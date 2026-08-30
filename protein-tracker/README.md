# Protein-Tracker

Prototyp zum Erfassen der täglichen Proteinaufnahme für zwei Nutzer im
Krafttraining. Der Tagesbedarf ist nicht konstant, sondern hängt davon ab, ob
an diesem oder am Vortag trainiert wurde.

## Schnellstart

```bash
npm install
npm run seed      # optional: Demodaten für die letzten drei Wochen
npm run dev       # API auf :3001, Frontend auf :5173
```

Für einen einzelnen Prozess im Heimnetz:

```bash
npm run build && npm start   # Server liefert API und gebautes Frontend auf :3001
```

| Befehl | Wirkung |
|---|---|
| `npm run dev` | API und Vite-Dev-Server parallel |
| `npm run build` | Frontend nach `web/dist` bauen |
| `npm start` | API inkl. gebautem Frontend auf `:3001` |
| `npm test` | 31 Tests, Schwerpunkt Bedarfslogik |
| `npm run seed` | Demodaten (überschreibt Bewegungsdaten) |

Die Datenbank liegt als SQLite-Datei unter `server/data/protein.db`
(`PT_DB` setzt einen anderen Pfad).

## Die Bedarfsrechnung

Der Kern steht in [`server/src/targets.js`](server/src/targets.js):

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

Diese drei Werte sind als Test hinterlegt (`test/targets.test.js`).

### Einfrieren

Ein Tagesziel wird beim Tageswechsel in `daily_targets` persistiert und danach
nicht mehr neu berechnet. Wer eine Einheit nachträglich für einen vergangenen
Tag einträgt, ändert damit nichts mehr an abgeschlossenen Zielen – sonst wäre
die Historie für Auswertungen unbrauchbar.

- **Heute** wird live gerechnet und als Zeile mit `frozen = 0` gehalten.
- **Vergangene Tage** friert der erste Zugriff nach Mitternacht ein
  (`freezePastTargets`), begrenzt auf 400 Tage rückwirkend.
- **Zukünftige Tage** werden für die Planung gerechnet, aber nicht gespeichert.

Datumsarithmetik läuft über UTC-Mittag, damit Sommerzeitwechsel keine Tage
verschieben. Das Gerät schickt sein lokales Datum als `today` mit, damit eine
abweichende Server-Zeitzone den Tageswechsel nicht verrückt.

## Aufbau

```
server/   Express + SQLite (better-sqlite3)
  src/targets.js     Bedarfslogik und Einfrieren
  src/schema.sql     Tabellen
  src/routes/        Profile, Produkte, Vorlagen, Trainings, Log, Auswertung, OFF-Proxy
  test/              31 Tests
web/      React + Vite als PWA
  src/screens/       Heute, Eintragen, Produkte, Vorlagen, Verlauf, Profil
  src/components/    Fortschritt, Scanner, Formulare, Diagramm
```

## Funktionen

- **Heute** – Fortschritt (gegessen solide, geplant schraffiert), Ziel, Rest,
  Einträge, Trainings-Toggle. Geplant wird mit einem Tap zu gegessen.
- **Eintragen** – Barcode scannen, Bibliothek durchsuchen oder manuell anlegen;
  danach Menge und Status. Auch für kommende Tage planbar.
- **Produkte** – gemeinsame Bibliothek beider Profile, sortiert nach Favoriten,
  Häufigkeit und letzter Verwendung.
- **Vorlagen** – wiederkehrende Kombinationen mit einem Tap loggen.
- **Verlauf** – rollierender 7-Tage-Schnitt, Balkendiagramm gegen das jeweilige
  Tagesziel, Zielerreichung getrennt nach trainingsnahen Tagen und Ruhetagen.
- **Profil** – Umschalten, Gewicht, Gewichtsverlauf, Faktoren. Keine
  Authentifizierung, wie für den Prototyp vorgesehen.

### Barcode-Scan

Bevorzugt die native `BarcodeDetector`-API, sonst wird `@zxing/browser`
nachgeladen (eigener Chunk, nur beim Scannen). Der Lookup läuft über
`GET /api/off/:barcode`:

1. Ist der Code schon in der Bibliothek, gewinnt der eigene Eintrag.
2. Sonst fragt der Server Open Food Facts und **übernimmt die Werte als
   Vorbelegung eines editierbaren Formulars**. Die Datenqualität dort schwankt;
   fehlt der Proteinwert, sagt die App das und verlangt eine Eingabe, statt
   einen Wert zu erfinden.
3. Unbekannte oder nicht erreichbare Codes führen direkt ins Anlegeformular,
   der Barcode ist vorbelegt.

Kamerazugriff funktioniert im Browser nur über HTTPS (localhost ausgenommen).
Als Rückfalltür gibt es immer die manuelle Eingabe des Codes.

### HTTPS im Heimnetz

```bash
mkcert -install && mkcert 192.168.1.42 localhost      # eigene IP einsetzen
PT_TLS_CERT=cert.pem PT_TLS_KEY=key.pem npm start     # zusätzlich auf :3443
```

Für den Dev-Server dieselben Dateien als `web/certs/cert.pem` und
`web/certs/key.pem` ablegen – Vite startet dann automatisch mit TLS.

## Bewusst nicht enthalten

Kalorien- und Makro-Auswertung über Protein hinaus (die Felder sind da),
Authentifizierung, Cloud-Sync, Übungs- und Volumen-Tracking, Rezeptimport,
Foto-Erkennung, Wearable-Anbindung.

## Hinweis

Die Voreinstellungen orientieren sich am Bereich 1,6–2,2 g/kg, der für
Kraftsport gut belegt ist (u. a. Morton et al., 2018). Bei Nierenerkrankungen
oder anderen Vorerkrankungen gelten andere Werte – das ist eine Frage für eine
ärztliche oder ernährungsmedizinische Beratung, nicht für diese App.
