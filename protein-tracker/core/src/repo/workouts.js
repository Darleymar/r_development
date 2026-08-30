import { notFound, num, str, date, requireUser } from '../validate.js';
import { addDays } from '../targets.js';

export function listWorkouts(db, userId, { from, to } = {}) {
  const user = requireUser(db, userId);
  const start = date(from, 'from', { required: false }) ?? '0000-01-01';
  const end = date(to, 'to', { required: false }) ?? '9999-12-31';
  return db.prepare(
    'SELECT * FROM workouts WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC'
  ).all(user.id, start, end);
}

export function saveWorkout(db, input = {}) {
  const user = requireUser(db, input.user_id);
  const d = date(input.date, 'date');
  const note = str(input.note, 'note', { required: false, max: 300 });
  db.prepare(
    `INSERT INTO workouts (user_id, date, note) VALUES (?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET note = excluded.note`
  ).run(user.id, d, note);
  return db.prepare('SELECT * FROM workouts WHERE user_id = ? AND date = ?').get(user.id, d);
}

/** Trainings-Toggle des Heute-Screens; meldet die Tage, deren Ziel sich bewegt. */
export function toggleWorkout(db, input = {}) {
  const user = requireUser(db, input.user_id);
  const d = date(input.date, 'date');
  const note = str(input.note, 'note', { required: false, max: 300 });

  const existing = db.prepare('SELECT id FROM workouts WHERE user_id = ? AND date = ?').get(user.id, d);
  if (existing) db.prepare('DELETE FROM workouts WHERE id = ?').run(existing.id);
  else db.prepare('INSERT INTO workouts (user_id, date, note) VALUES (?, ?, ?)').run(user.id, d, note);

  return { date: d, trained: !existing, affects: [d, addDays(d, 1)] };
}

export function deleteWorkout(db, id) {
  const info = db.prepare('DELETE FROM workouts WHERE id = ?').run(num(id, 'id', { min: 1 }));
  if (!info.changes) throw notFound('Trainingseintrag nicht gefunden');
}
