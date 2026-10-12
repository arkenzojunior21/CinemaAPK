import 'package:flutter/material.dart';

import '../../../../data/models/seat_map.dart';

class SeatTile extends StatelessWidget {
  const SeatTile({
    super.key,
    required this.seat,
    required this.selected,
    required this.onTap,
  });

  final SeatInfo seat;
  final bool selected;
  final VoidCallback? onTap;

  static const _size = 30.0;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isCouple = seat.type == SeatType.couple;

    final colors = switch (seat.status) {
      SeatStatus.sold => (bg: scheme.surfaceContainerHighest, fg: scheme.outline),
      SeatStatus.locked => (bg: scheme.tertiaryContainer, fg: scheme.onTertiaryContainer),
      SeatStatus.mine => (bg: scheme.secondaryContainer, fg: scheme.onSecondaryContainer),
      SeatStatus.available when selected => (bg: scheme.primary, fg: scheme.onPrimary),
      SeatStatus.available => (bg: Colors.transparent, fg: scheme.onSurfaceVariant),
    };

    return Tooltip(
      message: '${seat.label} · ${seat.type.label} · ${seat.price}',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          width: isCouple ? _size + 14 : _size,
          height: _size,
          margin: const EdgeInsets.all(3),
          decoration: BoxDecoration(
            color: selected || seat.status != SeatStatus.available
                ? colors.bg
                : scheme.surfaceContainerLow,
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(6),
              topRight: Radius.circular(6),
              bottomLeft: Radius.circular(isCouple ? 12 : 6),
              bottomRight: Radius.circular(isCouple ? 12 : 6),
            ),
            border: Border.all(
              color: selected ? scheme.primary : scheme.outlineVariant,
              width: selected ? 2 : 1,
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            seat.status == SeatStatus.sold ? '×' : '${seat.number}',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: selected ? scheme.onPrimary : colors.fg,
            ),
          ),
        ),
      ),
    );
  }
}

class SeatLegend extends StatelessWidget {
  const SeatLegend({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Wrap(
      spacing: 14,
      runSpacing: 6,
      children: [
        _LegendItem(color: scheme.surfaceContainerLow, border: scheme.outlineVariant, label: 'Tersedia'),
        _LegendItem(color: scheme.primary, label: 'Dipilih'),
        _LegendItem(color: scheme.secondaryContainer, label: 'Kunci Anda'),
        _LegendItem(color: scheme.tertiaryContainer, label: 'Sedang dikunci'),
        _LegendItem(color: scheme.surfaceContainerHighest, label: 'Terisi'),
      ],
    );
  }
}

class _LegendItem extends StatelessWidget {
  const _LegendItem({
    required this.color,
    required this.label,
    this.border,
  });

  final Color color;
  final String label;
  final Color? border;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 14,
          height: 14,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(3),
            border: Border.all(color: border ?? Colors.transparent),
          ),
        ),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant)),
      ],
    );
  }
}
