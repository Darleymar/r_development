import test from 'node:test';
import assert from 'node:assert/strict';
import { singleUserDb } from './helpers.js';
import {
  addDays,
  daysBetween,
  dateRange,
  effectiveFactor,
  targetGrams,
  computeTarget,
  getTarget,
  freezePastTargets,
  weightOn,
  MAX_BACKFILL_DAYS,
} from '../src/targets.js';

const freshDb = singleUserDb;

const addWorkout = (db, date) =>
  db.prepare('INSERT INTO workouts (user_id, date) VALUES (1, ?)').run(date);

// ------------------------------------------------------------ Datums-Arithmetik

test('addDays ueberspringt keine Tage an Sommerzeitwechseln', () => {
  assert.equal(addDays('2026-03-29', 1), '2026-03-30'); // MEZ -> MESZ
  assert.equal(addDays('2026-10-25', 1), '2026-10-26'); // MESZ -> MEZ
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29'); // Schaltjahr
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
});

test('daysBetween und dateRange', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-08'), 7);
  assert.equal(daysBetween('2026-01-08', '2026-01-01'), -7);
  assert.equal(dateRange('2026-01-01', '2026-01-03').length, 3);
  assert.deepEqual(dateRange('2026-01-03', '2026-01-01'), []);
});

// ------------------------------------------------------------------ Grundregel

test('Ruhetag rechnet mit faktor_ruhe, Trainingstag mit faktor_training', () => {
  const base = { weightKg: 80, factorTraining: 2.0, factorRest: 1.6 };
  assert.equal(targetGrams({ ...base, trainingAdjacent: false }), 128);
  assert.equal(targetGrams({ ...base, trainingAdjacent: true }), 160);
});

test('Training an D und an D-1 heben das Ziel, D-2 nicht mehr', () => {
  const db = freshDb();
  addWorkout(db, '2026-03-10');

  assert.equal(computeTarget(db, 1, '2026-03-09').target_g, 128); // Vortag des Trainings
  assert.equal(computeTarget(db, 1, '2026-03-10').target_g, 160); // Trainingstag
  assert.equal(computeTarget(db, 1, '2026-03-11').target_g, 160); // Folgetag
  assert.equal(computeTarget(db, 1, '2026-03-12').target_g, 128); // zwei Tage danach
});

test('was_training_adjacent wird mitgeliefert', () => {
  const db = freshDb();
  addWorkout(db, '2026-03-10');
  assert.equal(computeTarget(db, 1, '2026-03-11').was_training_adjacent, 1);
  assert.equal(computeTarget(db, 1, '2026-03-12').was_training_adjacent, 0);
});

// ------------------------------------------------------- faktor_ruhe als Boden

test('faktor_ruhe ist eine Untergrenze, auch bei verdrehter Konfiguration', () => {
  // Selbst wenn jemand faktor_training unter faktor_ruhe setzt, sinkt das Ziel nicht.
  assert.equal(
    effectiveFactor({ factorTraining: 1.2, factorRest: 1.6, trainingAdjacent: true }),
    1.6
  );
  assert.equal(
    effectiveFactor({ factorTraining: 1.2, factorRest: 1.6, trainingAdjacent: false }),
    1.6
  );
});

test('das Ziel sinkt auch nach Wochen ohne Training nicht unter faktor_ruhe', () => {
  const db = freshDb();
  addWorkout(db, '2026-01-05');
  for (const d of ['2026-01-20', '2026-02-15', '2026-03-30', '2026-06-01']) {
    assert.equal(computeTarget(db, 1, d).target_g, 128, `${d} muss auf dem Boden liegen`);
  }
});

// --------------------------------------------------- Wochenschnitte der Spezifikation

function weeklyAverageFactor(db, weekStart) {
  const days = dateRange(weekStart, addDays(weekStart, 6));
  const sum = days.reduce((acc, d) => acc + computeTarget(db, 1, d).target_g, 0);
  return sum / days.length / 80; // 80 kg -> zurueck auf g/kg
}

test('Wochenschnitte entsprechen der Tabelle in der Spezifikation', () => {
  const monday = '2026-03-02'; // ein Montag

  const three = freshDb();
  for (const d of ['2026-03-02', '2026-03-04', '2026-03-06']) addWorkout(three, d); // Mo/Mi/Fr
  assert.equal(weeklyAverageFactor(three, monday).toFixed(2), '1.94');

  const two = freshDb();
  for (const d of ['2026-03-02', '2026-03-05']) addWorkout(two, d); // Mo/Do
  assert.equal(weeklyAverageFactor(two, monday).toFixed(2), '1.83');

  const one = freshDb();
  addWorkout(one, '2026-03-02'); // nur Mo
  assert.equal(weeklyAverageFactor(one, monday).toFixed(2), '1.71');
});

// -------------------------------------------------------------------- Gewicht

test('gilt das Gewicht, das am jeweiligen Tag zuletzt eingetragen war', () => {
  const db = freshDb();
  db.prepare('INSERT INTO weight_entries (user_id, date, weight_kg) VALUES (1, ?, ?)')
    .run('2026-03-01', 82);
  db.prepare('INSERT INTO weight_entries (user_id, date, weight_kg) VALUES (1, ?, ?)')
    .run('2026-03-15', 84);

  assert.equal(weightOn(db, 1, '2026-02-28'), 80); // vor dem ersten Eintrag: Profilgewicht
  assert.equal(weightOn(db, 1, '2026-03-01'), 82);
  assert.equal(weightOn(db, 1, '2026-03-14'), 82);
  assert.equal(weightOn(db, 1, '2026-03-15'), 84);
  assert.equal(computeTarget(db, 1, '2026-03-20').target_g, round(84 * 1.6));
});

const round = (n) => Math.round(n * 10) / 10;

// ------------------------------------------------------------------ Einfrieren

test('vergangene Tage werden eingefroren, heute nicht', () => {
  const db = freshDb();
  const today = '2026-03-10';
  addWorkout(db, '2026-03-05');

  freezePastTargets(db, 1, today);
  getTarget(db, 1, today, today);

  const rows = db.prepare('SELECT date, frozen FROM daily_targets WHERE user_id = 1 ORDER BY date').all();
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.equal(r.frozen, r.date === today ? 0 : 1, `${r.date} falsch markiert`);
  }
});

test('ein nachtraeglich eingetragenes Training aendert eingefrorene Ziele nicht', () => {
  const db = freshDb();
  const today = '2026-03-10';
  addWorkout(db, '2026-03-01'); // erzeugt Aktivitaet ab dem 1.

  freezePastTargets(db, 1, today);
  const before = getTarget(db, 1, '2026-03-07', today);
  assert.equal(before.target_g, 128);
  assert.equal(before.frozen, 1);

  addWorkout(db, '2026-03-07'); // nachtraeglich

  freezePastTargets(db, 1, today); // erneuter Zugriff
  const after = getTarget(db, 1, '2026-03-07', today);
  assert.equal(after.target_g, 128, 'eingefrorenes Ziel darf sich nicht aendern');
  assert.equal(after.frozen, 1);

  // Der Rohwert wuerde ohne Einfrieren anders lauten – Beleg, dass wirklich
  // die eingefrorene Zeile gelesen wird und nicht neu gerechnet wird.
  assert.equal(computeTarget(db, 1, '2026-03-07').target_g, 160);
});

test('Einfrieren ist idempotent', () => {
  const db = freshDb();
  const today = '2026-03-10';
  addWorkout(db, '2026-03-01');

  const first = freezePastTargets(db, 1, today);
  assert.ok(first > 0);
  assert.equal(freezePastTargets(db, 1, today), 0, 'zweiter Lauf darf nichts mehr einfrieren');
});

test('das heutige Ziel wird live nachgefuehrt, wenn Training eingetragen wird', () => {
  const db = freshDb();
  const today = '2026-03-10';

  assert.equal(getTarget(db, 1, today, today).target_g, 128);
  addWorkout(db, today);
  assert.equal(getTarget(db, 1, today, today).target_g, 160);

  const row = db.prepare('SELECT target_g, frozen FROM daily_targets WHERE user_id = 1 AND date = ?').get(today);
  assert.equal(row.target_g, 160);
  assert.equal(row.frozen, 0);
});

test('beim Tageswechsel wird der gestrige Live-Wert eingefroren', () => {
  const db = freshDb();
  addWorkout(db, '2026-03-09');
  getTarget(db, 1, '2026-03-09', '2026-03-09'); // gestern noch live

  const nextDay = '2026-03-10';
  freezePastTargets(db, 1, nextDay);

  const row = db.prepare('SELECT target_g, frozen FROM daily_targets WHERE user_id = 1 AND date = ?')
    .get('2026-03-09');
  assert.equal(row.frozen, 1);
  assert.equal(row.target_g, 160);
});

test('Zukunftstage werden gerechnet, aber nicht gespeichert', () => {
  const db = freshDb();
  const today = '2026-03-10';
  addWorkout(db, '2026-03-12');

  const future = getTarget(db, 1, '2026-03-12', today);
  assert.equal(future.target_g, 160);
  assert.equal(future.frozen, 0);
  const row = db.prepare('SELECT 1 FROM daily_targets WHERE user_id = 1 AND date = ?').get('2026-03-12');
  assert.equal(row, undefined);
});

test('Tage vor der ersten Nutzung liefern ein gerechnetes, ungespeichertes Ziel', () => {
  const db = freshDb();
  addWorkout(db, '2026-03-05');
  freezePastTargets(db, 1, '2026-03-10');

  const old = getTarget(db, 1, '2026-01-01', '2026-03-10');
  assert.equal(old.target_g, 128);
  assert.equal(old.frozen, 0);
});

test('das Nachfrieren ist auf MAX_BACKFILL_DAYS begrenzt', () => {
  const db = freshDb();
  addWorkout(db, '2020-01-01');
  const today = '2026-03-10';
  const n = freezePastTargets(db, 1, today);
  assert.ok(n <= MAX_BACKFILL_DAYS, `${n} Tage eingefroren`);
  assert.equal(n, MAX_BACKFILL_DAYS);
});

test('ohne jede Aktivitaet wird nichts eingefroren', () => {
  const db = freshDb();
  assert.equal(freezePastTargets(db, 1, '2026-03-10'), 0);
});
