import type { NextFunction, Request, Response } from 'express';
import type { ZodError, ZodType } from 'zod';
import { AppError } from '../errors/app-error.js';

function validationError(error: ZodError): AppError {
  const first = error.issues[0];
  const path = first?.path.join('.');
  const message = first ? `${path ? `${path}: ` : ''}${first.message}` : 'Input tidak valid.';
  return new AppError(422, 'VALIDATION_ERROR', message);
}

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(validationError(result.error));
      return;
    }
    res.locals.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(validationError(result.error));
      return;
    }
    res.locals.query = result.data;
    next();
  };
}

export function validateParams<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(validationError(result.error));
      return;
    }
    res.locals.params = result.data;
    next();
  };
}

export function getBody<T>(res: Response): T {
  return res.locals.body as T;
}

export function getQuery<T>(res: Response): T {
  return res.locals.query as T;
}

export function getParams<T>(res: Response): T {
  return res.locals.params as T;
}
