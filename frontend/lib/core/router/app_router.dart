import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/ai/presentation/chat_page.dart';
import '../../features/ai/presentation/quiz_page.dart';
import '../../features/auth/presentation/login_page.dart';
import '../../features/auth/presentation/register_page.dart';
import '../../features/bookings/presentation/my_tickets_page.dart';
import '../../features/bookings/presentation/ticket_detail_page.dart';
import '../../features/fnb/presentation/fnb_page.dart';
import '../../features/home/presentation/home_page.dart';
import '../../features/movies/presentation/movie_detail_page.dart';
import '../../features/profile/presentation/profile_page.dart';
import '../../features/seats/presentation/seat_selection_page.dart';
import '../../features/shell/presentation/app_shell.dart';
import '../../features/showtimes/presentation/showtimes_page.dart';
import '../../features/splash/presentation/splash_page.dart';
import '../../features/split/presentation/split_setup_page.dart';
import '../../features/split/presentation/split_share_page.dart';
import '../../features/payments/presentation/payment_page.dart';
import '../providers/auth_controller.dart';

final rootNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'root');

final appRouterProvider = Provider<GoRouter>((ref) {
  final loggedIn = ref.watch(authControllerProvider).isLoggedIn;

  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/',
    redirect: (context, state) {
      final location = state.matchedLocation;
      final isPublic = location == '/' || location == '/login' || location == '/register';
      if (!loggedIn && !isPublic) return '/login';
      if (loggedIn && (location == '/login' || location == '/register')) return '/home';
      return null;
    },
    routes: [
      GoRoute(
        path: '/',
        parentNavigatorKey: rootNavigatorKey,
        builder: (context, state) => const SplashPage(),
      ),
      GoRoute(
        path: '/login',
        parentNavigatorKey: rootNavigatorKey,
        builder: (context, state) => const LoginPage(),
      ),
      GoRoute(
        path: '/register',
        parentNavigatorKey: rootNavigatorKey,
        builder: (context, state) => const RegisterPage(),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            AppShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/home', builder: (context, state) => const HomePage()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/tickets', builder: (context, state) => const MyTicketsPage()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/profile', builder: (context, state) => const ProfilePage()),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/movies/:id',
        builder: (context, state) => MovieDetailPage(movieId: state.pathParameters['id']!),
        routes: [
          GoRoute(
            path: 'showtimes',
            builder: (context, state) => ShowtimesPage(
              movieId: state.pathParameters['id']!,
              movieTitle: state.extra is String ? state.extra as String : null,
            ),
          ),
        ],
      ),
      GoRoute(
        path: '/showtimes/:id/seats',
        builder: (context, state) => SeatSelectionPage(showtimeId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/ticket/:id',
        builder: (context, state) => TicketDetailPage(bookingId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/fnb/:id',
        builder: (context, state) => FnbPage(bookingId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/ai/quiz', builder: (context, state) => const QuizPage()),
      GoRoute(path: '/ai/chat', builder: (context, state) => const ChatPage()),
      GoRoute(
        path: '/split/:bookingId',
        builder: (context, state) =>
            SplitSetupPage(bookingId: state.pathParameters['bookingId']!),
      ),
      GoRoute(
        path: '/split-bill/:id',
        builder: (context, state) => SplitSharePage(splitId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/pay/:bookingId',
        builder: (context, state) => PaymentPage(
          bookingId: state.pathParameters['bookingId']!,
          participantId: state.uri.queryParameters['participant'],
          splitId: state.uri.queryParameters['split'],
          shareLabel: state.uri.queryParameters['name'],
        ),
      ),
    ],
  );
});
