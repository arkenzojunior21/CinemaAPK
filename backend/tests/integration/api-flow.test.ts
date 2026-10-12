import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { getPool } from '../../src/db/pool.js';
import { env } from '../../src/config/env.js';

/**
 * Integration test alur inti TAHAP 3:
 * register → login → katalog film → jadwal → kunci kursi → konflik antar user
 * → booking → detail → cancel → refresh token → logout.
 *
 * Otomatis di-skip bila PostgreSQL tidak terjangkau.
 * Jalankan: docker compose up -d && npm run db:migrate && npm test
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

interface Tokens {
  access_token: string;
  refresh_token: string;
}

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

async function registerAndLogin(email: string): Promise<Tokens> {
  const reg = await api('POST', '/api/v1/auth/register', {
    full_name: 'Test User',
    email,
    password: 'rahasia123',
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  return reg.body.data.tokens;
}

describe('CineGen API end-to-end', () => {
  it('alur lengkap: auth, katalog, kursi, booking', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau — jalankan docker compose up -d');

    const stamp = Date.now();

    // --- Auth ---
    const tokens = await registerAndLogin(`user1-${stamp}@test.local`);
    const me = await api('GET', '/api/v1/auth/me', undefined, tokens.access_token);
    assert.equal(me.status, 200);
    assert.equal(me.body.data.email, `user1-${stamp}@test.local`);

    // --- Katalog film ---
    const movies = await api('GET', '/api/v1/movies?status=now_showing&limit=5');
    assert.equal(movies.status, 200);
    assert.ok(movies.body.data.items.length >= 3, 'seed harus menyediakan minimal 3 film now_showing');
    const movie = movies.body.data.items[0];

    // --- Jadwal per bioskop ---
    const showtimes = await api('GET', `/api/v1/movies/${movie.id}/showtimes`);
    assert.equal(showtimes.status, 200);
    assert.ok(showtimes.body.data.groups.length >= 1, 'minimal 1 bioskop punya jadwal');
    const showtime = showtimes.body.data.groups[0].showtimes[0];

    // --- Peta kursi ---
    const seatMap = await api('GET', `/api/v1/showtimes/${showtime.id}`);
    assert.equal(seatMap.status, 200);
    const availableSeats = seatMap.body.data.seats.filter((s: any) => s.status === 'available');
    assert.ok(availableSeats.length >= 2, 'minimal 2 kursi tersedia');
    const chosen = availableSeats.slice(0, 2);
    const expectedTotal = chosen.reduce((sum: number, s: any) => sum + s.price, 0);

    // --- Kunci kursi ---
    const lock = await api(
      'POST',
      `/api/v1/showtimes/${showtime.id}/seat-locks`,
      { seat_ids: chosen.map((s: any) => s.id) },
      tokens.access_token,
    );
    assert.equal(lock.status, 201, JSON.stringify(lock.body));
    assert.equal(lock.body.data.total_price, expectedTotal);
    assert.ok(new Date(lock.body.data.expires_at).getTime() > Date.now());

    // Peta kursi kini menandai kursi milik saya.
    const seatMapAfter = await api('GET', `/api/v1/showtimes/${showtime.id}`, undefined, tokens.access_token);
    const mineSeats = seatMapAfter.body.data.seats.filter((s: any) => s.status === 'mine');
    assert.equal(mineSeats.length, 2);

    // --- Konflik: user lain mencoba kursi yang sama ---
    const tokens2 = await registerAndLogin(`user2-${stamp}@test.local`);
    const conflict = await api(
      'POST',
      `/api/v1/showtimes/${showtime.id}/seat-locks`,
      { seat_ids: [chosen[0].id] },
      tokens2.access_token,
    );
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'SEAT_UNAVAILABLE');

    // --- Buat booking ---
    const booking = await api(
      'POST',
      '/api/v1/bookings',
      {
        showtime_id: showtime.id,
        seat_reservation_ids: lock.body.data.locks.map((l: any) => l.reservation_id),
      },
      tokens.access_token,
    );
    assert.equal(booking.status, 201, JSON.stringify(booking.body));
    assert.equal(booking.body.data.ticket_total, expectedTotal);
    assert.equal(booking.body.data.grand_total, expectedTotal);
    assert.match(booking.body.data.booking_code, /^CG-[A-Z2-9]{6}$/);

    // Kursi terkonfirmasi menjadi sold untuk semua orang.
    const seatMapSold = await api('GET', `/api/v1/showtimes/${showtime.id}`);
    const soldSeats = seatMapSold.body.data.seats.filter((s: any) => s.status === 'sold');
    assert.equal(soldSeats.length, 2);

    // --- Detail booking ---
    const detail = await api('GET', `/api/v1/bookings/${booking.body.data.id}`, undefined, tokens.access_token);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.seats.length, 2);
    assert.equal(detail.body.data.status, 'pending_payment');

    // User lain tidak boleh melihat booking ini.
    const foreign = await api('GET', `/api/v1/bookings/${booking.body.data.id}`, undefined, tokens2.access_token);
    assert.equal(foreign.status, 404);

    // --- Riwayat booking ---
    const list = await api('GET', '/api/v1/bookings', undefined, tokens.access_token);
    assert.equal(list.status, 200);
    assert.ok(list.body.data.items.length >= 1);

    // --- Pembatalan melepas kursi ---
    const cancel = await api('POST', `/api/v1/bookings/${booking.body.data.id}/cancel`, undefined, tokens.access_token);
    assert.equal(cancel.status, 200);
    const seatMapReleased = await api('GET', `/api/v1/showtimes/${showtime.id}`);
    const availableAfter = seatMapReleased.body.data.seats.filter((s: any) => s.status === 'available');
    assert.equal(availableAfter.length, seatMap.body.data.seats.length);
  });

  it('refresh token: rotasi, reuse ditolak, logout mencabut', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const stamp = Date.now();
    const tokens = await registerAndLogin(`refresh-${stamp}@test.local`);

    // Rotasi: refresh lama → pasangan baru.
    const rotated = await api('POST', '/api/v1/auth/refresh', { refresh_token: tokens.refresh_token });
    assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
    assert.notEqual(rotated.body.data.tokens.refresh_token, tokens.refresh_token);

    // Refresh lama sudah dicabut → ditolak.
    const reuse = await api('POST', '/api/v1/auth/refresh', { refresh_token: tokens.refresh_token });
    assert.equal(reuse.status, 401);

    // Logout mencabut refresh baru.
    const logout = await api(
      'POST',
      '/api/v1/auth/logout',
      { refresh_token: rotated.body.data.tokens.refresh_token },
      rotated.body.data.tokens.access_token,
    );
    assert.equal(logout.status, 200);
    const afterLogout = await api('POST', '/api/v1/auth/refresh', {
      refresh_token: rotated.body.data.tokens.refresh_token,
    });
    assert.equal(afterLogout.status, 401);
  });

  it('login gagal dengan kredensial salah', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const stamp = Date.now();
    await registerAndLogin(`wrongpass-${stamp}@test.local`);
    const login = await api('POST', '/api/v1/auth/login', {
      email: `wrongpass-${stamp}@test.local`,
      password: 'password-salah',
    });
    assert.equal(login.status, 401);
    assert.equal(login.body.error.code, 'INVALID_CREDENTIALS');
  });

  it('register gagal dengan email duplikat', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL tidak terjangkau');

    const stamp = Date.now();
    const email = `dup-${stamp}@test.local`;
    await registerAndLogin(email);
    const dup = await api('POST', '/api/v1/auth/register', {
      full_name: 'Duplikat',
      email,
      password: 'rahasia123',
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'EMAIL_ALREADY_USED');
  });
});
