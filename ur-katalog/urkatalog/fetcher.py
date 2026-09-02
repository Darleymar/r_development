"""Die eigentlichen Abholschritte gegen die Discogs-API.

Jeder Schritt ist fuer sich wiederholbar und bricht nichts, was schon da ist.
Der teure Schritt (ein Request pro Release) merkt sich ``detail_fetched_at``
und ueberspringt beim naechsten Lauf alles, was bereits gefuellt ist.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Callable, Iterable, Optional

from . import catno as catno_mod
from . import db as db_mod
from .config import Config
from .discogs import DiscogsClient, DiscogsError


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------- Label ----
def find_label(client: DiscogsClient, name: str, log: Callable[[str], None] = print) -> list[dict]:
    """Label-ID ueber die Suche ermitteln -- nicht raten.

    Gibt die Treffer aus, damit man verifizieren kann, dass es das Detroiter
    Label ist und keine Namensdopplung.
    """
    results = client.search_label(name)
    if not results:
        log(f"Keine Label-Treffer fuer {name!r}.")
        return []

    log(f"Treffer fuer {name!r}:")
    for index, result in enumerate(results, start=1):
        label_id = result.get("id")
        try:
            detail = client.label(label_id)
        except DiscogsError:
            detail = {}
        profile = (detail.get("profile") or "").replace("\n", " ")
        log(
            f"  [{index}] id={label_id}  {result.get('title')}"
            f"  ({len(detail.get('sublabels') or [])} Sublabels)"
        )
        if profile:
            log(f"      {profile[:160]}")
        if detail.get("urls"):
            log(f"      {', '.join(detail['urls'][:2])}")
    return results


def _upsert_label(
    conn: sqlite3.Connection,
    label_id: int,
    name: str,
    is_sublabel: bool,
    parent_id: Optional[int],
) -> None:
    conn.execute(
        """
        INSERT INTO labels (id, name, is_sublabel, parent_id, fetched_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name        = excluded.name,
            is_sublabel = excluded.is_sublabel,
            parent_id   = excluded.parent_id,
            fetched_at  = excluded.fetched_at
        """,
        (label_id, name, 1 if is_sublabel else 0, parent_id, now()),
    )


def sync_labels(
    conn: sqlite3.Connection,
    client: DiscogsClient,
    config: Config,
    log: Callable[[str], None] = print,
) -> list[sqlite3.Row]:
    """Hauptlabel und alle Sublabels (Red Planet, Somewhere In Detroit, ...)."""
    label_id = config.label_id
    if not label_id:
        raise DiscogsError(
            "Keine Label-ID in config.json. Erst 'python fetch.py find-label' "
            "laufen lassen und die ID eintragen."
        )

    data = client.label(label_id)
    _upsert_label(conn, label_id, data.get("name", config.label_name), False, None)
    log(f"Label: {data.get('name')} (id={label_id})")

    sublabels = data.get("sublabels") or []
    if config.get("label", {}).get("include_sublabels", True):
        for sub in sublabels:
            _upsert_label(conn, int(sub["id"]), sub.get("name", ""), True, label_id)
            log(f"  Sublabel: {sub.get('name')} (id={sub['id']})")
    else:
        log("  Sublabels laut config.json ausgeschlossen.")

    conn.commit()
    return conn.execute("SELECT * FROM labels ORDER BY is_sublabel, name").fetchall()


# ------------------------------------------------------------- Releases ----
def _release_artist(item: dict) -> str:
    if item.get("artist"):
        return item["artist"]
    artists = item.get("artists") or []
    parts = []
    for artist in artists:
        name = (artist.get("name") or "").strip()
        # Discogs haengt bei Namensdopplungen "(2)" an.
        name = name.rsplit(" (", 1)[0] if name.endswith(")") and " (" in name else name
        parts.append(name)
        if artist.get("join"):
            parts.append(artist["join"])
    return " ".join(parts).strip() or item.get("artists_sort", "")


def _upsert_release_stub(conn: sqlite3.Connection, label_id: int, item: dict) -> None:
    cat = catno_mod.parse(item.get("catno"))
    formats = item.get("format")
    conn.execute(
        """
        INSERT INTO releases (
            id, label_id, catno_raw, catno_norm, catno_prefix, catno_num,
            artist, title, year, formats_json, thumb_url, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            label_id     = excluded.label_id,
            catno_raw    = excluded.catno_raw,
            catno_norm   = excluded.catno_norm,
            catno_prefix = excluded.catno_prefix,
            catno_num    = excluded.catno_num,
            artist       = COALESCE(NULLIF(excluded.artist, ''), releases.artist),
            title        = COALESCE(NULLIF(excluded.title, ''), releases.title),
            year         = COALESCE(excluded.year, releases.year),
            thumb_url    = COALESCE(NULLIF(excluded.thumb_url, ''), releases.thumb_url),
            fetched_at   = excluded.fetched_at
        """,
        (
            int(item["id"]),
            label_id,
            cat.raw,
            cat.norm,
            cat.prefix,
            cat.num,
            _release_artist(item),
            item.get("title", ""),
            int(item["year"]) if str(item.get("year") or "").isdigit() else None,
            json.dumps(formats) if formats else None,
            item.get("thumb"),
            now(),
        ),
    )


def sync_releases(
    conn: sqlite3.Connection,
    client: DiscogsClient,
    config: Config,
    label_ids: Optional[Iterable[int]] = None,
    log: Callable[[str], None] = print,
) -> int:
    """Releaselisten aller Labels durchpaginieren."""
    if label_ids is None:
        rows = conn.execute("SELECT id, name FROM labels ORDER BY is_sublabel, name")
        labels = [(row["id"], row["name"]) for row in rows]
    else:
        wanted = [int(value) for value in label_ids]
        labels = [
            (row["id"], row["name"])
            for row in conn.execute(
                "SELECT id, name FROM labels WHERE id IN (%s)"
                % ",".join("?" * len(wanted)),
                wanted,
            )
        ]

    if not labels:
        raise DiscogsError("Keine Labels in der DB. Erst 'python fetch.py labels'.")

    total = 0
    for label_id, name in labels:
        log(f"Releases von {name} (id={label_id}):")
        count = skipped = 0
        for item in client.iter_label_releases(label_id):
            # "TrackAppearance" sind Compilations mit einem einzelnen Track --
            # gehoeren nicht in die Katalogliste.
            if (item.get("role") or "Main") != "Main":
                skipped += 1
                continue
            _upsert_release_stub(conn, label_id, item)
            count += 1
        conn.execute(
            "UPDATE labels SET releases_fetched_at = ? WHERE id = ?", (now(), label_id)
        )
        conn.commit()
        note = f", {skipped} Nebenrollen uebersprungen" if skipped else ""
        log(f"  {count} Releases gespeichert{note}.")
        total += count

    db_mod.set_meta(conn, "releases_synced_at", now())
    conn.commit()
    return total


# -------------------------------------------------------------- Details ----
def _store_detail(conn: sqlite3.Connection, release_id: int, data: dict) -> int:
    cat = catno_mod.parse(_detail_catno(data))
    labels = data.get("labels") or []
    label_id = None
    for label in labels:
        row = conn.execute(
            "SELECT id FROM labels WHERE id = ?", (int(label.get("id", 0)),)
        ).fetchone()
        if row:
            label_id = row["id"]
            break

    conn.execute(
        """
        UPDATE releases SET
            catno_raw    = COALESCE(NULLIF(?, ''), catno_raw),
            catno_norm   = CASE WHEN ? <> '' THEN ? ELSE catno_norm END,
            catno_prefix = CASE WHEN ? <> '' THEN ? ELSE catno_prefix END,
            catno_num    = COALESCE(?, catno_num),
            label_id     = COALESCE(?, label_id),
            artist       = COALESCE(NULLIF(?, ''), artist),
            title        = COALESCE(NULLIF(?, ''), title),
            year         = COALESCE(?, year),
            released     = ?,
            country      = ?,
            formats_json = ?,
            genres       = ?,
            styles       = ?,
            notes        = ?,
            discogs_url  = ?,
            thumb_url    = COALESCE(NULLIF(?, ''), thumb_url),
            detail_fetched_at = ?
        WHERE id = ?
        """,
        (
            cat.raw, cat.norm, cat.norm, cat.prefix, cat.prefix, cat.num,
            label_id,
            _release_artist(data),
            data.get("title", ""),
            int(data["year"]) if str(data.get("year") or "").isdigit() else None,
            data.get("released"),
            data.get("country"),
            json.dumps(data.get("formats") or [], ensure_ascii=False),
            json.dumps(data.get("genres") or [], ensure_ascii=False),
            json.dumps(data.get("styles") or [], ensure_ascii=False),
            data.get("notes"),
            data.get("uri") or f"https://www.discogs.com/release/{release_id}",
            (data.get("thumb") or (data.get("images") or [{}])[0].get("thumb") or ""),
            now(),
            release_id,
        ),
    )

    conn.execute("DELETE FROM tracks WHERE release_id = ?", (release_id,))
    seq = 0
    for track in data.get("tracklist") or []:
        # Ueberschriften ("Heading") haben keine Position und keine Dauer.
        if track.get("type_") not in (None, "track"):
            continue
        artists = track.get("artists") or []
        conn.execute(
            "INSERT OR REPLACE INTO tracks (release_id, seq, position, title, duration, artists)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                release_id,
                seq,
                track.get("position"),
                track.get("title"),
                track.get("duration"),
                ", ".join(a.get("name", "") for a in artists) or None,
            ),
        )
        seq += 1

    conn.execute("DELETE FROM videos WHERE release_id = ?", (release_id,))
    videos = data.get("videos") or []
    for index, video in enumerate(videos):
        conn.execute(
            "INSERT OR REPLACE INTO videos (release_id, seq, uri, title, duration)"
            " VALUES (?, ?, ?, ?, ?)",
            (release_id, index, video.get("uri"), video.get("title"), video.get("duration")),
        )
    return len(videos)


def _detail_catno(data: dict) -> str:
    for label in data.get("labels") or []:
        if label.get("catno"):
            return label["catno"]
    return ""


def sync_details(
    conn: sqlite3.Connection,
    client: DiscogsClient,
    config: Config,
    limit: Optional[int] = None,
    refresh: bool = False,
    log: Callable[[str], None] = print,
) -> dict:
    """Der teure Schritt: ein Request pro Release, dafuer mit videos-Array.

    Resumierbar -- bereits gefuellte Releases werden uebersprungen, ein
    Abbruch mit Ctrl-C verliert nur den laufenden Request.
    """
    if refresh:
        sql = "SELECT id FROM releases ORDER BY catno_prefix, catno_num IS NULL, catno_num, id"
        if limit:
            sql += f" LIMIT {int(limit)}"
        ids = [row["id"] for row in conn.execute(sql)]
    else:
        ids = list(db_mod.pending_detail_ids(conn, limit))

    done = conn.execute(
        "SELECT COUNT(*) FROM releases WHERE detail_fetched_at IS NOT NULL"
    ).fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM releases").fetchone()[0]

    if not ids:
        log(f"Nichts zu holen -- alle {total} Releases haben schon Detaildaten.")
        return {"fetched": 0, "videos": 0, "failed": 0}

    log(f"{len(ids)} Releases ohne Detaildaten (von {total} insgesamt).")
    fetched = video_count = failed = 0
    try:
        for index, release_id in enumerate(ids, start=1):
            try:
                data = client.release(release_id)
            except DiscogsError as exc:
                failed += 1
                log(f"  [{index}/{len(ids)}] {release_id}: {exc}")
                continue

            videos = _store_detail(conn, release_id, data)
            conn.commit()  # nach jedem Release -- Abbruch kostet hoechstens einen
            fetched += 1
            video_count += videos
            log(
                f"  [{index}/{len(ids)}] {done + index}/{total} "
                f"{_detail_catno(data) or '?':<10} {data.get('title', '')[:48]:<48} "
                f"{videos} Videos  {client.rate}"
            )
    except KeyboardInterrupt:
        log(
            f"\nAbgebrochen. {fetched} Releases geholt, Fortschritt ist gespeichert -- "
            "einfach nochmal starten."
        )

    db_mod.set_meta(conn, "details_synced_at", now())
    conn.commit()
    return {"fetched": fetched, "videos": video_count, "failed": failed}


# ------------------------------------------------------ Verwandte Releases --
def sync_related(
    conn: sqlite3.Connection,
    client: DiscogsClient,
    config: Config,
    log: Callable[[str], None] = print,
) -> int:
    """Seed-Liste mit Platten, die nicht auf UR erschienen sind (X-101 ff.).

    Eintraege ohne ``release_id`` werden ueber die Discogs-Suche aufgeloest;
    die gefundene ID wird in die Seed-Datei zurueckgeschrieben, damit der
    Suchschritt nur einmal passiert und man sie von Hand korrigieren kann.
    """
    path = config.related_seed_path
    if not path.exists():
        log(f"Keine Seed-Datei unter {path}.")
        return 0

    seeds = json.loads(path.read_text(encoding="utf-8"))
    changed = False
    imported = 0

    for seed in seeds:
        release_id = seed.get("release_id")
        if not release_id:
            query = seed.get("search")
            if not query:
                continue
            log(f"Suche nach {query!r} ...")
            results = client.search_release(query)
            if not results:
                log("  nichts gefunden -- release_id von Hand eintragen.")
                continue
            for result in results[:5]:
                log(f"    id={result.get('id')}  {result.get('title')} "
                    f"({result.get('year')}, {result.get('label', [''])[0] if result.get('label') else ''})")
            release_id = results[0].get("id")
            seed["release_id"] = release_id
            changed = True
            log(f"  uebernommen: id={release_id} (bei Bedarf in {path.name} korrigieren)")

        data = client.release(int(release_id))
        cat = catno_mod.parse(_detail_catno(data))
        conn.execute(
            """
            INSERT INTO releases (id, catno_raw, catno_norm, catno_prefix, catno_num,
                                  artist, title, year, is_related, related_note, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                is_related   = 1,
                related_note = excluded.related_note
            """,
            (
                int(release_id), cat.raw, cat.norm, cat.prefix, cat.num,
                _release_artist(data), data.get("title", ""),
                seed.get("year") or (int(data["year"]) if str(data.get("year") or "").isdigit() else None),
                seed.get("note"), now(),
            ),
        )
        _store_detail(conn, int(release_id), data)
        if seed.get("year"):
            conn.execute(
                "UPDATE releases SET year = ? WHERE id = ?", (seed["year"], int(release_id))
            )
        conn.commit()
        imported += 1
        log(f"  {data.get('title')} ({data.get('year')}) importiert.")

    if changed:
        path.write_text(json.dumps(seeds, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return imported
