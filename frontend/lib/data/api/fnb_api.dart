import '../models/fnb_item.dart';
import 'api_client.dart';

class FnbApi {
  FnbApi(this._client);

  final ApiClient _client;

  Future<List<FnbItem>> items(String cinemaId) async {
    final body = await _client.get('/cinemas/$cinemaId/fnb-items');
    final list = body['data'] as List;
    return list.map((e) => FnbItem.fromJson(e as Map<String, dynamic>)).toList(growable: false);
  }

  Future<FnbOrder> createOrder(String bookingId, Map<String, int> quantities) async {
    final items = quantities.entries
        .map((e) => {'fnb_item_id': e.key, 'quantity': e.value})
        .toList(growable: false);
    final body = await _client.post('/bookings/$bookingId/fnb-orders', data: {'items': items});
    return FnbOrder.fromJson(body['data'] as Map<String, dynamic>);
  }
}
