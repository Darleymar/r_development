import { bad, notFound, num, str, oneOf, date, requireUser } from '../validate.js';

export function loadTemplate(db, id) {
  const templateId = num(id, 'id', { min: 1 });
  const tpl = db.prepare('SELECT * FROM meal_templates WHERE id = ?').get(templateId);
  if (!tpl) throw notFound('Vorlage nicht gefunden');

  tpl.items = db.prepare(
    `SELECT i.id, i.product_id, i.amount_g, p.name AS product_name, p.brand, p.protein_per_100g,
            ROUND(i.amount_g / 100.0 * p.protein_per_100g, 1) AS protein_g
       FROM meal_template_items i JOIN products p ON p.id = i.product_id
      WHERE i.template_id = ? ORDER BY i.id`
  ).all(templateId);
  tpl.protein_g = Math.round(tpl.items.reduce((s, i) => s + i.protein_g, 0) * 10) / 10;
  return tpl;
}

function readItems(input, db) {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw bad('items muss mindestens eine Position enthalten');
  }
  return input.items.map((raw, idx) => {
    const productId = num(raw.product_id, `items[${idx}].product_id`, { min: 1 });
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) {
      throw bad(`Unbekanntes Produkt: ${productId}`);
    }
    return {
      product_id: productId,
      amount_g: num(raw.amount_g, `items[${idx}].amount_g`, { min: 0.1, max: 10000 }),
    };
  });
}

export function listTemplates(db) {
  return db.prepare('SELECT id FROM meal_templates ORDER BY name COLLATE NOCASE').all()
    .map((row) => loadTemplate(db, row.id));
}

export function createTemplate(db, input = {}) {
  const name = str(input.name, 'name', { max: 120 });
  const items = readItems(input, db);

  const id = db.transaction(() => {
    const info = db.prepare('INSERT INTO meal_templates (name) VALUES (?)').run(name);
    const insertItem = db.prepare(
      'INSERT INTO meal_template_items (template_id, product_id, amount_g) VALUES (?, ?, ?)'
    );
    for (const i of items) insertItem.run(info.lastInsertRowid, i.product_id, i.amount_g);
    return info.lastInsertRowid;
  })();

  return loadTemplate(db, id);
}

export function updateTemplate(db, id, input = {}) {
  const templateId = num(id, 'id', { min: 1 });
  const tpl = db.prepare('SELECT * FROM meal_templates WHERE id = ?').get(templateId);
  if (!tpl) throw notFound('Vorlage nicht gefunden');

  const name = input.name !== undefined ? str(input.name, 'name', { max: 120 }) : tpl.name;
  const items = input.items !== undefined ? readItems(input, db) : null;

  db.transaction(() => {
    db.prepare('UPDATE meal_templates SET name = ? WHERE id = ?').run(name, templateId);
    if (items) {
      db.prepare('DELETE FROM meal_template_items WHERE template_id = ?').run(templateId);
      const insertItem = db.prepare(
        'INSERT INTO meal_template_items (template_id, product_id, amount_g) VALUES (?, ?, ?)'
      );
      for (const i of items) insertItem.run(templateId, i.product_id, i.amount_g);
    }
  })();

  return loadTemplate(db, templateId);
}

export function deleteTemplate(db, id) {
  const info = db.prepare('DELETE FROM meal_templates WHERE id = ?').run(num(id, 'id', { min: 1 }));
  if (!info.changes) throw notFound('Vorlage nicht gefunden');
}

/** Komplette Vorlage mit einem Tap loggen. */
export function logTemplate(db, id, input = {}) {
  const tpl = loadTemplate(db, id);
  const user = requireUser(db, input.user_id);
  const d = date(input.date, 'date');
  const status = oneOf(input.status, 'status', ['planned', 'eaten']);

  const insert = db.prepare(
    'INSERT INTO log_entries (user_id, date, product_id, amount_g, status) VALUES (?, ?, ?, ?, ?)'
  );
  const ids = db.transaction(() =>
    tpl.items.map((i) => insert.run(user.id, d, i.product_id, i.amount_g, status).lastInsertRowid)
  )();

  return { template_id: tpl.id, created: ids.length, entry_ids: ids, protein_g: tpl.protein_g };
}
