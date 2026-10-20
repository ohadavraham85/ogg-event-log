"use strict";
/* Push notifications to phones (FCM) for task changes — the same messages the app's 📨 list shows.
   Trigger: any write to meta/task-<id>. Readers: every team member with a device registered in push/<token>,
   except the one who made the change and the office screen ("צופה").
   Deploy: see README → "התראות פוש". Needs the Blaze plan. */
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { newsFor, clean } = require("./news");

// must be the Firestore database's location (Firebase console → Firestore → the location shown at the top / in settings)
const REGION = process.env.FUNCTIONS_REGION || "me-west1";
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

const WEBPUSH = { headers: { Urgency: "high", TTL: String(24 * 3600) } };
// send, then note on each device how it went (the app shows it: "פוש אחרון נשלח…" / why it failed); forget removed devices
async function sendAll(sends) {
  if (!sends.length) return;
  const res = await getMessaging().sendEach(sends.map(s => s.msg));
  await Promise.all(res.responses.map((r, i) => {
    const code = r.error && r.error.code, ref = sends[i].ref;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") return ref.delete().catch(() => {});
    if (r.error) logger.warn("push failed", code);
    const st = { lastAt: FieldValue.serverTimestamp(), lastOk: !r.error, lastErr: code || "" };
    return Promise.all([
      ref.set({ ...st, lastTitle: String(sends[i].msg.data.title || "").slice(0, 80) }, { merge: true }).catch(() => {}),
      // the team list shows it too (📱 next to the name): when the last push went to this person, and whether it got through
      // update() — never set(): writing would create a members document, i.e. give access to someone no longer in the team
      sends[i].mail ? db.doc("members/" + sends[i].mail).update({ pushAt: st.lastAt, pushOk: st.lastOk, pushErr: st.lastErr }).catch(() => {}) : null,
    ]);
  }));
}
// how many devices a member has push on — kept on members/<mail>.pushDevices for the team list
async function countDevices(mail) {
  if (!mail) return;
  const n = (await db.collection("push").where("mail", "==", mail).get()).size;
  await db.doc("members/" + mail).update({ pushDevices: n }).catch(() => {});   // only an existing member (see sendAll)
}

exports.taskPush = onDocumentWritten({ document: "meta/{doc}", region: REGION, database: DATABASE }, async ev => {
  const before = ev.data.before.exists ? ev.data.before.data() : null;
  const after = ev.data.after.exists ? ev.data.after.data() : null;
  if (ev.params.doc.startsWith("me-")) return replyPush(ev.params.doc.slice(3), before, after);
  if (!ev.params.doc.startsWith("task-")) return;
  const writer = String((after && after._by) || (before && before._by) || "").toLowerCase();
  if (!writer) return;
  if (before && after && JSON.stringify(clean(before)) === JSON.stringify(clean(after)) && !!before._del === !!after._del) return;

  const tokens = await db.collection("push").get();
  if (tokens.empty) return;
  const { members, dept } = await team();
  const whoOf = mail => { const m = members.get(mail); return (m && m.name) || mail.split("@")[0]; };
  const who = whoOf(writer), t = (after && !after._del ? after : before) || {};
  const tid = String(t.id || ev.params.doc.slice(5));

  // what each person turned off in settings → 🔔 התראות (meta/me-<mail>.notifOff)
  const off = await notifOffOf([...new Set(tokens.docs.map(d => String(d.data().mail || "").toLowerCase()).filter(Boolean))]);
  // one message per device (each device keeps its own "every task of the team" setting for managers)
  const sends = [];
  tokens.docs.forEach(d => {
    const p = d.data(), mail = String(p.mail || "").toLowerCase(), m = members.get(mail);
    if (!m || mail === writer || m.role === "viewer" || !p.token) return;
    const R = { mail, name: m.name, dept: (m.name && dept[m.name]) || "", admin: m.role === "admin", all: p.all !== false };
    const no = off.get(mail) || [], news = newsFor(before, after, who, R).filter(n => !no.includes(n.kind));
    if (!news.length) return;
    const body = news.slice(0, 4).map(n => (n.by && n.by !== who ? n.by + ": " : "") + n.text).join("\n") + (news.length > 4 ? "\n…" : "");
    const head = news.some(n => n.kind === "assign" && /הוקצתה/.test(n.text)) ? "הוקצתה לך משימה" : "משימה · " + who;
    sends.push({ ref: d.ref, mail, msg: { token: p.token, data: { title: head, body: (t.title || "") + "\n" + body, tag: "ogg-task-" + tid, tid }, webpush: WEBPUSH } });
  });
  await sendAll(sends);
});

// settings → 🔔 התראות: the kinds each person turned off (assign / update / status / edit / off / fb / rem / ev)
async function notifOffOf(mails) {
  const m = new Map(); if (!mails.length) return m;
  const snaps = await db.getAll(...mails.map(x => db.doc("meta/me-" + x)));
  snaps.forEach((s, i) => { const a = s.exists && s.data().notifOff; if (Array.isArray(a)) m.set(mails[i], a); });
  return m;
}

// a manager answered a feedback (meta/me-<mail>.fbReplies grew): tell that person's devices
async function replyPush(mail, before, after) {
  const was = new Set(((before && before.fbReplies) || []).map(r => r && r.id));
  const fresh = ((after && after.fbReplies) || []).filter(r => r && !was.has(r.id));
  if (!fresh.length) return;
  if (Array.isArray(after.notifOff) && after.notifOff.includes("fb")) return;
  const tokens = await db.collection("push").where("mail", "==", mail).get();
  const r = fresh[fresh.length - 1];
  await sendAll(tokens.docs.filter(d => d.data().token).map(d => ({ ref: d.ref, mail, msg: { token: d.data().token,
    data: { title: "תשובה למשוב שלך" + (r.by ? " · " + r.by : ""), body: String(r.text || ""), tag: "ogg-fbr" }, webpush: WEBPUSH } })));
}

// "שלח לי פוש לבדיקה" in the app: the device writes push/<token>.test — send it a test message
exports.pushTest = onDocumentWritten({ document: "push/{tok}", region: REGION, database: DATABASE }, async ev => {
  const before = ev.data.before.exists ? ev.data.before.data() : null;
  const after = ev.data.after.exists ? ev.data.after.data() : null;
  // a device was added or removed: recount that person's devices
  // (also when the app re-registers on opening: _upd changes — the server's own notes don't touch _upd)
  const stamp = x => x && x._upd && x._upd.toMillis ? x._upd.toMillis() : 0;
  if (!before || !after || before.mail !== after.mail || stamp(before) !== stamp(after)) {
    await countDevices(String((after && after.mail) || (before && before.mail) || "").toLowerCase());
    if (before && after && before.mail) await countDevices(String(before.mail).toLowerCase());
  }
  if (!after || !after.test || !after.token || (before && before.test === after.test)) return;
  await sendAll([{ ref: ev.data.after.ref, mail: String(after.mail || "").toLowerCase(), msg: { token: after.token,
    data: { title: "בדיקה", body: "התראות פוש עובדות במכשיר הזה ✅", tag: "ogg-test", test: "1" }, webpush: WEBPUSH } }]);
});

/* "🚀 פרסם לכולם" (in the beta, managers): a manager writes board/_release {state:"requested"} — the site branch gets one new
   commit whose root files are the beta's (same file contents, so nothing is re-uploaded). GitHub Pages then publishes it.
   GH_TOKEN: a GitHub fine-grained token for this repository only, "Contents: read and write", kept as a Firebase secret. */
const GH_TOKEN = defineSecret("GH_TOKEN");
const REPO = "ohadavraham85/ogg-event-log", SITE_BRANCH = "claude/magical-bell-qcwse4";
exports.release = onDocumentWritten({ document: "board/_release", region: REGION, database: DATABASE, secrets: [GH_TOKEN] }, async ev => {
  const after = ev.data.after.exists ? ev.data.after.data() : null;
  if (!after || after.state !== "requested") return;
  const ref = ev.data.after.ref, by = String(after._by || "").toLowerCase();
  const done = (state, msg, extra) => ref.set({ state, msg: String(msg || "").slice(0, 300), at: FieldValue.serverTimestamp(), ...(extra || {}) }, { merge: true });
  const m = await db.doc("members/" + by).get();
  if (!m.exists || m.data().role !== "admin") return done("error", "רק מנהל יכול לפרסם");
  try {
    const gh = async (method, path, body) => {
      const r = await fetch("https://api.github.com/repos/" + REPO + path, { method, body: body ? JSON.stringify(body) : undefined,
        headers: { Authorization: "Bearer " + GH_TOKEN.value(), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ogg-release" } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("GitHub " + r.status + ": " + (j.message || path));
      return j;
    };
    const head = await gh("GET", "/git/ref/heads/" + SITE_BRANCH);
    const commit = await gh("GET", "/git/commits/" + head.object.sha);
    const tree = await gh("GET", "/git/trees/" + commit.tree.sha + "?recursive=1");
    if (tree.truncated) throw new Error("the file list is too long");
    const beta = tree.tree.filter(e => e.type === "blob" && e.path.startsWith("beta/"));
    const vEntry = beta.find(e => e.path === "beta/version.txt");
    if (!vEntry) throw new Error("no beta to publish");
    const ver = Buffer.from((await gh("GET", "/git/blobs/" + vEntry.sha)).content, "base64").toString().trim();
    const nt = await gh("POST", "/git/trees", { base_tree: commit.tree.sha,
      tree: beta.map(e => ({ path: e.path.slice(5), mode: e.mode, type: "blob", sha: e.sha })) });
    if (nt.sha === commit.tree.sha) return done("done", "כבר אצל כולם", { ver });
    const nc = await gh("POST", "/git/commits", { message: "release " + ver + " (from beta, by " + by + ")", tree: nt.sha, parents: [head.object.sha] });
    await gh("PATCH", "/git/refs/heads/" + SITE_BRANCH, { sha: nc.sha });
    logger.info("released", ver, "by", by);
    await done("done", "", { ver });
  } catch (e) { logger.error("release failed", e.message); await done("error", e.message); }
});

/* 🔔 reminders: every 5 minutes, the people whose earliest reminder (meta/me-<mail>.remNext) is due get a push; sent ones are removed,
   a repeating one (rep: d / w / m) moves on to its next time — the same hour in Israel (summer / winter time included) */
const ilOff = ms => { const s = new Date(ms).toLocaleString("en-US", { timeZone: "Asia/Jerusalem", hourCycle: "h23" });
  return Date.parse(s + " UTC") - Math.floor(ms / 1000) * 1000; };
function nextAt(at, rep, now) {
  const d = new Date(at + ilOff(at)); let n = 0;                       // Israel wall-clock time, kept as UTC fields
  while (d.getTime() - ilOff(at) <= now && n++ < 2000) {
    if (rep === "d") d.setUTCDate(d.getUTCDate() + 1); else if (rep === "w") d.setUTCDate(d.getUTCDate() + 7);
    else if (rep === "m") d.setUTCMonth(d.getUTCMonth() + 1); else return 0;
  }
  const guess = d.getTime() - ilOff(at); return d.getTime() - ilOff(guess);
}
exports.remindTick = onSchedule({ schedule: "every 5 minutes", region: REGION, timeZone: "Asia/Jerusalem" }, async () => {
  const now = Date.now();
  const q = await db.collection("meta").where("remNext", "<=", now).get();
  for (const d of q.docs) {
    if (!d.id.startsWith("me-")) continue;
    const mail = d.id.slice(3), R = (Array.isArray(d.data().reminders) ? d.data().reminders : []).filter(r => r && r.at);
    const due = R.filter(r => r.at <= now), rest = R.filter(r => r.at > now)
      .concat(due.filter(r => r.rep).map(r => ({ ...r, at: nextAt(r.at, r.rep, now) })).filter(r => r.at > now));
    const no = d.data().notifOff;
    if (due.length && !(Array.isArray(no) && no.includes("rem"))) {
      const tokens = await db.collection("push").where("mail", "==", mail).get(), sends = [];
      tokens.docs.forEach(t => { if (!t.data().token) return;
        due.forEach(r => sends.push({ ref: t.ref, mail, msg: { token: t.data().token,
          data: { title: "🔔 תזכורת", body: String(r.title || "משימה"), tag: "ogg-task-" + r.tid, tid: String(r.tid || "") }, webpush: WEBPUSH } })); });
      await sendAll(sends);
    }
    await d.ref.update({ reminders: rest, remNext: rest.length ? Math.min(...rest.map(r => r.at)) : null }).catch(() => {});
  }
});
