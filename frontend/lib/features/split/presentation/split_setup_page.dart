import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/providers/api_providers.dart';
import '../../../core/providers/auth_controller.dart';
import '../../../core/providers/booking_providers.dart';
import '../../../core/utils/api_message.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/utils/split_math.dart';
import '../../../core/utils/status_labels.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/booking.dart';
import '../../../data/models/split.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/app_feedback.dart';
import '../../../shared/widgets/app_text_field.dart';
import '../../../shared/widgets/info_row.dart';

class _MemberRow {
  _MemberRow({this.userId})
      : nameController = TextEditingController(),
        amountController = TextEditingController();

  final String? userId;
  final TextEditingController nameController;
  final TextEditingController amountController;

  bool get isHost => userId != null;

  void dispose() {
    nameController.dispose();
    amountController.dispose();
  }
}

/// FR-SB-01: host membagi tagihan (rata / kustom), lalu tautan dibagikan.
class SplitSetupPage extends ConsumerStatefulWidget {
  const SplitSetupPage({super.key, required this.bookingId});

  final String bookingId;

  @override
  ConsumerState<SplitSetupPage> createState() => _SplitSetupPageState();
}

class _SplitSetupPageState extends ConsumerState<SplitSetupPage> {
  static const _maxMembers = 10;

  String _method = 'equal';
  bool _submitting = false;
  late final List<_MemberRow> _members;

  @override
  void initState() {
    super.initState();
    final host = ref.read(authControllerProvider).user;
    _members = [
      _MemberRow(userId: host?.id)
        ..nameController.text = host?.fullName.split(' ').first ?? 'Saya',
      _MemberRow(),
    ];
  }

  @override
  void dispose() {
    for (final member in _members) {
      member.dispose();
    }
    super.dispose();
  }

  bool get _isCustom => _method == 'custom';

  int get _hostIndex {
    final index = _members.indexWhere((m) => m.isHost);
    return index < 0 ? 0 : index;
  }

  String _labelFor(int index) =>
      index == _hostIndex ? 'Kamu (host)' : 'Peserta ${index + 1}';

  List<int> _equalShares(int total) => equalShares(total, _members.length, hostIndex: _hostIndex);

  List<int?> _customAmounts() => _members.map((member) {
        final raw = member.amountController.text.replaceAll(RegExp(r'[^0-9]'), '');
        return raw.isEmpty ? null : int.parse(raw);
      }).toList(growable: false);

  void _addMember() {
    if (_members.length >= _maxMembers) {
      showSnack(context, 'Maksimal $_maxMembers peserta per patungan.');
      return;
    }
    setState(() => _members.add(_MemberRow()));
  }

  void _removeMember(int index) {
    if (_members.length <= 2) return;
    final removed = _members[index];
    setState(() => _members.removeAt(index));
    // Controller masih menempel pada TextField sampai frame ini dibangun ulang.
    WidgetsBinding.instance.addPostFrameCallback((_) => removed.dispose());
  }

  Future<void> _submit(Booking booking) async {
    final total = booking.totals.grand;
    final names = _members.map((m) => m.nameController.text.trim()).toList();
    if (names.any((name) => name.isEmpty)) {
      showSnack(context, 'Nama semua peserta wajib diisi.', isError: true);
      return;
    }

    final amounts = _customAmounts();
    if (_isCustom) {
      if (amounts.any((amount) => amount == null)) {
        showSnack(context, 'Isi nominal setiap peserta.', isError: true);
        return;
      }
      final remaining = customRemaining(total, amounts.cast<int>());
      if (remaining != 0) {
        showSnack(
          context,
          remaining > 0
              ? 'Masih kurang ${Formatters.rupiah(remaining)}.'
              : 'Kelebihan ${Formatters.rupiah(-remaining)}.',
          isError: true,
        );
        return;
      }
    }

    setState(() => _submitting = true);
    try {
      final drafts = [
        for (var i = 0; i < _members.length; i++)
          SplitMemberDraft(
            name: names[i],
            userId: _members[i].userId,
            amount: _isCustom ? amounts[i] : null,
          ),
      ];
      final bill =
          await ref.read(splitApiProvider).create(widget.bookingId, method: _method, members: drafts);
      if (!mounted) return;
      context.pushReplacement('/split-bill/${bill.id}');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, isError: true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final booking = ref.watch(bookingDetailProvider(widget.bookingId));

    return Scaffold(
      appBar: AppBar(title: const Text('Patungan')),
      body: switch (booking) {
        AsyncData(:final value) => _body(value),
        AsyncError(:final error) => ErrorView(
            message: describeApiError(error),
            onRetry: () => ref.invalidate(bookingDetailProvider(widget.bookingId)),
          ),
        _ => const LoadingView(message: 'Memuat total tagihan...'),
      },
    );
  }

  Widget _body(Booking booking) {
    final scheme = Theme.of(context).colorScheme;
    final total = booking.totals.grand;

    final summary = AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(booking.movie.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
          const SizedBox(height: 4),
          Text(
            '${booking.cinema.name} · ${booking.studio}',
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
          const Divider(height: 18),
          InfoRow(label: 'Yang dibagi', value: Formatters.rupiah(total), emphasize: true),
        ],
      ),
    );

    if (!bookingIsPayable(booking.status)) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          summary,
          const SizedBox(height: 14),
          const _Notice(
            icon: Icons.info_outline,
            message: 'Pesanan ini sudah lunas, jadi tidak perlu dipatungkan lagi.',
          ),
          const SizedBox(height: 20),
          AppButton(
            label: 'Kembali ke Detail Pesanan',
            variant: AppButtonVariant.secondary,
            onPressed: () => context.pop(),
          ),
        ],
      );
    }

    final shares = _isCustom
        ? _customAmounts().map((amount) => amount ?? 0).toList()
        : _equalShares(total);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        summary,
        const SizedBox(height: 18),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'equal', label: Text('Bagi Rata')),
            ButtonSegment(value: 'custom', label: Text('Sesuai Pesanan')),
          ],
          selected: {_method},
          showSelectedIcon: false,
          onSelectionChanged: (value) => setState(() => _method = value.first),
        ),
        const SizedBox(height: 16),
        const SectionHeader(title: 'Siapa yang ikut patungan?'),
        for (var i = 0; i < _members.length; i++)
          _MemberTile(
            key: ValueKey(_members[i]),
            label: _labelFor(i),
            member: _members[i],
            showAmount: _isCustom,
            shareLabel: _isCustom ? null : Formatters.rupiah(shares[i]),
            canRemove: _members.length > 2 && !_members[i].isHost,
            onRemove: () => _removeMember(i),
            onAmountChanged: _isCustom ? (_) => setState(() {}) : null,
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: _addMember,
            icon: const Icon(Icons.person_add_alt),
            label: Text('Tambah peserta (${_members.length}/$_maxMembers)'),
          ),
        ),
        const SizedBox(height: 10),
        _ShareSummary(total: total, isCustom: _isCustom, shares: shares),
        const SizedBox(height: 20),
        AppButton(
          label: 'Buat Patungan & Bagikan',
          icon: Icons.share_outlined,
          loading: _submitting,
          onPressed: _submitting ? null : () => _submit(booking),
        ),
      ],
    );
  }
}

class _MemberTile extends StatelessWidget {
  const _MemberTile({
    super.key,
    required this.label,
    required this.member,
    required this.showAmount,
    required this.canRemove,
    required this.onRemove,
    this.shareLabel,
    this.onAmountChanged,
  });

  final String label;
  final _MemberRow member;
  final bool showAmount;
  final bool canRemove;
  final VoidCallback onRemove;
  final String? shareLabel;
  final ValueChanged<String>? onAmountChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: scheme.primary,
                    ),
                  ),
                ),
                if (shareLabel != null)
                  Text(shareLabel!, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                if (canRemove)
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    onPressed: onRemove,
                    icon: const Icon(Icons.close, size: 18),
                  ),
              ],
            ),
            AppTextField(controller: member.nameController, label: 'Nama peserta'),
            if (showAmount) ...[
              const SizedBox(height: 8),
              AppTextField(
                controller: member.amountController,
                label: 'Nominal (Rp)',
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                onChanged: onAmountChanged,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ShareSummary extends StatelessWidget {
  const _ShareSummary({
    required this.total,
    required this.isCustom,
    required this.shares,
  });

  final int total;
  final bool isCustom;
  final List<int> shares;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final sum = sumShares(shares);
    final balanced = sum == total;
    final foreground = balanced ? scheme.onSecondaryContainer : scheme.onErrorContainer;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: balanced ? scheme.secondaryContainer : scheme.errorContainer,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Total share ${Formatters.rupiah(sum)} dari ${Formatters.rupiah(total)}',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: foreground),
          ),
          const SizedBox(height: 4),
          Text(
            !balanced
                ? (sum > total
                    ? 'Kelebihan ${Formatters.rupiah(sum - total)} — sesuaikan nominal peserta.'
                    : 'Kurang ${Formatters.rupiah(total - sum)} — bagi sisanya ke peserta.')
                : (isCustom
                    ? 'Pas. Setiap peserta bayar sesuai pesanannya.'
                    : 'Dibagi rata untuk ${shares.length} peserta. Sisa yang tidak habis dibebankan ke kamu sebagai host.'),
            style: TextStyle(fontSize: 12, color: foreground),
          ),
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.message});

  final IconData icon;
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
      child: Row(
        children: [
          Icon(icon, size: 20, color: scheme.onSurfaceVariant),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message, style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant)),
          ),
        ],
      ),
    );
  }
}
