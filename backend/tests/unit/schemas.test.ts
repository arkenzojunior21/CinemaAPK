import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerSchema, loginSchema } from '../../src/modules/auth/auth.schemas.js';
import { createSeatLockSchema } from '../../src/modules/bookings/bookings.schemas.js';
import { listMoviesQuerySchema } from '../../src/modules/movies/movies.schemas.js';
import { createSplitBillSchema, shareTokenParamsSchema } from '../../src/modules/split/split.schemas.js';
import { chatInputSchema, quizInputSchema } from '../../src/modules/ai/ai.schemas.js';

describe('Auth schemas', () => {
  it('register valid', () => {
    const result = registerSchema.safeParse({
      full_name: 'Budi Santoso',
      email: 'BUDI@Mail.COM',
      password: 'rahasia123',
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.email, 'budi@mail.com');
      assert.equal(result.data.phone, undefined);
    }
  });

  it('register menolak password pendek dan email invalid', () => {
    assert.equal(
      registerSchema.safeParse({ full_name: 'Budi', email: 'budi@mail.com', password: 'abc' }).success,
      false,
    );
    assert.equal(
      registerSchema.safeParse({ full_name: 'Budi', email: 'bukan-email', password: 'rahasia123' }).success,
      false,
    );
  });

  it('register memvalidasi format telepon', () => {
    assert.equal(
      registerSchema.safeParse({
        full_name: 'Budi',
        email: 'b@mail.com',
        phone: '08123',
        password: 'rahasia123',
      }).success,
      false,
    );
  });

  it('login valid', () => {
    assert.equal(
      loginSchema.safeParse({ email: 'budi@mail.com', password: 'x' }).success,
      true,
    );
  });
});

describe('Movies query schema', () => {
  it('default: now_showing, page 1, limit 10', () => {
    const result = listMoviesQuerySchema.safeParse({});
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.status, 'now_showing');
      assert.equal(result.data.page, 1);
      assert.equal(result.data.limit, 10);
    }
  });

  it('coerce page/limit dari string query', () => {
    const result = listMoviesQuerySchema.safeParse({ page: '2', limit: '20' });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.page, 2);
      assert.equal(result.data.limit, 20);
    }
  });

  it('menolak limit > 50 dan status tak dikenal', () => {
    assert.equal(listMoviesQuerySchema.safeParse({ limit: '100' }).success, false);
    assert.equal(listMoviesQuerySchema.safeParse({ status: 'biasa' }).success, false);
  });
});

describe('Seat lock schema', () => {
  const seatId = '11111111-1111-4111-8111-111111111111';

  it('valid dengan array uuid', () => {
    const result = createSeatLockSchema.safeParse({ seat_ids: [seatId, seatId] });
    assert.equal(result.success, true);
  });

  it('menolak array kosong dan uuid invalid', () => {
    assert.equal(createSeatLockSchema.safeParse({ seat_ids: [] }).success, false);
    assert.equal(createSeatLockSchema.safeParse({ seat_ids: ['bukan-uuid'] }).success, false);
  });

  it('menolak lebih dari 10 kursi', () => {
    const ids = Array.from({ length: 11 }, () => seatId);
    assert.equal(createSeatLockSchema.safeParse({ seat_ids: ids }).success, false);
  });
});

describe('Split bill schema', () => {
  const hostId = '11111111-1111-4111-8111-111111111111';
  const guestId = '22222222-2222-4222-8222-222222222222';

  it('metode equal cukup dengan nama peserta', () => {
    const result = createSplitBillSchema.safeParse({
      method: 'equal',
      participants: [
        { name: 'Budi', user_id: hostId },
        { name: 'Sinta' },
      ],
    });
    assert.equal(result.success, true);
  });

  it('membutuhkan minimal 2 peserta', () => {
    assert.equal(
      createSplitBillSchema.safeParse({
        method: 'equal',
        participants: [{ name: 'Budi' }],
      }).success,
      false,
    );
  });

  it('metode custom wajib punya amount per peserta', () => {
    const missing = createSplitBillSchema.safeParse({
      method: 'custom',
      participants: [{ name: 'Budi', amount: 100000 }, { name: 'Sinta' }],
    });
    assert.equal(missing.success, false);
    if (!missing.success) {
      assert.deepEqual(
        missing.error.issues.map((issue) => issue.path.join('.')),
        ['participants.1.amount'],
      );
    }

    assert.equal(
      createSplitBillSchema.safeParse({
        method: 'custom',
        participants: [
          { name: 'Budi', amount: 100000 },
          { name: 'Sinta', amount: 50000 },
        ],
      }).success,
      true,
    );
  });

  it('satu pengguna tidak boleh jadi dua peserta', () => {
    assert.equal(
      createSplitBillSchema.safeParse({
        method: 'equal',
        participants: [
          { name: 'Budi', user_id: guestId },
          { name: 'Budi lagi', user_id: guestId },
        ],
      }).success,
      false,
    );
    assert.equal(
      createSplitBillSchema.safeParse({
        method: 'equal',
        participants: [
          { name: 'Budi', user_id: hostId },
          { name: 'Sinta', user_id: guestId },
        ],
      }).success,
      true,
    );
  });

  it('token share hanya menerima format sp_<16 hex>', () => {
    assert.equal(shareTokenParamsSchema.safeParse({ token: 'sp_0123456789abcdef' }).success, true);
    assert.equal(shareTokenParamsSchema.safeParse({ token: 'sp_ABCDEF' }).success, false);
    assert.equal(shareTokenParamsSchema.safeParse({ token: '0123456789abcdef' }).success, false);
  });
});

describe('AI schemas', () => {
  it('quiz memakai default santai untuk pendamping dan batas durasi', () => {
    const result = quizInputSchema.safeParse({ mood: 'santai' });
    assert.equal(result.success, true);
    if (result.success) {
      assert.deepEqual(result.data.favorite_genres, []);
      assert.equal(result.data.companion, 'sendiri');
      assert.equal(result.data.max_duration_minutes, 180);
      assert.equal(result.data.limit, 3);
    }
  });

  it('quiz menolak mood di luar kartu kuesioner', () => {
    assert.equal(quizInputSchema.safeParse({ mood: 'bosen' }).success, false);
    assert.equal(
      quizInputSchema.safeParse({ mood: 'tegang', max_duration_minutes: 20 }).success,
      false,
    );
  });

  it('quiz memtrim genre favorit', () => {
    const result = quizInputSchema.safeParse({
      mood: 'keluarga',
      companion: 'keluarga',
      favorite_genres: ['  Animation ', 'Family'],
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.deepEqual(result.data.favorite_genres, ['Animation', 'Family']);
    }
  });

  it('chat butuh pesan minimal 3 karakter dan history berperan valid', () => {
    assert.equal(chatInputSchema.safeParse({ message: 'hi' }).success, false);
    assert.equal(chatInputSchema.safeParse({ message: 'ada film apa?' }).success, true);
    assert.equal(
      chatInputSchema.safeParse({
        message: 'film keluarga dong',
        history: [{ role: 'tamu', content: 'halo' }],
      }).success,
      false,
    );
    assert.equal(
      chatInputSchema.safeParse({
        message: 'film keluarga dong',
        history: [{ role: 'assistant', content: 'Halo!' }],
      }).success,
      true,
    );
  });
});
