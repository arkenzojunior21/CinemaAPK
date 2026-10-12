import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Penandatanganan e-ticket & QR F&B (HMAC-SHA256).
 * QR memuat kode + booking_code + signature, sehingga pemindaian di gerbang dapat
 * diverifikasi hanya dengan secret (tanpa lookup) dan tidak bisa dipalsukan.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

export function generateTicketCode(): string {
  return `TK-${randomCode(6)}`;
}

function signature(secret: string, kind: string, code: string, bookingCode: string): string {
  return createHmac('sha256', secret).update(`${kind}|${code}|${bookingCode}`).digest('hex');
}

function toQr(kind: string, code: string, bookingCode: string, secret: string): string {
  return `cinegen:${kind}:${code}:${bookingCode}:${signature(secret, kind, code, bookingCode)}`;
}

export type TicketKind = 'ticket' | 'fnb';

export function signQr(secret: string, kind: TicketKind, code: string, bookingCode: string): string {
  return signature(secret, kind, code, bookingCode);
}

/** Menyusun ulang string QR dari kode tersimpan + signature tersimpan. */
export function assembleQr(kind: TicketKind, code: string, bookingCode: string, sig: string): string {
  return `cinegen:${kind}:${code}:${bookingCode}:${sig}`;
}

export function buildTicketQr(secret: string, ticketCode: string, bookingCode: string): string {
  return toQr('ticket', ticketCode, bookingCode, secret);
}

export function buildPickupQr(secret: string, pickupCode: string, bookingCode: string): string {
  return toQr('fnb', pickupCode, bookingCode, secret);
}

export interface ScannedTicket {
  kind: 'ticket' | 'fnb';
  code: string;
  bookingCode: string;
}

/** Kembalikan isi tiket bila QR asli, null bila palsu/rusak/berformat salah. */
export function verifyTicketQr(secret: string, qr: string): ScannedTicket | null {
  const parts = qr.trim().split(':');
  if (parts.length !== 5 || parts[0] !== 'cinegen') return null;

  const [, kind, code, bookingCode, provided] = parts;
  if (kind !== 'ticket' && kind !== 'fnb') return null;
  if (!code || !bookingCode || !/^[0-9a-f]{64}$/.test(provided)) return null;

  const expected = Buffer.from(signature(secret, kind, code, bookingCode), 'utf8');
  const actual = Buffer.from(provided.toLowerCase(), 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  return { kind, code, bookingCode };
}
