import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../data/models/ai.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/poster_image.dart';

/// Kartu rekomendasi yang selalu menampilkan alasan (FR-AI-03).
class RecommendationCard extends StatelessWidget {
  const RecommendationCard({super.key, required this.recommendation});

  final Recommendation recommendation;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final movie = recommendation.movie;
    final matchPercent = (recommendation.matchScore * 100).clamp(0, 100).round();

    return AppCard(
      onTap: () => context.push('/movies/${movie.id}', extra: movie.title),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              PosterImage(url: movie.posterUrl, title: movie.title, width: 68, height: 100),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      movie.title,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      movie.genres.join(' • '),
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        AgeBadge(label: movie.ageRating),
                        _MetaPill(icon: Icons.schedule, label: '${movie.durationMinutes} mnt'),
                        if (movie.ratingScore != null) RatingChip(score: movie.ratingScore!),
                        _MatchBadge(percent: matchPercent),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: scheme.primaryContainer.withValues(alpha: 0.45),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.lightbulb_outline, size: 15, color: scheme.primary),
                    const SizedBox(width: 6),
                    Text(
                      'Mengapa film ini cocok',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: scheme.primary,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  recommendation.rationale,
                  style: const TextStyle(fontSize: 13, height: 1.45),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MetaPill extends StatelessWidget {
  const _MetaPill({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: scheme.onSurfaceVariant),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

class _MatchBadge extends StatelessWidget {
  const _MatchBadge({required this.percent});

  final int percent;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: scheme.primary,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        '$percent% cocok',
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: scheme.onPrimary,
        ),
      ),
    );
  }
}

class EngineBadge extends StatelessWidget {
  const EngineBadge({super.key, required this.engine});

  final String engine;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isLlm = engine == 'gemini';
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(isLlm ? Icons.auto_awesome : Icons.bolt, size: 14, color: scheme.primary),
        const SizedBox(width: 6),
        Text(
          isLlm ? 'Direkomendasikan oleh Cine-AI' : 'Rekomendasi cepat (mesin lokal)',
          style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}
