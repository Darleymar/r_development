import { fmt } from '../lib/date.js';

/**
 * Gegessen solide, geplant schraffiert – beide relativ zum Tagesziel.
 * Ueber dem Ziel waechst der Balken nicht weiter, der Ueberschuss wird
 * als eigener Abschnitt in der Statusfarbe gezeigt.
 */
export default function ProgressBar({ eaten, planned, target }) {
  const scale = Math.max(target, eaten + planned, 1);
  const eatenPct = Math.min(eaten, target) / scale * 100;
  const overPct = Math.max(0, eaten - target) / scale * 100;
  const plannedPct = Math.min(planned, Math.max(0, scale - eaten)) / scale * 100;

  return (
    <div
      className="progress"
      role="img"
      aria-label={`${fmt(eaten)} g gegessen, ${fmt(planned)} g geplant, Ziel ${fmt(target)} g`}
    >
      <div className="progress-eaten" style={{ width: `${eatenPct}%` }} />
      {overPct > 0 && <div className="progress-over" style={{ width: `${overPct}%` }} />}
      {plannedPct > 0 && <div className="progress-planned" style={{ width: `${plannedPct}%` }} />}
    </div>
  );
}
