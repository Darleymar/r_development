/** Lokales Datum des Geraets als 'YYYY-MM-DD'. */
export function todayISO(d = new Date()) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export const weekday = (iso) => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

/** '2026-03-10' -> '10.3.' */
export function shortDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

export function longDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${weekday(iso)}, ${d.getUTCDate()}. ${
    ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
     'August', 'September', 'Oktober', 'November', 'Dezember'][d.getUTCMonth()]
  } ${d.getUTCFullYear()}`;
}

/** 'Heute' / 'Gestern' / 'Morgen', sonst das lange Datum. */
export function relativeDate(iso, today = todayISO()) {
  if (iso === today) return 'Heute';
  if (iso === addDays(today, -1)) return 'Gestern';
  if (iso === addDays(today, 1)) return 'Morgen';
  return longDate(iso);
}

export const fmt = (n, digits = 0) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '–'
    : Number(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
