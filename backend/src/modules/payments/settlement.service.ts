import type { ClientBase } from 'pg';
import { getPool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { generateTicketCode, signQr } from '../../common/utils/eticket.js';
import { summarizeTracker } from '../split/split.calc.js';
import type { VerifiedNotification } from './gateways/gateway.js';

export type SettlementEffect =
  | 'settled'
  | 'failed'
  | 'expired'
  | 'duplicate'
  | 'ignored_pending'
  | 'amount_mismatch'
  | 'booking_not_payable';

export interface SettlementOutcome {
  payment_id: string;
  payment_status: string;
  booking_status: string | null;
  effect: SettlementEffect;
  message: string;
}

interface PaymentRow {
  id: string;
  booking_id: string;
  split_participant_id: string | null;
  amount: string;
  status: string;
}

interface BookingRow {
  id: string;
  booking_code: string;
  status: string;
  ticket_code: string | null;
}

const PAYABLE = new Set(['pending_payment', 'partially_paid']);

async function issueETicket(client: ClientBase, booking: BookingRow): Promise<void> {
  const ticketCode = booking.ticket_code ?? generateTicketCode();

  await client.query(
    `UPDATE bookings
     SET status = 'paid',
         paid_at = COALESCE(paid_at, now()),
         ticket_code = $2,
         ticket_signature = $3,
         ticket_issued_at = COALESCE(ticket_issued_at, now())
     WHERE id = $1`,
    [
      booking.id,
      ticketCode,
      signQr(env.TICKET_QR_SECRET, 'ticket', ticketCode, booking.booking_code),
    ],
  );

  const orders = await client.query<{ id: string; pickup_code: string; pickup_signature: string | null }>(
    `SELECT id, pickup_code, pickup_signature
     FROM fnb_orders WHERE booking_id = $1 AND status <> 'cancelled' FOR UPDATE`,
    [booking.id],
  );

  for (const order of orders.rows) {
    await client.query(
      `UPDATE fnb_orders
       SET status = 'paid',
           pickup_signature = COALESCE(pickup_signature, $2)
       WHERE id = $1`,
      [order.id, signQr(env.TICKET_QR_SECRET, 'fnb', order.pickup_code, booking.booking_code)],
    );
  }
}

async function settleSplit(client: ClientBase, payment: PaymentRow): Promise<BookingRow | null> {
  await client.query(
    `UPDATE split_bill_participants
     SET status = 'paid', paid_at = now(), payment_reference = $2
     WHERE id = $1 AND status <> 'paid'`,
    [payment.split_participant_id, payment.id],
  );

  const rows = await client.query<{ share_amount: string; status: string; booking_id: string; split_id: string }>(
    `SELECT p.share_amount, p.status, s.booking_id, s.id AS split_id
     FROM split_bill_participants p
     JOIN split_bills s ON s.id = p.split_bill_id
     WHERE s.booking_id = $1
     ORDER BY p.created_at, p.name
     FOR UPDATE OF p`,
    [payment.booking_id],
  );

  const first = rows.rows[0];
  if (!first) {
    throw new AppError(409, 'SPLIT_INVALID', 'Peserta patungan untuk pembayaran ini tidak ditemukan.');
  }

  const shares = rows.rows.map((row) => Number(row.share_amount));
  const statuses = rows.rows.map((row) => row.status);
  const tracker = summarizeTracker(shares, statuses);

  const splitStatus = tracker.allPaid ? 'paid' : tracker.paidCount > 0 ? 'partially_paid' : 'pending';
  await client.query(`UPDATE split_bills SET status = $2 WHERE id = $1`, [first.split_id, splitStatus]);

  const booking = await client.query<BookingRow>(
    `SELECT id, booking_code, status, ticket_code FROM bookings WHERE id = $1`,
    [payment.booking_id],
  );
  const current = booking.rows[0];
  if (!current) {
    throw new AppError(404, 'NOT_FOUND', 'Booking untuk pembayaran ini tidak ditemukan.');
  }

  if (tracker.allPaid && PAYABLE.has(current.status)) {
    await issueETicket(client, current);
    return { ...current, status: 'paid' };
  }

  if (tracker.paidCount > 0 && current.status === 'pending_payment') {
    await client.query(`UPDATE bookings SET status = 'partially_paid' WHERE id = $1`, [current.id]);
  }

  return current;
}

/**
 * Pintu masuk tunggal untuk semua sinyal pembayaran (webhook gateway maupun
 * simulator dev). Idempotent: notifikasi ulang atas payment yang sudah terminal
 * hanya dikembalikan sebagai duplicate, tidak pernah menerbitkan tiket kedua.
 */
export async function settlePayment(notification: VerifiedNotification): Promise<SettlementOutcome> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const paymentResult = await client.query<PaymentRow>(
      `SELECT id, booking_id, split_participant_id, amount, status
       FROM payments WHERE id = $1 FOR UPDATE`,
      [notification.paymentId],
    );
    const payment = paymentResult.rows[0];
    if (!payment) {
      await client.query('ROLLBACK');
      return {
        payment_id: notification.paymentId,
        payment_status: 'unknown',
        booking_status: null,
        effect: 'duplicate',
        message: 'Transaksi tidak dikenal, notifikasi diabaikan.',
      };
    }

    if (payment.status !== 'pending') {
      await client.query('COMMIT');
      return {
        payment_id: payment.id,
        payment_status: payment.status,
        booking_status: null,
        effect: 'duplicate',
        message: 'Pembayaran sudah berada pada status final.',
      };
    }

    const expectedAmount = Number(payment.amount);
    if (notification.status === 'settled' && notification.grossAmount !== null && notification.grossAmount !== expectedAmount) {
      await client.query(
        `UPDATE payments
         SET status = 'failed', failure_reason = 'AMOUNT_MISMATCH', gateway_raw = $2
         WHERE id = $1`,
        [payment.id, JSON.stringify(notification.raw)],
      );
      await client.query('COMMIT');
      return {
        payment_id: payment.id,
        payment_status: 'failed',
        booking_status: null,
        effect: 'amount_mismatch',
        message: 'Nominal notifikasi berbeda dengan tagihan; pembayaran ditandai gagal.',
      };
    }

    const bookingResult = await client.query<BookingRow>(
      `SELECT id, booking_code, status, ticket_code FROM bookings WHERE id = $1 FOR UPDATE`,
      [payment.booking_id],
    );
    const booking = bookingResult.rows[0];

    if (notification.status === 'pending') {
      await client.query('COMMIT');
      return {
        payment_id: payment.id,
        payment_status: 'pending',
        booking_status: booking?.status ?? null,
        effect: 'ignored_pending',
        message: 'Status belum final, menunggu notifikasi berikutnya.',
      };
    }

    if (notification.status === 'settled' && !PAYABLE.has(booking.status)) {
      await client.query(
        `UPDATE payments
         SET status = 'failed', failure_reason = 'BOOKING_NOT_PAYABLE', gateway_raw = $2
         WHERE id = $1`,
        [payment.id, JSON.stringify(notification.raw)],
      );
      await client.query('COMMIT');
      return {
        payment_id: payment.id,
        payment_status: 'failed',
        booking_status: booking.status,
        effect: 'booking_not_payable',
        message: 'Booking tidak lagi dapat dibayar; dana perlu direfund manual.',
      };
    }

    const nextStatus = notification.status;
    await client.query(
      `UPDATE payments
       SET status = $2,
           settled_at = CASE WHEN $2::text = 'settled' THEN now() ELSE settled_at END,
           failure_reason = CASE WHEN $2::text = 'settled' THEN NULL ELSE COALESCE(failure_reason, 'GATEWAY_REPORTED_FAILURE') END,
           gateway_raw = $3
       WHERE id = $1`,
      [payment.id, nextStatus, JSON.stringify(notification.raw)],
    );

    let bookingStatus = booking.status;
    if (nextStatus === 'settled') {
      if (payment.split_participant_id) {
        const updated = await settleSplit(client, payment);
        bookingStatus = updated?.status ?? booking.status;
      } else {
        await issueETicket(client, booking);
        bookingStatus = 'paid';
      }
    }

    await client.query('COMMIT');
    return {
      payment_id: payment.id,
      payment_status: nextStatus,
      booking_status: bookingStatus,
      effect: nextStatus,
      message: nextStatus === 'settled' ? 'Pembayaran lunas, tiket diterbitkan.' : `Pembayaran ${nextStatus}.`,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
