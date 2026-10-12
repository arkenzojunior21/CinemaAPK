import { getPool } from '../../db/pool.js';
import { AppError } from '../../common/errors/app-error.js';
import type { ListMoviesQuery } from './movies.schemas.js';

export interface MovieSummary {
  id: string;
  title: string;
  slug: string;
  genres: string[];
  duration_minutes: number;
  age_rating: string;
  language: string | null;
  poster_url: string | null;
  rating_score: number | null;
  release_date: string | null;
  status: string;
}

interface MovieRow {
  id: string;
  title: string;
  slug: string;
  genres: string[];
  duration_minutes: number;
  age_rating: string;
  language: string | null;
  poster_url: string | null;
  rating_score: string | null;
  release_date: Date | null;
  status: string;
}

function mapMovie(row: MovieRow): MovieSummary {
  return {
    ...row,
    rating_score: row.rating_score === null ? null : Number(row.rating_score),
    release_date: row.release_date === null ? null : row.release_date.toISOString().slice(0, 10),
  };
}

export async function listMovies(query: ListMoviesQuery): Promise<{
  items: MovieSummary[];
  meta: { page: number; limit: number; total_items: number; total_pages: number };
}> {
  const pool = getPool();
  const offset = (query.page - 1) * query.limit;
  const filters = [
    'm.status = $1',
    query.genre ? `EXISTS (SELECT 1 FROM unnest(m.genres) g WHERE lower(g) = lower($2::text))` : '$2::text IS NULL',
    query.search ? `(m.title ILIKE '%' || $3::text || '%' OR m.slug ILIKE '%' || $3::text || '%')` : '$3::text IS NULL',
    query.city
      ? `EXISTS (
           SELECT 1 FROM showtimes st
           JOIN studios s ON s.id = st.studio_id
           JOIN cinemas c ON c.id = s.cinema_id
           WHERE st.movie_id = m.id AND st.is_active AND st.starts_at > now() AND lower(c.city) = lower($4::text)
         )`
      : '$4::text IS NULL',
  ];
  const params = [query.status, query.genre ?? null, query.search ?? null, query.city ?? null];

  const where = filters.join(' AND ');

  const countResult = await pool.query<{ count: string }>(
    `SELECT count(*)::int AS count FROM movies m WHERE ${where}`,
    params,
  );
  const totalItems = Number(countResult.rows[0].count);

  const rows = await pool.query<MovieRow>(
    `SELECT m.id, m.title, m.slug, m.genres, m.duration_minutes, m.age_rating,
            m.language, m.poster_url, m.rating_score, m.release_date, m.status
     FROM movies m
     WHERE ${where}
     ORDER BY m.release_date DESC NULLS LAST, m.title
     LIMIT $5 OFFSET $6`,
    [...params, query.limit, offset],
  );

  return {
    items: rows.rows.map(mapMovie),
    meta: {
      page: query.page,
      limit: query.limit,
      total_items: totalItems,
      total_pages: Math.max(1, Math.ceil(totalItems / query.limit)),
    },
  };
}

export async function getMovieById(id: string): Promise<MovieSummary & {
  synopsis: string | null;
  backdrop_url: string | null;
  trailer_url: string | null;
}> {
  const result = await getPool().query<MovieRow & {
    synopsis: string | null;
    backdrop_url: string | null;
    trailer_url: string | null;
  }>(
    `SELECT id, title, slug, genres, duration_minutes, age_rating, language, poster_url,
            rating_score, release_date, status, synopsis, backdrop_url, trailer_url
     FROM movies WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Film tidak ditemukan.');
  }
  return mapMovie(row) as MovieSummary & {
    synopsis: string | null;
    backdrop_url: string | null;
    trailer_url: string | null;
  };
}
