import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

export async function runMigrations(): Promise<void> {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL belum di-set. Salin .env.example menjadi .env lalu sesuaikan.');
  }

  const pool = new Pool({ connectionString: env.DATABASE_URL });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (
        await pool.query<{ name: string }>('SELECT name FROM schema_migrations')
      ).rows.map((row) => row.name),
    );

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Skip (sudah diterapkan): ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Diterapkan: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Gagal menerapkan ${file}: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }

    console.log('Migrasi selesai.');
  } finally {
    await pool.end();
  }
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runMigrations().catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}
