import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { verifyToken, type AuthUser } from '../utils/jwt.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new AppError(401, 'UNAUTHORIZED', 'Token tidak ditemukan.'));
    return;
  }
  try {
    const payload = verifyToken(header.slice(7), 'access');
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** Guard fitur staff (pemindaian QR di gerbang masuk). */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    next(new AppError(403, 'FORBIDDEN', 'Hanya staff/admin yang dapat memverifikasi tiket.'));
    return;
  }
  next();
}
