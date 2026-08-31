import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { todayISO } from './date.js';

const ProfileContext = createContext(null);
const STORAGE_KEY = 'pt.active-user';

/**
 * Haelt die Profile, das aktive Profil und einen Zaehler, mit dem Screens
 * nach Schreibvorgaengen neu laden. Bewusst ohne Auth – der Prototyp laeuft
 * auf einem geteilten Geraet im Heimnetz.
 */
export function ProfileProvider({ children }) {
  const [users, setUsers] = useState([]);
  const [activeId, setActiveId] = useState(() => {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  const reloadUsers = useCallback(async () => {
    try {
      const list = await api.users();
      setUsers(list);
      setActiveId((current) => (list.some((u) => u.id === current) ? current : list[0]?.id ?? null));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reloadUsers(); }, [reloadUsers]);

  useEffect(() => {
    if (activeId) localStorage.setItem(STORAGE_KEY, String(activeId));
  }, [activeId]);

  // Datum im Blick behalten: bleibt die App ueber Mitternacht offen, soll der
  // Heute-Screen auf den neuen Tag springen.
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const tick = setInterval(() => {
      const now = todayISO();
      setToday((prev) => (prev === now ? prev : now));
    }, 30000);
    return () => clearInterval(tick);
  }, []);

  const value = useMemo(() => ({
    users,
    user: users.find((u) => u.id === activeId) ?? null,
    activeId,
    setActiveId,
    reloadUsers,
    loading,
    error,
    today,
    revision,
    refresh: () => setRevision((r) => r + 1),
  }), [users, activeId, reloadUsers, loading, error, today, revision]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile ausserhalb des ProfileProvider verwendet');
  return ctx;
}

/**
 * Kleiner Lade-Helfer: fuehrt `loader` aus, wenn sich die Abhaengigkeiten aendern.
 * `initial` ist der Wert, den `data` vor dem ersten Ergebnis und nach einem
 * Fehler hat – fuer Listen `[]`, damit Screens nie ueber `null` stolpern.
 */
export function useAsync(loader, deps, { skip = false, initial = null } = {}) {
  const [state, setState] = useState({ data: initial, loading: !skip, error: null });

  useEffect(() => {
    if (skip) {
      setState({ data: initial, loading: false, error: null });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((err) => { if (!cancelled) setState({ data: initial, loading: false, error: err.message }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
