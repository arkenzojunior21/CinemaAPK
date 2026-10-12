import 'package:intl/intl.dart';

class Formatters {
  Formatters._();

  static String rupiah(num amount) {
    final nf = NumberFormat.currency(locale: 'id_ID', symbol: 'Rp', decimalDigits: 0);
    return nf.format(amount);
  }

  static String duration(int minutes) {
    if (minutes < 60) return '$minutes mnt';
    final h = minutes ~/ 60;
    final m = minutes % 60;
    return m == 0 ? '$h jam' : '$h jam $m mnt';
  }

  static String clock(DateTime dt) => DateFormat.Hm().format(dt);

  static String dateShort(DateTime dt) => DateFormat('EEE, d MMM', 'id_ID').format(dt);

  static String dateFull(DateTime dt) => DateFormat('d MMMM yyyy', 'id_ID').format(dt);
}
