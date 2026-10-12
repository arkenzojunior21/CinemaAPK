class CinemaRef {
  const CinemaRef({required this.id, required this.chain, required this.name, required this.city});

  final String id;
  final String chain;
  final String name;
  final String city;

  factory CinemaRef.fromJson(Map<String, dynamic> json) => CinemaRef(
        id: json['id'] as String,
        chain: json['chain'] as String,
        name: json['name'] as String,
        city: json['city'] as String,
      );
}

class ShowtimeItem {
  const ShowtimeItem({
    required this.id,
    required this.studio,
    required this.startsAt,
    required this.format,
    required this.basePrice,
    this.language,
    this.subtitle,
  });

  final String id;
  final String studio;
  final DateTime startsAt;
  final String format;
  final int basePrice;
  final String? language;
  final String? subtitle;

  factory ShowtimeItem.fromJson(Map<String, dynamic> json) => ShowtimeItem(
        id: json['id'] as String,
        studio: json['studio'] as String,
        startsAt: DateTime.parse(json['starts_at'] as String).toLocal(),
        format: json['format'] as String,
        basePrice: json['base_price'] as int,
        language: json['language'] as String?,
        subtitle: json['subtitle'] as String?,
      );
}

class CinemaShowtimeGroup {
  const CinemaShowtimeGroup({required this.cinema, required this.showtimes});

  final CinemaRef cinema;
  final List<ShowtimeItem> showtimes;

  factory CinemaShowtimeGroup.fromJson(Map<String, dynamic> json) => CinemaShowtimeGroup(
        cinema: CinemaRef.fromJson(json['cinema'] as Map<String, dynamic>),
        showtimes: (json['showtimes'] as List)
            .map((e) => ShowtimeItem.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
      );
}

class MovieShowtimes {
  const MovieShowtimes({
    required this.movieId,
    required this.date,
    required this.groups,
  });

  final String movieId;
  final String date;
  final List<CinemaShowtimeGroup> groups;

  factory MovieShowtimes.fromJson(Map<String, dynamic> json) => MovieShowtimes(
        movieId: json['movie_id'] as String,
        date: json['date'] as String,
        groups: (json['groups'] as List)
            .map((e) => CinemaShowtimeGroup.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
      );
}
