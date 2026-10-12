-- ============================================================
-- CineGen - Migration 001: Initial Schema
-- Membuat seluruh tabel utama sesuai PRD:
-- users, cinemas, studios, movies, showtimes, seats,
-- seat_reservations, fnb_items, fnb_orders, fnb_order_items,
-- bookings, split_bills, split_bill_participants
--
-- Konvensi:
--   - Primary key  : UUID (gen_random_uuid, built-in PG13+)
--   - Waktu        : TIMESTAMPTZ (UTC)
--   - Uang         : BIGINT dalam Rupiah utuh (IDR tanpa sen)
--   - Array        : TEXT[] untuk data sederhana (genres, dst)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------- ENUM ----------

CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE movie_status AS ENUM ('upcoming', 'now_showing', 'archived');
CREATE TYPE seat_type AS ENUM ('regular', 'premium', 'couple');
CREATE TYPE reservation_status AS ENUM ('locked', 'confirmed', 'released');
CREATE TYPE booking_status AS ENUM ('pending_payment', 'partially_paid', 'paid', 'cancelled', 'expired');
CREATE TYPE fnb_category AS ENUM ('food', 'beverage', 'combo');
CREATE TYPE fnb_order_status AS ENUM ('pending', 'paid', 'preparing', 'ready', 'picked_up', 'cancelled');
CREATE TYPE split_method AS ENUM ('equal', 'custom');
CREATE TYPE split_status AS ENUM ('pending', 'partially_paid', 'paid', 'cancelled');
CREATE TYPE participant_status AS ENUM ('pending', 'paid', 'expired');

-- ---------- USERS ----------

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name     VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    phone         VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    role          user_role NOT NULL DEFAULT 'user',
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_lower_uniq ON users (lower(email));
CREATE UNIQUE INDEX users_phone_uniq ON users (phone) WHERE phone IS NOT NULL;

-- ---------- CINEMAS & STUDIOS ----------

CREATE TABLE cinemas (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chain      VARCHAR(50) NOT NULL,
    name       VARCHAR(150) NOT NULL,
    city       VARCHAR(100) NOT NULL,
    address    TEXT,
    latitude   NUMERIC(9, 6),
    longitude  NUMERIC(9, 6),
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cinemas_city_idx ON cinemas (city) WHERE is_active = true;

CREATE TABLE studios (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cinema_id    UUID NOT NULL REFERENCES cinemas (id) ON DELETE CASCADE,
    name         VARCHAR(50) NOT NULL,
    seat_rows    INT NOT NULL CHECK (seat_rows > 0),
    seat_cols    INT NOT NULL CHECK (seat_cols > 0),
    screen_types TEXT[] NOT NULL DEFAULT '{regular}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cinema_id, name)
);

-- ---------- MOVIES & SHOWTIMES ----------

CREATE TABLE movies (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title            VARCHAR(200) NOT NULL,
    slug             VARCHAR(220) NOT NULL UNIQUE,
    synopsis         TEXT,
    genres           TEXT[] NOT NULL DEFAULT '{}',
    duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
    age_rating       VARCHAR(10) NOT NULL DEFAULT 'SU',
    language         VARCHAR(50),
    poster_url       TEXT,
    backdrop_url     TEXT,
    trailer_url      TEXT,
    rating_score     NUMERIC(3, 1) CHECK (rating_score IS NULL OR (rating_score >= 0 AND rating_score <= 10)),
    release_date     DATE,
    status           movie_status NOT NULL DEFAULT 'upcoming',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX movies_status_idx ON movies (status, release_date DESC);
CREATE INDEX movies_genres_idx ON movies USING gin (genres);
CREATE INDEX movies_search_idx ON movies USING gin (to_tsvector('simple', title));

CREATE TABLE showtimes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id   UUID NOT NULL REFERENCES movies (id) ON DELETE CASCADE,
    studio_id  UUID NOT NULL REFERENCES studios (id) ON DELETE CASCADE,
    starts_at  TIMESTAMPTZ NOT NULL,
    ends_at    TIMESTAMPTZ NOT NULL,
    base_price BIGINT NOT NULL CHECK (base_price >= 0),
    format     VARCHAR(20) NOT NULL DEFAULT '2D',
    language   VARCHAR(50),
    subtitle   VARCHAR(50),
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX showtimes_movie_start_idx ON showtimes (movie_id, starts_at);
CREATE INDEX showtimes_studio_start_idx ON showtimes (studio_id, starts_at);

-- Satu studio tidak boleh punya dua tayangan yang saling tumpang tindih.
ALTER TABLE showtimes
    ADD CONSTRAINT showtimes_no_overlap
    EXCLUDE USING gist (
        studio_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
    ) WHERE (is_active = true);

-- ---------- SEATS & SEAT RESERVATIONS ----------

CREATE TABLE seats (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    studio_id        UUID NOT NULL REFERENCES studios (id) ON DELETE CASCADE,
    row_label        VARCHAR(3) NOT NULL,
    seat_number      INT NOT NULL CHECK (seat_number > 0),
    seat_type        seat_type NOT NULL DEFAULT 'regular',
    price_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.00 CHECK (price_multiplier > 0),
    is_active        BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (studio_id, row_label, seat_number)
);

CREATE INDEX seats_studio_idx ON seats (studio_id) WHERE is_active = true;

CREATE TABLE seat_reservations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    showtime_id UUID NOT NULL REFERENCES showtimes (id) ON DELETE CASCADE,
    seat_id     UUID NOT NULL REFERENCES seats (id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users (id) ON DELETE SET NULL,
    booking_id  UUID,
    status      reservation_status NOT NULL DEFAULT 'locked',
    locked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status <> 'locked' OR expires_at > locked_at)
);

-- Satu kursi hanya boleh punya SATU lock/konfirmasi aktif per showtime.
CREATE UNIQUE INDEX seat_reservations_active_uniq
    ON seat_reservations (showtime_id, seat_id)
    WHERE status IN ('locked', 'confirmed');

CREATE INDEX seat_reservations_showtime_idx ON seat_reservations (showtime_id);
CREATE INDEX seat_reservations_expiring_idx ON seat_reservations (expires_at) WHERE status = 'locked';

-- ---------- BOOKINGS ----------

CREATE TABLE bookings (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_code   VARCHAR(20) NOT NULL UNIQUE,
    user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    showtime_id    UUID NOT NULL REFERENCES showtimes (id),
    status         booking_status NOT NULL DEFAULT 'pending_payment',
    ticket_total   BIGINT NOT NULL DEFAULT 0 CHECK (ticket_total >= 0),
    fnb_total      BIGINT NOT NULL DEFAULT 0 CHECK (fnb_total >= 0),
    grand_total    BIGINT NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
    payment_due_at TIMESTAMPTZ,
    paid_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bookings_user_idx ON bookings (user_id, created_at DESC);
CREATE INDEX bookings_showtime_idx ON bookings (showtime_id);

ALTER TABLE seat_reservations
    ADD CONSTRAINT seat_reservations_booking_fk
    FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE SET NULL;

-- ---------- F&B ----------

CREATE TABLE fnb_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cinema_id   UUID NOT NULL REFERENCES cinemas (id) ON DELETE CASCADE,
    name        VARCHAR(150) NOT NULL,
    description TEXT,
    category    fnb_category NOT NULL,
    price       BIGINT NOT NULL CHECK (price >= 0),
    image_url   TEXT,
    is_available BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX fnb_items_cinema_idx ON fnb_items (cinema_id, category) WHERE is_available = true;

CREATE TABLE fnb_orders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id  UUID NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users (id),
    status      fnb_order_status NOT NULL DEFAULT 'pending',
    total_amount BIGINT NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    pickup_code VARCHAR(10) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX fnb_orders_booking_idx ON fnb_orders (booking_id);

CREATE TABLE fnb_order_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fnb_order_id UUID NOT NULL REFERENCES fnb_orders (id) ON DELETE CASCADE,
    fnb_item_id  UUID NOT NULL REFERENCES fnb_items (id),
    quantity     INT NOT NULL CHECK (quantity > 0),
    unit_price   BIGINT NOT NULL CHECK (unit_price >= 0),
    subtotal     BIGINT NOT NULL CHECK (subtotal >= 0)
);

CREATE INDEX fnb_order_items_order_idx ON fnb_order_items (fnb_order_id);

-- ---------- SPLIT BILLS ----------

CREATE TABLE split_bills (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id   UUID NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    host_user_id UUID NOT NULL REFERENCES users (id),
    method       split_method NOT NULL DEFAULT 'equal',
    total_amount BIGINT NOT NULL CHECK (total_amount >= 0),
    share_count  INT NOT NULL CHECK (share_count > 0),
    status       split_status NOT NULL DEFAULT 'pending',
    share_token  VARCHAR(32) NOT NULL UNIQUE,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX split_bills_booking_idx ON split_bills (booking_id);

CREATE TABLE split_bill_participants (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    split_bill_id     UUID NOT NULL REFERENCES split_bills (id) ON DELETE CASCADE,
    user_id           UUID REFERENCES users (id) ON DELETE SET NULL,
    name              VARCHAR(100) NOT NULL,
    share_amount      BIGINT NOT NULL CHECK (share_amount >= 0),
    status            participant_status NOT NULL DEFAULT 'pending',
    payment_reference VARCHAR(100),
    paid_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX split_bill_participants_bill_idx ON split_bill_participants (split_bill_id);
CREATE INDEX split_bill_participants_user_idx ON split_bill_participants (user_id) WHERE user_id IS NOT NULL;

-- ---------- TRIGGER updated_at ----------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_movies_updated_at BEFORE UPDATE ON movies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_fnb_orders_updated_at BEFORE UPDATE ON fnb_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_split_bills_updated_at BEFORE UPDATE ON split_bills
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
