/* Service worker — network first, cache as offline fallback.
   Online the app always loads the latest files (so "בדוק עדכון" keeps working);
   offline, or when the site answers with an error (404/5xx), it serves the last copy it saw. Data stays in localStorage, not here. */
const CACHE = "ogg-log-3.25";   // bump together with APP_VER in app.js
// the beta copy (…/beta/) keeps its own cache, so the two copies never clear each other's
const BETA = self.location.pathname.includes("/beta/");
const PFX = BETA ? "ogg-beta-" : "ogg-log-", CNAME = CACHE.replace("ogg-log-", PFX);
const SHELL = ["./", "index.html", "style.css", "app.js", "cloud.js", "firebase-config.js", "vendor/firebase.js", "vendor/html2canvas.min.js", "manifest.webmanifest",
               "icons/icon-notebook.svg", "icons/icon-notebook-192.png", "icons/icon-notebook-512.png",
               "icons/icon-notebook-maskable-512.png", "icons/icon-notebook-apple-180.png",
               "icons/logo-header.png", "icons/badge-96.png", "icons/sc-new-192.png", "icons/sc-dash-192.png", "icons/sc-open-192.png"];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(CNAME).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CNAME && (k.startsWith(PFX) || (!BETA && !k.startsWith("ogg-beta-")))).map(k => caches.delete(k))))
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
          caches.open(CNAME).then(c => c.put(req, copy));
          return res;
        }
        // Site answered with an error (e.g. 404 after the site was taken down):
        // keep the app working from the saved copy if there is one.
        return fromCache().then(hit => hit || res);
      })
      .catch(() => fromCache().then(hit => hit || Response.error()))
  );
});

// tapping a notification: bring the app forward and show what it is about —
// a push about a task opens that task; a "new event" one shows the new events
self.addEventListener("notificationclick", ev => {
  ev.notification.close();
  const tid = (ev.notification.data && ev.notification.data.tid) || "";
  const task = (ev.notification.tag || "").indexOf("ogg-task") === 0;
  ev.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const c = list[0];
    if (c) { c.postMessage(tid ? { type: "show-task", tid } : { type: task ? "show-tasks" : "show-new" }); return c.focus(); }
    return self.clients.openWindow("./?app=ogg-log-2&view=" + (task ? "Tasks" : "List") + (tid ? "&task=" + encodeURIComponent(tid) : ""));
  }));
});

// push from the server (Cloud Function "taskPush", via FCM): a change in a task I follow — also when the app is closed.
// FCM wraps the message's data in {data:{…}}. When the app is in front it already shows the change itself
// (iPhone: always show — Safari drops the subscription after pushes that show nothing).
self.addEventListener("push", ev => {
  let m = {}; try { m = ev.data ? ev.data.json() : {}; } catch (e) {}
  const d = m.data || m, ios = /iPhone|iPad|iPod/.test(self.navigator.userAgent);
  ev.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    if (!ios && !d.test && list.some(c => c.focused)) return;      // a test push shows even with the app in front
    return self.registration.showNotification(d.title || "יומן אירועים", {
      body: d.body || "", tag: d.tag || "ogg-task", renotify: true, icon: "icons/icon-notebook-192.png", badge: "icons/badge-96.png", lang: "he", dir: "rtl", data: { tid: d.tid || "" } });
  }));
});
