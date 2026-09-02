/* Cacht nur die Programmhuelle (HTML, CSS, JS, Icons), niemals /api/*.
 * Beim Aendern der Oberflaeche VERSION hochzaehlen. */
const VERSION = "ur-katalog-v1";
const SHELL = [
  "/",
  "/static/app.js",
  "/static/style.css",
  "/static/favicon.svg",
  "/static/icon-192.png",
  "/static/icon-512.png",
  "/static/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  // Netz zuerst, damit eine geaenderte Oberflaeche sofort ankommt; der Cache
  // ist nur da, wenn der Server nicht laeuft.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/")))
  );
});
