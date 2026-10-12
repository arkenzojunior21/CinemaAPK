/// Cerminan aturan kalkulasi server (backend/src/modules/split/split.calc.ts)
/// untuk pratinjau langsung di form. Nilai final selalu dihitung ulang oleh API.
library;

void _assertRupiah(int value, String label) {
  if (value < 0) throw ArgumentError('$label tidak boleh negatif');
}

/// Bagi rata; sisa yang tidak habis dibebankan ke host (indeks [hostIndex]).
List<int> equalShares(int total, int count, {int hostIndex = 0}) {
  _assertRupiah(total, 'Total tagihan');
  if (count < 1) throw ArgumentError('Jumlah peserta minimal 1');
  if (hostIndex < 0 || hostIndex >= count) throw ArgumentError('Indeks host di luar peserta');

  final base = total ~/ count;
  final remainder = total - base * count;
  return List<int>.generate(count, (i) => i == hostIndex ? base + remainder : base);
}

int sumShares(List<int> shares) => shares.fold(0, (a, b) => a + b);

/// Sisa tagihan yang belum terbagi pada metode kustom (boleh negatif = kelebihan).
int customRemaining(int total, List<int> amounts) => total - sumShares(amounts);
