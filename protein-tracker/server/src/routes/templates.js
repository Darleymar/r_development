import { Router } from 'express';
import { h, bad, notFound, num, str, oneOf, date, userId } from '../util.js';

function loadTemplate(db, id) {
  const tpl = db.prepare('SELECT * FROM meal_templates WHERE id = ?').get(id);
  if (!tpl) throw notFound('Vorlage nicht gefunden');
  tpl.items = db.prepare(
    `SELECT i.id, i.product_id, i.amount_g, p.name AS product_name, p.brand, p.protein_per_100g,
            ROUND(i.amount_g / 100.0 * p.protein_per_100g, 1) AS protein_g
       FROM meal_template_items i JOIN products p ON p.id = i.product_id
      WHERE i.template_id = ? ORDER BY i.id`
  ).all(id);
  tpl.protein_g = Math.round(tpl.items.reduce((s, i) => s + i.protein_g, 0) * 10) / 10;
  return tpl;
}

function readItems(body, db) {
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw bad('items muss mindestens eine Position enthalten');
  }
  return body.items.map((raw, idx) => {
    const productId = num(raw.product_id, `items[${idx}].product_id`, { min: 1 });
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) {
      throw bad(`Unbekanntes Produkt: ${productId}`);
    }
    return { product_id: productId, amount_g: num(raw.amount_g, `items[${idx}].amount_g`, { min: 0.1, max: 10000 }) };
  });
}

export default function templatesRoutes(db) {
  const r = Router();

  r.get('/', h((req, res) => {
    const ids = db.prepare('SELECT id FROM meal_templates ORDER BY name COLLATE NOCASE').all();
    res.json(ids.map((row) => loadTemplate(db, row.id)));
  }));

  r.get('/:id', h((req, res) => {
    res.json(loadTemplate(db, num(req.params.id, 'id', { min: 1 })));
  }));

  r.post('/', h((req, res) => {
    const name = str(req.body.name, 'name', { max: 120 });
    const items = readItems(req.body, db);
    const id = db.transaction(() => {
      const info = db.prepare('INSERT INTO meal_templates (name) VALUES (?)').run(name);
      const insertItem = db.prepare(
        'INSERT INTO meal_template_items (template_id, product_id, amount_g) VALUES (?, ?, ?)'
      );
      for (const i of items) insertItem.run(info.lastInsertRowid, i.product_id, i.amount_g);
      return info.lastInsertRowid;
    })();
    res.status(201).json(loadTemplate(db, id));
  }));

  r.patch('/:id', h((req, res) => {
    const id = num(req.params.id, 'id', { min: 1 });
    const tpl = db.prepare('SELECT * FROM meal_templates WHERE id = ?').get(id);
    if (!tpl) throw notFound('Vorlage nicht gefunden');

    const name = req.body.name !== undefined ? str(req.body.name, 'name', { max: 120 }) : tpl.name;
    const items = req.body.items !== undefined ? readItems(req.body, db) : null;

    db.transaction(() => {
      db.prepare('UPDATE meal_templates SET name = ? WHERE id = ?').run(name, id);
      if (items) {
        db.prepare('DELETE FROM meal_template_items WHERE template_id = ?').run(id);
        const insertItem = db.prepare(
          'INSERT INTO meal_template_items (template_id, product_id, amount_g) VALUES (?, ?, ?)'
        );
        for (const i of items) insertItem.run(id, i.product_id, i.amount_g);
      }
    })();
    res.json(loadTemplate(db, id));
  }));

  r.delete('/:id', h((req, res) => {
    const info = db.prepare('DELETE FROM meal_templates WHERE id = ?').run(num(req.params.id, 'id', { min: 1 }));
    if (!info.changes) throw notFound('Vorlage nicht gefunden');
    res.status(204).end();
  }));

  /** Komplette Vorlage mit einem Tap loggen. */
  r.post('/:id/log', h((req, res) => {
    const tpl = loadTemplate(db, num(req.params.id, 'id', { min: 1 }));
    const user = userId(req, db);
    const d = date(req.body.date, 'date');
    const status = oneOf(req.body.status, 'status', ['planned', 'eaten']);

    const insert = db.prepare(
      'INSERT INTO log_entries (user_id, date, product_id, amount_g, status) VALUES (?, ?, ?, ?, ?)'
    );
    const ids = db.transaction(() =>
      tpl.items.map((i) => insert.run(user.id, d, i.product_id, i.amount_g, status).lastInsertRowid)
    )();

    res.status(201).json({ template_id: tpl.id, created: ids.length, entry_ids: ids, protein_g: tpl.protein_g });
  }));

  return r;
}
