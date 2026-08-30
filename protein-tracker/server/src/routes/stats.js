import { Router } from 'express';
import { h, num, date, userId, clientToday, round1 } from '../util.js';
import { addDays, dateRange, daysBetween, freezePastTargets, getTarget, weightOn } from '../targets.js';

/** Protein je Tag und Status ueber einen Zeitraum. */
function proteinByDate(db, userId, from, to) {
  const rows = db.prepare(
    `SELECT l.date, l.status, SUM(l.amount_g / 100.0 * p.protein_per_100g) AS protein
       FROM log_entries l JOIN products p ON p.id = l.product_id
      WHERE l.user_id = ? AND l.date BETWEEN ? AND ?
      GROUP BY l.date, l.status`
  ).all(userId, from, to);

  const map = new Map();
  for (const row of rows) {
    const day = map.get(row.date) ?? { eaten_g: 0, planned_g: 0 };
    if (row.status === 'eaten') day.eaten_g = round1(row.protein);
    else day.planned_g = round1(row.protein);
    map.set(row.date, day);
  }
  return map;
}

function workoutDates(db, userId, from, to) {
  return new Set(
    db.prepare('SELECT date FROM workouts WHERE user_id = ? AND date BETWEEN ? AND ?')
      .all(userId, from, to)
      .map((r) => r.date)
  );
}

/** Eine Tageszeile, wie sie Heute-Screen und Verlauf brauchen. */
function buildDay(db, user, d, today, protein, trained) {
  const target = getTarget(db, user.id, d, today);
  const eaten = protein?.eaten_g ?? 0;
  const planned = protein?.planned_g ?? 0;
  return {
    date: d,
    target_g: target.target_g,
    was_training_adjacent: !!target.was_training_adjacent,
    frozen: !!target.frozen,
    trained,
    eaten_g: eaten,
    planned_g: planned,
    remaining_g: round1(target.target_g - eaten),
    remaining_after_planned_g: round1(target.target_g - eaten - planned),
    pct: target.target_g > 0 ? Math.round((eaten / target.target_g) * 100) : 0,
  };
}

export default function statsRoutes(db) {
  const r = Router();

  /** Heute-Screen: Ziel, Summen und alle Eintraege eines Tages. */
  r.get('/day', h((req, res) => {
    const user = userId(req, db);
    const today = clientToday(req);
    const d = date(req.query.date, 'date', { fallback: today });

    freezePastTargets(db, user.id, today);

    const protein = proteinByDate(db, user.id, d, d).get(d);
    const workout = db.prepare('SELECT * FROM workouts WHERE user_id = ? AND date = ?').get(user.id, d);
    const day = buildDay(db, user, d, today, protein, !!workout);

    const entries = db.prepare(
      `SELECT l.*, p.name AS product_name, p.brand, p.protein_per_100g, p.kcal_per_100g,
              ROUND(l.amount_g / 100.0 * p.protein_per_100g, 1) AS protein_g
         FROM log_entries l JOIN products p ON p.id = l.product_id
        WHERE l.user_id = ? AND l.date = ? ORDER BY l.logged_at`
    ).all(user.id, d);

    // Vortagstraining ist der Grund fuer ein erhoehtes Ziel ohne Training heute.
    const trainedYesterday = !!db.prepare('SELECT 1 FROM workouts WHERE user_id = ? AND date = ?')
      .get(user.id, addDays(d, -1));

    res.json({
      ...day,
      today,
      is_today: d === today,
      weight_kg: weightOn(db, user.id, d),
      trained_yesterday: trainedYesterday,
      workout_note: workout?.note ?? null,
      entries,
    });
  }));

  /**
   * Verlauf: Tageszeilen, rollierender 7-Tage-Schnitt und Zielerreichung
   * getrennt nach trainingsnahen Tagen und Ruhetagen.
   */
  r.get('/history', h((req, res) => {
    const user = userId(req, db);
    const today = clientToday(req);
    const days = num(req.query.days, 'days', { min: 1, max: 120, required: false }) ?? 30;

    const to = date(req.query.to, 'to', { required: false, fallback: today });
    const from = addDays(to, -(days - 1));
    // Sechs Tage Vorlauf, damit der rollierende Schnitt am ersten Balken stimmt.
    const paddedFrom = addDays(from, -6);

    freezePastTargets(db, user.id, today);

    const protein = proteinByDate(db, user.id, paddedFrom, to);
    const workouts = workoutDates(db, user.id, paddedFrom, to);

    const all = dateRange(paddedFrom, to).map((d) =>
      buildDay(db, user, d, today, protein.get(d), workouts.has(d))
    );
    const byDate = new Map(all.map((d) => [d.date, d]));

    // Rollierender 7-Tage-Schnitt fuer jeden angezeigten Tag.
    const series = dateRange(from, to).map((d) => {
      const window = dateRange(addDays(d, -6), d).map((w) => byDate.get(w)).filter(Boolean);
      const avgEaten = window.reduce((s, x) => s + x.eaten_g, 0) / window.length;
      const avgTarget = window.reduce((s, x) => s + x.target_g, 0) / window.length;
      return { ...byDate.get(d), rolling7_eaten_g: round1(avgEaten), rolling7_target_g: round1(avgTarget) };
    });

    const last7 = series.slice(-7);
    const avgEaten = round1(last7.reduce((s, x) => s + x.eaten_g, 0) / last7.length);
    const avgTarget = round1(last7.reduce((s, x) => s + x.target_g, 0) / last7.length);
    const weight = weightOn(db, user.id, to);

    // Der laufende Tag ist noch unvollstaendig und wuerde die Quote verzerren.
    const completed = series.filter((d) => daysBetween(d.date, today) > 0);
    const split = (predicate) => {
      const subset = completed.filter(predicate);
      const hit = subset.filter((d) => d.eaten_g >= d.target_g).length;
      const attainment = subset.length
        ? round1((subset.reduce((s, d) => s + (d.target_g ? d.eaten_g / d.target_g : 0), 0) / subset.length) * 100)
        : null;
      return {
        days: subset.length,
        hit,
        pct: subset.length ? Math.round((hit / subset.length) * 100) : null,
        avg_attainment_pct: attainment,
      };
    };

    res.json({
      user_id: user.id,
      today,
      from,
      to,
      days: series,
      rolling7: {
        avg_eaten_g: avgEaten,
        avg_target_g: avgTarget,
        pct: avgTarget > 0 ? Math.round((avgEaten / avgTarget) * 100) : null,
        avg_eaten_g_per_kg: weight > 0 ? Math.round((avgEaten / weight) * 100) / 100 : null,
        avg_target_g_per_kg: weight > 0 ? Math.round((avgTarget / weight) * 100) / 100 : null,
        window_days: last7.length,
      },
      achievement: {
        excludes_today: true,
        training_adjacent: split((d) => d.was_training_adjacent),
        rest: split((d) => !d.was_training_adjacent),
        overall: split(() => true),
      },
    });
  }));

  return r;
}
