import { z } from 'zod';

export const registerSchema = z.object({
  full_name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(100),
  email: z.email('Format email tidak valid').max(255).transform((v) => v.trim().toLowerCase()),
  phone: z
    .string()
    .regex(/^\+?[0-9]{8,15}$/, 'Nomor telepon tidak valid')
    .optional(),
  password: z.string().min(8, 'Password minimal 8 karakter').max(72, 'Password maksimal 72 karakter'),
});

export const loginSchema = z.object({
  email: z.email('Format email tidak valid').transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, 'Password wajib diisi'),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(20, 'Refresh token tidak valid'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
