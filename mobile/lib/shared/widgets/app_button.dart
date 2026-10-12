import 'package:flutter/material.dart';

enum AppButtonVariant { primary, secondary, text, danger }

class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    this.onPressed,
    this.variant = AppButtonVariant.primary,
    this.loading = false,
    this.icon,
    this.expanded = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final AppButtonVariant variant;
  final bool loading;
  final IconData? icon;
  final bool expanded;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final enabled = onPressed != null && !loading;

    final child = Row(
      mainAxisAlignment: MainAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (loading)
          SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2.2,
              color: _foreground(scheme),
            ),
          )
        else if (icon != null)
          Icon(icon, size: 20, color: _foreground(scheme)),
        if (loading || icon != null) const SizedBox(width: 10),
        Text(
          label,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: _foreground(scheme),
            fontSize: 15,
          ),
        ),
      ],
    );

    final button = switch (variant) {
      AppButtonVariant.primary => FilledButton(onPressed: enabled ? onPressed : null, child: child),
      AppButtonVariant.secondary => OutlinedButton(
          onPressed: enabled ? onPressed : null,
          child: child,
        ),
      AppButtonVariant.text => TextButton(
          onPressed: enabled ? onPressed : null,
          child: child,
        ),
      AppButtonVariant.danger => FilledButton.tonalIcon(
          onPressed: enabled ? onPressed : null,
          icon: Icon(Icons.delete_outline, color: scheme.error),
          label: Text(
            label,
            style: TextStyle(fontWeight: FontWeight.w600, color: scheme.error),
          ),
        ),
    };

    return SizedBox(
      height: 50,
      width: expanded ? double.infinity : null,
      child: button,
    );
  }

  Color _foreground(ColorScheme scheme) => switch (variant) {
        AppButtonVariant.primary => scheme.onPrimary,
        AppButtonVariant.secondary => scheme.primary,
        AppButtonVariant.text => scheme.primary,
        AppButtonVariant.danger => scheme.error,
      };
}
