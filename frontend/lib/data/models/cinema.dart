class Cinema {
  const Cinema({
    required this.id,
    required this.chain,
    required this.name,
    required this.city,
    this.address,
  });

  final String id;
  final String chain;
  final String name;
  final String city;
  final String? address;

  factory Cinema.fromJson(Map<String, dynamic> json) => Cinema(
        id: json['id'] as String,
        chain: json['chain'] as String,
        name: json['name'] as String,
        city: json['city'] as String,
        address: json['address'] as String?,
      );
}
