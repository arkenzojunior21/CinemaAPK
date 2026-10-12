import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { getPool } from '../../src/db/pool.js';
import { env } from '../../src/config/env.js';
import { verifyTicketQr } from '../../src/common/utils/eticket.js';

/**
 * Integration test TAHAP 6: pembayaran (charge → lunas → e-ticket) dan
 * penerbitan QR tiket/F&B, termasuk jalur patungan sampai lunas.
 *
 * Butuh PostgreSQL + Redis: docker compose up -d && npm run db:migrate.
 * Otomatis di-skip bila PostgreSQL tidak terjangkau.
 */

let server: Server;
let baseUrl: string;
let dbAvailable = false;

before(async () => {
  try {
    await Promise.race([
      getPool().query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Gagal mendapatkan port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
  if (env.DATABASE_URL) {
    try {
      await getPool().end();
    } catch {
      // pool mungkin tidak pernah terbentuk — aman diabaikan
    }
  }
});

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function me(token: string): Promise<string> {
  const res = await api('GET', '/api/v1/auth/me', undefined, token);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.id as string;
}

async function register(name: string, email: string): Promise<string> {
  const reg = await api('POST', '/api/v1/auth/register', {
    full_name: name,
    email,
    password: 'rahasia123',
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  return reg.body.data.tokens.access_token as string;
}

async function createPendingBooking(
  token: string,
  seatCount: number,
): Promise<{ id: string; grandTotal: number }> {
  const movies = await api('GET', '/api/v1/movies?status=now_showing&limit=5', undefined, token);
  assert.equal(movies.status, 200);
  const showtimes = await api(
    'GET',
    `/api/v1/movies/${movies.body.data.items[0].id}/showtimes`,
    undefined,
    token,
  );
  assert.equal(showtimes.status, 200);
  const showtime = showtimes.body.data.groups[0].showtimes[0];

  const seatMap = await api('GET', `/api/v1/showtimes/${showtime.id}`, undefined, token);
  const chosen = seatMap.body.data.seats
    .filter((s: any) => s.status === 'available')
    .slice(0, seatCount);
  assert.ok(chosen.length === seatCount, `butuh ${seatCount} kursi tersedia`);

  const lock = await api(
    'POST',
    `/api/v1/showtimes/${showtime.id}/seat-locks`,
    { seat_ids: chosen.map((s: any) => s.id) },
    token,
  );
  assert.equal(lock.status, 201, JSON.stringify(lock.body));

  const booking = await api(
    'POST',
    '/api/v1/bookings',
    {
      showtime_id: showtime.id,
      seat_reservation_ids: lock.body.data.locks.map((l: any) => l.reservation_id),
    },
    token,
  );
  assert.equal(booking.status, 201, JSON.stringify(booking.body));
  return { id: booking.body.data.id, grandTotal: booking.body.data.grand_total };
}

async function createSplit(
  token: string,
  bookingId: string,
  hostId: string,
  hostName: string,
  guestName: string,
): Promise<any> {
  const bill = await api(
    'POST',
    `/api/v1/bookings/${bookingId}/split-bills`,
    {
      method: 'equal',
      participants: [
        { name: hostName, user_id: hostId },
        { name: guestName },
      ],
    },
    token,
  );
  assert.equal(bill.status, 201, JSON.stringify(bill.body));
  return bill.body.data;
}

describe('Pembayaran penuh & e-ticket (TAHAP 6)', () => {
  it('charge → lunas → e-ticket terbit dengan QR yang dapat diverifikasi', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const token = await register('Pembayar Utama', `pay-full-${Date.now()}@test.local`);
    const booking = await createPendingBooking(token, 2);

    const before = await api('GET', `/api/v1/bookings/${booking.id}/ticket`, undefined, token);
    assert.equal(before.status, 409, 'tiket belum boleh terbit sebelum bayar');
    assert.equal(before.body.error.code, 'TICKET_NOT_ISSUED');

    const charge = await api('POST', `/api/v1/bookings/${booking.id}/payments`, { channel: 'qris' }, token);
    assert.equal(charge.status, 201, JSON.stringify(charge.body));
    const payment = charge.body.data;
    assert.equal(payment.amount, booking.grandTotal);
    assert.equal(payment.status, 'pending');
    assert.equal(payment.simulated, true);
    assert.match(payment.qris_payload, /^000201/);

    const again = await api('POST', `/api/v1/bookings/${booking.id}/payments`, { channel: 'qris' }, token);
    assert.equal(again.body.data.id, payment.id, 'charge kedua memakai intent pending yang sama');

    const settled = await api('POST', `/api/v1/payments/${payment.id}/simulate`, undefined, token);
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal(settled.body.data.effect, 'settled');
    assert.equal(settled.body.data.booking_status, 'paid');

    const status = await api('GET', `/api/v1/payments/${payment.id}/status`, undefined, token);
    assert.equal(status.body.data.status, 'settled');
    assert.equal(status.body.data.has_ticket, true);

    const ticket = await api('GET', `/api/v1/bookings/${booking.id}/ticket`, undefined, token);
    assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
    assert.match(ticket.body.data.ticket.code, /^TK-[A-Z0-9]{6}$/);
    const scanned = verifyTicketQr(env.TICKET_QR_SECRET, ticket.body.data.ticket.qr_payload);
    assert.equal(scanned?.code, ticket.body.data.ticket.code);
    assert.equal(scanned?.bookingCode, ticket.body.data.booking_code);

    const duplicate = await api('POST', `/api/v1/payments/${payment.id}/simulate`, undefined, token);
    assert.equal(duplicate.body.data.effect, 'duplicate');
    const ticketAgain = await api('GET', `/api/v1/bookings/${booking.id}/ticket`, undefined, token);
    assert.equal(ticketAgain.body.data.ticket.code, ticket.body.data.ticket.code, 'kode tiket tidak boleh berganti');
  });

  it('menolak pelunasan penuh saat tagihan sedang dipatungkan', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const host = await register('Host Split', `pay-host-${Date.now()}@test.local`);
    const booking = await createPendingBooking(host, 2);
    const split = await createSplit(host, booking.id, await me(host), 'Host Split', 'Tamu One');

    const blocked = await api('POST', `/api/v1/bookings/${booking.id}/payments`, { channel: 'qris' }, host);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'SPLIT_ACTIVE');
    assert.ok(split.participants.length === 2);
  });

  it('pembayaran share: lunas sebagian lalu lunas penuh menerbitkan satu tiket', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const host = await register('Host Bertahap', `pay-split-${Date.now()}@test.local`);
    const booking = await createPendingBooking(host, 2);
    const split = await createSplit(host, booking.id, await me(host), 'Host Bertahap', 'Tamu Dua');
    const [first, second] = split.participants;
    assert.equal(first.share_amount + second.share_amount, booking.grandTotal);

    const chargeFirst = await api(
      'POST',
      `/api/v1/bookings/${booking.id}/payments`,
      { channel: 'qris', participant_id: first.id },
      host,
    );
    assert.equal(chargeFirst.status, 201, JSON.stringify(chargeFirst.body));
    assert.equal(chargeFirst.body.data.amount, first.share_amount);

    const settleFirst = await api('POST', `/api/v1/payments/${chargeFirst.body.data.id}/simulate`, undefined, host);
    assert.equal(settleFirst.body.data.booking_status, 'partially_paid');

    const tracker = await api('GET', `/api/v1/split-bills/${split.id}`, undefined, host);
    assert.equal(tracker.body.data.tracker.paid_count, 1);
    assert.equal(tracker.body.data.status, 'partially_paid');

    const chargeSecond = await api(
      'POST',
      `/api/v1/bookings/${booking.id}/payments`,
      { channel: 'virtual_account', participant_id: second.id },
      host,
    );
    assert.equal(chargeSecond.status, 201, JSON.stringify(chargeSecond.body));
    assert.match(chargeSecond.body.data.va_number, /^\d+$/);

    const settleSecond = await api('POST', `/api/v1/payments/${chargeSecond.body.data.id}/simulate`, undefined, host);
    assert.equal(settleSecond.body.data.booking_status, 'paid', 'share terakhir melunasi booking');

    const paidTracker = await api('GET', `/api/v1/split-bills/${split.id}`, undefined, host);
    assert.equal(paidTracker.body.data.tracker.remaining, 0);
    assert.equal(paidTracker.body.data.tracker.all_paid, true);

    const ticket = await api('GET', `/api/v1/bookings/${booking.id}/ticket`, undefined, host);
    assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
    assert.ok(ticket.body.data.ticket.qr_payload.length > 40);
  });

  it('guard akses: tanpa token 401, booking orang lain 403', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const owner = await register('Pemilik', `pay-owner-${Date.now()}@test.local`);
    const stranger = await register('Orang Lain', `pay-other-${Date.now()}@test.local`);
    const booking = await createPendingBooking(owner, 2);

    const noToken = await api('POST', `/api/v1/bookings/${booking.id}/payments`, { channel: 'qris' });
    assert.equal(noToken.status, 401);

    const foreign = await api('POST', `/api/v1/bookings/${booking.id}/payments`, { channel: 'qris' }, stranger);
    assert.equal(foreign.status, 403);

    const foreignTicket = await api('GET', `/api/v1/bookings/${booking.id}/ticket`, undefined, stranger);
    assert.equal(foreignTicket.status, 403);
  });

  it('webhook menolak notifikasi tanpa gateway/signature yang sah', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const bogus = await api('POST', '/api/v1/payments/webhook/midtrans', { order_id: 'x' });
    assert.equal(bogus.status, 400);
    assert.ok(['INVALID_SIGNATURE', 'GATEWAY_UNAVAILABLE'].includes(bogus.body.error.code));

    const unknown = await api('POST', '/api/v1/payments/webhook/stripe', { order_id: 'x' });
    assert.equal(unknown.status, 400);

    const simulated = await api('POST', '/api/v1/payments/webhook/simulated', { order_id: 'x' });
    assert.equal(simulated.status, 400);
  });

  it('kanal tidak valid ditolak skema', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const token = await register('Kanal Salah', `pay-channel-${Date.now()}@test.local`);
    const booking = await createPendingBooking(token, 2);
    const res = await api('POST', `/api/v1/bookings/${booking.id}/payments`, { channel: 'credit_card' }, token);
    assert.equal(res.status, 422);
  });
});
