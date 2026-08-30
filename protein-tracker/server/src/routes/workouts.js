import { Router } from 'express';
import { h, notFound, num, str, date, userId } from '../util.js';
import { addDays } from '../targets.js';

export default function workoutsRoutes(db) {
  const r = Router();

  r.get('/', h((req, res) => {
    const user = userId(req, db);
    const to = date(req.query.to, 'to', { required: false }) ?? '9999-12-31';
    const from = date(req.query.from, 'from', { required: false }) ?? '0000-01-01';
    res.json(
      db.prepare('SELECT * FROM workouts WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC')
        .all(user.id, from, to)
    );
  }));

  r.post('/', h((req, res) => {
    const user = userId(req, db);
    const d = date(req.body.date, 'date');
    const note = str(req.body.note, 'note', { required: false, max: 300 });
    db.prepare(
      `INSERT INTO workouts (user_id, date, note) VALUES (?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET note = excluded.note`
    ).run(user.id, d, note);
    res.status(201).json(db.prepare('SELECT * FROM workouts WHERE user_id = ? AND date = ?').get(user.id, d));
  }));

  /**
   * Trainings-Toggle des Heute-Screens. Antwortet mit dem neuen Zustand und den
   * Tagen, deren Ziel sich dadurch bewegt (D und D+1) – sofern nicht eingefroren.
   */
  r.put('/toggle', h((req, res) => {
    const user = userId(req, db);
    const d = date(req.body.date, 'date');
    const note = str(req.body.note, 'note', { required: false, max: 300 });

    const existing = db.prepare('SELECT id FROM workouts WHERE user_id = ? AND date = ?').get(user.id, d);
    if (existing) {
      db.prepare('DELETE FROM workouts WHERE id = ?').run(existing.id);
    } else {
      db.prepare('INSERT INTO workouts (user_id, date, note) VALUES (?, ?, ?)').run(user.id, d, note);
    }
    res.json({ date: d, trained: !existing, affects: [d, addDays(d, 1)] });
  }));

  r.delete('/:id', h((req, res) => {
    const info = db.prepare('DELETE FROM workouts WHERE id = ?').run(num(req.params.id, 'id', { min: 1 }));
    if (!info.changes) throw notFound('Trainingseintrag nicht gefunden');
    res.status(204).end();
  }));

  return r;
}
