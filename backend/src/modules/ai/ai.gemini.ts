import { z } from 'zod';
import { env } from '../../config/env.js';

const geminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() }).passthrough()).default([]),
          })
          .optional(),
      }),
    )
    .default([]),
});

export function isLlmConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

/**
 * Memanggil Gemini dengan permintaan output JSON mentaati `schema`.
 * Sengaja mengembalikan null (bukan melempar) ketika key belum diisi,
 * permintaan melebihi batas waktu, atau model menghasilkan JSON yang tidak valid:
 * pemanggil wajib punya fallback agar NFR < 2,5 detik tetap terpenuhi.
 */
export async function generateJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options: { temperature?: number } = {},
): Promise<T | null> {
  if (!env.GEMINI_API_KEY) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    env.GEMINI_MODEL,
  )}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: options.temperature ?? 0.4,
        },
      }),
      signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const payload = geminiResponseSchema.parse(await response.json());
    const text = payload.candidates[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!text) return null;

    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
