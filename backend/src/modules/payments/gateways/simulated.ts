import { buildQrisPayload } from '../../../common/utils/qris.js';
import { env } from '../../../config/env.js';
import type { ChargeRequest, ChargeResult, PaymentGateway, VerifiedNotification } from './gateway.js';

/**
 * Gateway tanpa jaringan untuk development/test: QRIS disusun lokal (EMVCo asli),
 * VA memakai nomor fiktif, dan pelunasan dipicu lewat endpoint dev yang
 * memakai fungsi settlement yang sama dengan webhook sungguhan.
 */
export class SimulatedGateway implements PaymentGateway {
  readonly name = 'simulated';
  readonly acceptsNotifications = false;

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const transactionId = `sim_${request.paymentId}`;

    if (request.channel === 'qris') {
      return {
        gateway: this.name,
        transactionId,
        qrisPayload: buildQrisPayload({
          reference: request.paymentId,
          amount: request.amount,
          merchantName: request.merchantName,
          merchantCity: request.merchantCity,
        }),
        payUrl: null,
        vaNumber: null,
        vaBank: null,
        expiresAt: null,
      };
    }

    if (request.channel === 'virtual_account') {
      return {
        gateway: this.name,
        transactionId,
        qrisPayload: null,
        payUrl: null,
        vaNumber: `9900${request.paymentId.replace(/[^0-9]/g, '').padStart(10, '0').slice(-10)}`,
        vaBank: env.MIDTRANS_VA_BANK.toUpperCase(),
        expiresAt: null,
      };
    }

    return {
      gateway: this.name,
      transactionId,
      qrisPayload: null,
      payUrl: `${env.BASE_URL}/api/v1/payments/${request.paymentId}/simulate`,
      vaNumber: null,
      vaBank: null,
      expiresAt: null,
    };
  }

  parseNotification(): VerifiedNotification | null {
    return null;
  }
}
