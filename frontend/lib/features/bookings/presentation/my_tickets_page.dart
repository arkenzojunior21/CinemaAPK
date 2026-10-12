import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/providers/booking_providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/utils/status_labels.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/booking.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/app_feedback.dart';
import '../../../shared/widgets/poster_image.dart';

class MyTicketsPage extends ConsumerWidget {
  const MyTicketsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bookings = ref.watch(myBookingsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tiket Saya'),
        actions: [
          IconButton(
            tooltip: 'Muat ulang',
            onPressed: () => ref.invalidate(myBookingsProvider),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: switch (bookings) {
        AsyncData(:final value) => value.items.isEmpty
            ? EmptyView(
                message: 'Belum ada pesanan. Pilih film dan kursi untuk memulai.',
                icon: Icons.confirmation_number_outlined,
              )
            : ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
                itemCount: value.items.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final booking = value.items[index];
                  return _BookingCard(booking: booking);
                },
              ),
        AsyncError(:final error) => ErrorView(
            message: error is ApiException ? error.message : 'Daftar tiket gagal dimuat.',
            onRetry: () => ref.invalidate(myBookingsProvider),
          ),
        _ => const LoadingView(message: 'Memuat tiket Anda...'),
      },
    );
  }
}

class _BookingCard extends StatelessWidget {
  const _BookingCard({required this.booking});

  final Booking booking;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return AppCard(
      padding: const EdgeInsets.all(12),
      onTap: () => context.push('/ticket/${booking.id}'),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PosterImage(
            url: booking.movie.posterUrl,
            title: booking.movie.title,
            width: 54,
            height: 78,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        booking.movie.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.titleSmall?.copyWith(fontWeight: FontWeight.w800),
                      ),
                    ),
                    StatusChip(status: booking.status),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  booking.cinema.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                ),
                Text(
                  '${Formatters.dateShort(booking.showtime.startsAt)} · '
                  '${Formatters.clock(booking.showtime.startsAt)}',
                  style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${booking.seatsLabel} · ${booking.bookingCode}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
                      ),
                    ),
                    Text(
                      Formatters.rupiah(booking.totals.grand),
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: scheme.primary,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
