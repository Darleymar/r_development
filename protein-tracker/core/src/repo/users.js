import { bad, notFound, num, str, date, requireUser } from '../validate.js';

export function listUsers(db) {
  return db.prepare('SELECT * FROM users ORDER BY id').all();
}

export function createUser(db, input = {}) {
  const name = str(input.name, 'name', { max: 60 });
  const weight = num(input.weight_kg, 'weight_kg', { min: 20, max: 400 });
  const ft = num(input.factor_training, 'factor_training', { min: 0.5, max: 5, required: false }) ?? 2.0;
  const fr = num(input.factor_rest, 'factor_rest', { min: 0.5, max: 5, required: false }) ?? 1.6;

  if (db.prepare('SELECT 1 FROM users WHERE name = ?').get(name)) {
    throw bad(`Ein Profil mit dem Namen "${name}" existiert bereits`);
  }
  const info = db.prepare(
    'INSERT INTO users (name, weight_kg, factor_training, factor_rest) VALUES (?, ?, ?, ?)'
  ).run(name, weight, ft, fr);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

export function updateUser(db, id, patch = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(num(id, 'id', { min: 1 }));
  if (!user) throw notFound('Profil nicht gefunden');

  const next = {
    id: user.id,
    name: patch.name !== undefined ? str(patch.name, 'name', { max: 60 }) : user.name,
    weight_kg: patch.weight_kg !== undefined
      ? num(patch.weight_kg, 'weight_kg', { min: 20, max: 400 }) : user.weight_kg,
    factor_training: patch.factor_training !== undefined
      ? num(patch.factor_training, 'factor_training', { min: 0.5, max: 5 }) : user.factor_training,
    factor_rest: patch.factor_rest !== undefined
      ? num(patch.factor_rest, 'factor_rest', { min: 0.5, max: 5 }) : user.factor_rest,
  };

  const clash = db.prepare('SELECT 1 FROM users WHERE name = @name AND id != @id').get(next);
  if (clash) throw bad(`Ein Profil mit dem Namen "${next.name}" existiert bereits`);

  db.prepare(
    `UPDATE users SET name = @name, weight_kg = @weight_kg,
            factor_training = @factor_training, factor_rest = @factor_rest
      WHERE id = @id`
  ).run(next);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

export function deleteUser(db, id) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n <= 1) throw bad('Das letzte Profil kann nicht geloescht werden');
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(num(id, 'id', { min: 1 }));
  if (!info.changes) throw notFound('Profil nicht gefunden');
}

export function listWeights(db, userId) {
  const user = requireUser(db, userId);
  return db.prepare('SELECT * FROM weight_entries WHERE user_id = ? ORDER BY date DESC').all(user.id);
}

/** Traegt ein Gewicht ein und haelt das Profilgewicht auf dem juengsten Stand. */
export function addWeight(db, userId, input = {}) {
  const user = requireUser(db, userId);
  const d = date(input.date, 'date');
  const kg = num(input.weight_kg, 'weight_kg', { min: 20, max: 400 });

  db.transaction(() => {
    db.prepare(
      `INSERT INTO weight_entries (user_id, date, weight_kg) VALUES (?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg`
    ).run(user.id, d, kg);
    const latest = db.prepare(
      'SELECT weight_kg FROM weight_entries WHERE user_id = ? ORDER BY date DESC LIMIT 1'
    ).get(user.id);
    db.prepare('UPDATE users SET weight_kg = ? WHERE id = ?').run(latest.weight_kg, user.id);
  })();

  return db.prepare('SELECT * FROM weight_entries WHERE user_id = ? AND date = ?').get(user.id, d);
}

export function deleteWeight(db, userId, dateStr) {
  const user = requireUser(db, userId);
  const d = date(dateStr, 'date');
  const info = db.prepare('DELETE FROM weight_entries WHERE user_id = ? AND date = ?').run(user.id, d);
  if (!info.changes) throw notFound('Gewichtseintrag nicht gefunden');

  const latest = db.prepare(
    'SELECT weight_kg FROM weight_entries WHERE user_id = ? ORDER BY date DESC LIMIT 1'
  ).get(user.id);
  if (latest) db.prepare('UPDATE users SET weight_kg = ? WHERE id = ?').run(latest.weight_kg, user.id);
}
