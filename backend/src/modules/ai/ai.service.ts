import { z } from 'zod';
import { getPool } from '../../db/pool.js';
import { AppError } from '../../common/errors/app-error.js';
import { generateJson, isLlmConfigured } from './ai.gemini.js';
import {
  MOOD_GENRES,
  parsePreferenceFromText,
  recommendLocally,
  type CandidateMovie,
  type Preference,
  type Recommendation,
} from './ai.local.js';
import type { ChatInput, QuizInput } from './ai.schemas.js';

const CANDIDATE_SELECT = `
  SELECT m.id, m.title, m.slug, m.genres, m.duration_minutes, m.age_rating, m.language,
         m.synopsis, m.poster_url, m.rating_score,
         count(st.id) AS showing_count
  FROM movies m
  LEFT JOIN showtimes st
    ON st.movie_id = m.id AND st.is_active AND st.starts_at > now()
  LEFT JOIN studios sd ON sd.id = st.studio_id
  LEFT JOIN cinemas cn ON cn.id = sd.cinema_id
  WHERE m.status = 'now_showing'
    AND ($1::text IS NULL OR lower(cn.city) = lower($1::text))
  GROUP BY m.id
  ORDER BY showing_count DESC, m.rating_score DESC NULLS LAST
  LIMIT 24
`;

interface CandidateRow {
  id: string;
  title: string;
  slug: string;
  genres: string[];
  duration_minutes: number;
  age_rating: string;
  language: string | null;
  synopsis: string | null;
  poster_url: string | null;
  rating_score: string | null;
  showing_count: string;
}

async function loadCandidates(city?: string): Promise<CandidateMovie[]> {
  const result = await getPool().query<CandidateRow>(CANDIDATE_SELECT, [city ?? null]);
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    genres: row.genres,
    duration_minutes: row.duration_minutes,
    age_rating: row.age_rating,
    language: row.language,
    synopsis: row.synopsis,
    poster_url: row.poster_url,
    rating_score: row.rating_score === null ? null : Number(row.rating_score),
    showing_count: Number(row.showing_count),
  }));
}

const llmRecommendationSchema = z.object({
  recommendations: z
    .array(
      z.object({
        movie_id: z.uuid(),
        match_score: z.number().min(0).max(1),
        rationale: z.string().min(20).max(400),
      }),
    )
    .min(1)
    .max(5),
});

const llmChatSchema = z.object({
  reply: z.string().min(10).max(600),
  criteria: z.object({
    mood: z.enum(['pengen_ketawa', 'santai', 'inspiratif', 'tegang', 'romantis', 'keluarga']),
    favorite_genres: z.array(z.string().max(40)).max(6).default([]),
    max_duration_minutes: z.number().int().min(30).max(300).default(180),
    companion: z.enum(['sendiri', 'pasangan', 'keluarga', 'teman']).default('sendiri'),
  }),
});

function candidateBrief(movie: CandidateMovie): string {
  return [
    `- id=${movie.id} | ${movie.title} | genre: ${movie.genres.join(', ')}`,
    `  durasi ${movie.duration_minutes} menit | rating umur ${movie.age_rating}`,
    `  skor ulasan ${movie.rating_score ?? 'belum ada'} | ${movie.showing_count} jadwal tayang`,
    `  sinopsis: ${(movie.synopsis ?? '-').slice(0, 160)}`,
  ].join('\n');
}

function preferenceLine(preference: Preference): string {
  return [
    `mood: ${preference.mood} (genre yang cocok: ${MOOD_GENRES[preference.mood].join(', ')})`,
    `genre favorit: ${preference.favorite_genres.join(', ') || 'tidak spesifik'}`,
    `maksimal durasi: ${preference.max_duration_minutes} menit`,
    `teman nonton: ${preference.companion}`,
  ].join(' | ');
}

function toRecommendations(
  ranked: { movie_id: string; match_score: number; rationale: string }[],
  byId: Map<string, CandidateMovie>,
): Recommendation[] {
  return ranked
    .map((item) => {
      const movie = byId.get(item.movie_id);
      return movie ? { movie, match_score: item.match_score, rationale: item.rationale } : null;
    })
    .filter((item): item is Recommendation => item !== null);
}

export interface AiResult {
  engine: 'gemini' | 'local';
  recommendations: Recommendation[];
  reply?: string;
}

/**
 * FR-AI-01: kuesioner cepat. Kandidat disaring di DB lebih dulu, LLM hanya
 * men-skor & merangkai alasan; tanpa key/timeout, mesin lokal yang mengambil alih
 * sehingga bentuk respons tidak pernah berubah (FR-AI-03).
 */
export async function recommendByQuiz(input: QuizInput): Promise<AiResult> {
  const candidates = await loadCandidates(input.city);
  if (candidates.length === 0) {
    throw new AppError(404, 'NO_CANDIDATE', 'Belum ada film yang cocok dengan kriteria Anda.');
  }

  const preference: Preference = {
    mood: input.mood,
    favorite_genres: input.favorite_genres,
    max_duration_minutes: input.max_duration_minutes,
    companion: input.companion,
  };

  const local = recommendLocally(candidates, preference, input.limit);
  if (!isLlmConfigured()) {
    return { engine: 'local', recommendations: local };
  }

  const prompt = [
    'Anda adalah Cine-AI, asisten rekomendasi film bioskop Indonesia.',
    `Preferensi pengguna: ${preferenceLine(preference)}.`,
    'Kandidat film yang benar-benar tersedia:',
    candidates.map(candidateBrief).join('\n'),
    `Pilih maksimal ${input.limit} film terbaik, beri match_score 0..1 dan rationale wajib bahasa Indonesia`,
    'yang menjelaskan MENGAPA film itu cocok (sebut genre, durasi, rating, atau suasana).',
    'Balas HANYA JSON: {"recommendations":[{"movie_id":"uuid","match_score":0.9,"rationale":"..."}]}',
  ].join('\n\n');

  const ranked = await generateJson(prompt, llmRecommendationSchema);
  if (!ranked) {
    return { engine: 'local', recommendations: local };
  }

  const byId = new Map(candidates.map((movie) => [movie.id, movie]));
  const recommendations = toRecommendations(ranked.recommendations, byId);
  if (recommendations.length === 0) {
    return { engine: 'local', recommendations: local };
  }
  return { engine: 'gemini', recommendations: recommendations.slice(0, input.limit) };
}

/** FR-AI-02: Cine-Buddy. Kriteria diekstrak dari percakapan, lalu kandidat dinilai. */
export async function chatWithBuddy(input: ChatInput): Promise<AiResult> {
  const candidates = await loadCandidates(input.city);
  if (candidates.length === 0) {
    throw new AppError(404, 'NO_CANDIDATE', 'Belum ada film yang bisa saya rekomendasikan.');
  }

  const localPreference = parsePreferenceFromText(input.message);
  const local = recommendLocally(candidates, localPreference, input.limit);
  const localReply =
    local.length === 0
      ? 'Hmm, belum ada film yang pas dengan kriteria itu. Coba longgarkan durasi atau ganti suasananya?'
      : `Oke, ini ${local.length} pilihan yang paling pas: ${local
          .map((item) => item.movie.title)
          .join(', ')}. Tiap film saya sertakan alasannya ya.`;

  if (!isLlmConfigured()) {
    return { engine: 'local', reply: localReply, recommendations: local };
  }

  const history = input.history
    .map((message) => `${message.role}: ${message.content.slice(0, 200)}`)
    .join('\n');

  const prompt = [
    'Anda Cine-Buddy, asisten chat rekomendasi film bioskop. Balas bahasa Indonesia yang ramah dan singkat.',
    'Riwayat percakapan:',
    history || '(ini pesan pertama)',
    `Pesan pengguna: ${input.message}`,
    'Kandidat film yang tersedia di sistem:',
    candidates.map(candidateBrief).join('\n'),
    'Ekstrak kriteria pengguna lalu balas HANYA JSON dengan bentuk:',
    '{"reply":"kalimat singkat untuk pengguna","criteria":{"mood":"santai","favorite_genres":["Comedy"],"max_duration_minutes":120,"companion":"keluarga"}}',
    '_allowed mood: pengen_ketawa, santai, inspiratif, tegang, romantis, keluarga.',
  ].join('\n\n');

  const extracted = await generateJson(prompt, llmChatSchema, { temperature: 0.6 });
  if (!extracted) {
    return { engine: 'local', reply: localReply, recommendations: local };
  }

  const rankedLocal = recommendLocally(candidates, extracted.criteria, input.limit);
  if (rankedLocal.length === 0) {
    return { engine: 'gemini', reply: extracted.reply, recommendations: local };
  }
  return { engine: 'gemini', reply: extracted.reply, recommendations: rankedLocal };
}
