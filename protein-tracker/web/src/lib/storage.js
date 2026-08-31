/**
 * Ablage der Datenbankdatei im Geraet (IndexedDB).
 *
 * Gespeichert wird die exportierte SQLite-Datei als Ganzes. Bei der
 * Datenmenge dieser App – ein paar tausend Zeilen – ist das unkritisch und
 * spart eine zweite Persistenzschicht.
 */
const DB_NAME = 'protein-tracker';
const STORE = 'state';
const KEY = 'sqlite';

function openIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB steht nicht zur Verfügung.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB nicht nutzbar.'));
    request.onblocked = () => reject(new Error('IndexedDB ist blockiert.'));
  });
}

export async function loadBytes() {
  const idb = await openIdb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result) : null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    idb.close();
  }
}

export async function saveBytes(bytes) {
  const idb = await openIdb();
  try {
    await new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Speichern abgebrochen.'));
    });
  } finally {
    idb.close();
  }
}

export async function clearBytes() {
  const idb = await openIdb();
  try {
    await new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}
