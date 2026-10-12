import { getPool } from '../../db/pool.js';
import { AppError } from '../../common/errors/app-error.js';
import type { MovieShowtimesQuery } from '../movies/movies.schemas.js';

// ---------- Pure helpers (diuji di unit test) ----------

export type SeatAvailability = 'available' | 'locked' | 'mine' | 'sold';

export function mapSeatAvailability(
  reservationStatus: string | null,
  reservationUserId: string | null,
  currentUserId: string | null,
): SeatAvailability {
  if (reservationStatus === 'confirmed') return 'sold';
  if (reservationStatus === 'locked') {
    return currentUserId !== null && reservationUserId === currentUserId ? 'mine' : 'locked';
  }
  return 'available';
}

export interface ShowtimeGroupRow {
  showtime_id: string;
  starts_at: Date;
  format: string;
  language: string | null;
  subtitle: string | null;
  base_price: string | number;
  studio_id: string;
  studio_name: string;
  screen_types: string[];
  cinema_id: string;
  chain: string;
  cinema_name: string;
  city: string;
}

export interface CinemaShowtimeGroup {
  cinema: { id: string; chain: string; name: string; city: string };
  showtimes: {
    id: string;
    studio: string;
    starts_at: Date;
    format: string;
    base_price: number;
    language: string | null;
    subtitle: string | null;
  }[];
}

export function groupShowtimesByCinema(rows: ShowtimeGroupRow[]): CinemaShowtimeGroup[] {
  const groups = new Map<string, CinemaShowtimeGroup>();
  for (const row of rows) {
    let group = groups.get(row.cinema_id);
    if (!group) {
      group = {
        cinema: { id: row.cinema_id, chain: row.chain, name: row.cinema_name, city: row.city },
        showtimes: [],
      };
      groups.set(row.cinema_id, group);
    }
    group.showtimes.push({
      id: row.showtime_id,
      studio: row.studio_name,
      starts_at: row.starts_at,
      format: row.format,
      base_price: Number(row.base_price),
      language: row.language,
      subtitle: row.subtitle,
    });
  }
  return [...groups.values()];
}

// ---------- Service ----------

export async function getShowtimesForMovie(
  movieId: string,
  query: MovieShowtimesQuery,
): Promise<{ movie_id: string; date: string; groups: CinemaShowtimeGroup[] }> {
  const movieExists = await getPool().query(`SELECT 1 FROM movies WHERE id = $1`, [movieId]);
  if (!movieExists.rowCount) {
    throw new AppError(404, 'NOT_FOUND', 'Film tidak ditemukan.');
  }

  const dateStr = query.date ?? new Date().toISOString().slice(0, 10);
  const startsAt = `${dateStr}T00:00:00Z`;
  const endsAt = `${dateStr}T23:59:59.999Z`;

  const rows = await getPool().query<ShowtimeGroupRow>(
    `SELECT st.id AS showtime_id, st.starts_at, st.format, st.language, st.subtitle, st.base_price,
            s.id AS studio_id, s.name AS studio_name, s.screen_types,
            c.id AS cinema_id, c.chain, c.name AS cinema_name, c.city
     FROM showtimes st
     JOIN studios s ON s.id = st.studio_id
     JOIN cinemas c ON c.id = s.cinema_id
     WHERE st.movie_id = $1
       AND st.is_active
       AND st.starts_at >= $2::timestamptz
       AND st.starts_at <= $3::timestamptz
       AND ($4::text IS NULL OR lower(c.city) = lower($4::text))
     ORDER BY c.name, st.starts_at`,
    [movieId, startsAt, endsAt, query.city ?? null],
  );

  return { movie_id: movieId, date: dateStr, groups: groupShowtimesByCinema(rows.rows) };
}

export interface SeatMapResponse {
  showtime: {
    id: string;
    starts_at: Date;
    ends_at: Date;
    format: string;
    language: string | null;
    subtitle: string | null;
    base_price: number;
  };
  movie: { id: string; title: string; age_rating: string; duration_minutes: number; poster_url: string | null };
  studio: { id: string; name: string; seat_rows: number; seat_cols: number; screen_types: string[] };
  cinema: { id: string; chain: string; name: string; city: string };
  seats: {
    id: string;
    row: string;
    number: number;
    type: string;
    price: number;
    status: SeatAvailability;
  }[];
}

export async function getShowtimeSeatMap(
  showtimeId: string,
  currentUserId: string | null,
): Promise<SeatMapResponse> {
  const pool = getPool();

  // Bersihkan lock kedaluwarsa secara lazy sebelum membaca peta kursi.
  await pool.query(
    `UPDATE seat_reservations SET status = 'released' WHERE status = 'locked' AND expires_at < now()`,
  );

  const infoResult = await pool.query<{
    showtime_id: string;
    starts_at: Date;
    ends_at: Date;
    format: string;
    language: string | null;
    subtitle: string | null;
    base_price: string;
    movie_id: string;
    title: string;
    age_rating: string;
    duration_minutes: number;
    poster_url: string | null;
    studio_id: string;
    studio_name: string;
    seat_rows: number;
    seat_cols: number;
    screen_types: string[];
    cinema_id: string;
    chain: string;
    cinema_name: string;
    city: string;
    is_active: boolean;
  }>(
    `SELECT st.id AS showtime_id, st.starts_at, st.ends_at, st.format, st.language, st.subtitle,
            st.base_price, st.is_active,
            m.id AS movie_id, m.title, m.age_rating, m.duration_minutes, m.poster_url,
            s.id AS studio_id, s.name AS studio_name, s.seat_rows, s.seat_cols, s.screen_types,
            c.id AS cinema_id, c.chain, c.name AS cinema_name, c.city
     FROM showtimes st
     JOIN movies m ON m.id = st.movie_id
     JOIN studios s ON s.id = st.studio_id
     JOIN cinemas c ON c.id = s.cinema_id
     WHERE st.id = $1`,
    [showtimeId],
  );

  const info = infoResult.rows[0];
  if (!info || !info.is_active) {
    throw new AppError(404, 'NOT_FOUND', 'Jadwal tayang tidak ditemukan.');
  }

  const seatRows = await pool.query<{
    seat_id: string;
    row_label: string;
    seat_number: number;
    seat_type: string;
    price: string;
    res_status: string | null;
    res_user: string | null;
  }>(
    `SELECT s.id AS seat_id, s.row_label, s.seat_number, s.seat_type,
            round(st.base_price * s.price_multiplier)::bigint AS price,
            r.status AS res_status, r.user_id AS res_user
     FROM seats s
     JOIN showtimes st ON st.id = $1 AND st.studio_id = s.studio_id
     LEFT JOIN seat_reservations r
       ON r.seat_id = s.id AND r.showtime_id = $1 AND r.status IN ('locked', 'confirmed')
     WHERE s.is_active
     ORDER BY s.row_label, s.seat_number`,
    [showtimeId],
  );

  return {
    showtime: {
      id: info.showtime_id,
      starts_at: info.starts_at,
      ends_at: info.ends_at,
      format: info.format,
      language: info.language,
      subtitle: info.subtitle,
      base_price: Number(info.base_price),
    },
    movie: {
      id: info.movie_id,
      title: info.title,
      age_rating: info.age_rating,
      duration_minutes: info.duration_minutes,
      poster_url: info.poster_url,
    },
    studio: {
      id: info.studio_id,
      name: info.studio_name,
      seat_rows: info.seat_rows,
      seat_cols: info.seat_cols,
      screen_types: info.screen_types,
    },
    cinema: { id: info.cinema_id, chain: info.chain, name: info.cinema_name, city: info.city },
    seats: seatRows.rows.map((row) => ({
      id: row.seat_id,
      row: row.row_label,
      number: row.seat_number,
      type: row.seat_type,
      price: Number(row.price),
      status: mapSeatAvailability(row.res_status, row.res_user, currentUserId),
    })),
  };
}
