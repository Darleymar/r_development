import { useState } from 'react';
import { fmt, shortDate, weekday, longDate } from '../lib/date.js';

const M = { top: 14, right: 20, bottom: 38, left: 36 };
const HEIGHT = 210;
const PITCH_MIN = 17;
const BAR_GAP = 2;      // 2px Flaechenabstand zwischen benachbarten Balken
const CORNER = 4;       // gerundete Datenenden, am Nullpunkt verankert

/** Balken mit gerundeter Oberkante, unten buendig auf der Grundlinie. */
function barPath(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(CORNER, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y}`
       + ` L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function niceStep(max) {
  for (const step of [10, 20, 25, 50, 100, 200]) {
    if (max / step <= 5) return step;
  }
  return 500;
}

/**
 * Taegliches Protein gegen das jeweilige Tagesziel.
 *
 * Das Ziel ist keine waagerechte Linie, sondern eine Treppe – genau das ist
 * der Punkt der App: an trainingsnahen Tagen liegt es hoeher. Trainingstage
 * sind zusaetzlich unter der Achse markiert, damit die Stufen erklaerbar sind.
 */
export default function HistoryChart({ days }) {
  const [hover, setHover] = useState(null);
  const [showTable, setShowTable] = useState(false);

  if (!days || days.length === 0) {
    return <p className="empty">Noch keine Daten für diesen Zeitraum.</p>;
  }

  const plotW = Math.max(300, days.length * PITCH_MIN);
  const width = plotW + M.left + M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const pitch = plotW / days.length;
  const barW = Math.max(4, pitch - BAR_GAP);

  const rawMax = Math.max(...days.map((d) => Math.max(d.eaten_g, d.target_g)), 1);
  const step = niceStep(rawMax);
  const yMax = Math.ceil((rawMax * 1.08) / step) * step;
  const y = (v) => M.top + plotH - (v / yMax) * plotH;
  const xCenter = (i) => M.left + i * pitch + pitch / 2;
  const axisY = M.top + plotH;

  const ticks = [];
  for (let v = 0; v <= yMax; v += step) ticks.push(v);

  // Treppenlinie des Tagesziels.
  const targetPath = days
    .map((d, i) => {
      const x0 = M.left + i * pitch;
      const x1 = x0 + pitch;
      return `${i === 0 ? 'M' : 'L'}${x0},${y(d.target_g)} L${x1},${y(d.target_g)}`;
    })
    .join(' ');

  // Beschriftung ausduennen und am letzten Tag verankern – so bleibt der
  // Abstand gleichmaessig und das Datum ganz rechts kollidiert mit nichts.
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotW / 42))));
  const isLabelled = (i) => (days.length - 1 - i) % labelEvery === 0;
  const active = hover !== null ? days[hover] : null;

  return (
    <div className="stack">
      <div className="chart-legend">
        <span className="legend-item"><span className="legend-swatch" /> Protein gegessen</span>
        <span className="legend-item"><span className="legend-line" /> Tagesziel</span>
        <span className="legend-item"><span className="legend-dot" /> Training</span>
      </div>
      {days.some((d) => d.eaten_g > 0) && (
        <p className="tiny muted" style={{ margin: '-4px 0 0' }}>
          Der Balken ganz rechts ist der laufende Tag und damit noch unvollständig.
        </p>
      )}

      <div className="chart-wrap">
        <div className="chart-scroll">
          <svg
            className="chart"
            viewBox={`0 0 ${width} ${HEIGHT}`}
            style={{ minWidth: width }}
            height={HEIGHT}
            role="img"
            aria-label={`Protein je Tag gegenüber dem Tagesziel, ${days.length} Tage. Werte als Tabelle unterhalb des Diagramms.`}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line className="grid-line" x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} />
                <text className="tick" x={M.left - 6} y={y(v) + 3.5} textAnchor="end">{v}</text>
              </g>
            ))}

            {days.map((d, i) => (
              <path key={`bar-${d.date}`} className="bar"
                    d={barPath(M.left + i * pitch + BAR_GAP / 2, y(d.eaten_g), barW, axisY - y(d.eaten_g))} />
            ))}

            <path className="target-step" d={targetPath} />
            <line className="axis-line" x1={M.left} x2={width - M.right} y1={axisY} y2={axisY} />

            {days.map((d, i) => (
              d.trained ? <circle key={`w-${d.date}`} className="workout-dot" cx={xCenter(i)} cy={axisY + 9} r={3} /> : null
            ))}

            {days.map((d, i) => (
              isLabelled(i) ? (
                <text key={`x-${d.date}`} className="tick" x={xCenter(i)} y={axisY + 26} textAnchor="middle">
                  {shortDate(d.date)}
                </text>
              ) : null
            ))}

            {/* Trefferflaechen fuer Hover, Touch und Tastatur – breiter als der Balken. */}
            {days.map((d, i) => (
              <rect
                key={`hit-${d.date}`}
                className={`hover-band${hover === i ? ' on' : ''}`}
                x={M.left + i * pitch}
                y={M.top}
                width={pitch}
                height={plotH}
                tabIndex={0}
                role="button"
                aria-label={`${longDate(d.date)}: ${fmt(d.eaten_g)} von ${fmt(d.target_g)} Gramm`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onFocus={() => setHover(i)}
                onBlur={() => setHover((h) => (h === i ? null : h))}
                onTouchStart={() => setHover(i)}
              />
            ))}
          </svg>
        </div>

        {active && (
          <div
            className="tooltip"
            style={{
              left: `clamp(0px, ${(xCenter(hover) / width) * 100}% - 80px, calc(100% - 168px))`,
              top: 0,
            }}
          >
            <strong>{weekday(active.date)}, {shortDate(active.date)}</strong>
            <dl style={{ margin: '4px 0 0', display: 'grid', gridTemplateColumns: 'auto auto', gap: '1px 10px' }}>
              <dt>Gegessen</dt><dd style={{ margin: 0, textAlign: 'right' }} className="tabular">{fmt(active.eaten_g)} g</dd>
              {active.planned_g > 0 && (<>
                <dt>Geplant</dt><dd style={{ margin: 0, textAlign: 'right' }} className="tabular">{fmt(active.planned_g)} g</dd>
              </>)}
              <dt>Ziel</dt><dd style={{ margin: 0, textAlign: 'right' }} className="tabular">{fmt(active.target_g)} g</dd>
              <dt>Erreicht</dt><dd style={{ margin: 0, textAlign: 'right' }} className="tabular">{active.pct} %</dd>
            </dl>
            <div className="tiny muted" style={{ marginTop: 4 }}>
              {active.trained ? 'Training' : active.was_training_adjacent ? 'Tag nach Training' : 'Ruhetag'}
            </div>
          </div>
        )}
      </div>

      <button type="button" className="btn-ghost btn-sm" onClick={() => setShowTable((v) => !v)}
              aria-expanded={showTable}>
        {showTable ? 'Tabelle ausblenden' : 'Werte als Tabelle'}
      </button>

      {showTable && (
        <div style={{ overflowX: 'auto' }}>
          <table className="data">
            <caption className="tiny muted" style={{ captionSide: 'bottom', textAlign: 'left', paddingTop: 6 }}>
              Dieselben Werte wie im Diagramm.
            </caption>
            <thead>
              <tr>
                <th scope="col">Tag</th>
                <th scope="col">Gegessen</th>
                <th scope="col">Ziel</th>
                <th scope="col">%</th>
                <th scope="col">Typ</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date}>
                  <th scope="row" style={{ fontWeight: 400 }}>{weekday(d.date)} {shortDate(d.date)}</th>
                  <td>{fmt(d.eaten_g)} g</td>
                  <td>{fmt(d.target_g)} g</td>
                  <td>{d.pct} %</td>
                  <td style={{ textAlign: 'left' }}>
                    {d.trained ? 'Training' : d.was_training_adjacent ? 'Folgetag' : 'Ruhe'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
