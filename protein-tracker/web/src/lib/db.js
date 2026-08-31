import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import schemaSql from '@protein-tracker/core/schema.sql?raw';
import { ensureProfiles } from '@protein-tracker/core';
import { createAdapter } from './sqlite-adapter.js';
import { loadBytes, saveBytes, clearBytes } from './storage.js';

let ready = null;
let handle = null;
let persistTimer = null;
let persistError = null;

/** Schreibvorgaenge buendeln, statt nach jedem Tastendruck zu speichern. */
const PERSIST_DELAY_MS = 200;

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { flush(); }, PERSIST_DELAY_MS);
}

export async function flush() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!handle) return;
  try {
    await saveBytes(handle.export());
    persistError = null;
  } catch (err) {
    // Nicht werfen: die App bleibt bedienbar, der Hinweis erscheint im Profil.
    persistError = err.message;
  }
}

export const getPersistError = () => persistError;

/**
 * Oeffnet die lokale Datenbank – beim ersten Start frisch angelegt, danach
 * aus dem Geraetespeicher. Alles laeuft ohne Server; die Daten verlassen
 * das Geraet nur ueber den Export in den Einstellungen.
 */
export function openDatabase() {
  if (ready) return ready;

  ready = (async () => {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });

    let bytes = null;
    try {
      bytes = await loadBytes();
    } catch (err) {
      persistError = `Der Gerätespeicher ist nicht nutzbar (${err.message}). `
        + 'Die App läuft, merkt sich aber nichts über den Neustart hinaus.';
    }

    const sqlDb = bytes ? new SQL.Database(bytes) : new SQL.Database();
    handle = createAdapter(sqlDb, { onWrite: schedulePersist });
    handle.pragma('foreign_keys = ON');

    // Das Schema ist idempotent (CREATE TABLE IF NOT EXISTS) und darf bei
    // jedem Start laufen – so wachsen spaetere Tabellen von selbst mit.
    handle.exec(schemaSql);
    ensureProfiles(handle);
    await flush();

    return handle;
  })();

  return ready;
}

/** Setzt die Datenbank vollstaendig zurueck. */
export async function resetDatabase() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  handle?.close();
  handle = null;
  ready = null;
  await clearBytes();
  return openDatabase();
}

// Beim Wegschalten der App den letzten Stand sichern, damit auch ein
// abgebrochener Wartetakt nichts verliert.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', () => { flush(); });
}
