import { getPool } from '../../db/pool.js';
import { withRedis } from '../../db/redis.js';
import { AppError } from '../../common/errors/app-error.js';
import { env } from '../../config/env.js';

interface ShowtimeInfo {
  id: string;
  starts_at: Date;
  is_active: boolean;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';
}

function redisKey(showtimeId: string, seatId: string): string {
  return `cinegen:lock:${showtimeId}:${seatId}`;
}

async function getActiveShowtime(showtimeId: string): Promise<ShowtimeInfo> {
  const result = await getPool().query<ShowtimeInfo>(
    `SELECT id, starts_at, is_active FROM showtimes WHERE id = $1`,
    [showtimeId],
  );
  const showtime = result.rows[0];
  if (!showtime || !showtime.is_active) {
    throw new AppError(404, 'NOT_FOUND', 'Jadwal tayang tidak ditemukan.');
  }
  if (showtime.starts_at.getTime() <= Date.now()) {
    throw new AppError(409, 'SHOWTIME_PASSED', 'Jadwal tayang sudah lewat.');
  }
  return showtime;
}

async function validateSeatsBelongToShowtime(showtimeId: string, seatIds: string[]): Promise<void> {
  const result = await getPool().query<{ id: string }>(
    `SELECT s.id
     FROM seats s
     JOIN showtimes st ON st.id = $1 AND st.studio_id = s.studio_id
     WHERE s.id = ANY($2::uuid[]) AND s.is_active`,
    [showtimeId, seatIds],
  );
  if (result.rowCount !== seatIds.length) {
    throw new AppError(422, 'SEAT_NOT_IN_SHOWTIME', 'Ada kursi yang tidak termasuk dalam jadwal tayang ini.');
  }
}

export interface SeatLockResult {
  locks: { reservation_id: string; seat_id: string; row: string; number: number; type: string; price: number }[];
  total_price: number;
  expires_at: Date;
}

/**
 * Mengunci kursi untuk satu user pada satu showtime.
 * Setiap panggilan MENGGANTI lock lama user pada showtime tersebut
 * (sesuai interaksi pemilihan kursi di UI).
 *
 * Lapisan keamanan ganda:
 * 1. Redis SET NX EX — tolak cepat secara real-time bila tersedia.
 * 2. Partial unique index seat_reservations_active_uniq — penjaga mutlak di DB.
 */
export async function acquireSeatLocks(
  showtimeId: string,
  userId: string,
  requestedSeatIds: string[],
): Promise<SeatLockResult> {
  await getActiveShowtime(showtimeId);

  // Dedup + urutkan agar insert terurut (mengurangi risiko deadlock antar transaksi).
  const seatIds = [...new Set(requestedSeatIds)].sort();
  await validateSeatsBelongToShowtime(showtimeId, seatIds);

  const ttl = env.SEAT_LOCK_TTL_SECONDS;

  const redisOk = await withRedis(async (redis) => {
    const acquired: string[] = [];
    for (const seatId of seatIds) {
      const key = redisKey(showtimeId, seatId);
      const res = await redis.set(key, userId, 'EX', ttl, 'NX');
      if (res !== 'OK') {
        if (acquired.length > 0) await redis.del(...acquired);
        return false;
      }
      acquired.push(key);
    }
    return true;
  });
  if (redisOk === false) {
    throw new AppError(409, 'SEAT_UNAVAILABLE', 'Salah satu kursi sedang dikunci pengguna lain.');
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lepas lock lama user pada showtime ini (semantik penggantian pilihan).
    const released = await client.query<{ seat_id: string }>(
      `UPDATE seat_reservations SET status = 'released'
       WHERE showtime_id = $1 AND user_id = $2 AND status = 'locked'
       RETURNING seat_id`,
      [showtimeId, userId],
    );

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO seat_reservations (showtime_id, seat_id, user_id, status, locked_at, expires_at)
       SELECT $1, seat_id, $2, 'locked', now(), now() + make_interval(secs => $3::int)
       FROM unnest($4::uuid[]) AS seat_id
       RETURNING id`,
      [showtimeId, userId, ttl, seatIds],
    );
    if (inserted.rowCount !== seatIds.length) {
      throw new AppError(422, 'SEAT_NOT_IN_SHOWTIME', 'Ada kursi yang tidak valid.');
    }

    const detailRows = await client.query<{
      id: string;
      seat_id: string;
      row_label: string;
      seat_number: number;
      seat_type: string;
      price: string;
    }>(
      `SELECT r.id, r.seat_id, s.row_label, s.seat_number, s.seat_type,
              round(st.base_price * s.price_multiplier)::bigint AS price
       FROM seat_reservations r
       JOIN seats s ON s.id = r.seat_id
       JOIN showtimes st ON st.id = r.showtime_id
       WHERE r.id = ANY($1::uuid[])
       ORDER BY s.row_label, s.seat_number`,
      [inserted.rows.map((r) => r.id)],
    );

    const expiresAtResult = await client.query<{ expires_at: Date }>(
      `SELECT max(expires_at) AS expires_at FROM seat_reservations WHERE id = ANY($1::uuid[])`,
      [inserted.rows.map((r) => r.id)],
    );

    await client.query('COMMIT');

    // Hapus key Redis milik lock lama yang barusan dilepas.
    const releasedSeatIds = released.rows.map((r) => r.seat_id);
    if (releasedSeatIds.length > 0) {
      await withRedis((redis) =>
        redis.del(...releasedSeatIds.map((seatId) => redisKey(showtimeId, seatId))),
      );
    }

    const locks = detailRows.rows.map((row) => ({
      reservation_id: row.id,
      seat_id: row.seat_id,
      row: row.row_label,
      number: row.seat_number,
      type: row.seat_type,
      price: Number(row.price),
    }));

    return {
      locks,
      total_price: locks.reduce((sum, lock) => sum + lock.price, 0),
      expires_at: expiresAtResult.rows[0].expires_at,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'SEAT_UNAVAILABLE', 'Salah satu kursi sedang dikunci pengguna lain.');
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function releaseUserLocks(showtimeId: string, userId: string): Promise<void> {
  await getActiveShowtime(showtimeId);

  const released = await getPool().query<{ seat_id: string }>(
    `UPDATE seat_reservations SET status = 'released'
     WHERE showtime_id = $1 AND user_id = $2 AND status = 'locked'
     RETURNING seat_id`,
    [showtimeId, userId],
  );

  const releasedSeatIds = released.rows.map((r) => r.seat_id);
  if (releasedSeatIds.length > 0) {
    await withRedis((redis) =>
      redis.del(...releasedSeatIds.map((seatId) => redisKey(showtimeId, seatId))),
    );
  }
}
