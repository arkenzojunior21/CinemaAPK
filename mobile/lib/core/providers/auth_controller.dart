import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/api_client.dart';
import '../../data/models/auth.dart';
import 'api_providers.dart';

class AuthState {
  const AuthState({this.user});

  final User? user;

  bool get isLoggedIn => user != null;
  String get firstName => (user?.fullName ?? '').split(' ').first;
}

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() => AuthState(user: ref.watch(authStorageProvider).user);

  Future<void> login({required String email, required String password}) async {
    final result = await ref.read(authApiProvider).login(email: email, password: password);
    await _persist(result);
  }

  Future<void> register({
    required String fullName,
    required String email,
    required String password,
    String? phone,
  }) async {
    final result = await ref.read(authApiProvider).register(
          fullName: fullName,
          email: email,
          password: password,
          phone: phone,
        );
    await _persist(result);
  }

  Future<void> logout() async {
    final storage = ref.read(authStorageProvider);
    final refresh = storage.tokens?.refreshToken;
    if (refresh != null) {
      try {
        await ref.read(authApiProvider).logout(refresh);
      } on ApiException {
        // Sesi lokal tetap dibersihkan walau server menolak revoke.
      }
    }
    await storage.clear();
    state = const AuthState();
  }

  Future<void> _persist(AuthResult result) async {
    await ref.read(authStorageProvider).save(result.user, result.tokens);
    state = AuthState(user: result.user);
  }
}

final authControllerProvider =
    NotifierProvider<AuthController, AuthState>(AuthController.new);
