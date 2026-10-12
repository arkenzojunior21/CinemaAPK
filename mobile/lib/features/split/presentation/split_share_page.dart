import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/providers/split_providers.dart';
import '../../../core/utils/api_message.dart';
import '../../../core/utils/formatters.dart';
import '../../../data/models/split.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/app_feedback.dart';
import '../../../shared/widgets/info_row.dart';

/// FR-SB-02 + FR-SB-03: bagikan tautan patungan dan pantau siapa yang sudah bayar.
class SplitSharePage extends ConsumerWidget {
  const SplitSharePage({super.key, required this.splitId});

  final String splitId;

  Future<void> _refresh(WidgetRef ref) async {
    ref.invalidate(splitBillProvider(splitId));
    await ref.read(splitBillProvider(splitId).future);
  }

  Future<void> _copy(BuildContext context, String value, String label) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (context.mounted) showSnack(context, '$label disalin.');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final split = ref.watch(splitBillProvider(splitId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Status Patungan'),
        actions: [
          IconButton(onPressed: () => _refresh(ref), icon: const Icon(Icons.refresh)),
        ],
      ),
      body: switch (split) {
        AsyncData(:final value) => RefreshIndicator(
            onRefresh: () => _refresh(ref),
            child: _Body(
              bill: value,
              onCopy: (text, label) => _copy(context, text, label),
            ),
          ),
        AsyncError(:final error) => ErrorView(
            message: describeApiError(error),
            onRetry: () => ref.invalidate(splitBillProvider(splitId)),
          ),
        _ => const LoadingView(message: 'Memuat status patungan...'),
      },
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.bill, required this.onCopy});

  final SplitBill bill;
  final void Function(String value, String label) onCopy;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(bill.booking.movieTitle,
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 4),
              Text(
                '${bill.booking.cinemaName} · ${bill.booking.studio} · '
                '${Formatters.dateShort(bill.booking.startsAt)} '
                '${Formatters.clock(bill.booking.startsAt)}',
                style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
              ),
              const Divider(height: 18),
              InfoRow(label: 'Host', value: bill.hostName),
              InfoRow(
                label: 'Metode',
                value: bill.isCustom ? 'Sesuai pesanan' : 'Bagi rata',
              ),
              InfoRow(label: 'Total tagihan', value: Formatters.rupiah(bill.totalAmount)),
              if (bill.expiresAt != null)
                InfoRow(
                  label: 'Tautan berlaku sampai',
                  value: '${Formatters.dateShort(bill.expiresAt!)} '
                      '${Formatters.clock(bill.expiresAt!)}',
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _TrackerCard(tracker: bill.tracker),
        const SizedBox(height: 12),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.link, size: 20, color: scheme.primary),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text('Tautan patungan',
                        style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              SelectableText(bill.shareUrl, style: const TextStyle(fontSize: 12)),
              const SizedBox(height: 8),
              Text(
                'Kirim lewat aplikasi chat apa pun. Peserta yang membuka tautan ini '
                'melihat status bayar tanpa perlu login.',
                style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton.tonalIcon(
                  onPressed: () => onCopy(bill.shareUrl, 'Tautan'),
                  icon: const Icon(Icons.copy, size: 18),
                  label: const Text('Salin tautan'),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const SectionHeader(title: 'Status per peserta'),
        for (final participant in bill.participants)
          _ParticipantTile(
            participant: participant,
            onCopy: (value) => onCopy(value, 'Kode ${participant.name}'),
            onPay: () => context.push(
              Uri(
                path: '/pay/${bill.bookingId}',
                queryParameters: {
                  'participant': participant.id,
                  'split': bill.id,
                  'name': participant.name,
                },
              ).toString(),
            ),
          ),
        const SizedBox(height: 12),
        const _Note(
          message: 'Tiap peserta punya kode QRIS / Virtual Account sendiri. Setelah lunas, '
              'tiket dan QR F&B langsung terbit di halaman detail pesanan.',
        ),
      ],
    );
  }
}

class _TrackerCard extends StatelessWidget {
  const _TrackerCard({required this.tracker});

  final SplitTracker tracker;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${Formatters.rupiah(tracker.paid)} dari ${Formatters.rupiah(tracker.total)} lunas',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                ),
              ),
              Text(
                tracker.allPaid ? 'Selesai' : '${tracker.pendingCount} belum bayar',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: tracker.allPaid ? scheme.primary : scheme.error,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(value: tracker.progress, minHeight: 8),
          ),
          const SizedBox(height: 8),
          Text(
            'Sisa tagihan: ${Formatters.rupiah(tracker.remaining)}',
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _ParticipantTile extends StatelessWidget {
  const _ParticipantTile({
    required this.participant,
    required this.onCopy,
    required this.onPay,
  });

  final SplitParticipant participant;
  final ValueChanged<String> onCopy;
  final VoidCallback onPay;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        padding: const EdgeInsets.fromLTRB(12, 10, 8, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  participant.isPaid ? Icons.check_circle : Icons.radio_button_unchecked,
                  size: 20,
                  color: participant.isPaid ? scheme.primary : scheme.outline,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(participant.name,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                      if (participant.paidAt != null)
                        Text(
                          'Lunas ${Formatters.dateShort(participant.paidAt!)} '
                          '${Formatters.clock(participant.paidAt!)}',
                          style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
                        ),
                    ],
                  ),
                ),
                Text(
                  Formatters.rupiah(participant.shareAmount),
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                ),
              ],
            ),
            Theme(
              data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
              child: ExpansionTile(
                tilePadding: EdgeInsets.zero,
                childrenPadding: const EdgeInsets.only(bottom: 10),
                title: Text(
                  participant.isPaid ? 'Sudah dibayar' : 'Instruksi bayar',
                  style: const TextStyle(fontSize: 12),
                ),
                trailing: participant.isPaid
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.copy, size: 18),
                        tooltip: 'Salin kode QRIS',
                        onPressed: () => onCopy(participant.qrisPayload),
                      ),
                children: [
                  if (participant.isPaid)
                    const SizedBox.shrink()
                  else ...[
                    SelectableText(
                      participant.qrisPayload,
                      style: const TextStyle(fontSize: 11),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Expanded(
                          child: TextButton.icon(
                            onPressed: () => onCopy(participant.payUrl),
                            icon: const Icon(Icons.link, size: 16),
                            label: const Text('Salin tautan bayar'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: FilledButton.tonalIcon(
                            onPressed: onPay,
                            icon: const Icon(Icons.payments_outlined, size: 18),
                            label: const Text('Bayar'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(message, style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
    );
  }
}
