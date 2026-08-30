import { Router } from 'express';
import { h, bad, notFound, num, str, date, userId } from '../util.js';

export default function usersRoutes(db) {
  const r = Router();

  r.get('/', h((req, res) => {
    res.json(db.prepare('SELECT * FROM users ORDER BY id').all());
  }));

  r.post('/', h((req, res) => {
    const name = str(req.body.name, 'name', { max: 60 });
    const weight = num(req.body.weight_kg, 'weight_kg', { min: 20, max: 400 });
    const ft = num(req.body.factor_training, 'factor_training', { min: 0.5, max: 5, required: false }) ?? 2.0;
    const fr = num(req.body.factor_rest, 'factor_rest', { min: 0.5, max: 5, required: false }) ?? 1.6;
    try {
      const info = db.prepare(
        'INSERT INTO users (name, weight_kg, factor_training, factor_rest) VALUES (?, ?, ?, ?)'
      ).run(name, weight, ft, fr);
      res.status(201).json(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw bad(`Ein Profil mit dem Namen "${name}" existiert bereits`);
      throw e;
    }
  }));

  r.patch('/:id', h((req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(num(req.params.id, 'id', { min: 1 }));
    if (!user) throw notFound('Profil nicht gefunden');

    const patch = {
      name: req.body.name !== undefined ? str(req.body.name, 'name', { max: 60 }) : user.name,
      weight_kg: req.body.weight_kg !== undefined
        ? num(req.body.weight_kg, 'weight_kg', { min: 20, max: 400 }) : user.weight_kg,
      factor_training: req.body.factor_training !== undefined
        ? num(req.body.factor_training, 'factor_training', { min: 0.5, max: 5 }) : user.factor_training,
      factor_rest: req.body.factor_rest !== undefined
        ? num(req.body.factor_rest, 'factor_rest', { min: 0.5, max: 5 }) : user.factor_rest,
    };

    db.prepare(
      'UPDATE users SET name = @name, weight_kg = @weight_kg, factor_training = @factor_training, factor_rest = @factor_rest WHERE id = @id'
    ).run({ ...patch, id: user.id });
    res.json(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
  }));

  r.delete('/:id', h((req, res) => {
    const id = num(req.params.id, 'id', { min: 1 });
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
    if (n <= 1) throw bad('Das letzte Profil kann nicht geloescht werden');
    const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (!info.changes) throw notFound('Profil nicht gefunden');
    res.status(204).end();
  }));

  // ------------------------------------------------------------ Gewichtsverlauf

  r.get('/:user_id/weights', h((req, res) => {
    const user = userId(req, db);
    res.json(
      db.prepare('SELECT * FROM weight_entries WHERE user_id = ? ORDER BY date DESC').all(user.id)
    );
  }));

  r.post('/:user_id/weights', h((req, res) => {
    const user = userId(req, db);
    const d = date(req.body.date, 'date');
    const kg = num(req.body.weight_kg, 'weight_kg', { min: 20, max: 400 });

    db.transaction(() => {
      db.prepare(
        `INSERT INTO weight_entries (user_id, date, weight_kg) VALUES (?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg`
      ).run(user.id, d, kg);

      // Das Profilgewicht spiegelt immer den juengsten Eintrag.
      const latest = db.prepare(
        'SELECT weight_kg FROM weight_entries WHERE user_id = ? ORDER BY date DESC LIMIT 1'
      ).get(user.id);
      db.prepare('UPDATE users SET weight_kg = ? WHERE id = ?').run(latest.weight_kg, user.id);
    })();

    res.status(201).json(
      db.prepare('SELECT * FROM weight_entries WHERE user_id = ? AND date = ?').get(user.id, d)
    );
  }));

  r.delete('/:user_id/weights/:date', h((req, res) => {
    const user = userId(req, db);
    const d = date(req.params.date, 'date');
    const info = db.prepare('DELETE FROM weight_entries WHERE user_id = ? AND date = ?').run(user.id, d);
    if (!info.changes) throw notFound('Gewichtseintrag nicht gefunden');
    res.status(204).end();
  }));

  return r;
}
