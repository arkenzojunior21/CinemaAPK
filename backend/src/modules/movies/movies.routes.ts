import { Router } from 'express';
import {
  getParams,
  getQuery,
  validateParams,
  validateQuery,
} from '../../common/middlewares/validate.js';
import * as moviesService from './movies.service.js';
import {
  listMoviesQuerySchema,
  movieParamsSchema,
  movieShowtimesQuerySchema,
  type ListMoviesQuery,
  type MovieShowtimesQuery,
} from './movies.schemas.js';
import { getShowtimesForMovie } from '../showtimes/showtimes.service.js';

export const moviesRouter = Router();

moviesRouter.get('/', validateQuery(listMoviesQuerySchema), async (_req, res) => {
  const query = getQuery<ListMoviesQuery>(res);
  const result = await moviesService.listMovies(query);
  res.json({ success: true, data: result });
});

moviesRouter.get('/:id', validateParams(movieParamsSchema), async (_req, res) => {
  const { id } = getParams<{ id: string }>(res);
  const movie = await moviesService.getMovieById(id);
  res.json({ success: true, data: movie });
});

moviesRouter.get(
  '/:id/showtimes',
  validateParams(movieParamsSchema),
  validateQuery(movieShowtimesQuerySchema),
  async (_req, res) => {
    const { id } = getParams<{ id: string }>(res);
    const query = getQuery<MovieShowtimesQuery>(res);
    const result = await getShowtimesForMovie(id, query);
    res.json({ success: true, data: result });
  },
);
