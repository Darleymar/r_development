/**
 * Fassade des Kerns. Bekommt ein Datenbank-Handle im Stil von better-sqlite3
 * und bietet darauf alle Operationen der App – identisch, ob das Handle unter
 * Node laeuft (Tests) oder als WebAssembly im Geraet (App).
 */
export * from './targets.js';
// validate.js reicht round1 aus targets.js durch; hier nur der Rest.
export {
  AppError, bad, notFound, conflict,
  num, str, oneOf, date, resolveToday, requireUser,
} from './validate.js';
export * from './repo/users.js';
export * from './repo/products.js';
export * from './repo/entries.js';
export * from './repo/workouts.js';
export * from './repo/templates.js';
export * from './repo/stats.js';
export * from './backup.js';
export { lookupBarcode, mapOffProduct, isBarcode } from './openfoodfacts.js';

/**
 * Legt bei leerer Datenbank zwei Profile an – der Prototyp soll ohne
 * Einrichtung startklar sein. Namen, Gewicht und Faktoren sind aenderbar.
 */
export function ensureProfiles(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return;
  const insert = db.prepare(
    'INSERT INTO users (name, weight_kg, factor_training, factor_rest) VALUES (?, ?, 2.0, 1.6)'
  );
  db.transaction(() => {
    insert.run('Profil 1', 80);
    insert.run('Profil 2', 65);
  })();
}
export { seedDemoData } from './demo.js';
