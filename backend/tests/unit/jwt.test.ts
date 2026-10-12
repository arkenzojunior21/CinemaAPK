import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signAccessToken, signRefreshToken, verifyToken, hashToken } from '../../src/common/utils/jwt.js';
import { AppError } from '../../src/common/errors/app-error.js';

const user = { id: '11111111-1111-1111-1111-111111111111', email: 'test@mail.com', role: 'user' as const };

describe('JWT utils', () => {
  it('access token diverifikasi dengan payload lengkap', () => {
    const token = signAccessToken(user);
    const payload = verifyToken(token, 'access');
    assert.equal(payload.sub, user.id);
    assert.equal(payload.email, user.email);
    assert.equal(payload.role, user.role);
    assert.equal(payload.typ, 'access');
  });

  it('refresh token tidak diterima sebagai access token', () => {
    const token = signRefreshToken(user);
    assert.throws(() => verifyToken(token, 'access'), AppError);
  });

  it('access token tidak diterima sebagai refresh token', () => {
    const token = signAccessToken(user);
    assert.throws(() => verifyToken(token, 'refresh'), AppError);
  });

  it('token yang dimanipulasi ditolak', () => {
    const token = signAccessToken(user);
    assert.throws(() => verifyToken(`${token}x`, 'access'), AppError);
  });

  it('hashToken menghasilkan sha256 hex 64 karakter dan deterministik', () => {
    const hash1 = hashToken('abc');
    const hash2 = hashToken('abc');
    assert.equal(hash1, hash2);
    assert.match(hash1, /^[0-9a-f]{64}$/);
    assert.notEqual(hash1, hashToken('abd'));
  });
});
