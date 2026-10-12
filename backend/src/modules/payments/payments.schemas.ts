import { z } from 'zod';
import { PAYMENT_CHANNELS } from './gateways/gateway.js';

export const createPaymentSchema = z.object({
  channel: z.enum(PAYMENT_CHANNELS),
  /** Diisi hanya untuk membayar satu share patungan. */
  participant_id: z.uuid().optional(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const gatewayParamsSchema = z.object({
  gateway: z.string().trim().min(2).max(20),
});

export const paymentIdParamsSchema = z.object({ id: z.uuid() });

export const scanSchema = z.object({
  qr_payload: z.string().trim().min(20).max(400),
});

export const webhookBodySchema = z
  .record(z.string(), z.unknown())
  .refine((body) => Object.keys(body).length > 0, 'Body notifikasi kosong.');
