"use strict";
const $ = s => document.querySelector(s);
/* office screen ("מסך משרד"): ?tv=1 in the address, or signed in as a "צופה" — the app shows only the big rotating screen */
var TV = /[?&]tv=1\b/.test(location.search);
var BETA = /\/beta\//.test(location.pathname);   // the test copy (…/beta/): marked in the header, its own cache

/* ================= seed lists ================= */
const SEED = {
  type:["תקלה","אחזקה חודשית","גלישות חרום","אחזקה","אחזקה מונעת","אחזקה שנתית","אחזקת שבר","אחזקה מתוכננת","אחזקה יומית","אחזקה שבועית","הפסקות חשמל",
        "תהליך","הודעת יומן","ביקור","נפילות/קפיצות חשמל","סיור בטיחות חודשי","כללי"],
  loc:[], eq:[], ppl:[],   // plant-specific values are not kept in the code: they come from
                          // the events on this device, from values added in the app, and from loaded backups
  stat:["פתוח","בטיפול","ממתין לחלק","נסגר"]
};
const META = {
  type:{title:"סוג אירוע", multi:false},
  loc:{title:"מיקום",      multi:true },
  eq:{title:"ציוד",         multi:true },
  ppl:{title:"מעורבים",     multi:true },
  stat:{title:"סטטוס",      multi:false}
};
const TONE = {"תקלה":"f","גלישות חרום":"a","הפסקות חשמל":"a","נפילות/קפיצות חשמל":"a"};
const HUE = {"תקלה":"fault","גלישות חרום":"flood","הפסקות חשמל":"power","נפילות/קפיצות חשמל":"power",
  "אחזקה":"maint","אחזקה חודשית":"maint","אחזקה שנתית":"maint","אחזקה מונעת":"maint",
  "אחזקת שבר":"fault","אחזקה מתוכננת":"maint","אחזקה יומית":"maint","אחזקה שבועית":"maint",
  "ביקור":"visit","סיור בטיחות חודשי":"visit","תהליך":"visit"};
/* task categories: three anchors that are always there (they can't be taken out of the list) and each has its own colour;
   other categories can be added and taken out (✕). Events keep calling the same list "סוג". */
const TK_CATS=["אחזקות שבר","אחזקות יזומות","אחזקות מתוכננות"];
Object.assign(HUE,{"אחזקות שבר":"fault","אחזקות יזומות":"power","אחזקות מתוכננות":"visit"});
function tkCats(){ return TK_CATS.concat(byUse("type").filter(v=>!TK_CATS.includes(v))); }
// equipment tags: every piece of equipment gets its own colour, always the same one (a hue from its name)
// fixed vivid colours by the kind of equipment in the name (generic words): high voltage red, generators yellow, low voltage green, switchboards orange
function eqKind(q){ q=String(q); return /מתח\s*גבוה/.test(q) ? "hv" : /גנרטור/.test(q) ? "gen" : /מתח\s*נמוך/.test(q) ? "lv" : /לוח(ות)?\s*חשמל/.test(q) ? "pnl" : ""; }
function eqPaint(el,q){ const k=eqKind(q); if(k) el.classList.add("eqv","eqv-"+k); else el.style.setProperty("--eqh",eqHue(q)); }
function eqHue(q){ let h=0; for(const ch of String(q)) h=(h*31+ch.codePointAt(0))>>>0; return Math.round((h%997)*137.508)%360; }
function hueOf(t){ return HUE[t] || (/^אחזק/.test(t||"") ? "maint" : "gen"); }
/* event types in one family stay together in every list ("אחזקה", "אחזקה חודשית", "אחזקת שבר"…):
   families by their first word (אחזקה/אחזקת = the same), each where its most used member is,
   the plain word first, then in a fixed order (see rank). */
function groupTypes(arr){
  const stem=v=>String(v).trim().split(/\s+/)[0].replace(/[התי]$/,""), fam=new Map();
  arr.forEach(v=>{ const k=stem(v); if(!fam.has(k)) fam.set(k,[]); fam.get(k).push(v); });
  // inside a family a fixed order: the plain word, then by how often (יומית → שבועית → חודשית → רבעונית → שנתית), then מונעת, מתוכננת, שבר, then the rest
  const rank=v=>{ v=String(v).trim(); if(!/\s/.test(v)) return 0;
    const r=[[/יומי/,1],[/שבועי/,2],[/חודשי/,3],[/רבעוני/,4],[/חצי.?שנתי/,5],[/שנתי/,6],[/מונע/,7],[/מתוכנ/,8],[/שבר/,9]].find(([re])=>re.test(v));
    return r ? r[1] : 10; };
  return [...fam.values()].flatMap(g=>g.map((v,i)=>[v,i]).sort((a,b)=>rank(a[0])-rank(b[0]) || a[1]-b[1]).map(x=>x[0]));
}
const isCore=v=>!!(lists && (lists._core_ppl||[]).includes(v));
const roleOf=v=>(lists && lists._roles_ppl && lists._roles_ppl[v]) || "";
const deptOf=v=>(lists && lists._dept_ppl && lists._dept_ppl[v]) || "";
function personTags(v){          // small tags after a name: department, role
  const f=document.createDocumentFragment();
  if(deptOf(v)){ f.append(" "); f.appendChild(mk("small","dept",deptOf(v))); }
  if(roleOf(v)){ f.append(" "); f.appendChild(mk("small","role",roleOf(v))); }
  return f;
}
const coreFirst=(arr,k)=>k!=="ppl" ? arr : arr.filter(isCore).concat(arr.filter(v=>!isCore(v)));

/* ================= state ================= */
const CLOUD_ON=!!window.FIREBASE_CONFIG;   // team log (cloud.js) when firebase-config.js is filled in
const LS = CLOUD_ON ? "ogg-cloud-log" : "ogg-log-v2", LSL = CLOUD_ON ? "ogg-cloud-lists" : "ogg-lists-v2";
let events=[], lists=null, editId=null, fileHandle=null;
const sel = {type:[], loc:[], eq:[], ppl:[], stat:["פתוח"]};

/* the log and the tasks can outgrow the browser's small storage (~5MB): then they go to IndexedDB instead.
   saveBig resolves true only when the data is really kept somewhere — the team sync moves its "synced up to here"
   mark only after that, so a failed save can't leave a device thinking it has records it doesn't. */
const KV={p:null};
function kvdb(){ return KV.p || (KV.p=new Promise((res,rej)=>{ const r=indexedDB.open("ogg-kv",1);
  r.onupgradeneeded=()=>r.result.createObjectStore("kv"); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
async function kvOp(mode,fn){ const db=await kvdb(); return new Promise((res,rej)=>{ const tx=db.transaction("kv",mode), st=tx.objectStore("kv"), r=fn(st);
  tx.oncomplete=()=>res(r && r.result); tx.onerror=()=>rej(tx.error); }); }
const kvSet=(k,v)=>kvOp("readwrite",st=>st.put(v,k)), kvGet=k=>kvOp("readonly",st=>st.get(k)), kvDel=k=>kvOp("readwrite",st=>st.delete(k));
function saveBig(k,str){
  try{ localStorage.setItem(k,str); kvDel(k).catch(()=>{}); return Promise.resolve(true); }
  catch(e){ try{ localStorage.removeItem(k); }catch(_){} return kvSet(k,str).then(()=>true,()=>false); }
}
async function loadBig(k){ try{ const v=localStorage.getItem(k); if(v) return v; }catch(e){} try{ return (await kvGet(k))||null; }catch(e){ return null; } }
window.saveBig=saveBig; window.loadBig=loadBig; window.kvDel=kvDel;
// what didn't fit in localStorage is read back from IndexedDB (before the team sync starts — it waits for this)
window.bigReady=(async()=>{
  await Promise.resolve();                          // after the whole script has run (load() first)
  try{ if(!localStorage.getItem(LS)){ const v=await loadBig(LS); if(v){ events=JSON.parse(v)||[];
    Object.keys(SEED).forEach(k=>{ const custom=lists["_custom_"+k]||[], hidden=lists["_hide_"+k]||[];
      lists[k]=[...new Set(SEED[k].concat(custom, events.flatMap(e=>Array.isArray(e[k])?e[k]:[])))].filter(v=>!hidden.includes(v)); });
    renderAll(); } } }catch(e){}
  try{ if(!localStorage.getItem(LST)){ const v=await loadBig(LST); if(v){ tasks=JSON.parse(v)||[]; renderTasks(); } } }catch(e){}
})();
function load(){
  try{ events = JSON.parse(localStorage.getItem(LS)||"[]"); }catch(e){ events=[]; }
  let saved={}; try{ saved = JSON.parse(localStorage.getItem(LSL)||"{}"); }catch(e){}
  lists = {};
  Object.keys(SEED).forEach(k=>{
    const custom = Array.isArray(saved[k]) ? saved[k] : [];
    const hidden = Array.isArray(saved["_hide_"+k]) ? saved["_hide_"+k] : [];
    const used = events.flatMap(e=>Array.isArray(e[k])?e[k]:[]);
    lists[k] = [...new Set(SEED[k].concat(custom, used))].filter(v=>!hidden.includes(v));
    lists["_custom_"+k] = custom; lists["_hide_"+k] = hidden;
  });
  lists._core_ppl = Array.isArray(saved._core_ppl) ? saved._core_ppl : [];   // ⭐ core staff: always first, own colour
  lists._roles_ppl = saved._roles_ppl && typeof saved._roles_ppl==="object" ? saved._roles_ppl : {};   // person → role
  lists._dept_ppl = saved._dept_ppl && typeof saved._dept_ppl==="object" ? saved._dept_ppl : {};      // person → department
}
/* serial numbers: every event and every task keeps a permanent number — #1 is the oldest
   (events by their date, tasks by when they were opened); a new one gets the next number.
   Team log: numbering waits for the first full sync, and a long run of unnumbered records (the first
   numbering, an import) is left to a manager's device. Two devices giving the same number at once:
   the older record keeps it, the other gets the next free one (the same on every device). */
function numberAll(arr, key){
  const used=new Set(); let changed=false;
  const ord=(a,b)=>String(key(a)).localeCompare(String(key(b))) || String(a.id).localeCompare(String(b.id));
  arr.filter(x=>x.no).sort(ord).forEach(x=>{ if(used.has(x.no)){ delete x.no; changed=true; } else used.add(x.no); });
  const todo=arr.filter(x=>!x.no).sort(ord); if(!todo.length) return changed;
  let max=0; used.forEach(n=>{ if(n>max) max=n; });
  todo.forEach(x=>{ x.no=++max; }); return true;
}
const canNumber=(n,ready)=>!CLOUD_ON || (ready && (n<=20 || isManager()));
function ensureNos(){
  const ce = canNumber(events.filter(e=>!e.no).length, window.CLOUD_READY) && numberAll(events, e=>e.when||"");
  const ct = canNumber(tasks.filter(t=>!t.no).length, window.CLOUD_READY && window.TASKS_READY) && numberAll(tasks, t=>t.created||t.start||"");
  if(ct){ try{ localStorage.setItem(LST, JSON.stringify(tasks)); }catch(e){} if(window.cloudPushTasks) window.cloudPushTasks(); }
  return ce;
}
window.nosAfterSync=()=>{ const ce=ensureNos(); if(ce){ persist(); renderAll(); } renderTasks(); };
const snOf=x=>x && x.no ? "#"+x.no : "";
function persist(){
  ensureNos();
  saveBig(LS, JSON.stringify(events)).then(ok=>{ if(!ok) toast("הדפדפן חסם שמירה מקומית"); });
  try{
    const out={}; Object.keys(SEED).forEach(k=>{ out[k]=lists["_custom_"+k]; out["_hide_"+k]=lists["_hide_"+k]; }); out._core_ppl=lists._core_ppl||[]; out._roles_ppl=lists._roles_ppl||{}; out._dept_ppl=lists._dept_ppl||{};
    localStorage.setItem(LSL, JSON.stringify(out));
  }catch(e){ toast("הדפדפן חסם שמירה מקומית"); }
  // a linked file that is waiting for the browser's permission: ask now (we are inside a click)
  if(!fileHandle && pendingHandle) ensureFilePermission().then(ok=>{ if(ok) writeFile(); });
  else writeFile();
  if(window.cloudPush) window.cloudPush();   // team log: send what changed
}
function toast(m, act){
  const t=$("#toast"), s=t.firstElementChild; s.textContent=m;
  if(act){
    const b=document.createElement("button"); b.type="button"; b.className="tact"; b.textContent=act.label;
    b.onclick=()=>{ t.classList.remove("on"); act.fn(); }; s.appendChild(b);
  }
  t.classList.toggle("act",!!act); t.classList.add("on");
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("on"), act?5000:2200);
}
function useCount(key){
  const c={}; events.forEach(e=>{ (e[key]||[]).forEach(v=>{ c[v]=(c[v]||0)+1; }); }); return c;
}

/* ================= picker rows ================= */
const ROW = {type:"#pType", loc:"#pLoc", eq:"#pEq", ppl:"#pPpl", stat:"#pStat"};
function paintRows(){
  Object.keys(ROW).forEach(k=>{
    const el=$(ROW[k]), v=el.querySelector(".v"), vals=sel[k];
    el.classList.remove("filled","f","a");
    const old=el.querySelector(".tags"); if(old) old.remove();
    if(!vals.length){ v.textContent = k==="stat" ? "פתוח" : "בחר מהרשימה"; v.classList.add("none"); return; }
    v.classList.remove("none");
    if(META[k].multi && vals.length>1){
      v.textContent = vals.length+" נבחרו";
      const tg=document.createElement("div"); tg.className="tags";
      vals.forEach(x=>{ const s=document.createElement("span"); s.className="tag"; s.textContent=x; tg.appendChild(s); });
      el.querySelector(".mid").appendChild(tg);
    } else v.textContent = vals[0];
    el.classList.add("filled");
    if(k==="type" && TONE[vals[0]]) el.classList.add(TONE[vals[0]]);
  });
}
Object.keys(ROW).forEach(k=>{ $(ROW[k]).onclick = ()=>openSheet(k); });

/* ================= sheet ================= */
let shKey=null;
function openSheet(k){
  shKey=k;
  $("#shTitle").textContent = META[k].title + (META[k].multi && sel[k].length ? " · נבחרו "+sel[k].length : "");
  $("#shQ").value=""; $("#shNew").value="";
  $("#shNew").placeholder = "הוסף " + META[k].title + " חדש";
  drawOpts();
  $("#scrim").classList.add("on"); $("#sheet").classList.add("on");
  document.body.style.overflow="hidden";
  setTimeout(()=>$("#shQ").focus({preventScroll:true}), 260);
}
function closeSheet(){
  $("#scrim").classList.remove("on"); $("#sheet").classList.remove("on");
  document.body.style.overflow=""; shKey=null;
}
function drawOpts(){
  const box=$("#shOpts"); box.textContent="";
  const q=$("#shQ").value.trim(), k=shKey, cnt=useCount(k), custom=lists["_custom_"+k];
  let items = coreFirst(lists[k].slice().sort((a,b)=>(cnt[b]||0)-(cnt[a]||0)), k);
  if(k==="type") items=groupTypes(items);
  const hits = items.filter(v=>!q || v.includes(q));
  if(q && !items.includes(q)){   // typed in the search and it isn't in the list: add it from here
    const ad=document.createElement("button"); ad.type="button"; ad.className="opt opt-add"; ad.textContent="+ הוסף: "+q;
    ad.onclick=()=>{ $("#shQ").value=""; addValue(k, q); if(!META[k].multi) closeSheet(); };
    box.appendChild(ad);
  }
  if(!hits.length){
    const d=document.createElement("div"); d.className="empty"; d.style.margin="10px";
    d.innerHTML="<b>אין התאמה</b>אפשר להוסיף את הערך למטה.";
    box.appendChild(d); return;
  }
  hits.forEach(v=>{
    const on = sel[k].includes(v);
    const b=document.createElement("button");
    b.type="button"; b.className="opt"+(k==="ppl"&&isCore(v)?" core":""); b.setAttribute("aria-pressed", on?"true":"false");
    const bx=document.createElement("span"); bx.className="bx"; bx.textContent="✓";
    const tx=document.createElement("span"); tx.textContent=v;
    if(k==="ppl") tx.appendChild(personTags(v));
    b.append(bx,tx);
    if(custom.includes(v) && !cnt[v] && isManager()){
      const d=document.createElement("button"); d.className="del"; d.textContent="✕"; d.title="הסר מהרשימה";
      d.onclick = async ev=>{ ev.stopPropagation(); if(await confirmDel("להסיר מהרשימה?", META[k].title+": "+v)) removeValue(k,v); };
      b.appendChild(d);
    } else if(cnt[v]){
      const u=document.createElement("span"); u.className="use"; u.textContent=cnt[v]; b.appendChild(u);
    }
    b.onclick = ()=>{
      if(META[k].multi){
        const i=sel[k].indexOf(v);
        // several at once: the list stays open (✓ marks; tap again removes); the search clears for the next name; "סיום" closes
        if(i>=0) sel[k].splice(i,1); else sel[k].push(v);
        paintRows();
        if(i<0 && $("#shQ").value){ $("#shQ").value=""; }
        drawOpts();
        $("#shTitle").textContent = META[k].title + (sel[k].length ? " · נבחרו "+sel[k].length : "");
        if(!ssPhone()) $("#shQ").focus({preventScroll:true});
      }else{
        sel[k]=[v]; paintRows(); closeSheet();
      }
    };
    box.appendChild(b);
  });
}
function addValue(k, v){
  v=v.trim(); if(!v) return;
  if(!lists[k].includes(v)){
    lists["_custom_"+k].push(v);
    const h=lists["_hide_"+k].indexOf(v); if(h>=0) lists["_hide_"+k].splice(h,1);
    lists[k].push(v);
  }
  if(META[k].multi){ if(!sel[k].includes(v)) sel[k].push(v); } else sel[k]=[v];
  persist(); drawOpts(); paintRows(); renderMgr();
  toast("נוסף לרשימה");
}
function removeValue(k, v){
  const c=lists["_custom_"+k].indexOf(v); if(c>=0) lists["_custom_"+k].splice(c,1);
  const i=lists[k].indexOf(v); if(i>=0) lists[k].splice(i,1);
  const s=sel[k].indexOf(v); if(s>=0) sel[k].splice(s,1);
  persist(); if(shKey) drawOpts(); paintRows(); renderMgr();
}
function hideSeed(k, v){
  if(!lists["_hide_"+k].includes(v)) lists["_hide_"+k].push(v);
  const i=lists[k].indexOf(v); if(i>=0) lists[k].splice(i,1);
  const s=sel[k].indexOf(v); if(s>=0) sel[k].splice(s,1);
  persist(); paintRows(); renderMgr(); toast("הוסר מהרשימה");
}
$("#shQ").oninput = drawOpts;
$("#shAdd").onclick = ()=>{ const v=$("#shNew").value.trim(); if(!v) return; addValue(shKey, v); $("#shNew").value=""; closeSheet(); };
$("#shNew").onkeydown = e=>{ if(e.key==="Enter"){ e.preventDefault(); $("#shAdd").click(); } };
$("#shDone").onclick = ()=>{ const v=$("#shNew").value.trim(); if(v){ $("#shAdd").click(); return; } closeSheet(); };   // a new value typed but "סיום" pressed: it is added
$("#shClose").onclick = closeSheet;
$("#scrim").onclick = closeSheet;
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && shKey) closeSheet(); });

/* ================= list manager ================= */
/* ===== list management (settings → "ניהול רשימות"): one place for people, locations, equipment and event types.
   Active values appear in every dropdown (event form, tasks, filters for new work). "הוצא משימוש" retires a value:
   it disappears from all dropdowns, but old events keep it and the history filters still find it. */
const MGR_KEYS=[["ppl","אנשים"],["loc","מיקומים"],["eq","ציוד"],["type","סוגי אירוע"]];
const mgrOpen=new Set(), mgrQ={};
function retireValue(k,v){ if(!lists["_hide_"+k].includes(v)) lists["_hide_"+k].push(v);
  const i=lists[k].indexOf(v); if(i>=0) lists[k].splice(i,1); const s=sel[k].indexOf(v); if(s>=0) sel[k].splice(s,1);
  persist(); paintRows(); renderMgr(); renderTasks();
  toast(v+" הוצא משימוש",{label:"בטל",fn:()=>restoreValue(k,v)}); }
function restoreValue(k,v){ const h=lists["_hide_"+k].indexOf(v); if(h>=0) lists["_hide_"+k].splice(h,1);
  if(!lists[k].includes(v)) lists[k].push(v); persist(); paintRows(); renderMgr(); renderTasks(); toast(v+" חזר לרשימות"); }
/* duplicates: likely the same person/place written differently — spelling (ו/י, spaces, punctuation),
   or a first/last name alone next to the full name. Merging rewrites the value in every event and task. */
const skel=v=>String(v).replace(/["'״׳.\-+]/g,"").replace(/\s+/g,"").replace(/(?!^)[וי]/g,"");
function lev(x,y){ if(Math.abs(x.length-y.length)>1) return 9; const m=x.length,n=y.length; let p=[...Array(n+1).keys()];
  for(let i=1;i<=m;i++){ const c=[i]; for(let j=1;j<=n;j++) c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(x[i-1]===y[j-1]?0:1)); p=c; } return p[n]; }
function dupPairs(k){
  const cnt=useCount(k), vals=[...new Set(lists[k].concat(Object.keys(cnt)))].filter(v=>!(lists["_hide_"+k]||[]).includes(v)), out=[];
  const toks=v=>String(v).trim().split(/\s+/);
  for(let i=0;i<vals.length;i++) for(let j=i+1;j<vals.length;j++){
    const x=vals[i], y=vals[j], sx=skel(x), sy=skel(y);
    const code=v=>String(v).replace(/[^0-9A-Za-z]/g,"").toUpperCase();   // B103 vs B107, EB1 vs EB2: different things
    if(code(x)===code(y) && (sx===sy || (sx.length>=4 && sy.length>=4 && lev(sx,sy)<=1))){
      const [from,to]=(cnt[x]||0)<=(cnt[y]||0)?[x,y]:[y,x]; out.push({from,to,why:"כתיב"}); continue; }
    // a single word next to a two-word full name that starts or ends with it (אוהד → אוהד אברהם, EB1 → חדר חשמל EB1)
    const tx=toks(x), ty=toks(y), [s,l,sv,lv]=tx.length<ty.length?[tx,ty,x,y]:[ty,tx,y,x];
    const two = k==="ppl" ? l.length===2 : l.length>=2;
    if(s.length===1 && two && s[0].length>=2 && (skel(l[0])===skel(s[0]) || skel(l[l.length-1])===skel(s[0])) && code(s[0])===code(k==="ppl"?s[0]:l.join("")) )
      out.push({from:sv,to:lv,why:"שם חלקי"});
  }
  return out.sort((p,q)=>(cnt[q.to]||0)-(cnt[p.to]||0));
}
/* merge: one value becomes another; split: one value ("שלומי איציק") becomes several ("שלומי אביטל", "איציק גואל").
   Only the value inside events/tasks changes — no event is added or removed. */
function snapValues(){          // for "בטל": the value arrays of every event/task + the list settings
  const keys=MGR_KEYS.map(x=>x[0]);
  return { ev:events.map(e=>[e,keys.map(k=>Array.isArray(e[k])?e[k].slice():e[k])]), tk:tasks.map(t=>[t,keys.map(k=>Array.isArray(t[k])?t[k].slice():t[k])]),
    ls:keys.map(k=>[k,(lists["_custom_"+k]||[]).slice(),(lists["_hide_"+k]||[]).slice()]), keys,
    core:(lists._core_ppl||[]).slice(), roles:Object.assign({},lists._roles_ppl||{}), depts:Object.assign({},lists._dept_ppl||{}) };
}
function restoreValues(s){
  s.ev.forEach(([e,v])=>s.keys.forEach((k,i)=>{ if(v[i]===undefined) delete e[k]; else e[k]=v[i]; }));
  s.tk.forEach(([t,v])=>s.keys.forEach((k,i)=>{ if(v[i]===undefined) delete t[k]; else t[k]=v[i]; }));
  s.ls.forEach(([k,c,h])=>{ lists["_custom_"+k]=c; lists["_hide_"+k]=h; });
  lists._core_ppl=s.core; lists._roles_ppl=s.roles; lists._dept_ppl=s.depts;
  persist(); saveTasks(); load(); renderAll(); renderMgr();
}
function remapCore(k, from, toArr){          // returns how many events changed; never adds or removes events
  let n=0; const swap=arr=>[...new Set(arr.flatMap(v=>v===from?toArr:[v]))];
  events.forEach(e=>{ if((e[k]||[]).includes(from)){ e[k]=swap(e[k]); n++; } });
  tasks.forEach(t=>{ if((t[k]||[]).includes(from)) t[k]=swap(t[k]); });
  lists["_custom_"+k]=lists["_custom_"+k].filter(v=>v!==from); lists["_hide_"+k]=(lists["_hide_"+k]||[]).filter(v=>v!==from);
  lists[k]=lists[k].filter(v=>v!==from);
  if(k==="ppl") ["_roles_ppl","_dept_ppl"].forEach(key=>{ const m=lists[key]; if(m && m[from]){ const r=m[from]; delete m[from];
    if(toArr.length===1 && !m[toArr[0]]) m[toArr[0]]=r; } });
  if(k==="ppl" && (lists._core_ppl||[]).includes(from)){ lists._core_ppl=lists._core_ppl.filter(v=>v!==from); toArr.forEach(v=>{ if(!lists._core_ppl.includes(v)) lists._core_ppl.push(v); }); }
  toArr.forEach(v=>{ if(!lists[k].includes(v)) lists[k].push(v); if(!lists["_custom_"+k].includes(v)) lists["_custom_"+k].push(v); });
  return n;
}
async function mergeValue(k, from, to){
  const toArr=(Array.isArray(to)?to:[to]).map(v=>String(v).trim()).filter(v=>v && v!==from);
  if(!from || !toArr.length) return;
  const split=toArr.length>1;
  const cnt=useCount(k), nT=tasks.filter(t=>(t[k]||[]).includes(from)).length;
  const ok=await confirmDel(split?"לפצל?":"למזג?", "“"+from+"” ("+nf(cnt[from]||0)+" אירועים"+(nT?", "+nT+" משימות":"")+")\n"+(split?"יהפוך ל-"+toArr.length+": ":"יהפוך ל: ")+toArr.map(v=>"“"+v+"”").join(" + "),
    false, {ok1:split?"המשך לפיצול":"המשך למיזוג", ok2:split?"כן, פצל":"כן, מזג",
      warn:"⚠ אישור שני: הערך יוחלף בכל האירועים והמשימות"+(CLOUD_ON?" — לכל הצוות":"")+". מספר האירועים לא משתנה. אפשר לבטל מיד אחרי."});
  if(!ok) return;
  const snap=snapValues(), n=remapCore(k,from,toArr);
  persist(); saveTasks(); renderAll(); renderMgr();
  toast((split?"פוצל: ":"מוזג: ")+from+" ← "+toArr.join(" + ")+" ("+n+" אירועים)",{label:"בטל",fn:()=>{ restoreValues(snap); toast(split?"הפיצול בוטל":"המיזוג בוטל"); }});
}
/* corrections file: {"app":"ogg-fixes","fixes":[{"list":"ppl","from":"…","to":["…","…"]}, …]} — a list of merges/splits
   prepared outside the app (names never go into the code). Shown as a checklist with event counts; only checked rows apply. */
function openFixes(fixes){
  const box=$("#fixList"); box.textContent="";
  const labels=Object.fromEntries(MGR_KEYS);
  const rows=fixes.map(f=>{
    const k=f.list||"ppl", to=(Array.isArray(f.to)?f.to:[f.to]).map(x=>String(x).trim()).filter(Boolean);
    const n=useCount(k)[f.from]||0, nT=tasks.filter(t=>(t[k]||[]).includes(f.from)).length;
    const r=mk("label","fix-row"+(n||nT?"":" none")), cb=mk("input"); cb.type="checkbox"; cb.checked=!!(n||nT); cb.disabled=!(n||nT);
    const t=mk("span","fix-t"); t.append(mk("b",null,f.from), mk("em",null," ("+(n?nf(n)+" אירועים":"לא נמצא")+(nT?", "+nT+" משימות":"")+") ← "), mk("b",null,to.join(" + ")));
    r.append(cb, mk("span","dup-why",(to.length>1?"פיצול":"מיזוג")+" · "+(labels[k]||k)), t); box.appendChild(r);
    return {k,from:f.from,to,cb};
  });
  $("#fixSum").textContent=rows.filter(r=>!r.cb.disabled).length+" תיקונים רלוונטיים מתוך "+rows.length+". בטל סימון של מה שלא נכון.";
  $("#fixOk").onclick=async()=>{
    const sel_=rows.filter(r=>r.cb.checked && !r.cb.disabled); if(!sel_.length){ toast("לא נבחר אף תיקון"); return; }
    $("#dlgFix").close();
    const ok=await confirmDel("להחיל "+sel_.length+" תיקונים?", sel_.map(r=>"• "+r.from+" ← "+r.to.join(" + ")).join("\n"), false,
      {ok1:"המשך", ok2:"כן, החל", warn:"⚠ אישור שני: השמות יוחלפו בכל האירועים והמשימות"+(CLOUD_ON?" — לכל הצוות":"")+". מספר האירועים לא משתנה. אפשר לבטל מיד אחרי."});
    if(!ok) return;
    const before=events.length, snap=snapValues(); let n=0;
    sel_.forEach(r=>{ n+=remapCore(r.k,r.from,r.to); });
    persist(); saveTasks(); renderAll(); renderMgr();
    toast(sel_.length+" תיקונים הוחלו ("+n+" עדכונים באירועים, "+events.length+"/"+before+" אירועים)",{label:"בטל",fn:()=>{ restoreValues(snap); toast("התיקונים בוטלו"); }});
  };
  $("#fixNo").onclick=()=>$("#dlgFix").close();
  $("#dlgFix").showModal();
}
function renderMgr(){
  const box=$("#listMgr");
  // redrawn after every change (retire / restore / merge…): keep each list where it was scrolled, and the page too
  const keep={}; box.querySelectorAll(".mgr-list").forEach(l=>{ keep[l.dataset.k]=l.scrollTop; }); const wy=window.scrollY;
  box.textContent="";
  requestAnimationFrame(()=>{ box.querySelectorAll(".mgr-list").forEach(l=>{ if(keep[l.dataset.k]) l.scrollTop=keep[l.dataset.k]; });
    if(Math.abs(window.scrollY-wy)>2) window.scrollTo(0,wy); });
  MGR_KEYS.forEach(([k,label])=>{
    // alphabetical (א-ב, numbers and Latin in order too); in people the ⭐ core staff stay first
    const cnt=useCount(k), active=coreFirst(lists[k].slice().sort((x,y)=>x.localeCompare(y,"he",{numeric:true})), k);
    const retired=(lists["_hide_"+k]||[]).filter(v=>cnt[v]||lists["_custom_"+k].includes(v)||SEED[k].includes(v)).sort((x,y)=>x.localeCompare(y,"he"));
    const det=mk("details","mgr"); det.open=mgrOpen.has(k); det.ontoggle=()=>{ det.open?mgrOpen.add(k):mgrOpen.delete(k); };
    const sum=mk("summary"), cn=mk("span","mgr-n");
    cn.append(mk("span","mgr-st on",nf(active.length)+" פעילים"));
    if(retired.length) cn.append(mk("span","mgr-st off",nf(retired.length)+" לא פעילים"));
    sum.append(mk("b",null,label), cn);
    det.appendChild(sum);
    // add
    const r=mk("div","row mgr-add"); const inp=mk("input","txt"); inp.placeholder="הוסף "+label.replace(/ים$|ות$/,"")+"…"; inp.placeholder="ערך חדש ב"+label;
    const add=mk("button","btn","הוסף"); add.type="button";
    const go=()=>{ const v=inp.value.trim(); if(!v) return;
      if(lists["_hide_"+k].includes(v)){ restoreValue(k,v); inp.value=""; return; }
      if(!lists[k].includes(v)){ if(!lists["_custom_"+k].includes(v)) lists["_custom_"+k].push(v); lists[k].push(v); }
      inp.value=""; persist(); paintRows(); renderMgr(); renderTasks(); toast(v+" נוסף לרשימות"); };
    add.onclick=go; inp.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); go(); } };
    r.append(inp,add); det.appendChild(r);
    // likely duplicates
    const pairs=dupPairs(k);
    if(pairs.length){
      const dd=mk("details","mgr-dup"); dd.open=mgrOpen.has(k+":dup"); dd.ontoggle=()=>{ dd.open?mgrOpen.add(k+":dup"):mgrOpen.delete(k+":dup"); };
      dd.appendChild(mk("summary",null,"⚠ כפילויות אפשריות ("+pairs.length+") — בדוק ומזג"));
      pairs.forEach(pr=>{
        const r=mk("div","dup-row"), st={from:pr.from,to:pr.to};
        const txt=mk("span","dup-t"), paintT=()=>{ txt.textContent=""; txt.append(mk("b",null,st.from), mk("em",null," ("+nf(cnt[st.from]||0)+") ← "), mk("b",null,st.to), mk("em",null," ("+nf(cnt[st.to]||0)+")")); };
        paintT();
        const sw=mk("button","btn mini","⇄"); sw.type="button"; sw.title="הפוך כיוון"; sw.onclick=()=>{ [st.from,st.to]=[st.to,st.from]; paintT(); };
        const go=mk("button","btn mini ok","מזג"); go.type="button"; go.onclick=()=>mergeValue(k,st.from,st.to);
        r.append(mk("span","dup-why",pr.why), txt, sw, go); dd.appendChild(r);
      });
      det.appendChild(dd);
    }
    // search
    const q=mk("input","txt mgr-q"); q.type="search"; q.placeholder="חיפוש…"; q.value=mgrQ[k]||"";
    det.appendChild(q);
    const list=mk("div","mgr-list"); list.dataset.k=k; det.appendChild(list);
    const paint=()=>{
      list.textContent=""; const f=(mgrQ[k]||"").trim();
      const row=(v,isRet)=>{
        const core=k==="ppl" && !isRet && isCore(v);
        const rw=mk("div","listrow"+(isRet?" retired":"")+(core?" core":""));
        if(k==="ppl" && !isRet){ const s=mk("button","star"+(core?" on":""),core?"★":"☆"); s.type="button";
          s.title=core?"הסר מצוות קבוע":"סמן כצוות קבוע"; s.setAttribute("aria-label",s.title);
          s.onclick=()=>{ const L=lists._core_ppl=lists._core_ppl||[]; const i=L.indexOf(v); i>=0?L.splice(i,1):L.push(v);
            persist(); renderMgr(); renderTasks(); toast(i>=0 ? v+" הוסר מהצוות הקבוע" : "⭐ "+v+" — צוות קבוע"); };
          rw.appendChild(s); }
        const nameB=mk("b",null,v);
        if(k==="ppl") nameB.appendChild(personTags(v));
        rw.append(mk("span","mgr-st "+(isRet?"off":"on"), isRet?"לא פעיל":"פעיל"), nameB,
          mk("span","mgr-c", cnt[v] ? nf(cnt[v])+" אירועים" : "לא בשימוש"));
        const bt=(txt,cls,fn)=>{ const x=mk("button","btn mini"+(cls?" "+cls:""),txt); x.type="button"; x.onclick=fn; rw.appendChild(x); };
        if(k==="ppl" && !isRet) bt(roleOf(v)||deptOf(v)?"✎ תפקיד ומחלקה":"+ תפקיד ומחלקה","role-btn",()=>{
          if(rw.querySelector(".role-ed")) return;
          const ed=mk("div","role-ed"), ri=mk("input","txt"), di=mk("input","txt"), ok=mk("button","btn mini ok","שמור"), no=mk("button","btn mini ghost","ביטול");
          ri.value=roleOf(v); ri.placeholder="תפקיד (חשמלאי, מפעיל…)"; ri.setAttribute("list","dlRoles");
          di.value=deptOf(v); di.placeholder="מחלקה (אחזקה, תפעול…)"; di.setAttribute("list","dlDepts"); ok.type=no.type="button";
          const fillDl=(id,obj)=>{ const dl=$(id); dl.textContent=""; [...new Set(Object.values(obj||{}))].sort((x,y)=>x.localeCompare(y,"he")).forEach(r=>{ const o=document.createElement("option"); o.value=r; dl.appendChild(o); }); };
          fillDl("#dlRoles",lists._roles_ppl); fillDl("#dlDepts",lists._dept_ppl);
          const save=()=>{ const r=ri.value.trim(), dd=di.value.trim();
            lists._roles_ppl=lists._roles_ppl||{}; lists._dept_ppl=lists._dept_ppl||{};
            if(r) lists._roles_ppl[v]=r; else delete lists._roles_ppl[v];
            if(dd) lists._dept_ppl[v]=dd; else delete lists._dept_ppl[v];
            persist(); renderMgr(); renderTasks(); toast(v+([dd,r].filter(Boolean).length?" — "+[dd,r].filter(Boolean).join(" · "):": נמחקו תפקיד ומחלקה")); };
          ok.onclick=save; [ri,di].forEach(x=>x.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); save(); } if(e.key==="Escape") ed.remove(); });
          no.onclick=()=>ed.remove();
          const l1=mk("label","role-f"), l2=mk("label","role-f"); l1.append(mk("span",null,"תפקיד"),ri); l2.append(mk("span",null,"מחלקה"),di);
          const r2=mk("div","row"); r2.append(ok,no);
          ed.append(l1,l2,r2); rw.appendChild(ed); ri.focus(); });
        bt("פצל…","",()=>{
          if(rw.querySelector(".mgr-split")) return;
          const box=mk("div","mgr-split"), picks=[];
          const chips=mk("div","split-chips"), sel=mk("select"), inp=mk("input","txt"), go=mk("button","btn mini ok","פצל"), no=mk("button","btn mini ghost","ביטול");
          fillSelect(sel, active.filter(x=>x!==v), "", "הוסף מהרשימה…"); inp.placeholder="או הקלד שם חדש + Enter"; go.type=no.type="button";
          const paintC=()=>{ chips.textContent=""; picks.forEach((x,i)=>{ const c=mk("button","split-chip",x+" ✕"); c.type="button"; c.onclick=()=>{ picks.splice(i,1); paintC(); }; chips.appendChild(c); });
            if(!picks.length) chips.appendChild(mk("span","hint","בחר את האנשים שהערך הזה מייצג (2 או יותר)")); };
          const addP=x=>{ x=String(x||"").trim(); if(x && x!==v && !picks.includes(x)){ picks.push(x); paintC(); } };
          sel.onchange=()=>{ addP(sel.value); sel.value=""; };
          inp.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); addP(inp.value); inp.value=""; } };
          go.onclick=()=>{ if(inp.value.trim()){ addP(inp.value); inp.value=""; } if(picks.length<2){ toast("בחר לפחות 2"); return; } mergeValue(k,v,picks.slice()); };
          no.onclick=()=>box.remove();
          const r2=mk("div","row"); r2.append(go,no);
          box.append(mk("div","split-h","לפצל את “"+v+"” ל:"), chips, sel, inp, r2); paintC(); rw.appendChild(box);
          enhanceSelect(sel); });
        bt("מזג…","",()=>{
          if(rw.querySelector("select")) return;
          const s=mk("select","mgr-into"); fillSelect(s, active.filter(x=>x!==v), "", "מזג לתוך…");
          s.onchange=()=>{ if(s.value) mergeValue(k,v,s.value); };
          rw.appendChild(s); s.focus(); });
        if(isRet) bt("החזר","ok",()=>restoreValue(k,v));
        else {
          bt("הוצא משימוש","",()=>retireValue(k,v));
          if(!cnt[v] && lists["_custom_"+k].includes(v))
            bt("מחק","danger",async()=>{ if(await confirmDel("למחוק מהרשימות?", label+": "+v+"\nלא משמש אף אירוע.")) removeValue(k,v); });
        }
        list.appendChild(rw);
      };
      const act=active.filter(v=>!f||v.includes(f)), ret=retired.filter(v=>!f||v.includes(f));
      if(k==="ppl"){ const nc=act.filter(isCore).length;
        if(nc) list.appendChild(mk("div","mgr-h core-h","⭐ צוות קבוע ("+nc+") — תמיד ראשונים בכל הרשימות"));
        act.forEach((v,i)=>{ if(nc && i===nc) list.appendChild(mk("div","mgr-h","שאר האנשים")); row(v,false); });
        if(!nc && act.length) list.insertBefore(mk("p","hint","סמן ☆ ליד עובדי הצוות הקבוע — הם יופיעו ראשונים ובצבע משלהם."), list.firstChild);
      } else act.forEach(v=>row(v,false));
      if(!act.length) list.appendChild(mk("p","hint",f?"אין התאמה.":"הרשימה ריקה."));
      if(ret.length){ list.appendChild(mk("div","mgr-h","לא פעילים — לא מופיעים ברשימות הבחירה, נשארים באירועים הישנים")); ret.forEach(v=>row(v,true)); }
    };
    q.oninput=()=>{ mgrQ[k]=q.value; paint(); };
    paint();
    box.appendChild(det);
  });
}

/* ================= time ================= */
function setNow(){
  const d=new Date(), p=n=>String(n).padStart(2,"0");
  $("#dDate").value = d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
  $("#dTime").value = p(d.getHours())+":"+p(d.getMinutes());
}
$("#nowBtn").onclick = ()=>{ setNow(); toast("עודכן לעכשיו"); };
function whenStr(){ return ($("#dDate").value||"") + "T" + ($("#dTime").value||"00:00"); }
function fmtWhen(s){
  if(!s) return ""; const d=new Date(s); if(isNaN(d)) return s;
  const p=n=>String(n).padStart(2,"0");
  return p(d.getDate())+"/"+p(d.getMonth()+1)+"/"+d.getFullYear()+" "+p(d.getHours())+":"+p(d.getMinutes());
}

/* ================= delete: always two confirmations =================
   Step 1 shows exactly what will be deleted; step 2 is a separate, red "final" confirmation.
   Bulk deletions also require typing "מחק". Returns a Promise<boolean>. */
function confirmDel(title, what, bulk, o){
  o=o||{};
  if(!isManager()){ toast("מחיקה מותרת למנהל בלבד"); return Promise.resolve(false); }   // team log: members never delete
  return new Promise(res=>{
    const d=$("#dlgDel"), ok=$("#delOk"), no=$("#delNo"); let step=1;
    $("#delTitle").textContent=title; $("#delWhat").textContent=what||"";
    $("#delWarn").hidden=true; $("#delTypeWrap").hidden=true; $("#delType").value="";
    $("#delWarn").textContent = o.warn || "⚠ אישור שני: המחיקה סופית ואי אפשר לבטל אותה.";
    ok.textContent=o.ok1||"המשך למחיקה"; ok.classList.remove("final");
    const done=v=>{ ok.onclick=no.onclick=null; d.onclose=null; if(d.open) d.close(); res(v); };
    ok.onclick=()=>{
      if(step===1){ step=2; $("#delWarn").hidden=false; if(bulk){ $("#delTypeWrap").hidden=false; setTimeout(()=>$("#delType").focus(),50); }
        ok.textContent=o.ok2||"כן, מחק סופית"; ok.classList.add("final"); return; }
      if(bulk && $("#delType").value.trim()!=="מחק"){ toast("הקלד מחק כדי לאשר"); $("#delType").focus(); return; }
      done(true);
    };
    no.onclick=()=>done(false);
    d.onclose=()=>res(false);
    d.showModal();
  });
}

/* ================= save ================= */
/* photos and files on an event (same store as task files) */
let evFiles=[];
const okThumb=v=>typeof v==="string" && /^data:image\/(jpeg|png|webp);base64,/.test(v);
function evThumbs(files, box, onDel){
  box.textContent="";
  files.filter(m=>m && !m.del).forEach(m=>{
    const b=mk("button","tk-file"+(okThumb(m.thumb)?" img":"")); b.type="button"; b.title=m.name+(m.by?" · "+m.by:"");
    if(okThumb(m.thumb)){ const im=mk("img"); im.src=m.thumb; im.alt=m.name; im.loading="lazy"; b.appendChild(im); }
    else b.append(mk("span","tf-ic",fIcon(m)), mk("span","tf-n",m.name));
    b.onclick=ev=>{ ev.stopPropagation(); openFile(m); };
    if(onDel){ const d=mk("span","tf-del","✕"); d.setAttribute("role","button"); d.setAttribute("aria-label","הסר את "+m.name);
      d.onclick=ev=>{ ev.stopPropagation(); onDel(m); }; b.appendChild(d); }
    box.appendChild(b); });
}
function paintEvFiles(){ const box=$("#evPh"); if(box) evThumbs(evFiles, box, m=>{ evFiles=evFiles.filter(x=>x.id!==m.id); paintEvFiles(); }); }
["#evCam","#evGal","#evFile"].forEach(s=>{ const i=$(s); if(i) i.onchange=async()=>{ const fl=[...i.files]; i.value=""; if(!fl.length) return;
  if(evFiles.length+fl.length>8){ toast("עד 8 קבצים לאירוע"); return; }
  const out=await storeFiles(fl, s==="#evCam"); if(out.length){ evFiles.push(...out); paintEvFiles(); toast(out.length===1?"צורף":"צורפו "+out.length); } }; });
function resetForm(){
  evFiles=[]; paintEvFiles();
  sel.type=[]; sel.loc=[]; sel.eq=[]; sel.ppl=[]; sel.stat=["פתוח"];
  $("#title").value=""; $("#desc").value=""; $("#act").value=""; editId=null;
  $("#saveBtn").textContent="שמור אירוע"; $("#delEvBtn").hidden=true; setNow(); paintRows(); window.scrollTo({top:0});
}
function collect(){
  return {
    id: editId || (Date.now().toString(36)+Math.random().toString(36).slice(2,7)),
    type: sel.type.slice(), loc: sel.loc.slice(), eq: sel.eq.slice(), ppl: sel.ppl.slice(),
    stat: sel.stat.slice(), title: $("#title").value.trim(),
    desc: $("#desc").value.trim(), act: $("#act").value.trim(),
    when: whenStr(), ts: new Date().toISOString(), files: evFiles.slice()
  };
}
function findDup(e){
  const t=new Date(e.when).getTime();
  return events.find(x=>{
    if(x.id===e.id) return false;
    if(Math.abs(new Date(x.when).getTime()-t) > 3*3600*1000) return false;
    return (x.loc||[]).some(l=>e.loc.includes(l)) &&
           (x.desc.slice(0,22)===e.desc.slice(0,22) || x.desc===e.desc);
  });
}
function doSave(e){
  const i=events.findIndex(x=>x.id===e.id);
  if(i>=0 && isLocked(events[i])){ toast("אירוע ארכיון — לא ניתן לשינוי"); return; }
  // an edit keeps what the form doesn't show (serial number, who/when closed, source, link to a task…)
  if(i>=0) e=Object.assign({}, events[i], e);
  const wasClosed = i>=0 && !isOpen(events[i]);
  if(!isOpen(e) && !wasClosed){ e.closedAt=nowLocal(); e.closedBy=reporter()||""; }      // closed now: when and by whom
  if(isOpen(e)){ delete e.closedAt; delete e.closedBy; }
  if(i>=0) events[i]=e; else events.unshift(e);
  events.sort((a,b)=>(b.when||"").localeCompare(a.when||""));
  const ts = i>=0 ? syncTaskFromEvent(e) : null;
  persist(); renderAll(); toast((i>=0?"האירוע עודכן":"האירוע נשמר")+(ts ? (isOpen(e)?" · המשימה חזרה למשימות הפתוחות":" · המשימה סומנה כהושלמה") : "")); resetForm();
}
$("#saveBtn").onclick = ()=>{
  const e=collect();
  if(!e.type.length){ toast("בחר סוג אירוע"); openSheet("type"); return; }
  if(!e.loc.length){ toast("בחר מיקום"); openSheet("loc"); return; }
  if(!e.desc){ toast("כתוב מה קרה"); $("#desc").focus(); return; }
  const d=findDup(e);
  if(d){
    $("#dupText").textContent = fmtWhen(d.when)+" · "+(d.loc||[]).join(" · ")+" — "+d.desc.slice(0,90);
    $("#dlgDup").showModal();
    $("#dupSave").onclick=()=>{ $("#dlgDup").close(); doSave(e); };
    $("#dupCancel").onclick=()=>$("#dlgDup").close();
    return;
  }
  doSave(e);
};
$("#clearBtn").onclick = ()=>{ resetForm(); toast("הטופס נוקה"); };

/* ================= list view ================= */
const PAGE=60; let shown=PAGE, lastRows=[];
// events list: months folded by their arrow (kept on this device)
const evColl=new Set((()=>{ try{ const a=JSON.parse(localStorage.getItem("ogg-ev-coll")||"[]"); return Array.isArray(a)?a:[]; }catch(e){ return []; } })());
function saveEvColl(){ try{ localStorage.setItem("ogg-ev-coll",JSON.stringify([...evColl])); }catch(e){} }

function activeFilters(){
  return ["#fType","#fLoc","#fEq","#fPpl","#fStat","#fSrc","#fFrom","#fTo"]
    .filter(id=>$(id) && $(id).value).length;
}
function matchRows(){
  const q=$("#q").value.trim();
  const g=id=>$(id)?$(id).value:"";
  const ft=g("#fType"), fl=g("#fLoc"), fe=g("#fEq"), fp=g("#fPpl"),
        fs=g("#fStat"), fsrc=g("#fSrc"), from=g("#fFrom"), to=g("#fTo");
  return events.filter(e=>{
    if(ft && !(e.type||[]).includes(ft)) return false;
    if(fl && !(e.loc||[]).includes(fl)) return false;
    if(fe && !(e.eq||[]).includes(fe)) return false;
    if(fp && !(e.ppl||[]).includes(fp)) return false;
    if(fs===OPEN_ANY){ if(!isOpen(e)) return false; }
    else if(fs && ((e.stat||[])[0]||"פתוח")!==fs) return false;
    if(fsrc && (e.src||"רישום ידני")!==fsrc) return false;
    const day=(e.when||"").slice(0,10);
    if(from && (!day || day<from)) return false;
    if(to && (!day || day>to)) return false;
    if(q){
      const qn=q.replace(/^#/,"");                       // "#123" or "123" finds event number 123
      if(/^\d+$/.test(qn) && e.no===+qn){} else {
      const hay=[e.title,e.desc,e.act].concat(e.type||[],e.loc||[],e.eq||[],e.ppl||[]).join(" ");
      if(!hay.includes(q)) return false; }
    }
    return true;
  });
}
function sortRows(rows){
  const s=$("#sortBy").value;
  const by={
    "when-desc":(a,b)=>(b.when||"").localeCompare(a.when||""),
    "when-asc":(a,b)=>(a.when||"").localeCompare(b.when||""),
    "type":(a,b)=>((a.type||[])[0]||"").localeCompare((b.type||[])[0]||"","he")||(b.when||"").localeCompare(a.when||""),
    "loc":(a,b)=>((a.loc||[])[0]||"").localeCompare((b.loc||[])[0]||"","he")||(b.when||"").localeCompare(a.when||""),
    "stat":(a,b)=>((a.stat||[])[0]||"").localeCompare((b.stat||[])[0]||"","he")||(b.when||"").localeCompare(a.when||""),
    "edit":(a,b)=>(b.ts||"").localeCompare(a.ts||"")||(b.when||"").localeCompare(a.when||"")
  }[s];
  return rows.slice().sort(by);
}
function renderList(reset){
  if(reset!==false) shown=PAGE;
  const box=$("#listBox"); box.textContent="";
  const rows = lastRows = sortRows(matchRows());

  const n=activeFilters();
  $("#fBadge").textContent = n? n : "";
  $("#resCount").textContent = rows.length===events.length
    ? events.length+" אירועים"
    : rows.length+" מתוך "+events.length;

  if(!rows.length){
    const d=document.createElement("div"); d.className="empty";
    d.innerHTML = events.length
      ? "<b>אין התאמות</b>שנה את הסינון או נקה אותו."
      : "<b>היומן ריק</b>הרישום הראשון מתחיל בלשונית רישום אירוע.";
    box.appendChild(d); $("#moreRows").hidden=true; return;
  }

  // by date: a month heading per month, each with an arrow that folds it; the arrow by the count folds them all
  let group=null;
  const sortMode=$("#sortBy").value, byDate = sortMode==="when-desc"||sortMode==="when-asc";
  const mon=e=>(e.when||"").slice(0,7), mCnt={};
  if(byDate) rows.forEach(e=>{ const g=mon(e); mCnt[g]=(mCnt[g]||0)+1; });
  const vis = byDate ? rows.filter(e=>!evColl.has(mon(e))) : rows;
  const slice=vis.slice(0,shown), inSlice=new Set(slice), cut = vis.length>shown ? rows.indexOf(slice[slice.length-1]) : rows.length;
  const ca=$("#evCollAll"); ca.hidden=!byDate;
  if(byDate){ const all=Object.keys(mCnt).every(g=>evColl.has(g)); ca.textContent = all ? "◂ פתח הכל" : "▾ מזער הכל"; ca.setAttribute("aria-expanded",String(!all)); }
  rows.forEach((e,i)=>{
    if(byDate){
      const g=mon(e), folded=evColl.has(g);
      if(g!==group){
        group=g;
        if(folded ? i<=cut : inSlice.has(e)){
          const h=mk("button","daygap"+(folded?" folded":"")); h.type="button"; h.setAttribute("aria-expanded",String(!folded));
          h.appendChild(mk("span","dg-arr",folded?"◂":"▾"));
          h.append(g ? g.slice(5)+"/"+g.slice(0,4) : "ללא תאריך");
          h.appendChild(mk("span","dg-n",nf(mCnt[g])+" אירועים"));
          h.onclick=()=>{ folded ? evColl.delete(g) : evColl.add(g); saveEvColl(); renderList(false); };
          box.appendChild(h);
        }
      }
      if(folded) return;
    }
    if(!inSlice.has(e)) return;
    const t=(e.type||[])[0]||"";
    const d=document.createElement("article"); d.className="ev"+(UNSEEN.has(e.id)?" is-new":""); d.dataset.id=e.id;
    d.style.borderInlineStartColor="var(--c-"+hueOf(t)+")";
    let top=document.createElement("div"); top.className="top";
    const w=document.createElement("span"); w.className="when"; w.textContent=fmtWhen(e.when);
    const kd=document.createElement("span"); kd.className="badge"; kd.textContent=t;
    const hue=hueOf(t);
    kd.style.background="var(--c-"+hue+"-bg)"; kd.style.color="var(--c-"+hue+")";
    const st=(e.stat||[])[0]||"פתוח";
    const sp=document.createElement("span"); sp.className="pill "+(st==="נסגר"?"done":"open"); sp.textContent=st;
    const wh=document.createElement("span"); wh.className="where";
    wh.textContent=[(e.loc||[]).join(" · "),(e.eq||[]).join(" · ")].filter(Boolean).join(" · ");
    top.append(w,kd,sp,wh);
    if(e.no){ const sn=document.createElement("span"); sn.className="sn"; sn.textContent="#"+e.no; sn.title="מספר סידורי"; top.insertBefore(sn,top.firstChild); }
    if(UNSEEN.has(e.id)){ const nw=document.createElement("span"); nw.className="newtag"; nw.textContent="חדש"; top.insertBefore(nw,top.firstChild); }
    if(e.title){
      const hh=document.createElement("div"); hh.className="hl"; hh.textContent=e.title;
      d.appendChild(top); d.appendChild(hh); top=null;
    }
    const b=document.createElement("div"); b.className="body";
    const sameAct = e.act && e.desc && e.act.trim()===e.desc.trim();
    b.textContent = e.desc;
    if((e.files||[]).some(m=>m && !m.del)){ const ph=mk("div","ev-ph-grid ev-ph-card"); evThumbs(e.files, ph, null); b.appendChild(ph); }
    const det=document.createElement("div"); det.className="det"; det.hidden=true;
    const put=(k,v)=>{ if(!v) return;
      const dt=document.createElement("dt"); dt.textContent=k;
      const dd=document.createElement("dd"); dd.textContent=v;
      det.append(dt,dd); };
    put("סוג",(e.type||[]).join(", "));
    put("מיקום",(e.loc||[]).join(", "));
    put("ציוד",(e.eq||[]).join(", "));
    put("מעורבים",(e.ppl||[]).join(", "));
    put("סטטוס",(e.stat||[]).join(", "));
    put("נסגר בתאריך", e.closedAt ? fmtWhen(e.closedAt).slice(0,10) : "");
    put("נסגר על ידי", e.closedBy||"");
    put("פעולה שננקטה", e.act||"");
    put("המשך טיפול", e.follow||"");
    put("נרשם על ידי", e.by||"");
    put("אירוע קשור", e.ref||"");
    put("מקור", e.src||(e.taskId?"משימה":"רישום ידני"));
    put("המשימה נפתחה", e.taskCreated ? new Date(e.taskCreated).toLocaleDateString("he-IL") : "");
    put("הערה", e.note||"");

    const acts=document.createElement("div"); acts.className="acts";
    const info=document.createElement("button"); info.textContent="פרטים";
    info.onclick=()=>{ det.hidden=!det.hidden; d.classList.toggle("open",!det.hidden); info.textContent=det.hidden?"פרטים":"סגור פרטים"; };
    acts.appendChild(info);
    const closed_ = st==="נסגר";
    const sbtn=document.createElement("button"); sbtn.className="stbtn "+(closed_?"reopen":"close");
    sbtn.textContent = closed_ ? "פתח מחדש" : "סגור אירוע";
    sbtn.onclick=()=>setStatus(e.id, !closed_);
    acts.appendChild(sbtn);
    if(!isLocked(e) && !isViewer()){ const ed=document.createElement("button"); ed.textContent="ערוך"; ed.onclick=()=>loadInto(e); acts.appendChild(ed); }
    if(isLocked(e)){
      const lk=document.createElement("span"); lk.className="lock"; lk.title="ארכיון · "+(e.src||"");
      const li=document.createElement("span"); li.className="lk-i"; li.textContent="🔒";
      const lt=document.createElement("span"); lt.className="lk-t"; lt.textContent=" ארכיון · " + (e.src||"");
      lk.append(li,lt);
      acts.appendChild(lk);
      d.classList.add("locked");
    }
    if(top) d.appendChild(top); d.append(b,det,acts); box.appendChild(d);
  });
  const more=$("#moreRows");
  more.hidden = vis.length<=shown;
  more.textContent = "הצג עוד "+Math.min(PAGE, vis.length-shown)+" מתוך "+(vis.length-shown);
}
$("#evCollAll").onclick=()=>{
  const ms=[...new Set(lastRows.map(e=>(e.when||"").slice(0,7)))], all=ms.every(g=>evColl.has(g));
  if(all) evColl.clear(); else ms.forEach(g=>evColl.add(g));
  saveEvColl(); renderList();
};
$("#moreRows").onclick=()=>{ shown+=PAGE; renderList(false); };
/* phone view ("lite"): on a narrow screen the app shows what is used in the field — record, follow, update —
   and leaves out exports, charts, sorting, list management, files and team management (still there on a
   computer, or here with "תצוגה מלאה" in settings → כללי). Chosen per device. */
const LITE_MQ=matchMedia("(max-width:600px)");
function liteFull(){ try{ return localStorage.getItem("ogg-view-full")==="1"; }catch(e){ return false; } }
function isLite(){ return LITE_MQ.matches && !liteFull(); }
function applyLite(){
  const on=isLite(); document.documentElement.classList.toggle("lite",on);
  const b=$("#liteToggle"); if(b) b.textContent = on ? "עבור לתצוגה מלאה" : "חזור לתצוגת טלפון";
  if(typeof paintSettings==="function") paintSettings();
  if(typeof applyListView==="function") applyListView();
  if(on && curView==="Cal") show("Dash");
  if(on && $("#sgNav [aria-pressed=true]") && /lists|files/.test(($("#sgNav [aria-pressed=true]").dataset.sg||""))) { const g=$("#sgNav [data-sg=general]"); if(g) g.click(); }
}
document.documentElement.classList.toggle("lite",isLite());
if(LITE_MQ.addEventListener) LITE_MQ.addEventListener("change",()=>{ applyLite(); renderAll(); renderTasks(); });
/* list view: tiles (cards) or rows (one compact line per event; details open on "פרטים") */
let listView="tiles";
try{ listView=localStorage.getItem("ogg-list-view")==="rows"?"rows":"tiles"; }catch(e){}
function applyListView(){
  $("#viewList").classList.toggle("rows", listView==="rows" || isLite());   // phone view: always the compact list
  document.querySelectorAll("#listView button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.v===listView)));
}
document.querySelectorAll("#listView button").forEach(b=>b.onclick=()=>{
  listView=b.dataset.v; try{ localStorage.setItem("ogg-list-view",listView); }catch(e){}
  applyListView();
});
applyListView();
$("#fToggle").onclick=()=>{
  const p=$("#fPanel"), open=p.hidden;
  p.hidden=!open; $("#fToggle").setAttribute("aria-expanded",String(open));
};
["#fType","#fLoc","#fEq","#fPpl","#fStat","#fSrc","#fFrom","#fTo","#sortBy"]
  .forEach(id=>{ const el=$(id); if(el) el.onchange=()=>renderList(); });
$("#fClear").onclick=()=>{
  ["#fType","#fLoc","#fEq","#fPpl","#fStat","#fSrc","#fFrom","#fTo"].forEach(id=>{ if($(id)) $(id).value=""; });
  $("#q").value=""; renderList();
};
$("#fQuickYear").onclick=()=>{
  const y=new Date().getFullYear();
  $("#fFrom").value=y+"-01-01"; $("#fTo").value=""; renderList();
};
$("#fQuick12").onclick=()=>{
  const d=new Date(); d.setFullYear(d.getFullYear()-1);
  const p=n=>String(n).padStart(2,"0");
  $("#fFrom").value=d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
  $("#fTo").value=""; renderList();
};
$("#fQuickOpen").onclick=()=>{ $("#fStat").value="פתוח"; renderList(); };
$("#expView").onclick=()=>exportCsv(lastRows, true);
// the old archive (loaded from the earlier log files) stays as it was; anything recorded here, from a task or from Planner can be edited
function isLocked(e){ return !!(e.src && e.src!=="רישום ידני" && e.src!=="Planner"); }
function nowLocal(){ const d=new Date(), p=n=>String(n).padStart(2,"0");
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes()); }
function afterStatus(){ renderFilters(); renderList(false); renderStats(); if(!$("#viewDash").hidden) renderDash(); }
/* close / reopen an event. Archive events stay locked for editing, but their status may change. */
/* an event written by finishing a task moves with it: reopening the event brings the task back to the open tasks,
   closing it again completes the task again. Returns what to restore for "ביטול". */
function syncTaskFromEvent(e){
  const t=e && e.taskId && tasks.find(x=>x.id===e.taskId && !x._del); if(!t) return null;
  const prev={status:t.status, doneAt:t.doneAt, doneBy:t.doneBy, upd:t.upd, log:(t.log||[]).slice()};
  if(isOpen(e) && !tkOpen(t)){
    t.status="פתוחה"; delete t.doneAt; delete t.doneBy; t.upd=new Date().toISOString();
    tkLog(t, "נפתחה מחדש — האירוע ביומן"+(e.no?" #"+e.no:"")+" נפתח מחדש", "", true);
  } else if(!isOpen(e) && tkOpen(t) && t.eventId===e.id){
    t.status="הושלמה"; t.doneAt=e.closedAt||nowLocal(); t.doneBy=e.closedBy||reporter()||""; t.upd=new Date().toISOString();
    tkLog(t, "הושלמה — האירוע ביומן"+(e.no?" #"+e.no:"")+" נסגר", "", true);
  } else return null;
  saveTasks(); return {t, prev};
}
// tasks whose event was reopened before this was linked (or on another device): back to the open tasks
function reconcileTaskEvents(){
  if(typeof isViewer==="function" && isViewer()) return;
  tasks.forEach(t=>{ if(tkOpen(t) || !t.eventId || t._del) return; const e=events.find(x=>x.id===t.eventId); if(e && isOpen(e)) syncTaskFromEvent(e); });
}
function reopenTask(t){
  const prev={status:t.status, doneAt:t.doneAt, doneBy:t.doneBy, log:(t.log||[]).slice()};
  t.status="פתוחה"; delete t.doneAt; delete t.doneBy; t.upd=new Date().toISOString();
  tkLog(t, "נפתחה מחדש", "", true);
  const e=t.eventId && events.find(x=>x.id===t.eventId), ep = e && !isOpen(e) ? {stat:e.stat, closedAt:e.closedAt, closedBy:e.closedBy, ts:e.ts} : null;
  if(ep){ e.stat=["פתוח"]; delete e.closedAt; delete e.closedBy; e.ts=new Date().toISOString(); persist(); }
  saveTasks(); renderAll(); renderTasks();
  toast("המשימה נפתחה מחדש"+(ep?" · גם האירוע שלה ביומן":""),{label:"ביטול",fn:()=>{
    Object.keys(prev).forEach(k=>{ if(prev[k]===undefined) delete t[k]; else t[k]=prev[k]; }); t.upd=new Date().toISOString();
    if(ep) Object.keys(ep).forEach(k=>{ if(ep[k]===undefined) delete e[k]; else e[k]=ep[k]; });
    if(ep) persist(); saveTasks(); renderAll(); toast("השינוי בוטל"); }});
}
function undoTaskSync(s){ if(!s) return; Object.keys(s.prev).forEach(k=>{ if(s.prev[k]===undefined) delete s.t[k]; else s.t[k]=s.prev[k]; }); s.t.upd=new Date().toISOString(); saveTasks(); }
function setStatus(id, close){
  const e=events.find(x=>x.id===id); if(!e) return;
  const prev={stat:e.stat, closedAt:e.closedAt, closedBy:e.closedBy, ts:e.ts};
  if(close){ e.stat=["נסגר"]; e.closedAt=nowLocal(); e.closedBy=reporter()||""; } else { e.stat=["פתוח"]; delete e.closedAt; delete e.closedBy; }
  e.ts=new Date().toISOString();
  const ts=syncTaskFromEvent(e);
  persist(); afterStatus();
  toast((close?"האירוע נסגר":"האירוע נפתח מחדש")+(ts ? (close?" · המשימה סומנה כהושלמה":" · המשימה חזרה למשימות הפתוחות") : ""),{label:"ביטול",fn:()=>{
    ["stat","closedAt","closedBy","ts"].forEach(k=>{ if(prev[k]===undefined) delete e[k]; else e[k]=prev[k]; });
    undoTaskSync(ts);
    persist(); afterStatus(); toast("השינוי בוטל");
  }});
}
const OPEN_ANY="__open";
function isOpen(e){ return ((e.stat||[])[0]||"פתוח")!=="נסגר"; }
function loadInto(e){
  if(isLocked(e)){ toast("אירוע ארכיון — לא ניתן לעריכה"); return; }
  editId=e.id;
  sel.type=(e.type||[]).slice(); sel.loc=(e.loc||[]).slice();
  sel.eq=(e.eq||[]).slice(); sel.ppl=(e.ppl||[]).slice(); sel.stat=(e.stat||["פתוח"]).slice();
  $("#title").value=e.title||""; $("#desc").value=e.desc||""; $("#act").value=e.act||"";
  evFiles=(e.files||[]).filter(m=>m && !m.del).slice(); paintEvFiles();
  const parts=(e.when||"").split("T"); $("#dDate").value=parts[0]||""; $("#dTime").value=(parts[1]||"").slice(0,5);
  $("#saveBtn").textContent="עדכן אירוע"; $("#delEvBtn").hidden=!isManager(); show("New"); paintRows(); window.scrollTo({top:0});
}
// deleting an event: only from its edit screen, and only a manager (team log)
$("#delEvBtn").onclick=async()=>{
  const e=events.find(x=>x.id===editId); if(!e || !isManager()) return;
  const what=[fmtWhen(e.when),(e.type||[]).join(", "),e.title||String(e.desc||"").slice(0,80)].filter(Boolean).join(" · ");
  if(!await confirmDel("למחוק את האירוע?", what+(CLOUD_ON?"\nהאירוע יימחק לכל הצוות.":""))) return;
  binAdd("e",e); events=events.filter(x=>x.id!==e.id); persist(); resetForm(); renderAll(); show("List"); toast("האירוע נמחק — אפשר לשחזר מסל המיחזור (30 יום)"); };
function renderFilters(){
  const fill=(id,vals,keep,labels)=>{
    const s=$(id); if(!s) return;
    const cur=s.value; s.textContent="";
    const o=document.createElement("option"); o.value=""; o.textContent=keep; s.appendChild(o);
    vals.forEach(v=>{ const x=document.createElement("option"); x.value=v; x.textContent=(labels&&labels[v])||v; s.appendChild(x); });
    s.value = vals.includes(cur)?cur:"";
  };
  const uniq=(key,cnt)=>{
    const c={}; events.forEach(e=>(e[key]||[]).forEach(v=>{ c[v]=(c[v]||0)+1; }));
    return Object.keys(c).sort((a,b)=>c[b]-c[a]);
  };
  fill("#fType",uniq("type"),"כל הסוגים");
  fill("#fLoc",uniq("loc"),"כל המיקומים");
  fill("#fEq",uniq("eq"),"כל הציוד");
  fill("#fPpl",uniq("ppl"),"כל המעורבים");
  fill("#fStat",[OPEN_ANY].concat(uniq("stat")),"כל הסטטוסים",{[OPEN_ANY]:"כל מה שלא נסגר"});
  fill("#fSrc",[...new Set(events.map(e=>e.src||"רישום ידני"))],"כל המקורות");
}
function renderStats(){
  const box=$("#stats"); box.textContent="";
  const open=events.filter(e=>((e.stat||[])[0]||"פתוח")!=="נסגר").length;
  const f=events.filter(e=>(e.type||[]).includes("תקלה")).length;
  [["רישומים",events.length],["פתוחים",open],["תקלות",f]].forEach(([l,v])=>{
    const d=document.createElement("div");
    const b=document.createElement("b"); b.textContent=v;
    const s=document.createElement("span"); s.textContent=l;
    d.append(b,s); box.appendChild(d);
  });
  $("#cnt").textContent = events.length? "("+open+"/"+events.length+")":"";   // open out of all, like the tasks tab
}
function renderAll(){ paintRows(); renderFilters(); renderList(); renderStats(); renderMgr(); if(!$("#viewDash").hidden) renderDash(); if(!$("#viewCal").hidden) renderCal(); updateBadge(); paintNewCount(); }
$("#q").oninput=renderList; $("#fType").onchange=renderList; $("#fLoc").onchange=renderList;

/* ================= dashboard ================= */
const STAT_ORDER=["פתוח","בטיפול","ממתין לחלק","נסגר"];
const STAT_CLS={"פתוח":"s-open","בטיפול":"s-work","ממתין לחלק":"s-wait","נסגר":"s-done"};
const AGE=[ // days since the event, open events only
  {l:"עד שבוע",a:0,b:7},{l:"שבוע עד חודש",a:8,b:30},{l:"1–3 חודשים",a:31,b:90},
  {l:"3–12 חודשים",a:91,b:365},{l:"מעל שנה",a:366,b:Infinity}];
let dRange="365", dPpl="", dDept="", dAnim=true;   // dAnim: animate the next draw (when the dashboard is opened)
try{ dDept=localStorage.getItem("ogg-dash-dept")||""; }catch(e){}
const inDeptE=(e,d)=>(e.ppl||[]).some(n=>deptOf(n)===d), inDeptT=(t,d)=>(t.depts||[]).includes(d) || (t.ppl||[]).some(n=>deptOf(n)===d);
try{ dRange=localStorage.getItem("ogg-dash-range")||"365"; }catch(e){}
const nf=n=>n.toLocaleString("he-IL");
function ymd(d){ const p=n=>String(n).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); }
function daysAgo(n){ const d=new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()-n); return d; }
function dmy(s){ return s? s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4) : ""; }

function goList(o){
  renderFilters();
  ["#fType","#fLoc","#fEq","#fPpl","#fStat","#fSrc","#fFrom","#fTo"].forEach(id=>{ if($(id)) $(id).value=""; });
  $("#q").value="";
  if(o.type) $("#fType").value=o.type;
  if(o.loc) $("#fLoc").value=o.loc;
  if(o.stat) $("#fStat").value=o.stat;
  const ppl = o.ppl!==undefined ? o.ppl : dPpl;   // dashboard person filter carries over
  if(ppl) $("#fPpl").value=ppl;
  $("#fFrom").value=o.from||""; $("#fTo").value=o.to||"";
  $("#fPanel").hidden=false; $("#fToggle").setAttribute("aria-expanded","true");
  shown=PAGE; renderList(); show("List"); window.scrollTo({top:0});
}

/* tooltip: value first, label second; same on hover and keyboard focus */
function tipOn(el, value, label){
  const show_=()=>{
    const t=$("#dTip"); t.textContent="";
    const b=document.createElement("b"); b.textContent=value;
    const s=document.createElement("span"); s.textContent=label;
    t.append(b,s); t.hidden=false;
    const r=el.getBoundingClientRect(), tw=t.offsetWidth, th=t.offsetHeight;
    let x=r.left+r.width/2-tw/2; x=Math.max(8,Math.min(x,innerWidth-tw-8));
    let y=r.top-th-8; if(y<8) y=r.bottom+8;
    t.style.left=x+"px"; t.style.top=y+"px";
  };
  const hide=()=>{ $("#dTip").hidden=true; };
  el.addEventListener("pointerenter",show_); el.addEventListener("pointerleave",hide);
  el.addEventListener("focus",show_); el.addEventListener("blur",hide);
}
function mk(tag,cls,text){ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }
// each card has its own accent (a thin coloured top line and title mark) so the board reads at a glance
const D_ACC={"משימות":"power","סטטוס":"flood","אירועים פתוחים לפי ותק":"fault","פתוחים לפי סוג":"fault","פתוחים לפי מיקום":"maint","לפי מעורבים":"visit","לפי מחלקות":"power"};
function dcard(title,sub,body,rows,head){
  const c=mk("div","card dcard"); c.dataset.t=title; const acc=D_ACC[title] || (/^אירועים לפי/.test(title) ? "water" : "");
  if(acc) c.style.setProperty("--acc", acc==="water" ? "var(--water)" : "var(--c-"+acc+")");
  c.appendChild(mk("h3",null,title));
  if(sub) c.appendChild(mk("p","dsub",sub));
  c.appendChild(body);
  const det=mk("details","tv"); det.appendChild(mk("summary",null,"הצג כטבלה"));
  const tb=mk("table"); const hr=mk("tr"); head.forEach(h=>hr.appendChild(mk("th",null,h))); tb.appendChild(hr);
  rows.forEach(r=>{ const tr=mk("tr"); r.forEach(v=>tr.appendChild(mk("td",null,typeof v==="number"?nf(v):v))); tb.appendChild(tr); });
  det.appendChild(tb); c.appendChild(det);
  return c;
}
/* donut — part of a whole at a glance (≤6 slices; the rest folds into "אחר"): a thin surface gap between slices,
   the total in the middle, hover for the value, a tap filters; the legend carries every label, count and %. */
function donut(items, centerNum, centerLabel){
  items=items.filter(i=>i.v>0);
  const tot=items.reduce((s,i)=>s+i.v,0)||1, R=40, C=2*Math.PI*R, gap=items.length>1?1.6:0, NS="http://www.w3.org/2000/svg";
  const wrap=mk("div","donut"), fig=mk("div","dn-fig"), svg=document.createElementNS(NS,"svg");
  svg.setAttribute("viewBox","0 0 100 100"); svg.setAttribute("class","dn-svg"); svg.setAttribute("aria-hidden","true");
  let off=0;
  items.forEach(it=>{ const len=it.v/tot*C, dl=Math.max(0.01,len-gap);
    const c=document.createElementNS(NS,"circle"); [["cx",50],["cy",50],["r",R],["fill","none"],["stroke-width",15],
      ["stroke-dasharray",dl+" "+(C-dl)],["stroke-dashoffset",String(-off-gap/2)],["transform","rotate(-90 50 50)"],["class","dn-seg"]].forEach(([k,v])=>c.setAttribute(k,v));
    c.style.stroke=it.color;
    if(it.go){ c.addEventListener("click",it.go); c.style.cursor="pointer"; }
    tipOn(c, nf(it.v)+" · "+Math.round(100*it.v/tot)+"%", it.l);
    svg.appendChild(c); off+=len; });
  const mid=mk("div","dn-mid"); mid.append(mk("b",null,nf(centerNum)), mk("span",null,centerLabel));
  fig.append(svg,mid);
  const lg=mk("div","legend dn-lg");
  items.forEach(it=>{ const li=mk(it.go?"button":"span","li"); if(it.go){ li.type="button"; li.onclick=it.go; }
    const sw=mk("i"); sw.style.background=it.color;
    li.append(sw, mk("span",null,it.l), mk("b",null,nf(it.v)), mk("em",null,Math.round(100*it.v/tot)+"%")); lg.appendChild(li); });
  wrap.append(fig,lg); return wrap;
}
/* horizontal bars: label · bar · value at the tip */
function hbars(items, max, cls){
  const box=mk("div","hbars");
  items.forEach(it=>{
    const row=mk(it.go?"button":"div","hbar");
    if(it.go){ row.type="button"; row.onclick=it.go; }
    row.appendChild(mk("span","hl",it.l));
    const tr=mk("span","ht"); const f=mk("span","hf "+(it.cls||cls||""));
    if(it.hue) f.style.background="var(--c-"+it.hue+")";
    // leave room at the end of the track for the value label
    const r=max? it.v/max : 0;
    f.style.width = it.v ? "max(3px, calc((100% - 46px) * "+r+"))" : "0px"; tr.appendChild(f);
    tr.appendChild(mk("span","hv",nf(it.v))); row.appendChild(tr);
    tipOn(row, nf(it.v)+" אירועים", it.l);
    box.appendChild(row);
  });
  return box;
}
/* dashboard layout (per device): the card order. Drag a card by its title — mouse: press and drag;
   touch: long-press the title, then drag. The order is saved on this device. */
const K_DLAY="ogg-dash-layout";
let dOrder=[];
try{ const x=JSON.parse(localStorage.getItem(K_DLAY)||"null"); if(x && Array.isArray(x.order)) dOrder=x.order; }catch(e){}
function saveDLay(){ try{ localStorage.setItem(K_DLAY, JSON.stringify({order:dOrder})); }catch(e){} $("#dLayReset").hidden=!dOrder.length; }
function dKey(c){ const h=c.querySelector("h3"); const t=h?h.textContent.trim():"";
  return /^אירועים לפי (יום|שבוע|חודש|שנה)$/.test(t) ? "trend" : t; }
function captureOrder(){ dOrder=[...$("#dCards").children].map(c=>c.dataset.key).filter(Boolean); saveDLay(); }
function arrangeDash(){
  const box=$("#dCards"), cards=[...box.children].filter(c=>c.classList.contains("dcard"));
  cards.forEach(c=>{ c.dataset.key=dKey(c); });
  const pos=k=>{ const i=dOrder.indexOf(k); return i<0 ? 1000+cards.findIndex(c=>c.dataset.key===k) : i; };
  cards.slice().sort((x,y)=>pos(x.dataset.key)-pos(y.dataset.key)).forEach(c=>box.appendChild(c));
  [...box.children].filter(c=>!c.classList.contains("dcard")).forEach(c=>box.appendChild(c));   // "no events" note last
  cards.forEach(c=>{ const h=c.querySelector(":scope > h3"); if(h && !h.dataset.drag){ h.dataset.drag="1"; dragBy(h,c); } });
  $("#dLayReset").hidden=!dOrder.length;
}
function dragMoveTo(c,x,y){
  const box=$("#dCards");
  if(y<70) window.scrollBy(0,-14); else if(y>innerHeight-70) window.scrollBy(0,14);
  c.style.pointerEvents="none"; const el=document.elementFromPoint(x,y); c.style.pointerEvents="";
  const t=el && el.closest && el.closest("#dCards > .dcard"); if(!t || t===c) return;
  const r=t.getBoundingClientRect();
  const sameRow = y>r.top+r.height*0.25 && y<r.bottom-r.height*0.25 && !t.classList.contains("wide") && r.width<box.clientWidth*0.8;
  const before = sameRow ? x>r.left+r.width/2 : y<r.top+r.height/2;   // RTL: the right side comes first
  box.insertBefore(c, before ? t : t.nextElementSibling);
}
function dragBy(h,c){
  const start=()=>{ c.classList.add("dragging"); document.body.classList.add("d-drag"); if($("#dTip")) $("#dTip").hidden=true; };
  const end=()=>{ if(!c.classList.contains("dragging")) return; c.classList.remove("dragging"); document.body.classList.remove("d-drag"); captureOrder(); };
  // mouse (and pen): press on the title and move
  h.addEventListener("pointerdown",ev=>{
    if(ev.pointerType==="touch" || ev.button!==0) return;
    const x0=ev.clientX, y0=ev.clientY; let on=false;
    const mv=e=>{ if(!on){ if(Math.hypot(e.clientX-x0,e.clientY-y0)<6) return; on=true; start(); } e.preventDefault(); dragMoveTo(c,e.clientX,e.clientY); };
    const up=()=>{ removeEventListener("pointermove",mv); removeEventListener("pointerup",up); if(on) end(); };
    addEventListener("pointermove",mv); addEventListener("pointerup",up);
  });
  // touch: long-press the title (so normal scrolling still works), then drag
  let timer=null, on=false, x0=0, y0=0;
  h.addEventListener("touchstart",ev=>{
    const t=ev.touches[0]; x0=t.clientX; y0=t.clientY; on=false;
    timer=setTimeout(()=>{ on=true; start(); if(navigator.vibrate) try{ navigator.vibrate(15); }catch(e){} },380);
  },{passive:true});
  h.addEventListener("touchmove",ev=>{
    const t=ev.touches[0];
    if(!on){ if(Math.hypot(t.clientX-x0,t.clientY-y0)>10){ clearTimeout(timer); } return; }
    ev.preventDefault(); dragMoveTo(c,t.clientX,t.clientY);
  },{passive:false});
  const tend=()=>{ clearTimeout(timer); if(on){ on=false; end(); } };
  h.addEventListener("touchend",tend); h.addEventListener("touchcancel",tend);
  h.addEventListener("contextmenu",e=>{ if(on) e.preventDefault(); });
}
$("#dLayReset").onclick=()=>{ dOrder=[]; saveDLay(); renderDash(); toast("סדר הכרטיסים הוחזר"); };

/* dashboard: tasks card — tiles, open tasks by priority (ordinal red ramp, validated light & dark),
   open tasks by assignee, and the ones that need attention now (overdue / urgent). Every piece opens the task list filtered. */
function goTasks(o){
  Object.keys(tkF).forEach(k=>tkF[k]= k==="late" ? false : "");
  Object.assign(tkF, o.f||{}); tkView=o.view||"open"; closeTaskForm();
  const on=Object.keys(o.f||{}).some(k=>k!=="q" && tkF[k]); $("#tfPanel").hidden=!on; $("#tfToggle").setAttribute("aria-expanded",String(on));
  paintTkSeg(); renderTasks(); show("Tasks"); window.scrollTo({top:0});
}
function dashTasks(cards, from){
  const today=ymd(new Date()), byP=t=>(!dPpl || (t.ppl||[]).includes(dPpl)) && (!dDept || inDeptT(t,dDept));
  const open=tkVis().filter(t=>tkOpen(t) && byP(t));
  const done=tkVis().filter(t=>!tkOpen(t) && byP(t) && (!from || String(t.doneAt||"").slice(0,10)>=from)).length;
  if(!tasks.length){
    const b=mk("div","dt-empty"); b.appendChild(mk("p",null,"אין עדיין משימות. משימה שמסיימים נרשמת ביומן כאירוע."));
    const go=mk("button","btn","+ משימה חדשה"); go.type="button"; go.onclick=()=>{ goTasks({}); openTaskForm(null); };
    b.appendChild(go); const c=dcard("משימות",null,b,[],["",""]); c.querySelector("details").remove(); cards.appendChild(c); return;
  }
  const late=open.filter(t=>t.due && t.due<today), urgent=open.filter(t=>prioOf(t)==="דחופה"), mine=open.filter(isMine);
  const body=mk("div");
  // tiles
  const tk=mk("div","dt-tiles");
  const tile=(label,v,cls,fn)=>{ const b=mk("button","dt-tile"+(cls?" "+cls:"")); b.type="button";
    b.append(mk("b",null,nf(v)), mk("span",null,label)); b.onclick=fn; tk.appendChild(b); };
  tile("פתוחות", open.length, "", ()=>goTasks({}));
  tile("דחופות", urgent.length, urgent.length?"hot":"", ()=>goTasks({f:{prio:"דחופה"}}));
  tile("באיחור", late.length, late.length?"hot":"", ()=>goTasks({f:{late:true}}));
  if(myName()) tile("שלי", mine.length, "", ()=>goTasks({view:"mine"}));
  tile(from ? "הושלמו בטווח" : "הושלמו", done, "", ()=>goTasks({view:"done"}));
  body.appendChild(tk);
  if(open.length){
    // by priority: one stacked bar + legend with counts (the legend carries the labels)
    const pc={}; open.forEach(t=>{ const p=prioOf(t); pc[p]=(pc[p]||0)+1; });
    const order=PRIOS.filter(p=>pc[p]);
    // same colours as the priority tags: urgent red, high orange, normal blue, low grey
    const pBox=mk("div","dn-one"); pBox.append(mk("div","dt-h lite-hide","פתוחות לפי עדיפות"),
      donut(order.map(p=>({l:p, v:pc[p], color:"var(--c-"+PRIO_HUE[p]+")", go:()=>goTasks({f:{prio:p}})})), open.length, "פתוחות"));
    // by assignee
    const ac={}; open.forEach(t=>{ const who=(t.ppl||[])[0]||"ללא אחראי"; ac[who]=(ac[who]||0)+1; });
    const names=Object.keys(ac).sort((x,y)=>ac[y]-ac[x]), top=names.slice(0,8);
    if(names.length>8){ const rest=names.slice(8).reduce((s,n)=>s+ac[n],0); top.push("אחרים"); ac["אחרים"]=rest; }
    const items=top.map(n=>({l:n, v:ac[n], go: n==="אחרים"||n==="ללא אחראי" ? ()=>goTasks({}) : ()=>goTasks({f:{ppl:n}})}));
    const PAL=["#1B6FB8","#1C8A4E","#E07B12","#7A3FB5","#0E9AA7","#C2185B","#8D6E63","#9E9D24","#5C6B7A"];
    items.forEach((it,i)=>it.color= it.l==="ללא אחראי"||it.l==="אחרים" ? "var(--edge)" : PAL[i%PAL.length]);
    const aBox=mk("div","dn-one"); aBox.append(mk("div","dt-h lite-hide","פתוחות לפי אחראי"), donut(items, open.length, "פתוחות"));
    const pair=mk("div","dn-pair"); pair.append(pBox,aBox); body.appendChild(pair);   // both as pies, side by side on a wide screen
    // needs attention now
    const hot=open.filter(t=>(t.due && t.due<=today) || prioOf(t)==="דחופה")
      .sort((x,y)=>tkSortKey(x).localeCompare(tkSortKey(y))).slice(0,5);
    if(hot.length){
      const ul=mk("div","dt-hot");
      hot.forEach(t=>{
        const r=mk("button","dt-row"); r.type="button"; r.onclick=()=>goTask(t.id);   // opens this task itself
        const p=prioOf(t); r.style.borderInlineStartColor="var(--c-"+PRIO_HUE[p]+")";
        r.appendChild(mk("span","dt-t",t.title||""));
        const meta=[p!=="רגילה"?p:"", t.due ? (t.due<today?"באיחור · ":t.due===today?"היום · ":"")+dmy(t.due).slice(0,5) : "", (t.ppl||[])[0]||""].filter(Boolean).join(" · ");
        r.appendChild(mk("span","dt-m",meta)); ul.appendChild(r);
      });
      body.append(mk("div","dt-h","דורשות טיפול עכשיו"), ul);
    }
  }
  const c=dcard("משימות", dPpl ? "משימות של "+dPpl : "משימות פתוחות כעת", body,
    [["פתוחות",open.length],["דחופות",urgent.length],["באיחור",late.length]].concat(myName()?[["שלי",mine.length]]:[]).concat([[from?"הושלמו בטווח":"הושלמו",done]])
      .concat(PRIOS.map(p=>["עדיפות "+p, open.filter(t=>prioOf(t)===p).length])), ["מדד","משימות"]);
  c.classList.add("wide"); cards.appendChild(c);
}
function renderDash(){ renderDash0(); arrangeDash(); paintTicker(); paintBoard(); paintBriefCard(); renderLitePie(); }
/* phone dashboard: one pie, switched between views (kept on this device); a slice opens the tasks list filtered */
const LP_VIEWS=[["type","קטגוריה"],["prio","עדיפות"],["dept","מחלקה"],["stat","סטטוס"],["ppl","אחראי"],["ev","אירועים לפי סוג"]];
const LP_COL=["maint","flood","visit","power","fault","gen"];
function renderLitePie(){
  const box=$("#litePie"); if(!box) return; box.textContent=""; if(!isLite()) return;
  let v="type"; try{ v=localStorage.getItem("ogg-lite-pie")||"type"; }catch(e){}
  const seg=mk("div","lp-seg"); seg.setAttribute("role","group"); seg.setAttribute("aria-label","מה להציג בעוגה");
  LP_VIEWS.forEach(([k,l])=>{ const b=mk("button","lp-b",l); b.type="button"; b.setAttribute("aria-pressed",String(k===v));
    b.onclick=()=>{ try{ localStorage.setItem("ogg-lite-pie",k); }catch(e){} renderLitePie(); }; seg.appendChild(b); });
  const open=tkVis().filter(tkOpen), cnt={}, add=(k,n)=>{ if(k) cnt[k]=(cnt[k]||0)+(n||1); };
  let items=[], total=0, label="משימות פתוחות";
  if(v==="ev"){ const ev=events.filter(e=>((e.stat||[])[0]||"פתוח")!=="נסגר"); ev.forEach(e=>((e.type||[]).length?e.type:["ללא סוג"]).forEach(t=>add(t)));
    total=ev.length; label="אירועים פתוחים";
    items=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a]).map(k=>({l:k, v:cnt[k], color:"var(--c-"+hueOf(k)+")", go:()=>{ show("List"); }})); }
  else {
    total=open.length;
    const keyOf={type:t=>t.type||"ללא קטגוריה", prio:t=>prioOf(t), dept:t=>(t.depts||[])[0]||"ללא מחלקה", stat:t=>tkStat(t), ppl:t=>(t.ppl||[])[0]||"ללא אחראי"}[v];
    open.forEach(t=>add(keyOf(t)));
    let keys=Object.keys(cnt).sort((a,b)=>v==="prio" ? PRIOS.indexOf(a)-PRIOS.indexOf(b) : cnt[b]-cnt[a]);
    if(keys.length>6){ const rest=keys.slice(5).reduce((s,k)=>s+cnt[k],0); keys=keys.slice(0,5); cnt["אחרים"]=rest; keys.push("אחרים"); }
    const col=(k,i)=> v==="type" ? hueOf(k) : v==="prio" ? PRIO_HUE[k] : v==="stat" ? ({"פתוחה":"maint","בטיפול":"visit","בהמתנה":"gen"}[k]||"gen") : LP_COL[i%LP_COL.length];
    const go=k=>()=>{ if(k==="אחרים" || /^ללא/.test(k)) return goTasks({}); if(v==="stat") return goTasks({});
      goTasks({f:{[v==="type"?"type":v==="prio"?"prio":v==="dept"?"dept":"ppl"]:k}}); };
    items=keys.map((k,i)=>({l:(v==="dept"?deptIcon(k)+" ":"")+k, v:cnt[k], color:"var(--c-"+col(k,i)+")", go:go(k)}));
  }
  box.append(seg, items.length ? donut(items, total, label) : mk("p","hint","אין מה להציג כרגע."));
}
function liteStrips(){
  document.querySelectorAll("#viewData > .card").forEach(c=>{ if(c.dataset.strip) return; const h=c.querySelector(":scope > h3, :scope > .bd-head, :scope > .card-h"); if(!h) return;
    c.dataset.strip="1"; h.classList.add("strip-h");
    h.addEventListener("click",e=>{ if(!isLite() || e.target.closest("button:not(.strip-h),a,input,select,.info-i,.ci-i")) return;
      const on=!c.classList.contains("strip-open"); document.querySelectorAll("#viewData > .card.strip-open").forEach(x=>x.classList.remove("strip-open"));
      c.classList.toggle("strip-open",on); if(on) window.scrollTo({top:0,behavior:"smooth"}); }); });
}
function renderDash0(){
  document.querySelectorAll("#dRange button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.r===dRange)));
  const from = dRange==="all" ? "" : ymd(daysAgo(+dRange-1));
  const today = ymd(daysAgo(0));
  // person filter: options = everyone who appears in events, most frequent first
  const pc={}; events.forEach(e=>(e.ppl||[]).forEach(v=>{ pc[v]=(pc[v]||0)+1; }));
  const people=coreFirst(Object.keys(pc).sort((a,b)=>pc[b]-pc[a]), "ppl");
  if(dPpl && !pc[dPpl]) dPpl="";
  const ps=$("#dPpl"); ps.textContent="";
  [["","כל המעורבים"]].concat(people.map(v=>[v,v])).forEach(([v,l])=>{ const o=mk("option",null,l); o.value=v; ps.appendChild(o); });
  ps.value=dPpl; ps.hidden=!people.length;
  // department filter: events of the people in it; tasks assigned to it or to its people
  const depts=allDepts(); if(dDept && !depts.includes(dDept)) dDept="";
  const dsel=$("#dDept"); dsel.textContent="";
  [["","כל המחלקות"]].concat(depts.map(v=>[v,deptIcon(v)+" "+v])).forEach(([v,l])=>{ const o=mk("option",null,l); o.value=v; dsel.appendChild(o); });
  dsel.value=dDept; dsel.hidden=!depts.length; dsel.classList.toggle("on",!!dDept); ps.classList.toggle("on",!!dPpl);
  const inScope=e=>(!dPpl || (e.ppl||[]).includes(dPpl)) && (!dDept || inDeptE(e,dDept));
  const rows = events.filter(e=>{
    if(!inScope(e)) return false;
    if(!from) return true; const d=(e.when||"").slice(0,10); return d && d>=from; });
  // the same length of time just before, for the "compared with before" line on the tiles
  const pFrom = from ? ymd(daysAgo(2*(+dRange)-1)) : "";
  const prev = from ? events.filter(e=>{ if(!inScope(e)) return false; const d=(e.when||"").slice(0,10); return d && d>=pFrom && d<from; }) : null;
  const anim=dAnim; dAnim=false;
  $("#dCards").classList.toggle("anim",anim); $("#dKpis").classList.toggle("anim",anim);
  const open = rows.filter(isOpen);
  const closed = rows.length-open.length;
  const faults = open.filter(e=>(e.type||[]).includes("תקלה")).length;
  window.paintTeamStrip();
  $("#dScope").textContent = (from? "מ-"+dmy(from)+" עד היום" : "כל התקופה")+(dDept? " · מחלקת "+dDept : "")+(dPpl? " · "+dPpl : "")+" · "+nf(rows.length)+" אירועים";

  /* KPI row */
  const k=$("#dKpis"); k.textContent="";
  // each tile: icon, number (counts up when the board opens), and — for "נרשמו"/"נסגרו"/"תקלות" — the change from the period before
  const pv = prev && { reg:prev.length, closed:prev.filter(e=>!isOpen(e)).length, faults:prev.filter(e=>(e.type||[]).includes("תקלה")).length };
  const regF = rows.filter(e=>(e.type||[]).includes("תקלה")).length;
  [[ ["אירועים פתוחים","פתוחים"], open.length, "hero k-open", "📂", {stat:OPEN_ANY,from}, null ],
   [ ["אירועי תקלה פתוחים","תקלות פתוחות"], faults, "k-fault", "⚡", {stat:OPEN_ANY,type:"תקלה",from}, pv && [regF,pv.faults,"תקלות נרשמו",true] ],
   [ ["אירועים שנרשמו","נרשמו"], rows.length, "k-reg", "📝", {from}, pv && [rows.length,pv.reg,"",false] ],
   [ ["אירועים שנסגרו","נסגרו"], closed, "k-done", "✅", {stat:"נסגר",from}, pv && [closed,pv.closed,"",false] ]].forEach(([l,v,cls,ic,q,cmp])=>{
    const t=mk("button","kpi "+cls); t.type="button";
    const head=mk("span","kl"); head.append(mk("span","ki",ic), mk("span","kl-full",l[0]), mk("span","kl-short",l[1]));   // the phone view shows the short word under an "אירועים" heading
    const num=mk("b",null,nf(v)); if(anim && v>0) countUp(num,v);
    t.append(head, num);
    if(cmp){ const [now_,was,word,upBad]=cmp, d=now_-was;
      const txt = !was ? (now_ ? "חדש בתקופה" : "") : (d===0 ? "ללא שינוי" : (d>0?"▲ ":"▼ ")+Math.abs(Math.round(100*d/was))+"%");
      const prevName={"30":"30 הימים הקודמים","90":"90 הימים הקודמים","365":"12 החודשים הקודמים"}[dRange]||"התקופה הקודמת";
      if(txt){ const tr=mk("span","ktr "+(d===0||!was ? "" : (d>0)===upBad ? "bad" : "good"), txt+(was&&d?" מהקודם":""));
        tr.title=(word||"")+" לעומת "+prevName+" — אז: "+nf(was)+" · עכשיו: "+nf(now_); t.appendChild(tr); } }
    t.appendChild(mk("span","kgo","הצג ברשימה ‹"));
    t.onclick=()=>goList(q); k.appendChild(t);
  });

  const cards=$("#dCards"); cards.textContent="";
  dashTasks(cards, from);
  if(!rows.length){
    const em=mk("div","dempty"); em.appendChild(mk("p",null, events.length? "אין אירועים בטווח הזה." : "עדיין אין אירועים ביומן."));
    const go=mk("button","btn primary","רישום אירוע"); go.type="button"; go.onclick=()=>show("New");
    em.appendChild(go); cards.appendChild(em); return;
  }

  /* status: one stacked bar + legend (legend carries every value) */
  const sc={}; rows.forEach(e=>{ const s=(e.stat||[])[0]||"פתוח"; sc[s]=(sc[s]||0)+1; });
  const stats=STAT_ORDER.filter(s=>sc[s]).concat(Object.keys(sc).filter(s=>!STAT_ORDER.includes(s)));
  const sb=donut(stats.map(s=>({l:s, v:sc[s], color: STAT_CLS[s] ? "var(--"+STAT_CLS[s]+")" : "var(--other)", go:()=>goList({stat:s,from})})), rows.length, "אירועים");
  cards.appendChild(dcard("סטטוס", null, sb, stats.map(s=>[s,sc[s],Math.round(100*sc[s]/rows.length)+"%"]), ["סטטוס","אירועים","אחוז"]));

  /* open events by age (ordinal ramp: older = darker) */
  const now=daysAgo(0).getTime();
  const ages=AGE.map(()=>0);
  open.forEach(e=>{ const d=(e.when||"").slice(0,10); if(!d) return;
    const n=Math.round((now-new Date(d+"T12:00").getTime())/864e5);
    const i=AGE.findIndex(g=>n>=g.a && n<=g.b); if(i>=0) ages[i]++; });
  const ageItems=AGE.map((g,i)=>({l:g.l, v:ages[i], cls:"age"+i,
    go:()=>{ let f=g.b===Infinity?"":ymd(daysAgo(g.b)); if(from && (!f || f<from)) f=from; goList({stat:OPEN_ANY, from:f, to:ymd(daysAgo(g.a))}); }}));
  cards.appendChild(dcard("אירועים פתוחים לפי ותק", "כמה זמן עבר מאז האירוע", hbars(ageItems, Math.max(...ages)),
    AGE.map((g,i)=>[g.l,ages[i]]), ["ותק","פתוחים"]));

  /* over time: one series, bucket size follows the range */
  const unit = dRange==="30"?"day": dRange==="90"?"week": dRange==="365"?"month":"year";
  const keyOf=d=>{ // d = "YYYY-MM-DD"
    if(unit==="day") return d;
    if(unit==="month") return d.slice(0,7);
    if(unit==="year") return d.slice(0,4);
    const x=new Date(d+"T12:00"); x.setDate(x.getDate()-x.getDay()); return ymd(x); // week starts Sunday
  };
  const labelOf=kk=> unit==="day"||unit==="week" ? kk.slice(8,10)+"/"+kk.slice(5,7) : unit==="month" ? kk.slice(5,7)+"/"+kk.slice(2,4) : kk;
  const buckets=[];
  if(unit==="year"){
    const ys=rows.map(e=>(e.when||"").slice(0,4)).filter(Boolean).sort();
    if(ys.length) for(let y=+ys[0]; y<=+today.slice(0,4); y++) buckets.push(String(y));
  } else {
    const n = unit==="day"?30 : unit==="week"?13 : 12;
    for(let i=n-1;i>=0;i--){
      if(unit==="day") buckets.push(ymd(daysAgo(i)));
      else if(unit==="week") buckets.push(keyOf(ymd(daysAgo(i*7))));
      else { const d=daysAgo(0); d.setDate(1); d.setMonth(d.getMonth()-i); buckets.push(ymd(d).slice(0,7)); }
    }
  }
  const tc={}; rows.forEach(e=>{ const d=(e.when||"").slice(0,10); if(d){ const kk=keyOf(d); tc[kk]=(tc[kk]||0)+1; } });
  const vals=buckets.map(b=>tc[b]||0), vmax=Math.max(1,...vals), imax=vals.indexOf(Math.max(...vals));
  const plot=mk("div","cols"); plot.style.setProperty("--n",buckets.length);
  const bodyT=mk("div");
  buckets.forEach((b,i)=>{
    const c=mk("button","col"+(i===buckets.length-1?" cur":"")); c.type="button";
    const bar_=mk("span","cb"); bar_.style.height=(100*vals[i]/vmax)+"%";
    if(vals[i] && (i===imax || i===buckets.length-1)) bar_.appendChild(mk("span","cv",nf(vals[i])));
    c.appendChild(bar_);
    const unitName={day:"יום",week:"שבוע מ-",month:"חודש",year:"שנה"}[unit];
    tipOn(c, nf(vals[i])+" אירועים", unitName+" "+labelOf(b));
    c.onclick=()=>{
      let f,t;
      if(unit==="day"){ f=t=b; }
      else if(unit==="week"){ f=b; const x=new Date(b+"T12:00"); x.setDate(x.getDate()+6); t=ymd(x); }
      else if(unit==="month"){ f=b+"-01"; const x=new Date(b+"-01T12:00"); x.setMonth(x.getMonth()+1); x.setDate(0); t=ymd(x); }
      else { f=b+"-01-01"; t=b+"-12-31"; }
      if(from && f<from) f=from;   // first bucket may start before the range
      goList({from:f,to:t});
    };
    plot.appendChild(c);
  });
  const axis=mk("div","cax");
  if(unit==="month" || (unit==="year" && buckets.length<=15)){
    // a label under every bar: month number (year under the first month and every January), or the year
    axis.classList.add("all");
    buckets.forEach((b,i)=>{
      const s=mk("span",null, unit==="month" ? String(+b.slice(5,7)) : b); s.style.setProperty("--i",i);
      if(unit==="month" && (i===0 || b.slice(5,7)==="01")) s.appendChild(mk("small",null,b.slice(0,4)));
      axis.appendChild(s); });
  } else
  [0, Math.floor((buckets.length-1)/2), buckets.length-1].filter((v,i,a)=>a.indexOf(v)===i).forEach(i=>{
    const s=mk("span",null,labelOf(buckets[i])); s.style.setProperty("--i",i); axis.appendChild(s); });
  axis.style.setProperty("--n",buckets.length);
  bodyT.append(plot,axis);
  const tTitle={day:"אירועים לפי יום",week:"אירועים לפי שבוע",month:"אירועים לפי חודש",year:"אירועים לפי שנה"}[unit];
  const tCard=dcard(tTitle, "כל האירועים שנרשמו, פתוחים וסגורים", bodyT,
    buckets.map((b,i)=>[labelOf(b),vals[i]]), [{day:"יום",week:"שבוע",month:"חודש",year:"שנה"}[unit],"אירועים"]);
  tCard.classList.add("wide"); cards.appendChild(tCard);

  /* open by type / by location: top 6 + "other" */
  const topBars=(key,title,filterKey)=>{
    const c={}; open.forEach(e=>(e[key]||[]).forEach(v=>{ c[v]=(c[v]||0)+1; }));
    const all=Object.keys(c).sort((a,b)=>c[b]-c[a]);
    const top=all.slice(0,6), rest=all.slice(6).reduce((s,v)=>s+c[v],0);
    const items=top.map(v=>({l:v,v:c[v],hue:key==="type"?hueOf(v):"",go:()=>goList({stat:OPEN_ANY,[filterKey]:v,from})}));
    if(rest) items.push({l:"אחר ("+all.slice(6).length+")",v:rest,cls:"other"});
    if(!items.length) return;
    const max=Math.max(...items.map(i=>i.v));
    cards.appendChild(dcard(title, null, hbars(items,max,"one"), all.map(v=>[v,c[v]]), [title.replace("פתוחים לפי ",""),"פתוחים"]));
  };
  { const c={}; open.forEach(e=>(e.type||[]).forEach(v=>{ c[v]=(c[v]||0)+1; }));
    const all=Object.keys(c).sort((a,b)=>c[b]-c[a]), top=all.slice(0,5), rest=all.slice(5).reduce((s,v)=>s+c[v],0);
    const items=top.map(v=>({l:v, v:c[v], color:"var(--c-"+hueOf(v)+")", go:()=>goList({stat:OPEN_ANY,type:v,from})}));
    if(rest) items.push({l:"אחר ("+all.slice(5).length+")", v:rest, color:"var(--other)"});
    if(items.length) cards.appendChild(dcard("פתוחים לפי סוג", null, donut(items, open.length, "פתוחים"), all.map(v=>[v,c[v]]), ["סוג","פתוחים"])); }
  topBars("loc","פתוחים לפי מיקום","loc");

  /* by department: open / closed events and open tasks per department (tap = show only that department) */
  if(!dDept && depts.length){
    const per=depts.map(d=>{ const ev=rows.filter(e=>inDeptE(e,d)); return {l:d, o:ev.filter(isOpen).length, c:ev.filter(e=>!isOpen(e)).length,
      t:tkVis().filter(t=>tkOpen(t) && inDeptT(t,d) && (!dPpl || (t.ppl||[]).includes(dPpl))).length}; }).sort((a,b)=>(b.o+b.c)-(a.o+a.c) || b.t-a.t);
    const max=Math.max(1,...per.map(i=>i.o+i.c)), body=mk("div");
    const lg=mk("div","legend"); [["אירועים פתוחים","s-open"],["אירועים שנסגרו","s-done"]].forEach(([l,c])=>{ const li=mk("span","li"); li.append(mk("i",c),mk("span",null,l)); lg.appendChild(li); });
    const box=mk("div","pbars");
    per.forEach(it=>{
      const row=mk("div","pbar"), lb=mk("button","pl",deptIcon(it.l)+" "+it.l); lb.type="button";
      lb.onclick=()=>{ dDept=it.l; try{ localStorage.setItem("ogg-dash-dept",dDept); }catch(e){} dAnim=true; renderDash(); window.scrollTo({top:0,behavior:"smooth"}); };
      tipOn(lb, "הצג את הדשבורד של המחלקה", it.l);
      const tr=mk("span","pt"), bar=mk("span","pb"); bar.style.width = (it.o+it.c) ? "max(4px, calc(100% * "+((it.o+it.c)/max)+"))" : "0";
      [["o","s-open","פתוחים"],["c","s-done","נסגרו"]].forEach(([k,cls,word])=>{ if(!it[k]) return;
        const sg=mk("span","pseg "+cls); sg.style.flexGrow=it[k]; tipOn(sg, nf(it[k])+" "+word, it.l); bar.appendChild(sg); });
      tr.appendChild(bar);
      const head=mk("div","ph"); head.append(lb, mk("span","pv", nf(it.o+it.c)+" אירועים"+(it.o?" · "+nf(it.o)+" פתוחים":"")+(it.t?" · "+nf(it.t)+" משימות פתוחות":"")));
      row.append(head,tr); box.appendChild(row);
    });
    body.append(lg,box);
    cards.appendChild(dcard("לפי מחלקות","לפי המחלקה של המעורבים · לחיצה על מחלקה מציגה רק אותה", body,
      per.map(i=>[i.l,i.o+i.c,i.o,i.c,i.t]), ["מחלקה","אירועים","פתוחים","נסגרו","משימות פתוחות"]));
  }

  /* by person: open vs closed per person (hidden when one person is already selected) */
  if(!dPpl){
    const per={}; rows.forEach(e=>(e.ppl||[]).forEach(v=>{ const r=per[v]||(per[v]={o:0,c:0}); isOpen(e)? r.o++ : r.c++; }));
    const names=Object.keys(per).sort((a,b)=>(per[b].o+per[b].c)-(per[a].o+per[a].c) || per[b].o-per[a].o);
    if(names.length){
      const top=names.slice(0,8), restN=names.slice(8);
      const items=top.map(v=>({l:v,o:per[v].o,c:per[v].c,p:v}));
      if(restN.length) items.push({l:"אחר ("+restN.length+")",o:restN.reduce((s,v)=>s+per[v].o,0),c:restN.reduce((s,v)=>s+per[v].c,0)});
      const max=Math.max(...items.map(i=>i.o+i.c));
      const body=mk("div");
      const lg=mk("div","legend"); [["פתוח","s-open"],["נסגר","s-done"]].forEach(([l,c])=>{ const li=mk("span","li"); li.append(mk("i",c),mk("span",null,l)); lg.appendChild(li); });
      const box=mk("div","pbars");
      items.forEach(it=>{
        const row=mk("div","pbar");
        const lb=mk(it.p?"button":"span","pl",it.l);
        if(it.p){ lb.type="button"; lb.onclick=()=>goList({ppl:it.p,from}); tipOn(lb, nf(it.o+it.c)+" אירועים", it.l); }
        const tr=mk("span","pt");
        const bar=mk("span","pb"); bar.style.width="max(4px, calc(100% * "+((it.o+it.c)/max)+"))";
        [["o","s-open","פתוחים",OPEN_ANY],["c","s-done","נסגרו","נסגר"]].forEach(([k,cls,word,stat])=>{
          if(!it[k]) return;
          const sg=mk(it.p?"button":"span","pseg "+cls); sg.style.flexGrow=it[k];
          if(it.p){ sg.type="button"; sg.onclick=()=>goList({ppl:it.p,stat,from}); }
          tipOn(sg, nf(it[k])+" "+word, it.l); bar.appendChild(sg);
        });
        tr.appendChild(bar);
        const head=mk("div","ph"); head.append(lb, mk("span","pv", nf(it.o+it.c)+(it.o? " · "+nf(it.o)+" פתוחים" : "")));
        row.append(head,tr); box.appendChild(row);
      });
      body.append(lg,box);
      cards.appendChild(dcard("לפי מעורבים","אירועים לכל אדם, פתוחים וסגורים", body,
        names.map(v=>[v,per[v].o+per[v].c,per[v].o,per[v].c]), ["מעורב","אירועים","פתוחים","נסגרו"]));
    }
  }
}
$("#dPpl").onchange=()=>{ dPpl=$("#dPpl").value; dAnim=true; renderDash(); };
$("#dDept").onchange=()=>{ dDept=$("#dDept").value; try{ localStorage.setItem("ogg-dash-dept",dDept); }catch(e){} dAnim=true; renderDash(); };
/* "לפני 5 דק׳" — how long ago, in short Hebrew */
function agoHe(t){ const d=(Date.now()-t)/1000;
  if(d<90) return "עכשיו"; if(d<3600) return "לפני "+Math.round(d/60)+" דק׳"; if(d<86400) return "לפני "+Math.round(d/3600)+" שע׳";
  const x=new Date(t), y=new Date(); y.setDate(y.getDate()-1);
  if(x.toDateString()===y.toDateString()) return "אתמול "+String(x.getHours()).padStart(2,"0")+":"+String(x.getMinutes()).padStart(2,"0");
  if(d<7*86400) return "לפני "+Math.round(d/86400)+" ימים"; return "ב-"+x.toLocaleDateString("he-IL"); }
window.agoHe=agoHe;
/* the team at a glance (team log, on the dashboard): who is connected now, and when the others were last here */
window.paintTeamStrip=function(){
  const box=$("#dTeam"); if(!box) return;
  const M=window.teamMembers ? window.teamMembers() : [];
  if(!CLOUD_ON || !M.length || !(window.cloudIsAdmin && window.cloudIsAdmin())){ box.hidden=true; return; }   // who is connected: managers only
  const st=M.map(m=>({m, s:window.memberState(m), t:(window.teamSeen()[m.email]||0)}))
    .sort((a,b)=>(a.s.k==="on"?0:1)-(b.s.k==="on"?0:1) || b.t-a.t || (a.m.name||a.m.email).localeCompare(b.m.name||b.m.email,"he"));
  box.textContent=""; box.hidden=false;
  const onL=st.filter(x=>x.s.k==="on"), all=box.classList.contains("all");
  const head=mk("button","dt-lbl"); head.type="button"; head.setAttribute("aria-expanded",String(all));
  head.append(mk("i","dt-dot"+(onL.length?" on":"")), mk("span",null,onL.length ? onL.length+" מחוברים עכשיו" : "אין מחוברים עכשיו"), mk("small",null, all ? "▴ פחות" : "▾ כל הצוות"));
  head.onclick=()=>{ box.classList.toggle("all"); window.paintTeamStrip(); };
  box.appendChild(head);
  (all ? st : onL).forEach(({m,s})=>{ const c=mk("span","dt-p st-"+s.k); c.title=(m.name||m.email)+" — "+s.t;
    c.append(mk("i"), mk("b",null,m.name||m.email.split("@")[0]));
    if(all && s.k!=="on") c.appendChild(mk("small",null, s.k==="was" ? s.t.replace(/^התחבר /,"").replace(/^הצטרף.*/,"הצטרף") : s.k==="inv" ? "הוזמן" : "טרם הוזמן"));
    box.appendChild(c); });
};
/* feedback (💬, bottom corner): a picture of the screen exactly as it is now; tap the picture to circle the spot,
   write a note, send. Team log — it reaches the managers (a message + "משובים" in settings);
   this device only — the picture is saved as a file to send on. */
/* html2canvas can't read today's colour syntax (the browser reports color-mix() as "color(srgb …)"):
   just for the capture, every such colour on the page is written inline as plain rgba(); the returned function puts things back */
function h2cColorsOn(){
  const P=["color","background-color","background-image","border-top-color","border-right-color","border-bottom-color","border-left-color",
    "outline-color","box-shadow","text-decoration-color","fill","stroke","caret-color"], undo=[];
  const fix=v=>v.replace(/color\((?:srgb|display-p3) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)(?: \/ ([\d.%]+))?\)/g,(m,r,g,b,a)=>{
      const c=x=>Math.max(0,Math.min(255,Math.round(parseFloat(x)*255)));
      const al = a==null ? 1 : (String(a).endsWith("%") ? parseFloat(a)/100 : parseFloat(a));
      return "rgba("+c(r)+","+c(g)+","+c(b)+","+al+")"; })
    .replace(/(?:oklch|oklab|lab|lch)\([^()]*\)/g,"rgba(128,128,128,1)");
  [document.documentElement,...document.querySelectorAll("*")].forEach(el=>{
    if(!el.style) return; const cs=getComputedStyle(el);
    P.forEach(p=>{ const v=cs.getPropertyValue(p); if(!v || !/color\(|oklch|oklab|lab\(|lch\(/.test(v)) return;
      undo.push([el,p,el.style.getPropertyValue(p),el.style.getPropertyPriority(p)]); el.style.setProperty(p, fix(v), "important"); });
  });
  return ()=>undo.reverse().forEach(([el,p,v,pr])=>{ if(v) el.style.setProperty(p,v,pr); else el.style.removeProperty(p); });
}
let fbBase=null, fbMarks=[];
$("#fbBtn").onclick=async()=>{
  const b=$("#fbBtn"); b.hidden=true; if($("#dTip")) $("#dTip").hidden=true;
  try{
    await loadH2C();
    const sc=Math.min(1, 1100/innerWidth), bg=getComputedStyle(document.body).backgroundColor;
    const restore=h2cColorsOn();
    try{ fbBase=await html2canvas(document.body,{x:scrollX,y:scrollY,width:innerWidth,height:innerHeight,windowWidth:innerWidth,windowHeight:innerHeight,
      scale:sc,backgroundColor:bg||"#ffffff",logging:false}); }
    finally{ restore(); }
    fbMarks=[]; fbDraw(); $("#fbText").value=""; $("#dlgFb").showModal(); setTimeout(()=>$("#fbText").focus(),100);
  }catch(e){ toast("לא הצלחתי לצלם את המסך"); }
  b.hidden=false;
};
function fbDraw(){
  const cv=$("#fbCanvas"); cv.width=fbBase.width; cv.height=fbBase.height; const g=cv.getContext("2d"); g.drawImage(fbBase,0,0);
  const r=Math.max(16,cv.width*0.035); g.lineWidth=Math.max(3,cv.width*0.006); g.strokeStyle="#e11d48";
  fbMarks.forEach(([x,y])=>{ g.beginPath(); g.arc(x,y,r,0,Math.PI*2); g.stroke(); });
  $("#fbUndo").hidden=!fbMarks.length;
}
$("#fbCanvas").onclick=e=>{ const cv=e.currentTarget, rc=cv.getBoundingClientRect();
  fbMarks.push([(e.clientX-rc.left)*cv.width/rc.width,(e.clientY-rc.top)*cv.height/rc.height]); fbDraw(); };
$("#fbUndo").onclick=()=>{ fbMarks.pop(); fbDraw(); };
$("#fbCancel").onclick=()=>$("#dlgFb").close();
$("#fbSend").onclick=async()=>{
  const text=$("#fbText").value.trim(); if(!text && !fbMarks.length){ toast("כתוב מה רצית לומר, או סמן על התמונה"); $("#fbText").focus(); return; }
  const cv=$("#fbCanvas"); let img=cv.toDataURL("image/jpeg",.72);
  if(img.length>600000){ const k=Math.sqrt(600000/img.length), t=document.createElement("canvas"); t.width=Math.round(cv.width*k); t.height=Math.round(cv.height*k);
    t.getContext("2d").drawImage(cv,0,0,t.width,t.height); img=t.toDataURL("image/jpeg",.65); }
  const view={Dash:"דשבורד",List:"אירועים",Tasks:"משימות",Cal:"לוח שנה",Data:"הגדרות",New:"רישום אירוע"}[curView]||curView||"";
  const rec={id:newId(), text, img, by:reporter()||"", at:nowLocal(), view, ver:APP_VER, screen:innerWidth+"×"+innerHeight};
  const b=$("#fbSend"); b.disabled=true;
  if(window.cloudSendFeedback){
    const ok=await window.cloudSendFeedback(rec); b.disabled=false;
    if(ok){ $("#dlgFb").close(); toast("המשוב נשלח למנהל — תודה!"); } else toast("השליחה נכשלה — בדוק חיבור ונסה שוב");
    return;
  }
  b.disabled=false;
  const a=document.createElement("a"); a.href=img; a.download="משוב "+rec.at.replace("T"," ").replace(/:/g,"-")+".jpg"; document.body.appendChild(a); a.click(); a.remove();
  $("#dlgFb").close(); toast("צילום המסך נשמר — שלח אותו יחד עם ההערה");
};
/* numbers count up when the dashboard opens (skipped when the phone asks for less motion) */
function countUp(el, to){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const t0=performance.now(), dur=Math.min(900, 350+to*2);
  const step=t=>{ const k=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-k,3); el.textContent=nf(Math.round(to*e)); if(k<1) requestAnimationFrame(step); };
  el.textContent="0"; requestAnimationFrame(step);
}
document.querySelectorAll("#dRange button").forEach(b=>b.onclick=()=>{
  dRange=b.dataset.r; try{ localStorage.setItem("ogg-dash-range",dRange); }catch(e){}
  renderDash();
});
addEventListener("scroll",()=>{ const t=$("#dTip"); if(t) t.hidden=true; },{passive:true});

/* ================= new events from the team (unseen marker) ================= */
let UNSEEN=new Set(), curView=null;
try{ UNSEEN=new Set(JSON.parse(localStorage.getItem("ogg-unseen")||"[]")); }catch(e){}
function saveUnseen(){ try{ localStorage.setItem("ogg-unseen",JSON.stringify([...UNSEEN])); }catch(e){} paintNewCount(); }
function paintNewCount(){
  const have=new Set(events.map(e=>e.id)); const n=[...UNSEEN].filter(id=>have.has(id)).length;
  const el=$("#newCnt"); el.textContent = n ? (n>99?"99+":String(n)) : ""; el.title = n ? n+" אירועים חדשים" : "";
  el.hidden = !n || curView==="List";
}
function showNew(){                       // open the list with the newest changes on top, new ones highlighted
  const sp=$("#splash"); if(sp && !sp.hidden && window.splashEnter && !$("#spEnter").hidden) window.splashEnter();
  $("#sortBy").value="edit"; goList({ppl:""});
  setTimeout(()=>{ const el=document.querySelector(".ev.is-new"); if(el) el.scrollIntoView({block:"center",behavior:"smooth"}); },150);
}
if(navigator.serviceWorker) navigator.serviceWorker.addEventListener("message",ev=>{
  if(ev.data && ev.data.type==="show-new") showNew();
  if(ev.data && ev.data.type==="show-tasks") setTimeout(()=>showMyTasks(),0);
  if(ev.data && ev.data.type==="show-task") showTaskSoon(String(ev.data.tid||""));
});
/* open one task from a push (the app may still be loading: wait for the task to arrive, up to ~15 s) */
function showTaskSoon(tid){
  if(!tid) return;
  const sp=$("#splash"); if(sp && !sp.hidden && window.splashEnter && !$("#spEnter").hidden) window.splashEnter();
  let n=0; const go=()=>{ if(tid.startsWith("p:") || tasks.some(x=>x.id===tid) || ++n>30) goTask(tid); else setTimeout(go,500); };
  setTimeout(go,0);
}

/* ================= app icon badge ================= */
let badgeMode="recent";
try{ badgeMode=localStorage.getItem("ogg-badge")||"recent"; }catch(e){}
function updateBadge(){
  if(!("setAppBadge" in navigator)) return;
  let n=0;
  if(badgeMode==="recent"){ const from=ymd(daysAgo(29)); n=events.filter(e=>isOpen(e) && (e.when||"").slice(0,10)>=from).length; }
  else if(badgeMode==="open") n=events.filter(isOpen).length;
  else if(badgeMode==="faults") n=events.filter(e=>isOpen(e) && (e.type||[]).includes("תקלה")).length;
  try{ n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); }catch(e){}
}
$("#badgeMode").value=badgeMode;
$("#badgeMode").onchange=()=>{ badgeMode=$("#badgeMode").value; try{ localStorage.setItem("ogg-badge",badgeMode); }catch(e){} updateBadge(); };
if(!("setAppBadge" in navigator)) $("#badgeNote").textContent="הדפדפן הזה לא מציג מספר על האייקון (למשל כרום באנדרואיד). במחשב, ובאייפון כשהאפליקציה מותקנת, זה עובד.";

/* ================= tabs / theme ================= */
function show(w){
  if(w==="Cal" && isLite()) w="Dash";                // no calendar in the phone view
  if($("#dTip")) $("#dTip").hidden=true;
  const prev=curView; curView=w;
  if(prev==="List" && w!=="List" && UNSEEN.size){ UNSEEN.clear(); saveUnseen(); }   // seen once you leave the list
  if(prev==="Tasks" && w!=="Tasks" && typeof tkMarkSeen==="function") tkMarkSeen();   // new tasks: seen once you leave the tasks list
  if($("#newCnt")) paintNewCount();
  // the calendar opens from the events or the tasks list, and that tab stays lit; settings is the gear in the header
  const lit = w==="Cal" ? (calMd==="tk" ? "Tasks" : "List") : w;
  ["New","List","Dash","Data","Tasks","Cal"].forEach(v=>{
    $("#view"+v).hidden=(v!==w);
    const tb=$("#tab"+v); if(tb) tb.setAttribute("aria-selected",String(v===lit));
  });
  $("#setBtn").setAttribute("aria-pressed",String(w==="Data"));
  document.documentElement.dataset.view=w; if(typeof paintBotNav==="function") paintBotNav(); if(w==="Data" && typeof liteStrips==="function") liteStrips();
  $("#savebar").style.display = w==="New"?"block":"none";
  document.querySelector(".wrap").style.paddingBottom = w==="New"?"130px":"40px";
}
$("#tabNew").onclick=()=>show("New");
$("#fabNew").onclick=()=>{ show("New"); window.scrollTo({top:0}); };   // "+" in the events list replaces the "רישום אירוע" tab
$("#tabList").onclick=()=>{ renderFilters(); renderList(); show("List"); };
$("#tabDash").onclick=()=>{ dAnim=true; renderDash(); show("Dash"); };
$("#tabData").onclick=$("#setBtn").onclick=()=>{ renderStats(); renderMgr(); paintSettings(); show("Data"); window.scrollTo({top:0}); };
/* settings: one topic at a time (lists / team / files / general); the last one is remembered */
let sgCur="lists"; try{ sgCur=localStorage.getItem("ogg-settings-topic")||"lists"; }catch(e){}
/* who manages: on this device (no team log) — you; in the team log — only members with the admin role.
   A regular member sees "צוות וחשבון" (own account) and "כללי"; lists management and files/backup are for admins. */
function isManager(){ if(!CLOUD_ON) return true; try{ return localStorage.getItem("ogg-cloud-role")==="admin"; }catch(e){ return false; } }
function paintSettings(){
  const team=!!$("#cloudCard"), mgr=isManager();
  $("#sgNav [data-sg=team]").hidden=!team; $("#sgNav [data-sg=notif]").hidden=!team || isViewer();
  if(sgCur==="notif" && (!team || isViewer())) sgCur="general";
  $("#sgNav [data-sg=lists]").hidden=!mgr; $("#sgNav [data-sg=files]").hidden=!mgr; $("#sgNav [data-sg=sec]").hidden=!mgr || TV;
  if((!mgr || isLite()) && (sgCur==="lists"||sgCur==="files")) sgCur = team ? "team" : "general";   // phone view: no lists / files topics
  if(sgCur==="sec" && (!mgr || TV)) sgCur = team ? "team" : "general";
  if(sgCur==="team" && !team) sgCur = mgr ? "lists" : "general";
  document.querySelectorAll("#sgNav button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.sg===sgCur)));
  document.querySelectorAll("#viewData > .card").forEach(c=>{ c.hidden = (c.dataset.sg||"general")!==sgCur || c.dataset.off==="1" || (c.id==="liteCard" && !LITE_MQ.matches) || (c.id==="tvCard" && !mgr) || (c.id==="newsCard" && !(CLOUD_ON && mgr)); });
}
document.querySelectorAll("#sgNav button").forEach(b=>b.onclick=()=>{ sgCur=b.dataset.sg; try{ localStorage.setItem("ogg-settings-topic",sgCur); }catch(e){} paintSettings(); window.scrollTo({top:0}); });
window.paintSettings=paintSettings;
const _ps=paintSettings; paintSettings=function(){ _ps(); if(typeof relPaint==="function") relPaint(); if($("#relCard") && $("#relCard").dataset.off!=="1" && (sgCur||"general")==="general") $("#relCard").hidden=false; };
window.paintSettings=paintSettings;
/* theme: one tap switches between light and dark (whatever is showing now — the phone's setting or a saved choice) */
const darkMQ=window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : {matches:false};
function isDark(){ const t=document.documentElement.getAttribute("data-theme"); return t ? t==="dark" : darkMQ.matches; }
function paintThemeBtn(){
  const d=isDark(), b=$("#themeBtn");
  b.textContent = d ? "☀ רקע בהיר" : "☾ רקע כהה";
  b.title = b.ariaLabel = d ? "מעבר לרקע בהיר" : "מעבר לרקע כהה";
  const m=document.querySelector('meta[name="theme-color"]'); if(m) m.content = d ? "#0E161C" : (getComputedStyle(document.documentElement).getPropertyValue("--water").trim() || "#0E7C86");
  const t=document.documentElement.getAttribute("data-theme"), cs=document.querySelector('meta[name="color-scheme"]');
  if(cs) cs.content = t==="light" ? "only light" : t==="dark" ? "only dark" : "light dark";
}
$("#themeBtn").onclick=()=>{
  const next = isDark() ? "light" : "dark";
  document.documentElement.setAttribute("data-theme",next);
  try{ localStorage.setItem("ogg-theme",next); }catch(e){}
  paintThemeBtn();
};
try{ const th=localStorage.getItem("ogg-theme"); if(th==="light"||th==="dark") document.documentElement.setAttribute("data-theme",th); }catch(e){}
if(darkMQ.addEventListener) darkMQ.addEventListener("change",paintThemeBtn);
/* colour scheme (accent): the same app in another colour; the choice stays on this device */
const ACCENTS=[["teal","טורקיז","#0E7C86"],["blue","כחול מבט\"י","#1565A8"],["red","אדום","#D32F2F"],["orange","כתום עז","#C94A00"],["green","ירוק","#1B8A3A"],["emerald","ירוק-טורקיז","#008C7A"],["cyan","תכלת","#0277BD"],["royal","כחול רויאל","#1D4ED8"],["violet","סגול עז","#7C3AED"],["magenta","מג׳נטה","#C2185B"],["black","שחור","#111827"],["purple","סגול","#6A3FB8"],["wine","בורדו","#9C2A4E"],["amber","כתום","#B45309"],["slate","גרפיט","#3F4B59"]];
function curAccent(){ return document.documentElement.getAttribute("data-accent") || "teal"; }
function paintAccents(){
  const box=$("#accList"); if(!box) return; box.textContent="";
  ACCENTS.forEach(([k,name,col])=>{ const b=mk("button","acc"); b.type="button"; b.setAttribute("aria-pressed",String(k===curAccent()));
    const i=mk("i"); i.style.background=col; b.append(i,name);
    b.onclick=()=>{ if(k==="teal") document.documentElement.removeAttribute("data-accent"); else document.documentElement.setAttribute("data-accent",k);
      try{ localStorage.setItem("ogg-accent",k); }catch(e){}
      paintAccents(); paintThemeBtn(); if(!$("#viewDash").hidden && typeof renderDash==="function") renderDash(); };
    box.appendChild(b); });
}
paintAccents();
paintThemeBtn();

/* ================= voice ================= */
(function(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition, btn=$("#micBtn");
  if(!SR){ btn.hidden=true; $("#micHint").textContent="הכתבה קולית לא נתמכת בדפדפן הזה."; return; }
  let rec=null;
  btn.onclick=()=>{
    if(rec){ rec.stop(); return; }
    rec=new SR(); rec.lang="he-IL"; rec.continuous=true; rec.interimResults=false;
    const base=$("#desc").value;
    rec.onresult=ev=>{ let s=""; for(let i=ev.resultIndex;i<ev.results.length;i++) s+=ev.results[i][0].transcript;
      $("#desc").value=(base?base+" ":"")+s.trim(); };
    rec.onerror=()=>{ $("#micHint").textContent="ההכתבה נעצרה. נסה שוב או הקלד."; };
    rec.onend=()=>{ rec=null; btn.dataset.rec="0"; $("#micHint").textContent=""; };
    rec.start(); btn.dataset.rec="1"; $("#micHint").textContent="מקליט — הקש שוב לעצירה.";
  };
})();

/* ================= file / export ================= */
function payload(){
  const out={app:"ogg-event-log",version:2,saved:new Date().toISOString(),events,lists:{},tasks};
  Object.keys(SEED).forEach(k=>{ out.lists[k]=lists["_custom_"+k]; out.lists["_hide_"+k]=lists["_hide_"+k]; }); out.lists._core_ppl=lists._core_ppl||[]; out.lists._roles_ppl=lists._roles_ppl||{}; out.lists._dept_ppl=lists._dept_ppl||{};
  return out;
}
async function writeFile(){
  if(!fileHandle) return;
  try{
    const w=await fileHandle.createWritable();
    await w.write(JSON.stringify(payload(),null,1)); await w.close();
    $("#fileState").textContent="מסונכרן לקובץ · נשמר "+new Date().toLocaleTimeString("he-IL");
  }catch(e){ $("#fileState").textContent="לא הצלחתי לכתוב לקובץ. חבר אותו מחדש."; }
}
$("#linkFile").onclick=async()=>{
  if(!window.showSaveFilePicker){ toast("הדפדפן לא תומך — השתמש בהורדת גיבוי"); return; }
  try{
    fileHandle=await window.showSaveFilePicker({suggestedName:"יומן-אירועים-אוג.json",
      types:[{description:"גיבוי יומן",accept:{"application/json":[".json"]}}]});
    pendingHandle=null; await fhSave(fileHandle); fileLinkedUI();
    await writeFile(); toast("הקובץ חובר");
  }catch(e){}
};
$("#saveNow").onclick=async()=>{
  if(!fileHandle && pendingHandle) await ensureFilePermission();
  if(!fileHandle){ toast("חבר קובץ קודם"); return; }
  await writeFile(); toast("נשמר לקובץ");
};

/* keep the linked file across reloads and updates: the file handle is stored in IndexedDB */
let pendingHandle=null;
function fhDb(){ return new Promise((res,rej)=>{ const r=indexedDB.open("ogg-file",1);
  r.onupgradeneeded=()=>r.result.createObjectStore("h"); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function fhSave(h){ try{ const db=await fhDb(); await new Promise((res,rej)=>{ const tx=db.transaction("h","readwrite");
  tx.objectStore("h").put(h,"file"); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }catch(e){} }
async function fhLoad(){ try{ const db=await fhDb(); return await new Promise(res=>{ const r=db.transaction("h").objectStore("h").get("file");
  r.onsuccess=()=>res(r.result||null); r.onerror=()=>res(null); }); }catch(e){ return null; } }
function fileLinkedUI(){
  $("#fileState").textContent="מחובר לקובץ "+fileHandle.name+" · כל שמירה נכתבת אליו";
  $("#fileAllow").hidden=true; $("#linkFile").textContent="חבר קובץ אחר";
}
async function ensureFilePermission(){          // must run inside a click: may show the browser's prompt
  if(fileHandle) return true;
  if(!pendingHandle) return false;
  try{
    if(await pendingHandle.requestPermission({mode:"readwrite"})==="granted"){
      fileHandle=pendingHandle; pendingHandle=null; fileLinkedUI(); return true;
    }
  }catch(e){}
  return false;
}
$("#fileAllow").onclick=async()=>{ if(await ensureFilePermission()){ await writeFile(); toast("הקובץ מחובר"); } };
(async()=>{
  if(!("indexedDB" in window)) return;
  const h=await fhLoad(); if(!h || !h.queryPermission) return;
  let st="prompt"; try{ st=await h.queryPermission({mode:"readwrite"}); }catch(e){}
  if(st==="granted"){ fileHandle=h; fileLinkedUI(); return; }
  pendingHandle=h;
  $("#fileState").textContent="הקובץ "+h.name+" עדיין מחובר, אבל הדפדפן מבקש לאשר גישה אליו. זה יתבקש אוטומטית בשמירה הבאה, או לחץ \"אשר גישה לקובץ\". בחלון של הדפדפן בחר \"אפשר בכל ביקור\" כדי שלא יישאל שוב.";
  $("#fileAllow").hidden=false;
  toast("הקובץ "+h.name+" מחכה לאישור גישה",{label:"אשר",fn:()=>{ $("#fileAllow").click(); }});
})();
function download(name,text,mime){
  const blob=new Blob([mime.indexOf("csv")>=0?"\uFEFF"+text:text],{type:mime});
  const url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
$("#expJson").onclick=()=>{ download("יומן-אירועים-אוג.json",JSON.stringify(payload(),null,1),"application/json"); toast("הגיבוי הורד"); };
/* ================= weekly summary (PDF) + backup =================
   Once a week (from Sunday 00:00) a window opens that can't be dismissed until both steps are done:
   1) share/download a PDF summary of a date range (default: the last 7 days), 2) share/download a full backup.
   Team mode: only admins, and only after the first full sync from the server (so the backup is complete).
   The PDF is drawn from an off-screen A4 layout with html2canvas (vendor/, loaded on demand) and packed
   into a PDF by pdfFromJpegs() — no other library. */
const K_WEEK="ogg-weekly-done", K_WEEK_TO="ogg-weekly-to", K_WEEK_SNZ="ogg-weekly-snooze";
let wkState=null;
function weekStart(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate()-x.getDay()); return x.getTime(); }
function weekDone(){ try{ return +localStorage.getItem(K_WEEK)||0; }catch(e){ return 0; } }
function appTitle(){                          // the header title, e.g. "יומן אירועים ומשימות" + sub-title
  const m=$(".bar .mark"); if(!m) return "יומן אירועים ומשימות";
  const sub=m.querySelector(".sub"), main=[...m.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join("").trim();
  return (main+" "+(sub?sub.textContent:"")).trim();
}
function rangeSummary(from,to){                // from/to: "YYYY-MM-DD", inclusive
  const inR=s=>{ const d=String(s||"").slice(0,10); return d>=from && d<=to; };
  const isF=e=>(e.type||[]).includes("תקלה");
  const rows=events.filter(e=>inR(e.when)).sort((a,b)=>String(a.when).localeCompare(String(b.when)));
  const closed=events.filter(e=>!isOpen(e) && inR(e.closedAt)).length;
  const open=events.filter(isOpen), openF=open.filter(isF).sort((a,b)=>String(a.when).localeCompare(String(b.when)));
  const byType={}; rows.forEach(e=>((e.type||[]).length?e.type:["ללא סוג"]).forEach(t=>byType[t]=(byType[t]||0)+1));
  const types=Object.keys(byType).sort((a,b)=>byType[b]-byType[a]).map(t=>[t,byType[t]]);
  const nums=[["נרשמו בטווח",rows.length],["תקלות בטווח",rows.filter(isF).length],["נסגרו בטווח",closed],
              ["פתוחים כעת",open.length],["תקלות פתוחות",openF.length]];
  return {from,to,range:dmy(from)+" – "+dmy(to),rows,openF,nums,types};
}

/* ---- PDF ---- */
function loadH2C(){
  if(window.html2canvas) return Promise.resolve();
  return new Promise((ok,no)=>{ const s=document.createElement("script"); s.src="vendor/html2canvas.min.js?v="+APP_VER;
    s.onload=ok; s.onerror=()=>no(new Error("html2canvas")); document.head.appendChild(s); });
}
function pdfFromJpegs(pages){                 // pages: [{bytes:Uint8Array (JPEG), w, h}] → A4 portrait PDF Blob
  const enc=new TextEncoder(), parts=[], offs=[]; let len=0;
  const put=x=>{ const b=typeof x==="string"?enc.encode(x):x; parts.push(b); len+=b.length; };
  const obj=(n,body,stream)=>{ offs[n]=len; put(n+" 0 obj\n"+body); if(stream){ put("\nstream\n"); put(stream); put("\nendstream"); } put("\nendobj\n"); };
  const W=595.28, H=841.89, n=pages.length;
  put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1,"<< /Type /Catalog /Pages 2 0 R >>");
  obj(2,"<< /Type /Pages /Count "+n+" /Kids ["+pages.map((p,i)=>(3+i*3)+" 0 R").join(" ")+"] >>");
  pages.forEach((p,i)=>{
    const po=3+i*3, co=po+1, io=po+2, cs="q "+W+" 0 0 "+H+" 0 0 cm /Im0 Do Q";
    obj(po,"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+W+" "+H+"] /Resources << /XObject << /Im0 "+io+" 0 R >> >> /Contents "+co+" 0 R >>");
    obj(co,"<< /Length "+cs.length+" >>",cs);
    obj(io,"<< /Type /XObject /Subtype /Image /Width "+p.w+" /Height "+p.h+" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+p.bytes.length+" >>",p.bytes);
  });
  const xref=len, total=3+n*3;
  let x="xref\n0 "+total+"\n0000000000 65535 f \n";
  for(let i=1;i<total;i++) x+=String(offs[i]).padStart(10,"0")+" 00000 n \n";
  put(x+"trailer\n<< /Size "+total+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF");
  return new Blob(parts,{type:"application/pdf"});
}
async function buildPdf(S){
  await loadH2C();
  try{ await document.fonts.ready; }catch(e){}
  const title=appTitle(), made=new Date().toLocaleString("he-IL",{dateStyle:"short",timeStyle:"short"});
  const host=mk("div","rp-host"); document.body.appendChild(host);
  const pages=[]; let body;
  const newPage=()=>{
    const pg=mk("div","rp-page"); host.appendChild(pg); pages.push(pg);
    const hd=mk("div","rp-head"), tx=mk("div","rp-tx"), lg=mk("img","rp-logo");
    lg.src="icons/logo-header.png"; lg.alt="";
    tx.append(mk("div","rp-title",title), mk("div","rp-range","סיכום אירועים · "+S.range));
    hd.append(tx,lg);
    pg.appendChild(hd);
    body=mk("div","rp-body"); pg.appendChild(body);
    pg.appendChild(mk("div","rp-foot"));
    return pg;
  };
  const fits=()=>body.scrollHeight<=body.clientHeight;
  const place=el=>{ body.appendChild(el); if(!fits() && body.childElementCount>1){ el.remove(); newPage(); body.appendChild(el); } };
  newPage();
  const k=mk("div","rp-kpis");
  S.nums.forEach(([l,v],i)=>{ const b=mk("div","rp-kpi"+(i===1||i===4?" f":"")); b.append(mk("b",null,nf(v)),mk("span",null,l)); k.appendChild(b); });
  place(k);
  if(S.types.length) place(mk("p","rp-types","לפי סוג: "+S.types.map(([t,n])=>t+" "+n).join(" · ")));
  const table=(caption,rows)=>{
    const cols=["תאריך","סוג","אירוע","מיקום / ציוד","מעורבים","סטטוס"];
    const start=cont=>{ const t=mk("table","rp-t"), tr=mk("tr"); cols.forEach(c=>tr.appendChild(mk("th",null,c)));
      t.appendChild(tr); const w=mk("div","rp-sec"); w.append(mk("h3",null,caption+(cont?" (המשך)":" ("+rows.length+")")),t); return w; };
    let sec=start(false); place(sec); let t=sec.querySelector("table");
    if(!rows.length){ const tr=mk("tr"), td=mk("td","rp-none","אין אירועים"); td.colSpan=6; tr.appendChild(td); t.appendChild(tr); return; }
    rows.forEach(e=>{
      const tr=mk("tr");
      tr.appendChild(mk("td","nw",fmtWhen(e.when)));
      tr.appendChild(mk("td",null,(e.type||[]).join(", ")));
      const ev=mk("td"); if(e.title) ev.appendChild(mk("b",null,e.title));
      if(e.desc) ev.appendChild(mk("div","rp-d",String(e.desc).slice(0,400)));
      if(e.act) ev.appendChild(mk("div","rp-d","פעולה: "+String(e.act).slice(0,300)));
      tr.appendChild(ev);
      tr.appendChild(mk("td",null,(e.loc||[]).concat(e.eq||[]).join(", ")));
      tr.appendChild(mk("td",null,(e.ppl||[]).join(", ")));
      tr.appendChild(mk("td",isOpen(e)?"rp-open":"rp-closed",isOpen(e)?"פתוח":"נסגר"));
      t.appendChild(tr);
      if(!fits()){ tr.remove(); newPage(); sec=start(true); body.appendChild(sec); t=sec.querySelector("table"); t.appendChild(tr); }
    });
  };
  table("אירועים בטווח",S.rows);
  table("תקלות פתוחות (כל התקופה)",S.openF);
  pages.forEach((pg,i)=>{ pg.querySelector(".rp-foot").textContent="עמוד "+(i+1)+" מתוך "+pages.length+" · הופק "+made; });
  const out=[];
  await Promise.all([...host.querySelectorAll("img")].map(im=>im.decode().catch(()=>{})));
  try{
    for(const pg of pages){
      const c=await html2canvas(pg,{scale:2,backgroundColor:"#ffffff",logging:false});
      const bin=atob(c.toDataURL("image/jpeg",.86).split(",")[1]), u=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
      out.push({bytes:u,w:c.width,h:c.height});
    }
  } finally { host.remove(); }
  return new File([pdfFromJpegs(out)],"סיכום-אירועים-"+S.from+"-עד-"+S.to+".pdf",{type:"application/pdf"});
}
function saveBlob(file){
  const url=URL.createObjectURL(file), a=document.createElement("a");
  a.href=url; a.download=file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}
const canShareFile=f=>{ try{ return !!(navigator.canShare && navigator.canShare({files:[f]})); }catch(e){ return false; } };
async function shareOrSave(f,title,text){      // true when done; false when the person cancelled the share sheet
  if(canShareFile(f)){
    try{ await navigator.share({files:[f],title,text}); return true; }
    catch(e){ if(e && e.name==="AbortError") return false; }
  }
  saveBlob(f); return true;
}

/* ---- the window ---- */
function wkPaintSum(){
  const S=wkState.sum=rangeSummary($("#wkFrom").value,$("#wkTo").value), box=$("#wkSum");
  box.innerHTML="";
  const nums=mk("div");
  S.nums.forEach(([l,v],k)=>{ if(k) nums.append(" · "); nums.append(l+" ",mk("b",null,nf(v))); });
  box.appendChild(nums);
  if(S.types.length) box.appendChild(mk("div",null,"לפי סוג: "+S.types.map(([t,n])=>t+" "+n).join(" · ")));
  wkMakePdf();
}
async function wkMakePdf(){                     // prepared ahead, so the share sheet opens right on the tap
  const S=wkState.sum, btn=$("#wkPdf"), my=wkState.pdfJob={};
  wkState.pdf=null; btn.disabled=true; $("#wkPdfShare").hidden=true; btn.textContent="מכין PDF…";
  if(S.from>S.to){ btn.textContent="טווח תאריכים לא תקין"; return; }
  try{
    const f=await buildPdf(S);
    if(!wkState || wkState.pdfJob!==my) return;
    wkState.pdf=f; btn.disabled=false; btn.textContent="שלח במייל";
    $("#wkPdfShare").hidden=!canShareFile(f); $("#wkShareHint").hidden=$("#wkPdfShare").hidden;
  }catch(e){ if(wkState && wkState.pdfJob===my) btn.textContent="יצירת ה-PDF נכשלה"; }
}
function openWeekly(manual){
  const d=$("#dlgWeek"); if(d.open) return;
  wkState={s1:false,s2:false,manual:!!manual};
  const t=new Date(), f=new Date(); f.setDate(f.getDate()-6);
  $("#wkFrom").value=ymd(f); $("#wkTo").value=ymd(t);
  $("#wkBkShare").hidden=!canShareFile(new File(["{}"],"x.json",{type:"application/json"}));
  try{ $("#wkMailTo").value=localStorage.getItem(K_WEEK_TO)||""; }catch(e){}
  $("#wkIntro").hidden=!!manual; $("#wkClose").hidden=!manual; $("#wkSnz").hidden=!!manual;
  wkPaint(); d.showModal(); wkPaintSum();
}
function wkPaint(){
  $("#wkS1").classList.toggle("done",wkState.s1); $("#wkS2").classList.toggle("done",wkState.s2);
  $("#wkDone").disabled=!(wkState.s1&&wkState.s2);
}
$("#wkFrom").onchange=$("#wkTo").onchange=()=>{ if(wkState) wkPaintSum(); };
/* "שלח במייל": the file is saved to the device and a ready mail opens (a mail link can't carry an attachment).
   "שתף": the share sheet, with the file already attached (phones, and Chrome/Edge on Windows). */
function wkMail(subject, body){
  const to=$("#wkMailTo").value.trim();
  try{ localStorage.setItem(K_WEEK_TO,to); }catch(e){}
  const addr=to.split(/[,;\s]+/).filter(Boolean).map(encodeURIComponent).join(",").replace(/%40/g,"@");
  setTimeout(()=>{ location.href="mailto:"+addr+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body); },350);
}
function wkPdfText(){
  const S=wkState.sum;
  let t=appTitle()+"\nסיכום אירועים "+S.range+"\n\n"+S.nums.map(([l,v])=>l+": "+v).join("\n");
  if(S.types.length) t+="\n\nלפי סוג: "+S.types.map(([x,n])=>x+" "+n).join(" · ");
  return t;
}
$("#wkPdf").onclick=()=>{
  const f=wkState && wkState.pdf; if(!f) return;
  saveBlob(f);
  wkMail(appTitle()+" — סיכום אירועים "+wkState.sum.range, wkPdfText()+"\n\nמצורף הדוח המלא: "+f.name);
  toast("ה-PDF ירד — צרף אותו למייל שנפתח");
  wkState.s1=true; wkPaint();
};
$("#wkPdfShare").onclick=async()=>{
  const f=wkState && wkState.pdf; if(!f) return;
  if(await shareOrSave(f, appTitle()+" — סיכום אירועים "+wkState.sum.range, wkPdfText())){ wkState.s1=true; wkPaint(); }
  else toast("השליחה בוטלה");
};
const backupFile=()=>new File([JSON.stringify(payload(),null,1)],"גיבוי-יומן-"+ymd(new Date())+".json",{type:"application/json"});
$("#wkBackup").onclick=()=>{
  const f=backupFile(); saveBlob(f);
  wkMail("גיבוי "+appTitle()+" — "+dmy(ymd(new Date())),
    "גיבוי מלא של היומן ("+events.length+" אירועים).\nמצורף הקובץ: "+f.name+"\n\nלשחזור: באפליקציה ← הגדרות ← קבצים וגיבוי ← טען גיבוי.");
  toast("הגיבוי ירד — צרף אותו למייל שנפתח");
  wkState.s2=true; wkPaint();
};
$("#wkBkShare").onclick=async()=>{
  if(await shareOrSave(backupFile(),"גיבוי "+appTitle(),"גיבוי מלא של היומן ("+events.length+" אירועים).")){ wkState.s2=true; wkPaint(); }
  else toast("השליחה בוטלה");
};
$("#wkDone").onclick=()=>{
  if(!(wkState.s1&&wkState.s2)) return;
  try{ localStorage.setItem(K_WEEK,String(Date.now())); }catch(e){}
  wkState.closing=true; $("#dlgWeek").close(); wkLast(); toast("הסיכום והגיבוי השבועיים בוצעו");
};
$("#wkClose").onclick=()=>{ wkState.closing=true; $("#dlgWeek").close(); };
// ⏰ snooze: close the due window now, it comes back at the time picked (on this device)
document.querySelectorAll("#wkSnz [data-snz]").forEach(b=>b.onclick=()=>{
  const v=b.dataset.snz, m=new Date(Date.now()+864e5); m.setHours(8,0,0,0);
  const at = v==="m" ? m.getTime() : Date.now()+(+v)*3600e3;
  try{ localStorage.setItem(K_WEEK_SNZ,String(at)); }catch(e){}
  wkState.closing=true; $("#dlgWeek").close();
  toast("⏰ אזכיר "+(v==="m" ? "מחר ב-08:00" : v==="1" ? "בעוד שעה" : "בעוד 3 שעות"));
});
$("#dlgWeek").addEventListener("cancel",e=>{ if(!wkState.manual) e.preventDefault(); });
$("#dlgWeek").addEventListener("close",()=>{            // Escape pressed twice etc.: a due window comes straight back
  if(wkState && !wkState.closing && !wkState.manual) setTimeout(()=>$("#dlgWeek").showModal(),0);
  else wkState=null;
});
$("#wkOpen").onclick=()=>openWeekly(true);
function wkLast(){
  const t=weekDone();
  $("#wkLast").textContent = t ? "בוצע לאחרונה: "+new Date(t).toLocaleDateString("he-IL")+" · החלון נפתח לבד בכל יום ראשון"
                               : "החלון נפתח לבד בכל יום ראשון עד שמבצעים את שני השלבים.";
}
function weeklyCheck(){ if(TV) return;
  if(isLite()) return;                                  // the weekly summary + backup is done on a computer
  if($("#dlgWeek").open || !$("#splash").hidden || !events.length) return;
  if(CLOUD_ON){
    let role=null; try{ role=localStorage.getItem("ogg-cloud-role"); }catch(e){}
    if(!window.CLOUD_READY || role!=="admin") return;
  }
  if(weekDone()>=weekStart(new Date())) return;
  try{ if(+localStorage.getItem(K_WEEK_SNZ)>Date.now()) return; }catch(e){}
  openWeekly(false);
}
window.weeklyCheck=weeklyCheck;
setInterval(weeklyCheck,5*60e3);

/* ================= security check (🔒) =================
   Managers (and everyone in local mode): a check of how safe the data is — the live security rules in the cloud
   (cloud.js probes them without writing anything), the team and its roles, the last backup and this device.
   Runs from settings, and once a day by itself (a toast only when something needs attention). Kept on this
   device only (ogg-sec-last), and removed on logout. */
const K_SEC="ogg-sec-last", K_SEC_AUTO="ogg-sec-auto";
const SEC_ICON={bad:"⛔",warn:"⚠️",ok:"✅",info:"ℹ️"}, SEC_RANK={bad:0,warn:1,ok:2,info:3};
let secRunning=false;
function secLast(){ try{ const x=JSON.parse(localStorage.getItem(K_SEC)||"null"); return x && Array.isArray(x.items) ? x : null; }catch(e){ return null; } }
function secAutoOn(){ try{ return localStorage.getItem(K_SEC_AUTO)!=="0"; }catch(e){ return true; } }
async function secDevice(){
  const out=[], add=(g,s,t,d,fix)=>out.push({g,s,t,d:d||"",fix:fix||""});
  const G3="המכשיר והאפליקציה", G4="גיבוי", G5="לבדוק ידנית במסוף (אי אפשר לבדוק מהאפליקציה)", DAY=864e5;
  const local=/^(localhost|127\.)/.test(location.hostname);
  if(location.protocol==="https:") add(G3,"ok","חיבור מוצפן (HTTPS)","כל מה שעובר בין המכשיר לאתר ולענן מוצפן.");
  else add(G3, local?"info":"bad", local?"פועל מהמחשב המקומי (פיתוח)":"החיבור לא מוצפן", local?"":"האתר נפתח ב-http.", local?"":"לפתוח את היומן רק בכתובת https://");
  const v=await latestVersion();
  if(v && newer(v,APP_VER)) add(G3,"warn","יש גרסה חדשה יותר ("+v+")","במכשיר הזה רצה גרסה "+APP_VER+".","הגדרות ← כללי ← גרסה ← בדוק עדכון.");
  else if(v) add(G3,"ok","האפליקציה מעודכנת","גרסה "+APP_VER+".");
  else add(G3,"info","לא הצלחתי לבדוק עדכון","אין חיבור לאתר. במכשיר רצה גרסה "+APP_VER+".");
  if(CLOUD_ON) add(G3,"info","עותק של היומן שמור במכשיר","כדי לעבוד גם בלי אינטרנט. הוא לא מוצפן — מי שפותח את הדפדפן במכשיר הזה יכול לראות אותו. בהתנתקות הוא נמחק.","במכשיר משותף — להתנתק בסוף העבודה (הגדרות ← צוות וחשבון ← התנתק).");
  else add(G3,"warn","היומן שמור רק בדפדפן הזה","המידע לא מוצפן ולא נמצא בשום מקום אחר — אם הדפדפן יימחק, הוא יאבד.","לחבר קובץ ב-OneDrive (הגדרות ← קבצים וגיבוי) ולהוריד גיבוי באופן קבוע. לא להשאיר את המכשיר פתוח לאחרים.");
  try{ if(navigator.storage && navigator.storage.persisted){ const p=await navigator.storage.persisted();
    if(p) add(G3,"ok","הדפדפן לא ימחק את המידע לבד","האחסון במכשיר מסומן כקבוע.");
    else add(G3, CLOUD_ON?"info":"warn","הדפדפן עלול למחוק את המידע כשחסר מקום", CLOUD_ON?"העותק שבמכשיר יורד מחדש מהענן אם יימחק.":"", "להתקין את האפליקציה למסך הבית — אז האחסון נשמר."); } }catch(e){}
  try{ if(navigator.storage && navigator.storage.estimate){ const e=await navigator.storage.estimate();
    if(e && e.usage!=null) add(G3,"info","נפח בשימוש במכשיר", (e.usage/1048576).toFixed(1)+" MB"+(e.quota?" מתוך "+Math.round(e.quota/1048576).toLocaleString("he-IL")+" MB אפשריים":"")+"."); } }catch(e){}
  const wd=weekDone(), age=wd ? Math.floor((Date.now()-wd)/DAY) : null;
  if(age===null) add(G4,"warn","עוד לא בוצע גיבוי שבועי במכשיר הזה","","הגדרות ← קבצים וגיבוי ← סיכום וגיבוי שבועי.");
  else if(age<=8) add(G4,"ok","הגיבוי השבועי בוצע","לפני "+(age? age+" ימים":"פחות מיום")+" ("+new Date(wd).toLocaleDateString("he-IL")+").");
  else add(G4,"warn","הגיבוי השבועי האחרון לפני "+age+" ימים", new Date(wd).toLocaleDateString("he-IL")+".","הגדרות ← קבצים וגיבוי ← סיכום וגיבוי שבועי.");
  add(G4,"info","קובצי גיבוי ו-PDF מכילים שמות ורישומים אמיתיים","מה שהורד או נשלח במייל כבר מחוץ לאפליקציה.","לשמור אותם במקום מוגן, לא בתיקיית ההורדות של מחשב משותף.");
  if(!CLOUD_ON) add(G4, fileHandle?"ok":"warn", fileHandle?"מחובר קובץ גיבוי":"אין קובץ גיבוי מחובר", fileHandle?"כל שמירה נכתבת גם לקובץ "+(fileHandle.name||"")+".":"", fileHandle?"":"הגדרות ← קבצים וגיבוי ← חבר קובץ.");
  if(CLOUD_ON){
    add(G5,"info","Authentication ← Settings ← Authorized domains","צריכות להיות רק: כתובת האתר של היומן, ה-firebaseapp.com וה-web.app של הפרויקט (ו-localhost אם מפתחים במחשב).");
    add(G5,"info","Authentication ← Users","לעבור על הרשימה ולמחוק מיילים לא מוכרים (הם לא יכולים לראות כלום בלי להיות בצוות, אבל אין סיבה שיישארו).");
    add(G5,"info","Firestore ← Disaster recovery","מומלץ להפעיל Point-in-time recovery או גיבוי יומי מתוזמן — כדי שאפשר יהיה לשחזר רישום שנערך או נמחק בטעות.");
  }
  return out;
}
async function secRun(silent){
  if(secRunning) return null; secRunning=true;
  const b=$("#secRun"), b2=$("#secAgain"); [b,b2].forEach(x=>{ if(x){ x.disabled=true; x.dataset.t=x.dataset.t||x.textContent; x.textContent="בודק…"; } });
  let items=[];
  try{
    if(CLOUD_ON){ if(window.cloudSecCheck) items=items.concat(await window.cloudSecCheck());
                  else items.push({g:"הענן וכללי האבטחה",s:"warn",t:"החיבור ליומן המשותף עוד לא מוכן",d:"",fix:"לנסות שוב בעוד רגע."}); }
    items=items.concat(await secDevice());
  }catch(e){ items.push({g:"הבדיקה",s:"warn",t:"הבדיקה נעצרה באמצע",d:String(e&&e.message||e),fix:"להריץ שוב."}); }
  finally{ secRunning=false; [b,b2].forEach(x=>{ if(x){ x.disabled=false; x.textContent=x.dataset.t; } }); }
  const res={at:Date.now(), ver:APP_VER, items};
  try{ localStorage.setItem(K_SEC,JSON.stringify(res)); }catch(e){}
  secPaint();
  if($("#dlgSec").open) secFill(res);
  const n=items.filter(x=>x.s==="bad"||x.s==="warn").length, bad=items.some(x=>x.s==="bad");
  if(silent){ if(n) toast((bad?"⛔ ":"⚠️ ")+"בדיקת האבטחה היומית: "+n+" דברים לטפל בהם",{label:"לדוח",fn:secOpen}); }
  else toast(n ? "הבדיקה הסתיימה — "+n+" דברים לטפל בהם" : "הבדיקה הסתיימה — הכול תקין ✅");
  return res;
}
function secCounts(items){ const c={bad:0,warn:0,ok:0,info:0}; items.forEach(x=>{ c[x.s]=(c[x.s]||0)+1; }); return c; }
function secGroups(items){ const g=[]; items.forEach(x=>{ let e=g.find(y=>y.name===x.g); if(!e) g.push(e={name:x.g,items:[]}); e.items.push(x); });
  g.forEach(e=>e.items.sort((a,b)=>SEC_RANK[a.s]-SEC_RANK[b.s])); return g; }
function secSumText(r){ const c=secCounts(r.items);
  return (c.bad?"⛔ "+c.bad+" בעיות · ":"")+(c.warn?"⚠️ "+c.warn+" אזהרות · ":"")+"✅ "+c.ok+" תקין"; }
function secPaint(){
  const r=secLast(), sum=$("#secSum");
  $("#secAuto").checked=secAutoOn();
  $("#secShow").hidden=$("#secDl").hidden=!r;
  const c=r ? secCounts(r.items) : null;
  $("#secDot").hidden=!(c && (c.bad||c.warn));
  sum.textContent=""; sum.className="sec-sum"+(c ? (c.bad?" s-bad":c.warn?" s-warn":" s-ok") : "");
  if(!r){ sum.textContent="עוד לא הורצה בדיקה במכשיר הזה."; return; }
  sum.appendChild(mk("b",null,secSumText(r)));
  sum.appendChild(mk("span",null,"בדיקה אחרונה: "+new Date(r.at).toLocaleString("he-IL",{dateStyle:"short",timeStyle:"short"})));
}
function secFill(r){
  $("#secWhen").textContent=new Date(r.at).toLocaleString("he-IL",{dateStyle:"full",timeStyle:"short"})+" · "+secSumText(r);
  const box=$("#secList"); box.textContent="";
  secGroups(r.items).forEach(g=>{
    box.appendChild(mk("h4","sec-g",g.name));
    g.items.forEach(x=>{
      const it=mk("div","sec-it s-"+x.s); it.appendChild(mk("span","sec-i",SEC_ICON[x.s]||""));
      const b=mk("div","sec-b"); b.appendChild(mk("b",null,x.t)); if(x.d) b.appendChild(mk("span","sec-d",x.d));
      if(x.fix) b.appendChild(mk("span","sec-fix","מה לעשות: "+x.fix));
      it.appendChild(b); box.appendChild(it);
    });
  });
}
function secOpen(){ const r=secLast(); if(!r){ secRun(false).then(x=>{ if(x) secOpen(); }); return; } secFill(r); if(!$("#dlgSec").open) $("#dlgSec").showModal(); }
function secReport(){
  const r=secLast(); if(!r) return;
  const e=v=>String(v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const col={bad:"#B8352F",warn:"#8F5A06",ok:"#1C7A46",info:"#4A5A6A"};
  const d=new Date(r.at), day=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  const rows=secGroups(r.items).map(g=>"<h2>"+e(g.name)+"</h2>"+g.items.map(x=>
    '<div class="it" style="border-inline-start-color:'+col[x.s]+'"><b>'+(SEC_ICON[x.s]||"")+" "+e(x.t)+"</b>"+(x.d?"<p>"+e(x.d)+"</p>":"")+(x.fix?'<p class="fx">מה לעשות: '+e(x.fix)+"</p>":"")+"</div>").join("")).join("");
  const html='<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>דוח אבטחה '+day+'</title>'
    +'<style>body{font-family:system-ui,Arial,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#16202A;background:#fff}h1{font-size:22px;margin:0 0 4px}'
    +'.m{color:#566877;margin:0 0 18px}h2{font-size:16px;margin:22px 0 8px;border-bottom:1px solid #DCE3E8;padding-bottom:4px}'
    +'.it{border:1px solid #DCE3E8;border-inline-start:5px solid;border-radius:8px;padding:8px 12px;margin:0 0 8px;break-inside:avoid}'
    +'.it p{margin:4px 0 0;color:#566877;overflow-wrap:anywhere}.it .fx{color:#16202A}</style></head><body>'
    +'<h1>🔒 דוח אבטחה — יומן אירועים ומשימות</h1><p class="m">'+e(d.toLocaleString("he-IL",{dateStyle:"full",timeStyle:"short"}))+" · גרסה "+e(r.ver||APP_VER)+" · "+e(secSumText(r))+"</p>"
    +rows+'<p class="m" style="margin-top:24px">הדוח מכיל שמות ומיילים של הצוות — לשמור במקום מוגן.</p></body></html>';
  download("דוח-אבטחה-"+day+".html",html,"text/html");
}
function secDaily(){
  if(TV || !isManager() || !secAutoOn() || secRunning) return;
  if(CLOUD_ON && !window.CLOUD_READY) return;
  const r=secLast(); if(r && Date.now()-r.at<864e5) return;
  secRun(true);
}
window.secDaily=secDaily;
$("#secRun").onclick=()=>secRun(false);
$("#secAgain").onclick=()=>secRun(false);
$("#secShow").onclick=secOpen;
$("#secDl").onclick=$("#secDl2").onclick=secReport;
$("#secClose").onclick=()=>$("#dlgSec").close();
$("#secAuto").onchange=()=>{ try{ localStorage.setItem(K_SEC_AUTO,$("#secAuto").checked?"1":"0"); }catch(e){} };
secPaint();
if(!CLOUD_ON) Promise.resolve(window.bigReady).catch(()=>{}).then(()=>setTimeout(secDaily,8000));
setInterval(secDaily,60*60e3);
document.addEventListener("visibilitychange",()=>{ if(!document.hidden) setTimeout(weeklyCheck,800); });
wkLast();

// a CSV cell: quoted, and a value that starts like a formula (= + - @) gets a leading ' so Excel shows it as text instead of running it
function csvEsc(v){ let s=String(v==null?"":v); if(/^[=+\-@\t\r]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; }
function exportCsv(rows, filtered){
  rows = rows && rows.length ? rows : events;
  const head=["מס'","תאריך","סוג","כותרת","מיקום","ציוד","תיאור אירוע","פעולה שננקטה","מעורבים","סטטוס","נסגר על ידי","מקור"];
  const esc=csvEsc;
  const body=rows.map(e=>[e.no||"",fmtWhen(e.when),(e.type||[]).join("; "),e.title||"",(e.loc||[]).join("; "),
    (e.eq||[]).join("; "),e.desc,e.act,(e.ppl||[]).join("; "),(e.stat||[]).join("; "),e.closedBy||"",
    e.src||"רישום ידני"].map(esc).join(","));
  download((filtered?"יומן-מסונן-":"יומן-אירועים-")+"אוג.csv",
    [head.map(esc).join(",")].concat(body).join("\r\n"),"text/csv;charset=utf-8");
  toast(rows.length+" שורות הורדו");
}
$("#expCsv").onclick=()=>exportCsv(events,false);
$("#impBtn").onclick=()=>$("#impFile").click();
$("#fixBtn").onclick=()=>$("#fixFile").click();
$("#fixFile").onchange=ev=>{
  const f=ev.target.files[0]; if(!f) return; const r=new FileReader();
  r.onload=()=>{ try{ const d=JSON.parse(r.result); const fx=Array.isArray(d)?d:d.fixes;
      if(!Array.isArray(fx) || !fx.every(x=>x && x.from && x.to)) throw 0; openFixes(fx); }
    catch(e){ toast("זה לא קובץ תיקונים"); } };
  r.readAsText(f); ev.target.value="";
};
$("#impFile").onchange=ev=>{
  const f=ev.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const d=JSON.parse(r.result), inc=Array.isArray(d)?d:(d.events||[]);
      if(!Array.isArray(inc)) throw 0;
      const idx=new Map(events.map((e,i)=>[e.id,i])); let n=0,u=0;
      inc.forEach(e=>{ if(!e||!e.id) return;
        if(idx.has(e.id)){ events[idx.get(e.id)]=e; u++; } else { events.push(e); n++; } });
      if(d.lists && d.lists._dept_ppl && typeof d.lists._dept_ppl==="object") Object.entries(d.lists._dept_ppl).forEach(([p,r])=>{ if(!lists._dept_ppl[p]) lists._dept_ppl[p]=r; });
      if(d.lists && d.lists._roles_ppl && typeof d.lists._roles_ppl==="object") Object.entries(d.lists._roles_ppl).forEach(([p,r])=>{ if(!lists._roles_ppl[p]) lists._roles_ppl[p]=r; });
      if(d.lists && Array.isArray(d.lists._core_ppl)) d.lists._core_ppl.forEach(v=>{ if(!lists._core_ppl.includes(v)) lists._core_ppl.push(v); });
      if(d.lists) Object.keys(SEED).forEach(k=>{
        (d.lists[k]||[]).forEach(v=>{ if(!lists["_custom_"+k].includes(v)){ lists["_custom_"+k].push(v);
          if(!lists[k].includes(v)) lists[k].push(v); } });
      });
      let tn=0;
      if(Array.isArray(d.tasks)){ const ti=new Map(tasks.map((t,i)=>[t.id,i]));
        d.tasks.forEach(t=>{ if(!t||!t.id) return; if(ti.has(t.id)) tasks[ti.get(t.id)]=t; else { tasks.push(t); tn++; } }); saveTasks(); }
      events.sort((a,b)=>(b.when||"").localeCompare(a.when||""));
      persist(); load(); renderAll(); toast(n+" נוספו, "+u+" עודכנו"+(tn?", "+tn+" משימות":""));
    }catch(e){ toast("הקובץ לא בפורמט הנכון"); }
  };
  r.readAsText(f); ev.target.value="";
};
$("#wipe").onclick=async()=>{
  const mine=events.filter(e=>!isLocked(e)).length, arch=events.length-mine;
  if(!mine){ toast("אין רישומים שלך למחיקה"); return; }
  if(!await confirmDel("למחוק את הרישומים שלך?", mine+" רישומים יימחקו. "+arch+" אירועי ארכיון יישארו.", true)) return;
  events=events.filter(e=>isLocked(e)); persist(); renderAll(); toast(mine+" רישומים נמחקו");
};
$("#wipeAll").onclick=async()=>{
  if(!await confirmDel("למחוק את כל היומן?", "כל "+events.length+" האירועים יימחקו, כולל הארכיון.", true)) return;
  events=[]; persist(); renderAll(); toast("היומן רוקן");
};

/* ================= version ================= */
const APP_VER="3.48", APP_DATE="22/10/2026";
$("#verChip").textContent = BETA && LITE_MQ.matches ? "בטא "+APP_VER : "v"+APP_VER+(BETA?" · בטא":""); if(BETA){ $("#verChip").classList.add("beta"); document.title="בטא · "+document.title; }
$("#verLine").textContent="גרסה "+APP_VER+" · "+APP_DATE;
async function refreshApp(){
  const cur=["Dash","New","List","Data","Tasks","Cal"].find(v=>!$("#view"+v).hidden)||"Dash";
  try{ sessionStorage.setItem("ogg-refresh",cur); }catch(e){}
  try{ const r=navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if(r) await r.update(); }catch(e){}
  location.reload();
}
/* update check: version.txt on the site says what the latest version is. When it is newer than this copy,
   a banner offers "עדכן עכשיו": clear the saved app files (not the data) and load fresh. */
async function latestVersion(){
  try{ const r=await fetch("version.txt?t="+Date.now(),{cache:"no-store"}); if(!r.ok) return null;
    const v=(await r.text()).trim(); return /^\d+(\.\d+)+$/.test(v) ? v : null; }catch(e){ return null; }
}
const newer=(a,b)=>{ const x=a.split(".").map(Number), y=b.split(".").map(Number);
  for(let i=0;i<Math.max(x.length,y.length);i++){ if((x[i]||0)!==(y[i]||0)) return (x[i]||0)>(y[i]||0); } return false; };
/* "i" in the header — what changed in each version. The list is the version table in README.md (every version adds a row
   there), read when the window opens; the service worker keeps the last copy for offline. A version not seen yet on this
   device lights a dot on "i" and, after an update, a toast offers to show what's new. */
const K_SEENVER="ogg-seen-ver";
let seenVer=""; try{ seenVer=localStorage.getItem(K_SEENVER)||""; }catch(e){}
const newsSeen=v=>seenVer ? !newer(v,seenVer) : v!==APP_VER;   // first time: only this version counts as new
async function newsRows(){
  const r=await fetch("README.md?v="+APP_VER); if(!r.ok) throw new Error(r.status);
  const out=[];
  (await r.text()).split("\n").forEach(l=>{ const m=l.match(/^\|\s*(\d+(?:\.\d+)+)\s*\|\s*([\d/]+)\s*\|\s*(.*?)\s*\|\s*$/);
    if(m) out.push({v:m[1], d:m[2], t:m[3].replace(/\*\*|`/g,"").replace(/\\\|/g,"|")}); });
  return out.filter(x=>!newer(x.v,APP_VER)).sort((a,b)=>newer(a.v,b.v)?-1:newer(b.v,a.v)?1:0);
}
let newsAll=false;
async function openNews(){
  const d=$("#dlgNews"), box=$("#newsList");
  $("#newsTitle").textContent="מה חדש · גרסה "+APP_VER;
  box.textContent=""; box.appendChild(mk("p","news-empty","טוען…"));
  $("#newsMore").hidden=true;
  if(!d.open) d.showModal();
  let rows=[]; try{ rows=await newsRows(); }catch(e){}
  box.textContent="";
  if(!rows.length){ box.appendChild(mk("p","news-empty","לא הצלחתי לטעון את רשימת השינויים — צריך רשת בפעם הראשונה.")); }
  const show=newsAll ? rows : rows.slice(0, Math.max(5, rows.filter(x=>!newsSeen(x.v)).length));
  show.forEach(x=>{
    const it=mk("div","news-it"+(x.v===APP_VER?" cur":"")+(newsSeen(x.v)?"":" new"));
    const h=mk("div","news-h"); h.appendChild(mk("b",null,"גרסה "+x.v)); h.appendChild(mk("span",null,x.d));
    if(x.v===APP_VER) h.appendChild(mk("span","news-tag","הגרסה שלך")); else if(!newsSeen(x.v)) h.appendChild(mk("span","news-tag","חדש"));
    it.append(h, mk("div","news-t",x.t)); box.appendChild(it);
  });
  $("#newsMore").hidden=newsAll || show.length>=rows.length;
  seenVer=APP_VER; try{ localStorage.setItem(K_SEENVER,APP_VER); }catch(e){}
  $("#infoDot").hidden=true;
}
$("#infoBtn").onclick=()=>{ newsAll=false; openNews(); };
$("#newsMore").onclick=()=>{ newsAll=true; openNews(); };
$("#newsClose").onclick=()=>$("#dlgNews").close();
$("#infoDot").hidden=seenVer===APP_VER;
// after an update (this device already knew an older version): say so once, with a way to see what changed
if(seenVer && newer(APP_VER,seenVer)) setTimeout(()=>toast("עודכן לגרסה "+APP_VER,{label:"מה חדש?", fn:()=>{ newsAll=false; openNews(); }}),2500);
async function hardUpdate(){
  const cur=["Dash","New","List","Data","Tasks","Cal"].find(v=>!$("#view"+v).hidden)||"Dash";
  try{ sessionStorage.setItem("ogg-refresh",cur); }catch(e){}
  try{ const ks=await caches.keys(), pf=BETA?"ogg-beta-":"ogg-log-"; await Promise.all(ks.filter(k=>k.startsWith(pf)).map(k=>caches.delete(k))); }catch(e){}
  // update the service worker in place — not unregister: that would drop this phone's push subscription
  try{ const rs=await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r=>r.update())); }catch(e){}
  location.replace(location.pathname+"?app=ogg-log-2&u="+Date.now());
}
/* automatic update: a newer version on the site loads by itself — at a moment nothing is being written
   (no open window, no event/task form, nothing typed in the last 2 minutes); otherwise the banner waits and it
   tries again shortly. Once per version: if the site still serves the old files (its cache), the banner stays. */
let lastTyping=0;
document.addEventListener("input",()=>{ lastTyping=Date.now(); },true);
function quietNow(){
  if(Date.now()-lastTyping<2*60e3) return false;
  if(document.querySelector("dialog[open]")) return false;
  const a=document.activeElement; if(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type!=="checkbox") return false;
  if(!$("#viewNew").hidden) return false;                      // recording / editing an event
  const tf=$("#tfPanel"); if(tf && !tf.hidden) return false;    // the task form is open
  return true;
}
let autoT=null;
function autoUpdate(v){
  let tried=""; try{ tried=localStorage.getItem("ogg-auto-upd")||""; }catch(e){}
  if(tried===v) return;                                        // already reloaded once for this version
  if(!quietNow()){ clearTimeout(autoT); autoT=setTimeout(()=>autoUpdate(v),30e3); return; }
  try{ localStorage.setItem("ogg-auto-upd",v); }catch(e){}
  hardUpdate();
}
async function checkUpdate(){
  const v=await latestVersion(); const bar=$("#updBar");
  if(v && newer(v,APP_VER)){ $("#updTxt").textContent="גרסה חדשה "+v+" זמינה (יש לך "+APP_VER+")"; bar.hidden=false; }   // no automatic reload: the banner "עדכן עכשיו" waits for the user
  else bar.hidden=true;
  return v;
}
$("#updGo").onclick=hardUpdate;
setTimeout(checkUpdate,2500); setInterval(checkUpdate,5*60e3);
document.addEventListener("visibilitychange",()=>{ if(!document.hidden) checkUpdate(); });
$("#reloadApp").onclick=async()=>{ const v=await checkUpdate(); if(v && newer(v,APP_VER)) hardUpdate(); else { toast("יש לך את הגרסה העדכנית ("+APP_VER+")"); } };
$("#refreshBtn").onclick=async()=>{ $("#refreshBtn").classList.add("spin");
  const v=await latestVersion(); if(v && newer(v,APP_VER)) hardUpdate(); else refreshApp(); };

/* ================= clock: day, date, time in the header ================= */
(function(){
  const p=n=>String(n).padStart(2,"0");
  const dayFmt=new Intl.DateTimeFormat("he-IL",{weekday:"long"});
  const tick=()=>{
    const d=new Date();
    $("#cDay").textContent=dayFmt.format(d);
    $("#cDate").textContent=p(d.getDate())+"/"+p(d.getMonth()+1)+"/"+d.getFullYear();
    $("#cTime").textContent=p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds());
    clearTimeout(tick._t); tick._t=setTimeout(tick, 1000-d.getMilliseconds()+20);   // next second boundary
  };
  tick();
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) tick(); });
})();
/* ================= splash ================= */
let REFRESH_VIEW=null;
try{ REFRESH_VIEW=sessionStorage.getItem("ogg-refresh"); sessionStorage.removeItem("ogg-refresh"); }catch(e){}
if(!["Dash","New","List","Data","Tasks","Cal"].includes(REFRESH_VIEW)) REFRESH_VIEW=null;
// app-icon shortcuts open a screen directly (?view=New|Dash|List|Data|open)
let DEEP_OPEN=false;
(function(){
  const u=new URL(location.href), v=u.searchParams.get("view"), tk=u.searchParams.get("task");
  if(tk){ u.searchParams.delete("task"); history.replaceState(null,"",u.pathname+u.search); setTimeout(()=>showTaskSoon(tk),300); }
  if(!v) return;
  if(v==="open"){ DEEP_OPEN=true; if(!REFRESH_VIEW) REFRESH_VIEW="List"; }
  else if(["Dash","New","List","Data","Tasks","Cal"].includes(v) && !REFRESH_VIEW) REFRESH_VIEW=v;
  u.searchParams.delete("view"); history.replaceState(null,"",u.pathname+u.search);
})();
/* shared into the app (Android: "שתף" → the app): the photos / files wait in the service worker's cache; once the app is
   open (after the opening screen) a window asks what to open with them — a new task or a new event — with them attached */
(function(){
  const u=new URL(location.href); if(u.searchParams.get("share")!=="1") return;
  u.searchParams.delete("share"); history.replaceState(null,"",u.pathname+u.search);
  const NAME=location.pathname.includes("/beta/") ? "ogg-beta-share" : "ogg-share";
  (async()=>{ let files=[], meta={};
    try{ const c=await caches.open(NAME); const mr=await c.match("share-meta"); meta=mr ? await mr.json() : {};
      for(let i=0;i<(meta.n||0);i++){ const r=await c.match("share-"+i); if(!r) continue; const b=await r.blob();
        files.push(new File([b], decodeURIComponent(r.headers.get("x-name")||"file"), {type:b.type})); }
      await caches.delete(NAME); }catch(e){}
    const text=[meta.title,meta.text,meta.url].filter(Boolean).join(" ").trim();
    if(!files.length && !text) return;
    const ready=()=>{ const sp=$("#splash"); return !sp || sp.hidden || getComputedStyle(sp).display==="none"; };
    let tries=0; while(!ready() && tries++<240) await new Promise(r=>setTimeout(r,500));   // wait for the opening screen / sign-in
    const box=$("#shrThumbs"); box.textContent="";
    files.forEach(f=>{ const d=mk("div","tk-file"+(/^image\//.test(f.type)?" img":""));
      if(/^image\//.test(f.type)){ const im=mk("img"); im.src=URL.createObjectURL(f); im.alt=f.name; d.appendChild(im); } else d.appendChild(mk("span",null,"📎 "+f.name)); box.appendChild(d); });
    $("#shrSub").textContent = (files.length ? (files.length===1 ? "קובץ אחד" : files.length+" קבצים") : "")+(text ? (files.length?" · ":"")+"“"+text.slice(0,120)+"”" : "")+" — מה לפתוח?";
    $("#shrTask").hidden=isViewer(); $("#shrEv").hidden=isViewer();
    $("#shrNo").onclick=()=>$("#dlgShare").close();
    $("#shrTask").onclick=()=>{ $("#dlgShare").close(); show("Tasks"); openTaskForm(); if(files.length) tkPendAdd(files,false);
      if(text && !$("#tkTitle").value) $("#tkTitle").value=text.slice(0,120); };
    $("#shrEv").onclick=async()=>{ $("#dlgShare").close(); resetForm(); show("New");
      if(text) $("#desc").value=text;
      if(files.length){ const out=await storeFiles(files.slice(0,8), false); if(out.length){ evFiles.push(...out); paintEvFiles(); toast(out.length===1?"צורף לאירוע":"צורפו "+out.length+" לאירוע"); } } };
    $("#dlgShare").showModal();
  })();
})();
(function(){
  const sp=$("#splash"); if(!sp) return;
  // shift and date (morning 07–15, evening 15–23, night 23–07)
  const d=new Date(), h=d.getHours();
  const shift = h>=7&&h<15 ? "בוקר" : h>=15&&h<23 ? "ערב" : "לילה";
  const date = d.toLocaleDateString("he-IL",{day:"2-digit",month:"2-digit",year:"numeric"});
  $("#spShift").textContent = "משמרת "+shift+" · "+date;
  $("#spVer").textContent = "גרסה "+APP_VER;
  const enter=()=>{
    document.documentElement.classList.remove("sp-open");
    sp.classList.add("out");
    setTimeout(()=>{ sp.hidden=true; weeklyCheck(); inboxOpenUntil=Date.now()+20000; if(window.inboxCheck) window.inboxCheck(); },200);
    $("#tabDash").focus({preventScroll:true});
  };
  $("#spEnter").onclick=enter;
  window.splashEnter=enter;
  if(REFRESH_VIEW){ sp.hidden=true; return; }   // came from the refresh button: skip the opening screen
  document.documentElement.classList.add("sp-open");
})();
/* ================= tasks =================
   A task is open work (what, who, where, until when). Finishing it writes a closed event to the log
   ("what was done" becomes the action taken), so the log keeps the history and the task list stays short.
   Storage: this device (localStorage); team mode syncs them through cloud.js (window.cloudPushTasks). */
const LST = CLOUD_ON ? "ogg-cloud-tasks" : "ogg-tasks-v1";
let tasks=[], tkView="open", tkEdit=null, tkDoneId=null;
const tkF={ppl:"",loc:"",type:"",prio:"",dept:"",late:false,rep:false,q:""};                 // list filters (dropdowns at the top)
const PRIOS=["דחופה","גבוהה","רגילה","נמוכה"];
const PRIO_HUE={"דחופה":"fault","גבוהה":"flood","רגילה":"maint","נמוכה":"gen"};
const prioOf=t=>PRIOS.includes(t.prio) ? t.prio : (t.urgent ? "דחופה" : "רגילה");   // older tasks: urgent flag
function loadTasks(){ try{ tasks=JSON.parse(localStorage.getItem(LST)||"[]"); if(!Array.isArray(tasks)) tasks=[]; }catch(e){ tasks=[]; } }
function saveTasks(){
  if(ensureNos()) persist();                      // a new task gets its number right away (events too, if any were waiting)
  saveBig(LST, JSON.stringify(tasks)).then(ok=>{ if(!ok) toast("הדפדפן חסם שמירה מקומית"); });
  if(window.cloudPushTasks) window.cloudPushTasks();
  writeFile();
  renderTasks();
}
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const tkOpen=t=>t.status!=="הושלמה";
const tkStat=t=>t.status==="בטיפול" ? "בטיפול" : t.status==="בהמתנה" || t.status==="HOLD" ? "בהמתנה" : "פתוחה";   // an open task: פתוחה / בטיפול / בהמתנה (v2.53 wrote "HOLD")
/* order of the open tasks: newest first (default), by due date, or by priority — picked above the list, kept on the device */
let tkSort="new"; try{ tkSort=localStorage.getItem("ogg-tk-sort")||"new"; }catch(e){}
/* "רשימה" on a wide screen: sort by a column (its heading) */
const TK_COLS=[["title","משימה"],["eq","ציוד"],["who","שיוך"],["dept","מחלקה"],["prio","עדיפות"],["type","קטגוריה"],["stat","סטטוס"],["extra","נוספים"],["due","תאריכים"],["ppl","אחראי · מיקום"]];
let tkCol=null; try{ tkCol=JSON.parse(localStorage.getItem("ogg-tk-col")||"null"); }catch(e){}
/* column widths in "רשימה": drag the edge of a heading; kept on this device. A narrower column leaves more room to the title. */
const TK_COLW_DEF={title:"minmax(130px,2fr)",eq:"128px",who:"68px",dept:"96px",prio:"68px",type:"108px",stat:"64px",extra:"minmax(96px,1fr)",due:"118px",ppl:"minmax(60px,1fr)"};
let tkResizeAt=0, tkColW={}; try{ tkColW=JSON.parse(localStorage.getItem("ogg-tk-colw")||"{}")||{}; }catch(e){}
function tkColWApply(){ const v=TK_COLS.map(([k])=>tkColW[k] ? (k==="title" ? "minmax("+tkColW[k]+"px,1fr)" : tkColW[k]+"px") : TK_COLW_DEF[k]).join(" ");
  const el=$("#viewTasks"); if(Object.keys(tkColW).length) el.style.setProperty("--tkcols",v); else el.style.removeProperty("--tkcols"); }
function tkColWSave(){ try{ localStorage.setItem("ogg-tk-colw",JSON.stringify(tkColW)); }catch(e){} tkColWApply(); }
function tkColDrag(ev,k,cell){
  ev.preventDefault(); ev.stopPropagation();
  const x0=ev.clientX, w0=cell.getBoundingClientRect().width, rtl=getComputedStyle(cell).direction==="rtl";
  document.body.classList.add("tk-resizing");
  const mv=e=>{ const d=(rtl ? x0-e.clientX : e.clientX-x0); tkColW[k]=Math.round(Math.max(36,Math.min(600,w0+d))); tkColWApply(); };
  const up=()=>{ removeEventListener("pointermove",mv); removeEventListener("pointerup",up); removeEventListener("pointercancel",up);
    document.body.classList.remove("tk-resizing"); tkColWSave(); tkResizeAt=Date.now(); };   // the release isn't a tap on the heading
  addEventListener("pointermove",mv); addEventListener("pointerup",up); addEventListener("pointercancel",up);
}
const tkColOn=()=>!!tkCol && tkLV==="rows" && matchMedia("(min-width:900px)").matches;
function tkColVal(t,k){   // a number or a text; "" = nothing there (always last)
  if(k==="title") return t.title||"";
  if(k==="eq") return (t.eq||[])[0]||"";
  if(k==="who") return t.priv ? 3 : isMine(t) ? 0 : openedByMe(t) ? 1 : 2;
  if(k==="dept") return (t.depts||[])[0]||"";
  if(k==="prio") return PRIOS.indexOf(prioOf(t));
  if(k==="type"){ const i=TK_CATS.indexOf(t.type||""); return !t.type ? "" : i>=0 ? " "+i : t.type; }   // the anchors first, in their order
  if(k==="stat") return !tkOpen(t) ? 9 : ["פתוחה","בטיפול","בהמתנה"].indexOf(tkStat(t));
  if(k==="extra"){ const ci=(t.check||[]).filter(x=>x && !x.del); return ci.length ? ci.filter(x=>x.done).length/ci.length : ""; }
  if(k==="due") return t.due||"";
  if(k==="ppl") return (t.ppl||[])[0]||"";
  return "";
}
function tkColCmp(){ const {k,d}=tkCol;
  return (a,b)=>{ const x=tkColVal(a,k), y=tkColVal(b,k);
    if(x==="" || y==="") return x===y ? 0 : x==="" ? 1 : -1;
    const c = typeof x==="number" && typeof y==="number" ? x-y : String(x).localeCompare(String(y),"he");
    return d*c || tkSortKey(a).localeCompare(tkSortKey(b)); }; }
function tkCmp(){
  const due=t=>t.due||"9999-99-99", cr=t=>String(t.created||"");
  if(tkSort==="due") return (a,b)=>due(a).localeCompare(due(b)) || PRIOS.indexOf(prioOf(a))-PRIOS.indexOf(prioOf(b));
  if(tkSort==="prio") return (a,b)=>tkSortKey(a).localeCompare(tkSortKey(b));
  if(tkSort==="chg") return (a,b)=>tkLastChg(b)-tkLastChg(a);
  if(tkSort==="cat"){ const ci=t=>{ const i=TK_CATS.indexOf(t.type||""); return i>=0 ? i : t.type ? 50 : 99; };   // the anchors in order, then the rest A–Z, then none
    return (a,b)=>ci(a)-ci(b) || String(a.type||"").localeCompare(String(b.type||""),"he") || tkSortKey(a).localeCompare(tkSortKey(b)); }
  return (a,b)=>cr(b).localeCompare(cr(a));
}
// the last time anyone changed the task: its last save, its last log line, or when it was opened
function tkLastChg(t){ const ms=v=>{ const x=Date.parse(String(v||"")); return isNaN(x)?0:x; }, L=t.log||[];
  return Math.max(ms(t.upd), ms(t.created), L.length ? ms(L[L.length-1] && L[L.length-1].at) : 0); }
function tkSortKey(t){ return PRIOS.indexOf(prioOf(t))+(t.due||"9999-99-99")+(t.created||""); }
/* "המשימות שלי": tasks assigned to me by name, or to my department (from "תפקיד ומחלקה").
   Team log: me = the signed-in member's team name. This device only: the person picked in "אני:" (saved here). */
const K_ME="ogg-me-name";
function myName(){
  const c=window.cloudMyName ? window.cloudMyName() : ""; if(c) return c;
  if(window.cloudMe) return "";                      // team log without a name set: the admin sets it
  try{ return localStorage.getItem(K_ME)||""; }catch(e){ return ""; }
}
function myDept(){ const n=myName(); return n ? deptOf(n) : ""; }
const isMine=t=>{ const n=myName(), d=myDept();
  return !!n && ((t.ppl||[]).includes(n) || (!!d && (t.depts||[]).includes(d))); };
window.taskIsMine=isMine;
function allDepts(){ return [...new Set(Object.values(lists._dept_ppl||{}).concat(tasks.flatMap(t=>t.depts||[])))].filter(Boolean).sort((a,b)=>a.localeCompare(b,"he")); }
function paintMe(){
  const box=$("#tkMe"); box.textContent=""; paintHello();
  const n=myName(), d=myDept();
  const team=!!(window.cloudMe && window.cloudMe());
  if(team && window.cloudNameFromAdmin && window.cloudNameFromAdmin()){   // the admin linked my login to a name
    box.appendChild(mk("span","hint","אני: "+n+(d?" · מחלקה: "+d:" · (אין מחלקה — הגדרות ← ניהול רשימות ← אנשים ← תפקיד ומחלקה)")));
    return;
  }
  // pick "who am I" from the people list — team log: saved in the cloud (all my devices); otherwise on this device
  const lab=mk("label","tk-me-sel"), sel=mk("select"); lab.append(mk("span",null,"אני:"), sel);
  fillSelect(sel, pplValues(), n, "— בחר את השם שלך —");
  sel.onchange=()=>{ const v=sel.value;
    if(team && window.cloudSetMyName) window.cloudSetMyName(v); else { try{ localStorage.setItem(K_ME, v); }catch(e){} }
    if(!v && tkView==="mine") tkView="open"; paintTkSeg(); renderTasks(); if(v) toast("שלום "+v); };
  box.appendChild(lab);
  if(n) box.appendChild(mk("span","hint", d ? "מחלקה: "+d : "אין מחלקה — הגדרות ← ניהול רשימות ← אנשים ← תפקיד ומחלקה"));
  enhanceSelect(sel);
}
/* greeting in the header: "שלום <name>" (the name linked to me, else the start of my mail) */
function paintHello(){
  const el=$("#cHello"); if(!el) return;
  const mail=window.cloudMe ? window.cloudMe() : "";
  const n=myName() || (mail ? mail.split("@")[0] : "");
  el.textContent = n ? "שלום "+n : ""; el.hidden=!n;
}
/* who sees which tasks: a manager (and this device, without the team log) — all of them;
   a team member — only the tasks assigned to them by name or to their department */
function isViewer(){ try{ return CLOUD_ON && localStorage.getItem("ogg-cloud-role")==="viewer"; }catch(e){ return false; } }
function tkVis(){ return isManager() || isViewer() ? tasks : tasks.filter(t=>isMine(t) || openedByMe(t)); }   // the office screen ("צופה") shows the whole team's tasks
window.tkVisible=t=>isManager() || isViewer() || isMine(t) || openedByMe(t);
/* "שפתחתי": the tasks I opened (also when assigned to another department). New tasks keep who opened them;
   older ones: from the first line of their update log ("המשימה נפתחה"). */
function openedByMe(t){
  const m=window.cloudMe && window.cloudMe();
  if(t.openedMail || t.openedBy) return m ? t.openedMail===m : (!!t.openedBy && t.openedBy===reporter());
  const l=(t.log||[]).find(x=>x && x.sys && /^המשימה נפתחה/.test(x.text||"")); if(!l) return false;
  return m ? l.mail===m : (!!l.by && l.by===reporter());
}
window.openedByMe=openedByMe;
/* "new" task: one I haven't seen yet (per person, on this device) — it stays at the top of the list, marked.
   Seen = it was on the screen in the task list and I left the list (like "חדש" on events).
   A task I just opened is new too (it stays on top until I leave the list); on the first use, what is already there counts as seen. */
const tkSeenKey=()=>"ogg-tk-seen-"+((window.cloudMe && window.cloudMe()) || "local");
let tkSeen=null, tkShownNew=new Set();
function tkSeenLoad(){ const k=tkSeenKey(); if(tkSeen && tkSeen.k===k) return tkSeen;
  let d=null; try{ d=JSON.parse(localStorage.getItem(k)||"null"); }catch(e){}
  if(!d || !Array.isArray(d.ids)) d={since:new Date().toISOString(), ids:[]};
  tkSeen={k, since:d.since, ids:new Set(d.ids)}; if(!localStorage.getItem(k)) tkSeenSave(); return tkSeen; }
function tkSeenSave(){ const S=tkSeen; if(!S) return;
  const live=new Set(tasks.map(t=>t.id)); try{ localStorage.setItem(S.k, JSON.stringify({since:S.since, ids:[...S.ids].filter(id=>live.has(id))})); }catch(e){} }
function tkIsNew(t){ if(t.priv || !tkOpen(t)) return false; const S=tkSeenLoad();
  return !S.ids.has(t.id) && String(t.created||"")>S.since; }
document.addEventListener("visibilitychange",()=>{ if(document.hidden && curView==="Tasks") tkMarkSeen(); });   // left the app from the list
function tkMarkSeen(){ if(!tkShownNew.size) return; const S=tkSeenLoad(); tkShownNew.forEach(id=>S.ids.add(id)); tkShownNew.clear(); tkSeenSave(); }
function paintTaskCount(){
  const V=tkVis(), n=V.filter(tkOpen).length;              // "(open/total)": 4/5 = 4 open out of 5
  $("#tkCnt").textContent = "("+(V.length ? nf(n)+"/"+nf(V.length) : "0")+")";
  $("#tkCnt").title = n+" פתוחות מתוך "+V.length+" משימות"; $("#tkCnt").dir="ltr";
  const m=V.filter(t=>tkOpen(t)&&isMine(t)).length, el=$("#tkMine"), o=V.filter(t=>tkOpen(t)&&openedByMe(t)).length;
  el.textContent = m ? String(m) : ""; el.title = m ? m+" משימות פתוחות שלך" : ""; el.hidden=!m;
  const P=typeof privTasks==="function" ? privTasks() : [], po=P.filter(tkOpen).length;          // my open personal (🔒) tasks
  const segN={open:n, done:V.length-n, mine:m, opened:o, priv:po};   // personal (🔒) tasks show only under "אישיות"
  document.querySelectorAll("#tkSeg button[data-v]").forEach(b=>{
    const base={open:isLite()?"כל המשימות":"פתוחות",done:"הושלמו",mine:isLite()?"שלי":"המשימות שלי",opened:"שפתחתי",priv:"🔒 אישיות"}[b.dataset.v];   // phone: short words, one line
    b.textContent=""; b.append(base+" "); b.appendChild(mk("span","seg-n",nf(segN[b.dataset.v]||0))); });
}
function showMyTasks(){
  const sp=$("#splash"); if(sp && !sp.hidden && window.splashEnter && !$("#spEnter").hidden) window.splashEnter();
  tkView = myName() ? "mine" : "open"; paintTkSeg(); renderTasks(); show("Tasks"); window.scrollTo({top:0});
}
/* ================= messages (team log) =================
   A new assignment, an update-log entry or edited details that someone else made on a task of mine
   (or my department's) becomes a message (built in cloud.js). Kept on this device for the signed-in user;
   unread messages pop up as a list when the app is opened, and the bell in the header shows them any time. */
const INBOX_MAX=300, INBOX_ICON={assign:"📌",update:"💬",status:"🔄",edit:"✏️",off:"↩",fb:"📣"};
const inboxKey=()=>"ogg-inbox-"+((window.cloudMe && window.cloudMe()) || "local");
function inboxGet(){ try{ const a=JSON.parse(localStorage.getItem(inboxKey())||"[]"); return Array.isArray(a) ? a : []; }catch(e){ return []; } }
function inboxPut(a){
  a.sort((x,y)=>String(y.at).localeCompare(String(x.at)));
  try{ localStorage.setItem(inboxKey(), JSON.stringify(a.slice(0,INBOX_MAX))); }catch(e){}
  paintInbox();
}
function paintInbox(){
  const b=$("#inboxBtn"); if(!b) return;
  b.hidden=!CLOUD_ON; if(!CLOUD_ON) return;
  const n=inboxGet().filter(x=>!x.read && !x.arch).length, s=$("#inboxN");
  s.textContent = n>99 ? "99+" : String(n); s.hidden=!n;
  b.setAttribute("aria-label", n ? n+" הודעות חדשות" : "הודעות"); b.title = n ? n+" הודעות חדשות" : "הודעות";
}
let inboxOpenUntil=Date.now()+20000;          // "the app was just opened": messages arriving now pop the list up
function inboxAdd(items, toasted){
  const a=inboxGet(), ids=new Set(a.map(x=>x.id)), now=nowLocal()+":"+String(new Date().getSeconds()).padStart(2,"0");
  inboxDelIds().forEach(i=>ids.add(i));
  const add=items.filter(x=>x && !ids.has(x.id)).map(x=>Object.assign({at:now}, x, {read:false}));
  if(!add.length) return;
  inboxPut(add.concat(a));
  if(Date.now()<inboxOpenUntil) inboxCheck();
  else if(!toasted) toast(add.length===1 ? "הודעה חדשה: "+(add[0].title||"") : add.length+" הודעות חדשות", {label:"הצג", fn:openInbox});
}
function inboxCheck(){ if(TV) return;
  if(!CLOUD_ON || !inboxGet().some(x=>!x.read && !x.arch)) return;
  const sp=$("#splash"); if(sp && !sp.hidden) return;                 // after the opening screen
  if(document.querySelector("dialog[open]")) return;                  // the weekly window etc. first (retried when it closes)
  openInbox();
}
let inbTab="in";
const inbDelKey=()=>inboxKey()+"-del";
function inboxDelIds(){ try{ const a=JSON.parse(localStorage.getItem(inbDelKey())||"[]"); return Array.isArray(a) ? a : []; }catch(e){ return []; } }
function inboxArchive(id, on){ const a=inboxGet(), x=a.find(m=>m.id===id); if(!x) return; x.arch=on; x.read=true; inboxPut(a); openInbox(); }
function inboxDelete(ids){                       // final delete; remembered so the same message is not brought back
  const set=new Set(ids); inboxPut(inboxGet().filter(m=>!set.has(m.id)));
  try{ localStorage.setItem(inbDelKey(), JSON.stringify(inboxDelIds().concat(ids).slice(-400))); }catch(e){}
  openInbox();
}
// swipe a message to the right → it moves to the archive
function inbSwipe(row, card, fn){
  let x0=null, y0=0, dx=0, drag=false;
  card.addEventListener("pointerdown",e=>{ if(e.button) return; x0=e.clientX; y0=e.clientY; dx=0; drag=false; });
  card.addEventListener("pointermove",e=>{
    if(x0==null) return; dx=e.clientX-x0; const dy=e.clientY-y0;
    if(!drag){ if(Math.abs(dx)>10 && Math.abs(dx)>Math.abs(dy)*1.3){ drag=true; row.classList.add("drag"); try{ card.setPointerCapture(e.pointerId); }catch(_){} card.style.transition="none"; } else if(Math.abs(dy)>10){ x0=null; return; } else return; }
    const d=Math.max(0,dx); card.style.transform="translateX("+d+"px)"; row.classList.toggle("go", d>90);
  });
  const end=()=>{ if(x0==null) return; x0=null; card.style.transition=""; row.classList.remove("drag");
    if(drag && dx>90){ card.style.transform="translateX(110%)"; card.style.opacity="0"; if(typeof haptic==="function") haptic(); setTimeout(fn,180); }
    else { card.style.transform=""; row.classList.remove("go"); }
    if(drag){ card.dataset.swiped="1"; setTimeout(()=>delete card.dataset.swiped,50); } };
  card.addEventListener("pointerup",end); card.addEventListener("pointercancel",end);
}
function openInbox(){
  const d=$("#dlgInbox"), box=$("#inbList"), all=inboxGet(), arch=all.filter(x=>x.arch), a=all.filter(x=>!x.arch), n=a.filter(x=>!x.read).length;
  const inArch = inbTab==="arch";
  $("#inbTitle").textContent = inArch ? "ארכיון הודעות" : n ? "הודעות חדשות ("+n+")" : "הודעות";
  $("#inbArchBtn").textContent = "ארכיון"+(arch.length?" ("+arch.length+")":"");
  document.querySelectorAll("#dlgInbox [data-ib]").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.ib===inbTab)));
  $("#inbHint").textContent = inArch ? "הודעות שהוסרו מהרשימה. אפשר להחזיר הודעה, או למחוק אותה סופית."
    : "הקצאות ועדכונים שאחרים עשו במשימות שלך, של המחלקה שלך, ובמשימות שפתחת או עדכנת. לחיצה על הודעה פותחת את המשימה; החלקה ימינה מעבירה אותה לארכיון.";
  const list = inArch ? arch : a;
  $("#inbClose").textContent = inArch ? "סגור" : "קראתי";
  $("#inbAll").textContent = inArch ? "מחק הכל סופית" : "העבר הכל לארכיון";
  $("#inbAll").hidden = !list.length;
  box.textContent="";
  if(!list.length) box.appendChild(mk("div","inb-empty", inArch ? "הארכיון ריק." : "אין הודעות. כאן יופיעו הקצאות ועדכונים במשימות שלך."));
  list.forEach(x=>{
    const row=mk("div","inb-row");
    const r=mk("button","inb"+(x.read?"":" new")); r.type="button";
    r.appendChild(mk("span","inb-i",INBOX_ICON[x.kind]||"•"));
    const body=mk("span","inb-b"); body.appendChild(mk("b","inb-t",x.title||"(ללא כותרת)")); body.appendChild(mk("span","inb-x",x.text||""));
    body.appendChild(mk("span","inb-m",[x.by,fmtWhen(x.at)].filter(Boolean).join(" · "))); r.appendChild(body);
    r.onclick=()=>{ if(r.dataset.swiped) return; d.close(); if(x.reply){ } else if(x.fb){ if(window.openFeedback) window.openFeedback(x.fb); } else goTask(x.tid); };
    row.appendChild(r);
    if(inArch){
      const act=mk("div","inb-act");
      const back=mk("button","btn mini","↩ החזר"); back.type="button"; back.onclick=()=>inboxArchive(x.id,false);
      const del=mk("button","btn mini danger","מחק סופית"); del.type="button"; del.onclick=()=>inboxDelete([x.id]);
      act.append(back,del); row.appendChild(act);
    } else {
      row.appendChild(mk("span","inb-swipe","לארכיון ←"));
      const xb=mk("button","inb-xb","✕"); xb.type="button"; xb.setAttribute("aria-label","העבר לארכיון"); xb.title="העבר לארכיון";
      xb.onclick=()=>inboxArchive(x.id,true); row.appendChild(xb);
      inbSwipe(row, r, ()=>inboxArchive(x.id,true));
    }
    box.appendChild(row);
  });
  if(!d.open) d.showModal();
}
document.querySelectorAll("#dlgInbox [data-ib]").forEach(b=>b.onclick=()=>{ inbTab=b.dataset.ib; openInbox(); });
$("#inbAll").onclick=()=>{
  const all=inboxGet();
  if(inbTab==="arch"){ const ids=all.filter(x=>x.arch).map(x=>x.id); if(ids.length && confirm("למחוק סופית "+ids.length+" הודעות מהארכיון?")) inboxDelete(ids); }
  else { all.forEach(x=>{ if(!x.arch){ x.arch=true; x.read=true; } }); inboxPut(all); openInbox(); }
};
function goTask(tid){
  const pv=tid.startsWith("p:"), t=pv ? privTasks().find(x=>x.id===tid) : tasks.find(x=>x.id===tid); if(!t){ toast("המשימה כבר לא קיימת"); return; }
  if(!pv && !window.tkVisible(t)){ toast("המשימה כבר לא משויכת אליך או למחלקה שלך"); return; }
  Object.keys(tkF).forEach(k=>tkF[k]= k==="late" ? false : "");
  tkView = pv ? "priv" : !tkOpen(t) ? "done" : isMine(t) ? "mine" : "open"; tkOpenLogs.add(t.id); tkRowOpen.add(t.id);   // "רשימה": the line opens in full
  closeTaskForm(); $("#tfPanel").hidden=true; $("#tfToggle").setAttribute("aria-expanded","false");
  paintTkSeg(); renderTasks(); show("Tasks");
  const c=document.querySelector('#tkList .tk[data-id="'+tid+'"]');
  if(c){ c.classList.add("flash"); setTimeout(()=>c.classList.remove("flash"),2200);
    requestAnimationFrame(()=>c.scrollIntoView({block:"center"})); }
}
$("#inboxBtn").onclick=()=>{ inbTab="in"; openInbox(); };
$("#inbClose").onclick=()=>$("#dlgInbox").close();
$("#dlgInbox").addEventListener("close",()=>{ const a=inboxGet(); if(a.some(x=>!x.read)){ a.forEach(x=>x.read=true); inboxPut(a); } });
$("#dlgWeek").addEventListener("close",()=>setTimeout(inboxCheck,300));
document.addEventListener("visibilitychange",()=>{ if(!document.hidden){ inboxOpenUntil=Date.now()+20000; setTimeout(inboxCheck,1200); } });
window.inboxAdd=inboxAdd; window.inboxCheck=inboxCheck; window.paintInbox=paintInbox;
paintInbox();
/* dropdown helpers: the values come from the log's lists (events + added values), most used in events first */
let freqCache=null;
function byUse(k){
  if(!freqCache || freqCache.n!==events.length){ freqCache={n:events.length};
    ["loc","eq","ppl","type"].forEach(f=>{ const m=new Map(); events.forEach(e=>(e[f]||[]).forEach(v=>m.set(v,(m.get(v)||0)+1))); freqCache[f]=m; }); }
  const m=freqCache[k];
  const out=coreFirst((lists[k]||[]).slice().sort((x,y)=>(m.get(y)||0)-(m.get(x)||0) || x.localeCompare(y,"he")), k);
  return k==="type" ? groupTypes(out) : out;
}
function pplValues(){ const off=lists._hide_ppl||[];
  return coreFirst([...new Set((window.TEAM_NAMES||[]).filter(n=>!off.includes(n)).concat(byUse("ppl")))], "ppl"); }
function fillSelect(el, values, cur, first, other){
  el.textContent="";
  if(first!==undefined){ const o=mk("option",null,first); o.value=""; el.appendChild(o); }
  const vals=values.slice(); if(cur && !vals.includes(cur)) vals.unshift(cur);
  vals.forEach(v=>{ const o=mk("option",null,v); o.value=v; if(v===cur) o.selected=true; el.appendChild(o); });
  if(other){ const o=mk("option",null,"+ אחר…"); o.value="__other"; el.appendChild(o); }
  if(!cur) el.value="";
}
function colorSelect(el, hue){                            // a chosen value gets its colour
  el.style.background = hue ? "var(--c-"+hue+"-bg)" : ""; el.style.color = hue ? "var(--c-"+hue+")" : "";
  el.style.borderColor = hue ? "var(--c-"+hue+")" : ""; el.style.fontWeight = hue ? "800" : "";
}
function paintFormColors(){ colorSelect($("#tkPrio"), PRIO_HUE[$("#tkPrio").value]); const ty=$("#tkType"), tb=ty.nextElementSibling;
  colorSelect(ty, ty.value ? hueOf(ty.value) : ""); if(tb && tb.classList.contains("ss-btn")) colorSelect(tb, ty.value ? hueOf(ty.value) : ""); }
// (tkInDept: a task belongs to the department it was assigned to; a task with no department, to its people's — defined with the calendar)
// managers: a row of departments above the list; it opens on the manager's own department
let tkDeptInit=false;
// a department's icon by the kind of work in its name (generic words only): electricity ⚡, maintenance 🔧, operations 💧; others 🏢
function deptIcon(d){ d=String(d||""); return /חשמל/.test(d) ? "⚡" : /אחזק/.test(d) ? "🔧" : /תפעול/.test(d) ? "💧" : "🏢"; }
function paintDeptSeg(){
  const box=$("#tkDeptSeg"), ds=allDepts(), on=isManager() && ds.length>0 && tkView!=="priv";   // personal tasks have no department
  box.hidden=!on; if(!on) return;
  if(!tkDeptInit && myDept() && ds.includes(myDept())){ tkDeptInit=true; tkF.dept=myDept(); }
  const base=tkVis().filter(t=> tkView==="done" ? !tkOpen(t) : tkOpen(t) && (tkView!=="mine" || isMine(t)) && (tkView!=="opened" || openedByMe(t)));
  const sl=$("#tkDeptSel"); sl.textContent="";
  [["", "כל המחלקות", base.length]].concat(ds.map(d=>[d, deptIcon(d)+" "+d, base.filter(t=>tkInDept(t,d)).length])).forEach(([v,label,n])=>{
    const o=mk("option",null,label+" ("+nf(n)+")"); o.value=v; sl.appendChild(o); });
  sl.value = ds.includes(tkF.dept) ? tkF.dept : ""; sl.classList.toggle("on",!!sl.value);
}
$("#tkDeptSel").onchange=e=>{ tkF.dept=e.target.value; renderTasks(); };
function renderTkFilters(){
  fillSelect($("#tfPpl"), pplValues(), tkF.ppl, "כל האחראים");
  fillSelect($("#tfDept"), allDepts(), tkF.dept, "כל המחלקות"); $("#tfDept").hidden=!allDepts().length;
  $("#tfDept").classList.toggle("on",!!tkF.dept);
  fillSelect($("#tfLoc"), byUse("loc"), tkF.loc, "כל המיקומים");
  { const box=$("#tkCatChips"); if(box){ box.textContent=""; const cs=tkCatPicked();   // phone: the categories in the top row, scrolling sideways
      const used=new Set(tkVis().map(t=>t.type).filter(Boolean));   // the anchors, and other categories only when a task has them
      tkCats().filter(v=>TK_CATS.includes(v) || used.has(v) || cs.includes(v)).forEach(v=>{ const on=cs.includes(v), b=mk("button","tk-cc"+(on?" on":""),v); b.type="button"; b.setAttribute("aria-pressed",String(on));
        const h=hueOf(v); b.style.setProperty("--cc","var(--c-"+h+")"); b.style.setProperty("--ccb","var(--c-"+h+"-bg)");
        b.onclick=()=>{ const now=tkCatPicked(); tkF.type=(now.includes(v) ? now.filter(x=>x!==v) : now.concat(v)).join("\n"); renderTasks(); };
        box.appendChild(b); }); } }
  { const cs=tkCatPicked();   // several categories can be picked (kept as one text, one per line)
    fillSelect($("#tfType"), tkCats(), cs.length===1 ? cs[0] : "", "כל הקטגוריות");
    if(cs.length>1){ const o=mk("option",null,cs.length+" קטגוריות"); o.value="__multi"; $("#tfType").appendChild(o); $("#tfType").value="__multi"; }
    const b=$("#tkCatSel"); b.textContent = !cs.length ? "הכל" : cs.length<=2 ? cs.join(", ") : cs.length+" קטגוריות"; b.title=cs.join(", ");
    b.classList.toggle("on",!!cs.length); colorSelect(b, cs.length===1 ? hueOf(cs[0]) : ""); }
  fillSelect($("#tfPrio"), PRIOS, tkF.prio, "כל העדיפויות");
  colorSelect($("#tfPrio"), PRIO_HUE[tkF.prio]); colorSelect($("#tfType"), tkCatPicked().length===1 ? hueOf(tkF.type) : "");
  ["#tfPpl","#tfLoc","#tfType"].forEach(id=>$(id).classList.toggle("on",!!$(id).value));
  // like the events list: search + "סינון" (a panel), the badge counts the filters that are on
  paintDeptSeg(); $("#tfDept").hidden = $("#tfDept").hidden || !$("#tkDeptSeg").hidden;   // managers pick the department in the row above
  const nOn=["ppl","loc","type","prio",$("#tkDeptSeg").hidden?"dept":"","late","rep"].filter(k=>k && tkF[k]).length;
  $("#tfBadge").textContent = nOn ? String(nOn) : "";
  $("#tfLate").setAttribute("aria-pressed",String(!!tkF.late));
  $("#tfRep").setAttribute("aria-pressed",String(!!tkF.rep));
  if($("#tq").value!==tkF.q) $("#tq").value=tkF.q;
  const dl=$("#dlPpl"); dl.textContent=""; (lists.ppl||[]).forEach(v=>{ const x=document.createElement("option"); x.value=v; dl.appendChild(x); });
}
$("#tkSort").value=tkSort;
const tkCatPicked=()=>tkF.type ? String(tkF.type).split("\n").filter(Boolean) : [];
$("#tkCatSel").onclick=ev=>{ ev.stopPropagation(); const old=$(".cat-pop"); if(old){ old.remove(); $("#tkCatSel").setAttribute("aria-expanded","false"); return; }
  const btn=$("#tkCatSel"), p=mk("div","cat-pop"); p.setAttribute("role","group"); p.setAttribute("aria-label","קטגוריות");
  const paint=()=>{ p.textContent=""; const cs=tkCatPicked();
    const all=mk("button","cat-all"+(cs.length?"":" on"),"הכל"); all.type="button"; all.onclick=()=>{ tkF.type=""; renderTasks(); paint(); }; p.appendChild(all);
    tkCats().forEach(v=>{ const l=mk("label","cat-it"), i=mk("input"); i.type="checkbox"; i.checked=cs.includes(v);
      const sw=mk("span","cat-sw"); sw.style.background="var(--c-"+hueOf(v)+")";
      i.onchange=()=>{ const n=i.checked ? cs.concat(v) : cs.filter(x=>x!==v); tkF.type=n.join("\n"); renderTasks(); paint(); };
      l.append(i,sw,mk("span",null,v)); p.appendChild(l); }); };
  paint(); document.body.appendChild(p); btn.setAttribute("aria-expanded","true");
  const r=btn.getBoundingClientRect(), w=Math.min(260, innerWidth-16);
  p.style.width=w+"px"; p.style.top=(r.bottom+4)+"px"; p.style.left=Math.max(8,Math.min(r.right-w,innerWidth-w-8))+"px";
  const out=e=>{ if(!p.contains(e.target) && e.target!==btn){ p.remove(); btn.setAttribute("aria-expanded","false"); removeEventListener("pointerdown",out,true); removeEventListener("scroll",out,true); } };
  addEventListener("pointerdown",out,true); addEventListener("scroll",out,true); };
$("#tkSort").onchange=()=>{ tkSort=$("#tkSort").value; tkCol=null; try{ localStorage.removeItem("ogg-tk-col"); }catch(e){} try{ localStorage.setItem("ogg-tk-sort",tkSort); }catch(e){} renderTasks(); };
$("#tfClear").onclick=()=>{ Object.keys(tkF).forEach(k=>tkF[k]= k==="late" ? false : ""); renderTasks(); };
$("#tfToggle").onclick=()=>{ const p=$("#tfPanel"), open=p.hidden; p.hidden=!open; $("#tfToggle").setAttribute("aria-expanded",String(open)); };
$("#tfLate").onclick=()=>{ tkF.late=!tkF.late; renderTasks(); };
$("#tfRep").onclick=()=>{ tkF.rep=!tkF.rep; renderTasks(); };      // only the recurring (scheduled) tasks
$("#tq").oninput=()=>{ tkF.q=$("#tq").value; renderTasks(); };
["ppl","loc","type","prio","dept"].forEach(k=>{ const el=$("#tf"+k[0].toUpperCase()+k.slice(1)); el.onchange=()=>{ if(el.value==="__multi") return; tkF[k]=el.value; renderTasks(); }; });
/* update log: every task keeps a running log — time, who reported, what happened.
   Status changes are logged automatically; when the task is finished the log goes into the event ("המשך טיפול"). */
const K_REPORTER="ogg-reporter";
/* who is updating: team log — the signed-in user (their team name, else the mail's user part); this device — the chosen reporter */
function reporter(){
  if(myName()) return myName();
  const m=window.cloudMe ? window.cloudMe() : ""; if(m) return m.split("@")[0];
  try{ return localStorage.getItem(K_REPORTER)||""; }catch(e){ return ""; }
}
function tkLog(t, text, by, sys){
  if(!Array.isArray(t.log)) t.log=[];
  const mail=window.cloudMe ? window.cloudMe() : "";
  t.log.push({id:newId(), at:nowLocal()+":"+String(new Date().getSeconds()).padStart(2,"0"), by:by||reporter()||"", ...(mail?{mail}:{}), text, ...(sys?{sys:true}:{})});
}
const logLine=l=>"• "+(l.by?l.by+": ":"")+l.text+" ("+fmtWhen(l.at).replace(/\/\d{4}/,"")+")";
let tkOpenLogs=new Set();
const tkDraft={}; let tkFocus=null;          // unsent text in a task's boxes, and which box had the focus
/* checklist inside a task: tick items off, add items in place (Enter). Ticking writes a line in the
   update log (so the team gets it as a message). Removing an item is for a manager, with confirmation;
   it stays as a hidden tombstone so a device that still has it can't bring it back. */
/* a checklist item that turns out to be a job of its own becomes a task: same type, priority, people, departments,
   place, equipment and due date as the task it came from; the item stays, marked "→ משימה #", and both logs say so */
function ckToTask(t, it){
  if(!confirm("להפוך את הפריט למשימה בפני עצמה?\n"+it.text+"\n\nהמשימה החדשה תקבל את הקטגוריה, העדיפות, האחראים, המיקום, הציוד והיעד של המשימה הזו.")) return;
  const now=new Date().toISOString();
  const n={id:newId(), status:"פתוחה", created:now, upd:now, log:[], openedBy:reporter()||"", openedMail:(window.cloudMe && window.cloudMe())||"",
    title:it.text, desc:"", type:t.type||"", prio:prioOf(t), urgent:prioOf(t)==="דחופה", ppl:(t.ppl||[]).slice(), depts:(t.depts||[]).slice(),
    loc:(t.loc||[]).slice(), eq:(t.eq||[]).slice(), start:"", due:t.due||"", parent:t.id};
  tkLog(n, "נפתחה מפריט ברשימת הבדיקה של משימה"+(t.no?" #"+t.no:"")+": "+(t.title||""), "", true);
  tasks.push(n); ensureNos();
  it.moved=n.id; it.done=true; it.by=reporter()||""; it.at=nowLocal();
  tkLog(t, "פריט הפך למשימה"+(n.no?" #"+n.no:"")+": "+it.text, "", true); t.upd=now;
  saveTasks(); toast("נפתחה משימה"+(n.no?" #"+n.no:""),{label:"הצג",fn:()=>goTask(n.id)});
}
/* card view: the first photo on the task is the card's background (faint, so the text stays readable). The small preview
   kept with the task shows at once; the full photo (this device / the cloud copy) replaces it when it is at hand. */
const tkBgFull=new Map();
function tkBg(t, c){
  const m=(t.files||[]).find(x=>x && !x.del && x.thumb && /^image\//.test(x.type||"")); if(!m) return;
  const set=u=>c.style.setProperty("--tkbg",'url("'+u+'")');
  c.classList.add("has-bg"); set(tkBgFull.get(m.id) || m.thumb);
  if(!tkBgFull.has(m.id)) fGet(m.id).then(r=>{ const u=r && (r.data||r.url); if(u && /^data:image\//.test(u)){ tkBgFull.set(m.id,u); set(u); } else tkBgFull.set(m.id,m.thumb); });
}
/* ===== phone (html.lite): bottom bar, 🔍 panel, swipe right to complete ===== */
function paintBotNav(){ const v=curView, lit=v==="New"?"List":v==="Cal"?"Tasks":v;
  document.querySelectorAll("#botNav [data-go]").forEach(b=>b.setAttribute("aria-current", b.dataset.go===lit ? "page" : "false"));
  const T={Tasks:"משימות",Dash:"דשבורד",List:"אירועים",New:"רישום אירוע",Data:"הגדרות",Cal:"לוח שנה"}; if($("#liteTitle")) $("#liteTitle").textContent=T[v]||""; }
function bnCopy(from, to){ const f=$(from), t=$(to); if(!f || !t) return; const sync=()=>{ t.textContent=f.textContent; t.hidden=f.hidden || !f.textContent; };
  sync(); new MutationObserver(sync).observe(f,{childList:true,characterData:true,subtree:true,attributes:true}); }
bnCopy("#tkMine","#bnTk"); bnCopy("#newCnt","#bnEv");
document.querySelectorAll("#botNav [data-go], #liteFab").forEach(b=>b.onclick=ev=>{ const g=b.dataset.go; $("#bnMenu").hidden=true;
  if(g==="Tasks") $("#tabTasks").click(); else if(g==="Dash") $("#tabDash").click(); else if(g==="List") $("#tabList").click(); else if(g==="Data") $("#setBtn").click();
  else if(g==="plus"){ if(curView==="List" || curView==="New") $("#fabNew").click(); else if(curView==="Tasks") openTaskForm(null);
    else { ev.stopPropagation(); $("#bnMenu").hidden=!$("#bnMenu").hidden; } }
  window.scrollTo({top:0}); });
$("#bnMenu").onclick=e=>{ const n=e.target.dataset.n; if(!n) return; $("#bnMenu").hidden=true;
  if(n==="task"){ $("#tabTasks").click(); openTaskForm(null); } else { $("#tabList").click(); $("#fabNew").click(); } };
document.addEventListener("pointerdown",e=>{ if(!$("#bnMenu").hidden && !e.target.closest("#bnMenu,.bn-plus")) $("#bnMenu").hidden=true; });
$("#tkSrch").onclick=()=>{ const on=!$("#viewTasks").classList.contains("fopen"); $("#viewTasks").classList.toggle("fopen",on); $("#tkSrch").setAttribute("aria-expanded",String(on));
  if(on){ $("#tfPanel").hidden=false; setTimeout(()=>$("#tq").focus({preventScroll:true}),50); } };
$("#tfDone").onclick=()=>{ tkView = tkView==="done" ? "open" : "done"; paintTkSeg(); renderTasks(); };
$("#tfOpened").onclick=()=>{ tkView = tkView==="opened" ? "open" : "opened"; paintTkSeg(); renderTasks(); };
function liteSwipe(card, fn){   // a finger to the right (in Hebrew, the "done" direction): the card slides and the action opens
  let x0=null, y0=0, dx=0, drag=false;
  card.addEventListener("touchstart",e=>{ if(e.target.closest("button,input,textarea,select,a,label,.tk-check,.tk-files")) return; const p=e.touches[0]; x0=p.clientX; y0=p.clientY; dx=0; drag=false; card._swiped=false; },{passive:true});
  card.addEventListener("touchmove",e=>{ if(x0===null) return; const p=e.touches[0]; dx=p.clientX-x0; const dy=p.clientY-y0;
    if(!drag && Math.abs(dx)>14 && Math.abs(dx)>Math.abs(dy)*1.4) drag=true;
    if(drag && dx>0){ card.style.transform="translateX("+Math.min(dx,160)+"px)"; card.classList.toggle("sw-go", dx>90); } },{passive:true});
  const end=()=>{ if(x0===null) return; const go=drag && dx>90; x0=null; card.style.transform=""; card.classList.remove("sw-go");
    if(drag){ card._swiped=true; setTimeout(()=>card._swiped=false,350); } if(go){ if(typeof haptic==="function") haptic(); fn(); } };
  card.addEventListener("touchend",end); card.addEventListener("touchcancel",end);
}
function renderCheck(t, c){
  const items=(t.check||[]).filter(x=>x && !x.del), open=tkOpen(t);
  if(!items.length && !open) return;
  const box=mk("div","tk-check"+(items.length?"":" ck-empty")), done=items.filter(x=>x.done).length;
  if(items.length) box.appendChild(mk("div","tk-check-h", "רשימת בדיקה ("+done+" מתוך "+items.length+" פריטים בוצעו)"));
  if(items.length){ const bar=mk("div","tk-check-bar"), f=mk("span"); f.style.width=Math.round(done/items.length*100)+"%"; bar.appendChild(f); box.appendChild(bar); }
  const save=()=>{ t.upd=new Date().toISOString(); saveTasks(); };
  items.forEach(it=>{
    const r=mk("div","ck"+(it.done?" done":""));
    const b=mk("button","ck-box"); b.type="button"; b.setAttribute("role","checkbox"); b.setAttribute("aria-checked",String(!!it.done));
    b.setAttribute("aria-label",it.text); b.disabled=!open;
    b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    b.onclick=()=>{ it.done=!it.done; it.by=reporter()||""; it.at=nowLocal();
      tkLog(t, (it.done?"✓ בוצע: ":"סימון בוטל: ")+it.text, "", true); save(); };
    const x=mk("span","ck-t",it.text); x.onclick=()=>{ if(open) b.click(); };
    const ctl=mk("span","ck-ctl"); r.append(b,x,ctl);   // the item's controls — on a narrow phone they wrap under the text
    if(it.moved){ const tt=tasks.find(z=>z.id===it.moved), g=mk("button","ck-moved","→ משימה"+(tt && tt.no?" #"+tt.no:"")); g.type="button";
      g.title="הפריט הפך למשימה בפני עצמה"; g.onclick=()=>goTask(it.moved); ctl.appendChild(g); }
    else if(it.done && it.by) ctl.appendChild(mk("span","ck-by",it.by));
    if(open && !isViewer()){   // move up / down, and "make it a task of its own"
      const i=items.indexOf(it), mv=(dir)=>{ const o=items[i+dir]; if(!o) return; const a=t.check, ia=a.indexOf(it), ib=a.indexOf(o); a[ia]=o; a[ib]=it; save(); };
      const up=mk("button","ck-mv","▲"), dn=mk("button","ck-mv","▼"); up.type=dn.type="button";
      up.setAttribute("aria-label","הזז למעלה"); dn.setAttribute("aria-label","הזז למטה"); up.title="למעלה"; dn.title="למטה";
      up.disabled=i===0; dn.disabled=i===items.length-1; up.onclick=()=>mv(-1); dn.onclick=()=>mv(1);
      ctl.append(up,dn);
      if(!it.moved && !it.done){ const pr=mk("button","ck-pro","⤴"); pr.type="button"; pr.title="הפוך למשימה בפני עצמה"; pr.setAttribute("aria-label","הפוך למשימה בפני עצמה");
        pr.onclick=()=>ckToTask(t, it); ctl.appendChild(pr); }
    }
    if(open && isManager()){ const d=mk("button","ck-del","✕"); d.type="button"; d.setAttribute("aria-label","הסר פריט");
      d.onclick=async()=>{ if(!await confirmDel("להסיר פריט מרשימת הבדיקה?", it.text)) return; it.del=true; save(); }; ctl.appendChild(d); }
    box.appendChild(r);
  });
  if(open){
    const r=mk("div","ck ck-add"), o=mk("span","ck-box"), inp=mk("input");
    inp.placeholder = items.length ? "הוסף פריט" : "הוסף רשימת בדיקה"; inp.dataset.draft="ck-"+t.id; inp.setAttribute("aria-label","הוסף פריט לרשימת הבדיקה"); inp.maxLength=300;
    inp.value=tkDraft["ck-"+t.id]||""; inp.oninput=()=>{ tkDraft["ck-"+t.id]=inp.value; };
    inp.onkeydown=e=>{ if(e.key!=="Enter" || e.isComposing) return; e.preventDefault();
      const v=inp.value.trim(); if(!v) return;
      if(!Array.isArray(t.check)) t.check=[];
      t.check.push({id:newId(), text:v, done:false}); delete tkDraft["ck-"+t.id]; save(); };
    r.append(o,inp); box.appendChild(r);
    if(tkFocus==="ck-"+t.id) setTimeout(()=>inp.focus({preventScroll:true}),0);
  }
  c.appendChild(box);
}
/* ================= files on a task =================
   Photos (camera or gallery) and other files. The task keeps a short list (name, type, size, who, when,
   a small preview for photos); the file itself is kept on this device (IndexedDB "ogg-files") and, in
   the team log, in the cloud ("files" — needs the updated security rules; until they are published a
   file stays on the device that added it and is sent later). Photos are shrunk (≤1600px JPEG);
   other files up to 700KB for now — bigger storage comes later. */
const FDB={p:null};
function fdb(){ return FDB.p || (FDB.p=new Promise((res,rej)=>{ const r=indexedDB.open("ogg-files",1);
  r.onupgradeneeded=()=>r.result.createObjectStore("f"); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
async function fPut(id,rec){ const db=await fdb(); return new Promise((res,rej)=>{ const tx=db.transaction("f","readwrite"); tx.objectStore("f").put(rec,id); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
async function fGet(id){ try{ const db=await fdb(); return await new Promise(res=>{ const r=db.transaction("f").objectStore("f").get(id); r.onsuccess=()=>res(r.result||null); r.onerror=()=>res(null); }); }catch(e){ return null; } }
window.fGet=fGet; window.fPut=fPut;
const F_MAX=700*1024;
const readDataURL=f=>new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(f); });
function shrinkImage(file, max, q){ return new Promise((res,rej)=>{ const img=new Image(), url=URL.createObjectURL(file);
  img.onload=()=>{ const k=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)), c=document.createElement("canvas");
    c.width=Math.max(1,Math.round(img.naturalWidth*k)); c.height=Math.max(1,Math.round(img.naturalHeight*k));
    const g=c.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height);
    URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg",q)); };
  img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error("img")); }; img.src=url; }); }
const kb=n=>n>=1048576 ? (n/1048576).toFixed(1)+"MB" : Math.max(1,Math.round(n/1024))+"KB";
const fIcon=m=>/pdf/.test(m.type)?"📄":/sheet|excel|csv/.test(m.type)?"📊":/word|document/.test(m.type)?"📝":/^image\//.test(m.type)?"🖼":/^video\//.test(m.type)?"🎬":"📎";
async function addFiles(t, list, fromCam){
  const out=await storeFiles(list, fromCam);
  if(!out.length) return;
  if(!Array.isArray(t.files)) t.files=[]; t.files.push(...out);
  tkLog(t, out.length===1 ? "צורף קובץ: "+out[0].name : "צורפו "+out.length+" קבצים: "+out.map(x=>x.name).join(", "), "", true);
  t.upd=new Date().toISOString(); saveTasks(); toast(out.length===1 ? "הקובץ צורף" : "צורפו "+out.length+" קבצים");
}
/* a picture is made smaller (and gets a thumbnail); other files up to F_MAX. The data goes to this device's store and to the cloud
   ("files"); what is returned (name, type, size, thumbnail…) is kept on the task or event */
async function storeFiles(list, fromCam){
  const out=[];
  for(const f of list){
    try{
      let data, type=f.type||"application/octet-stream", name=f.name||"קובץ", thumb="";
      if(/^image\//.test(type) && !/svg|gif/.test(type)){
        for(const [mx,q] of [[1600,.78],[1280,.7],[1024,.62],[800,.55]]){ data=await shrinkImage(f,mx,q); if(data.length<900000) break; }
        thumb=await shrinkImage(f,180,.6); type="image/jpeg";
        name = fromCam || /^image(\.|$)/i.test(name) ? "צילום "+nowLocal().replace("T"," ").slice(0,16).replace(/:/g,"-")+".jpg" : name.replace(/\.[^.]+$/,"")+".jpg";
      } else {
        if(f.size>F_MAX){ toast("\""+name+"\" גדול מדי ("+kb(f.size)+") — בינתיים עד 700KB"); continue; }
        data=await readDataURL(f);
      }
      const id=newId(), size=Math.round((data.length-data.indexOf(",")-1)*0.75);
      await fPut(id,{data,name,type,up:false});
      const meta={id,name,type,size,by:reporter()||"",at:nowLocal(),...(thumb?{thumb}:{})};
      out.push(meta);
      if(window.cloudPutFile) window.cloudPutFile(id);
    }catch(e){ toast("לא הצלחתי לקרוא את \""+(f.name||"הקובץ")+"\""); }
  }
  return out;
}
async function fileRec(m){
  let rec=await fGet(m.id);
  if(!rec && window.cloudGetFile){ rec=await window.cloudGetFile(m.id); if(rec){ rec.up=true; try{ await fPut(m.id,rec); }catch(e){} } }
  return rec;
}
// files come from other devices, so the type is never taken on trust: only pictures, PDF and plain text keep theirs —
// anything else (HTML, SVG, scripts…) becomes a plain download, so a file can't run inside the app
function safeType(t){ t=String(t||"").toLowerCase().split(";")[0].trim();
  return /^image\/(jpeg|png|gif|webp|heic|heif|bmp)$/.test(t) ? t : t==="application/pdf" ? t : /^text\/(plain|csv)$/.test(t) ? "text/plain" : "application/octet-stream"; }
function dataToBlob(d){ const i=d.indexOf(","), meta=d.slice(5,i), bin=atob(d.slice(i+1)), u=new Uint8Array(bin.length);
  for(let k=0;k<bin.length;k++) u[k]=bin.charCodeAt(k); return new Blob([u],{type:safeType(meta)}); }
async function openFile(m){
  const rec=await fileRec(m);
  if(!rec){ toast(CLOUD_ON ? "הקובץ עדיין לא זמין — הוא שמור רק במכשיר שהוסיף אותו" : "הקובץ לא נמצא במכשיר הזה"); return; }
  const url=URL.createObjectURL(dataToBlob(rec.data));
  const ty=safeType(rec.data.slice(5,rec.data.indexOf(",")));
  if(/^image\//.test(ty)){
    $("#imgView").src=url; $("#imgView").alt=m.name; $("#imgName").textContent=m.name+" · "+kb(m.size)+(m.by?" · "+m.by:"")+(m.at?" · "+fmtWhen(m.at):"");
    $("#imgDl").href=url; $("#imgDl").download=m.name; $("#dlgImg").showModal();
    $("#dlgImg").addEventListener("close",()=>setTimeout(()=>URL.revokeObjectURL(url),500),{once:true});
  } else {
    const a=document.createElement("a"); a.href=url; a.download=m.name;
    if(ty==="application/pdf" || ty==="text/plain"){ a.target="_blank"; a.rel="noopener"; a.removeAttribute("download"); }
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
}
$("#imgClose").onclick=()=>$("#dlgImg").close();
function renderFiles(t, c){
  const fs=(t.files||[]).filter(x=>x && !x.del), open=tkOpen(t);
  if(!fs.length && !open) return;
  const box=mk("div","tk-files"+(fs.length?"":" none"));
  if(fs.length) box.appendChild(mk("div","tk-files-h","📎 קבצים ("+fs.length+")"));
  const grid=mk("div","tk-fgrid");
  fs.forEach(m=>{
    const b=mk("button","tk-file"+(m.thumb?" img":"")); b.type="button"; b.title=m.name+" · "+kb(m.size||0)+(m.by?" · "+m.by:"");
    if(m.thumb && /^data:image\/(jpeg|png|webp);base64,/.test(m.thumb)){ const im=mk("img"); im.src=m.thumb; im.alt=m.name; im.loading="lazy"; b.appendChild(im); }
    else b.append(mk("span","tf-ic",fIcon(m)), mk("span","tf-n",m.name));
    b.onclick=()=>openFile(m);
    if(open && isManager()){ const d=mk("span","tf-del","✕"); d.setAttribute("role","button"); d.setAttribute("aria-label","הסר את "+m.name);
      d.onclick=async ev=>{ ev.stopPropagation(); if(!await confirmDel("להסיר את הקובץ מהמשימה?", m.name)) return;
        m.del=true; tkLog(t,"הוסר קובץ: "+m.name,"",true); t.upd=new Date().toISOString(); saveTasks(); };
      b.appendChild(d); }
    grid.appendChild(b);
  });
  if(open){
    // cam: the camera (one shot); "gallery": several pictures at once from the phone's gallery; otherwise any files
    const mkAdd=(label,cam)=>{ const l=mk("label","tk-fadd"), i=mk("input"); i.type="file"; i.hidden=true;
      if(cam===true){ i.accept="image/*"; i.setAttribute("capture","environment"); } else if(cam==="gallery"){ i.accept="image/*"; i.multiple=true; } else i.multiple=true;
      i.onchange=()=>{ const fl=[...i.files]; i.value=""; if(fl.length) addFiles(t,fl,cam); };
      l.append(label,i); return l; };
    var btns=mk("div","tk-fbtns"); btns.append(mkAdd("📷 צילום",true), mkAdd("📎 קובץ",false), mkAdd("🖼 תמונות",'gallery'));
  }
  if(fs.length) box.appendChild(grid);
  if(btns) box.appendChild(btns);
  c.appendChild(box);
}
// team log: files that are still only on this device (rules not published yet, or offline) — send them
window.filesRetry=async()=>{ if(!window.cloudPutFile) return;
  for(const t of tasks) for(const m of (t.files||[])){ if(!m || m.del) continue; const r=await fGet(m.id); if(r && !r.up) window.cloudPutFile(m.id); } };
/* update log: time, who, what — the last 3 lines (all on demand). "+ עדכון" under the log opens a short form. */
let tkUpdFor=null;
function renderLog(t, c){
  const log=(t.log||[]).slice().sort((x,y)=>String(x.at).localeCompare(String(y.at)));
  const open=tkOpen(t);
  if(!log.length && !open) return;
  const box=mk("div","tk-log");
  if(log.length){
    const all=tkOpenLogs.has(t.id), show=all ? log : log.slice(-3);
    const head=mk("div","tk-log-h","יומן עדכונים ("+log.length+")");
    if(log.length>3){ const b=mk("button","tk-more", all ? "הצג פחות" : "הצג את כל "+log.length);
      b.type="button"; b.onclick=()=>{ all ? tkOpenLogs.delete(t.id) : tkOpenLogs.add(t.id); renderTasks(); }; head.appendChild(b); }
    box.appendChild(head);
    show.forEach(l=>{
      const r=mk("div","tk-le"+(l.sys?" sys":""));
      const x=mk("div","tk-le-x"); if(l.by){ x.appendChild(mk("b",null,l.by+": ")); } x.append(l.text);
      if(l.mail) x.title=l.mail;
      r.append(x, mk("span","tk-le-t",fmtWhen(l.at).replace(/\/\d{4}/,"")));
      box.appendChild(r);
    });
  }
  if(open && tkUpdFor===t.id){
    const f=mk("div","tk-upd");
    const ta=mk("textarea"); ta.rows=2; ta.placeholder="מה התחדש? מה נעשה עכשיו?"; ta.dataset.draft=t.id; ta.value=tkDraft[t.id]||"";
    ta.oninput=()=>{ tkDraft[t.id]=ta.value; };
    const row=mk("div","tk-upd-row");
    // team log: the signed-in user is the reporter (no choice); this device: pick who reports (required)
    const auto = window.cloudMe && window.cloudMe();
    const who=mk("select"); fillSelect(who, pplValues(), reporter(), "— מי מדווח? —");
    const whoTxt=mk("span","tk-upd-who","מדווח: "+reporter());
    const ok=mk("button","btn primary tk-send"), no=mk("button","btn ghost","ביטול"); ok.type=no.type="button";
    ok.setAttribute("aria-label","שלח עדכון"); ok.title="שלח עדכון";   // a paper plane, like sending a message (points left — Hebrew reads right to left)
    ok.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/></svg>';
    ok.onclick=()=>{
      const txt=ta.value.trim(); if(!txt){ toast("כתוב מה התחדש"); ta.focus(); return; }
      const by = auto ? reporter() : who.value;
      if(!by){ toast("בחר מי מדווח"); who.focus(); return; }
      if(!auto) try{ localStorage.setItem(K_REPORTER,by); }catch(e){}
      tkLog(t, txt, by); if(tkStat(t)==="פתוחה") t.status="בטיפול";   // an update on a waiting task leaves it waiting
      delete tkDraft[t.id]; t.upd=new Date().toISOString(); tkUpdFor=null; saveTasks(); toast("העדכון נוסף");
    };
    no.onclick=()=>{ delete tkDraft[t.id]; tkUpdFor=null; renderTasks(); };
    row.append(auto ? whoTxt : who, no, ok); f.append(ta,row); box.appendChild(f);   // the plane at the far end, like a chat
    setTimeout(()=>{ ta.focus({preventScroll:tkFocus===t.id}); ta.setSelectionRange(ta.value.length,ta.value.length); },50);
  } else if(open){
    const u=mk("button","btn upd tk-upd-btn","✎ עדכון"); u.type="button";
    u.onclick=()=>{ tkUpdFor=t.id; renderTasks(); };
    box.appendChild(u);
  }
  c.appendChild(box);
}
// everything a search can find in a task: title, description, people, places, equipment, departments, updates, checklist
/* tasks shown like the events list: "אריחים" (cards) or "רשימה" (a line each), and "ייצוא לאקסל" of what is shown */
let tkLV="tiles", tkLastRows=[]; const tkRowOpen=new Set();
try{ tkLV=localStorage.getItem("ogg-tk-view")==="rows" ? "rows" : "tiles"; }catch(e){}
function paintTkLV(){ $("#viewTasks").classList.toggle("rows",tkLV==="rows");
  document.querySelectorAll("#tkListView button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.v===tkLV))); }
document.querySelectorAll("#tkListView button").forEach(b=>b.onclick=()=>{ tkLV=b.dataset.v; try{ localStorage.setItem("ogg-tk-view",tkLV); }catch(e){} paintTkLV(); });
paintTkLV();
function exportTasksCsv(rows){
  rows = rows && rows.length ? rows : tasks;
  const head=["מס'","קבצים","כותרת","סטטוס","עדיפות","קטגוריה","אחראי","משויכים","מחלקות","מיקום","ציוד","תאריך התחלה","תאריך יעד","מחזוריות","רשימת בדיקה","תיאור","עדכונים","נפתחה","הושלמה","נסגרה על ידי","מה בוצע"];
  const esc=csvEsc;
  const body=rows.map(t=>{ const ck=(t.check||[]).filter(x=>x&&!x.del);
    return [t.no||"", (t.files||[]).filter(x=>x&&!x.del).map(x=>x.name).join("; "), t.title||"", t.status||"", prioOf(t), t.type||"", (t.ppl||[])[0]||"", (t.ppl||[]).slice(1).join("; "), (t.depts||[]).join("; "),
      (t.loc||[]).join("; "), (t.eq||[]).join("; "), dmy(t.start||""), dmy(t.due||""), t.rep?repLabel(t.rep):"",
      ck.length ? ck.filter(x=>x.done).length+"/"+ck.length+" — "+ck.map(x=>(x.done?"✓ ":"○ ")+x.text).join("; ") : "",
      t.desc||"", (t.log||[]).slice().sort((x,y)=>String(x.at).localeCompare(String(y.at))).map(l=>fmtWhen(l.at)+" "+(l.by?l.by+": ":"")+l.text).join("\n"),
      t.created?fmtWhen(t.created):"", t.doneAt?fmtWhen(t.doneAt):"", t.doneBy||"", t.act||""].map(esc).join(","); });
  download("משימות-אוג.csv",[head.map(esc).join(",")].concat(body).join("\r\n"),"text/csv;charset=utf-8");
  toast(rows.length+" משימות הורדו");
}
$("#tkExp").onclick=()=>exportTasksCsv(tkLastRows);
function tkText(t){ return [snOf(t),t.title,t.desc,t.act,t.type,t.prio,(t.ppl||[]).join(" "),(t.loc||[]).join(" "),(t.eq||[]).join(" "),(t.depts||[]).join(" "),
  (t.log||[]).map(l=>(l.by||"")+" "+(l.text||"")).join(" "),(t.check||[]).filter(x=>x&&!x.del).map(x=>x.text).join(" "),(t.files||[]).filter(x=>x&&!x.del).map(x=>x.name).join(" ")].join(" ").toLowerCase(); }
function renderTasks(){
  reconcileTaskEvents();
  const ae=document.activeElement; tkFocus = ae && ae.dataset && ae.dataset.draft || null;   // typing in a task's message box
  paintTaskCount(); renderTkFilters(); paintMe();
  if(!$("#viewDash").hidden && typeof renderDash==="function") setTimeout(renderDash,0);   // keep the tasks card current
  if(!$("#viewCal").hidden && typeof renderCal==="function") setTimeout(renderCal,0);
  const box=$("#tkList"); if(!box) return; box.textContent="";
  const today=ymd(new Date());
  const pass=t=>(!tkF.ppl || (t.ppl||[]).includes(tkF.ppl)) && (!tkF.loc || (t.loc||[]).includes(tkF.loc))
             && (!tkF.type || tkCatPicked().includes(t.type)) && (!tkF.prio || prioOf(t)===tkF.prio)
             && (!tkF.late || (t.due && t.due<today)) && (!tkF.dept || tkInDept(t,tkF.dept)) && (!tkF.rep || !!(t.rep || (t.hrs && t.hrs.every>0)))
             && (!tkF.q || tkText(t).includes(tkF.q.trim().toLowerCase()));
  const rows = tkView==="priv" ? [] : (tkView!=="done"
    ? tkVis().filter(t=>tkOpen(t) && (tkView!=="mine" || isMine(t)) && (tkView!=="opened" || openedByMe(t))).sort((a,b)=>{
        const na=tkIsNew(a), nb=tkIsNew(b); if(na!==nb) return na ? -1 : 1;                     // new ones first
        return na ? String(b.created).localeCompare(String(a.created)) : tkCmp()(a,b); })
    : tkVis().filter(t=>!tkOpen(t)).sort((a,b)=>String(b.doneAt||"").localeCompare(String(a.doneAt||"")))), shown=rows.filter(pass);
  $("#tkResCount").textContent = shown.length===rows.length ? nf(rows.length)+" משימות" : nf(shown.length)+" מתוך "+nf(rows.length);
  { // personal tasks (🔒): their own view; filters that only team tasks have (person, place, type, department) leave them out
    const pv=tkView==="priv" ? privTasks() : [];   // personal tasks only under "אישיות": all of mine, open first
    const pPass=t=>!tkF.rep && (tkView==="priv" || !tkF.ppl && !tkF.loc && !tkF.type && !tkF.dept) && (!tkF.prio || prioOf(t)===tkF.prio) && (!tkF.late || (t.due && t.due<today))
      && (!tkF.q || [t.title,t.desc].concat(t.check.map(x=>x.text)).join(" ").toLowerCase().includes(tkF.q.trim().toLowerCase()));
    if(pv.length){ const cmp = tkView==="priv" ? (a,b)=>(tkOpen(b)-tkOpen(a)) || (tkOpen(a) ? tkCmp()(a,b) : String(b.doneAt||"").localeCompare(String(a.doneAt||""))) : tkView==="done" ? (a,b)=>String(b.doneAt||"").localeCompare(String(a.doneAt||"")) : (a,b)=>{ const na=tkIsNew(a), nb=tkIsNew(b); if(na!==nb) return na ? -1 : 1; return tkCmp()(a,b); };
      rows.push(...pv); shown.push(...pv.filter(pPass)); shown.sort(cmp);
      $("#tkResCount").textContent = shown.length===rows.length ? nf(rows.length)+" משימות" : nf(shown.length)+" מתוך "+nf(rows.length); }
  }
  if(tkColOn()) shown.sort(tkColCmp());   // "רשימה": a column heading was tapped — that order wins
  rows.length=0; rows.push(...shown); tkLastRows=shown.filter(t=>!t.priv);
  if(!rows.length){ box.appendChild(mk("div","tk-empty", tkView!=="priv" && Object.values(tkF).some(Boolean) ? "אין משימות שמתאימות לסינון." :
    tkView==="mine" ? (myName() ? "אין משימות פתוחות שלך או של המחלקה שלך." : (window.cloudMe ? "המנהל עדיין לא הגדיר לך שם בצוות." : "בחר למעלה \"אני:\" כדי לראות את המשימות שלך.")) : tkView==="opened" ? "אין משימות פתוחות שפתחת." : tkView==="priv" ? "אין לך משימות אישיות — \"משימה חדשה\" → אישית 🔒." : tkView==="open" ? "אין משימות פתוחות." : "עדיין לא הושלמו משימות.")); return; }
  // "רשימה" on a wide screen: a header row naming the columns (hidden on cards / phones by CSS)
  { const h=mk("div","tk-head");   // a tap on a heading sorts by that column: once up, again down, a third time back to the usual order
    TK_COLS.forEach(([k,x])=>{ const on=tkCol && tkCol.k===k, b=mk("button","tk-th"+(on?" on":""),x+(on?(tkCol.d>0?" ▲":" ▼"):"")); b.type="button";
      b.title="מיון לפי "+x; b.setAttribute("aria-sort", on ? (tkCol.d>0?"ascending":"descending") : "none");
      b.onclick=()=>{ if(Date.now()-tkResizeAt<400) return; tkCol = !on ? {k,d:1} : tkCol.d>0 ? {k,d:-1} : null; try{ localStorage.setItem("ogg-tk-col", JSON.stringify(tkCol)); }catch(e){} renderTasks(); };
      if(k!=="ppl"){ const rs=mk("span","tk-rs"); rs.title="גרירה — רוחב העמודה · לחיצה כפולה — חזרה לרוחב הרגיל"; rs.setAttribute("aria-hidden","true");
        rs.onclick=ev=>ev.stopPropagation(); rs.ondblclick=ev=>{ ev.stopPropagation(); delete tkColW[k]; tkColWSave(); };
        rs.onpointerdown=ev=>tkColDrag(ev,k,b); b.appendChild(rs); }
      h.appendChild(b); }); box.appendChild(h); }
  rows.forEach(t=>{
    if(t.priv){ box.appendChild(privCard(t, today)); return; }
    const pr=prioOf(t), ph=PRIO_HUE[pr];
    const c=mk("div","tk"+(tkOpen(t)?"":" done")+(tkRowOpen.has(t.id)?" x":"")); c.dataset.id=t.id;
    tkBg(t, c);   // cards: the task's first photo shows faintly behind it
    // "רשימה": one compact line per task; a tap opens it in full (and closes it again)
    c.addEventListener("click",ev=>{ if((tkLV!=="rows" && !isLite()) || c._swiped || ev.target.closest("button,input,textarea,select,a,label,.tk-log,.tk-check,.tk-files,.qk")) return;
      tkRowOpen.has(t.id) ? tkRowOpen.delete(t.id) : tkRowOpen.add(t.id); c.classList.toggle("x"); }); c.style.borderInlineStartColor = tkOpen(t) && !t.due ? "var(--c-"+ph+")" : "";
    if(tkOpen(t) && t.due) c.classList.add(t.due<today?"tl-late":t.due===today?"tl-today":"tl-future");   // the whole frame in the traffic-light colour of the due date
    if(tkOpen(t) && (pr==="גבוהה" || pr==="דחופה")) c.classList.add("tk-blink", pr==="דחופה" ? "hot" : "high");   // high and urgent: the whole task pulses red
    const tx=mk("span","tk-tt",t.title||"(ללא כותרת)");
    { const tt=mk("div","tk-t"); tt.appendChild(tkCircle(t, ()=>tkOpen(t) ? openTaskDone(t.id) : reopenTask(t))); if(t.no) tt.appendChild(mk("span","sn","#"+t.no));
      (t.eq||[]).forEach(q=>{ const g=mk("span","tk-eqtag eqc","⚙ "+q); g.title="ציוד"; eqPaint(g,q); tx.appendChild(g); });   // the equipment, right by the title
      tt.appendChild(tx); if(tkOpen(t) && !isViewer()) tt.appendChild(remBell(t));
      if(tkOpen(t) && t.due){ const d=mk("span","lite-due "+(t.due<today?"late":t.due===today?"today":"future"), t.due<today?"באיחור · "+dmy(t.due).slice(0,5):t.due===today?"היום":dmy(t.due).slice(0,5)); tt.appendChild(d); }
      c.appendChild(tt);
      { const ci=(t.check||[]).filter(x=>x && !x.del), L=t.hrs ? hrsLeft(t) : null;   // phone: one quiet line under the title
        const sub=[(t.depts||[])[0] ? deptIcon(t.depts[0])+" "+t.depts[0] : "", t.type||"", prioOf(t)!=="רגילה" ? prioOf(t) : "", tkStat(t)!=="פתוחה" && tkOpen(t) ? tkStat(t) : "",
          L!==null ? "⏱ "+(L<=0?"עבר ב-"+nf(-L):"עוד "+nf(L))+" ש'" : "", t.rep ? "🔁 "+repLabel(t.rep) : "", ci.length ? "☑ "+ci.filter(x=>x.done).length+"/"+ci.length : "",
          !tkOpen(t) ? "הושלמה "+(t.doneAt?fmtWhen(t.doneAt).slice(0,5):"") : ""].filter(Boolean).join(" · ");
        if(sub) c.appendChild(mk("div","lite-sub",sub)); } }   // number and text side by side: a wrapped line starts under the text, not under the number   // number and text side by side: a wrapped line starts under the text, not under the number
    // tags sit in fixed slots, so in "רשימה" every kind lines up in its own column (in "אריחים" the slots just flow)
    const tags=mk("div","tk-tags"), SL={}; ["eq","who","dept","prio","type","stat","extra","due"].forEach(k=>{ SL[k]=mk("span","sl sl-"+k); tags.appendChild(SL[k]); });
    const tag=(txt,cls,hue,slot)=>{ const x=mk("span","tk-tag"+(cls?" "+cls:""),txt);
      if(hue){ x.style.background="var(--c-"+hue+"-bg)"; x.style.color="var(--c-"+hue+")"; x.style.borderColor="transparent"; } SL[slot||"extra"].appendChild(x); };
    (t.eq||[]).forEach(q=>{ tag("⚙ "+q,"eqt eqc",null,"eq"); eqPaint(SL.eq.lastChild,q); });   // each piece of equipment its own colour          // equipment: its own column in "רשימה" (by the title on cards)
    if(tkOpen(t)){
      if(tkIsNew(t)){ tag("✨ חדשה","new",null,"who"); if(!$("#viewTasks").hidden) tkShownNew.add(t.id); }
      if(isMine(t)) tag((t.ppl||[]).includes(myName()) ? "שלי" : "המחלקה שלי","me",null,"who");
      else if(openedByMe(t)) tag("פתחתי","me",null,"who");
      (t.depts||[]).forEach(d=>tag(deptIcon(d)+" "+d,"dept",null,"dept"));
      if(pr!=="רגילה") tag(pr,"",ph,"prio");
      if(t.type) tag(t.type,"",hueOf(t.type),"type");
      if(t.status==="בטיפול") tag("בטיפול","w",null,"stat");
      if(tkStat(t)==="בהמתנה") tag("⏸ בהמתנה","hold",null,"stat");
      if(t.rep) tag("🔁 "+repLabel(t.rep),"rep");
      if(t.hrs && !(t.hrs.every>0)) tag("⏱ "+nf(t.hrs.cur)+" ש'","hrs meter",null,"extra");   // a meter, no cycle
      else if(t.hrs){ const L=hrsLeft(t), w=L<=0 ? "late" : L<=t.hrs.every*.1 ? "soon" : "ok";
        tag(L<=0 ? "⏱ עבר ב-"+nf(-L)+" ש'" : "⏱ עוד "+nf(L)+" ש'","hrs "+w,null,"extra");
        const el=SL.extra.lastChild; el.title="מונה: "+nf(t.hrs.cur)+" ש' ("+dmy(t.hrs.at).slice(0,5)+") · טיפול ב-"+nf(t.hrs.base+t.hrs.every)+" ש' · כל "+nf(t.hrs.every)+" ש'"; }
      { const nf_=(t.files||[]).filter(x=>x&&!x.del).length; if(nf_) tag("📎 "+nf_); }
      { const ci=(t.check||[]).filter(x=>x && !x.del); if(ci.length) tag("☑ "+ci.filter(x=>x.done).length+"/"+ci.length, ci.every(x=>x.done)?"ok":""); }
      if(t.start && t.start>today) tag("מתחילה "+dmy(t.start).slice(0,5),"",null,"due");
      if(t.due) tag((t.due<today?"באיחור · ":t.due===today?"היום · ":"יעד ")+dmy(t.due).slice(0,5), t.due<today?"late":t.due===today?"today":"future", null, "due");
    } else {
      tag("הושלמה "+(t.doneAt?fmtWhen(t.doneAt).slice(0,10):"")+(t.doneBy?" · "+t.doneBy:""),"ok",null,"due");
      if(t.type) tag(t.type,"",hueOf(t.type),"type");
      if(t.eventId && events.some(e=>e.id===t.eventId)) tag("נרשמה ביומן");
    }
    if(tkOpen(t) && !isViewer()){   // tap a tag (or its empty column in "רשימה") to change just that — status, dates, people, equipment, type…
      const QS={eq:["eq"], who:["ppl","depts"], dept:["depts"], prio:["prio"], type:["type"], stat:["status"], due:["start","due"]};
      Object.keys(QS).forEach(k=>{ const el=SL[k]; el.classList.add("qk"); el.title="לחץ לשינוי";
        el.onclick=ev=>{ ev.stopPropagation(); qkOpen(t, QS[k]); }; });
      tx.querySelectorAll(".tk-eqtag").forEach(g=>{ g.classList.add("qk"); g.onclick=ev=>{ ev.stopPropagation(); qkOpen(t,["eq"]); }; });
    }
    if(tags.querySelector(".tk-tag:not(.eqt)") || $("#viewTasks").classList.contains("rows")) c.appendChild(tags);
    const pn=n=>n;   // the worker's name only — department and role are in their own columns
    const meta=[(t.ppl||[]).length ? "👤 "+(t.ppl.length>1 ? "אחראי: "+pn(t.ppl[0])+" · משויכים: "+t.ppl.slice(1).join(", ") : pn(t.ppl[0])) : "", (t.loc||[]).length?"📍 "+t.loc.join(", "):"", (t.eq||[]).length?"⚙ "+t.eq.join(", "):""].filter(Boolean).join("   ");
    if(meta){ const m=mk("div","tk-m",meta); c.appendChild(m);
      if(tkOpen(t) && !isViewer()){ m.classList.add("qk"); m.title="לחץ לשינוי"; m.onclick=ev=>{ ev.stopPropagation(); qkOpen(t,["ppl","loc"]); }; } }
    if(t.desc) c.appendChild(mk("div","tk-d",t.desc));
    renderCheck(t, c);
    renderFiles(t, c);
    if(!tkOpen(t) && t.act) c.appendChild(mk("div","tk-d","בוצע: "+t.act));
    renderLog(t, c);
    // one visible action ("✓ השלם", or "↩ פתח מחדש"); the rest wait in "⋯" so the card stays quiet
    const acts=mk("div","tk-acts"), more=[], btn=(label,cls,fn)=>{
      if(cls==="primary" || cls==="keep"){ const b=mk("button","btn"+(cls==="primary"?" primary":""),label); b.type="button"; b.onclick=fn; acts.appendChild(b); }
      else more.push([label,cls,fn]); };
    if(tkOpen(t)){
      btn(t.status==="בטיפול"?"החזר לפתוחה":"בטיפול","",()=>{ t.status = t.status==="בטיפול" ? "פתוחה" : "בטיפול";
        tkLog(t, t.status==="בטיפול" ? "הועברה לטיפול" : "הוחזרה לפתוחה", "", true); t.upd=new Date().toISOString(); saveTasks(); });
      // בהמתנה: the task is waiting (a part, an approval, a contractor…) — set aside without closing it
      btn(tkStat(t)==="בהמתנה"?"▶ שחרר מהמתנה":"⏸ בהמתנה","",()=>{ t.status = tkStat(t)==="בהמתנה" ? "פתוחה" : "בהמתנה";
        tkLog(t, t.status==="בהמתנה" ? "הועברה להמתנה" : "שוחררה מהמתנה", "", true); t.upd=new Date().toISOString(); saveTasks(); });
      btn("ערוך","",()=>openTaskForm(t.id));
      if(!isViewer()) btn("⧉ שכפל","",()=>dupTask(t.id));
      if(t.hrs && !isViewer()) btn("⏱ קריאת מונה","keep",()=>hrsAsk(t));   // at the machine: one tap, type the number
    } else if(!isViewer()){
      // a completed task can be reopened (its event in the log reopens with it) and edited
      btn("↩ פתח מחדש","keep",()=>reopenTask(t));
      btn("ערוך","",()=>openTaskForm(t.id));
      btn("⧉ שכפל","",()=>dupTask(t.id));
    }
    // a team task that turns out to be only mine: move it to my personal (🔒) tasks — it leaves the team board (so: managers, like deleting)
    if(tkOpen(t) && isManager() && !isViewer()) btn("🔒 העבר לאישית","",()=>{
      const who=(t.ppl||[]).filter(n=>n!==myName());
      if(!confirm("להעביר את המשימה למשימות האישיות שלך?\n"+(t.title||"")+"\n\nהיא תוסר מלוח המשימות של הצוות"+(who.length?" (גם אצל "+who.join(", ")+")":"")+", ורק אתה תראה אותה. אם תסיים אותה — היא לא תירשם ביומן.")) return;
      const now=new Date().toISOString(), items=meGet();
      items.unshift({id:newId(), title:t.title||"", desc:t.desc||"", prio:prioOf(t), start:t.start||"", due:t.due||"",
        check:(t.check||[]).filter(x=>x && !x.del).map(x=>({id:newId(), text:x.text, done:!!x.done})), done:false, at:nowLocal(), created:now, upd:now, fromTask:t.id});
      mePut(items);
      tasks=tasks.filter(x=>x.id!==t.id); saveTasks(); renderTasks();
      toast("הועברה למשימות האישיות שלך 🔒");
    });
    if(isManager()) btn("מחק","ghost",async()=>{
      if(!await confirmDel("למחוק את המשימה?", (t.title||"")+((t.log||[]).length?"\nכולל יומן העדכונים ("+t.log.length+")":"")+(t.eventId?"\nהאירוע שנרשם ביומן נשאר.":"")+(CLOUD_ON?"\nהמשימה תימחק לכל הצוות.":""))) return;
      binAdd("t",t); tasks=tasks.filter(x=>x.id!==t.id); saveTasks(); toast("המשימה נמחקה — אפשר לשחזר מסל המיחזור (30 יום)");
    });
    if(tkOpen(t) && !isViewer()){                       // adding things to the task: photo, file, checklist
      const ins=c.querySelectorAll(".tk-fadd input");
      if(ins[0]) more.unshift(["📷 צילום","",()=>ins[0].click()]);
      if(ins[1]) more.unshift(["📎 קובץ","",()=>ins[1].click()]);
      if(ins[2]) more.unshift(["🖼 כמה תמונות","",()=>ins[2].click()]);
      if(!(t.check||[]).some(x=>x && !x.del)) more.unshift(["☑ רשימת בדיקה","",()=>{ tkCkOn.add(t.id); c.classList.add("ck-on");
        const i=c.querySelector(".ck-add input"); if(i) i.focus(); }]);
    }
    if(!isViewer()) more.push(["שלח בוואטסאפ","wa",()=>tkWhatsApp(t)]);
    if(tkCkOn.has(t.id)) c.classList.add("ck-on");
    // "+ עדכון" joins the action line (next to "✓ השלם"); an update log with nothing else in it then goes
    const ub=c.querySelector(".tk-upd-btn"); if(ub){ const lb=ub.parentNode; acts.appendChild(ub); if(lb && !lb.children.length) lb.remove(); }
    if(more.length){
      const mb=mk("button","btn tk-more-b","⋯"); mb.type="button"; mb.title="פעולות נוספות"; mb.setAttribute("aria-label","פעולות נוספות"); mb.setAttribute("aria-expanded","false");
      const menu=mk("div","tk-more"); menu.hidden=true;
      more.forEach(([label,cls,fn])=>{ const b=mk("button","btn"+(cls?" "+cls:""),label); b.type="button"; b.onclick=()=>{ menu.hidden=true; mb.setAttribute("aria-expanded","false"); fn(); }; menu.appendChild(b); });
      mb.onclick=()=>{ menu.hidden=!menu.hidden; mb.setAttribute("aria-expanded",String(!menu.hidden)); };
      acts.append(mb, menu);
    }
    c.appendChild(acts); box.appendChild(c);
  });
}
const tkCkOn=new Set();
/* a task as a WhatsApp message (the person picks the chat): number, title, who, due, priority, place, description, checklist,
   and a link that opens the task in the app (always the regular address, also when sent from the beta) */
function tkWhatsApp(t){
  // plain text + WhatsApp bold (*…*); no emoji — WhatsApp on a computer turns them into "�" when the text comes from a link
  const dm=v=>v ? v.slice(8,10)+"/"+v.slice(5,7) : "", pr=prioOf(t), L=[];
  L.push("*משימה"+(t.no?" #"+t.no:"")+" · "+(t.title||"")+"*");
  if((t.ppl||[]).length) L.push("*אחראי:* "+t.ppl[0]+(t.ppl.length>1?" · *משויכים:* "+t.ppl.slice(1).join(", "):""));
  if((t.depts||[]).length) L.push("*מחלקה:* "+t.depts.join(", "));
  const when=[t.due?"*יעד:* "+dm(t.due):"", pr && pr!=="רגילה" ? "*עדיפות:* "+pr : ""].filter(Boolean).join(" · "); if(when) L.push(when);
  const where=[(t.loc||[]).join(", "),(t.eq||[]).join(", ")].filter(Boolean).join(" · "); if(where) L.push("*מיקום:* "+where);
  if(t.desc){ L.push(""); L.push(t.desc); }
  const ck=(t.check||[]).filter(x=>x && !x.del);
  if(ck.length){ L.push(""); L.push("*רשימת בדיקה:*"); ck.forEach(x=>L.push((x.done?"\u2713 ":"\u2610 ")+x.text)); }
  const base=location.origin+location.pathname.replace(/beta\/(index\.html)?$/,"").replace(/index\.html$/,"");
  L.push(""); L.push("לפתיחה באפליקציה:"); L.push(base+"?app=ogg-log-2&view=Tasks&task="+encodeURIComponent(t.id));
  window.open("https://wa.me/?text="+encodeURIComponent(L.join("\n")),"_blank","noopener");
}                                   // tasks where "☑ רשימת בדיקה" was asked for (the empty list shows)
/* the round "complete" mark at the start of a task: open → tap opens the same completion window as "✓ השלם משימה";
   completed → a filled ✓ (a personal task can be ticked back) */
function tkCircle(t, onDone, priv){
  const open=tkOpen(t), b=mk("button","tk-done-c"+(open?"":" on")); b.type="button";
  b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const can = !(typeof isViewer==="function" && isViewer());
  b.disabled=!can;
  b.title = open ? "השלם משימה" : "הושלמה"+(t.doneBy?" · "+t.doneBy:"")+" — לחיצה מחזירה לפתוחות";
  b.setAttribute("aria-label", b.title);
  b.onclick=ev=>{ ev.stopPropagation(); if(can) onDone(); };
  return b;
}
let tkScope="team", tkEditPriv=null;
function setScope(s){ tkScope=s; $("#tkForm").classList.toggle("priv", s==="me"); $("#tkScopeHint").hidden = s!=="me";
  document.querySelectorAll("#tkScope [data-s]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.s===s)));
  document.querySelectorAll("#tkForm .tk-f.bad").forEach(x=>x.classList.remove("bad"));
  $("#tkSave").textContent = s==="me" ? "שמור משימה אישית" : "שמור משימה"; }
document.querySelectorAll("#tkScope [data-s]").forEach(b=>b.onclick=()=>setScope(b.dataset.s));
/* duplicate: the task form opens as a NEW task filled from this one (title, details, type, priority, people, departments,
   location, equipment, dates, repeat, checklist items unticked) — change what is needed and save; the original stays as it is.
   Files, updates and status are not copied. */
function dupTask(id){ openTaskForm(id, true); }
function openTaskForm(id, copy){
  const pt = id && String(id).startsWith("p:") ? privTasks().find(x=>x.id===id) : null;
  tkEditPriv = pt ? pt.pid : null;
  const t=!pt && id ? tasks.find(x=>x.id===id) : null; tkEdit=t && !copy ? t.id : null;
  const defType="";   // the category is picked each time (required)
  fillSelect($("#tkType"), tkCats(), t ? (t.type||"") : defType, "— בחר קטגוריה —");
  fillSelect($("#tkPrio"), PRIOS, t ? prioOf(t) : "רגילה");
  fillSelect($("#tkPpl"), pplValues(), "", "— הוסף משתמש —", true);
  paintPplChips(t ? (t.ppl||[]) : (tkView==="mine" && myName() ? [myName()] : []));
  fillSelect($("#tkLoc"), byUse("loc"), t ? (t.loc||[])[0]||"" : "", "— בחר מיקום —", true);
  fillSelect($("#tkEq"), byUse("eq"), t ? (t.eq||[])[0]||"" : "", "— בחר ציוד —", true);
  paintDeptChips(t ? (t.depts||[]) : (tkView==="mine" && myDept() && !myName() ? [myDept()] : []));
  $("#tkCkWrap").hidden=false;   // the checklist: new items on a new task; editing a task shows its items and adds more (a manager can also take one out)
  paintFormCk(copy && t ? (t.check||[]).filter(c=>c && !c.del).map(c=>c.text) : [], t && !copy ? (t.check||[]).filter(c=>c && !c.del) : []);
  document.querySelectorAll("#tkForm .tk-f.bad").forEach(x=>x.classList.remove("bad"));
  paintFormColors();
  $("#tkFormTitle").textContent = pt ? "עריכת משימה אישית 🔒" : copy && t ? "משימה חדשה — עותק של "+(snOf(t)||"משימה") : t ? "עריכת משימה" : "משימה חדשה";
  $("#tkTitle").value=t?t.title||"":""; $("#tkDesc").value=t?t.desc||"":"";
  $("#tkDue").value=t?t.due||"":"";
  $("#tkScope").hidden = !!((t && !copy) || pt);                  // a task stays what it was (team or personal)
  setScope(pt || (!t && tkView==="priv") ? "me" : "team");   // from "אישיות" a new task starts as personal
  if(pt){ $("#tkTitle").value=pt.title; $("#tkDesc").value=pt.desc; $("#tkDue").value=pt.due; $("#tkStart").value=pt.start||""; fillSelect($("#tkPrio"), PRIOS, pt.prio); paintFormColors(); $("#tkCkWrap").hidden=true; }
  setRep(t && t.rep, t && t.hrs); repAuto=false;
  $("#tkStart").value=pt ? (pt.start||"") : t && !copy ? (t.start || String(t.created||"").slice(0,10) || ymd(new Date())) : copy && t && t.start && t.start>ymd(new Date()) ? t.start : ymd(new Date());
  if(copy && t && t.due && t.due<$("#tkStart").value) $("#tkDue").value="";       // a copy doesn't start out late
  $("#tkDue").min=$("#tkStart").value;
  $("#tkForm").hidden=false; $("#tkNewBtn").hidden=true;
  // open with the title in view, just below the sticky header; a new task starts in the title
  const hb=document.querySelector("header.bar"), off=(hb && getComputedStyle(hb).position==="sticky" ? hb.getBoundingClientRect().height : 0)+12;
  window.scrollTo({top:$("#tkForm").getBoundingClientRect().top+window.scrollY-off, behavior:"smooth"});
  if(!t || copy) setTimeout(()=>{ const ti=$("#tkTitle"); ti.focus({preventScroll:true}); if(copy) ti.select(); },350);
  if(copy) toast("עותק נפתח — משנים מה שצריך ושומרים כמשימה חדשה");
}
/* "+ אחר…": type a new value; it joins the app's lists (like adding it in settings → lists) */
[["#tkPpl","ppl","שם האחראי"],["#tkLoc","loc","מיקום חדש"],["#tkEq","eq","ציוד חדש"]].forEach(([id,k,label])=>{
  const el=$(id), prev={v:""};
  el.onfocus=()=>{ prev.v=el.value; };
  el.onchange=()=>{
    if(el.value!=="__other"){ prev.v=el.value; return; }
    const v=(prompt(label+":")||"").trim();
    if(!v){ el.value=prev.v; return; }
    if(!lists[k].includes(v)){ lists[k].push(v); if(!lists["_custom_"+k].includes(v)) lists["_custom_"+k].push(v); persist(); }
    const o=mk("option",null,v); o.value=v; el.insertBefore(o, el.lastElementChild); el.value=v; prev.v=v;
  };
});
$("#tkPrio").onchange=$("#tkType").onchange=paintFormColors;
$("#tkStart").addEventListener("change",()=>{ $("#tkDue").min=$("#tkStart").value; });
["#tkType","#tkPrio","#tkPpl","#tkStart","#tkDue","#tkLoc","#tkEq","#tkTitle"].forEach(id=>{
  const clr=()=>{ if($(id).value) $(id).closest(".tk-f").classList.remove("bad"); };
  $(id).addEventListener("change",clr); $(id).addEventListener("input",clr); });
/* assigned users: pick one after another from the list; the first is the responsible one (tap another to make it responsible) */
let tkPplSel=[];
function paintPplChips(sel){
  if(sel) tkPplSel=sel.slice();
  const box=$("#tkPplChips"); box.textContent="";
  tkPplSel.forEach((n,i)=>{
    const c=mk("span","pchip"+(i?"":" lead")), nb=mk("button","pchip-n",(i?"":"★ ")+n+(i?"":" · אחראי"));
    nb.type="button"; nb.title = i ? "הפוך לאחראי" : "אחראי";
    nb.onclick=()=>{ if(!i) return; tkPplSel.splice(i,1); tkPplSel.unshift(n); paintPplChips(); };
    const x=mk("button","pchip-x","✕"); x.type="button"; x.setAttribute("aria-label","הסר את "+n);
    x.onclick=()=>{ tkPplSel.splice(i,1); paintPplChips(); };
    c.append(nb,x); box.appendChild(c);
  });
  box.hidden=!tkPplSel.length;
}
$("#tkPpl").addEventListener("change",()=>{
  const el=$("#tkPpl"), v=el.value; if(!v || v==="__other") return;
  if(!tkPplSel.includes(v)) tkPplSel.push(v);
  el.value=""; paintPplChips(); el.closest(".tk-f").classList.remove("bad"); $("#tkDepts").closest(".tk-f").classList.remove("bad");
});
/* checklist in the new-task form: type an item + Enter; ✕ takes it out (nothing is saved until "שמור משימה") */
let tkCkSel=[], tkCkOld=[], tkCkGone=new Set();   // new item texts · the task's items (editing) · items a manager took out in the form
function paintFormCk(sel, old){
  if(sel) tkCkSel=sel.slice();
  if(old){ tkCkOld=old.slice(); tkCkGone=new Set(); }
  const box=$("#tkCk"); box.textContent="";
  tkCkOld.forEach(c=>{ const gone=tkCkGone.has(c.id), r=mk("div","ck"+(c.done?" done":"")+(gone?" gone":""));
    const o=mk("span","ck-box"+(c.done?" on":"")); if(c.done) o.textContent="✓";
    r.append(o, mk("span","ck-t",c.text));
    if(isManager()){ const d=mk("button","ck-del",gone?"↩":"✕"); d.type="button"; d.style.opacity="1"; d.setAttribute("aria-label",gone?"החזר פריט":"הוצא פריט");
      d.onclick=()=>{ gone ? tkCkGone.delete(c.id) : tkCkGone.add(c.id); paintFormCk(); }; r.appendChild(d); }
    box.appendChild(r); });
  tkCkSel.forEach((v,i)=>{
    const r=mk("div","ck"), o=mk("span","ck-box"), x=mk("span","ck-t",v), d=mk("button","ck-del","✕");
    d.type="button"; d.setAttribute("aria-label","הוצא פריט"); d.style.opacity="1";
    d.onclick=()=>{ tkCkSel.splice(i,1); paintFormCk(); };
    r.append(o,x,d); box.appendChild(r);
  });
  const r=mk("div","ck ck-add"), o=mk("span","ck-box"), inp=mk("input");
  inp.placeholder="הוסף פריט"; inp.maxLength=300; inp.setAttribute("aria-label","הוסף פריט לרשימת הבדיקה");
  inp.onkeydown=e=>{ if(e.key!=="Enter" || e.isComposing) return; e.preventDefault();
    const v=inp.value.trim(); if(!v) return; tkCkSel.push(v); paintFormCk(); $("#tkCk input").focus(); };
  r.append(o,inp); box.appendChild(r);
}
/* departments: several can be picked (chips); departments come from "תפקיד ומחלקה" of the people */
let tkDeptSel=[];
function paintDeptChips(sel){
  if(sel) tkDeptSel=sel.slice();
  const box=$("#tkDepts"); box.textContent="";
  const all=[...new Set(allDepts().concat(tkDeptSel))];
  if(!all.length){ box.appendChild(mk("span","hint","אין עדיין מחלקות — מגדירים ב\"הגדרות ← ניהול רשימות ← אנשים ← תפקיד ומחלקה\".")); return; }
  all.forEach(d=>{ const on=tkDeptSel.includes(d), b=mk("button","dchip"+(on?" on":""),(on?"✓ ":deptIcon(d)+" ")+d); b.type="button"; b.setAttribute("aria-pressed",String(on));
    b.onclick=()=>{ tkDeptSel = on ? tkDeptSel.filter(x=>x!==d) : tkDeptSel.concat(d); paintDeptChips();
      if(tkDeptSel.length) $("#tkPpl").closest(".tk-f").classList.remove("bad"), box.closest(".tk-f").classList.remove("bad"); };
    box.appendChild(b); });
}
function closeTaskForm(){ $("#tkForm").hidden=true; $("#tkNewBtn").hidden=false; tkEdit=null; tkEditPriv=null; tkFromPriv=null; document.querySelectorAll(".priv-carry").forEach(x=>x.remove()); tkPendClear(); }
/* photos and files picked in the task form: kept here until "שמור משימה", then attached to the task (the same as 📷 / 📎 on a task) */
var tkPend=[];
function tkPendClear(){ tkPend.forEach(x=>{ if(x.url) URL.revokeObjectURL(x.url); }); tkPend=[]; tkPendPaint(); }
function tkPendPaint(){ const box=$("#tkPendList"); if(!box) return; box.textContent="";
  tkPend.forEach((x,i)=>{ const b=mk("div","tk-file"+(x.url?" img":""));
    if(x.url){ const im=mk("img"); im.src=x.url; im.alt=x.f.name||"תמונה"; b.appendChild(im); }
    else b.append(mk("span","tf-ic","📄"), mk("span","tf-n",x.f.name||"קובץ"));
    const d=mk("span","tf-del","✕"); d.setAttribute("role","button"); d.setAttribute("aria-label","הסר את "+(x.f.name||"הקובץ"));
    d.onclick=()=>{ if(x.url) URL.revokeObjectURL(x.url); tkPend.splice(i,1); tkPendPaint(); }; b.appendChild(d); box.appendChild(b); }); }
function tkPendAdd(list, cam){ [...list].forEach(f=>tkPend.push({f, cam, url:/^image\//.test(f.type||"") ? URL.createObjectURL(f) : ""})); tkPendPaint(); }
/* files dragged in from outside (the computer's folders, the desktop, an e-mail): dropped on the task form they wait with
   the form's photos; dropped on an open task card they are added to it. Anywhere else the browser doesn't open them. */
let dropEl=null;
const dropFiles=e=>e.dataTransfer && [...(e.dataTransfer.types||[])].includes("Files");
function dropTarget(e){ const f=e.target.closest && e.target.closest("#tkForm"); if(f && !f.hidden) return f;
  const c=e.target.closest && e.target.closest("#tkList .tk[data-id]"); if(!c || isViewer()) return null;
  const t=String(c.dataset.id).startsWith("p:") ? privTasks().find(x=>x.id===c.dataset.id) : tasks.find(x=>x.id===c.dataset.id); return t && tkOpen(t) ? c : null; }
function dropMark(el){ if(dropEl===el) return; if(dropEl) dropEl.classList.remove("drop-on"); dropEl=el; if(el) el.classList.add("drop-on"); }
document.addEventListener("dragover",e=>{ if(!dropFiles(e)) return; e.preventDefault(); const el=dropTarget(e);
  e.dataTransfer.dropEffect = el ? "copy" : "none"; dropMark(el); });
document.addEventListener("dragleave",e=>{ if(!e.relatedTarget) dropMark(null); });
document.addEventListener("drop",e=>{ if(!dropFiles(e)) return; e.preventDefault(); const el=dropTarget(e), fl=[...e.dataTransfer.files]; dropMark(null);
  if(!fl.length) return;
  if(!el){ toast("גרור את הקבצים לתוך משימה פתוחה או לטופס המשימה"); return; }
  if(el.id==="tkForm"){ tkPendAdd(fl,false); toast(fl.length===1?"הקובץ יצורף בשמירה":fl.length+" קבצים יצורפו בשמירה"); return; }
  if(String(el.dataset.id).startsWith("p:")){ privAddFiles(el.dataset.id.slice(2), fl, false); return; }
  const t=tasks.find(x=>x.id===el.dataset.id); if(t) addFiles(t, fl, false); });
$("#tkPendCam").onchange=e=>{ tkPendAdd(e.target.files,true); e.target.value=""; };
$("#tkPendFile").onchange=e=>{ tkPendAdd(e.target.files,false); e.target.value=""; };
const one=v=>v && v!=="__other" ? [v] : [];
$("#tkNewBtn").onclick=()=>openTaskForm(null);
$("#tkCancel").onclick=closeTaskForm;
$("#tkSave").onclick=()=>{
  if(tkScope==="me"){                              // personal: only a title is needed; nothing assigned, no message, no log
    const title=$("#tkTitle").value.trim();
    if(!title){ $("#tkTitle").closest(".tk-f").classList.add("bad"); toast("חסר: כותרת המשימה"); $("#tkTitle").focus(); return; }
    const st=$("#tkStart").value||"", du=$("#tkDue").value||"";
    if(st && du && st>du){ $("#tkDue").closest(".tk-f").classList.add("bad"); toast("תאריך היעד לפני תאריך ההתחלה"); return; }
    const pt0=tkEditPriv && meGet().find(m=>m.id===tkEditPriv);
    const data={title:title.slice(0,300), desc:$("#tkDesc").value.trim(), prio:$("#tkPrio").value||"רגילה",
      start: st || (pt0 && pt0.created ? ymd(new Date(pt0.created)) : ymd(new Date())), due:du};   // the start is always there: the day it was opened
    const pf=tkPend.map(x=>x.f); tkPend=[];                     // photos / files picked in the form
    if(tkEditPriv){ const id=tkEditPriv; meSet(id, data); closeTaskForm(); toast("המשימה האישית עודכנה"); if(pf.length) privAddFiles(id, pf, false); return; }
    const pend=($("#tkCk input")||{}).value; if(pend && pend.trim() && !tkCkSel.includes(pend.trim())) tkCkSel.push(pend.trim());
    const now=new Date().toISOString(), a=meGet();
    a.unshift(Object.assign({id:newId(), done:false, at:nowLocal(), created:now, upd:now, check:tkCkSel.map(text=>({id:newId(), text, done:false}))}, data));
    closeTaskForm(); tkView="priv"; paintTkSeg(); mePut(a);   // show it where personal tasks live
    if(pf.length) privAddFiles(a[0].id, pf, false);
    toast(window.cloudMineState==="denied" ? "נשמרה 🔒 — כרגע רק במכשיר הזה" : "המשימה האישית נשמרה 🔒 — רק אתה רואה אותה"); return;
  }
  // required: type, priority, assignee (person or department), location, equipment and the title
  // assignment: a person, one or more departments, or both — at least one of them
  // start and due dates are optional (a recurring task without a due date counts its next round from the day it is done)
  const need=[["#tkType","קטגוריה"],["#tkPrio","עדיפות"],["#tkPpl","אחראי או מחלקה"],["#tkLoc","מיקום"],["#tkEq","ציוד"],["#tkTitle","כותרת המשימה"]];
  const miss=need.filter(([id])=>{ const v=($(id).value||"").trim(); let bad=!v || v==="__other";
    if(id==="#tkPpl") bad=!tkPplSel.length && !tkDeptSel.length;
    $(id).closest(".tk-f").classList.toggle("bad",bad); if(id==="#tkPpl") $("#tkDepts").closest(".tk-f").classList.toggle("bad",bad); return bad; });
  if(miss.length){ toast("חסר: "+miss.map(m=>m[1]).join(", "));
    const f=$(miss[0][0]); (f.classList.contains("ss-hidden") ? f.nextElementSibling : f).focus(); return; }
  if($("#tkStart").value && $("#tkDue").value && $("#tkStart").value > $("#tkDue").value){ $("#tkDue").closest(".tk-f").classList.add("bad"); toast("תאריך היעד לפני תאריך ההתחלה"); $("#tkDue").focus(); return; }
  const hrs=readHrs();
  if(hrs===null){ toast("⏱ שעות עבודה: הקלד את קריאת המונה עכשיו"); $("#tkHrsCur").focus(); return; }
  const title=$("#tkTitle").value.trim();
  const now=new Date().toISOString(), prio=$("#tkPrio").value||"רגילה";
  const data={title, desc:$("#tkDesc").value.trim(), type:$("#tkType").value||"", prio, urgent:prio==="דחופה",
    ppl:tkPplSel.slice(), loc:one($("#tkLoc").value), eq:one($("#tkEq").value), due:$("#tkDue").value||"", start:$("#tkStart").value||"", depts:tkDeptSel.slice(), rep:readRep(), hrs, upd:now};
  if(hrs){ const old=tkEdit && tasks.find(x=>x.id===tkEdit), oh=old && old.hrs;   // keep the readings already kept
    hrs.hist = oh && oh.cur===hrs.cur ? (oh.hist||[]) : ((oh && oh.hist)||[]).filter(x=>x.at!==hrs.at).concat({h:hrs.cur,at:hrs.at}).slice(-12);
    if(oh && oh.cur===hrs.cur) hrs.at=oh.at;
    data.due=hrsDue({hrs, due:data.due}); }
  const was=tkEdit;
  if(was){ const t=tasks.find(x=>x.id===was); if(t){ Object.assign(t,data);
      const pend=($("#tkCk input")||{}).value; if(pend && pend.trim() && !tkCkSel.includes(pend.trim())) tkCkSel.push(pend.trim());
      if(tkCkGone.size) (t.check||[]).forEach(c=>{ if(c && tkCkGone.has(c.id)) c.del=true; });
      if(tkCkSel.length){ t.check=(Array.isArray(t.check)?t.check:[]).concat(tkCkSel.map(text=>({id:newId(), text, done:false})));
        tkLog(t, "נוספו לרשימת הבדיקה: "+tkCkSel.join(", "), "", true); } } }
  else { const pend=($("#tkCk input")||{}).value; if(pend && pend.trim() && !tkCkSel.includes(pend.trim())) tkCkSel.push(pend.trim());
    const t=Object.assign({id:newId(), status:"פתוחה", created:now, log:[], openedBy:reporter()||"", openedMail:(window.cloudMe && window.cloudMe())||""}, data);
    if(tkCkSel.length) t.check=tkCkSel.map(text=>({id:newId(), text, done:false}));
    if(tkFromPriv){ const fp=tkFromPriv; if(fp.files.length) t.files=fp.files.slice();
      if(t.check) t.check.forEach(c=>{ const o=fp.check.find(x=>x.text===c.text); if(o && o.done) c.done=true; });
      t._fromPriv=1; meSet(fp.pid,{del:true}); }
    tkLog(t, "המשימה נפתחה"+(data.ppl.length?" · אחראי: "+data.ppl[0]:"")+(data.ppl.length>1?" · משויכים: "+data.ppl.slice(1).join(", "):"")+(data.depts.length?" · מחלקות: "+data.depts.join(", "):""), "", true); if(t._fromPriv){ delete t._fromPriv; tkLog(t, "הועברה ממשימה אישית", "", true); } tasks.push(t); }
  const pend=tkPend; tkPend=[];                                     // photos / files picked in the form (closing the form would drop them)
  closeTaskForm(); if(tkView==="done"){ tkView="open"; paintTkSeg(); } saveTasks();
  const saved=tasks.find(x=>x.id===(was||tasks[tasks.length-1].id));
  if(saved && pend.length){
    addFiles(saved, pend.map(x=>x.f), pend.every(x=>x.cam)).finally(()=>pend.forEach(x=>{ if(x.url) URL.revokeObjectURL(x.url); })); }   // one line in the log
  toast(saved && !isManager() && !isMine(saved) ? (was?"המשימה עודכנה":"המשימה נשמרה")+" — היא לא משויכת אליך או למחלקה שלך; תמצא אותה ב\"שפתחתי\"" : (was?"המשימה עודכנה":"המשימה נשמרה"));
};
/* quick edit: a tag on a task opens a small window that changes only that detail (no need for the full form).
   The change is saved like an edit in the form: the task's "upd" moves on and the team gets the usual message. */
const QK_LABEL={status:"סטטוס", prio:"עדיפות", type:"קטגוריה", ppl:"אחראי ומשויכים", depts:"מחלקות", loc:"מיקום", eq:"ציוד", start:"תאריך התחלה", due:"תאריך יעד"};
let qkT=null, qkV={};
function qkOpen(t, keys){
  qkT=t; qkV={}; const box=$("#qkBody"); box.textContent="";
  $("#qkTitle").textContent = keys.map(k=>QK_LABEL[k]).filter((x,i)=>!(keys[0]==="start" && i===0)).join(" · ").replace("תאריך יעד","תאריכים");
  $("#qkSub").textContent = (t.no?"#"+t.no+" · ":"")+(t.title||"");
  let instant = keys.length===1 && ["status","prio","type"].includes(keys[0]);   // one tap is enough
  keys.forEach(k=>{
    const sec=mk("div","qk-sec"); if(keys.length>1) sec.appendChild(mk("div","qk-lbl",QK_LABEL[k]));
    if(k==="start" || k==="due"){
      const i=mk("input"); i.type="date"; i.value=t[k]||""; i.dataset.k=k; qkV[k]=i.value;
      i.onchange=()=>{ qkV[k]=i.value; };
      const clr=mk("button","btn ghost qk-clr","ללא"); clr.type="button"; clr.onclick=()=>{ i.value=""; qkV[k]=""; };
      const r=mk("div","qk-date"); r.append(i,clr); sec.appendChild(r); box.appendChild(sec); return;
    }
    const multi = k==="ppl" || k==="depts";
    const cur = k==="status" ? [tkStat(t)] : k==="prio" ? [prioOf(t)] : k==="type" ? (t.type?[t.type]:[]) : (t[k]||[]).slice();
    const opts = k==="status" ? ["פתוחה","בטיפול","בהמתנה"] : k==="prio" ? PRIOS : k==="type" ? tkCats() : k==="ppl" ? pplValues() : k==="depts" ? allDepts() : byUse(k);
    qkV[k]=cur.slice();
    const chips=mk("div","qk-chips"), all=[...new Set(cur.concat(opts))];
    let q=null; if(all.length>8){ q=mk("input","qk-q"); q.type="search"; q.placeholder="חיפוש"+(k==="ppl"||k==="depts"?"":" או ערך חדש"); sec.appendChild(q); }
    const paint=()=>{ chips.textContent=""; const f=q ? q.value.trim().toLowerCase() : "";
      const vis=all.filter(v=>!f || v.toLowerCase().includes(f));
      vis.forEach(v=>{ const on=qkV[k].includes(v), b=mk("button","dchip qk-c"+(on?" on":""));
        b.type="button"; b.setAttribute("aria-pressed",String(on));
        b.textContent=(on && multi?"✓ ":"")+(k==="depts"?deptIcon(v)+" ":"")+(k==="status" && v==="בהמתנה"?"⏸ בהמתנה":v)+(k==="ppl" && on && qkV.ppl[0]===v && qkV.ppl.length>1?" · אחראי":"");
        if(k==="prio") colorSelect(b, on ? PRIO_HUE[v] : ""); if(k==="type" && on) colorSelect(b, hueOf(v));
        b.onclick=()=>{ if(multi) qkV[k] = on ? qkV[k].filter(x=>x!==v) : qkV[k].concat(v); else qkV[k] = on && k!=="status" && k!=="prio" ? [] : [v];
          if(instant) return qkSave(); paint(); };
        chips.appendChild(b); });
      if(q && f && !multi && !all.some(v=>v.toLowerCase()===f)){   // a new location / equipment / type joins the lists
        const b=mk("button","dchip qk-c qk-new","+ הוסף: "+q.value.trim()); b.type="button";
        b.onclick=()=>{ const v=q.value.trim(); if(!lists[k].includes(v)){ lists[k].push(v); if(!lists["_custom_"+k].includes(v)) lists["_custom_"+k].push(v); persist(); }
          all.unshift(v); qkV[k]=[v]; q.value=""; if(instant) return qkSave(); paint(); };
        chips.appendChild(b); }
      if(!vis.length && !(q && f && !multi)) chips.appendChild(mk("span","qk-none","אין התאמה"));
    };
    if(q) q.oninput=paint;
    paint(); sec.appendChild(chips);
    if(k==="status"){ const d=mk("button","btn primary qk-done","✓ השלם משימה…"); d.type="button";
      d.onclick=()=>{ $("#dlgQk").close(); openTaskDone(t.id); }; sec.appendChild(d); }
    box.appendChild(sec);
  });
  $("#qkOk").hidden = instant;
  $("#dlgQk").showModal();
}
function qkSave(){
  const t=qkT && tasks.find(x=>x.id===qkT.id); if(!t){ $("#dlgQk").close(); return; }
  const v=qkV, d={};
  if("ppl" in v || "depts" in v){
    const ppl = "ppl" in v ? v.ppl : (t.ppl||[]), dp = "depts" in v ? v.depts : (t.depts||[]);
    if(!ppl.length && !dp.length){ toast("צריך לפחות אחראי אחד או מחלקה"); return; }
    if("ppl" in v) d.ppl=ppl.slice(); if("depts" in v) d.depts=dp.slice(); }
  if("loc" in v){ if(!v.loc.length){ toast("צריך לבחור מיקום"); return; } d.loc=v.loc.slice(0,1); }
  if("eq" in v){ if(!v.eq.length){ toast("צריך לבחור ציוד"); return; } d.eq=v.eq.slice(0,1); }
  if("type" in v){ if(!v.type.length){ toast("צריך לבחור קטגוריה"); return; } d.type=v.type[0]; }
  if("prio" in v){ d.prio=v.prio[0]||"רגילה"; d.urgent=d.prio==="דחופה"; }
  if("start" in v) d.start=v.start; if("due" in v) d.due=v.due;
  { const st="start" in d ? d.start : t.start, du="due" in d ? d.due : t.due; if(st && du && st>du){ toast("תאריך היעד לפני תאריך ההתחלה"); return; } }
  const stNew = "status" in v ? v.status[0] : null;
  const changed = Object.keys(d).some(k=>JSON.stringify(d[k]??"")!==JSON.stringify(t[k]??(Array.isArray(d[k])?[]:""))) || (stNew && stNew!==tkStat(t));
  $("#dlgQk").close(); if(!changed) return;
  Object.assign(t, d);
  if(stNew && stNew!==tkStat(t)){ const from=tkStat(t); t.status=stNew; tkLog(t, stNew==="בטיפול" ? "הועברה לטיפול" : stNew==="בהמתנה" ? "הועברה להמתנה" : from==="בהמתנה" ? "שוחררה מהמתנה" : "הוחזרה לפתוחה", "", true); }
  t.upd=new Date().toISOString(); saveTasks(); toast("המשימה עודכנה"); if(typeof haptic==="function") haptic();
}
$("#qkOk").onclick=qkSave; $("#qkNo").onclick=()=>$("#dlgQk").close();
$("#qkFull").onclick=()=>{ $("#dlgQk").close(); if(qkT) openTaskForm(qkT.id); };
$("#dlgQk").addEventListener("click",e=>{ if(e.target===e.currentTarget) e.currentTarget.close(); });   // a tap outside closes it
function paintTkSeg(){ document.querySelectorAll("#tkSeg button[data-v]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.v===tkView)));
  if($("#tfDone")){ $("#tfDone").setAttribute("aria-pressed",String(tkView==="done")); $("#tfOpened").setAttribute("aria-pressed",String(tkView==="opened")); } }
document.querySelectorAll("#tkSeg button[data-v]").forEach(b=>b.onclick=()=>{ tkView=b.dataset.v; paintTkSeg(); renderTasks(); });
/* finish a task -> a closed event in the log */
/* recurring tasks: rep = {n, u} — every n days / weeks / months / years.
   Finishing one opens the next with the same details, dates moved on by the interval
   (and on past today, so a task finished late doesn't come back already late); the checklist starts over. */
const REP_U={d:["יום","ימים"],w:["שבוע","שבועות"],m:["חודש","חודשים"],y:["שנה","שנים"]};
function repLabel(r){ if(!r || !REP_U[r.u]) return "";
  if(+r.n===1) return {d:"יומית",w:"שבועית",m:"חודשית",y:"שנתית"}[r.u];
  return "כל "+r.n+" "+REP_U[r.u][1]; }
function readRep(){ const v=$("#tkRep").value; if(!v) return undefined;
  if(v!=="c") return {n:1,u:v};
  const n=Math.max(1,Math.min(366,parseInt($("#tkRepN").value,10)||1)); return {n, u:$("#tkRepU").value||"d"}; }
function setRep(r, hrs){ setHrs(hrs);
  const ok=r && REP_U[r.u];
  $("#tkRep").value = !ok ? "" : +r.n===1 ? r.u : "c";
  if(ok && +r.n!==1){ $("#tkRepN").value=r.n; $("#tkRepU").value=r.u; } else { $("#tkRepN").value=2; $("#tkRepU").value="d"; }
  paintRep();
}
function paintRep(){ const v=$("#tkRep").value; $("#tkRepC").hidden = v!=="c"; $("#tkRepHint").hidden = !v; if(typeof paintHrsF==="function") paintHrsF(); }
/* ⏱ working hours (a field of its own on every team task): a task with a meter reading keeps hrs = {every (0 = no cycle), base (the reading at the last service),
   cur (the latest reading), at (its date), hist (recent readings, for the pace)}. A reading entered on one task updates every
   open hours-task of the same equipment. The due date is estimated from the pace (hours a day) when there are two readings. */
function readHrs(){ if(tkScope==="me" || $("#tkHrsF").closest(".tk-hrs-f").hidden) return undefined;
  const every=parseFloat($("#tkHrsN").value), cur=parseFloat($("#tkHrsCur").value), b=parseFloat($("#tkHrsBase").value);
  if($("#tkHrsCur").value==="" && $("#tkHrsN").value==="" && $("#tkHrsBase").value==="") return undefined;
  if(!(cur>=0)) return null;                                   // a cycle or a last reading needs the reading now
  return {every: every>0 ? every : 0, cur, base: b>=0 ? b : cur, at:ymd(new Date())}; }
function setHrs(h){ $("#tkHrsCur").value = h ? h.cur : ""; $("#tkHrsN").value = h && h.every ? h.every : ""; $("#tkHrsBase").value = h && h.every ? h.base : ""; paintHrsF(); }
// the working-hours block shows for the "אחזקות מתוכננות" category (or when the task already has a reading)
function paintHrsF(){ const plan=$("#tkType").value==="אחזקות מתוכננות";
  $("#tkHrsF").closest(".tk-hrs-f").hidden = !(plan || ["#tkHrsCur","#tkHrsN","#tkHrsBase"].some(id=>$(id).value!==""));
  $("#tkRep").closest(".tk-rep-f").hidden = !(plan || $("#tkRep").value); }   // the recurrence too (or when the task already repeats)
$("#tkType").addEventListener("change",paintHrsF);
const hrsLeft=t=>t.hrs && t.hrs.every>0 ? +(t.hrs.base+t.hrs.every-t.hrs.cur).toFixed(1) : null;
function hrsPace(h){ const H=(h.hist||[]).filter(x=>x && x.at); if(H.length<2) return 0;   // hours a day, from the first and last reading kept
  const a=H[0], b=H[H.length-1], d=(Date.parse(b.at)-Date.parse(a.at))/864e5; return d>=1 && b.h>a.h ? (b.h-a.h)/d : 0; }
function hrsDue(t){ const left=hrsLeft(t), p=hrsPace(t.hrs); if(left===null) return t.due||"";
  if(left<=0) return t.hrs.at; if(!p) return t.due||"";
  const d=new Date(t.hrs.at+"T12:00:00"); d.setDate(d.getDate()+Math.floor(left/p)); return ymd(d); }
function hrsSet(eq, val, by){   // a new reading for this equipment: every open hours-task of it
  const at=ymd(new Date()); let n=0;
  tasks.filter(t=>t.hrs && tkOpen(t) && (t.eq||[])[0]===eq).forEach(t=>{ const h=t.hrs;
    h.cur=val; h.at=at; h.hist=(h.hist||[]).filter(x=>x.at!==at).concat({h:val,at}).slice(-12);
    t.due=hrsDue(t); t.upd=new Date().toISOString(); tkLog(t, "⏱ קריאת מונה: "+nf(val)+" ש'", by||"", true); n++; });
  return n; }
let hrsT=null;
function hrsAsk(t){ hrsT=t; const eq=(t.eq||[])[0]||"";
  $("#hrSub").textContent=eq; $("#hrVal").value="";
  $("#hrLast").textContent = t.hrs ? "קריאה אחרונה: "+nf(t.hrs.cur)+" ש' ("+dmy(t.hrs.at).slice(0,5)+")"+(t.hrs.every>0?" · הטיפול הבא ב-"+nf(t.hrs.base+t.hrs.every)+" ש'":"") : "";
  $("#dlgHrs").showModal(); setTimeout(()=>$("#hrVal").focus(),50); }
$("#hrNo").onclick=()=>$("#dlgHrs").close();
$("#hrOk").onclick=()=>{ const v=parseFloat($("#hrVal").value), t=hrsT; if(!t) return;
  if(!(v>=0)){ toast("הקלד את המספר שעל המונה"); $("#hrVal").focus(); return; }
  if(v<t.hrs.cur && !confirm("הקריאה נמוכה מהקודמת ("+nf(t.hrs.cur)+"). לשמור בכל זאת?")) return;
  const n=hrsSet((t.eq||[])[0]||"", v); $("#dlgHrs").close(); saveTasks();
  toast("⏱ נשמר: "+nf(v)+" ש'"+(n>1?" · עודכנו "+n+" משימות של אותו ציוד":"")); };
$("#hrVal").onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); $("#hrOk").click(); } };
$("#tkRep").addEventListener("change",()=>{ repAuto=false; paintRep(); });
/* a type that says how often (יומית / שבועית / חודשית / שנתית, also "סיור בטיחות חודשי") sets the recurrence by itself;
   picked by hand it stays as chosen, and switching to a type without one clears only what was set automatically */
let repAuto=false;
const repOfType=v=>/יומי/.test(v)?"d":/שבועי/.test(v)?"w":/חודשי/.test(v)?"m":/שנתי/.test(v)?"y":"";
$("#tkType").addEventListener("change",()=>{
  const u=repOfType($("#tkType").value||""), cur=$("#tkRep").value;
  if(u && (!cur || repAuto)){ if(cur!==u){ setRep({n:1,u}); repAuto=true; toast("מחזוריות: "+repLabel({n:1,u})+" — אפשר לשנות"); } }
  else if(!u && repAuto){ setRep(null); repAuto=false; }
});
function addRep(s, r, k){                     // "YYYY-MM-DD" + k intervals (month ends stay in their month: 31/01 → 28/02)
  if(!s) return s; const [Y,M,D]=s.split("-").map(Number), n=(+r.n||1)*(k||1);
  if(r.u==="d" || r.u==="w"){ const d=new Date(Y,M-1,D,12); d.setDate(d.getDate()+n*(r.u==="w"?7:1)); return ymd(d); }
  const mm=(M-1)+n*(r.u==="y"?12:1), y2=Y+Math.floor(mm/12), m2=((mm%12)+12)%12, last=new Date(y2,m2+1,0).getDate();
  return ymd(new Date(y2,m2,Math.min(D,last),12));
}
function nextOccurrence(t){
  if(t.hrs && t.hrs.every>0){ const now=new Date().toISOString(), h=t.hrs, at=ymd(new Date()), b=+t.hrsDone>=0 ? +t.hrsDone : h.cur;
    const n={id:newId(), status:"פתוחה", created:now, upd:now, log:[], title:t.title, desc:t.desc||"", type:t.type||"", prio:t.prio||"רגילה", urgent:!!t.urgent,
      ppl:(t.ppl||[]).slice(), loc:(t.loc||[]).slice(), eq:(t.eq||[]).slice(), depts:(t.depts||[]).slice(), start:"", prevId:t.id,
      hrs:{every:h.every, base:b, cur:Math.max(b,h.cur), at, hist:(h.hist||[]).filter(x=>x.at!==at).concat({h:Math.max(b,h.cur),at}).slice(-12)}};
    n.due=hrsDue(n);
    const items=(t.check||[]).filter(x=>x && !x.del); if(items.length) n.check=items.map(x=>({id:newId(), text:x.text, done:false}));
    tkLog(n, "⏱ טיפול לפי שעות (כל "+nf(h.every)+" ש') — נפתח אחרי שהקודם הושלם ב-"+nf(b)+" ש'; הבא ב-"+nf(b+h.every)+" ש'", "", true);
    return n; }
  const r=t.rep, base=t.due || ymd(new Date()), today=ymd(new Date());
  let k=1; while(addRep(base,r,k)<today && k<2000) k++;
  const now=new Date().toISOString();
  const n={id:newId(), status:"פתוחה", created:now, upd:now, log:[], title:t.title, desc:t.desc||"", type:t.type||"", prio:t.prio||"רגילה", urgent:!!t.urgent,
    ppl:(t.ppl||[]).slice(), loc:(t.loc||[]).slice(), eq:(t.eq||[]).slice(), depts:(t.depts||[]).slice(), rep:{n:+r.n||1,u:r.u},
    due:addRep(base,r,k), start:t.start ? addRep(t.start,r,k) : "", prevId:t.id};
  if(t.hrs){ const b=+t.hrsDone>=0 ? +t.hrsDone : t.hrs.cur, at=ymd(new Date()); n.hrs={every:0, base:b, cur:b, at, hist:(t.hrs.hist||[]).filter(x=>x.at!==at).concat({h:b,at}).slice(-12)}; }
  const items=(t.check||[]).filter(x=>x && !x.del);
  if(items.length) n.check=items.map(x=>({id:newId(), text:x.text, done:false}));
  tkLog(n, "משימה מחזורית ("+repLabel(r)+") — נפתחה אחרי שהקודמת הושלמה"+(t.due?" (יעד קודם "+dmy(t.due).slice(0,5)+")":""), "", true);
  return n;
}
function openTaskDone(id){
  const t=tasks.find(x=>x.id===id); if(!t) return; tkDoneId=id;
  $("#tdName").textContent=t.title;
  $("#tdAct").value=t.act||"";
  const types=byUse("type"), def=t.type || (types.includes("אחזקה") ? "אחזקה" : types[0]);
  fillSelect($("#tdType"), types, def);
  colorSelect($("#tdType"), hueOf($("#tdType").value));
  $("#tdWhen").value=nowLocal();
  $("#tdHrsF").hidden=!t.hrs; $("#tdHrs").value = t.hrs ? t.hrs.cur : "";
  // writing it to the log is optional; the choice is remembered on this device (on unless turned off)
  let lg=true; try{ lg=localStorage.getItem("ogg-td-log")!=="0"; }catch(e){}
  if(t.eventId && events.some(e=>e.id===t.eventId)) lg=true;        // reopened from its event: it closes that event again
  $("#tdLog").checked=lg; paintTdLog();
  $("#dlgTaskDone").showModal();
}
function paintTdLog(){ const on=$("#tdLog").checked; $("#tdLogF").hidden=!on; $("#tdOk").textContent = on ? "✓ השלם ורשום ביומן" : "✓ השלם משימה"; }
$("#tdLog").onchange=()=>{ paintTdLog(); try{ localStorage.setItem("ogg-td-log",$("#tdLog").checked?"1":"0"); }catch(e){} };
$("#tdType").onchange=()=>colorSelect($("#tdType"), hueOf($("#tdType").value));
$("#tdCancel").onclick=()=>$("#dlgTaskDone").close();
$("#tdOk").onclick=()=>{
  const t=tasks.find(x=>x.id===tkDoneId); if(!t){ $("#dlgTaskDone").close(); return; }
  const when=$("#tdWhen").value||nowLocal(), act=$("#tdAct").value.trim(), type=$("#tdType").value;
  if(t.hrs){ const v=parseFloat($("#tdHrs").value); if(!(v>=0)){ toast("⏱ הקלד את קריאת המונה בזמן הטיפול"); $("#tdHrs").focus(); return; }
    t.hrsDone=v; if(v>t.hrs.cur) hrsSet((t.eq||[])[0]||"", v); tkLog(t, "⏱ טופל ב-"+nf(v)+" ש'", "", true); }
  if(!$("#tdLog").checked){                       // complete only — no event in the log
    Object.assign(t,{status:"הושלמה", doneAt:nowLocal(), doneBy:reporter()||"", act, upd:new Date().toISOString()});
    tkLog(t, "הושלמה"+(act?": "+act:"")+" (לא נרשם ביומן)", "", true);
    const nx0 = (t.rep || (t.hrs && t.hrs.every>0)) && !t.nextId ? nextOccurrence(t) : null; if(nx0){ tasks.push(nx0); t.nextId=nx0.id; }
    $("#dlgTaskDone").close(); saveTasks(); renderTasks();
    if(nx0) toast("המשימה הושלמה · נפתחה המשימה הבאה"+(nx0.hrs && nx0.hrs.every?" ב-"+nf(nx0.hrs.base+nx0.hrs.every)+" ש'":" ליעד "+dmy(nx0.due).slice(0,5)),{label:"הצג",fn:()=>goTask(nx0.id)});
    else toast("המשימה הושלמה ועברה ל\"הושלמו\"");
    return;
  }
  const old=t.eventId && events.find(x=>x.id===t.eventId);     // a task that was reopened: its event is closed again (no second event)
  const ev={ id:old ? old.id : newId(), ...(old ? {no:old.no, src:old.src} : {}), type:type?[type]:[], loc:(t.loc||[]).slice(), eq:(t.eq||[]).slice(), ppl:(t.ppl||[]).slice(),
    stat:["נסגר"], title:t.title, desc:t.desc||"", act, when, closedAt:when, closedBy:reporter()||"", ts:new Date().toISOString(),
    ...((t.log||[]).some(l=>!l.sys) ? {follow:(t.log||[]).slice().sort((x,y)=>String(x.at).localeCompare(String(y.at))).map(logLine).join("\n")} : {}),
    taskId:t.id, taskCreated:t.created||"" };
  if(old) events[events.indexOf(old)]=ev; else events.push(ev);
  events.sort((a,b)=>(b.when||"").localeCompare(a.when||""));
  ["loc","eq","ppl"].forEach(k=>(ev[k]||[]).forEach(v=>{ if(!lists[k].includes(v)) lists[k].push(v); }));
  Object.assign(t,{status:"הושלמה", doneAt:when, doneBy:reporter()||"", act, eventType:type, eventId:ev.id, upd:new Date().toISOString()});
  tkLog(t, "הושלמה ונרשמה ביומן"+(act?": "+act:""), "", true);
  const nx = (t.rep || (t.hrs && t.hrs.every>0)) && !t.nextId ? nextOccurrence(t) : null;    // recurring: open the next one
  if(nx){ tasks.push(nx); t.nextId=nx.id; }
  $("#dlgTaskDone").close();
  persist(); renderAll(); saveTasks();
  if(nx) toast("הושלמה ונרשמה ביומן · נפתחה המשימה הבאה"+(nx.hrs && nx.hrs.every?" ב-"+nf(nx.hrs.base+nx.hrs.every)+" ש'":" ליעד "+dmy(nx.due).slice(0,5)),{label:"הצג",fn:()=>goTask(nx.id)});
  else toast("המשימה הושלמה ונרשמה ביומן",{label:"הצג",fn:()=>{ $("#sortBy").value="edit"; goList({ppl:""}); }});
};
let tkLiteSet=false;
$("#tabTasks").onclick=()=>{
  if(isLite() && !tkLiteSet && myName()){ tkView="mine"; paintTkSeg(); }   // phone view opens on "המשימות שלי" (once per visit)
  tkLiteSet=true; renderTasks(); show("Tasks"); };
/* ================= calendar: events that happened + tasks (due / completed), month view ================= */
let calY, calM, calSel=null, calMd="all", calLeg="";   // calLeg: legend colour picked → only that kind
calMd="ev";                                             // set by the list the calendar is opened from
(()=>{ const d=new Date(); calY=d.getFullYear(); calM=d.getMonth(); })();
const HEB_MONTHS=["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
/* by department: a task belongs to the departments it is assigned to and to those of its people;
   an event — to the departments of the people involved. */
let calDept=""; try{ calDept=localStorage.getItem("ogg-cal-dept")||""; }catch(e){}
const tkInDept=(t,d)=>(t.depts||[]).length ? t.depts.includes(d) : (t.ppl||[]).some(n=>deptOf(n)===d);   // its own department; none set → its people's
const evInDept=(e,d)=>(e.ppl||[]).some(n=>deptOf(n)===d);
function paintCalDept(){
  const box=$("#calDept"), ds=allDepts(); box.hidden=!ds.length; box.textContent=""; if(!ds.length) return;
  if(calDept && !ds.includes(calDept)) calDept="";
  const pre=calY+"-"+String(calM+1).padStart(2,"0"), mS=pre+"-01", mE=pre+"-31";
  const inMonth = calMd==="tk"
    ? t=>(tkOpen(t) && t.due && (t.start&&t.start<=t.due?t.start:t.due)<=mE && t.due>=mS) || (!tkOpen(t) && String(t.doneAt||"").startsWith(pre))
    : e=>(e.when||"").startsWith(pre);
  const src = calMd==="tk" ? tkVis().filter(inMonth) : events.filter(inMonth), isIn = calMd==="tk" ? tkInDept : evInDept;
  [["", "כל המחלקות", src.length]].concat(ds.map(d=>[d,deptIcon(d)+" "+d,src.filter(x=>isIn(x,d)).length])).forEach(([v,l,n])=>{
    const b=mk("button","dchip"+(v===calDept?" on":"")); b.type="button"; b.setAttribute("aria-pressed",String(v===calDept));
    b.append(l+" "); b.appendChild(mk("span","seg-n",nf(n)));
    b.onclick=()=>{ calDept=v; try{ localStorage.setItem("ogg-cal-dept",calDept); }catch(e){} renderCal(); };
    box.appendChild(b); });
}
function calIndex(){
  const ev={}, due={}, done={}, rep={}, today=ymd(new Date()), L=calLeg, on=x=>!L || L===x;
  const D=calDept, okT=t=>!D || tkInDept(t,D), okE=e=>!D || evInDept(e,D);
  if(calMd!=="tk" && on("ev")) events.filter(okE).forEach(e=>{ const d=(e.when||"").slice(0,10); if(d) (ev[d]=ev[d]||[]).push(e); });
  if(calMd!=="ev") tkVis().filter(okT).forEach(t=>{
    if(tkOpen(t) && t.due && on(t.due<today?"late":"tk")){
      // an open task sits on every day from its start date to its due date (older tasks without a start: the due day only)
      const s0=t.start && t.start<=t.due ? t.start : t.due; let d=new Date(s0+"T12:00"), n=0;
      while(n<200){ const k=ymd(d); const pos = s0===t.due ? "single" : k===s0 ? "start" : k===t.due ? "end" : "mid";
        (due[k]=due[k]||[]).push({t,pos}); if(k>=t.due) break; d.setDate(d.getDate()+1); n++; } }
    if(!tkOpen(t) && t.doneAt && on("done")){ const d=String(t.doneAt).slice(0,10); (done[d]=done[d]||[]).push(t); }
    // recurring: the coming repeats (they are opened one at a time, when the current one is finished)
    if(tkOpen(t) && t.rep && t.due && on("rep")){ const end=ymd(new Date(calY,calM+1,7));
      for(let k=1;k<500;k++){ const d=addRep(t.due,t.rep,k); if(d>end) break; (rep[d]=rep[d]||[]).push(t); } } });
  return {ev,due,done,rep};
}
function renderCal(){
  document.querySelectorAll("#calMode button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.m===calMd)));
  document.querySelectorAll("#calLeg button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.l===calLeg)));
  $("#calLeg").classList.toggle("picked",!!calLeg);
  paintCalDept();
  document.querySelectorAll("#calLeg button").forEach(b=>b.hidden = calMd==="ev" ? b.dataset.l!=="ev" : calMd==="tk" ? b.dataset.l==="ev" : false);
  // monthly counts on the mode buttons (always for the month shown, whatever the mode)
  const pre=calY+"-"+String(calM+1).padStart(2,"0");
  const nEv=events.filter(e=>(e.when||"").startsWith(pre)).length;
  const mS=pre+"-01", mE=pre+"-31";
  const nTk=tkVis().filter(t=>(tkOpen(t) && t.due && (t.start&&t.start<=t.due?t.start:t.due)<=mE && t.due>=mS) || (!tkOpen(t) && String(t.doneAt||"").startsWith(pre))).length;
  const segN={all:nEv+nTk, ev:nEv, tk:nTk};
  document.querySelectorAll("#calMode button").forEach(b=>{ const base={all:"הכל",ev:"אירועים",tk:"משימות"}[b.dataset.m];
    b.textContent=""; b.append(base+" "); b.appendChild(mk("span","seg-n",nf(segN[b.dataset.m]))); b.title=segN[b.dataset.m]+" ב"+HEB_MONTHS[calM]; });
  $("#calTitle").textContent=HEB_MONTHS[calM]+" "+calY;
  const I=calIndex(), today=ymd(new Date()), g=$("#calGrid"); g.textContent="";
  "אבגדהוש".split("").forEach(c=>g.appendChild(mk("div","cal-dow",c)));
  const first=new Date(calY,calM,1), start=new Date(first); start.setDate(1-first.getDay());
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i); const k=ymd(d), inM=d.getMonth()===calM;
    if(i>=35 && !inM && d.getDate()>7) break;       // no empty 6th week
    const evs=I.ev[k]||[], dues=I.due[k]||[], dones=I.done[k]||[];
    const faults=evs.filter(e=>(e.type||[]).includes("תקלה")).length, late=dues.filter(x=>x.t.due<today).length;
    const c=mk("button","cal-d"+(inM?"":" out")+(k===today?" today":"")+(k===calSel?" sel":"")+(k<today?" past":"")); c.type="button";
    c.appendChild(mk("span","cal-n",String(d.getDate())));
    // titles on the day itself: tasks first (overdue / due / done), then events by time; "+N" for the rest
    const items=[];
    dues.forEach(({t,pos})=>{ const lt=t.due<today, mark = pos==="start" ? "▶ " : (pos==="end"||pos==="single") ? (lt?"⚠ ":"🏁 ") : "";
      items.push({cls:(lt?"i-late":"i-tk")+(pos==="mid"?" i-mid":""), t:mark+(t.title||"משימה"), hue:null}); });
    dones.forEach(t=>items.push({cls:"i-done", t:"✓ "+(t.title||"משימה")}));
    (I.rep[k]||[]).forEach(t=>items.push({cls:"i-rep", t:"🔁 "+(t.title||"משימה")}));
    evs.slice().sort((x,y)=>String(x.when).localeCompare(String(y.when))).forEach(e=>{
      const ty=(e.type||[])[0]||""; items.push({cls:"i-ev", t:e.title||String(e.desc||"").slice(0,40)||ty||"אירוע", hue:hueOf(ty)}); });
    const max=matchMedia("(min-width:700px)").matches ? 4 : 2, m=mk("span","cal-m");
    items.slice(0, items.length>max ? max-1 : max).forEach(it=>{
      const s=mk("span","ci "+it.cls, it.t);
      if(it.hue){ s.style.borderInlineStartColor="var(--c-"+it.hue+")"; s.style.background="var(--c-"+it.hue+"-bg)"; s.style.color="var(--c-"+it.hue+")"; }
      m.appendChild(s); });
    if(items.length>max) m.appendChild(mk("span","ci i-more","+"+nf(items.length-max+1)+" עוד"));
    c.appendChild(m);
    const tip=[evs.length?evs.length+" אירועים"+(faults?" ("+faults+" תקלות)":""):"", dues.length?dues.length+" משימות"+(late?" ("+late+" באיחור)":""):"", dones.length?dones.length+" משימות הושלמו":""].filter(Boolean).join(" · ");
    c.title=dmy(k)+(tip?" — "+tip:""); c.setAttribute("aria-label",c.title);
    c.onclick=()=>{ calSel=k; renderCal(); $("#calDay").scrollIntoView({block:"nearest",behavior:"smooth"}); };
    g.appendChild(c);
  }
  renderCalDay(I, today);
}
function renderCalDay(I, today){
  const box=$("#calDay"); box.textContent="";
  const k=calSel || today, evs=(I.ev[k]||[]).slice().sort((a,b)=>String(a.when).localeCompare(String(b.when)));
  const dues=I.due[k]||[], dones=I.done[k]||[], reps=I.rep[k]||[];
  const dn=new Date(k+"T12:00"), head=mk("h3",null,["יום ראשון","יום שני","יום שלישי","יום רביעי","יום חמישי","יום שישי","שבת"][dn.getDay()]+" · "+dmy(k)+(k===today?" · היום":""));
  box.appendChild(head);
  if(!evs.length && !dues.length && !dones.length && !reps.length){ box.appendChild(mk("p","hint",k>today?"אין משימות ליעד ביום הזה.":"לא נרשם כלום ביום הזה.")); return; }
  const sec=(title,rows)=>{ if(!rows.length) return; box.appendChild(mk("div","cal-h",title)); rows.forEach(r=>box.appendChild(r)); };
  sec(dues.length?"משימות ביום הזה ("+dues.length+")":"", dues.map(({t,pos})=>{
    const r=mk("button","cal-row r-task"); r.type="button"; r.style.borderInlineStartColor="var(--c-"+PRIO_HUE[prioOf(t)]+")";
    const when = pos==="start" ? "▶ מתחילה היום" : pos==="end"||pos==="single" ? (t.due<today?"⚠ היעד עבר":"🏁 יעד") : "בביצוע";
    const range = t.start && t.start!==t.due ? dmy(t.start).slice(0,5)+"–"+dmy(t.due).slice(0,5) : "";
    r.append(mk("b",null,t.title||""), mk("span","cal-meta",[when, range, prioOf(t)!=="רגילה"?prioOf(t):"", (t.ppl||[])[0]||"", tkStat(t)!=="פתוחה"?tkStat(t):""].filter(Boolean).join(" · ")));
    r.onclick=()=>goTask(t.id); return r; }));
  sec(reps.length?"משימות מחזוריות — צפויות ביום הזה ("+reps.length+")":"", reps.map(t=>{
    const r=mk("button","cal-row r-rep"); r.type="button";
    r.append(mk("b",null,"🔁 "+(t.title||"")), mk("span","cal-meta",[repLabel(t.rep),"תיפתח כשהנוכחית (יעד "+dmy(t.due).slice(0,5)+") תושלם",(t.ppl||[])[0]||""].filter(Boolean).join(" · ")));
    r.onclick=()=>goTask(t.id); return r; }));
  sec(dones.length?"משימות שהושלמו ("+dones.length+")":"", dones.map(t=>{
    const r=mk("button","cal-row r-done"); r.type="button"; r.append(mk("b",null,"✓ "+(t.title||"")), mk("span","cal-meta",(t.ppl||[])[0]||""));
    r.onclick=()=>goTask(t.id); return r; }));
  sec(evs.length?"אירועים ("+evs.length+")":"", evs.slice(0,60).map(e=>{
    const t=(e.type||[])[0]||"", r=mk("button","cal-row r-ev"); r.type="button"; r.style.borderInlineStartColor="var(--c-"+hueOf(t)+")";
    const b=mk("span","cal-time",(e.when||"").slice(11,16));
    r.append(b, mk("b",null,e.title||String(e.desc||"").slice(0,70)||t), mk("span","cal-meta",[t,(e.loc||[])[0]||"",isOpen(e)?"פתוח":""].filter(Boolean).join(" · ")));
    r.onclick=()=>goList({from:k,to:k,ppl:""}); return r; }));
  if(evs.length>60) box.appendChild(mk("p","hint","ועוד "+(evs.length-60)+" — פתח ברשימה"));
  if(evs.length){ const go=mk("button","btn","הצג את אירועי היום ברשימה"); go.type="button"; go.onclick=()=>goList({from:k,to:k,ppl:""}); box.appendChild(go); }
}
$("#calPrev").onclick=()=>{ calM--; if(calM<0){ calM=11; calY--; } renderCal(); };
$("#calNext").onclick=()=>{ calM++; if(calM>11){ calM=0; calY++; } renderCal(); };
$("#calToday").onclick=()=>{ const d=new Date(); calY=d.getFullYear(); calM=d.getMonth(); calSel=ymd(d); renderCal(); };
document.querySelectorAll("#calLeg button").forEach(b=>b.onclick=()=>{
  calLeg = calLeg===b.dataset.l ? "" : b.dataset.l;                 // tap again = everything
  if(calLeg) calMd = calLeg==="ev" ? "ev" : "tk"; else calMd="all";
  renderCal(); });
document.querySelectorAll("#calMode button").forEach(b=>b.onclick=()=>{ calMd=b.dataset.m; calLeg=""; try{ localStorage.setItem("ogg-cal-mode",calMd); }catch(e){} renderCal(); });
$("#tabCal").onclick=()=>{ renderCal(); show("Cal"); };
// calendar inside each list: events → events only, tasks → tasks only; "חזרה" goes back to that list
function openCal(md){ calMd=md; calLeg=""; calSel=null;
  $("#calH").textContent = md==="tk" ? "לוח שנה — משימות" : "לוח שנה — אירועים";
  $("#calBack").textContent = md==="tk" ? "→ חזרה למשימות" : "→ חזרה לאירועים";
  renderCal(); show("Cal"); window.scrollTo({top:0}); }
$("#evCalBtn").onclick=()=>openCal("ev");
$("#tkCalBtn").onclick=()=>openCal("tk");
$("#calBack").onclick=()=>{ if(calMd==="tk") $("#tabTasks").click(); else $("#tabList").click(); window.scrollTo({top:0}); };
matchMedia("(min-width:700px)").addEventListener("change",()=>{ if(!$("#viewCal").hidden) renderCal(); });
/* searchable dropdown: long lists (people, locations, equipment) get a search box.
   The real <select> stays (hidden) — the code keeps reading/writing it; this is only the face. */
function enhanceSelect(sel){
  if(sel.dataset.enh) return; sel.dataset.enh="1";
  const btn=mk("button","ss-btn"); btn.type="button"; sel.after(btn); sel.classList.add("ss-hidden");
  const sync=()=>{ const o=sel.options[sel.selectedIndex]; btn.textContent=o ? o.textContent : ""; btn.classList.toggle("empty",!sel.value);
    btn.setAttribute("aria-label",(sel.getAttribute("aria-label")||"")+": "+btn.textContent); };
  new MutationObserver(()=>Promise.resolve().then(sync)).observe(sel,{childList:true,subtree:true,attributes:true});
  sel.addEventListener("change",sync);
  const setVal=()=>{ const d=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value");
    Object.defineProperty(sel,"value",{configurable:true,get(){ return d.get.call(this); },set(v){ d.set.call(this,v); sync(); }}); };
  setVal();
  btn.onclick=()=>openSS(sel,btn);
  sync();
}
let ssPanel=null;
function closeSS(){ if(ssPanel){ ssPanel.remove(); ssPanel=null; removeEventListener("pointerdown",ssOutside,true); } }
function ssOutside(e){ if(ssPanel && !ssPanel.contains(e.target) && !e.target.classList.contains("ss-btn")) closeSS(); }
function openSS(sel,btn){
  closeSS(); ssW=innerWidth;
  const p=mk("div","ss-panel"), q=mk("input","ss-q"), list=mk("div","ss-list");
  q.type="search"; q.placeholder="חיפוש…"; q.autocomplete="off"; p.append(q,list);
  const opts=[...sel.options].map(o=>({v:o.value,t:o.textContent,core:isCore(o.value)}));
  // a list where several are picked (people on a task) stays open until it is closed: tap outside, "סיום" or Esc
  const multi=!!sel._picked;
  const pick=v=>{
    if(multi && v && v!=="__other"){
      if(sel._picked().includes(v)) sel._unpick(v); else { sel.value=v; sel.dispatchEvent(new Event("change",{bubbles:true})); }
      q.value=""; paint(); requestAnimationFrame(()=>{ if(p._place) p._place(); }); if(!ssPhone()) q.focus({preventScroll:true}); return;   // phone: the keyboard doesn't jump after each pick
    }
    sel.value=v; sel.dispatchEvent(new Event("change",{bubbles:true})); closeSS(); btn.focus(); };
  let first=null;
  const paint=()=>{
    list.textContent=""; first=null; const f=q.value.trim().toLowerCase();
    opts.forEach(o=>{
      const special = o.v==="" || o.v==="__other";
      if(f && !special && !(o.t+" "+roleOf(o.v)+" "+deptOf(o.v)).toLowerCase().includes(f)) return;   // search by role / department too
      if(f && o.v==="") return;
      if(multi && o.v==="") return;
      const picked = multi && !special && sel._picked().includes(o.v);
      const b=mk("button","ss-opt"+(o.v===sel.value||picked?" on":"")+(special?" sp":"")+(o.core?" core":"")+(picked?" picked":""),(picked?"✓ ":"")+o.t); b.type="button"; b.onclick=()=>pick(o.v);
      if(picked) b.title="נבחר — לחיצה מסירה";
      if(!special && !sel._listKey) b.appendChild(personTags(o.v));
      if(!special && sel._listKey && !(sel._keep||[]).includes(o.v)){ const x=mk("span","ss-x","✕"); x.setAttribute("role","button"); x.title="הוצא מהרשימה"; x.setAttribute("aria-label","הוצא מהרשימה: "+o.t);
        x.onclick=ev=>{ ev.stopPropagation(); retireValue(sel._listKey,o.v);
          const so=[...sel.options].find(z=>z.value===o.v); if(so && sel.value!==o.v) so.remove();
          const i=opts.indexOf(o); if(i>=0) opts.splice(i,1); paint(); };
        b.appendChild(x); }
      if(!first && !special) first=o.v; list.appendChild(b);
    });
    if(sel._listKey && f && !opts.some(o=>o.t.trim().toLowerCase()===f)){   // a new value: added to the list and picked
      const raw=q.value.trim(), b=mk("button","ss-opt ss-add","+ הוסף: "+raw); b.type="button";
      b.onclick=()=>{ const k=sel._listKey;
        if(!lists[k].includes(raw)){ lists[k].push(raw); if(!lists["_custom_"+k].includes(raw)) lists["_custom_"+k].push(raw); }
        const h=(lists["_hide_"+k]||[]).indexOf(raw); if(h>=0) lists["_hide_"+k].splice(h,1);
        persist(); if(![...sel.options].some(z=>z.value===raw)){ const no=mk("option",null,raw); no.value=raw; sel.appendChild(no); }
        pick(raw); toast(raw+" נוסף לרשימה"); };
      list.insertBefore(b, list.firstChild); }
    if(!list.querySelector(".ss-opt:not(.sp)")) list.insertBefore(mk("div","ss-none","אין התאמה"), list.firstChild);
  };
  q.oninput=paint;
  q.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); if(first!==null) pick(first); } if(e.key==="Escape"){ closeSS(); btn.focus(); } };
  if(multi){ const done=mk("button","btn primary ss-done","סיום ✓"); done.type="button"; done.onclick=()=>{ closeSS(); btn.focus(); }; p.appendChild(done); }
  paint(); (btn.closest("dialog[open]")||document.body).appendChild(p); ssPanel=p; p._btn=btn;
  const place=()=>{
    if(ssPhone()){   // phone: docked at the top of the visible area, above the keyboard — the keyboard opening doesn't close it
      const vv=window.visualViewport, vh=vv ? vv.height : innerHeight, top=vv ? vv.offsetTop : 0;
      p.style.left="8px"; p.style.width=(innerWidth-16)+"px"; p.style.top=(top+8)+"px"; p.style.bottom="";
      list.style.maxHeight=Math.max(120, vh-16-(multi?112:64))+"px"; return;
    }
    const r=btn.getBoundingClientRect(), w=Math.max(r.width,Math.min(300,innerWidth-16));
    const below=innerHeight-r.bottom, down=below>=240 || below>=r.top, h=Math.min(380, (down ? below : r.top)-12);   // fits on the side it opens to
    p.style.width=w+"px"; p.style.left=Math.max(8,Math.min(r.right-w,innerWidth-w-8))+"px";
    if(down){ p.style.top=(r.bottom+4)+"px"; p.style.bottom=""; } else { p.style.bottom=(innerHeight-r.top+4)+"px"; p.style.top=""; }
    list.style.maxHeight=Math.max(120,h-(multi?104:56))+"px";
  };
  place(); p._place=place;
  const on=list.querySelector(".ss-opt.on"); if(on) on.scrollIntoView({block:"nearest"});
  q.focus({preventScroll:true});
  addEventListener("pointerdown",ssOutside,true);
}
addEventListener("scroll",e=>{            // follow the button while the page scrolls; close only when it leaves the screen
  if(!ssPanel || ssPanel.contains(e.target)) return;
  if(ssPhone()) return ssPanel._place();
  const r=ssPanel._btn.getBoundingClientRect(); if(r.bottom<0 || r.top>innerHeight) closeSS(); else ssPanel._place();
},true);
// a phone keyboard opening or closing changes the height only — keep the list open; a real resize (turning the phone, a window) closes it
function ssPhone(){ return innerWidth<=600 || matchMedia("(pointer:coarse)").matches; }
let ssW=innerWidth;
addEventListener("resize",()=>{ if(!ssPanel){ ssW=innerWidth; return; } if(Math.abs(innerWidth-ssW)>40){ ssW=innerWidth; closeSS(); } else ssPanel._place(); });
if(window.visualViewport){ const vvp=()=>{ if(ssPanel && ssPhone()) ssPanel._place(); }; visualViewport.addEventListener("resize",vvp); visualViewport.addEventListener("scroll",vvp); }
["#tkPpl","#tkLoc","#tkEq","#tfPpl","#tfLoc","#tkType"].forEach(id=>enhanceSelect($(id)));
$("#tkType")._listKey="type"; $("#tkType")._keep=TK_CATS;   // the task type list: ✕ takes a type out of the list, and a typed new one is added for next time
// people on a task: several are picked one after another — the list stays open
$("#tkPpl")._picked=()=>tkPplSel; $("#tkPpl")._unpick=v=>{ tkPplSel=tkPplSel.filter(x=>x!==v); paintPplChips(); };

/* ================= boot ================= */
load(); loadTasks(); if(!CLOUD_ON) window.nosAfterSync(); setNow(); renderAll(); renderTasks(); renderDash(); show(REFRESH_VIEW||"Dash"); applyLite();
$("#liteToggle").onclick=()=>{ try{ localStorage.setItem("ogg-view-full", isLite() ? "1" : "0"); }catch(e){} applyLite(); renderAll(); renderTasks();
  toast(isLite() ? "תצוגת טלפון" : "תצוגה מלאה — אפשר לחזור מכאן"); };
$("#liteTheme").onclick=()=>$("#themeBtn").click();
$("#liteReload").onclick=()=>$("#refreshBtn").click();
// a short vibration on every tap of a button (phones). Android: navigator.vibrate; iPhone (Safari 18+): toggling a hidden switch gives a tick
const HAP_KEY="ogg-haptic";
function hapOn(){ try{ return localStorage.getItem(HAP_KEY)!=="0"; }catch(e){ return true; } }
let hapSw=null;
function haptic(){
  if(!hapOn() || !matchMedia("(pointer:coarse)").matches) return;
  if(navigator.vibrate){ try{ navigator.vibrate(12); }catch(e){} return; }
  if(!hapSw){ hapSw=mk("label"); hapSw.setAttribute("aria-hidden","true"); hapSw.style.cssText="position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;inset-inline-start:-9px;top:0";
    const i=document.createElement("input"); i.type="checkbox"; i.setAttribute("switch",""); i.tabIndex=-1; hapSw.appendChild(i); document.body.appendChild(hapSw); }
  hapSw.click();
}
document.addEventListener("click",ev=>{ if(ev.isTrusted && ev.target.closest && ev.target.closest("button,.btn,[role=tab],summary,.seg button,.dt-tile,.kpi,.tk-tag,input[type=checkbox],input[type=radio]") && !(hapSw && hapSw.contains(ev.target))) haptic(); },true);
/* "שקיפות הרקע" (settings → ערכת צבעים): the light page behind the content turns see-through, showing the blue behind it.
   0 = as before. Kept on this device. */
const GLASS_KEY="ogg-glass";
function applyGlass(v){ v=Math.max(0,Math.min(80,+v||0)); const r=document.documentElement;
  r.style.setProperty("--glass", v+"%"); r.classList.toggle("glass", v>0);
  if($("#glassR")){ $("#glassR").value=v; $("#glassV").textContent=v+"%"; } }
try{ applyGlass(localStorage.getItem(GLASS_KEY)); }catch(e){ applyGlass(0); }
/* text size (this device): the whole app scales — 85%…130% */
const ZOOM_KEY="ogg-zoom";
const ZOOMS=[90,100,112,125];
function applyZoom(v){ v=+v||100; if(!ZOOMS.includes(v)) v=ZOOMS.reduce((a,b)=>Math.abs(b-v)<Math.abs(a-v)?b:a);
  document.documentElement.style.zoom = v===100 ? "" : String(v/100);
  document.querySelectorAll("#zoomSeg button").forEach(b=>b.setAttribute("aria-pressed",String(+b.dataset.z===v))); }
try{ applyZoom(localStorage.getItem(ZOOM_KEY)||100); }catch(e){ applyZoom(100); }
// one step per tap; the page stays put — the button you tapped is where it was
document.querySelectorAll("#zoomSeg button").forEach(b=>b.onclick=()=>{
  const y0=b.getBoundingClientRect().top;
  applyZoom(b.dataset.z); try{ localStorage.setItem(ZOOM_KEY, b.dataset.z); }catch(_){}
  let n=0; const fix=()=>{ const d=b.getBoundingClientRect().top-y0; if(Math.abs(d)>1 && n++<4){ window.scrollBy(0,d); requestAnimationFrame(fix); } };
  requestAnimationFrame(fix);
});
if($("#glassR")) $("#glassR").oninput=e=>{ applyGlass(e.target.value); try{ localStorage.setItem(GLASS_KEY, e.target.value); }catch(_){} };
if($("#hapOn")){ $("#hapOn").checked=hapOn(); $("#hapOn").onchange=e=>{ try{ localStorage.setItem(HAP_KEY,e.target.checked?"1":"0"); }catch(_){} if(e.target.checked) haptic(); }; }
/* ===== help: a guided tour of the controls in working order, and a flow chart of the process =====
   The tour opens by itself the first time on a device (after the opening screen and any message window),
   and any time from "?" in the header or settings → כללי. Steps adapt to phone/desktop and to the user's role;
   a step whose control is not on screen is skipped. */
const TOUR_KEY="ogg-tour-done";
function tourSteps(){
  const lite=isLite(), mgr=isManager(), tab=id=>()=>{ const b=$(id); if(b && b.getAttribute("aria-selected")!=="true") b.click(); };
  return [
    {sel:".tabs", title:"שלוש לשוניות", text:"משימות — עבודה שצריך לבצע. דשבורד — תמונת מצב. אירועים — היומן של מה שקרה בשטח."},
    {sel: lite ? '.dcard[data-t="משימות"]' : "#dKpis", pre:tab("#tabDash"), title:"דשבורד", text: lite ? "המשימות שלך ושל המחלקה, ומתחת — האירועים הפתוחים. לחיצה על מספר פותחת את הרשימה שלו." : "המספרים של היומן. לחיצה על כרטיס פותחת את האירועים שמאחוריו."},
    {sel:"#dTicker", pre:tab("#tabDash"), title:"מבזקים", text:"פס שרץ כל הזמן עם מה שפתוח עכשיו — משימות באיחור ולהיום קודם, ואחריהן האירועים הפתוחים. נוגעים כדי לעצור, לוחצים על פריט כדי לפתוח אותו."},
    {sel:"#fabNew", pre:tab("#tabList"), title:"רישום אירוע", text:"קרה משהו? ＋ חדש. בוחרים מתי, סוג ומיקום, כותבים מה קרה (אפשר להכתיב 🎙) ושומרים. אירוע שלא טופל נשאר פתוח."},
    {sel:"#viewList .toolbar", title:"חיפוש וסינון", text:"מחפשים מילה בתיאור, בפעולה או בציוד. \"סינון\" — לפי סוג, מיקום, סטטוס, תאריכים."},
    {sel:"#evCollAll", title:"חודשים", text:"האירועים מסודרים לפי חודשים. החץ ליד חודש ממזער אותו, וכאן — את כולם."},
    {sel:"#listBox .ev", title:"אירוע ברשימה", text:"\"פרטים\" מציג הכל. \"סגור אירוע\" כשהטיפול הסתיים — נרשם מי סגר ומתי. אפשר גם לפתוח מחדש."},
    {sel:"#tkSeg", pre:tab("#tabTasks"), title:"משימות", text:"המשימות שלי — מה שהוקצה לך ולמחלקה שלך. שפתחתי — מה שאתה פתחת. פתוחות / הושלמו — הכל."},
    mgr && {sel:"#tkDeptSeg", title:"לפי מחלקה", text:"כמנהל — בוחרים מחלקה כדי לראות רק את המשימות שלה. הרשימה נפתחת על המחלקה שלך."},
    {sel:"#tkNewBtn", title:"משימה חדשה", text:"כותרת, הקצאה למחלקה או לעובדים (הראשון — האחראי), קטגוריה, עדיפות ותאריכים. מי שהוקצה מקבל הודעה. בחירה ב\"🔒 אישית\" — משימה לעצמך שרק אתה רואה, בלי הקצאה ובלי רישום ביומן."},
    {sel:"#tkList .tk", title:"משימה", text:"הפס בצד מראה את היעד: אדום — באיחור, ירוק — היום, כתום — בהמשך. \"+ עדכון\" מוסיף התקדמות, ו\"השלם משימה\" מעביר אותה ל\"הושלמו\" — ואם רוצים, גם רושם אירוע סגור ביומן."},
    {sel:"#inboxBtn", title:"הודעות", text:"🔔 כאן מגיעות הקצאות ועדכונים במשימות שלך. החלקה ימינה מעבירה הודעה לארכיון."},
    {sel:"#fbBtn", title:"משוב", text:"משהו לא עובד או חסר? 💬 מצלם את המסך, מסמנים עליו ושולחים למנהל."},
    {sel:"#setBtn", title:"הגדרות", text: lite ? "בטלפון מוצג רק מה שצריך בשטח. ⚙ ← כללי ← \"עבור לתצוגה מלאה\" מציג הכל." : "ערכת צבעים, צוות וחשבון"+(mgr?", ניהול רשימות, גיבוי":"")+"."},
    {sel:"#setBtn", title:"זהו!", text:"ההדרכה, תרשים התהליך ורקע בהיר/כהה — תמיד בהגדרות ← כללי.", end:true}
  ].filter(s=>{ if(!s) return false;             // controls that are off for this user (not just on another tab) are left out, so the count is right
    let x=document.querySelector(s.sel); if(!x) return true;
    for(; x; x=x.parentElement) if(x.hidden && x.tagName!=="SECTION") return false;
    return true; });
}
let tour=null;
function tourEl(){
  if($("#tourLayer")) return;
  const L=mk("div"); L.id="tourLayer"; L.hidden=true;
  const hole=mk("div","tour-hole"); hole.id="tourHole";
  const box=mk("div","tour-box"); box.id="tourBox"; box.setAttribute("role","dialog"); box.setAttribute("aria-live","polite");
  box.innerHTML='<div class="tour-n" id="tourN"></div><h4 id="tourT"></h4><p id="tourX"></p><div class="tour-btns"><button type="button" class="btn primary" id="tourNext"></button><button type="button" class="btn" id="tourPrev">הקודם</button><button type="button" class="btn ghost" id="tourSkip">דלג</button></div>';
  L.append(hole,box); document.body.appendChild(L);
  $("#tourNext").onclick=()=>tourGo(1); $("#tourPrev").onclick=()=>tourGo(-1); $("#tourSkip").onclick=tourEnd;
  L.addEventListener("click",e=>{ if(e.target===L) tourGo(1); });
  addEventListener("resize",()=>{ if(tour) tourPlace(); });
  document.addEventListener("keydown",e=>{ if(!tour) return; if(e.key==="Escape") tourEnd(); else if(e.key==="ArrowLeft") tourGo(1); else if(e.key==="ArrowRight") tourGo(-1); });
}
function tourVisible(sel){ const el=document.querySelector(sel); if(!el) return null; const r=el.getBoundingClientRect(); return r.width>0 && r.height>0 && getComputedStyle(el).visibility!=="hidden" ? el : null; }
function tourStart(){
  document.querySelectorAll("dialog[open]").forEach(d=>d.close());
  if(!$("#viewData").hidden) show("Dash");
  tourEl(); tour={steps:tourSteps(), i:-1}; $("#tourLayer").hidden=false; document.documentElement.classList.add("touring"); tourGo(1);
}
function tourGo(d){
  if(!tour) return; let i=tour.i;
  for(;;){ i+=d; if(i<0) return; if(i>=tour.steps.length){ tourEnd(); return; }
    const s=tour.steps[i]; if(s.pre) s.pre(); if(tourVisible(s.sel)) break; }
  tour.i=i; const s=tour.steps[i], n=tour.steps.length;
  $("#tourN").textContent=(i+1)+" / "+n; $("#tourT").textContent=s.title; $("#tourX").textContent=s.text;
  $("#tourPrev").hidden = i===0; $("#tourNext").textContent = s.end ? "סיום" : "הבא ←";
  if(s.end && !$("#tourFlow")){ const f=mk("button","btn","תרשים התהליך"); f.type="button"; f.id="tourFlow"; f.onclick=()=>{ tourEnd(); openFlow(); }; $("#tourBox .tour-btns").appendChild(f); }
  if($("#tourFlow")) $("#tourFlow").hidden=!s.end;
  const el=tourVisible(s.sel); el.scrollIntoView({block:"center",behavior:"instant"});
  requestAnimationFrame(tourPlace);
}
function tourPlace(){
  if(!tour) return; const el=tourVisible(tour.steps[tour.i].sel); if(!el) return;
  const r=el.getBoundingClientRect(), pad=6, hole=$("#tourHole"), box=$("#tourBox"), vw=innerWidth, vh=innerHeight;
  const top=Math.max(4,r.top-pad), left=Math.max(4,r.left-pad), w=Math.min(vw-8,r.width+pad*2), h=Math.min(vh-8,r.height+pad*2);
  Object.assign(hole.style,{top:top+"px",left:left+"px",width:w+"px",height:h+"px"});
  const bw=Math.min(340,vw-24); box.style.width=bw+"px";
  const bh=box.offsetHeight, below=top+h+12, above=top-12-bh;
  let y = below+bh<=vh-8 ? below : above>=8 ? above : Math.max(8,vh-bh-8);
  let x = Math.min(Math.max(12, r.left+r.width/2-bw/2), vw-bw-12);
  Object.assign(box.style,{top:y+"px",left:x+"px"});
}
function tourEnd(){
  tour=null; const L=$("#tourLayer"); if(L) L.hidden=true; document.documentElement.classList.remove("touring");
  try{ localStorage.setItem(TOUR_KEY,"1"); }catch(e){}
}
function tourAuto(){ if(TV) return;                           // the first time on this device: once the opening screen and any message window are gone
  try{ if(localStorage.getItem(TOUR_KEY)) return; }catch(e){ return; }
  let n=0; const t=setInterval(()=>{ n++;
    try{ if(TV || localStorage.getItem(TOUR_KEY)){ clearInterval(t); return; } }catch(e){}   // marked done meanwhile / became the office screen
    const sp=$("#splash"), busy=(sp && !sp.hidden) || document.querySelector("dialog[open]");
    if(!busy){ clearInterval(t); tourStart(); } else if(n>120) clearInterval(t); },1000);
}
function openFlow(which){
  const d=$("#dlgFlow"); if(which) flowTab(which); if(!d.open) d.showModal();
}
function flowTab(w){ document.querySelectorAll("#dlgFlow [data-fl]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.fl===w))); $("#flowEv").hidden=w!=="ev"; $("#flowTk").hidden=w!=="tk"; $(".fl-legend").hidden=w!=="tk"; }
document.querySelectorAll("#dlgFlow [data-fl]").forEach(b=>b.onclick=()=>flowTab(b.dataset.fl));
if($("#helpBtn")) $("#helpBtn").onclick=()=>openFlow();
$("#flClose").onclick=()=>$("#dlgFlow").close();
$("#tourStart").onclick=()=>{ $("#dlgFlow").close(); tourStart(); };
$("#tourStart2").onclick=tourStart; $("#flowOpen2").onclick=()=>openFlow();
setTimeout(tourAuto,1500);

/* ===== dashboard ticker ("מבזקים"): what is open right now — tasks (the ones I can see) and events — running in a strip.
   Rebuilt only when its content changes, so the strip keeps moving; it stops while a finger or the mouse is on it. */
function evGo(id){                                // open one event in the list: unfold its month, scroll to it, open its details
  const e=events.find(x=>x.id===id); if(!e){ toast("האירוע כבר לא קיים"); return; }
  goList({ppl:""}); $("#fPanel").hidden=true; $("#fToggle").setAttribute("aria-expanded","false");
  const g=(e.when||"").slice(0,7); if(evColl.has(g)){ evColl.delete(g); saveEvColl(); }
  const i=lastRows.indexOf(e); if(i>=shown) shown=i+1; renderList(false);
  const el=document.querySelector('#listBox .ev[data-id="'+CSS.escape(id)+'"]');
  if(el){ el.scrollIntoView({block:"center"}); el.classList.add("flash"); setTimeout(()=>el.classList.remove("flash"),2200);
    const info=[...el.querySelectorAll("button")].find(b=>b.textContent==="פרטים"); if(info) info.click(); }
}
function paintTicker(){ paintTickerInto($("#dTicker"),$("#dTickTrack"),"d"); }
function paintTickerInto(box, tr, key){
  const tickSigs=window.__tickSigs||(window.__tickSigs={});        // may run before the rest of the file
  if(!box || !tr) return;
  const today=ymd(new Date()), items=[];
  // notices from the board run first (the important ones before the rest)
  (typeof boardActive==="function" ? boardActive() : []).forEach(x=>items.push({k:"b", id:x.id, cls:x.important?"bimp":"bd", tag:x.important?"❗ מודעה":"📌 מודעה", text:x.text.replace(/\s+/g," ").slice(0,140)}));
  const tks=tkVis().filter(tkOpen).sort((a,b)=>{ const r=t=>t.due && t.due<today ? 0 : t.due===today ? 1 : prioOf(t)==="דחופה" ? 2 : 3;
    return r(a)-r(b) || String(a.due||"9").localeCompare(String(b.due||"9")); }).slice(0,15);
  tks.forEach(t=>{ const st = t.due && t.due<today ? "late" : t.due===today ? "today" : prioOf(t)==="דחופה" ? "urg" : "";
    items.push({k:"t", id:t.id, cls:st, tag: st==="late" ? "באיחור" : st==="today" ? "היום" : st==="urg" ? "דחופה" : "משימה",
      text:(t.no?"#"+t.no+" ":"")+(t.title||"משימה")+((t.ppl||[])[0]?" · "+t.ppl[0]:"")+(t.due && st!=="today"?" · יעד "+dmy(t.due).slice(0,5):"")}); });
  events.filter(isOpen).sort((a,b)=>String(b.when||"").localeCompare(String(a.when||""))).slice(0,15).forEach(e=>{
    const ty=(e.type||[])[0]||"אירוע";
    items.push({k:"e", id:e.id, cls:ty==="תקלה"?"fault":"ev", tag:ty,
      text:(e.no?"#"+e.no+" ":"")+(e.title||String(e.desc||"").slice(0,70)||ty)+((e.loc||[]).length?" · "+e.loc.join(", "):"")+(e.when?" · "+fmtWhen(e.when).slice(0,5):"")}); });
  if(key==="tv"){ for(let i=items.length-1;i>=0;i--) if(tvHidden(items[i].k,items[i].id)) items.splice(i,1); }
  box.hidden=!items.length || (key==="tv" && !tvCfg().ticker);
  const sig=JSON.stringify(items); if(sig===tickSigs[key]) return; tickSigs[key]=sig;
  tr.textContent="";
  const run=()=>{ const g=mk("div","tk-run"); items.forEach(it=>{
      const b=mk("button","tk-it"+(it.cls?" ki-"+it.cls:"")); b.type="button"; b.title=it.k==="t"?"פתח את המשימה":"פתח את האירוע";
      b.append(mk("span","tk-tag",it.tag), mk("span","tk-tx",it.text));
      b.title = it.k==="b" ? "לוח המודעות" : b.title;
      b.onclick=()=>it.k==="t" ? tvGo(()=>goTask(it.id)) : it.k==="b" ? (TV ? tvGo(()=>bsOpenAt(it.id)) : goBoard(it.id)) : tvGo(()=>evGo(it.id)); g.appendChild(b); }); return g; };
  const a1=run(), a2=run(); a2.setAttribute("aria-hidden","true"); a2.querySelectorAll("button").forEach(b=>b.tabIndex=-1);
  tr.append(a1,a2);
  // a calm, readable pace: about 1.5 letters' width a second (≈22px on a phone, more on the big screen where the letters are bigger)
  // measured once the strip is on screen (a hidden dashboard measures 0 wide, which used to make a long strip race)
  const setDur=()=>{ const w=a1.scrollWidth; if(!w) return false; const fs=parseFloat(getComputedStyle(a1.querySelector(".tk-tx")||a1).fontSize)||14;
    tr.style.setProperty("--tk-dur", Math.max(30, Math.round(w/(fs*1.6)))+"s"); return true; };
  tr.style.animationPlayState="paused";
  const go=()=>{ if(setDur()){ tr.style.animationPlayState=""; return true; } return false; };
  if(!go() && window.ResizeObserver){ const ro=new ResizeObserver(()=>{ if(go()) ro.disconnect(); }); ro.observe(a1); }
}

/* ===== personal area: my own to-dos — not managed, not shared, never written to the log.
   Kept on this device per signed-in user, and in the team log in a private document only I can read (cloud.js). */
var meKey=()=>"ogg-me-todos-"+((window.cloudMe && window.cloudMe()) || "local");
function meGet(){ try{ const a=JSON.parse(localStorage.getItem(meKey())||"[]"); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function mePut(a, fromCloud){
  const keep=a.filter(x=>!x.del || Date.now()-Date.parse(x.upd||0) < 30*864e5);      // deleted ones are remembered a month (so other devices hear of it)
  try{ localStorage.setItem(meKey(), JSON.stringify(keep)); }catch(e){}
  if(!fromCloud && window.cloudPushMine) window.cloudPushMine(keep);
  paintMe2();
}
window.meApply=remote=>{                          // merge my other devices' copy: per item, the later change wins
  const loc=meGet(), by={}; loc.forEach(x=>by[x.id]=x); let changed=false, mineNewer=false;
  (remote||[]).forEach(r=>{ const l=by[r.id]; if(!l || String(r.upd)>String(l.upd)){ by[r.id]=r; changed=true; } });
  const rm={}; (remote||[]).forEach(r=>rm[r.id]=r);
  loc.forEach(l=>{ const r=rm[l.id]; if(!r || String(l.upd)>String(r.upd)) mineNewer=true; });
  if(changed) mePut(Object.values(by), true);
  if(mineNewer && window.cloudPushMine) window.cloudPushMine(Object.values(by));
  if(!changed) paintMe2();
};
function meSet(id, patch){ const a=meGet(), x=a.find(m=>m.id===id); if(!x) return; Object.assign(x, patch, {upd:new Date().toISOString()}); mePut(a); }
/* personal tasks live in the tasks board, marked 🔒 (only their owner sees them; never assigned, never written to the log) */
function privTasks(){
  return meGet().filter(x=>!x.del).map(x=>({priv:true, id:"p:"+x.id, pid:x.id, title:x.title||x.text||"", desc:x.desc||"", prio:x.prio||"רגילה",
    start:x.start||(x.created ? ymd(new Date(x.created)) : ""),   /* no start: the day it was opened */ due:x.due||"", check:(x.check||[]).filter(c=>c && !c.del),
    status:x.done?"הושלמה":"פתוחה", doneAt:x.doneAt||"",
    created:x.created||x.upd||"", upd:x.upd||"", files:(x.files||[]).filter(m=>m && !m.del)}));
}
function paintMe2(){ if(typeof renderTasks==="function") renderTasks(); }
window.paintMe2=paintMe2;
// a personal task's photos / files: kept like a team task's (this device + the cloud copy), listed on the personal task
async function privAddFiles(pid, list, cam){
  const out=await storeFiles(list, cam); if(!out.length) return;
  const x=meGet().find(z=>z.id===pid); if(!x) return;
  meSet(pid,{files:(x.files||[]).concat(out)}); toast(out.length===1?"צורף 🔒":"צורפו "+out.length+" 🔒"); }
/* 🔒 tapped on an open personal task: it moves to the team — the team form opens with its title, details, dates, checklist and
   files; once the missing team details (category, people, place…) are filled and it is saved, the personal copy goes away */
let tkFromPriv=null;
function privToTeam(t){
  if(!confirm("להעביר את המשימה האישית לצוות?\n"+t.title+"\n\nייפתח טופס משימת צוות עם הפרטים שלה — משלימים קטגוריה, אחראי, מיקום וציוד ושומרים.")) return;
  openTaskForm(null); setScope("team"); $("#tkScope").hidden=true;
  $("#tkFormTitle").textContent="העברה לצוות — "+t.title;
  $("#tkTitle").value=t.title; $("#tkDesc").value=t.desc||""; fillSelect($("#tkPrio"), PRIOS, t.prio||"רגילה"); paintFormColors();
  $("#tkStart").value=t.start||ymd(new Date()); $("#tkDue").value=t.due||""; $("#tkDue").min=$("#tkStart").value;
  paintFormCk((t.check||[]).map(c=>c.text), []);
  tkFromPriv={pid:t.pid, files:(t.files||[]).slice(), check:(t.check||[]).map(c=>({text:c.text, done:!!c.done}))};
  if(tkFromPriv.files.length){ const n=mk("div","hint priv-carry","📎 "+tkFromPriv.files.length+" קבצים יעברו עם המשימה"); $("#tkPendList").before(n); }
  toast("משלימים את פרטי הצוות ושומרים — המשימה תעבור לצוות");
}
function privCard(t, today){
  const c=mk("div","tk priv"+(tkOpen(t)?"":" done")+(tkRowOpen.has(t.id)?" x":"")); c.dataset.id=t.id;
  c.addEventListener("click",ev=>{ if((tkLV!=="rows" && !isLite()) || c._swiped || ev.target.closest("button,input,textarea,select,a,label,.tk-check")) return;
    tkRowOpen.has(t.id) ? tkRowOpen.delete(t.id) : tkRowOpen.add(t.id); c.classList.toggle("x"); });
  if(tkOpen(t) && t.due) c.classList.add(t.due<today?"tl-late":t.due===today?"tl-today":"tl-future");
  const tt=mk("div","tk-t"), lk=mk("button","sn priv-sn","🔒"); lk.type="button";
  if(tkOpen(t) && !isViewer()){ lk.classList.add("priv-go"); lk.onclick=ev=>{ ev.stopPropagation(); privToTeam(t); }; }
  lk.title="משימה אישית — רק אתה רואה אותה";
  tt.append(tkCircle(t, ()=>{ meSet(t.pid,{done:tkOpen(t), doneAt:tkOpen(t)?nowLocal():""}); toast(tkOpen(t)?"סומנה כבוצעה — לא נרשם ביומן":"הוחזרה לפתוחות"); }, true), lk, mk("span","tk-tt",t.title||"(ללא כותרת)")); if(tkOpen(t)) tt.appendChild(remBell(t)); c.appendChild(tt);
  const tags=mk("div","tk-tags"), SL={}; ["eq","who","dept","prio","type","stat","extra","due"].forEach(k=>{ SL[k]=mk("span","sl sl-"+k); tags.appendChild(SL[k]); });
  const tag=(txt,cls,hue,slot)=>{ const x=mk("span","tk-tag"+(cls?" "+cls:""),txt); if(hue){ x.style.background="var(--c-"+hue+"-bg)"; x.style.color="var(--c-"+hue+")"; } SL[slot||"extra"].appendChild(x); };
  tag("אישית","privt",null,"who");
  if(tkOpen(t)){
    const pr=prioOf(t); if(pr!=="רגילה") tag(pr,"",PRIO_HUE[pr],"prio");
    if(t.check.length) tag("☑ "+t.check.filter(x=>x.done).length+"/"+t.check.length, t.check.every(x=>x.done)?"ok":"");
    if(t.start) tag((t.start>today?"מתחילה ":"התחלה ")+dmy(t.start).slice(0,5),"pstart",null,"due");   // a personal task always shows its start (the day it was opened, unless set)
    if(t.due) tag((t.due<today?"באיחור · ":t.due===today?"היום · ":"יעד ")+dmy(t.due).slice(0,5), t.due<today?"late":t.due===today?"today":"future", null, "due");
  } else tag("בוצעה"+(t.doneAt?" "+fmtWhen(t.doneAt).slice(0,5):""),"ok",null,"due");
  c.appendChild(tags);
  c.appendChild(mk("div","tk-m","רק לי · לא נרשם ביומן"));
  if(t.desc) c.appendChild(mk("p","tk-d",t.desc));
  const upd=patch=>meSet(t.pid, patch);
  if(t.check.length){
    const box=mk("div","tk-check"), done=t.check.filter(x=>x.done).length;
    box.appendChild(mk("div","tk-check-h","רשימת בדיקה ("+done+" מתוך "+t.check.length+")"));
    t.check.forEach(it=>{ const r=mk("div","ck"+(it.done?" done":"")), b=mk("button","ck-box"); b.type="button"; b.setAttribute("role","checkbox"); b.setAttribute("aria-checked",String(!!it.done)); b.setAttribute("aria-label",it.text);
      b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      b.onclick=()=>{ const x=meGet().find(m=>m.id===t.pid); if(!x) return; (x.check||[]).forEach(cc=>{ if(cc.id===it.id) cc.done=!cc.done; }); upd({check:x.check}); };
      const tx=mk("span","ck-t",it.text); tx.onclick=()=>b.click(); r.append(b,tx); box.appendChild(r); });
    c.appendChild(box);
  }
  tkBg(t, c);
  if(isLite()){
    if(tkOpen(t) && t.due) tt.appendChild(mk("span","lite-due "+(t.due<today?"late":t.due===today?"today":"future"), t.due<today?"באיחור · "+dmy(t.due).slice(0,5):t.due===today?"היום":dmy(t.due).slice(0,5)));
    const ci=t.check||[]; c.insertBefore(mk("div","lite-sub",["🔒 אישית", prioOf(t)!=="רגילה"?prioOf(t):"", ci.length?"☑ "+ci.filter(x=>x.done).length+"/"+ci.length:"", t.files.length?"📎 "+t.files.length:""].filter(Boolean).join(" · ")), tt.nextSibling); }
  if(t.files.length){ const ph=mk("div","ev-ph-grid priv-ph"); evThumbs(t.files, ph, tkOpen(t) ? m=>{ if(!confirm("להסיר את הקובץ מהמשימה?\n"+m.name)) return;
      const x=meGet().find(z=>z.id===t.pid); if(x) upd({files:(x.files||[]).filter(f=>f.id!==m.id)}); } : null); c.appendChild(ph); }
  const acts=mk("div","tk-acts row");
  if(tkOpen(t)){   // done: only with the circle at the start of the task
    const ed=mk("button","btn","ערוך"); ed.type="button"; ed.onclick=()=>openTaskForm(t.id); acts.appendChild(ed);
    [["📷","צילום",true],["📎","קובץ / תמונה",false]].forEach(([ic,lb,cam])=>{ const l=mk("label","btn priv-add"), i=mk("input"); i.type="file"; i.hidden=true;
      if(cam){ i.accept="image/*"; i.setAttribute("capture","environment"); } else i.multiple=true; l.title=lb; l.append(ic+" "+lb, i);
      i.onchange=async()=>{ const fl=[...i.files]; i.value=""; if(fl.length) await privAddFiles(t.pid, fl, cam); }; acts.appendChild(l); }); }
  else { const bk=mk("button","btn","↩ החזר לפתוחות"); bk.type="button"; bk.onclick=()=>upd({done:false, doneAt:""}); acts.appendChild(bk); }
  const del=mk("button","btn ghost","מחק"); del.type="button"; del.onclick=()=>{ if(!confirm("למחוק את המשימה האישית?\n"+t.title)) return; upd({del:true}); toast("המשימה האישית נמחקה"); };   // my own: I delete it (not the managers-only delete)
  acts.appendChild(del); c.appendChild(acts);
  return c;
}
if($("#cHello")){ $("#cHello").style.cursor="pointer"; $("#cHello").title="המשימות שלי"; $("#cHello").onclick=()=>{ tkView="mine"; paintTkSeg(); renderTasks(); show("Tasks"); window.scrollTo({top:0}); }; }
setTimeout(weeklyCheck,1500);
if(DEEP_OPEN) goList({stat:OPEN_ANY});

/* ===== notice board (📌): managers post short notices with an end date; everyone sees them on the dashboard and on the office screen.
   Team log: board/<id> in the cloud (cloud.js); on this device only: kept here. */
var BOARD=(()=>{ try{ const a=JSON.parse(localStorage.getItem("ogg-board")||"[]"); return Array.isArray(a)?a:[]; }catch(e){ return []; } })();
function boardActive(){ const d=ymd(new Date()); return (BOARD||[]).filter(x=>x && x.text && (!x.until || x.until>=d))
  .sort((a,b)=>(b.important?1:0)-(a.important?1:0) || String(b.at).localeCompare(String(a.at))); }
function boardSave(){ try{ localStorage.setItem("ogg-board",JSON.stringify(BOARD)); }catch(e){} }
window.boardApply=items=>{ BOARD=items||[]; boardSave(); paintBoard(); paintTicker(); if(TV) tvPaint(true); if(window.bsRefresh) window.bsRefresh(); };
function goBoard(id){ if(TV) return; if(typeof bsOpenAt==="function"){ bsOpenAt(id); return; } show("Dash"); const c=$("#dBoard"); if(c && !c.hidden){ c.scrollIntoView({block:"center"}); c.classList.add("flash"); setTimeout(()=>c.classList.remove("flash"),1800); } }
function paintBoard(){
  const act=boardActive(), mgr=isManager() && !isViewer();
  const qn=$("#qkBdN"); if(qn){ qn.textContent=act.length; qn.hidden=!act.length; qn.classList.toggle("imp",act.some(x=>x.important)); }
  const box=$("#dBoard"); if(!box) return;
  box.hidden = !act.length && !mgr;
  $("#bdAdd").hidden=!mgr || !$("#bdForm").hidden;
  const L=$("#bdList"); L.textContent="";
  if(!act.length) L.appendChild(mk("p","hint","אין מודעות כרגע. מודעה שתפרסם תופיע כאן לכל הצוות ועל מסך המשרד."));
  act.forEach(x=>{ const r=mk("div","bd-it"+(x.important?" imp":""));
    r.appendChild(mk("div","bd-tx",x.text));
    r.appendChild(mk("div","bd-m",[x.by, x.until?"עד "+dmy(x.until).slice(0,5):""].filter(Boolean).join(" · ")));
    if(mgr){ const d=mk("button","bd-del","✕"); d.type="button"; d.title="הסר את המודעה"; d.setAttribute("aria-label","הסר את המודעה");
      d.onclick=async()=>{ if(!confirm("להסיר את המודעה?\n"+x.text)) return;
        if(CLOUD_ON && window.cloudBoardDel){ if(!await window.cloudBoardDel(x.id)) toast("ההסרה נכשלה"); }
        else { BOARD=BOARD.filter(b=>b.id!==x.id); boardSave(); paintBoard(); paintTicker(); } };
      r.appendChild(d); }
    L.appendChild(r); });
}
$("#bdAdd").onclick=()=>{ $("#bdForm").hidden=false; $("#bdAdd").hidden=true; const d=new Date(); d.setDate(d.getDate()+7); $("#bdUntil").value=ymd(d); $("#bdUntil").min=ymd(new Date()); $("#bdImp").checked=false; $("#bdText").focus(); };
$("#bdCancel").onclick=()=>{ $("#bdForm").hidden=true; $("#bdText").value=""; paintBoard(); };
$("#bdForm").onsubmit=async ev=>{ ev.preventDefault(); const text=$("#bdText").value.trim(); if(!text){ $("#bdText").focus(); return; }
  const it={id:newId(), text:text.slice(0,400), until:$("#bdUntil").value||"", important:$("#bdImp").checked, by:reporter()||"", at:nowLocal()};
  if(CLOUD_ON && window.cloudBoardPut){ if(!await window.cloudBoardPut(it)){ toast("הפרסום נכשל — אולי צריך לפרסם את כללי האבטחה המעודכנים"); return; } }
  else { BOARD.push(it); boardSave(); }
  $("#bdText").value=""; $("#bdForm").hidden=true; paintBoard(); paintTicker(); toast("המודעה פורסמה 📌"); };
paintBoard(); paintTicker();          // the ticker painted before the notices were loaded

/* ===== notice board "studio": the board exactly as the office screen shows it — 16:9 slides of up to 6 notices —
   and, for managers, editing right there: tap a notice (or "＋ מודעה חדשה"), change the text on the slide itself or in the
   bar above, the end date and "חשוב"; ✓ saves (to the whole team). "▶ הצג" plays the slides full screen, like a slideshow. */
const BS_PER=6;
let bsSel=null, bsDraft=null, bsPlayT=null;          // bsSel: id being edited; bsDraft: its working copy
const bsMgr=()=>isManager() && !isViewer();
function bsPages(list){ const P=[]; for(let i=0;i<Math.max(1,Math.ceil(list.length/BS_PER));i++) P.push(list.slice(i*BS_PER,(i+1)*BS_PER)); return P; }
function bsList(){                                      // what the screen shows, with the note being edited in its place
  let a=boardActive().slice();
  if(bsDraft){ const i=a.findIndex(x=>x.id===bsDraft.id); if(i>=0) a[i]=bsDraft; else a.unshift(bsDraft); }
  return a;
}
function bsClock(){ const d=new Date(), p=v=>String(v).padStart(2,"0");
  document.querySelectorAll("#bsSlides .bs-time").forEach(e=>e.textContent=p(d.getHours())+":"+p(d.getMinutes()));
  const ds=new Intl.DateTimeFormat("he-IL",{weekday:"long"}).format(d)+" · "+p(d.getDate())+"/"+p(d.getMonth()+1)+"/"+d.getFullYear();
  document.querySelectorAll("#bsSlides .bs-date").forEach(e=>e.textContent=ds);
}
function bsMeta(x){ return [x.by, x.until?"עד "+dmy(x.until).slice(0,5):""].filter(Boolean).join(" · "); }
function bsRender(){
  const box=$("#bsSlides"); box.textContent="";
  const list=bsList(), pages=bsPages(list), mgr=bsMgr();
  pages.forEach((pg,pi)=>{
    const s=mk("div","bs-slide");
    s.innerHTML='<header class="bs-top"><div class="bs-brand"><img src="icons/logo-header.png" alt=""><div><b>יומן אירועים ומשימות</b><span>מט"ש אוג</span></div></div>'
      +'<div class="bs-clock"><b class="bs-time"></b><span class="bs-date"></span></div></header>'
      +'<div class="bs-tick"><b>● לייב</b><span></span></div>';                  // the ticker strip, as on the screen
    s.querySelector(".bs-tick span").textContent=list.filter(x=>x.text).map(x=>(x.important?"❗ ":"📌 ")+x.text.split("\n")[0]).join("   ·   ");
    const h=mk("h2","bs-h","📌 לוח מודעות"); if(pages.length>1) h.appendChild(mk("small",null,"שקופית "+(pi+1)+" מתוך "+pages.length)); s.appendChild(h);
    const g=mk("div","bs-board");
    if(!pg.length) g.appendChild(mk("div","bs-empty", mgr ? "אין מודעות. לחץ \"＋ מודעה חדשה\" כדי להוסיף." : "אין מודעות כרגע."));
    pg.forEach(x=>{
      const n=mk("div","bs-note"+(x.important?" imp":"")+(x.id===bsSel?" sel":"")); n.dataset.id=x.id;
      const p=mk("p",null,x.text||""); if(!x.text) p.dataset.ph="כתוב כאן את המודעה…";
      n.append(p, mk("span",null,bsMeta(x)));
      if(mgr){ n.tabIndex=0; n.title="לחץ לעריכה";
        n.onclick=()=>{ if(bsSel!==x.id) bsEdit(x); };
        if(x.id===bsSel){ p.contentEditable="plaintext-only"; if(p.contentEditable!=="plaintext-only") p.contentEditable="true";
          p.oninput=()=>{ bsDraft.text=p.innerText.replace(/\n$/,"").slice(0,400); $("#bsText").value=bsDraft.text; bsFit(); }; } }
      g.appendChild(n); });
    s.appendChild(g); s.appendChild(mk("div","bs-foot")); s.appendChild(mk("div","bs-over","⚠ לא נכנס בשקופית — קצר את הטקסט"));
    box.appendChild(s);
  });
  bsClock(); requestAnimationFrame(bsFit);
  $("#bsTools").hidden=!bsDraft; $("#bsAdd").hidden=!mgr;
  $("#bsHint").textContent = mgr ? (bsDraft ? "עורך: אפשר לכתוב ישר על השקופית או בשורה למעלה. ✓ שמור — וזה מתעדכן אצל כולם ועל מסך המשרד."
                                            : "לחץ על מודעה כדי לערוך אותה. מודעה חשובה ❗ מופיעה ראשונה. כל שקופית מחזיקה עד "+BS_PER+" מודעות.")
                                 : "כך נראה לוח המודעות על מסך המשרד. רק מנהל יכול לשנות.";
}
function bsFit(){ document.querySelectorAll("#bsSlides .bs-slide").forEach(s=>{ const g=s.querySelector(".bs-board"); s.classList.toggle("over", g.scrollHeight>g.clientHeight+2); }); }
function bsEdit(x){
  if(bsDraft && !bsCommitAsk()) return;
  bsSel=x.id; bsDraft=Object.assign({},x);
  $("#bsText").value=bsDraft.text||""; $("#bsUntil").value=bsDraft.until||""; $("#bsUntil").min=ymd(new Date()); $("#bsImp").checked=!!bsDraft.important;
  $("#bsDel").hidden=!!x._new;
  bsRender();
  const n=document.querySelector('#bsSlides .bs-note.sel'); if(n){ n.scrollIntoView({block:"nearest"}); const p=n.querySelector("p"); if(matchMedia("(min-width:700px)").matches && p) p.focus(); else $("#bsText").focus(); }
}
function bsChanged(){ if(!bsDraft) return false; if(bsDraft._new) return !!(bsDraft.text||"").trim();
  const o=(BOARD||[]).find(b=>b.id===bsDraft.id)||{}; return (o.text||"")!==(bsDraft.text||"") || (o.until||"")!==(bsDraft.until||"") || !!o.important!==!!bsDraft.important; }
function bsCommitAsk(){                                    // leaving a note with unsaved changes
  if(!bsChanged()){ bsSel=null; bsDraft=null; return true; }
  if(confirm("לשמור את השינויים במודעה?")){ bsSave(); return false; }
  bsSel=null; bsDraft=null; return true;
}
async function bsSave(){
  if(!bsDraft) return;
  const text=(bsDraft.text||"").trim();
  if(!text){ toast("המודעה ריקה"); $("#bsText").focus(); return; }
  const it={id:bsDraft.id, text:text.slice(0,400), until:bsDraft.until||"", important:!!bsDraft.important,
            by:bsDraft.by||reporter()||"", at:bsDraft._new ? nowLocal() : (bsDraft.at||nowLocal())};
  $("#bsSave").disabled=true;
  if(CLOUD_ON && window.cloudBoardPut){ const ok=await window.cloudBoardPut(it); $("#bsSave").disabled=false;
    if(!ok){ toast("השמירה נכשלה — אולי אין רשת"); return; }
    const i=BOARD.findIndex(b=>b.id===it.id); if(i>=0) BOARD[i]=it; else BOARD.push(it); }
  else { $("#bsSave").disabled=false; const i=BOARD.findIndex(b=>b.id===it.id); if(i>=0) BOARD[i]=it; else BOARD.push(it); boardSave(); }
  bsSel=null; bsDraft=null; paintBoard(); paintTicker(); bsRender(); toast("נשמר — מוצג לכל הצוות ועל מסך המשרד 📌");
}
async function bsDelete(){
  if(!bsDraft || bsDraft._new) return;
  if(!confirm("להסיר את המודעה?\n"+(bsDraft.text||""))) return;
  const id=bsDraft.id;
  if(CLOUD_ON && window.cloudBoardDel){ if(!await window.cloudBoardDel(id)){ toast("ההסרה נכשלה"); return; } }
  BOARD=BOARD.filter(b=>b.id!==id); boardSave();
  bsSel=null; bsDraft=null; paintBoard(); paintTicker(); bsRender(); toast("המודעה הוסרה");
}
function bsOpen(){ bsSel=null; bsDraft=null; bsRender(); const d=$("#dlgStudio"); if(!d.open) d.showModal(); clearInterval(bsOpen.t); bsOpen.t=setInterval(bsClock,15e3); }
window.bsRefresh=()=>{ if($("#dlgStudio").open && !bsDraft) bsRender(); };   // someone else changed the board meanwhile
$("#bsOpen").onclick=bsOpen; $("#bsOpen2").onclick=bsOpen;
$("#bsAdd").onclick=()=>{ const d=new Date(); d.setDate(d.getDate()+7);
  bsEdit({id:newId(), text:"", until:ymd(d), important:false, by:reporter()||"", _new:true}); };
$("#bsText").oninput=()=>{ if(!bsDraft) return; bsDraft.text=$("#bsText").value; const p=document.querySelector("#bsSlides .bs-note.sel p"); if(p){ p.textContent=bsDraft.text; } bsFit(); };
$("#bsUntil").onchange=()=>{ if(!bsDraft) return; bsDraft.until=$("#bsUntil").value; const s=document.querySelector("#bsSlides .bs-note.sel span"); if(s) s.textContent=bsMeta(bsDraft); };
$("#bsImp").onchange=()=>{ if(!bsDraft) return; bsDraft.important=$("#bsImp").checked; const n=document.querySelector("#bsSlides .bs-note.sel"); if(n) n.classList.toggle("imp",bsDraft.important); bsFit(); };
$("#bsSave").onclick=bsSave; $("#bsDel").onclick=bsDelete;
$("#bsCancel").onclick=()=>{ bsSel=null; bsDraft=null; bsRender(); };
$("#bsClose").onclick=()=>{ if(bsDraft && !bsCommitAsk()) return; $("#dlgStudio").close(); };
$("#dlgStudio").addEventListener("cancel",ev=>{ if(bsDraft && bsChanged()){ ev.preventDefault(); $("#bsClose").click(); } });
$("#dlgStudio").addEventListener("close",()=>{ clearInterval(bsOpen.t); bsSel=null; bsDraft=null; });
// ▶ הצג: the slides full screen, one at a time (14 s each, like the office screen); a tap / any key / Esc ends it
$("#bsPlay").onclick=async()=>{
  if(bsDraft && !bsCommitAsk()) return; bsRender();
  const box=$("#bsSlides"), S=[...box.querySelectorAll(".bs-slide")]; if(!S.length) return;
  let i=0; box.classList.add("playing"); const showI=()=>S.forEach((s,k)=>s.classList.toggle("on",k===i));
  showI(); try{ await box.requestFullscreen(); }catch(e){}
  const stop=()=>{ clearInterval(bsPlayT); box.classList.remove("playing"); S.forEach(s=>s.classList.remove("on"));
    box.onclick=null; document.removeEventListener("keydown",key,true); if(document.fullscreenElement) document.exitFullscreen().catch(()=>{}); };
  const key=ev=>{ ev.preventDefault(); ev.stopPropagation(); stop(); };
  box.onclick=stop; document.addEventListener("keydown",key,true);
  document.addEventListener("fullscreenchange",function fc(){ if(!document.fullscreenElement){ document.removeEventListener("fullscreenchange",fc); if(box.classList.contains("playing")) stop(); } });
  clearInterval(bsPlayT); bsPlayT=setInterval(()=>{ i=(i+1)%S.length; showI(); }, 14000);
};

/* ===== office screen settings (managers): which pages, how long each, which numbers, and items hidden from the screen.
   Kept in the cloud as board/_screen (managers write the board; everyone in the team, the office screen too, reads it). */
var TVC=null;
const TVC_DEF={pages:{tk:true,ev:true,bd:true,num:true}, ticker:true, secs:14,
  nums:{open:true,late:true,today:true,evopen:true,faults:true,closed:true}, hide:[]};
function tvCfg(){ if(!TVC){ try{ TVC=JSON.parse(localStorage.getItem("ogg-tv-cfg")||"null"); }catch(e){} }
  const c=TVC||{}; return {pages:Object.assign({},TVC_DEF.pages,c.pages), ticker:c.ticker!==false, secs:+c.secs||TVC_DEF.secs,
    nums:Object.assign({},TVC_DEF.nums,c.nums), hide:Array.isArray(c.hide)?c.hide.slice():[]}; }
function tvHidden(k,id){ return tvCfg().hide.includes(k+":"+id); }
window.tvCfgApply=c=>{ TVC=c||{}; try{ localStorage.setItem("ogg-tv-cfg",JSON.stringify(TVC)); }catch(e){}
  if(typeof tvPaint==="function") tvPaint(true); if($("#dlgTvCfg") && $("#dlgTvCfg").open) tvCfgPaint(); };
async function tvCfgSave(c){
  const prev=TVC; window.tvCfgApply(c);
  if(CLOUD_ON && window.cloudScreenPut && !(await window.cloudScreenPut(c))){ window.tvCfgApply(prev); toast("השמירה נכשלה — אולי אין רשת"); return false; }
  return true;
}
function tvHideItem(k,id,name){
  const c=tvCfg(); if(!c.hide.includes(k+":"+id)) c.hide.push(k+":"+id);
  tvCfgSave(c).then(ok=>{ if(ok) toast("הוסתר מהמסך: "+name,{label:"בטל", fn:()=>{ const d=tvCfg(); d.hide=d.hide.filter(x=>x!==k+":"+id); tvCfgSave(d); }}); });
}
/* the settings window */
function tvCfgPaint(){
  const c=tvCfg(), B=$("#tvcBody"); B.textContent="";
  const sec=(t)=>{ const s=mk("div","tvc-sec"); s.appendChild(mk("h4",null,t)); B.appendChild(s); return s; };
  const chk=(box,label,on,fn)=>{ const l=mk("label","tk-chk"), i=mk("input"); i.type="checkbox"; i.checked=on; i.onchange=()=>fn(i.checked); l.append(i," "+label); box.appendChild(l); };
  const set=fn=>v=>{ const d=tvCfg(); fn(d,v); tvCfgSave(d).then(ok=>{ if(ok) toast("נשמר — המסך מתעדכן"); }); };
  const p=sec("עמודים במסך");
  [["tk","📋 משימות פתוחות"],["ev","⚠ אירועים פתוחים"],["bd","📌 לוח מודעות"],["num","🔢 תמונת מצב (מספרים)"]].forEach(([k,l])=>chk(p,l,c.pages[k],set((d,v)=>{ d.pages[k]=v; })));
  chk(p,"📰 פס המבזקים למעלה",c.ticker,set((d,v)=>{ d.ticker=v; }));
  const r=mk("label","tvc-secs"); r.appendChild(mk("span",null,"כל עמוד מוצג "));
  const s=mk("select"); [8,10,14,20,30,45,60].forEach(n=>{ const o=mk("option",null,n+" שניות"); o.value=n; if(n===c.secs) o.selected=true; s.appendChild(o); });
  s.onchange=()=>set((d,v)=>{ d.secs=+v; })(s.value); r.appendChild(s); p.appendChild(r);
  const n=sec("תמונת מצב — אילו מספרים");
  TV_NUMS.forEach(x=>chk(n,x.l,c.nums[x.k],set((d,v)=>{ d.nums[x.k]=v; })));
  const h=sec("מוסתרים מהמסך ("+c.hide.length+")");
  if(!c.hide.length) h.appendChild(mk("p","hint","אין. על המסך — לחיצה על 🚫 בפינת כרטיס מסתירה אותו מהמסך בלבד (באפליקציה הוא נשאר)."));
  c.hide.forEach(key=>{ const [k,id]=[key.slice(0,1),key.slice(2)];
    const nm = k==="t" ? ((tasks.find(t=>t.id===id)||{}).title||"משימה שנסגרה/נמחקה") : k==="e" ? (()=>{ const e=events.find(x=>x.id===id); return e ? (e.title||String(e.desc||"").slice(0,60)||"אירוע") : "אירוע שנמחק"; })()
             : ((BOARD||[]).find(b=>b.id===id)||{}).text||"מודעה שהוסרה";
    const row=mk("div","tvc-hid"); row.appendChild(mk("span",null,(k==="t"?"📋 ":k==="e"?"⚠ ":"📌 ")+nm));
    const b=mk("button","btn mini","↩ החזר למסך"); b.type="button"; b.onclick=()=>set(d=>{ d.hide=d.hide.filter(x=>x!==key); })(); row.appendChild(b); h.appendChild(row); });
  if(c.hide.length>1){ const b=mk("button","btn mini","החזר הכל"); b.type="button"; b.onclick=()=>set(d=>{ d.hide=[]; })(); h.appendChild(b); }
}
function tvCfgOpen(){ if(!isManager() || isViewer()){ toast("רק מנהל יכול לשנות את המסך"); return; } tvCfgPaint(); const d=$("#dlgTvCfg"); if(!d.open) d.showModal(); }
$("#tvcClose").onclick=()=>$("#dlgTvCfg").close();
if($("#tvCfgOpen")) $("#tvCfgOpen").onclick=tvCfgOpen;
const TV_NUMS=[{k:"open",l:"משימות פתוחות"},{k:"late",l:"משימות באיחור"},{k:"today",l:"משימות להיום"},{k:"evopen",l:"אירועים פתוחים"},{k:"faults",l:"תקלות פתוחות"},{k:"closed",l:"נסגרו היום"}];

/* ===== office screen: big, rotating, live — header (clock), the ticker, one page at a time
   (open tasks, open events, notice board, the numbers), each page for a few seconds. No buttons; nothing can be changed here. */
let tvOn=false, tvPages=[], tvI=0, tvTimer=null, tvSig="", tvLock=null, tvLast=Date.now();
function tvBuild(){
  if($("#tvRoot")) return;
  const R=mk("div"); R.id="tvRoot";
  R.innerHTML='<header class="tv-top"><div class="tv-brand"><img src="icons/logo-header.png" alt=""><div><b>יומן אירועים ומשימות</b><span>מט"ש אוג</span></div></div>'
    +'<div class="tv-clock"><b id="tvTime"></b><span id="tvDate"></span></div></header>'
    +'<div class="ticker tv-ticker" id="tvTicker"><span class="tk-live" aria-hidden="true"><i></i>לייב</span><div class="tk-vp"><div class="tk-track" id="tvTickTrack"></div></div></div>'
    +'<main class="tv-page" id="tvPage"></main>'
    +'<footer class="tv-foot"><div class="tv-dots" id="tvDots"></div><span id="tvUpd"></span><span class="tv-hint" id="tvHint"></span><button type="button" class="tv-cfg" id="tvCfgBtn" hidden>⚙ התאמת המסך</button></footer>'
    +'<button type="button" class="tv-exit" id="tvExit">✕ יציאה ממצב מסך</button>';
  document.body.appendChild(R);
  $("#tvExit").onclick=()=>{ if(isViewer()){ toast("זה מסך משרד (צופה) — כדי לצאת מתנתקים מהחשבון"); return; } location.href=location.pathname; };
  let hideT=null; document.addEventListener("mousemove",()=>{ R.classList.add("show-exit"); clearTimeout(hideT); hideT=setTimeout(()=>R.classList.remove("show-exit"),2500); });
}
function tvClock(){ const d=new Date(), p=v=>String(v).padStart(2,"0");
  $("#tvTime").textContent=p(d.getHours())+":"+p(d.getMinutes());
  $("#tvDate").textContent=new Intl.DateTimeFormat("he-IL",{weekday:"long"}).format(d)+" · "+p(d.getDate())+"/"+p(d.getMonth()+1)+"/"+d.getFullYear();
  const s=Math.round((Date.now()-tvLast)/1000); $("#tvUpd").textContent = navigator.onLine===false ? "⚠ אין חיבור — מוצג המידע האחרון" : "מתעדכן בלייב · עודכן לפני "+(s<60?s+" שנ׳":Math.round(s/60)+" דק׳");
}
function tvData(){
  const today=ymd(new Date());
  const tks=tkVis().filter(tkOpen).sort((a,b)=>{ const r=t=>t.due && t.due<today ? 0 : t.due===today ? 1 : prioOf(t)==="דחופה" ? 2 : 3;
    return r(a)-r(b) || String(a.due||"9").localeCompare(String(b.due||"9")); });
  const evs=events.filter(isOpen).sort((a,b)=>String(b.when||"").localeCompare(String(a.when||"")));
  const c=tvCfg(), vis=k=>x=>!c.hide.includes(k+":"+x.id);
  return {today, tks:tks.filter(vis("t")), evs:evs.filter(vis("e")), board:boardActive().filter(vis("b"))};
}
function tvMakePages(){
  const D=tvData(), P=[], per=8, on=tvCfg().pages;
  if(on.tk) for(let i=0;i<Math.max(1,Math.ceil(D.tks.length/per));i++) P.push({k:"tk", title:"משימות פתוחות", n:D.tks.length, items:D.tks.slice(i*per,(i+1)*per), pg:[i+1,Math.ceil(D.tks.length/per)]});
  if(on.ev) for(let i=0;i<Math.ceil(D.evs.length/per);i++) P.push({k:"ev", title:"אירועים פתוחים", n:D.evs.length, items:D.evs.slice(i*per,(i+1)*per), pg:[i+1,Math.ceil(D.evs.length/per)]});
  const bn=Math.ceil(D.board.length/6);
  if(on.bd) for(let i=0;i<bn;i++) P.push({k:"bd", title:"📌 לוח מודעות", items:D.board.slice(i*6,(i+1)*6), pg:[i+1,bn], long:true});
  if(on.num || !P.length) P.push({k:"num", title:"תמונת מצב", D});     // never an empty screen
  return P;
}
function tvRenderPage(pg){
  const M=$("#tvPage"); M.textContent=""; M.className="tv-page tvp-"+pg.k;
  const h=mk("h2","tv-h",pg.title); if(pg.n!=null) h.appendChild(mk("span","tv-n",String(pg.n))); if(pg.pg && pg.pg[1]>1) h.appendChild(mk("small",null,"עמוד "+pg.pg[0]+" מתוך "+pg.pg[1])); M.appendChild(h);
  const today=ymd(new Date()), grid=mk("div","tv-grid");
  if(pg.k==="tk"){
    if(!pg.items.length) grid.appendChild(mk("div","tv-empty","אין משימות פתוחות 👍"));
    pg.items.forEach(t=>{ const st=t.due && t.due<today ? "late" : t.due===today ? "today" : "future", pr=prioOf(t);
      const c=mk("div","tv-card tl-"+(t.due?st:"none")); tvClickable(c,()=>goTask(t.id)); tvHideBtn(c,"t",t.id,t.title||"משימה");
      const top=mk("div","tv-ct"); if(t.no) top.appendChild(mk("span","tv-no","#"+t.no)); top.appendChild(mk("b",null,t.title||"משימה")); c.appendChild(top);
      const m=mk("div","tv-cm");
      if(t.due) m.appendChild(mk("span","tv-tag "+st,(st==="late"?"באיחור · ":st==="today"?"היום · ":"יעד ")+dmy(t.due).slice(0,5)));
      if(pr!=="רגילה") m.appendChild(mk("span","tv-tag pr-"+PRIO_HUE[pr],pr));
      const who=(t.ppl||[])[0] || (t.depts||[]).join(", "); if(who) m.appendChild(mk("span","tv-who","👤 "+who));
      if((t.loc||[]).length) m.appendChild(mk("span","tv-who","📍 "+t.loc.join(", ")));
      c.appendChild(m); grid.appendChild(c); });
  } else if(pg.k==="ev"){
    pg.items.forEach(e=>{ const ty=(e.type||[])[0]||"אירוע", c=mk("div","tv-card ev"); tvClickable(c,()=>evGo(e.id)); tvHideBtn(c,"e",e.id,e.title||ty);
      c.style.borderInlineStartColor="var(--c-"+hueOf(ty)+")";
      const top=mk("div","tv-ct"); if(e.no) top.appendChild(mk("span","tv-no","#"+e.no)); top.appendChild(mk("b",null,e.title||String(e.desc||"").slice(0,90)||ty)); c.appendChild(top);
      const m=mk("div","tv-cm"); const tg=mk("span","tv-tag",ty); tg.style.background="var(--c-"+hueOf(ty)+"-bg)"; tg.style.color="var(--c-"+hueOf(ty)+")"; m.appendChild(tg);
      if((e.loc||[]).length) m.appendChild(mk("span","tv-who","📍 "+e.loc.join(", ")));
      if(e.when) m.appendChild(mk("span","tv-who","🕒 "+fmtWhen(e.when)));
      c.appendChild(m); grid.appendChild(c); });
  } else if(pg.k==="bd"){
    grid.className="tv-board";
    pg.items.forEach(x=>{ const c=mk("div","tv-note"+(x.important?" imp":"")); tvClickable(c,()=>bsOpenAt(x.id)); tvHideBtn(c,"b",x.id,x.text.slice(0,40)); c.appendChild(mk("p",null,x.text));
      c.appendChild(mk("span",null,[x.by, x.until?"עד "+dmy(x.until).slice(0,5):""].filter(Boolean).join(" · "))); grid.appendChild(c); });
  } else {
    grid.className="tv-nums"; const D=pg.D, c=tvCfg();
    const V={open:[D.tks.length,"",()=>goTasks({})], late:[D.tks.filter(t=>t.due && t.due<D.today).length,"late",()=>goTasks({f:{late:true}})],
      today:[D.tks.filter(t=>t.due===D.today).length,"today",()=>goTasks({})], evopen:[D.evs.length,"",()=>goList({stat:OPEN_ANY,ppl:""})],
      faults:[D.evs.filter(e=>(e.type||[]).includes("תקלה")).length,"late",()=>goList({stat:OPEN_ANY,type:"תקלה",ppl:""})],
      closed:[events.filter(e=>!isOpen(e) && String(e.closedAt||"").slice(0,10)===D.today).length,"today",()=>goList({from:D.today,to:D.today,ppl:""})]};
    TV_NUMS.filter(x=>c.nums[x.k]).forEach(x=>{ const [v,cls,go]=V[x.k], el=mk("div","tv-num "+cls); el.append(mk("b",null,nf(v)), mk("span",null,x.l)); tvClickable(el,go); grid.appendChild(el); });
  }
  M.appendChild(grid);
  const dots=$("#tvDots"); dots.textContent=""; tvPages.forEach((p,i)=>dots.appendChild(mk("i",i===tvI?"on":"")));
}
function tvPaint(force){                             // data changed: rebuild the pages, stay on the same kind of page
  if(!tvOn || tvAway) return;
  const sig=JSON.stringify([tasks.length, tasks.map(t=>t.upd||t.status).join(), events.length, events.filter(isOpen).map(e=>e.id+(e.ts||"")).join(), BOARD.map(b=>b.id+b.text+b.until).join()]);
  if(!force && sig===tvSig) return; tvSig=sig; tvLast=Date.now();
  const k=tvPages[tvI] && tvPages[tvI].k; tvPages=tvMakePages();
  if(tvI>=tvPages.length || (tvPages[tvI] && tvPages[tvI].k!==k)) tvI=Math.max(0,tvPages.findIndex(p=>p.k===k));
  tvRenderPage(tvPages[tvI]||tvPages[0]); paintTickerInto($("#tvTicker"),$("#tvTickTrack"),"tv");
}
/* editing from the office screen (anyone but "צופה"): a tap on a task, event, notice or ticker item leaves the screen view
   for the app at that item; "🖥️ חזרה למסך" (or 3 quiet minutes) brings the screen back where it was */
let tvAway=false, tvAwayT=null, tvAct=Date.now();
const tvCanEdit=()=>tvOn && !isViewer();
function tvClickable(el,fn){ if(!tvCanEdit()) return; el.classList.add("tv-click"); el.tabIndex=0; el.title="לחץ לעריכה";
  el.onclick=()=>tvGo(fn); el.onkeydown=ev=>{ if(ev.key==="Enter"){ ev.preventDefault(); tvGo(fn); } }; }
function tvHideBtn(el,k,id,name){ if(!tvCanEdit() || !isManager()) return;
  const b=mk("button","tv-hide","🚫"); b.type="button"; b.title="הסתר מהמסך (באפליקציה זה נשאר)"; b.setAttribute("aria-label","הסתר מהמסך");
  b.onclick=ev=>{ ev.stopPropagation(); tvHideItem(k,id,name); }; el.appendChild(b); }
function tvGo(fn){
  if(!tvOn){ fn(); return; }
  if(!tvCanEdit()){ toast("זה מסך משרד (צופה) — אי אפשר לשנות מכאן"); return; }
  tvAway=true; clearTimeout(tvTimer); document.documentElement.classList.remove("tv");
  let b=$("#tvBack"); if(!b){ b=mk("button","tv-back","🖥️ חזרה למסך"); b.id="tvBack"; b.type="button"; b.onclick=tvReturn; document.body.appendChild(b); }
  b.hidden=false; tvAct=Date.now();
  clearInterval(tvAwayT); tvAwayT=setInterval(()=>{ if(Date.now()-tvAct>3*60e3 && (typeof quietNow!=="function" || quietNow())) tvReturn(); },15e3);
  fn();
  // edited in a window (e.g. the notice board): closing it goes straight back to the screen
  setTimeout(()=>{ const d=document.querySelector("dialog[open]"); if(d) d.addEventListener("close",()=>setTimeout(tvReturn,50),{once:true}); },100);
}
function tvReturn(){
  if(!tvAway) return; tvAway=false; clearInterval(tvAwayT);
  document.querySelectorAll("dialog[open]").forEach(d=>d.close());
  const b=$("#tvBack"); if(b) b.hidden=true;
  document.documentElement.classList.add("tv"); scrollTo(0,0);
  tvPaint(true); clearTimeout(tvTimer); tvTimer=setTimeout(tvNext, tvDur(tvPages[tvI]));
}
["pointerdown","keydown","input"].forEach(t=>document.addEventListener(t,()=>{ tvAct=Date.now(); },true));
function bsOpenAt(id){ bsOpen(); const x=(BOARD||[]).find(b=>b.id===id); if(x && bsMgr()) bsEdit(x); }
function tvNext(){
  if(tvAway) return; tvPages=tvMakePages(); tvI=(tvI+1)%tvPages.length; tvRenderPage(tvPages[tvI]);
  clearTimeout(tvTimer); tvTimer=setTimeout(tvNext, tvDur(tvPages[tvI])); }
function tvDur(p){ const s=tvCfg().secs*1000; return p && p.long ? Math.round(s*1.4) : s; }
async function tvWake(){ try{ if("wakeLock" in navigator && !document.hidden) tvLock=await navigator.wakeLock.request("screen"); }catch(e){} }
function tvStart(){
  if(tvOn) return; tvOn=true; TV=true; document.documentElement.classList.add("tv");
  document.querySelectorAll("dialog[open]").forEach(d=>d.close());
  tvBuild(); tvClock(); setInterval(tvClock,1000);
  tvPages=tvMakePages(); tvI=0; tvRenderPage(tvPages[0]); setInterval(()=>{ const h=$("#tvHint"); if(h) h.textContent=tvCanEdit()?"✎ לחיצה על כרטיס — עריכה"+(isManager()?" · 🚫 — הסתרה מהמסך":""):"";
    const g=$("#tvCfgBtn"); if(g) g.hidden=!(tvCanEdit() && isManager()); },2000);
  $("#tvCfgBtn").onclick=()=>tvGo(tvCfgOpen); paintTickerInto($("#tvTicker"),$("#tvTickTrack"),"tv");
  clearTimeout(tvTimer); tvTimer=setTimeout(tvNext,tvDur(tvPages[0]));
  setInterval(()=>tvPaint(false),4000);
  tvWake(); document.addEventListener("visibilitychange",()=>{ if(!document.hidden) tvWake(); });
  // the opening screen: once signed in, go straight in
  const sp=setInterval(()=>{ const b=$("#spEnter"), s=$("#splash"); if(s && !s.hidden && b && !b.hidden){ b.click(); } if(s && s.hidden) clearInterval(sp); },800);
}
$("#tvOpen").onclick=()=>window.open(location.pathname+"?tv=1","_blank","noopener");
$("#tvCopy").onclick=async()=>{ const u=location.origin+location.pathname+"?tv=1"; try{ await navigator.clipboard.writeText(u); toast("הקישור הועתק: "+u); }catch(e){ prompt("הקישור למסך המשרד:",u); } };
if(TV) tvStart();
else { const w=setInterval(()=>{ if(isViewer()){ clearInterval(w); tvStart(); } },1500); }   // signed in as "צופה": the office screen opens by itself

/* settings → כללי: a manager gets a message on every change in every team task (on unless turned off; cloud.js reads it) */
if($("#newsAll")){ try{ $("#newsAll").checked=localStorage.getItem("ogg-news-all")!=="0"; }catch(e){}
  $("#newsAll").onchange=e=>{ try{ localStorage.setItem("ogg-news-all", e.target.checked?"1":"0"); }catch(_){} toast(e.target.checked?"תקבל הודעה על כל שינוי בכל משימה":"תקבל הודעות רק על המשימות שלך ושפתחת");
    if(window.cloudPushPrefs) window.cloudPushPrefs(); }; }

/* ===== morning briefing (🗒️ שיחת בוקר): managers only — a card on the dashboard and a form in a window.
   Attendance comes from the people list (with role), the open faults and today's recurring rounds come from the tasks,
   topics written in the briefing (work plan, open floor) stay in the briefing only — nothing is opened in the log from them;
   only tasks / events picked from the log are linked (their status can change from here).
   One briefing per day (id = the date; changing the date moves it). Team log: briefs/<date> in the cloud, readable by managers only
   (cloud.js, firestore.rules); this device keeps all of them too (IndexedDB when localStorage is full) — the folder (📁) lists them. */
var BRIEFS=(()=>{ try{ const o=JSON.parse(localStorage.getItem("ogg-briefs")||"{}"); return o && typeof o==="object" ? o : {}; }catch(e){ return {}; } })();
var brCur=null, brTouched=false, brCloudT=null;
const BR_REASONS=["חופש","מחלה","עבודה מרחוק / מתקן אחר","מילואים","הדרכה / קורס","עזיבה מוקדמת","אחר"];
const BR_CHECKS=["כלל הצוות תודרך בהנחיות הבטיחות היומיות","נבדק ציוד מגן אישי לכלל הנוכחים","אושרה עבודה בגובה / במרחב מוקף (אם רלוונטי)","הצוות מודע לנהלי חירום ונקודות כינוס"];
const BR_SECS={faults:{type:"תקלה", ph:"תקלה או קצה פתוח"}, maint:{type:"אחזקה", ph:"אחזקה או סבב"}, plan:{type:"כללי", ph:"מה עושים היום"},
  contr:{ph:"קבלן / גורם חוץ, מה ומתי", ev:true}, open:{type:"כללי", ph:"נושא", detail:true}};
const BR_DAYS=["יום ראשון","יום שני","יום שלישי","יום רביעי","יום חמישי","יום שישי","שבת"];
function brCanSee(){ return !TV && isManager() && !isViewer(); }
function brStore(){ saveBig("ogg-briefs",JSON.stringify(BRIEFS)); }
(async()=>{ try{ if(!localStorage.getItem("ogg-briefs")){ const v=await loadBig("ogg-briefs"); if(v){ const o=JSON.parse(v);
  if(o && typeof o==="object"){ Object.keys(o).forEach(k=>{ if(!BRIEFS[k]) BRIEFS[k]=o[k]; }); paintBriefCard(); } } } }catch(e){} })();
async function brDelete(id){
  delete BRIEFS[id]; brStore();
  if(CLOUD_ON && window.cloudBriefDel && !await window.cloudBriefDel(id)) toast("המחיקה מהענן נכשלה");
}
function brSave(b, cloudNow){
  b.upd=new Date().toISOString(); BRIEFS[b.id]=b; brStore();
  if(CLOUD_ON && window.cloudBriefPut){ clearTimeout(brCloudT);
    const go=async()=>{ if(!await window.cloudBriefPut(b)) toast("שיחת הבוקר נשמרה רק במכשיר — אולי צריך לפרסם את כללי האבטחה המעודכנים"); };
    if(cloudNow) return go(); brCloudT=setTimeout(go,2500); }
}
window.briefsApply=(list, gone)=>{ (gone||[]).forEach(id=>{ if(!(brCur && brCur.id===id && $("#dlgBrief").open)) delete BRIEFS[id]; });   // deleted or moved on another device
  (list||[]).forEach(b=>{ if(!b || !b.id) return; const l=BRIEFS[b.id];
    if(brCur && brCur.id===b.id && $("#dlgBrief").open) return;            // being edited here: keep what is on the screen
    if(!l || String(l.upd||"")<=String(b.upd||"")) BRIEFS[b.id]=b; });
  brStore(); paintBriefCard(); if($("#dlgBriefs").open) paintBriefs(); };
function brNew(d){ const now=new Date(), p=n=>String(n).padStart(2,"0");
  return {id:d, date:d, time:p(now.getHours())+":"+p(now.getMinutes()), leader:myName()||"", att:{}, linked:{},
    rows:{faults:[],maint:[],plan:[],contr:[],open:[]}, safety:"", checks:BR_CHECKS.map(()=>false), sig:"", done:false}; }
/* the open work the briefing goes over: late, urgent or in progress (not the recurring rounds — those have their own list) */
function brLinkedTasks(d){ return tasks.filter(t=>tkOpen(t) && !t.priv && !t.rep && ((t.due && t.due<d) || prioOf(t)==="דחופה" || tkStat(t)==="בטיפול" || t.type==="תקלה"))
  .sort((a,b)=>tkSortKey(a).localeCompare(tkSortKey(b))).slice(0,30); }
function brRepTasks(d){ return tasks.filter(t=>tkOpen(t) && !t.priv && t.rep && (t.due ? t.due<=d : (!t.start || t.start<=d)))
  .sort((a,b)=>tkSortKey(a).localeCompare(tkSortKey(b))).slice(0,30); }
function brCounts(b){ const r=b.rows||{}, n=k=>(r[k]||[]).filter(x=>x.tid).length;
  return {tasks:n("faults")+n("maint")+n("plan")+n("open"), ev:(r.contr||[]).filter(x=>x.eid).length,
    in:Object.values(b.att||{}).filter(a=>a.s==="in").length, out:Object.values(b.att||{}).filter(a=>a.s==="out").length}; }

function paintBriefCard(){
  const q=$("#qkBrief"); if(!q || !BRIEFS) return;           // (the dashboard can draw before this part of the file has run)
  if($("#dBrief")) $("#dBrief").hidden=true;                  // everything about the briefing lives in its window now
  q.hidden=!brCanSee(); if(q.hidden) return;
  const d=ymd(new Date()), b=BRIEFS[d];
  // the next briefing to open: today's — or, once today's is saved, the next day that has none (a draft for tomorrow)
  let nd=d; if(b && b.done){ const x=new Date(d+"T12:00"); do{ x.setDate(x.getDate()+1); nd=ymd(x); }while(BRIEFS[nd] && BRIEFS[nd].done); }
  const st=$("#qkBrSt");
  st.className="qk-st "+(b && b.done ? "ok" : "todo");
  st.textContent = b && b.done ? "✓ נעשתה "+(b.doneAt||"").slice(11,16) : b ? "● טיוטה" : "● עוד לא היום";
  q.onclick=()=>openBrief(nd);
}
/* one briefing in a list: day · date · time, then who led it and what came out of it */
function brItem(x, short){
  const c=brCounts(x), r=mk("button","br-hi"); r.type="button"; const dd=new Date(x.id+"T12:00");
  r.append(mk("b",null,BR_DAYS[dd.getDay()].replace("יום ","")+" · "+(short?dmy(x.id).slice(0,5):dmy(x.id))+(x.time?" · "+x.time:"")),
    mk("span",null, [x.done?"":"טיוטה", short?"":x.leader, c.in?c.in+" נוכחים":"", c.tasks?c.tasks+" משימות":"", c.ev?c.ev+" ביקורים":""].filter(Boolean).join(" · ")));
  r.onclick=()=>{ if($("#dlgBriefs").open) $("#dlgBriefs").close(); openBrief(x.id); };
  if(short) return r;
  const w=mk("div","br-fi"), pdf=mk("button","btn mini br-fpdf","PDF"); pdf.type="button"; pdf.setAttribute("aria-label","PDF של שיחת הבוקר מ-"+dmy(x.id));
  pdf.onclick=()=>brPdfOut(x, pdf); w.append(r,pdf); return w;
}
/* the folder (📁): every briefing, newest first, by month; search by name, topic or note; open any date (new or existing) */
if($("#brFolderBtn")) $("#brFolderBtn").onclick=()=>openBriefs();
function openBriefs(){ if(!brCanSee()) return; $("#brfQ").value=""; $("#brfDate").value=ymd(new Date()); paintBriefs(); $("#dlgBriefs").showModal(); }
function paintBriefs(){
  const L=$("#brfList"); L.textContent="";
  const q=$("#brfQ").value.trim().toLowerCase();
  const all=Object.values(BRIEFS).sort((a,c)=>c.id.localeCompare(a.id));
  const hit=all.filter(x=>!q || JSON.stringify([x.leader,x.att,x.rows,x.safety,x.notes,x.evs,dmy(x.id)]).toLowerCase().includes(q));
  $("#brfCount").textContent=all.length ? (q ? hit.length+" מתוך "+all.length+" שיחות" : all.length+" שיחות") : "";
  if(!hit.length){ L.appendChild(mk("p","hint",all.length?"לא נמצאה שיחה שמתאימה לחיפוש.":"עדיין אין שיחות בוקר. בוחרים תאריך ולוחצים \"פתח\".")); return; }
  let mon="";
  hit.forEach(x=>{ const m=x.id.slice(0,7); if(m!==mon){ mon=m;
      L.appendChild(mk("div","br-mon",new Date(x.id+"T12:00").toLocaleDateString("he-IL",{month:"long",year:"numeric"}))); }
    L.appendChild(brItem(x,false)); });
}
$("#brfQ").oninput=paintBriefs;
$("#brfClose").onclick=()=>$("#dlgBriefs").close();
$("#brfOpen").onclick=()=>{ const d=$("#brfDate").value; if(!d){ $("#brfDate").focus(); return; } $("#dlgBriefs").close(); openBrief(d); };

/* ---- the form ---- */
/* who is on the attendance table: the ⭐ team (or, without one, the 20 most used), plus everyone who was on the last
   briefing's table — so a person added once with "+ הוסף אדם לנוכחות" stays there from then on — plus whoever is on this one */
function brPeople(b){ const off=lists._hide_ppl||[], core=(lists._core_ppl||[]).filter(v=>!off.includes(v));
  const base=core.length ? core : pplValues().slice(0,20);
  const prev=Object.values(BRIEFS||{}).filter(x=>x.id<b.id && x.att).sort((x,y)=>y.id.localeCompare(x.id))[0];
  const was=prev ? Object.keys(prev.att).filter(n=>!off.includes(n)) : [];
  return [...new Set(base.concat(was, Object.keys(b.att||{})))]; }
function brOwners(b){ const inn=Object.keys(b.att||{}).filter(n=>b.att[n].s==="in"); return inn.length ? inn : pplValues(); }
function brTouch(){ brTouched=true; if(brCur) brSave(brCur,false); paintBrSum(); }
function openBrief(id){
  if(!brCanSee()){ toast("שיחת הבוקר למנהלים בלבד"); return; }
  brCur=BRIEFS[id] ? JSON.parse(JSON.stringify(BRIEFS[id])) : brNew(id); brTouched=false;
  const R=brCur.rows; Object.keys(BR_SECS).forEach(k=>{ R[k]=R[k]||[]; });
  paintBrief(); $("#dlgBrief").showModal(); brSigInit();
}
function paintBrief(){
  const b=brCur, dd=new Date(b.id+"T12:00");
  $("#brTitle").textContent="שיחת בוקר"+(b.done?" ✓":"");
  const M=$("#brMeta"); M.textContent="";
  const dl=mk("label","br-mf"), di=mk("input"); di.type="date"; di.id="brDate"; di.value=b.id; di.required=true;
  dl.append(mk("span",null,BR_DAYS[dd.getDay()]), di);
  di.onchange=()=>brMoveDate(di.value);
  const tl=mk("label","br-mf"), ti=mk("input"); ti.type="time"; ti.id="brTime"; ti.value=b.time||"";
  tl.append(mk("span",null,"שעה"), ti); ti.onchange=()=>{ b.time=ti.value; brTouch(); };
  M.append(dl,tl);
  const ls=mk("select","br-leader"); ls.id="brLeader"; ls.setAttribute("aria-label","מנהל / מוביל השיחה");
  fillSelect(ls, pplValues(), b.leader, "מוביל השיחה *");
  ls.onchange=()=>{ b.leader=ls.value; ls.classList.remove("bad"); brTouch(); };
  M.appendChild(ls);
  paintBrAtt(); paintBrTasks(); paintBrEvents(); Object.keys(BR_SECS).forEach(paintBrRows);
  $("#brSafety").value=b.safety||""; $("#brSafety").oninput=()=>{ b.safety=$("#brSafety").value; brTouch(); };
  const C=$("#brChecks"); C.textContent="";
  BR_CHECKS.forEach((t,i)=>{ const l=mk("label","tk-chk br-ck"), c=mk("input"); c.type="checkbox"; c.checked=!!(b.checks||[])[i];
    c.onchange=()=>{ b.checks=b.checks||[]; b.checks[i]=c.checked; brTouch(); }; l.append(c, document.createTextNode(t)); C.appendChild(l); });
  paintBrSum();
}
/* a new worker, added from the briefing: into the people list of the app (with the role; ⭐ team when there is one,
   so they stay on the attendance list) — the same list the events and tasks use, never into the code */
function brAddPerson(){
  const n=$("#brNpName").value.trim().replace(/\s+/g," "), r=$("#brNpRole").value.trim();
  if(!n){ $("#brNpName").focus(); return; }
  if(!lists.ppl.includes(n)){ lists._custom_ppl.push(n); lists.ppl.push(n); }
  const h=(lists._hide_ppl||[]).indexOf(n); if(h>=0) lists._hide_ppl.splice(h,1);
  if(r){ lists._roles_ppl=lists._roles_ppl||{}; lists._roles_ppl[n]=r; }
  if((lists._core_ppl||[]).length && !lists._core_ppl.includes(n)) lists._core_ppl.push(n);
  persist(); renderMgr();
  if(brCur){ if(!brCur.att[n]) brCur.att[n]={}; brTouch(); paintBrAtt(); Object.keys(BR_SECS).forEach(paintBrRows); }
  $("#brNpName").value=""; $("#brNpRole").value=""; $("#brNewP").hidden=true;
  toast(n+" נוסף לרשימת האנשים"+(r?" · "+r:""));
}
$("#brNpOk").onclick=brAddPerson;
$("#brNpName").onkeydown=$("#brNpRole").onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); brAddPerson(); } };
$("#brNpNo").onclick=()=>{ $("#brNpName").value=""; $("#brNpRole").value=""; $("#brNewP").hidden=true; };
/* changing the date moves the briefing (its id is the date); a date that already has one is refused */
function brMoveDate(nd){
  const b=brCur; if(!nd || nd===b.id){ $("#brDate").value=b.id; return; }
  if(BRIEFS[nd]){ toast("כבר יש שיחת בוקר ב-"+dmy(nd)+" — אפשר לפתוח אותה מהתיקייה 📁"); $("#brDate").value=b.id; return; }
  const old=b.id, had=!!BRIEFS[old];
  b.id=b.date=nd;
  let ct=0, ce=0;
  tasks.forEach(t=>{ if(t.brief===old){ t.brief=nd; t.upd=new Date().toISOString(); ct++; } });
  events.forEach(e=>{ if(e.brief===old){ e.brief=nd; e.ts=new Date().toISOString(); ce++; } });
  if(ct) saveTasks(); if(ce) persist();
  if(had) brDelete(old);
  brSave(b,true); brTouched=false; paintBrief(); paintBriefCard();
  toast("השיחה הועברה ל-"+dmy(nd));
}
function paintBrAtt(){                     // the paper form's table: name · role · present/absent · reason · notes
  const b=brCur, A=$("#brAtt"); A.textContent="";
  const hd=mk("div","br-ar br-ah"); hd.setAttribute("role","row");
  ["שם","תפקיד","נוכחות","סיבת היעדרות / אילוץ","הערות"].forEach(h=>{ const c=mk("div",null,h); c.setAttribute("role","columnheader"); hd.appendChild(c); });
  A.appendChild(hd);
  brPeople(b).forEach((n,i)=>{ const a=b.att[n]||{}, r=mk("div","br-ar"); r.setAttribute("role","row");
    const nm=mk("div","br-an"+(a.s==="in"?" in":a.s==="out"?" out":"")), ro=mk("div","br-aro",roleOf(n));
    nm.appendChild(mk("span",null,n)); if(roleOf(n)) nm.appendChild(mk("small","br-anr",roleOf(n)));      // the role under the name: phones only
    const st=mk("div","br-ast"), set=v=>{ const cur=b.att[n]||{};
      if(cur.s===v){ delete cur.s; if(v==="out") delete cur.r; } else { cur.s=v; if(v==="in") delete cur.r; }
      if(cur.s || cur.n) b.att[n]=cur; else delete b.att[n];
      brTouch(); paintBrAtt(); Object.keys(BR_SECS).forEach(paintBrRows); };
    [["in","נוכח"],["out","נעדר"]].forEach(([v,l])=>{ const lb=mk("label","br-rad "+v), rd=mk("input"); rd.type="radio"; rd.name="brAtt"+i; rd.checked=a.s===v;
      rd.onclick=e=>{ e.preventDefault(); set(v); }; lb.append(rd, document.createTextNode(" "+l)); st.appendChild(lb); });
    const rs=mk("select","br-ars"); rs.setAttribute("aria-label","סיבת היעדרות של "+n); fillSelect(rs, BR_REASONS, a.r, "");
    rs.onchange=()=>{ const cur=b.att[n]||{}; cur.r=rs.value; if(rs.value) cur.s="out"; b.att[n]=cur; brTouch(); paintBrAtt(); Object.keys(BR_SECS).forEach(paintBrRows); };
    const nt=mk("input","txt br-ant"); nt.placeholder="הערות"; nt.value=a.n||""; nt.setAttribute("aria-label","הערות על "+n);
    nt.oninput=()=>{ const cur=b.att[n]||{}; cur.n=nt.value; if(cur.s || cur.n) b.att[n]=cur; else delete b.att[n]; brTouch(); };
    [nm,ro,st].forEach(c=>c.setAttribute("role","cell"));
    const c4=mk("div"), c5=mk("div"); c4.setAttribute("role","cell"); c5.setAttribute("role","cell"); c4.appendChild(rs); c5.appendChild(nt);
    r.append(nm,ro,st,c4,c5); A.appendChild(r); });
  const sel=$("#brAddP"), have=brPeople(b);
  fillSelect(sel, pplValues().filter(v=>!have.includes(v)), "", "+ הוסף אדם לנוכחות");
  const nw=mk("option",null,"＋ אדם חדש (לא ברשימה)…"); nw.value="__new"; sel.appendChild(nw);
  sel.onchange=()=>{ if(!sel.value) return;
    if(sel.value==="__new"){ sel.value=""; $("#brNewP").hidden=false; const dl=$("#dlRoles"); dl.textContent=""; [...new Set(Object.values(lists._roles_ppl||{}))].sort((x,y)=>x.localeCompare(y,"he")).forEach(r=>{ const o=mk("option"); o.value=r; dl.appendChild(o); }); $("#brNpName").focus(); return; }
    b.att[sel.value]={s:"in"}; brTouch(); paintBrAtt(); Object.keys(BR_SECS).forEach(paintBrRows); };
}
/* a note for the briefing only: shown here and in the PDF, never written into the task or the event */
/* every topic in the briefing: its number is a button — tap = ✓ דובר (discussed), tap again = back to the number;
   the ⠿ handle drags it to a new place in its list (finger or mouse). onMove(keys) gets the new order. */
function brDeco(el, i, said, onSaid){
  const no=mk("button","br-no"+(said?" said":""), said?"✓":String(i+1)); no.type="button";
  no.title=said?"דובר — לחיצה מבטלת":"סמן ✓ דובר"; no.setAttribute("aria-pressed",String(!!said)); no.setAttribute("aria-label",(said?"דובר: ":"סמן כדובר: ")+"נושא "+(i+1));
  no.onclick=()=>onSaid(!said);
  const h=mk("span","br-drag","⠿"); h.title="גרור לשינוי הסדר"; h.setAttribute("aria-hidden","true");
  el.classList.toggle("said",!!said); el.append(no,h);
}
function brDragList(box, sel, onMove){
  box.querySelectorAll(":scope > "+sel).forEach(el=>{ const h=el.querySelector(".br-drag"); if(!h) return;
    h.onpointerdown=e=>{ e.preventDefault(); el.classList.add("dragging");      // tracked on the page: moving the card would drop a captured pointer
      const dlg=box.closest("dialog"); let scr=0, raf=0;
      const tick=()=>{ if(scr && dlg) dlg.scrollTop+=scr; raf=requestAnimationFrame(tick); }; raf=requestAnimationFrame(tick);
      const move=ev=>{ const y=ev.clientY, items=[...box.querySelectorAll(":scope > "+sel)].filter(x=>x!==el);
        const after=items.find(x=>{ const r=x.getBoundingClientRect(); return y < r.top+r.height/2; });
        if(after) box.insertBefore(el,after); else { const last=items[items.length-1]; if(last) last.after(el); }
        if(dlg){ const d=dlg.getBoundingClientRect(); scr = y<d.top+70 ? -8 : y>d.bottom-130 ? 8 : 0; } };
      const up=()=>{ cancelAnimationFrame(raf); el.classList.remove("dragging");
        removeEventListener("pointermove",move); removeEventListener("pointerup",up); removeEventListener("pointercancel",up);
        onMove([...box.querySelectorAll(":scope > "+sel)].map(x=>x.dataset.k)); };
      addEventListener("pointermove",move); addEventListener("pointerup",up); addEventListener("pointercancel",up); }; });
}
/* a numbered sub-section title: "2.1 משימות לדיון" + how many */
function brSubHead(el, no, title, n){ el.textContent=""; el.append(mk("i",null,no), document.createTextNode(title)); if(n) el.appendChild(mk("b","br-cnt",String(n))); }
/* a note stays a small "+ הערה" link until it is used, so the rows stay short */
function brNoteIn(get, set, label){ const n=mk("input","txt br-note"); n.value=get()||""; n.maxLength=300;
  n.placeholder="הערה לשיחה (לא נכנסת למשימה)"; n.setAttribute("aria-label","הערה לשיחה: "+label);
  n.oninput=()=>{ set(n.value); brTouch(); };
  if(n.value) return n;
  const btn=mk("button","br-notebtn","+ הערה"); btn.type="button"; btn.setAttribute("aria-label","הוסף הערה לשיחה: "+label);
  btn.onclick=()=>{ btn.replaceWith(n); n.focus(); }; return btn; }
/* open tasks — an option, like last week's events: the ones ticked "לדיון" join the briefing; for those the status can change
   (written to the task on save) and a note added (the briefing only). The suggested ones (late, urgent, in progress, rounds due) come first.
   Briefings saved before this (no b.tks) keep what they showed then: the suggested lists minus the hidden ones. */
function brPicked(b){
  if(b.tks){ const o=(b.tkOrd||[]).filter(id=>b.tks[id]); Object.keys(b.tks).forEach(id=>{ if(!o.includes(id)) o.push(id); });
    return o.map(id=>tasks.find(t=>t.id===id)).filter(Boolean); }
  const H=b.hide||{}; return brLinkedTasks(b.id).concat(brRepTasks(b.id)).filter(t=>!H[t.id]);
}
function brTaskRow(t, b, i){
  const r=mk("div","br-lr br-evr on"+(t.due && t.due<b.id && tkOpen(t)?" late":"")), tx=mk("div","br-lt"); r.dataset.k=t.id;
  b.said=b.said||{}; brDeco(r, i, b.said["t:"+t.id], v=>{ if(v) b.said["t:"+t.id]=1; else delete b.said["t:"+t.id]; brTouch(); paintBrTasks(); });
  tx.appendChild(mk("b",null,(snOf(t)?snOf(t)+" ":"")+(t.title||"(ללא כותרת)")));
  tx.appendChild(mk("small",null,[(t.ppl||[])[0]||(t.depts||[]).join(", "), tkOpen(t)?tkStat(t):"הושלמה", t.due?(t.due<b.id?"באיחור · ":"יעד ")+dmy(t.due).slice(0,5):"", t.rep?repLabel(t.rep):"", prioOf(t)!=="רגילה"?prioOf(t):""].filter(Boolean).join(" · ")));
  const x=mk("button","bd-del br-del","✕"); x.type="button"; x.title="הסר מהשיחה"; x.setAttribute("aria-label","הסר את "+(t.title||"המשימה")+" מהשיחה");
  x.onclick=()=>{ delete b.tks[t.id]; if(b.linked) delete b.linked[t.id]; brTouch(); paintBrTasks(); };
  r.append(tx,x);
  if(tkOpen(t)){ const s=mk("select","br-st"); s.setAttribute("aria-label","סטטוס "+(t.title||""));
    const cur=(b.linked||{})[t.id] || tkStat(t);
    fillSelect(s, ["פתוחה","בטיפול","בהמתנה"], cur); s.classList.toggle("chg", cur!==tkStat(t));
    s.onchange=()=>{ b.linked=b.linked||{}; if(s.value===tkStat(t)) delete b.linked[t.id]; else b.linked[t.id]=s.value; s.classList.toggle("chg", s.value!==tkStat(t)); brTouch(); };
    const w=mk("div","br-tkx"); w.appendChild(s);
    w.appendChild(brNoteIn(()=>(b.notes||{})[t.id], v=>{ b.notes=b.notes||{}; if(v.trim()) b.notes[t.id]=v; else delete b.notes[t.id]; }, t.title||""));
    r.appendChild(w); }
  else r.appendChild(brNoteIn(()=>(b.notes||{})[t.id], v=>{ b.notes=b.notes||{}; if(v.trim()) b.notes[t.id]=v; else delete b.notes[t.id]; }, t.title||""));
  return r;
}
/* the tasks picked for the briefing, then a searchable list to add one: the suggested (late, urgent, in progress, rounds due) first, marked ⚠ */
function paintBrTasks(){
  const b=brCur, box=$("#brTk"); box.textContent="";
  if(!b.tks){ b.tks={}; if(b.upd) brPicked(Object.assign({},b,{tks:undefined})).forEach(t=>{ b.tks[t.id]=1; }); }   // older briefing: keep what it showed
  const own=t=>t.brief===b.id;                                     // opened from this briefing's topics: already shown there
  Object.keys(b.tks).forEach(id=>{ const t=tasks.find(x=>x.id===id); if(t && own(t)) delete b.tks[id]; });
  const ord=(b.tkOrd||[]).filter(id=>b.tks[id]); Object.keys(b.tks).forEach(id=>{ if(!ord.includes(id)) ord.push(id); }); b.tkOrd=ord;   // the order (drag)
  const picked=ord.map(id=>tasks.find(t=>t.id===id)).filter(Boolean);
  brSubHead($("#brTkSum"),"2.1","משימות לדיון",picked.length);
  if(!picked.length) box.appendChild(mk("p","hint br-none","עדיין לא נבחרו משימות. בוחרים מהרשימה למטה."));
  picked.forEach((t,i)=>box.appendChild(brTaskRow(t,b,i)));
  brDragList(box,".br-lr",keys=>{ b.tkOrd=keys; brTouch(); paintBrTasks(); });
  const sug=brLinkedTasks(b.id).concat(brRepTasks(b.id)), sid=new Set(sug.map(t=>t.id));
  const rest=tasks.filter(t=>tkOpen(t) && !t.priv && !sid.has(t.id)).sort((a,c)=>tkSortKey(a).localeCompare(tkSortKey(c)));
  const left=sug.concat(rest).filter(t=>!b.tks[t.id] && !own(t));
  const sel=$("#brTkAdd"); sel.textContent="";
  const o0=mk("option",null,"+ הוסף משימה לדיון ("+left.length+" פתוחות)"); o0.value=""; sel.appendChild(o0);
  left.forEach(t=>{ const late=t.due && t.due<b.id, o=mk("option",null,(sid.has(t.id)?"⚠ ":"")+(snOf(t)?snOf(t)+" ":"")+(t.title||"")+" · "+([(t.ppl||[])[0], late?"באיחור":"", prioOf(t)==="דחופה"?"דחופה":"", tkStat(t)==="בטיפול"?"בטיפול":""].filter(Boolean).join(", ")||tkStat(t)));
    o.value=t.id; sel.appendChild(o); });
  sel.value=""; enhanceSelect(sel);
  sel.onchange=()=>{ const id=sel.value; if(!id) return; b.tks[id]=1; brTouch(); paintBrTasks(); };
}
/* last week's events (7 days up to the briefing's date) — an option: the ones ticked "לדיון" join the briefing (and its PDF) */
function brWeekEvents(d){ const from=ymd(new Date(new Date(d+"T12:00").getTime()-7*864e5));
  return events.filter(e=>{ const w=(e.when||"").slice(0,10); return w && w>=from && w<=d && e.brief!==d && !e._del; })
    .sort((a,c)=>(c.when||"").localeCompare(a.when||"")); }
function paintBrEvents(){
  const b=brCur, box=$("#brEv"); box.textContent=""; b.evs=b.evs||{}; const E=b.evs;
  const ord=(b.evOrd||[]).filter(id=>id in E); Object.keys(E).forEach(id=>{ if(!ord.includes(id)) ord.push(id); }); b.evOrd=ord;
  const picked=ord.map(id=>events.find(e=>e.id===id)).filter(Boolean);
  brSubHead($("#brEvSum"),"2.2","אירועים מהשבוע האחרון לדיון",picked.length);
  if(!picked.length) box.appendChild(mk("p","hint br-none","עדיין לא נבחרו אירועים. בוחרים מהרשימה למטה."));
  b.said=b.said||{};
  picked.forEach((e,i)=>{ const r=mk("div","br-lr br-evr on"), tx=mk("div","br-lt"); r.dataset.k=e.id;
    brDeco(r, i, b.said["e:"+e.id], v=>{ if(v) b.said["e:"+e.id]=1; else delete b.said["e:"+e.id]; brTouch(); paintBrEvents(); });
    tx.appendChild(mk("b",null,(snOf(e)?snOf(e)+" ":"")+((e.type||[]).join(", ")||"אירוע")+" · "+(e.title||e.desc||"").slice(0,90)));
    tx.appendChild(mk("small",null,[fmtWhen(e.when), (e.loc||[]).concat(e.eq||[]).join(", "), (e.ppl||[]).join(", "), isOpen(e)?"פתוח":"נסגר"].filter(Boolean).join(" · ")));
    const x=mk("button","bd-del br-del","✕"); x.type="button"; x.title="הסר מהשיחה"; x.setAttribute("aria-label","הסר את האירוע מהשיחה");
    x.onclick=()=>{ delete E[e.id]; brTouch(); paintBrEvents(); };
    r.append(tx,x, brNoteIn(()=>E[e.id], v=>{ E[e.id]=v; }, e.title||e.desc||"")); box.appendChild(r); });
  brDragList(box,".br-lr",keys=>{ b.evOrd=keys; brTouch(); paintBrEvents(); });
  const left=brWeekEvents(b.id).filter(e=>!(e.id in E));
  const sel=$("#brEvAdd"); sel.textContent="";
  const o0=mk("option",null,"+ הוסף אירוע מהשבוע האחרון ("+left.length+")"); o0.value=""; sel.appendChild(o0);
  left.forEach(e=>{ const o=mk("option",null,(snOf(e)?snOf(e)+" ":"")+((e.type||[]).join(", "))+" · "+(e.title||e.desc||"").slice(0,70)+" · "+dmy((e.when||"").slice(0,10)).slice(0,5)+(isOpen(e)?" · פתוח":""));
    o.value=e.id; sel.appendChild(o); });
  sel.value=""; enhanceSelect(sel);
  sel.onchange=()=>{ const id=sel.value; if(!id) return; E[id]=""; brTouch(); paintBrEvents(); };
}
function paintBrRows(k){
  const b=brCur, S=BR_SECS[k], box=$("#brR-"+k); if(!box) return; box.textContent="";
  let rows=b.rows[k];
  // faults / maintenance / contractors as free rows left the form (topics are picked from the open tasks and last week's events);
  // they still show on a briefing that has them from before
  const grp=$("#brG-"+k);
  if(grp){ rows=b.rows[k]=rows.filter(x=>x.tid || x.eid || (x.text||"").trim()); grp.hidden=!rows.length; if(!rows.length) return; }
  const add=focus=>{ rows.push({id:newId(), text:"", owner:""}); brTouch(); paintBrRows(k); if(focus){ const ins=box.querySelectorAll(".br-tx"); if(ins.length) ins[ins.length-1].focus(); } };
  rows.forEach(x=>{ if(x.tid && !tasks.some(t=>t.id===x.tid)) delete x.tid; if(x.eid && !events.some(e=>e.id===x.eid)) delete x.eid; });   // removed from the log since
  rows.forEach((x,i)=>{
    const r=mk("div","br-row"+(x.tid||x.eid?" made":"")+((x.text||"").trim()?" on":"")); r.dataset.k=x.id;
    brDeco(r, i, x.said, v=>{ if(v) x.said=1; else delete x.said; brTouch(); paintBrRows(k); });
    const tx=mk("input","txt br-tx"); tx.value=x.text||""; tx.placeholder=S.ph; tx.setAttribute("aria-label",S.ph+" "+(i+1)); tx.maxLength=300;
    tx.oninput=()=>{ x.text=tx.value; r.classList.toggle("on",!!tx.value.trim()); brTouch(); };
    tx.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); add(true); }
      else if(e.key==="Backspace" && !tx.value && !x.tid && !x.eid && rows.length>1){ e.preventDefault(); rows.splice(i,1); brTouch(); paintBrRows(k);
        const ins=box.querySelectorAll(".br-tx"); if(ins.length) ins[Math.max(0,i-1)].focus(); } };
    r.appendChild(tx);
    if(S.detail){ const dt=mk("input","txt br-dt"); dt.value=x.detail||""; dt.placeholder="פירוט"; dt.setAttribute("aria-label","פירוט "+(i+1));
      dt.oninput=()=>{ x.detail=dt.value; brTouch(); }; r.appendChild(dt); }
    const ow=mk("select","br-ow"); ow.setAttribute("aria-label",(S.ev?"מלווה":"מוביל משימה")+" "+(i+1));
    fillSelect(ow, brOwners(b), x.owner, S.ev?"מלווה":"מוביל משימה");
    ow.onchange=()=>{ x.owner=ow.value; brTouch(); }; r.appendChild(ow);
    if(S.detail){ const du=mk("input","br-du"); du.type="date"; du.value=x.date||""; du.min=b.id; du.setAttribute("aria-label","תאריך יעד "+(i+1));
      du.onchange=()=>{ x.date=du.value; brTouch(); }; r.appendChild(du); }
    if(x.tid || x.eid){ const ref=x.tid ? tasks.find(t=>t.id===x.tid) : events.find(e=>e.id===x.eid);
      const tg=mk("button","br-made", x.tid ? "✓ משימה "+(ref&&snOf(ref)||"") : "✓ אירוע "+(ref&&snOf(ref)||"")); tg.type="button";
      tg.onclick=()=>{ $("#dlgBrief").close(); if(x.tid) goTask(x.tid); else evGo(x.eid); };
      r.appendChild(tg);
      const del=mk("button","bd-del br-del","✕"); del.type="button"; del.title="הסר מהשיחה — "+(x.tid?"המשימה":"האירוע")+" נשאר"+(x.tid?"ת":"");
      del.setAttribute("aria-label",del.title); del.onclick=()=>{ rows.splice(i,1); brTouch(); paintBrRows(k); }; r.appendChild(del); }
    else if(rows.length>1 || x.text){ const del=mk("button","bd-del br-del","✕"); del.type="button"; del.setAttribute("aria-label","הסר שורה");
      del.onclick=()=>{ rows.splice(i,1); brTouch(); paintBrRows(k); }; r.appendChild(del); }
    r.appendChild(brNoteIn(()=>x.note, v=>{ x.note=v; }, x.text||S.ph));
    box.appendChild(r);
  });
  brDragList(box,".br-row",keys=>{ b.rows[k]=keys.map(id=>rows.find(x=>x.id===id)).filter(Boolean); brTouch(); paintBrRows(k); });
  if(grp) return;
  const more=mk("button","btn mini ghost br-more","+ שורה"); more.type="button"; more.onclick=()=>add(true);
  if(!rows.length) add(false); else box.appendChild(more);
}
function brPending(b){ const r=b.rows, out={tasks:0, ev:0, st:Object.keys(b.linked||{}).filter(id=>{ const t=tasks.find(x=>x.id===id); return t && tkOpen(t) && tkStat(t)!==b.linked[id]; }).length};
  out.ed=0;
  Object.keys(BR_SECS).forEach(k=>(r[k]||[]).forEach(x=>{ if(brEdits(k,x)) out.ed++; }));
  return out; }
/* a row that already became a task / event and was changed here since: what to write back (title, assignee, due date / event text) */
function brEdits(k,x){
  const text=(x.text||"").trim(); if(!text) return null;
  if(x.tid){ const t=tasks.find(y=>y.id===x.tid); if(!t) return null; const ch={};
    if(t.title!==text) ch.title=text;
    if(((t.ppl||[])[0]||"")!==(x.owner||"")) ch.owner=x.owner||"";
    if(k==="open" && (t.due||"")!==(x.date||"")) ch.due=x.date||"";
    return Object.keys(ch).length ? {t,ch} : null; }
  if(x.eid){ const e=events.find(y=>y.id===x.eid); if(!e) return null; const ch={};
    if((e.desc||"")!==text) ch.desc=text;
    if(((e.ppl||[])[0]||"")!==(x.owner||"")) ch.owner=x.owner||"";
    return Object.keys(ch).length ? {e,ch} : null; }
  return null;
}
function paintBrSum(){
  const b=brCur, S=$("#brSum"); if(!b || !S) return; S.textContent="";
  const p=brPending(b), li=[];

  if(p.st) li.push("הסטטוס של "+p.st+" משימות יתעדכן");
  if(p.ed) li.push(p.ed+" משימות / אירועים שכבר נוצרו יתעדכנו לפי השינויים כאן");
  const c=brCounts(b);
  S.appendChild(mk("b",null, li.length ? "בשמירה ביומן:" : b.done ? "השיחה נשמרה." : "הנושאים שנכתבו כאן נשמרים בשיחה בלבד — לא נפתחות מהם משימות ביומן."));
  if(li.length){ const ul=mk("ul"); li.forEach(t=>ul.appendChild(mk("li",null,t))); S.appendChild(ul); }
  // tasks that earlier versions opened in the log from this briefing's topics: one tap removes them (the topics stay here)
  const made=Object.keys(BR_SECS).flatMap(k=>(b.rows[k]||[]).filter(x=>x.tid && tasks.some(t=>t.id===x.tid)));
  if(made.length && isManager()){ const cl=mk("button","btn mini br-clean","הסר מהיומן "+made.length+" משימות שנפתחו מהשיחה (הנושאים נשארים כאן)"); cl.type="button";
    cl.onclick=async()=>{ if(!await confirmDel("להסיר מהיומן את המשימות שנפתחו משיחת הבוקר?", made.map(x=>"• "+x.text).join("\n")+"\nהנושאים נשארים בשיחה.")) return;
      const ids=new Set(made.map(x=>x.tid)); tasks=tasks.filter(t=>!ids.has(t.id)); made.forEach(x=>{ delete x.tid; });
      if(b.tks) ids.forEach(id=>delete b.tks[id]); saveTasks(); brSave(b,true); paintBrief(); toast(ids.size+" משימות הוסרו מהיומן"); };
    S.appendChild(cl); }
  $("#brDone").textContent = b.done ? (li.length?"שמור את השינויים":"סגור") : "סיים ושמור שיחה";
  $("#brLater").hidden=!!b.done;
}
function brFinish(){
  const b=brCur; if(!b) return;
  if(!b.leader){ const ls=$("#brLeader"); ls.classList.add("bad"); ls.focus(); toast("יש לבחור מנהל / מוביל שיחה"); return; }
  const now=new Date().toISOString(), on=dmy(b.id).slice(0,5); let nt=0, ne=0, ns=0;
  Object.keys(b.linked||{}).forEach(id=>{ const t=tasks.find(x=>x.id===id), v=b.linked[id];
    if(t && tkOpen(t) && tkStat(t)!==v){ t.status=v; t.upd=now; tkLog(t,"סטטוס: "+v+" (בשיחת בוקר "+on+")","",true); ns++; } });
  b.linked={};
  let nu=0, eu=false;
  Object.keys(BR_SECS).forEach(k=>(b.rows[k]||[]).forEach(x=>{ const d=brEdits(k,x); if(!d) return; nu++;
    if(d.t){ const t=d.t, ch=d.ch, parts=[];
      if(ch.title!==undefined){ t.title=ch.title; parts.push("כותרת"); }
      if(ch.owner!==undefined){ const rest=(t.ppl||[]).slice(1).filter(n=>n!==ch.owner); t.ppl=ch.owner ? [ch.owner].concat(rest) : rest; parts.push("אחראי"+(ch.owner?": "+ch.owner:"")); }
      if(ch.due!==undefined){ t.due=ch.due; parts.push("תאריך יעד"); }
      t.upd=now; tkLog(t,"עודכן בשיחת בוקר "+on+": "+parts.join(", "),"",true); }
    else { const e=d.e, ch=d.ch; if(ch.desc!==undefined) e.desc=ch.desc;
      if(ch.owner!==undefined){ const rest=(e.ppl||[]).slice(1).filter(n=>n!==ch.owner); e.ppl=ch.owner ? [ch.owner].concat(rest) : rest; }
      e.ts=now; eu=true; } }));
  Object.keys(BR_SECS).forEach(k=>{ b.rows[k]=(b.rows[k]||[]).filter(x=>x.tid || x.eid || (x.text||"").trim()); });   // topics stay in the briefing
  if(ne || eu){ events.sort((a,c)=>(c.when||"").localeCompare(a.when||"")); persist(); renderAll(); }
  if(nt || ns || nu) saveTasks();
  if(!b.done){ b.done=true; b.doneAt=nowLocal(); b.by=reporter()||""; }
  brSave(b,true); brTouched=false;
  $("#dlgBrief").close(); paintBriefCard();
  toast("שיחת הבוקר נשמרה"+(ns?" · "+ns+" סטטוסים עודכנו ביומן":"")+(nu?" · "+nu+" עודכנו":""));
}
$("#brDone").onclick=brFinish;
$("#brLater").onclick=()=>{ if(brCur){ brSave(brCur,true); brTouched=false; } $("#dlgBrief").close(); toast("הטיוטה נשמרה"); };
$("#brClose").onclick=()=>$("#dlgBrief").close();
$("#brDel").onclick=async()=>{ const b=brCur; if(!b) return;
  if(!await confirmDel("למחוק את שיחת הבוקר?", "שיחת הבוקר מ-"+dmy(b.id)+(b.time?" "+b.time:"")+". משימות ואירועים שנוצרו בה נשארים.")) return;
  brCur=null; brTouched=false; clearTimeout(brCloudT); $("#dlgBrief").close(); await brDelete(b.id); paintBriefCard(); if($("#dlgBriefs").open) paintBriefs(); toast("שיחת הבוקר נמחקה"); };
$("#dlgBrief").addEventListener("close",()=>{ if(brCur && brTouched){ brSave(brCur,true); brTouched=false; } paintBriefCard(); if($("#dlgBriefs").open) paintBriefs(); });

/* signature: drawn with a finger or the mouse, kept as a small picture in the briefing */
function brSigInit(){
  const c=$("#brSig"), r=window.devicePixelRatio||1, w=c.clientWidth||300, h=c.clientHeight||120;
  c.width=Math.round(w*r); c.height=Math.round(h*r);
  const x=c.getContext("2d"); x.setTransform(r,0,0,r,0,0); x.lineWidth=2.2; x.lineCap="round"; x.lineJoin="round";
  x.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue("--ink").trim()||"#16202A";
  if(brCur && brCur.sig){ const im=new Image(); im.onload=()=>x.drawImage(im,0,0,w,h); im.src=brCur.sig; }
}
(()=>{ const c=$("#brSig"); let on=false;
  const pos=e=>{ const r=c.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; };
  c.addEventListener("pointerdown",e=>{ e.preventDefault(); c.setPointerCapture(e.pointerId); on=true; const x=c.getContext("2d"), [a,b]=pos(e); x.beginPath(); x.moveTo(a,b); });
  c.addEventListener("pointermove",e=>{ if(!on) return; e.preventDefault(); const x=c.getContext("2d"), [a,b]=pos(e); x.lineTo(a,b); x.stroke(); });
  const end=()=>{ if(!on) return; on=false; if(brCur){ brCur.sig=c.toDataURL("image/png"); brTouch(); } };
  ["pointerup","pointercancel","pointerleave"].forEach(t=>c.addEventListener(t,end));
  $("#brSigClr").onclick=()=>{ c.getContext("2d").clearRect(0,0,c.width,c.height); if(brCur){ brCur.sig=""; brTouch(); } };
})();

/* PDF of the briefing, for keeping: laid out like the paper form — a header band with the date, day, time and leader,
   numbered sections, the attendance table with green / red names, the topics with who leads them and what they became,
   the safety checklist and the signature. A4 pages (html2canvas → JPEG → PDF), the same engine as the weekly summary. */
async function briefPdf(b){
  await loadH2C(); try{ await document.fonts.ready; }catch(e){}
  const dd=new Date(b.id+"T12:00"), host=mk("div","rp-host"); document.body.appendChild(host);
  const pages=[]; let body;
  const newPage=()=>{ const pg=mk("div","rp-page bp-page"); host.appendChild(pg); pages.push(pg);
    const hd=mk("div","bp-head"), top=mk("div","bp-top"), lg=mk("img","bp-logo"), tx=mk("div","bp-tt");
    lg.src="icons/logo-header.png"; lg.alt="";
    tx.append(mk("div","bp-eye","טופס תדריך יומי"), mk("div","bp-title","שיחת בוקר"), mk("div","bp-sub",appTitle()));
    top.append(tx,lg); hd.appendChild(top);
    const f=mk("div","bp-fields");
    [["תאריך",dmy(b.id)],["יום בשבוע",BR_DAYS[dd.getDay()]],["שעה",b.time||""],["מנהל / מוביל השיחה",b.leader||""]].forEach(([l,v])=>{
      const c=mk("div","bp-f"); c.append(mk("span",null,l), mk("b",null,v||"—")); f.appendChild(c); });
    hd.appendChild(f); pg.appendChild(hd);
    body=mk("div","rp-body bp-body"); pg.appendChild(body); pg.appendChild(mk("div","rp-foot")); };
  const fits=()=>{ const l=body.lastElementChild; return !l || l.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom-6; };   // the last block ends above the page bottom (6px to spare)
  let pend=null;                       // a section title waits for its first block, so a title never ends a page alone
  const place=el=>{ if(pend){ const w=mk("div"); w.append(pend,el); pend=null; el=w; }
    body.appendChild(el); if(!fits() && body.childElementCount>1){ el.remove(); newPage(); body.appendChild(el); } return el; };
  const sec=(n,t)=>{ const h=mk("div","bp-sec"); h.append(mk("i",null,String(n)), mk("b",null,t)); return h; };
  const table=(head, cols, rows, cellCls, kind)=>{ if(!rows.length) return;
    const start=cont=>{ const w=mk("div","bp-tw"+(kind?" bp-k-"+kind:""));
      if(head){ const h=typeof head==="string" ? mk("div","bp-lbl",head) : (cont ? head.cloneNode(true) : head); if(cont) h.appendChild(document.createTextNode(" (המשך)")); w.appendChild(h); }
      const t=mk("table","bp-t"), tr=mk("tr"); cols.forEach(([c,wd])=>{ const th=mk("th",null,c); if(wd) th.style.width=wd; tr.appendChild(th); }); t.appendChild(tr); w.appendChild(t); return w; };
    let w=start(false); const box=place(w); let t=w.querySelector("table");
    rows.forEach((r,ri)=>{ const tr=mk("tr"); r.forEach((v,ci)=>{ const td=mk("td",cellCls ? cellCls(ri,ci) : null,v); tr.appendChild(td); }); t.appendChild(tr);
      if(!fits()){
        if(ri===0 && body.childElementCount>1){ box.remove(); newPage(); body.appendChild(box); return; }   // a header alone at the bottom: move the whole table
        tr.remove(); newPage(); w=start(true); body.appendChild(w); t=w.querySelector("table"); t.appendChild(tr); } }); };
  newPage();
  const ref=x=>{ const t=x.tid && tasks.find(y=>y.id===x.tid), e=x.eid && events.find(y=>y.id===x.eid); return t ? "משימה "+snOf(t) : e ? "אירוע "+snOf(e) : ""; };
  // 1. attendance
  const ppl=brPeople(b).filter(n=>b.att[n] && (b.att[n].s || b.att[n].r || b.att[n].n)), c=brCounts(b);
  pend=(sec(1,"נוכחות צוות"+(c.in+c.out ? " · "+c.in+" נוכחים, "+c.out+" נעדרים" : "")));
  const ar=ppl.map(n=>{ const a=b.att[n]; return [n, roleOf(n), a.s==="in"?"נוכח":a.s==="out"?"נעדר":"", a.r||"", a.n||""]; });
  if(ar.length) table(null,[["שם","18%"],["תפקיד","18%"],["נוכחות","12%"],["סיבת היעדרות / אילוץ","20%"],["הערות",""]], ar,
    (ri,ci)=>ci===0 ? "bp-n "+(b.att[ppl[ri]].s==="in"?"in":b.att[ppl[ri]].s==="out"?"out":"") : ci===2 ? "bp-st "+(b.att[ppl[ri]].s||"") : null);
  else place(mk("p","bp-none","לא סומנה נוכחות."));
  // 2. tasks and work plan — the same sub-sections, numbers and colours as the form
  pend=sec(2,"סטטוס משימות ותוכנית עבודה");
  const N=b.notes||{}, pk=brPicked(b);
  const lbl=(no,t,kind)=>{ const h=mk("div","bp-lbl bp-k-"+kind); h.append(mk("i",null,no), document.createTextNode(t)); return h; };
  const SD=b.said||{};
  const num=(rows,said)=>rows.map((r,i)=>[(said&&said[i]?"✓ ":"")+String(i+1)].concat(r)), nc=(ri,ci)=>ci===0 ? "bp-no" : null;
  const old=x=>ref(x) ? " ("+ref(x)+")" : "";                     // an older briefing that still opened tasks: which one
  const free=k=>(b.rows[k]||[]).filter(x=>(x.text||"").trim());
  table(lbl("2.1","משימות לדיון","tk"), [["#","5%"],["משימה",""],["מוביל משימה","16%"],["יעד","10%"],["סטטוס","10%"],["הערה","22%"]],
    num(pk.map(t=>[(snOf(t)?snOf(t)+" ":"")+(t.title||""), (t.ppl||[])[0]||(t.depts||[]).join(", "), t.due?dmy(t.due):"", tkOpen(t)?tkStat(t):"הושלמה", N[t.id]||""]), pk.map(t=>SD["t:"+t.id])), nc, "tk");
  const ev=(b.evOrd||Object.keys(b.evs||{})).filter(id=>id in (b.evs||{})).map(id=>events.find(e=>e.id===id)).filter(Boolean);
  table(lbl("2.2","אירועים מהשבוע האחרון","ev"), [["#","5%"],["אירוע",""],["מתי","14%"],["מיקום","15%"],["סטטוס","9%"],["הערה","22%"]],
    num(ev.map(e=>[(snOf(e)?snOf(e)+" ":"")+((e.type||[]).join(", "))+" · "+(e.title||e.desc||""), fmtWhen(e.when), (e.loc||[]).join(", "), isOpen(e)?"פתוח":"נסגר", b.evs[e.id]||""]), ev.map(e=>SD["e:"+e.id])), nc, "ev");
  table(lbl("2.3","תוכנית עבודה להיום","pl"), [["#","5%"],["נושא",""],["מוביל משימה","20%"],["הערה","30%"]],
    num(free("plan").map(x=>[x.text+old(x), x.owner||"", x.note||""]), free("plan").map(x=>x.said)), nc, "pl");
  [["faults","תקלות פתוחות וסגירת קצוות"],["maint","אחזקות קבועות וסבבים"],["contr","קבלני משנה וגורמי חוץ"]].forEach(([k,l])=>     // from older briefings only
    table(lbl("·",l+" (משיחה קודמת)","old"), [["#","5%"],["נושא",""],["מוביל","20%"],["הערה","30%"]], num(free(k).map(x=>[x.text+old(x), x.owner||"", x.note||""])), nc, "old"));
  if(!pk.length && !ev.length && !["faults","maint","plan","contr"].some(k=>free(k).length)) place(mk("p","bp-none","אין נושאים."));
  // 3. safety
  const sf=mk("div","bp-blk"); sf.appendChild(sec(3,"דגשי בטיחות להיום"));
  if(b.safety) sf.appendChild(mk("div","bp-txt",b.safety));
  const ck=mk("div","bp-ck"); BR_CHECKS.forEach((t,i)=>{ const on=!!(b.checks||[])[i], r=mk("div","bp-ci"+(on?" on":"")); r.append(mk("span","bp-box",on?"✓":""), mk("span",null,t)); ck.appendChild(r); });
  sf.appendChild(ck); place(sf);
  // 4. open floor
  pend=sec(4,"פתוח לצוות וסגירת קצוות");
  const op=free("open");
  if(op.length) table(null,[["#","5%"],["נושא","20%"],["פירוט",""],["גורם אחראי","15%"],["תאריך","11%"],["הערה","20%"]],
    num(op.map(x=>[x.text+old(x), x.detail||"", x.owner||"", x.date?dmy(x.date):"", x.note||""]), op.map(x=>x.said)), nc, "op");
  else place(mk("p","bp-none","אין נושאים."));
  // 5. approval and signature
  const sg=mk("div","bp-blk"); sg.appendChild(sec(5,"אישור וחתימה"));
  const sr=mk("div","bp-sig"), sl=mk("div","bp-sigl");
  sl.append(mk("span",null,"מוביל השיחה"), mk("b",null,b.leader||"—"), mk("span",null,b.done ? "נשמרה "+fmtWhen(b.doneAt||"") : "טיוטה — לא נסגרה"));
  const sb=mk("div","bp-sigb"); if(b.sig){ const im=mk("img"); im.src=b.sig; im.alt="חתימה"; sb.appendChild(im); } sb.appendChild(mk("span",null,"חתימה"));
  sr.append(sl,sb); sg.appendChild(sr); place(sg);
  const made=new Date().toLocaleString("he-IL",{dateStyle:"short",timeStyle:"short"});
  pages.forEach((pg,i)=>{ pg.querySelector(".rp-foot").textContent="שיחת בוקר "+dmy(b.id)+" · עמוד "+(i+1)+" מתוך "+pages.length+" · הופק "+made+" · לשימוש פנימי"; });
  const out=[]; await Promise.all([...host.querySelectorAll("img")].map(im=>im.decode().catch(()=>{})));
  try{ for(const pg of pages){ const cv=await html2canvas(pg,{scale:2,backgroundColor:"#ffffff",logging:false});
      const bin=atob(cv.toDataURL("image/jpeg",.88).split(",")[1]), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
      out.push({bytes:u,w:cv.width,h:cv.height}); } }
  finally{ host.remove(); }
  return new File([pdfFromJpegs(out)],"שיחת-בוקר-"+b.id+".pdf",{type:"application/pdf"});
}
/* PDF: opens to view (a new tab with the browser's PDF viewer — save / print / share from there). The tab is opened right on the
   tap (a tab opened later is blocked), shows "מכין…", then gets the file. No tab (blocked, or an app view): the file is saved. */
async function brPdfOut(b, btn){ const lbl=btn.textContent; btn.disabled=true; btn.textContent="מכין…";
  let w=null; try{ w=window.open("","_blank"); if(w){ w.document.title="שיחת בוקר "+dmy(b.id);
    w.document.body.innerHTML='<p style="font:18px system-ui,sans-serif;text-align:center;margin-top:30vh" dir="rtl">מכין את ה-PDF…</p>'; } }catch(e){ w=null; }
  try{ const f=await briefPdf(b), url=URL.createObjectURL(f);
    if(w && !w.closed){ w.location.href=url; setTimeout(()=>URL.revokeObjectURL(url),120000); }
    else { URL.revokeObjectURL(url); saveBlob(f); toast("ה-PDF נשמר בהורדות"); } }
  catch(e){ if(w && !w.closed) w.close(); toast("יצירת ה-PDF נכשלה"); }
  finally{ btn.disabled=false; btn.textContent=lbl; } }
/* share: the share sheet with the file (WhatsApp, mail…); where there is none, the file is saved */
$("#brShare").onclick=async()=>{ if(!brCur) return; const btn=$("#brShare"), lbl=btn.textContent; btn.disabled=true; btn.textContent="מכין…";
  try{ const f=await briefPdf(brCur); await shareOrSave(f,"שיחת בוקר "+dmy(brCur.id),"שיחת בוקר "+dmy(brCur.id)); }
  catch(e){ toast("יצירת ה-PDF נכשלה"); } finally{ btn.disabled=false; btn.textContent=lbl; } };
$("#brPdf").onclick=()=>{ if(brCur) brPdfOut(brCur, $("#brPdf")); };
paintBriefCard();

/* ===== "🚀 פרסם לכולם" — only in the beta, only managers, team log: the beta becomes what everyone gets (cloud function "release") */
let relLive=null;
async function relPaint(){
  const c=$("#relCard"); if(!c) return;
  const show=BETA && CLOUD_ON && isManager() && !isViewer(); c.dataset.off=show?"":"1";
  const vc=$("#verChip"); if(vc && BETA){ vc.textContent=LITE_MQ.matches ? "בטא "+APP_VER : (show?"🚀 ":"")+"v"+APP_VER+" · בטא"; /* phone: short */ vc.classList.toggle("rel",show); vc.title=show?"פרסם את הבטא לכולם":"גרסה"; }
  if(!show){ c.hidden=true; return; }
  let live="?"; try{ const r=await fetch("../version.txt?t="+Date.now(),{cache:"no-store"}); if(r.ok) live=(await r.text()).trim(); }catch(e){}
  const st=$("#relSt"), b=$("#relGo"), same=live===APP_VER;
  if(relLive && relLive.state==="requested"){ st.textContent="⏳ מפרסם את "+(relLive.ver||APP_VER)+"…"; b.disabled=true; return; }
  st.textContent="בטא: "+APP_VER+" · אצל כולם: "+live+(same?" — זהה":"")+(relLive && relLive.state==="error" ? " · ⚠ הפרסום האחרון נכשל: "+(relLive.msg||"") : relLive && relLive.state==="done" && relLive.ver ? " · ✓ פורסם לאחרונה: "+relLive.ver : "");
  b.disabled=same; b.textContent=same?"כבר אצל כולם":"פרסם את "+APP_VER+" לכולם";
}
window.relApply=d=>{ const was=relLive && relLive.state; relLive=d||null;
  if(was==="requested" && relLive && relLive.state==="done") toast("🚀 פורסם לכולם: "+(relLive.ver||"")+" — באתר בעוד דקה-שתיים");
  if(was==="requested" && relLive && relLive.state==="error") toast("הפרסום נכשל: "+(relLive.msg||""));
  relPaint(); };
$("#relGo").onclick=async()=>{
  if(!confirm("לפרסם את הגרסה "+APP_VER+" לכל הצוות?\nמה שיש עכשיו בבטא יחליף את הגרסה הרגילה.")) return;
  $("#relGo").disabled=true;
  if(!window.cloudRelease || !await window.cloudRelease(APP_VER)){ toast("הבקשה נכשלה"); relPaint(); return; }
  relLive={state:"requested",ver:APP_VER}; relPaint();
};
// the orange beta chip in the header = the same button: one tap → confirm → everyone gets this version
$("#verChip").onclick=async()=>{
  if(!(BETA && CLOUD_ON && isManager() && !isViewer())) return;
  if(relLive && relLive.state==="requested"){ toast("⏳ כבר מפרסם…"); return; }
  let live="?"; try{ const r=await fetch("../version.txt?t="+Date.now(),{cache:"no-store"}); if(r.ok) live=(await r.text()).trim(); }catch(e){}
  if(live===APP_VER){ toast("✓ "+APP_VER+" כבר אצל כולם"); return; }
  if(!confirm("🚀 לפרסם לכולם?\nבטא: "+APP_VER+" · אצל כולם: "+live)) return;
  if(!window.cloudRelease || !await window.cloudRelease(APP_VER)){ toast("הבקשה נכשלה"); return; }
  relLive={state:"requested",ver:APP_VER}; relPaint(); toast("⏳ מפרסם את "+APP_VER+" לכולם…");
};
setTimeout(relPaint,1500);

/* ===== reminders (🔔 on a task): "remind me" at a time I pick. Team log: kept on meta/me-<me> (reminders, remNext) — the cloud
   function "remindTick" sends the push when the time comes (app closed too); with the app on screen a message says it here. */
var REMS=null;                                    // (var + functions: the task list can draw before this part of the file has run)
function remList(){ if(!REMS){ try{ const a=JSON.parse(localStorage.getItem("ogg-rems")||"[]"); REMS=Array.isArray(a)?a:[]; }catch(e){ REMS=[]; } } return REMS; }
function remSave(){ try{ localStorage.setItem("ogg-rems",JSON.stringify(REMS)); }catch(e){} if(window.cloudSetRems) window.cloudSetRems(REMS); }
window.remApply=list=>{ REMS=Array.isArray(list)?list.filter(r=>r && r.tid && r.at):[]; try{ localStorage.setItem("ogg-rems",JSON.stringify(REMS)); }catch(e){}
  if(typeof renderTasks==="function") renderTasks(); };
function remOf(tid){ return remList().find(r=>r.tid===tid); }
// a repeating reminder: the next time after "now" (same hour; day / week / month)
function remNextAt(at,rep,now){ const d=new Date(at); let n=0;
  while(d.getTime()<=now && n++<2000){ if(rep==="d") d.setDate(d.getDate()+1); else if(rep==="w") d.setDate(d.getDate()+7); else if(rep==="m") d.setMonth(d.getMonth()+1); else return 0; }
  return d.getTime(); }
var REP_TXT={d:"כל יום",w:"כל שבוע",m:"כל חודש"};
function remWhen(ms){ const d=new Date(ms), p=n=>String(n).padStart(2,"0"), dd=ymd(d);
  const day = dd===ymd(new Date()) ? "היום" : dd===ymd(new Date(Date.now()+864e5)) ? "מחר" : p(d.getDate())+"/"+p(d.getMonth()+1);
  return day+" "+p(d.getHours())+":"+p(d.getMinutes()); }
function remBell(t){
  const r=remOf(t.id), b=mk("button","tk-bell"+(r?" on":"")); b.type="button";
  b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1z"/></svg>';
  if(r) b.appendChild(mk("span","tk-bell-t",(r.rep?"🔁 ":"")+remWhen(r.at)));
  b.title = r ? "תזכורת: "+remWhen(r.at)+(r.rep?" · "+REP_TXT[r.rep]:"")+" — לחץ לשינוי" : "תזכורת למשימה"; b.setAttribute("aria-label",b.title);
  b.onclick=ev=>{ ev.stopPropagation(); remOpen(t); }; return b;
}
let remFor=null;
function remOpen(t){
  remFor=t; const r=remOf(t.id), d=$("#dlgRem"), at8=v=>new Date(v+"T08:00").getTime();
  $("#remTitle").textContent="🔔 תזכורת · "+(t.priv?"🔒 ":t.no?"#"+t.no+" ":"")+(t.title||"");
  $("#remNow").textContent = r ? "יש תזכורת ל"+remWhen(r.at)+(r.rep?" · חוזרת "+REP_TXT[r.rep]:"") : "";
  $("#remRep").value = r && r.rep || "";
  const box=$("#remOpts"); box.textContent="";
  const opt=(label,ms)=>{ const b=mk("button","btn",label); b.type="button"; b.onclick=()=>remSet(ms()); box.appendChild(b); };
  opt("בעוד שעה",()=>Date.now()+3600e3); opt("בעוד 3 שעות",()=>Date.now()+3*3600e3);
  opt("מחר ב-08:00",()=>at8(ymd(new Date(Date.now()+864e5))));
  if(t.due && at8(t.due)>Date.now()) opt("ביום היעד ב-08:00 ("+dmy(t.due).slice(0,5)+")",()=>at8(t.due));
  const p=n=>String(n).padStart(2,"0"), dflt=new Date(Date.now()+864e5);
  $("#remAt").value = r ? (()=>{ const x=new Date(r.at); return ymd(x)+"T"+p(x.getHours())+":"+p(x.getMinutes()); })() : ymd(dflt)+"T08:00";
  $("#remAt").min = ymd(new Date())+"T00:00";
  $("#remOff").hidden=!r;
  if(!d.open) d.showModal();
}
function remSet(ms){
  if(!remFor || !(ms>Date.now())){ toast("בחר זמן עתידי"); return; }
  const t=remFor;
  const rp=$("#remRep").value;
  REMS=remList().filter(x=>x.tid!==t.id).concat(Object.assign({id:newId(), tid:t.id, at:Math.round(ms), title:(t.priv?"🔒 ":t.no?"#"+t.no+" ":"")+(t.title||"משימה")}, rp?{rep:rp}:{}));
  remSave(); $("#dlgRem").close(); renderTasks(); toast("🔔 תזכורת נקבעה ל"+remWhen(ms)+(rp?" · "+REP_TXT[rp]:""));
}
$("#remSetAt").onclick=()=>{ const v=$("#remAt").value; if(!v){ $("#remAt").focus(); return; } remSet(new Date(v).getTime()); };
$("#remOff").onclick=()=>{ if(!remFor) return; REMS=remList().filter(x=>x.tid!==remFor.id); remSave(); $("#dlgRem").close(); renderTasks(); toast("התזכורת בוטלה"); };
$("#remClose").onclick=()=>$("#dlgRem").close();
// the time came: on screen — a message here; app in the background without push — a device notification; otherwise the push brings it
function remTick(){
  const now=Date.now(), due=remList().filter(r=>r.at<=now); if(!due.length) return;
  let push=false; try{ push=!!localStorage.getItem("ogg-push-token") && "Notification" in window && Notification.permission==="granted"; }catch(e){}
  if(document.hidden && CLOUD_ON && push) return;                 // the cloud sends it (and clears it)
  due.forEach(r=>{
    if(!document.hidden) toast("🔔 תזכורת: "+r.title,{label:"פתח",fn:()=>goTask(r.tid)});
    else if(window.notifOn("rem") && "Notification" in window && Notification.permission==="granted" && navigator.serviceWorker)
      navigator.serviceWorker.ready.then(g=>g.showNotification("🔔 תזכורת",{body:r.title, tag:"ogg-task-"+r.tid, icon:"icons/icon-notebook-192.png", badge:"icons/badge-96.png", lang:"he", dir:"rtl", data:{tid:r.tid}})).catch(()=>{});
  });
  REMS=REMS.filter(r=>r.at>now || r.rep).map(r=>r.at>now ? r : Object.assign({},r,{at:remNextAt(r.at,r.rep,now)})).filter(r=>r.at>now);   // a repeating one moves on
  remSave(); renderTasks();
}
setInterval(remTick,30e3);
/* ===== settings → 🔔 התראות: what to be notified about — push to the phone and notifications on the device (the 📨 list keeps everything).
   Saved here and on meta/me-<me>.notifOff (the cloud functions read it), so it holds on every device of the account. */
var NOTIF_KINDS=[["assign","משימה חדשה או שהוקצתה לי"],["update","עדכון שנכתב במשימה"],["status","שינוי סטטוס וסיום משימה"],
  ["edit","שינוי פרטים, קבצים ורשימת בדיקה"],["off","משימה שהוסרה ממני או נמחקה"],["fb","תשובה למשוב שלי"],["rem","תזכורות 🔔 שקבעתי"],["ev","אירוע חדש ביומן"]];
function notifOff(){ try{ const a=JSON.parse(localStorage.getItem("ogg-notif-off")||"[]"); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
window.notifOn=k=>!notifOff().includes(k);
window.notifApply=a=>{ if(!Array.isArray(a)) return; try{ localStorage.setItem("ogg-notif-off",JSON.stringify(a)); }catch(e){} paintNotif(); };
function paintNotif(){
  const box=$("#notifList"); if(!box) return; box.textContent=""; const off=notifOff();
  NOTIF_KINDS.forEach(([k,label])=>{ const l=mk("label","tk-chk"), i=document.createElement("input"); i.type="checkbox"; i.checked=!off.includes(k);
    i.onchange=()=>{ const o=notifOff().filter(x=>x!==k); if(!i.checked) o.push(k);
      try{ localStorage.setItem("ogg-notif-off",JSON.stringify(o)); }catch(e){} if(window.cloudSetNotif) window.cloudSetNotif(o); };
    l.append(i, document.createTextNode(" "+label)); box.appendChild(l); });
}
paintNotif(); document.addEventListener("visibilitychange",()=>{ if(!document.hidden) setTimeout(remTick,800); }); setTimeout(remTick,3000);

/* ===== recycle bin (🗑): deleted events and tasks, 30 days. This device keeps what it deleted; the team log also keeps every
   deleted document in the cloud (deleting only marks it _del), so the bin also shows what was deleted elsewhere. Restoring = a manager. */
const BIN_DAYS=30, K_BIN="ogg-bin";
function binGet(){ try{ const a=JSON.parse(localStorage.getItem(K_BIN)||"[]"); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function binPut(a){ const lim=Date.now()-BIN_DAYS*864e5; try{ localStorage.setItem(K_BIN,JSON.stringify(a.filter(x=>x && x.at>=lim).slice(0,300))); }catch(e){} }
function binAdd(k,item){ const a=binGet().filter(x=>!(x.k===k && x.id===item.id)); a.unshift({k,id:item.id,item:JSON.parse(JSON.stringify(item)),at:Date.now(),by:reporter()||""}); binPut(a); }
async function binList(){
  const lim=Date.now()-BIN_DAYS*864e5, map=new Map();
  binGet().forEach(x=>{ if(x.at>=lim) map.set(x.k+":"+x.id,x); });
  if(CLOUD_ON && window.cloudBinList){ try{ (await window.cloudBinList(lim)).forEach(x=>{ const k=x.k+":"+x.id, l=map.get(k); map.set(k, Object.assign({}, x, l?{by:l.by||x.by}:{})); }); }catch(e){} }
  // already back (restored elsewhere)? then it is not in the bin
  return [...map.values()].filter(x=>!(x.k==="e" ? events.some(e=>e.id===x.id) : tasks.some(t=>t.id===x.id))).sort((a,b)=>b.at-a.at);
}
async function binPaint(){
  const L=$("#binList"); L.textContent=""; L.appendChild(mk("p","hint","טוען…"));
  const items=await binList(), mgr=isManager() && !isViewer(); L.textContent="";
  if(!items.length){ L.appendChild(mk("p","hint","הסל ריק.")); return; }
  items.forEach(x=>{ const it=x.item||{}, r=mk("div","bin-it");
    const ttl = x.k==="e" ? (it.title || String(it.desc||"").slice(0,80) || "אירוע") : (it.title||"משימה");
    const b=mk("div","bin-b"); b.append(mk("b",null,(x.k==="e"?"⚠ ":"📋 ")+(it.no?"#"+it.no+" ":"")+ttl),
      mk("span","bin-m",(x.k==="e"?"אירוע":"משימה")+" · נמחק "+new Date(x.at).toLocaleDateString("he-IL")+(x.by?" · "+x.by:"")+" · נשארו "+Math.max(1,Math.ceil((x.at+BIN_DAYS*864e5-Date.now())/864e5))+" ימים"));
    r.appendChild(b);
    if(mgr){ const rs=mk("button","btn mini","↩ שחזר"); rs.type="button"; rs.onclick=async()=>{ rs.disabled=true; if(await binRestore(x)){ toast("שוחזר"); binPaint(); } else { rs.disabled=false; toast("השחזור נכשל"); } }; r.appendChild(rs); }
    L.appendChild(r); });
}
async function binRestore(x){
  if(CLOUD_ON && window.cloudRestore){ if(!await window.cloudRestore(x.k,x.id)) return false; }
  else if(x.item){ if(x.k==="e"){ events.push(x.item); events.sort((a,b)=>(b.when||"").localeCompare(a.when||"")); persist(); renderAll(); }
                   else { tasks.push(x.item); saveTasks(); } }
  binPut(binGet().filter(y=>!(y.k===x.k && y.id===x.id)));
  return true;
}
$("#binOpen").onclick=()=>{ binPaint(); $("#dlgBin").showModal(); };
$("#binClose").onclick=()=>$("#dlgBin").close();

/* ===== files folder (📁): every file and picture of the tasks and events I can see, newest first.
   Tapping one goes to where it belongs (the task or the event); 🔍 opens the file itself. */
let fdKind="";
function flAll(){
  const out=[];
  tkVis().forEach(t=>(t.files||[]).forEach(m=>{ if(m && !m.del) out.push({m, k:"t", id:t.id, src:(t.no?"#"+t.no+" ":"")+(t.title||"משימה")}); }));
  events.forEach(e=>(e.files||[]).forEach(m=>{ if(m && !m.del) out.push({m, k:"e", id:e.id, src:(e.no?"#"+e.no+" ":"")+(e.title||String(e.desc||"").slice(0,50)||"אירוע")}); }));
  return out.sort((a,b)=>String(b.m.at||"").localeCompare(String(a.m.at||"")));
}
function flPaint(){
  const q=$("#fdQ").value.trim().toLowerCase(), G=$("#fdGrid"); G.textContent="";
  const isImg=m=>/^image\//.test(m.type||"");
  const list=flAll().filter(x=>(!fdKind || (fdKind==="img")===isImg(x.m)) && (!q || (x.m.name+" "+x.src+" "+(x.m.by||"")).toLowerCase().includes(q)));
  $("#fdTitle").textContent="📁 קבצים ("+nf(list.length)+")";
  if(!list.length){ G.appendChild(mk("p","hint","אין קבצים.")); return; }
  list.slice(0,300).forEach(x=>{ const c=mk("div","fd-it");
    const go=mk("button","fd-go"); go.type="button"; go.title="פתח את "+(x.k==="t"?"המשימה":"האירוע");
    if(okThumb(x.m.thumb)){ const im=mk("img"); im.src=x.m.thumb; im.alt=x.m.name; im.loading="lazy"; go.appendChild(im); }
    else go.appendChild(mk("span","fd-ic",fIcon(x.m)));
    go.onclick=()=>{ $("#dlgFiles").close(); x.k==="t" ? goTask(x.id) : evGo(x.id); };
    const z=mk("button","fd-z","🔍"); z.type="button"; z.title="פתח את הקובץ"; z.onclick=()=>openFile(x.m);
    c.append(go, z, mk("b","fd-n",x.m.name), mk("span","fd-s",(x.k==="t"?"📋 ":"⚠ ")+x.src), mk("span","fd-d",(x.m.at?fmtWhen(x.m.at).slice(0,10):"")+(x.m.by?" · "+x.m.by:"")));
    G.appendChild(c); });
}
$("#qkFiles").onclick=()=>{ $("#fdQ").value=""; flPaint(); $("#dlgFiles").showModal(); };
$("#fdClose").onclick=()=>$("#dlgFiles").close();
$("#fdQ").oninput=flPaint;
document.querySelectorAll("#fdKind button").forEach(b=>b.onclick=()=>{ fdKind=b.dataset.k; document.querySelectorAll("#fdKind button").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); flPaint(); });

/* ===== quiet screens: explanations behind a small ⓘ =====
   A card's description paragraph (the <p> right under its title) is hidden, with an ⓘ by the title that opens it.
   A long hint line keeps its short beginning (the state, e.g. "התראות פוש פעילות במכשיר הזה") and the rest opens from an ⓘ.
   Runs on everything, also text that is drawn or rewritten later (a MutationObserver), so new screens stay quiet too. */
(function(){
  const SKIP="#tvRoot,#splash,#tourLayer,.inb-list,.tk-run,.bs-slide";
  const btn=(label,onTap)=>{ const b=document.createElement("button"); b.type="button"; b.className="tip-i"; b.textContent="i";
    b.setAttribute("aria-label",label); b.setAttribute("aria-expanded","false"); b.title=label;
    b.onclick=ev=>{ ev.preventDefault(); ev.stopPropagation(); const on=b.getAttribute("aria-expanded")!=="true"; b.setAttribute("aria-expanded",String(on)); onTap(on); };
    return b; };
  function card(p){                                   // <h3>title</h3><p>description</p>
    const h=p.previousElementSibling; if(!h || h.querySelector(".tip-i")) return;
    p.classList.add("tip-body");
    h.appendChild(btn("הסבר", on=>p.classList.toggle("tip-show",on)));
  }
  function split(t){
    let m=t.match(/^(.{4,60}?)\s[—–]\s/); if(m) return [m[1], t.slice(m[0].length)];
    m=t.match(/^(.{4,60}?[.!])\s/); if(m) return [m[1], t.slice(m[0].length)];
    m=t.match(/^(.{15,60}?):\s/); if(m) return [m[1], t.slice(m[0].length)];
    return ["", t];
  }
  function hint(el){                                  // a hint line: short head + ⓘ + the rest (folded)
    const t=(el.textContent||"").trim(); el.dataset.tipk=t;
    if(t.length<=60) return;
    const [head,rest]=split(t);
    el.textContent=""; el.classList.add("tip-hint");
    if(head) el.appendChild(document.createTextNode(head+" "));
    const more=document.createElement("span"); more.className="tip-more"; more.textContent=(head?"":"")+rest;
    el.append(btn(head?"עוד":"הסבר", on=>more.classList.toggle("tip-show",on)), more);
    el.dataset.tipk=el.textContent;
  }
  function run(){
    document.querySelectorAll(".card > h3 + p, dialog > h3 + p").forEach(p=>{
      if(p.id || p.classList.contains("tip-body") || p.classList.contains("keep") || p.closest(SKIP)) return;
      if(!(p.textContent||"").trim() || p.querySelector("input,select,button,textarea")) return;
      card(p); });
    document.querySelectorAll(".hint").forEach(el=>{
      if(el.closest(SKIP) || el.classList.contains("keep")) return;
      if(el.dataset.tipk!=null && el.dataset.tipk===el.textContent) return;           // done, unchanged since
      if(el.querySelector("*:not(.tip-i):not(.tip-more)")) return;                    // has its own parts — leave it
      hint(el); });
  }
  let t=null; const later=()=>{ clearTimeout(t); t=setTimeout(run,60); };
  new MutationObserver(later).observe(document.body,{subtree:true,childList:true,characterData:true});
  run();
})();
tkColWApply();
