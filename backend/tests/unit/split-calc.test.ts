import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  splitEqually,
  sumShares,
  summarizeTracker,
  validateCustomShares,
} from '../../src/modules/split/split.calc.js';

describe('splitEqually', () => {
  it('membagi rata tanpa sisa', () => {
    assert.deepEqual(splitEqually(200000, 2), [100000, 100000]);
  });

  it('sisa pembagian dibebankan ke host (indeks 0 default)', () => {
    const shares = splitEqually(50000, 3);
    assert.deepEqual(shares, [16668, 16666, 16666]);
    assert.equal(sumShares(shares), 50000);
  });

  it('sisa mengikuti indeks host yang diberikan', () => {
    assert.deepEqual(splitEqually(50001, 3, 2), [16667, 16667, 16667]);
    assert.deepEqual(splitEqually(50003, 3, 1), [16667, 16669, 16667]);
  });

  it('jumlah share selalu persis sama dengan total untuk berbagai kasus', () => {
    for (const total of [1, 999, 100000, 750003, 12345678]) {
      for (let count = 1; count <= 7; count++) {
        assert.equal(sumShares(splitEqually(total, count)), total, `total ${total} / ${count}`);
      }
    }
  });

  it('menolak total non-bulat atau negatif', () => {
    assert.throws(() => splitEqually(1000.5, 2), RangeError);
    assert.throws(() => splitEqually(-1, 2), RangeError);
  });

  it('menolak jumlah peserta < 1 dan indeks host di luar rentang', () => {
    assert.throws(() => splitEqually(1000, 0), RangeError);
    assert.throws(() => splitEqually(1000, 2, 2), RangeError);
  });
});

describe('validateCustomShares', () => {
  it('mengembalikan nominal ketika total cocok', () => {
    const amounts = validateCustomShares(150000, [
      { name: 'Budi', amount: 100000 },
      { name: 'Sinta', amount: 50000 },
    ]);
    assert.deepEqual(amounts, [100000, 50000]);
  });

  it('menolak total yang tidak sama dengan tagihan', () => {
    assert.throws(
      () =>
        validateCustomShares(150000, [
          { name: 'Budi', amount: 100000 },
          { name: 'Sinta', amount: 40000 },
        ]),
      /Total share \(140000\) harus sama dengan total tagihan \(150000\)/,
    );
  });

  it('menolak nominal non-bulat atau negatif', () => {
    assert.throws(
      () =>
        validateCustomShares(1000, [
          { name: 'A', amount: 500.5 },
          { name: 'B', amount: 499.5 },
        ]),
      RangeError,
    );
    assert.throws(
      () =>
        validateCustomShares(1000, [
          { name: 'A', amount: -100 },
          { name: 'B', amount: 1100 },
        ]),
      RangeError,
    );
  });

  it('memperbolehkan peserta bernominal nol (tidak ikut bayar)', () => {
    assert.deepEqual(
      validateCustomShares(80000, [
        { name: 'A', amount: 80000 },
        { name: 'B', amount: 0 },
      ]),
      [80000, 0],
    );
  });
});

describe('summarizeTracker', () => {
  const shares = [100000, 50000, 50000];

  it('menggabungkan uang dan jumlah peserta yang lunas', () => {
    const summary = summarizeTracker(shares, ['paid', 'pending', 'expired']);
    assert.deepEqual(summary, {
      total: 200000,
      paid: 100000,
      remaining: 100000,
      paidCount: 1,
      pendingCount: 2,
      allPaid: false,
    });
  });

  it('allPaid hanya true saat semua lunas', () => {
    assert.equal(summarizeTracker(shares, ['paid', 'paid', 'paid']).allPaid, true);
    assert.equal(summarizeTracker(shares, ['paid', 'paid', 'pending']).allPaid, false);
  });

  it('tracker kosong tidak dianggap lunas', () => {
    assert.deepEqual(summarizeTracker([], []), {
      total: 0,
      paid: 0,
      remaining: 0,
      paidCount: 0,
      pendingCount: 0,
      allPaid: false,
    });
  });
});
