"""SQLite-Schema und Zugriffshelfer.

Die Datenbank ist bewusst flach und ohne ORM gehalten, damit man mit
``sqlite3 urkatalog.db`` direkt selbst abfragen kann.

Arbeitsteilung: der Fetcher schreibt ``labels``/``releases``/``tracks``/
``videos``, die App schreibt ausschliesslich ``listening``. Ein erneuter
Katalog-Abgleich fasst den Hoerfortschritt nie an.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable, Optional

DEFAULT_DB = "urkatalog.db"

STATUSES = ("ungehoert", "gehoert", "favorit", "nochmal")

SCHEMA = """
CREATE TABLE IF NOT EXISTS labels (
    id                  INTEGER PRIMARY KEY,
    name                TEXT    NOT NULL,
    is_sublabel         INTEGER NOT NULL DEFAULT 0,
    parent_id           INTEGER REFERENCES labels(id),
    fetched_at          TEXT,
    releases_fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS releases (
    id                 INTEGER PRIMARY KEY,          -- Discogs-Release-ID
    label_id           INTEGER REFERENCES labels(id),
    catno_raw          TEXT,
    catno_norm         TEXT,                         -- Gruppenschluessel fuer Varianten
    catno_prefix       TEXT,
    catno_num          INTEGER,
    artist             TEXT,
    title              TEXT,
    year               INTEGER,
    released           TEXT,
    country            TEXT,
    formats_json       TEXT,                         -- JSON: Discogs-Formatobjekte
    genres             TEXT,                         -- JSON-Array
    styles             TEXT,                         -- JSON-Array
    notes              TEXT,
    discogs_url        TEXT,
    thumb_url          TEXT,
    variant_of         INTEGER REFERENCES releases(id),
    is_primary         INTEGER NOT NULL DEFAULT 1,
    is_related         INTEGER NOT NULL DEFAULT 0,   -- Seed-Liste (X-101 usw.)
    related_note       TEXT,
    spotify_uri        TEXT,
    spotify_url        TEXT,
    spotify_checked_at TEXT,
    fetched_at         TEXT,
    detail_fetched_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_releases_sort
    ON releases(label_id, catno_prefix, catno_num);
CREATE INDEX IF NOT EXISTS idx_releases_norm    ON releases(catno_norm);
CREATE INDEX IF NOT EXISTS idx_releases_variant ON releases(variant_of);
CREATE INDEX IF NOT EXISTS idx_releases_detail  ON releases(detail_fetched_at);

CREATE TABLE IF NOT EXISTS tracks (
    release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,                     -- Reihenfolge wie bei Discogs
    position   TEXT,
    title      TEXT,
    duration   TEXT,
    artists    TEXT,
    PRIMARY KEY (release_id, seq)
);

CREATE TABLE IF NOT EXISTS videos (
    release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    uri        TEXT NOT NULL,
    title      TEXT,
    duration   INTEGER,
    PRIMARY KEY (release_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_videos_release ON videos(release_id);

-- Wird ausschliesslich von der App geschrieben.
CREATE TABLE IF NOT EXISTS listening (
    release_id  INTEGER PRIMARY KEY REFERENCES releases(id),
    status      TEXT NOT NULL DEFAULT 'ungehoert'
                CHECK (status IN ('ungehoert', 'gehoert', 'favorit', 'nochmal')),
    rating      INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    notes       TEXT,
    listened_at TEXT,
    updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Bequemlichkeit fuer Abfragen von Hand: die Hauptliste in Katalogreihenfolge.
CREATE VIEW IF NOT EXISTS v_katalog AS
SELECT r.id,
       l.name  AS label,
       r.catno_raw,
       r.catno_prefix,
       r.catno_num,
       r.artist,
       r.title,
       r.year,
       COALESCE(li.status, 'ungehoert') AS status,
       li.rating,
       li.listened_at,
       (SELECT COUNT(*) FROM videos v WHERE v.release_id = r.id) AS video_count,
       (SELECT COUNT(*) FROM releases x WHERE x.variant_of = r.id) AS variant_count
FROM releases r
LEFT JOIN labels    l  ON l.id = r.label_id
LEFT JOIN listening li ON li.release_id = r.id
WHERE r.is_primary = 1
ORDER BY r.catno_prefix, r.catno_num IS NULL, r.catno_num, r.id;
"""

# Sortierung der Hauptliste. Releases ohne Nummer wandern ans Ende ihrer Gruppe.
ORDER_BY = (
    "r.catno_prefix, r.catno_num IS NULL, r.catno_num, r.catno_raw, r.id"
)


def connect(path: str | Path = DEFAULT_DB, *, read_only: bool = False) -> sqlite3.Connection:
    # check_same_thread=False: FastAPI bedient synchrone Endpunkte aus einem
    # Threadpool und raeumt die Verbindung u. U. in einem anderen Thread ab.
    # Jeder Request bekommt seine eigene Verbindung, parallel schreibt hier
    # niemand -- die Pruefung waere nur im Weg.
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    if not read_only:
        conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    _migrate(conn)
    conn.commit()


def _migrate(conn: sqlite3.Connection) -> None:
    """Nachtraeglich hinzugekommene Spalten ergaenzen (aeltere DB-Dateien)."""
    have = {row["name"] for row in conn.execute("PRAGMA table_info(releases)")}
    for column, ddl in (
        ("is_related", "INTEGER NOT NULL DEFAULT 0"),
        ("related_note", "TEXT"),
        ("spotify_uri", "TEXT"),
        ("spotify_url", "TEXT"),
        ("spotify_checked_at", "TEXT"),
    ):
        if column not in have:
            conn.execute(f"ALTER TABLE releases ADD COLUMN {column} {ddl}")


def get_meta(conn: sqlite3.Connection, key: str) -> Optional[str]:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)),
    )


def counts(conn: sqlite3.Connection) -> dict:
    def scalar(sql: str) -> int:
        return conn.execute(sql).fetchone()[0]

    return {
        "labels": scalar("SELECT COUNT(*) FROM labels"),
        "releases": scalar("SELECT COUNT(*) FROM releases"),
        "primary": scalar("SELECT COUNT(*) FROM releases WHERE is_primary = 1"),
        "variants": scalar("SELECT COUNT(*) FROM releases WHERE is_primary = 0"),
        "detailed": scalar(
            "SELECT COUNT(*) FROM releases WHERE detail_fetched_at IS NOT NULL"
        ),
        "pending": scalar(
            "SELECT COUNT(*) FROM releases WHERE detail_fetched_at IS NULL"
        ),
        "with_videos": scalar(
            "SELECT COUNT(DISTINCT release_id) FROM videos"
        ),
        "tracks": scalar("SELECT COUNT(*) FROM tracks"),
        "videos": scalar("SELECT COUNT(*) FROM videos"),
    }


def pending_detail_ids(conn: sqlite3.Connection, limit: Optional[int] = None) -> Iterable[int]:
    sql = (
        "SELECT id FROM releases WHERE detail_fetched_at IS NULL "
        f"ORDER BY {ORDER_BY.replace('r.', '')}"
    )
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [row["id"] for row in conn.execute(sql)]
