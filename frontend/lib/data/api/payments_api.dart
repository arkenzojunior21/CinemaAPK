import '../models/payment.dart';
import 'api_client.dart';

class PaymentsApi {
  PaymentsApi(this._client);

  final ApiClient _client;

  /// Buat (atau pakai ulang) intent pembayaran booking penuh / satu share patungan.
  Future<PaymentCharge> charge(
    String bookingId, {
    required String channel,
    String? participantId,
  }) async {
    final body = await _client.post('/bookings/$bookingId/payments', data: {
      'channel': channel,
      'participant_id': ?participantId,
    });
    return PaymentCharge.fromJson(body['data'] as Map<String, dynamic>);
  }

  Future<PaymentStatus> status(String paymentId) async {
    final body = await _client.get('/payments/$paymentId/status');
    return PaymentStatus.fromJson(body['data'] as Map<String, dynamic>);
  }

  /// Hanya dev/test: menandai lunas tanpa gateway (server menolak di production).
  Future<SettlementResult> simulate(String paymentId) async {
    final body = await _client.post('/payments/$paymentId/simulate');
    return SettlementResult.fromJson(body['data'] as Map<String, dynamic>);
  }

  Future<ETicket> ticket(String bookingId) async {
    final body = await _client.get('/bookings/$bookingId/ticket');
    return ETicket.fromJson(body['data'] as Map<String, dynamic>);
  }
}
