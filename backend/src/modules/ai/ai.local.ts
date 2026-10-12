import type { COMPANIONS, MOODS } from './ai.schemas.js';

export type Mood = (typeof MOODS)[number];
export type Companion = (typeof COMPANIONS)[number];

export interface CandidateMovie {
  id: string;
  title: string;
  slug: string;
  genres: string[];
  duration_minutes: number;
  age_rating: string;
  language: string | null;
  synopsis: string | null;
  poster_url: string | null;
  rating_score: number | null;
  showing_count: number;
}

export interface Preference {
  mood: Mood;
  favorite_genres: string[];
  max_duration_minutes: number;
  companion: Companion;
}

export interface Recommendation {
  movie: CandidateMovie;
  match_score: number;
  rationale: string;
}

/** Genre yang biasanya memuaskan tiap mood — dipakai mesin lokal dan sebagai kandidat awal. */
export const MOOD_GENRES: Record<Mood, string[]> = {
  pengen_ketawa: ['Comedy', 'Animation'],
  santai: ['Comedy', 'Family', 'Romance', 'Animation'],
  inspiratif: ['Drama', 'Biography', 'Adventure', 'Sci-Fi'],
  tegang: ['Action', 'Thriller', 'Horror', 'Superhero', 'Sci-Fi'],
  romantis: ['Romance', 'Drama', 'Family'],
  keluarga: ['Family', 'Animation', 'Adventure'],
};

/** Rating umur yang aman untuk tiap konteks teman nonton (FR-AI-01). */
export const COMPANION_AGE_LIMITS: Record<Companion, string[]> = {
  sendiri: ['SU', '13+', '17+', '21+'],
  pasangan: ['SU', '13+', '17+', '21+'],
  teman: ['SU', '13+', '17+', '21+'],
  keluarga: ['SU', '13+'],
};

const MOOD_LABEL: Record<Mood, string> = {
  pengen_ketawa: 'ingin tertawa',
  santai: 'butuh tontonan ringan',
  inspiratif: 'tertarik cerita yang menguatkan',
  tegang: 'suka ketegangan',
  romantis: 'mencari kisah romantis',
  keluarga: 'menonton bersama keluarga',
};

const COMPANION_LABEL: Record<Companion, string> = {
  sendiri: 'sendiri',
  pasangan: 'berdua dengan pasangan',
  keluarga: 'bareng keluarga termasuk anak-anak',
  teman: 'rombongan teman',
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function overlaps(listA: string[], listB: string[]): string[] {
  const b = new Set(listA.map(normalize));
  return listB.filter((genre) => b.has(normalize(genre)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function scoreCandidate(movie: CandidateMovie, preference: Preference): number {
  const moodGenres = MOOD_GENRES[preference.mood];
  const wanted = [...new Set([...preference.favorite_genres, ...moodGenres])];

  const matched = overlaps(moodGenres, movie.genres);
  const matchedFavorite = overlaps(preference.favorite_genres, movie.genres);

  const genreScore = wanted.length === 0 ? 0.5 : Math.min(1, (matched.length + matchedFavorite.length) / 2);
  const moodScore = matched.length > 0 ? 1 : 0.25;
  const durationScore =
    movie.duration_minutes <= preference.max_duration_minutes ? 1 : 0.35;
  const ratingScore = (movie.rating_score ?? 6.5) / 10;

  return 0.4 * genreScore + 0.2 * moodScore + 0.15 * durationScore + 0.25 * ratingScore;
}

function buildRationale(movie: CandidateMovie, preference: Preference): string {
  const matched = overlaps(MOOD_GENRES[preference.mood], movie.genres);
  const matchedFavorite = overlaps(preference.favorite_genres, movie.genres);
  const parts: string[] = [];

  parts.push(`Anda sedang mencari tontonan ${MOOD_LABEL[preference.mood]} untuk ${COMPANION_LABEL[preference.companion]}`);

  if (matchedFavorite.length > 0) {
    parts.push(`genre favorit Anda (${matchedFavorite.join(', ')}) ada di film ini`);
  } else if (matched.length > 0) {
    parts.push(`nuansa ${matched.join(', ')} kuat di film ini`);
  }

  parts.push(
    movie.duration_minutes <= preference.max_duration_minutes
      ? `durasi ${movie.duration_minutes} menit masih di bawah batas ${preference.max_duration_minutes} menit`
      : `durasi ${movie.duration_minutes} menit sedikit melebihi batas, tapi tetap layak`,
  );

  if (movie.rating_score !== null) {
    parts.push(`rating ulasan ${movie.rating_score.toFixed(1)}/10`);
  }
  if (movie.showing_count > 0) {
    parts.push(`${movie.showing_count} jadwal tayang tersedia minggu ini`);
  }

  return `Film ini cocok untuk Anda karena ${parts.join(', ')}.`;
}

/**
 * Mesin rekomendasi deterministik: selalu mengembalikan struktur ber-rationale
 * (FR-AI-03) dan dipakai sebagai fallback ketika LLM tidak tersedia/gagal.
 */
export function recommendLocally(
  candidates: readonly CandidateMovie[],
  preference: Preference,
  limit: number,
): Recommendation[] {
  const allowedAges = new Set(COMPANION_AGE_LIMITS[preference.companion]);

  return candidates
    .filter((movie) => allowedAges.has(movie.age_rating))
    .map((movie) => ({
      movie,
      match_score: round2(scoreCandidate(movie, preference)),
      rationale: buildRationale(movie, preference),
    }))
    .sort((a, b) => b.match_score - a.match_score || b.movie.showing_count - a.movie.showing_count)
    .slice(0, limit);
}

const MOOD_KEYWORDS: [RegExp, Mood][] = [
  [/\b(ketawa|komedi|lucu|funny|garing)\b/i, 'pengen_ketawa'],
  [/\b(santai|ringan|healing|santuy)\b/i, 'santai'],
  [/\b(inspirasi|inspiratif|terinspirasi|drama|biografi|motivasi|menyentuh)\b/i, 'inspiratif'],
  [/\b(tegang|thriller|horor|aksi|action|perang)\b/i, 'tegang'],
  [/\b(romantis|cinta|romance|galau)\b/i, 'romantis'],
  [/\b(keluarga|anak|bareng ortu|family)\b/i, 'keluarga'],
];

const COMPANION_KEYWORDS: [RegExp, Companion][] = [
  [/\b(keluarga|anak|istri|suami dan anak|ortu)\b/i, 'keluarga'],
  [/\b(pasangan|gebetan|kencan|pacar)\b/i, 'pasangan'],
  [/\b(teman|sahabat|nongkrong|rombongan)\b/i, 'teman'],
];

const GENRE_HINTS: [RegExp, string][] = [
  [/\bkomedi|comedy\b/i, 'Comedy'],
  [/\banimasi|animation\b/i, 'Animation'],
  [/\baksi|action\b/i, 'Action'],
  [/\bhoror|horror\b/i, 'Horror'],
  [/\bdrama\b/i, 'Drama'],
  [/\bsci[- ]?fi\b/i, 'Sci-Fi'],
  [/\bromance|romantis\b/i, 'Romance'],
  [/\bfamily|keluarga\b/i, 'Family'],
  [/\bsuperhero\b/i, 'Superhero'],
];

function extractDuration(text: string): number | null {
  const match = text.match(/(\d{2,3})\s*(menit|mnt|minute|min)\b/i);
  if (match) return Number(match[1]);
  const hours = text.match(/(\d{1,2})\s*(jam|hour|hr)\b/i);
  if (hours) return Number(hours[1]) * 60;
  return null;
}

/** Parser aturan untuk Cine-Buddy saat LLM tidak dipakai (mode lokal). */
export function parsePreferenceFromText(message: string): Preference {
  const mood = MOOD_KEYWORDS.find(([pattern]) => pattern.test(message))?.[1] ?? 'santai';
  const companion = COMPANION_KEYWORDS.find(([pattern]) => pattern.test(message))?.[1] ?? 'sendiri';
  const genres = GENRE_HINTS.filter(([pattern]) => pattern.test(message)).map(([, genre]) => genre);
  const duration = extractDuration(message);

  return {
    mood,
    companion,
    favorite_genres: genres,
    max_duration_minutes: duration ?? 180,
  };
}
