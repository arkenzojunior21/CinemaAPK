import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/payment.dart';
import '../utils/api_message.dart';
import 'api_providers.dart';
import 'booking_providers.dart';
import 'eticket_providers.dart';
import 'split_providers.dart';

const _pollInterval = Duration(milliseconds: 1500);
const _maxPolls = 80; // ~2 menit, supaya timer tidak hidup selamanya.

class PaymentState {
  const PaymentState({
    this.charge,
    this.status,
    this.busy = false,
    this.polling = false,
    this.error,
    this.notice,
  });

  final PaymentCharge? charge;
  final PaymentStatus? status;
  final bool busy;
  final bool polling;
  final String? error;
  final String? notice;

  bool get settled => status?.isSettled ?? false;
  bool get isSimulated => charge?.simulated ?? false;
  bool get failed => status?.status == 'failed' || status?.status == 'expired';
  int get amount => status?.amount ?? charge?.amount ?? 0;

  PaymentState copyWith({
    PaymentCharge? charge,
    PaymentStatus? status,
    bool? busy,
    bool? polling,
    String? error,
    String? notice,
    bool clearError = false,
  }) {
    return PaymentState(
      charge: charge ?? this.charge,
      status: status ?? this.status,
      busy: busy ?? this.busy,
      polling: polling ?? this.polling,
      error: clearError ? null : (error ?? this.error),
      notice: notice ?? this.notice,
    );
  }
}

class PaymentController extends AutoDisposeNotifier<PaymentState> {
  Timer? _timer;
  int _attempts = 0;
  String? _bookingId;
  String? _splitId;

  @override
  PaymentState build() {
    ref.onDispose(() => _timer?.cancel());
    return const PaymentState();
  }

  Future<void> start({
    required String bookingId,
    required PaymentChannel channel,
    String? participantId,
    String? splitId,
  }) async {
    _bookingId = bookingId;
    _splitId = splitId;
    _attempts = 0;
    _timer?.cancel();
    state = PaymentState(busy: true, notice: 'Menyiapkan pembayaran ${channel.label}...');

    try {
      final charge = await ref.read(paymentsApiProvider).charge(
            bookingId,
            channel: channel.value,
            participantId: participantId,
          );
      state = PaymentState(charge: charge, busy: false, polling: true, notice: _waitingHint(channel));
      _startPolling();
    } on Object catch (error) {
      state = PaymentState(busy: false, error: describeApiError(error));
    }
  }

  String _waitingHint(PaymentChannel channel) {
    if (channel.value == PaymentChannel.qris.value) return 'Scan QR lalu tunggu konfirmasi.';
    if (channel.value == PaymentChannel.virtualAccount.value) return 'Transfer ke VA lalu tunggu konfirmasi.';
    return 'Selesaikan pembayaran di tautan lalu tunggu konfirmasi.';
  }

  void _startPolling() {
    _timer?.cancel();
    _timer = Timer.periodic(_pollInterval, (_) => _poll());
  }

  Future<void> _poll() async {
    final paymentId = state.charge?.id;
    if (paymentId == null || _attempts >= _maxPolls) {
      _timer?.cancel();
      state = state.copyWith(polling: false, notice: 'Status berhenti dipantau, tarik untuk memperbarui.');
      return;
    }
    _attempts++;
    await _refresh(paymentId);
  }

  Future<void> refresh() async {
    final paymentId = state.charge?.id;
    if (paymentId != null) await _refresh(paymentId);
  }

  Future<void> _refresh(String paymentId) async {
    try {
      final status = await ref.read(paymentsApiProvider).status(paymentId);
      state = state.copyWith(status: status, polling: !status.isTerminal);
      if (status.isTerminal) {
        _timer?.cancel();
        if (status.isSettled) _onSettled();
      }
    } on Object catch (error) {
      _timer?.cancel();
      state = state.copyWith(polling: false, error: describeApiError(error));
    }
  }

  /// Jalur dev/test ketika gateway belum dikonfigurasi (server menolak di production).
  Future<void> markPaidAsSimulated() async {
    final paymentId = state.charge?.id;
    if (paymentId == null) return;
    state = state.copyWith(busy: true, clearError: true);
    try {
      final result = await ref.read(paymentsApiProvider).simulate(paymentId);
      state = state.copyWith(busy: false, notice: result.message);
      await _refresh(paymentId);
    } on Object catch (error) {
      state = state.copyWith(busy: false, error: describeApiError(error));
    }
  }

  void _onSettled() {
    final bookingId = _bookingId;
    if (bookingId == null) return;
    ref
      ..invalidate(bookingDetailProvider(bookingId))
      ..invalidate(eticketProvider(bookingId));
    final splitId = _splitId;
    if (splitId != null) ref.invalidate(splitBillProvider(splitId));
  }
}

final paymentControllerProvider =
    AutoDisposeNotifierProvider<PaymentController, PaymentState>(PaymentController.new);
