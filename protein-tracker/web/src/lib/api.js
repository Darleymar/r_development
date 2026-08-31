/**
 * Datenzugriff der App.
 *
 * Bietet dieselben Methoden wie frueher der HTTP-Client, arbeitet aber
 * ausschliesslich auf der lokalen Datenbank im Geraet. Es gibt keinen Server –
 * die Screens merken davon nichts, weil die Schnittstelle gleich geblieben ist.
 */
import * as core from '@protein-tracker/core';
import { openDatabase, resetDatabase, flush } from './db.js';

const withDb = (fn) => async (...args) => {
  const db = await openDatabase();
  return fn(db, ...args);
};

/**
 * Open Food Facts erlaubt Zugriffe aus dem Browser. In der Android-App laeuft
 * die Anfrage nativ, was CORS von vornherein umgeht und auch dann traegt,
 * wenn der Dienst seine Kopfzeilen aendert.
 */
async function request(url) {
  const capacitor = globalThis.Capacitor;
  if (capacitor?.isNativePlatform?.()) {
    const { CapacitorHttp } = await import('@capacitor/core');
    const res = await CapacitorHttp.get({ url, headers: { Accept: 'application/json' } });
    return {
      status: res.status,
      json: async () => (typeof res.data === 'string' ? JSON.parse(res.data) : res.data),
    };
  }
  return fetch(url, { headers: { Accept: 'application/json' } });
}

export const api = {
  users: withDb(core.listUsers),
  createUser: withDb((db, body) => core.createUser(db, body)),
  updateUser: withDb((db, id, body) => core.updateUser(db, id, body)),
  deleteUser: withDb((db, id) => core.deleteUser(db, id)),

  weights: withDb((db, userId) => core.listWeights(db, userId)),
  addWeight: withDb((db, userId, body) => core.addWeight(db, userId, body)),
  deleteWeight: withDb((db, userId, date) => core.deleteWeight(db, userId, date)),

  products: withDb((db, params = {}) => core.listProducts(db, params)),
  createProduct: withDb((db, body) => core.createProduct(db, body)),
  updateProduct: withDb((db, id, body) => core.updateProduct(db, id, body)),
  deleteProduct: withDb((db, id) => core.deleteProduct(db, id)),

  templates: withDb(core.listTemplates),
  createTemplate: withDb((db, body) => core.createTemplate(db, body)),
  updateTemplate: withDb((db, id, body) => core.updateTemplate(db, id, body)),
  deleteTemplate: withDb((db, id) => core.deleteTemplate(db, id)),
  logTemplate: withDb((db, id, body) => core.logTemplate(db, id, body)),

  workouts: withDb((db, params = {}) => core.listWorkouts(db, params.user_id, params)),
  toggleWorkout: withDb((db, body) => core.toggleWorkout(db, body)),
  saveWorkout: withDb((db, body) => core.saveWorkout(db, body)),

  addEntry: withDb((db, body) => core.addEntry(db, body)),
  updateEntry: withDb((db, id, body) => core.updateEntry(db, id, body)),
  deleteEntry: withDb((db, id) => core.deleteEntry(db, id)),

  day: withDb((db, params) => core.getDay(db, params)),
  history: withDb((db, params) => core.getHistory(db, params)),

  /**
   * Barcode nachschlagen. Ein bereits erfasstes Produkt gewinnt gegen die
   * teils lueckenhaften Daten von Open Food Facts.
   */
  lookupBarcode: withDb(async (db, barcode) => {
    const known = core.findByBarcode(db, barcode);
    if (known) {
      return { found: true, source: 'library', barcode, existing_product: known, warnings: [] };
    }
    return core.lookupBarcode(barcode, { request });
  }),

  // --------------------------------------------------------------- Sicherung
  exportBackup: withDb(core.exportData),
  importBackup: withDb(async (db, backup) => {
    const counts = core.importData(db, backup);
    await flush();
    return counts;
  }),
  loadDemoData: withDb(async (db, today) => {
    const n = core.seedDemoData(db, today);
    await flush();
    return n;
  }),
  resetAll: async () => { await resetDatabase(); },
};

export { flush };
