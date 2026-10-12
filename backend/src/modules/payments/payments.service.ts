import { getPool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { assembleQr, verifyTicketQr } from '../../common/utils/eticket.js';
import type { ChargeResult, PaymentChannel } from './gateways/gateway.js';
import { gatewayByName, resolveGateway } from './gateways/index.js';
import { settlePayment, type SettlementOutcome } from './settlement.service.js';
import type { CreatePaymentInput } from './payments.schemas.js';

const PAYABLE = new Set(['pending_payment', 'partially_paid']);

interface BookingContextRow {
  id: string;
  booking_code: string;
  user_id: string;
  status: string;
  grand_total: string;
  payment_due_at: Date | null;
  cinema_name: string;
  cinema_city: string;
  movie_title: string;
  starts_at: Date;
  user_name: string;
  user_email: string;
}

interface ParticipantRow {
  id: string;
  split_bill_id: string;
  user_id: string | null;
  name: string;
  share_amount: string;
  status: string;
}

interface PaymentRow {
  id: string;
  booking_id: string;
  channel: string;
  amount: string;
  status: string;
  gateway: string;
  gateway_transaction_id: string | null;
  created_at: Date;
}

const CONTEXT_SELECT = `
  SELECT b.id, b.booking_code, b.user_id, b.status, b.grand_total, b.payment_due_at,
         c.name AS cinema_name, c.city AS cinema_city, m.title AS movie_title, st.starts_at,
         u.full_name AS user_name, u.email AS user_email
  FROM bookings b
  JOIN showtimes st ON st.id = b.showtime_id
  JOIN movies m ON m.id = st.movie_id
  JOIN studios s ON s.id = st.studio_id
  JOIN cinemas c ON c.id = s.cinema_id
  JOIN users u ON u.id = b.user_id
`;

function chargeResponse(
  payment: PaymentRow,
  amount: number,
  charge: ChargeResult | null,
): Record<string, unknown> {
  return {
    id: payment.id,
    booking_id: payment.booking_id,
    channel: payment.channel,
    amount,
    status: payment.status,
    gateway: payment.gateway,
    simulated: payment.gateway === 'simulated',
    qris_payload: charge?.qrisPayload ?? null,
    pay_url: charge?.payUrl ?? null,
    va_number: charge?.vaNumber ?? null,
    va_bank: charge?.vaBank ?? null,
    transaction_id: charge?.transactionId ?? payment.gateway_transaction_id,
    created_at: payment.created_at.toISOString(),
    poll_url: `/api/v1/payments/${payment.id}/status`,
  };
}

async function loadContext(bookingId: string): Promise<BookingContextRow> {
  const result = await getPool().query<BookingContextRow>(`${CONTEXT_SELECT} WHERE b.id = $1`, [bookingId]);
  const context = result.rows[0];
  if (!context) throw new AppError(404, 'NOT_FOUND', 'Booking tidak ditemukan.');
  return context;
}

function assertPayable(context: BookingContextRow): void {
  if (!PAYABLE.has(context.status)) {
    throw new AppError(409, 'BOOKING_NOT_PAYABLE', 'Booking ini sudah lunas atau tidak dapat dibayar.');
  }
  if (context.payment_due_at && context.payment_due_at.getTime() <= Date.now()) {
    throw new AppError(410, 'PAYMENT_WINDOW_CLOSED', 'Batas waktu pembayaran booking ini habis.');
  }
}

async function findActiveSplitId(bookingId: string): Promise<string | null> {
  const result = await getPool().query<{ id: string }>(
    `SELECT id FROM split_bills WHERE booking_id = $1 AND status IN ('pending', 'partially_paid')`,
    [bookingId],
  );
  return result.rows[0]?.id ?? null;
}

async function loadParticipant(splitId: string, participantId: string): Promise<ParticipantRow> {
  const result = await getPool().query<ParticipantRow>(
    `SELECT id, split_bill_id, user_id, name, share_amount, status
     FROM split_bill_participants WHERE id = $1 AND split_bill_id = $2`,
    [participantId, splitId],
  );
  const participant = result.rows[0];
  if (!participant) throw new AppError(404, 'NOT_FOUND', 'Peserta patungan tidak ditemukan.');
  return participant;
}

async function reusePendingPayment(
  bookingId: string,
  participantId: string | null,
): Promise<{ payment: PaymentRow; charge: ChargeResult } | null> {
  const pool = getPool();
  const existing = await pool.query<PaymentRow>(
    `SELECT id, booking_id, channel, amount, status, gateway, gateway_transaction_id, created_at
     FROM payments
     WHERE booking_id = $1 AND status = 'pending'
       AND split_participant_id IS NOT DISTINCT FROM $2
     ORDER BY created_at DESC LIMIT 1`,
    [bookingId, participantId],
  );
  const payment = existing.rows[0];
  if (!payment) return null;

  const gateway = resolveGateway();
  if (payment.gateway !== gateway.name || !payment.gateway_transaction_id) return null;

  const stored = await pool.query<{ gateway_raw: ChargeResult | null }>(
    `SELECT gateway_raw FROM payments WHERE id = $1`,
    [payment.id],
  );
  const charge = stored.rows[0]?.gateway_raw ?? null;
  return charge ? { payment, charge } : null;
}

/** Membuat (atau memakai ulang) intent pembayaran untuk booking penuh maupun share patungan. */
export async function createCharge(
  userId: string,
  bookingId: string,
  input: CreatePaymentInput,
): Promise<Record<string, unknown>> {
  const context = await loadContext(bookingId);
  assertPayable(context);

  const pool = getPool();
  const splitId = await findActiveSplitId(bookingId);
  const isOwner = context.user_id === userId;
  let participant: ParticipantRow | null = null;
  let amount = Number(context.grand_total);

  if (input.participant_id) {
    if (!splitId) {
      throw new AppError(404, 'NOT_FOUND', 'Patungan untuk booking ini tidak ditemukan.');
    }
    participant = await loadParticipant(splitId, input.participant_id);
    // Pemilik booking boleh membayarkan share siapa pun; peserta hanya share-nya sendiri.
    if (!isOwner && participant.user_id !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Anda bukan peserta untuk share ini.');
    }
    if (participant.status === 'paid') {
      throw new AppError(409, 'PARTICIPANT_PAID', 'Share ini sudah lunas.');
    }
    amount = Number(participant.share_amount);
  } else if (!isOwner) {
    throw new AppError(403, 'FORBIDDEN', 'Hanya pemilik booking yang dapat melunasi tagihan penuh.');
  } else if (splitId) {
    throw new AppError(409, 'SPLIT_ACTIVE', 'Tagihan sedang dipatungkan; bayar melalui tautan patungan.');
  }

  if (amount <= 0) {
    throw new AppError(409, 'BOOKING_NOT_PAYABLE', 'Tidak ada sisa tagihan yang perlu dibayar.');
  }

  const scope = participant?.id ?? null;
  const reusable = await reusePendingPayment(bookingId, scope);
  if (reusable && reusable.payment.channel === input.channel) {
    return chargeResponse(reusable.payment, Number(reusable.payment.amount), reusable.charge);
  }

  const gateway = resolveGateway();
  const inserted = await pool.query<PaymentRow>(
    `INSERT INTO payments (booking_id, split_participant_id, user_id, channel, amount, status, gateway)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     RETURNING id, booking_id, channel, amount, status, gateway, gateway_transaction_id, created_at`,
    [bookingId, scope, userId, input.channel, amount, gateway.name],
  );
  const payment = inserted.rows[0];

  let charge: ChargeResult;
  try {
    charge = await gateway.charge({
      paymentId: payment.id,
      channel: input.channel as PaymentChannel,
      amount,
      description: participant
        ? `Patungan ${context.booking_code} - ${participant.name}`
        : `Tiket ${context.booking_code} - ${context.movie_title}`,
      customerName: context.user_name,
      customerEmail: context.user_email,
      merchantName: context.cinema_name,
      merchantCity: context.cinema_city,
    });
  } catch (err) {
    await pool
      .query(`UPDATE payments SET status = 'failed', failure_reason = 'CHARGE_FAILED' WHERE id = $1`, [payment.id])
      .catch(() => undefined);
    if (err instanceof AppError) throw err;
    throw new AppError(502, 'GATEWAY_UNAVAILABLE', 'Payment gateway tidak dapat dihubungi, coba lagi.');
  }

  await pool.query(`UPDATE payments SET gateway_transaction_id = $2, gateway_raw = $3 WHERE id = $1`, [
    payment.id,
    charge.transactionId,
    JSON.stringify(charge),
  ]);

  return chargeResponse({ ...payment, gateway_transaction_id: charge.transactionId }, amount, charge);
}

/** Notifikasi gateway (publik). Signature sudah diverifikasi sebelum settle dipanggil. */
export async function handleWebhook(gatewayName: string, body: Record<string, unknown>) {
  const gateway = gatewayByName(gatewayName);
  if (!gateway || !gateway.acceptsNotifications) {
    throw new AppError(400, 'GATEWAY_UNAVAILABLE', `Gateway ${gatewayName} tidak menerima notifikasi.`);
  }

  const notification = gateway.parseNotification(body);
  if (!notification) {
    throw new AppError(400, 'INVALID_SIGNATURE', 'Notifikasi pembayaran tidak valid.');
  }

  return settlePayment(notification);
}

/** Jalur dev/test: melunasi payment tanpa gateway, lewat settlement yang sama. */
export async function simulateSettlement(paymentId: string, userId: string): Promise<SettlementOutcome> {
  if (env.NODE_ENV === 'production') {
    throw new AppError(403, 'FORBIDDEN', 'Simulasi pembayaran tidak tersedia di production.');
  }

  const result = await getPool().query<{ amount: string; payer_user_id: string | null }>(
    `SELECT p.amount, p.user_id AS payer_user_id
     FROM payments p JOIN bookings b ON b.id = p.booking_id
     WHERE p.id = $1`,
    [paymentId],
  );
  const payment = result.rows[0];
  if (!payment) throw new AppError(404, 'NOT_FOUND', 'Pembayaran tidak ditemukan.');
  if (payment.payer_user_id !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Bukan pembayaran milik Anda.');
  }

  return settlePayment({
    paymentId,
    status: 'settled',
    grossAmount: Number(payment.amount),
    raw: { simulated: true, order_id: paymentId, gross_amount: payment.amount },
  });
}

export async function paymentStatus(paymentId: string, userId: string) {
  const result = await getPool().query<PaymentRow & { booking_status: string; participant_status: string | null }>(
    `SELECT p.id, p.booking_id, p.channel, p.amount, p.status, p.gateway, p.gateway_transaction_id, p.created_at,
            b.status AS booking_status, sp.status AS participant_status
     FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     LEFT JOIN split_bill_participants sp ON sp.id = p.split_participant_id
     WHERE p.id = $1 AND (b.user_id = $2 OR sp.user_id = $2)`,
    [paymentId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Pembayaran tidak ditemukan.');

  return {
    id: row.id,
    status: row.status,
    amount: Number(row.amount),
    gateway: row.gateway,
    booking_status: row.booking_status,
    participant_status: row.participant_status,
    has_ticket: row.booking_status === 'paid',
  };
}

export async function bookingTicket(bookingId: string, userId: string) {
  const context = await loadContext(bookingId);
  if (context.user_id !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Bukan booking milik Anda.');
  }
  if (context.status !== 'paid') {
    throw new AppError(409, 'TICKET_NOT_ISSUED', 'E-ticket terbit setelah pembayaran lunas.');
  }

  const pool = getPool();
  const ticket = await pool.query<{ ticket_code: string; ticket_signature: string; ticket_issued_at: Date | null }>(
    `SELECT ticket_code, ticket_signature, ticket_issued_at FROM bookings WHERE id = $1`,
    [bookingId],
  );
  const row = ticket.rows[0];
  if (!row?.ticket_code || !row.ticket_signature) {
    throw new AppError(409, 'TICKET_NOT_ISSUED', 'E-ticket belum diterbitkan.');
  }

  const orders = await pool.query<{
    id: string;
    pickup_code: string;
    pickup_signature: string | null;
    total_amount: string;
    status: string;
  }>(
    `SELECT id, pickup_code, pickup_signature, total_amount, status
     FROM fnb_orders WHERE booking_id = $1 AND status <> 'cancelled' ORDER BY created_at`,
    [bookingId],
  );

  return {
    booking_code: context.booking_code,
    movie_title: context.movie_title,
    cinema_name: context.cinema_name,
    starts_at: context.starts_at,
    ticket: {
      code: row.ticket_code,
      issued_at: row.ticket_issued_at,
      qr_payload: assembleQr('ticket', row.ticket_code, context.booking_code, row.ticket_signature),
    },
    fnb_orders: orders.rows.map((order) => ({
      id: order.id,
      pickup_code: order.pickup_code,
      status: order.status,
      total_amount: Number(order.total_amount),
      qr_payload: order.pickup_signature
        ? assembleQr('fnb', order.pickup_code, context.booking_code, order.pickup_signature)
        : null,
    })),
  };
}

/** Verifikasi QR di gerbang masuk (staff/admin): stateless, tanpa need DB untuk validitas. */
export async function scanTicket(qrPayload: string) {
  const scanned = verifyTicketQr(env.TICKET_QR_SECRET, qrPayload);
  if (!scanned) {
    return { valid: false, message: 'QR tidak valid atau dipalsukan.' };
  }

  const pool = getPool();
  const result = await pool.query<{
    id: string;
    status: string;
    ticket_code: string | null;
    movie_title: string;
    cinema_name: string;
    studio_name: string;
    starts_at: Date;
  }>(
    `SELECT b.id, b.status, b.ticket_code, m.title AS movie_title, c.name AS cinema_name,
            s.name AS studio_name, st.starts_at
     FROM bookings b
     JOIN showtimes st ON st.id = b.showtime_id
     JOIN movies m ON m.id = st.movie_id
     JOIN studios s ON s.id = st.studio_id
     JOIN cinemas c ON c.id = s.cinema_id
     WHERE b.booking_code = $1`,
    [scanned.bookingCode],
  );
  const booking = result.rows[0];

  if (!booking) return { valid: false, message: 'Booking untuk QR ini tidak ditemukan.' };

  if (scanned.kind === 'ticket') {
    if (booking.ticket_code !== scanned.code) {
      return { valid: false, message: 'Kode tiket tidak cocok dengan booking-nya.' };
    }
  } else {
    const pickup = await pool.query(
      `SELECT 1 FROM fnb_orders WHERE booking_id = $1 AND pickup_code = $2 AND status <> 'cancelled'`,
      [booking.id, scanned.code],
    );
    if (!pickup.rowCount) return { valid: false, message: 'Kode pengambilan F&B tidak cocok.' };
  }

  if (booking.status !== 'paid') {
    return { valid: false, message: `Booking belum lunas (status: ${booking.status}).` };
  }

  return {
    valid: true,
    kind: scanned.kind,
    code: scanned.code,
    message: scanned.kind === 'ticket' ? 'Tiket valid.' : 'Kode F&B valid.',
    booking: {
      booking_code: scanned.bookingCode,
      movie_title: booking.movie_title,
      cinema: booking.cinema_name,
      studio: booking.studio_name,
      starts_at: booking.starts_at,
    },
  };
}
