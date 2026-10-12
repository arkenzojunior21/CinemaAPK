import { Router } from 'express';
import { z } from 'zod';
import {
  getParams,
  getQuery,
  validateParams,
  validateQuery,
} from '../../common/middlewares/validate.js';
import { listCinemasQuerySchema, type ListCinemasQuery } from '../movies/movies.schemas.js';
import * as cinemasService from './cinemas.service.js';

const cinemaParamsSchema = z.object({ id: z.uuid('ID bioskop tidak valid') });

export const cinemasRouter = Router();

cinemasRouter.get('/', validateQuery(listCinemasQuerySchema), async (_req, res) => {
  const query = getQuery<ListCinemasQuery>(res);
  const result = await cinemasService.listCinemas(query);
  res.json({ success: true, data: result });
});

cinemasRouter.get('/:id', validateParams(cinemaParamsSchema), async (_req, res) => {
  const { id } = getParams<{ id: string }>(res);
  const cinema = await cinemasService.getCinemaById(id);
  res.json({ success: true, data: cinema });
});
