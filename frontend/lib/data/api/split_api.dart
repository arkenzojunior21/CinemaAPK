import '../models/split.dart';
import 'api_client.dart';

class SplitApi {
  SplitApi(this._client);

  final ApiClient _client;

  /// Buat patungan dari booking yang belum lunas (FR-SB-01).
  Future<SplitBill> create(String bookingId, {required String method, required List<SplitMemberDraft> members}) async {
    final body = await _client.post('/bookings/$bookingId/split-bills', data: {
      'method': method,
      'participants': [for (final member in members) member.toMap()],
    });
    return SplitBill.fromJson(body['data'] as Map<String, dynamic>);
  }

  /// Tracker status bayar (FR-SB-03).
  Future<SplitBill> detail(String splitId) async {
    final body = await _client.get('/split-bills/$splitId');
    return SplitBill.fromJson(body['data'] as Map<String, dynamic>);
  }
}
