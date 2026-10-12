import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { env } from '../../../config/env.js';
import {
  type ChargeRequest,
  type ChargeResult,
  type PaymentGateway,
  type VerifiedNotification,
  type NotificationStatus,
} from './gateway.js';

/** Signature notifikasi Midtrans: SHA512(order_id + status_code + gross_amount + serverKey). */
export function midtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
): string {
  return createHash('sha512').update(`${orderId}${statusCode}${grossAmount}${serverKey}`).digest('hex');
}

export function verifyMidtransNotification(
  body: Record<string, unknown>,
  serverKey: string,
): boolean {
  const signature = body.signature_key;
  const orderId = body.order_id;
  const statusCode = body.status_code;
  const grossAmount = body.gross_amount;
  if (
    typeof signature !== 'string' ||
    typeof orderId !== 'string' ||
    typeof statusCode !== 'string' ||
    typeof grossAmount !== 'string' ||
    !serverKey
  ) {
    return false;
  }

  const expected = midtransSignature(orderId, statusCode, grossAmount, serverKey);
  const a = Buffer.from(signature.toLowerCase(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const STATUS_MAP: Record<string, NotificationStatus> = {
  settlement: 'settled',
  capture: 'settled',
  succeed: 'settled',
  failed: 'failed',
  cancel: 'failed',
  deny: 'failed',
  expire: 'expired',
  expiration: 'expired',
  pending: 'pending',
  processing: 'pending',
  authorization: 'pending',
};

interface MidtransChargeResponse {
  transaction_status?: string;
  status_code?: string;
  order_id?: string;
  gross_amount?: string | number;
  va_numbers?: { bank?: string; va_number?: string }[];
  actions?: { method?: string; url?: string }[];
  qr_string?: string;
}

function actionUrl(actions: MidtransChargeResponse['actions'], methods: string[]): string | null {
  for (const method of methods) {
    const hit = actions?.find((action) => action.method === method)?.url;
    if (hit) return hit;
  }
  return actions?.find((action) => action.url)?.url ?? null;
}

export class MidtransGateway implements PaymentGateway {
  readonly name = 'midtrans';
  readonly acceptsNotifications = true;

  constructor(private readonly serverKey: string) {}

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const payload: Record<string, unknown> = {
      transaction_details: {
        order_id: request.paymentId,
        gross_amount: request.amount,
      },
      item_details: [
        {
          id: request.paymentId,
          name: request.description,
          price: request.amount,
          quantity: 1,
        },
      ],
    };

    if (request.customerName || request.customerEmail) {
      payload.customer_details = {
        first_name: request.customerName || undefined,
        email: request.customerEmail || undefined,
      };
    }

    switch (request.channel) {
      case 'qris':
        payload.payment_type = 'qris';
        break;
      case 'virtual_account':
        payload.payment_type = 'bank_transfer';
        payload.bank_transfer = { gateway: env.MIDTRANS_VA_BANK };
        break;
      case 'ewallet':
        payload.payment_type = 'gopay';
        payload.gopay = { enable_checkout: true };
        break;
    }

    const response = await fetch(`${env.MIDTRANS_BASE_URL}/v2/charge`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`${this.serverKey}:`).toString('base64')}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    }).catch((err: unknown) => {
      throw new AppError(502, 'GATEWAY_UNAVAILABLE', `Payment gateway tidak dapat dihubungi: ${(err as Error).message}`);
    });

    const text = await response.text();
    let parsed: MidtransChargeResponse = {};
    try {
      parsed = text ? (JSON.parse(text) as MidtransChargeResponse) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok || parsed.status_code !== '201') {
      throw new AppError(
        502,
        'GATEWAY_UNAVAILABLE',
        `Pembuatan pembayaran ditolak gateway (${parsed.status_code ?? response.status}).`,
      );
    }

    const qrisPayload =
      typeof parsed.qr_string === 'string' && parsed.qr_string.length > 0 ? parsed.qr_string : null;
    const va = parsed.va_numbers?.[0];

    return {
      gateway: this.name,
      transactionId: String(parsed.order_id ?? request.paymentId),
      qrisPayload,
      payUrl: actionUrl(parsed.actions, request.channel === 'qris' ? ['web'] : ['debit', 'payment-page']),
      vaNumber: va?.va_number ?? null,
      vaBank: va?.bank ?? (va?.va_number ? env.MIDTRANS_VA_BANK : null),
      expiresAt: null,
    };
  }

  parseNotification(body: Record<string, unknown>): VerifiedNotification | null {
    if (!verifyMidtransNotification(body, this.serverKey)) return null;

    const orderId = body.order_id;
    const rawStatus = body.transaction_status;
    if (typeof orderId !== 'string' || typeof rawStatus !== 'string') return null;

    const status = STATUS_MAP[rawStatus.toLowerCase()];
    if (!status) return null;

    const gross = body.gross_amount;
    const amount = typeof gross === 'number' ? gross : Number(gross);

    return {
      paymentId: orderId,
      status,
      grossAmount: Number.isFinite(amount) ? amount : null,
      raw: body,
    };
  }
}
