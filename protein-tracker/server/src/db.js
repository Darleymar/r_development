import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = path.join(here, '..', 'data', 'protein.db');

/**
 * Oeffnet (und erstellt bei Bedarf) die Datenbank und legt das Schema an.
 * `:memory:` wird fuer Tests unterstuetzt.
 */
export function openDb(file = process.env.PT_DB || DEFAULT_DB) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  ensureProfiles(db);
  return db;
}

/**
 * Der Prototyp ist fuer zwei Profile gedacht und soll ohne Einrichtung
 * startklar sein – Namen, Gewicht und Faktoren sind in den Einstellungen
 * aenderbar.
 */
function ensureProfiles(db) {
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

export default openDb;
