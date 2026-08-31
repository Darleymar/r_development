/* Die App braucht kein Netz: Daten und Logik liegen im Geraet. Der Service
   Worker sorgt nur dafuer, dass auch die Programmdateien offline verfuegbar
   bleiben. Einzige Ausnahme ist der Abruf bei Open Food Facts, der ohne
   Verbindung ins Leere laeuft – die App faengt das ab und bietet das
   manuelle Anlegen an. */
const CACHE = 'pt-shell-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigationen: Netz zuerst, damit eine neue Fassung ankommt; sonst die Shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html').then((hit) => hit ?? caches.match('./')))
    );
    return;
  }

  // Programmdateien inkl. WebAssembly: aus dem Cache, sonst holen und merken.
  event.respondWith(
    caches.match(request).then((hit) => hit ?? fetch(request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    }))
  );
});
