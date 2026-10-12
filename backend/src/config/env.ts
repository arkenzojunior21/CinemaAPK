import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default('*'),
  BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().default('dev-insecure-access-secret'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().default('dev-insecure-refresh-secret'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  SEAT_LOCK_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(600),
  SPLIT_SHARE_TTL_MINUTES: z.coerce.number().int().min(30).max(10080).default(1440),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(500).max(8000).default(2000),
  MIDTRANS_SERVER_KEY: z.string().optional(),
  MIDTRANS_CLIENT_KEY: z.string().optional(),
  MIDTRANS_BASE_URL: z.string().url().default('https://app.sandbox.midtrans.com'),
  MIDTRANS_VA_BANK: z.string().min(3).max(20).default('bca'),
  TICKET_QR_SECRET: z.string().default('dev-insecure-ticket-secret'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    'Invalid environment variables:',
    parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  );
  process.exit(1);
}

export const env = parsed.data;
export const isDev = env.NODE_ENV === 'development';

const insecureSecret = (value: string) =>
  !value || value.startsWith('dev-insecure') || value === 'ganti-dengan-secret-acak';

if (
  env.NODE_ENV === 'production' &&
  (insecureSecret(env.JWT_ACCESS_SECRET) ||
    insecureSecret(env.JWT_REFRESH_SECRET) ||
    insecureSecret(env.TICKET_QR_SECRET))
) {
  console.error(
    'JWT_ACCESS_SECRET/JWT_REFRESH_SECRET/TICKET_QR_SECRET wajib diisi dengan secret acak di production.',
  );
  process.exit(1);
}
