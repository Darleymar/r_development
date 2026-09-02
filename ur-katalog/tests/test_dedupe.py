import json

import pytest

from urkatalog import db as db_mod
from urkatalog import dedupe


@pytest.fixture()
def conn():
    connection = db_mod.connect(":memory:")
    db_mod.init(connection)
    connection.execute("INSERT INTO labels (id, name) VALUES (1, 'UR')")
    return connection


def add(conn, release_id, catno_norm, year, country, formats):
    conn.execute(
        "INSERT INTO releases (id, label_id, catno_raw, catno_norm, catno_prefix, "
        "catno_num, title, year, country, formats_json) "
        "VALUES (?, 1, ?, ?, 'UR', 7, 'Jupiter Jazz', ?, ?, ?)",
        (release_id, catno_norm, catno_norm, year, country,
         json.dumps([{"name": f} for f in formats])),
    )


def test_aeltestes_jahr_gewinnt(conn):
    add(conn, 1, "UR007", 1998, "DE", ["Vinyl"])   # Repress
    add(conn, 2, "UR007", 1992, "US", ["Vinyl"])   # Original
    dedupe.rebuild(conn)
    assert conn.execute("SELECT is_primary FROM releases WHERE id = 2").fetchone()[0] == 1
    assert conn.execute("SELECT variant_of FROM releases WHERE id = 1").fetchone()[0] == 2


def test_bei_gleichem_jahr_gewinnt_vinyl_vor_cd(conn):
    add(conn, 1, "UR007", 1992, "US", ["CD"])
    add(conn, 2, "UR007", 1992, "US", ["Vinyl"])
    dedupe.rebuild(conn)
    assert conn.execute("SELECT is_primary FROM releases WHERE id = 2").fetchone()[0] == 1


def test_bei_gleichem_format_gewinnt_us(conn):
    add(conn, 1, "UR007", 1992, "Germany", ["Vinyl"])
    add(conn, 2, "UR007", 1992, "US", ["Vinyl"])
    dedupe.rebuild(conn)
    assert conn.execute("SELECT is_primary FROM releases WHERE id = 2").fetchone()[0] == 1


def test_ohne_katalognummer_bleibt_jedes_release_eigenstaendig(conn):
    add(conn, 1, "", 1992, "US", ["Vinyl"])
    add(conn, 2, "", 1993, "US", ["Vinyl"])
    result = dedupe.rebuild(conn)
    assert result["variants"] == 0
    assert result["groups"] == 2


def test_wiederholter_lauf_aendert_nichts(conn):
    add(conn, 1, "UR007", 1998, "DE", ["CD"])
    add(conn, 2, "UR007", 1992, "US", ["Vinyl"])
    first = dedupe.rebuild(conn)
    assert dedupe.rebuild(conn) == first


def test_formatnamen_aus_discogs_objekten():
    raw = json.dumps([{"name": "Vinyl", "descriptions": ["12\"", "33 ⅓ RPM"]}])
    assert dedupe.format_names(raw) == ["Vinyl", '12"', "33 ⅓ RPM"]
