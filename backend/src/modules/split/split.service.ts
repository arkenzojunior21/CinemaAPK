import { getPool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { generateShareToken } from '../../common/utils/codes.js';
import { buildQrisPayload } from '../../common/utils/qris.js';
import { splitEqually, summarizeTracker, validateCustomShares } from './split.calc.js';
import type { CreateSplitBillInput } from './split.schemas.js';

interface BookingRow {
  id: string;
  user_id: string;
  status: string;
  grand_total: string;
  booking_code: string;
}

interface SplitRow {
  id: string;
  booking_id: string;
  host_user_id: string;
  method: string;
  total_amount: string;
  share_count: number;
  status: string;
  share_token: string;
  expires_at: Date | null;
  created_at: Date;
  host_name: string;
  booking_code: string;
  booking_status: string;
  movie_title: string;
  cinema_name: string;
  cinema_city: string;
  starts_at: Date;
  studio_name: string;
}

interface ParticipantRow {
  id: string;
  name: string;
  user_id: string | null;
  share_amount: string;
  status: string;
  payment_reference: string | null;
  paid_at: Date | null;
}

const SELECT_SPLIT = `
  SELECT sb.id, sb.booking_id, sb.host_user_id, sb.method, sb.total_amount, sb.share_count,
         sb.status, sb.share_token, sb.expires_at, sb.created_at,
         h.full_name AS host_name,
         b.booking_code, b.status AS booking_status,
         m.title AS movie_title, c.name AS cinema_name, c.city AS cinema_city, st.starts_at, s.name AS studio_name
  FROM split_bills sb
  JOIN users h ON h.id = sb.host_user_id
  JOIN bookings b ON b.id = sb.booking_id
  JOIN showtimes st ON st.id = b.showtime_id
  JOIN movies m ON m.id = st.movie_id
  JOIN studios s ON s.id = st.studio_id
  JOIN cinemas c ON c.id = s.cinema_id
`;

function shareUrl(token: string): string {
  return `${env.BASE_URL}/api/v1/split-bills/share/${token}`;
}

function assertNotExpired(row: SplitRow): void {
  if (row.status === 'cancelled') {
    throw new AppError(409, 'SPLIT_CANCELLED', 'Patungan ini sudah dibatalkan.');
  }
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
    throw new AppError(410, 'SPLIT_EXPIRED', 'Tautan patungan ini sudah kedaluwarsa.');
  }
}

async function loadSplit(id: string): Promise<{ split: SplitRow; participants: ParticipantRow[] }> {
  const pool = getPool();
  const splitResult = await pool.query<SplitRow>(`${SELECT_SPLIT} WHERE sb.id = $1`, [id]);
  const split = splitResult.rows[0];
  if (!split) {
    throw new AppError(404, 'NOT_FOUND', 'Patungan tidak ditemukan.');
  }

  const participantsResult = await pool.query<ParticipantRow>(
    `SELECT id, name, user_id, share_amount, status, payment_reference, paid_at
     FROM split_bill_participants
     WHERE split_bill_id = $1
     ORDER BY created_at, name`,
    [id],
  );

  return { split, participants: participantsResult.rows };
}

function toResponse(split: SplitRow, participants: ParticipantRow[], publicView = false) {
  const url = shareUrl(split.share_token);
  const shares = participants.map((p) => Number(p.share_amount));
  const tracker = summarizeTracker(
    shares,
    participants.map((p) => p.status),
  );

  return {
    id: split.id,
    booking_id: split.booking_id,
    method: split.method,
    status: split.status,
    total_amount: Number(split.total_amount),
    share_count: split.share_count,
    share_token: split.share_token,
    share_url: url,
    expires_at: split.expires_at?.toISOString() ?? null,
    created_at: split.created_at.toISOString(),
    host: { id: publicView ? null : split.host_user_id, name: split.host_name },
    booking: {
      id: split.booking_id,
      booking_code: split.booking_code,
      status: split.booking_status,
      movie_title: split.movie_title,
      cinema_name: split.cinema_name,
      studio: split.studio_name,
      starts_at: split.starts_at.toISOString(),
    },
    tracker: {
      total: tracker.total,
      paid: tracker.paid,
      remaining: tracker.remaining,
      paid_count: tracker.paidCount,
      pending_count: tracker.pendingCount,
      all_paid: tracker.allPaid,
    },
    participants: participants.map((participant, index) => ({
      id: participant.id,
      name: participant.name,
      user_id: publicView ? null : participant.user_id,
      share_amount: shares[index],
      status: participant.status,
      paid_at: participant.paid_at?.toISOString() ?? null,
      pay_url: `${url}?participant=${participant.id}`,
      qris_payload: buildQrisPayload({
        reference: participant.id,
        amount: shares[index],
        merchantName: split.cinema_name,
        merchantCity: split.cinema_city,
      }),
    })),
  };
}

export async function createSplitBill(
  bookingId: string,
  hostUserId: string,
  input: CreateSplitBillInput,
) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bookingResult = await client.query<BookingRow>(
      `SELECT id, user_id, status, grand_total, booking_code
       FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId],
    );
    const booking = bookingResult.rows[0];
    if (!booking || booking.user_id !== hostUserId) {
      throw new AppError(404, 'NOT_FOUND', 'Booking tidak ditemukan.');
    }
    if (booking.status !== 'pending_payment' && booking.status !== 'partially_paid') {
      throw new AppError(409, 'BOOKING_NOT_PAYABLE', 'Hanya booking yang belum lunas bisa dipatungkan.');
    }

    const existing = await client.query(
      `SELECT 1 FROM split_bills WHERE booking_id = $1 AND status IN ('pending', 'partially_paid')`,
      [bookingId],
    );
    if (existing.rowCount) {
      throw new AppError(409, 'SPLIT_EXISTS', 'Booking ini sudah punya patungan aktif.');
    }

    const total = Number(booking.grand_total);
    const hostIndex = Math.max(
      0,
      input.participants.findIndex((p) => p.user_id === hostUserId),
    );

    let shares: number[];
    if (input.method === 'custom') {
      try {
        shares = validateCustomShares(
          total,
          input.participants.map((p) => ({ name: p.name, amount: p.amount ?? 0 })),
        );
      } catch (err) {
        throw new AppError(422, 'SHARE_MISMATCH', (err as Error).message);
      }
    } else {
      try {
        shares = splitEqually(total, input.participants.length, hostIndex);
      } catch (err) {
        throw new AppError(422, 'SHARE_CALCULATION_FAILED', (err as Error).message);
      }
    }

    const splitResult = await client.query<{ id: string }>(
      `INSERT INTO split_bills (booking_id, host_user_id, method, total_amount, share_count, share_token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7::int))
       RETURNING id`,
      [
        bookingId,
        hostUserId,
        input.method,
        total,
        input.participants.length,
        generateShareToken(),
        env.SPLIT_SHARE_TTL_MINUTES,
      ],
    );
    const splitId = splitResult.rows[0].id;

    await client.query(
      `INSERT INTO split_bill_participants (split_bill_id, user_id, name, share_amount)
       SELECT $1, p.user_id, p.name, p.share_amount
       FROM unnest($2::text[], $3::uuid[], $4::bigint[]) AS p(name, user_id, share_amount)`,
      [
        splitId,
        input.participants.map((p) => p.name),
        input.participants.map((p) => p.user_id ?? null),
        shares,
      ],
    );

    await client.query('COMMIT');
    const loaded = await loadSplit(splitId);
    return toResponse(loaded.split, loaded.participants);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getSplitBill(id: string, userId: string) {
  const { split, participants } = await loadSplit(id);
  assertNotExpired(split);

  const isHost = split.host_user_id === userId;
  const isParticipant = participants.some((p) => p.user_id === userId);
  if (!isHost && !isParticipant) {
    throw new AppError(403, 'FORBIDDEN', 'Anda bukan peserta patungan ini.');
  }

  return toResponse(split, participants);
}

/** Halaman publik tautan patungan (FR-SB-02): status lengkap, tanpa ID pengguna. */
export async function getSplitByShareToken(token: string) {
  const pool = getPool();
  const splitResult = await pool.query<SplitRow>(`${SELECT_SPLIT} WHERE sb.share_token = $1`, [
    token,
  ]);
  const split = splitResult.rows[0];
  if (!split) {
    throw new AppError(404, 'NOT_FOUND', 'Tautan patungan tidak ditemukan.');
  }
  assertNotExpired(split);

  const participantsResult = await pool.query<ParticipantRow>(
    `SELECT id, name, user_id, share_amount, status, payment_reference, paid_at
     FROM split_bill_participants
     WHERE split_bill_id = $1
     ORDER BY created_at, name`,
    [split.id],
  );

  return toResponse(split, participantsResult.rows, true);
}
