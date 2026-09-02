# UR-Katalog

Lokale Single-User-App, um den Katalog von Underground Resistance (inklusive
Sublabels) systematisch durchzuhören: eine Liste in Katalogreihenfolge, pro
Release direkt abspielbare Video-Links und ein persistenter Hörstatus.

Läuft komplett auf dem Handy — Termux, kein PC, keine Cloud, kein Account.
Auf dem Rechner läuft dasselbe unverändert.

| Datei      | Aufgabe                                                                 |
|------------|-------------------------------------------------------------------------|
| `fetch.py` | holt Daten von Discogs nach SQLite — wiederholt ausführbar, resumierbar |
| `app.py`   | serviert die Oberfläche und die Status-Endpunkte                        |
| `ur`       | Starthelfer fürs Handy (setzt unter Termux einen Wakelock)              |

**Keine Laufzeit-Abhängigkeiten.** Fetcher und App benutzen ausschließlich die
Python-Standardbibliothek (ab 3.9). Kein pip, kein Rust-Build, kein
Frontend-Framework, kein Build-Step. `pip install` braucht man nur, wenn man
die Tests laufen lassen will.

Die Trennung von Fetcher und App ist auch eine Sicherheitsleine: Der Fetcher
fasst die Tabelle `listening` nie an. Ein erneuter Katalog-Abgleich kann den
Hörfortschritt nicht überschreiben.

## Einrichten auf dem Handy (Android)

**1. Termux installieren** — aus [F-Droid](https://f-droid.org/packages/com.termux/),
nicht aus dem Play Store; die Play-Store-Version ist veraltet und bekommt keine
Pakete mehr.

**2. Python und git holen:**

```bash
pkg update && pkg upgrade
pkg install python git
```

**3. Projekt klonen:**

```bash
git clone <dieses-repo> && cd r_development/ur-katalog
```

**4. Discogs-Token eintragen.** Der Token ist ein *Personal Access Token* aus
dem eigenen Discogs-Account (Settings → Developers → *Generate new token*),
kostenlos und ohne OAuth:

```bash
cp .env.example .env
nano .env          # DISCOGS_TOKEN=... eintragen, Strg-O speichern, Strg-X raus
```

**5. Label-ID prüfen und festschreiben:**

```bash
./ur find-label
```

Das listet die Suchtreffer mit Profiltext, Website und Sublabel-Anzahl auf.
Kurz drüberschauen, ob es das Detroiter Label ist — dann die ID übernehmen:

```bash
./ur find-label --pick <ID>
```

**6. Katalog holen.** Erst ein kleiner Probelauf, dann der volle:

```bash
./ur fetch --limit 20      # ein paar Releases, zum Schauen
./ur stats
./ur fetch                 # alles
```

**7. App starten:**

```bash
./ur app
```

Dann im Handy-Browser `http://127.0.0.1:8000` öffnen. Über das Chrome-Menü
→ *Zum Startbildschirm hinzufügen* landet die App als Icon auf dem Homescreen
und startet ohne Adressleiste.

### Was auf dem Handy sonst noch hilft

* **Wakelock.** `./ur fetch` und `./ur app` setzen automatisch
  `termux-wake-lock`. Ohne den friert Android den Prozess ein, sobald der
  Bildschirm ausgeht, und der Lauf steht still. In der Termux-Notification
  steht dann *Acquire wakelock* / *Release wakelock*.
* **Der volle Lauf dauert.** Discogs erlaubt 60 Requests/Minute, der
  Detailschritt braucht einen Request pro Release — grob eine Minute pro 60
  Releases. Abbrechen ist unkritisch: nach jedem Release wird committet, der
  nächste Lauf macht dort weiter.
* **Termux beenden killt den Server.** Solange die Termux-Notification steht,
  läuft er weiter, auch wenn du im Browser bist.
* **Datei bleibt liegen.** Die SQLite-Datei liegt im Projektordner. Backup:
  `cp urkatalog.db /sdcard/Download/` (einmalig vorher `termux-setup-storage`).

## Auf dem Rechner

Dasselbe, nur ohne Termux-Zwischenschritte:

```bash
python3 fetch.py find-label
python3 fetch.py find-label --pick <ID>
python3 fetch.py all
python3 app.py                  # http://127.0.0.1:8000
```

Wenn das Handy die Oberfläche vom Rechner aus benutzen soll, statt selbst zu
fetchen:

```bash
python3 app.py --host 0.0.0.0
```

Die App gibt dann auch die Adresse im Heimnetz aus. Kein Passwort, keine
Verschlüsselung — nur im eigenen WLAN benutzen.

## Bedienung

* **„nächstes ungehörtes"** (der große Knopf unten bzw. Taste `.`) springt zum
  nächsten Release mit Status `ungehoert` *nach der aktuellen Position*; am
  Listenende wird umgebrochen. Filter gelten dabei mit.
* **Filter** liegen auf dem Handy hinter dem Knopf *Filter* und fahren als
  Sheet über die Liste: Label/Sublabel, Ära, Jahr-Range, Status, „nur mit
  Video", dazu Freitextsuche über Artist, Titel, Katalognummer und Tracktitel.
* **Fortschritt** oben gesamt, darunter pro Ära (auf dem Handy seitlich
  wischbar).
* **Aufgeklappt:** Tracklist mit Play-Link je Track (sofern sich ein Video über
  Titelähnlichkeit zuordnen lässt), darunter die übrigen Release-Videos,
  weitere Versionen, Discogs-Link, Bewertung und Notizfeld (speichert selbst).
* **Tastatur** (am Rechner): `j`/`k` navigieren, `Enter` auf-/zuklappen,
  `g` gehört, `f` Favorit, `n` nochmal, `u` zurück auf ungehört,
  `.` nächstes ungehörtes, `/` Suche.

Filtereinstellungen bleiben im `localStorage` des Browsers. Ein Service Worker
cacht die Oberfläche (nicht die Daten), damit die Seite auch startet, wenn der
Server gerade nicht läuft.

## Discogs-Anbindung

* Auth per Personal Access Token aus `.env`, Header
  `Authorization: Discogs token=…`.
* Eigener `User-Agent` — ohne den antwortet Discogs mit 403.
* **Rate Limit:** `X-Discogs-Ratelimit-Remaining` wird ausgewertet. Solange
  mehr als 20 Requests im laufenden Fenster frei sind, läuft der Fetcher ohne
  Pause; darunter streckt er die verbleibenden über den Rest des Fensters
  (`60/remaining`, gedeckelt bei 10 s). 429 wird mit `Retry-After` abgewartet,
  5xx und Netzwerkfehler bis zu fünfmal mit 2/4/8/16 s wiederholt.
* `details` ist der eigentliche Grund für die Übung: `/releases/{id}` liefert
  das `videos`-Array mit den von Usern hinterlegten YouTube-Links. Damit
  entfällt die YouTube-Sucherei.

Einzelschritte, falls man nicht `all` will:

```bash
./ur labels                # Label + Sublabels (Red Planet, Somewhere In Detroit, …)
./ur releases              # /labels/{id}/releases, durchpaginiert
./ur details --limit 50    # der teure Schritt
./ur dedupe                # Hauptversion je Katalognummer neu bestimmen
./ur related               # Seed-Liste (X-101 ff.)
./ur stats
```

## Die zwei Fallstricke

**Duplikate.** Die Releaseliste eines Labels enthält massenhaft Repressings,
Länder-Varianten und CD-Ausgaben desselben Titels. Gruppiert wird nach
normalisierter Katalognummer; pro Gruppe gewinnt das früheste Jahr, bei
Gleichstand das bevorzugte Format (Default `Vinyl`), dann das bevorzugte Land
(Default `US`), zuletzt die kleinste Discogs-ID, damit das Ergebnis stabil
bleibt. Die anderen Versionen bleiben erhalten — sie hängen über `variant_of`
an der Hauptversion und lassen sich im Detail ausklappen. Formate und Länder
sind in `config.json` unter `dedupe` einstellbar; `./ur dedupe` rechnet neu.

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

| Schlüssel                 | Bedeutung                                            |
|---------------------------|------------------------------------------------------|
| `label.id`                | Discogs-Label-ID, von `find-label --pick` gesetzt    |
| `label.include_sublabels` | Sublabels mitziehen                                  |
| `user_agent`              | Pflicht bei Discogs                                  |
| `db`                      | Pfad zur SQLite-Datei                                |
| `dedupe`                  | bevorzugte Formate/Länder für die Hauptversion       |
| `eras`                    | Ära-Gruppierung, frei editierbar                     |
| `video_match_threshold`   | ab welcher Titelähnlichkeit ein Video als Track gilt |

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
Katalogreihenfolge mit Status und Videozähler. Unter Termux dafür einmal
`pkg install sqlite`:

```sql
sqlite3 urkatalog.db "SELECT catno_raw, artist, title, status, video_count
                      FROM v_katalog WHERE status = 'ungehoert' LIMIT 20;"
```

## Zweiter Schritt: verwandte Releases und Spotify

**Verwandte Releases.** `seeds/related.json` ist eine von Hand pflegbare Liste
für Platten der Crew, die nicht auf UR erschienen sind — X-101, X-102 und
X-103 auf Tresor. Jeder Eintrag hat `release_id`, `year` und `note`. Ist
`release_id` noch `null`, löst `./ur related` den Eintrag über die
Discogs-Suche auf, protokolliert die Treffer und schreibt die übernommene ID
in die Datei zurück — dort lässt sie sich korrigieren, falls die Suche
danebengegriffen hat. Die Releases erscheinen mit der angegebenen Jahreszahl
in der Timeline und sind in der Liste mit `✧` markiert.

**Spotify.** Nur der Suchteil, mit dem **Client-Credentials-Flow** (kein
User-Login):

```bash
./ur spotify --limit 100          # streambar? URI speichern
./ur spotify --playlist ur.m3u    # Katalogreihenfolge als M3U
```

Playlists direkt in Spotify anzulegen bräuchte den Authorization-Code-Flow mit
Scope `playlist-modify-private` und ist bewusst nicht enthalten; die M3U-Datei
mit den gefundenen Album-Links ist der Ersatz, bis das jemand braucht.

## Tests

```bash
pip install pytest      # auf dem Handy nur, wenn man wirklich testen will
python3 -m pytest tests -q
```

Die Tests laufen ohne Netz gegen ein Stück nachgebauter Discogs-API
(`tests/fake_discogs.py`) und decken Katalognummern-Parsing, Dublettenwahl,
Video-Zuordnung, Paginierung, Resume-Verhalten und die HTTP-Endpunkte ab —
inklusive der Zusicherung, dass ein erneuter Abgleich den Hörstatus stehen
lässt.

## Was die App nicht tut

Keine Audio-Dateien herunterladen oder lokal speichern — nur verlinken. Keine
Cloud, keine Accounts, keine Datenbank außer der lokalen SQLite.
