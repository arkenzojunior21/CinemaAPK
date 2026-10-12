import { env } from '../../../config/env.js';
import { MidtransGateway } from './midtrans.js';
import { SimulatedGateway } from './simulated.js';
import type { PaymentGateway } from './gateway.js';

/** Midtrans dipakai begitu SERVER_KEY diisi; tanpa key, dev/test tetap jalan. */
export function resolveGateway(): PaymentGateway {
  return env.MIDTRANS_SERVER_KEY ? new MidtransGateway(env.MIDTRANS_SERVER_KEY) : new SimulatedGateway();
}

/** Dipakai webhook: gateway mana yang mengklaim notifikasi ini? */
export function gatewayByName(name: string): PaymentGateway | null {
  if (name === 'midtrans') {
    return env.MIDTRANS_SERVER_KEY ? new MidtransGateway(env.MIDTRANS_SERVER_KEY) : null;
  }
  if (name === 'simulated') return new SimulatedGateway();
  return null;
}
