/* Sehr schlanker Service Worker: App-Shell offline halten, API-Antworten
   als Notnagel zwischenspeichern. Kein Hintergrund-Sync – der Prototyp
   soll bei Funkloch lesbar bleiben, nicht Schreibvorgaenge puffern. */
const SHELL = 'pt-shell-v1';
const DATA = 'pt-data-v1';
const SHELL_FILES = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API: erst Netz, bei Ausfall die letzte bekannte Antwort.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? Response.json(
          { error: 'Offline und keine gespeicherte Antwort vorhanden.' },
          { status: 503 }
        )))
    );
    return;
  }

  // Navigationen immer auf die Shell zurueckfallen lassen (SPA-Routing).
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => hit ?? fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(request, copy));
      return res;
    }))
  );
});
