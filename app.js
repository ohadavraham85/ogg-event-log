"use strict";
const $ = s => document.querySelector(s);

/* ================= seed lists (from the real plant log) ================= */
const SEED = {
  type:["תקלה","אחזקה חודשית","גלישות חרום","אחזקה","אחזקה מונעת","אחזקה שנתית","הפסקות חשמל",
        "תהליך","הודעת יומן","ביקור","נפילות/קפיצות חשמל","סיור בטיחות חודשי","כללי"],
  loc:["קדם טיפול","צינור OVERFLOW","מט\"ש כללי","עבודות קבלן","בריכה B1","בריכה B2","בית מלאכה",
       "חדר חשמל ראשי ECB","חדר חשמל EB1","חדר חשמל EB2","חדר חשמל מתח גבוה EB6","משרדים","מגובים",
       "חממות","מאגר בוצה","סילוק בוצה","גנרטור","מעבדה","מחסן חשמל","שער כניסה","אחר"],
  eq:["גנרטור 670KVA","מגוב גס A151","מגוב גס A152","מגוב עדין A101","מגוב עדין A102","משאבת סולר",
      "דוגם אוטומטי קולחים","משאבת גרוסת A204","מיכל השקטה","דחסן חלזוני","ציוד כיבוי אש","מערבל",
      "מאוורר","מדחס אוויר","שנאי","לוח חשמל ראשי"],
  ppl:["יוסי לוי","אבי בצלאל","אוהד אברהם","אלדד אפרים","אלעד ניסים","אביב עובדיה","נעם גייגר",
       "מחמוד דראושה","שגיא קוריס","קבלן"],
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
const LS="ogg-log-v2", LSL="ogg-lists-v2";
let events=[], lists=null, editId=null, fileHandle=null;
const sel = {type:[], loc:[], eq:[], ppl:[], stat:["פתוח"]};

function load(){
  try{ events = JSON.parse(localStorage.getItem(LS)||"[]"); }catch(e){ events=[]; }
  let saved={}; try{ saved = JSON.parse(localStorage.getItem(LSL)||"{}"); }catch(e){}
  lists = {};
  Object.keys(SEED).forEach(k=>{
    const custom = Array.isArray(saved[k]) ? saved[k] : [];
    const hidden = Array.isArray(saved["_hide_"+k]) ? saved["_hide_"+k] : [];
    lists[k] = [...new Set(SEED[k].concat(custom))].filter(v=>!hidden.includes(v));
    lists["_custom_"+k] = custom; lists["_hide_"+k] = hidden;
  });
}
function persist(){
  try{
    localStorage.setItem(LS, JSON.stringify(events));
    const out={}; Object.keys(SEED).forEach(k=>{ out[k]=lists["_custom_"+k]; out["_hide_"+k]=lists["_hide_"+k]; });
    localStorage.setItem(LSL, JSON.stringify(out));
  }catch(e){ toast("הדפדפן חסם שמירה מקומית"); }
  writeFile();
}
function toast(m){
  const t=$("#toast"); t.firstElementChild.textContent=m; t.classList.add("on");
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("on"),2200);
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
    if(fs && ((e.stat||[])[0]||"פתוח")!==fs) return false;
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
      : "<b>היומן ריק</b>הרישום הראשון מתחיל בלשונית רישום.";
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
    const d=document.createElement("article"); d.className="ev";
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
    info.onclick=()=>{ det.hidden=!det.hidden; info.textContent=det.hidden?"פרטים":"סגור פרטים"; };
    acts.appendChild(info);
    if(isLocked(e)){
      const lk=document.createElement("span"); lk.className="lock";
      lk.textContent="🔒 ארכיון · " + (e.src||"");
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
  const fill=(id,vals,keep)=>{
    const s=$(id); if(!s) return;
    const cur=s.value; s.textContent="";
    const o=document.createElement("option"); o.value=""; o.textContent=keep; s.appendChild(o);
    vals.forEach(v=>{ const x=document.createElement("option"); x.value=v; x.textContent=v; s.appendChild(x); });
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
  fill("#fStat",uniq("stat"),"כל הסטטוסים");
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
function renderAll(){ paintRows(); renderFilters(); renderList(); renderStats(); renderMgr(); }
$("#q").oninput=renderList; $("#fType").onchange=renderList; $("#fLoc").onchange=renderList;

/* ================= tabs / theme ================= */
function show(w){
  ["New","List","Data"].forEach(v=>{
    $("#view"+v).hidden=(v!==w);
    $("#tab"+v).setAttribute("aria-selected",String(v===w));
  });
  $("#savebar").style.display = w==="New"?"block":"none";
  document.querySelector(".wrap").style.paddingBottom = w==="New"?"130px":"40px";
}
$("#tabNew").onclick=()=>show("New");
$("#tabList").onclick=()=>{ renderFilters(); renderList(); show("List"); };
$("#tabData").onclick=()=>{ renderStats(); renderMgr(); show("Data"); };
$("#themeBtn").onclick=()=>{
  const cur=document.documentElement.getAttribute("data-theme");
  const next=cur==="dark"?"light":cur==="light"?"":"dark";
  if(next) document.documentElement.setAttribute("data-theme",next);
  else document.documentElement.removeAttribute("data-theme");
  try{ localStorage.setItem("ogg-theme",next); }catch(e){}
};
try{ const th=localStorage.getItem("ogg-theme"); if(th) document.documentElement.setAttribute("data-theme",th); }catch(e){}

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
    await writeFile(); toast("הקובץ חובר");
  }catch(e){}
};
$("#saveNow").onclick=async()=>{ if(!fileHandle){ toast("חבר קובץ קודם"); return; } await writeFile(); toast("נשמר לקובץ"); };
function download(name,text,mime){
  const blob=new Blob([mime.indexOf("csv")>=0?"\uFEFF"+text:text],{type:mime});
  const url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
$("#expJson").onclick=()=>{ download("יומן-אירועים-אוג.json",JSON.stringify(payload(),null,1),"application/json"); toast("הגיבוי הורד"); };
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
      persist(); renderAll(); toast(n+" נוספו, "+u+" עודכנו");
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
const APP_VER="1.8", APP_DATE="24/09/2026";
$("#reloadApp").onclick=()=>{ location.reload(true); };
/* ================= boot ================= */
load(); setNow(); renderAll(); show("New");
