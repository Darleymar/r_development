import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { getPersistError } from '../lib/db.js';
import { todayISO } from '../lib/date.js';

/**
 * Sicherung und Wiederherstellung.
 *
 * Die Daten liegen ausschliesslich auf diesem Geraet. Ohne Export waere ein
 * verlorenes, getauschtes oder zurueckgesetztes Handy gleichbedeutend mit
 * verlorenen Daten – und der Export ist zugleich der Weg auf ein zweites Geraet.
 */
export default function DataSection({ onChanged }) {
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const persistError = getPersistError();

  const run = async (label, fn) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const exportBackup = () => run('export', async () => {
    const backup = await api.exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `protein-tracker-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const rows = Object.values(backup.data).reduce((s, list) => s + list.length, 0);
    setNotice(`Sicherung mit ${rows} Datensätzen erstellt.`);
  });

  const importBackup = (file) => run('import', async () => {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Die Datei ist kein lesbares JSON.');
    }
    const counts = await api.importBackup(parsed);
    const rows = Object.values(counts).reduce((s, n) => s + n, 0);
    setNotice(`${rows} Datensätze eingespielt. Der bisherige Stand wurde ersetzt.`);
    onChanged?.();
  });

  return (
    <div className="card stack">
      <h2>Daten</h2>

      {persistError && <div className="banner banner-warn">⚠ {persistError}</div>}
      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="banner">{notice}</div>}

      <p className="tiny muted" style={{ margin: 0 }}>
        Alles bleibt auf diesem Gerät – nichts wird irgendwohin übertragen. Damit ist die
        Sicherung Ihre einzige Absicherung gegen einen Geräteverlust und zugleich der Weg
        auf ein zweites Gerät.
      </p>

      <div className="field-row">
        <button onClick={exportBackup} disabled={busy !== null}>
          {busy === 'export' ? 'Erstellt …' : 'Sicherung exportieren'}
        </button>
        <button onClick={() => fileInput.current?.click()} disabled={busy !== null}>
          {busy === 'import' ? 'Liest …' : 'Sicherung einspielen'}
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) importBackup(file);
        }}
      />

      <p className="tiny muted" style={{ margin: 0 }}>
        Ein Einspielen ersetzt den gesamten aktuellen Stand. Schlägt es fehl, bleibt der
        bisherige Stand unangetastet.
      </p>

      <hr style={{ border: 'none', borderTop: '1px solid var(--grid)', margin: '2px 0' }} />

      <div className="field-row">
        <button
          onClick={() => run('demo', async () => {
            const n = await api.loadDemoData(todayISO());
            setNotice(`${n} Beispiel-Einträge für die letzten drei Wochen geladen.`);
            onChanged?.();
          })}
          disabled={busy !== null}
        >
          {busy === 'demo' ? 'Lädt …' : 'Demodaten laden'}
        </button>

        <button
          className={confirmReset ? 'btn-danger' : 'btn-ghost btn-danger'}
          disabled={busy !== null}
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              setNotice(null);
              return;
            }
            setConfirmReset(false);
            run('reset', async () => {
              await api.resetAll();
              setNotice('Alle Daten wurden gelöscht.');
              onChanged?.();
            });
          }}
        >
          {confirmReset ? 'Wirklich alles löschen?' : 'Alles zurücksetzen'}
        </button>
      </div>

      <p className="tiny muted" style={{ margin: 0 }}>
        Demodaten und Zurücksetzen ersetzen ebenfalls den kompletten Bestand.
      </p>
    </div>
  );
}
