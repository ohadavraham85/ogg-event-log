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
}
function persist(){
  try{
    localStorage.setItem(LS, JSON.stringify(events));
    const out={}; Object.keys(SEED).forEach(k=>{ out[k]=lists["_custom_"+k]; out["_hide_"+k]=lists["_hide_"+k]; });
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
  $("#shTitle").textContent = META[k].title + (META[k].multi? " — אפשר לבחור כמה" : "");
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
  const items = lists[k].slice().sort((a,b)=>(cnt[b]||0)-(cnt[a]||0));
  const hits = items.filter(v=>!q || v.includes(q));
  if(!hits.length){
    const d=document.createElement("div"); d.className="empty"; d.style.margin="10px";
    d.innerHTML="<b>אין התאמה</b>אפשר להוסיף את הערך למטה.";
    box.appendChild(d); return;
  }
  hits.forEach(v=>{
    const on = sel[k].includes(v);
    const b=document.createElement("button");
    b.type="button"; b.className="opt"; b.setAttribute("aria-pressed", on?"true":"false");
    const bx=document.createElement("span"); bx.className="bx"; bx.textContent="✓";
    const tx=document.createElement("span"); tx.textContent=v;
    b.append(bx,tx);
    if(custom.includes(v) && !cnt[v]){
      const d=document.createElement("button"); d.className="del"; d.textContent="✕"; d.title="הסר מהרשימה";
      d.onclick = ev=>{ ev.stopPropagation(); removeValue(k,v); };
      b.appendChild(d);
    } else if(cnt[v]){
      const u=document.createElement("span"); u.className="use"; u.textContent=cnt[v]; b.appendChild(u);
    }
    b.onclick = ()=>{
      if(META[k].multi){
        const i=sel[k].indexOf(v);
        if(i>=0) sel[k].splice(i,1); else sel[k].push(v);
        drawOpts(); paintRows();
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
$("#shAdd").onclick = ()=>{ addValue(shKey, $("#shNew").value); $("#shNew").value=""; };
$("#shNew").onkeydown = e=>{ if(e.key==="Enter"){ e.preventDefault(); $("#shAdd").click(); } };
$("#shDone").onclick = closeSheet;
$("#shClose").onclick = closeSheet;
$("#scrim").onclick = closeSheet;
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && shKey) closeSheet(); });

/* ================= list manager ================= */
function renderMgr(){
  const box=$("#listMgr"); box.textContent="";
  Object.keys(SEED).forEach(k=>{
    const h=document.createElement("div");
    h.style.cssText="font-weight:700;font-size:13px;color:var(--ink-3);margin:14px 0 4px";
    h.textContent = META[k].title + " (" + lists[k].length + ")";
    box.appendChild(h);
    const r=document.createElement("div"); r.className="row"; r.style.margin="0 0 8px";
    const inp=document.createElement("input"); inp.className="txt"; inp.style.flex="1";
    inp.placeholder="ערך חדש";
    const add=document.createElement("button"); add.className="btn"; add.textContent="הוסף";
    const go=()=>{ if(!inp.value.trim()) return; const k2=k;
      if(!lists[k2].includes(inp.value.trim())){ lists["_custom_"+k2].push(inp.value.trim());
        const hi=lists["_hide_"+k2].indexOf(inp.value.trim()); if(hi>=0) lists["_hide_"+k2].splice(hi,1);
        lists[k2].push(inp.value.trim()); }
      inp.value=""; persist(); renderMgr(); toast("נוסף לרשימה"); };
    add.onclick=go; inp.onkeydown=e=>{ if(e.key==="Enter"){e.preventDefault();go();} };
    r.append(inp,add); box.appendChild(r);

    const cnt=useCount(k);
    lists[k].forEach(v=>{
      const row=document.createElement("div"); row.className="listrow";
      const b=document.createElement("b"); b.textContent=v;
      const s=document.createElement("span"); s.textContent = cnt[v] ? cnt[v]+" רישומים" : "";
      row.append(b,s);
      if(!cnt[v]){
        const x=document.createElement("button"); x.className="btn";
        x.style.cssText="padding:5px 11px;font-size:13px"; x.textContent="הסר";
        x.onclick=()=>{ lists["_custom_"+k].includes(v) ? removeValue(k,v) : hideSeed(k,v); };
        row.appendChild(x);
      } else {
        const l=document.createElement("span"); l.className="inuse"; l.textContent="בשימוש";
        row.appendChild(l);
      }
      box.appendChild(row);
    });
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
    put("מקור", e.src||"רישום ידני");
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
    } else {
    const ed=document.createElement("button"); ed.textContent="עריכה"; ed.onclick=()=>loadInto(e);
    const rm=document.createElement("button"); rm.textContent="מחיקה";
    rm.onclick=()=>{ events=events.filter(x=>x.id!==e.id); persist(); renderAll(); toast("האירוע נמחק"); };
    acts.append(ed,rm);
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
function renderAll(){ paintRows(); renderFilters(); renderList(); renderStats(); renderMgr(); if(!$("#viewDash").hidden) renderDash(); updateBadge(); paintNewCount(); }
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
function renderDash(){
  document.querySelectorAll("#dRange button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.r===dRange)));
  const from = dRange==="all" ? "" : ymd(daysAgo(+dRange-1));
  const today = ymd(daysAgo(0));
  // person filter: options = everyone who appears in events, most frequent first
  const pc={}; events.forEach(e=>(e.ppl||[]).forEach(v=>{ pc[v]=(pc[v]||0)+1; }));
  const people=Object.keys(pc).sort((a,b)=>pc[b]-pc[a]);
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
if(navigator.serviceWorker) navigator.serviceWorker.addEventListener("message",ev=>{ if(ev.data && ev.data.type==="show-new") showNew(); });

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
  ["New","List","Dash","Data"].forEach(v=>{
    $("#view"+v).hidden=(v!==w);
    $("#tab"+v).setAttribute("aria-selected",String(v===w));
  });
  $("#savebar").style.display = w==="New"?"block":"none";
  document.querySelector(".wrap").style.paddingBottom = w==="New"?"130px":"40px";
}
$("#tabNew").onclick=()=>show("New");
$("#tabList").onclick=()=>{ renderFilters(); renderList(); show("List"); };
$("#tabDash").onclick=()=>{ renderDash(); show("Dash"); };
$("#tabData").onclick=()=>{ renderStats(); renderMgr(); show("Data"); };
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
  const out={app:"ogg-event-log",version:2,saved:new Date().toISOString(),events,lists:{}};
  Object.keys(SEED).forEach(k=>{ out.lists[k]=lists["_custom_"+k]; out.lists["_hide_"+k]=lists["_hide_"+k]; });
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
    "גיבוי מלא של היומן ("+events.length+" אירועים).\nמצורף הקובץ: "+f.name+"\n\nלשחזור: באפליקציה ← רשימות וקובץ ← טען גיבוי.");
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
      if(d.lists) Object.keys(SEED).forEach(k=>{
        (d.lists[k]||[]).forEach(v=>{ if(!lists["_custom_"+k].includes(v)){ lists["_custom_"+k].push(v);
          if(!lists[k].includes(v)) lists[k].push(v); } });
      });
      events.sort((a,b)=>(b.when||"").localeCompare(a.when||""));
      persist(); load(); renderAll(); toast(n+" נוספו, "+u+" עודכנו");
    }catch(e){ toast("הקובץ לא בפורמט הנכון"); }
  };
  r.readAsText(f); ev.target.value="";
};
$("#wipe").onclick=()=>{
  const mine=events.filter(e=>!isLocked(e)).length, arch=events.length-mine;
  if(!mine){ toast("אין רישומים שלך למחיקה"); return; }
  if(!confirm("למחוק "+mine+" רישומים שלך? "+arch+" אירועי ארכיון יישארו.")) return;
  events=events.filter(e=>isLocked(e)); persist(); renderAll(); toast(mine+" רישומים נמחקו");
};
$("#wipeAll").onclick=()=>{
  if(!confirm("למחוק את כל "+events.length+" האירועים, כולל הארכיון?")) return;
  events=[]; persist(); renderAll(); toast("היומן רוקן");
};

/* ================= version ================= */
const APP_VER="1.36", APP_DATE="28/09/2026";
$("#verChip").textContent="v"+APP_VER;
$("#verLine").textContent="גרסה "+APP_VER+" · "+APP_DATE;
async function refreshApp(){
  const cur=["Dash","New","List","Data"].find(v=>!$("#view"+v).hidden)||"Dash";
  try{ sessionStorage.setItem("ogg-refresh",cur); }catch(e){}
  try{ const r=navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if(r) await r.update(); }catch(e){}
  location.reload();
}
$("#reloadApp").onclick=refreshApp;
$("#refreshBtn").onclick=()=>{ $("#refreshBtn").classList.add("spin"); refreshApp(); };

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
if(!["Dash","New","List","Data"].includes(REFRESH_VIEW)) REFRESH_VIEW=null;
// app-icon shortcuts open a screen directly (?view=New|Dash|List|Data|open)
let DEEP_OPEN=false;
(function(){
  const u=new URL(location.href), v=u.searchParams.get("view");
  if(!v) return;
  if(v==="open"){ DEEP_OPEN=true; if(!REFRESH_VIEW) REFRESH_VIEW="List"; }
  else if(["Dash","New","List","Data"].includes(v) && !REFRESH_VIEW) REFRESH_VIEW=v;
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
    setTimeout(()=>{ sp.hidden=true; weeklyCheck(); },200);
    $("#tabDash").focus({preventScroll:true});
  };
  $("#spEnter").onclick=enter;
  window.splashEnter=enter;
  if(REFRESH_VIEW){ sp.hidden=true; return; }   // came from the refresh button: skip the opening screen
  document.documentElement.classList.add("sp-open");
})();
/* ================= boot ================= */
load(); setNow(); renderAll(); renderDash(); show(REFRESH_VIEW||"Dash");
setTimeout(weeklyCheck,1500);
if(DEEP_OPEN) goList({stat:OPEN_ANY});
