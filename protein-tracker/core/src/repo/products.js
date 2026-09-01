import { bad, notFound, conflict, num, str, oneOf } from '../validate.js';

const BARCODE = /^\d{8,14}$/;

function readProduct(input, defaults = {}) {
  const p = {
    name: input.name !== undefined ? str(input.name, 'name', { max: 120 }) : defaults.name,
    brand: input.brand !== undefined
      ? str(input.brand, 'brand', { required: false, max: 120 }) : defaults.brand ?? null,
    barcode: input.barcode !== undefined
      ? str(input.barcode, 'barcode', { required: false, max: 20 }) : defaults.barcode ?? null,
    protein_per_100g: input.protein_per_100g !== undefined
      ? num(input.protein_per_100g, 'protein_per_100g', { min: 0, max: 100 })
      : defaults.protein_per_100g,
    kcal_per_100g: input.kcal_per_100g !== undefined
      ? num(input.kcal_per_100g, 'kcal_per_100g', { min: 0, max: 900, required: false })
      : defaults.kcal_per_100g ?? null,
    default_serving_g: input.default_serving_g !== undefined
      ? num(input.default_serving_g, 'default_serving_g', { min: 0.1, max: 5000, required: false })
      : defaults.default_serving_g ?? null,
    category: input.category !== undefined
      ? str(input.category, 'category', { required: false, max: 60 }) : defaults.category ?? null,
    source: input.source !== undefined
      ? oneOf(input.source, 'source', ['openfoodfacts', 'manual'])
      : defaults.source ?? 'manual',
    is_favorite: input.is_favorite !== undefined
      ? (input.is_favorite ? 1 : 0) : defaults.is_favorite ?? 0,
  };
  if (p.name === undefined || p.name === null) throw bad('name fehlt');
  if (p.protein_per_100g === undefined || p.protein_per_100g === null) throw bad('protein_per_100g fehlt');
  if (p.barcode && !BARCODE.test(p.barcode)) throw bad('barcode muss 8–14 Ziffern haben');
  return p;
}

/** Favoriten zuerst, dann meistverwendet, dann zuletzt verwendet. */
const LIST_SQL = (where) => `
  SELECT p.*,
         COALESCE(u.use_count, 0) AS use_count,
         u.last_used
    FROM products p
    LEFT JOIN (
      SELECT product_id, COUNT(*) AS use_count, MAX(logged_at) AS last_used
        FROM log_entries GROUP BY product_id
    ) u ON u.product_id = p.id
   ${where}
   ORDER BY p.is_favorite DESC,
            use_count DESC,
            (u.last_used IS NULL), u.last_used DESC,
            p.name COLLATE NOCASE
   LIMIT @limit`;

export function listProducts(db, { q, favorites, limit } = {}) {
  const query = str(q, 'q', { required: false, max: 80 });
  const max = num(limit, 'limit', { min: 1, max: 500, required: false }) ?? 200;

  const clauses = [];
  if (query) clauses.push('(p.name LIKE @like OR p.brand LIKE @like OR p.category LIKE @like OR p.barcode = @q)');
  if (favorites === true || favorites === '1' || favorites === 'true') clauses.push('p.is_favorite = 1');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  return db.prepare(LIST_SQL(where)).all({ q: query ?? null, like: `%${query ?? ''}%`, limit: max });
}

export function getProduct(db, id) {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(num(id, 'id', { min: 1 }));
  if (!row) throw notFound('Produkt nicht gefunden');
  return row;
}

export function findByBarcode(db, barcode) {
  const code = str(barcode, 'barcode', { max: 20 });
  return db.prepare('SELECT * FROM products WHERE barcode = ?').get(code) ?? null;
}

export function createProduct(db, input = {}) {
  const p = readProduct(input);
  if (p.barcode) {
    const existing = db.prepare('SELECT id FROM products WHERE barcode = ?').get(p.barcode);
    if (existing) throw conflict(`Barcode ${p.barcode} gehoert bereits zu Produkt ${existing.id}`);
  }
  const info = db.prepare(
    `INSERT INTO products (name, brand, barcode, protein_per_100g, kcal_per_100g,
                           default_serving_g, category, source, is_favorite)
     VALUES (@name, @brand, @barcode, @protein_per_100g, @kcal_per_100g,
             @default_serving_g, @category, @source, @is_favorite)`
  ).run(p);
  return db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
}

export function updateProduct(db, id, input = {}) {
  const productId = num(id, 'id', { min: 1 });
  const current = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!current) throw notFound('Produkt nicht gefunden');

  const p = readProduct(input, current);
  if (p.barcode) {
    const other = db.prepare('SELECT id FROM products WHERE barcode = ? AND id != ?').get(p.barcode, productId);
    if (other) throw conflict(`Barcode ${p.barcode} gehoert bereits zu Produkt ${other.id}`);
  }
  db.prepare(
    `UPDATE products SET name = @name, brand = @brand, barcode = @barcode,
            protein_per_100g = @protein_per_100g, kcal_per_100g = @kcal_per_100g,
            default_serving_g = @default_serving_g, category = @category,
            source = @source, is_favorite = @is_favorite
      WHERE id = @id`
  ).run({ ...p, id: productId });
  return db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
}

/**
 * Produkte, die in Eintraegen vorkommen, bleiben erhalten – sonst reisst das
 * Loeschen Luecken in die Historie, die das Einfrieren gerade schuetzen soll.
 */
export function deleteProduct(db, id) {
  const productId = num(id, 'id', { min: 1 });
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM log_entries WHERE product_id = ?').get(productId);
  if (n > 0) {
    throw conflict(
      `Produkt ist in ${n} Eintraegen verwendet und wird fuer die Historie gebraucht. Bearbeiten statt loeschen.`
    );
  }
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(productId);
  if (!info.changes) throw notFound('Produkt nicht gefunden');
}
