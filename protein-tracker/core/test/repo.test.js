import test from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from './helpers.js';
import {
  listUsers, updateUser, addWeight,
  listProducts, createProduct, updateProduct, deleteProduct, findByBarcode,
  addEntry, updateEntry,
  toggleWorkout, saveWorkout,
  createTemplate, logTemplate,
  getDay, getHistory,
  exportData, importData,
  mapOffProduct,
  seedDemoData,
} from '../src/index.js';

const TODAY = '2026-03-10';
const round1 = (n) => Math.round(n * 10) / 10;

test('zwei Profile sind ohne Einrichtung vorhanden', () => {
  const users = listUsers(testDb());
  assert.equal(users.length, 2);
  assert.equal(users[0].factor_training, 2.0);
  assert.equal(users[0].factor_rest, 1.6);
});

test('Produkt anlegen, suchen und per Barcode finden', () => {
  const db = testDb();
  const created = createProduct(db, {
    name: 'Magerquark', brand: 'Milbona', barcode: '4056489123456',
    protein_per_100g: 12, kcal_per_100g: 67, default_serving_g: 250,
  });
  assert.equal(created.source, 'manual');

  const found = listProducts(db, { q: 'quark' });
  assert.equal(found.length, 1);
  assert.equal(found[0].use_count, 0);

  assert.equal(findByBarcode(db, '4056489123456').id, created.id);
  assert.equal(findByBarcode(db, '1111111111111'), null);

  assert.throws(
    () => createProduct(db, { name: 'Anderer', barcode: '4056489123456', protein_per_100g: 5 }),
    (e) => e.status === 409
  );
});

test('Produkte ohne Proteinwert werden abgelehnt', () => {
  assert.throws(() => createProduct(testDb(), { name: 'Ohne Wert' }),
    (e) => e.status === 400 && /protein_per_100g/.test(e.message));
});

test('Suche findet auch ueber die Marke, Favoriten stehen oben', () => {
  const db = testDb();
  createProduct(db, { name: 'Quark', brand: 'Milbona', protein_per_100g: 12 });
  const fav = createProduct(db, { name: 'Skyr', brand: 'Arla', protein_per_100g: 11, is_favorite: true });

  assert.equal(listProducts(db, { q: 'milbona' }).length, 1);
  assert.equal(listProducts(db)[0].id, fav.id);
  assert.equal(listProducts(db, { favorites: true }).length, 1);
});

test('Tagesansicht summiert gegessen und geplant getrennt', () => {
  const db = testDb();
  const quark = createProduct(db, { name: 'Magerquark', protein_per_100g: 12 });
  const whey = createProduct(db, { name: 'Whey', protein_per_100g: 80 });

  addEntry(db, { user_id: 1, date: TODAY, product_id: quark.id, amount_g: 250, status: 'eaten' });
  addEntry(db, { user_id: 1, date: TODAY, product_id: whey.id, amount_g: 30, status: 'planned' });

  const day = getDay(db, { user_id: 1, date: TODAY, today: TODAY });
  assert.equal(day.eaten_g, 30);
  assert.equal(day.planned_g, 24);
  assert.equal(day.target_g, 128);
  assert.equal(day.remaining_g, 98);
  assert.equal(day.remaining_after_planned_g, 74);
  assert.equal(day.entries.length, 2);
});

test('geplant laesst sich auf gegessen umschalten', () => {
  const db = testDb();
  const p = createProduct(db, { name: 'Whey', protein_per_100g: 80 });
  const entry = addEntry(db, { user_id: 1, date: TODAY, product_id: p.id, amount_g: 30, status: 'planned' });

  assert.equal(updateEntry(db, entry.id, { status: 'eaten' }).status, 'eaten');
  const day = getDay(db, { user_id: 1, date: TODAY, today: TODAY });
  assert.equal(day.eaten_g, 24);
  assert.equal(day.planned_g, 0);
});

test('Trainings-Toggle hebt das heutige Ziel und senkt es wieder', () => {
  const db = testDb();
  assert.equal(getDay(db, { user_id: 1, date: TODAY, today: TODAY }).target_g, 128);

  const on = toggleWorkout(db, { user_id: 1, date: TODAY });
  assert.equal(on.trained, true);
  assert.deepEqual(on.affects, [TODAY, '2026-03-11']);
  assert.equal(getDay(db, { user_id: 1, date: TODAY, today: TODAY }).target_g, 160);

  // Der Folgetag zaehlt ebenfalls als trainingsnah.
  const tomorrow = getDay(db, { user_id: 1, date: '2026-03-11', today: TODAY });
  assert.equal(tomorrow.target_g, 160);
  assert.equal(tomorrow.trained, false);
  assert.equal(tomorrow.was_training_adjacent, true);

  assert.equal(toggleWorkout(db, { user_id: 1, date: TODAY }).trained, false);
  assert.equal(getDay(db, { user_id: 1, date: TODAY, today: TODAY }).target_g, 128);
});

test('Vorlage loggt alle Positionen auf einmal', () => {
  const db = testDb();
  const milch = createProduct(db, { name: 'Milch', protein_per_100g: 3.4 });
  const pulver = createProduct(db, { name: 'Proteinpulver', protein_per_100g: 80 });
  const banane = createProduct(db, { name: 'Banane', protein_per_100g: 1.1 });

  const tpl = createTemplate(db, {
    name: 'Shake',
    items: [
      { product_id: milch.id, amount_g: 300 },
      { product_id: pulver.id, amount_g: 30 },
      { product_id: banane.id, amount_g: 120 },
    ],
  });
  assert.equal(tpl.protein_g, 35.5);

  assert.equal(logTemplate(db, tpl.id, { user_id: 1, date: TODAY, status: 'eaten' }).created, 3);
  const day = getDay(db, { user_id: 1, date: TODAY, today: TODAY });
  assert.equal(day.eaten_g, 35.5);
  assert.equal(day.entries.length, 3);
});

test('Produkte in Benutzung werden nicht geloescht', () => {
  const db = testDb();
  const p = createProduct(db, { name: 'Whey', protein_per_100g: 80 });
  addEntry(db, { user_id: 1, date: TODAY, product_id: p.id, amount_g: 30, status: 'eaten' });

  assert.throws(() => deleteProduct(db, p.id), (e) => e.status === 409 && /Historie/.test(e.message));

  // Unbenutzte Produkte schon.
  const unused = createProduct(db, { name: 'Unbenutzt', protein_per_100g: 1 });
  deleteProduct(db, unused.id);
  assert.equal(listProducts(db, { q: 'Unbenutzt' }).length, 0);
});

test('Gewichtseintrag aktualisiert das Profilgewicht und damit das Ziel', () => {
  const db = testDb();
  addWeight(db, 1, { date: TODAY, weight_kg: 85 });
  assert.equal(listUsers(db).find((u) => u.id === 1).weight_kg, 85);

  const day = getDay(db, { user_id: 1, date: TODAY, today: TODAY });
  assert.equal(day.weight_kg, 85);
  assert.equal(day.target_g, 136);
});

test('Faktoren aendern wirkt sofort auf das heutige Ziel', () => {
  const db = testDb();
  updateUser(db, 1, { factor_rest: 1.8 });
  assert.equal(getDay(db, { user_id: 1, date: TODAY, today: TODAY }).target_g, 144);
});

test('Verlauf liefert 7-Tage-Schnitt und Quote getrennt nach Tagtyp', () => {
  const db = testDb();
  const p = createProduct(db, { name: 'Protein', protein_per_100g: 100 });

  saveWorkout(db, { user_id: 1, date: '2026-03-04' }); // 04. und 05. trainingsnah
  for (const [date, grams] of [
    ['2026-03-04', 140], ['2026-03-05', 140],
    ['2026-03-06', 130], ['2026-03-07', 130],
    ['2026-03-08', 130], ['2026-03-09', 130],
  ]) {
    addEntry(db, { user_id: 1, date, product_id: p.id, amount_g: grams, status: 'eaten' });
  }

  const hist = getHistory(db, { user_id: 1, days: 7, today: TODAY });
  assert.equal(hist.days.length, 7);
  assert.equal(hist.days.at(-1).date, TODAY);
  assert.deepEqual(
    hist.days.filter((d) => d.was_training_adjacent).map((d) => d.date),
    ['2026-03-04', '2026-03-05']
  );

  assert.equal(hist.achievement.excludes_today, true);
  assert.equal(hist.achievement.training_adjacent.days, 2);
  assert.equal(hist.achievement.training_adjacent.hit, 0);  // 140 < 160
  assert.equal(hist.achievement.rest.days, 4);
  assert.equal(hist.achievement.rest.hit, 4);               // 130 >= 128
  assert.equal(hist.rolling7.avg_eaten_g, round1((140 * 2 + 130 * 4) / 7));
  assert.equal(hist.rolling7.window_days, 7);
});

test('Open-Food-Facts-Antworten werden robust gemappt', () => {
  const full = mapOffProduct({
    product_name: 'Skyr Natur', brands: 'Arla, Arla Foods',
    nutriments: { proteins_100g: 11, 'energy-kcal_100g': 63 },
    serving_size: '150 g',
  }, '5711953068904');
  assert.equal(full.product.name, 'Skyr Natur');
  assert.equal(full.product.brand, 'Arla');
  assert.equal(full.product.protein_per_100g, 11);
  assert.equal(full.product.default_serving_g, 150);
  assert.equal(full.warnings.length, 0);

  const sparse = mapOffProduct({ product_name: 'Irgendwas', nutriments: {} }, '1234567890');
  assert.equal(sparse.product.protein_per_100g, null);
  assert.match(sparse.warnings[0], /Proteinwert/);
});

test('ungueltige Eingaben liefern verstaendliche Fehler', () => {
  const db = testDb();
  assert.throws(() => getDay(db, { user_id: 1, date: '10.03.2026' }), (e) => e.status === 400);
  assert.throws(() => getDay(db, { user_id: 99, date: TODAY }), (e) => e.status === 404);
  assert.throws(() => addEntry(db, { user_id: 1, date: TODAY, product_id: 999, amount_g: 10, status: 'eaten' }),
    (e) => e.status === 400);
  assert.throws(() => addEntry(db, { user_id: 1, date: TODAY, product_id: 1, amount_g: 10, status: 'vielleicht' }),
    (e) => e.status === 400);
});

// ------------------------------------------------------------------ Sicherung

test('Export und Import stellen den Stand vollstaendig wieder her', () => {
  const db = testDb();
  const p = createProduct(db, { name: 'Magerquark', protein_per_100g: 12, barcode: '4056489123456' });
  addEntry(db, { user_id: 1, date: TODAY, product_id: p.id, amount_g: 250, status: 'eaten' });
  saveWorkout(db, { user_id: 1, date: TODAY, note: 'Ganzkörper' });
  addWeight(db, 1, { date: TODAY, weight_kg: 82 });
  getDay(db, { user_id: 1, date: TODAY, today: TODAY }); // erzeugt eine daily_targets-Zeile

  const backup = exportData(db);
  const before = getDay(db, { user_id: 1, date: TODAY, today: TODAY });

  const fresh = testDb();
  const counts = importData(fresh, backup);
  assert.equal(counts.products, 1);
  assert.equal(counts.log_entries, 1);

  const after = getDay(fresh, { user_id: 1, date: TODAY, today: TODAY });
  assert.equal(after.eaten_g, before.eaten_g);
  assert.equal(after.target_g, before.target_g);
  assert.equal(after.trained, true);
  assert.equal(after.weight_kg, 82);
  assert.equal(after.entries[0].product_name, 'Magerquark');
  assert.equal(after.workout_note, 'Ganzkörper');
});

test('fremde oder kaputte Sicherungen werden abgelehnt, ohne Daten zu verlieren', () => {
  const db = testDb();
  createProduct(db, { name: 'Bleibt erhalten', protein_per_100g: 10 });

  assert.throws(() => importData(db, { format: 'etwas-anderes' }), (e) => e.status === 400);
  assert.throws(() => importData(db, { format: 'protein-tracker-backup', version: 99 }),
    (e) => e.status === 400);
  assert.throws(
    () => importData(db, { format: 'protein-tracker-backup', version: 1, data: { products: 'kaputt' } }),
    (e) => e.status === 400
  );

  assert.equal(listProducts(db).length, 1, 'der alte Stand muss unangetastet bleiben');
});

test('ein fehlgeschlagener Import laesst den alten Stand stehen', () => {
  const db = testDb();
  createProduct(db, { name: 'Vorher da', protein_per_100g: 10 });

  // Eintrag verweist auf ein Produkt, das die Sicherung nicht enthaelt.
  const broken = {
    format: 'protein-tracker-backup',
    version: 1,
    data: {
      users: listUsers(db),
      log_entries: [{ id: 1, user_id: 1, date: TODAY, product_id: 4242, amount_g: 100, status: 'eaten', logged_at: '2026-03-10 10:00:00' }],
    },
  };
  assert.throws(() => importData(db, broken));
  assert.equal(listProducts(db).length, 1);
  assert.equal(listProducts(db)[0].name, 'Vorher da');
});

test('Demodaten erzeugen einen plausiblen Verlauf', () => {
  const db = testDb();
  const entries = seedDemoData(db, TODAY);
  assert.ok(entries > 100, `${entries} Eintraege`);

  const hist = getHistory(db, { user_id: 1, days: 14, today: TODAY });
  // Der Schnitt soll in der Naehe des Ziels liegen, nicht bei einem Bruchteil.
  assert.ok(hist.rolling7.pct > 70 && hist.rolling7.pct < 110, `Schnitt bei ${hist.rolling7.pct} %`);
  assert.ok(hist.days.some((d) => d.trained), 'es muss Trainingstage geben');
  assert.ok(hist.days.some((d) => !d.was_training_adjacent) || hist.days.every((d) => d.was_training_adjacent));

  // Profil 2 trainiert seltener und hat deshalb echte Ruhetage.
  const zwei = getHistory(db, { user_id: 2, days: 14, today: TODAY });
  assert.ok(zwei.achievement.rest.days > 0, 'Profil 2 braucht Ruhetage fuer die Auswertung');
});
