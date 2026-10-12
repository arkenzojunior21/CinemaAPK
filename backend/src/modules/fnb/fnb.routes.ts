import { Router } from 'express';
import { z } from 'zod';
import { getParams, validateParams } from '../../common/middlewares/validate.js';
import { listFnbItems } from './fnb.service.js';

const cinemaFnbParamsSchema = z.object({ id: z.uuid('ID bioskop tidak valid') });

// Di-mount di /api/v1/cinemas — katalog F&B milik bioskop (FR-FB-01, publik).
export const fnbCinemaRouter = Router();

fnbCinemaRouter.get('/:id/fnb-items', validateParams(cinemaFnbParamsSchema), async (_req, res) => {
  const { id } = getParams<{ id: string }>(res);
  const result = await listFnbItems({ cinema_id: id });
  res.json({ success: true, data: result });
});
