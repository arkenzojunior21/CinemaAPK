# Product Requirements Document (PRD)

## 1. Document Overview
* **Product Name:** CineGen (Next-Gen Cinema Booking & AI Companion)
* **Document Version:** v1.1.0
* **Date:** October 11, 2026
* **Status:** Ready for Review
* **Target Audience:** Umum (Semua Penikmat Film, Komunitas Cinema, Keluarga, & Penonton Kasual)

---

## 2. Product Objectives & Vision
**CineGen** adalah platform agregator tiket bioskop modern yang dirancang untuk memberikan pengalaman menonton yang praktis, personal, dan efisien bagi **semua kalangan penonton**. Aplikasi ini menyelesaikan masalah *paralysis choice* (kebingungan memilih film) menggunakan rekomendasi AI personal ber-alasan (*rational choice*), mengintegrasikan pemesanan makanan & minuman (F&B) bioskop secara online, serta mempermudah pengalaman nonton bersama melalui fitur *Split Bill* yang transparan.

---

## 3. Target Audience & User Profiles
1. **Penonton Kasual & Keluarga:** Menikmati film pop/blockbuster, membutuhkan kemudahan dalam memilih jadwal, membeli makanan, dan memesan banyak tiket sekaligus.
2. **Penonton Fleksibel (Undecided Viewer):** Bingung menentukan film yang sesuai *mood*, menyukai rekomendasi cepat melalui kuesioner visual atau obrolan santai via *chatbot*.
3. **Pencinta Film (Cinephile & Komunitas):** Menyukai eksplorasi genre, ulasan mendalam, serta kepraktisan membandingkan jadwal antar-jaringan bioskop.

---

## 4. Scope & Feature Specifications

### 4.1. Dual-Mode AI Recommendation Engine (Cine-AI)
* **FR-AI-01 (Kuesioner Interaktif / Quick Quiz):**
  * Pilihan cepat berbasis kartu visual yang intuitif dan ramah untuk segala umur.
  * Parameter: *Mood* (misal: "Pengen Ketawa", "Inspiratif", "Tegang"), Genre Favorit, Durasi, dan Teman Nonton (Sendiri/Pasangan/Keluarga/Teman).
* **FR-AI-02 (Chatbot Interaktif / Cine-Buddy):**
  * Asisten percakapan cerdas dengan bahasa yang ramah dan fleksibel.
  * Mampu memahami kriteria spesifik (misal: *"Rekomendasikan film keluarga yang aman untuk anak usia 10 tahun di bioskop X"*).
* **FR-AI-03 (AI Rationale Output):**
  * Setiap rekomendasi film *wajib* menyertakan alasan penjelas ("*Mengapa Film Ini Cocok untuk Anda*").
  * Contoh: *"Film ini cocok untuk Anda karena sedang mencari tontonan ringan bertema keluarga dengan rating ulasan yang sangat baik minggu ini."*

### 4.2. Multi-Cinema Ticketing & Seat Selection
* **FR-TC-01 (Cinema Aggregation):** Agregasi jadwal tayang dan harga tiket real-time dari berbagai jaringan bioskop.
* **FR-TC-02 (Interactive Seat Map):** Tampilan denah kursi yang jelas, kontras tinggi, dan responsif dengan fitur *seat locking* real-time.

### 4.3. In-App F&B Pre-Ordering
* **FR-FB-01 (Post-Ticket Purchase Trigger):** Katalogo F&B khusus bioskop terkait otomatis ditawarkan setelah tiket selesai dipilih.
* **FR-FB-02 (On-Site Pickup Sync):** Integrasi langsung dengan konter F&B bioskop. Pengguna cukup menunjukkan QR Code tanpa perlu mengantre lama.

### 4.4. Smart Split Bill System
* **FR-SB-01 (Bill Creator):** Pemesan utama (*Host*) dapat membagi total tagihan (tiket + F&B) secara rata atau kustom sesuai pesanan masing-masing.
* **FR-SB-02 (Payment Link Generator):** Menghasilkan tautan pembayaran universal/QRIS patungan yang bisa dikirimkan melalui aplikasi pesan singkat mana pun.
* **FR-SB-03 (Status Tracker):** Rincian status pembayaran yang jelas untuk memantau siapa yang sudah dan belum melunasi patungan.

---

## 5. Non-Functional Requirements (NFR)

* **Usability & Accessibility:** 
  * Antarmuka yang bersih, mudah dibaca, serta mendukung *Light Mode* & *Dark Mode*.
  * Ukuran font dan navigasi yang ramah pengguna dari berbagai tingkat literasi digital.
* **Performance:**
  * Respons rekomendasi AI < 2.5 detik.
  * Pemutakhiran status kursi & pembayaran < 1.5 detik.
* **Security & Compliance:**
  * Perlindungan data pribadi dan riwayat percakapan AI.
  * Standar keamanan transaksi tingkat tinggi (PCI-DSS compliant).

---

## 6. High-Level User Flow

1. **Eksplorasi (Home):** Pengguna masuk -> Memilih jalur pencarian (Navigasi Manual / Kuesioner Cepat / Chatbot AI).
2. **Hasil Rekomendasi:** AI menyajikan daftar film beserta alasan kecocokannya.
3. **Pemesanan Tiket:** Pengguna memilih lokasi bioskop, waktu, dan posisi kursi.
4. **Pemesanan F&B (Opsional):** Menambahkan makanan/minuman dari bioskop terkait ke dalam keranjang.
5. **Pembayaran & Split Bill:** 
   * Memilih *Bayar Sendiri* ATAU *Split Bill (Patungan)*.
   * Jika *Split Bill*: Tautan pembayaran dibagikan -> Masing-masing membayar -> E-ticket & QR Code F&B terbit.
6. **Redemption:** Pengguna melakukan scan QR Code di bioskop untuk mencetak tiket atau mengambil F&B.

---

## 7. Tech Stack Recommendation
* **Mobile App:** Flutter / React Native (Cross-platform iOS & Android)
* **Backend API:** Node.js (Express) / Go
* **Database:** PostgreSQL (Data Transaksi), Redis (Caching & Lock Kursi Real-Time)
* **AI Engine:** OpenAI API / Anthropic Claude / Gemini Flash
* **Payment Gateway:** Midtrans / Xendit (Mendukung e-Wallet, QRIS, Virtual Account, Credit Card)