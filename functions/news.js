"use strict";
/* The same rules the app uses (cloud.js followsTask / taskNews, app.js taskIsMine / openedByMe),
   worked out on the server for one reader R = {mail, name, dept, admin, all}.
   Keep in step with cloud.js when those change. */

const isMine = (t, R) => !!R.name && ((t.ppl || []).includes(R.name) || (!!R.dept && (t.depts || []).includes(R.dept)));

function openedBy(t, R) {
  if (t.openedMail || t.openedBy) return t.openedMail === R.mail;
  const l = (t.log || []).find(x => x && x.sys && /^המשימה נפתחה/.test(x.text || ""));
  return !!l && l.mail === R.mail;
}

// which tasks send R a message when someone else changes them
function followsTask(x, R) {
  if (!x) return false;
  if (R.admin && R.all) return true;
  return isMine(x, R) || openedBy(x, R) || (x.log || []).some(l => l && l.mail === R.mail);
}

// what changed in one task, as messages for R
function taskNews(was, t, who, R) {
  const mineNow = isMine(t, R), mineWas = !!was && isMine(was, R);
  const out = [], base = { by: who }, dm = v => v ? v.slice(8, 10) + "/" + v.slice(5, 7) : "—";
  if (mineWas && !mineNow) { out.push({ ...base, kind: "off", text: "המשימה כבר לא משויכת אליך" }); return out; }
  if (mineNow && !mineWas) {
    if (t.status !== "הושלמה") out.push({ ...base, kind: "assign",
      text: "הוקצתה לך משימה" + (t.prio && t.prio !== "רגילה" ? " · " + t.prio : "") + (t.due ? " · יעד " + dm(t.due) : "") });
    return out;
  }
  if (!was) {
    out.push({ ...base, kind: "assign", text: "נפתחה משימה חדשה" + ((t.ppl || []).length ? " · אחראי: " + t.ppl[0] : "") +
      ((t.depts || []).length ? " · 🏢 " + t.depts.join(", ") : "") + (t.due ? " · יעד " + dm(t.due) : "") });
    return out;
  }
  const had = new Set((was.log || []).map(l => l && l.id));
  (t.log || []).filter(l => l && !had.has(l.id) && l.mail !== R.mail)
    .forEach(l => out.push({ ...base, kind: l.sys ? "status" : "update", text: l.text || "", by: l.by || who }));
  const ch = [], same = (a, b) => JSON.stringify(a || "") === JSON.stringify(b || "");
  if (!same(t.title, was.title)) ch.push("כותרת");
  if (!same(t.due, was.due)) ch.push("יעד " + dm(t.due));
  if (!same(t.start, was.start)) ch.push("התחלה " + dm(t.start));
  if (!same(t.prio, was.prio)) ch.push("עדיפות " + (t.prio || "רגילה"));
  if (!same(t.type, was.type)) ch.push("סוג " + (t.type || "—"));
  if (!same(t.desc, was.desc)) ch.push("תיאור");
  if (!same(t.loc, was.loc)) ch.push("מיקום");
  if (!same(t.eq, was.eq)) ch.push("ציוד");
  if (!same(t.rep, was.rep)) ch.push("מחזוריות");
  const items = x => (x.check || []).filter(c => c && !c.del).map(c => c.text);
  if (!same(items(t), items(was))) ch.push("רשימת בדיקה");
  if (!same(t.ppl, was.ppl) || !same(t.depts, was.depts)) ch.push("שיוך: " + (t.ppl || []).concat((t.depts || []).map(x => "🏢 " + x)).join(", "));
  if (ch.length) out.push({ ...base, kind: "edit", text: "עודכנו פרטים: " + ch.join(" · ") });
  const fl = x => (x.files || []).filter(f => f && !f.del), wasF = new Set(fl(was).map(f => f.id)), nowF = new Set(fl(t).map(f => f.id));
  const addF = fl(t).filter(f => !wasF.has(f.id)), rmF = fl(was).filter(f => !nowF.has(f.id));
  if (addF.length) out.push({ ...base, kind: "edit", text: (addF.length === 1 ? (/^image\//.test(addF[0].type || "") ? "📷 צורפה תמונה: " : "📎 צורף קובץ: ") + (addF[0].name || "") : "📎 צורפו " + addF.length + " קבצים") });
  if (rmF.length) out.push({ ...base, kind: "edit", text: "הוסר קובץ: " + rmF.map(f => f.name || "").join(", ") });
  if (!out.length && t.status !== was.status) out.push({ ...base, kind: "status", text: "סטטוס: " + (t.status || "") });
  return out;
}

const clean = d => { const e = {}; for (const k in d || {}) if (k[0] !== "_") e[k] = d[k]; return e; };

/* one change of meta/task-<id> (before/after = raw documents or null) → messages for reader R.
   who = the writer's display name. Returns [] when R should not hear about it. */
function newsFor(before, after, who, R) {
  const gone = !after || after._del, was = before && !before._del ? clean(before) : null;
  if (gone) return was && followsTask(was, R) ? [{ by: who, kind: "off", text: "המשימה נמחקה" }] : [];
  const t = clean(after);
  if (was && JSON.stringify(was) === JSON.stringify(t)) return [];   // only the stamp changed
  if (!(followsTask(t, R) || followsTask(was, R))) return [];
  return taskNews(was, t, who, R);
}

module.exports = { isMine, followsTask, taskNews, newsFor, clean };
