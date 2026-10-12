import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from '../../src/common/utils/passwords.js';

describe('Password utils', () => {
  it('hash berbeda dari password asli dan bisa diverifikasi', async () => {
    const hash = await hashPassword('rahasia123');
    assert.notEqual(hash, 'rahasia123');
    assert.equal(await verifyPassword('rahasia123', hash), true);
  });

  it('password salah gagal verifikasi', async () => {
    const hash = await hashPassword('rahasia123');
    assert.equal(await verifyPassword('salah999', hash), false);
  });

  it('salt acak: hash berbeda untuk password sama', async () => {
    const h1 = await hashPassword('rahasia123');
    const h2 = await hashPassword('rahasia123');
    assert.notEqual(h1, h2);
  });
});
