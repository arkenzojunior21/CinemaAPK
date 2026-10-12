import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildQrisPayload } from '../../src/common/utils/qris.js';

function parseTlv(payload: string): Map<string, string> {
  const tags = new Map<string, string>();
  let cursor = 0;
  while (cursor < payload.length) {
    const id = payload.slice(cursor, cursor + 2);
    const rawLength = payload.slice(cursor + 2, cursor + 4);
    assert.match(rawLength, /^\d{2}$/, `tag ${id} harus punya panjang 2 digit`);
    const length = Number(rawLength);
    const value = payload.slice(cursor + 4, cursor + 4 + length);
    assert.equal(value.length, length, `panjang nilai tag ${id} tidak sesuai`);
    tags.set(id, value);
    cursor += 4 + length;
  }
  return tags;
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

describe('buildQrisPayload', () => {
  const payload = buildQrisPayload({
    reference: 'participant-42',
    amount: 100000,
    merchantName: 'CINEGEN',
    merchantCity: 'JAKARTA',
  });

  it('seluruh tag dapat di-parse sebagai tag-length-value', () => {
    const tags = parseTlv(payload);
    assert.equal(tags.get('00'), '01');
    assert.equal(tags.get('01'), '12');
    assert.equal(tags.get('53'), '360');
    assert.equal(tags.get('54'), '100000');
    assert.equal(tags.get('58'), 'ID');
    assert.equal(tags.get('59'), 'CINEGEN');
    assert.equal(tags.get('60'), 'JAKARTA');
  });

  it('memuat referensi di merchant account info (29) dan bill number (62)', () => {
    const tags = parseTlv(payload);
    assert.ok(tags.get('29')?.includes('participant-42'));
    assert.ok(tags.get('29')?.includes('ID.CO.CINEGEN'));
    assert.equal(parseTlv(tags.get('62') ?? '').get('01'), 'participant-42');
  });

  it('CRC pada tag 63 cocok dengan perhitungan atas sisa payload', () => {
    const body = payload.slice(0, payload.length - 4);
    const checksum = payload.slice(payload.length - 4);
    assert.match(checksum, /^[0-9A-F]{4}$/);
    assert.equal(crc16(body), checksum);
    assert.equal(parseTlv(payload).get('63'), checksum);
  });

  it('memotong nama merchant dan kota sesuai batas EMVCo', () => {
    const tags = parseTlv(
      buildQrisPayload({
        reference: 'x',
        amount: 1,
        merchantName: 'CINEMA GENERATION SANGAT PANJANG SEKALI',
        merchantCity: 'KOTA ADMINISTRASI JAKARTA PUSAT',
      }),
    );
    assert.ok((tags.get('59') ?? '').length <= 25);
    assert.ok((tags.get('60') ?? '').length <= 15);
  });

  it('menolak jumlah bukan bulat positif', () => {
    assert.throws(() => buildQrisPayload({ reference: 'x', amount: 0 }), RangeError);
    assert.throws(() => buildQrisPayload({ reference: 'x', amount: -5000 }), RangeError);
    assert.throws(() => buildQrisPayload({ reference: 'x', amount: 1500.75 }), RangeError);
  });
});
