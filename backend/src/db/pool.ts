import { Pool } from 'pg';
import { env } from '../config/env.js';
import { AppError } from '../common/errors/app-error.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    if (!env.DATABASE_URL) {
      throw new AppError(500, 'DB_NOT_CONFIGURED', 'DATABASE_URL belum dikonfigurasi.');
    }
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}
