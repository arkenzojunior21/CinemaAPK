import { getPool } from '../../db/pool.js';
import { withRedis } from '../../db/redis.js';
import { AppError } from '../../common/errors/app-error.js';
import { generateBookingCode } from '../../common/utils/codes.js';
import { env } from '../../config/env.js';
import type { CreateBookingInput, ListBookingsQuery } from './bookings.schemas.js';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';
}

interface ReservationRow {
  id: string;
  seat_id: string;
  row_label: string;
  seat_number: number;
  seat_type: string;
  price: string;
  expires_at: Date;
}

export interface BookingResult {
  id: string;
  booking_code: string;
  status: string;
  showtime_id: string;
  ticket_total: number;
  fnb_total: number;
  grand_total: number;
  payment_due_at: Date | null;
  created_at: Date;
}

export async function createBooking(userId: string, input: CreateBookingInput): Promise<BookingResult> {
  const pool = getPool();

  const showtime = await pool.query<{ id: string; starts_at: Date; is_active: boolean }>(
    `SELECT id, starts_at, is_active FROM showtimes WHERE id = $1`,
    [input.showtime_id],
  );
  const st = showtime.rows[0];
  if (!st || !st.is_active) {
    throw new AppError(404, 'NOT_FOUND', 'Jadwal tayang tidak ditemukan.');
  }
  if (st.starts_at.getTime() <= Date.now()) {
    throw new AppError(409, 'SHOWTIME_PASSED', 'Jadwal tayang sudah lewat.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reservations = await client.query<ReservationRow>(
      `SELECT r.id, r.seat_id, s.row_label, s.seat_number, s.seat_type, r.expires_at,
              round(st.base_price * s.price_multiplier)::bigint AS price
       FROM seat_reservations r
       JOIN seats s ON s.id = r.seat_id
       JOIN showtimes st ON st.id = r.showtime_id
       WHERE r.id = ANY($1::uuid[])
         AND r.user_id = $2
         AND r.showtime_id = $3
         AND r.status = 'locked'
       FOR UPDATE`,
      [input.seat_reservation_ids, userId, input.showtime_id],
    );

    if (reservations.rowCount !== input.seat_reservation_ids.length) {
      throw new AppError(
        409,
        'LOCK_INVALID',
        'Reservasi kursi tidak valid. Silakan pilih kursi kembali.',
      );
    }

    const now = Date.now();
    const expired = reservations.rows.find((r) => r.expires_at.getTime() <= now);
    if (expired) {
      throw new AppError(410, 'LOCK_EXPIRED', 'Masa mengunci kursi sudah habis. Silakan pilih kursi kembali.');
    }

    const ticketTotal = reservations.rows.reduce((sum, r) => sum + Number(r.price), 0);

    let booking: { id: string; booking_code: string } | undefined;
    for (let attempt = 0; attempt < 3 && !booking; attempt++) {
      try {
        const result = await client.query<{ id: string; booking_code: string }>(
          `INSERT INTO bookings (booking_code, user_id, showtime_id, status, ticket_total, fnb_total, grand_total, payment_due_at)
           VALUES ($1, $2, $3, 'pending_payment', $4, 0, $4, now() + make_interval(secs => $5::int))
           RETURNING id, booking_code`,
          [generateBookingCode(), userId, input.showtime_id, ticketTotal, env.SEAT_LOCK_TTL_SECONDS],
        );
        booking = result.rows[0];
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!booking) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Gagal membuat kode booking, coba lagi.');
    }

    const confirmed = await client.query(
      `UPDATE seat_reservations SET status = 'confirmed', booking_id = $1
       WHERE id = ANY($2::uuid[]) AND status = 'locked'`,
      [booking.id, reservations.rows.map((r) => r.id)],
    );
    if (confirmed.rowCount !== reservations.rows.length) {
      throw new AppError(409, 'SEAT_UNAVAILABLE', 'Kursi tidak lagi tersedia.');
    }

    const finalResult = await client.query<BookingResult & { grand_total: string; ticket_total: string; fnb_total: string }>(
      `SELECT id, booking_code, status, showtime_id, ticket_total, fnb_total, grand_total, payment_due_at, created_at
       FROM bookings WHERE id = $1`,
      [booking.id],
    );
    const row = finalResult.rows[0];

    await client.query('COMMIT');

    // Key Redis tidak lagi relevan — status kini 'confirmed' (dijaga unique index).
    const seatIds = reservations.rows.map((r) => r.seat_id);
    if (seatIds.length > 0) {
      await withRedis((redis) =>
        redis.del(...seatIds.map((seatId) => `cinegen:lock:${input.showtime_id}:${seatId}`)),
      );
    }

    return {
      ...row,
      ticket_total: Number(row.ticket_total),
      fnb_total: Number(row.fnb_total),
      grand_total: Number(row.grand_total),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

interface BookingDetailRow {
  id: string;
  booking_code: string;
  status: string;
  showtime_id: string;
  starts_at: Date;
  format: string;
  ticket_total: string;
  fnb_total: string;
  grand_total: string;
  payment_due_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
  movie_id: string;
  title: string;
  poster_url: string | null;
  age_rating: string;
  duration_minutes: number;
  cinema_id: string;
  cinema_name: string;
  chain: string;
  city: string;
  studio_name: string;
}

function mapBookingDetail(row: BookingDetailRow, seats: { row: string; number: number; type: string }[]) {
  return {
    id: row.id,
    booking_code: row.booking_code,
    status: row.status,
    totals: {
      ticket: Number(row.ticket_total),
      fnb: Number(row.fnb_total),
      grand: Number(row.grand_total),
    },
    payment_due_at: row.payment_due_at,
    paid_at: row.paid_at,
    created_at: row.created_at,
    showtime: {
      id: row.showtime_id,
      starts_at: row.starts_at,
      format: row.format,
    },
    movie: {
      id: row.movie_id,
      title: row.title,
      poster_url: row.poster_url,
      age_rating: row.age_rating,
      duration_minutes: row.duration_minutes,
    },
    cinema: { id: row.cinema_id, name: row.cinema_name, chain: row.chain, city: row.city },
    studio: row.studio_name,
    seats,
  };
}

const DETAIL_SELECT = `
  SELECT b.id, b.booking_code, b.status, b.showtime_id, st.starts_at, st.format,
         b.ticket_total, b.fnb_total, b.grand_total, b.payment_due_at, b.paid_at, b.created_at,
         m.id AS movie_id, m.title, m.poster_url, m.age_rating, m.duration_minutes,
         c.id AS cinema_id, c.name AS cinema_name, c.chain, c.city, s.name AS studio_name
  FROM bookings b
  JOIN showtimes st ON st.id = b.showtime_id
  JOIN movies m ON m.id = st.movie_id
  JOIN studios s ON s.id = st.studio_id
  JOIN cinemas c ON c.id = s.cinema_id
`;

export async function listBookings(userId: string, query: ListBookingsQuery): Promise<{
  items: ReturnType<typeof mapBookingDetail>[];
  meta: { page: number; limit: number; total_items: number; total_pages: number };
}> {
  const pool = getPool();
  const offset = (query.page - 1) * query.limit;

  const countResult = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM bookings WHERE user_id = $1 AND ($2::text IS NULL OR status = $2)`,
    [userId, query.status ?? null],
  );
  const totalItems = countResult.rows[0].count;

  const rows = await pool.query<BookingDetailRow>(
    `${DETAIL_SELECT}
     WHERE b.user_id = $1 AND ($2::text IS NULL OR b.status = $2)
     ORDER BY b.created_at DESC
     LIMIT $3 OFFSET $4`,
    [userId, query.status ?? null, query.limit, offset],
  );

  const items = await Promise.all(
    rows.rows.map(async (row) => {
      const seats = await pool.query<{ row_label: string; seat_number: number; seat_type: string }>(
        `SELECT s.row_label, s.seat_number, s.seat_type
         FROM seat_reservations r
         JOIN seats s ON s.id = r.seat_id
         WHERE r.booking_id = $1
         ORDER BY s.row_label, s.seat_number`,
        [row.id],
      );
      return mapBookingDetail(row, seats.rows.map((s) => ({ row: s.row_label, number: s.seat_number, type: s.seat_type })));
    }),
  );

  return {
    items,
    meta: {
      page: query.page,
      limit: query.limit,
      total_items: totalItems,
      total_pages: Math.max(1, Math.ceil(totalItems / query.limit)),
    },
  };
}

export async function getBookingDetail(userId: string, bookingId: string): Promise<ReturnType<typeof mapBookingDetail>> {
  const pool = getPool();

  const rows = await pool.query<BookingDetailRow>(
    `${DETAIL_SELECT} WHERE b.id = $1 AND b.user_id = $2`,
    [bookingId, userId],
  );
  const row = rows.rows[0];
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Booking tidak ditemukan.');
  }

  const seats = await pool.query<{ row_label: string; seat_number: number; seat_type: string }>(
    `SELECT s.row_label, s.seat_number, s.seat_type
     FROM seat_reservations r
     JOIN seats s ON s.id = r.seat_id
     WHERE r.booking_id = $1
     ORDER BY s.row_label, s.seat_number`,
    [bookingId],
  );

  return mapBookingDetail(row, seats.rows.map((s) => ({ row: s.row_label, number: s.seat_number, type: s.seat_type })));
}

export async function cancelBooking(userId: string, bookingId: string): Promise<{ message: string }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const rows = await client.query<{ id: string; status: string; showtime_id: string }>(
      `SELECT id, status, showtime_id FROM bookings WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [bookingId, userId],
    );
    const booking = rows.rows[0];
    if (!booking) {
      throw new AppError(404, 'NOT_FOUND', 'Booking tidak ditemukan.');
    }
    if (booking.status !== 'pending_payment' && booking.status !== 'partially_paid') {
      throw new AppError(409, 'CONFLICT', 'Booking yang sudah dibayar atau batal tidak dapat dibatalkan lagi.');
    }

    await client.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
    const released = await client.query<{ seat_id: string }>(
      `UPDATE seat_reservations SET status = 'released', booking_id = NULL
       WHERE booking_id = $1 AND status = 'confirmed'
       RETURNING seat_id`,
      [bookingId],
    );

    await client.query('COMMIT');

    const seatIds = released.rows.map((r) => r.seat_id);
    if (seatIds.length > 0) {
      await withRedis((redis) =>
        redis.del(...seatIds.map((seatId) => `cinegen:lock:${booking.showtime_id}:${seatId}`)),
      );
    }

    return { message: 'Booking dibatalkan dan kursi dilepas.' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
