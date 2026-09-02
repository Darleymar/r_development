from urkatalog import matching


def test_artist_praefix_und_klammern_stoeren_nicht():
    score = matching.similarity(
        "Jupiter Jazz",
        "Underground Resistance - Jupiter Jazz (Original Mix)",
        artist="Underground Resistance",
    )
    assert score >= 0.9


def test_fremder_titel_wird_nicht_zugeordnet():
    tracks = [{"title": "Jupiter Jazz"}]
    videos = [{"title": "Live at Tresor 1998", "uri": "https://youtu.be/aaaaaaa"}]
    matched, leftover = matching.match(tracks, videos)
    assert matched == {}
    assert len(leftover) == 1


def test_jedes_video_nur_einmal_vergeben():
    tracks = [{"title": "Amazon"}, {"title": "Amazon (Reprise)"}]
    videos = [{"title": "UR - Amazon", "uri": "https://youtu.be/bbbbbbb"}]
    matched, leftover = matching.match(tracks, videos)
    assert len(matched) == 1
    assert leftover == []


def test_trackposition_wird_ignoriert():
    assert matching.normalize_title("A1 Jupiter Jazz") == "jupiter jazz"


def test_youtube_id_aus_verschiedenen_url_formen():
    assert matching.youtube_id("https://www.youtube.com/watch?v=abc123XYZ") == "abc123XYZ"
    assert matching.youtube_id("https://youtu.be/abc123XYZ") == "abc123XYZ"
    assert matching.youtube_id("https://example.org/foo") is None
