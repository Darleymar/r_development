import { assertDate, isValidDate, serverToday } from './targets.js';

export { round1 } from './targets.js';

/**
 * Fehler mit Statuscode. Der Code stammt aus der frueheren REST-Schicht und
 * bleibt nuetzlich, um im Frontend „nicht gefunden“ von „ungueltige Eingabe“
 * und „Konflikt“ zu unterscheiden.
 */
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

export const bad = (msg) => new AppError(400, msg);
export const notFound = (msg) => new AppError(404, msg);
export const conflict = (msg) => new AppError(409, msg);

export function num(value, label, { min = -Infinity, max = Infinity, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${label} fehlt`);
    return null;
  }
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
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

/** Heute aus Sicht des Geraets; ungueltige Angaben fallen auf die Systemzeit zurueck. */
export const resolveToday = (value) => (isValidDate(value) ? value : serverToday());

export function requireUser(db, userId) {
  const id = num(userId, 'user_id', { min: 1 });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw notFound(`Unbekannter Nutzer: ${id}`);
  return user;
}

