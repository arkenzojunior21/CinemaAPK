/**
 * Demo server in-memory untuk CineGen.
 *
 * Bicara dengan kontrak HTTP yang sama persis dengan backend asli
 * (lihat docs/api-spec.md dan src/modules/*), tetapi seluruh data hidup di memori:
 * tanpa PostgreSQL, tanpa Redis. Dipakai untuk demo Flutter UI di perangkat asli.
 *
 * Jalankan dari folder backend/:  npx tsx tools/demo-server.ts
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';

/* ------------------------------------------------------------------ */
/* Konfigurasi & helper umum                                          */
/* ------------------------------------------------------------------ */

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.DEMO_BASE_URL ?? `http://localhost:${PORT}`;
const ACCESS_TTL_SECONDS = 900;
const SEAT_LOCK_TTL_SECONDS = 900;
const SPLIT_TTL_MINUTES = 1440;
const MAX_SEATS_PER_LOCK = 10;
const QR_SECRET = 'cinegen-demo-secret';
const SEAT_ROWS = 10;
const SEAT_COLS = 8;
/** Harga per tipe kursi (kelipatan base_price studio). */
const SEAT_MULTIPLIER = { regular: 1.0, premium: 1.5, couple: 2.0 } as const;
type SeatType = keyof typeof SEAT_MULTIPLIER;

class DemoError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DemoError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data });
}

function checkUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) {
    throw new DemoError(422, 'VALIDATION_ERROR', `${label} tidak valid`);
  }
  return value;
}

/** Express 5 mengetik params sebagai string | string[]; route demo ini selalu satu segmen. */
function pathParam(req: Request, name: string): string {
  const raw = (req.params as Record<string, string | string[] | undefined>)[name];
  return (Array.isArray(raw) ? raw[0] : raw) ?? '';
}

/** Query string -> string | null (kosong dianggap tidak diisi). */
function qstr(req: Request, name: string): string | null {
  const raw = req.query[name];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

function qint(req: Request, name: string, fallback: number): number {
  const raw = qstr(req, name);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function paginate<T>(items: readonly T[], page: number, limit: number) {
  const total = items.length;
  return {
    items: items.slice((page - 1) * limit, page * limit),
    meta: { page, limit, total_items: total, total_pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}

/** Uang selalu integer rupiah. */
function rupee(value: number): number {
  return Math.round(value);
}

/** Tanggal lokal (YYYY-MM-DD) — filter ?date= dari aplikasi memakai tanggal lokal. */
function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

function numericId(length: number): string {
  let digits = '';
  for (const byte of randomBytes(length)) digits += String(byte % 10);
  return digits;
}

const generateBookingCode = () => `CG-${randomCode(6)}`;
const generatePickupCode = () => `FNB-${randomCode(4)}`;
const generateTicketCode = () => `TK-${randomCode(6)}`;
const generateShareToken = () => `sp_${randomBytes(8).toString('hex')}`;

/** QR e-ticket: cinegen:<ticket|fnb>:<kode>:<booking_code>:<hmac-sha256 hex>. */
function qrSignature(kind: string, code: string, bookingCode: string): string {
  return createHmac('sha256', QR_SECRET).update(`${kind}|${code}|${bookingCode}`).digest('hex');
}

function buildTicketQr(kind: 'ticket' | 'fnb', code: string, bookingCode: string): string {
  return `cinegen:${kind}:${code}:${bookingCode}:${qrSignature(kind, code, bookingCode)}`;
}

/* ------------------------------------------------------------------ */
/* Payload QRIS (EMVCo TLV + CRC-16/CCITT-FALSE pada tag 63)          */
/* ------------------------------------------------------------------ */

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function buildQrisPayload(input: {
  reference: string;
  amount: number;
  merchantName?: string;
  merchantCity?: string;
}): string {
  const reference = input.reference.slice(0, 24);
  const body = [
    tlv('00', '01'),
    tlv('01', '12'),
    tlv('29', tlv('00', 'ID.CO.CINEGEN') + tlv('01', reference)),
    tlv('30', tlv('00', 'CINEGEN') + tlv('01', 'ID')),
    tlv('52', '5044'),
    tlv('53', '360'),
    tlv('54', String(input.amount)),
    tlv('58', 'ID'),
    tlv('59', (input.merchantName ?? 'CINEGEN').slice(0, 25)),
    tlv('60', (input.merchantCity ?? 'JAKARTA').slice(0, 15)),
    tlv('62', tlv('01', reference)),
    '6304',
  ].join('');
  return `${body}${crc16(body)}`;
}

/* ------------------------------------------------------------------ */
/* Model data                                                          */
/* ------------------------------------------------------------------ */

interface CinemaRow {
  id: string;
  chain: string;
  name: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface StudioRow {
  id: string;
  cinema_id: string;
  name: string;
  seat_rows: number;
  seat_cols: number;
  screen_types: string[];
  format: string;
  base_price: number;
}

interface SeatRow {
  id: string;
  studio_id: string;
  row: string;
  number: number;
  type: SeatType;
  multiplier: number;
}

interface MovieRow {
  id: string;
  title: string;
  slug: string;
  synopsis: string;
  genres: string[];
  duration_minutes: number;
  age_rating: string;
  language: string;
  rating_score: number | null;
  release_date: string;
  status: 'now_showing' | 'upcoming';
  poster_url: string;
  backdrop_url: string;
  trailer_url: string;
}

interface ShowtimeRow {
  id: string;
  movie_id: string;
  studio_id: string;
  starts_at: Date;
  ends_at: Date;
  base_price: number;
  format: string;
  language: string;
  subtitle: string;
  is_active: boolean;
}

interface FnbItemRow {
  id: string;
  cinema_id: string;
  name: string;
  description: string;
  category: 'food' | 'beverage' | 'combo';
  price: number;
  image_url: string;
}

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: 'user' | 'admin';
  password: string;
  created_at: Date;
}

type ReservationStatus = 'locked' | 'confirmed' | 'released';

interface ReservationRow {
  id: string;
  showtime_id: string;
  seat_id: string;
  user_id: string | null;
  status: ReservationStatus;
  expires_at: Date;
  booking_id: string | null;
}

interface BookingRow {
  id: string;
  booking_code: string;
  user_id: string;
  showtime_id: string;
  status: 'pending_payment' | 'partially_paid' | 'paid' | 'cancelled' | 'expired';
  ticket_total: number;
  fnb_total: number;
  grand_total: number;
  payment_due_at: Date;
  created_at: Date;
  paid_at: Date | null;
  ticket_code: string | null;
  ticket_issued_at: Date | null;
}

interface FnbOrderRow {
  id: string;
  booking_id: string;
  user_id: string;
  status: 'pending' | 'paid' | 'cancelled';
  total_amount: number;
  pickup_code: string;
  items: { fnb_item_id: string; name: string; quantity: number; unit_price: number; subtotal: number }[];
  created_at: Date;
}

interface SplitParticipantRow {
  id: string;
  name: string;
  user_id: string | null;
  share_amount: number;
  status: 'pending' | 'paid';
  paid_at: Date | null;
}

interface SplitBillRow {
  id: string;
  booking_id: string;
  host_user_id: string;
  method: 'equal' | 'custom';
  total_amount: number;
  status: 'pending' | 'partially_paid' | 'paid' | 'cancelled';
  share_token: string;
  expires_at: Date;
  created_at: Date;
  participants: SplitParticipantRow[];
}

interface PaymentRow {
  id: string;
  booking_id: string;
  user_id: string;
  participant_id: string | null;
  channel: 'qris' | 'virtual_account' | 'ewallet';
  amount: number;
  status: 'pending' | 'settled' | 'failed' | 'expired';
  gateway: string;
  transaction_id: string;
  charge: Record<string, unknown>;
  created_at: Date;
  settled_at: Date | null;
}

/* ------------------------------------------------------------------ */
/* Seed: bioskop, studio, kursi, film, jadwal, F&B                     */
/* ------------------------------------------------------------------ */

const cinemas = new Map<string, CinemaRow>();
const studios = new Map<string, StudioRow>();
const seats: SeatRow[] = [];
const movies = new Map<string, MovieRow>();
const showtimes = new Map<string, ShowtimeRow>();
const fnbItems = new Map<string, FnbItemRow>();

const users = new Map<string, UserRow>();
const accessTokens = new Map<string, string>();
const refreshTokens = new Map<string, string>();
const reservations = new Map<string, ReservationRow>();
const bookings = new Map<string, BookingRow>();
const fnbOrders = new Map<string, FnbOrderRow>();
const splitBills = new Map<string, SplitBillRow>();
const payments = new Map<string, PaymentRow>();

const CINEMA_SEED = [
  {
    chain: 'CGV', name: 'CGV Grand Indonesia', city: 'Jakarta',
    address: 'Jl. M.H. Thamrin No.1, Jakarta Pusat', latitude: -6.195, longitude: 106.82,
    studios: [
      { name: 'Studio 1', screen_types: ['regular'], format: '2D', base_price: 42000 },
      { name: 'Studio 2 IMAX', screen_types: ['imax'], format: 'IMAX', base_price: 68000 },
    ],
  },
  {
    chain: 'XXI', name: 'XXI Senayan City', city: 'Jakarta',
    address: 'Jl. Asia Afrika No.8, Jakarta Selatan', latitude: -6.225, longitude: 106.8,
    studios: [
      { name: 'Studio 1', screen_types: ['regular'], format: '2D', base_price: 45000 },
      { name: 'Studio 2 3D', screen_types: ['3d'], format: '3D', base_price: 58000 },
    ],
  },
  {
    chain: 'CGV', name: 'CGV Paris Van Java', city: 'Bandung',
    address: 'Jl. Sukajadi No.137-139, Bandung', latitude: -6.8794, longitude: 107.6203,
    studios: [
      { name: 'Studio 1', screen_types: ['regular'], format: '2D', base_price: 38000 },
      { name: 'Studio 2 4DX', screen_types: ['4dx'], format: '4DX', base_price: 72000 },
    ],
  },
  {
    chain: 'XXI', name: 'XXI 23 Paskal', city: 'Bandung',
    address: 'Jl. Pasir Kaliki No.25-27, Bandung', latitude: -6.9034, longitude: 107.5979,
    studios: [
      { name: 'Studio 1', screen_types: ['regular'], format: '2D', base_price: 35000 },
      { name: 'Studio 2 3D', screen_types: ['3d'], format: '3D', base_price: 52000 },
    ],
  },
];

const MOVIE_SEED: Omit<MovieRow, 'id' | 'poster_url' | 'backdrop_url' | 'trailer_url'>[] = [
  {
    title: 'Interstellar', slug: 'interstellar', status: 'now_showing',
    synopsis: 'Saat Bumi tak lagi layak huni, seorang petani dan mantan pilot NASA memimpin misi melewati wormhole untuk mencari rumah baru bagi umat manusia.',
    genres: ['Sci-Fi', 'Drama', 'Adventure'], duration_minutes: 169, age_rating: '13+',
    language: 'English', rating_score: 9.3, release_date: '2014-11-06',
  },
  {
    title: 'Inside Out 2', slug: 'inside-out-2', status: 'now_showing',
    synopsis: 'Emosi baru muncul di markas besar pikiran Riley saat ia memasuki masa remaja dan menghadapi tekanan pertemanan.',
    genres: ['Animation', 'Family', 'Comedy'], duration_minutes: 96, age_rating: 'SU',
    language: 'English', rating_score: 8.0, release_date: '2024-06-12',
  },
  {
    title: 'Deadpool & Wolverine', slug: 'deadpool-wolverine', status: 'now_showing',
    synopsis: 'Deadpool bergabung dengan Wolverine dalam misi menyelamatkan garis waktu sembari berantah ke sana ke mari.',
    genres: ['Action', 'Comedy', 'Superhero'], duration_minutes: 128, age_rating: '17+',
    language: 'English', rating_score: 8.1, release_date: '2024-07-24',
  },
  {
    title: 'KKN di Desa Penari', slug: 'kkn-di-desa-penari', status: 'now_showing',
    synopsis: 'Enam mahasiswa terkena kutukan setelah melanggar aturan tak tertulis saat melakukan KKN di sebuah desa terpencil.',
    genres: ['Horror', 'Thriller', 'Drama'], duration_minutes: 106, age_rating: '17+',
    language: 'Indonesian', rating_score: 7.4, release_date: '2022-04-30',
  },
  {
    title: 'Miracle in Cell No. 7', slug: 'miracle-in-cell-no-7', status: 'now_showing',
    synopsis: 'Seorang ayah dengan keterbatasan intelektual berjuang membuktikan dirinya tidak bersalah demi putrinya.',
    genres: ['Drama', 'Family'], duration_minutes: 136, age_rating: '13+',
    language: 'Indonesian', rating_score: 8.4, release_date: '2022-12-25',
  },
  {
    title: 'Dune: Part Two', slug: 'dune-part-two', status: 'now_showing',
    synopsis: 'Paul Atreides bergabung dengan bangsa Fremen untuk membalaskan dendam keluarganya di planet Arrakis.',
    genres: ['Sci-Fi', 'Adventure', 'Action'], duration_minutes: 166, age_rating: '13+',
    language: 'English', rating_score: 8.5, release_date: '2024-02-28',
  },
  {
    title: 'Avatar: Fire and Ash', slug: 'avatar-fire-and-ash', status: 'upcoming',
    synopsis: 'Keluarga Sully meninggalkan rumah dan bertemu klan Abu yang membakar jalan mereka di Pandora.',
    genres: ['Sci-Fi', 'Adventure', 'Action'], duration_minutes: 195, age_rating: '13+',
    language: 'English', rating_score: null, release_date: '2026-12-18',
  },
  {
    title: 'Jumbo: Petualangan Kedua', slug: 'jumbo-petualangan-kedua', status: 'upcoming',
    synopsis: 'Sekuel animasi lokal tentang persahabatan, keberanian, dan satu karnaval yang hampir tutup.',
    genres: ['Animation', 'Family', 'Adventure'], duration_minutes: 92, age_rating: 'SU',
    language: 'Indonesian', rating_score: null, release_date: '2026-12-25',
  },
];

const FNB_SEED: Omit<FnbItemRow, 'id' | 'cinema_id' | 'image_url'>[] = [
  { name: 'Popcorn Regular', description: 'Popcorn manis ukuran regular', category: 'food', price: 40000 },
  { name: 'Popcorn Caramel', description: 'Popcorn karamel ukuran besar', category: 'food', price: 50000 },
  { name: 'Hotdog Jumbo', description: 'Hotdog jumbo dengan saus spesial', category: 'food', price: 35000 },
  { name: 'Cola Large', description: 'Minuman bersoda ukuran besar', category: 'beverage', price: 28000 },
  { name: 'Lemon Tea', description: 'Es teh lemon segar', category: 'beverage', price: 25000 },
  { name: 'Air Mineral', description: 'Air mineral botol 600ml', category: 'beverage', price: 12000 },
  { name: 'Combo Hemat', description: 'Popcorn regular + cola large', category: 'combo', price: 60000 },
  { name: 'Combo Keluarga', description: 'Popcorn besar + 2 lemon tea', category: 'combo', price: 85000 },
];

function seedCatalog(): void {
  for (const seed of CINEMA_SEED) {
    const cinemaId = randomUUID();
    cinemas.set(cinemaId, {
      id: cinemaId, chain: seed.chain, name: seed.name, city: seed.city,
      address: seed.address, latitude: seed.latitude, longitude: seed.longitude,
    });

    for (const studioSeed of seed.studios) {
      const studioId = randomUUID();
      studios.set(studioId, {
        id: studioId, cinema_id: cinemaId, name: studioSeed.name,
        seat_rows: SEAT_ROWS, seat_cols: SEAT_COLS, screen_types: studioSeed.screen_types,
        format: studioSeed.format, base_price: studioSeed.base_price,
      });
      for (let row = 0; row < SEAT_ROWS; row += 1) {
        const label = String.fromCharCode(65 + row);
        const type: SeatType = row < 2 ? 'premium' : row === SEAT_ROWS - 1 ? 'couple' : 'regular';
        for (let number = 1; number <= SEAT_COLS; number += 1) {
          seats.push({
            id: randomUUID(), studio_id: studioId, row: label, number, type,
            multiplier: SEAT_MULTIPLIER[type],
          });
        }
      }
    }

    for (const item of FNB_SEED) {
      const itemId = randomUUID();
      fnbItems.set(itemId, {
        ...item, id: itemId, cinema_id: cinemaId,
        image_url: `https://picsum.photos/seed/fnb-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/300/300`,
      });
    }
  }

  for (const seed of MOVIE_SEED) {
    const id = randomUUID();
    movies.set(id, {
      ...seed, id,
      poster_url: `https://picsum.photos/seed/${seed.slug}/400/600`,
      backdrop_url: `https://picsum.photos/seed/${seed.slug}-wide/1600/720`,
      trailer_url: `https://www.youtube.com/watch?v=${seed.slug}`,
    });
  }
}

/** Jadwal 7 hari (hari ini + 6) mengikuti chip tanggal di halaman jadwal. */
const SHOWTIME_SLOTS = [{ h: 11, m: 0 }, { h: 14, m: 0 }, { h: 18, m: 0 }, { h: 20, m: 30 }, { h: 22, m: 15 }];

function seedShowtimes(): void {
  const showing = [...movies.values()].filter((movie) => movie.status === 'now_showing');
  const studioList = [...studios.values()];
  let cursor = 0;

  for (let day = 0; day < 7; day += 1) {
    for (const slot of SHOWTIME_SLOTS) {
      for (const studio of studioList) {
        const movie = showing[cursor % showing.length];
        cursor += 1;
        const startsAt = new Date();
        startsAt.setHours(slot.h, slot.m, 0, 0);
        startsAt.setDate(startsAt.getDate() + day);
        const id = randomUUID();
        showtimes.set(id, {
          id, movie_id: movie.id, studio_id: studio.id,
          starts_at: startsAt, ends_at: addMinutes(startsAt, movie.duration_minutes),
          base_price: studio.base_price, format: studio.format,
          language: movie.language, subtitle: 'Indonesian', is_active: true,
        });
      }
    }
  }
}

function seedDemoUser(): void {
  const id = randomUUID();
  users.set(id, {
    id, full_name: 'Penonton Demo', email: 'demo@cinegen.id', phone: '081234567890',
    role: 'user', password: 'demo1234', created_at: new Date(),
  });
}

/** Penonton semu: sebagian kursi terlihat sudah laku/dikunci agar peta kursi hidup. */
function occupancyOf(showtimeId: string, seatId: string): 'sold' | 'locked' | null {
  let hash = 2166136261;
  for (const text of `${showtimeId}|${seatId}`) {
    hash ^= text.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const value = (hash >>> 0) / 4294967295;
  if (value < 0.16) return 'sold';
  if (value < 0.19) return 'locked';
  return null;
}

/* ------------------------------------------------------------------ */
/* Lookup & pemetaan                                                   */
/* ------------------------------------------------------------------ */

function mustFindShowtime(id: string): ShowtimeRow {
  checkUuid(id, 'ID jadwal tayang');
  const showtime = showtimes.get(id);
  if (!showtime || !showtime.is_active) {
    throw new DemoError(404, 'NOT_FOUND', 'Jadwal tayang tidak ditemukan.');
  }
  return showtime;
}

function mustFindBooking(id: string, userId: string): BookingRow {
  checkUuid(id, 'ID');
  const booking = bookings.get(id);
  if (!booking || booking.user_id !== userId) {
    throw new DemoError(404, 'NOT_FOUND', 'Booking tidak ditemukan.');
  }
  return booking;
}

function seatPrice(showtime: ShowtimeRow, seat: SeatRow): number {
  return rupee(showtime.base_price * seat.multiplier);
}

function seatsOfStudio(studioId: string): SeatRow[] {
  return seats.filter((seat) => seat.studio_id === studioId);
}

/** Buang lock yang sudah kedaluwarsa (persis seperti pembersihan lazy di backend). */
function purgeExpiredLocks(): void {
  const now = Date.now();
  for (const [id, reservation] of reservations) {
    if (reservation.status === 'locked' && reservation.expires_at.getTime() <= now) {
      reservations.delete(id);
    }
  }
}

function activeReservation(showtimeId: string, seatId: string): ReservationRow | null {
  for (const reservation of reservations.values()) {
    if (reservation.showtime_id === showtimeId && reservation.seat_id === seatId
      && (reservation.status === 'locked' || reservation.status === 'confirmed')) {
      return reservation;
    }
  }
  return null;
}

function seatStatus(showtimeId: string, seatId: string, userId: string | null): string {
  const reservation = activeReservation(showtimeId, seatId);
  if (reservation) {
    if (reservation.status === 'confirmed') return 'sold';
    return reservation.user_id === userId ? 'mine' : 'locked';
  }
  return occupancyOf(showtimeId, seatId) ?? 'available';
}

function movieBrief(id: string) {
  const movie = movies.get(id);
  if (!movie) throw new DemoError(404, 'NOT_FOUND', 'Film tidak ditemukan.');
  return movie;
}

function cinemaOfShowtime(showtime: ShowtimeRow) {
  const studio = studios.get(showtime.studio_id)!;
  return { studio, cinema: cinemas.get(studio.cinema_id)! };
}

function splitOfBooking(bookingId: string): SplitBillRow | null {
  for (const split of splitBills.values()) {
    if (split.booking_id === bookingId && (split.status === 'pending' || split.status === 'partially_paid')) {
      return split;
    }
  }
  return null;
}

function bookingSeats(bookingId: string) {
  return [...reservations.values()]
    .filter((r) => r.booking_id === bookingId && r.status === 'confirmed')
    .map((r) => seats.find((seat) => seat.id === r.seat_id)!)
    .filter((seat) => seat !== undefined)
    .sort((a, b) => a.row.localeCompare(b.row) || a.number - b.number)
    .map((seat) => ({ row: seat.row, number: seat.number, type: seat.type }));
}

function bookingDetail(booking: BookingRow) {
  const showtime = showtimes.get(booking.showtime_id)!;
  const movie = movieBrief(showtime.movie_id);
  const { studio, cinema } = cinemaOfShowtime(showtime);
  return {
    id: booking.id,
    booking_code: booking.booking_code,
    status: booking.status,
    totals: { ticket: booking.ticket_total, fnb: booking.fnb_total, grand: booking.grand_total },
    payment_due_at: booking.payment_due_at,
    paid_at: booking.paid_at,
    created_at: booking.created_at,
    showtime: { id: showtime.id, starts_at: showtime.starts_at, format: showtime.format },
    movie: {
      id: movie.id, title: movie.title, poster_url: movie.poster_url,
      age_rating: movie.age_rating, duration_minutes: movie.duration_minutes,
    },
    cinema: { id: cinema.id, name: cinema.name, chain: cinema.chain, city: cinema.city },
    studio: studio.name,
    seats: bookingSeats(booking.id),
  };
}

/* ------------------------------------------------------------------ */
/* Autentikasi (token acak opaque)                                     */
/* ------------------------------------------------------------------ */

function issueTokens(user: UserRow) {
  const accessToken = `demoat_${randomBytes(24).toString('hex')}`;
  const refreshToken = `demort_${randomBytes(32).toString('hex')}`;
  accessTokens.set(accessToken, user.id);
  refreshTokens.set(refreshToken, user.id);
  return { access_token: accessToken, refresh_token: refreshToken, expires_in: ACCESS_TTL_SECONDS };
}

function currentUser(req: Request): UserRow | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const userId = accessTokens.get(header.slice(7));
  return userId ? users.get(userId) ?? null : null;
}

function requireUser(req: Request): UserRow {
  const user = currentUser(req);
  if (!user) throw new DemoError(401, 'UNAUTHORIZED', 'Token tidak ditemukan.');
  return user;
}

function publicUser(user: UserRow) {
  return { id: user.id, full_name: user.full_name, email: user.email, phone: user.phone, role: user.role };
}

/* ------------------------------------------------------------------ */
/* Route: auth                                                          */
/* ------------------------------------------------------------------ */

const authRouter = express.Router();

function authBody(req: Request): Record<string, unknown> {
  const body = req.body;
  if (typeof body !== 'object' || body === null) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'Body request tidak valid.');
  }
  return body as Record<string, unknown>;
}

function str(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === 'string' ? value.trim() : null;
}

authRouter.post('/register', (req: Request, res: Response) => {
  const body = authBody(req);
  const fullName = str(body, 'full_name') ?? '';
  const email = (str(body, 'email') ?? '').toLowerCase();
  const password = str(body, 'password') ?? '';
  const phone = str(body, 'phone');

  if (fullName.length < 2 || fullName.length > 100) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'full_name: Nama minimal 2 karakter');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'email: Format email tidak valid');
  }
  if (phone !== null && phone !== '' && !/^\+?[0-9]{8,15}$/.test(phone)) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'phone: Nomor telepon tidak valid');
  }
  if (password.length < 8) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'password: Password minimal 8 karakter');
  }
  for (const existing of users.values()) {
    if (existing.email === email) throw new DemoError(409, 'EMAIL_ALREADY_USED', 'Email sudah terdaftar.');
    if (phone && existing.phone === phone) throw new DemoError(409, 'PHONE_ALREADY_USED', 'Nomor telepon sudah terdaftar.');
  }

  const id = randomUUID();
  const user: UserRow = {
    id, full_name: fullName, email, phone: phone || null, role: 'user', password, created_at: new Date(),
  };
  users.set(id, user);
  ok(res, { user: publicUser(user), tokens: issueTokens(user) }, 201);
});

authRouter.post('/login', (req: Request, res: Response) => {
  const body = authBody(req);
  const email = (str(body, 'email') ?? '').toLowerCase();
  const password = str(body, 'password') ?? '';
  const user = [...users.values()].find((candidate) => candidate.email === email);
  if (!user || user.password !== password) {
    throw new DemoError(401, 'INVALID_CREDENTIALS', 'Email atau password salah.');
  }
  ok(res, { user: publicUser(user), tokens: issueTokens(user) });
});

authRouter.post('/refresh', (req: Request, res: Response) => {
  const token = str(authBody(req), 'refresh_token');
  const userId = token ? refreshTokens.get(token) : undefined;
  const user = userId ? users.get(userId) : undefined;
  if (!user) throw new DemoError(401, 'UNAUTHORIZED', 'Refresh token tidak dikenali.');
  refreshTokens.delete(token as string);
  ok(res, { user: publicUser(user), tokens: issueTokens(user) });
});

authRouter.post('/logout', (req: Request, res: Response) => {
  requireUser(req);
  const token = str(authBody(req), 'refresh_token');
  if (token) refreshTokens.delete(token);
  ok(res, { message: 'Logout berhasil.' });
});

authRouter.get('/me', (req: Request, res: Response) => {
  const user = requireUser(req);
  ok(res, { ...publicUser(user), created_at: user.created_at });
});

/* ------------------------------------------------------------------ */
/* Route: movies, cinemas, fnb katalog                                  */
/* ------------------------------------------------------------------ */

function movieSummary(movie: MovieRow) {
  return {
    id: movie.id, title: movie.title, slug: movie.slug, genres: movie.genres,
    duration_minutes: movie.duration_minutes, age_rating: movie.age_rating, language: movie.language,
    poster_url: movie.poster_url, rating_score: movie.rating_score, release_date: movie.release_date,
    status: movie.status,
  };
}

function hasFutureShowtimeInCity(movieId: string, city: string): boolean {
  const now = Date.now();
  for (const showtime of showtimes.values()) {
    if (showtime.movie_id !== movieId || !showtime.is_active || showtime.starts_at.getTime() <= now) continue;
    if (cinemaOfShowtime(showtime).cinema.city.toLowerCase() === city.toLowerCase()) return true;
  }
  return false;
}

const moviesRouter = express.Router();

moviesRouter.get('/', (req: Request, res: Response) => {
  const status = qstr(req, 'status') ?? 'now_showing';
  const genre = qstr(req, 'genre');
  const search = qstr(req, 'search');
  const city = qstr(req, 'city');
  const page = qint(req, 'page', 1);
  const limit = Math.min(qint(req, 'limit', 10), 50);

  const filtered = [...movies.values()]
    .filter((movie) => movie.status === status)
    .filter((movie) => !genre || movie.genres.some((g) => g.toLowerCase() === genre.toLowerCase()))
    .filter((movie) => !search
      || movie.title.toLowerCase().includes(search.toLowerCase())
      || movie.slug.toLowerCase().includes(search.toLowerCase()))
    .filter((movie) => !city || hasFutureShowtimeInCity(movie.id, city))
    .sort((a, b) => b.release_date.localeCompare(a.release_date) || a.title.localeCompare(b.title));

  ok(res, paginate(filtered.map(movieSummary), page, limit));
});

moviesRouter.get('/:id', (req: Request, res: Response) => {
  const movie = movieBrief(checkUuid(pathParam(req, 'id'), 'ID film'));
  ok(res, { ...movieSummary(movie), synopsis: movie.synopsis, backdrop_url: movie.backdrop_url, trailer_url: movie.trailer_url });
});

const cinemasRouter = express.Router();

function cinemaSummary(cinema: CinemaRow) {
  return {
    id: cinema.id, chain: cinema.chain, name: cinema.name, city: cinema.city,
    address: cinema.address, latitude: cinema.latitude, longitude: cinema.longitude,
  };
}

cinemasRouter.get('/', (req: Request, res: Response) => {
  const city = qstr(req, 'city');
  const items = [...cinemas.values()]
    .filter((cinema) => !city || cinema.city.toLowerCase() === city.toLowerCase())
    .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name))
    .map(cinemaSummary);
  ok(res, { items });
});

/** Katalog F&B bioskop (publik) — datanya array polos, sama seperti backend asli. */
cinemasRouter.get('/:id/fnb-items', (req: Request, res: Response) => {
  const cinemaId = checkUuid(pathParam(req, 'id'), 'ID bioskop');
  if (!cinemas.has(cinemaId)) throw new DemoError(404, 'NOT_FOUND', 'Bioskop tidak ditemukan.');
  const items = [...fnbItems.values()]
    .filter((item) => item.cinema_id === cinemaId)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  ok(res, items);
});

cinemasRouter.get('/:id', (req: Request, res: Response) => {
  const cinema = cinemas.get(checkUuid(pathParam(req, 'id'), 'ID bioskop'));
  if (!cinema) throw new DemoError(404, 'NOT_FOUND', 'Bioskop tidak ditemukan.');
  ok(res, cinemaSummary(cinema));
});

/* ------------------------------------------------------------------ */
/* Route: showtime (jadwal per film + peta kursi + lock)               */
/* ------------------------------------------------------------------ */

function showtimesForMovie(movieId: string, date: string, city: string | null) {
  const matched = [...showtimes.values()]
    .filter((showtime) => showtime.movie_id === movieId && showtime.is_active)
    .filter((showtime) => dayKey(showtime.starts_at) === date)
    .filter((showtime) => !city || cinemaOfShowtime(showtime).cinema.city.toLowerCase() === city.toLowerCase())
    .sort((a, b) => Number(a.starts_at) - Number(b.starts_at));

  // Ringkasan bioskop dalam grup jadwal lebih tipis dari cinemaSummary (sama seperti backend asli).
  type GroupCinema = Pick<ReturnType<typeof cinemaSummary>, 'id' | 'chain' | 'name' | 'city'>;
  const groups = new Map<string, { cinema: GroupCinema; showtimes: unknown[] }>();
  for (const showtime of matched) {
    const { studio, cinema } = cinemaOfShowtime(showtime);
    let group = groups.get(cinema.id);
    if (!group) {
      group = {
        cinema: { id: cinema.id, chain: cinema.chain, name: cinema.name, city: cinema.city },
        showtimes: [],
      };
      groups.set(cinema.id, group);
    }
    group.showtimes.push({
      id: showtime.id, studio: studio.name, starts_at: showtime.starts_at, format: showtime.format,
      base_price: showtime.base_price, language: showtime.language, subtitle: showtime.subtitle,
    });
  }
  return { movie_id: movieId, date, groups: [...groups.values()] };
}

moviesRouter.get('/:id/showtimes', (req: Request, res: Response) => {
  const movieId = checkUuid(pathParam(req, 'id'), 'ID film');
  if (!movies.has(movieId)) throw new DemoError(404, 'NOT_FOUND', 'Film tidak ditemukan.');
  const date = qstr(req, 'date') ?? dayKey(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'date: Tanggal harus format YYYY-MM-DD');
  }
  ok(res, showtimesForMovie(movieId, date, qstr(req, 'city')));
});

const showtimesRouter = express.Router();

showtimesRouter.get('/:id', (req: Request, res: Response) => {
  purgeExpiredLocks();
  const showtime = mustFindShowtime(pathParam(req, 'id'));
  const movie = movieBrief(showtime.movie_id);
  const { studio, cinema } = cinemaOfShowtime(showtime);
  const userId = currentUser(req)?.id ?? null;

  ok(res, {
    showtime: {
      id: showtime.id, starts_at: showtime.starts_at, ends_at: showtime.ends_at, format: showtime.format,
      language: showtime.language, subtitle: showtime.subtitle, base_price: showtime.base_price,
    },
    movie: {
      id: movie.id, title: movie.title, age_rating: movie.age_rating,
      duration_minutes: movie.duration_minutes, poster_url: movie.poster_url,
    },
    studio: {
      id: studio.id, name: studio.name, seat_rows: studio.seat_rows,
      seat_cols: studio.seat_cols, screen_types: studio.screen_types,
    },
    cinema: { id: cinema.id, chain: cinema.chain, name: cinema.name, city: cinema.city },
    seats: seatsOfStudio(studio.id).map((seat) => ({
      id: seat.id, row: seat.row, number: seat.number, type: seat.type,
      price: seatPrice(showtime, seat), status: seatStatus(showtime.id, seat.id, userId),
    })),
  });
});

function assertShowtimeBookable(showtime: ShowtimeRow): void {
  if (showtime.starts_at.getTime() <= Date.now()) {
    throw new DemoError(409, 'SHOWTIME_PASSED', 'Jadwal tayang sudah lewat.');
  }
}

showtimesRouter.post('/:id/seat-locks', (req: Request, res: Response) => {
  purgeExpiredLocks();
  const user = requireUser(req);
  const showtime = mustFindShowtime(pathParam(req, 'id'));
  assertShowtimeBookable(showtime);

  const raw = authBody(req).seat_ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'seat_ids: Minimal pilih 1 kursi');
  }
  if (raw.length > MAX_SEATS_PER_LOCK) {
    throw new DemoError(422, 'VALIDATION_ERROR', `seat_ids: Maksimal ${MAX_SEATS_PER_LOCK} kursi per pemesanan`);
  }

  const studioSeats = seatsOfStudio(showtime.studio_id);
  const seatIds = [...new Set(raw as string[])];
  const chosen = seatIds.map((seatId) => {
    checkUuid(seatId, 'ID kursi');
    const seat = studioSeats.find((candidate) => candidate.id === seatId);
    if (!seat) throw new DemoError(422, 'SEAT_NOT_IN_SHOWTIME', 'Ada kursi yang tidak termasuk dalam jadwal tayang ini.');
    return seat;
  }).sort((a, b) => a.row.localeCompare(b.row) || a.number - b.number);

  // Kunci milik user sendiri boleh dipilih ulang; kunci user lain/block occupied menolak.
  for (const seat of chosen) {
    const existing = activeReservation(showtime.id, seat.id);
    if (existing && existing.user_id === user.id && existing.status === 'locked') continue;
    const blocked = existing !== null || occupancyOf(showtime.id, seat.id) !== null;
    if (blocked) {
      throw new DemoError(409, 'SEAT_UNAVAILABLE', `Kursi ${seat.row}${seat.number} sedang dikunci atau sudah dipesan pengguna lain.`);
    }
  }

  // Pergantian pilihan: lock lama user pada showtime yang sama dilepas dulu.
  for (const [id, reservation] of reservations) {
    if (reservation.showtime_id === showtime.id && reservation.user_id === user.id && reservation.status === 'locked') {
      reservations.delete(id);
    }
  }

  const expiresAt = addSeconds(new Date(), SEAT_LOCK_TTL_SECONDS);
  const locks = chosen.map((seat) => {
    const id = randomUUID();
    reservations.set(id, {
      id, showtime_id: showtime.id, seat_id: seat.id, user_id: user.id,
      status: 'locked', expires_at: expiresAt, booking_id: null,
    });
    return {
      reservation_id: id, seat_id: seat.id, row: seat.row, number: seat.number,
      type: seat.type, price: seatPrice(showtime, seat),
    };
  });

  ok(res, { locks, total_price: locks.reduce((sum, lock) => sum + lock.price, 0), expires_at: expiresAt }, 201);
});

showtimesRouter.delete('/:id/seat-locks', (req: Request, res: Response) => {
  const user = requireUser(req);
  const showtime = mustFindShowtime(pathParam(req, 'id'));
  assertShowtimeBookable(showtime);
  for (const [id, reservation] of reservations) {
    if (reservation.showtime_id === showtime.id && reservation.user_id === user.id && reservation.status === 'locked') {
      reservations.delete(id);
    }
  }
  ok(res, { message: 'Semua kunci kursi dilepas.' });
});

/* ------------------------------------------------------------------ */
/* Split: pembagian share (integer rupiah, sisa jatuh ke host)         */
/* ------------------------------------------------------------------ */

function splitEqually(total: number, shareCount: number, hostIndex: number): number[] {
  const base = Math.floor(total / shareCount);
  const remainder = total - base * shareCount;
  return Array.from({ length: shareCount }, (_, index) => (index === hostIndex ? base + remainder : base));
}

function trackerOf(participants: SplitParticipantRow[]) {
  const shares = participants.map((p) => p.share_amount);
  const paidCount = participants.filter((p) => p.status === 'paid').length;
  const paid = shares.filter((_, index) => participants[index].status === 'paid').reduce((a, b) => a + b, 0);
  const total = shares.reduce((a, b) => a + b, 0);
  return {
    total, paid, remaining: total - paid, paid_count: paidCount,
    pending_count: participants.length - paidCount,
    all_paid: participants.length > 0 && paidCount === participants.length,
  };
}

function shareUrlOf(token: string): string {
  return `${BASE_URL}/api/v1/split-bills/share/${token}`;
}

function splitResponse(split: SplitBillRow, publicView = false) {
  const booking = bookings.get(split.booking_id)!;
  const showtime = showtimes.get(booking.showtime_id)!;
  const movie = movieBrief(showtime.movie_id);
  const { studio, cinema } = cinemaOfShowtime(showtime);
  const host = users.get(split.host_user_id)!;
  const url = shareUrlOf(split.share_token);

  return {
    id: split.id,
    booking_id: split.booking_id,
    method: split.method,
    status: split.status,
    total_amount: split.total_amount,
    share_count: split.participants.length,
    share_token: split.share_token,
    share_url: url,
    expires_at: split.expires_at,
    created_at: split.created_at,
    host: { id: publicView ? null : split.host_user_id, name: host.full_name },
    booking: {
      id: booking.id,
      booking_code: booking.booking_code,
      status: booking.status,
      movie_title: movie.title,
      cinema_name: cinema.name,
      studio: studio.name,
      starts_at: showtime.starts_at,
    },
    tracker: trackerOf(split.participants),
    participants: split.participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      user_id: publicView ? null : participant.user_id,
      share_amount: participant.share_amount,
      status: participant.status,
      paid_at: participant.paid_at,
      pay_url: `${url}?participant=${participant.id}`,
      qris_payload: buildQrisPayload({
        reference: participant.id,
        amount: participant.share_amount,
        merchantName: cinema.name,
        merchantCity: cinema.city,
      }),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Settlement: satu pintu untuk simulate maupun webhook                */
/* ------------------------------------------------------------------ */

const PAYABLE_STATUSES = new Set(['pending_payment', 'partially_paid']);

function issueETicket(booking: BookingRow): void {
  booking.ticket_code = booking.ticket_code ?? generateTicketCode();
  booking.ticket_issued_at = booking.ticket_issued_at ?? new Date();
  booking.paid_at = booking.paid_at ?? new Date();
  booking.status = 'paid';

  for (const order of fnbOrders.values()) {
    if (order.booking_id === booking.id && order.status !== 'cancelled') order.status = 'paid';
  }
}

interface SettlementOutcome {
  payment_id: string;
  payment_status: string;
  booking_status: string | null;
  effect: string;
  message: string;
}

/** Pelunasan lewat jalur dev (simulate): idempoten, tiket hanya terbit sekali. */
function settlePayment(payment: PaymentRow): SettlementOutcome {
  const booking = bookings.get(payment.booking_id)!;
  if (payment.status !== 'pending') {
    return {
      payment_id: payment.id, payment_status: payment.status, booking_status: booking.status,
      effect: 'duplicate', message: 'Pembayaran sudah berada pada status final.',
    };
  }

  if (!PAYABLE_STATUSES.has(booking.status)) {
    payment.status = 'failed';
    return {
      payment_id: payment.id, payment_status: 'failed', booking_status: booking.status,
      effect: 'booking_not_payable', message: 'Booking tidak lagi dapat dibayar; dana perlu direfund manual.',
    };
  }

  payment.status = 'settled';
  payment.settled_at = new Date();

  if (!payment.participant_id) {
    issueETicket(booking);
    return {
      payment_id: payment.id, payment_status: 'settled', booking_status: 'paid', effect: 'settled',
      message: 'Pembayaran lunas, tiket diterbitkan.',
    };
  }
  return settleSplitPayment(payment, booking);
}

/** Share patungan lunas: perbarui tracker, status split, lalu booking bila penuh. */
function settleSplitPayment(payment: PaymentRow, booking: BookingRow): SettlementOutcome {
  const split = [...splitBills.values()].find((candidate) =>
    candidate.participants.some((p) => p.id === payment.participant_id),
  );
  const participant = split?.participants.find((p) => p.id === payment.participant_id);
  if (!split || !participant) {
    throw new DemoError(409, 'SPLIT_INVALID', 'Peserta patungan untuk pembayaran ini tidak ditemukan.');
  }

  participant.status = 'paid';
  participant.paid_at = new Date();

  const tracker = trackerOf(split.participants);
  split.status = tracker.all_paid ? 'paid' : tracker.paid_count > 0 ? 'partially_paid' : 'pending';

  if (tracker.all_paid && PAYABLE_STATUSES.has(booking.status)) {
    issueETicket(booking);
    return {
      payment_id: payment.id, payment_status: 'settled', booking_status: 'paid', effect: 'settled',
      message: 'Share terakhir lunas, booking dibayar penuh dan tiket diterbitkan.',
    };
  }

  if (tracker.paid_count > 0 && booking.status === 'pending_payment') booking.status = 'partially_paid';
  return {
    payment_id: payment.id, payment_status: 'settled', booking_status: booking.status, effect: 'settled',
    message: `Share ${participant.name} lunas, sisa tagihan Rp${tracker.remaining}.`,
  };
}

/* ------------------------------------------------------------------ */
/* Route: bookings (semuanya butuh login)                              */
/* ------------------------------------------------------------------ */

const PAYABLE_CHANNELS = new Set(['qris', 'virtual_account', 'ewallet']);

const bookingsRouter = express.Router();

bookingsRouter.post('/', (req: Request, res: Response) => {
  purgeExpiredLocks();
  const user = requireUser(req);
  const body = authBody(req);
  const showtimeId = str(body, 'showtime_id');
  const rawReservationIds = body.seat_reservation_ids;

  if (!showtimeId) throw new DemoError(422, 'VALIDATION_ERROR', 'showtime_id: ID jadwal tayang tidak valid');
  const showtime = mustFindShowtime(showtimeId);
  assertShowtimeBookable(showtime);

  if (!Array.isArray(rawReservationIds) || rawReservationIds.length === 0) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'seat_reservation_ids: Minimal 1 reservasi kursi');
  }
  const reservationIds = rawReservationIds as string[];
  const chosen: { reservation: ReservationRow; seat: SeatRow }[] = [];
  for (const reservationId of reservationIds) {
    checkUuid(reservationId, 'ID reservasi kursi');
    const reservation = reservations.get(reservationId);
    const seat = reservation ? seats.find((candidate) => candidate.id === reservation.seat_id) : undefined;
    if (!reservation || !seat || reservation.showtime_id !== showtime.id
      || reservation.user_id !== user.id || reservation.status !== 'locked') {
      throw new DemoError(409, 'LOCK_INVALID', 'Reservasi kursi tidak valid. Silakan pilih kursi kembali.');
    }
    if (reservation.expires_at.getTime() <= Date.now()) {
      throw new DemoError(410, 'LOCK_EXPIRED', 'Masa mengunci kursi sudah habis. Silakan pilih kursi kembali.');
    }
    chosen.push({ reservation, seat });
  }

  const ticketTotal = chosen.reduce((sum, item) => sum + seatPrice(showtime, item.seat), 0);
  const id = randomUUID();
  const now = new Date();
  const booking: BookingRow = {
    id, booking_code: generateBookingCode(), user_id: user.id, showtime_id: showtime.id,
    status: 'pending_payment', ticket_total: ticketTotal, fnb_total: 0, grand_total: ticketTotal,
    payment_due_at: addSeconds(now, SEAT_LOCK_TTL_SECONDS), created_at: now,
    paid_at: null, ticket_code: null, ticket_issued_at: null,
  };
  bookings.set(id, booking);
  for (const item of chosen) {
    item.reservation.status = 'confirmed';
    item.reservation.booking_id = booking.id;
  }

  ok(res, {
    id: booking.id, booking_code: booking.booking_code, status: booking.status,
    showtime_id: booking.showtime_id, ticket_total: booking.ticket_total,
    fnb_total: booking.fnb_total, grand_total: booking.grand_total,
    payment_due_at: booking.payment_due_at, created_at: booking.created_at,
  }, 201);
});

bookingsRouter.get('/', (req: Request, res: Response) => {
  const user = requireUser(req);
  const status = qstr(req, 'status');
  const page = qint(req, 'page', 1);
  const limit = Math.min(qint(req, 'limit', 10), 50);
  const mine = [...bookings.values()]
    .filter((booking) => booking.user_id === user.id)
    .filter((booking) => !status || booking.status === status)
    .sort((a, b) => Number(b.created_at) - Number(a.created_at))
    .map(bookingDetail);
  ok(res, paginate(mine, page, limit));
});

bookingsRouter.get('/:id', (req: Request, res: Response) => {
  const user = requireUser(req);
  ok(res, bookingDetail(mustFindBooking(pathParam(req, 'id'), user.id)));
});

bookingsRouter.post('/:id/cancel', (req: Request, res: Response) => {
  const user = requireUser(req);
  const booking = mustFindBooking(pathParam(req, 'id'), user.id);
  if (!PAYABLE_STATUSES.has(booking.status)) {
    throw new DemoError(409, 'CONFLICT', 'Booking yang sudah dibayar atau batal tidak dapat dibatalkan lagi.');
  }
  booking.status = 'cancelled';
  for (const reservation of reservations.values()) {
    if (reservation.booking_id === booking.id) reservation.status = 'released';
  }
  for (const order of fnbOrders.values()) {
    if (order.booking_id === booking.id && order.status !== 'paid') order.status = 'cancelled';
  }
  ok(res, { message: 'Booking dibatalkan dan kursi dilepas.' });
});

bookingsRouter.post('/:id/fnb-orders', (req: Request, res: Response) => {
  const user = requireUser(req);
  const booking = mustFindBooking(pathParam(req, 'id'), user.id);
  if (!PAYABLE_STATUSES.has(booking.status)) {
    throw new DemoError(409, 'BOOKING_NOT_PAYABLE', 'Booking ini tidak dapat menerima pesanan F&B.');
  }

  const raw = authBody(req).items;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DemoError(400, 'VALIDATION_ERROR', 'Minimal satu item F&B diperlukan.');
  }

  const lines = (raw as { fnb_item_id?: string; quantity?: number }[]).map((line) => {
    const itemId = typeof line.fnb_item_id === 'string' ? checkUuid(line.fnb_item_id, 'ID item F&B') : '';
    const item = fnbItems.get(itemId);
    if (!item) throw new DemoError(404, 'FNB_ITEM_NOT_FOUND', `Item F&B ${itemId} tidak tersedia.`);
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new DemoError(422, 'VALIDATION_ERROR', 'items.quantity: Minimal 1');
    }
    return {
      fnb_item_id: item.id, name: item.name, quantity,
      unit_price: item.price, subtotal: item.price * quantity,
    };
  });

  const totalAmount = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const id = randomUUID();
  const order: FnbOrderRow = {
    id, booking_id: booking.id, user_id: user.id, status: 'pending',
    total_amount: totalAmount, pickup_code: generatePickupCode(), items: lines, created_at: new Date(),
  };
  fnbOrders.set(id, order);
  booking.fnb_total += totalAmount;
  booking.grand_total += totalAmount;

  ok(res, {
    id: order.id, status: order.status, total_amount: order.total_amount,
    pickup_code: order.pickup_code, items: order.items,
  }, 201);
});

bookingsRouter.post('/:id/split-bills', (req: Request, res: Response) => {
  const user = requireUser(req);
  const booking = mustFindBooking(pathParam(req, 'id'), user.id);
  if (!PAYABLE_STATUSES.has(booking.status)) {
    throw new DemoError(409, 'BOOKING_NOT_PAYABLE', 'Hanya booking yang belum lunas bisa dipatungkan.');
  }
  if (splitOfBooking(booking.id)) {
    throw new DemoError(409, 'SPLIT_EXISTS', 'Booking ini sudah punya patungan aktif.');
  }

  const body = authBody(req);
  const method = str(body, 'method');
  if (method !== 'equal' && method !== 'custom') {
    throw new DemoError(422, 'VALIDATION_ERROR', 'method: Pilih metode equal atau custom');
  }
  const raw = body.participants;
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'participants: Patungan membutuhkan minimal 2 peserta');
  }

  const participants = (raw as { name?: unknown; user_id?: unknown; amount?: unknown }[]).map((input) => {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw new DemoError(422, 'VALIDATION_ERROR', 'participants.name: Nama peserta wajib diisi');
    const userId = typeof input.user_id === 'string' && input.user_id ? checkUuid(input.user_id, 'ID peserta') : null;
    return { name, user_id: userId, amount: input.amount === undefined ? null : Number(input.amount) };
  });
  const linked = participants.map((p) => p.user_id).filter((id): id is string => id !== null);
  if (new Set(linked).size !== linked.length) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'participants: Satu pengguna hanya boleh menjadi satu peserta');
  }

  const total = booking.grand_total;
  let shares: number[];
  if (method === 'custom') {
    const amounts = participants.map((p) => p.amount);
    if (amounts.some((amount) => amount === null || !Number.isInteger(amount) || amount < 0)) {
      throw new DemoError(422, 'VALIDATION_ERROR', 'participants.amount: Metode kustom membutuhkan nominal untuk setiap peserta');
    }
    const sum = amounts.reduce<number>((a, b) => a + (b as number), 0);
    if (sum !== total) {
      throw new DemoError(422, 'SHARE_MISMATCH', `Total share (${sum}) harus sama dengan total tagihan (${total}).`);
    }
    shares = amounts as number[];
  } else {
    const hostIndex = Math.max(0, participants.findIndex((p) => p.user_id === user.id));
    shares = splitEqually(total, participants.length, hostIndex);
  }

  const id = randomUUID();
  const split: SplitBillRow = {
    id, booking_id: booking.id, host_user_id: user.id, method, total_amount: total,
    status: 'pending', share_token: generateShareToken(),
    expires_at: addMinutes(new Date(), SPLIT_TTL_MINUTES), created_at: new Date(),
    participants: participants.map((participant, index) => ({
      id: randomUUID(), name: participant.name, user_id: participant.user_id,
      share_amount: shares[index], status: 'pending', paid_at: null,
    })),
  };
  splitBills.set(id, split);
  ok(res, splitResponse(split), 201);
});

bookingsRouter.get('/:id/ticket', (req: Request, res: Response) => {
  const user = requireUser(req);
  const booking = mustFindBooking(pathParam(req, 'id'), user.id);
  if (booking.status !== 'paid' || !booking.ticket_code) {
    throw new DemoError(409, 'TICKET_NOT_ISSUED', 'E-ticket terbit setelah pembayaran lunas.');
  }
  const showtime = showtimes.get(booking.showtime_id)!;
  const movie = movieBrief(showtime.movie_id);
  const { cinema } = cinemaOfShowtime(showtime);

  ok(res, {
    booking_code: booking.booking_code,
    movie_title: movie.title,
    cinema_name: cinema.name,
    starts_at: showtime.starts_at,
    ticket: {
      code: booking.ticket_code,
      issued_at: booking.ticket_issued_at,
      qr_payload: buildTicketQr('ticket', booking.ticket_code, booking.booking_code),
    },
    fnb_orders: [...fnbOrders.values()]
      .filter((order) => order.booking_id === booking.id && order.status !== 'cancelled')
      .map((order) => ({
        id: order.id,
        pickup_code: order.pickup_code,
        status: order.status,
        total_amount: order.total_amount,
        qr_payload: buildTicketQr('fnb', order.pickup_code, booking.booking_code),
      })),
  });
});

/** Intent pembayaran: penuh (tanpa participant_id) atau satu share patungan. */
bookingsRouter.post('/:id/payments', (req: Request, res: Response) => {
  const user = requireUser(req);
  const booking = mustFindBooking(pathParam(req, 'id'), user.id);
  const body = authBody(req);
  const channel = str(body, 'channel');
  const rawParticipant = str(body, 'participant_id');

  if (!channel || !PAYABLE_CHANNELS.has(channel)) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'channel: Kanal pembayaran tidak dikenal');
  }
  if (!PAYABLE_STATUSES.has(booking.status)) {
    throw new DemoError(409, 'BOOKING_NOT_PAYABLE', 'Booking ini sudah lunas atau tidak dapat dibayar.');
  }
  if (booking.payment_due_at.getTime() <= Date.now()) {
    throw new DemoError(410, 'PAYMENT_WINDOW_CLOSED', 'Batas waktu pembayaran booking ini habis.');
  }

  const showtime = showtimes.get(booking.showtime_id)!;
  const movie = movieBrief(showtime.movie_id);
  const { cinema } = cinemaOfShowtime(showtime);
  const split = splitOfBooking(booking.id);
  let participant: SplitParticipantRow | null = null;
  let amount = booking.grand_total;

  if (rawParticipant) {
    const participantId = checkUuid(rawParticipant, 'ID peserta');
    if (!split) throw new DemoError(404, 'NOT_FOUND', 'Patungan untuk booking ini tidak ditemukan.');
    participant = split.participants.find((p) => p.id === participantId) ?? null;
    if (!participant) throw new DemoError(404, 'NOT_FOUND', 'Peserta patungan tidak ditemukan.');
    if (booking.user_id !== user.id && participant.user_id !== user.id) {
      throw new DemoError(403, 'FORBIDDEN', 'Anda bukan peserta untuk share ini.');
    }
    if (participant.status === 'paid') throw new DemoError(409, 'PARTICIPANT_PAID', 'Share ini sudah lunas.');
    amount = participant.share_amount;
  } else if (booking.user_id !== user.id) {
    throw new DemoError(403, 'FORBIDDEN', 'Hanya pemilik booking yang dapat melunasi tagihan penuh.');
  } else if (split) {
    throw new DemoError(409, 'SPLIT_ACTIVE', 'Tagihan sedang dipatungkan; bayar melalui tautan patungan.');
  }

  const scope = participant?.id ?? null;
  const reusable = [...payments.values()].find(
    (payment) => payment.booking_id === booking.id && payment.status === 'pending'
      && payment.participant_id === scope && payment.channel === channel,
  );
  if (reusable) {
    ok(res, chargeResponse(reusable), 201);
    return;
  }

  const id = randomUUID();
  const payment: PaymentRow = {
    id, booking_id: booking.id, user_id: user.id, participant_id: scope,
    channel: channel as PaymentRow['channel'], amount, status: 'pending', gateway: 'simulated',
    transaction_id: `sim_${id}`,
    charge: buildChargeForChannel(channel as PaymentRow['channel'], id, amount, cinema, booking, movie.title, participant),
    created_at: new Date(), settled_at: null,
  };
  payments.set(id, payment);
  ok(res, chargeResponse(payment), 201);
});

function buildChargeForChannel(
  channel: PaymentRow['channel'],
  paymentId: string,
  amount: number,
  cinema: CinemaRow,
  booking: BookingRow,
  movieTitle: string,
  participant: SplitParticipantRow | null,
): Record<string, unknown> {
  const description = participant
    ? `Patungan ${booking.booking_code} - ${participant.name}`
    : `Tiket ${booking.booking_code} - ${movieTitle}`;

  if (channel === 'qris') {
    return {
      qris_payload: buildQrisPayload({
        reference: paymentId, amount, merchantName: cinema.name, merchantCity: cinema.city,
      }),
      pay_url: null, va_number: null, va_bank: null, description,
    };
  }
  if (channel === 'virtual_account') {
    return {
      qris_payload: null, pay_url: null,
      va_number: `9900${numericId(10)}`, va_bank: 'BCA', description,
    };
  }
  return {
    qris_payload: null, pay_url: `${BASE_URL}/api/v1/payments/${paymentId}/simulate`,
    va_number: null, va_bank: null, description,
  };
}

function chargeResponse(payment: PaymentRow) {
  return {
    id: payment.id,
    booking_id: payment.booking_id,
    channel: payment.channel,
    amount: payment.amount,
    status: payment.status,
    gateway: payment.gateway,
    simulated: payment.gateway === 'simulated',
    ...payment.charge,
    transaction_id: payment.transaction_id,
    created_at: payment.created_at,
    poll_url: `/api/v1/payments/${payment.id}/status`,
  };
}

/* ------------------------------------------------------------------ */
/* Route: split bills & payments                                        */
/* ------------------------------------------------------------------ */

const splitRouter = express.Router();

function mustFindSplit(id: string): SplitBillRow {
  checkUuid(id, 'ID patungan');
  const split = splitBills.get(id);
  if (!split) throw new DemoError(404, 'NOT_FOUND', 'Patungan tidak ditemukan.');
  assertSplitUsable(split);
  return split;
}

function assertSplitUsable(split: SplitBillRow): void {
  if (split.status === 'cancelled') throw new DemoError(409, 'SPLIT_CANCELLED', 'Patungan ini sudah dibatalkan.');
  if (split.expires_at.getTime() <= Date.now()) {
    throw new DemoError(410, 'SPLIT_EXPIRED', 'Tautan patungan ini sudah kedaluwarsa.');
  }
}

splitRouter.get('/:id', (req: Request, res: Response) => {
  const user = requireUser(req);
  const split = mustFindSplit(pathParam(req, 'id'));
  const isHost = split.host_user_id === user.id;
  const isParticipant = split.participants.some((p) => p.user_id === user.id);
  if (!isHost && !isParticipant) throw new DemoError(403, 'FORBIDDEN', 'Anda bukan peserta patungan ini.');
  ok(res, splitResponse(split));
});

splitRouter.get('/share/:token', (req: Request, res: Response) => {
  const token = pathParam(req, 'token');
  if (!/^sp_[0-9a-f]{16}$/.test(token)) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'token: Token patungan tidak valid');
  }
  const split = [...splitBills.values()].find((candidate) => candidate.share_token === token);
  if (!split) throw new DemoError(404, 'NOT_FOUND', 'Tautan patungan tidak ditemukan.');
  assertSplitUsable(split);
  ok(res, splitResponse(split, true));
});

const paymentsRouter = express.Router();

function mustFindPayment(id: string): PaymentRow {
  checkUuid(id, 'ID pembayaran');
  const payment = payments.get(id);
  if (!payment) throw new DemoError(404, 'NOT_FOUND', 'Pembayaran tidak ditemukan.');
  return payment;
}

paymentsRouter.get('/:id/status', (req: Request, res: Response) => {
  const user = requireUser(req);
  const payment = mustFindPayment(pathParam(req, 'id'));
  const booking = bookings.get(payment.booking_id)!;
  if (booking.user_id !== user.id && payment.user_id !== user.id) {
    throw new DemoError(404, 'NOT_FOUND', 'Pembayaran tidak ditemukan.');
  }
  const participant = payment.participant_id
    ? [...splitBills.values()].flatMap((s) => s.participants).find((p) => p.id === payment.participant_id)
    : null;

  ok(res, {
    id: payment.id, status: payment.status, amount: payment.amount, gateway: payment.gateway,
    booking_status: booking.status, participant_status: participant?.status ?? null,
    has_ticket: booking.status === 'paid',
  });
});

paymentsRouter.post('/:id/simulate', (req: Request, res: Response) => {
  const user = requireUser(req);
  const payment = mustFindPayment(pathParam(req, 'id'));
  const booking = bookings.get(payment.booking_id)!;
  if (payment.user_id !== user.id && booking.user_id !== user.id) {
    throw new DemoError(403, 'FORBIDDEN', 'Bukan pembayaran milik Anda.');
  }
  ok(res, settlePayment(payment));
});

paymentsRouter.post('/webhook/:gateway', (req: Request, res: Response) => {
  void req;
  throw new DemoError(400, 'GATEWAY_UNAVAILABLE', 'Gateway simulated tidak menerima notifikasi.');
});

const eticketsRouter = express.Router();

eticketsRouter.post('/scan', (req: Request, res: Response) => {
  const user = requireUser(req);
  if (user.role !== 'admin') {
    throw new DemoError(403, 'FORBIDDEN', 'Hanya staff/admin yang dapat memverifikasi tiket.');
  }
  const payload = str(authBody(req), 'qr_payload') ?? '';
  const parts = payload.trim().split(':');
  const [, kind, code, bookingCode, signature] = parts;
  if (parts.length !== 5 || parts[0] !== 'cinegen' || (kind !== 'ticket' && kind !== 'fnb')
    || signature !== qrSignature(kind, code, bookingCode)) {
    ok(res, { valid: false, message: 'QR tidak valid atau dipalsukan.' });
    return;
  }
  const booking = [...bookings.values()].find((candidate) => candidate.booking_code === bookingCode);
  if (!booking) {
    ok(res, { valid: false, message: 'Booking untuk QR ini tidak ditemukan.' });
    return;
  }
  if (kind === 'ticket' && booking.ticket_code !== code) {
    ok(res, { valid: false, message: 'Kode tiket tidak cocok dengan booking-nya.' });
    return;
  }
  if (booking.status !== 'paid') {
    ok(res, { valid: false, message: `Booking belum lunas (status: ${booking.status}).` });
    return;
  }
  ok(res, {
    valid: true, kind, code,
    message: kind === 'ticket' ? 'Tiket valid.' : 'Kode F&B valid.',
    booking: { booking_code: booking.booking_code, movie_title: movieBrief(showtimes.get(booking.showtime_id)!.movie_id).title },
  });
});

/* ------------------------------------------------------------------ */
/* Route: AI (kuesioner + Cine-Buddy, mesin lokal deterministik)       */
/* ------------------------------------------------------------------ */

const MOOD_GENRES: Record<string, string[]> = {
  pengen_ketawa: ['Comedy', 'Animation'],
  santai: ['Comedy', 'Family', 'Romance', 'Animation'],
  inspiratif: ['Drama', 'Biography', 'Adventure', 'Sci-Fi'],
  tegang: ['Action', 'Thriller', 'Horror', 'Superhero', 'Sci-Fi'],
  romantis: ['Romance', 'Drama', 'Family'],
  keluarga: ['Family', 'Animation', 'Adventure'],
};

const MOOD_LABEL: Record<string, string> = {
  pengen_ketawa: 'ingin tertawa', santai: 'butuh tontonan ringan', inspiratif: 'tertarik cerita yang menguatkan',
  tegang: 'suka ketegangan', romantis: 'mencari kisah romantis', keluarga: 'menonton bersama keluarga',
};

const COMPANION_LABEL: Record<string, string> = {
  sendiri: 'sendiri', pasangan: 'berdua dengan pasangan',
  keluarga: 'bareng keluarga termasuk anak-anak', teman: 'rombongan teman',
};

const COMPANION_AGE_LIMITS: Record<string, string[]> = {
  sendiri: ['SU', '13+', '17+', '21+'], pasangan: ['SU', '13+', '17+', '21+'],
  teman: ['SU', '13+', '17+', '21+'], keluarga: ['SU', '13+'],
};

const MOOD_KEYWORDS: [RegExp, string][] = [
  [/\b(ketawa|komedi|lucu|funny|garing)\b/i, 'pengen_ketawa'],
  [/\b(santai|ringan|healing|santuy)\b/i, 'santai'],
  [/\b(inspirasi|inspiratif|drama|biografi|motivasi|menyentuh)\b/i, 'inspiratif'],
  [/\b(tegang|thriller|horor|aksi|action|perang)\b/i, 'tegang'],
  [/\b(romantis|cinta|romance|galau)\b/i, 'romantis'],
  [/\b(keluarga|anak|ortu|family)\b/i, 'keluarga'],
];

function matchingGenres(moodGenres: string[], movieGenres: string[]): string[] {
  const lowered = new Set(movieGenres.map((g) => g.toLowerCase()));
  return moodGenres.filter((g) => lowered.has(g.toLowerCase()));
}

function showingCountOf(movieId: string, city: string | null): number {
  const now = Date.now();
  let count = 0;
  for (const showtime of showtimes.values()) {
    if (showtime.movie_id !== movieId || !showtime.is_active || showtime.starts_at.getTime() <= now) continue;
    if (!city || cinemaOfShowtime(showtime).cinema.city.toLowerCase() === city.toLowerCase()) count += 1;
  }
  return count;
}

interface CandidateMovie {
  id: string; title: string; slug: string; genres: string[]; duration_minutes: number;
  age_rating: string; language: string; synopsis: string; poster_url: string;
  rating_score: number | null; showing_count: number;
}

function loadCandidates(city: string | null): CandidateMovie[] {
  return [...movies.values()]
    .filter((movie) => movie.status === 'now_showing')
    .map((movie) => ({
      id: movie.id, title: movie.title, slug: movie.slug, genres: movie.genres,
      duration_minutes: movie.duration_minutes, age_rating: movie.age_rating, language: movie.language,
      synopsis: movie.synopsis, poster_url: movie.poster_url, rating_score: movie.rating_score,
      showing_count: showingCountOf(movie.id, city),
    }))
    .filter((movie) => !city || movie.showing_count > 0)
    .sort((a, b) => b.showing_count - a.showing_count || (b.rating_score ?? 0) - (a.rating_score ?? 0));
}

function recommend(candidates: CandidateMovie[], preference: {
  mood: string; favoriteGenres: string[]; maxDuration: number; companion: string;
}, limit: number) {
  const moodGenres = MOOD_GENRES[preference.mood] ?? MOOD_GENRES.santai;
  const allowedAges = new Set(COMPANION_AGE_LIMITS[preference.companion] ?? COMPANION_AGE_LIMITS.sendiri);

  return candidates
    .filter((movie) => allowedAges.has(movie.age_rating))
    .map((movie) => {
      const matched = matchingGenres(moodGenres, movie.genres);
      const matchedFavorite = matchingGenres(preference.favoriteGenres, movie.genres);
      const durationOk = movie.duration_minutes <= preference.maxDuration;

      const score = 0.4 * Math.min(1, (matched.length + matchedFavorite.length) / 2)
        + 0.2 * (matched.length > 0 ? 1 : 0.25)
        + 0.15 * (durationOk ? 1 : 0.35)
        + 0.25 * ((movie.rating_score ?? 6.5) / 10);

      const reasons = [
        `Anda sedang mencari tontonan ${MOOD_LABEL[preference.mood] ?? 'santai'} untuk ${COMPANION_LABEL[preference.companion] ?? 'sendiri'}`,
      ];
      if (matchedFavorite.length > 0) reasons.push(`genre favorit Anda (${matchedFavorite.join(', ')}) ada di film ini`);
      else if (matched.length > 0) reasons.push(`nuansa ${matched.join(', ')} kuat di film ini`);
      reasons.push(durationOk
        ? `durasi ${movie.duration_minutes} menit masih di bawah batas ${preference.maxDuration} menit`
        : `durasi ${movie.duration_minutes} menit sedikit melebihi batas, tapi tetap layak`);
      if (movie.rating_score !== null) reasons.push(`rating ulasan ${movie.rating_score.toFixed(1)}/10`);
      if (movie.showing_count > 0) reasons.push(`${movie.showing_count} jadwal tayang tersedia minggu ini`);

      return {
        movie,
        match_score: Math.round(score * 100) / 100,
        rationale: `Film ini cocok untuk Anda karena ${reasons.join(', ')}.`,
      };
    })
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, limit);
}

const aiRouter = express.Router();

aiRouter.post('/quiz', (req: Request, res: Response) => {
  requireUser(req);
  const body = authBody(req);
  const mood = str(body, 'mood') ?? 'santai';
  if (!(mood in MOOD_GENRES)) {
    throw new DemoError(422, 'VALIDATION_ERROR', 'mood: Suasana tidak dikenal');
  }
  const companion = str(body, 'companion') ?? 'sendiri';
  const city = str(body, 'city');
  const favoriteGenres = Array.isArray(body.favorite_genres) ? (body.favorite_genres as string[]) : [];
  const maxDuration = Number(body.max_duration_minutes) || 180;
  const limit = Math.min(Math.max(Number(body.limit) || 3, 1), 5);

  const recommendations = recommend(loadCandidates(city), { mood, favoriteGenres, maxDuration, companion }, limit);
  if (recommendations.length === 0) {
    throw new DemoError(404, 'NO_CANDIDATE', 'Belum ada film yang cocok dengan kriteria Anda.');
  }
  ok(res, { engine: 'local', recommendations });
});

aiRouter.post('/chat', (req: Request, res: Response) => {
  requireUser(req);
  const body = authBody(req);
  const message = str(body, 'message') ?? '';
  if (message.length < 3) throw new DemoError(422, 'VALIDATION_ERROR', 'message: Pesan terlalu singkat');

  const city = str(body, 'city');
  const mood = MOOD_KEYWORDS.find(([pattern]) => pattern.test(message))?.[1] ?? 'santai';
  const companion = /keluarga|anak|pasangan|pacar|teman|sahabat/i.test(message)
    ? (/keluarga|anak/i.test(message) ? 'keluarga' : /pasangan|pacar/i.test(message) ? 'pasangan' : 'teman')
    : 'sendiri';
  const favoriteGenres = ['Comedy', 'Horror', 'Action', 'Drama', 'Romance', 'Animation', 'Sci-Fi', 'Family']
    .filter((genre) => new RegExp(genre, 'i').test(message));
  const durationMatch = /(\d{2,3})\s*(menit|mnt|min)/i.exec(message);
  const maxDuration = durationMatch ? Number(durationMatch[1]) : 180;
  const limit = Math.min(Math.max(Number(body.limit) || 3, 1), 5);

  const recommendations = recommend(loadCandidates(city), { mood, favoriteGenres, maxDuration, companion }, limit);
  if (recommendations.length === 0) {
    throw new DemoError(404, 'NO_CANDIDATE', 'Belum ada film yang bisa saya rekomendasikan.');
  }

  const reply = `Oke, ini ${recommendations.length} pilihan yang paling pas: ${recommendations
    .map((item) => item.movie.title)
    .join(', ')}. Tiap film saya sertakan alasannya ya.`;
  ok(res, { engine: 'local', reply, recommendations });
});

/* ------------------------------------------------------------------ */
/* Perakitan aplikasi                                                  */
/* ------------------------------------------------------------------ */

seedCatalog();
seedShowtimes();
seedDemoUser();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'CineGen DEMO API (in-memory)',
    mode: 'demo',
    database: 'none (semua data di memori, hilang saat server berhenti)',
    health: '/health',
    api: '/api/v1',
    demo_user: 'demo@cinegen.id / demo1234',
    modules: ['auth', 'movies', 'cinemas', 'showtimes', 'bookings', 'fnb', 'split-bills', 'payments', 'etickets', 'ai'],
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'ok', service: 'cinegen-demo-api', mode: 'in-memory',
      uptimeSeconds: Math.floor(process.uptime()), timestamp: new Date().toISOString(),
    },
  });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/movies', moviesRouter);
app.use('/api/v1/cinemas', cinemasRouter);
app.use('/api/v1/showtimes', showtimesRouter);
app.use('/api/v1/bookings', bookingsRouter);
app.use('/api/v1/split-bills', splitRouter);
app.use('/api/v1/payments', paymentsRouter);
app.use('/api/v1/etickets', eticketsRouter);
app.use('/api/v1/ai', aiRouter);

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof DemoError) {
    res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof SyntaxError) {
    res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Format request tidak valid.' } });
    return;
  }
  console.error('[demo] unhandled error:', err);
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server demo.' } });
});

app.listen(PORT, () => {
  console.log(`[demo] server in-memory berjalan di :${PORT} (tanpa PostgreSQL)`);
  console.log(`[demo] ${movies.size} film, ${cinemas.size} bioskop, ${showtimes.size} jadwal, ${fnbItems.size} item F&B | login demo: demo@cinegen.id / demo1234`);
});
