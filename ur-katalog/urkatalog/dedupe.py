"""Repressings, Laendervarianten und CD-Ausgaben zusammenfassen.

Die Releaseliste eines Labels enthaelt denselben Titel oft ein Dutzend Mal.
Gruppiert wird nach normalisierter Katalognummer; pro Gruppe wird eine
Hauptversion gewaehlt:

1. das aelteste Jahr,
2. bei Gleichstand ein bevorzugtes Format (Default: Vinyl),
3. dann ein bevorzugtes Land (Default: US),
4. zuletzt die kleinste Discogs-ID, damit das Ergebnis stabil ist.

Die anderen Versionen bleiben erhalten, werden aber ueber ``variant_of`` an
die Hauptversion gehaengt und aus der Hauptliste ausgeblendet.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Iterable, Optional, Sequence

DEFAULT_FORMATS = ("Vinyl",)
DEFAULT_COUNTRIES = ("US",)


def format_names(formats_json: Optional[str]) -> list[str]:
    """Discogs liefert Formate mal als Objektliste, mal als String."""
    if not formats_json:
        return []
    try:
        data = json.loads(formats_json)
    except (TypeError, ValueError):
        return [str(formats_json)]

    names: list[str] = []
    if isinstance(data, str):
        return [data]
    for item in data:
        if isinstance(item, dict):
            if item.get("name"):
                names.append(str(item["name"]))
            for descriptor in item.get("descriptions") or []:
                names.append(str(descriptor))
        else:
            names.append(str(item))
    return names


def _rank(value: Optional[str], preferred: Sequence[str]) -> int:
    """0 fuer den ersten Wunschwert, 1 fuer den zweiten, ... sonst ganz hinten."""
    if not value:
        return len(preferred) + 1
    for index, wanted in enumerate(preferred):
        if wanted.lower() == value.lower():
            return index
    return len(preferred) + 1


def _format_rank(formats_json: Optional[str], preferred: Sequence[str]) -> int:
    names = format_names(formats_json)
    ranks = [_rank(name, preferred) for name in names] or [len(preferred) + 1]
    return min(ranks)


def score(row, prefer_formats: Sequence[str], prefer_countries: Sequence[str]) -> tuple:
    """Kleiner ist besser."""
    year = row["year"] if row["year"] else 9999
    return (
        year,
        _format_rank(row["formats_json"], prefer_formats),
        _rank(row["country"], prefer_countries),
        row["id"],
    )


def choose_primary(
    rows: Iterable,
    prefer_formats: Sequence[str] = DEFAULT_FORMATS,
    prefer_countries: Sequence[str] = DEFAULT_COUNTRIES,
):
    return min(rows, key=lambda row: score(row, prefer_formats, prefer_countries))


def rebuild(
    conn: sqlite3.Connection,
    prefer_formats: Sequence[str] = DEFAULT_FORMATS,
    prefer_countries: Sequence[str] = DEFAULT_COUNTRIES,
) -> dict:
    """Alle Gruppen neu bewerten. Idempotent, jederzeit wiederholbar."""
    rows = conn.execute(
        "SELECT id, catno_norm, label_id, year, country, formats_json "
        "FROM releases WHERE is_related = 0"
    ).fetchall()

    groups: dict[str, list] = {}
    for row in rows:
        # Ohne Katalognummer laesst sich nichts gruppieren -- eigene Gruppe.
        key = row["catno_norm"] or f"#{row['id']}"
        groups.setdefault(key, []).append(row)

    primaries = variants = 0
    for group in groups.values():
        primary = choose_primary(group, prefer_formats, prefer_countries)
        for row in group:
            if row["id"] == primary["id"]:
                conn.execute(
                    "UPDATE releases SET is_primary = 1, variant_of = NULL WHERE id = ?",
                    (row["id"],),
                )
                primaries += 1
            else:
                conn.execute(
                    "UPDATE releases SET is_primary = 0, variant_of = ? WHERE id = ?",
                    (primary["id"], row["id"]),
                )
                variants += 1

    # Seed-Releases (X-101 usw.) stehen immer fuer sich.
    conn.execute(
        "UPDATE releases SET is_primary = 1, variant_of = NULL WHERE is_related = 1"
    )
    conn.commit()
    return {"groups": len(groups), "primary": primaries, "variants": variants}
