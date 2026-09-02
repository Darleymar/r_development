"""Konfiguration aus config.json und Token aus .env.

Beides absichtlich ohne externe Abhaengigkeiten: .env ist eine simple
KEY=VALUE-Datei, config.json normales JSON, damit man Aeren und Label-ID
von Hand editieren kann.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = ROOT / "config.json"
DEFAULT_ENV = ROOT / ".env"

DEFAULTS: dict[str, Any] = {
    "label": {
        "id": None,
        "name": "Underground Resistance",
        "include_sublabels": True,
    },
    "user_agent": "URKatalog/0.1 +http://localhost",
    "db": "urkatalog.db",
    "dedupe": {
        "prefer_formats": ["Vinyl"],
        "prefer_countries": ["US"],
    },
    "eras": [
        {"id": "1990-1993", "label": "Erste Welle (Banks / Mills / Hood)",
         "from": 1990, "to": 1993},
        {"id": "1994-1997", "label": "Mad Mike solo, Galaxy 2 Galaxy, Red Planet",
         "from": 1994, "to": 1997},
        {"id": "1998-2004", "label": "Interstellar Fugitives, Los Hermanos, Aztec Mystic",
         "from": 1998, "to": 2004},
        {"id": "2005-", "label": "Timeline und Live-Aera", "from": 2005, "to": None},
    ],
    "related_seed_file": "seeds/related.json",
    "video_match_threshold": 0.72,
}


def load_env(path: str | Path = DEFAULT_ENV) -> dict[str, str]:
    """Sehr kleiner .env-Parser. Bereits gesetzte Umgebungsvariablen gewinnen."""
    values: dict[str, str] = {}
    path = Path(path)
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip('"').strip("'")
    for key, value in values.items():
        os.environ.setdefault(key, value)
    return values


def discogs_token(env_path: str | Path = DEFAULT_ENV) -> Optional[str]:
    load_env(env_path)
    return os.environ.get("DISCOGS_TOKEN") or None


def spotify_credentials(env_path: str | Path = DEFAULT_ENV) -> tuple[Optional[str], Optional[str]]:
    load_env(env_path)
    return (
        os.environ.get("SPOTIFY_CLIENT_ID") or None,
        os.environ.get("SPOTIFY_CLIENT_SECRET") or None,
    )


class Config:
    def __init__(self, data: dict, path: Path):
        self.data = data
        self.path = path

    # -- Zugriff ---------------------------------------------------------
    def __getitem__(self, key: str) -> Any:
        return self.data[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    @property
    def label_id(self) -> Optional[int]:
        value = self.data.get("label", {}).get("id")
        return int(value) if value else None

    @property
    def label_name(self) -> str:
        return self.data.get("label", {}).get("name", "Underground Resistance")

    @property
    def user_agent(self) -> str:
        return self.data.get("user_agent", DEFAULTS["user_agent"])

    @property
    def db_path(self) -> Path:
        db = Path(self.data.get("db", DEFAULTS["db"]))
        return db if db.is_absolute() else self.path.parent / db

    @property
    def eras(self) -> list[dict]:
        return self.data.get("eras", DEFAULTS["eras"])

    @property
    def related_seed_path(self) -> Path:
        seed = Path(self.data.get("related_seed_file", DEFAULTS["related_seed_file"]))
        return seed if seed.is_absolute() else self.path.parent / seed

    def era_for(self, year: Optional[int]) -> Optional[dict]:
        if not year:
            return None
        for era in self.eras:
            start, end = era.get("from"), era.get("to")
            if start is not None and year < start:
                continue
            if end is not None and year > end:
                continue
            return era
        return None

    # -- Schreiben -------------------------------------------------------
    def set_label_id(self, label_id: int, name: Optional[str] = None) -> None:
        label = self.data.setdefault("label", {})
        label["id"] = int(label_id)
        if name:
            label["name"] = name
        self.save()

    def save(self) -> None:
        self.path.write_text(
            json.dumps(self.data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )


def _merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def load(path: str | Path = DEFAULT_CONFIG) -> Config:
    path = Path(path)
    data = dict(DEFAULTS)
    if path.exists():
        data = _merge(data, json.loads(path.read_text(encoding="utf-8")))
    return Config(data, path)
