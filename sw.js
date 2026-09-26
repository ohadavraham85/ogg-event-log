/* Service worker — network first, cache as offline fallback.
   Online the app always loads the latest files (so "בדוק עדכון" keeps working);
   offline, or when the site answers with an error (404/5xx), it serves the last copy it saw. Data stays in localStorage, not here. */
const CACHE = "ogg-log-1.16";   // bump together with APP_VER in app.js
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest",
               "icons/icon-notebook.svg", "icons/icon-notebook-192.png", "icons/icon-notebook-512.png",
               "icons/icon-notebook-maskable-512.png", "icons/icon-notebook-apple-180.png",
               "icons/logo-header.png"];

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

  const fromCache = () => caches.match(req, { ignoreSearch: true })
    .then(hit => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined));

  ev.respondWith(
    fetch(req)
      .then(res => {
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        }
        // Site answered with an error (e.g. 404 after the site was taken down):
        // keep the app working from the saved copy if there is one.
        return fromCache().then(hit => hit || res);
      })
      .catch(() => fromCache().then(hit => hit || Response.error()))
  );
});
