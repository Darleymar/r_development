import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync, useProfile } from '../lib/store.jsx';
import { fmt } from '../lib/date.js';
import HistoryChart from '../components/HistoryChart.jsx';

function Attainment({ label, stats, hint }) {
  return (
    <div className="stack" style={{ gap: 3 }}>
      <span className="tiny muted">{label}</span>
      {stats.days === 0 ? (
        <span className="secondary small">keine Tage im Zeitraum</span>
      ) : (
        <>
          <span className="tabular" style={{ fontSize: 24, fontWeight: 620, lineHeight: 1.1 }}>
            {stats.pct} %
          </span>
          <span className="tiny muted">
            {stats.hit} von {stats.days} Tagen · im Schnitt {fmt(stats.avg_attainment_pct)} % des Ziels
          </span>
        </>
      )}
      {hint && <span className="tiny muted">{hint}</span>}
    </div>
  );
}

export default function History() {
  const { user, today, revision } = useProfile();
  const [days, setDays] = useState(14);

  const { data, loading, error } = useAsync(
    () => api.history({ user_id: user.id, days, today }),
    [user.id, days, today, revision]
  );

  if (loading && !data) return <div className="empty">Lade …</div>;
  if (error) return <div className="banner banner-error">{error}</div>;
  if (!data) return null;

  const { rolling7, achievement } = data;
  const trainingBehind =
    achievement.training_adjacent.pct !== null &&
    achievement.rest.pct !== null &&
    achievement.training_adjacent.pct + 15 < achievement.rest.pct;

  return (
    <>
      <div className="card stack">
        <h2>Rollierender 7-Tage-Schnitt</h2>
        <div className="hero">
          <span className="hero-value tabular">{fmt(rolling7.avg_eaten_g)}</span>
          <span className="hero-unit">g / Tag</span>
        </div>
        <div className="row-between small secondary">
          <span>Ziel im selben Fenster <strong className="tabular">{fmt(rolling7.avg_target_g)} g</strong></span>
          <span className="tabular" style={{ color: rolling7.pct >= 100 ? 'var(--good-text)' : undefined }}>
            {rolling7.pct} %
          </span>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>
          {fmt(rolling7.avg_eaten_g_per_kg, 2)} g/kg gegenüber {fmt(rolling7.avg_target_g_per_kg, 2)} g/kg Ziel.
          Rollierend statt Kalenderwoche – bei schwankender Trainingsfrequenz aussagekräftiger.
        </p>
      </div>

      <div className="card stack">
        <div className="row-between">
          <h2 style={{ margin: 0 }}>Protein gegen Tagesziel</h2>
          <div className="segmented" role="group" aria-label="Zeitraum">
            {[14, 30].map((n) => (
              <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>
                {n} Tage
              </button>
            ))}
          </div>
        </div>
        <HistoryChart days={data.days} />
      </div>

      <div className="card stack">
        <h2>Zielerreichung nach Tagtyp</h2>
        <div className="field-row" style={{ gap: 18 }}>
          <Attainment label="Trainingsnahe Tage" stats={achievement.training_adjacent} />
          <Attainment label="Ruhetage" stats={achievement.rest} />
        </div>

        {trainingBehind && (
          <div className="banner banner-warn">
            An trainingsnahen Tagen wird das Ziel deutlich seltener erreicht als an Ruhetagen –
            dort liegt es auch höher. Eine feste Portion an Trainingstagen einplanen.
          </div>
        )}

        <p className="tiny muted" style={{ margin: 0 }}>
          Der laufende Tag ist noch unvollständig und bleibt in dieser Quote außen vor.
        </p>
      </div>
    </>
  );
}
