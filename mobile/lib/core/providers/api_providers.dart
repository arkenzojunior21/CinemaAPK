import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/api_client.dart';
import '../../data/api/ai_api.dart';
import '../../data/api/auth_api.dart';
import '../../data/api/bookings_api.dart';
import '../../data/api/cinemas_api.dart';
import '../../data/api/fnb_api.dart';
import '../../data/api/movies_api.dart';
import '../../data/api/payments_api.dart';
import '../../data/api/showtimes_api.dart';
import '../../data/api/split_api.dart';
import '../../data/local/auth_storage.dart';

/// Di-override di `main()` dengan instance yang sudah siap (SharedPreferences termuat).
final apiClientProvider = Provider<ApiClient>(
  (ref) => throw UnimplementedError('apiClientProvider harus di-override di main()'),
);

final authStorageProvider = Provider<AuthStorage>((ref) => ref.watch(apiClientProvider).storage);

final authApiProvider = Provider<AuthApi>((ref) => AuthApi(ref.watch(apiClientProvider)));
final moviesApiProvider = Provider<MoviesApi>((ref) => MoviesApi(ref.watch(apiClientProvider)));
final cinemasApiProvider = Provider<CinemasApi>((ref) => CinemasApi(ref.watch(apiClientProvider)));
final showtimesApiProvider =
    Provider<ShowtimesApi>((ref) => ShowtimesApi(ref.watch(apiClientProvider)));
final bookingsApiProvider =
    Provider<BookingsApi>((ref) => BookingsApi(ref.watch(apiClientProvider)));
final fnbApiProvider = Provider<FnbApi>((ref) => FnbApi(ref.watch(apiClientProvider)));
final aiApiProvider = Provider<AiApi>((ref) => AiApi(ref.watch(apiClientProvider)));
final splitApiProvider = Provider<SplitApi>((ref) => SplitApi(ref.watch(apiClientProvider)));
final paymentsApiProvider =
    Provider<PaymentsApi>((ref) => PaymentsApi(ref.watch(apiClientProvider)));
