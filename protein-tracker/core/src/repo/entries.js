import { bad, notFound, num, oneOf, date, requireUser } from '../validate.js';

const ENTRY_SQL = `
  SELECT l.*, p.name AS product_name, p.brand, p.protein_per_100g, p.kcal_per_100g,
         ROUND(l.amount_g / 100.0 * p.protein_per_100g, 1) AS protein_g,
         CASE WHEN p.kcal_per_100g IS NULL THEN NULL
              ELSE ROUND(l.amount_g / 100.0 * p.kcal_per_100g) END AS kcal
    FROM log_entries l JOIN products p ON p.id = l.product_id`;

export function listEntries(db, userId, dateStr) {
  const user = requireUser(db, userId);
  const d = date(dateStr, 'date');
  return db.prepare(`${ENTRY_SQL} WHERE l.user_id = ? AND l.date = ? ORDER BY l.logged_at, l.id`)
    .all(user.id, d);
}

export function addEntry(db, input = {}) {
  const user = requireUser(db, input.user_id);
  const d = date(input.date, 'date');
  const productId = num(input.product_id, 'product_id', { min: 1 });
  const amount = num(input.amount_g, 'amount_g', { min: 0.1, max: 10000 });
  const status = oneOf(input.status, 'status', ['planned', 'eaten']);

  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) {
    throw bad(`Unbekanntes Produkt: ${productId}`);
  }
  const info = db.prepare(
    'INSERT INTO log_entries (user_id, date, product_id, amount_g, status) VALUES (?, ?, ?, ?, ?)'
  ).run(user.id, d, productId, amount, status);
  return db.prepare(`${ENTRY_SQL} WHERE l.id = ?`).get(info.lastInsertRowid);
}

export function updateEntry(db, id, patch = {}) {
  const entryId = num(id, 'id', { min: 1 });
  const current = db.prepare('SELECT * FROM log_entries WHERE id = ?').get(entryId);
  if (!current) throw notFound('Eintrag nicht gefunden');

  const next = {
    id: entryId,
    amount_g: patch.amount_g !== undefined
      ? num(patch.amount_g, 'amount_g', { min: 0.1, max: 10000 }) : current.amount_g,
    status: patch.status !== undefined
      ? oneOf(patch.status, 'status', ['planned', 'eaten']) : current.status,
    date: patch.date !== undefined ? date(patch.date, 'date') : current.date,
  };
  db.prepare('UPDATE log_entries SET amount_g = @amount_g, status = @status, date = @date WHERE id = @id')
    .run(next);
  return db.prepare(`${ENTRY_SQL} WHERE l.id = ?`).get(entryId);
}

export function deleteEntry(db, id) {
  const info = db.prepare('DELETE FROM log_entries WHERE id = ?').run(num(id, 'id', { min: 1 }));
  if (!info.changes) throw notFound('Eintrag nicht gefunden');
}
