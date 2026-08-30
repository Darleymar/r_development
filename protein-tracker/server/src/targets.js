/**
 * Bedarfslogik – der Teil, der stimmen muss.
 *
 * Fuer jeden Tag D gilt:
 *   trainingsnah = (Trainingseinheit an D) ODER (Trainingseinheit an D-1)
 *   faktor       = trainingsnah ? faktor_training : faktor_ruhe
 *   tagesziel_g  = koerpergewicht_kg * faktor
 *
 * faktor_ruhe ist ein Boden: das Ziel sinkt nie darunter, egal wie lange
 * nicht trainiert wurde.
 *
 * Ein Tagesziel wird beim Tageswechsel eingefroren und danach nicht mehr
 * neu berechnet – ein nachtraeglich eingetragenes Training aendert an
 * abgeschlossenen Tagen nichts mehr.
 */

// ---------------------------------------------------------------- Datums-Helfer
// Alle Datumswerte sind Strings 'YYYY-MM-DD'. Gerechnet wird ueber UTC-Mittag,
// damit Sommerzeitwechsel keine Tage verschieben koennen.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(iso) {
  if (typeof iso !== 'string' || !ISO_DATE.test(iso)) return false;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export function assertDate(iso, label = 'date') {
  if (!isValidDate(iso)) {
    const err = new Error(`${label} muss ein Datum im Format YYYY-MM-DD sein (erhalten: ${iso})`);
    err.status = 400;
    throw err;
  }
  return iso;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Anzahl Tage von `from` bis `to` (to - from). Negativ, wenn to vor from liegt. */
export function daysBetween(from, to) {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Aufsteigende Liste aller Datumswerte von `from` bis `to`, beide inklusive. */
export function dateRange(from, to) {
  const out = [];
  for (let d = from; daysBetween(d, to) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Heutiges Datum in der lokalen Zeitzone des Servers. */
export function serverToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

// ------------------------------------------------------------- reine Rechnung

export const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Der wirksame Faktor fuer einen Tag.
 * factorRest wirkt als Untergrenze – auch dann, wenn ein Profil versehentlich
 * mit factor_training < factor_rest konfiguriert wurde.
 */
export function effectiveFactor({ factorTraining, factorRest, trainingAdjacent }) {
  const chosen = trainingAdjacent ? factorTraining : factorRest;
  return Math.max(chosen, factorRest);
}

/** Tagesziel in Gramm aus Gewicht, Faktoren und Trainingsnaehe. */
export function targetGrams({ weightKg, factorTraining, factorRest, trainingAdjacent }) {
  return round1(weightKg * effectiveFactor({ factorTraining, factorRest, trainingAdjacent }));
}

/**
 * Trainingsnaehe aus einer Menge von Trainingsdaten.
 * @param {Set<string>|{has:(d:string)=>boolean}} workoutDates
 */
export function isTrainingAdjacent(workoutDates, date) {
  return workoutDates.has(date) || workoutDates.has(addDays(date, -1));
}

// ------------------------------------------------------------ DB-gebundener Teil

/** Gewicht, das an einem Tag gilt: juengster Eintrag <= date, sonst Profilgewicht. */
export function weightOn(db, userId, date) {
  const row = db.prepare(
    `SELECT weight_kg FROM weight_entries
      WHERE user_id = ? AND date <= ?
      ORDER BY date DESC LIMIT 1`
  ).get(userId, date);
  if (row) return row.weight_kg;
  const user = db.prepare('SELECT weight_kg FROM users WHERE id = ?').get(userId);
  if (!user) {
    const err = new Error(`Unbekannter Nutzer: ${userId}`);
    err.status = 404;
    throw err;
  }
  return user.weight_kg;
}

function hasWorkout(db, userId, date) {
  return !!db.prepare('SELECT 1 FROM workouts WHERE user_id = ? AND date = ?').get(userId, date);
}

/** Berechnet das Ziel eines Tages frisch aus dem aktuellen Datenstand. */
export function computeTarget(db, userId, date) {
  assertDate(date);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    const err = new Error(`Unbekannter Nutzer: ${userId}`);
    err.status = 404;
    throw err;
  }
  const trainingAdjacent = hasWorkout(db, userId, date) || hasWorkout(db, userId, addDays(date, -1));
  const weightKg = weightOn(db, userId, date);
  return {
    date,
    target_g: targetGrams({
      weightKg,
      factorTraining: user.factor_training,
      factorRest: user.factor_rest,
      trainingAdjacent,
    }),
    was_training_adjacent: trainingAdjacent ? 1 : 0,
    frozen: 0,
    weight_kg: weightKg,
    factor: effectiveFactor({
      factorTraining: user.factor_training,
      factorRest: user.factor_rest,
      trainingAdjacent,
    }),
  };
}

/** Frueheste Aktivitaet eines Nutzers – Startpunkt fuer das Nachfrieren. */
export function firstActivityDate(db, userId) {
  const row = db.prepare(
    `SELECT MIN(d) AS d FROM (
       SELECT MIN(date) AS d FROM log_entries    WHERE user_id = ?
       UNION ALL SELECT MIN(date) FROM workouts       WHERE user_id = ?
       UNION ALL SELECT MIN(date) FROM weight_entries WHERE user_id = ?
       UNION ALL SELECT MIN(date) FROM daily_targets  WHERE user_id = ?
     )`
  ).get(userId, userId, userId, userId);
  return row?.d ?? null;
}

/** Maximale Zahl von Tagen, die ein einzelner Aufruf nachtraeglich einfriert. */
export const MAX_BACKFILL_DAYS = 400;

/**
 * Friert alle noch offenen vergangenen Tage ein (alles vor `today`).
 * Idempotent: bereits eingefrorene Tage werden nicht angefasst.
 * Gibt die Zahl der neu eingefrorenen Tage zurueck.
 */
export function freezePastTargets(db, userId, today) {
  assertDate(today, 'today');
  const start = firstActivityDate(db, userId);
  if (!start) return 0;

  const yesterday = addDays(today, -1);
  if (daysBetween(start, yesterday) < 0) return 0;

  // Sehr alte Luecken werden nicht endlos nachgezogen.
  const earliest = addDays(today, -MAX_BACKFILL_DAYS);
  const from = daysBetween(earliest, start) > 0 ? start : earliest;

  const frozenDates = new Set(
    db.prepare('SELECT date FROM daily_targets WHERE user_id = ? AND frozen = 1 AND date >= ?')
      .all(userId, from)
      .map((r) => r.date)
  );

  const upsert = db.prepare(
    `INSERT INTO daily_targets (user_id, date, target_g, was_training_adjacent, frozen)
     VALUES (@user_id, @date, @target_g, @was_training_adjacent, 1)
     ON CONFLICT(user_id, date) DO UPDATE SET
       target_g = excluded.target_g,
       was_training_adjacent = excluded.was_training_adjacent,
       frozen = 1`
  );

  const run = db.transaction((dates) => {
    let n = 0;
    for (const date of dates) {
      if (frozenDates.has(date)) continue;
      const t = computeTarget(db, userId, date);
      upsert.run({
        user_id: userId,
        date,
        target_g: t.target_g,
        was_training_adjacent: t.was_training_adjacent,
      });
      n += 1;
    }
    return n;
  });

  return run(dateRange(from, yesterday));
}

/**
 * Das Ziel eines Tages so, wie es angezeigt werden soll.
 *  - Vergangenheit: der eingefrorene Wert (fehlt er, wird live gerechnet, aber
 *    nicht gespeichert – z.B. fuer Tage vor der ersten Nutzung).
 *  - Heute: live gerechnet und als noch nicht eingefrorene Zeile gespeichert.
 *  - Zukunft: live gerechnet, nicht gespeichert (Planung).
 */
export function getTarget(db, userId, date, today = serverToday()) {
  assertDate(date);
  assertDate(today, 'today');

  if (daysBetween(date, today) > 0) {
    const row = db.prepare(
      'SELECT date, target_g, was_training_adjacent, frozen FROM daily_targets WHERE user_id = ? AND date = ? AND frozen = 1'
    ).get(userId, date);
    if (row) return row;
    return { ...computeTarget(db, userId, date), frozen: 0 };
  }

  const live = computeTarget(db, userId, date);

  if (date === today) {
    db.prepare(
      `INSERT INTO daily_targets (user_id, date, target_g, was_training_adjacent, frozen)
       VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(user_id, date) DO UPDATE SET
         target_g = excluded.target_g,
         was_training_adjacent = excluded.was_training_adjacent
       WHERE daily_targets.frozen = 0`
    ).run(userId, date, live.target_g, live.was_training_adjacent);
  }

  return live;
}

/**
 * Einstiegspunkt fuer jeden Request, der Ziele liest: erst nachfrieren,
 * dann das gefragte Ziel liefern.
 */
export function syncAndGetTarget(db, userId, date, today = serverToday()) {
  freezePastTargets(db, userId, today);
  return getTarget(db, userId, date, today);
}
