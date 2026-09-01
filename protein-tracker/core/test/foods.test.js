import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testDb } from './helpers.js';
import {
  STARTER_FOODS, ensureStarterFoods, migrate,
  listProducts, createProduct, updateProduct, addEntry, getDay, seedDemoData,
} from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', 'src', 'schema.sql'), 'utf8');

test('die Tabelle ist plausibel: keine Duplikate, Werte im moeglichen Bereich', () => {
  const names = STARTER_FOODS.map(([name]) => name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'Namen muessen eindeutig sein');
  assert.ok(STARTER_FOODS.length >= 80, `${STARTER_FOODS.length} Eintraege`);

  for (const [name, category, protein, kcal, serving] of STARTER_FOODS) {
    assert.ok(name && category, `${name}: Name und Kategorie noetig`);
    assert.ok(protein >= 0 && protein <= 100, `${name}: Protein ${protein}`);
    assert.ok(kcal >= 0 && kcal <= 900, `${name}: kcal ${kcal}`);
    assert.ok(serving > 0 && serving <= 500, `${name}: Portion ${serving}`);

    // Protein liefert 4 kcal je Gramm – mehr Protein als Energie ist unmoeglich.
    assert.ok(protein * 4 <= kcal + 1, `${name}: ${protein} g Protein passen nicht zu ${kcal} kcal`);
  }
});

test('typische Zutaten sind enthalten und richtig hinterlegt', () => {
  const byName = new Map(STARTER_FOODS.map(([name, , protein]) => [name, protein]));
  for (const name of ['Haferflocken', 'Sojadrink, ungesüßt', 'Magerquark', 'Linsen, roh',
                      'Hähnchenbrustfilet', 'Tofu, natur', 'Ei (Größe M)']) {
    assert.ok(byName.has(name), `${name} fehlt im Grundstock`);
  }
  assert.equal(byName.get('Haferflocken'), 13.5);
  assert.equal(byName.get('Sojadrink, ungesüßt'), 3.3);
});

test('der Grundstock landet vollstaendig in der Bibliothek', () => {
  const db = testDb();
  const added = ensureStarterFoods(db);
  assert.equal(added, STARTER_FOODS.length);

  const hafer = listProducts(db, { q: 'haferflocken' })[0];
  assert.equal(hafer.protein_per_100g, 13.5);
  assert.equal(hafer.category, 'Getreide');
  assert.equal(hafer.brand, null, 'die Kategorie darf nicht im Markenfeld landen');
});

test('ein zweiter Aufruf legt nichts doppelt an', () => {
  const db = testDb();
  ensureStarterFoods(db);
  assert.equal(ensureStarterFoods(db), 0);
  assert.equal(listProducts(db, { limit: 500 }).length, STARTER_FOODS.length);
});

test('eigene Aenderungen am Grundstock bleiben beim Nachtragen erhalten', () => {
  const db = testDb();
  ensureStarterFoods(db);

  const hafer = listProducts(db, { q: 'haferflocken' })[0];
  updateProduct(db, hafer.id, { protein_per_100g: 12.8, is_favorite: true });

  // Ein Produkt entfernen, um das Nachtragen sichtbar zu machen.
  const banane = listProducts(db, { q: 'banane' })[0];
  db.prepare('DELETE FROM products WHERE id = ?').run(banane.id);

  assert.equal(ensureStarterFoods(db), 1, 'nur das fehlende Produkt darf zurueckkommen');

  const danach = listProducts(db, { q: 'haferflocken' })[0];
  assert.equal(danach.protein_per_100g, 12.8, 'der angepasste Wert muss stehen bleiben');
  assert.equal(danach.is_favorite, 1);
});

test('mit dem Grundstock laesst sich ohne Barcode loggen', () => {
  const db = testDb();
  ensureStarterFoods(db);

  const hafer = listProducts(db, { q: 'haferflocken' })[0];
  const soja = listProducts(db, { q: 'sojadrink' })[0];

  addEntry(db, { user_id: 1, date: '2026-03-10', product_id: hafer.id, amount_g: 100, status: 'eaten' });
  addEntry(db, { user_id: 1, date: '2026-03-10', product_id: soja.id, amount_g: 250, status: 'eaten' });

  const day = getDay(db, { user_id: 1, date: '2026-03-10', today: '2026-03-10' });
  // 100 g Haferflocken = 13,5 g + 250 ml Sojadrink = 8,25 g
  assert.equal(day.eaten_g, 21.8);
});

test('die Suche findet den Grundstock auch ueber die Kategorie', () => {
  const db = testDb();
  ensureStarterFoods(db);
  assert.ok(listProducts(db, { q: 'Hülsenfrüchte' }).length >= 10);
  assert.ok(listProducts(db, { q: 'quark' }).length >= 2);
});

test('Demodaten loeschen den Grundstock nicht', () => {
  const db = testDb();
  ensureStarterFoods(db);
  seedDemoData(db, '2026-03-10');

  assert.ok(listProducts(db, { q: 'sojadrink' }).length === 1, 'Grundstock muss erhalten bleiben');
  assert.ok(listProducts(db, { limit: 500 }).length > STARTER_FOODS.length,
    'Demoprodukte kommen hinzu');
});

// ------------------------------------------------------------------ Migration

test('eine aeltere Datenbank ohne category-Spalte wird nachgezogen', () => {
  // Schema von vor der Aenderung nachstellen.
  const alt = SCHEMA.replace(/\s*-- Grobe Einordnung[\s\S]*?category\s+TEXT,\n/, '\n');
  assert.ok(!/category/.test(alt), 'das alte Schema darf die Spalte nicht kennen');

  const db = new Database(':memory:');
  db.exec(alt);
  db.prepare(
    `INSERT INTO products (name, protein_per_100g, source) VALUES ('Eigenes Produkt', 20, 'manual')`
  ).run();

  assert.deepEqual(migrate(db), ['products.category']);
  assert.deepEqual(migrate(db), [], 'ein zweiter Lauf darf nichts mehr tun');

  // Bestand unversehrt, neue Spalte nutzbar.
  const vorhanden = db.prepare('SELECT * FROM products').get();
  assert.equal(vorhanden.name, 'Eigenes Produkt');
  assert.equal(vorhanden.category, null);

  assert.equal(ensureStarterFoods(db), STARTER_FOODS.length);
  const hafer = db.prepare("SELECT * FROM products WHERE name = 'Haferflocken'").get();
  assert.equal(hafer.category, 'Getreide');
});

test('Kategorie laesst sich beim Anlegen und Bearbeiten setzen', () => {
  const db = testDb();
  const p = createProduct(db, { name: 'Eigenes', protein_per_100g: 10, category: 'Sonstiges' });
  assert.equal(p.category, 'Sonstiges');
  assert.equal(updateProduct(db, p.id, { category: 'Getreide' }).category, 'Getreide');
});

// ------------------------------------------------- Namenssuche bei Open Food Facts

test('die Namenssuche mappt Treffer und sortiert Lueckenhaftes nach hinten', async () => {
  const { searchByName } = await import('../src/index.js');

  let angefragt = null;
  const request = async (url) => {
    angefragt = url;
    return {
      status: 200,
      json: async () => ({
        products: [
          { code: '1', product_name: 'Ohne Naehrwerte', nutriments: {} },
          { code: '2', product_name: 'Haferflocken zart', brands: 'Kölln, Peter Kölln',
            nutriments: { proteins_100g: 13.5, 'energy-kcal_100g': 370 }, serving_size: '40 g' },
          { code: '3', nutriments: { proteins_100g: 5 } }, // ohne Namen -> faellt raus
        ],
      }),
    };
  };

  const res = await searchByName('haferflocken', { request });
  assert.equal(res.count, 2, 'Treffer ohne Namen sind unbrauchbar');
  assert.equal(res.results[0].product.name, 'Haferflocken zart', 'vollstaendige Treffer zuerst');
  assert.equal(res.results[0].product.protein_per_100g, 13.5);
  assert.equal(res.results[0].product.brand, 'Kölln');
  assert.equal(res.results[0].product.default_serving_g, 40);
  assert.match(res.results[1].warnings[0], /Proteinwert/);

  assert.match(angefragt, /search_terms=haferflocken/);
  assert.match(angefragt, /lc=de/);
});

test('die Namenssuche meldet zu kurze Eingaben und Ausfaelle verstaendlich', async () => {
  const { searchByName } = await import('../src/index.js');

  await assert.rejects(() => searchByName('a', { request: async () => ({}) }),
    (e) => e.status === 400);

  await assert.rejects(
    () => searchByName('quark', { request: async () => { throw new Error('offline'); } }),
    (e) => e.status === 502 && /manuell anlegen/.test(e.message)
  );

  await assert.rejects(
    () => searchByName('quark', { request: async () => ({ status: 503, json: async () => ({}) }) }),
    (e) => e.status === 502 && /503/.test(e.message)
  );
});

test('eine leere Antwort ist kein Fehler', async () => {
  const { searchByName } = await import('../src/index.js');
  const res = await searchByName('gibtesnicht', {
    request: async () => ({ status: 200, json: async () => ({ products: [] }) }),
  });
  assert.equal(res.count, 0);
  assert.deepEqual(res.results, []);
});
