import { Router } from 'express';
import { requireAuth } from '../../common/middlewares/auth.js';
import { getBody, validateBody } from '../../common/middlewares/validate.js';
import { chatInputSchema, quizInputSchema, type ChatInput, type QuizInput } from './ai.schemas.js';
import * as aiService from './ai.service.js';

export const aiRouter = Router();

aiRouter.use(requireAuth);

// Kuesioner cepat berbasis kartu visual (FR-AI-01).
aiRouter.post('/quiz', validateBody(quizInputSchema), async (req, res) => {
  const body = getBody<QuizInput>(res);
  const result = await aiService.recommendByQuiz(body);
  res.json({ success: true, data: result });
});

// Cine-Buddy: paham kriteria bebas, tetap mengembalikan rekomendasi beralasan (FR-AI-02).
aiRouter.post('/chat', validateBody(chatInputSchema), async (req, res) => {
  const body = getBody<ChatInput>(res);
  const result = await aiService.chatWithBuddy(body);
  res.json({ success: true, data: result });
});
