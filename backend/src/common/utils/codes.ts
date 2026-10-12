import { randomBytes } from 'node:crypto';

// Alfabet tanpa karakter ambigu (tanpa I, L, O, U, 0, 1).
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

export function generateBookingCode(): string {
  return `CG-${randomCode(6)}`;
}

export function generatePickupCode(): string {
  return `FNB-${randomCode(4)}`;
}

export function generateShareToken(): string {
  return `sp_${randomBytes(8).toString('hex')}`;
}

export const MAX_SEATS_PER_LOCK = 10;
