import { Router } from 'express';
import { requireAuth } from '../../common/middlewares/auth.js';
import { getParams, validateParams } from '../../common/middlewares/validate.js';
import { uuidParamsSchema } from '../bookings/bookings.schemas.js';
import { shareTokenParamsSchema } from './split.schemas.js';
import * as splitService from './split.service.js';

export const splitBillsRouter = Router();

// Tracker host/peserta (FR-SB-03).
splitBillsRouter.get('/:id', requireAuth, validateParams(uuidParamsSchema), async (req, res) => {
  const { id } = getParams<{ id: string }>(res);
  const split = await splitService.getSplitBill(id, req.user!.id);
  res.json({ success: true, data: split });
});

// Halaman publik dari tautan/QR patungan (FR-SB-02) — tanpa autentikasi.
splitBillsRouter.get(
  '/share/:token',
  validateParams(shareTokenParamsSchema),
  async (req, res) => {
    const { token } = getParams<{ token: string }>(res);
    const split = await splitService.getSplitByShareToken(token);
    res.json({ success: true, data: split });
  },
);
