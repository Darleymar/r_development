from urkatalog import catno


def test_gleiche_nummer_verschiedene_schreibweisen():
    assert catno.normalize("UR-007") == catno.normalize("UR007") == catno.normalize("ur 007")


def test_zerlegung():
    parsed = catno.parse("UR-007")
    assert (parsed.prefix, parsed.num, parsed.raw) == ("UR", 7, "UR-007")


def test_sublabel_praefixe():
    assert catno.parse("RP-1").prefix == "RP"
    assert catno.parse("SID-01").num == 1


def test_repress_suffix_bleibt_erhalten():
    parsed = catno.parse("UR-025R")
    assert (parsed.prefix, parsed.num, parsed.suffix) == ("UR", 25, "R")


def test_platzhalter_ergeben_leere_nummer():
    for value in ("none", "Not On Label", "", None):
        assert catno.parse(value).is_empty


def test_mehrfachangabe_nimmt_den_ersten_teil():
    assert catno.parse("UR-030, UR-031").num == 30


def test_sortierung_ist_numerisch():
    roh = ["UR-010", "UR 9", "UR-100", "RP-2", "UR-none"]
    assert sorted(roh, key=catno.sort_key) == ["RP-2", "UR 9", "UR-010", "UR-100", "UR-none"]
