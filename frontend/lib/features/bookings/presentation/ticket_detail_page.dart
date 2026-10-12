import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/providers/api_providers.dart';
import '../../../core/providers/booking_providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/utils/status_labels.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/booking.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/app_feedback.dart';
import '../../../shared/widgets/info_row.dart';
import '../../../shared/widgets/poster_image.dart';
import '../widgets/eticket_card.dart';

class TicketDetailPage extends ConsumerWidget {
  const TicketDetailPage({super.key, required this.bookingId});

  final String bookingId;

  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    final confirmed = await confirmAction(
      context,
      title: 'Batalkan pesanan?',
      message: 'Kursi akan dilepas dan pesanan tidak dapat dipulihkan.',
      confirmLabel: 'Batalkan Pesanan',
      destructive: true,
    );
    if (!confirmed) return;

    try {
      await ref.read(bookingsApiProvider).cancel(bookingId);
      ref
        ..invalidate(bookingDetailProvider(bookingId))
        ..invalidate(myBookingsProvider);
      if (context.mounted) showSnack(context, 'Pesanan dibatalkan.');
    } on ApiException catch (e) {
      if (context.mounted) showSnack(context, e.message, isError: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final booking = ref.watch(bookingDetailProvider(bookingId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Detail Pesanan'),
        actions: [
          IconButton(
            tooltip: 'Muat ulang',
            onPressed: () => ref.invalidate(bookingDetailProvider(bookingId)),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: switch (booking) {
        AsyncData(:final value) => _TicketBody(
            booking: value,
            onCancel: () => _cancel(context, ref),
          ),
        AsyncError(:final error) => ErrorView(
            message: error is ApiException ? error.message : 'Pesanan tidak ditemukan.',
            onRetry: () => ref.invalidate(bookingDetailProvider(bookingId)),
          ),
        _ => const LoadingView(message: 'Memuat pesanan...'),
      },
    );
  }
}

class _TicketBody extends StatelessWidget {
  const _TicketBody({required this.booking, required this.onCancel});

  final Booking booking;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Kode: ${booking.bookingCode}',
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
                    ),
                  ),
                  StatusChip(status: booking.status),
                ],
              ),
              const SizedBox(height: 14),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  PosterImage(
                    url: booking.movie.posterUrl,
                    title: booking.movie.title,
                    width: 64,
                    height: 94,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          booking.movie.title,
                          style: text.titleSmall?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${booking.cinema.name} · ${booking.studio}',
                          style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                        ),
                        Text(
                          '${Formatters.dateShort(booking.showtime.startsAt)} · '
                          '${Formatters.clock(booking.showtime.startsAt)} · ${booking.showtime.format}',
                          style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                        ),
                        const SizedBox(height: 6),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: [
                            for (final seat in booking.seats)
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: scheme.surfaceContainerHighest,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  seat.label,
                                  style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(
            children: [
              InfoRow(label: 'Subtotal tiket', value: Formatters.rupiah(booking.totals.ticket)),
              InfoRow(label: 'F&B', value: Formatters.rupiah(booking.totals.fnb)),
              const Divider(height: 18),
              InfoRow(
                label: 'Total bayar',
                value: Formatters.rupiah(booking.totals.grand),
                emphasize: true,
              ),
            ],
          ),
        ),
        if (booking.paymentDueAt != null && bookingIsPayable(booking.status)) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: scheme.tertiaryContainer,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                Icon(Icons.schedule, color: scheme.onTertiaryContainer),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Selesaikan pembayaran sebelum '
                    '${Formatters.clock(booking.paymentDueAt!)} '
                    '${Formatters.dateShort(booking.paymentDueAt!)}.',
                    style: TextStyle(color: scheme.onTertiaryContainer, fontSize: 13),
                  ),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 20),
        if (bookingIsPayable(booking.status)) ...[
          AppButton(
            label: 'Tambah F&B',
            icon: Icons.local_cafe_outlined,
            variant: AppButtonVariant.secondary,
            onPressed: () => context.push('/fnb/${booking.id}'),
          ),
          const SizedBox(height: 10),
          AppButton(
            label: 'Patungan / Split Bill',
            icon: Icons.groups_outlined,
            variant: AppButtonVariant.secondary,
            onPressed: () => context.push('/split/${booking.id}'),
          ),
          const SizedBox(height: 10),
          AppButton(
            label: 'Bayar Sekarang',
            icon: Icons.credit_card_outlined,
            onPressed: () => context.push('/pay/${booking.id}'),
          ),
          const SizedBox(height: 10),
          AppButton(
            label: 'Batalkan Pesanan',
            variant: AppButtonVariant.text,
            onPressed: onCancel,
          ),
        ] else if (booking.status == 'paid') ...[
          const SizedBox(height: 12),
          ETicketCard(bookingId: booking.id),
        ],
      ],
    );
  }
}
