class ApiConstants {
  ApiConstants._();

  /// 10.0.2.2 = loopback host dari Android emulator.
  /// Override via `flutter run --dart-define=API_BASE_URL=...` untuk device fisik.
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000/api/v1',
  );

  /// Sama dengan MAX_SEATS_PER_LOCK di backend (bookings.schemas.ts).
  static const maxSeatsPerBooking = 10;
}
