import { Router } from 'express';
import { requireAuth } from '../../common/middlewares/auth.js';
import { getBody, validateBody } from '../../common/middlewares/validate.js';
import * as authService from './auth.service.js';
import {
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  type LoginInput,
  type RefreshTokenInput,
  type RegisterInput,
} from './auth.schemas.js';

export const authRouter = Router();

authRouter.post('/register', validateBody(registerSchema), async (_req, res) => {
  const body = getBody<RegisterInput>(res);
  const result = await authService.register(body);
  res.status(201).json({ success: true, data: result });
});

authRouter.post('/login', validateBody(loginSchema), async (_req, res) => {
  const body = getBody<LoginInput>(res);
  const result = await authService.login(body);
  res.json({ success: true, data: result });
});

authRouter.post('/refresh', validateBody(refreshTokenSchema), async (_req, res) => {
  const body = getBody<RefreshTokenInput>(res);
  const result = await authService.refresh(body);
  res.json({ success: true, data: result });
});

authRouter.post('/logout', requireAuth, validateBody(refreshTokenSchema), async (_req, res) => {
  const body = getBody<RefreshTokenInput>(res);
  await authService.logout(body.refresh_token);
  res.json({ success: true, data: { message: 'Logout berhasil.' } });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const profile = await authService.getProfile(req.user!.id);
  res.json({ success: true, data: profile });
});
