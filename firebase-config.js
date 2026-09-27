/* Team (shared) log — Firebase settings.
   null = local mode: everything stays in this browser only (how the app always worked).
   To turn on the shared team log, paste the web-app config from the Firebase console here, e.g.
   window.FIREBASE_CONFIG = { apiKey:"…", authDomain:"….firebaseapp.com", projectId:"…", appId:"…" };
   These values are not secret — access is enforced by the Firestore security rules (firestore.rules). */
window.FIREBASE_CONFIG = null;
