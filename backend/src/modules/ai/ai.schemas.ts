import { z } from 'zod';

export const MOODS = [
  'pengen_ketawa',
  'santai',
  'inspiratif',
  'tegang',
  'romantis',
  'keluarga',
] as const;

export const COMPANIONS = ['sendiri', 'pasangan', 'keluarga', 'teman'] as const;

export const quizInputSchema = z.object({
  mood: z.enum(MOODS),
  favorite_genres: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
  max_duration_minutes: z.coerce.number().int().min(30).max(300).default(180),
  companion: z.enum(COMPANIONS).default('sendiri'),
  city: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(5).default(3),
});

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(600),
});

export const chatInputSchema = z.object({
  message: z.string().trim().min(3).max(400),
  history: z.array(chatMessageSchema).max(12).default([]),
  city: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(5).default(3),
});

export type QuizInput = z.infer<typeof quizInputSchema>;
export type ChatInput = z.infer<typeof chatInputSchema>;
