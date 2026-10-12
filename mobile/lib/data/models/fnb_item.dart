enum FnbCategory { food, beverage, combo }

extension FnbCategoryX on FnbCategory {
  String get label => switch (this) {
        FnbCategory.food => 'Makanan',
        FnbCategory.beverage => 'Minuman',
        FnbCategory.combo => 'Paket Combo',
      };
}

class FnbItem {
  const FnbItem({
    required this.id,
    required this.name,
    this.description,
    required this.category,
    required this.price,
    this.imageUrl,
  });

  final String id;
  final String name;
  final String? description;
  final FnbCategory category;
  final int price;
  final String? imageUrl;

  factory FnbItem.fromJson(Map<String, dynamic> json) => FnbItem(
        id: json['id'] as String,
        name: json['name'] as String,
        description: json['description'] as String?,
        category: FnbCategory.values.firstWhere(
          (c) => c.name == json['category'],
          orElse: () => FnbCategory.food,
        ),
        price: json['price'] as int,
        imageUrl: json['image_url'] as String?,
      );
}

class FnbOrderLine {
  const FnbOrderLine({
    required this.fnbItemId,
    required this.name,
    required this.quantity,
    required this.unitPrice,
    required this.subtotal,
  });

  final String fnbItemId;
  final String name;
  final int quantity;
  final int unitPrice;
  final int subtotal;

  factory FnbOrderLine.fromJson(Map<String, dynamic> json) => FnbOrderLine(
        fnbItemId: json['fnb_item_id'] as String,
        name: json['name'] as String,
        quantity: json['quantity'] as int,
        unitPrice: json['unit_price'] as int,
        subtotal: json['subtotal'] as int,
      );
}

class FnbOrder {
  const FnbOrder({
    required this.id,
    required this.status,
    required this.totalAmount,
    required this.pickupCode,
    required this.items,
  });

  final String id;
  final String status;
  final int totalAmount;
  final String pickupCode;
  final List<FnbOrderLine> items;

  factory FnbOrder.fromJson(Map<String, dynamic> json) => FnbOrder(
        id: json['id'] as String,
        status: json['status'] as String,
        totalAmount: json['total_amount'] as int,
        pickupCode: json['pickup_code'] as String,
        items: (json['items'] as List)
            .map((e) => FnbOrderLine.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
      );
}
