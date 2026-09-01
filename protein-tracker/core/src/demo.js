/**
 * Demodaten zum Ausprobieren: Produkte, Vorlagen, Trainings und Eintraege
 * fuer die letzten drei Wochen. Ersetzt den vorhandenen Bestand.
 *
 * Steckt im Kern statt in einem Skript, weil es keinen Server mehr gibt –
 * die App laedt die Daten auf Wunsch selbst.
 */
import { addDays, computeTarget, serverToday } from './targets.js';
import { ensureProfiles } from './index.js';
import { ensureStarterFoods } from './foods.js';

const PRODUCTS = [
  ['Magerquark',            'Milbona',   '4056489123456', 12.0,  67, 250],
  ['Skyr Natur',            'Arla',      '5711953068904', 11.0,  63, 150],
  ['Whey Protein Vanille',  'ESN',       '4260375870011', 78.0, 375,  30],
  ['Hüttenkäse',          'Exquisa',   null,            13.0, 100, 200],
  ['Hähnchenbrustfilet',   null,        null,            23.0, 108, 150],
  ['Rinderhackfleisch 5%',  null,        null,            21.0, 133, 150],
  ['Lachsfilet',            null,        null,            20.0, 208, 125],
  ['Vollkornbrot',          'Harry',     null,             7.0, 220,  50],
  ['Haferflocken',          'Kölln',    null,            13.5, 372,  80],
  ['Vollmilch 3,5%',        null,        null,             3.4,  64, 200],
  ['Banane',                null,        null,             1.1,  93, 120],
  ['Eier (Gr. M)',          null,        null,            12.6, 137,  60],
  ['Linsen, gekocht',       null,        null,             9.0, 116, 200],
  ['Thunfisch in Wasser',   null,        null,            26.0, 116, 140],
  ['Mandeln',               null,        null,            21.0, 579,  30],
];

const TEMPLATES = [
  ['Shake nach dem Training', [['Vollmilch 3,5%', 300], ['Whey Protein Vanille', 30], ['Banane', 120]]],
  ['Frühstücksquark',       [['Magerquark', 250], ['Haferflocken', 60], ['Banane', 100]]],
  ['Abendessen Standard',     [['Hähnchenbrustfilet', 180], ['Linsen, gekocht', 200]]],
];

export function seedDemoData(db, today = serverToday()) {
  ensureProfiles(db);

  const insertProduct = db.prepare(
    `INSERT INTO products (name, brand, barcode, protein_per_100g, kcal_per_100g,
                           default_serving_g, source, is_favorite)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    for (const table of ['log_entries', 'workouts', 'daily_targets', 'weight_entries',
                         'meal_template_items', 'meal_templates', 'products']) {
      db.prepare(`DELETE FROM ${table}`).run();
    }

    for (const [i, p] of PRODUCTS.entries()) {
      insertProduct.run(...p, p[2] ? 'openfoodfacts' : 'manual', i < 3 ? 1 : 0);
    }
    // Der Grundstock gehoert zur Ausstattung, nicht zu den Demodaten.
    ensureStarterFoods(db);

    const idOf = (name) => db.prepare('SELECT id FROM products WHERE name = ?').get(name).id;
    const proteinOf = (name) =>
      db.prepare('SELECT protein_per_100g AS p FROM products WHERE name = ?').get(name).p;

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
      'INSERT INTO weight_entries (user_id, date, weight_kg) VALUES (?, ?, ?)'
    );

    // Profil 1 trainiert drei-, Profil 2 zweimal pro Woche – so unterscheiden
    // sich die Zielverlaeufe im Diagramm sichtbar.
    const pattern = [[1, 3, 5], [1, 4]];
    const menu = [
      ['Magerquark', 250], ['Haferflocken', 60], ['Hähnchenbrustfilet', 180],
      ['Eier (Gr. M)', 120], ['Vollkornbrot', 100], ['Skyr Natur', 150],
      ['Whey Protein Vanille', 30], ['Linsen, gekocht', 200], ['Thunfisch in Wasser', 140],
    ];
    // Zielerreichung zwischen 78 % und 112 % – trainingsnahe Tage bewusst
    // etwas schwaecher, damit die Auswertung nach Tagtyp etwas zu zeigen hat.
    const spread = [1.02, 0.95, 1.08, 0.86, 1.0, 0.91, 1.06, 0.82, 0.98, 1.11, 0.89];

    users.forEach((user, u) => {
      insertWeight.run(user.id, addDays(today, -21), user.weight_kg - 1);
      insertWeight.run(user.id, addDays(today, -7), user.weight_kg);

      // Erst alle Trainings, damit das Tagesziel danach schon feststeht.
      for (let back = 21; back >= 0; back -= 1) {
        const date = addDays(today, -back);
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
        if (pattern[u % 2].includes(weekday)) {
          insertWorkout.run(user.id, date, back % 7 === 0 ? 'Ganzkörper' : null);
        }
      }

      for (let back = 21; back >= 0; back -= 1) {
        const date = addDays(today, -back);
        const { target_g: target, was_training_adjacent: adjacent } = computeTarget(db, user.id, date);
        const factor = spread[(back + u * 3) % spread.length] - (adjacent ? 0.09 : 0);
        const wanted = target * factor;

        const meals = [0, 1, 2, 3].map((m) => menu[(back * 3 + m + u) % menu.length]);
        const base = meals.reduce((sum, [name, amount]) => sum + amount * proteinOf(name) / 100, 0);
        const scale = base > 0 ? wanted / base : 1;

        meals.forEach(([name, amount], m) => {
          const grams = Math.max(20, Math.round((amount * scale) / 5) * 5);
          // Am laufenden Tag steht die letzte Mahlzeit noch als geplant aus.
          const status = back === 0 && m >= 2 ? 'planned' : 'eaten';
          insertLog.run(user.id, date, idOf(name), grams, status);
        });
      }
    });
  })();

  return db.prepare('SELECT COUNT(*) AS n FROM log_entries').get().n;
}
