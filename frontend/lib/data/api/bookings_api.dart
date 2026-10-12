import '../models/booking.dart';
import 'api_client.dart';

class BookingsApi {
  BookingsApi(this._client);

  final ApiClient _client;

  Future<BookingCreated> create({
    required String showtimeId,
    required List<String> seatReservationIds,
  }) async {
    final body = await _client.post('/bookings', data: {
      'showtime_id': showtimeId,
      'seat_reservation_ids': seatReservationIds,
    });
    return BookingCreated.fromJson(body['data'] as Map<String, dynamic>);
  }

  Future<BookingsPage> list({String? status, int page = 1}) async {
    final body = await _client.get('/bookings', query: {
      'status': ?status,
      'page': page,
    });
    return BookingsPage.fromJson(body['data'] as Map<String, dynamic>);
  }

  Future<Booking> detail(String id) async {
    final body = await _client.get('/bookings/$id');
    return Booking.fromJson(body['data'] as Map<String, dynamic>);
  }

  Future<void> cancel(String id) async {
    await _client.post('/bookings/$id/cancel');
  }
}
