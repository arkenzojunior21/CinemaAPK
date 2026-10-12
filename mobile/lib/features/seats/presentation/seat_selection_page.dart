import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/providers/api_providers.dart';
import '../../../core/providers/auth_controller.dart';
import '../../../core/providers/booking_providers.dart';
import '../../../core/providers/fnb_providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/seat_map.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_feedback.dart';
import 'widgets/seat_tile.dart';

class SeatSelectionPage extends ConsumerStatefulWidget {
  const SeatSelectionPage({super.key, required this.showtimeId});

  final String showtimeId;

  @override
  ConsumerState<SeatSelectionPage> createState() => _SeatSelectionPageState();
}

class _SeatSelectionPageState extends ConsumerState<SeatSelectionPage> {
  final Map<String, SeatLock> _locks = {};
  Timer? _ticker;
  DateTime? _expiresAt;
  int _secondsLeft = 0;
  bool _busy = false;
  bool _confirming = false;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  void _tick() {
    final expiresAt = _expiresAt;
    if (expiresAt == null) return;
    final left = expiresAt.difference(DateTime.now()).inSeconds;
    if (left > 0) {
      setState(() => _secondsLeft = left);
      return;
    }
    _locks.clear();
    _expiresAt = null;
    setState(() => _secondsLeft = 0);
    ref.invalidate(seatMapProvider(widget.showtimeId));
    if (mounted) showSnack(context, 'Waktu kunci kursi habis. Silakan pilih ulang.', isError: true);
  }

  int get _total => _locks.values.fold(0, (sum, lock) => sum + lock.price);

  Future<void> _applySelection(List<String> seatIds) async {
    if (seatIds.isEmpty) {
      try {
        await ref.read(showtimesApiProvider).releaseLocks(widget.showtimeId);
      } on ApiException catch (e) {
        if (mounted) showSnack(context, e.message, isError: true);
      }
      setState(() {
        _locks.clear();
        _expiresAt = null;
        _secondsLeft = 0;
      });
      return;
    }

    setState(() => _busy = true);
    try {
      final result = await ref.read(showtimesApiProvider).acquireLocks(widget.showtimeId, seatIds);
      _locks
        ..clear()
        ..addEntries(result.locks.map((lock) => MapEntry(lock.seatId, lock)));
      _expiresAt = result.expiresAt;
      setState(() => _secondsLeft = result.expiresAt.difference(DateTime.now()).inSeconds);
      ref.invalidate(seatMapProvider(widget.showtimeId));
    } on ApiException catch (e) {
      _locks.clear();
      _expiresAt = null;
      ref.invalidate(seatMapProvider(widget.showtimeId));
      if (mounted) showSnack(context, e.message, isError: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toggle(SeatInfo seat) {
    if (_busy || _confirming) return;

    if (!ref.read(authControllerProvider).isLoggedIn) {
      showSnack(context, 'Masuk dulu untuk mengunci kursi.');
      context.push('/login');
      return;
    }

    if (_locks.containsKey(seat.id)) {
      _applySelection(
        _locks.values.where((lock) => lock.seatId != seat.id).map((lock) => lock.seatId).toList(),
      );
      return;
    }

    if (seat.status != SeatStatus.available) {
      showSnack(context, 'Kursi ${seat.label} sedang tidak tersedia.', isError: true);
      return;
    }

    if (_locks.length >= ApiConstants.maxSeatsPerBooking) {
      showSnack(
        context,
        'Maksimal ${ApiConstants.maxSeatsPerBooking} kursi per pemesanan.',
        isError: true,
      );
      return;
    }

    _applySelection([..._locks.keys, seat.id]);
  }

  Future<void> _confirm() async {
    setState(() => _confirming = true);
    try {
      final created = await ref.read(bookingsApiProvider).create(
            showtimeId: widget.showtimeId,
            seatReservationIds: _locks.values.map((lock) => lock.reservationId).toList(),
          );
      ref
        ..invalidate(myBookingsProvider)
        ..read(cartProvider.notifier).clear();
      if (!mounted) return;
      context.go('/fnb/${created.id}');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, isError: true);
    } finally {
      if (mounted) setState(() => _confirming = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final seatMap = ref.watch(seatMapProvider(widget.showtimeId));

    return Scaffold(
      appBar: AppBar(title: const Text('Pilih Kursi')),
      body: switch (seatMap) {
        AsyncData(:final value) => _SeatBody(
            map: value,
            selectedIds: _locks.keys,
            busy: _busy,
            onToggle: _toggle,
          ),
        AsyncError(:final error) => ErrorView(
            message: error is ApiException ? error.message : 'Peta kursi gagal dimuat.',
            onRetry: () => ref.invalidate(seatMapProvider(widget.showtimeId)),
          ),
        _ => const LoadingView(message: 'Memuat peta kursi...'),
      },
      bottomNavigationBar: seatMap.hasValue
          ? _CheckoutBar(
              total: _total,
              count: _locks.length,
              secondsLeft: _secondsLeft,
              busy: _busy || _confirming,
              onConfirm: _confirm,
            )
          : null,
    );
  }
}

class _SeatBody extends StatelessWidget {
  const _SeatBody({
    required this.map,
    required this.selectedIds,
    required this.busy,
    required this.onToggle,
  });

  final SeatMap map;
  final Iterable<String> selectedIds;
  final bool busy;
  final void Function(SeatInfo seat) onToggle;

  List<List<SeatInfo>> _rowGroups() {
    final byRow = <String, List<SeatInfo>>{};
    for (final seat in map.seats) {
      (byRow[seat.row] ??= <SeatInfo>[]).add(seat);
    }
    final rows = byRow.keys.toList()..sort();
    return [
      for (final row in rows)
        (byRow[row]!..sort((a, b) => a.number.compareTo(b.number))),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        Text(
          map.movie.title,
          style: text.titleMedium?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        Text(
          '${map.cinema.name} · ${map.studio.name} · ${Formatters.clock(map.showtime.startsAt)}',
          style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 14),
        const SeatLegend(),
        const SizedBox(height: 16),
        Container(
          height: 8,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(4),
            gradient: LinearGradient(
              colors: [scheme.primary.withValues(alpha: 0.15), scheme.primary, scheme.primary.withValues(alpha: 0.15)],
            ),
          ),
        ),
        const SizedBox(height: 6),
        Center(
          child: Text(
            'LAYAR ${map.studio.screenTypes.join(' / ')}',
            style: text.labelSmall?.copyWith(letterSpacing: 2, color: scheme.onSurfaceVariant),
          ),
        ),
        const SizedBox(height: 18),
        InteractiveViewer(
          maxScale: 2.6,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              for (final row in _rowGroups())
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SizedBox(
                      width: 22,
                      child: Text(
                        row.first.row,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                    for (final seat in row)
                      Opacity(
                        opacity: busy && !selectedIds.contains(seat.id) ? 0.6 : 1,
                        child: SeatTile(
                          seat: seat,
                          selected: selectedIds.contains(seat.id),
                          onTap: selectedIds.contains(seat.id) || seat.status == SeatStatus.available || seat.status == SeatStatus.mine
                              ? () => onToggle(seat)
                              : null,
                        ),
                      ),
                  ],
                ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Text(
          'Harga tiket ${map.studio.name}: mulai ${Formatters.rupiah(map.showtime.basePrice)}',
          textAlign: TextAlign.center,
          style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

class _CheckoutBar extends StatelessWidget {
  const _CheckoutBar({
    required this.total,
    required this.count,
    required this.secondsLeft,
    required this.busy,
    required this.onConfirm,
  });

  final int total;
  final int count;
  final int secondsLeft;
  final bool busy;
  final VoidCallback onConfirm;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      decoration: BoxDecoration(
        color: scheme.surfaceContainer,
        border: Border(top: BorderSide(color: scheme.outlineVariant)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  count == 0 ? 'Belum ada kursi dipilih' : '$count kursi dipilih',
                  style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
                ),
              ),
              if (count > 0 && secondsLeft > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: scheme.errorContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    _clock(secondsLeft),
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: scheme.onErrorContainer,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Text(
                  Formatters.rupiah(total),
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                ),
              ),
              SizedBox(
                width: 190,
                child: AppButton(
                  label: count == 0 ? 'Pilih kursi dulu' : 'Lanjut',
                  icon: Icons.arrow_forward,
                  loading: busy,
                  onPressed: count == 0 ? null : onConfirm,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  static String _clock(int seconds) {
    final m = (seconds ~/ 60).toString().padLeft(2, '0');
    final s = (seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }
}
