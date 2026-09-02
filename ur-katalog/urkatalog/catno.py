"""Katalognummern zerlegen und normalisieren.

Discogs schreibt Katalognummern uneinheitlich: ``UR-007``, ``UR007``,
``UR 007``, dazu Sublabel-Praefixe wie ``RP-1`` oder ``SID-01``. Zum Sortieren
und zum Gruppieren von Repressings brauchen wir daraus drei Werte:

``norm``    alles ausser Buchstaben/Ziffern entfernt, Grossbuchstaben.
            Gruppenschluessel fuer die Dublettenerkennung.
``prefix``  der Buchstabenteil (``UR``, ``RP``, ``SID``).
``num``     der Zahlenteil als Integer, damit UR-9 vor UR-10 kommt.

Die Originalschreibweise bleibt in ``catno_raw`` erhalten.
"""

from __future__ import annotations

import re
from typing import NamedTuple, Optional

# Mehrfachangaben wie "UR-030, UR-031" oder "SID-01 / SID-02": nur den ersten
# Teil verwenden, sonst zerfaellt die Sortierung.
_SEPARATORS = re.compile(r"\s*[,;/|]\s*")

# "UR-025 R" -> Praefix "UR", Nummer 25, Suffix "R" (Repress-Kennzeichen o. ae.)
_SPLIT = re.compile(r"^(?P<prefix>[A-Z]*)(?P<num>\d+)(?P<suffix>[A-Z0-9]*)$")

# Werte, die Discogs statt einer Katalognummer eintraegt.
_PLACEHOLDERS = {"", "NONE", "NOTONLABEL", "NA", "UNKNOWN", "NOCATALOGUENUMBER"}


class CatNo(NamedTuple):
    raw: str
    norm: str
    prefix: str
    num: Optional[int]
    suffix: str

    @property
    def is_empty(self) -> bool:
        return self.norm == ""


def first_token(raw: Optional[str]) -> str:
    if not raw:
        return ""
    return _SEPARATORS.split(raw.strip())[0].strip()


def normalize(raw: Optional[str]) -> str:
    """``UR-007``, ``ur 007`` und ``UR007`` ergeben alle ``UR007``."""
    token = first_token(raw).upper()
    token = re.sub(r"[^A-Z0-9]", "", token)
    return "" if token in _PLACEHOLDERS else token


def parse(raw: Optional[str]) -> CatNo:
    norm = normalize(raw)
    if not norm:
        return CatNo(raw=(raw or "").strip(), norm="", prefix="", num=None, suffix="")

    match = _SPLIT.match(norm)
    if not match:
        # Reine Buchstabenfolge, z. B. "TRESOR". Sortiert am Ende der Gruppe.
        return CatNo(raw=raw.strip(), norm=norm, prefix=norm, num=None, suffix="")

    return CatNo(
        raw=raw.strip(),
        norm=norm,
        prefix=match.group("prefix"),
        num=int(match.group("num")),
        suffix=match.group("suffix"),
    )


def sort_key(raw: Optional[str]) -> tuple:
    """Sortierschluessel fuer Python-seitiges Sortieren (SQL sortiert selbst)."""
    cat = parse(raw)
    return (cat.prefix, cat.num is None, cat.num or 0, cat.suffix)
