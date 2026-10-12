import 'package:cinegen/core/utils/split_math.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('equalShares', () {
    test('membagi rata tanpa sisa', () {
      expect(equalShares(90000, 3), [30000, 30000, 30000]);
    });

    test('sisa dibebankan ke host', () {
      expect(equalShares(50000, 3), [16668, 16666, 16666]);
      expect(equalShares(50000, 3, hostIndex: 2), [16666, 16666, 16668]);
    });

    test('jumlah share selalu sama dengan total', () {
      for (final total in [1, 999, 50000, 137500, 4_500_000]) {
        for (final count in [1, 2, 3, 7, 10]) {
          expect(sumShares(equalShares(total, count)), total);
        }
      }
    });

    test('menolak input tidak valid', () {
      expect(() => equalShares(-1, 2), throwsArgumentError);
      expect(() => equalShares(1000, 0), throwsArgumentError);
      expect(() => equalShares(1000, 2, hostIndex: 2), throwsArgumentError);
    });
  });

  group('customRemaining', () {
    test('nol saat pembagian pas', () {
      expect(customRemaining(150000, [70000, 80000]), 0);
    });

    test('positif saat kurang, negatif saat lebih', () {
      expect(customRemaining(150000, [70000, 70000]), 10000);
      expect(customRemaining(150000, [90000, 90000]), -30000);
    });
  });
}
