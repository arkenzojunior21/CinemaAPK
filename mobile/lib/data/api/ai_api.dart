import '../models/ai.dart';
import 'api_client.dart';

class AiApi {
  AiApi(this._client);

  final ApiClient _client;

  /// Kuesioner cepat (FR-AI-01).
  Future<AiResult> quiz(QuizAnswer answer) async {
    final body = await _client.post('/ai/quiz', data: answer.toMap());
    return AiResult.fromJson(body['data'] as Map<String, dynamic>);
  }

  /// Cine-Buddy (FR-AI-02): riwayat terakhir dikirim supaya konteks LLM terjaga.
  Future<AiResult> chat({
    required String message,
    List<ChatMessage> history = const [],
    String? city,
    int limit = 3,
  }) async {
    final body = await _client.post('/ai/chat', data: {
      'message': message,
      'history': history.map((m) => m.toMap()).toList(),
      if (city != null && city.isNotEmpty) 'city': city,
      'limit': limit,
    });
    return AiResult.fromJson(body['data'] as Map<String, dynamic>);
  }
}
