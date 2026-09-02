"""Videos den Tracks eines Releases zuordnen.

Discogs-Videos heissen oft "Underground Resistance - Jupiter Jazz (Original
Mix)", der Track schlicht "Jupiter Jazz". Deshalb: Titel normalisieren
(Artist-Praefix, Trackposition, Klammerzusaetze raus) und ueber
``difflib`` vergleichen. Was sich nicht sicher zuordnen laesst, bleibt als
Release-Video uebrig und wird gesammelt unter der Tracklist angezeigt.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Optional, Sequence

DEFAULT_THRESHOLD = 0.72

_NOISE = re.compile(
    r"\b(original mix|original version|full version|radio edit|"
    r"official (video|audio)|hq|hd|remaster(ed)?|audio only)\b",
    re.IGNORECASE,
)
_BRACKETS = re.compile(r"[\(\[\{][^\)\]\}]*[\)\]\}]")
_POSITION = re.compile(r"^[a-h]{1,2}\d{0,2}[\.\)\-\s]+", re.IGNORECASE)
_NON_WORD = re.compile(r"[^a-z0-9]+")


def normalize_title(title: Optional[str], artist: Optional[str] = None) -> str:
    text = (title or "").lower()

    # "Underground Resistance - Jupiter Jazz" -> "Jupiter Jazz"
    if artist:
        artist_norm = _NON_WORD.sub(" ", artist.lower()).strip()
        if artist_norm and text.startswith(artist_norm.split("(")[0].strip()):
            text = text[len(artist_norm):]
    if " - " in text:
        head, _, tail = text.partition(" - ")
        if len(tail.strip()) >= 3:
            text = tail

    text = _BRACKETS.sub(" ", text)
    text = _NOISE.sub(" ", text)
    text = _POSITION.sub(" ", text)
    text = _NON_WORD.sub(" ", text)
    return " ".join(text.split())


def similarity(track_title: str, video_title: str, artist: Optional[str] = None) -> float:
    a = normalize_title(track_title)
    b = normalize_title(video_title, artist)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    # Der Videotitel enthaelt den Tracktitel als ganzes Wort -> sehr sicher.
    if len(a) >= 4 and re.search(rf"\b{re.escape(a)}\b", b):
        return 0.95
    return SequenceMatcher(None, a, b).ratio()


def match(
    tracks: Sequence[dict],
    videos: Sequence[dict],
    artist: Optional[str] = None,
    threshold: float = DEFAULT_THRESHOLD,
) -> tuple[dict[int, dict], list[dict]]:
    """Ordnet Videos Tracks zu (jeweils hoechster Score zuerst, 1:1).

    Rueckgabe: ``({track_index: video}, [uebrige videos])``.
    """
    scored = []
    for t_index, track in enumerate(tracks):
        for v_index, video in enumerate(videos):
            value = similarity(track.get("title") or "", video.get("title") or "", artist)
            if value >= threshold:
                scored.append((value, t_index, v_index))
    scored.sort(key=lambda item: (-item[0], item[1], item[2]))

    by_track: dict[int, dict] = {}
    used_videos: set[int] = set()
    for value, t_index, v_index in scored:
        if t_index in by_track or v_index in used_videos:
            continue
        video = dict(videos[v_index])
        video["match_score"] = round(value, 3)
        by_track[t_index] = video
        used_videos.add(v_index)

    leftover = [dict(v) for i, v in enumerate(videos) if i not in used_videos]
    return by_track, leftover


def youtube_id(uri: Optional[str]) -> Optional[str]:
    if not uri:
        return None
    patterns = (
        r"(?:youtube\.com/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{6,})",
        r"(?:youtu\.be/)([A-Za-z0-9_-]{6,})",
        r"(?:youtube\.com/embed/)([A-Za-z0-9_-]{6,})",
    )
    for pattern in patterns:
        found = re.search(pattern, uri)
        if found:
            return found.group(1)
    return None
