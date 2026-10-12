/// Model Split Bill (FR-SB-01..03) sesuai respons `/split-bills`.
class SplitParticipant {
  const SplitParticipant({
    required this.id,
    required this.name,
    required this.shareAmount,
    required this.status,
    required this.payUrl,
    required this.qrisPayload,
    this.userId,
    this.paidAt,
  });

  final String id;
  final String name;
  final int shareAmount;
  final String status;
  final String payUrl;
  final String qrisPayload;
  final String? userId;
  final DateTime? paidAt;

  bool get isPaid => status == 'paid';

  factory SplitParticipant.fromJson(Map<String, dynamic> json) => SplitParticipant(
        id: json['id'] as String,
        name: json['name'] as String,
        shareAmount: (json['share_amount'] as num).toInt(),
        status: json['status'] as String,
        payUrl: json['pay_url'] as String? ?? '',
        qrisPayload: json['qris_payload'] as String? ?? '',
        userId: json['user_id'] as String?,
        paidAt: json['paid_at'] == null ? null : DateTime.parse(json['paid_at'] as String).toLocal(),
      );
}

class SplitTracker {
  const SplitTracker({
    required this.total,
    required this.paid,
    required this.remaining,
    required this.paidCount,
    required this.pendingCount,
    required this.allPaid,
  });

  final int total;
  final int paid;
  final int remaining;
  final int paidCount;
  final int pendingCount;
  final bool allPaid;

  double get progress => total == 0 ? 0 : (paid / total).clamp(0, 1);

  factory SplitTracker.fromJson(Map<String, dynamic> json) => SplitTracker(
        total: (json['total'] as num).toInt(),
        paid: (json['paid'] as num).toInt(),
        remaining: (json['remaining'] as num).toInt(),
        paidCount: (json['paid_count'] as num).toInt(),
        pendingCount: (json['pending_count'] as num).toInt(),
        allPaid: json['all_paid'] as bool,
      );
}

class SplitBookingBrief {
  const SplitBookingBrief({
    required this.id,
    required this.bookingCode,
    required this.status,
    required this.movieTitle,
    required this.cinemaName,
    required this.studio,
    required this.startsAt,
  });

  final String id;
  final String bookingCode;
  final String status;
  final String movieTitle;
  final String cinemaName;
  final String studio;
  final DateTime startsAt;

  factory SplitBookingBrief.fromJson(Map<String, dynamic> json) => SplitBookingBrief(
        id: json['id'] as String,
        bookingCode: json['booking_code'] as String,
        status: json['status'] as String,
        movieTitle: json['movie_title'] as String,
        cinemaName: json['cinema_name'] as String,
        studio: json['studio'] as String,
        startsAt: DateTime.parse(json['starts_at'] as String).toLocal(),
      );
}

class SplitBill {
  const SplitBill({
    required this.id,
    required this.bookingId,
    required this.method,
    required this.status,
    required this.totalAmount,
    required this.shareCount,
    required this.shareToken,
    required this.shareUrl,
    required this.hostName,
    required this.booking,
    required this.tracker,
    required this.participants,
    this.expiresAt,
  });

  final String id;
  final String bookingId;
  final String method;
  final String status;
  final int totalAmount;
  final int shareCount;
  final String shareToken;
  final String shareUrl;
  final String hostName;
  final SplitBookingBrief booking;
  final SplitTracker tracker;
  final List<SplitParticipant> participants;
  final DateTime? expiresAt;

  bool get isCustom => method == 'custom';

  factory SplitBill.fromJson(Map<String, dynamic> json) => SplitBill(
        id: json['id'] as String,
        bookingId: json['booking_id'] as String,
        method: json['method'] as String,
        status: json['status'] as String,
        totalAmount: (json['total_amount'] as num).toInt(),
        shareCount: (json['share_count'] as num).toInt(),
        shareToken: json['share_token'] as String,
        shareUrl: json['share_url'] as String? ?? '',
        hostName: (json['host'] as Map<String, dynamic>)['name'] as String? ?? 'Host',
        booking: SplitBookingBrief.fromJson(json['booking'] as Map<String, dynamic>),
        tracker: SplitTracker.fromJson(json['tracker'] as Map<String, dynamic>),
        participants: (json['participants'] as List)
            .map((e) => SplitParticipant.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
        expiresAt: json['expires_at'] == null
            ? null
            : DateTime.parse(json['expires_at'] as String).toLocal(),
      );
}

/// Satu baris peserta pada form pembuatan patungan.
class SplitMemberDraft {
  SplitMemberDraft({required this.name, this.amount, this.userId});

  String name;
  int? amount;
  final String? userId;

  bool get isComplete => name.trim().isNotEmpty && (amount == null || amount! >= 0);

  Map<String, dynamic> toMap() => {
        'name': name.trim(),
        if (userId != null) 'user_id': userId,
        if (amount != null) 'amount': amount,
      };
}
