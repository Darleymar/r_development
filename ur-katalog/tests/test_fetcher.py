import json

import pytest

from fake_discogs import FakeSession
from urkatalog import config as config_mod
from urkatalog import db as db_mod
from urkatalog import dedupe, fetcher
from urkatalog.discogs import DiscogsClient, DiscogsError


@pytest.fixture()
def cfg(tmp_path):
    configuration = config_mod.load(tmp_path / "config.json")
    configuration.data["label"]["id"] = 23528
    configuration.data["db"] = str(tmp_path / "test.db")
    return configuration


@pytest.fixture()
def conn():
    connection = db_mod.connect(":memory:")
    db_mod.init(connection)
    return connection


def make_client(session=None, **kwargs):
    return DiscogsClient(
        "token", "URKatalog/test", session=session or FakeSession(),
        sleep=lambda _: None, log=lambda _: None, **kwargs
    )


def test_client_setzt_user_agent_und_token():
    client = make_client()
    assert client.session.headers["User-Agent"] == "URKatalog/test"
    assert client.session.headers["Authorization"] == "Discogs token=token"


def test_client_ohne_token_meckert():
    with pytest.raises(DiscogsError):
        DiscogsClient("", "URKatalog/test")


def test_serverfehler_wird_wiederholt():
    session = FakeSession(fail_first=2)
    client = make_client(session)
    assert client.label(23528)["name"] == "Underground Resistance"
    assert len(session.calls) == 3


def test_drosselung_richtet_sich_nach_dem_restbudget():
    client = make_client()
    client.rate.limit, client.rate.remaining = 60, 59
    assert client.rate.sleep_seconds() == 0.0     # genug Budget, volle Fahrt
    client.rate.remaining = 10
    assert client.rate.sleep_seconds() == pytest.approx(6.0)
    client.rate.remaining = 1
    assert client.rate.sleep_seconds() == 10.0    # gedeckelt


def test_labels_und_sublabels(conn, cfg):
    rows = fetcher.sync_labels(conn, make_client(), cfg, log=lambda _: None)
    namen = {row["name"]: row["is_sublabel"] for row in rows}
    assert namen == {"Underground Resistance": 0, "Red Planet": 1}


def test_releaseliste_paginiert_und_filtert_nebenrollen(conn, cfg):
    fetcher.sync_labels(conn, make_client(), cfg, log=lambda _: None)
    total = fetcher.sync_releases(conn, make_client(), cfg, log=lambda _: None)
    assert total == 4  # 3x UR (ohne TrackAppearance) + 1x Red Planet
    ids = {row["id"] for row in conn.execute("SELECT id FROM releases")}
    assert ids == {101, 102, 103, 201}


def test_catno_wird_beim_import_zerlegt(conn, cfg):
    fetcher.sync_labels(conn, make_client(), cfg, log=lambda _: None)
    fetcher.sync_releases(conn, make_client(), cfg, log=lambda _: None)
    row = conn.execute(
        "SELECT catno_raw, catno_norm, catno_prefix, catno_num FROM releases WHERE id = 101"
    ).fetchone()
    assert tuple(row) == ("UR-007", "UR007", "UR", 7)


def test_details_liefern_tracks_und_videos(conn, cfg):
    fetcher.sync_labels(conn, make_client(), cfg, log=lambda _: None)
    fetcher.sync_releases(conn, make_client(), cfg, log=lambda _: None)
    result = fetcher.sync_details(conn, make_client(), cfg, log=lambda _: None)

    assert result["fetched"] == 4
    assert result["videos"] == 3
    tracks = conn.execute(
        "SELECT title FROM tracks WHERE release_id = 101 ORDER BY seq"
    ).fetchall()
    assert [t["title"] for t in tracks] == ["Jupiter Jazz", "Sea Wolf"]  # Heading raus
    assert json.loads(
        conn.execute("SELECT styles FROM releases WHERE id = 101").fetchone()[0]
    ) == ["Techno"]


def test_details_sind_resumierbar(conn, cfg):
    fetcher.sync_labels(conn, make_client(), cfg, log=lambda _: None)
    fetcher.sync_releases(conn, make_client(), cfg, log=lambda _: None)
    fetcher.sync_details(conn, make_client(), cfg, limit=2, log=lambda _: None)
    assert db_mod.counts(conn)["pending"] == 2

    session = FakeSession()
    fetcher.sync_details(conn, make_client(session), cfg, log=lambda _: None)
    assert db_mod.counts(conn)["pending"] == 0
    # Zweiter Lauf holt nur noch die fehlenden zwei, nicht alle vier.
    assert len([call for call in session.calls if "/releases/" in call[0]]) == 2

    session = FakeSession()
    fetcher.sync_details(conn, make_client(session), cfg, log=lambda _: None)
    assert session.calls == []


def test_hoerstatus_ueberlebt_erneuten_abgleich(conn, cfg):
    fetcher.sync_labels(conn, make_client(), cfg, log=lambda _: None)
    fetcher.sync_releases(conn, make_client(), cfg, log=lambda _: None)
    fetcher.sync_details(conn, make_client(), cfg, log=lambda _: None)

    conn.execute(
        "INSERT INTO listening (release_id, status, rating, notes) "
        "VALUES (101, 'favorit', 5, 'Klassiker')"
    )
    conn.commit()

    fetcher.sync_releases(conn, make_client(), cfg, log=lambda _: None)
    fetcher.sync_details(conn, make_client(), cfg, refresh=True, log=lambda _: None)
    dedupe.rebuild(conn)

    row = conn.execute("SELECT status, rating, notes FROM listening WHERE release_id = 101").fetchone()
    assert tuple(row) == ("favorit", 5, "Klassiker")


def test_dedupe_nach_import(conn, cfg):
    fetcher.sync_labels(conn, make_client(), cfg, log=lambda _: None)
    fetcher.sync_releases(conn, make_client(), cfg, log=lambda _: None)
    fetcher.sync_details(conn, make_client(), cfg, log=lambda _: None)
    dedupe.rebuild(conn)

    # UR-007 und "UR 007" sind dieselbe Platte -> die 1992er Vinyl gewinnt.
    assert conn.execute("SELECT is_primary FROM releases WHERE id = 101").fetchone()[0] == 1
    assert conn.execute("SELECT variant_of FROM releases WHERE id = 102").fetchone()[0] == 101
    assert db_mod.counts(conn)["primary"] == 3


def test_seed_liste_schreibt_gefundene_id_zurueck(conn, cfg, tmp_path):
    seed_file = tmp_path / "related.json"
    seed_file.write_text(json.dumps(
        [{"release_id": None, "search": "X-101 Tresor", "year": 1991, "note": "X-101"}]
    ))
    cfg.data["related_seed_file"] = str(seed_file)

    count = fetcher.sync_related(conn, make_client(), cfg, log=lambda _: None)
    assert count == 1
    assert json.loads(seed_file.read_text())[0]["release_id"] == 501
    row = conn.execute("SELECT is_related, year, related_note FROM releases WHERE id = 501").fetchone()
    assert tuple(row) == (1, 1991, "X-101")
