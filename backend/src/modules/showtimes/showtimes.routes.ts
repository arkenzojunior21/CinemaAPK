import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../common/middlewares/auth.js';
import {
  getBody,
  getParams,
  validateBody,
  validateParams,
} from '../../common/middlewares/validate.js';
import { getShowtimeSeatMap } from './showtimes.service.js';
import { acquireSeatLocks, releaseUserLocks } from '../bookings/seat-lock.service.js';
import { createSeatLockSchema, type CreateSeatLockInput } from '../bookings/bookings.schemas.js';

const showtimeParamsSchema = z.object({ id: z.uuid('ID jadwal tayang tidak valid') });

export const showtimesRouter = Router();

// Peta kursi real-time (publik; status kursi milik sendiri ditandai 'mine' bila login).
showtimesRouter.get('/:id', validateParams(showtimeParamsSchema), async (req, res) => {
  const { id } = getParams<{ id: string }>(res);
  const currentUserId = req.user?.id ?? null;
  const seatMap = await getShowtimeSeatMap(id, currentUserId);
  res.json({ success: true, data: seatMap });
});

// Kunci kursi — mengganti lock lama user pada showtime yang sama.
showtimesRouter.post(
  '/:id/seat-locks',
  requireAuth,
  validateParams(showtimeParamsSchema),
  validateBody(createSeatLockSchema),
  async (req, res) => {
    const { id } = getParams<{ id: string }>(res);
    const body = getBody<CreateSeatLockInput>(res);
    const result = await acquireSeatLocks(id, req.user!.id, body.seat_ids);
    res.status(201).json({ success: true, data: result });
  },
);

// Lepas semua lock user pada showtime ini.
showtimesRouter.delete('/:id/seat-locks', requireAuth, validateParams(showtimeParamsSchema), async (req, res) => {
  const { id } = getParams<{ id: string }>(res);
  await releaseUserLocks(id, req.user!.id);
  res.json({ success: true, data: { message: 'Semua kunci kursi dilepas.' } });
});
