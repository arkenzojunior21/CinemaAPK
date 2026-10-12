import '../models/auth.dart';
import 'api_client.dart';

class AuthApi {
  AuthApi(this._client);

  final ApiClient _client;

  Future<AuthResult> register({
    required String fullName,
    required String email,
    required String password,
    String? phone,
  }) async {
    final body = await _client.post('/auth/register', data: {
      'full_name': fullName,
      'email': email,
      'password': password,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
    });
    return AuthResult.fromJson(body['data'] as Map<String, dynamic>);
  }

  Future<AuthResult> login({required String email, required String password}) async {
    final body = await _client.post('/auth/login', data: {
      'email': email,
      'password': password,
    });
    return AuthResult.fromJson(body['data'] as Map<String, dynamic>);
  }

  Future<void> logout(String refreshToken) async {
    await _client.post('/auth/logout', data: {'refresh_token': refreshToken});
  }
}
