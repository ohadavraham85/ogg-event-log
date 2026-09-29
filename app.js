"use strict";
const $ = s => document.querySelector(s);

/* ================= seed lists ================= */
const SEED = {
  type:["תקלה","אחזקה חודשית","גלישות חרום","אחזקה","אחזקה מונעת","אחזקה שנתית","הפסקות חשמל",
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
  "ביקור":"visit","סיור בטיחות חודשי":"visit","תהליך":"visit"};
function hueOf(t){ return HUE[t] || "gen"; }
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
function persist(){
  try{
    localStorage.setItem(LS, JSON.stringify(events));
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
  $("#shTitle").textContent = META[k].title + (META[k].multi && sel[k].length ? " — לחיצה על מסומן מבטלת אותו" : "");
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
  const items = coreFirst(lists[k].slice().sort((a,b)=>(cnt[b]||0)-(cnt[a]||0)), k);
  const hits = items.filter(v=>!q || v.includes(q));
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
        if(i>=0){ sel[k].splice(i,1); drawOpts(); paintRows(); }      // un-pick: stay open
        else { sel[k].push(v); paintRows(); closeSheet(); }        // pick: close (open again to add more)
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
$("#shDone").onclick = closeSheet;
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
  const box=$("#listMgr"); box.textContent="";
  MGR_KEYS.forEach(([k,label])=>{
    const cnt=useCount(k), active=coreFirst(lists[k].slice().sort((x,y)=>(cnt[y]||0)-(cnt[x]||0)||x.localeCompare(y,"he")), k);
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
    const list=mk("div","mgr-list"); det.appendChild(list);
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
function resetForm(){
  sel.type=[]; sel.loc=[]; sel.eq=[]; sel.ppl=[]; sel.stat=["פתוח"];
  $("#title").value=""; $("#desc").value=""; $("#act").value=""; editId=null;
  $("#saveBtn").textContent="שמור אירוע"; setNow(); paintRows(); window.scrollTo({top:0});
}
function collect(){
  return {
    id: editId || (Date.now().toString(36)+Math.random().toString(36).slice(2,7)),
    type: sel.type.slice(), loc: sel.loc.slice(), eq: sel.eq.slice(), ppl: sel.ppl.slice(),
    stat: sel.stat.slice(), title: $("#title").value.trim(),
    desc: $("#desc").value.trim(), act: $("#act").value.trim(),
    when: whenStr(), ts: new Date().toISOString()
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
  if(i>=0) events[i]=e; else events.unshift(e);
  events.sort((a,b)=>(b.when||"").localeCompare(a.when||""));
  persist(); renderAll(); toast(i>=0?"האירוע עודכן":"האירוע נשמר"); resetForm();
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
      const hay=[e.title,e.desc,e.act].concat(e.type||[],e.loc||[],e.eq||[],e.ppl||[]).join(" ");
      if(!hay.includes(q)) return false;
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

  const slice=rows.slice(0,shown);
  let group=null;
  const sortMode=$("#sortBy").value;
  slice.forEach(e=>{
    if(sortMode==="when-desc"||sortMode==="when-asc"){
      const g=(e.when||"").slice(0,7);
      if(g!==group){
        group=g;
        const h=document.createElement("div"); h.className="daygap";
        h.textContent = g ? g.slice(5)+"/"+g.slice(0,4) : "ללא תאריך";
        box.appendChild(h);
      }
    }
    const t=(e.type||[])[0]||"";
    const d=document.createElement("article"); d.className="ev"+(UNSEEN.has(e.id)?" is-new":"");
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
    if(UNSEEN.has(e.id)){ const nw=document.createElement("span"); nw.className="newtag"; nw.textContent="חדש"; top.insertBefore(nw,top.firstChild); }
    if(e.title){
      const hh=document.createElement("div"); hh.className="hl"; hh.textContent=e.title;
      d.appendChild(top); d.appendChild(hh); top=null;
    }
    const b=document.createElement("div"); b.className="body";
    const sameAct = e.act && e.desc && e.act.trim()===e.desc.trim();
    b.textContent = e.desc;
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
    if(isLocked(e)){
      const lk=document.createElement("span"); lk.className="lock"; lk.title="ארכיון · "+(e.src||"");
      const li=document.createElement("span"); li.className="lk-i"; li.textContent="🔒";
      const lt=document.createElement("span"); lt.className="lk-t"; lt.textContent=" ארכיון · " + (e.src||"");
      lk.append(li,lt);
      acts.appendChild(lk);
      d.classList.add("locked");
    } else if(isManager()) {                // team log: only a manager deletes
    const rm=document.createElement("button"); rm.textContent="מחיקה";
    rm.onclick=async()=>{
      const what=[fmtWhen(e.when),(e.type||[]).join(", "),e.title||String(e.desc||"").slice(0,80)].filter(Boolean).join(" · ");
      if(!await confirmDel("למחוק את האירוע?", what+(CLOUD_ON?"\nהאירוע יימחק לכל הצוות.":""))) return;
      events=events.filter(x=>x.id!==e.id); persist(); renderAll(); toast("האירוע נמחק"); };
    acts.append(rm);
    }
    if(top) d.appendChild(top); d.append(b,det,acts); box.appendChild(d);
  });
  const more=$("#moreRows");
  more.hidden = rows.length<=shown;
  more.textContent = "הצג עוד "+Math.min(PAGE, rows.length-shown)+" מתוך "+(rows.length-shown);
}
$("#moreRows").onclick=()=>{ shown+=PAGE; renderList(false); };
/* list view: tiles (cards) or rows (one compact line per event; details open on "פרטים") */
let listView="tiles";
try{ listView=localStorage.getItem("ogg-list-view")==="rows"?"rows":"tiles"; }catch(e){}
function applyListView(){
  $("#viewList").classList.toggle("rows", listView==="rows");
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
function isLocked(e){ return !!(e.src && e.src!=="רישום ידני"); }
function nowLocal(){ const d=new Date(), p=n=>String(n).padStart(2,"0");
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes()); }
function afterStatus(){ renderFilters(); renderList(false); renderStats(); if(!$("#viewDash").hidden) renderDash(); }
/* close / reopen an event. Archive events stay locked for editing, but their status may change. */
function setStatus(id, close){
  const e=events.find(x=>x.id===id); if(!e) return;
  const prev={stat:e.stat, closedAt:e.closedAt, ts:e.ts};
  if(close){ e.stat=["נסגר"]; e.closedAt=nowLocal(); } else { e.stat=["פתוח"]; delete e.closedAt; }
  e.ts=new Date().toISOString();
  persist(); afterStatus();
  toast(close?"האירוע נסגר":"האירוע נפתח מחדש",{label:"ביטול",fn:()=>{
    ["stat","closedAt","ts"].forEach(k=>{ if(prev[k]===undefined) delete e[k]; else e[k]=prev[k]; });
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
  const parts=(e.when||"").split("T"); $("#dDate").value=parts[0]||""; $("#dTime").value=(parts[1]||"").slice(0,5);
  $("#saveBtn").textContent="עדכן אירוע"; show("New"); paintRows(); window.scrollTo({top:0});
}
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
  $("#cnt").textContent = events.length? "("+events.length+")":"";
}
function renderAll(){ paintRows(); renderFilters(); renderList(); renderStats(); renderMgr(); if(!$("#viewDash").hidden) renderDash(); if(!$("#viewCal").hidden) renderCal(); updateBadge(); paintNewCount(); }
$("#q").oninput=renderList; $("#fType").onchange=renderList; $("#fLoc").onchange=renderList;

/* ================= dashboard ================= */
const STAT_ORDER=["פתוח","בטיפול","ממתין לחלק","נסגר"];
const STAT_CLS={"פתוח":"s-open","בטיפול":"s-work","ממתין לחלק":"s-wait","נסגר":"s-done"};
const AGE=[ // days since the event, open events only
  {l:"עד שבוע",a:0,b:7},{l:"שבוע עד חודש",a:8,b:30},{l:"1–3 חודשים",a:31,b:90},
  {l:"3–12 חודשים",a:91,b:365},{l:"מעל שנה",a:366,b:Infinity}];
let dRange="365", dPpl="";
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
function dcard(title,sub,body,rows,head){
  const c=mk("div","card dcard");
  c.appendChild(mk("h3",null,title));
  if(sub) c.appendChild(mk("p","dsub",sub));
  c.appendChild(body);
  const det=mk("details","tv"); det.appendChild(mk("summary",null,"הצג כטבלה"));
  const tb=mk("table"); const hr=mk("tr"); head.forEach(h=>hr.appendChild(mk("th",null,h))); tb.appendChild(hr);
  rows.forEach(r=>{ const tr=mk("tr"); r.forEach(v=>tr.appendChild(mk("td",null,typeof v==="number"?nf(v):v))); tb.appendChild(tr); });
  det.appendChild(tb); c.appendChild(det);
  return c;
}
/* horizontal bars: label · bar · value at the tip */
function hbars(items, max, cls){
  const box=mk("div","hbars");
  items.forEach(it=>{
    const row=mk(it.go?"button":"div","hbar");
    if(it.go){ row.type="button"; row.onclick=it.go; }
    row.appendChild(mk("span","hl",it.l));
    const tr=mk("span","ht"); const f=mk("span","hf "+(it.cls||cls||""));
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
  paintTkSeg(); renderTasks(); show("Tasks"); window.scrollTo({top:0});
}
function dashTasks(cards, from){
  const today=ymd(new Date()), byP=t=>!dPpl || (t.ppl||[]).includes(dPpl);
  const open=tasks.filter(t=>tkOpen(t) && byP(t));
  const done=tasks.filter(t=>!tkOpen(t) && byP(t) && (!from || String(t.doneAt||"").slice(0,10)>=from)).length;
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
    const order=PRIOS.filter(p=>pc[p]), bar=mk("div","sbar"), lg=mk("div","legend");
    order.forEach(p=>{
      const cls="pr-"+PRIOS.indexOf(p), go=()=>goTasks({f:{prio:p}});
      const seg=mk("button","seg-s "+cls); seg.type="button"; seg.style.flexGrow=pc[p]; seg.setAttribute("aria-label",p+": "+pc[p]);
      seg.onclick=go; tipOn(seg, nf(pc[p])+" משימות", "עדיפות "+p); bar.appendChild(seg);
      const li=mk("button","li"); li.type="button"; li.onclick=go; li.append(mk("i",cls), mk("span",null,p), mk("b",null,nf(pc[p]))); lg.appendChild(li);
    });
    body.append(mk("div","dt-h","פתוחות לפי עדיפות"), bar, lg);
    // by assignee
    const ac={}; open.forEach(t=>{ const who=(t.ppl||[])[0]||"ללא אחראי"; ac[who]=(ac[who]||0)+1; });
    const names=Object.keys(ac).sort((x,y)=>ac[y]-ac[x]), top=names.slice(0,8);
    if(names.length>8){ const rest=names.slice(8).reduce((s,n)=>s+ac[n],0); top.push("אחרים"); ac["אחרים"]=rest; }
    const items=top.map(n=>({l:n, v:ac[n], go: n==="אחרים"||n==="ללא אחראי" ? ()=>goTasks({}) : ()=>goTasks({f:{ppl:n}})}));
    const hb=hbars(items, Math.max(...items.map(i=>i.v)), "one");
    hb.querySelectorAll(".hbar").forEach((r,i)=>tipOn(r, nf(items[i].v)+" משימות פתוחות", items[i].l));
    body.append(mk("div","dt-h","פתוחות לפי אחראי"), hb);
    // needs attention now
    const hot=open.filter(t=>(t.due && t.due<=today) || prioOf(t)==="דחופה")
      .sort((x,y)=>tkSortKey(x).localeCompare(tkSortKey(y))).slice(0,5);
    if(hot.length){
      const ul=mk("div","dt-hot");
      hot.forEach(t=>{
        const r=mk("button","dt-row"); r.type="button"; r.onclick=()=>goTasks({});
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
function renderDash(){ renderDash0(); arrangeDash(); }
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
  const rows = events.filter(e=>{
    if(dPpl && !(e.ppl||[]).includes(dPpl)) return false;
    if(!from) return true; const d=(e.when||"").slice(0,10); return d && d>=from; });
  const open = rows.filter(isOpen);
  const closed = rows.length-open.length;
  const faults = open.filter(e=>(e.type||[]).includes("תקלה")).length;
  $("#dScope").textContent = (from? "מ-"+dmy(from)+" עד היום" : "כל התקופה")+(dPpl? " · "+dPpl : "")+" · "+nf(rows.length)+" אירועים";

  /* KPI row */
  const k=$("#dKpis"); k.textContent="";
  [[ "פתוחים (לא נסגרו)", open.length, "hero", {stat:OPEN_ANY,from} ],
   [ "תקלות פתוחות", faults, "", {stat:OPEN_ANY,type:"תקלה",from} ],
   [ "נרשמו", rows.length, "", {from} ],
   [ "נסגרו", closed, "", {stat:"נסגר",from} ]].forEach(([l,v,cls,q])=>{
    const t=mk("button","kpi "+cls); t.type="button";
    t.append(mk("span","kl",l), mk("b",null,nf(v)), mk("span","kgo","הצג ברשימה ‹"));
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
  const sb=mk("div"); const bar=mk("div","sbar"); const lg=mk("div","legend");
  stats.forEach(s=>{
    const pct=Math.round(100*sc[s]/rows.length);
    const seg=mk("button","seg-s "+(STAT_CLS[s]||"s-other")); seg.type="button";
    seg.style.flexGrow=sc[s]; seg.setAttribute("aria-label",s+": "+nf(sc[s]));
    seg.onclick=()=>goList({stat:s,from}); tipOn(seg, nf(sc[s])+" · "+pct+"%", s);
    bar.appendChild(seg);
    const li=mk("button","li"); li.type="button"; li.onclick=seg.onclick;
    li.append(mk("i",STAT_CLS[s]||"s-other"), mk("span",null,s), mk("b",null,nf(sc[s])), mk("em",null,pct+"%"));
    lg.appendChild(li);
  });
  sb.append(bar,lg);
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
    const items=top.map(v=>({l:v,v:c[v],go:()=>goList({stat:OPEN_ANY,[filterKey]:v,from})}));
    if(rest) items.push({l:"אחר ("+all.slice(6).length+")",v:rest,cls:"other"});
    if(!items.length) return;
    const max=Math.max(...items.map(i=>i.v));
    cards.appendChild(dcard(title, null, hbars(items,max,"one"), all.map(v=>[v,c[v]]), [title.replace("פתוחים לפי ",""),"פתוחים"]));
  };
  topBars("type","פתוחים לפי סוג","type");
  topBars("loc","פתוחים לפי מיקום","loc");

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
$("#dPpl").onchange=()=>{ dPpl=$("#dPpl").value; renderDash(); };
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
});

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
  if($("#dTip")) $("#dTip").hidden=true;
  const prev=curView; curView=w;
  if(prev==="List" && w!=="List" && UNSEEN.size){ UNSEEN.clear(); saveUnseen(); }   // seen once you leave the list
  if($("#newCnt")) paintNewCount();
  ["New","List","Dash","Data","Tasks","Cal"].forEach(v=>{
    $("#view"+v).hidden=(v!==w);
    $("#tab"+v).setAttribute("aria-selected",String(v===w));
  });
  $("#savebar").style.display = w==="New"?"block":"none";
  document.querySelector(".wrap").style.paddingBottom = w==="New"?"130px":"40px";
}
$("#tabNew").onclick=()=>show("New");
$("#fabNew").onclick=()=>{ show("New"); window.scrollTo({top:0}); };   // "+" in the events list replaces the "רישום אירוע" tab
$("#tabList").onclick=()=>{ renderFilters(); renderList(); show("List"); };
$("#tabDash").onclick=()=>{ renderDash(); show("Dash"); };
$("#tabData").onclick=()=>{ renderStats(); renderMgr(); paintSettings(); show("Data"); };
/* settings: one topic at a time (lists / team / files / general); the last one is remembered */
let sgCur="lists"; try{ sgCur=localStorage.getItem("ogg-settings-topic")||"lists"; }catch(e){}
/* who manages: on this device (no team log) — you; in the team log — only members with the admin role.
   A regular member sees "צוות וחשבון" (own account) and "כללי"; lists management and files/backup are for admins. */
function isManager(){ if(!CLOUD_ON) return true; try{ return localStorage.getItem("ogg-cloud-role")==="admin"; }catch(e){ return false; } }
function paintSettings(){
  const team=!!$("#cloudCard"), mgr=isManager();
  $("#sgNav [data-sg=team]").hidden=!team;
  $("#sgNav [data-sg=lists]").hidden=!mgr; $("#sgNav [data-sg=files]").hidden=!mgr;
  if(!mgr && (sgCur==="lists"||sgCur==="files")) sgCur = team ? "team" : "general";
  if(sgCur==="team" && !team) sgCur = mgr ? "lists" : "general";
  document.querySelectorAll("#sgNav button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.sg===sgCur)));
  document.querySelectorAll("#viewData > .card").forEach(c=>{ c.hidden = (c.dataset.sg||"general")!==sgCur || c.dataset.off==="1"; });
}
document.querySelectorAll("#sgNav button").forEach(b=>b.onclick=()=>{ sgCur=b.dataset.sg; try{ localStorage.setItem("ogg-settings-topic",sgCur); }catch(e){} paintSettings(); window.scrollTo({top:0}); });
window.paintSettings=paintSettings;
/* theme: one tap switches between light and dark (whatever is showing now — the phone's setting or a saved choice) */
const darkMQ=window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : {matches:false};
function isDark(){ const t=document.documentElement.getAttribute("data-theme"); return t ? t==="dark" : darkMQ.matches; }
function paintThemeBtn(){
  const d=isDark(), b=$("#themeBtn");
  b.textContent = d ? "☀" : "☾";
  b.title = b.ariaLabel = d ? "מעבר לרקע בהיר" : "מעבר לרקע כהה";
  const m=document.querySelector('meta[name="theme-color"]'); if(m) m.content = d ? "#0E161C" : "#0E7C86";
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
const K_WEEK="ogg-weekly-done", K_WEEK_TO="ogg-weekly-to";
let wkState=null;
function weekStart(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate()-x.getDay()); return x.getTime(); }
function weekDone(){ try{ return +localStorage.getItem(K_WEEK)||0; }catch(e){ return 0; } }
function appTitle(){                          // the header title, e.g. "יומן אירועים" + sub-title
  const m=$(".bar .mark"); if(!m) return "יומן אירועים";
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
  $("#wkIntro").hidden=!!manual; $("#wkClose").hidden=!manual;
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
function weeklyCheck(){
  if($("#dlgWeek").open || !$("#splash").hidden || !events.length) return;
  if(CLOUD_ON){
    let role=null; try{ role=localStorage.getItem("ogg-cloud-role"); }catch(e){}
    if(!window.CLOUD_READY || role!=="admin") return;
  }
  if(weekDone()>=weekStart(new Date())) return;
  openWeekly(false);
}
window.weeklyCheck=weeklyCheck;
setInterval(weeklyCheck,5*60e3);
document.addEventListener("visibilitychange",()=>{ if(!document.hidden) setTimeout(weeklyCheck,800); });
wkLast();

function exportCsv(rows, filtered){
  rows = rows && rows.length ? rows : events;
  const head=["תאריך","סוג","כותרת","מיקום","ציוד","תיאור אירוע","פעולה שננקטה","מעורבים","סטטוס","מקור"];
  const esc=v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"';
  const body=rows.map(e=>[fmtWhen(e.when),(e.type||[]).join("; "),e.title||"",(e.loc||[]).join("; "),
    (e.eq||[]).join("; "),e.desc,e.act,(e.ppl||[]).join("; "),(e.stat||[]).join("; "),
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
const APP_VER="1.78", APP_DATE="30/09/2026";
$("#verChip").textContent="v"+APP_VER;
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
async function hardUpdate(){
  const cur=["Dash","New","List","Data","Tasks","Cal"].find(v=>!$("#view"+v).hidden)||"Dash";
  try{ sessionStorage.setItem("ogg-refresh",cur); }catch(e){}
  try{ const ks=await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); }catch(e){}
  try{ const rs=await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r=>r.unregister())); }catch(e){}
  location.replace(location.pathname+"?app=ogg-log-2&u="+Date.now());
}
async function checkUpdate(){
  const v=await latestVersion(); const bar=$("#updBar");
  if(v && newer(v,APP_VER)){ $("#updTxt").textContent="גרסה חדשה "+v+" זמינה (יש לך "+APP_VER+")"; bar.hidden=false; }
  else bar.hidden=true;
  return v;
}
$("#updGo").onclick=hardUpdate;
setTimeout(checkUpdate,2500); setInterval(checkUpdate,10*60e3);
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
  const u=new URL(location.href), v=u.searchParams.get("view");
  if(!v) return;
  if(v==="open"){ DEEP_OPEN=true; if(!REFRESH_VIEW) REFRESH_VIEW="List"; }
  else if(["Dash","New","List","Data","Tasks","Cal"].includes(v) && !REFRESH_VIEW) REFRESH_VIEW=v;
  u.searchParams.delete("view"); history.replaceState(null,"",u.pathname+u.search);
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
const tkF={ppl:"",loc:"",type:"",prio:"",dept:"",late:false};                 // list filters (dropdowns at the top)
const PRIOS=["דחופה","גבוהה","רגילה","נמוכה"];
const PRIO_HUE={"דחופה":"fault","גבוהה":"flood","רגילה":"maint","נמוכה":"gen"};
const prioOf=t=>PRIOS.includes(t.prio) ? t.prio : (t.urgent ? "דחופה" : "רגילה");   // older tasks: urgent flag
function loadTasks(){ try{ tasks=JSON.parse(localStorage.getItem(LST)||"[]"); if(!Array.isArray(tasks)) tasks=[]; }catch(e){ tasks=[]; } }
function saveTasks(){
  try{ localStorage.setItem(LST, JSON.stringify(tasks)); }catch(e){ toast("הדפדפן חסם שמירה מקומית"); }
  if(window.cloudPushTasks) window.cloudPushTasks();
  writeFile();
  renderTasks();
}
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const tkOpen=t=>t.status!=="הושלמה";
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
function paintTaskCount(){
  const n=tasks.filter(tkOpen).length;                     // "(open/total)": 4/5 = 4 open out of 5
  $("#tkCnt").textContent = "("+(tasks.length ? nf(n)+"/"+nf(tasks.length) : "0")+")";
  $("#tkCnt").title = n+" פתוחות מתוך "+tasks.length+" משימות"; $("#tkCnt").dir="ltr";
  const m=tasks.filter(t=>tkOpen(t)&&isMine(t)).length, el=$("#tkMine");
  el.textContent = m ? String(m) : ""; el.title = m ? m+" משימות פתוחות שלך" : ""; el.hidden=!m;
  const segN={open:n, done:tasks.length-n, mine:m};
  document.querySelectorAll("#tkSeg button").forEach(b=>{
    const base={open:"פתוחות",done:"הושלמו",mine:"המשימות שלי"}[b.dataset.v];
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
const INBOX_MAX=80, INBOX_ICON={assign:"📌",update:"💬",status:"🔄",edit:"✏️",off:"↩"};
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
  const n=inboxGet().filter(x=>!x.read).length, s=$("#inboxN");
  s.textContent = n>99 ? "99+" : String(n); s.hidden=!n;
  b.setAttribute("aria-label", n ? n+" הודעות חדשות" : "הודעות"); b.title = n ? n+" הודעות חדשות" : "הודעות";
}
let inboxOpenUntil=Date.now()+20000;          // "the app was just opened": messages arriving now pop the list up
function inboxAdd(items, toasted){
  const a=inboxGet(), ids=new Set(a.map(x=>x.id)), now=nowLocal()+":"+String(new Date().getSeconds()).padStart(2,"0");
  const add=items.filter(x=>x && !ids.has(x.id)).map(x=>Object.assign({at:now}, x, {read:false}));
  if(!add.length) return;
  inboxPut(add.concat(a));
  if(Date.now()<inboxOpenUntil) inboxCheck();
  else if(!toasted) toast(add.length===1 ? "הודעה חדשה: "+(add[0].title||"") : add.length+" הודעות חדשות", {label:"הצג", fn:openInbox});
}
function inboxCheck(){
  if(!CLOUD_ON || !inboxGet().some(x=>!x.read)) return;
  const sp=$("#splash"); if(sp && !sp.hidden) return;                 // after the opening screen
  if(document.querySelector("dialog[open]")) return;                  // the weekly window etc. first (retried when it closes)
  openInbox();
}
function openInbox(){
  const d=$("#dlgInbox"), box=$("#inbList"), a=inboxGet(), n=a.filter(x=>!x.read).length;
  $("#inbTitle").textContent = n ? "הודעות חדשות ("+n+")" : "הודעות";
  box.textContent="";
  if(!a.length) box.appendChild(mk("div","inb-empty","אין הודעות. כאן יופיעו הקצאות ועדכונים במשימות שלך."));
  a.forEach(x=>{
    const r=mk("button","inb"+(x.read?"":" new")); r.type="button";
    r.appendChild(mk("span","inb-i",INBOX_ICON[x.kind]||"•"));
    const body=mk("span","inb-b"); body.appendChild(mk("b","inb-t",x.title||"(ללא כותרת)")); body.appendChild(mk("span","inb-x",x.text||""));
    body.appendChild(mk("span","inb-m",[x.by,fmtWhen(x.at)].filter(Boolean).join(" · "))); r.appendChild(body);
    r.onclick=()=>{ d.close(); goTask(x.tid); };
    box.appendChild(r);
  });
  if(!d.open) d.showModal();
}
function goTask(tid){
  const t=tasks.find(x=>x.id===tid); if(!t){ toast("המשימה כבר לא קיימת"); return; }
  Object.keys(tkF).forEach(k=>tkF[k]= k==="late" ? false : "");
  tkView = !tkOpen(t) ? "done" : isMine(t) ? "mine" : "open"; tkOpenLogs.add(t.id);
  paintTkSeg(); renderTasks(); show("Tasks");
  const c=document.querySelector('#tkList .tk[data-id="'+tid+'"]');
  if(c){ c.scrollIntoView({block:"center"}); c.classList.add("flash"); setTimeout(()=>c.classList.remove("flash"),2200); }
}
$("#inboxBtn").onclick=openInbox;
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
  return coreFirst((lists[k]||[]).slice().sort((x,y)=>(m.get(y)||0)-(m.get(x)||0) || x.localeCompare(y,"he")), k);
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
function paintFormColors(){ colorSelect($("#tkPrio"), PRIO_HUE[$("#tkPrio").value]); colorSelect($("#tkType"), $("#tkType").value ? hueOf($("#tkType").value) : ""); }
function renderTkFilters(){
  fillSelect($("#tfPpl"), pplValues(), tkF.ppl, "כל האחראים");
  fillSelect($("#tfDept"), allDepts(), tkF.dept, "כל המחלקות"); $("#tfDept").hidden=!allDepts().length;
  $("#tfDept").classList.toggle("on",!!tkF.dept);
  fillSelect($("#tfLoc"), byUse("loc"), tkF.loc, "כל המיקומים");
  fillSelect($("#tfType"), byUse("type"), tkF.type, "כל הסוגים");
  fillSelect($("#tfPrio"), PRIOS, tkF.prio, "כל העדיפויות");
  colorSelect($("#tfPrio"), PRIO_HUE[tkF.prio]); colorSelect($("#tfType"), tkF.type ? hueOf(tkF.type) : "");
  ["#tfPpl","#tfLoc","#tfType"].forEach(id=>$(id).classList.toggle("on",!!$(id).value));
  $("#tfClear").hidden=!Object.values(tkF).some(Boolean);
  $("#tfClear").textContent = "✕ נקה סינון"+(tkF.late ? " (באיחור)" : "");
  const dl=$("#dlPpl"); dl.textContent=""; (lists.ppl||[]).forEach(v=>{ const x=document.createElement("option"); x.value=v; dl.appendChild(x); });
}
$("#tfClear").onclick=()=>{ Object.keys(tkF).forEach(k=>tkF[k]= k==="late" ? false : ""); renderTasks(); };
["ppl","loc","type","prio","dept"].forEach(k=>{ const el=$("#tf"+k[0].toUpperCase()+k.slice(1)); el.onchange=()=>{ tkF[k]=el.value; renderTasks(); }; });
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
function renderCheck(t, c){
  const items=(t.check||[]).filter(x=>x && !x.del), open=tkOpen(t);
  if(!items.length && !open) return;
  const box=mk("div","tk-check"), done=items.filter(x=>x.done).length;
  box.appendChild(mk("div","tk-check-h", items.length ? "רשימת בדיקה ("+done+" מתוך "+items.length+" פריטים בוצעו)" : "רשימת בדיקה"));
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
    r.append(b,x);
    if(it.done && it.by) r.appendChild(mk("span","ck-by",it.by));
    if(open && isManager()){ const d=mk("button","ck-del","✕"); d.type="button"; d.setAttribute("aria-label","הסר פריט");
      d.onclick=async()=>{ if(!await confirmDel("להסיר פריט מרשימת הבדיקה?", it.text)) return; it.del=true; save(); }; r.appendChild(d); }
    box.appendChild(r);
  });
  if(open){
    const r=mk("div","ck ck-add"), o=mk("span","ck-box"), inp=mk("input");
    inp.placeholder="הוסף פריט"; inp.dataset.draft="ck-"+t.id; inp.setAttribute("aria-label","הוסף פריט לרשימת הבדיקה"); inp.maxLength=300;
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
/* update log as a conversation: bubbles (mine on one side, others on the other, system lines in the middle)
   and a message box always open under an open task — Enter sends, Shift+Enter is a new line.
   A draft survives the list being redrawn (a sync from the team), and so does the focus. */
function renderLog(t, c){
  const log=(t.log||[]).slice().sort((x,y)=>String(x.at).localeCompare(String(y.at)));
  const open=tkOpen(t);
  if(!log.length && !open) return;
  const box=mk("div","tk-log");
  const all=tkOpenLogs.has(t.id), show=all ? log : log.slice(-4);
  const head=mk("div","tk-log-h","💬 שיחה ועדכונים"+(log.length?" ("+log.length+")":""));
  if(log.length>4){ const b=mk("button","tk-more", all ? "הצג פחות" : "הצג את כל "+log.length);
    b.type="button"; b.onclick=()=>{ all ? tkOpenLogs.delete(t.id) : tkOpenLogs.add(t.id); renderTasks(); }; head.appendChild(b); }
  box.appendChild(head);
  const meMail = window.cloudMe && window.cloudMe(), meName=reporter();
  const chat=mk("div","tk-chat");
  show.forEach(l=>{
    const when=fmtWhen(l.at).replace(/\/\d{4}/,"");
    if(l.sys){ const r=mk("div","tk-sys"); r.append(mk("span",null,(l.by?l.by+": ":"")+l.text+" · "), mk("span","tk-le-t",when)); chat.appendChild(r); return; }
    const mine = meMail ? l.mail===meMail : (!!l.by && l.by===meName);
    const r=mk("div","tk-msg"+(mine?" me":""));
    if(!mine && l.by) r.appendChild(mk("b","tk-msg-by",l.by));
    const x=mk("div","tk-msg-x",l.text); if(l.mail) x.title=l.mail; r.appendChild(x);
    r.appendChild(mk("span","tk-le-t",when));
    chat.appendChild(r);
  });
  box.appendChild(chat);
  if(open){
    const f=mk("div","tk-send");
    // team log: the signed-in user is the reporter (no choice); this device: pick who reports (required)
    const auto = !!meMail;
    let who=null;
    if(!auto){ who=mk("select","tk-send-who"); fillSelect(who, pplValues(), meName, "— מי כותב? —"); who.setAttribute("aria-label","מי כותב"); f.appendChild(who); }
    const ta=mk("textarea"); ta.rows=1; ta.placeholder="כתוב עדכון…"; ta.dataset.draft=t.id; ta.value=tkDraft[t.id]||"";
    ta.setAttribute("aria-label","עדכון למשימה");
    const grow=()=>{ ta.style.height=""; if(ta.value.includes("\n") || ta.scrollHeight>ta.clientHeight+2) ta.style.height=Math.min(ta.scrollHeight+3,140)+"px"; };
    const send=mk("button","tk-send-btn"); send.type="button"; send.setAttribute("aria-label","שלח עדכון"); send.title="שלח";
    send.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12 4 4l3 8-3 8z" fill="currentColor"/></svg>';
    const paintBtn=()=>send.disabled=!ta.value.trim();
    ta.oninput=()=>{ tkDraft[t.id]=ta.value; grow(); paintBtn(); };
    const go=()=>{
      const txt=ta.value.trim(); if(!txt){ ta.focus(); return; }
      const by = auto ? reporter() : who.value;
      if(!by){ toast("בחר מי כותב"); who.focus(); return; }
      if(!auto) try{ localStorage.setItem(K_REPORTER,by); }catch(e){}
      tkLog(t, txt, by); if(t.status!=="בטיפול") t.status="בטיפול";
      delete tkDraft[t.id]; tkOpenLogs.delete(t.id);
      t.upd=new Date().toISOString(); saveTasks();           // redraws; the box keeps the focus for the next message
    };
    send.onclick=go;
    ta.onkeydown=e=>{ if(e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); go(); } };
    f.append(ta,send); box.appendChild(f);
    paintBtn(); setTimeout(grow,0);
    if(tkFocus===t.id) setTimeout(()=>{ ta.focus({preventScroll:true}); ta.setSelectionRange(ta.value.length,ta.value.length); },0);
  }
  c.appendChild(box);
}
function renderTasks(){
  const ae=document.activeElement; tkFocus = ae && ae.dataset && ae.dataset.draft || null;   // typing in a task's message box
  paintTaskCount(); renderTkFilters(); paintMe();
  if(!$("#viewDash").hidden && typeof renderDash==="function") setTimeout(renderDash,0);   // keep the tasks card current
  if(!$("#viewCal").hidden && typeof renderCal==="function") setTimeout(renderCal,0);
  const box=$("#tkList"); if(!box) return; box.textContent="";
  const today=ymd(new Date());
  const pass=t=>(!tkF.ppl || (t.ppl||[]).includes(tkF.ppl)) && (!tkF.loc || (t.loc||[]).includes(tkF.loc))
             && (!tkF.type || t.type===tkF.type) && (!tkF.prio || prioOf(t)===tkF.prio)
             && (!tkF.late || (t.due && t.due<today)) && (!tkF.dept || (t.depts||[]).includes(tkF.dept));
  const rows = (tkView!=="done"
    ? tasks.filter(t=>tkOpen(t) && (tkView!=="mine" || isMine(t))).sort((a,b)=>tkSortKey(a).localeCompare(tkSortKey(b)))
    : tasks.filter(t=>!tkOpen(t)).sort((a,b)=>String(b.doneAt||"").localeCompare(String(a.doneAt||"")))).filter(pass);
  if(!rows.length){ box.appendChild(mk("div","tk-empty", Object.values(tkF).some(Boolean) ? "אין משימות שמתאימות לסינון." :
    tkView==="mine" ? (myName() ? "אין משימות פתוחות שלך או של המחלקה שלך." : (window.cloudMe ? "המנהל עדיין לא הגדיר לך שם בצוות." : "בחר למעלה \"אני:\" כדי לראות את המשימות שלך.")) : tkView==="open" ? "אין משימות פתוחות." : "עדיין לא הושלמו משימות.")); return; }
  rows.forEach(t=>{
    const pr=prioOf(t), ph=PRIO_HUE[pr];
    const c=mk("div","tk"+(tkOpen(t)?"":" done")); c.dataset.id=t.id; c.style.borderInlineStartColor = tkOpen(t) ? "var(--c-"+ph+")" : "";
    if(tkOpen(t) && pr==="דחופה") c.style.background="color-mix(in srgb,var(--c-fault-bg) 55%,var(--panel))";
    c.appendChild(mk("div","tk-t",t.title||"(ללא כותרת)"));
    const tags=mk("div","tk-tags"), tag=(txt,cls,hue)=>{ const x=mk("span","tk-tag"+(cls?" "+cls:""),txt);
      if(hue){ x.style.background="var(--c-"+hue+"-bg)"; x.style.color="var(--c-"+hue+")"; x.style.borderColor="transparent"; } tags.appendChild(x); };
    if(tkOpen(t)){
      if(isMine(t)) tag((t.ppl||[]).includes(myName()) ? "שלי" : "המחלקה שלי","me");
      (t.depts||[]).forEach(d=>tag("🏢 "+d,"dept"));
      if(pr!=="רגילה") tag(pr,"",ph);
      if(t.type) tag(t.type,"",hueOf(t.type));
      if(t.status==="בטיפול") tag("בטיפול","w");
      { const ci=(t.check||[]).filter(x=>x && !x.del); if(ci.length) tag("☑ "+ci.filter(x=>x.done).length+"/"+ci.length, ci.every(x=>x.done)?"ok":""); }
      if(t.start && t.start>today) tag("מתחילה "+dmy(t.start).slice(0,5));
      if(t.due) tag((t.due<today?"באיחור · ":t.due===today?"היום · ":"יעד ")+dmy(t.due).slice(0,5), t.due<today?"late":t.due===today?"today":"");
    } else {
      tag("הושלמה "+(t.doneAt?fmtWhen(t.doneAt).slice(0,10):""),"ok");
      if(t.type) tag(t.type,"",hueOf(t.type));
      if(t.eventId && events.some(e=>e.id===t.eventId)) tag("נרשמה ביומן");
    }
    if(tags.childElementCount) c.appendChild(tags);
    const pn=n=>{ const x=[deptOf(n),roleOf(n)].filter(Boolean).join(" · "); return x?n+" ("+x+")":n; };
    const meta=[(t.ppl||[]).length ? "👤 "+(t.ppl.length>1 ? "אחראי: "+pn(t.ppl[0])+" · משויכים: "+t.ppl.slice(1).join(", ") : pn(t.ppl[0])) : "", (t.loc||[]).length?"📍 "+t.loc.join(", "):"", (t.eq||[]).length?"⚙ "+t.eq.join(", "):""].filter(Boolean).join("   ");
    if(meta) c.appendChild(mk("div","tk-m",meta));
    if(t.desc) c.appendChild(mk("div","tk-d",t.desc));
    renderCheck(t, c);
    if(!tkOpen(t) && t.act) c.appendChild(mk("div","tk-d","בוצע: "+t.act));
    renderLog(t, c);
    const acts=mk("div","tk-acts"), btn=(label,cls,fn)=>{ const b=mk("button","btn"+(cls?" "+cls:""),label); b.type="button"; b.onclick=fn; acts.appendChild(b); };
    if(tkOpen(t)){
      btn("✓ סיים ורשום ביומן","primary",()=>openTaskDone(t.id));
      btn(t.status==="בטיפול"?"החזר לפתוחה":"בטיפול","",()=>{ t.status = t.status==="בטיפול" ? "פתוחה" : "בטיפול";
        tkLog(t, t.status==="בטיפול" ? "הועברה לטיפול" : "הוחזרה לפתוחה", "", true); t.upd=new Date().toISOString(); saveTasks(); });
      btn("ערוך","",()=>openTaskForm(t.id));
    }
    if(isManager()) btn("מחק","ghost",async()=>{
      if(!await confirmDel("למחוק את המשימה?", (t.title||"")+((t.log||[]).length?"\nכולל יומן העדכונים ("+t.log.length+")":"")+(t.eventId?"\nהאירוע שנרשם ביומן נשאר.":"")+(CLOUD_ON?"\nהמשימה תימחק לכל הצוות.":""))) return;
      tasks=tasks.filter(x=>x.id!==t.id); saveTasks(); toast("המשימה נמחקה");
    });
    c.appendChild(acts); box.appendChild(c);
  });
}
function openTaskForm(id){
  const t=id ? tasks.find(x=>x.id===id) : null; tkEdit=t ? t.id : null;
  const types=lists.type||[], defType=types.includes("אחזקה") ? "אחזקה" : (types[0]||"");
  fillSelect($("#tkType"), byUse("type"), t ? (t.type||"") : defType, "— בחר סוג —");
  fillSelect($("#tkPrio"), PRIOS, t ? prioOf(t) : "רגילה");
  fillSelect($("#tkPpl"), pplValues(), "", "— הוסף משתמש —", true);
  paintPplChips(t ? (t.ppl||[]) : (tkView==="mine" && myName() ? [myName()] : []));
  fillSelect($("#tkLoc"), byUse("loc"), t ? (t.loc||[])[0]||"" : "", "— בחר מיקום —", true);
  fillSelect($("#tkEq"), byUse("eq"), t ? (t.eq||[])[0]||"" : "", "— בחר ציוד —", true);
  paintDeptChips(t ? (t.depts||[]) : (tkView==="mine" && myDept() && !myName() ? [myDept()] : []));
  document.querySelectorAll("#tkForm .tk-f.bad").forEach(x=>x.classList.remove("bad"));
  paintFormColors();
  $("#tkFormTitle").textContent = t ? "עריכת משימה" : "משימה חדשה";
  $("#tkTitle").value=t?t.title||"":""; $("#tkDesc").value=t?t.desc||"":"";
  $("#tkDue").value=t?t.due||"":"";
  $("#tkStart").value=t ? (t.start || String(t.created||"").slice(0,10) || ymd(new Date())) : ymd(new Date());
  $("#tkDue").min=$("#tkStart").value;
  $("#tkForm").hidden=false; $("#tkNewBtn").hidden=true;
  $("#tkForm").scrollIntoView({block:"start",behavior:"smooth"});
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
/* departments: several can be picked (chips); departments come from "תפקיד ומחלקה" of the people */
let tkDeptSel=[];
function paintDeptChips(sel){
  if(sel) tkDeptSel=sel.slice();
  const box=$("#tkDepts"); box.textContent="";
  const all=[...new Set(allDepts().concat(tkDeptSel))];
  if(!all.length){ box.appendChild(mk("span","hint","אין עדיין מחלקות — מגדירים ב\"הגדרות ← ניהול רשימות ← אנשים ← תפקיד ומחלקה\".")); return; }
  all.forEach(d=>{ const on=tkDeptSel.includes(d), b=mk("button","dchip"+(on?" on":""),(on?"✓ ":"")+d); b.type="button"; b.setAttribute("aria-pressed",String(on));
    b.onclick=()=>{ tkDeptSel = on ? tkDeptSel.filter(x=>x!==d) : tkDeptSel.concat(d); paintDeptChips();
      if(tkDeptSel.length) $("#tkPpl").closest(".tk-f").classList.remove("bad"), box.closest(".tk-f").classList.remove("bad"); };
    box.appendChild(b); });
}
function closeTaskForm(){ $("#tkForm").hidden=true; $("#tkNewBtn").hidden=false; tkEdit=null; }
const one=v=>v && v!=="__other" ? [v] : [];
$("#tkNewBtn").onclick=()=>openTaskForm(null);
$("#tkCancel").onclick=closeTaskForm;
$("#tkSave").onclick=()=>{
  // all fields are required: type, priority, assignee, due date, location, equipment, and what to do
  // assignment: a person, one or more departments, or both — at least one of them
  const need=[["#tkType","סוג"],["#tkPrio","עדיפות"],["#tkStart","תאריך התחלה"],["#tkPpl","אחראי או מחלקה"],["#tkDue","תאריך יעד"],["#tkLoc","מיקום"],["#tkEq","ציוד"],["#tkTitle","כותרת המשימה"]];
  const miss=need.filter(([id])=>{ const v=($(id).value||"").trim(); let bad=!v || v==="__other";
    if(id==="#tkPpl") bad=!tkPplSel.length && !tkDeptSel.length;
    $(id).closest(".tk-f").classList.toggle("bad",bad); if(id==="#tkPpl") $("#tkDepts").closest(".tk-f").classList.toggle("bad",bad); return bad; });
  if(miss.length){ toast("חסר: "+miss.map(m=>m[1]).join(", "));
    const f=$(miss[0][0]); (f.classList.contains("ss-hidden") ? f.nextElementSibling : f).focus(); return; }
  if($("#tkStart").value > $("#tkDue").value){ $("#tkDue").closest(".tk-f").classList.add("bad"); toast("תאריך היעד לפני תאריך ההתחלה"); $("#tkDue").focus(); return; }
  const title=$("#tkTitle").value.trim();
  const now=new Date().toISOString(), prio=$("#tkPrio").value||"רגילה";
  const data={title, desc:$("#tkDesc").value.trim(), type:$("#tkType").value||"", prio, urgent:prio==="דחופה",
    ppl:tkPplSel.slice(), loc:one($("#tkLoc").value), eq:one($("#tkEq").value), due:$("#tkDue").value||"", start:$("#tkStart").value||"", depts:tkDeptSel.slice(), upd:now};
  const was=tkEdit;
  if(was){ const t=tasks.find(x=>x.id===was); if(t) Object.assign(t,data); }
  else { const t=Object.assign({id:newId(), status:"פתוחה", created:now, log:[]}, data);
    tkLog(t, "המשימה נפתחה"+(data.ppl.length?" · אחראי: "+data.ppl[0]:"")+(data.ppl.length>1?" · משויכים: "+data.ppl.slice(1).join(", "):"")+(data.depts.length?" · מחלקות: "+data.depts.join(", "):""), "", true); tasks.push(t); }
  closeTaskForm(); if(tkView==="done"){ tkView="open"; paintTkSeg(); } saveTasks(); toast(was?"המשימה עודכנה":"המשימה נשמרה");
};
function paintTkSeg(){ document.querySelectorAll("#tkSeg button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.v===tkView))); }
document.querySelectorAll("#tkSeg button").forEach(b=>b.onclick=()=>{ tkView=b.dataset.v; paintTkSeg(); renderTasks(); });
/* finish a task -> a closed event in the log */
function openTaskDone(id){
  const t=tasks.find(x=>x.id===id); if(!t) return; tkDoneId=id;
  $("#tdName").textContent=t.title;
  $("#tdAct").value=t.act||"";
  const types=lists.type||[], def=t.type || (types.includes("אחזקה") ? "אחזקה" : types[0]);
  fillSelect($("#tdType"), types, def);
  colorSelect($("#tdType"), hueOf($("#tdType").value));
  $("#tdWhen").value=nowLocal();
  $("#dlgTaskDone").showModal();
}
$("#tdType").onchange=()=>colorSelect($("#tdType"), hueOf($("#tdType").value));
$("#tdCancel").onclick=()=>$("#dlgTaskDone").close();
$("#tdOk").onclick=()=>{
  const t=tasks.find(x=>x.id===tkDoneId); if(!t){ $("#dlgTaskDone").close(); return; }
  const when=$("#tdWhen").value||nowLocal(), act=$("#tdAct").value.trim(), type=$("#tdType").value;
  const ev={ id:newId(), type:type?[type]:[], loc:(t.loc||[]).slice(), eq:(t.eq||[]).slice(), ppl:(t.ppl||[]).slice(),
    stat:["נסגר"], title:t.title, desc:t.desc||"", act, when, closedAt:when, ts:new Date().toISOString(),
    ...((t.log||[]).some(l=>!l.sys) ? {follow:(t.log||[]).slice().sort((x,y)=>String(x.at).localeCompare(String(y.at))).map(logLine).join("\n")} : {}),
    taskId:t.id, taskCreated:t.created||"" };
  events.push(ev); events.sort((a,b)=>(b.when||"").localeCompare(a.when||""));
  ["loc","eq","ppl"].forEach(k=>(ev[k]||[]).forEach(v=>{ if(!lists[k].includes(v)) lists[k].push(v); }));
  Object.assign(t,{status:"הושלמה", doneAt:when, act, eventType:type, eventId:ev.id, upd:new Date().toISOString()});
  tkLog(t, "הושלמה ונרשמה ביומן"+(act?": "+act:""), "", true);
  $("#dlgTaskDone").close();
  persist(); renderAll(); saveTasks();
  toast("המשימה הושלמה ונרשמה ביומן",{label:"הצג",fn:()=>{ $("#sortBy").value="edit"; goList({ppl:""}); }});
};
$("#tabTasks").onclick=()=>{ renderTasks(); show("Tasks"); };
/* ================= calendar: events that happened + tasks (due / completed), month view ================= */
let calY, calM, calSel=null, calMd="all", calLeg="";   // calLeg: legend colour picked → only that kind
try{ calMd=localStorage.getItem("ogg-cal-mode")||"all"; }catch(e){}
(()=>{ const d=new Date(); calY=d.getFullYear(); calM=d.getMonth(); })();
const HEB_MONTHS=["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
function calIndex(){
  const ev={}, due={}, done={}, today=ymd(new Date()), L=calLeg, on=x=>!L || L===x;
  if(calMd!=="tk" && on("ev")) events.forEach(e=>{ const d=(e.when||"").slice(0,10); if(d) (ev[d]=ev[d]||[]).push(e); });
  if(calMd!=="ev") tasks.forEach(t=>{
    if(tkOpen(t) && t.due && on(t.due<today?"late":"tk")){
      // an open task sits on every day from its start date to its due date (older tasks without a start: the due day only)
      const s0=t.start && t.start<=t.due ? t.start : t.due; let d=new Date(s0+"T12:00"), n=0;
      while(n<200){ const k=ymd(d); const pos = s0===t.due ? "single" : k===s0 ? "start" : k===t.due ? "end" : "mid";
        (due[k]=due[k]||[]).push({t,pos}); if(k>=t.due) break; d.setDate(d.getDate()+1); n++; } }
    if(!tkOpen(t) && t.doneAt && on("done")){ const d=String(t.doneAt).slice(0,10); (done[d]=done[d]||[]).push(t); } });
  return {ev,due,done};
}
function renderCal(){
  document.querySelectorAll("#calMode button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.m===calMd)));
  document.querySelectorAll("#calLeg button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.l===calLeg)));
  $("#calLeg").classList.toggle("picked",!!calLeg);
  // monthly counts on the mode buttons (always for the month shown, whatever the mode)
  const pre=calY+"-"+String(calM+1).padStart(2,"0");
  const nEv=events.filter(e=>(e.when||"").startsWith(pre)).length;
  const mS=pre+"-01", mE=pre+"-31";
  const nTk=tasks.filter(t=>(tkOpen(t) && t.due && (t.start&&t.start<=t.due?t.start:t.due)<=mE && t.due>=mS) || (!tkOpen(t) && String(t.doneAt||"").startsWith(pre))).length;
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
  const dues=I.due[k]||[], dones=I.done[k]||[];
  const dn=new Date(k+"T12:00"), head=mk("h3",null,["יום ראשון","יום שני","יום שלישי","יום רביעי","יום חמישי","יום שישי","שבת"][dn.getDay()]+" · "+dmy(k)+(k===today?" · היום":""));
  box.appendChild(head);
  if(!evs.length && !dues.length && !dones.length){ box.appendChild(mk("p","hint",k>today?"אין משימות ליעד ביום הזה.":"לא נרשם כלום ביום הזה.")); return; }
  const sec=(title,rows)=>{ if(!rows.length) return; box.appendChild(mk("div","cal-h",title)); rows.forEach(r=>box.appendChild(r)); };
  sec(dues.length?"משימות ביום הזה ("+dues.length+")":"", dues.map(({t,pos})=>{
    const r=mk("button","cal-row r-task"); r.type="button"; r.style.borderInlineStartColor="var(--c-"+PRIO_HUE[prioOf(t)]+")";
    const when = pos==="start" ? "▶ מתחילה היום" : pos==="end"||pos==="single" ? (t.due<today?"⚠ היעד עבר":"🏁 יעד") : "בביצוע";
    const range = t.start && t.start!==t.due ? dmy(t.start).slice(0,5)+"–"+dmy(t.due).slice(0,5) : "";
    r.append(mk("b",null,t.title||""), mk("span","cal-meta",[when, range, prioOf(t)!=="רגילה"?prioOf(t):"", (t.ppl||[])[0]||"", t.status==="בטיפול"?"בטיפול":""].filter(Boolean).join(" · ")));
    r.onclick=()=>goTasks({}); return r; }));
  sec(dones.length?"משימות שהושלמו ("+dones.length+")":"", dones.map(t=>{
    const r=mk("button","cal-row r-done"); r.type="button"; r.append(mk("b",null,"✓ "+(t.title||"")), mk("span","cal-meta",(t.ppl||[])[0]||""));
    r.onclick=()=>goTasks({view:"done"}); return r; }));
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
  closeSS();
  const p=mk("div","ss-panel"), q=mk("input","ss-q"), list=mk("div","ss-list");
  q.type="search"; q.placeholder="חיפוש…"; q.autocomplete="off"; p.append(q,list);
  const opts=[...sel.options].map(o=>({v:o.value,t:o.textContent,core:isCore(o.value)}));
  const pick=v=>{ sel.value=v; sel.dispatchEvent(new Event("change",{bubbles:true})); closeSS(); btn.focus(); };
  let first=null;
  const paint=()=>{
    list.textContent=""; first=null; const f=q.value.trim().toLowerCase();
    opts.forEach(o=>{
      const special = o.v==="" || o.v==="__other";
      if(f && !special && !(o.t+" "+roleOf(o.v)+" "+deptOf(o.v)).toLowerCase().includes(f)) return;   // search by role / department too
      if(f && o.v==="") return;
      const b=mk("button","ss-opt"+(o.v===sel.value?" on":"")+(special?" sp":"")+(o.core?" core":""),o.t); b.type="button"; b.onclick=()=>pick(o.v);
      if(!special) b.appendChild(personTags(o.v));
      if(!first && !special) first=o.v; list.appendChild(b);
    });
    if(!list.querySelector(".ss-opt:not(.sp)")) list.insertBefore(mk("div","ss-none","אין התאמה"), list.firstChild);
  };
  q.oninput=paint;
  q.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); if(first!==null) pick(first); } if(e.key==="Escape"){ closeSS(); btn.focus(); } };
  paint(); document.body.appendChild(p); ssPanel=p; p._btn=btn;
  const place=()=>{
    const r=btn.getBoundingClientRect(), w=Math.max(r.width,Math.min(300,innerWidth-16));
    const below=innerHeight-r.bottom, h=Math.min(380, Math.max(below, r.top)-12);
    p.style.width=w+"px"; p.style.left=Math.max(8,Math.min(r.right-w,innerWidth-w-8))+"px";
    if(below>=240 || below>=r.top){ p.style.top=(r.bottom+4)+"px"; p.style.bottom=""; } else { p.style.bottom=(innerHeight-r.top+4)+"px"; p.style.top=""; }
    list.style.maxHeight=Math.max(120,h-56)+"px";
  };
  place(); p._place=place;
  const on=list.querySelector(".ss-opt.on"); if(on) on.scrollIntoView({block:"nearest"});
  q.focus({preventScroll:true});
  addEventListener("pointerdown",ssOutside,true);
}
addEventListener("scroll",e=>{            // follow the button while the page scrolls; close only when it leaves the screen
  if(!ssPanel || ssPanel.contains(e.target)) return;
  const r=ssPanel._btn.getBoundingClientRect(); if(r.bottom<0 || r.top>innerHeight) closeSS(); else ssPanel._place();
},true);
addEventListener("resize",closeSS);
["#tkPpl","#tkLoc","#tkEq","#tfPpl","#tfLoc"].forEach(id=>enhanceSelect($(id)));

/* ================= boot ================= */
load(); loadTasks(); setNow(); renderAll(); renderTasks(); renderDash(); show(REFRESH_VIEW||"Dash");
setTimeout(weeklyCheck,1500);
if(DEEP_OPEN) goList({stat:OPEN_ANY});
