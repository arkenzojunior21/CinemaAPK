import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/providers/auth_controller.dart';
import '../../../core/providers/catalog_providers.dart';
import '../../../core/providers/theme_controller.dart';
import '../../../core/utils/api_message.dart';
import '../../../data/models/movie.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/app_feedback.dart';
import '../../../shared/widgets/app_text_field.dart';
import '../../../shared/widgets/movie_card.dart';

class HomePage extends ConsumerStatefulWidget {
  const HomePage({super.key});

  @override
  ConsumerState<HomePage> createState() => _HomePageState();
}

class _HomePageState extends ConsumerState<HomePage> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _pickTheme() async {
    final controller = ref.read(themeControllerProvider.notifier);
    await showAppSheet<void>(
      context,
      title: 'Tampilan',
      builder: (_) => Column(
        children: [
          _ThemeOption(
            icon: Icons.brightness_auto_outlined,
            label: 'Ikuti pengaturan sistem',
            onTap: () {
              controller.setMode(ThemeMode.system);
              Navigator.of(context).pop();
            },
          ),
          _ThemeOption(
            icon: Icons.light_mode_outlined,
            label: 'Light mode',
            onTap: () {
              controller.setMode(ThemeMode.light);
              Navigator.of(context).pop();
            },
          ),
          _ThemeOption(
            icon: Icons.dark_mode_outlined,
            label: 'Dark mode',
            onTap: () {
              controller.setMode(ThemeMode.dark);
              Navigator.of(context).pop();
            },
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final browse = ref.watch(browseProvider);
    final movies = ref.watch(moviesListProvider(browse));
    final cities = ref.watch(citiesProvider);
    final scheme = Theme.of(context).colorScheme;
    final user = ref.watch(authControllerProvider).user;

    return Scaffold(
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user == null ? 'CineGen' : 'Halo, ${user.fullName.split(' ').first}',
                          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                        ),
                        Text(
                          'Mau nonton apa hari ini?',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: scheme.onSurfaceVariant,
                              ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: _pickTheme,
                    tooltip: 'Ubah tampilan',
                    icon: const Icon(Icons.brightness_6_outlined),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: AppSearchField(
                controller: _search,
                onChanged: (value) => ref.read(browseProvider.notifier).setSearch(value),
              ),
            ),
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Expanded(
                    child: _AiEntry(
                      icon: Icons.quiz_outlined,
                      title: 'Kuis Cepat',
                      subtitle: '4 pertanyaan, langsung cocok',
                      onTap: () => context.push('/ai/quiz'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _AiEntry(
                      icon: Icons.chat_bubble_outline,
                      title: 'Cine-Buddy',
                      subtitle: 'Ngobrol, minta rekomendasi',
                      onTap: () => context.push('/ai/chat'),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              height: 38,
              child: switch (cities) {
                AsyncData(:final value) => ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    children: [
                      _CityChip(
                        label: 'Semua kota',
                        selected: browse.city.isEmpty,
                        onTap: () => ref.read(browseProvider.notifier).setCity(''),
                      ),
                      for (final city in value)
                        _CityChip(
                          label: city,
                          selected: browse.city == city,
                          onTap: () => ref.read(browseProvider.notifier).setCity(city),
                        ),
                    ],
                  ),
                AsyncError() => const SizedBox.shrink(),
                _ => const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 24),
                    child: LinearProgressIndicator(minHeight: 2),
                  ),
              },
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Row(
                children: [
                  Expanded(
                    child: SegmentedButton<String>(
                      segments: const [
                        ButtonSegment(value: movieTabNowShowing, label: Text('Sedang Tayang')),
                        ButtonSegment(value: movieTabUpcoming, label: Text('Segera Tayang')),
                      ],
                      selected: {browse.status},
                      showSelectedIcon: false,
                      onSelectionChanged: (value) =>
                          ref.read(browseProvider.notifier).setTab(value.first),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: switch (movies) {
                AsyncData(:final value) => _MovieList(
                    page: value,
                    browse: browse,
                    onLoadMore: () => ref.read(browseProvider.notifier).nextPage(),
                  ),
                AsyncError(:final error) => ErrorView(
                    message: describeApiError(error),
                    onRetry: () => ref.invalidate(moviesListProvider(browse)),
                  ),
                _ => const LoadingView(message: 'Mengambil daftar film...'),
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _MovieList extends StatelessWidget {
  const _MovieList({
    required this.page,
    required this.browse,
    required this.onLoadMore,
  });

  final MoviesPage page;
  final MovieListKey browse;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    if (page.items.isEmpty) {
      return EmptyView(
        message: browse.search.isEmpty
            ? 'Belum ada film di kategori ini.'
            : 'Tidak ada film dengan kata kunci "${browse.search}".',
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
      itemCount: page.items.length + (page.page < page.totalPages ? 1 : 0),
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        if (index >= page.items.length) {
          return Padding(
            padding: const EdgeInsets.only(top: 6),
            child: AppButton(
              label: 'Muat selengkapnya',
              variant: AppButtonVariant.secondary,
              icon: Icons.expand_more,
              onPressed: onLoadMore,
            ),
          );
        }
        final movie = page.items[index];
        return MovieCard(
          movie: movie,
          onTap: () => context.push('/movies/${movie.id}', extra: movie.title),
        );
      },
    );
  }
}

class _AiEntry extends StatelessWidget {
  const _AiEntry({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 22, color: scheme.primary),
          const SizedBox(height: 8),
          Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text(
            subtitle,
            style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
            maxLines: 2,
          ),
        ],
      ),
    );
  }
}

class _CityChip extends StatelessWidget {
  const _CityChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
      ),
    );
  }
}

class _ThemeOption extends StatelessWidget {
  const _ThemeOption({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      onTap: onTap,
      child: Row(
        children: [
          Icon(icon, size: 22),
          const SizedBox(width: 12),
          Expanded(child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}
