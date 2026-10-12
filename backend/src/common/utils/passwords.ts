import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

// Menyamakan waktu respons login saat email tidak terdaftar (anti user-enumeration).
const DUMMY_HASH = '$2a$10$C6UzMDM.H6dfI/f/IKcEe.uK0ZLLbP5xO4qtOo9lSihZUJ1Z8j1C6';

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function fakeVerifyPassword(plain: string): Promise<boolean> {
  return bcrypt.compare(plain, DUMMY_HASH);
}
