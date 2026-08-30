import { serverToday, assertDate, isValidDate } from './targets.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg) => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

/** Faengt synchron geworfene Fehler aus Handlern ein. */
export const h = (fn) => (req, res, next) => {
  try {
    fn(req, res, next);
  } catch (err) {
    next(err);
  }
};

export function num(value, label, { min = -Infinity, max = Infinity, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${label} fehlt`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw bad(`${label} muss eine Zahl sein`);
  if (n < min || n > max) throw bad(`${label} muss zwischen ${min} und ${max} liegen`);
  return n;
}

export function str(value, label, { required = true, max = 200 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw bad(`${label} fehlt`);
    return null;
  }
  const s = String(value).trim();
  if (!s) {
    if (required) throw bad(`${label} darf nicht leer sein`);
    return null;
  }
  if (s.length > max) throw bad(`${label} ist zu lang (max. ${max} Zeichen)`);
  return s;
}

export function oneOf(value, label, allowed, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${label} fehlt`);
    return null;
  }
  if (!allowed.includes(value)) throw bad(`${label} muss einer von ${allowed.join(', ')} sein`);
  return value;
}

export function date(value, label = 'date', { required = true, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback) return fallback;
    if (required) throw bad(`${label} fehlt`);
    return null;
  }
  assertDate(String(value), label);
  return String(value);
}

/**
 * "Heute" aus Sicht des Clients. Der Server kann in einer anderen Zeitzone
 * laufen als das Handy im Heimnetz, deshalb darf der Client sein lokales
 * Datum mitschicken.
 */
export function clientToday(req) {
  const t = req.query.today ?? req.body?.today;
  return isValidDate(t) ? t : serverToday();
}

export function userId(req, db) {
  const raw = req.query.user_id ?? req.body?.user_id ?? req.params.user_id;
  const id = num(raw, 'user_id', { min: 1 });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw notFound(`Unbekannter Nutzer: ${id}`);
  return user;
}

export const proteinOf = (amountG, proteinPer100g) => (amountG / 100) * proteinPer100g;
export const round1 = (n) => Math.round(n * 10) / 10;
