"""Optionaler Spotify-Abgleich: ist ein Release streambar?

Nur der Suchteil, und der laeuft mit dem **Client-Credentials-Flow** -- also
ohne User-Login. Das Anlegen von Playlists braeuchte den
Authorization-Code-Flow mit Scope ``playlist-modify-private`` und ist hier
bewusst nicht enthalten; als Ersatz erzeugt ``fetch.py playlist`` eine
M3U-Datei mit den gefundenen Album-URIs in Katalogreihenfolge.
"""

from __future__ import annotations

import base64
import sqlite3
import time
from datetime import datetime, timezone
from typing import Callable, Optional

import requests

TOKEN_URL = "https://accounts.spotify.com/api/token"
SEARCH_URL = "https://api.spotify.com/v1/search"


class SpotifyError(RuntimeError):
    pass


class SpotifyClient:
    """Nur Suche -- Client Credentials, kein User-Kontext."""

    def __init__(self, client_id: str, client_secret: str, market: str = "DE") -> None:
        if not client_id or not client_secret:
            raise SpotifyError(
                "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET fehlen in .env."
            )
        self.client_id = client_id
        self.client_secret = client_secret
        self.market = market
        self.session = requests.Session()
        self._token: Optional[str] = None
        self._expires_at = 0.0

    def _access_token(self) -> str:
        if self._token and time.time() < self._expires_at - 30:
            return self._token
        basic = base64.b64encode(
            f"{self.client_id}:{self.client_secret}".encode()
        ).decode()
        response = self.session.post(
            TOKEN_URL,
            data={"grant_type": "client_credentials"},
            headers={"Authorization": f"Basic {basic}"},
            timeout=30,
        )
        if not response.ok:
            raise SpotifyError(f"Token-Abruf fehlgeschlagen: {response.status_code}")
        payload = response.json()
        self._token = payload["access_token"]
        self._expires_at = time.time() + float(payload.get("expires_in", 3600))
        return self._token

    def find_album(self, artist: str, title: str) -> Optional[dict]:
        query = " ".join(part for part in (artist, title) if part).strip()
        if not query:
            return None
        response = self.session.get(
            SEARCH_URL,
            params={"q": query, "type": "album", "limit": 1, "market": self.market},
            headers={"Authorization": f"Bearer {self._access_token()}"},
            timeout=30,
        )
        if response.status_code == 429:
            time.sleep(float(response.headers.get("Retry-After", 5)))
            return self.find_album(artist, title)
        if not response.ok:
            raise SpotifyError(f"Suche fehlgeschlagen: {response.status_code}")
        items = response.json().get("albums", {}).get("items", [])
        return items[0] if items else None


def sync(
    conn: sqlite3.Connection,
    client: SpotifyClient,
    limit: Optional[int] = None,
    recheck: bool = False,
    log: Callable[[str], None] = print,
) -> dict:
    sql = (
        "SELECT id, artist, title FROM releases WHERE is_primary = 1"
        + ("" if recheck else " AND spotify_checked_at IS NULL")
        + " ORDER BY catno_prefix, catno_num IS NULL, catno_num, id"
    )
    if limit:
        sql += f" LIMIT {int(limit)}"
    rows = conn.execute(sql).fetchall()
    log(f"{len(rows)} Releases zu pruefen.")

    found = 0
    for index, row in enumerate(rows, start=1):
        album = client.find_album(row["artist"] or "", row["title"] or "")
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        conn.execute(
            "UPDATE releases SET spotify_uri = ?, spotify_url = ?, spotify_checked_at = ?"
            " WHERE id = ?",
            (
                album.get("uri") if album else None,
                (album.get("external_urls") or {}).get("spotify") if album else None,
                stamp,
                row["id"],
            ),
        )
        conn.commit()
        if album:
            found += 1
        log(f"  [{index}/{len(rows)}] {row['title'][:50]:<50} "
            f"{'-> ' + album['name'][:30] if album else 'nicht gefunden'}")
    return {"checked": len(rows), "found": found}


def playlist_m3u(conn: sqlite3.Connection) -> str:
    """Katalogreihenfolge als M3U -- Spotify-URIs lassen sich importieren."""
    rows = conn.execute(
        "SELECT catno_raw, artist, title, spotify_url, spotify_uri FROM releases "
        "WHERE is_primary = 1 AND spotify_uri IS NOT NULL "
        "ORDER BY catno_prefix, catno_num IS NULL, catno_num, id"
    ).fetchall()
    lines = ["#EXTM3U"]
    for row in rows:
        lines.append(f"#EXTINF:-1,{row['artist']} - {row['title']} [{row['catno_raw']}]")
        lines.append(row["spotify_url"] or row["spotify_uri"])
    return "\n".join(lines) + "\n"
