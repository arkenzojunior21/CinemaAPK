import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  generateBookingCode,
  generatePickupCode,
  generateShareToken,
} from '../../src/common/utils/codes.js';
import { parseDurationToSeconds } from '../../src/common/utils/parse-duration.js';

describe('Code generator', () => {
  it('booking code berformat CG-XXXXXX tanpa karakter ambigu', () => {
    for (let i = 0; i < 100; i++) {
      assert.match(generateBookingCode(), /^CG-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/);
    }
  });

  it('booking code cukup unik untuk 1000 generasi', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateBookingCode()));
    assert.equal(codes.size, 1000);
  });

  it('pickup code berformat FNB-XXXX', () => {
    assert.match(generatePickupCode(), /^FNB-[A-Z2-9]{4}$/);
  });

  it('share token berformat sp_ + hex', () => {
    assert.match(generateShareToken(), /^sp_[0-9a-f]{16}$/);
  });
});

describe('parseDurationToSeconds', () => {
  it('memparse semua unit', () => {
    assert.equal(parseDurationToSeconds('30s'), 30);
    assert.equal(parseDurationToSeconds('15m'), 900);
    assert.equal(parseDurationToSeconds('12h'), 43200);
    assert.equal(parseDurationToSeconds('7d'), 604800);
    assert.equal(parseDurationToSeconds('2w'), 1209600);
  });

  it('menolak format tidak valid', () => {
    assert.throws(() => parseDurationToSeconds('15'));
    assert.throws(() => parseDurationToSeconds('abc'));
    assert.throws(() => parseDurationToSeconds('5x'));
  });
});
