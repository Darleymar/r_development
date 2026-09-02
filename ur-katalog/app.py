#!/usr/bin/env python3
"""Lokale Durchhoer-App fuer den UR-Katalog.

    python app.py            # http://127.0.0.1:8000

Serviert eine HTML-Seite plus ein paar JSON-Endpunkte -- ausschliesslich mit
der Python-Standardbibliothek, damit die App auch auf dem Handy (Termux) ohne
pip und ohne Kompilieren laeuft.

Geschrieben wird nur in die Tabelle ``listening``; der Fetcher darf jederzeit
parallel laufen.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import socket
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from urkatalog import api
from urkatalog import config as config_mod
from urkatalog import db as db_mod

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
MAX_BODY = 1 << 20  # 1 MB reicht fuer eine Notiz bei weitem

CONFIG = config_mod.load()
if os.environ.get("URKATALOG_DB"):
    CONFIG.data["db"] = os.environ["URKATALOG_DB"]

RELEASE_PATH = re.compile(r"^/api/releases/(\d+)$")
LISTENING_PATH = re.compile(r"^/api/listening/(\d+)$")


def open_db() -> sqlite3.Connection:
    conn = db_mod.connect(CONFIG.db_path)
    db_mod.init(conn)
    return conn


def single_values(query: str) -> dict:
    """``?a=1&a=2`` -> letzter Wert gewinnt; die Oberflaeche schickt nie Listen."""
    return {key: values[-1] for key, values in parse_qs(query, keep_blank_values=True).items()}


class Handler(BaseHTTPRequestHandler):
    server_version = "URKatalog"
    protocol_version = "HTTP/1.1"

    # -- Antworten -------------------------------------------------------
    def send_payload(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, data, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_payload(status, body, "application/json; charset=utf-8")

    def send_error_json(self, status: int, message: str) -> None:
        self.send_json({"error": message}, status)

    def send_file(self, path: Path) -> None:
        if not path.is_file():
            self.send_error_json(404, "Datei nicht gefunden")
            return
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type.endswith(("javascript", "json")):
            content_type += "; charset=utf-8"
        self.send_payload(200, path.read_bytes(), content_type)

    # -- Routen ----------------------------------------------------------
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path, query = parsed.path, single_values(parsed.query)

        if path in ("/", "/index.html"):
            self.send_file(STATIC / "index.html")
            return

        if path.startswith("/static/"):
            # Kein Ausbrechen aus static/ ueber ".." oder absolute Pfade.
            target = (STATIC / path[len("/static/"):]).resolve()
            if not str(target).startswith(str(STATIC.resolve())):
                self.send_error_json(403, "Verboten")
                return
            self.send_file(target)
            return

        if path == "/favicon.ico":
            self.send_file(STATIC / "favicon.svg")
            return

        if not path.startswith("/api/"):
            self.send_error_json(404, "Unbekannter Pfad")
            return

        conn = open_db()
        try:
            if path == "/api/meta":
                self.send_json(api.meta(conn, CONFIG))
            elif path == "/api/releases":
                self.send_json(api.releases(conn, CONFIG, query))
            elif path == "/api/next-unheard":
                self.send_json(api.next_unheard(conn, CONFIG, query))
            elif path == "/api/stats":
                self.send_json(api.stats(conn, CONFIG, query))
            elif RELEASE_PATH.match(path):
                release_id = int(RELEASE_PATH.match(path).group(1))
                self.send_json(api.release_detail(conn, CONFIG, release_id))
            else:
                self.send_error_json(404, "Unbekannter Endpunkt")
        except api.ApiError as error:
            self.send_error_json(error.status, error.message)
        finally:
            conn.close()

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_PUT(self) -> None:
        match = LISTENING_PATH.match(urlparse(self.path).path)
        if not match:
            self.send_error_json(404, "Unbekannter Endpunkt")
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.send_error_json(413, "Anfrage zu gross")
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            self.send_error_json(400, "Ungueltiges JSON")
            return

        conn = open_db()
        try:
            self.send_json(api.set_listening(conn, int(match.group(1)), payload))
        except api.ApiError as error:
            self.send_error_json(error.status, error.message)
        finally:
            conn.close()

    def log_message(self, fmt: str, *args) -> None:
        # Eine knappe Zeile statt der Standardausgabe mit Zeitstempel.
        print(f"  {self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")


def local_ip() -> str:
    """Die IP im Heimnetz -- praktisch, wenn ein anderes Geraet mitlesen soll."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 80))  # TEST-NET, es fliesst nichts
            return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="UR-Katalog: Oberflaeche starten.")
    parser.add_argument("--host", default="127.0.0.1",
                        help="0.0.0.0, um die App im Heimnetz freizugeben")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--db", help="andere SQLite-Datei als in config.json")
    args = parser.parse_args(argv)

    if args.db:
        CONFIG.data["db"] = args.db

    conn = open_db()
    counts = db_mod.counts(conn)
    conn.close()

    print(f"UR-Katalog  ->  http://127.0.0.1:{args.port}")
    if args.host not in ("127.0.0.1", "localhost"):
        print(f"im Netz     ->  http://{local_ip()}:{args.port}")
    print(f"Datenbank   :   {CONFIG.db_path}")
    print(f"Katalog     :   {counts['primary']} Releases, {counts['with_videos']} mit Video")
    if not counts["releases"]:
        print("Noch keine Daten -- erst './ur fetch' laufen lassen.")
    print("Beenden mit Ctrl-C.\n")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer beendet.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
