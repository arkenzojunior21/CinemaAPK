import { Redis } from 'ioredis';
import { env } from '../config/env.js';

let client: Redis | null = null;
let warned = false;

function getClient(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL!, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: (times: number) => (times > 2 ? null : times * 300),
    });
    client.on('error', () => {});
  }
  return client;
}

/**
 * Jalankan operasi Redis; kembalikan null (dan fallback ke DB-only)
 * bila Redis tidak dikonfigurasi/tidak terjangkau.
 * Unique index seat_reservations tetap menjadi penjaga integritas.
 */
export async function withRedis<T>(fn: (redis: Redis) => Promise<T>): Promise<T | null> {
  if (!env.REDIS_URL) return null;
  try {
    const redis = getClient();
    if (['wait', 'close', 'end'].includes(redis.status)) {
      await redis.connect();
    }
    return await fn(redis);
  } catch {
    if (!warned) {
      console.warn('[redis] tidak tersedia — seat locking berjalan mode DB-only');
      warned = true;
    }
    return null;
  }
}
