import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync, useProfile } from '../lib/store.jsx';
import { addDays, fmt, relativeDate } from '../lib/date.js';
import ProgressBar from '../components/ProgressBar.jsx';

function TargetReason({ day }) {
  if (day.trained) return <>Training an diesem Tag – Ziel nach <strong>faktor_training</strong>.</>;
  if (day.trained_yesterday) return <>Tag nach dem Training – die Proteinsynthese läuft noch, Ziel bleibt erhöht.</>;
  return <>Ruhetag – Ziel auf der Untergrenze <strong>faktor_ruhe</strong>.</>;
}

export default function Today() {
  const { user, today, revision, refresh } = useProfile();
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { data: day, loading } = useAsync(
    () => api.day({ user_id: user.id, date, today }),
    [user.id, date, today, revision]
  );

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !day) return <div className="empty">Lade …</div>;
  if (!day) return <div className="banner banner-error">{error ?? 'Tag konnte nicht geladen werden.'}</div>;

  const remaining = day.remaining_g;
  const reached = remaining <= 0;

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}

      <div className="card stack">
        <div className="row-between">
          <button className="btn-ghost btn-sm" onClick={() => setDate(addDays(date, -1))} aria-label="Vorheriger Tag">←</button>
          <div className="center">
            <div style={{ fontWeight: 600 }}>{relativeDate(date, today)}</div>
            {day.frozen && <span className="chip chip-frozen tiny">Ziel eingefroren</span>}
          </div>
          <button className="btn-ghost btn-sm" onClick={() => setDate(addDays(date, 1))}
                  aria-label="Nächster Tag">→</button>
        </div>

        <div className="hero">
          <span className="hero-value tabular" style={{ color: reached ? 'var(--good-text)' : undefined }}>
            {fmt(Math.abs(remaining))}
          </span>
          <span className="hero-unit">g {reached ? 'über dem Ziel' : 'fehlen noch'}</span>
        </div>

        <ProgressBar eaten={day.eaten_g} planned={day.planned_g} target={day.target_g} />

        <div className="row-between small">
          <span><strong className="tabular">{fmt(day.eaten_g)} g</strong> <span className="muted">gegessen</span></span>
          {day.planned_g > 0 && (
            <span><strong className="tabular">{fmt(day.planned_g)} g</strong> <span className="muted">geplant</span></span>
          )}
          <span><strong className="tabular">{fmt(day.target_g)} g</strong> <span className="muted">Ziel</span></span>
        </div>

        {day.planned_g > 0 && (
          <p className="tiny muted" style={{ margin: 0 }}>
            Mit allem Geplanten {day.remaining_after_planned_g <= 0
              ? `wärst du ${fmt(Math.abs(day.remaining_after_planned_g))} g über dem Ziel.`
              : `fehlen noch ${fmt(day.remaining_after_planned_g)} g.`}
          </p>
        )}
      </div>

      <div className="card stack">
        <div className="row-between">
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Training</div>
            <p className="tiny muted" style={{ margin: '2px 0 0' }}><TargetReason day={day} /></p>
          </div>
          <button
            className={day.trained ? 'primary' : ''}
            aria-pressed={day.trained}
            disabled={busy}
            onClick={() => act(() => api.toggleWorkout({ user_id: user.id, date }))}
          >
            {day.trained ? 'Trainiert ✓' : 'Eintragen'}
          </button>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>
          {fmt(day.weight_kg, 1)} kg × {fmt(day.target_g / day.weight_kg, 2)} g/kg = {fmt(day.target_g)} g
        </p>
      </div>

      <div className="card">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Einträge</h2>
          <Link className="btn btn-sm primary" to="/eintragen">+ Hinzufügen</Link>
        </div>

        {day.entries.length === 0 ? (
          <p className="empty">Noch nichts erfasst.</p>
        ) : (
          <div className="list">
            {day.entries.map((e) => (
              <div key={e.id} className={`entry${e.status === 'planned' ? ' entry-planned' : ''}`}>
                <div className="grow">
                  <div className="row" style={{ gap: 6 }}>
                    <span className="truncate entry-name">{e.product_name}</span>
                    {e.status === 'planned' && <span className="chip chip-planned tiny">geplant</span>}
                  </div>
                  <div className="tiny muted">
                    {e.brand ? `${e.brand} · ` : ''}{fmt(e.amount_g)} g
                  </div>
                </div>
                <strong className="tabular">{fmt(e.protein_g, 1)} g</strong>

                {e.status === 'planned' && (
                  <button className="btn-sm" disabled={busy}
                          title="Als gegessen markieren"
                          onClick={() => act(() => api.updateEntry(e.id, { status: 'eaten' }))}>
                    ✓
                  </button>
                )}
                <button className="btn-sm btn-ghost btn-danger" disabled={busy}
                        aria-label={`${e.product_name} entfernen`}
                        onClick={() => act(() => api.deleteEntry(e.id))}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
