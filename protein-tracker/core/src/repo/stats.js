import { num, date, requireUser, resolveToday, round1 } from '../validate.js';
import { addDays, dateRange, daysBetween, freezePastTargets, getTarget, weightOn } from '../targets.js';
import { listEntries } from './entries.js';

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

/** Heute-Screen: Ziel, Summen und alle Eintraege eines Tages. */
export function getDay(db, { user_id, date: dateStr, today: todayStr } = {}) {
  const user = requireUser(db, user_id);
  const today = resolveToday(todayStr);
  const d = date(dateStr, 'date', { fallback: today });

  freezePastTargets(db, user.id, today);

  const protein = proteinByDate(db, user.id, d, d).get(d);
  const workout = db.prepare('SELECT * FROM workouts WHERE user_id = ? AND date = ?').get(user.id, d);
  const day = buildDay(db, user, d, today, protein, !!workout);

  const trainedYesterday = !!db.prepare('SELECT 1 FROM workouts WHERE user_id = ? AND date = ?')
    .get(user.id, addDays(d, -1));

  return {
    ...day,
    today,
    is_today: d === today,
    weight_kg: weightOn(db, user.id, d),
    trained_yesterday: trainedYesterday,
    workout_note: workout?.note ?? null,
    entries: listEntries(db, user.id, d),
  };
}

/**
 * Verlauf: Tageszeilen, rollierender 7-Tage-Schnitt und Zielerreichung
 * getrennt nach trainingsnahen Tagen und Ruhetagen.
 */
export function getHistory(db, { user_id, days: dayCount, to: toStr, today: todayStr } = {}) {
  const user = requireUser(db, user_id);
  const today = resolveToday(todayStr);
  const days = num(dayCount, 'days', { min: 1, max: 120, required: false }) ?? 30;

  const to = date(toStr, 'to', { required: false, fallback: today });
  const from = addDays(to, -(days - 1));
  const paddedFrom = addDays(from, -6); // Vorlauf fuer den rollierenden Schnitt

  freezePastTargets(db, user.id, today);

  const protein = proteinByDate(db, user.id, paddedFrom, to);
  const workouts = workoutDates(db, user.id, paddedFrom, to);

  const all = dateRange(paddedFrom, to).map((d) =>
    buildDay(db, user, d, today, protein.get(d), workouts.has(d))
  );
  const byDate = new Map(all.map((d) => [d.date, d]));

  const series = dateRange(from, to).map((d) => {
    const window = dateRange(addDays(d, -6), d).map((w) => byDate.get(w)).filter(Boolean);
    return {
      ...byDate.get(d),
      rolling7_eaten_g: round1(window.reduce((s, x) => s + x.eaten_g, 0) / window.length),
      rolling7_target_g: round1(window.reduce((s, x) => s + x.target_g, 0) / window.length),
    };
  });

  const last7 = series.slice(-7);
  const avgEaten = round1(last7.reduce((s, x) => s + x.eaten_g, 0) / last7.length);
  const avgTarget = round1(last7.reduce((s, x) => s + x.target_g, 0) / last7.length);
  const weight = weightOn(db, user.id, to);

  // Der laufende Tag ist unvollstaendig und wuerde die Quote verzerren.
  const completed = series.filter((d) => daysBetween(d.date, today) > 0);
  const split = (predicate) => {
    const subset = completed.filter(predicate);
    const hit = subset.filter((d) => d.eaten_g >= d.target_g).length;
    return {
      days: subset.length,
      hit,
      pct: subset.length ? Math.round((hit / subset.length) * 100) : null,
      avg_attainment_pct: subset.length
        ? round1((subset.reduce((s, d) => s + (d.target_g ? d.eaten_g / d.target_g : 0), 0) / subset.length) * 100)
        : null,
    };
  };

  return {
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
  };
}
