import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useProfile } from './lib/store.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Today from './screens/Today.jsx';
import AddEntry from './screens/AddEntry.jsx';
import Products from './screens/Products.jsx';
import Templates from './screens/Templates.jsx';
import History from './screens/History.jsx';
import Settings from './screens/Settings.jsx';

const icons = {
  today: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4',
  add: 'M12 5v14M5 12h14',
  products: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
  templates: 'M5 4h14v6H5zM5 14h14v6H5z',
  history: 'M5 20V10M12 20V4M19 20v-7',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4',
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={icons[name]} />
    </svg>
  );
}

const TABS = [
  ['/', 'today', 'Heute'],
  ['/eintragen', 'add', 'Eintragen'],
  ['/produkte', 'products', 'Produkte'],
  ['/vorlagen', 'templates', 'Vorlagen'],
  ['/verlauf', 'history', 'Verlauf'],
  ['/einstellungen', 'settings', 'Profil'],
];

function ProfileSwitch() {
  const { users, activeId, setActiveId } = useProfile();
  if (users.length === 0) return null;

  return (
    <label className="row tiny" style={{ gap: 6 }}>
      <span className="muted">Profil</span>
      <select
        aria-label="Profil wechseln"
        value={activeId ?? ''}
        onChange={(e) => setActiveId(Number(e.target.value))}
        style={{ width: 'auto', minHeight: 34, padding: '4px 8px', fontSize: 13 }}
      >
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    </label>
  );
}

export default function App() {
  const { loading, error, user } = useProfile();
  const { pathname } = useLocation();

  return (
    <div className="app">
      <header className="topbar">
        <h1>Protein-Tracker</h1>
        <ProfileSwitch />
      </header>

      <main>
        {error && <div className="banner banner-error">{error}</div>}
        {loading && <div className="empty">Lade …</div>}
        {!loading && !error && !user && (
          <div className="card empty">Kein Profil vorhanden. Unter „Profil“ eines anlegen.</div>
        )}
        {!loading && user && (
          <ErrorBoundary resetKey={pathname}>
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/eintragen" element={<AddEntry />} />
            <Route path="/produkte" element={<Products />} />
            <Route path="/vorlagen" element={<Templates />} />
            <Route path="/verlauf" element={<History />} />
            <Route path="/einstellungen" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ErrorBoundary>
        )}
      </main>

      <nav className="tabbar" aria-label="Hauptnavigation">
        {TABS.map(([to, icon, label]) => (
          <NavLink key={to} to={to} end={to === '/'}
                   className={({ isActive }) => (isActive ? 'active' : undefined)}>
            <Icon name={icon} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
