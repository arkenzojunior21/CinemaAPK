/// Kanal pembayaran yang didukung gateway (FR-BY-01).
class PaymentChannel {
  const PaymentChannel._(this.value, this.label, this.description);

  final String value;
  final String label;
  final String description;

  static const qris = PaymentChannel._('qris', 'QRIS', 'Scan QR dari aplikasi bank / e-wallet mana pun.');
  static const virtualAccount = PaymentChannel._(
    'virtual_account',
    'Virtual Account',
    'Transfer ke nomor VA hingga batas waktu pembayaran.',
  );
  static const ewallet = PaymentChannel._(
    'ewallet',
    'E-Wallet',
    'Bayar lewat tautan e-wallet (GoPay dan lainnya).',
  );

  static const all = <PaymentChannel>[qris, virtualAccount, ewallet];
}

/// Intent pembayaran yang dikembalikan POST /bookings/{id}/payments.
class PaymentCharge {
  const PaymentCharge({
    required this.id,
    required this.channel,
    required this.amount,
    required this.status,
    required this.gateway,
    required this.simulated,
    this.qrisPayload,
    this.payUrl,
    this.vaNumber,
    this.vaBank,
    this.transactionId,
  });

  final String id;
  final String channel;
  final int amount;
  final String status;
  final String gateway;
  final bool simulated;
  final String? qrisPayload;
  final String? payUrl;
  final String? vaNumber;
  final String? vaBank;
  final String? transactionId;

  bool get isSettled => status == 'settled';

  factory PaymentCharge.fromJson(Map<String, dynamic> json) => PaymentCharge(
        id: json['id'] as String,
        channel: json['channel'] as String,
        amount: json['amount'] as int,
        status: json['status'] as String,
        gateway: json['gateway'] as String,
        simulated: json['simulated'] as bool? ?? false,
        qrisPayload: json['qris_payload'] as String?,
        payUrl: json['pay_url'] as String?,
        vaNumber: json['va_number'] as String?,
        vaBank: json['va_bank'] as String?,
        transactionId: json['transaction_id'] as String?,
      );
}

/// Status hasil polling (NFR: pembaruan status bayar < 1,5 detik).
class PaymentStatus {
  const PaymentStatus({
    required this.id,
    required this.status,
    required this.amount,
    required this.gateway,
    required this.bookingStatus,
    this.participantStatus,
    required this.hasTicket,
  });

  final String id;
  final String status;
  final int amount;
  final String gateway;
  final String bookingStatus;
  final String? participantStatus;
  final bool hasTicket;

  bool get isSettled => status == 'settled';
  bool get isTerminal => status == 'settled' || status == 'failed' || status == 'expired';

  factory PaymentStatus.fromJson(Map<String, dynamic> json) => PaymentStatus(
        id: json['id'] as String,
        status: json['status'] as String,
        amount: json['amount'] as int,
        gateway: json['gateway'] as String,
        bookingStatus: json['booking_status'] as String,
        participantStatus: json['participant_status'] as String?,
        hasTicket: json['has_ticket'] as bool? ?? false,
      );
}

/// Hasil settle (webhook gateway atau simulasi dev).
class SettlementResult {
  const SettlementResult({
    required this.paymentId,
    required this.paymentStatus,
    required this.effect,
    required this.message,
    this.bookingStatus,
  });

  final String paymentId;
  final String paymentStatus;
  final String effect;
  final String message;
  final String? bookingStatus;

  factory SettlementResult.fromJson(Map<String, dynamic> json) => SettlementResult(
        paymentId: json['payment_id'] as String,
        paymentStatus: json['payment_status'] as String,
        effect: json['effect'] as String,
        message: json['message'] as String,
        bookingStatus: json['booking_status'] as String?,
      );
}

class TicketFace {
  const TicketFace({required this.code, required this.qrPayload, this.issuedAt});

  final String code;
  final String qrPayload;
  final DateTime? issuedAt;

  factory TicketFace.fromJson(Map<String, dynamic> json) => TicketFace(
        code: json['code'] as String,
        qrPayload: json['qr_payload'] as String,
        issuedAt: json['issued_at'] == null ? null : DateTime.parse(json['issued_at'] as String).toLocal(),
      );
}

class FnbPickup {
  const FnbPickup({
    required this.id,
    required this.pickupCode,
    required this.status,
    required this.totalAmount,
    this.qrPayload,
  });

  final String id;
  final String pickupCode;
  final String status;
  final int totalAmount;
  final String? qrPayload;

  factory FnbPickup.fromJson(Map<String, dynamic> json) => FnbPickup(
        id: json['id'] as String,
        pickupCode: json['pickup_code'] as String,
        status: json['status'] as String,
        totalAmount: json['total_amount'] as int,
        qrPayload: json['qr_payload'] as String?,
      );
}

/// E-ticket + QR F&B yang terbit setelah lunas.
class ETicket {
  const ETicket({
    required this.bookingCode,
    required this.movieTitle,
    required this.cinemaName,
    required this.startsAt,
    required this.ticket,
    required this.fnbOrders,
  });

  final String bookingCode;
  final String movieTitle;
  final String cinemaName;
  final DateTime startsAt;
  final TicketFace ticket;
  final List<FnbPickup> fnbOrders;

  factory ETicket.fromJson(Map<String, dynamic> json) => ETicket(
        bookingCode: json['booking_code'] as String,
        movieTitle: json['movie_title'] as String,
        cinemaName: json['cinema_name'] as String,
        startsAt: DateTime.parse(json['starts_at'] as String).toLocal(),
        ticket: TicketFace.fromJson(json['ticket'] as Map<String, dynamic>),
        fnbOrders: (json['fnb_orders'] as List? ?? const [])
            .map((e) => FnbPickup.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
      );
}
