import type { PoolClient } from 'pg';
import { getPool } from '../../db/pool.js';
import { AppError } from '../../common/errors/app-error.js';
import {
  hashPassword,
  fakeVerifyPassword,
  verifyPassword,
} from '../../common/utils/passwords.js';
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  type AuthUser,
} from '../../common/utils/jwt.js';
import { parseDurationToSeconds } from '../../common/utils/parse-duration.js';
import { env } from '../../config/env.js';
import type { LoginInput, RefreshTokenInput, RegisterInput } from './auth.schemas.js';

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface AuthResult {
  user: { id: string; full_name: string; email: string; phone: string | null; role: string };
  tokens: Tokens;
}

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  password_hash: string;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';
}

function toPublicUser(row: UserRow) {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
  };
}

async function issueTokens(client: PoolClient, user: AuthUser): Promise<Tokens> {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  const refreshTtlSeconds = parseDurationToSeconds(env.JWT_REFRESH_EXPIRES_IN);
  await client.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3::int))`,
    [user.id, hashToken(refreshToken), refreshTtlSeconds],
  );

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: parseDurationToSeconds(env.JWT_ACCESS_EXPIRES_IN),
  };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const pool = getPool();

  const existing = await pool.query(
    `SELECT email, phone FROM users WHERE lower(email) = $1 OR ($2::text IS NOT NULL AND phone = $2)`,
    [input.email, input.phone ?? null],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    const row = existing.rows[0] as { email: string; phone: string | null };
    if (row.email.toLowerCase() === input.email) {
      throw new AppError(409, 'EMAIL_ALREADY_USED', 'Email sudah terdaftar.');
    }
    throw new AppError(409, 'PHONE_ALREADY_USED', 'Nomor telepon sudah terdaftar.');
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<UserRow>(
        `INSERT INTO users (full_name, email, phone, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, full_name, email, phone, role, password_hash`,
        [input.full_name, input.email, input.phone ?? null, passwordHash],
      );
      const user = result.rows[0];
      const authUser: AuthUser = { id: user.id, email: user.email, role: user.role as 'user' | 'admin' };
      const tokens = await issueTokens(client, authUser);
      await client.query('COMMIT');
      return { user: toPublicUser(user), tokens };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'EMAIL_ALREADY_USED', 'Email atau nomor telepon sudah terdaftar.');
    }
    throw err;
  }
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const pool = getPool();

  const result = await pool.query<UserRow>(
    `SELECT id, full_name, email, phone, role, password_hash
     FROM users WHERE lower(email) = $1`,
    [input.email],
  );

  const user = result.rows[0];
  if (!user) {
    await fakeVerifyPassword(input.password);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email atau password salah.');
  }

  const valid = await verifyPassword(input.password, user.password_hash);
  if (!valid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email atau password salah.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const authUser: AuthUser = { id: user.id, email: user.email, role: user.role as 'user' | 'admin' };
    const tokens = await issueTokens(client, authUser);
    await client.query('COMMIT');
    return { user: toPublicUser(user), tokens };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function refresh(input: RefreshTokenInput): Promise<AuthResult> {
  const payload = verifyToken(input.refresh_token, 'refresh');
  const pool = getPool();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tokenRow = await client.query<{ user_id: string; revoked_at: Date | null; expires_at: Date }>(
      `SELECT user_id, revoked_at, expires_at FROM refresh_tokens
       WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(input.refresh_token)],
    );

    const stored = tokenRow.rows[0];
    if (!stored) {
      throw new AppError(401, 'UNAUTHORIZED', 'Refresh token tidak dikenali.');
    }
    if (stored.revoked_at) {
      throw new AppError(401, 'UNAUTHORIZED', 'Refresh token sudah dicabut.');
    }
    if (stored.expires_at.getTime() <= Date.now()) {
      throw new AppError(401, 'UNAUTHORIZED', 'Refresh token kadaluarsa.');
    }

    const userResult = await client.query<UserRow>(
      `SELECT id, full_name, email, phone, role, password_hash FROM users WHERE id = $1`,
      [stored.user_id],
    );
    const user = userResult.rows[0];
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Pengguna tidak ditemukan.');
    }

    await client.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [
      hashToken(input.refresh_token),
    ]);

    const authUser: AuthUser = { id: user.id, email: user.email, role: user.role as 'user' | 'admin' };
    const tokens = await issueTokens(client, authUser);
    await client.query('COMMIT');
    return { user: toPublicUser(user), tokens };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function logout(refreshToken: string): Promise<void> {
  const payload = verifyToken(refreshToken, 'refresh');
  void payload;
  await getPool().query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(refreshToken)],
  );
}

export async function getProfile(userId: string): Promise<{
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  created_at: Date;
}> {
  const result = await getPool().query(
    `SELECT id, full_name, email, phone, role, created_at FROM users WHERE id = $1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user) {
    throw new AppError(404, 'NOT_FOUND', 'Pengguna tidak ditemukan.');
  }
  return user;
}
