import 'package:flutter/material.dart';

String bookingStatusLabel(String status) => switch (status) {
      'pending_payment' => 'Menunggu Pembayaran',
      'partially_paid' => 'Pembayaran Sebagian',
      'paid' => 'Lunas',
      'cancelled' => 'Dibatalkan',
      'expired' => 'Kedaluwarsa',
      _ => status,
    };

bool bookingIsPayable(String status) =>
    status == 'pending_payment' || status == 'partially_paid';

Color bookingStatusColor(BuildContext context, String status) {
  final scheme = Theme.of(context).colorScheme;
  return switch (status) {
    'paid' => scheme.secondaryContainer,
    'cancelled' || 'expired' => scheme.surfaceContainerHighest,
    _ => scheme.tertiaryContainer,
  };
}

Color bookingStatusTextColor(BuildContext context, String status) {
  final scheme = Theme.of(context).colorScheme;
  return switch (status) {
    'paid' => scheme.onSecondaryContainer,
    'cancelled' || 'expired' => scheme.onSurfaceVariant,
    _ => scheme.onTertiaryContainer,
  };
}

class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: bookingStatusColor(context, status),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        bookingStatusLabel(status),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: bookingStatusTextColor(context, status),
        ),
      ),
    );
  }
}
