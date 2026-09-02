"""Tests gegen den echten HTTP-Server -- gestartet im Testprozess, ohne Netz."""

import http.client
import json
import threading
from http.server import ThreadingHTTPServer

import pytest

from fake_discogs import FakeTransport
from urkatalog import config as config_mod
from urkatalog import db as db_mod
from urkatalog import dedupe, fetcher
from urkatalog.discogs import DiscogsClient


class Response:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self.body = body

    def json(self):
        return json.loads(self.body)

    @property
    def text(self):
        return self.body.decode("utf-8")


class Client:
    def __init__(self, port):
        self.port = port

    def _request(self, method, path, payload=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        body = json.dumps(payload).encode() if payload is not None else None
        headers = {"Content-Type": "application/json"} if body else {}
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        result = Response(response.status, response.read())
        conn.close()
        return result

    def get(self, path):
        return self._request("GET", path)

    def put(self, path, json=None):
        return self._request("PUT", path, json if json is not None else {})


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Server gegen eine frisch befuellte Test-DB."""
    import app as app_module

    db_path = tmp_path / "test.db"
    cfg = config_mod.load(tmp_path / "config.json")
    cfg.data["label"]["id"] = 23528
    cfg.data["db"] = str(db_path)

    conn = db_mod.connect(db_path)
    db_mod.init(conn)
    discogs = DiscogsClient(
        "t", "URKatalog/test", transport=FakeTransport(), sleep=lambda _: None,
        log=lambda _: None,
    )
    fetcher.sync_labels(conn, discogs, cfg, log=lambda _: None)
    fetcher.sync_releases(conn, discogs, cfg, log=lambda _: None)
    fetcher.sync_details(conn, discogs, cfg, log=lambda _: None)
    dedupe.rebuild(conn)
    conn.close()

    monkeypatch.setattr(app_module, "CONFIG", cfg)
    monkeypatch.setattr(app_module.Handler, "log_message", lambda *args: None)

    server = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    thread.start()
    try:
        yield Client(server.server_port)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_meta_listet_labels_und_aeren(client):
    data = client.get("/api/meta").json()
    assert {label["name"] for label in data["labels"]} == {"Underground Resistance", "Red Planet"}
    assert data["counts"]["primary"] == 3
    assert len(data["eras"]) == 4


def test_liste_in_katalogreihenfolge_ohne_varianten(client):
    data = client.get("/api/releases").json()
    assert [item["catno_raw"] for item in data["items"]] == ["RP-1", "UR-007", "UR-030"]
    assert data["total"] == 3


def test_liste_zeigt_videozaehler_und_aera(client):
    items = {item["catno_raw"]: item for item in client.get("/api/releases").json()["items"]}
    assert items["UR-007"]["video_count"] == 2
    assert items["UR-007"]["variant_count"] == 1
    assert items["UR-007"]["era"] == "1990-1993"
    assert items["UR-030"]["era"] == "1998-2004"


def test_filter_label_jahr_video_und_suche(client):
    def catnos(query):
        return [item["catno_raw"] for item in client.get(f"/api/releases?{query}").json()["items"]]

    assert catnos("label_id=4444") == ["RP-1"]
    assert catnos("year_from=1995") == ["UR-030"]
    assert catnos("era=1990-1993") == ["RP-1", "UR-007"]
    assert catnos("has_video=true") == ["RP-1", "UR-007"]
    assert catnos("q=Sea+Wolf") == ["UR-007"]        # Treffer nur im Tracktitel
    assert catnos("q=Martian") == ["RP-1"]


def test_unsinnige_filter_werden_abgewiesen(client):
    assert client.get("/api/releases?status=vielleicht").status_code == 400
    assert client.get("/api/releases?year_from=neunzehn").status_code == 400
    assert client.get("/api/releases?sort=zufall").status_code == 400


def test_detail_ordnet_video_dem_track_zu(client):
    release = client.get("/api/releases/101").json()
    tracks = {track["title"]: track for track in release["tracks"]}
    assert tracks["Jupiter Jazz"]["video"]["uri"].endswith("jjjjjjj")
    assert tracks["Sea Wolf"]["video"] is None
    # Das Live-Video passt auf keinen Track und bleibt gesammelt uebrig.
    assert [video["title"] for video in release["unmatched_videos"]] == ["UR live in Berlin"]
    assert release["variants"][0]["catno_raw"] == "UR 007"
    assert release["formats"] == ["Vinyl", '12"']


def test_status_setzen_und_lesen(client):
    response = client.put("/api/listening/101", json={"status": "favorit", "rating": 5})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "favorit"
    assert body["listened_at"] is not None

    detail = client.get("/api/releases/101").json()
    assert detail["listening"]["status"] == "favorit"
    assert detail["listening"]["rating"] == 5


def test_notiz_bleibt_beim_statuswechsel_erhalten(client):
    client.put("/api/listening/101", json={"notes": "Klassiker"})
    client.put("/api/listening/101", json={"status": "gehoert"})
    assert client.get("/api/releases/101").json()["listening"]["notes"] == "Klassiker"


def test_ungueltige_eingaben_werden_abgelehnt(client):
    assert client.put("/api/listening/101", json={"status": "vielleicht"}).status_code == 422
    assert client.put("/api/listening/101", json={"rating": 9}).status_code == 422
    assert client.put("/api/listening/999999", json={"status": "gehoert"}).status_code == 404
    assert client.get("/api/releases/999999").status_code == 404
    assert client.get("/api/quatsch").status_code == 404


def test_naechstes_ungehoertes_folgt_der_katalogreihenfolge(client):
    first = client.get("/api/next-unheard").json()
    assert first["item"]["catno_raw"] == "RP-1"
    assert first["remaining"] == 3

    client.put(f"/api/listening/{first['id']}", json={"status": "gehoert"})
    second = client.get("/api/next-unheard").json()
    assert second["item"]["catno_raw"] == "UR-007"
    assert second["remaining"] == 2

    # 'after' springt weiter, ohne den Status zu aendern.
    weiter = client.get(f"/api/next-unheard?after={second['id']}").json()
    assert weiter["item"]["catno_raw"] == "UR-030"


def test_naechstes_ungehoertes_respektiert_filter(client):
    data = client.get("/api/next-unheard?label_id=4444").json()
    assert data["item"]["catno_raw"] == "RP-1"
    assert data["remaining"] == 1


def test_after_springt_weiter_auch_von_einem_gehoerten_release_aus(client):
    # Steht der Cursor auf UR-007 (gehoert), kommt UR-030 -- nicht wieder RP-1.
    client.put("/api/listening/101", json={"status": "gehoert"})
    weiter = client.get("/api/next-unheard?after=101").json()
    assert weiter["item"]["catno_raw"] == "UR-030"
    assert weiter["remaining"] == 2


def test_after_am_listenende_bricht_um(client):
    assert client.get("/api/next-unheard?after=103").json()["item"]["catno_raw"] == "RP-1"


def test_alles_gehoert_liefert_nichts_mehr(client):
    for release_id in (101, 103, 201):
        client.put(f"/api/listening/{release_id}", json={"status": "gehoert"})
    assert client.get("/api/next-unheard").json() == {"id": None, "remaining": 0, "item": None}


def test_statistik_pro_aera(client):
    client.put("/api/listening/101", json={"status": "gehoert"})
    stats = client.get("/api/stats").json()
    assert (stats["total"], stats["heard"]) == (3, 1)
    assert stats["by_status"]["gehoert"] == 1
    erste_welle = next(era for era in stats["by_era"] if era["id"] == "1990-1993")
    assert (erste_welle["total"], erste_welle["heard"]) == (2, 1)


def test_startseite_und_statische_dateien(client):
    seite = client.get("/")
    assert seite.status_code == 200
    assert "UR" in seite.text
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/style.css").status_code == 200


def test_kein_ausbrechen_aus_dem_static_verzeichnis(client):
    for pfad in ("/static/../config.json", "/static/../../etc/passwd"):
        assert client.get(pfad).status_code in (403, 404)
