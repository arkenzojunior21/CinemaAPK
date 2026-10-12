/// Film kandidat dari engine rekomendasi (lebih ringkas daripada [Movie] katalog).
class RecommendedMovie {
  const RecommendedMovie({
    required this.id,
    required this.title,
    required this.genres,
    required this.durationMinutes,
    required this.ageRating,
    required this.showingCount,
    this.posterUrl,
    this.synopsis,
    this.ratingScore,
  });

  final String id;
  final String title;
  final List<String> genres;
  final int durationMinutes;
  final String ageRating;
  final int showingCount;
  final String? posterUrl;
  final String? synopsis;
  final double? ratingScore;

  factory RecommendedMovie.fromJson(Map<String, dynamic> json) => RecommendedMovie(
        id: json['id'] as String,
        title: json['title'] as String,
        genres: (json['genres'] as List).cast<String>(),
        durationMinutes: json['duration_minutes'] as int,
        ageRating: json['age_rating'] as String,
        showingCount: (json['showing_count'] as num?)?.toInt() ?? 0,
        posterUrl: json['poster_url'] as String?,
        synopsis: json['synopsis'] as String?,
        ratingScore: (json['rating_score'] as num?)?.toDouble(),
      );
}

/// Rekomendasi + alasan (FR-AI-03: rationale tidak pernah opsional).
class Recommendation {
  const Recommendation({
    required this.movie,
    required this.matchScore,
    required this.rationale,
  });

  final RecommendedMovie movie;
  final double matchScore;
  final String rationale;

  factory Recommendation.fromJson(Map<String, dynamic> json) => Recommendation(
        movie: RecommendedMovie.fromJson(json['movie'] as Map<String, dynamic>),
        matchScore: ((json['match_score'] as num?) ?? 0).toDouble(),
        rationale: json['rationale'] as String,
      );
}

class AiResult {
  const AiResult({required this.engine, required this.recommendations, this.reply});

  /// `gemini` bila LLM dipakai, `local` bila mesin deterministik yang mengambil alih.
  final String engine;
  final List<Recommendation> recommendations;
  final String? reply;

  bool get isLlmPowered => engine == 'gemini';

  factory AiResult.fromJson(Map<String, dynamic> json) => AiResult(
        engine: json['engine'] as String? ?? 'local',
        reply: json['reply'] as String?,
        recommendations: (json['recommendations'] as List? ?? const [])
            .map((e) => Recommendation.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
      );
}

/// Jawaban kuis visual (FR-AI-01).
class QuizAnswer {
  const QuizAnswer({
    required this.mood,
    required this.favoriteGenres,
    required this.maxDurationMinutes,
    required this.companion,
    this.city,
    this.limit = 3,
  });

  final String mood;
  final List<String> favoriteGenres;
  final int maxDurationMinutes;
  final String companion;
  final String? city;
  final int limit;

  Map<String, dynamic> toMap() => {
        'mood': mood,
        'favorite_genres': favoriteGenres,
        'max_duration_minutes': maxDurationMinutes,
        'companion': companion,
        if (city != null && city!.isNotEmpty) 'city': city,
        'limit': limit,
      };
}

class ChatMessage {
  const ChatMessage({required this.role, required this.content});

  final String role;
  final String content;

  Map<String, dynamic> toMap() => {'role': role, 'content': content};
}

/// Satu gelembung percakapan; balasan asisten dapat membawa rekomendasi.
class ChatEntry {
  const ChatEntry._({
    required this.role,
    required this.content,
    this.recommendations = const [],
    this.isPending = false,
    this.isError = false,
  });

  const ChatEntry.user(String content)
      : this._(role: 'user', content: content);

  ChatEntry.assistant(AiResult result)
      : this._(
          role: 'assistant',
          content: result.reply ?? '',
          recommendations: result.recommendations,
        );

  const ChatEntry.pending() : this._(role: 'assistant', content: '', isPending: true);

  const ChatEntry.failed(String message)
      : this._(role: 'assistant', content: message, isError: true);

  final String role;
  final String content;
  final List<Recommendation> recommendations;
  final bool isPending;
  final bool isError;

  bool get isUser => role == 'user';

  ChatMessage toChatMessage() => ChatMessage(role: role, content: content);
}
