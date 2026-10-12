import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/api_client.dart';
import '../../data/models/ai.dart';
import 'api_providers.dart';
import 'catalog_providers.dart';

/// Hasil kuesioner terakhir; state null berarti kuis belum dijalankan.
class QuizController extends AutoDisposeAsyncNotifier<AiResult?> {
  @override
  Future<AiResult?> build() async => null;

  Future<void> submit(QuizAnswer answer) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      final city = answer.city ?? ref.read(browseProvider).city;
      return ref.read(aiApiProvider).quiz(
            QuizAnswer(
              mood: answer.mood,
              favoriteGenres: answer.favoriteGenres,
              maxDurationMinutes: answer.maxDurationMinutes,
              companion: answer.companion,
              city: city,
              limit: answer.limit,
            ),
          );
    });
  }

  void reset() => state = const AsyncValue.data(null);
}

final quizControllerProvider =
    AsyncNotifierProvider.autoDispose<QuizController, AiResult?>(QuizController.new);

class ChatState {
  const ChatState({this.entries = const [], this.isSending = false, this.error});

  final List<ChatEntry> entries;
  final bool isSending;
  final String? error;

  bool get isEmpty => entries.isEmpty;
}

/// Cine-Buddy: riwayat percakapan dipegang perangkat (tabel history di server menyusul).
class ChatController extends AutoDisposeNotifier<ChatState> {
  @override
  ChatState build() => const ChatState();

  Future<void> send(String text) async {
    final message = text.trim();
    if (message.isEmpty || state.isSending) return;

    final history = _history();
    final entries = [...state.entries, ChatEntry.user(message), ChatEntry.pending()];
    state = ChatState(entries: entries, isSending: true);

    try {
      final result = await ref.read(aiApiProvider).chat(
            message: message,
            history: history,
            city: ref.read(browseProvider).city,
          );
      state = ChatState(entries: [..._withoutPending(entries), ChatEntry.assistant(result)]);
    } on ApiException catch (e) {
      state = ChatState(
        entries: [..._withoutPending(entries), ChatEntry.failed(e.message)],
        error: e.message,
      );
    } catch (_) {
      const failure = 'Cine-Buddy sedang sibuk. Coba lagi sebentar ya.';
      state = ChatState(
        entries: [..._withoutPending(entries), ChatEntry.failed(failure)],
        error: failure,
      );
    }
  }

  void clear() => state = const ChatState();

  /// 12 pesan terakhir agar muat cepat dan tetap dalam konteks.
  List<ChatMessage> _history() {
    final usable = state.entries.where((e) => !e.isPending && !e.isError).toList();
    final start = usable.length > 12 ? usable.length - 12 : 0;
    return usable.sublist(start).map((e) => e.toChatMessage()).toList();
  }

  List<ChatEntry> _withoutPending(List<ChatEntry> entries) =>
      entries.where((e) => !e.isPending).toList(growable: false);
}

final chatControllerProvider =
    AutoDisposeNotifierProvider<ChatController, ChatState>(ChatController.new);
