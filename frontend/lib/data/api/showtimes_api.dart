import '../models/seat_map.dart';
import 'api_client.dart';

class ShowtimesApi {
  ShowtimesApi(this._client);

  final ApiClient _client;

  Future<SeatMap> seatMap(String showtimeId) async {
    final body = await _client.get('/showtimes/$showtimeId');
    return SeatMap.fromJson(body['data'] as Map<String, dynamic>);
  }

  Future<SeatLockResult> acquireLocks(String showtimeId, List<String> seatIds) async {
    final body = await _client.post(
      '/showtimes/$showtimeId/seat-locks',
      data: {'seat_ids': seatIds},
    );
    return SeatLockResult.fromJson(body['data'] as Map<String, dynamic>);
  }

  Future<void> releaseLocks(String showtimeId) async {
    await _client.delete('/showtimes/$showtimeId/seat-locks');
  }
}
