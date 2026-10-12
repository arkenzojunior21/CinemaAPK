class Movie {
  const Movie({
    required this.id,
    required this.title,
    required this.slug,
    required this.genres,
    required this.durationMinutes,
    required this.ageRating,
    this.language,
    this.posterUrl,
    this.ratingScore,
    this.releaseDate,
    this.synopsis,
    this.backdropUrl,
    this.trailerUrl,
    required this.status,
  });

  final String id;
  final String title;
  final String slug;
  final List<String> genres;
  final int durationMinutes;
  final String ageRating;
  final String? language;
  final String? posterUrl;
  final double? ratingScore;
  final String? releaseDate;
  final String? synopsis;
  final String? backdropUrl;
  final String? trailerUrl;
  final String status;

  factory Movie.fromJson(Map<String, dynamic> json) => Movie(
        id: json['id'] as String,
        title: json['title'] as String,
        slug: json['slug'] as String,
        genres: (json['genres'] as List).cast<String>(),
        durationMinutes: json['duration_minutes'] as int,
        ageRating: json['age_rating'] as String,
        language: json['language'] as String?,
        posterUrl: json['poster_url'] as String?,
        ratingScore: (json['rating_score'] as num?)?.toDouble(),
        releaseDate: json['release_date'] as String?,
        synopsis: json['synopsis'] as String?,
        backdropUrl: json['backdrop_url'] as String?,
        trailerUrl: json['trailer_url'] as String?,
        status: json['status'] as String,
      );
}

class MoviesPage {
  const MoviesPage({required this.items, required this.totalItems, required this.page, required this.totalPages});

  final List<Movie> items;
  final int totalItems;
  final int page;
  final int totalPages;

  factory MoviesPage.fromJson(Map<String, dynamic> json) {
    final meta = json['meta'] as Map<String, dynamic>;
    return MoviesPage(
      items: (json['items'] as List)
          .map((e) => Movie.fromJson(e as Map<String, dynamic>))
          .toList(growable: false),
      totalItems: meta['total_items'] as int,
      page: meta['page'] as int,
      totalPages: meta['total_pages'] as int,
    );
  }
}
