import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/providers/catalog_providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/movie.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/app_feedback.dart';
import '../../../shared/widgets/info_row.dart';
import '../../../shared/widgets/poster_image.dart';

class MovieDetailPage extends ConsumerWidget {
  const MovieDetailPage({super.key, required this.movieId});

  final String movieId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final movie = ref.watch(movieDetailProvider(movieId));

    return Scaffold(
      appBar: AppBar(),
      body: switch (movie) {
        AsyncData(:final value) => _MovieDetail(movie: value),
        AsyncError(:final error) => ErrorView(
            message: error is ApiException ? error.message : 'Film tidak ditemukan.',
            onRetry: () => ref.invalidate(movieDetailProvider(movieId)),
          ),
        _ => const LoadingView(message: 'Memuat detail film...'),
      },
    );
  }
}

class _MovieDetail extends StatelessWidget {
  const _MovieDetail({required this.movie});

  final Movie movie;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: PosterImage(
                    url: movie.posterUrl,
                    title: movie.title,
                    width: 190,
                    height: 280,
                    radius: 16,
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  movie.title,
                  style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    AgeBadge(label: movie.ageRating),
                    _Pill(label: Formatters.duration(movie.durationMinutes)),
                    if (movie.language != null) _Pill(label: movie.language!),
                    if (movie.ratingScore != null)
                      _Pill(label: 'Rating ${movie.ratingScore!.toStringAsFixed(1)}'),
                  ],
                ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final genre in movie.genres)
                      Chip(label: Text(genre), labelStyle: const TextStyle(fontSize: 12)),
                  ],
                ),
                const SizedBox(height: 18),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Informasi',
                        style: text.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 10),
                      InfoRow(
                        label: 'Sinopsis',
                        value: movie.synopsis ?? 'Sinopsis belum tersedia untuk film ini.',
                      ),
                      InfoRow(label: 'Tayang sejak', value: movie.releaseDate ?? '-'),
                      InfoRow(
                        label: 'Status',
                        value: movie.status == movieTabNowShowing
                            ? 'Sedang tayang'
                            : 'Segera tayang',
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
          child: AppButton(
            icon: Icons.event_seat_outlined,
            label: 'Pilih Jadwal & Kursi',
            onPressed: () => context.push('/movies/${movie.id}/showtimes', extra: movie.title),
          ),
        ),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: scheme.onSurfaceVariant,
        ),
      ),
    );
  }
}
