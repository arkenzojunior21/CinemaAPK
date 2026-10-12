import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/providers/payment_providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../data/models/payment.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/app_feedback.dart';
import '../../../shared/widgets/info_row.dart';

/// Halaman pembayaran (FR-BY-01): pilih kanal, bayar, pantau status, tiket terbit.
class PaymentPage extends ConsumerStatefulWidget {
  const PaymentPage({
    super.key,
    required this.bookingId,
    this.participantId,
    this.splitId,
    this.shareLabel,
  });

  final String bookingId;
  final String? participantId;
  final String? splitId;
  final String? shareLabel;

  @override
  ConsumerState<PaymentPage> createState() => _PaymentPageState();
}

class _PaymentPageState extends ConsumerState<PaymentPage> {
  PaymentChannel _channel = PaymentChannel.qris;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _start());
  }

  Future<void> _start([PaymentChannel? channel]) async {
    final selected = channel ?? _channel;
    await ref.read(paymentControllerProvider.notifier).start(
          bookingId: widget.bookingId,
          channel: selected,
          participantId: widget.participantId,
          splitId: widget.splitId,
        );
  }

  Future<void> _copy(String value, String label) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (mounted) showSnack(context, '$label disalin.');
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(paymentControllerProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.shareLabel == null ? 'Pembayaran' : 'Bayar Share'),
        actions: [
          IconButton(
            tooltip: 'Perbarui status',
            onPressed: () => ref.read(paymentControllerProvider.notifier).refresh(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(paymentControllerProvider.notifier).refresh(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            if (widget.shareLabel != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _ShareNotice(label: widget.shareLabel!),
              ),
            _ChannelPicker(
              value: _channel,
              enabled: !state.busy,
              onChanged: (next) {
                setState(() => _channel = next);
                _start(next);
              },
            ),
            const SizedBox(height: 14),
            if (state.busy) const LoadingView(message: 'Menyiapkan pembayaran...'),
            if (state.error != null)
              ErrorView(message: state.error!, onRetry: () => _start()),
            if (state.charge != null) ...[
              _AmountCard(state: state),
              const SizedBox(height: 12),
              _InstructionCard(
                charge: state.charge!,
                onCopy: _copy,
              ),
              const SizedBox(height: 12),
              _StatusCard(
                state: state,
                onSimulate: () => ref.read(paymentControllerProvider.notifier).markPaidAsSimulated(),
              ),
              const SizedBox(height: 16),
              if (state.settled)
                AppButton(
                  label: 'Lihat E-Ticket',
                  icon: Icons.confirmation_number_outlined,
                  onPressed: () => context.pushReplacement('/ticket/${widget.bookingId}'),
                )
              else if (state.failed)
                AppButton(
                  label: 'Coba Kanal Lain',
                  variant: AppButtonVariant.secondary,
                  onPressed: () => _start(),
                )
              else
                AppButton(
                  label: 'Sudah Bayar? Perbarui Status',
                  variant: AppButtonVariant.secondary,
                  icon: Icons.sync,
                  loading: state.busy,
                  onPressed: () => ref.read(paymentControllerProvider.notifier).refresh(),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ShareNotice extends StatelessWidget {
  const _ShareNotice({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Icon(Icons.groups_outlined, size: 18, color: scheme.onSurfaceVariant),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Anda membayar share atas nama $label.',
              style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChannelPicker extends StatelessWidget {
  const _ChannelPicker({required this.value, required this.enabled, required this.onChanged});

  final PaymentChannel value;
  final bool enabled;
  final ValueChanged<PaymentChannel> onChanged;

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<PaymentChannel>(
      segments: [
        for (final channel in PaymentChannel.all)
          ButtonSegment(
            value: channel,
            label: Text(channel.label),
            icon: Icon(_iconFor(channel)),
          ),
      ],
      selected: {value},
      showSelectedIcon: false,
      onSelectionChanged: enabled ? (next) => onChanged(next.first) : null,
    );
  }

  IconData _iconFor(PaymentChannel channel) {
    if (channel.value == PaymentChannel.qris.value) return Icons.qr_code_2;
    if (channel.value == PaymentChannel.virtualAccount.value) return Icons.account_balance_outlined;
    return Icons.account_balance_wallet_outlined;
  }
}

class _AmountCard extends ConsumerWidget {
  const _AmountCard({required this.state});

  final PaymentState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final charge = state.charge!;
    final scheme = Theme.of(context).colorScheme;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Jumlah dibayar',
            style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 4),
          Text(
            Formatters.rupiah(state.amount),
            style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
          ),
          const Divider(height: 20),
          InfoRow(label: 'Kanal', value: _labelOf(charge.channel)),
          InfoRow(label: 'Gateway', value: charge.gateway),
          if (charge.transactionId != null)
            InfoRow(label: 'Reference', value: charge.transactionId!),
        ],
      ),
    );
  }

  String _labelOf(String channel) {
    return PaymentChannel.all.firstWhere((item) => item.value == channel).label;
  }
}

class _InstructionCard extends StatelessWidget {
  const _InstructionCard({required this.charge, required this.onCopy});

  final PaymentCharge charge;
  final void Function(String value, String label) onCopy;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    final payload = charge.qrisPayload;
    final va = charge.vaNumber;
    final link = charge.payUrl;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Instruksi pembayaran', style: text.titleSmall?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          if (payload != null) ...[
            Text(
              'Salin kode QRIS ini lalu tempel di aplikasi bank / e-wallet Anda, atau render sebagai QR.',
              style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 10),
            _MonoBox(value: payload),
            const SizedBox(height: 10),
            AppButton(
              label: 'Salin kode QRIS',
              icon: Icons.copy,
              variant: AppButtonVariant.secondary,
              onPressed: () => onCopy(payload, 'Kode QRIS'),
            ),
          ] else if (va != null) ...[
            InfoRow(label: 'Bank', value: charge.vaBank ?? '-'),
            const SizedBox(height: 8),
            _MonoBox(value: va),
            const SizedBox(height: 10),
            AppButton(
              label: 'Salin nomor Virtual Account',
              icon: Icons.copy,
              variant: AppButtonVariant.secondary,
              onPressed: () => onCopy(va, 'Nomor VA'),
            ),
          ] else if (link != null) ...[
            _MonoBox(value: link),
            const SizedBox(height: 10),
            AppButton(
              label: 'Salin tautan bayar',
              icon: Icons.copy,
              variant: AppButtonVariant.secondary,
              onPressed: () => onCopy(link, 'Tautan bayar'),
            ),
          ] else
            Text(
              'Gateway belum mengembalikan instruksi pembayaran.',
              style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
        ],
      ),
    );
  }
}

class _MonoBox extends StatelessWidget {
  const _MonoBox({required this.value});

  final String value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: SelectableText(
        value,
        style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.state, required this.onSimulate});

  final PaymentState state;
  final VoidCallback onSimulate;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    final color = state.settled
        ? scheme.secondaryContainer
        : state.failed
            ? scheme.errorContainer
            : scheme.tertiaryContainer;
    final foreground = state.settled
        ? scheme.onSecondaryContainer
        : state.failed
            ? scheme.onErrorContainer
            : scheme.onTertiaryContainer;
    final icon = state.settled
        ? Icons.check_circle_outline
        : state.failed
            ? Icons.error_outline
            : Icons.hourglass_top;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(16)),
          child: Row(
            children: [
              Icon(icon, color: foreground),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  state.notice ?? _statusLabel(state),
                  style: TextStyle(color: foreground, fontSize: 13),
                ),
              ),
              if (state.polling)
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: foreground),
                ),
            ],
          ),
        ),
        if (state.isSimulated && !state.settled) ...[
          const SizedBox(height: 10),
          Text(
            'Mode development: gateway uang asli belum dikonfigurasi di server.',
            style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 8),
          AppButton(
            label: 'Tandai sudah dibayar (simulasi)',
            icon: Icons.bolt_outlined,
            variant: AppButtonVariant.text,
            loading: state.busy,
            onPressed: onSimulate,
          ),
        ],
      ],
    );
  }

  String _statusLabel(PaymentState state) {
    final status = state.status?.status ?? 'pending';
    return switch (status) {
      'settled' => 'Pembayaran diterima. E-ticket sudah terbit.',
      'failed' => 'Pembayaran gagal. Silakan ulangi atau pilih kanal lain.',
      'expired' => 'Batas waktu pembayaran lewat. Buat ulang pembayaran.',
      _ => 'Menunggu konfirmasi dari payment gateway...',
    };
  }
}
