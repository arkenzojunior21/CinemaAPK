import { z } from 'zod';

export const splitParticipantSchema = z.object({
  name: z.string().trim().min(1, 'Nama peserta wajib diisi').max(100),
  user_id: z.uuid('ID peserta tidak valid').optional(),
  amount: z.coerce.number().int().min(0).optional(),
});

export const createSplitBillSchema = z
  .object({
    method: z.enum(['equal', 'custom']),
    participants: z
      .array(splitParticipantSchema)
      .min(2, 'Patungan membutuhkan minimal 2 peserta')
      .max(20, 'Maksimal 20 peserta per patungan'),
  })
  .superRefine((value, ctx) => {
    if (value.method === 'custom') {
      for (const [index, participant] of value.participants.entries()) {
        if (participant.amount === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['participants', index, 'amount'],
            message: 'Metode kustom membutuhkan nominal untuk setiap peserta',
          });
        }
      }
    }

    const linked = value.participants
      .map((p) => p.user_id)
      .filter((id): id is string => id !== undefined);
    if (new Set(linked).size !== linked.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['participants'],
        message: 'Satu pengguna hanya boleh menjadi satu peserta',
      });
    }
  });

export const shareTokenParamsSchema = z.object({
  token: z.string().regex(/^sp_[0-9a-f]{16}$/, 'Token patungan tidak valid'),
});

export type CreateSplitBillInput = z.infer<typeof createSplitBillSchema>;
export type SplitParticipantInput = z.infer<typeof splitParticipantSchema>;
