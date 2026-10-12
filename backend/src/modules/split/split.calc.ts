/**
 * Kalkulasi pembagian tagihan (FR-SB-01).
 * Fungsi murni & integer-only: uang tidak pernah memakai float, dan sisa pembagian
 * yang tidak habis selalu dibebankan ke host sehingga jumlah seluruh share
 * persis sama dengan total tagihan.
 */

export function splitEqually(total: number, shareCount: number, hostIndex = 0): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError('Total tagihan harus bilangan bulat non-negatif.');
  }
  if (!Number.isInteger(shareCount) || shareCount < 1) {
    throw new RangeError('Jumlah peserta minimal 1.');
  }
  if (!Number.isInteger(hostIndex) || hostIndex < 0 || hostIndex >= shareCount) {
    throw new RangeError('Indeks host berada di luar daftar peserta.');
  }

  const base = Math.floor(total / shareCount);
  const remainder = total - base * shareCount;

  return Array.from({ length: shareCount }, (_, index) =>
    index === hostIndex ? base + remainder : base,
  );
}

export interface CustomShareInput {
  name: string;
  amount: number;
}

export function sumShares(shares: readonly number[]): number {
  return shares.reduce((acc, value) => acc + value, 0);
}

/** Memastikan total share kustom sama persis dengan total tagihan. */
export function validateCustomShares(
  total: number,
  participants: readonly CustomShareInput[],
): number[] {
  const amounts = participants.map((p) => p.amount);
  if (amounts.some((amount) => !Number.isInteger(amount) || amount < 0)) {
    throw new RangeError('Nilai share kustom harus bilangan bulat non-negatif.');
  }

  const sum = sumShares(amounts);
  if (sum !== total) {
    throw new RangeError(
      `Total share (${sum}) harus sama dengan total tagihan (${total}).`,
    );
  }
  return amounts;
}

export interface TrackerSummary {
  total: number;
  paid: number;
  remaining: number;
  paidCount: number;
  pendingCount: number;
  allPaid: boolean;
}

export function summarizeTracker(
  shares: readonly number[],
  statuses: readonly string[],
): TrackerSummary {
  let paid = 0;
  let paidCount = 0;

  shares.forEach((share, index) => {
    if (statuses[index] === 'paid') {
      paid += share;
      paidCount += 1;
    }
  });

  const total = sumShares(shares);
  return {
    total,
    paid,
    remaining: total - paid,
    paidCount,
    pendingCount: shares.length - paidCount,
    allPaid: shares.length > 0 && paidCount === shares.length,
  };
}
