"""Minimaler HTTP-Client auf urllib-Basis.

Bewusst ohne ``requests``: die App soll auf dem Handy (Termux) mit einem
blanken ``pkg install python`` laufen, ohne pip und ohne Kompilieren.
Geliefert wird immer ein ``Response`` -- auch bei 4xx/5xx, damit der Aufrufer
die Rate-Limit-Header auch aus Fehlerantworten lesen kann.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional


class NetworkError(RuntimeError):
    """Verbindung kam gar nicht zustande (DNS, kein Netz, Timeout)."""


class Response:
    def __init__(self, status_code: int, headers: dict, body: bytes):
        self.status_code = status_code
        # Header sind bei HTTP case-insensitive.
        self.headers = {key.lower(): value for key, value in headers.items()}
        self.body = body

    @property
    def ok(self) -> bool:
        return self.status_code < 400

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", "replace")

    def json(self):
        return json.loads(self.body.decode("utf-8"))

    def header(self, name: str) -> Optional[str]:
        return self.headers.get(name.lower())




class Transport:
    """Kapselt den Netzzugriff -- in Tests durch eine Attrappe ersetzbar."""

    def __init__(self, headers: Optional[dict] = None):
        self.headers = dict(headers or {})

    def get(self, url: str, params: Optional[dict] = None, timeout: float = 30.0) -> Response:
        if params:
            query = urllib.parse.urlencode(
                {key: value for key, value in params.items() if value is not None}
            )
            url = f"{url}{'&' if '?' in url else '?'}{query}"

        request = urllib.request.Request(url, headers=self.headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return Response(response.status, dict(response.headers), response.read())
        except urllib.error.HTTPError as error:
            # Kein Ausnahmefall fuer uns: 429 und 5xx werden oben behandelt.
            return Response(error.code, dict(error.headers or {}), error.read())
        except (urllib.error.URLError, OSError) as error:
            raise NetworkError(str(error)) from error

    def post_form(
        self, url: str, data: dict, headers: Optional[dict] = None, timeout: float = 30.0
    ) -> Response:
        payload = urllib.parse.urlencode(data).encode()
        merged = {**self.headers, **(headers or {}),
                  "Content-Type": "application/x-www-form-urlencoded"}
        request = urllib.request.Request(url, data=payload, headers=merged, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return Response(response.status, dict(response.headers), response.read())
        except urllib.error.HTTPError as error:
            return Response(error.code, dict(error.headers or {}), error.read())
        except (urllib.error.URLError, OSError) as error:
            raise NetworkError(str(error)) from error
