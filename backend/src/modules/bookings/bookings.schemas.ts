import { z } from 'zod';
import { MAX_SEATS_PER_LOCK } from '../../common/utils/codes.js';

export const createSeatLockSchema = z.object({
  seat_ids: z
    .array(z.uuid('ID kursi tidak valid'))
    .min(1, 'Minimal pilih 1 kursi')
    .max(MAX_SEATS_PER_LOCK, `Maksimal ${MAX_SEATS_PER_LOCK} kursi per pemesanan`),
});

export const createBookingSchema = z.object({
  showtime_id: z.uuid('ID jadwal tayang tidak valid'),
  seat_reservation_ids: z
    .array(z.uuid('ID reservasi kursi tidak valid'))
    .min(1, 'Minimal 1 reservasi kursi')
    .max(MAX_SEATS_PER_LOCK),
});

export const listBookingsQuerySchema = z.object({
  status: z
    .enum(['pending_payment', 'partially_paid', 'paid', 'cancelled', 'expired'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const uuidParamsSchema = z.object({ id: z.uuid('ID tidak valid') });

export type CreateSeatLockInput = z.infer<typeof createSeatLockSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
