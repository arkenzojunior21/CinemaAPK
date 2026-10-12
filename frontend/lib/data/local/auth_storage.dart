import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/auth.dart';

/// Persistensi sesi (user + token) di SharedPreferences.
class AuthStorage {
  const AuthStorage(this._prefs);

  static const _kUser = 'cinegen_user';
  static const _kTokens = 'cinegen_tokens';

  final SharedPreferences _prefs;

  User? get user {
    final raw = _prefs.getString(_kUser);
    if (raw == null) return null;
    return User.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  Tokens? get tokens {
    final raw = _prefs.getString(_kTokens);
    if (raw == null) return null;
    return Tokens.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  Future<void> save(User user, Tokens tokens) async {
    await _prefs.setString(_kUser, jsonEncode(user.toJson()));
    await _prefs.setString(_kTokens, jsonEncode(tokens.toJson()));
  }

  Future<void> updateTokens(Tokens tokens) async {
    await _prefs.setString(_kTokens, jsonEncode(tokens.toJson()));
  }

  Future<void> clear() async {
    await _prefs.remove(_kUser);
    await _prefs.remove(_kTokens);
  }
}
