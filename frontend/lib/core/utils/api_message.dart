import '../../data/api/api_client.dart';

/// Pesan yang aman ditampilkan ke pengguna dari error layer data.
String describeApiError(Object error) {
  if (error is ApiException) return error.message;
  return 'Terjadi kesalahan. Coba lagi.';
}
