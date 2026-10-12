import '../models/movie.dart';
import '../models/showtime.dart';
import 'api_client.dart';

class MoviesApi {
  MoviesApi(this._client);

  final ApiClient _client;

  Future<MoviesPage> list({
    String status = 'now_showing',
    String? search,
    String? city,
    int page = 1,
    int limit = 20,
  }) async {
    final body = await _client.get('/movies', query: {
      'status': status,
      if (search != null && search.isNotEmpty) 'search': search,
      if (city != null && city.isNotEmpty) 'city': city,
      'page': page,
      'limit': limit,
    });
    return MoviesPage.fromJson(body['data'] as Map<String, dynamic>);
  }

  Future<Movie> detail(String id) async {
    final body = await _client.get('/movies/$id');
    return Movie.fromJson(body['data'] as Map<String, dynamic>);
  }

  Future<MovieShowtimes> showtimes(String movieId, {String? date, String? city}) async {
    final body = await _client.get('/movies/$movieId/showtimes', query: {
      'date': ?date,
      if (city != null && city.isNotEmpty) 'city': city,
    });
    return MovieShowtimes.fromJson(body['data'] as Map<String, dynamic>);
  }
}
