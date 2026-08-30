import { Router } from 'express';
import { h, notFound, bad, num, oneOf, date, userId } from '../util.js';

const ENTRY_SQL = `
  SELECT l.*, p.name AS product_name, p.brand, p.protein_per_100g, p.kcal_per_100g,
         ROUND(l.amount_g / 100.0 * p.protein_per_100g, 1) AS protein_g,
         CASE WHEN p.kcal_per_100g IS NULL THEN NULL
              ELSE ROUND(l.amount_g / 100.0 * p.kcal_per_100g) END AS kcal
    FROM log_entries l JOIN products p ON p.id = l.product_id`;

export default function logRoutes(db) {
  const r = Router();

  r.get('/', h((req, res) => {
    const user = userId(req, db);
    const d = date(req.query.date, 'date');
    res.json(
      db.prepare(`${ENTRY_SQL} WHERE l.user_id = ? AND l.date = ? ORDER BY l.logged_at`).all(user.id, d)
    );
  }));

  r.post('/', h((req, res) => {
    const user = userId(req, db);
    const d = date(req.body.date, 'date');
    const productId = num(req.body.product_id, 'product_id', { min: 1 });
    const amount = num(req.body.amount_g, 'amount_g', { min: 0.1, max: 10000 });
    const status = oneOf(req.body.status, 'status', ['planned', 'eaten']);

    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) {
      throw bad(`Unbekanntes Produkt: ${productId}`);
    }
    const info = db.prepare(
      'INSERT INTO log_entries (user_id, date, product_id, amount_g, status) VALUES (?, ?, ?, ?, ?)'
    ).run(user.id, d, productId, amount, status);
    res.status(201).json(db.prepare(`${ENTRY_SQL} WHERE l.id = ?`).get(info.lastInsertRowid));
  }));

  r.patch('/:id', h((req, res) => {
    const id = num(req.params.id, 'id', { min: 1 });
    const current = db.prepare('SELECT * FROM log_entries WHERE id = ?').get(id);
    if (!current) throw notFound('Eintrag nicht gefunden');

    const patch = {
      amount_g: req.body.amount_g !== undefined
        ? num(req.body.amount_g, 'amount_g', { min: 0.1, max: 10000 }) : current.amount_g,
      status: req.body.status !== undefined
        ? oneOf(req.body.status, 'status', ['planned', 'eaten']) : current.status,
      date: req.body.date !== undefined ? date(req.body.date, 'date') : current.date,
    };
    db.prepare('UPDATE log_entries SET amount_g = @amount_g, status = @status, date = @date WHERE id = @id')
      .run({ ...patch, id });
    res.json(db.prepare(`${ENTRY_SQL} WHERE l.id = ?`).get(id));
  }));

  r.delete('/:id', h((req, res) => {
    const info = db.prepare('DELETE FROM log_entries WHERE id = ?').run(num(req.params.id, 'id', { min: 1 }));
    if (!info.changes) throw notFound('Eintrag nicht gefunden');
    res.status(204).end();
  }));

  return r;
}
