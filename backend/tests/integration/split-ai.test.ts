import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { getPool } from '../../src/db/pool.js';
import { env } from '../../src/config/env.js';

/**
 * Integration test TAHAP 5: Cine-AI (quiz + chat) dan Split Bill
 * (buat patungan → tracker → halaman publik → guard).
 *
 * Butuh PostgreSQL + Redis (seat lock) berjalan: docker compose up -d && npm run db:migrate.
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

async function register(email: string): Promise<string> {
  const reg = await api('POST', '/api/v1/auth/register', {
    full_name: 'Peserta Test',
    email,
    password: 'rahasia123',
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  return reg.body.data.tokens.access_token as string;
}

/** Booking pending_payment via alur asli (butuh Redis untuk seat lock). */
async function createPendingBooking(token: string): Promise<{ id: string; grandTotal: number }> {
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
    .slice(0, 3);
  assert.ok(chosen.length >= 2, 'butuh minimal 2 kursi tersedia untuk patungan');

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

describe('Cine-AI (TAHAP 5)', () => {
  it('quiz selalu mengembalikan rekomendasi ber-rationale', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const token = await register(`ai-quiz-${Date.now()}@test.local`);
    const res = await api(
      'POST',
      '/api/v1/ai/quiz',
      {
        mood: 'keluarga',
        favorite_genres: ['Animation', 'Family'],
        max_duration_minutes: 150,
        companion: 'keluarga',
        limit: 3,
      },
      token,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const items = res.body.data.recommendations;
    assert.ok(items.length >= 1, 'seed menyediakan film now_showing');
    assert.ok(items.length <= 3);
    for (const item of items) {
      assert.ok(item.movie.id && item.movie.title);
      assert.equal(typeof item.match_score, 'number');
      assert.match(item.rationale, /^Film ini cocok untuk Anda karena /);
      // teman nonton keluarga => tidak ada film 17+/21+
      assert.ok(['SU', '13+'].includes(item.movie.age_rating), item.movie.age_rating);
    }
    assert.ok(['gemini', 'local'].includes(res.body.data.engine));
  });

  it('chat Cine-Buddy membalas dengan rekomendasi yang bisa dipakai', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const token = await register(`ai-chat-${Date.now()}@test.local`);
    const res = await api(
      'POST',
      '/api/v1/ai/chat',
      { message: 'Ada film animasi ringan buat keluarga, nggak lebih dari 120 menit?' },
      token,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.data.reply.length >= 10);
    assert.ok(Array.isArray(res.body.data.recommendations));
    for (const item of res.body.data.recommendations) {
      assert.match(item.rationale, /^Film ini cocok untuk Anda karena /);
    }
  });

  it('quiz butuh autentikasi dan mood valid', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const anonymous = await api('POST', '/api/v1/ai/quiz', { mood: 'santai' });
    assert.equal(anonymous.status, 401);

    const token = await register(`ai-bad-${Date.now()}@test.local`);
    const bad = await api('POST', '/api/v1/ai/quiz', { mood: 'bosen' }, token);
    assert.equal(bad.status, 422);
  });
});

describe('Split Bill (TAHAP 5)', () => {
  it('buat patungan rata → tracker → halaman publik', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const host = await register(`split-host-${Date.now()}@test.local`);
    const guest = await register(`split-guest-${Date.now()}@test.local`);
    const outsider = await register(`split-out-${Date.now()}@test.local`);

    const { id: bookingId, grandTotal } = await createPendingBooking(host);
    const hostId = (await api('GET', '/api/v1/auth/me', undefined, host)).body.data.id;
    const guestId = (await api('GET', '/api/v1/auth/me', undefined, guest)).body.data.id;

    const created = await api(
      'POST',
      `/api/v1/bookings/${bookingId}/split-bills`,
      {
        method: 'equal',
        participants: [
          { name: 'Host', user_id: hostId },
          { name: 'Guest', user_id: guestId },
        ],
      },
      host,
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const split = created.body.data;
    assert.equal(split.booking_id, bookingId);
    assert.equal(split.total_amount, grandTotal);
    assert.equal(split.share_count, 2);
    assert.equal(split.status, 'pending');
    assert.match(split.share_token, /^sp_[0-9a-f]{16}$/);
    assert.ok(split.share_url.includes(`/split-bills/share/${split.share_token}`));
    assert.equal(sumShares(split.participants), grandTotal);
    assert.equal(split.tracker.total, grandTotal);
    assert.equal(split.tracker.remaining, grandTotal);
    assert.equal(split.tracker.all_paid, false);

    // payload QRIS tiap peserta unik & siap render
    const payloads = new Set(split.participants.map((p: any) => p.qris_payload));
    assert.equal(payloads.size, split.participants.length);
    for (const payload of payloads) {
      assert.ok(payload.startsWith('000201'));
      assert.match(payload, /6304[0-9A-F]{4}$/);
    }

    // peserta yang ditautkan boleh membuka tracker
    const guestView = await api('GET', `/api/v1/split-bills/${split.id}`, undefined, guest);
    assert.equal(guestView.status, 200, JSON.stringify(guestView.body));

    // bukan peserta ditolak
    const foreign = await api('GET', `/api/v1/split-bills/${split.id}`, undefined, outsider);
    assert.equal(foreign.status, 403);

    // halaman publik: tanpa autentikasi, tanpa ID pengguna
    const share = await api('GET', `/api/v1/split-bills/share/${split.share_token}`);
    assert.equal(share.status, 200, JSON.stringify(share.body));
    assert.equal(share.body.data.host.id, null);
    for (const participant of share.body.data.participants) {
      assert.equal(participant.user_id, null);
    }
    assert.equal(share.body.data.tracker.total, grandTotal);

    // patungan aktif tidak boleh dobel
    const duplicate = await api(
      'POST',
      `/api/v1/bookings/${bookingId}/split-bills`,
      { method: 'equal', participants: [{ name: 'A' }, { name: 'B' }] },
      host,
    );
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'SPLIT_EXISTS');
  });

  it('metode kustom wajib sama persis dengan total tagihan', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const host = await register(`split-custom-${Date.now()}@test.local`);
    const { id: bookingId, grandTotal } = await createPendingBooking(host);

    const mismatch = await api(
      'POST',
      `/api/v1/bookings/${bookingId}/split-bills`,
      {
        method: 'custom',
        participants: [{ name: 'A', amount: 1000 }, { name: 'B', amount: grandTotal }],
      },
      host,
    );
    assert.equal(mismatch.status, 422, JSON.stringify(mismatch.body));
    assert.equal(mismatch.body.error.code, 'SHARE_MISMATCH');

    const custom = await api(
      'POST',
      `/api/v1/bookings/${bookingId}/split-bills`,
      {
        method: 'custom',
        participants: [
          { name: 'A', amount: Math.floor(grandTotal / 4) },
          { name: 'B', amount: grandTotal - Math.floor(grandTotal / 4) },
        ],
      },
      host,
    );
    assert.equal(custom.status, 201, JSON.stringify(custom.body));
    assert.equal(sumShares(custom.body.data.participants), grandTotal);
  });

  it('booking milik orang lain tidak bisa dipatungkan', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const host = await register(`split-owner-${Date.now()}@test.local`);
    const thief = await register(`split-thief-${Date.now()}@test.local`);
    const { id: bookingId } = await createPendingBooking(host);

    const res = await api(
      'POST',
      `/api/v1/bookings/${bookingId}/split-bills`,
      { method: 'equal', participants: [{ name: 'X' }, { name: 'Y' }] },
      thief,
    );
    assert.equal(res.status, 404);
  });
});

function sumShares(participants: any[]): number {
  return participants.reduce((total, p) => total + Number(p.share_amount), 0);
}
