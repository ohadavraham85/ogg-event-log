/* Service worker — network first, cache as offline fallback.
   Online the app always loads the latest files (so "בדוק עדכון" keeps working);
   offline it serves the last copy it saw. Data stays in localStorage, not here. */
const CACHE = "ogg-log-shell-v3";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest",
               "icons/favicon-64.png", "icons/icon-192.png", "icons/icon-512.png",
               "icons/icon-maskable-512.png"];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFont) return;

  ev.respondWith(
    fetch(req)
      .then(res => {
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined))
        .then(hit => hit || Response.error()))
  );
});
