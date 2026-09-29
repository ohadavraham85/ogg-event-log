"use strict";
/* ================= team log (Firebase) =================
   Runs only when firebase-config.js sets window.FIREBASE_CONFIG; otherwise the app stays local.
   - Events: Firestore collection "events", one document per event (id = event id).
     Every write carries _upd (server time) and _by (writer's e-mail). Deletes are soft (_del:true).
   - Lists (added / hidden values): document meta/lists.
   - Access: e-mail link sign-in; only the owner (in the security rules) and e-mails in "members".
   - Sync: each device downloads everything once, then only documents changed since its last sync
     (query _upd > last), so daily use costs very few reads. localStorage keeps the working copy;
     Firestore's persistent cache keeps unsent writes across reloads while offline. */
(function(){
  if(!CLOUD_ON) return;
  const K_SYNC_T="ogg-cloud-tsync", K_SYNC="ogg-cloud-sync", K_MAIL="ogg-cloud-mail", K_ROLE="ogg-cloud-role";
  // invitation link (?invite=<mail>): pre-fills the sign-in mail, then leaves the address bar clean
  let INVITE="";
  try{ const u=new URL(location.href); INVITE=(u.searchParams.get("invite")||"").trim().toLowerCase();
    if(INVITE){ u.searchParams.delete("invite"); history.replaceState(null,"",u.pathname+u.search+u.hash); } }catch(e){}
  const get=k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const put=(k,v)=>{ try{ v==null? localStorage.removeItem(k) : localStorage.setItem(k,v); }catch(e){} };
  const mk=(tag,cls,text)=>{ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; };

  /* ---------- UI shells (login inside the opening screen, sync chip, team card) ---------- */
  const sp=$("#splash"), actions=$("#splash .sp-actions");
  const login=mk("div","sp-login"); login.hidden=true; actions.after(login);
  const chip=mk("span","sync-chip","☁"); chip.title="יומן משותף"; $("#verChip").before(chip);
  let state="init";                       // init | out | sent | in | noaccess
  function setChip(kind,title){ chip.dataset.s=kind; chip.title=title; chip.textContent = kind==="pending" ? "☁ ⏳" : kind==="off" ? "☁ ✕" : "☁"; }

  function showSplash(){ sp.hidden=false; sp.classList.remove("out"); document.documentElement.classList.add("sp-open"); }
  function renderLogin(){
    login.textContent=""; const enterBtn=$("#spEnter");
    enterBtn.hidden = state!=="in";
    login.hidden = state==="in" || state==="init";
    sp.classList.toggle("sp-auth", state!=="in");      // compact opening screen while the login form shows
    if(state==="init"){ enterBtn.hidden=true; login.hidden=false; login.appendChild(mk("p","sp-msg","מתחבר…")); return; }
    if(state==="out"){
      login.appendChild(mk("p","sp-msg","כניסה ליומן המשותף: הקלד את המייל שלך ונשלח אליו קישור כניסה."));
      const inp=mk("input","sp-input"); inp.type="email"; inp.placeholder="המייל שלך"; inp.value=INVITE||get(K_MAIL)||""; inp.autocomplete="email"; inp.dir="ltr";
      const b=mk("button","sp-btn","שלח קישור כניסה"); b.type="button";
      const go=async()=>{
        const email=inp.value.trim().toLowerCase();
        if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ inp.focus(); toast("מייל לא תקין"); return; }
        b.disabled=true; b.textContent="שולח…";
        try{
          await F.sendSignInLinkToEmail(auth, email, {url: location.origin+location.pathname, handleCodeInApp:true});
          put(K_MAIL,email); state="sent"; renderLogin();
        }catch(e){ b.disabled=false; b.textContent="שלח קישור כניסה"; toast("שליחה נכשלה — בדוק חיבור לרשת ונסה שוב"); }
      };
      b.onclick=go; inp.onkeydown=e=>{ if(e.key==="Enter") go(); };
      login.append(inp,b);
    }
    if(state==="sent"){
      login.appendChild(mk("p","sp-msg","שלחנו קישור כניסה אל "+(get(K_MAIL)||"")+". פתח את המייל ולחץ על הקישור."));
      login.appendChild(mk("p","sp-msg sp-small","אם הקישור נפתח בדפדפן אחר (למשל באייפון), העתק אותו והדבק כאן:"));
      const inp=mk("input","sp-input"); inp.placeholder="הדבק כאן את הקישור מהמייל"; inp.dir="ltr";
      const b=mk("button","sp-btn","כניסה"); b.type="button"; b.onclick=()=>finishLink(inp.value.trim());
      const again=mk("button","sp-link","שלח שוב / מייל אחר"); again.type="button"; again.onclick=()=>{ state="out"; renderLogin(); };
      login.append(inp,b,again);
    }
    if(state==="noaccess"){
      login.appendChild(mk("p","sp-msg","המייל "+((auth.currentUser&&auth.currentUser.email)||"")+" עדיין לא ברשימת הצוות. בקש ממנהל היומן להוסיף אותך, ואז לחץ \"נסה שוב\"."));
      const again=mk("button","sp-btn","נסה שוב"); again.type="button"; again.onclick=()=>afterSignIn(auth.currentUser);
      const out=mk("button","sp-link","התנתק"); out.type="button"; out.onclick=logout;
      login.append(again,out);
    }
  }

  /* ---------- Firebase ---------- */
  let F, app, auth, db, me=null, role=null, unsubEv=null, unsubLists=null, unsubMembers=null;
  let tSynced={}, unsubTasks=null, tFresh=false, tInit=false;   // tFresh: this device never synced tasks
  let synced={}, listsSynced="", pending=0, started=false, initialDone=false;

  function loadSdk(){
    return new Promise((res,rej)=>{ if(window.FB) return res();
      const s=document.createElement("script"); s.src="vendor/firebase.js?v="+APP_VER; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
  }
  async function finishLink(link){
    if(!link || !F.isSignInWithEmailLink(auth,link)){ toast("זה לא קישור כניסה תקין"); return; }
    let email=get(K_MAIL);
    if(!email) email=(prompt("לאיזה מייל נשלח הקישור?")||"").trim().toLowerCase();
    if(!email) return;
    state="init"; renderLogin();
    try{ await F.signInWithEmailLink(auth,email,link); put(K_MAIL,email); }
    catch(e){ state="out"; renderLogin(); toast("הקישור לא תקף או שכבר נוצל — שלח קישור חדש"); }
  }

  async function checkAccess(email){
    try{ await F.getDoc(F.doc(db,"meta","lists")); }
    catch(e){
      if(e && e.code==="permission-denied") return null;
      return get(K_ROLE) || null;            // offline: trust the role this device had last time
    }
    try{
      const m=await F.getDoc(F.doc(db,"members",email));
      if(m.exists()) return m.data().role==="admin" ? "admin" : "member";
      // not listed but allowed to read -> the owner from the rules: register as admin
      await F.setDoc(F.doc(db,"members",email),{role:"admin",added:F.serverTimestamp(),by:email});
      return "admin";
    }catch(e){ return "member"; }
  }

  async function afterSignIn(user){
    if(!user){ me=null; stopSync(); state="out"; showSplash(); renderLogin(); setChip("off","לא מחובר"); return; }
    me=(user.email||"").toLowerCase();
    state="init"; renderLogin();
    role=await checkAccess(me);
    if(!role){ stopSync(); state="noaccess"; showSplash(); renderLogin(); setChip("off","אין הרשאה"); return; }
    put(K_ROLE,role); state="in"; renderLogin();
    startSync(); renderAccount();
    if(typeof paintSettings==="function") paintSettings();       // members don't get the admin-only settings
    if(sp.hidden===false && location.search.includes("oobCode")) {}   // stay on the opening screen until "כניסה"
  }

  /* ---------- sync ---------- */
  const clean=d=>{ const e={}; for(const k in d) if(k[0]!=="_") e[k]=d[k]; return e; };
  const plain=o=>JSON.parse(JSON.stringify(o));          // drops undefined (Firestore rejects it)
  function startSync(){
    if(started) return; started=true;
    synced={}; events.forEach(e=>{ synced[e.id]=JSON.stringify(e); });
    listsSynced=listsJSON();
    const since=Math.max(0,(+get(K_SYNC)||0)-5*60*1000);   // small overlap is harmless
    const q=F.query(F.collection(db,"events"), F.where("_upd",">",F.Timestamp.fromMillis(since)));
    unsubEv=F.onSnapshot(q,{includeMetadataChanges:true}, applyEvents, err=>{ setChip("off","שגיאת סנכרון: "+(err.code||err.message)); });
    unsubLists=F.onSnapshot(F.doc(db,"meta","lists"), applyLists, ()=>{});
    watchMembers();                                        // everyone: names for "assigned to me"
    selfName=""; loadSelfName();                           // "אני:" picked by this user (any device)
    if(typeof paintHello==="function") paintHello();
    // tasks: one document each in "meta" (task-<id>) — the rules already allow team members there
    tSynced={}; tasks.forEach(t=>{ tSynced[t.id]=JSON.stringify(t); });
    tFresh=!(+get(K_SYNC_T)); tInit=false;
    const tSince=Math.max(0,(+get(K_SYNC_T)||0)-5*60*1000);
    unsubTasks=F.onSnapshot(F.query(F.collection(db,"meta"), F.where("_upd",">",F.Timestamp.fromMillis(tSince))), applyTasks, ()=>{});
    cloudPush(); cloudPushTasks();                         // anything changed while signed out / offline
  }
  function stopSync(){
    initialDone=false;
    members=[]; window.TEAM_NAMES=[];
    [unsubEv,unsubLists,unsubMembers,unsubTasks].forEach(u=>{ if(u) u(); }); unsubEv=unsubLists=unsubMembers=unsubTasks=null; started=false;
  }
  function applyEvents(snap){
    const ch=snap.docChanges();
    if(ch.length){
      const idx=new Map(events.map((e,i)=>[e.id,i]));
      let maxU=+get(K_SYNC)||0, changed=false;
      const firstEver=!maxU, fresh=[];          // first full download on this device is not "news"
      ch.forEach(c=>{
        if(c.type==="removed") return;
        const d=c.doc.data({serverTimestamps:"estimate"}), id=c.doc.id;
        if(!c.doc.metadata.hasPendingWrites && d._upd && d._upd.toMillis) maxU=Math.max(maxU,d._upd.toMillis());
        if(d._del){
          if(idx.has(id)){ events.splice(idx.get(id),1); idx.clear(); events.forEach((e,i)=>idx.set(e.id,i)); changed=true; }
          delete synced[id]; return;
        }
        const e=clean(d), js=JSON.stringify(e);
        if(synced[id]===js && idx.has(id)) return;         // our own write coming back
        if(idx.has(id)) events[idx.get(id)]=e;
        else { idx.set(id,events.length); events.push(e); if(!firstEver && d._by && d._by!==me) fresh.push({e,by:d._by}); }
        synced[id]=js; changed=true;
      });
      put(K_SYNC,String(maxU));
      if(changed){
        events.sort((a,b)=>(b.when||"").localeCompare(a.when||""));
        try{ localStorage.setItem(LS, JSON.stringify(events)); }catch(e){}
        rebuildLists(); renderAll();
      }
      if(fresh.length) announce(fresh);
    }
    // first answer from the server (not the local cache): now we know what the cloud really has
    if(!initialDone && !snap.metadata.fromCache){ initialDone=true; renderAccount(); window.CLOUD_READY=true; if(window.weeklyCheck) setTimeout(window.weeklyCheck,1000); }
    syncChip(snap.metadata);
  }
  function applyTasks(snap){
    // the first server answer on a brand-new device is the initial download, not news
    let maxU=+get(K_SYNC_T)||0, changed=false; const firstEver=tFresh && !tInit, fresh=[], assigned=[], news=[]; let mergedLog=false;
    snap.docChanges().forEach(c=>{
      const id=c.doc.id; if(c.type==="removed" || id.indexOf("task-")!==0) return;
      const d=c.doc.data({serverTimestamps:"estimate"}), tid=id.slice(5);
      if(!c.doc.metadata.hasPendingWrites && d._upd && d._upd.toMillis) maxU=Math.max(maxU,d._upd.toMillis());
      const i=tasks.findIndex(t=>t.id===tid);
      if(d._del){ if(i>=0){ tasks.splice(i,1); changed=true; } delete tSynced[tid]; return; }
      const t=clean(d), js=JSON.stringify(t);
      if(tSynced[tid]===js && i>=0) return;                // our own write coming back
      const mine=window.cloudMyName(), was=i>=0 ? tasks[i] : null;
      // assigned to me by name, or to my department (a change that newly includes me)
      const mineT=x=>window.taskIsMine ? window.taskIsMine(x) : (x.ppl||[]).includes(mine);
      if(!firstEver && mine && d._by && d._by!==me && t.status!=="הושלמה" && mineT(t) && !(was && mineT(was))) assigned.push(t);
      // messages list: anything someone else did to a task of mine (or that stopped being mine)
      if(!firstEver && mine && d._by && d._by!==me && (mineT(t) || (was && mineT(was))))
        news.push(...taskNews(was, t, whoOf(d._by), mineT(t), !!was && mineT(was), d._upd && d._upd.toMillis ? d._upd.toMillis() : Date.now()));
      // update log: keep entries this device has that the incoming copy lacks (two people updating at once)
      if(was && Array.isArray(was.log) && was.log.length){
        const have=new Set((t.log||[]).map(l=>l.id)), extra=was.log.filter(l=>l && !have.has(l.id));
        if(extra.length){ t.log=(t.log||[]).concat(extra).sort((x,y)=>String(x.at).localeCompare(String(y.at))); mergedLog=true; }
      }
      if(i>=0) tasks[i]=t; else { tasks.push(t); if(!firstEver && d._by && d._by!==me) fresh.push(t); }
      tSynced[tid]=js; changed=true;
    });
    put(K_SYNC_T,String(maxU));
    if(!snap.metadata.fromCache) tInit=true;
    if(changed){ try{ localStorage.setItem("ogg-cloud-tasks", JSON.stringify(tasks)); }catch(e){} renderTasks(); }
    if(mergedLog) setTimeout(cloudPushTasks,0);           // send the merged log back
    const openMine=()=>{ if(typeof showMyTasks==="function") showMyTasks(); };
    if(assigned.length){
      const title = assigned.length===1 ? "הוקצתה לך משימה" : "הוקצו לך "+assigned.length+" משימות";
      const body = assigned.map(t=>(t.prio&&t.prio!=="רגילה"&&t.prio!=="נמוכה" ? t.prio+" · " : t.urgent?"דחופה · ":"")+(t.title||"")+(t.due?" · יעד "+t.due.slice(8,10)+"/"+t.due.slice(5,7):"")).join("\n");
      toast(title+": "+(assigned[0].title||""), {label:"הצג", fn:openMine});
      notifyDevice(title, body, "ogg-task", openMine);
      if(typeof addMineUnseen==="function") addMineUnseen(assigned.map(t=>t.id));
    } else if(fresh.length) toast(fresh.length===1 ? "משימה חדשה: "+(fresh[0].title||"") : fresh.length+" משימות חדשות",
      {label:"הצג", fn:()=>{ $("#tabTasks").click(); }});
    if(news.length && typeof inboxAdd==="function") inboxAdd(news, !!assigned.length);
  }
  const whoOf=mail=>{ const m=members.find(x=>x.email===mail); return (m && m.name) || String(mail||"").split("@")[0]; };
  // what changed in one task, as messages for its assignee: new assignment, update-log entries, edited details
  function taskNews(was, t, who, mineNow, mineWas, upd){
    const out=[], base={tid:t.id, title:t.title||"", by:who}, dm=v=>v ? v.slice(8,10)+"/"+v.slice(5,7) : "—";
    if(!mineNow){ out.push({...base, id:t.id+":off:"+upd, kind:"off", text:"המשימה כבר לא משויכת אליך"}); return out; }
    if(!mineWas){
      if(t.status!=="הושלמה") out.push({...base, id:t.id+":as:"+upd, kind:"assign",
        text:"הוקצתה לך משימה"+(t.prio && t.prio!=="רגילה" ? " · "+t.prio : "")+(t.due ? " · יעד "+dm(t.due) : "")});
      return out;
    }
    const had=new Set((was.log||[]).map(l=>l && l.id));
    (t.log||[]).filter(l=>l && !had.has(l.id)).forEach(l=>out.push({...base, id:t.id+":"+l.id, kind:l.sys ? "status" : "update",
      text:l.text||"", by:l.by||who, at:l.at}));
    const ch=[], same=(a,b)=>JSON.stringify(a||"")===JSON.stringify(b||"");
    if(!same(t.title,was.title)) ch.push("כותרת");
    if(!same(t.due,was.due)) ch.push("יעד "+dm(t.due));
    if(!same(t.start,was.start)) ch.push("התחלה "+dm(t.start));
    if(!same(t.prio,was.prio)) ch.push("עדיפות "+(t.prio||"רגילה"));
    if(!same(t.desc,was.desc)) ch.push("תיאור");
    if(!same(t.loc,was.loc)) ch.push("מיקום");
    if(!same(t.eq,was.eq)) ch.push("ציוד");
    if(!same(t.ppl,was.ppl) || !same(t.depts,was.depts)) ch.push("שיוך: "+(t.ppl||[]).concat((t.depts||[]).map(x=>"🏢 "+x)).join(", "));
    if(ch.length) out.push({...base, id:t.id+":ed:"+upd, kind:"edit", text:"עודכנו פרטים: "+ch.join(" · ")});
    if(!out.length && t.status!==was.status) out.push({...base, id:t.id+":st:"+upd, kind:"status", text:"סטטוס: "+(t.status||"")});
    return out;
  }
  function cloudPushTasks(){
    if(!started || !me) return;
    const cur={}; tasks.forEach(t=>{ cur[t.id]=JSON.stringify(t); });
    const writes=[];
    for(const id in cur) if(tSynced[id]!==cur[id]) writes.push({id, data:Object.assign(plain(JSON.parse(cur[id])),{_del:false})});
    for(const id in tSynced) if(!(id in cur)) writes.push({id, data:{id, _del:true}});
    if(!writes.length) return;
    for(let i=0;i<writes.length;i+=400){
      const b=F.writeBatch(db);
      writes.slice(i,i+400).forEach(w=>{
        b.set(F.doc(db,"meta","task-"+w.id), Object.assign(w.data,{_upd:F.serverTimestamp(),_by:me}), {merge: !!w.data._del});
      });
      b.commit().catch(err=>toast("שמירת משימה ליומן המשותף נכשלה: "+(err.code||"")));
    }
    writes.forEach(w=>{ if(w.data._del) delete tSynced[w.id]; else tSynced[w.id]=cur[w.id]; });
  }
  window.cloudPushTasks=cloudPushTasks;

  /* new events recorded by someone else: tab counter, "חדש" marker, toast, and a device notification
     when the app is in the background (needs the user's permission; not when the app is closed) */
  function announce(fresh){
    fresh.forEach(f=>UNSEEN.add(f.e.id)); saveUnseen(); renderList(false);
    const who=m=>(m||"").split("@")[0];
    const one=fresh[0].e, what=[(one.type||[])[0],(one.loc||[])[0]].filter(Boolean).join(" · ");
    const title = fresh.length===1 ? "אירוע חדש ביומן" : fresh.length+" אירועים חדשים ביומן";
    const body  = fresh.length===1 ? [what, (one.title||one.desc||"").slice(0,90), "נרשם ע\"י "+who(fresh[0].by)].filter(Boolean).join("\n")
                                   : "נרשמו ע\"י "+[...new Set(fresh.map(f=>who(f.by)))].join(", ");
    toast(fresh.length===1 ? "אירוע חדש"+(what?" · "+what:"")+" · "+who(fresh[0].by) : title, {label:"הצג", fn:showNew});
    if(document.hidden && "Notification" in window && Notification.permission==="granted"){
      const opt={body, tag:"ogg-new", renotify:true, icon:"icons/icon-notebook-192.png", lang:"he", dir:"rtl"};
      (navigator.serviceWorker ? navigator.serviceWorker.ready.then(r=>r.showNotification(title,opt)) : Promise.reject())
        .catch(()=>{ try{ const n=new Notification(title,opt); n.onclick=()=>{ window.focus(); showNew(); n.close(); }; }catch(e){} });
    }
  }
  function listsJSON(){ const o={}; Object.keys(SEED).forEach(k=>{ o[k]=lists["_custom_"+k]; o["_hide_"+k]=lists["_hide_"+k]; }); o._core_ppl=lists._core_ppl||[]; o._roles_ppl=lists._roles_ppl||{}; o._dept_ppl=lists._dept_ppl||{}; return JSON.stringify(o); }
  function rebuildLists(){
    Object.keys(SEED).forEach(k=>{
      const custom=lists["_custom_"+k]||[], hidden=lists["_hide_"+k]||[];
      const used=events.flatMap(e=>Array.isArray(e[k])?e[k]:[]);
      lists[k]=[...new Set(SEED[k].concat(custom,used))].filter(v=>!hidden.includes(v));
    });
  }
  function applyLists(snap){
    if(!snap.exists()) return;
    const js=snap.data().data; if(!js || js===listsSynced) return;
    let o; try{ o=JSON.parse(js); }catch(e){ return; }
    Object.keys(SEED).forEach(k=>{
      lists["_custom_"+k]=Array.isArray(o[k])?o[k]:[]; lists["_hide_"+k]=Array.isArray(o["_hide_"+k])?o["_hide_"+k]:[];
    });
    lists._core_ppl=Array.isArray(o._core_ppl)?o._core_ppl:[];
    lists._roles_ppl=o._roles_ppl && typeof o._roles_ppl==="object" ? o._roles_ppl : {};
    lists._dept_ppl=o._dept_ppl && typeof o._dept_ppl==="object" ? o._dept_ppl : {};
    listsSynced=js; try{ localStorage.setItem(LSL, js); }catch(e){}
    rebuildLists(); renderAll();
  }
  function syncChip(meta){
    if(!navigator.onLine) return setChip("off","לא מקוון — השינויים יישלחו כשהרשת תחזור");
    if(pending>0 || (meta && meta.hasPendingWrites)) return setChip("pending","שולח שינויים…");
    setChip("ok","יומן משותף · מסונכרן"+(me?" · "+me:""));
  }
  addEventListener("online",()=>syncChip()); addEventListener("offline",()=>syncChip());

  /* push whatever differs from what the cloud has (called after every local save) */
  function cloudPush(){
    if(!started || !me) return;
    const cur={}; events.forEach(e=>{ cur[e.id]=JSON.stringify(e); });
    const writes=[];
    for(const id in cur) if(synced[id]!==cur[id]) writes.push({id, data:Object.assign(plain(JSON.parse(cur[id])),{_del:false})});
    for(const id in synced) if(!(id in cur)) writes.push({id, data:{id, _del:true}});
    const lj=listsJSON(), listsChanged = lj!==listsSynced;
    if(!writes.length && !listsChanged) return;
    for(let i=0;i<writes.length;i+=400){
      const b=F.writeBatch(db);
      writes.slice(i,i+400).forEach(w=>{
        b.set(F.doc(db,"events",w.id), Object.assign(w.data,{_upd:F.serverTimestamp(),_by:me}), {merge: !!w.data._del});
      });
      pending++; syncChip();
      b.commit().then(()=>{ pending--; syncChip(); }, err=>{ pending--; setChip("off","שמירה לענן נכשלה: "+(err.code||err.message)); });
    }
    writes.forEach(w=>{ if(w.data._del) delete synced[w.id]; else synced[w.id]=cur[w.id]; });
    if(listsChanged){
      listsSynced=lj;
      F.setDoc(F.doc(db,"meta","lists"),{data:lj,_upd:F.serverTimestamp(),_by:me}).catch(()=>{});
    }
  }
  window.cloudPush=cloudPush;

  /* ---------- account, team management, upload of the local log ---------- */
  const card=mk("div","card"); card.id="cloudCard"; card.dataset.sg="team";
  $("#viewData").insertBefore(card, $("#viewData").children[1]||null);
  function renderAccount(){
    card.textContent="";
    card.appendChild(mk("h3",null,"יומן משותף"));
    card.appendChild(mk("p",null,"מחובר כ-"+me+(role==="admin"?" · מנהל":"")+". כל רישום נשמר ביומן המשותף ומגיע לכל הצוות."));
    const nm=mk("p","hint cloud-myname"); nm.id="cloudMyName"; card.appendChild(nm); paintMyName();
    const row=mk("div","row"); const out=mk("button","btn","התנתק"); out.type="button"; out.onclick=logout; row.appendChild(out); card.appendChild(row);

    // device notifications for new events (while the app is open or in the background)
    const nt=mk("div","cloud-notif");
    if(!("Notification" in window)){
      nt.appendChild(mk("p","hint","התראות במכשיר לא נתמכות בדפדפן הזה. באייפון — רק כשהאפליקציה מותקנת במסך הבית."));
    } else if(Notification.permission==="granted"){
      nt.appendChild(mk("p","hint","🔔 התראות במכשיר פעילות: כשמישהו רושם אירוע חדש תופיע התראה, גם כשהאפליקציה ברקע."));
    } else if(Notification.permission==="denied"){
      nt.appendChild(mk("p","hint","התראות חסומות בדפדפן. כדי להפעיל: הגדרות האתר בדפדפן ← התראות ← אפשר."));
    } else {
      nt.appendChild(mk("p","hint","קבל התראה במכשיר כשמישהו בצוות רושם אירוע חדש."));
      const nb=mk("button","btn","הפעל התראות"); nb.type="button";
      nb.onclick=async()=>{ try{ await Notification.requestPermission(); }catch(e){} renderAccount(); };
      nt.appendChild(nb);
    }
    card.appendChild(nt);

    // local-only log on this device (from before the team log) -> admin can upload it once
    let local=[]; try{ local=JSON.parse(get("ogg-log-v2")||"[]"); }catch(e){}
    const missingNow=()=>{ const have=new Set(events.map(e=>e.id)); return local.filter(e=>e && e.id && !have.has(e.id)); };
    const missing=missingNow();
    // only after the full download, so an old local copy can never overwrite newer team data
    if(role==="admin" && initialDone && missing.length){
      const up=mk("div","cloud-up");
      up.appendChild(mk("p",null,"במכשיר הזה יש "+missing.length.toLocaleString("he-IL")+" אירועים מהיומן המקומי שעדיין לא ביומן המשותף."));
      const b=mk("button","btn primary","העלה אותם ליומן המשותף"); b.type="button";
      b.onclick=()=>{
        const add=missingNow();                        // re-check: only events the team log does not have
        if(!add.length){ renderAccount(); return; }
        if(!confirm("להעלות "+add.length+" אירועים ליומן המשותף? כל הצוות יראה אותם.")) return;
        events=events.concat(add); events.sort((a,b)=>(b.when||"").localeCompare(a.when||""));
        let ll={}; try{ ll=JSON.parse(get("ogg-lists-v2")||"{}"); }catch(e){}
        Object.keys(SEED).forEach(k=>{ (ll[k]||[]).forEach(v=>{ if(!lists["_custom_"+k].includes(v)) lists["_custom_"+k].push(v); }); });
        rebuildLists(); persist(); renderAll(); renderAccount(); toast(add.length+" אירועים הועלו");
      };
      up.appendChild(b); card.appendChild(up);
    }
    if(role==="admin"){
      card.appendChild(mk("h3","cloud-h","צוות"));
      card.appendChild(mk("p",null,"רק המיילים ברשימה יכולים להיכנס, לראות ולרשום."));
      const add=mk("div","row cloud-add"); const inp=mk("input","txt"); inp.type="email"; inp.placeholder="מייל של איש צוות"; inp.dir="ltr"; inp.style.flex="1";
      const nameIn=mk("input","txt"); nameIn.placeholder="שם (כמו ברשימת המעורבים)"; nameIn.setAttribute("list","dlPpl"); nameIn.style.flex="1";
      const sel=mk("select","dsel"); [["member","איש צוות"],["admin","מנהל"]].forEach(([v,l])=>{ const o=mk("option",null,l); o.value=v; sel.appendChild(o); });
      const b=mk("button","btn","הוסף"); b.type="button";
      b.onclick=async()=>{
        const em=inp.value.trim().toLowerCase(); if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ toast("מייל לא תקין"); return; }
        const name=nameIn.value.trim();
        try{ await F.setDoc(F.doc(db,"members",em),{role:sel.value,added:F.serverTimestamp(),by:me,...(name?{name}:{})}); inp.value=""; nameIn.value=""; toast("נוסף לצוות — שלח לו הזמנה"); showInvite(em); }
        catch(e){ toast("ההוספה נכשלה"); }
      };
      card.appendChild(mk("p","hint","השם מחבר את איש הצוות למשימות: משימה שהאחראי בה הוא השם הזה תופיע אצלו ב\"שלי\" ויקבל עליה התראה."));
      add.append(inp,nameIn,sel,b); card.appendChild(add);
      const inv=mk("div","cloud-invite"); inv.id="cloudInvite"; inv.hidden=true; card.appendChild(inv);
      const list=mk("div","cloud-members"); list.id="cloudMembers"; card.appendChild(list);
      paintMembers();
    }
  }
  let members=[];
  function watchMembers(){
    if(unsubMembers) return;
    unsubMembers=F.onSnapshot(F.collection(db,"members"), s=>{
      members=s.docs.map(d=>({email:d.id,...d.data()})).sort((a,b)=>(a.name||a.email).localeCompare(b.name||b.email));
      window.TEAM_NAMES=members.map(m=>m.name).filter(Boolean);
      paintMembers(); paintMyName(); if(typeof renderTasks==="function") renderTasks();
    }, ()=>{});
  }
  window.cloudMe=()=>me||"";
  /* who am I in the lists: the name the admin gave me in the team list, else the one I picked myself
     ("אני:" in tasks — saved in meta/me-<mail>, so it follows me to every device) */
  let selfName="";
  const K_SELF=()=>"ogg-cloud-me-"+(me||"");
  window.cloudMyName=()=>{ const m=members.find(x=>x.email===me); if(m && m.name) return m.name;
    if(!selfName){ try{ selfName=localStorage.getItem(K_SELF())||""; }catch(e){} } return selfName; };
  window.cloudNameFromAdmin=()=>{ const m=members.find(x=>x.email===me); return !!(m && m.name); };
  window.cloudSetMyName=async name=>{
    selfName=name||""; try{ localStorage.setItem(K_SELF(),selfName); }catch(e){}
    try{ await F.setDoc(F.doc(db,"meta","me-"+me),{name:selfName,_upd:F.serverTimestamp(),_by:me}); }catch(e){ toast("השמירה בענן נכשלה — נשמר במכשיר"); }
    if(typeof renderTasks==="function") renderTasks();
  };
  async function loadSelfName(){
    try{ const s=await F.getDoc(F.doc(db,"meta","me-"+me)); if(s.exists() && s.data().name){ selfName=s.data().name; try{ localStorage.setItem(K_SELF(),selfName); }catch(e){} if(typeof renderTasks==="function") renderTasks(); } }catch(e){}
  }
  function paintMyName(){
    const el=$("#cloudMyName"); if(!el) return;
    const n=window.cloudMyName();
    el.textContent = n ? "השם שלך ביומן: "+n+" — משימות שהאחראי בהן \""+n+"\" מופיעות אצלך ב\"שלי\"."
                       : (role==="admin" ? "עדיין לא הוגדר לך שם — לחץ \"שם\" ליד המייל שלך ברשימת הצוות, כדי לקבל משימות והתראות."
                                          : "מנהל היומן עדיין לא הגדיר את השם שלך — בלי שם לא תקבל התראה על משימות שהוקצו לך.");
  }
  function paintMembers(){
    const box=$("#cloudMembers"); if(!box) return; box.textContent="";
    members.forEach(m=>{
      const r=mk("div","listrow"), who=mk("div","cm-who");
      who.appendChild(mk("b",null,m.name||"(בלי שם)")); who.appendChild(mk("span","cm-mail",m.email));
      r.appendChild(who); r.appendChild(mk("span",null,m.role==="admin"?"מנהל":"איש צוות"));
      const nb=mk("button","btn mini","שם"); nb.type="button";
      nb.onclick=async()=>{
        const v=prompt("השם של "+m.email+" ביומן (כמו שמופיע ברשימת המעורבים):", m.name||""); if(v===null) return;
        try{ await F.setDoc(F.doc(db,"members",m.email),{name:v.trim()},{merge:true}); toast("השם נשמר"); }catch(e){ toast("השמירה נכשלה"); }
      };
      r.appendChild(nb);
      if(m.email!==me){
        const iv=mk("button","btn mini","הזמן"); iv.type="button"; iv.onclick=()=>showInvite(m.email); r.appendChild(iv);
        const x=mk("button","btn mini","הסר"); x.type="button";
        x.onclick=async()=>{ if(!await confirmDel("להסיר מהצוות?", (m.name?m.name+" · ":"")+m.email+"\nלא יוכל יותר להיכנס ליומן.")) return; try{ await F.deleteDoc(F.doc(db,"members",m.email)); }catch(e){ toast("ההסרה נכשלה"); } };
        r.appendChild(x);
      }
      box.appendChild(r);
    });
  }
  /* invitation: a ready message with the app link (their mail pre-filled) and how to sign in —
     sent by WhatsApp, mail, the share sheet, or copied. Adding to the team is what grants access. */
  function inviteText(em){
    const title=(document.querySelector(".bar .mark")||{}).textContent||"יומן אירועים";
    const url=location.origin+location.pathname+"?invite="+encodeURIComponent(em);
    return { url, subject:"הזמנה ל"+title.trim().replace(/\s+/g," "),
      text:"הוזמנת ל"+title.trim().replace(/\s+/g," ")+" — היומן המשותף של הצוות.\n\n"+
        "1. פותחים את הקישור: "+url+"\n"+
        "2. לוחצים \"שלח קישור כניסה\" (המייל "+em+" כבר ממולא).\n"+
        "3. פותחים את המייל שמגיע ולוחצים על הקישור — וזהו, נכנסים ליומן.\n\n"+
        "כדאי להתקין כאפליקציה: בתפריט הדפדפן ← \"הוסף למסך הבית\"." };
  }
  function showInvite(em){
    const box=$("#cloudInvite"); if(!box) return;
    const T=inviteText(em); box.textContent=""; box.hidden=false;
    const head=mk("div","ci-head"); head.appendChild(mk("b",null,"הזמנה ל-"+em));
    const x=mk("button","x","✕"); x.type="button"; x.setAttribute("aria-label","סגור"); x.onclick=()=>{ box.hidden=true; };
    head.appendChild(x); box.appendChild(head);
    // the link alone (to paste in the address bar) — separate from the full message
    const lk=mk("a","ci-link",T.url); lk.href=T.url; lk.target="_blank"; lk.rel="noopener"; lk.dir="ltr"; box.appendChild(lk);
    box.appendChild(mk("div","ci-text",T.text));
    const row=mk("div","row");
    const btn=(label,fn,cls)=>{ const b=mk("button","btn"+(cls?" "+cls:""),label); b.type="button"; b.onclick=fn; row.appendChild(b); };
    btn("וואטסאפ",()=>window.open("https://wa.me/?text="+encodeURIComponent(T.text),"_blank","noopener"),"primary");
    btn("מייל",()=>{ location.href="mailto:"+em+"?subject="+encodeURIComponent(T.subject)+"&body="+encodeURIComponent(T.text); });
    if(navigator.share) btn("שתף",async()=>{ try{ await navigator.share({title:T.subject,text:T.text}); }catch(e){} });
    btn("העתק קישור",async()=>{ try{ await navigator.clipboard.writeText(T.url); toast("הקישור הועתק — להדבקה בשורת הכתובת"); }catch(e){ toast("ההעתקה נכשלה"); } });
    btn("העתק הודעה",async()=>{ try{ await navigator.clipboard.writeText(T.text); toast("הודעת ההזמנה הועתקה — להדבקה בוואטסאפ/מייל"); }catch(e){ toast("ההעתקה נכשלה"); } });
    box.appendChild(row);
    box.scrollIntoView({block:"nearest",behavior:"smooth"});
  }
  /* device notification (when the app is in the background and the user allowed it) */
  function notifyDevice(title, body, tag, onClick){
    if(!(document.hidden && "Notification" in window && Notification.permission==="granted")) return;
    const opt={body, tag, renotify:true, icon:"icons/icon-notebook-192.png", lang:"he", dir:"rtl"};
    (navigator.serviceWorker ? navigator.serviceWorker.ready.then(r=>r.showNotification(title,opt)) : Promise.reject())
      .catch(()=>{ try{ const n=new Notification(title,opt); n.onclick=()=>{ window.focus(); onClick(); n.close(); }; }catch(e){} });
  }
  async function logout(){
    if(!confirm("להתנתק? העותק של היומן המשותף יימחק מהמכשיר הזה (הוא נשאר בענן).")) return;
    stopSync();
    try{ await F.signOut(auth); }catch(e){}
    ["ogg-cloud-log","ogg-cloud-lists","ogg-cloud-tasks",K_SYNC,K_SYNC_T,K_ROLE].forEach(k=>put(k,null));
    try{ await F.terminate(db); await F.clearIndexedDbPersistence(db); }catch(e){}
    location.reload();
  }

  // shared log: wiping "my records" / "everything" would delete for the whole team -> not offered here
  ["#wipe","#wipeAll"].forEach(id=>{ const b=$(id); if(b){ const c=b.closest(".card"); if(c){ c.hidden=true; c.dataset.off="1"; } } });

  /* ---------- the opening screen is the gate ---------- */
  $("#spEnter").onclick=()=>{ if(state==="in" && window.splashEnter) window.splashEnter(); };
  if(sp.hidden) showSplash();              // refresh button skipped the splash; keep it until access is confirmed
  state="init"; renderLogin(); setChip("off","מתחבר…");

  loadSdk().then(async()=>{
    F=window.FB;
    app=F.initializeApp(window.FIREBASE_CONFIG);
    auth=F.initializeAuth(app,{persistence:[F.indexedDBLocalPersistence,F.browserLocalPersistence]});
    // FIREBASE_DATABASE: a separate (named) Firestore database, so the log can live in a project that
    // already has another app, without touching that app's data or security rules
    db=F.initializeFirestore(app,{localCache:F.persistentLocalCache({tabManager:F.persistentMultipleTabManager()})},
                             window.FIREBASE_DATABASE||undefined);
    if(window.FIREBASE_EMULATOR){
      F.connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});
      F.connectFirestoreEmulator(db,"127.0.0.1",8080);
    }
    if(F.isSignInWithEmailLink(auth,location.href)){
      const link=location.href; history.replaceState(null,"",location.pathname);
      await finishLink(link);
    }
    let first=true;
    F.onAuthStateChanged(auth, async user=>{
      await afterSignIn(user);
      if(first && user && state==="in" && REFRESH_VIEW){ sp.hidden=true; document.documentElement.classList.remove("sp-open"); }
      first=false;
    });
  }).catch(()=>{ state="out"; renderLogin(); toast("לא הצלחתי לטעון את רכיב היומן המשותף"); });
})();
