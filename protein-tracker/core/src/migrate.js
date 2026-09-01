/**
 * Schemaanpassungen fuer bereits vorhandene Datenbanken.
 *
 * `schema.sql` legt nur an, was noch fehlt (CREATE TABLE IF NOT EXISTS) –
 * neue Spalten in bestehenden Tabellen entstehen dadurch nicht. Weil die
 * Daten auf den Geraeten der Nutzer liegen und nicht neu aufgesetzt werden
 * koennen, werden solche Aenderungen hier nachgezogen.
 *
 * Jeder Schritt muss gefahrlos mehrfach laufen koennen.
 */
const COLUMNS = [
  ['products', 'category', 'TEXT'],
];

export function migrate(db) {
  const applied = [];

  for (const [table, column, type] of COLUMNS) {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all()
      .some((c) => c.name === column);
    if (exists) continue;
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
    applied.push(`${table}.${column}`);
  }

  return applied;
}
