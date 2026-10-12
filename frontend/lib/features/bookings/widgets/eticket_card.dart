import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers/eticket_providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../data/models/payment.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/app_feedback.dart';
import '../../../shared/widgets/info_row.dart';

/// E-ticket + QR F&B hasil TAHAP 6: tampil begitu status booking `paid`.
class ETicketCard extends ConsumerWidget {
  const ETicketCard({super.key, required this.bookingId});

  final String bookingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ticket = ref.watch(eticketProvider(bookingId));

    return switch (ticket) {
      AsyncData(:final value) => _TicketBody(ticket: value),
      AsyncError(:final error) => AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'E-ticket belum tersedia.',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 6),
              Text(
                '$error'.replaceFirst('Exception: ', ''),
                style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 10),
              AppButton(
                label: 'Coba lagi',
                variant: AppButtonVariant.secondary,
                icon: Icons.refresh,
                onPressed: () => ref.invalidate(eticketProvider(bookingId)),
              ),
            ],
          ),
        ),
      _ => const LoadingView(message: 'Mengambil e-ticket...'),
    };
  }
}

class _TicketBody extends StatelessWidget {
  const _TicketBody({required this.ticket});

  final ETicket ticket;

  Future<void> _copy(BuildContext context, String value, String label) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (context.mounted) showSnack(context, '$label disalin.');
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Column(
      children: [
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'E-TICKET',
                      style: text.labelLarge?.copyWith(
                        letterSpacing: 1.4,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  Text(
                    ticket.bookingCode,
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                ticket.movieTitle,
                style: text.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 4),
              Text(
                '${ticket.cinemaName} · ${Formatters.dateShort(ticket.startsAt)} · '
                '${Formatters.clock(ticket.startsAt)}',
                style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
              const Divider(height: 22),
              Center(
                child: Text(
                  ticket.ticket.code,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 2,
                  ),
                ),
              ),
              const SizedBox(height: 4),
              Center(
                child: Text(
                  'Kode tiket',
                  style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ),
              const SizedBox(height: 12),
              SelectableText(
                ticket.ticket.qrPayload,
                textAlign: TextAlign.center,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
              ),
              const SizedBox(height: 10),
              AppButton(
                label: 'Salin QR tiket',
                icon: Icons.copy,
                variant: AppButtonVariant.secondary,
                onPressed: () => _copy(context, ticket.ticket.qrPayload, 'QR tiket'),
              ),
            ],
          ),
        ),
        for (final order in ticket.fnbOrders) ...[
          const SizedBox(height: 12),
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.local_cafe_outlined, size: 18, color: scheme.onSurfaceVariant),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Kode pengambilan F&B',
                        style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ),
                    Text(
                      order.pickupCode,
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                InfoRow(label: 'Status', value: order.status),
                InfoRow(label: 'Total', value: Formatters.rupiah(order.totalAmount)),
                if (order.qrPayload != null) ...[
                  const SizedBox(height: 10),
                  SelectableText(
                    order.qrPayload!,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
                  ),
                  const SizedBox(height: 10),
                  AppButton(
                    label: 'Salin QR F&B',
                    icon: Icons.copy,
                    variant: AppButtonVariant.text,
                    onPressed: () => _copy(context, order.qrPayload!, 'QR F&B'),
                  ),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}
