import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../errors/app-error.js';

export type TokenType = 'access' | 'refresh';
export type UserRole = 'user' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  typ: TokenType;
  jti: string;
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    { email: user.email, role: user.role, typ: 'access' },
    env.JWT_ACCESS_SECRET,
    {
      subject: user.id,
      jwtid: randomUUID(),
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    },
  );
}

export function signRefreshToken(user: AuthUser): string {
  return jwt.sign(
    { email: user.email, role: user.role, typ: 'refresh' },
    env.JWT_REFRESH_SECRET,
    {
      subject: user.id,
      jwtid: randomUUID(),
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    },
  );
}

export function verifyToken(token: string, expectedType: TokenType): TokenPayload {
  const secret = expectedType === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === 'string') {
      throw new AppError(401, 'UNAUTHORIZED', 'Token tidak valid.');
    }
    const payload = decoded as jwt.JwtPayload & Partial<TokenPayload>;
    if (payload.typ !== expectedType) {
      throw new AppError(401, 'UNAUTHORIZED', 'Jenis token tidak sesuai.');
    }
    return {
      sub: payload.sub!,
      email: payload.email!,
      role: payload.role!,
      typ: payload.typ,
      jti: payload.jti!,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'UNAUTHORIZED', 'Token kadaluarsa.');
    }
    throw new AppError(401, 'UNAUTHORIZED', 'Token tidak valid.');
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
