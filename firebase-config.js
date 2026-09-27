/* Team (shared) log — Firebase settings.
   null = local mode: everything stays in this browser only (how the app always worked).
   To turn on the shared team log, paste the web-app config from the Firebase console here, e.g.
   window.FIREBASE_CONFIG = { apiKey:"…", authDomain:"….firebaseapp.com", projectId:"…", appId:"…" };
   These values are not secret — access is enforced by the Firestore security rules (firestore.rules). */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCSCT2cUBuKY6fDXdHpUyYE_-KN6s61bfU",
  authDomain: "project-06006ec8-b6b5-42df-af9.firebaseapp.com",
  projectId: "project-06006ec8-b6b5-42df-af9",
  storageBucket: "project-06006ec8-b6b5-42df-af9.firebasestorage.app",
  messagingSenderId: "499764630425",
  appId: "1:499764630425:web:3458b66f99950f43533908"
};
/* Optional: the Firestore database to use. Leave null for the project's default database; set a name
   (e.g. "event-log") to keep the log in its own database when the project also serves another app. */
window.FIREBASE_DATABASE = null;
