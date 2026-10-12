import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/providers/auth_controller.dart';
import '../../../core/providers/theme_controller.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/app_feedback.dart';
import '../../../shared/widgets/info_row.dart';

class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    final mode = ref.watch(themeControllerProvider);
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Akun')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
        children: [
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 24,
                      backgroundColor: scheme.primaryContainer,
                      child: Text(
                        (user?.fullName ?? '?').substring(0, 1).toUpperCase(),
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          color: scheme.onPrimaryContainer,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        user?.fullName ?? 'Tamu',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                InfoRow(label: 'Email', value: user?.email ?? '-'),
                InfoRow(label: 'Telepon', value: user?.phone ?? '-'),
                InfoRow(label: 'Peran', value: user?.role ?? 'customer'),
              ],
            ),
          ),
          const SizedBox(height: 14),
          const SectionHeader(title: 'Tampilan'),
          AppCard(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Column(
              children: [
                for (final option in const [
                  (ThemeMode.system, 'Ikuti sistem', Icons.brightness_auto_outlined),
                  (ThemeMode.light, 'Light mode', Icons.light_mode_outlined),
                  (ThemeMode.dark, 'Dark mode', Icons.dark_mode_outlined),
                ])
                  ListTile(
                    dense: true,
                    leading: Icon(option.$3),
                    title: Text(option.$2),
                    trailing: mode == option.$1
                        ? Icon(Icons.check_circle, color: scheme.primary)
                        : null,
                    onTap: () => ref.read(themeControllerProvider.notifier).setMode(option.$1),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          AppButton(
            label: 'Keluar',
            icon: Icons.logout,
            variant: AppButtonVariant.danger,
            expanded: true,
            onPressed: () async {
              final confirmed = await confirmAction(
                context,
                title: 'Keluar dari akun?',
                message: 'Anda perlu masuk lagi untuk memesan tiket.',
                confirmLabel: 'Keluar',
                destructive: true,
              );
              if (!confirmed) return;
              await ref.read(authControllerProvider.notifier).logout();
              if (context.mounted) context.go('/login');
            },
          ),
        ],
      ),
    );
  }
}
