# CineGen — REST API Specification

> Base URL: `http://localhost:3000/api/v1` (dev) • Format: JSON • Protokol: HTTPS + Bearer Token (JWT)
>
> **Mengapa REST, bukan GraphQL?** Klien utamanya aplikasi mobile milik kita sendiri dengan pola layar yang sudah jelas (katalog → jadwal → kursi → bayar). REST lebih sederhana untuk HTTP caching di CDN, webhook payment gateway, dan link publik Split Bill. GraphQL akan lebih layak jika ada klien pihak ketiga dengan kebutuhan query beragam.

## 1. Konvensi Umum

### 1.1. Format Respons
Semua respons memakai envelope yang sama (konsisten dengan error handler di `src/common/middlewares/error-handler.ts`):

**Sukses**
```json
{ "success": true, "data": { } }
```

**Gagal**
```json
{ "success": false, "error": { "code": "SEAT_UNAVAILABLE", "message": "Kursi A5 sudah dikunci pengguna lain" } }
```

### 1.2. Autentikasi
Endpoint privat membutuhkan header:
```
Authorization: Bearer <access_token>
```
Access token berumur pendek (15 mnt); refresh token (7 hari) dipakai memperbarui via `/auth/refresh`.

### 1.3. Kode Error Standar
| code | HTTP | Arti |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Body/param tidak valid (Zod) |
| `UNAUTHORIZED` | 401 | Token hilang/kadaluarsa |
| `FORBIDDEN` | 403 | Bukan pemilik resource |
| `NOT_FOUND` | 404 | Resource tidak ada |
| `SEAT_UNAVAILABLE` | 409 | Kursi sudah dikunci/dipesan |
| `LOCK_EXPIRED` | 410 | Lock kursi kedaluwarsa |
| `BOOKING_NOT_PAYABLE` | 409 | Booking sudah lunas/batal, tidak bisa dipatungkan |
| `SPLIT_EXISTS` | 409 | Booking ini sudah punya patungan aktif |
| `SPLIT_CANCELLED` | 409 | Patungan dibatalkan |
| `SPLIT_EXPIRED` | 410 | Tautan patungan kedaluwarsa |
| `SHARE_MISMATCH` | 422 | Total share kustom ≠ total tagihan |
| `SHARE_CALCULATION_FAILED` | 422 | Kalkulasi share rata tidak valid |
| `NO_CANDIDATE` | 404 | Tidak ada film yang bisa direkomendasikan |
| `SPLIT_ACTIVE` | 409 | Tagihan sedang dipatungkan; bayar lewat share peserta |
| `PARTICIPANT_PAID` | 409 | Share peserta ini sudah lunas |
| `PAYMENT_WINDOW_CLOSED` | 410 | `payment_due_at` booking sudah lewat |
| `TICKET_NOT_ISSUED` | 409 | E-ticket diminta sebelum pembayaran lunas |
| `GATEWAY_UNAVAILABLE` | 502/400 | Gateway menolak/tidak terkonfigurasi saat charge atau webhook |
| `INVALID_SIGNATURE` | 400 | Notifikasi gateway tanpa `signature_key` yang sah |
| `CONFLICT` | 409 | Pelanggaran state (mis. booking sudah dibayar) |
| `RATE_LIMITED` | 429 | Terlalu banyak request |
| `INTERNAL_ERROR` | 500 | Kesalahan server |

### 1.4. Paginasi
Query `?page=1&limit=10`. Respons data list menyertakan:
```json
{ "items": [], "meta": { "page": 1, "limit": 10, "total_items": 42, "total_pages": 5 } }
```

---

## 2. Auth Module (TAHAP 3)

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| POST | `/auth/register` | - | Daftar akun baru |
| POST | `/auth/login` | - | Login, dapat access+refresh token |
| POST | `/auth/refresh` | - | Perbarui access token |
| POST | `/auth/logout` | ✅ | Revoke refresh token |
| GET | `/auth/me` | ✅ | Profil user aktif |

**POST /auth/register** — body:
```json
{ "full_name": "Budi Santoso", "email": "budi@mail.com", "phone": "081234567890", "password": "rahasia123" }
```
Response `201`:
```json
{ "success": true, "data": {
  "user": { "id": "uuid", "full_name": "Budi Santoso", "email": "budi@mail.com" },
  "tokens": { "access_token": "eyJ...", "refresh_token": "eyJ...", "expires_in": 900 }
} }
```

---

## 3. Movies & Showtimes Module (TAHAP 3)

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| GET | `/movies` | - | Katalog film (filter + paginasi) |
| GET | `/movies/{id}` | - | Detail film |
| GET | `/movies/{id}/showtimes` | - | Jadwal film, dikelompokkan per bioskop |
| GET | `/cinemas` | - | Daftar bioskop (per kota) |
| GET | `/cinemas/{id}` | - | Detail bioskop |

**GET /movies** — query params:
- `status`: `now_showing` (default) | `upcoming`
- `genre`: string, mis. `Action` (match `genres @>`)
- `search`: full-text pada judul
- `city`: hanya film yang punya jadwal di kota tsb
- `page`, `limit`

**GET /movies/{id}/showtimes?city=Jakarta&date=2026-10-12** — response dikelompokkan agar UI mobile tinggal render:
```json
{ "success": true, "data": {
  "movie_id": "uuid",
  "groups": [
    {
      "cinema": { "id": "uuid", "chain": "CGV", "name": "CGV Grand Indonesia", "city": "Jakarta" },
      "showtimes": [
        {
          "id": "uuid", "studio": "Studio 2 IMAX", "starts_at": "2026-10-12T13:00:00Z",
          "format": "IMAX", "base_price": 60000, "language": "English", "subtitle": "Indonesian"
        }
      ]
    }
  ]
} }
```

---

## 4. Seat Selection & Booking Module (TAHAP 3)

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| GET | `/showtimes/{id}` | - | Detail showtime + **peta kursi real-time** |
| POST | `/showtimes/{id}/seat-locks` | ✅ | Kunci kursi (TTL 10 menit) |
| DELETE | `/seat-locks` | ✅ | Lepas lock sebelum kedaluwarsa |
| POST | `/bookings` | ✅ | Buat booking dari lock aktif |
| GET | `/bookings` | ✅ | Riwayat booking saya |
| GET | `/bookings/{id}` | ✅ | Detail booking (kursi + F&B + split) |
| POST | `/bookings/{id}/cancel` | ✅ | Batalkan booking |

**GET /showtimes/{id}** — peta kursi dengan status per kursi:
```json
{ "success": true, "data": {
  "showtime": { "id": "uuid", "starts_at": "...", "base_price": 40000, "format": "2D" },
  "movie": { "id": "uuid", "title": "Interstellar", "duration_minutes": 169 },
  "studio": { "id": "uuid", "name": "Studio 1", "seat_rows": 8, "seat_cols": 10 },
  "seats": [
    { "id": "uuid", "row": "A", "number": 5, "type": "premium", "price": 60000, "status": "available" },
    { "id": "uuid", "row": "B", "number": 2, "type": "premium", "price": 60000, "status": "locked" }
  ]
} }
```
`status` kursi: `available` | `locked` (orang lain mengunci) | `mine` (lock milik saya) | `sold`.
Mobile mem-polling endpoint ini tiap ±1 detik saat halaman kursi terbuka (NFR: update < 1.5 dtk).

**POST /showtimes/{id}/seat-locks** — body: `{ "seat_ids": ["uuid1", "uuid2"] }`
Response `201`:
```json
{ "success": true, "data": {
  "locks": [
    { "reservation_id": "uuid", "seat_id": "uuid", "row": "C", "number": 7, "price": 40000 }
  ],
  "total_price": 80000,
  "expires_at": "2026-10-11T09:10:00Z"
} }
```
Error `409 SEAT_UNAVAILABLE` bila salah satu kursi sudah tidak bebas.
Satu permintaan `POST` **mengganti** seluruh lock milik pengguna pada showtime yang sama (lock lama dilepas).

**GET /bookings/{id}** — detail lengkap untuk halaman tiket & patungan:
```json
{ "success": true, "data": {
  "id": "uuid", "booking_code": "CG-8FK2Q9", "status": "pending_payment",
  "totals": { "ticket": 80000, "fnb": 25000, "grand": 105000 },
  "payment_due_at": "...", "paid_at": null, "created_at": "...",
  "showtime": { "id": "uuid", "starts_at": "...", "format": "2D" },
  "movie": { "id": "uuid", "title": "Interstellar", "poster_url": "...", "age_rating": "13+", "duration_minutes": 169 },
  "cinema": { "id": "uuid", "name": "CGV Grand Indonesia", "chain": "CGV", "city": "Jakarta" },
  "studio": "Studio 1",
  "seats": [ { "row": "C", "number": 7, "type": "regular" } ]
} }
```
`cinema.id` dipakai mobile untuk mengambil katalog F&B bioskop terkait (FR-FB-01); item ini juga ikut dikembalikan pada `GET /bookings` (riwayat).

**POST /bookings** — body:
```json
{ "showtime_id": "uuid", "seat_reservation_ids": ["uuid-lock-1", "uuid-lock-2"] }
```
Response `201`:
```json
{ "success": true, "data": {
  "id": "uuid", "booking_code": "CG-8FK2Q9", "status": "pending_payment",
  "ticket_total": 80000, "fnb_total": 0, "grand_total": 80000,
  "payment_due_at": "2026-10-11T09:10:00Z"
} }
```

---

## 5. F&B Module (TAHAP 4-6)

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| GET | `/cinemas/{id}/fnb-items` | - | Katalog F&B bioskop (FR-FB-01) |
| POST | `/bookings/{id}/fnb-orders` | ✅ | Pre-order F&B untuk booking |
| GET | `/fnb-orders/{id}` | ✅ | Status order + pickup code |
| - | QR pengambilan F&B | ✅ | Disajikan lewat `GET /bookings/{id}/ticket` (§8), bukan endpoint terpisah |

**POST /bookings/{id}/fnb-orders** — body: `{ "items": [{ "fnb_item_id": "uuid", "quantity": 2 }] }`
Response `201`:
```json
{ "success": true, "data": {
  "id": "uuid", "status": "pending", "total_amount": 120000,
  "pickup_code": "FNB-4X2K", "items": [
    { "fnb_item_id": "uuid", "name": "Combo Hemat", "quantity": 2, "unit_price": 60000, "subtotal": 120000 }
  ]
} }
```

---

## 6. Split Bill Module (TAHAP 5-6)

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| POST | `/bookings/{id}/split-bills` | ✅ | Buat patungan (FR-SB-01) |
| GET | `/split-bills/{id}` | ✅ | Tracker status host (FR-SB-03) |
| GET | `/split-bills/share/{token}` | - | **Halaman publik** dari link yang dibagikan |
| POST | `/bookings/{id}/payments` | ✅ | Bayar satu share peserta lewat `participant_id` (§8) |

**POST /bookings/{id}/split-bills** — body:
```json
{
  "method": "equal",
  "participants": [
    { "name": "Budi", "user_id": "uuid-opsional" },
    { "name": "Sinta" }
  ]
}
```
Response `201` (bentuk identik untuk `GET /split-bills/{id}` dan `GET /split-bills/share/{token}`):
```json
{ "success": true, "data": {
  "id": "uuid", "booking_id": "uuid", "method": "equal", "status": "pending",
  "total_amount": 200000, "share_count": 2,
  "share_token": "sp_9f8a7b6c1d2e3f40",
  "share_url": "http://localhost:3000/api/v1/split-bills/share/sp_9f8a7b6c1d2e3f40",
  "expires_at": "2026-10-12T10:00:00.000Z", "created_at": "2026-10-11T10:00:00.000Z",
  "host": { "id": "uuid", "name": "Budi" },
  "booking": {
    "id": "uuid", "booking_code": "CG-K3M7PQ", "status": "pending_payment",
    "movie_title": "Inside Out 2", "cinema_name": "CGV Grand Indonesia",
    "studio": "Studio 1", "starts_at": "2026-10-11T13:00:00.000Z"
  },
  "tracker": { "total": 200000, "paid": 0, "remaining": 200000, "paid_count": 0, "pending_count": 2, "all_paid": false },
  "participants": [
    { "id": "uuid", "name": "Budi", "user_id": "uuid", "share_amount": 100000, "status": "pending",
      "paid_at": null, "pay_url": "http://localhost:3000/api/v1/split-bills/share/sp_...?participant=uuid",
      "qris_payload": "000201293050008ID.CO.CINEGEN..." }
  ]
} }
```
Aturan implementasi:
- Untuk `method: "custom"`, tiap peserta wajib menyertakan `amount`; server menolak `422 SHARE_MISMATCH` bila total share ≠ `grand_total` booking.
- Uang selalu integer (rupiah). Sisa pembagian yang tidak habis dibagi (mis. Rp50.003 ÷ 3) dibebankan ke host — jika host tidak ikut terdaftar sebagai peserta, sisa jatuh ke peserta pertama. Dijamin `sum(share_amount) == total_amount`.
- `participant.user_id` yang sama tidak boleh muncul dua kali (`422 VALIDATION_ERROR`).
- Hanya pemilik booking berstatus `pending_payment`/`partially_paid` yang bisa membuat patungan: `409 BOOKING_NOT_PAYABLE`; patungan aktif kedua pada booking yang sama → `409 SPLIT_EXISTS`.
- `GET /split-bills/{id}`: host atau peserta bertaut (`403 FORBIDDEN` untuk selain itu). Tautan kedaluwarsa → `410 SPLIT_EXPIRED` (TTL dari `SPLIT_SHARE_TTL_MINUTES`).
- `GET /split-bills/share/{token}`: publik (tanpa auth), dipakai halaman yang dibuka dari link/QR. Tracker tetap lengkap, tetapi `host.id` dan `participant.user_id` di-redaksi menjadi `null`.
- `qris_payload` adalah string EMVCo tag-length-value siap render (CRC-16/CCITT-FALSE pada tag 63). Sejak TAHAP 6 pembayaran share memakai `POST /bookings/{id}/payments` dengan `participant_id` (§8); begitu tiap share lunas, peserta berubah jadi `paid` dan share terakhir melunasi booking.

---

## 7. AI Recommendation Module (TAHAP 5)

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| POST | `/ai/quiz` | ✅ | Quick Quiz (FR-AI-01) |
| POST | `/ai/chat` | ✅ | Cine-Buddy chatbot (FR-AI-02) |
| GET | `/ai/chat/sessions` | ✅ | Riwayat sesi chat — **tidak dibuat**; riwayat disimpan di perangkat (maks 12 pesan) sesuai aturan privasi percakapan AI |

**POST /ai/quiz** — body (semua jawaban kuesioner visual):
```json
{
  "mood": "pengen_ketawa",
  "favorite_genres": ["Comedy", "Family"],
  "max_duration_minutes": 120,
  "companion": "keluarga",
  "city": "Jakarta",
  "limit": 3
}
```
`mood`: `pengen_ketawa | santai | inspiratif | tegang | romantis | keluarga` ·
`companion`: `sendiri | pasangan | keluarga | teman` · `limit` 1-5 (default 3).

Response — **selalu** menyertakan rationale (FR-AI-03):
```json
{ "success": true, "data": {
  "engine": "gemini",
  "recommendations": [
    {
      "movie": { "id": "uuid", "title": "Inside Out 2", "slug": "inside-out-2", "genres": ["Animation", "Family"], "duration_minutes": 96, "age_rating": "SU", "rating_score": 8.0, "showing_count": 12, "poster_url": "...", "synopsis": "..." },
      "match_score": 0.95,
      "rationale": "Film ini cocok untuk Anda karena Anda sedang mencari tontonan ... , genre favorit Anda (Family) ada di film ini, durasi 96 menit masih di bawah batas 120 menit, rating ulasan 8.0/10, 12 jadwal tayang tersedia minggu ini."
    }
  ]
} }
```
**POST /ai/chat** — body `{ "message": "...", "history": [{ "role": "user|assistant", "content": "..." }], "city?", "limit"? }`
Response menambahkan `"engine": "gemini" | "local"` dan `"reply": "..."` (kalimat Cine-Buddy) di samping `recommendations` dengan bentuk yang sama.

Cara kerja & NFR (respons AI < 2.5 detik):
1. Kandidat disaring dari DB lebih dulu (`now_showing` + jadwal aktif, filter kota, maksimal 24 film).
2. Mesin lokal deterministik selalu menghitung skor + rationale; jika `GEMINI_API_KEY` kosong, panggilan timeout (`AI_TIMEOUT_MS`, default 2000 ms), atau JSON LLM tidak valid, respons jatuh ke mesin lokal dengan `engine: "local"` — bentuk respons tidak pernah berubah.
3. Rationale selalu diawali `"Film ini cocok untuk Anda karena "`.
4. `companion: "keluarga"` hanya meloloskan rating umur `SU`/`13+`.
5. Tidak ada kandidat sama sekali → `404 NO_CANDIDATE`.

---

## 8. Payments & E-Ticket Module (TAHAP 6)

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| POST | `/bookings/{id}/payments` | ✅ | Buat/pakai ulang intent pembayaran (kanal `qris`, `virtual_account`, `ewallet`) |
| GET | `/payments/{id}/status` | ✅ | Status payment + status booking (dipakai polling 1,5s) |
| POST | `/payments/{id}/simulate` | ✅ | Dev/test only: tandai lunas tanpa gateway (403 di production) |
| POST | `/payments/webhook/{gateway}` | - | Notifikasi gateway; `signature_key` Midtrans diverifikasi |
| GET | `/bookings/{id}/ticket` | ✅ | E-ticket + kode/QR pengambilan F&B |
| POST | `/etickets/scan` | ✅ admin | Verifikasi QR tiket/F&B di gerbang masuk |

**POST /bookings/{id}/payments** — body: `{ "channel": "qris", "participant_id": "uuid?" }`
Response `201`:

```json
{
  "id": "uuid",
  "booking_id": "uuid",
  "channel": "qris",
  "amount": 75000,
  "status": "pending",
  "gateway": "simulated",
  "simulated": true,
  "qris_payload": "00020126...",
  "pay_url": null,
  "va_number": null,
  "va_bank": null,
  "transaction_id": "sim_<payment id>",
  "poll_url": "/api/v1/payments/uuid/status"
}
```

Aturan implementasi:
1. `order_id` yang dikirim ke gateway adalah **id payment kami**, sehingga notifikasi selalu bisa dikorelasikan tanpa tabel tambahan.
2. `participant_id` kosong = lunasi seluruh `grand_total`; terisi = bayar satu share patungan. Pemilik booking boleh membayar share siapa pun, peserta lain hanya share-nya sendiri (`403`).
3. Charge yang masih `pending` pada lingkup & kanal yang sama **dipakai ulang**, tidak membuat transaksi baru (halaman bayar bisa dibuka berkali-kali).
4. Booking dengan patungan aktif menolak pelunasan penuh (`409 SPLIT_ACTIVE`); booking tidak payable → `409 BOOKING_NOT_PAYABLE`; `payment_due_at` lewat → `410 PAYMENT_WINDOW_CLOSED`.
5. Settlement hanya lewat satu pintu (`settlePayment`), idempoten pada status final. Notifikasi ulang → `effect: "duplicate"`, tiket tidak pernah terbit dua kali.
6. Nominal notifikasi berbeda dari tagihan → payment ditandai `failed` + `effect: "amount_mismatch"`, tiket tidak terbit.
7. Booking `cancelled`/`expired` saat settlement datang → payment `failed` dengan `failure_reason: BOOKING_NOT_PAYABLE` (refund manual, di luar cakupan). Status `void` dari gateway sengaja diabaikan agar tidak membatalkan tiket yang sudah lunas.
8. share dibayar → `split_bills.status` dan `bookings.status` (`partially_paid`) diperbarui; share terakhir mengubah booking jadi `paid` **+ menerbitkan e-ticket** pada transaksi yang sama.
9. `GET /bookings/{id}/ticket` sebelum lunas → `409 TICKET_NOT_ISSUED`.
10. QR = `cinegen:<ticket|fnb>:<kode>:<booking_code>:<hmac-sha256>` dengan `TICKET_QR_SECRET`; verifikasi tidak butuh lookup DB dan menolak QR yang kodenya/nominalnya diubah. Tidak ada data kartu yang disimpan di server (hanya id transaksi & status gateway).
11. Tanpa `MIDTRANS_SERVER_KEY`, gateway `simulated` dipakai: payload QRIS/VA dibuat lokal dan pelunasan lewat `/payments/{id}/simulate`. Bentuk respons identik, jadi klien tidak perlu bercabang logika.

---

## 9. Urutan Pengembangan
Endpoint di atas diimplementasikan bertahap: **TAHAP 3** → Auth (§2), Movies/Showtimes (§3), Seat & Booking (§4). **TAHAP 5** → AI (§7) + Split Bill (§6). **TAHAP 6** → Payments/E-Ticket (§8) + QR F&B (§5 terakhir).
