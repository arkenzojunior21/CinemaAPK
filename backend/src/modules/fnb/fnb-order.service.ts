import { getPool } from '../../db/pool.js';
import { AppError } from '../../common/errors/app-error.js';
import { generatePickupCode } from '../../common/utils/codes.js';

export interface FnbOrderInput {
  items: { fnb_item_id: string; quantity: number }[];
}

export interface FnbOrderResult {
  id: string;
  status: string;
  total_amount: number;
  pickup_code: string;
  items: { fnb_item_id: string; name: string; quantity: number; unit_price: number; subtotal: number }[];
}

interface ItemRow {
  id: string;
  name: string;
  price: string;
}

/**
 * Membuat pre-order F&B untuk booking berstatus pending_payment.
 * total_amount dihitung ulang dari harga item di DB (klien tidak dipercaya),
 * lalu fnb_total & grand_total booking diperbarui dalam satu transaksi.
 */
export async function createFnbOrder(
  bookingId: string,
  userId: string,
  input: FnbOrderInput,
): Promise<FnbOrderResult> {
  if (input.items.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Minimal satu item F&B diperlukan.');
  }

  const pool = getPool();
  const booking = await pool.query<{ id: string; user_id: string; status: string }>(
    `SELECT id, user_id, status FROM bookings WHERE id = $1`,
    [bookingId],
  );
  const b = booking.rows[0];
  if (!b || b.user_id !== userId) {
    throw new AppError(404, 'NOT_FOUND', 'Booking tidak ditemukan.');
  }
  if (b.status !== 'pending_payment' && b.status !== 'partially_paid') {
    throw new AppError(409, 'BOOKING_NOT_PAYABLE', 'Booking ini tidak dapat menerima pesanan F&B.');
  }

  const itemIds = [...new Set(input.items.map((i) => i.fnb_item_id))];
  const itemsResult = await pool.query<ItemRow>(
    `SELECT id, name, price FROM fnb_items
     WHERE id = ANY($1::uuid[]) AND is_available`,
    [itemIds],
  );
  const itemMap = new Map(itemsResult.rows.map((r) => [r.id, r]));

  const lines = input.items.map((line) => {
    const item = itemMap.get(line.fnb_item_id);
    if (!item) {
      throw new AppError(404, 'FNB_ITEM_NOT_FOUND', `Item F&B ${line.fnb_item_id} tidak tersedia.`);
    }
    const unitPrice = Number(item.price);
    return {
      fnb_item_id: item.id,
      name: item.name,
      quantity: line.quantity,
      unit_price: unitPrice,
      subtotal: unitPrice * line.quantity,
    };
  });
  const totalAmount = lines.reduce((sum, l) => sum + l.subtotal, 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let orderId = '';
    let pickupCode = '';
    for (let attempt = 0; attempt < 3 && !orderId; attempt++) {
      try {
        const orderResult = await client.query<{ id: string; pickup_code: string }>(
          `INSERT INTO fnb_orders (booking_id, user_id, status, total_amount, pickup_code)
           VALUES ($1, $2, 'pending', $3, $4)
           RETURNING id, pickup_code`,
          [bookingId, userId, totalAmount, generatePickupCode()],
        );
        orderId = orderResult.rows[0].id;
        pickupCode = orderResult.rows[0].pickup_code;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!orderId) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Gagal membuat kode pickup, coba lagi.');
    }

    for (const line of lines) {
      await client.query(
        `INSERT INTO fnb_order_items (fnb_order_id, fnb_item_id, quantity, unit_price, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, line.fnb_item_id, line.quantity, line.unit_price, line.subtotal],
      );
    }

    await client.query(
      `UPDATE bookings
       SET fnb_total = fnb_total + $2, grand_total = grand_total + $2
       WHERE id = $1`,
      [bookingId, totalAmount],
    );

    await client.query('COMMIT');

    return {
      id: orderId,
      status: 'pending',
      total_amount: totalAmount,
      pickup_code: pickupCode,
      items: lines,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';
}
