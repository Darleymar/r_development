/**
 * Laesst eine sql.js-Datenbank wie better-sqlite3 aussehen.
 *
 * Der Kern (`@protein-tracker/core`) ist gegen die synchrone Schnittstelle
 * von better-sqlite3 geschrieben – `prepare(sql).get/all/run` und
 * `transaction(fn)`. Dieser Adapter bildet genau das auf sql.js ab, damit
 * dieselbe geprüfte Logik unter Node (Tests) und im Gerät (App) läuft,
 * ohne zwei Fassungen pflegen zu müssen.
 */

/**
 * SQLite kennt keine Booleans und akzeptiert kein `undefined`.
 * better-sqlite3 wirft dabei, sql.js bindet stillschweigend Unsinn – also
 * hier einmal sauber umsetzen.
 */
function coerce(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/**
 * Der Kern ruft entweder positionsweise (`get(a, b)`) oder mit einem Objekt
 * benannter Parameter (`run({ user_id: 1 })`) auf. Benannte Parameter heissen
 * im SQL durchgaengig `@name`, sql.js erwartet den Schluessel samt Zeichen.
 */
function toBindings(args) {
  if (args.length === 0) return undefined;

  const [first] = args;
  const isNamed = args.length === 1
    && first !== null
    && typeof first === 'object'
    && !Array.isArray(first)
    && !ArrayBuffer.isView(first);

  if (!isNamed) return args.map(coerce);

  const named = {};
  for (const [key, value] of Object.entries(first)) named[`@${key}`] = coerce(value);
  return named;
}

export function createAdapter(sqlDb, { onWrite } = {}) {
  let transactionDepth = 0;

  const lastInsertRowid = () => {
    const stmt = sqlDb.prepare('SELECT last_insert_rowid() AS id');
    try {
      stmt.step();
      return stmt.getAsObject().id;
    } finally {
      stmt.free();
    }
  };

  const markWritten = () => {
    // Innerhalb einer Transaktion erst nach dem Commit melden.
    if (transactionDepth === 0) onWrite?.();
  };

  function prepare(sql) {
    return {
      get(...args) {
        const stmt = sqlDb.prepare(sql);
        try {
          const bindings = toBindings(args);
          if (bindings !== undefined) stmt.bind(bindings);
          return stmt.step() ? stmt.getAsObject() : undefined;
        } finally {
          stmt.free();
        }
      },

      all(...args) {
        const stmt = sqlDb.prepare(sql);
        try {
          const bindings = toBindings(args);
          if (bindings !== undefined) stmt.bind(bindings);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          return rows;
        } finally {
          stmt.free();
        }
      },

      run(...args) {
        const stmt = sqlDb.prepare(sql);
        try {
          const bindings = toBindings(args);
          if (bindings !== undefined) stmt.bind(bindings);
          stmt.step();
        } finally {
          stmt.free();
        }
        const result = { changes: sqlDb.getRowsModified(), lastInsertRowid: lastInsertRowid() };
        markWritten();
        return result;
      },
    };
  }

  /**
   * Wie bei better-sqlite3 liefert `transaction` eine Funktion zurueck.
   * Verschachtelte Aufrufe klinken sich in die aeussere Transaktion ein,
   * statt eine zweite zu oeffnen – SQLite erlaubt das ohnehin nicht.
   */
  function transaction(fn) {
    return (...args) => {
      if (transactionDepth > 0) {
        transactionDepth += 1;
        try {
          return fn(...args);
        } finally {
          transactionDepth -= 1;
        }
      }

      sqlDb.run('BEGIN');
      transactionDepth = 1;
      try {
        const result = fn(...args);
        transactionDepth = 0;
        sqlDb.run('COMMIT');
        onWrite?.();
        return result;
      } catch (err) {
        transactionDepth = 0;
        try {
          sqlDb.run('ROLLBACK');
        } catch {
          /* Rollback kann fehlschlagen, wenn die Transaktion schon beendet ist. */
        }
        throw err;
      }
    };
  }

  return {
    prepare,
    transaction,
    exec(sql) {
      sqlDb.run(sql);
      markWritten();
    },
    pragma(statement) {
      sqlDb.run(`PRAGMA ${statement}`);
    },
    export: () => sqlDb.export(),
    close: () => sqlDb.close(),
  };
}
