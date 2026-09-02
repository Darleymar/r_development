"""Discogs-API-Client mit dynamischer Drosselung.

Zwei Dinge, die Discogs erzwingt:

* ein eigener ``User-Agent`` -- ohne den kommt 403 zurueck,
* das Rate Limit von 60 Requests/Minute (mit Token).

Statt blind ``sleep(1)`` wird ``X-Discogs-Ratelimit-Remaining`` ausgewertet:
solange genug Budget im laufenden Fenster ist, laeuft der Fetcher mit voller
Geschwindigkeit; wird es knapp, streckt er die Requests ueber den Rest des
Fensters.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Iterator, Optional

import requests

BASE_URL = "https://api.discogs.com"
WINDOW_SECONDS = 60.0

# Ab diesem Restbudget im Fenster wird gedrosselt.
THROTTLE_BELOW = 20
MAX_SLEEP = 10.0
MAX_RETRIES = 5


class DiscogsError(RuntimeError):
    pass


class RateLimitState:
    """Merkt sich die Rate-Limit-Header der letzten Antwort."""

    def __init__(self) -> None:
        self.limit: Optional[int] = None
        self.remaining: Optional[int] = None
        self.used: Optional[int] = None

    def update(self, headers) -> None:
        def as_int(name: str) -> Optional[int]:
            value = headers.get(name)
            try:
                return int(value) if value is not None else None
            except ValueError:
                return None

        self.limit = as_int("X-Discogs-Ratelimit") or self.limit
        self.remaining = as_int("X-Discogs-Ratelimit-Remaining")
        self.used = as_int("X-Discogs-Ratelimit-Used")

    def sleep_seconds(self) -> float:
        """Wie lange vor dem naechsten Request gewartet werden soll."""
        if self.remaining is None:
            # Keine Header gesehen -- konservativ am Limit entlang.
            return WINDOW_SECONDS / 60.0
        if self.remaining > THROTTLE_BELOW:
            return 0.0
        # Restliche Requests ueber den Rest des Fensters verteilen.
        return min(WINDOW_SECONDS / max(self.remaining, 1), MAX_SLEEP)

    def __str__(self) -> str:
        if self.remaining is None:
            return "rate limit: unbekannt"
        return f"rate limit: {self.remaining}/{self.limit or '?'} frei"


class DiscogsClient:
    def __init__(
        self,
        token: str,
        user_agent: str,
        *,
        base_url: str = BASE_URL,
        session: Optional[requests.Session] = None,
        sleep: Callable[[float], None] = time.sleep,
        log: Callable[[str], None] = print,
    ) -> None:
        if not token:
            raise DiscogsError(
                "Kein Discogs-Token. Lege .env an (siehe .env.example) und "
                "trage DISCOGS_TOKEN ein."
            )
        if not user_agent:
            raise DiscogsError("Discogs verlangt einen eigenen User-Agent.")

        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Discogs token={token}",
                "User-Agent": user_agent,
                "Accept": "application/vnd.discogs.v2+json",
            }
        )
        self.rate = RateLimitState()
        self._sleep = sleep
        self._log = log
        self.request_count = 0

    # -- HTTP ------------------------------------------------------------
    def get(self, path: str, params: Optional[dict] = None) -> dict:
        url = path if path.startswith("http") else f"{self.base_url}/{path.lstrip('/')}"

        for attempt in range(1, MAX_RETRIES + 1):
            wait = self.rate.sleep_seconds()
            if wait:
                self._sleep(wait)

            try:
                response = self.session.get(url, params=params, timeout=30)
            except requests.RequestException as exc:
                if attempt == MAX_RETRIES:
                    raise DiscogsError(f"Netzwerkfehler bei {url}: {exc}") from exc
                backoff = 2**attempt
                self._log(f"  Netzwerkfehler ({exc}), neuer Versuch in {backoff}s")
                self._sleep(backoff)
                continue

            self.request_count += 1
            self.rate.update(response.headers)

            if response.status_code == 429:
                retry_after = float(response.headers.get("Retry-After", WINDOW_SECONDS))
                self._log(f"  429 vom Server, warte {retry_after:.0f}s")
                self._sleep(retry_after)
                continue

            if response.status_code == 403:
                raise DiscogsError(
                    "403 von Discogs. Haeufigste Ursachen: fehlender oder "
                    "falscher User-Agent, ungueltiger Token."
                )

            if response.status_code == 404:
                raise DiscogsError(f"404: {url}")

            if response.status_code >= 500:
                if attempt == MAX_RETRIES:
                    raise DiscogsError(f"{response.status_code} von {url}")
                backoff = 2**attempt
                self._log(f"  {response.status_code}, neuer Versuch in {backoff}s")
                self._sleep(backoff)
                continue

            if not response.ok:
                raise DiscogsError(f"{response.status_code} von {url}: {response.text[:200]}")

            return response.json()

        raise DiscogsError(f"Aufgabe nach {MAX_RETRIES} Versuchen: {url}")

    # -- Endpunkte -------------------------------------------------------
    def search_label(self, name: str, per_page: int = 10) -> list[dict]:
        data = self.get(
            "/database/search",
            {"q": name, "type": "label", "per_page": per_page},
        )
        return data.get("results", [])

    def label(self, label_id: int) -> dict:
        return self.get(f"/labels/{label_id}")

    def label_releases(self, label_id: int, page: int = 1, per_page: int = 100) -> dict:
        return self.get(
            f"/labels/{label_id}/releases",
            {"page": page, "per_page": per_page},
        )

    def iter_label_releases(self, label_id: int, per_page: int = 100) -> Iterator[dict]:
        page, pages = 1, 1
        while page <= pages:
            data = self.label_releases(label_id, page=page, per_page=per_page)
            pages = data.get("pagination", {}).get("pages", 1) or 1
            items = data.get("releases", [])
            self._log(f"    Seite {page}/{pages} ({len(items)} Eintraege, {self.rate})")
            yield from items
            page += 1

    def release(self, release_id: int) -> dict:
        return self.get(f"/releases/{release_id}")

    def search_release(self, query: str, per_page: int = 10) -> list[Any]:
        data = self.get(
            "/database/search",
            {"q": query, "type": "release", "per_page": per_page},
        )
        return data.get("results", [])
