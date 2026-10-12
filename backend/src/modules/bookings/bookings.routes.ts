import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../common/middlewares/auth.js';
import {
  getBody,
  getParams,
  getQuery,
  validateBody,
  validateParams,
  validateQuery,
} from '../../common/middlewares/validate.js';
import * as bookingsService from './bookings.service.js';
import { createFnbOrder } from '../fnb/fnb-order.service.js';
import { createPaymentSchema, type CreatePaymentInput } from '../payments/payments.schemas.js';
import * as paymentsService from '../payments/payments.service.js';
import { createSplitBillSchema, type CreateSplitBillInput } from '../split/split.schemas.js';
import { createSplitBill } from '../split/split.service.js';
import {
  createBookingSchema,
  listBookingsQuerySchema,
  uuidParamsSchema,
  type CreateBookingInput,
  type ListBookingsQuery,
} from './bookings.schemas.js';

const createFnbOrderSchema = z.object({
  items: z
    .array(
      z.object({
        fnb_item_id: z.uuid('ID item F&B tidak valid'),
        quantity: z.number().int().min(1, 'Minimal 1').max(20),
      }),
    )
    .min(1, 'Minimal satu item F&B'),
});

type CreateFnbOrderInput = z.infer<typeof createFnbOrderSchema>;

export const bookingsRouter = Router();

bookingsRouter.use(requireAuth);

bookingsRouter.post('/', validateBody(createBookingSchema), async (req, res) => {
  const body = getBody<CreateBookingInput>(res);
  const booking = await bookingsService.createBooking(req.user!.id, body);
  res.status(201).json({ success: true, data: booking });
});

bookingsRouter.get('/', validateQuery(listBookingsQuerySchema), async (req, res) => {
  const query = getQuery<ListBookingsQuery>(res);
  const result = await bookingsService.listBookings(req.user!.id, query);
  res.json({ success: true, data: result });
});

bookingsRouter.get('/:id', validateParams(uuidParamsSchema), async (req, res) => {
  const { id } = getParams<{ id: string }>(res);
  const booking = await bookingsService.getBookingDetail(req.user!.id, id);
  res.json({ success: true, data: booking });
});

bookingsRouter.post('/:id/cancel', validateParams(uuidParamsSchema), async (req, res) => {
  const { id } = getParams<{ id: string }>(res);
  const result = await bookingsService.cancelBooking(req.user!.id, id);
  res.json({ success: true, data: result });
});

// Pre-order F&B untuk booking yang belum lunas (FR-FB-01).
bookingsRouter.post('/:id/fnb-orders', validateParams(uuidParamsSchema), validateBody(createFnbOrderSchema), async (req, res) => {
  const { id } = getParams<{ id: string }>(res);
  const body = getBody<CreateFnbOrderInput>(res);
  const order = await createFnbOrder(id, req.user!.id, body);
  res.status(201).json({ success: true, data: order });
});

// Buat patungan untuk booking ini (FR-SB-01).
bookingsRouter.post(
  '/:id/split-bills',
  validateParams(uuidParamsSchema),
  validateBody(createSplitBillSchema),
  async (req, res) => {
    const { id } = getParams<{ id: string }>(res);
    const body = getBody<CreateSplitBillInput>(res);
    const split = await createSplitBill(id, req.user!.id, body);
    res.status(201).json({ success: true, data: split });
  },
);

// Intent pembayaran: penuh (VA/QRIS/e-wallet) atau satu share patungan.
bookingsRouter.post(
  '/:id/payments',
  validateParams(uuidParamsSchema),
  validateBody(createPaymentSchema),
  async (req, res) => {
    const { id } = getParams<{ id: string }>(res);
    const body = getBody<CreatePaymentInput>(res);
    const charge = await paymentsService.createCharge(req.user!.id, id, body);
    res.status(201).json({ success: true, data: charge });
  },
);

// E-ticket + QR F&B, terbit setelah lunas.
bookingsRouter.get('/:id/ticket', validateParams(uuidParamsSchema), async (req, res) => {
  const { id } = getParams<{ id: string }>(res);
  const ticket = await paymentsService.bookingTicket(id, req.user!.id);
  res.json({ success: true, data: ticket });
});
