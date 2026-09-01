/**
 * Grundstock gaengiger Lebensmittel.
 *
 * Damit kennt die App die ueblichen Zutaten von Anfang an – Haferflocken,
 * Sojadrink, Quark – ohne dass jemand Naehrwerte abtippen oder eine Packung
 * mit Barcode zur Hand haben muss.
 *
 * Es sind **Richtwerte** fuer die uebliche Zusammensetzung, keine Angaben zu
 * einem bestimmten Markenprodukt. Sie sind in der App jederzeit editierbar;
 * fuer ein konkretes Produkt gewinnen Packungsangabe oder Barcode-Abruf.
 *
 * Format: [Name, Kategorie, Protein je 100 g, kcal je 100 g, uebliche Portion in g]
 * Mengen beziehen sich auf den rohen Zustand, sofern nicht anders benannt.
 */
export const STARTER_FOODS = [
  // ------------------------------------------------------- Getreide, Beilagen
  ['Haferflocken',              'Getreide', 13.5, 370,  60],
  ['Haferkleie',                'Getreide', 17.0, 350,  30],
  ['Dinkelflocken',             'Getreide', 14.0, 350,  60],
  ['Müsli, Basis ohne Zucker',  'Getreide', 11.0, 360,  60],
  ['Vollkornbrot',              'Getreide',  7.0, 210,  50],
  ['Roggenvollkornbrot',        'Getreide',  6.5, 190,  50],
  ['Weizenmischbrot',           'Getreide',  7.5, 250,  50],
  ['Toastbrot',                 'Getreide',  8.0, 260,  25],
  ['Nudeln, roh',               'Getreide', 12.5, 360, 100],
  ['Nudeln, gekocht',           'Getreide',  5.0, 150, 250],
  ['Vollkornnudeln, roh',       'Getreide', 13.5, 340, 100],
  ['Reis, roh',                 'Getreide',  7.0, 350,  80],
  ['Reis, gekocht',             'Getreide',  2.6, 130, 200],
  ['Vollkornreis, roh',         'Getreide',  8.0, 350,  80],
  ['Couscous, roh',             'Getreide', 12.0, 360,  80],
  ['Bulgur, roh',               'Getreide', 12.0, 350,  80],
  ['Quinoa, roh',               'Getreide', 14.0, 370,  80],
  ['Kartoffeln, gekocht',       'Getreide',  2.0,  70, 250],
  ['Süßkartoffel, gekocht',     'Getreide',  1.6,  90, 200],

  // ---------------------------------------------------------- Milchprodukte
  ['Magerquark',                'Milchprodukte', 12.0,  67, 250],
  ['Speisequark 20 %',          'Milchprodukte', 12.0, 110, 250],
  ['Skyr, natur',               'Milchprodukte', 11.0,  63, 150],
  ['Hüttenkäse',                'Milchprodukte', 13.0, 100, 200],
  ['Naturjoghurt 3,5 %',        'Milchprodukte',  3.5,  65, 150],
  ['Magerjoghurt',              'Milchprodukte',  4.0,  45, 150],
  ['Griechischer Joghurt 10 %', 'Milchprodukte',  6.0, 130, 150],
  ['Vollmilch 3,5 %',           'Milchprodukte',  3.4,  64, 200],
  ['Milch 1,5 %',               'Milchprodukte',  3.5,  47, 200],
  ['Buttermilch',               'Milchprodukte',  3.5,  37, 250],
  ['Gouda 45 %',                'Milchprodukte', 25.0, 360,  30],
  ['Emmentaler',                'Milchprodukte', 29.0, 380,  30],
  ['Parmesan',                  'Milchprodukte', 36.0, 390,  20],
  ['Mozzarella',                'Milchprodukte', 18.0, 250, 125],
  ['Feta',                      'Milchprodukte', 14.0, 260,  50],
  ['Harzer Käse',               'Milchprodukte', 30.0, 125, 125],
  ['Körniger Frischkäse',       'Milchprodukte', 12.5,  95, 200],
  ['Frischkäse Doppelrahm',     'Milchprodukte',  6.0, 250,  30],

  // ------------------------------------------------------- Pflanzliche Drinks
  ['Sojadrink, ungesüßt',       'Pflanzendrinks', 3.3,  39, 200],
  ['Haferdrink',                'Pflanzendrinks', 1.0,  45, 200],
  ['Mandeldrink, ungesüßt',     'Pflanzendrinks', 0.5,  24, 200],
  ['Erbsendrink',               'Pflanzendrinks', 3.0,  40, 200],
  ['Sojajoghurt, natur',        'Pflanzendrinks', 4.0,  60, 150],

  // -------------------------------------------------------- Fleisch und Fisch
  ['Hähnchenbrustfilet',        'Fleisch & Fisch', 23.0, 108, 150],
  ['Putenbrustfilet',           'Fleisch & Fisch', 24.0, 105, 150],
  ['Rinderhackfleisch 5 %',     'Fleisch & Fisch', 21.0, 133, 150],
  ['Gemischtes Hackfleisch',    'Fleisch & Fisch', 18.0, 220, 150],
  ['Schweineschnitzel',         'Fleisch & Fisch', 22.0, 110, 150],
  ['Rindersteak',               'Fleisch & Fisch', 22.0, 150, 150],
  ['Kochschinken',              'Fleisch & Fisch', 20.0, 110,  50],
  ['Putenaufschnitt',           'Fleisch & Fisch', 18.0, 100,  50],
  ['Salami',                    'Fleisch & Fisch', 18.0, 400,  30],
  ['Lachsfilet',                'Fleisch & Fisch', 20.0, 208, 125],
  ['Kabeljau',                  'Fleisch & Fisch', 18.0,  80, 150],
  ['Forelle',                   'Fleisch & Fisch', 20.0, 120, 150],
  ['Thunfisch in Wasser',       'Fleisch & Fisch', 26.0, 116, 140],
  ['Garnelen',                  'Fleisch & Fisch', 20.0, 100, 100],
  ['Hering',                    'Fleisch & Fisch', 18.0, 200, 100],

  // ------------------------------------------------------------------- Eier
  ['Ei (Größe M)',              'Eier', 12.6, 137,  60],
  ['Eiklar',                    'Eier', 11.0,  48,  33],
  ['Eigelb',                    'Eier', 16.0, 320,  17],

  // -------------------------------------------------- Hülsenfrüchte und Soja
  ['Linsen, roh',               'Hülsenfrüchte', 24.0, 320,  80],
  ['Linsen, gekocht',           'Hülsenfrüchte',  9.0, 116, 200],
  ['Kichererbsen, roh',         'Hülsenfrüchte', 19.0, 340,  80],
  ['Kichererbsen, Dose',        'Hülsenfrüchte',  7.0, 120, 150],
  ['Kidneybohnen, Dose',        'Hülsenfrüchte',  7.0, 110, 150],
  ['Weiße Bohnen, Dose',        'Hülsenfrüchte',  6.5, 105, 150],
  ['Erbsen, tiefgekühlt',       'Hülsenfrüchte',  5.0,  80, 150],
  ['Edamame',                   'Hülsenfrüchte', 11.0, 120, 100],
  ['Tofu, natur',               'Hülsenfrüchte', 12.0, 130, 150],
  ['Räuchertofu',               'Hülsenfrüchte', 17.0, 180, 100],
  ['Tempeh',                    'Hülsenfrüchte', 19.0, 190, 100],
  ['Sojaschnetzel, trocken',    'Hülsenfrüchte', 50.0, 350,  50],
  ['Seitan',                    'Hülsenfrüchte', 25.0, 150, 100],

  // --------------------------------------------------------- Nüsse und Samen
  ['Mandeln',                   'Nüsse & Samen', 21.0, 579,  30],
  ['Walnüsse',                  'Nüsse & Samen', 15.0, 654,  30],
  ['Haselnüsse',                'Nüsse & Samen', 14.0, 630,  30],
  ['Cashewkerne',               'Nüsse & Samen', 18.0, 550,  30],
  ['Erdnüsse',                  'Nüsse & Samen', 25.0, 570,  30],
  ['Erdnussmus',                'Nüsse & Samen', 25.0, 590,  20],
  ['Sonnenblumenkerne',         'Nüsse & Samen', 21.0, 580,  20],
  ['Kürbiskerne',               'Nüsse & Samen', 24.0, 560,  20],
  ['Leinsamen, geschrotet',     'Nüsse & Samen', 18.0, 530,  15],
  ['Chiasamen',                 'Nüsse & Samen', 17.0, 440,  15],

  // ----------------------------------------------------------- Obst, Gemüse
  ['Banane',                    'Obst & Gemüse', 1.1,  93, 120],
  ['Apfel',                     'Obst & Gemüse', 0.3,  54, 150],
  ['Beeren, gemischt',          'Obst & Gemüse', 1.0,  45, 150],
  ['Orange',                    'Obst & Gemüse', 1.0,  47, 150],
  ['Avocado',                   'Obst & Gemüse', 2.0, 160, 100],
  ['Brokkoli',                  'Obst & Gemüse', 2.8,  34, 200],
  ['Spinat',                    'Obst & Gemüse', 2.9,  23, 200],
  ['Champignons',               'Obst & Gemüse', 2.7,  22, 150],
  ['Paprika',                   'Obst & Gemüse', 1.0,  30, 150],
  ['Tomate',                    'Obst & Gemüse', 0.9,  18, 150],
  ['Gurke',                     'Obst & Gemüse', 0.6,  12, 150],
  ['Karotte',                   'Obst & Gemüse', 0.8,  40, 150],
  ['Zucchini',                  'Obst & Gemüse', 1.6,  20, 200],

  // ------------------------------------------------------------ Supplemente
  ['Whey Protein, Pulver',      'Supplemente', 78.0, 375, 30],
  ['Mehrkomponenten-Protein',   'Supplemente', 75.0, 370, 30],
  ['Veganes Proteinpulver',     'Supplemente', 75.0, 380, 30],
  ['Proteinriegel',             'Supplemente', 30.0, 350, 60],

  // ------------------------------------------------------------------- Fette
  ['Olivenöl',                  'Fette', 0.0, 880, 10],
  ['Rapsöl',                    'Fette', 0.0, 880, 10],
  ['Butter',                    'Fette', 0.7, 740, 10],
];

const normalise = (name) => name.trim().toLowerCase();

/**
 * Traegt fehlende Grundnahrungsmittel nach.
 *
 * Bewusst additiv: vorhandene Produkte werden nicht angefasst, auch wenn
 * jemand ihre Werte angepasst hat. Verglichen wird ueber den Namen, damit
 * ein zweiter Aufruf nichts doppelt.
 *
 * @returns {number} Anzahl der neu angelegten Produkte
 */
export function ensureStarterFoods(db) {
  const existing = new Set(
    db.prepare('SELECT name FROM products').all().map((row) => normalise(row.name))
  );

  const insert = db.prepare(
    `INSERT INTO products (name, brand, barcode, protein_per_100g, kcal_per_100g,
                           default_serving_g, category, source, is_favorite)
     VALUES (@name, NULL, NULL, @protein, @kcal, @serving, @category, 'manual', 0)`
  );

  return db.transaction(() => {
    let added = 0;
    for (const [name, category, protein, kcal, serving] of STARTER_FOODS) {
      if (existing.has(normalise(name))) continue;
      insert.run({ name, category, protein, kcal, serving });
      added += 1;
    }
    return added;
  })();
}
