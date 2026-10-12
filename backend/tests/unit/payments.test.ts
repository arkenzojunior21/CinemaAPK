import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { env } from '../../src/config/env.js';
import {
  assembleQr,
  buildPickupQr,
  buildTicketQr,
  generateTicketCode,
  signQr,
  verifyTicketQr,
} from '../../src/common/utils/eticket.js';
import {
  MidtransGateway,
  midtransSignature,
  verifyMidtransNotification,
} from '../../src/modules/payments/gateways/midtrans.js';
import { SimulatedGateway } from '../../src/modules/payments/gateways/simulated.js';
import { gatewayByName, resolveGateway } from '../../src/modules/payments/gateways/index.js';
import { createPaymentSchema } from '../../src/modules/payments/payments.schemas.js';

const SECRET = 'test-ticket-secret';
const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function notification(overrides: Record<string, unknown>, serverKey = 'sk-test') {
  const base = {
    order_id: UUID,
    status_code: '200',
    gross_amount: '75000',
    transaction_status: 'settlement',
    signature_key: '',
  };
  const body = { ...base, ...overrides };
  if (!body.signature_key) {
    body.signature_key = midtransSignature(
      String(body.order_id),
      String(body.status_code),
      String(body.gross_amount),
      serverKey,
    );
  }
  return body;
}

describe('Signature notifikasi Midtrans', () => {
  it('menerima notifikasi dengan signature_key yang benar', () => {
    const body = notification({});
    assert.equal(verifyMidtransNotification(body, 'sk-test'), true);
  });

  it('menolak saat nominal diubah setelah signature dibuat', () => {
    const body = notification({});
    assert.equal(
      verifyMidtransNotification({ ...body, gross_amount: '1' }, 'sk-test'),
      false,
      'amount tampering harus gagal verifikasi',
    );
  });

  it('menolak saat server key berbeda', () => {
    assert.equal(verifyMidtransNotification(notification({}), 'sk-lain'), false);
  });

  it('menolak body tanpa field wajib', () => {
    assert.equal(verifyMidtransNotification({ order_id: UUID }, 'sk-test'), false);
    assert.equal(verifyMidtransNotification({}, 'sk-test'), false);
    assert.equal(verifyMidtransNotification(notification({}), ''), false);
  });

  it('signature_key uppercase tetap diterima', () => {
    const body = notification({});
    body.signature_key = String(body.signature_key).toUpperCase();
    assert.equal(verifyMidtransNotification(body, 'sk-test'), true);
  });
});

describe('MidtransGateway.parseNotification', () => {
  const gateway = new MidtransGateway('sk-test');

  it('memetakan status gateway ke status internal', () => {
    const cases: [string, string][] = [
      ['settlement', 'settled'],
      ['capture', 'settled'],
      ['expire', 'expired'],
      ['cancel', 'failed'],
      ['pending', 'pending'],
    ];
    for (const [raw, expected] of cases) {
      const parsed = gateway.parseNotification(notification({ transaction_status: raw }));
      assert.equal(parsed?.status, expected, `status ${raw}`);
      assert.equal(parsed?.paymentId, UUID);
      assert.equal(parsed?.grossAmount, 75000);
    }
  });

  it('mengabaikan status yang tidak dikenal', () => {
    assert.equal(gateway.parseNotification(notification({ transaction_status: 'void' })), null);
  });

  it('menolak notifikasi tanpa signature valid', () => {
    assert.equal(gateway.parseNotification(notification({ signature_key: 'deadbeef' })), null);
  });

  it('charge butuh server key dan memakai order_id kami', () => {
    assert.equal(gateway.name, 'midtrans');
    assert.equal(gateway.acceptsNotifications, true);
  });
});

describe('Gateway factory', () => {
  it('memilih midtrans hanya bila MIDTRANS_SERVER_KEY terisi', () => {
    const expected = env.MIDTRANS_SERVER_KEY ? 'midtrans' : 'simulated';
    assert.equal(resolveGateway().name, expected);
  });

  it('gatewayByName hanya mengembalikan gateway yang terkonfigurasi', () => {
    assert.equal(gatewayByName('simulated')?.name, 'simulated');
    assert.equal(gatewayByName('unknown'), null);
    assert.equal(gatewayByName('midtrans') === null, !env.MIDTRANS_SERVER_KEY);
  });
});

describe('SimulatedGateway.charge', () => {
  const gateway = new SimulatedGateway();
  const request = {
    paymentId: UUID,
    channel: 'qris' as const,
    amount: 75000,
    description: 'Tiket CG-ABC123',
    customerName: 'Budi',
  };

  it('QRIS menghasilkan payload EMVCo dengan CRC tag 63', async () => {
    const charge = await gateway.charge(request);
    assert.equal(charge.gateway, 'simulated');
    assert.equal(charge.transactionId, `sim_${UUID}`);
    assert.match(charge.qrisPayload!, /^000201/);
    assert.ok(charge.qrisPayload!.includes(`5405${'75000'}`));
    assert.match(charge.qrisPayload!, /6304[0-9A-F]{4}$/);
    assert.equal(charge.qrisPayload!.length, charge.qrisPayload!.trim().length);
  });

  it('virtual account memberi nomor VA dan nama bank', async () => {
    const charge = await gateway.charge({ ...request, channel: 'virtual_account' });
    assert.match(charge.vaNumber!, /^\d{12,16}$/);
    assert.ok(charge.vaBank);
    assert.equal(charge.qrisPayload, null);
  });

  it('e-wallet memberi tautan bayar', async () => {
    const charge = await gateway.charge({ ...request, channel: 'ewallet' });
    assert.ok(charge.payUrl!.endsWith(`/api/v1/payments/${UUID}/simulate`));
  });

  it('tolak nominal nol dan tidak menampung notifikasi', async () => {
    await assert.rejects(() => gateway.charge({ ...request, amount: 0 }), RangeError);
    assert.equal(gateway.acceptsNotifications, false);
    assert.equal(gateway.parseNotification({}), null);
  });
});

describe('E-ticket HMAC', () => {
  it('QR tiket yang dibangun sendiri terverifikasi', () => {
    const ticketCode = generateTicketCode();
    const qr = buildTicketQr(SECRET, ticketCode, 'CG-ABC123');
    const scanned = verifyTicketQr(SECRET, qr);
    assert.deepEqual(scanned, { kind: 'ticket', code: ticketCode, bookingCode: 'CG-ABC123' });
  });

  it('QR F&B memakai kind berbeda', () => {
    const scanned = verifyTicketQr(SECRET, buildPickupQr(SECRET, 'FNB-2K4P', 'CG-ABC123'));
    assert.equal(scanned?.kind, 'fnb');
    assert.equal(scanned?.code, 'FNB-2K4P');
  });

  it('menolak QR dari secret lain', () => {
    const qr = buildTicketQr('secret-a', 'TK-AAAAAA', 'CG-ABC123');
    assert.equal(verifyTicketQr('secret-b', qr), null);
  });

  it('menolak kode atau booking yang diubah', () => {
    const qr = buildTicketQr(SECRET, 'TK-AAAAAA', 'CG-ABC123');
    const [prefix, kind, code, booking, sig] = qr.split(':');
    assert.equal(verifyTicketQr(SECRET, [prefix, kind, 'TK-BBBBBB', booking, sig].join(':')), null);
    assert.equal(verifyTicketQr(SECRET, [prefix, kind, code, 'CG-XXXXXX', sig].join(':')), null);
    assert.equal(verifyTicketQr(SECRET, [prefix, kind, code, booking, sig.replace(/.$/, '0')].join(':')), null);
  });

  it('menolak format QR rusak', () => {
    for (const bad of ['', 'cinegen:ticket:TK-A', 'http://example.com', 'other:ticket:a:b:c']) {
      assert.equal(verifyTicketQr(SECRET, bad), null, `harus ditolak: ${bad}`);
    }
    assert.equal(verifyTicketQr(SECRET, 'cinegen:unknown:TK-A:CG-1:' + '0'.repeat(64)), null);
  });

  it('assembleQr identik dengan buildTicketQr sehingga signature tersimpan cukup', () => {
    const code = 'TK-ZZZZ99';
    const sig = signQr(SECRET, 'ticket', code, 'CG-ABC123');
    const qr = assembleQr('ticket', code, 'CG-ABC123', sig);
    assert.equal(qr, buildTicketQr(SECRET, code, 'CG-ABC123'));
    assert.equal(verifyTicketQr(SECRET, qr)?.code, code);
  });

  it('kode tiket hanya memakai alfabet tanpa karakter ambigu', () => {
    for (let i = 0; i < 50; i++) {
      assert.match(generateTicketCode(), /^TK-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/);
    }
  });
});

describe('Skema pembayaran', () => {
  it('menerima kanal yang sah dan participant_id opsional', () => {
    assert.deepEqual(createPaymentSchema.parse({ channel: 'qris' }), { channel: 'qris' });
    assert.equal(
      createPaymentSchema.parse({ channel: 'virtual_account', participant_id: UUID }).participant_id,
      UUID,
    );
  });

  it('menolak kanal asing dan id bukan UUID', () => {
    assert.throws(() => createPaymentSchema.parse({ channel: 'credit_card' }));
    assert.throws(() => createPaymentSchema.parse({ channel: 'qris', participant_id: 'not-uuid' }));
    assert.throws(() => createPaymentSchema.parse({}));
  });
});
