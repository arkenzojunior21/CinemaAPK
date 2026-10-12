/** Kontrak payment gateway: satu interface, banyak implementasi (Midtrans, simulated). */

export type PaymentChannel = 'qris' | 'virtual_account' | 'ewallet';

export const PAYMENT_CHANNELS: readonly PaymentChannel[] = ['qris', 'virtual_account', 'ewallet'];

export interface ChargeRequest {
  /** UUID payment kami; dikirim ke gateway sebagai order_id supaya korelasi webhook mudah. */
  paymentId: string;
  channel: PaymentChannel;
  amount: number;
  description: string;
  customerName: string;
  customerEmail?: string;
  /** Merchant lokal untuk payload QRIS (nama & kota bioskop). */
  merchantName?: string;
  merchantCity?: string;
}

export interface ChargeResult {
  gateway: string;
  transactionId: string;
  qrisPayload: string | null;
  payUrl: string | null;
  vaNumber: string | null;
  vaBank: string | null;
  expiresAt: Date | null;
}

export type NotificationStatus = 'settled' | 'failed' | 'expired' | 'pending';

export interface VerifiedNotification {
  paymentId: string;
  status: NotificationStatus;
  grossAmount: number | null;
  raw: Record<string, unknown>;
}

export interface PaymentGateway {
  readonly name: string;
  /** True bila gateway menerima notifikasi HTTP dari pihak luar. */
  readonly acceptsNotifications: boolean;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  /** Kembalikan null bila signature/body tidak valid (ditolak sebagai 400). */
  parseNotification(body: Record<string, unknown>): VerifiedNotification | null;
}
