import 'dart:convert';

import 'package:cinegen/core/providers/api_providers.dart';
import 'package:cinegen/core/providers/auth_controller.dart';
import 'package:cinegen/data/api/api_client.dart';
import 'package:cinegen/data/models/auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:cinegen/app.dart';

Future<ApiClient> _buildClient({Map<String, String> values = const {}}) async {
  SharedPreferences.setMockInitialValues(values);
  return ApiClient.create();
}

void main() {
  testWidgets('tanpa sesi tersimpan, splash membawa pengguna ke login', (tester) async {
    final client = await _buildClient();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(client)],
        child: const CineGenApp(),
      ),
    );

    expect(find.text('CineGen'), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 900));
    await tester.pumpAndSettle();

    expect(find.text('Masuk untuk lanjut'), findsOneWidget);
  });

  test('sesi dari penyimpanan lokal dikenali tanpa request jaringan', () async {
    final client = await _buildClient(
      values: {
        'cinegen_user': jsonEncode(const {
          'id': '11111111-1111-4111-8111-111111111111',
          'full_name': 'Budi Santoso',
          'email': 'budi@example.com',
          'phone': null,
          'role': 'customer',
        }),
        'cinegen_tokens': jsonEncode(const {
          'access_token': 'a',
          'refresh_token': 'b',
          'expires_in': 900,
        }),
      },
    );

    final container = ProviderContainer(
      overrides: [apiClientProvider.overrideWithValue(client)],
    );
    addTearDown(container.dispose);

    final state = container.read(authControllerProvider);
    expect(state.isLoggedIn, isTrue);
    expect(state.user, isA<User>());
    expect(state.firstName, 'Budi');
  });

  test('User dan Tokens bertahan melewati penyimpanan lokal', () async {
    final client = await _buildClient();
    const user = User(
      id: '22222222-2222-4222-8222-222222222222',
      fullName: 'Citra Dewi',
      email: 'citra@example.com',
      role: 'customer',
    );
    const tokens = Tokens(accessToken: 'x', refreshToken: 'y', expiresIn: 900);

    await client.storage.save(user, tokens);

    expect(client.storage.user?.fullName, 'Citra Dewi');
    expect(client.storage.tokens?.accessToken, 'x');

    await client.storage.clear();
    expect(client.storage.user, isNull);
  });
}
