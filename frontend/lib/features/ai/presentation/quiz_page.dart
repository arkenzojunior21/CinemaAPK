import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers/ai_providers.dart';
import '../../../core/utils/api_message.dart';
import '../../../data/models/ai.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/app_feedback.dart';
import '../widgets/recommendation_card.dart';

class _Option<T> {
  const _Option(this.value, this.label, this.icon);

  final T value;
  final String label;
  final IconData icon;
}

const _moods = <_Option<String>>[
  _Option('pengen_ketawa', 'Pengen Ketawa', Icons.sentiment_very_satisfied),
  _Option('santai', 'Santai', Icons.local_cafe_outlined),
  _Option('inspiratif', 'Inspiratif', Icons.self_improvement),
  _Option('tegang', 'Tegang', Icons.bolt),
  _Option('romantis', 'Romantis', Icons.favorite_outline),
  _Option('keluarga', 'Bareng Keluarga', Icons.family_restroom),
];

const _companions = <_Option<String>>[
  _Option('sendiri', 'Sendiri', Icons.person_outline),
  _Option('pasangan', 'Pasangan', Icons.favorite),
  _Option('keluarga', 'Keluarga', Icons.family_restroom),
  _Option('teman', 'Teman', Icons.groups_outlined),
];

const _genreOptions = <String>[
  'Comedy',
  'Animation',
  'Family',
  'Drama',
  'Action',
  'Adventure',
  'Sci-Fi',
  'Superhero',
  'Romance',
  'Thriller',
  'Horror',
  'Biography',
];

const _durations = <_Option<int>>[
  _Option(90, 'Maksimal 90 menit', Icons.timelapse),
  _Option(120, 'Maksimal 2 jam', Icons.timelapse),
  _Option(150, 'Maksimal 2,5 jam', Icons.timelapse),
  _Option(180, 'Maksimal 3 jam', Icons.timelapse),
  _Option(300, 'Durasi bebas', Icons.timelapse),
];

/// Quick Quiz (FR-AI-01): kartu visual, jawaban singkat, hasil beralasan.
class QuizPage extends ConsumerStatefulWidget {
  const QuizPage({super.key});

  @override
  ConsumerState<QuizPage> createState() => _QuizPageState();
}

class _QuizPageState extends ConsumerState<QuizPage> {
  String _mood = 'santai';
  String _companion = 'sendiri';
  int _duration = 180;
  final Set<String> _selectedGenres = <String>{};

  void _submit() {
    ref.read(quizControllerProvider.notifier).submit(
          QuizAnswer(
            mood: _mood,
            favoriteGenres: _selectedGenres.toList(),
            maxDurationMinutes: _duration,
            companion: _companion,
          ),
        );
  }

  @override
  Widget build(BuildContext context) {
    final quiz = ref.watch(quizControllerProvider);
    final isLoading = quiz.isLoading;

    return Scaffold(
      appBar: AppBar(title: const Text('Kuis Cepat Cine-AI')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          const Text(
            'Cukup empat pertanyaan. Hasilnya selalu disertai alasan.',
            style: TextStyle(fontSize: 13),
          ),
          const SizedBox(height: 18),
          const SectionHeader(title: '1. Suasana hati kamu'),
          _OptionGrid(
            options: _moods,
            selected: _mood,
            onChanged: (value) => setState(() => _mood = value),
          ),
          const SizedBox(height: 22),
          const SectionHeader(title: '2. Genre favorit (opsional)'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final genre in _genreOptions)
                FilterChip(
                  label: Text(genre),
                  selected: _selectedGenres.contains(genre),
                  onSelected: (selected) => setState(() {
                    if (selected) {
                      if (_selectedGenres.length < 6) _selectedGenres.add(genre);
                    } else {
                      _selectedGenres.remove(genre);
                    }
                  }),
                ),
            ],
          ),
          const SizedBox(height: 22),
          const SectionHeader(title: '3. Batas durasi'),
          _OptionGrid(
            options: _durations,
            selected: _duration,
            onChanged: (value) => setState(() => _duration = value),
          ),
          const SizedBox(height: 22),
          const SectionHeader(title: '4. Nonton bareng siapa?'),
          _OptionGrid(
            options: _companions,
            selected: _companion,
            onChanged: (value) => setState(() => _companion = value),
          ),
          const SizedBox(height: 24),
          AppButton(
            label: isLoading ? 'Memikirkan...' : 'Lihat rekomendasinya',
            icon: Icons.auto_awesome,
            loading: isLoading,
            onPressed: isLoading ? null : _submit,
          ),
          const SizedBox(height: 20),
          switch (quiz) {
            AsyncData(:final value) => value == null
                ? const _QuizHint()
                : _QuizResults(result: value),
            AsyncError(:final error) => ErrorView(
                message: describeApiError(error),
                onRetry: _submit,
              ),
            _ => const LoadingView(message: 'Cine-AI mencocokkan film dengan jawabanmu...'),
          },
        ],
      ),
    );
  }
}

class _OptionGrid<T> extends StatelessWidget {
  const _OptionGrid({
    required this.options,
    required this.selected,
    required this.onChanged,
  });

  final List<_Option<T>> options;
  final T selected;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 2.4,
      ),
      itemCount: options.length,
      itemBuilder: (context, index) {
        final option = options[index];
        final isSelected = option.value == selected;
        return Material(
          color: isSelected ? scheme.primaryContainer : scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(14),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: () => onChanged(option.value),
            child: Ink(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: isSelected ? scheme.primary : scheme.outlineVariant,
                  width: isSelected ? 1.6 : 1,
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  children: [
                    Icon(option.icon, size: 22, color: scheme.primary),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        option.label,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _QuizHint extends StatelessWidget {
  const _QuizHint();

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Row(
        children: [
          Icon(Icons.auto_awesome, color: Theme.of(context).colorScheme.primary),
          const SizedBox(width: 12),
          const Expanded(
            child: Text(
              'Pilih jawabanmu lalu tekan tombol. Rekomendasi akan muncul di sini lengkap dengan alasannya.',
              style: TextStyle(fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

class _QuizResults extends StatelessWidget {
  const _QuizResults({required this.result});

  final AiResult result;

  @override
  Widget build(BuildContext context) {
    if (result.recommendations.isEmpty) {
      return const EmptyView(message: 'Belum ada film yang cocok. Coba longgarkan filternya.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader(title: 'Pilihan untuk kamu'),
        EngineBadge(engine: result.engine),
        const SizedBox(height: 12),
        for (final recommendation in result.recommendations)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: RecommendationCard(recommendation: recommendation),
          ),
      ],
    );
  }
}
