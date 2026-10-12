import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../../src/app.js';

let server: Server;
let baseUrl: string;

before(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Gagal mendapatkan port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
});

describe('HTTP layer (tanpa DB)', () => {
  it('GET /health → 200 envelope sukses', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean; data: { status: string } };
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'ok');
  });

  it('route tidak dikenal → 404 dengan envelope error', async () => {
    const res = await fetch(`${baseUrl}/api/v1/tidak-ada`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('POST /auth/login body invalid → 422 VALIDATION_ERROR (zod berjalan sebelum DB)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'bukan-email' }),
    });
    assert.equal(res.status, 422);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('GET /bookings tanpa token → 401 UNAUTHORIZED', async () => {
    const res = await fetch(`${baseUrl}/api/v1/bookings`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  it('GET /bookings dengan token access yang dikirim sebagai refresh-type token → 401', async () => {
    const { signRefreshToken } = await import('../../src/common/utils/jwt.js');
    const refreshToken = signRefreshToken({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'x@mail.com',
      role: 'user',
    });
    const res = await fetch(`${baseUrl}/api/v1/bookings`, {
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    assert.equal(res.status, 401);
  });

  it('body bukan JSON → tetap ditangani error handler (400 dari express)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'bukan-json{{',
    });
    assert.ok(res.status === 400 || res.status === 422);
    const body = (await res.json()) as { success: boolean };
    assert.equal(body.success, false);
  });
});
