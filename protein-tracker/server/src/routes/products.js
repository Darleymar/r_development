import { Router } from 'express';
import { h, bad, notFound, conflict, num, str, oneOf } from '../util.js';

const BARCODE = /^\d{8,14}$/;

function readProduct(body, defaults = {}) {
  const p = {
    name: body.name !== undefined ? str(body.name, 'name', { max: 120 }) : defaults.name,
    brand: body.brand !== undefined
      ? str(body.brand, 'brand', { required: false, max: 120 }) : defaults.brand ?? null,
    barcode: body.barcode !== undefined
      ? str(body.barcode, 'barcode', { required: false, max: 20 }) : defaults.barcode ?? null,
    protein_per_100g: body.protein_per_100g !== undefined
      ? num(body.protein_per_100g, 'protein_per_100g', { min: 0, max: 100 })
      : defaults.protein_per_100g,
    kcal_per_100g: body.kcal_per_100g !== undefined
      ? num(body.kcal_per_100g, 'kcal_per_100g', { min: 0, max: 900, required: false })
      : defaults.kcal_per_100g ?? null,
    default_serving_g: body.default_serving_g !== undefined
      ? num(body.default_serving_g, 'default_serving_g', { min: 0.1, max: 5000, required: false })
      : defaults.default_serving_g ?? null,
    source: body.source !== undefined
      ? oneOf(body.source, 'source', ['openfoodfacts', 'manual'])
      : defaults.source ?? 'manual',
    is_favorite: body.is_favorite !== undefined
      ? (body.is_favorite ? 1 : 0) : defaults.is_favorite ?? 0,
  };
  if (p.name === undefined) throw bad('name fehlt');
  if (p.protein_per_100g === undefined || p.protein_per_100g === null) throw bad('protein_per_100g fehlt');
  if (p.barcode && !BARCODE.test(p.barcode)) throw bad('barcode muss 8–14 Ziffern haben');
  return p;
}

export default function productsRoutes(db) {
  const r = Router();

  // Bibliothek mit Nutzungsstatistik: Favoriten zuerst, dann meistverwendet,
  // dann zuletzt verwendet.
  const listSql = (where) => `
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

  r.get('/', h((req, res) => {
    const q = str(req.query.q, 'q', { required: false, max: 80 });
    const limit = num(req.query.limit, 'limit', { min: 1, max: 500, required: false }) ?? 200;
    const favoritesOnly = req.query.favorites === '1' || req.query.favorites === 'true';

    const clauses = [];
    if (q) clauses.push('(p.name LIKE @like OR p.brand LIKE @like OR p.barcode = @q)');
    if (favoritesOnly) clauses.push('p.is_favorite = 1');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    res.json(db.prepare(listSql(where)).all({ q: q ?? null, like: `%${q ?? ''}%`, limit }));
  }));

  r.get('/barcode/:barcode', h((req, res) => {
    const code = str(req.params.barcode, 'barcode', { max: 20 });
    const row = db.prepare('SELECT * FROM products WHERE barcode = ?').get(code);
    if (!row) throw notFound(`Kein Produkt mit Barcode ${code} in der Bibliothek`);
    res.json(row);
  }));

  r.get('/:id', h((req, res) => {
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(num(req.params.id, 'id', { min: 1 }));
    if (!row) throw notFound('Produkt nicht gefunden');
    res.json(row);
  }));

  r.post('/', h((req, res) => {
    const p = readProduct(req.body);
    if (p.barcode) {
      const existing = db.prepare('SELECT id FROM products WHERE barcode = ?').get(p.barcode);
      if (existing) throw conflict(`Barcode ${p.barcode} gehoert bereits zu Produkt ${existing.id}`);
    }
    const info = db.prepare(
      `INSERT INTO products (name, brand, barcode, protein_per_100g, kcal_per_100g, default_serving_g, source, is_favorite)
       VALUES (@name, @brand, @barcode, @protein_per_100g, @kcal_per_100g, @default_serving_g, @source, @is_favorite)`
    ).run(p);
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
  }));

  r.patch('/:id', h((req, res) => {
    const id = num(req.params.id, 'id', { min: 1 });
    const current = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!current) throw notFound('Produkt nicht gefunden');

    const p = readProduct(req.body, current);
    if (p.barcode) {
      const other = db.prepare('SELECT id FROM products WHERE barcode = ? AND id != ?').get(p.barcode, id);
      if (other) throw conflict(`Barcode ${p.barcode} gehoert bereits zu Produkt ${other.id}`);
    }
    db.prepare(
      `UPDATE products SET name = @name, brand = @brand, barcode = @barcode,
              protein_per_100g = @protein_per_100g, kcal_per_100g = @kcal_per_100g,
              default_serving_g = @default_serving_g, source = @source, is_favorite = @is_favorite
        WHERE id = @id`
    ).run({ ...p, id });
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  }));

  r.delete('/:id', h((req, res) => {
    const id = num(req.params.id, 'id', { min: 1 });
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM log_entries WHERE product_id = ?').get(id);
    if (n > 0) {
      throw conflict(
        `Produkt ist in ${n} Eintraegen verwendet und wird fuer die Historie gebraucht. ` +
        'Bearbeiten statt loeschen.'
      );
    }
    const info = db.prepare('DELETE FROM products WHERE id = ?').run(id);
    if (!info.changes) throw notFound('Produkt nicht gefunden');
    res.status(204).end();
  }));

  return r;
}
