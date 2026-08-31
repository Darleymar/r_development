import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { ProfileProvider } from './lib/store.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* HashRouter: die App laeuft ohne Server, es gibt also niemanden, der
        tiefe Pfade auf index.html umschreiben koennte. So funktioniert das
        Aufrufen einzelner Seiten auf jedem statischen Speicherort und in der
        Android-App gleichermassen. */}
    <HashRouter>
      <ProfileProvider>
        <App />
      </ProfileProvider>
    </HashRouter>
  </React.StrictMode>
);

// Nur im Web: dort haelt der Service Worker die Programmdateien offline
// verfuegbar. In der Android-App liegen sie ohnehin im Paket – ein Cache
// wuerde dort nach einem Update alte Staende ausliefern.
const isNativeApp = () => Boolean(globalThis.Capacitor?.isNativePlatform?.());

if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeApp()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* Ohne Service Worker laeuft die App weiter, nur eben nicht offline. */
    });
  });
}
