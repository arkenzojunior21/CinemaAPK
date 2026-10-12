import { getPool } from '../../db/pool.js';
import { AppError } from '../../common/errors/app-error.js';
import type { ListCinemasQuery } from '../movies/movies.schemas.js';

export interface CinemaSummary {
  id: string;
  chain: string;
  name: string;
  city: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface CinemaRow {
  id: string;
  chain: string;
  name: string;
  city: string;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
}

function mapCinema(row: CinemaRow): CinemaSummary {
  return {
    ...row,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
  };
}

export async function listCinemas(query: ListCinemasQuery): Promise<{ items: CinemaSummary[] }> {
  const result = await getPool().query<CinemaRow>(
    `SELECT id, chain, name, city, address, latitude, longitude
     FROM cinemas
     WHERE is_active AND ($1::text IS NULL OR lower(city) = lower($1::text))
     ORDER BY city, name`,
    [query.city ?? null],
  );
  return { items: result.rows.map(mapCinema) };
}

export async function getCinemaById(id: string): Promise<CinemaSummary> {
  const result = await getPool().query<CinemaRow>(
    `SELECT id, chain, name, city, address, latitude, longitude
     FROM cinemas WHERE id = $1 AND is_active`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Bioskop tidak ditemukan.');
  }
  return mapCinema(row);
}
