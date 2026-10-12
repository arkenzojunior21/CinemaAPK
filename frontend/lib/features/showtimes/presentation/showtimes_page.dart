import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/providers/catalog_providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/showtime.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/app_feedback.dart';

class ShowtimesPage extends ConsumerStatefulWidget {
  const ShowtimesPage({super.key, required this.movieId, this.movieTitle});

  final String movieId;
  final String? movieTitle;

  @override
  ConsumerState<ShowtimesPage> createState() => _ShowtimesPageState();
}

class _ShowtimesPageState extends ConsumerState<ShowtimesPage> {
  /// 0 = hari ini, 1..6 = hari berikutnya.
  int _dayOffset = 0;

  String get _date {
    final day = DateTime.now().add(Duration(days: _dayOffset));
    return '${day.year.toString().padLeft(4, '0')}-'
        '${day.month.toString().padLeft(2, '0')}-'
        '${day.day.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final city = ref.watch(browseProvider).city;
    final key = (movieId: widget.movieId, date: _date, city: city);
    final showtimes = ref.watch(movieShowtimesProvider(key));
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.movieTitle ?? 'Jadwal Tayang'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(64),
          child: SizedBox(
            height: 52,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              itemCount: 7,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final day = DateTime.now().add(Duration(days: index));
                return ChoiceChip(
                  label: Text(Formatters.dateShort(day)),
                  selected: _dayOffset == index,
                  onSelected: (_) => setState(() => _dayOffset = index),
                );
              },
            ),
          ),
        ),
      ),
      body: switch (showtimes) {
        AsyncData(:final value) => _ShowtimeGroups(
            groups: value.groups,
            emptyMessage: city.isEmpty
                ? 'Belum ada jadwal untuk tanggal ini.'
                : 'Belum ada jadwal di $city untuk tanggal ini.',
          ),
        AsyncError(:final error) => ErrorView(
            message: error is ApiException ? error.message : 'Gagal memuat jadwal.',
            onRetry: () => ref.invalidate(movieShowtimesProvider(key)),
          ),
        _ => const LoadingView(message: 'Mengumpulkan jadwal dari beberapa bioskop...'),
      },
      bottomNavigationBar: city.isEmpty
          ? null
          : Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              color: scheme.surfaceContainerHighest,
              child: Row(
                children: [
                  Icon(Icons.filter_alt_outlined, size: 18, color: scheme.onSurfaceVariant),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Difilter kota: $city',
                      style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
                    ),
                  ),
                  TextButton(
                    onPressed: () => ref.read(browseProvider.notifier).setCity(''),
                    child: const Text('Hapus filter'),
                  ),
                ],
              ),
            ),
    );
  }
}

class _ShowtimeGroups extends StatelessWidget {
  const _ShowtimeGroups({required this.groups, required this.emptyMessage});

  final List<CinemaShowtimeGroup> groups;
  final String emptyMessage;

  @override
  Widget build(BuildContext context) {
    if (groups.isEmpty) return EmptyView(message: emptyMessage, icon: Icons.event_busy_outlined);
    final scheme = Theme.of(context).colorScheme;

    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      itemCount: groups.length,
      itemBuilder: (context, index) {
        final group = groups[index];
        return Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        group.cinema.name,
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                      ),
                    ),
                    Text(
                      group.cinema.chain,
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
                Text(
                  group.cinema.city,
                  style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final showtime in group.showtimes)
                      _ShowtimeButton(
                        showtime: showtime,
                        onTap: () => context.push('/showtimes/${showtime.id}/seats'),
                      ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _ShowtimeButton extends StatelessWidget {  const _ShowtimeButton({required this.showtime, required this.onTap});

  final ShowtimeItem showtime;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: scheme.outlineVariant),
          color: scheme.surfaceContainerLow,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              Formatters.clock(showtime.startsAt),
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
            Text(
              '${showtime.studio} · ${showtime.format}',
              style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
            ),
            Text(
              Formatters.rupiah(showtime.basePrice),
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: scheme.primary),
            ),
          ],
        ),
      ),
    );
  }
}

