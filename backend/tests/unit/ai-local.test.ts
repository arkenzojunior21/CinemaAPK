import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMPANION_AGE_LIMITS,
  MOOD_GENRES,
  parsePreferenceFromText,
  recommendLocally,
  scoreCandidate,
  type CandidateMovie,
  type Preference,
} from '../../src/modules/ai/ai.local.js';

function candidate(overrides: Partial<CandidateMovie> = {}): CandidateMovie {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Film Contoh',
    slug: 'film-contoh',
    genres: ['Drama'],
    duration_minutes: 120,
    age_rating: '13+',
    language: 'Indonesian',
    synopsis: 'Sinopsis singkat.',
    poster_url: null,
    rating_score: 7.5,
    showing_count: 4,
    ...overrides,
  };
}

function preference(overrides: Partial<Preference> = {}): Preference {
  return {
    mood: 'pengen_ketawa',
    favorite_genres: ['Comedy'],
    max_duration_minutes: 120,
    companion: 'sendiri',
    ...overrides,
  };
}

describe('recommendLocally', () => {
  it('setiap rekomendasi selalu punya rationale (FR-AI-03)', () => {
    const results = recommendLocally(
      [candidate(), candidate({ id: '22222222-2222-4222-8222-222222222222', title: 'Kedua' })],
      preference(),
      3,
    );
    assert.equal(results.length, 2);
    for (const item of results) {
      assert.match(item.rationale, /^Film ini cocok untuk Anda karena .+\.$/);
      assert.ok(item.match_score >= 0 && item.match_score <= 1);
    }
  });

  it('menyebut mood, batas durasi, dan rating pada rationale', () => {
    const [first] = recommendLocally(
      [candidate({ genres: ['Comedy'], rating_score: 8.4 })],
      preference({ max_duration_minutes: 100 }),
      1,
    );
    assert.match(first!.rationale, /ingin tertawa/);
    assert.match(first!.rationale, /sedikit melebihi batas/);
    assert.match(first!.rationale, /rating ulasan 8\.4\/10/);
  });

  it('membuang film yang tidak aman untuk nonton bersama keluarga', () => {
    const results = recommendLocally(
      [
        candidate({ id: '33333333-3333-4333-8333-333333333333', age_rating: 'SU' }),
        candidate({ id: '44444444-4444-4444-8444-444444444444', age_rating: '17+' }),
        candidate({ id: '55555555-5555-4555-8555-555555555555', age_rating: '21+' }),
      ],
      preference({ companion: 'keluarga' }),
      5,
    );
    assert.deepEqual(
      results.map((r) => r.movie.age_rating),
      ['SU'],
    );
  });

  it('menghormati limit dan mengurutkan skor dari yang tertinggi', () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      candidate({
        id: `66666666-6666-4666-8666-66666666666${i}`,
        rating_score: 5 + i * 0.5,
      }),
    );
    const results = recommendLocally(candidates, preference(), 3);
    assert.equal(results.length, 3);
    const scores = results.map((r) => r.match_score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });

  it('skor film comedy lebih tinggi daripada thriller untuk mood pengen ketawa', () => {
    const funny = candidate({ genres: ['Comedy'], id: '77777777-7777-4777-8777-777777777777' });
    const tense = candidate({
      genres: ['Thriller'],
      id: '88888888-8888-4888-8888-888888888888',
    });
    assert.ok(scoreCandidate(funny, preference()) > scoreCandidate(tense, preference()));
  });

  it('durasi di bawah batas memberi skor lebih besar', () => {
    const short = candidate({ duration_minutes: 90 });
    const long = candidate({ duration_minutes: 200 });
    const pref = preference({ max_duration_minutes: 120 });
    assert.ok(scoreCandidate(short, pref) > scoreCandidate(long, pref));
  });

  it('genap: semua mood punya pemetaan genre dan semua companion punya batas umur', () => {
    for (const mood of Object.keys(MOOD_GENRES)) {
      assert.ok(MOOD_GENRES[mood as keyof typeof MOOD_GENRES].length > 0, mood);
    }
    for (const companion of Object.keys(COMPANION_AGE_LIMITS)) {
      assert.ok(COMPANION_AGE_LIMITS[companion as keyof typeof COMPANION_AGE_LIMITS].length > 0);
    }
  });
});

describe('parsePreferenceFromText', () => {
  it('memahami permintaan film keluarga untuk anak dengan batas durasi', () => {
    const parsed = parsePreferenceFromText(
      'Rekomendasikan film keluarga yang aman untuk anak usia 10 tahun, maksimal 120 menit',
    );
    assert.equal(parsed.mood, 'keluarga');
    assert.equal(parsed.companion, 'keluarga');
    assert.equal(parsed.max_duration_minutes, 120);
    assert.ok(parsed.favorite_genres.includes('Family'));
  });

  it('mengkonversi satuan jam menjadi menit', () => {
    assert.equal(parsePreferenceFromText('cari film tegang bawah 2 jam').max_duration_minutes, 120);
  });

  it('mendeteksi mood dari kata kunci', () => {
    assert.equal(parsePreferenceFromText('pengen ketawa malam ini').mood, 'pengen_ketawa');
    assert.equal(parsePreferenceFromText('lagi pengen yang tegang').mood, 'tegang');
    assert.equal(parsePreferenceFromText('butuh cerita inspiratif').mood, 'inspiratif');
    assert.equal(parsePreferenceFromText('nonton sama pasangan').companion, 'pasangan');
  });

  it('memakai default santai / sendiri / 180 menit untuk kalimat netral', () => {
    const parsed = parsePreferenceFromText('ada film apa saja minggu ini?');
    assert.equal(parsed.mood, 'santai');
    assert.equal(parsed.companion, 'sendiri');
    assert.equal(parsed.max_duration_minutes, 180);
    assert.deepEqual(parsed.favorite_genres, []);
  });

  it('hasil parsing selalu bisa dipakai mesin lokal', () => {
    const parsed = parsePreferenceFromText('film animasi ringan buat keluarga, 100 menit');
    const results = recommendLocally(
      [candidate({ genres: ['Animation', 'Family'], age_rating: 'SU' })],
      parsed,
      3,
    );
    assert.equal(results.length, 1);
    assert.match(results[0]!.rationale, /^Film ini cocok untuk Anda karena/);
  });
});
