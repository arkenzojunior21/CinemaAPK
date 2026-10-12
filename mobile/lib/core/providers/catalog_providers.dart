import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/cinema.dart';
import '../../data/models/movie.dart';
import '../../data/models/showtime.dart';
import 'api_providers.dart';

/// Filter halaman Home; dipakai sebagai key provider daftar film.
typedef MovieListKey = ({String status, String search, String city, int page});

const movieTabNowShowing = 'now_showing';
const movieTabUpcoming = 'upcoming';

class BrowseController extends Notifier<MovieListKey> {
  @override
  MovieListKey build() =>
      (status: movieTabNowShowing, search: '', city: '', page: 1);

  void setTab(String status) {
    if (state.status == status) return;
    state = (status: status, search: state.search, city: state.city, page: 1);
  }

  void setSearch(String value) {
    final v = value.trim();
    if (v == state.search) return;
    state = (status: state.status, search: v, city: state.city, page: 1);
  }

  void setCity(String value) {
    if (value == state.city) return;
    state = (status: state.status, search: state.search, city: value, page: 1);
  }

  void nextPage() {
    state = (
      status: state.status,
      search: state.search,
      city: state.city,
      page: state.page + 1,
    );
  }
}

final browseProvider = NotifierProvider<BrowseController, MovieListKey>(BrowseController.new);

final moviesListProvider = FutureProvider.family<MoviesPage, MovieListKey>((ref, key) {
  return ref.watch(moviesApiProvider).list(
        status: key.status,
        search: key.search.isEmpty ? null : key.search,
        city: key.city.isEmpty ? null : key.city,
        page: key.page,
      );
});

final cinemasProvider = FutureProvider<List<Cinema>>(
  (ref) => ref.watch(cinemasApiProvider).list(),
);

final citiesProvider = FutureProvider<List<String>>((ref) async {
  final cinemas = await ref.watch(cinemasProvider.future);
  final cities = <String>{};
  for (final cinema in cinemas) {
    cities.add(cinema.city);
  }
  final sorted = cities.toList()..sort();
  return sorted;
});

final movieDetailProvider = FutureProvider.family<Movie, String>(
  (ref, movieId) => ref.watch(moviesApiProvider).detail(movieId),
);

typedef ShowtimesKey = ({String movieId, String date, String city});

final movieShowtimesProvider = FutureProvider.family<MovieShowtimes, ShowtimesKey>((ref, key) {
  return ref.watch(moviesApiProvider).showtimes(
        key.movieId,
        date: key.date,
        city: key.city.isEmpty ? null : key.city,
      );
});
