import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/booking.dart';
import '../../data/models/seat_map.dart';
import 'api_providers.dart';

final seatMapProvider = FutureProvider.family<SeatMap, String>(
  (ref, showtimeId) => ref.watch(showtimesApiProvider).seatMap(showtimeId),
);

final myBookingsProvider = FutureProvider<BookingsPage>(
  (ref) => ref.watch(bookingsApiProvider).list(),
);

final bookingDetailProvider = FutureProvider.family<Booking, String>(
  (ref, bookingId) => ref.watch(bookingsApiProvider).detail(bookingId),
);
