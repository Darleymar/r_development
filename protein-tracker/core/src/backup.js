/**
 * Sicherung der Daten.
 *
 * Die Daten liegen ausschliesslich auf dem Geraet – ohne Export waere ein
 * verlorenes oder zuruecksetztes Handy gleichbedeutend mit verlorenen Daten.
 */
import { bad } from './validate.js';

const TABLES = [
  'users', 'weight_entries', 'products', 'meal_templates',
  'meal_template_items', 'workouts', 'log_entries', 'daily_targets',
];

export const BACKUP_FORMAT = 'protein-tracker-backup';
export const BACKUP_VERSION = 1;

export function exportData(db) {
  const data = {};
  for (const table of TABLES) data[table] = db.prepare(`SELECT * FROM ${table}`).all();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    data,
  };
}

/**
 * Spielt eine Sicherung zurueck und ersetzt dabei den gesamten Bestand.
 * Alles oder nichts: schlaegt eine Zeile fehl, bleibt der alte Stand stehen.
 */
export function importData(db, backup) {
  if (backup?.format !== BACKUP_FORMAT) {
    throw bad('Das ist keine Sicherung des Protein-Trackers.');
  }
  if (backup.version > BACKUP_VERSION) {
    throw bad(`Die Sicherung stammt aus einer neueren Version (${backup.version}).`);
  }
  const data = backup.data ?? {};
  for (const table of TABLES) {
    if (data[table] !== undefined && !Array.isArray(data[table])) {
      throw bad(`Abschnitt "${table}" in der Sicherung ist unbrauchbar.`);
    }
  }

  const counts = {};
  db.transaction(() => {
    // Rueckwaerts loeschen, damit Fremdschluessel nicht im Weg stehen.
    for (const table of [...TABLES].reverse()) db.prepare(`DELETE FROM ${table}`).run();

    for (const table of TABLES) {
      const rows = data[table] ?? [];
      counts[table] = rows.length;
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      const stmt = db.prepare(
        `INSERT INTO ${table} (${columns.join(', ')})
         VALUES (${columns.map((c) => `@${c}`).join(', ')})`
      );
      for (const row of rows) {
        const clean = {};
        for (const c of columns) clean[c] = row[c] ?? null;
        stmt.run(clean);
      }
    }
  })();

  return counts;
}
