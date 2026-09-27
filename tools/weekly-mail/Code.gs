/* Weekly e-mails for the team log (team mode / Firebase).
   Runs in Google Apps Script under the account that owns the Firebase project,
   reads Firestore over REST with that account's own permissions, and sends two e-mails:
     weeklySummary() — summary of the last 7 days (HTML)
     weeklyBackup()  — full backup of the log as a JSON attachment (same format as "הורד גיבוי", loadable back into the app)
   Setup: see README.md in this folder. Nothing plant-specific or personal is stored here —
   the project id and recipients live in the script's properties. */

const TZ = "Asia/Jerusalem";

function cfg_(){
  const p = PropertiesService.getScriptProperties();
  const project = (p.getProperty("PROJECT_ID")||"").trim();
  if(!project) throw new Error("חסר PROJECT_ID במאפייני הסקריפט (Project Settings → Script properties)");
  const to = (p.getProperty("RECIPIENTS")||"").trim() || Session.getEffectiveUser().getEmail();
  return { project, to, database: (p.getProperty("DATABASE")||"(default)").trim(),
           title: (p.getProperty("TITLE")||"יומן אירועים").trim(),
           appUrl: (p.getProperty("APP_URL")||"").trim(),
           emulator: (p.getProperty("EMULATOR")||"").trim() };
}

/* ---------- Firestore REST ---------- */
function fsBase_(c){
  return (c.emulator || "https://firestore.googleapis.com") + "/v1/projects/" + c.project + "/databases/" + c.database + "/documents";
}
function fsGet_(c, url){
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions:true, headers:{
    Authorization: "Bearer " + (c.emulator ? "owner" : ScriptApp.getOAuthToken()),
    "x-goog-user-project": c.project } });
  if(r.getResponseCode() === 404) return null;
  if(r.getResponseCode() !== 200) throw new Error("Firestore " + r.getResponseCode() + ": " + r.getContentText().slice(0,300));
  return JSON.parse(r.getContentText());
}
function val_(v){
  if(v == null) return null;
  if("stringValue" in v) return v.stringValue;
  if("booleanValue" in v) return v.booleanValue;
  if("integerValue" in v) return Number(v.integerValue);
  if("doubleValue" in v) return v.doubleValue;
  if("timestampValue" in v) return v.timestampValue;
  if("nullValue" in v) return null;
  if("arrayValue" in v) return (v.arrayValue.values||[]).map(val_);
  if("mapValue" in v){ const o={}, f=v.mapValue.fields||{}; for(const k in f) o[k]=val_(f[k]); return o; }
  return null;
}
function loadAll_(c){
  const base = fsBase_(c), events = [];
  let token = "";
  do{
    const j = fsGet_(c, base + "/events?pageSize=300" + (token ? "&pageToken=" + encodeURIComponent(token) : ""));
    ((j && j.documents) || []).forEach(d => {
      const o = {}; for(const k in (d.fields||{})) o[k] = val_(d.fields[k]);
      if(o._del) return;
      delete o._del; delete o._upd; delete o._by;
      if(!o.id) o.id = d.name.split("/").pop();
      events.push(o);
    });
    token = j && j.nextPageToken;
  }while(token);
  let lists = {};
  const ld = fsGet_(c, base + "/meta/lists");
  if(ld && ld.fields && ld.fields.data){ try{ lists = JSON.parse(val_(ld.fields.data)) || {}; }catch(e){} }
  events.sort((a,b) => String(b.when||"").localeCompare(String(a.when||"")));
  return { events, lists };
}

/* ---------- helpers ---------- */
const arr_ = v => Array.isArray(v) ? v : (v ? [v] : []);
const isOpen_ = e => (arr_(e.stat)[0] || "פתוח") !== "נסגר";
const isFault_ = e => arr_(e.type).indexOf("תקלה") >= 0;
const esc_ = s => String(s == null ? "" : s).replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
function stamp_(d, f){ return Utilities.formatDate(d, TZ, f || "yyyy-MM-dd'T'HH:mm"); }
function fmtWhen_(s){ const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d:\d\d))?/.exec(s||""); return m ? m[3]+"/"+m[2]+(m[4]?" "+m[4]:"") : esc_(s); }

/* ---------- weekly summary ---------- */
function weeklySummary(){
  const c = cfg_(), { events } = loadAll_(c);
  const now = new Date(), from = new Date(now.getTime() - 7*864e5);
  const since = stamp_(from), today = stamp_(now);
  const week = events.filter(e => String(e.when||"") >= since && String(e.when||"") <= today + "~");
  const closedWeek = events.filter(e => !isOpen_(e) && String(e.closedAt||"") >= since);
  const open = events.filter(isOpen_), openFaults = open.filter(isFault_);
  const byType = {};
  week.forEach(e => (arr_(e.type).length ? arr_(e.type) : ["ללא סוג"]).forEach(t => byType[t] = (byType[t]||0) + 1));
  const range = stamp_(from, "dd/MM") + "–" + stamp_(now, "dd/MM/yyyy");

  const card = (label, n, color) =>
    '<td style="padding:10px 14px;border:1px solid #DCE3E8;border-radius:10px;text-align:center;background:#fff">' +
    '<div style="font-size:26px;font-weight:800;color:' + (color||"#16202A") + '">' + n + '</div>' +
    '<div style="font-size:13px;color:#566877">' + label + '</div></td>';
  const row = e => '<tr>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #EEF2F5;white-space:nowrap">' + fmtWhen_(e.when) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #EEF2F5">' + esc_(arr_(e.type).join(", ")) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #EEF2F5"><b>' + esc_(e.title||"") + '</b>' +
      (e.desc ? '<div style="color:#566877;font-size:12.5px">' + esc_(String(e.desc).slice(0,200)) + '</div>' : '') + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #EEF2F5">' + esc_(arr_(e.loc).concat(arr_(e.eq)).join(", ")) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #EEF2F5;white-space:nowrap;color:' + (isOpen_(e)?"#B8352F":"#0E7C86") + '">' +
      (isOpen_(e) ? "פתוח" : "נסגר") + '</td></tr>';
  const table = (title, rows, cap) => !rows.length ? "" :
    '<h3 style="margin:22px 0 6px;font-size:16px">' + title + ' (' + rows.length + ')</h3>' +
    '<table style="border-collapse:collapse;width:100%;font-size:13.5px"><tr style="background:#F4F6F8;text-align:right">' +
    '<th style="padding:6px 8px">תאריך</th><th style="padding:6px 8px">סוג</th><th style="padding:6px 8px">כותרת</th>' +
    '<th style="padding:6px 8px">מיקום / ציוד</th><th style="padding:6px 8px">סטטוס</th></tr>' +
    rows.slice(0, cap).map(row).join("") + '</table>' +
    (rows.length > cap ? '<div style="color:#566877;font-size:12.5px;margin-top:4px">ועוד ' + (rows.length-cap) + ' — הרשימה המלאה באפליקציה</div>' : '');

  const types = Object.keys(byType).sort((a,b) => byType[b]-byType[a])
    .map(t => esc_(t) + ": <b>" + byType[t] + "</b>").join(" · ");
  const html =
    '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;color:#16202A;max-width:900px">' +
    '<h2 style="margin:0 0 4px;color:#0E7C86">' + esc_(c.title) + ' — סיכום שבועי</h2>' +
    '<div style="color:#566877;margin-bottom:14px">' + range + '</div>' +
    '<table style="border-collapse:separate;border-spacing:8px 0"><tr>' +
      card("נרשמו השבוע", week.length) + card("תקלות השבוע", week.filter(isFault_).length, "#D6342C") +
      card("נסגרו השבוע", closedWeek.length, "#0E7C86") + card("פתוחים כעת", open.length, "#8F5A06") +
      card("תקלות פתוחות", openFaults.length, "#D6342C") +
    '</tr></table>' +
    (types ? '<p style="margin:16px 0 0">לפי סוג: ' + types + '</p>' : '') +
    table("אירועי השבוע", week, 150) +
    table("תקלות פתוחות", openFaults.slice().reverse(), 60) +
    (c.appUrl ? '<p style="margin-top:22px"><a href="' + esc_(c.appUrl) + '">פתיחת היומן</a></p>' : '') +
    '<p style="color:#8494A1;font-size:12px;margin-top:22px">נשלח אוטומטית מהיומן המשותף.</p></div>';

  MailApp.sendEmail({ to: c.to, subject: c.title + " — סיכום שבועי " + range, htmlBody: html,
    body: "סיכום שבועי " + range + ": נרשמו " + week.length + ", נסגרו " + closedWeek.length + ", פתוחים " + open.length + "." });
}

/* ---------- weekly backup ---------- */
function weeklyBackup(){
  const c = cfg_(), { events, lists } = loadAll_(c);
  const out = { app:"ogg-event-log", version:2, saved:new Date().toISOString(), events, lists };
  const day = stamp_(new Date(), "yyyy-MM-dd");
  const blob = Utilities.newBlob(JSON.stringify(out), "application/json", "גיבוי-יומן-" + day + ".json");
  const zip = Utilities.zip([blob], "גיבוי-יומן-" + day + ".zip");
  MailApp.sendEmail({ to: c.to, subject: c.title + " — גיבוי שבועי " + stamp_(new Date(), "dd/MM/yyyy"),
    body: "מצורף גיבוי מלא של היומן (" + events.length + " אירועים).\n" +
          "לשחזור: לחלץ את קובץ ה-JSON מה-zip, ובאפליקציה: רשימות וקובץ ← טען גיבוי.",
    attachments: [zip] });
}

/* ---------- one-time setup: run once from the editor ---------- */
function setup(){
  ScriptApp.getProjectTriggers().forEach(t => {
    if(["weeklySummary","weeklyBackup"].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("weeklySummary").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(7).inTimezone(TZ).create();
  ScriptApp.newTrigger("weeklyBackup").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(8).inTimezone(TZ).create();
  weeklySummary(); weeklyBackup();   // send one of each now, to check it works
}
