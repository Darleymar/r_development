"""Ein Stueck Discogs-API zum Testen -- ohne Netz."""

from __future__ import annotations

import json
from urllib.parse import parse_qs, urlparse


class FakeResponse:
    """Wie urkatalog.webclient.Response, nur ohne Netz."""

    def __init__(self, payload, status_code=200, headers=None):
        self._payload = payload
        self.status_code = status_code
        self.headers = {key.lower(): value for key, value in (headers or {}).items()}
        self.text = json.dumps(payload)

    @property
    def ok(self):
        return self.status_code < 400

    def json(self):
        return self._payload

    def header(self, name):
        return self.headers.get(name.lower())


LABEL = {
    "id": 23528,
    "name": "Underground Resistance",
    "profile": "Detroit techno label founded by Mad Mike Banks and Jeff Mills.",
    "urls": ["http://www.undergroundresistance.com"],
    "sublabels": [{"id": 4444, "name": "Red Planet"}],
}

RELEASE_PAGES = {
    (23528, 1): {
        "pagination": {"page": 1, "pages": 2, "per_page": 2},
        "releases": [
            {"id": 101, "catno": "UR-007", "title": "Jupiter Jazz", "year": 1992,
             "artist": "Underground Resistance", "format": "12\"", "role": "Main"},
            {"id": 102, "catno": "UR 007", "title": "Jupiter Jazz", "year": 1998,
             "artist": "Underground Resistance", "format": "CD", "role": "Main"},
        ],
    },
    (23528, 2): {
        "pagination": {"page": 2, "pages": 2, "per_page": 2},
        "releases": [
            {"id": 103, "catno": "UR-030", "title": "Electronic Warfare", "year": 1998,
             "artist": "Underground Resistance", "format": "12\"", "role": "Main"},
            {"id": 999, "catno": "COMP-1", "title": "Techno Compilation", "year": 2001,
             "artist": "Various", "format": "CD", "role": "TrackAppearance"},
        ],
    },
    (4444, 1): {
        "pagination": {"page": 1, "pages": 1, "per_page": 2},
        "releases": [
            {"id": 201, "catno": "RP-1", "title": "Star Dancer", "year": 1992,
             "artist": "The Martian", "format": "12\"", "role": "Main"},
        ],
    },
}

RELEASES = {
    101: {
        "id": 101, "title": "Jupiter Jazz", "year": 1992, "country": "US",
        "released": "1992-00-00", "uri": "https://www.discogs.com/release/101",
        "labels": [{"id": 23528, "name": "Underground Resistance", "catno": "UR-007"}],
        "formats": [{"name": "Vinyl", "descriptions": ["12\""]}],
        "genres": ["Electronic"], "styles": ["Techno"], "notes": "Original press.",
        "artists": [{"name": "Underground Resistance"}],
        "tracklist": [
            {"position": "A", "title": "Jupiter Jazz", "duration": "6:12", "type_": "track"},
            {"position": "B", "title": "Sea Wolf", "duration": "5:03", "type_": "track"},
            {"title": "Bonus", "type_": "heading"},
        ],
        "videos": [
            {"uri": "https://www.youtube.com/watch?v=jjjjjjj",
             "title": "Underground Resistance - Jupiter Jazz", "duration": 372},
            {"uri": "https://www.youtube.com/watch?v=xxxxxxx",
             "title": "UR live in Berlin", "duration": 3600},
        ],
    },
    102: {
        "id": 102, "title": "Jupiter Jazz", "year": 1998, "country": "Germany",
        "labels": [{"id": 23528, "name": "Underground Resistance", "catno": "UR 007"}],
        "formats": [{"name": "CD"}], "genres": ["Electronic"], "styles": ["Techno"],
        "artists": [{"name": "Underground Resistance"}], "tracklist": [], "videos": [],
    },
    103: {
        "id": 103, "title": "Electronic Warfare", "year": 1998, "country": "US",
        "labels": [{"id": 23528, "name": "Underground Resistance", "catno": "UR-030"}],
        "formats": [{"name": "Vinyl", "descriptions": ["12\""]}],
        "genres": ["Electronic"], "styles": ["Techno"],
        "artists": [{"name": "Underground Resistance"}],
        "tracklist": [{"position": "A", "title": "Electronic Warfare", "duration": "5:55",
                       "type_": "track"}],
        "videos": [],
    },
    501: {
        "id": 501, "title": "X-101", "year": 1991, "country": "Germany",
        "labels": [{"id": 7777, "name": "Tresor", "catno": "TRESOR 4"}],
        "formats": [{"name": "Vinyl", "descriptions": ["LP"]}],
        "genres": ["Electronic"], "styles": ["Techno"],
        "artists": [{"name": "X-101"}],
        "tracklist": [{"position": "A1", "title": "Sonic Destroyer", "duration": "5:20",
                       "type_": "track"}],
        "videos": [{"uri": "https://youtu.be/ddddddd", "title": "X-101 - Sonic Destroyer",
                    "duration": 320}],
    },
    201: {
        "id": 201, "title": "Star Dancer", "year": 1992, "country": "US",
        "labels": [{"id": 4444, "name": "Red Planet", "catno": "RP-1"}],
        "formats": [{"name": "Vinyl", "descriptions": ["12\""]}],
        "genres": ["Electronic"], "styles": ["Techno"],
        "artists": [{"name": "The Martian"}],
        "tracklist": [{"position": "A1", "title": "Star Dancer", "duration": "7:00",
                       "type_": "track"}],
        "videos": [{"uri": "https://youtu.be/sssssss", "title": "The Martian - Star Dancer",
                    "duration": 420}],
    },
}


class FakeTransport:
    """Ersetzt urkatalog.webclient.Transport im DiscogsClient."""

    def __init__(self, remaining_sequence=None, fail_first=0):
        self.headers = {}
        self.calls = []
        self.remaining_sequence = list(remaining_sequence or [])
        self.fail_first = fail_first

    def _rate_headers(self):
        remaining = self.remaining_sequence.pop(0) if self.remaining_sequence else 59
        return {
            "X-Discogs-Ratelimit": "60",
            "X-Discogs-Ratelimit-Remaining": str(remaining),
            "X-Discogs-Ratelimit-Used": str(60 - remaining),
        }

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params or {}))
        if self.fail_first > 0:
            self.fail_first -= 1
            return FakeResponse({"message": "boom"}, 503, self._rate_headers())

        path = urlparse(url).path
        headers = self._rate_headers()

        if path == "/database/search":
            query = (params or {}).get("q", "")
            if (params or {}).get("type") == "label":
                return FakeResponse({"results": [{"id": 23528, "title": "Underground Resistance"}]}, headers=headers)
            return FakeResponse(
                {"results": [{"id": 501, "title": f"Treffer fuer {query}", "year": 1991}]},
                headers=headers,
            )

        if path.startswith("/labels/") and path.endswith("/releases"):
            label_id = int(path.split("/")[2])
            page = int((params or {}).get("page", 1))
            payload = RELEASE_PAGES.get((label_id, page))
            if payload is None:
                return FakeResponse({"message": "not found"}, 404, headers)
            return FakeResponse(payload, headers=headers)

        if path.startswith("/labels/"):
            return FakeResponse(LABEL, headers=headers)

        if path.startswith("/releases/"):
            release_id = int(path.split("/")[2])
            payload = RELEASES.get(release_id)
            if payload is None:
                return FakeResponse({"message": "not found"}, 404, headers)
            return FakeResponse(payload, headers=headers)

        return FakeResponse({"message": "unhandled"}, 404, headers)
