import { getPool } from '../../db/pool.js';
import { AppError } from '../../common/errors/app-error.js';

export interface FnbItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  image_url: string | null;
}

interface FnbRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: string;
  image_url: string | null;
}

export async function listFnbItems(query: { cinema_id: string }): Promise<FnbItem[]> {
  const cinemaExists = await getPool().query(`SELECT 1 FROM cinemas WHERE id = $1 AND is_active`, [
    query.cinema_id,
  ]);
  if (!cinemaExists.rowCount) {
    throw new AppError(404, 'NOT_FOUND', 'Bioskop tidak ditemukan.');
  }

  const rows = await getPool().query<FnbRow>(
    `SELECT id, name, description, category, price, image_url
     FROM fnb_items
     WHERE cinema_id = $1 AND is_available
     ORDER BY category, name`,
    [query.cinema_id],
  );

  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    price: Number(r.price),
    image_url: r.image_url,
  }));
}
