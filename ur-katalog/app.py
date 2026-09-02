#!/usr/bin/env python3
"""Lokale Durchhoer-App fuer den UR-Katalog.

    python app.py            # http://127.0.0.1:8000

Serviert eine einzelne HTML-Seite plus ein paar JSON-Endpunkte. Schreibt
ausschliesslich in die Tabelle ``listening`` -- der Fetcher darf jederzeit
parallel laufen.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from urkatalog import config as config_mod
from urkatalog import db as db_mod
from urkatalog import matching
from urkatalog.dedupe import format_names

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"

CONFIG = config_mod.load()
if os.environ.get("URKATALOG_DB"):
    CONFIG.data["db"] = os.environ["URKATALOG_DB"]

app = FastAPI(title="UR-Katalog", docs_url="/api/docs", redoc_url=None)


def get_conn() -> sqlite3.Connection:
    conn = db_mod.connect(CONFIG.db_path)
    db_mod.init(conn)
    try:
        yield conn
    finally:
        conn.close()


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


# ------------------------------------------------------------- Filter ------
class Filters:
    """Die Filterleiste der Oberflaeche als WHERE-Klausel."""

    def __init__(
        self,
        label_id: Optional[int] = Query(None, description="Label oder Sublabel"),
        year_from: Optional[int] = Query(None),
        year_to: Optional[int] = Query(None),
        status: Optional[str] = Query(None, description="Komma-getrennt moeglich"),
        has_video: bool = Query(False),
        q: Optional[str] = Query(None, description="Artist, Titel oder Tracktitel"),
        era: Optional[str] = Query(None),
        include_related: bool = Query(True),
        sort: str = Query("catno", pattern="^(catno|label|year)$"),
    ) -> None:
        self.label_id = label_id
        self.year_from = year_from
        self.year_to = year_to
        self.status = [s for s in (status or "").split(",") if s]
        self.has_video = has_video
        self.q = (q or "").strip()
        self.era = era
        self.include_related = include_related
        self.sort = sort

        if self.era:
            found = next((e for e in CONFIG.eras if e["id"] == self.era), None)
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


def _row_to_item(row: sqlite3.Row) -> dict:
    era = CONFIG.era_for(row["year"])
    item = dict(row)
    item["era"] = era["id"] if era else None
    item["era_label"] = era["label"] if era else "Ohne Jahr"
    return item


# ------------------------------------------------------------ Endpunkte ----
@app.get("/api/meta")
def meta(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    labels = [
        dict(row)
        for row in conn.execute(
            "SELECT l.id, l.name, l.is_sublabel, l.parent_id, "
            "(SELECT COUNT(*) FROM releases r WHERE r.label_id = l.id AND r.is_primary = 1) AS count "
            "FROM labels l ORDER BY l.is_sublabel, l.name"
        )
    ]
    years = conn.execute(
        "SELECT MIN(year) AS min_year, MAX(year) AS max_year FROM releases "
        "WHERE year IS NOT NULL AND year > 0"
    ).fetchone()
    return {
        "labels": labels,
        "eras": CONFIG.eras,
        "statuses": list(db_mod.STATUSES),
        "years": {"min": years["min_year"], "max": years["max_year"]},
        "counts": db_mod.counts(conn),
        "db": str(CONFIG.db_path),
    }


@app.get("/api/releases")
def releases(
    filters: Filters = Depends(),
    limit: int = Query(2000, le=10000),
    offset: int = Query(0, ge=0),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    where, params = filters.where()
    sql = LIST_SQL.format(where=where, order=filters.order_by()) + " LIMIT ? OFFSET ?"
    rows = conn.execute(sql, params + [limit, offset]).fetchall()
    total = conn.execute(
        "SELECT COUNT(*) FROM releases r LEFT JOIN labels l ON l.id = r.label_id "
        f"LEFT JOIN listening li ON li.release_id = r.id WHERE {where}",
        params,
    ).fetchone()[0]
    return {"total": total, "items": [_row_to_item(row) for row in rows]}


@app.get("/api/releases/{release_id}")
def release_detail(
    release_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> dict:
    row = conn.execute(
        "SELECT r.*, l.name AS label, COALESCE(li.status, 'ungehoert') AS status, "
        "li.rating, li.notes AS listening_notes, li.listened_at "
        "FROM releases r LEFT JOIN labels l ON l.id = r.label_id "
        "LEFT JOIN listening li ON li.release_id = r.id WHERE r.id = ?",
        (release_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Release unbekannt")

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
        tracks, videos, row["artist"], CONFIG.get("video_match_threshold", 0.72)
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

    era = CONFIG.era_for(row["year"])
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
        "discogs_url": row["discogs_url"]
        or f"https://www.discogs.com/release/{row['id']}",
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


@app.get("/api/next-unheard")
def next_unheard(
    filters: Filters = Depends(),
    after: Optional[int] = Query(None, description="ab hier weitersuchen"),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    """Der Hauptknopf: das naechste Release mit Status ``ungehoert``.

    ``after`` ist die Position, an der man gerade steht -- gesucht wird das
    naechste ungehoerte *danach*, am Ende der Liste wird umgebrochen. Das
    Release unter ``after`` muss selbst nicht ungehoert sein.
    """
    where, params = filters.where()
    sql = LIST_SQL.format(where=where, order=filters.order_by())
    rows = conn.execute(sql, params).fetchall()

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

    position = next(
        (index for index in open_positions if index > start), open_positions[0]
    )
    chosen = rows[position]
    return {
        "id": chosen["id"],
        "remaining": len(open_positions),
        "item": _row_to_item(chosen),
    }


@app.get("/api/stats")
def stats(
    filters: Filters = Depends(), conn: sqlite3.Connection = Depends(get_conn)
) -> dict:
    where, params = filters.where()
    rows = conn.execute(
        "SELECT r.year, COALESCE(li.status, 'ungehoert') AS status "
        "FROM releases r LEFT JOIN labels l ON l.id = r.label_id "
        f"LEFT JOIN listening li ON li.release_id = r.id WHERE {where}",
        params,
    ).fetchall()

    by_status: dict[str, int] = {status: 0 for status in db_mod.STATUSES}
    buckets = {
        era["id"]: {"id": era["id"], "label": era["label"], "total": 0, "heard": 0}
        for era in CONFIG.eras
    }
    buckets["_none"] = {"id": None, "label": "Ohne Jahr", "total": 0, "heard": 0}

    heard = 0
    for row in rows:
        status = row["status"]
        by_status[status] = by_status.get(status, 0) + 1
        era = CONFIG.era_for(row["year"])
        bucket = buckets[era["id"]] if era else buckets["_none"]
        bucket["total"] += 1
        if status != "ungehoert":
            heard += 1
            bucket["heard"] += 1

    return {
        "total": len(rows),
        "heard": heard,
        "by_status": by_status,
        "by_era": [b for b in buckets.values() if b["total"]],
    }


class ListeningUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern="^(ungehoert|gehoert|favorit|nochmal)$")
    rating: Optional[int] = Field(None, ge=1, le=5)
    notes: Optional[str] = None
    clear_rating: bool = False


@app.put("/api/listening/{release_id}")
def set_listening(
    release_id: int,
    payload: ListeningUpdate,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    exists = conn.execute("SELECT 1 FROM releases WHERE id = ?", (release_id,)).fetchone()
    if not exists:
        raise HTTPException(404, "Release unbekannt")

    conn.execute(
        "INSERT OR IGNORE INTO listening (release_id, status) VALUES (?, 'ungehoert')",
        (release_id,),
    )
    sets, params = [], []
    if payload.status is not None:
        sets.append("status = ?")
        params.append(payload.status)
        # Zeitstempel nur beim Wechsel weg von 'ungehoert'.
        if payload.status == "ungehoert":
            sets.append("listened_at = NULL")
        else:
            sets.append("listened_at = COALESCE(listened_at, ?)")
            params.append(now())
    if payload.clear_rating:
        sets.append("rating = NULL")
    elif payload.rating is not None:
        sets.append("rating = ?")
        params.append(payload.rating)
    if payload.notes is not None:
        sets.append("notes = ?")
        params.append(payload.notes)

    sets.append("updated_at = ?")
    params.append(now())
    params.append(release_id)
    conn.execute(f"UPDATE listening SET {', '.join(sets)} WHERE release_id = ?", params)
    conn.commit()

    row = conn.execute(
        "SELECT status, rating, notes, listened_at FROM listening WHERE release_id = ?",
        (release_id,),
    ).fetchone()
    return dict(row)


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


if __name__ == "__main__":
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--db", help="andere SQLite-Datei als in config.json")
    args = parser.parse_args()

    if args.db:
        # Auch fuer den Reload-Worker sichtbar, der das Modul neu importiert.
        os.environ["URKATALOG_DB"] = args.db
        CONFIG.data["db"] = args.db

    print(f"UR-Katalog: http://{args.host}:{args.port}  (DB: {CONFIG.db_path})")
    uvicorn.run("app:app" if args.reload else app, host=args.host, port=args.port,
                reload=args.reload)
