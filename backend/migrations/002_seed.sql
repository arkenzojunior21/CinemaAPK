-- ============================================================
-- CineGen - Migration 002: Seed Data (Development)
-- Data contoh: 2 bioskop, 4 studio + kursi, 4 film,
-- jadwal 3 hari ke depan, dan katalog F&B per bioskop.
-- ============================================================

-- ---------- CINEMAS ----------

INSERT INTO cinemas (id, chain, name, city, address, latitude, longitude) VALUES
    ('11111111-1111-4111-8111-111111111111', 'CGV', 'CGV Grand Indonesia', 'Jakarta', 'Jl. M.H. Thamrin No.1, Jakarta Pusat', -6.1950, 106.8200),
    ('22222222-2222-4222-8222-222222222222', 'XXI', 'XXI Senayan City', 'Jakarta', 'Jl. Asia Afrika No.8, Jakarta Selatan', -6.2250, 106.8000);

-- ---------- STUDIOS ----------

INSERT INTO studios (id, cinema_id, name, seat_rows, seat_cols, screen_types) VALUES
    ('aaaa0001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Studio 1',      8, 10, '{regular}'),
    ('aaaa0001-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Studio 2 IMAX', 8, 10, '{imax}'),
    ('aaaa0001-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'Studio 1',      8, 10, '{regular}'),
    ('aaaa0001-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'Studio 2 3D',   8, 10, '{3d}');

-- ---------- SEATS (8 baris x 10 kolom per studio) ----------
-- Baris A-B = premium (1.5x), baris H = couple (2.0x), sisanya regular.

INSERT INTO seats (studio_id, row_label, seat_number, seat_type, price_multiplier)
SELECT st.id,
       chr(64 + r),
       c,
       CASE
           WHEN r <= 2 THEN 'premium'
           WHEN r = 8  THEN 'couple'
           ELSE 'regular'
       END::seat_type,
       CASE
           WHEN r <= 2 THEN 1.50
           WHEN r = 8  THEN 2.00
           ELSE 1.00
       END
FROM studios st
CROSS JOIN generate_series(1, 8) AS r
CROSS JOIN generate_series(1, 10) AS c;

-- ---------- MOVIES ----------

INSERT INTO movies (id, title, slug, synopsis, genres, duration_minutes, age_rating, language, rating_score, release_date, status) VALUES
    ('bbbb0001-0000-4000-8000-000000000001', 'Interstellar', 'interstellar',
     'Saat Bumi tak lagi layak huni, seorang petani dan mantan pilot NASA memimpin misi melewati wormhole untuk mencari rumah baru bagi umat manusia.',
     '{Sci-Fi, Drama, Adventure}', 169, '13+', 'English', 9.3, '2014-11-06', 'now_showing'),
    ('bbbb0001-0000-4000-8000-000000000002', 'Inside Out 2', 'inside-out-2',
     'Emosi baru muncul di markas besar pikiran Riley saat ia memasuki masa remaja.',
     '{Animation, Family, Comedy}', 96, 'SU', 'English', 8.0, '2024-06-12', 'now_showing'),
    ('bbbb0001-0000-4000-8000-000000000003', 'Deadpool & Wolverine', 'deadpool-wolverine',
     'Deadpool bergabung dengan Wolverine dalam misi menyelamatkan garis waktunya.',
     '{Action, Comedy, Superhero}', 128, '17+', 'English', 8.1, '2024-07-24', 'now_showing'),
    ('bbbb0001-0000-4000-8000-000000000004', 'Avatar: Fire and Ash', 'avatar-fire-and-ash',
     'Petualangan berikutnya di Pandora menelusuri sukua Ash People.',
     '{Sci-Fi, Adventure}', 190, '13+', 'English', NULL, '2026-12-18', 'upcoming');

-- ---------- SHOWTIMES (hari ini + 2 hari, slot 13/16/19/22) ----------
-- Film now_showing dirotasi merata di seluruh studio.

INSERT INTO showtimes (movie_id, studio_id, starts_at, ends_at, base_price, format, language, subtitle)
SELECT
    m.id,
    st.id,
    current_date + make_interval(days => d) + make_interval(hours => 13 + s * 3),
    current_date + make_interval(days => d) + make_interval(hours => 13 + s * 3) + make_interval(mins => m.duration_minutes),
    CASE
        WHEN 'imax' = ANY (st.screen_types) THEN 60000
        WHEN '3d'   = ANY (st.screen_types) THEN 50000
        ELSE 40000
    END,
    CASE
        WHEN 'imax' = ANY (st.screen_types) THEN 'IMAX'
        WHEN '3d'   = ANY (st.screen_types) THEN '3D'
        ELSE '2D'
    END,
    m.language,
    'Indonesian'
FROM studios st
CROSS JOIN generate_series(0, 2) AS d
CROSS JOIN generate_series(0, 3) AS s
JOIN LATERAL (
    SELECT id, language, duration_minutes
    FROM movies
    WHERE status = 'now_showing'
    ORDER BY slug
    OFFSET ((d * 4 + s) % 3)
    LIMIT 1
) m ON true;

-- ---------- F&B ITEMS (per bioskop) ----------

INSERT INTO fnb_items (cinema_id, name, description, category, price) VALUES
    ('11111111-1111-4111-8111-111111111111', 'Popcorn Regular', 'Popcorn manis ukuran regular', 'food', 40000),
    ('11111111-1111-4111-8111-111111111111', 'Popcorn Caramel', 'Popcorn karamel ukuran besar', 'food', 50000),
    ('11111111-1111-4111-8111-111111111111', 'Cola Large', 'Minuman bersoda ukuran besar', 'beverage', 28000),
    ('11111111-1111-4111-8111-111111111111', 'Air Mineral', 'Air mineral botol 600ml', 'beverage', 12000),
    ('11111111-1111-4111-8111-111111111111', 'Combo Hemat', 'Popcorn regular + cola large', 'combo', 60000),
    ('22222222-2222-4222-8222-222222222222', 'Popcorn Regular', 'Popcorn manis ukuran regular', 'food', 40000),
    ('22222222-2222-4222-8222-222222222222', 'Hotdog Jumbo', 'Hotdog jumbo dengan saus', 'food', 35000),
    ('22222222-2222-4222-8222-222222222222', 'Lemon Tea', 'Es teh lemon segar', 'beverage', 25000),
    ('22222222-2222-4222-8222-222222222222', 'Air Mineral', 'Air mineral botol 600ml', 'beverage', 12000),
    ('22222222-2222-4222-8222-222222222222', 'Combo Keluarga', 'Popcorn besar + 2 lemon tea', 'combo', 85000);
