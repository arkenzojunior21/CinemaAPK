/**
 * Penyusun payload QRIS (EMVCo Merchant-Presented Mode).
 * Format tag-length-value dengan CRC-16/CCITT-FALSE pada tag 63,
 * sehingga string yang dihasilkan siap dirender menjadi QR code.
 * Nilai final (static/dynamic) tetap dikoordinasikan dengan payment gateway di TAHAP 6.
 */

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface QrisPayloadInput {
  /** ID peserta patungan; dipakai sebagai nomor tagihan (tag 62). */
  reference: string;
  amount: number;
  merchantName?: string;
  merchantCity?: string;
}

export function buildQrisPayload(input: QrisPayloadInput): string {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new RangeError('QRIS membutuhkan jumlah rupiah bulat lebih dari nol.');
  }

  const body = [
    tlv('00', '01'),
    tlv('01', '12'),
    tlv('29', tlv('00', 'ID.CO.CINEGEN') + tlv('01', input.reference.slice(0, 24))),
    tlv('30', tlv('00', 'CINEGEN') + tlv('01', 'ID')),
    tlv('52', '5044'),
    tlv('53', '360'),
    tlv('54', String(input.amount)),
    tlv('58', 'ID'),
    tlv('59', (input.merchantName ?? 'CINEGEN').slice(0, 25)),
    tlv('60', (input.merchantCity ?? 'JAKARTA').slice(0, 15)),
    tlv('62', tlv('01', input.reference.slice(0, 24))),
    '6304',
  ].join('');

  return `${body}${crc16(body)}`;
}
