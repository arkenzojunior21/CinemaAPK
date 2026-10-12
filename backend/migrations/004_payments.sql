-- ============================================================
-- CineGen - Migration 004: Payments & E-Ticket (TAHAP 6)
--
--   - payments            : jejak charge per booking/peserta patungan
--   - bookings            : kolom e-ticket (kode + signature HMAC + waktu terbit)
--   - fnb_orders          : signature untuk QR pengambilan F&B
--
-- Kontribusi keamanan: tidak ada data kartu/credentials yang disimpan —
-- hanya transaksi id dari gateway dan status. Nominal tetap BIGINT Rupiah.
-- ============================================================

CREATE TYPE payment_channel AS ENUM ('qris', 'virtual_account', 'ewallet');
CREATE TYPE payment_status AS ENUM ('pending', 'settled', 'failed', 'expired');

CREATE TABLE payments (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id             UUID NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    split_participant_id   UUID REFERENCES split_bill_participants (id) ON DELETE CASCADE,
    user_id                UUID REFERENCES users (id) ON DELETE SET NULL,
    channel                payment_channel NOT NULL,
    amount                 BIGINT NOT NULL CHECK (amount > 0),
    status                 payment_status NOT NULL DEFAULT 'pending',
    gateway                VARCHAR(20) NOT NULL,
    gateway_transaction_id VARCHAR(120) UNIQUE,
    gateway_raw            JSONB,
    failure_reason         VARCHAR(200),
    settled_at             TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Satu pembayaran patungan per peserta tidak boleh dobel baris.
    CONSTRAINT payments_split_unique UNIQUE (split_participant_id)
);

CREATE INDEX payments_booking_idx ON payments (booking_id, created_at DESC);
CREATE INDEX payments_status_idx ON payments (status) WHERE status = 'pending';

-- ---------- E-TICKET ----------
-- ticket_code acak + ticket_signature = HMAC-SHA256(payload, secret) sehingga
-- QR di gerbang masuk dapat diverifikasi tanpa lookup dan tidak bisa dipalsukan.

ALTER TABLE bookings
    ADD COLUMN ticket_code      VARCHAR(20) UNIQUE,
    ADD COLUMN ticket_signature VARCHAR(64),
    ADD COLUMN ticket_issued_at TIMESTAMPTZ;

ALTER TABLE fnb_orders
    ADD COLUMN pickup_signature VARCHAR(64);

CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
