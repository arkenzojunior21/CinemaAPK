import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../common/middlewares/auth.js';
import { getBody, getParams, validateBody, validateParams } from '../../common/middlewares/validate.js';
import {
  gatewayParamsSchema,
  paymentIdParamsSchema,
  scanSchema,
  webhookBodySchema,
} from './payments.schemas.js';
import * as paymentsService from './payments.service.js';

export const paymentsRouter = Router();

// Notifikasi gateway (Midtrans) — publik, diamankan signature_key.
paymentsRouter.post(
  '/webhook/:gateway',
  validateParams(gatewayParamsSchema),
  validateBody(webhookBodySchema),
  async (req, res) => {
    const { gateway } = getParams<{ gateway: string }>(res);
    const outcome = await paymentsService.handleWebhook(gateway, getBody<Record<string, unknown>>(res));
    res.json({ success: true, data: outcome });
  },
);

// Pelunasan versi dev/test (tidak terdaftar di production).
paymentsRouter.post(
  '/:id/simulate',
  requireAuth,
  validateParams(paymentIdParamsSchema),
  async (req, res) => {
    const { id } = getParams<{ id: string }>(res);
    const outcome = await paymentsService.simulateSettlement(id, req.user!.id);
    res.json({ success: true, data: outcome });
  },
);

paymentsRouter.get(
  '/:id/status',
  requireAuth,
  validateParams(paymentIdParamsSchema),
  async (req, res) => {
    const { id } = getParams<{ id: string }>(res);
    const status = await paymentsService.paymentStatus(id, req.user!.id);
    res.json({ success: true, data: status });
  },
);

export const eticketsRouter = Router();

// Pemindaian QR di gerbang masuk (staff).
eticketsRouter.post('/scan', requireAuth, requireAdmin, validateBody(scanSchema), async (req, res) => {
  const { qr_payload } = getBody<{ qr_payload: string }>(res);
  const result = await paymentsService.scanTicket(qr_payload);
  res.json({ success: true, data: result });
});
