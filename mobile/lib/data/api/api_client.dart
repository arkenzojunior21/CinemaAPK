import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/constants/api_constants.dart';
import '../local/auth_storage.dart';
import '../models/auth.dart';

/// Error API terstruktur: kode dari backend + pesan ramah pengguna.
class ApiException implements Exception {
  ApiException({required this.statusCode, this.code, required this.message});

  final int statusCode;
  final String? code;
  final String message;

  bool get isAuthError => statusCode == 401;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient(this._dio, this._storage);

  final Dio _dio;
  final AuthStorage _storage;

  Dio get dio => _dio;

  AuthStorage get storage => _storage;

  static Future<ApiClient> create() async {
    final prefs = await SharedPreferences.getInstance();
    final storage = AuthStorage(prefs);
    final dio = Dio();
    dio.options
      ..baseUrl = ApiConstants.baseUrl
      ..connectTimeout = const Duration(seconds: 10)
      ..receiveTimeout = const Duration(seconds: 20);
    final client = ApiClient(dio, storage);
    dio.interceptors.add(_AuthInterceptor(client));
    return client;
  }

  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async {
    final res = await _dio.get<Map<String, dynamic>>(path, queryParameters: query);
    final body = res.data;
    if (body == null) throw ApiException(statusCode: 500, message: 'Respons kosong dari server.');
    return body;
  }

  Future<Map<String, dynamic>> post(String path, {Object? data}) async {
    final res = await _dio.post<Map<String, dynamic>>(path, data: data);
    final payload = res.data;
    if (payload == null) throw ApiException(statusCode: 500, message: 'Respons kosong dari server.');
    return payload;
  }

  Future<Map<String, dynamic>> delete(String path) async {
    final res = await _dio.delete<Map<String, dynamic>>(path);
    final data = res.data;
    if (data == null) throw ApiException(statusCode: 500, message: 'Respons kosong dari server.');
    return data;
  }
}

/// Menempelkan access token, dan bila 401 → refresh token sekali lalu ulang request.
class _AuthInterceptor extends QueuedInterceptor {
  _AuthInterceptor(this._client);

  final ApiClient _client;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final tokens = _client._storage.tokens;
    if (tokens != null) {
      options.headers['Authorization'] = 'Bearer ${tokens.accessToken}';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    final isAuthEndpoint = err.requestOptions.path.contains('/auth/');
    if (err.response?.statusCode != 401 || isAuthEndpoint) {
      handler.next(_toApiException(err));
      return;
    }

    final refreshed = await _tryRefresh();
    if (!refreshed) {
      await _client._storage.clear();
      handler.next(_toApiException(err));
      return;
    }

    try {
      final retry = await _client._dio.fetch(err.requestOptions);
      handler.resolve(retry);
    } on DioException catch (e) {
      handler.next(_toApiException(e));
    }
  }

  Future<bool> _tryRefresh() async {
    final storage = _client._storage;
    final tokens = storage.tokens;
    if (tokens == null) return false;
    try {
      final res = await _client._dio.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refresh_token': tokens.refreshToken},
      );
      final body = res.data;
      if (body == null) return false;
      final data = body['data'];
      if (data is! Map<String, dynamic>) return false;
      final newTokens = data['tokens'];
      final newUser = data['user'];
      if (newTokens is! Map<String, dynamic>) return false;
      await storage.updateTokens(Tokens.fromJson(newTokens));
      if (newUser is Map<String, dynamic>) {
        await storage.save(User.fromJson(newUser), Tokens.fromJson(newTokens));
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  DioException _toApiException(DioException err) {
    final response = err.response;
    if (response != null) {
      final body = response.data;
      String message = 'Terjadi kesalahan pada server.';
      String? code;
      if (body is Map<String, dynamic>) {
        final error = body['error'];
        if (error is Map<String, dynamic>) {
          final m = error['message'];
          if (m is String) message = m;
          code = error['code'] as String?;
        }
      }
      return DioException(
        requestOptions: err.requestOptions,
        error: ApiException(statusCode: response.statusCode ?? 500, code: code, message: message),
        type: DioExceptionType.badResponse,
      );
    }
    final message = err.type == DioExceptionType.connectionTimeout ||
            err.type == DioExceptionType.connectionError
        ? 'Tidak dapat terhubung ke server. Pastikan backend berjalan.'
        : 'Koneksi bermasalah. Coba lagi.';
    return DioException(
      requestOptions: err.requestOptions,
      error: ApiException(statusCode: 0, message: message),
      type: err.type,
    );
  }
}
