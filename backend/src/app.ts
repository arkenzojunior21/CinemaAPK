import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorHandler, notFoundHandler } from './common/middlewares/error-handler.js';
import { env, isDev } from './config/env.js';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { moviesRouter } from './modules/movies/movies.routes.js';
import { cinemasRouter } from './modules/cinemas/cinemas.routes.js';
import { showtimesRouter } from './modules/showtimes/showtimes.routes.js';
import { bookingsRouter } from './modules/bookings/bookings.routes.js';
import { fnbCinemaRouter } from './modules/fnb/fnb.routes.js';
import { splitBillsRouter } from './modules/split/split.routes.js';
import { paymentsRouter, eticketsRouter } from './modules/payments/payments.routes.js';
import { aiRouter } from './modules/ai/ai.routes.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));
  if (isDev) {
    app.use(morgan('dev'));
  }

  app.get('/', (_req, res) => {
    res.json({
      name: 'CineGen API',
      version: '0.1.0',
      health: '/health',
      api: '/api/v1',
      modules: ['auth', 'movies', 'cinemas', 'showtimes', 'bookings', 'fnb', 'split-bills', 'payments', 'etickets', 'ai'],
    });
  });
  app.use('/health', healthRouter);

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/movies', moviesRouter);
  app.use('/api/v1/cinemas', cinemasRouter);
  app.use('/api/v1/cinemas', fnbCinemaRouter);
  app.use('/api/v1/showtimes', showtimesRouter);
  app.use('/api/v1/bookings', bookingsRouter);
  app.use('/api/v1/split-bills', splitBillsRouter);
  app.use('/api/v1/payments', paymentsRouter);
  app.use('/api/v1/etickets', eticketsRouter);
  app.use('/api/v1/ai', aiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
