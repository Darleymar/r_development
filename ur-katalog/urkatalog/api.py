"""Die Abfragen hinter der Oberflaeche -- reines Python, kein Webframework.

``app.py`` ist nur noch HTTP-Verkabelung um diese Funktionen herum. Jede
Funktion nimmt eine SQLite-Verbindung und die Konfiguration entgegen und gibt
JSON-faehige Dicts zurueck.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Optional

from . import db as db_mod
from . import matching
from .config import Config
from .dedupe import format_names

SORTS = ("catno", "label", "year")


class ApiError(Exception):
    """Fehler, der als HTTP-Status beim Client landet."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _json_list(value: Optional[str]) -> list:
    if not value:
        return []
    try:
        data = json.loads(value)
    except (TypeError, ValueError):
        return [value]
    return data if isinstance(data, list) else [data]


def _as_int(value, default=None, field="Wert"):
    if value in (None, ""):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ApiError(400, f"{field} muss eine Zahl sein, nicht {value!r}")


def _as_bool(value, default=False) -> bool:
    if value in (None, ""):
        return default
    return str(value).lower() in ("1", "true", "yes", "on")


# ---------------------------------------------------------------- Filter ---
class Filters:
    """Die Filterleiste der Oberflaeche als WHERE-Klausel."""

    def __init__(self, query: dict, config: Config):
        self.label_id = _as_int(query.get("label_id"), field="label_id")
        self.year_from = _as_int(query.get("year_from"), field="year_from")
        self.year_to = _as_int(query.get("year_to"), field="year_to")
        self.status = [s for s in (query.get("status") or "").split(",") if s]
        self.has_video = _as_bool(query.get("has_video"))
        self.q = (query.get("q") or "").strip()
        self.era = query.get("era") or None
        self.include_related = _as_bool(query.get("include_related"), True)
        self.sort = query.get("sort") or "catno"

        unbekannt = [s for s in self.status if s not in db_mod.STATUSES]
        if unbekannt:
            raise ApiError(400, f"Unbekannter Status: {', '.join(unbekannt)}")
        if self.sort not in SORTS:
            raise ApiError(400, f"Unbekannte Sortierung: {self.sort}")

        if self.era:
            found = next((e for e in config.eras if e["id"] == self.era), None)
            if found:
                self.year_from = max(self.year_from or 0, found.get("from") or 0) or None
                if found.get("to"):
                    self.year_to = min(self.year_to or 9999, found["to"])

    def where(self) -> tuple[str, list]:
        clauses = ["r.is_primary = 1"]
        params: list = []

        if not self.include_related:
            clauses.append("r.is_related = 0")
        if self.label_id:
            # Sublabel-Auswahl schliesst dessen eigene Sublabels mit ein.
            clauses.append(
                "(r.label_id = ? OR r.label_id IN "
                "(SELECT id FROM labels WHERE parent_id = ?))"
            )
            params += [self.label_id, self.label_id]
        if self.year_from:
            clauses.append("r.year >= ?")
            params.append(self.year_from)
        if self.year_to:
            clauses.append("r.year <= ?")
            params.append(self.year_to)
        if self.status:
            placeholders = ",".join("?" * len(self.status))
            clauses.append(f"COALESCE(li.status, 'ungehoert') IN ({placeholders})")
            params += self.status
        if self.has_video:
            clauses.append("EXISTS (SELECT 1 FROM videos v WHERE v.release_id = r.id)")
        if self.q:
            like = f"%{self.q}%"
            clauses.append(
                "(r.artist LIKE ? OR r.title LIKE ? OR r.catno_raw LIKE ? OR EXISTS "
                "(SELECT 1 FROM tracks t WHERE t.release_id = r.id AND t.title LIKE ?))"
            )
            params += [like, like, like, like]

        return " AND ".join(clauses), params

    def order_by(self) -> str:
        if self.sort == "year":
            return "r.year IS NULL, r.year, r.catno_prefix, r.catno_num"
        if self.sort == "label":
            return "l.name, " + db_mod.ORDER_BY
        return db_mod.ORDER_BY


LIST_SQL = """
SELECT r.id, r.label_id, l.name AS label, r.catno_raw, r.catno_prefix, r.catno_num,
       r.artist, r.title, r.year, r.country, r.is_related, r.related_note,
       r.spotify_uri, r.spotify_url,
       COALESCE(li.status, 'ungehoert') AS status, li.rating, li.listened_at,
       CASE WHEN COALESCE(li.notes, '') <> '' THEN 1 ELSE 0 END AS has_notes,
       (SELECT COUNT(*) FROM videos v  WHERE v.release_id = r.id) AS video_count,
       (SELECT COUNT(*) FROM releases x WHERE x.variant_of = r.id) AS variant_count,
       r.detail_fetched_at
FROM releases r
LEFT JOIN labels l     ON l.id = r.label_id
LEFT JOIN listening li ON li.release_id = r.id
WHERE {where}
ORDER BY {order}
"""

COUNT_SQL = (
    "SELECT COUNT(*) FROM releases r LEFT JOIN labels l ON l.id = r.label_id "
    "LEFT JOIN listening li ON li.release_id = r.id WHERE {where}"
)


def _row_to_item(row: sqlite3.Row, config: Config) -> dict:
    era = config.era_for(row["year"])
    item = dict(row)
    item["era"] = era["id"] if era else None
    item["era_label"] = era["label"] if era else "Ohne Jahr"
    return item


# ------------------------------------------------------------ Endpunkte ----
def meta(conn: sqlite3.Connection, config: Config) -> dict:
    labels = [
        dict(row)
        for row in conn.execute(
            "SELECT l.id, l.name, l.is_sublabel, l.parent_id, "
            "(SELECT COUNT(*) FROM releases r WHERE r.label_id = l.id AND r.is_primary = 1)"
            " AS count FROM labels l ORDER BY l.is_sublabel, l.name"
        )
    ]
    years = conn.execute(
        "SELECT MIN(year) AS min_year, MAX(year) AS max_year FROM releases "
        "WHERE year IS NOT NULL AND year > 0"
    ).fetchone()
    return {
        "labels": labels,
        "eras": config.eras,
        "statuses": list(db_mod.STATUSES),
        "years": {"min": years["min_year"], "max": years["max_year"]},
        "counts": db_mod.counts(conn),
        "db": str(config.db_path),
    }


def releases(conn: sqlite3.Connection, config: Config, query: dict) -> dict:
    filters = Filters(query, config)
    limit = min(_as_int(query.get("limit"), 2000, "limit"), 10000)
    offset = max(_as_int(query.get("offset"), 0, "offset"), 0)

    where, params = filters.where()
    sql = LIST_SQL.format(where=where, order=filters.order_by()) + " LIMIT ? OFFSET ?"
    rows = conn.execute(sql, params + [limit, offset]).fetchall()
    total = conn.execute(COUNT_SQL.format(where=where), params).fetchone()[0]
    return {"total": total, "items": [_row_to_item(row, config) for row in rows]}


def release_detail(conn: sqlite3.Connection, config: Config, release_id: int) -> dict:
    row = conn.execute(
        "SELECT r.*, l.name AS label, COALESCE(li.status, 'ungehoert') AS status, "
        "li.rating, li.notes AS listening_notes, li.listened_at "
        "FROM releases r LEFT JOIN labels l ON l.id = r.label_id "
        "LEFT JOIN listening li ON li.release_id = r.id WHERE r.id = ?",
        (release_id,),
    ).fetchone()
    if not row:
        raise ApiError(404, "Release unbekannt")

    tracks = [
        dict(t)
        for t in conn.execute(
            "SELECT seq, position, title, duration, artists FROM tracks "
            "WHERE release_id = ? ORDER BY seq",
            (release_id,),
        )
    ]
    videos = [
        dict(v)
        for v in conn.execute(
            "SELECT seq, uri, title, duration FROM videos WHERE release_id = ? ORDER BY seq",
            (release_id,),
        )
    ]
    for video in videos:
        video["youtube_id"] = matching.youtube_id(video["uri"])

    matched, leftover = matching.match(
        tracks, videos, row["artist"], config.get("video_match_threshold", 0.72)
    )
    for index, track in enumerate(tracks):
        track["video"] = matched.get(index)

    variants = [
        dict(v)
        for v in conn.execute(
            "SELECT id, catno_raw, year, country, formats_json, discogs_url "
            "FROM releases WHERE variant_of = ? ORDER BY year IS NULL, year, id",
            (release_id,),
        )
    ]
    for variant in variants:
        variant["formats"] = format_names(variant.pop("formats_json"))

    era = config.era_for(row["year"])
    return {
        "id": row["id"],
        "label": row["label"],
        "label_id": row["label_id"],
        "catno_raw": row["catno_raw"],
        "artist": row["artist"],
        "title": row["title"],
        "year": row["year"],
        "released": row["released"],
        "country": row["country"],
        "formats": format_names(row["formats_json"]),
        "genres": _json_list(row["genres"]),
        "styles": _json_list(row["styles"]),
        "notes": row["notes"],
        "discogs_url": row["discogs_url"] or f"https://www.discogs.com/release/{row['id']}",
        "thumb_url": row["thumb_url"],
        "is_related": row["is_related"],
        "related_note": row["related_note"],
        "spotify_url": row["spotify_url"],
        "era": era["id"] if era else None,
        "era_label": era["label"] if era else "Ohne Jahr",
        "detail_fetched_at": row["detail_fetched_at"],
        "tracks": tracks,
        "videos": videos,
        "unmatched_videos": leftover,
        "variants": variants,
        "listening": {
            "status": row["status"],
            "rating": row["rating"],
            "notes": row["listening_notes"] or "",
            "listened_at": row["listened_at"],
        },
    }


def next_unheard(conn: sqlite3.Connection, config: Config, query: dict) -> dict:
    """Der Hauptknopf: das naechste Release mit Status ``ungehoert``.

    ``after`` ist die Position, an der man gerade steht -- gesucht wird das
    naechste ungehoerte *danach*, am Ende der Liste wird umgebrochen. Das
    Release unter ``after`` muss selbst nicht ungehoert sein.
    """
    filters = Filters(query, config)
    after = _as_int(query.get("after"), field="after")

    where, params = filters.where()
    rows = conn.execute(
        LIST_SQL.format(where=where, order=filters.order_by()), params
    ).fetchall()

    open_positions = [
        index for index, row in enumerate(rows) if row["status"] == "ungehoert"
    ]
    if not open_positions:
        return {"id": None, "remaining": 0, "item": None}

    start = -1
    if after is not None:
        ids = [row["id"] for row in rows]
        if after in ids:
            start = ids.index(after)

    position = next((index for index in open_positions if index > start), open_positions[0])
    chosen = rows[position]
    return {
        "id": chosen["id"],
        "remaining": len(open_positions),
        "item": _row_to_item(chosen, config),
    }


def stats(conn: sqlite3.Connection, config: Config, query: dict) -> dict:
    filters = Filters(query, config)
    where, params = filters.where()
    rows = conn.execute(
        "SELECT r.year, COALESCE(li.status, 'ungehoert') AS status "
        "FROM releases r LEFT JOIN labels l ON l.id = r.label_id "
        f"LEFT JOIN listening li ON li.release_id = r.id WHERE {where}",
        params,
    ).fetchall()

    by_status = {status: 0 for status in db_mod.STATUSES}
    buckets = {
        era["id"]: {"id": era["id"], "label": era["label"], "total": 0, "heard": 0}
        for era in config.eras
    }
    buckets["_none"] = {"id": None, "label": "Ohne Jahr", "total": 0, "heard": 0}

    heard = 0
    for row in rows:
        status = row["status"]
        by_status[status] = by_status.get(status, 0) + 1
        era = config.era_for(row["year"])
        bucket = buckets[era["id"]] if era else buckets["_none"]
        bucket["total"] += 1
        if status != "ungehoert":
            heard += 1
            bucket["heard"] += 1

    return {
        "total": len(rows),
        "heard": heard,
        "by_status": by_status,
        "by_era": [bucket for bucket in buckets.values() if bucket["total"]],
    }


def set_listening(conn: sqlite3.Connection, release_id: int, payload: dict) -> dict:
    """Der einzige schreibende Pfad der App."""
    if not isinstance(payload, dict):
        raise ApiError(400, "Erwartet wird ein JSON-Objekt")

    status = payload.get("status")
    if status is not None and status not in db_mod.STATUSES:
        raise ApiError(422, f"Status muss einer von {', '.join(db_mod.STATUSES)} sein")

    rating = payload.get("rating")
    if rating is not None:
        rating = _as_int(rating, field="rating")
        if not 1 <= rating <= 5:
            raise ApiError(422, "Bewertung muss zwischen 1 und 5 liegen")

    notes = payload.get("notes")
    if notes is not None and not isinstance(notes, str):
        raise ApiError(422, "Notiz muss Text sein")

    if not conn.execute("SELECT 1 FROM releases WHERE id = ?", (release_id,)).fetchone():
        raise ApiError(404, "Release unbekannt")

    conn.execute(
        "INSERT OR IGNORE INTO listening (release_id, status) VALUES (?, 'ungehoert')",
        (release_id,),
    )
    sets, params = [], []
    if status is not None:
        sets.append("status = ?")
        params.append(status)
        # Zeitstempel nur beim Wechsel weg von 'ungehoert'.
        if status == "ungehoert":
            sets.append("listened_at = NULL")
        else:
            sets.append("listened_at = COALESCE(listened_at, ?)")
            params.append(now())
    if payload.get("clear_rating"):
        sets.append("rating = NULL")
    elif rating is not None:
        sets.append("rating = ?")
        params.append(rating)
    if notes is not None:
        sets.append("notes = ?")
        params.append(notes)

    sets.append("updated_at = ?")
    params += [now(), release_id]
    conn.execute(f"UPDATE listening SET {', '.join(sets)} WHERE release_id = ?", params)
    conn.commit()

    row = conn.execute(
        "SELECT status, rating, notes, listened_at FROM listening WHERE release_id = ?",
        (release_id,),
    ).fetchone()
    return dict(row)
