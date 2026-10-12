import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/fnb_item.dart';
import 'api_providers.dart';

final fnbCatalogProvider = FutureProvider.family<List<FnbItem>, String>(
  (ref, cinemaId) => ref.watch(fnbApiProvider).items(cinemaId),
);

/// Keranjang F&B: fnbItemId -> jumlah.
class CartController extends Notifier<Map<String, int>> {
  @override
  Map<String, int> build() => const {};

  void changeQty(FnbItem item, int delta) {
    final next = {...state};
    final qty = (next[item.id] ?? 0) + delta;
    if (qty <= 0) {
      next.remove(item.id);
    } else {
      next[item.id] = qty;
    }
    state = next;
  }

  void clear() => state = const {};
}

final cartProvider = NotifierProvider<CartController, Map<String, int>>(CartController.new);

int cartTotal(Map<String, int> cart, List<FnbItem> catalog) {
  var total = 0;
  for (final item in catalog) {
    total += item.price * (cart[item.id] ?? 0);
  }
  return total;
}
