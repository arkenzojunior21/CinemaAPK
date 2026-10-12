import 'showtime.dart';

class BookingSeat {
  const BookingSeat({required this.row, required this.number, required this.type});

  final String row;
  final int number;
  final String type;

  factory BookingSeat.fromJson(Map<String, dynamic> json) => BookingSeat(
        row: json['row'] as String,
        number: json['number'] as int,
        type: json['type'] as String,
      );

  String get label => '$row$number';
}

class Booking {
  const Booking({
    required this.id,
    required this.bookingCode,
    required this.status,
    required this.totals,
    this.paymentDueAt,
    this.paidAt,
    required this.createdAt,
    required this.showtime,
    required this.movie,
    required this.cinema,
    required this.studio,
    required this.seats,
  });

  final String id;
  final String bookingCode;
  final String status;
  final BookingTotals totals;
  final DateTime? paymentDueAt;
  final DateTime? paidAt;
  final DateTime createdAt;
  final BookingShowtime showtime;
  final BookingMovie movie;
  final BookingCinema cinema;
  final String studio;
  final List<BookingSeat> seats;

  factory Booking.fromJson(Map<String, dynamic> json) => Booking(
        id: json['id'] as String,
        bookingCode: json['booking_code'] as String,
        status: json['status'] as String,
        totals: BookingTotals.fromJson(json['totals'] as Map<String, dynamic>),
        paymentDueAt: json['payment_due_at'] == null
            ? null
            : DateTime.parse(json['payment_due_at'] as String).toLocal(),
        paidAt: json['paid_at'] == null ? null : DateTime.parse(json['paid_at'] as String).toLocal(),
        createdAt: DateTime.parse(json['created_at'] as String).toLocal(),
        showtime: BookingShowtime.fromJson(json['showtime'] as Map<String, dynamic>),
        movie: BookingMovie.fromJson(json['movie'] as Map<String, dynamic>),
        cinema: BookingCinema.fromJson(json['cinema'] as Map<String, dynamic>),
        studio: json['studio'] as String,
        seats: (json['seats'] as List)
            .map((e) => BookingSeat.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
      );

  String get seatsLabel => seats.map((s) => s.label).join(', ');
}

class BookingTotals {
  const BookingTotals({required this.ticket, required this.fnb, required this.grand});

  final int ticket;
  final int fnb;
  final int grand;

  factory BookingTotals.fromJson(Map<String, dynamic> json) => BookingTotals(
        ticket: json['ticket'] as int,
        fnb: json['fnb'] as int,
        grand: json['grand'] as int,
      );
}

class BookingShowtime {
  const BookingShowtime({required this.id, required this.startsAt, required this.format});

  final String id;
  final DateTime startsAt;
  final String format;

  factory BookingShowtime.fromJson(Map<String, dynamic> json) => BookingShowtime(
        id: json['id'] as String,
        startsAt: DateTime.parse(json['starts_at'] as String).toLocal(),
        format: json['format'] as String,
      );
}

class BookingMovie {
  const BookingMovie({
    required this.id,
    required this.title,
    this.posterUrl,
    required this.ageRating,
    required this.durationMinutes,
  });

  final String id;
  final String title;
  final String? posterUrl;
  final String ageRating;
  final int durationMinutes;

  factory BookingMovie.fromJson(Map<String, dynamic> json) => BookingMovie(
        id: json['id'] as String,
        title: json['title'] as String,
        posterUrl: json['poster_url'] as String?,
        ageRating: json['age_rating'] as String,
        durationMinutes: json['duration_minutes'] as int,
      );
}

class BookingCinema {
  const BookingCinema({
    required this.id,
    required this.name,
    required this.chain,
    required this.city,
  });

  final String id;
  final String name;
  final String chain;
  final String city;

  factory BookingCinema.fromJson(Map<String, dynamic> json) => BookingCinema(
        id: json['id'] as String,
        name: json['name'] as String,
        chain: json['chain'] as String,
        city: json['city'] as String,
      );
}

class BookingsPage {
  const BookingsPage({required this.items, required this.totalItems});

  final List<Booking> items;
  final int totalItems;

  factory BookingsPage.fromJson(Map<String, dynamic> json) => BookingsPage(
        items: (json['items'] as List)
            .map((e) => Booking.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
        totalItems: (json['meta'] as Map<String, dynamic>)['total_items'] as int,
      );
}

// Hasil langsung POST /bookings (belum berisi detail movie/cinema).
class BookingCreated {
  const BookingCreated({
    required this.id,
    required this.bookingCode,
    required this.status,
    required this.showtimeId,
    required this.ticketTotal,
    required this.fnbTotal,
    required this.grandTotal,
    this.paymentDueAt,
  });

  final String id;
  final String bookingCode;
  final String status;
  final String showtimeId;
  final int ticketTotal;
  final int fnbTotal;
  final int grandTotal;
  final DateTime? paymentDueAt;

  factory BookingCreated.fromJson(Map<String, dynamic> json) => BookingCreated(
        id: json['id'] as String,
        bookingCode: json['booking_code'] as String,
        status: json['status'] as String,
        showtimeId: json['showtime_id'] as String,
        ticketTotal: json['ticket_total'] as int,
        fnbTotal: json['fnb_total'] as int,
        grandTotal: json['grand_total'] as int,
        paymentDueAt: json['payment_due_at'] == null
            ? null
            : DateTime.parse(json['payment_due_at'] as String).toLocal(),
      );
}

// Dipakai CinemaRef di model showtime.dart untuk halaman detail.
typedef CinemaBrief = CinemaRef;
