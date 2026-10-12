import { z } from 'zod';

export const listMoviesQuerySchema = z.object({
  status: z.enum(['now_showing', 'upcoming']).default('now_showing'),
  genre: z.string().trim().min(1).max(50).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const movieParamsSchema = z.object({ id: z.uuid('ID film tidak valid') });

export const movieShowtimesQuerySchema = z.object({
  city: z.string().trim().min(1).max(100).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus format YYYY-MM-DD')
    .optional(),
});

export const listCinemasQuerySchema = z.object({
  city: z.string().trim().min(1).max(100).optional(),
});

export type ListMoviesQuery = z.infer<typeof listMoviesQuerySchema>;
export type MovieShowtimesQuery = z.infer<typeof movieShowtimesQuerySchema>;
export type ListCinemasQuery = z.infer<typeof listCinemasQuerySchema>;
