import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/providers/api_providers.dart';
import '../../../core/providers/booking_providers.dart';
import '../../../core/providers/fnb_providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/booking.dart';
import '../../../data/models/fnb_item.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/app_feedback.dart';
import '../../../shared/widgets/info_row.dart';

class FnbPage extends ConsumerWidget {
  const FnbPage({super.key, required this.bookingId});

  final String bookingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final booking = ref.watch(bookingDetailProvider(bookingId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Camilan & Minuman'),
        actions: [
          TextButton(
            onPressed: () => context.go('/ticket/$bookingId'),
            child: const Text('Lewati'),
          ),
        ],
      ),
      body: switch (booking) {
        AsyncData(:final value) => _FnbBody(booking: value),
        AsyncError(:final error) => ErrorView(
            message: error is ApiException ? error.message : 'Booking tidak ditemukan.',
            onRetry: () => ref.invalidate(bookingDetailProvider(bookingId)),
          ),
        _ => const LoadingView(message: 'Memuat booking...'),
      },
    );
  }
}

class _FnbBody extends ConsumerStatefulWidget {
  const _FnbBody({required this.booking});

  final Booking booking;

  @override
  ConsumerState<_FnbBody> createState() => _FnbBodyState();
}

class _FnbBodyState extends ConsumerState<_FnbBody> {
  bool _busy = false;

  Future<void> _submit() async {
    final cart = ref.read(cartProvider);
    if (cart.isEmpty) return;
    setState(() => _busy = true);
    try {
      await ref.read(fnbApiProvider).createOrder(widget.booking.id, cart);
      ref
        ..invalidate(bookingDetailProvider(widget.booking.id))
        ..invalidate(myBookingsProvider)
        ..read(cartProvider.notifier).clear();
      if (mounted) context.go('/ticket/${widget.booking.id}');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, isError: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final catalog = ref.watch(fnbCatalogProvider(widget.booking.cinema.id));
    final cart = ref.watch(cartProvider);
    final scheme = Theme.of(context).colorScheme;

    return switch (catalog) {
      AsyncData(:final value) => value.isEmpty
          ? EmptyView(
              message: 'Bioskop ${widget.booking.cinema.name} belum punya katalog F&B online.',
              icon: Icons.no_meals_outlined,
            )
          : Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                    children: [
                      AppCard(
                        child: Column(
                          children: [
                            InfoRow(label: 'Film', value: widget.booking.movie.title),
                            InfoRow(label: 'Kursi', value: widget.booking.seatsLabel),
                            InfoRow(
                              label: 'Tiket',
                              value: Formatters.rupiah(widget.booking.totals.ticket),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),
                      for (final category in FnbCategory.values)
                        if (value.any((item) => item.category == category)) ...[
                          SectionHeader(title: category.label),
                          for (final item in value.where((i) => i.category == category))
                            _FnbRow(
                              item: item,
                              qty: cart[item.id] ?? 0,
                              onChanged: (delta) =>
                                  ref.read(cartProvider.notifier).changeQty(item, delta),
                            ),
                          const SizedBox(height: 8),
                        ],
                    ],
                  ),
                ),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainer,
                    border: Border(top: BorderSide(color: scheme.outlineVariant)),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Total F&B',
                              style: TextStyle(
                                fontSize: 12,
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                            Text(
                              Formatters.rupiah(cartTotal(cart, value)),
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(
                        width: 200,
                        child: AppButton(
                          label: cart.isEmpty ? 'Belum ada item' : 'Tambah ke Pesanan',
                          icon: Icons.shopping_basket_outlined,
                          loading: _busy,
                          onPressed: cart.isEmpty ? null : _submit,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
      AsyncError(:final error) => ErrorView(
          message: error is ApiException ? error.message : 'Katalog F&B gagal dimuat.',
          onRetry: () => ref.invalidate(fnbCatalogProvider(widget.booking.cinema.id)),
        ),
      _ => const LoadingView(message: 'Memuat katalog F&B...'),
    };
  }
}

class _FnbRow extends StatelessWidget {
  const _FnbRow({
    required this.item,
    required this.qty,
    required this.onChanged,
  });

  final FnbItem item;
  final int qty;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                ),
                if (item.description != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      item.description!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                  ),
                const SizedBox(height: 4),
                Text(
                  Formatters.rupiah(item.price),
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: scheme.primary),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          _QtyStepper(qty: qty, onChanged: onChanged),
        ],
      ),
    );
  }
}

class _QtyStepper extends StatelessWidget {
  const _QtyStepper({required this.qty, required this.onChanged});

  final int qty;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    if (qty == 0) {
      return SizedBox(
        height: 36,
        child: FilledButton.tonal(
          onPressed: () => onChanged(1),
          style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 16)),
          child: const Text('Tambah'),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            onPressed: () => onChanged(-1),
            icon: const Icon(Icons.remove),
            iconSize: 18,
            visualDensity: VisualDensity.compact,
          ),
          Text('$qty', style: const TextStyle(fontWeight: FontWeight.w800)),
          IconButton(
            onPressed: () => onChanged(1),
            icon: const Icon(Icons.add),
            iconSize: 18,
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }
}
