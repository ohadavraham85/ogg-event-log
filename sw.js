/* Service worker — network first, cache as offline fallback.
   Online the app always loads the latest files (so "בדוק עדכון" keeps working);
   offline, or when the site answers with an error (404/5xx), it serves the last copy it saw. Data stays in localStorage, not here. */
const CACHE = "ogg-log-1.70";   // bump together with APP_VER in app.js
const SHELL = ["./", "index.html", "style.css", "app.js", "cloud.js", "firebase-config.js", "vendor/firebase.js", "vendor/html2canvas.min.js", "manifest.webmanifest",
               "icons/icon-notebook.svg", "icons/icon-notebook-192.png", "icons/icon-notebook-512.png",
               "icons/icon-notebook-maskable-512.png", "icons/icon-notebook-apple-180.png",
               "icons/logo-header.png", "icons/sc-new-192.png", "icons/sc-dash-192.png", "icons/sc-open-192.png"];

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

  // GitHub Pages lets browsers keep files for 10 minutes; revalidate app files on every load
  // (a cheap 304 when nothing changed) so a new version shows up on the next refresh.
  const netReq = sameOrigin ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" }) : req;

  ev.respondWith(
    fetch(netReq)
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

// tapping a "new event" notification: bring the app forward and show the new events
self.addEventListener("notificationclick", ev => {
  ev.notification.close();
  ev.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const c = list[0], task = (ev.notification.tag || "").indexOf("ogg-task") === 0;
    if (c) { c.postMessage({ type: task ? "show-tasks" : "show-new" }); return c.focus(); }
    return self.clients.openWindow("./?app=ogg-log-2&view=" + (task ? "Tasks" : "List"));
  }));
});
