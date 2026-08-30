/**
 * Demodaten zum Ausprobieren: Produkte, Vorlagen, Trainings und Eintraege
 * fuer die letzten drei Wochen. Loescht vorhandene Bewegungsdaten.
 *
 *   npm run seed            (Standard-Datenbank)
 *   PT_DB=:memory: npm run seed
 */
import { openDb } from './db.js';
import { addDays, serverToday } from './targets.js';

const db = openDb();
const today = process.argv[2] ?? serverToday();

const PRODUCTS = [
  ['Magerquark',            'Milbona',   '4056489123456', 12.0,  67, 250],
  ['Skyr Natur',            'Arla',      '5711953068904', 11.0,  63, 150],
  ['Whey Protein Vanille',  'ESN',       '4260375870011', 78.0, 375,  30],
  ['Huettenkaese',          'Exquisa',   null,            13.0, 100, 200],
  ['Haehnchenbrustfilet',   null,        null,            23.0, 108, 150],
  ['Rinderhackfleisch 5%',  null,        null,            21.0, 133, 150],
  ['Lachsfilet',            null,        null,            20.0, 208, 125],
  ['Vollkornbrot',          'Harry',     null,             7.0, 220,  50],
  ['Haferflocken',          'Koelln',    null,            13.5, 372,  80],
  ['Vollmilch 3,5%',        null,        null,             3.4,  64, 200],
  ['Banane',                null,        null,             1.1,  93, 120],
  ['Eier (Gr. M)',          null,        null,            12.6, 137,  60],
  ['Linsen, gekocht',       null,        null,             9.0, 116, 200],
  ['Thunfisch in Wasser',   null,        null,            26.0, 116, 140],
  ['Mandeln',               null,        null,            21.0, 579,  30],
];

const TEMPLATES = [
  ['Shake nach dem Training', [['Vollmilch 3,5%', 300], ['Whey Protein Vanille', 30], ['Banane', 120]]],
  ['Fruehstuecksquark',       [['Magerquark', 250], ['Haferflocken', 60], ['Banane', 100]]],
  ['Abendessen Standard',     [['Haehnchenbrustfilet', 180], ['Linsen, gekocht', 200]]],
];

const insertProduct = db.prepare(
  `INSERT INTO products (name, brand, barcode, protein_per_100g, kcal_per_100g, default_serving_g, source, is_favorite)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(barcode) DO NOTHING`
);

db.transaction(() => {
  db.prepare('DELETE FROM log_entries').run();
  db.prepare('DELETE FROM workouts').run();
  db.prepare('DELETE FROM daily_targets').run();
  db.prepare('DELETE FROM weight_entries').run();
  db.prepare('DELETE FROM meal_template_items').run();
  db.prepare('DELETE FROM meal_templates').run();
  db.prepare('DELETE FROM products').run();

  for (const [i, p] of PRODUCTS.entries()) {
    insertProduct.run(...p, p[2] ? 'openfoodfacts' : 'manual', i < 3 ? 1 : 0);
  }

  const idOf = (name) => db.prepare('SELECT id FROM products WHERE name = ?').get(name).id;

  for (const [name, items] of TEMPLATES) {
    const tplId = db.prepare('INSERT INTO meal_templates (name) VALUES (?)').run(name).lastInsertRowid;
    const insertItem = db.prepare(
      'INSERT INTO meal_template_items (template_id, product_id, amount_g) VALUES (?, ?, ?)'
    );
    for (const [product, amount] of items) insertItem.run(tplId, idOf(product), amount);
  }

  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  const insertWorkout = db.prepare('INSERT INTO workouts (user_id, date, note) VALUES (?, ?, ?)');
  const insertLog = db.prepare(
    'INSERT INTO log_entries (user_id, date, product_id, amount_g, status) VALUES (?, ?, ?, ?, ?)'
  );
  const insertWeight = db.prepare(
    'INSERT INTO weight_entries (user_id, date, weight_kg) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
  );

  // Profil 1 trainiert drei-, Profil 2 zweimal pro Woche – so unterscheiden
  // sich die Zielverlaeufe im Diagramm sichtbar.
  const pattern = [[1, 3, 5], [1, 4]];
  const menu = [
    ['Magerquark', 250], ['Haferflocken', 60], ['Haehnchenbrustfilet', 180],
    ['Eier (Gr. M)', 120], ['Vollkornbrot', 100], ['Skyr Natur', 150],
    ['Whey Protein Vanille', 30], ['Linsen, gekocht', 200], ['Thunfisch in Wasser', 140],
  ];

  users.forEach((user, u) => {
    insertWeight.run(user.id, addDays(today, -21), user.weight_kg - 1);
    insertWeight.run(user.id, addDays(today, -7), user.weight_kg);

    for (let back = 21; back >= 0; back -= 1) {
      const date = addDays(today, -back);
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();

      if (pattern[u % 2].includes(weekday)) {
        insertWorkout.run(user.id, date, back % 7 === 0 ? 'Ganzkoerper' : null);
      }

      // Drei bis vier Mahlzeiten, leicht schwankend – mal wird das Ziel
      // erreicht, mal knapp verfehlt.
      const meals = 3 + ((back + u) % 2);
      for (let m = 0; m < meals; m += 1) {
        const [name, amount] = menu[(back * 3 + m + u) % menu.length];
        const status = back === 0 && m === meals - 1 ? 'planned' : 'eaten';
        insertLog.run(user.id, date, idOf(name), amount, status);
      }
    }
  });
})();

const counts = ['products', 'meal_templates', 'workouts', 'log_entries', 'weight_entries']
  .map((t) => `${t}: ${db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n}`)
  .join(', ');
console.log(`Demodaten angelegt (Stichtag ${today}) – ${counts}`);
db.close();
