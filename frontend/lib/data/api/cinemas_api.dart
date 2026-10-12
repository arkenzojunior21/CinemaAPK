import '../models/cinema.dart';
import 'api_client.dart';

class CinemasApi {
  CinemasApi(this._client);

  final ApiClient _client;

  Future<List<Cinema>> list({String? city}) async {
    final body = await _client.get('/cinemas', query: {
      if (city != null && city.isNotEmpty) 'city': city,
    });
    final list = (body['data'] as Map<String, dynamic>)['items'] as List;
    return list.map((e) => Cinema.fromJson(e as Map<String, dynamic>)).toList(growable: false);
  }
}
