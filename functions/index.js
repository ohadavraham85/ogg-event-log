"use strict";
/* Push notifications to phones (FCM) for task changes — the same messages the app's 📨 list shows.
   Trigger: any write to meta/task-<id>. Readers: every team member with a device registered in push/<token>,
   except the one who made the change and the office screen ("צופה").
   Deploy: see README → "התראות פוש". Needs the Blaze plan. */
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { newsFor, clean } = require("./news");

// must be the Firestore database's location (Firebase console → Firestore → the location shown at the top / in settings)
const REGION = process.env.FUNCTIONS_REGION || "us-central1";
// the same database the app uses (firebase-config.js FIREBASE_DATABASE); "(default)" when that is null
const DATABASE = process.env.FIRESTORE_DATABASE || "(default)";

initializeApp();
const db = DATABASE === "(default)" ? getFirestore() : getFirestore(DATABASE);

// team list, names and departments change rarely — keep them for a few minutes between runs
let teamCache = null, teamAt = 0;
async function team() {
  if (teamCache && Date.now() - teamAt < 5 * 60e3) return teamCache;
  const [mem, lists] = await Promise.all([db.collection("members").get(), db.doc("meta/lists").get()]);
  let dept = {};
  try { dept = JSON.parse((lists.exists && lists.data().data) || "{}")._dept_ppl || {}; } catch (e) {}
  const members = new Map();
  mem.docs.forEach(d => members.set(d.id, { mail: d.id, name: d.data().name || "", role: d.data().role || "member" }));
  // a name picked by the member ("אני:" — meta/me-<mail>) when the manager did not set one
  const noName = [...members.values()].filter(m => !m.name);
  if (noName.length) {
    const snaps = await db.getAll(...noName.map(m => db.doc("meta/me-" + m.mail)));
    snaps.forEach((s, i) => { if (s.exists && s.data().name) noName[i].name = s.data().name; });
  }
  teamCache = { members, dept }; teamAt = Date.now();
  return teamCache;
}

exports.taskPush = onDocumentWritten({ document: "meta/{doc}", region: REGION, database: DATABASE }, async ev => {
  if (!ev.params.doc.startsWith("task-")) return;
  const before = ev.data.before.exists ? ev.data.before.data() : null;
  const after = ev.data.after.exists ? ev.data.after.data() : null;
  const writer = String((after && after._by) || (before && before._by) || "").toLowerCase();
  if (!writer) return;
  if (before && after && JSON.stringify(clean(before)) === JSON.stringify(clean(after)) && !!before._del === !!after._del) return;

  const tokens = await db.collection("push").get();
  if (tokens.empty) return;
  const { members, dept } = await team();
  const whoOf = mail => { const m = members.get(mail); return (m && m.name) || mail.split("@")[0]; };
  const who = whoOf(writer), t = (after && !after._del ? after : before) || {};
  const tid = String(t.id || ev.params.doc.slice(5));

  // one message per device (each device keeps its own "every task of the team" setting for managers)
  const sends = [];
  tokens.docs.forEach(d => {
    const p = d.data(), mail = String(p.mail || "").toLowerCase(), m = members.get(mail);
    if (!m || mail === writer || m.role === "viewer" || !p.token) return;
    const R = { mail, name: m.name, dept: (m.name && dept[m.name]) || "", admin: m.role === "admin", all: p.all !== false };
    const news = newsFor(before, after, who, R);
    if (!news.length) return;
    const body = news.slice(0, 4).map(n => (n.by && n.by !== who ? n.by + ": " : "") + n.text).join("\n") + (news.length > 4 ? "\n…" : "");
    const head = news.some(n => n.kind === "assign" && /הוקצתה/.test(n.text)) ? "הוקצתה לך משימה" : "משימה · " + who;
    sends.push({ ref: d.ref, msg: {
      token: p.token,
      data: { title: head, body: (t.title || "") + "\n" + body, tag: "ogg-task-" + tid, tid },
      webpush: { headers: { Urgency: "high", TTL: String(24 * 3600) } },
    } });
  });
  if (!sends.length) return;
  const res = await getMessaging().sendEach(sends.map(s => s.msg));
  // devices that uninstalled the app / turned notifications off: forget them
  await Promise.all(res.responses.map((r, i) => {
    const code = r.error && r.error.code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") return sends[i].ref.delete().catch(() => {});
    if (r.error) logger.warn("push failed", code);
    return null;
  }));
});
