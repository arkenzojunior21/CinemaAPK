enum SeatStatus { available, locked, mine, sold }

enum SeatType { regular, premium, couple }

extension SeatTypeX on SeatType {
  String get label => switch (this) {
        SeatType.regular => 'Reguler',
        SeatType.premium => 'Premium',
        SeatType.couple => 'Couple',
      };
}

class SeatInfo {
  const SeatInfo({
    required this.id,
    required this.row,
    required this.number,
    required this.type,
    required this.price,
    required this.status,
  });

  final String id;
  final String row;
  final int number;
  final SeatType type;
  final int price;
  final SeatStatus status;

  factory SeatInfo.fromJson(Map<String, dynamic> json) => SeatInfo(
        id: json['id'] as String,
        row: json['row'] as String,
        number: json['number'] as int,
        type: SeatType.values.firstWhere(
          (t) => t.name == json['type'],
          orElse: () => SeatType.regular,
        ),
        price: json['price'] as int,
        status: SeatStatus.values.firstWhere(
          (s) => s.name == json['status'],
          orElse: () => SeatStatus.available,
        ),
      );

  String get label => '$row$number';
}

class SeatMap {
  const SeatMap({
    required this.showtime,
    required this.movie,
    required this.studio,
    required this.cinema,
    required this.seats,
  });

  final SeatMapShowtime showtime;
  final SeatMapMovie movie;
  final SeatMapStudio studio;
  final CinemaRefInfo cinema;
  final List<SeatInfo> seats;

  factory SeatMap.fromJson(Map<String, dynamic> json) => SeatMap(
        showtime: SeatMapShowtime.fromJson(json['showtime'] as Map<String, dynamic>),
        movie: SeatMapMovie.fromJson(json['movie'] as Map<String, dynamic>),
        studio: SeatMapStudio.fromJson(json['studio'] as Map<String, dynamic>),
        cinema: CinemaRefInfo.fromJson(json['cinema'] as Map<String, dynamic>),
        seats: (json['seats'] as List)
            .map((e) => SeatInfo.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
      );
}

class SeatMapShowtime {
  const SeatMapShowtime({
    required this.id,
    required this.startsAt,
    required this.format,
    this.language,
    this.subtitle,
    required this.basePrice,
  });

  final String id;
  final DateTime startsAt;
  final String format;
  final String? language;
  final String? subtitle;
  final int basePrice;

  factory SeatMapShowtime.fromJson(Map<String, dynamic> json) => SeatMapShowtime(
        id: json['id'] as String,
        startsAt: DateTime.parse(json['starts_at'] as String).toLocal(),
        format: json['format'] as String,
        language: json['language'] as String?,
        subtitle: json['subtitle'] as String?,
        basePrice: json['base_price'] as int,
      );
}

class SeatMapMovie {
  const SeatMapMovie({
    required this.id,
    required this.title,
    required this.ageRating,
    required this.durationMinutes,
    this.posterUrl,
  });

  final String id;
  final String title;
  final String ageRating;
  final int durationMinutes;
  final String? posterUrl;

  factory SeatMapMovie.fromJson(Map<String, dynamic> json) => SeatMapMovie(
        id: json['id'] as String,
        title: json['title'] as String,
        ageRating: json['age_rating'] as String,
        durationMinutes: json['duration_minutes'] as int,
        posterUrl: json['poster_url'] as String?,
      );
}

class SeatMapStudio {
  const SeatMapStudio({
    required this.id,
    required this.name,
    required this.seatRows,
    required this.seatCols,
    required this.screenTypes,
  });

  final String id;
  final String name;
  final int seatRows;
  final int seatCols;
  final List<String> screenTypes;

  factory SeatMapStudio.fromJson(Map<String, dynamic> json) => SeatMapStudio(
        id: json['id'] as String,
        name: json['name'] as String,
        seatRows: json['seat_rows'] as int,
        seatCols: json['seat_cols'] as int,
        screenTypes: (json['screen_types'] as List).cast<String>(),
      );
}

class CinemaRefInfo {
  const CinemaRefInfo({required this.id, required this.chain, required this.name, required this.city});

  final String id;
  final String chain;
  final String name;
  final String city;

  factory CinemaRefInfo.fromJson(Map<String, dynamic> json) => CinemaRefInfo(
        id: json['id'] as String,
        chain: json['chain'] as String,
        name: json['name'] as String,
        city: json['city'] as String,
      );
}

class SeatLock {
  const SeatLock({
    required this.reservationId,
    required this.seatId,
    required this.row,
    required this.number,
    required this.type,
    required this.price,
  });

  final String reservationId;
  final String seatId;
  final String row;
  final int number;
  final String type;
  final int price;

  factory SeatLock.fromJson(Map<String, dynamic> json) => SeatLock(
        reservationId: json['reservation_id'] as String,
        seatId: json['seat_id'] as String,
        row: json['row'] as String,
        number: json['number'] as int,
        type: json['type'] as String,
        price: json['price'] as int,
      );

  String get label => '$row$number';
}

class SeatLockResult {
  const SeatLockResult({required this.locks, required this.totalPrice, required this.expiresAt});

  final List<SeatLock> locks;
  final int totalPrice;
  final DateTime expiresAt;

  factory SeatLockResult.fromJson(Map<String, dynamic> json) => SeatLockResult(
        locks: (json['locks'] as List)
            .map((e) => SeatLock.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
        totalPrice: json['total_price'] as int,
        expiresAt: DateTime.parse(json['expires_at'] as String).toLocal(),
      );
}
