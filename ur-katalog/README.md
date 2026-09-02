# UR-Katalog

Lokale Single-User-App, um den Katalog von Underground Resistance (inklusive
Sublabels) systematisch durchzuhören: eine Liste in Katalogreihenfolge, pro
Release direkt abspielbare Video-Links und ein persistenter Hörstatus.

Kein Deployment, kein Multi-User, keine Auth, kein Build-Step. Zwei Teile:

| Datei      | Aufgabe                                                              |
|------------|----------------------------------------------------------------------|
| `fetch.py` | holt Daten von Discogs nach SQLite — wiederholt ausführbar, resumierbar |
| `app.py`   | serviert die Oberfläche und die Status-Endpunkte                     |

Die Trennung ist auch eine Sicherheitsleine: Der Fetcher fasst die Tabelle
`listening` nie an. Ein erneuter Katalog-Abgleich kann den Hörfortschritt
nicht überschreiben.

## Einrichten

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # DISCOGS_TOKEN eintragen
```

Der Token ist ein **Personal Access Token** aus dem eigenen Discogs-Account
(Settings → Developers → *Generate new token*), kostenlos und ohne OAuth.

## Daten holen

```bash
python fetch.py find-label          # 1. Label-ID ermitteln und prüfen
python fetch.py find-label --pick 23528   # ID nach Sichtprüfung übernehmen
python fetch.py all                 # 2. Labels, Releaselisten, Details, Dedupe
```

`find-label` sucht über `/database/search`, holt zu jedem Treffer das Profil
und listet Sublabel-Anzahl und Website auf — damit sich verifizieren lässt,
dass es das Detroiter Label ist und keine Namensdopplung. Erst `--pick`
schreibt die ID in `config.json`; danach passiert der Suchschritt nicht mehr.

Die Schritte gibt es auch einzeln:

```bash
python fetch.py labels              # Label + Sublabels (Red Planet, Somewhere In Detroit, …)
python fetch.py releases            # /labels/{id}/releases, durchpaginiert
python fetch.py details --limit 50  # der teure Schritt: ein Request pro Release
python fetch.py dedupe              # Hauptversion je Katalognummer neu bestimmen
python fetch.py related             # Seed-Liste (X-101 ff.)
python fetch.py stats               # Zählstand
```

`details` ist der eigentliche Grund für die Übung: Die Antwort von
`/releases/{id}` enthält das `videos`-Array mit den von Usern hinterlegten
YouTube-Links. Damit entfällt die YouTube-Sucherei.

**Abbrechen ist unkritisch.** Nach jedem Release wird committet und
`detail_fetched_at` gesetzt; der nächste Lauf überspringt alles, was schon
gefüllt ist. `--refresh` erzwingt das erneute Holen.

**Rate Limit.** Discogs erlaubt mit Token 60 Requests/Minute. Der Client liest
`X-Discogs-Ratelimit-Remaining` aus und drosselt danach: solange mehr als 20
Requests im laufenden Fenster frei sind, läuft er ohne Pause, darunter streckt
er die verbleibenden Requests über den Rest des Fensters (`60/remaining`,
gedeckelt bei 10 s). 429 wird mit `Retry-After` abgewartet, 5xx und
Netzwerkfehler werden bis zu fünfmal mit 2/4/8/16 s wiederholt. Der
`User-Agent` wird gesetzt — ohne ihn antwortet Discogs mit 403.

## App starten

```bash
python app.py             # http://127.0.0.1:8000
python app.py --port 8080 --db ~/musik/ur.db
```

* **„nächstes ungehörtes"** springt zum nächsten Release mit Status
  `ungehoert` *nach der aktuellen Position* (am Listenende wird umgebrochen)
  und klappt es auf. Filter gelten dabei mit.
* **Filter:** Label/Sublabel, Ära, Jahr-Range, Status, „nur mit Video";
  Freitextsuche über Artist, Titel, Katalognummer und Tracktitel.
* **Fortschritt:** oben gesamt, darunter pro Ära.
* **Aufgeklappt:** Tracklist mit Play-Link je Track (sofern sich ein Video über
  Titelähnlichkeit zuordnen lässt), darunter die übrigen Release-Videos,
  weitere Versionen, Discogs-Link, Bewertung und Notizfeld (speichert selbst).
* **Tastatur:** `j`/`k` navigieren, `Enter` auf-/zuklappen, `g` gehört,
  `f` Favorit, `n` nochmal, `u` zurück auf ungehört, `.` nächstes ungehörtes,
  `/` Suche.

Die Filtereinstellungen bleiben im `localStorage` des Browsers.

## Die zwei Fallstricke

**Duplikate.** Die Releaseliste eines Labels enthält massenhaft Repressings,
Länder-Varianten und CD-Ausgaben desselben Titels. Gruppiert wird nach
normalisierter Katalognummer; pro Gruppe gewinnt das früheste Jahr, bei
Gleichstand das bevorzugte Format (Default `Vinyl`), dann das bevorzugte Land
(Default `US`), zuletzt die kleinste Discogs-ID, damit das Ergebnis stabil
bleibt. Die anderen Versionen bleiben erhalten — sie hängen über `variant_of`
an der Hauptversion und lassen sich im Detail ausklappen. Formate und Länder
sind in `config.json` unter `dedupe` einstellbar; `python fetch.py dedupe`
rechnet danach neu.

**Sortierung nach Katalognummer.** `UR-007`, `UR007` und `UR 007` sind
dieselbe Platte. Beim Import wird deshalb in `catno_prefix` (Buchstaben) und
`catno_num` (Integer) zerlegt und zusätzlich ein normalisierter
Gruppenschlüssel `catno_norm` abgelegt. Sortiert wird nach
`(catno_prefix, catno_num)` — nicht nach dem Rohstring, sonst käme `UR-100`
vor `UR-9`. Die Originalschreibweise steht in `catno_raw` und wird angezeigt.

Releases, die Discogs als `TrackAppearance` führt (Compilations mit einem
einzelnen Track), landen nicht in der Katalogliste.

## Konfiguration

`config.json`:

| Schlüssel              | Bedeutung                                            |
|------------------------|------------------------------------------------------|
| `label.id`             | Discogs-Label-ID, von `find-label --pick` gesetzt    |
| `label.include_sublabels` | Sublabels mitziehen                               |
| `user_agent`           | Pflicht bei Discogs                                  |
| `db`                   | Pfad zur SQLite-Datei                                |
| `dedupe`               | bevorzugte Formate/Länder für die Hauptversion       |
| `eras`                 | Ära-Gruppierung, frei editierbar                     |
| `video_match_threshold`| ab welcher Titelähnlichkeit ein Video als Track gilt |

Die Ären sind als Startwerte gesetzt: 1990–1993 Erste Welle (Banks / Mills /
Hood), 1994–1997 Mad Mike solo / Galaxy 2 Galaxy / Red Planet, 1998–2004
Interstellar Fugitives / Los Hermanos / Aztec Mystic, ab 2005 Timeline und
Live-Ära. Grenzen ändern → App neu starten.

## Datenbank

```
labels      (id, name, is_sublabel, parent_id, …)
releases    (id, label_id, catno_raw, catno_norm, catno_prefix, catno_num,
             artist, title, year, released, country, formats_json, genres,
             styles, notes, discogs_url, thumb_url, variant_of, is_primary,
             fetched_at, detail_fetched_at, …)
tracks      (release_id, seq, position, title, duration, artists)
videos      (release_id, seq, uri, title, duration)
listening   (release_id PK, status, rating, notes, listened_at, updated_at)
```

`listening.status` ist `ungehoert` | `gehoert` | `favorit` | `nochmal`
(per CHECK-Constraint erzwungen). `formats_json`, `genres` und `styles`
enthalten JSON, alles andere sind skalare Werte.

Für Abfragen von Hand gibt es die View `v_katalog` — Hauptversionen in
Katalogreihenfolge mit Status und Videozähler:

```sql
sqlite3 urkatalog.db "SELECT catno_raw, artist, title, status, video_count
                      FROM v_katalog WHERE status = 'ungehoert' LIMIT 20;"
```

## Zweiter Schritt: verwandte Releases und Spotify

**Verwandte Releases.** `seeds/related.json` ist eine von Hand pflegbare Liste
für Platten der Crew, die nicht auf UR erschienen sind — X-101, X-102 und
X-103 auf Tresor. Jeder Eintrag hat `release_id`, `year` und `note`. Ist
`release_id` noch `null`, löst `python fetch.py related` den Eintrag über die
Discogs-Suche auf, protokolliert die Treffer und schreibt die übernommene ID
in die Datei zurück — dort lässt sie sich korrigieren, falls die Suche
danebengegriffen hat. Die Releases erscheinen mit der angegebenen
Jahreszahl in der Timeline und sind in der Liste mit `✧` markiert.

**Spotify.** Nur der Suchteil, mit dem **Client-Credentials-Flow** (kein
User-Login):

```bash
python fetch.py spotify --limit 100          # streambar? URI speichern
python fetch.py spotify --playlist ur.m3u    # Katalogreihenfolge als M3U
```

Playlists direkt in Spotify anzulegen bräuchte den Authorization-Code-Flow mit
Scope `playlist-modify-private` und ist bewusst nicht enthalten; die M3U-Datei
mit den gefundenen Album-Links ist der Ersatz, bis das jemand braucht.

## Tests

```bash
python -m pytest tests -q
```

Die Tests laufen ohne Netz gegen ein Stück nachgebauter Discogs-API
(`tests/fake_discogs.py`) und decken Katalognummern-Parsing, Dublettenwahl,
Video-Zuordnung, Paginierung, Resume-Verhalten und die HTTP-Endpunkte ab —
inklusive der Zusicherung, dass ein erneuter Abgleich den Hörstatus stehen
lässt.

## Was die App nicht tut

Keine Audio-Dateien herunterladen oder lokal speichern — nur verlinken. Keine
Cloud, keine Accounts, keine Datenbank außer der lokalen SQLite. Kein
Frontend-Framework mit Build-Step.
