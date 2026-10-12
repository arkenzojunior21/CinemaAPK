import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/payment.dart';
import 'api_providers.dart';

/// E-ticket + QR F&B (diterbitkan server setelah pembayaran lunas).
final eticketProvider = FutureProvider.family.autoDispose<ETicket, String>(
  (ref, bookingId) => ref.watch(paymentsApiProvider).ticket(bookingId),
);
