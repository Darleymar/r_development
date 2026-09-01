-- Protein-Tracker – Schema (SQLite)
-- Datumswerte durchgaengig als TEXT im Format 'YYYY-MM-DD' (lokales Datum, kein UTC).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL UNIQUE,
  weight_kg       REAL    NOT NULL,
  factor_training REAL    NOT NULL DEFAULT 2.0,
  factor_rest     REAL    NOT NULL DEFAULT 1.6,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Gewichtsverlauf. Fuer einen Tag D gilt der juengste Eintrag mit date <= D;
-- gibt es keinen, faellt die Berechnung auf users.weight_kg zurueck.
CREATE TABLE IF NOT EXISTS weight_entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date      TEXT    NOT NULL,
  weight_kg REAL    NOT NULL,
  UNIQUE (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_weight_entries_user_date ON weight_entries(user_id, date);

-- Produktbibliothek: bewusst NICHT nach Nutzer getrennt, beide Profile teilen sie.
CREATE TABLE IF NOT EXISTS products (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  brand             TEXT,
  barcode           TEXT    UNIQUE,
  protein_per_100g  REAL    NOT NULL,
  kcal_per_100g     REAL,
  default_serving_g REAL,
  -- Grobe Einordnung ("Getreide", "Milchprodukte"). Nur zum Blaettern in der
  -- Bibliothek; fuer Markenangaben ist brand zustaendig.
  category          TEXT,
  source            TEXT    NOT NULL DEFAULT 'manual'
                            CHECK (source IN ('openfoodfacts','manual')),
  is_favorite       INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0,1)),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS meal_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meal_template_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES meal_templates(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id)       ON DELETE CASCADE,
  amount_g    REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_template_items_template ON meal_template_items(template_id);

-- Minimal: Datum + Notiz. Bewusst kein Uebungs-/Volumentracking.
CREATE TABLE IF NOT EXISTS workouts (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date    TEXT    NOT NULL,
  note    TEXT,
  UNIQUE (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);

CREATE TABLE IF NOT EXISTS log_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  amount_g   REAL    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN ('planned','eaten')),
  logged_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_log_entries_user_date ON log_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_log_entries_product ON log_entries(product_id);

-- Eingefrorene Tagesziele. frozen=1 heisst: wird nie wieder neu berechnet,
-- auch wenn nachtraeglich ein Training fuer diesen Tag eingetragen wird.
CREATE TABLE IF NOT EXISTS daily_targets (
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date                  TEXT    NOT NULL,
  target_g              REAL    NOT NULL,
  was_training_adjacent INTEGER NOT NULL CHECK (was_training_adjacent IN (0,1)),
  frozen                INTEGER NOT NULL DEFAULT 0 CHECK (frozen IN (0,1)),
  PRIMARY KEY (user_id, date)
);
