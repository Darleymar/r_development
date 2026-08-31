import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureProfiles } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', 'src', 'schema.sql'), 'utf8');

/**
 * Datenbank fuer Tests: better-sqlite3 im Speicher. Die App nutzt dasselbe
 * Schema und dieselben Funktionen ueber einen WebAssembly-Adapter mit
 * gleicher Schnittstelle – deshalb pruefen diese Tests echten App-Code.
 */
export function testDb({ profiles = true } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  if (profiles) ensureProfiles(db);
  return db;
}

export function singleUserDb() {
  const db = testDb({ profiles: false });
  db.prepare(
    'INSERT INTO users (id, name, weight_kg, factor_training, factor_rest) VALUES (1, ?, 80, 2.0, 1.6)'
  ).run('Test');
  return db;
}
