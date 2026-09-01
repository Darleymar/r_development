# Protein-Tracker

Prototyp zum Erfassen der täglichen Proteinaufnahme für Krafttraining. Der
Tagesbedarf ist nicht konstant, sondern hängt davon ab, ob an diesem oder am
Vortag trainiert wurde.

Die App läuft **vollständig im Gerät**: kein Server, kein Konto, keine
Übertragung. Alle Daten liegen lokal in einer SQLite-Datenbank, die als
WebAssembly im Browser beziehungsweise in der Android-App läuft.

## Schnellstart

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 36 Tests, Schwerpunkt Bedarfslogik
```

Zum Ausprobieren unter *Profil → Daten → Demodaten laden* drei Wochen
Beispielverlauf erzeugen.

| Befehl | Wirkung |
|---|---|
| `npm run dev` | Entwicklungsserver |
| `npm run build` | Baut nach `web/dist` |
| `npm test` | Tests des Kerns |
| `npm run android:sync` | Baut und überträgt ins Android-Projekt |
| `npm run android:apk` | Baut die Debug-APK (Android SDK nötig) |
| `npm run android:open` | Öffnet das Projekt in Android Studio |

## Die Bedarfsrechnung

Der Kern steht in [`core/src/targets.js`](core/src/targets.js):

```
trainingsnah = (Trainingseinheit an D) ODER (Trainingseinheit an D-1)
faktor       = trainingsnah ? faktor_training : faktor_ruhe
tagesziel_g  = koerpergewicht_kg * faktor
```

Voreinstellung 2,0 g/kg für trainingsnahe Tage, 1,6 g/kg sonst, pro Profil
änderbar.

**`faktor_ruhe` ist eine Untergrenze.** Das Ziel sinkt nie darunter, auch nicht
nach Wochen ohne Training – in solchen Phasen ist Protein für den Muskelerhalt
eher wichtiger. Umgesetzt als `max(gewählter Faktor, faktor_ruhe)`, damit selbst
eine verdrehte Konfiguration (`faktor_training < faktor_ruhe`) den Boden nicht
unterläuft.

Weil sich das Ziel aus tatsächlich geloggten Einheiten ergibt und nicht aus
einem festen Wochenplan, passt es sich der realen Frequenz an:

| Einheiten/Woche | erhöhte Tage | Wochenschnitt |
|---|---|---|
| 3 | bis 6 | 1,94 g/kg |
| 2 | 4 | 1,83 g/kg |
| 1 | 2 | 1,71 g/kg |

Diese drei Werte sind als Test hinterlegt.

### Einfrieren

Ein Tagesziel wird beim Tageswechsel in `daily_targets` persistiert und danach
nicht mehr neu berechnet. Wer eine Einheit nachträglich für einen vergangenen
Tag einträgt, ändert damit nichts mehr an abgeschlossenen Zielen – sonst wäre
die Historie für Auswertungen unbrauchbar.

- **Heute** wird live gerechnet und als Zeile mit `frozen = 0` gehalten.
- **Vergangene Tage** friert der erste Zugriff nach Mitternacht ein,
  begrenzt auf 400 Tage rückwirkend.
- **Zukünftige Tage** werden für die Planung gerechnet, aber nicht gespeichert.

Datumsarithmetik läuft über UTC-Mittag, damit Sommerzeitwechsel keine Tage
verschieben.

## Aufbau

```
core/     Schema, Bedarfslogik und Datenzugriff – ohne Laufzeitabhängigkeiten
  src/targets.js     Bedarfsrechnung und Einfrieren
  src/schema.sql     Tabellen
  src/repo/          Profile, Produkte, Vorlagen, Trainings, Log, Auswertung
  src/backup.js      Export und Import
  test/              36 Tests
web/      React + Vite als PWA
  src/lib/sqlite-adapter.js   SQLite-WebAssembly hinter der better-sqlite3-Schnittstelle
  src/lib/db.js               Datenbank im Gerät, gesichert in IndexedDB
  src/screens/                Heute, Eintragen, Produkte, Vorlagen, Verlauf, Profil
android/  Capacitor-Projekt für die APK
```

### Warum ein eigenes `core`

`core` ist gegen die synchrone Schnittstelle von `better-sqlite3` geschrieben.
Im Gerät liegt darunter [sql.js](https://sql.js.org/) – SQLite als
WebAssembly – über einen Adapter mit derselben Schnittstelle
(`web/src/lib/sqlite-adapter.js`).

Dadurch laufen die Tests unter Node gegen echtes SQLite und prüfen exakt den
Code, den auch die App ausführt. Es gibt keine zweite Fassung der Logik, die
auseinanderlaufen könnte.

Gespeichert wird die SQLite-Datei als Ganzes in IndexedDB, gebündelt nach
Schreibvorgängen und zusätzlich beim Wegschalten der App.

## Funktionen

- **Heute** – Fortschritt (gegessen solide, geplant schraffiert), Ziel, Rest,
  Einträge, Trainings-Toggle. Geplant wird mit einem Tap zu gegessen.
- **Eintragen** – Barcode scannen, Bibliothek durchsuchen oder manuell anlegen;
  danach Menge und Status. Auch für kommende Tage planbar.
- **Produkte** – gemeinsame Bibliothek beider Profile, sortiert nach Favoriten,
  Häufigkeit und letzter Verwendung. Beim ersten Start bereits mit über 100
  Grundnahrungsmitteln gefüllt.
- **Vorlagen** – wiederkehrende Kombinationen mit einem Tap loggen.
- **Verlauf** – rollierender 7-Tage-Schnitt, Balkendiagramm gegen das jeweilige
  Tagesziel, Zielerreichung getrennt nach Tagtyp.
- **Profil** – Umschalten, Gewicht, Gewichtsverlauf, Faktoren, Sicherung.

### Sicherung

Weil die Daten nur auf dem Gerät liegen, ist der Export unter *Profil → Daten*
die einzige Absicherung gegen Geräteverlust – und zugleich der Weg auf ein
zweites Gerät. Der Import ersetzt den gesamten Bestand; schlägt er fehl, bleibt
der bisherige Stand unangetastet.

### Woher die Nährwerte kommen

Drei Quellen, in dieser Reihenfolge:

1. **Eingebauter Grundstock.** Über 100 gängige Lebensmittel sind ab dem ersten
   Start in der Bibliothek – Haferflocken, Sojadrink, Quark, Linsen, Tofu,
   Hähnchenbrust und so weiter, mit Protein, kcal und üblicher Portionsgröße.
   Damit lässt sich ein Porridge loggen, ohne eine Packung zur Hand zu haben
   oder Nährwerte abzutippen. Die Liste steht in
   [`core/src/foods.js`](core/src/foods.js).

   Es sind **Richtwerte für die übliche Zusammensetzung**, keine Angaben zu
   einem bestimmten Markenprodukt, und sie sind jederzeit editierbar. Wer es
   genauer braucht, überschreibt sie mit der Packungsangabe. Unter
   *Profil → Daten → Grundnahrungsmittel ergänzen* lassen sich fehlende
   Einträge nachtragen; vorhandene und selbst angepasste Produkte bleiben
   dabei unangetastet.

2. **Barcode-Scan** für konkrete Markenprodukte (siehe unten).

3. **Namenssuche bei Open Food Facts**, wenn die Packung nicht zur Hand ist.
   Im Eintragen-Screen unterhalb der Bibliothekssuche. Braucht als Einziges
   eine Verbindung; Treffer ohne Proteinwert werden als solche gekennzeichnet
   und ans Ende sortiert.

Jedes einmal erfasste Produkt landet in der Bibliothek und ist danach ohne
erneutes Nachschlagen verfügbar.

### Barcode-Scan

Bevorzugt die native `BarcodeDetector`-API, sonst `@zxing/browser` als eigener
Chunk. Der Ablauf:

1. Ist der Code schon in der Bibliothek, gewinnt der eigene Eintrag.
2. Sonst wird Open Food Facts gefragt und die Werte **als Vorbelegung eines
   editierbaren Formulars** übernommen. Die Datenqualität dort schwankt; fehlt
   der Proteinwert, sagt die App das und verlangt eine Eingabe, statt einen
   Wert zu erfinden.
3. Unbekannte oder nicht erreichbare Codes führen direkt ins Anlegeformular,
   der Barcode ist vorbelegt.

Das ist der einzige Teil, der eine Verbindung braucht. Ohne Netz funktioniert
alles andere unverändert weiter.

Im Browser ist für den Kamerazugriff HTTPS nötig (localhost ausgenommen); in
der Android-App entfällt das, weil die Inhalte aus dem App-Paket kommen.

## Auf das Handy bringen

Zwei Wege. Beide brauchen keinen laufenden Server – die App und ihre Daten
liegen anschließend vollständig auf dem Gerät.

### Weg 1: als installierte Web-App (ohne Android Studio, auch für iPhone)

Der gebaute Ordner `web/dist` ist eine rein statische Seite und läuft auf
jedem statischen Speicherort, auch in einem Unterverzeichnis.

Am einfachsten über GitHub Pages:

1. Im Repository unter **Settings → Pages** die *Source* auf
   „GitHub Actions“ stellen.
2. Unter **Actions → „Protein-Tracker veröffentlichen“ → Run workflow**
   den Build starten. Der Workflow ist bewusst nur manuell auslösbar –
   ohne diesen Klick geht nichts online.
3. Die angezeigte Adresse auf dem Handy öffnen und zum Startbildschirm
   hinzufügen: in Chrome über *Menü → App installieren*, in Safari über
   *Teilen → Zum Home-Bildschirm*.

Danach startet die App wie eine installierte App, im Vollbild und ohne
Adressleiste. Ab dem ersten Öffnen läuft sie offline weiter.

Veröffentlicht wird dabei nur das Programm. Ihre Einträge entstehen erst auf
dem Gerät und werden nie übertragen – die Seite kennt sie nicht.

### Weg 2: als APK

Das Android-Projekt liegt fertig konfiguriert unter `android/` – mit
Kameraberechtigung, App-Icons und passender Anwendungs-ID. Nötig ist ein
Android SDK, am einfachsten über
[Android Studio](https://developer.android.com/studio):

```bash
npm install
npm run android:apk
```

Die Datei liegt anschließend unter
`android/app/build/outputs/apk/debug/app-debug.apk` und lässt sich per USB
oder Dateiübertragung aufs Handy bringen. Zum Installieren muss dort einmalig
„Apps aus dieser Quelle zulassen“ aktiviert werden.

Für den ersten Lauf ist `npm run android:open` bequemer, weil Android Studio
fehlende SDK-Teile selbst nachlädt.

Nach jeder Änderung am Frontend `npm run android:sync` ausführen, damit das
Android-Projekt den neuen Stand bekommt. Für eine signierte Release-APK gilt
der übliche Weg über einen eigenen Keystore (`./gradlew assembleRelease`);
Keystores sind über `.gitignore` ausgeschlossen.

### Welcher Weg wofür

| | Web-App | APK |
|---|---|---|
| Aufwand | ein Klick im Repository | Android Studio einrichten |
| Geräte | Android, iPhone, Desktop | nur Android |
| Kamera-Scan | ja (über HTTPS) | ja |
| Offline | ja, ab dem ersten Öffnen | ja |
| Aktualisieren | von selbst beim Öffnen | neue APK installieren |

## Bewusst nicht enthalten

Kalorien- und Makro-Auswertung über Protein hinaus (die Felder sind da),
Authentifizierung, Abgleich zwischen Geräten, Übungs- und Volumen-Tracking,
Rezeptimport, Foto-Erkennung, Wearable-Anbindung.

Da jedes Gerät seine eigenen Daten hält, ist die gemeinsame Produktbibliothek
auf ein geteiltes Gerät beschränkt. Für zwei Geräte ist der Export/Import der
vorgesehene Weg.

## Hinweis

Die Voreinstellungen orientieren sich am Bereich 1,6–2,2 g/kg, der für
Kraftsport gut belegt ist (u. a. Morton et al., 2018). Bei Nierenerkrankungen
oder anderen Vorerkrankungen gelten andere Werte – das ist eine Frage für eine
ärztliche oder ernährungsmedizinische Beratung, nicht für diese App.
