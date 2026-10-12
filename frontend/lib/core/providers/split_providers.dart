import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/split.dart';
import 'api_providers.dart';

/// Tracker patungan (FR-SB-03). Muat ulang manual lewat pull-to-refresh;
/// status bayar baru berubah setelah gateway TAHAP 6.
final splitBillProvider = FutureProvider.family<SplitBill, String>(
  (ref, splitId) => ref.watch(splitApiProvider).detail(splitId),
);
