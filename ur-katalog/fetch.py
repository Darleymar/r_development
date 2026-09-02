#!/usr/bin/env python3
"""Discogs-Fetcher fuer den UR-Katalog.

Typischer erster Lauf:

    python fetch.py find-label          # Label-ID ermitteln und pruefen
    python fetch.py all                 # Labels, Releaseliste, Details, Dedupe

Danach reicht ``python fetch.py all`` -- alles, was schon Detaildaten hat,
wird uebersprungen. Ein Abbruch mit Ctrl-C ist unkritisch, der naechste Lauf
macht dort weiter.

Die Tabelle ``listening`` fasst dieses Skript nie an.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from urkatalog import config as config_mod
from urkatalog import db as db_mod
from urkatalog import dedupe, fetcher
from urkatalog.discogs import DiscogsClient, DiscogsError

ROOT = Path(__file__).resolve().parent


def build_client(cfg: config_mod.Config) -> DiscogsClient:
    token = config_mod.discogs_token(ROOT / ".env")
    return DiscogsClient(token or "", cfg.user_agent)


def open_db(cfg: config_mod.Config):
    conn = db_mod.connect(cfg.db_path)
    db_mod.init(conn)
    return conn


# ------------------------------------------------------------- Befehle -----
def cmd_find_label(args, cfg):
    client = build_client(cfg)
    name = args.name or cfg.label_name
    results = fetcher.find_label(client, name)
    if not results:
        return 1
    print(
        "\nPruefen, ob das das Detroiter Label ist (Profil / URLs oben), dann "
        "die ID eintragen:"
    )
    if args.pick:
        chosen = next((r for r in results if int(r["id"]) == args.pick), None)
        if not chosen:
            print(f"  id={args.pick} war nicht unter den Treffern -- trotzdem uebernommen.")
        cfg.set_label_id(args.pick, chosen.get("title") if chosen else None)
        print(f"  config.json: label.id = {args.pick}")
    else:
        print(f"  python fetch.py find-label --pick <ID>")
        print(f"  oder label.id von Hand in {cfg.path.name} setzen")
    return 0


def cmd_labels(args, cfg):
    conn = open_db(cfg)
    rows = fetcher.sync_labels(conn, build_client(cfg), cfg)
    print(f"\n{len(rows)} Labels in der DB.")
    return 0


def cmd_releases(args, cfg):
    conn = open_db(cfg)
    total = fetcher.sync_releases(conn, build_client(cfg), cfg, args.label)
    print(f"\n{total} Releases gesamt.")
    return 0


def cmd_details(args, cfg):
    conn = open_db(cfg)
    result = fetcher.sync_details(
        conn, build_client(cfg), cfg, limit=args.limit, refresh=args.refresh
    )
    print(
        f"\n{result['fetched']} Releases geholt, {result['videos']} Videos gefunden"
        + (f", {result['failed']} Fehler" if result["failed"] else "")
    )
    return 0


def cmd_dedupe(args, cfg):
    conn = open_db(cfg)
    settings = cfg.get("dedupe", {})
    result = dedupe.rebuild(
        conn,
        settings.get("prefer_formats", dedupe.DEFAULT_FORMATS),
        settings.get("prefer_countries", dedupe.DEFAULT_COUNTRIES),
    )
    print(
        f"{result['groups']} Katalognummern, {result['primary']} Hauptversionen, "
        f"{result['variants']} Varianten."
    )
    return 0


def cmd_related(args, cfg):
    conn = open_db(cfg)
    count = fetcher.sync_related(conn, build_client(cfg), cfg)
    print(f"{count} verwandte Releases importiert.")
    return 0


def cmd_spotify(args, cfg):
    from urkatalog import spotify as spotify_mod

    conn = open_db(cfg)
    if args.playlist:
        target = Path(args.playlist)
        target.write_text(spotify_mod.playlist_m3u(conn), encoding="utf-8")
        print(f"Playlist geschrieben: {target}")
        return 0

    client_id, client_secret = config_mod.spotify_credentials(ROOT / ".env")
    client = spotify_mod.SpotifyClient(client_id or "", client_secret or "", args.market)
    result = spotify_mod.sync(conn, client, limit=args.limit, recheck=args.recheck)
    print(f"\n{result['found']} von {result['checked']} Releases auf Spotify gefunden.")
    return 0


def cmd_all(args, cfg):
    conn = open_db(cfg)
    client = build_client(cfg)
    print("== Labels ==")
    fetcher.sync_labels(conn, client, cfg)
    print("\n== Releaselisten ==")
    fetcher.sync_releases(conn, client, cfg)
    print("\n== Details ==")
    fetcher.sync_details(conn, client, cfg, limit=args.limit)
    if cfg.related_seed_path.exists() and not args.no_related:
        print("\n== Verwandte Releases ==")
        try:
            fetcher.sync_related(conn, client, cfg)
        except DiscogsError as exc:
            print(f"  uebersprungen: {exc}")
    print("\n== Dublettenerkennung ==")
    cmd_dedupe(args, cfg)
    print()
    return cmd_stats(args, cfg)


def cmd_stats(args, cfg):
    conn = open_db(cfg)
    counts = db_mod.counts(conn)
    print("Datenbank:", cfg.db_path)
    for key, value in counts.items():
        print(f"  {key:<12} {value}")

    rows = conn.execute(
        "SELECT COALESCE(li.status, 'ungehoert') AS status, COUNT(*) AS n "
        "FROM releases r LEFT JOIN listening li ON li.release_id = r.id "
        "WHERE r.is_primary = 1 GROUP BY 1 ORDER BY 2 DESC"
    ).fetchall()
    print("  Hoerstatus:")
    for row in rows:
        print(f"    {row['status']:<12} {row['n']}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Discogs-Katalog von Underground Resistance in SQLite ziehen.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    # Beide Optionen gelten vor *und* nach dem Unterbefehl -- auf dem Handy
    # tippt niemand gern zweimal, weil die Reihenfolge nicht stimmte.
    # SUPPRESS: fehlt die Option beim Unterbefehl, bleibt der globale Wert stehen.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--config", default=argparse.SUPPRESS)
    common.add_argument("--db", default=argparse.SUPPRESS,
                        help="ueberschreibt db aus config.json")

    parser.add_argument("--config", default=str(config_mod.DEFAULT_CONFIG))
    parser.add_argument("--db", help="ueberschreibt db aus config.json")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("find-label", parents=[common], help="Label-ID ueber die Suche ermitteln")
    p.add_argument("--name", help="Suchbegriff (Default: label.name aus config.json)")
    p.add_argument("--pick", type=int, help="gefundene ID direkt in config.json schreiben")
    p.set_defaults(func=cmd_find_label)

    p = sub.add_parser("labels", parents=[common], help="Label und Sublabels speichern")
    p.set_defaults(func=cmd_labels)

    p = sub.add_parser("releases", parents=[common], help="Releaselisten je Label durchpaginieren")
    p.add_argument("--label", type=int, nargs="*", help="nur diese Label-IDs")
    p.set_defaults(func=cmd_releases)

    p = sub.add_parser("details", parents=[common], help="Detaildaten inkl. videos-Array (resumierbar)")
    p.add_argument("--limit", type=int, help="nur N Releases in diesem Lauf")
    p.add_argument("--refresh", action="store_true", help="auch bereits geholte erneut")
    p.set_defaults(func=cmd_details)

    p = sub.add_parser("dedupe", parents=[common], help="Hauptversion je Katalognummer neu bestimmen")
    p.set_defaults(func=cmd_dedupe)

    p = sub.add_parser("related", parents=[common], help="Seed-Liste verwandter Releases (X-101 ff.)")
    p.set_defaults(func=cmd_related)

    p = sub.add_parser("spotify", parents=[common], help="optionaler Spotify-Abgleich (nur Suche)")
    p.add_argument("--limit", type=int)
    p.add_argument("--market", default="DE")
    p.add_argument("--recheck", action="store_true", help="auch bereits geprueffte erneut pruefen")
    p.add_argument("--playlist", help="M3U in Katalogreihenfolge schreiben")
    p.set_defaults(func=cmd_spotify)

    p = sub.add_parser("all", parents=[common], help="labels + releases + details + dedupe")
    p.add_argument("--limit", type=int, help="Detailschritt begrenzen")
    p.add_argument("--no-related", action="store_true")
    p.set_defaults(func=cmd_all)

    p = sub.add_parser("stats", parents=[common], help="Zaehlstand ausgeben")
    p.set_defaults(func=cmd_stats)

    args = parser.parse_args(argv)
    cfg = config_mod.load(args.config)
    if args.db:
        cfg.data["db"] = args.db

    try:
        return args.func(args, cfg)
    except DiscogsError as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nAbgebrochen.", file=sys.stderr)
        return 130
    except BrokenPipeError:
        # z. B. 'fetch.py stats | head' -- kein Grund fuer einen Traceback.
        try:
            sys.stdout.close()
        finally:
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
