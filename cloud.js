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
      if(m.exists()){ const r=m.data().role; return r==="admin" ? "admin" : r==="viewer" ? "viewer" : "member"; }
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
    if(get(K_PUSH)) pushRegister(false);                   // push on this device: keep its token current
    if(typeof paintSettings==="function") paintSettings();       // members don't get the admin-only settings
    if(typeof renderAll==="function"){ renderAll(); renderTasks(); }  // delete buttons only for a manager
    if(sp.hidden===false && location.search.includes("oobCode")) {}   // stay on the opening screen until "כניסה"
  }

  /* ---------- sync ---------- */
  const clean=d=>{ const e={}; for(const k in d) if(k[0]!=="_") e[k]=d[k]; return e; };
  const plain=o=>JSON.parse(JSON.stringify(o));          // drops undefined (Firestore rejects it)
  /* start the team sync — after whatever was kept in IndexedDB is loaded. Safety: a device with no events (or no tasks)
     but a "synced up to here" mark downloads everything again (a save that failed must not hide the log) */
  function startSync(){
    if(started) return; started=true;
    Promise.resolve(window.bigReady).catch(()=>{}).then(()=>{
      if(!events.length && +get(K_SYNC)) put(K_SYNC,null);
      if(!tasks.length && +get(K_SYNC_T)) put(K_SYNC_T,null);
      startSync0();
    });
  }
  function startSync0(){
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
    unsubTasks=F.onSnapshot(F.query(F.collection(db,"meta"), F.where("_upd",">",F.Timestamp.fromMillis(tSince))), {includeMetadataChanges:true}, applyTasks, ()=>{});   // metadata too: know when the server answered even if nothing changed
    cloudPush(); cloudPushTasks();                         // anything changed while signed out / offline
    // presence: who is here now / when last seen — presence/<mail>, refreshed every few minutes while the app is open.
    // Only managers read it (the rules allow nobody else), so only they see who is connected.
    if(role==="admin"){
      unsubSeen=F.onSnapshot(F.collection(db,"presence"), snap=>{
        snap.docs.forEach(d=>{ const x=d.data({serverTimestamps:"estimate"}); if(x.email && x.at && x.at.toMillis) seen[x.email]=Math.max(seen[x.email]||0, x.at.toMillis()); });
        paintMembers(); if(window.paintTeamStrip) window.paintTeamStrip();
      }, ()=>{});
      // the old place (meta/seen-<mail>) could be read by everyone: take what is there, then clear it
      const once=F.onSnapshot(F.query(F.collection(db,"meta"), F.where("kind","==","seen")), snap=>{
        snap.docs.forEach(d=>{ const x=d.data(); if(x.email && x.at && x.at.toMillis) seen[x.email]=Math.max(seen[x.email]||0, x.at.toMillis()); F.deleteDoc(d.ref).catch(()=>{}); });
        paintMembers(); if(window.paintTeamStrip) window.paintTeamStrip(); setTimeout(()=>once(),0);
      }, ()=>{});
    }
    beat(); watchFeedback(); watchMine(); watchBoard(); watchBriefs();
  }
  /* morning briefings (🗒️): briefs/<date> — managers only (the rules let nobody else read or write them).
     The briefing travels as one JSON string (attendance, rows, signature); the newer copy wins (app.js briefsApply). */
  let unsubBriefs=null;
  function watchBriefs(){
    if(unsubBriefs || get(K_ROLE)!=="admin") return;
    unsubBriefs=F.onSnapshot(F.collection(db,"briefs"), snap=>{
      const items=[]; snap.docs.forEach(d=>{ try{ const b=JSON.parse(d.data().data||"null"); if(b && b.id===d.id) items.push(b); }catch(e){} });
      const gone=snap.docChanges().filter(c=>c.type==="removed").map(c=>c.doc.id);          // deleted, or moved to another date
      if(window.briefsApply) window.briefsApply(items, gone);
    }, ()=>{});
  }
  window.cloudBriefDel=async id=>{ if(!started || !me || get(K_ROLE)!=="admin") return false; try{ await F.deleteDoc(F.doc(db,"briefs",id)); return true; }catch(e){ return false; } };
  window.cloudBriefPut=async b=>{ if(!started || !me || get(K_ROLE)!=="admin") return false;
    try{ await F.setDoc(F.doc(db,"briefs",b.id),{data:JSON.stringify(b),date:b.id,done:!!b.done,_upd:F.serverTimestamp(),_by:me}); return true; }catch(e){ return false; } };
  /* notice board (📌): board/<id> — the whole team and the office screen read it, managers post and remove */
  let unsubBoard=null;
  function watchBoard(){
    if(unsubBoard) return;
    unsubBoard=F.onSnapshot(F.collection(db,"board"), snap=>{
      const rel=snap.docs.find(d=>d.id==="_release");               // "🚀 פרסם לכולם" — its progress
      if(rel && window.relApply) window.relApply(rel.data({serverTimestamps:"estimate"}));
      const scr=snap.docs.find(d=>d.id==="_screen");                 // the office screen settings live here too
      if(scr && window.tvCfgApply){ try{ window.tvCfgApply(JSON.parse(scr.data().cfg||"{}")); }catch(e){} }
      const items=snap.docs.filter(d=>d.id!=="_screen" && d.id!=="_release").map(d=>{ const x=d.data(); return {id:d.id, text:String(x.text||""), until:String(x.until||""), important:!!x.important, by:String(x.by||""), at:String(x.at||"")}; });
      if(window.boardApply) window.boardApply(items);
    }, ()=>{});
  }
  window.cloudScreenPut=async cfg=>{ if(!started || !me) return false;
    try{ await F.setDoc(F.doc(db,"board","_screen"),{cfg:JSON.stringify(cfg),text:"",_upd:F.serverTimestamp(),_by:me}); return true; }catch(e){ return false; } };
  /* recycle bin: deleted documents stay in the cloud marked _del — list the ones deleted since <since>, or bring one back */
  window.cloudBinList=async since=>{ if(!started || !me) return [];
    const out=[], ms=d=>d._upd && d._upd.toMillis ? d._upd.toMillis() : 0;
    const ev=await F.getDocs(F.query(F.collection(db,"events"), F.where("_del","==",true)));
    ev.docs.forEach(s=>{ const d=s.data(); if(ms(d)>=since && (d.desc || d.title)) out.push({k:"e", id:s.id, item:clean(d), at:ms(d), by:whoOf(d._by)}); });
    const tk=await F.getDocs(F.query(F.collection(db,"meta"), F.where("_del","==",true)));
    tk.docs.forEach(s=>{ if(s.id.indexOf("task-")!==0) return; const d=s.data(); if(ms(d)>=since && d.title) out.push({k:"t", id:s.id.slice(5), item:clean(d), at:ms(d), by:whoOf(d._by)}); });
    return out; };
  window.cloudRestore=async (k,id)=>{ if(!started || !me) return false;
    try{ await F.setDoc(k==="e" ? F.doc(db,"events",id) : F.doc(db,"meta","task-"+id), {id, _del:false, _upd:F.serverTimestamp(), _by:me}, {merge:true}); return true; }catch(e){ return false; } };
  window.cloudRelease=async ver=>{ if(!started || !me) return false;
    try{ await F.setDoc(F.doc(db,"board","_release"),{state:"requested",ver,text:"",_upd:F.serverTimestamp(),_by:me}); return true; }catch(e){ return false; } };
  window.cloudBoardPut=async it=>{ if(!started || !me) return false;
    try{ await F.setDoc(F.doc(db,"board",it.id),{text:it.text,until:it.until||"",important:!!it.important,by:it.by||"",at:it.at||"",_upd:F.serverTimestamp(),_by:me}); return true; }catch(e){ return false; } };
  window.cloudBoardDel=async id=>{ if(!started || !me) return false; try{ await F.deleteDoc(F.doc(db,"board",id)); return true; }catch(e){ return false; } };
  /* personal area (my own to-dos): one private document per person, private/<mail> — the rules let only its owner read or
     write it (not even a manager), so it follows me to my other devices and nobody else sees it */
  let unsubMine=null, minePushT=null; window.cloudMineState="";
  function watchMine(){
    if(unsubMine || !me) return;
    unsubMine=F.onSnapshot(F.doc(db,"private",me), s=>{
      window.cloudMineState="ok";
      let items=[]; try{ items=s.exists() ? JSON.parse(s.data().items||"[]") : []; }catch(e){}
      if(window.meApply) window.meApply(items);
    }, ()=>{ window.cloudMineState="denied"; if(window.paintMe2) window.paintMe2(); });
  }
  window.cloudPushMine=items=>{ if(!started || !me) return; clearTimeout(minePushT);
    minePushT=setTimeout(async()=>{ try{ await F.setDoc(F.doc(db,"private",me),{items:JSON.stringify(items),_upd:F.serverTimestamp(),_by:me}); window.cloudMineState="ok"; }
      catch(e){ window.cloudMineState="denied"; } if(window.paintMe2) window.paintMe2(); },700); };
  /* feedback (💬): one document each in its own collection "feedback" (feedback/<id>), which only managers can read —
     the screenshot can show anything that was on the sender's screen. Older ones were kept in meta/fb-<id>, where every
     team member could read them; a manager's device moves them over (copy, then delete) when it sees them. */
  const okImg=v=>typeof v==="string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : "";
  window.cloudSendFeedback=async rec=>{ if(!started || !me) return false;
    try{ await F.setDoc(F.doc(db,"feedback",rec.id), Object.assign({kind:"fb", mail:me, handled:false}, rec, {_upd:F.serverTimestamp(), _by:me})); return true; }catch(e){ return false; } };
  let fbList=[], fbNew=[], fbOld=[], unsubFb=null, unsubFbOld=null;
  function fbMerge(){
    fbList=fbNew.concat(fbOld).sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")));
    const open_=fbList.filter(f=>!f.handled && f.mail!==me);
    if(open_.length && typeof inboxAdd==="function")
      inboxAdd(open_.map(f=>({id:"fb:fb-"+f.docId.replace(/^fb-/,""), fb:f.docId, kind:"fb", title:"משוב מ"+(f.by || String(f.mail||"").split("@")[0]), text:f.text||"(סימון על צילום המסך)", by:f.by||"", at:f.at})), false);
    paintFeedback();
  }
  function watchFeedback(){
    if(unsubFb || get(K_ROLE)!=="admin") return;
    unsubFb=F.onSnapshot(F.collection(db,"feedback"), snap=>{ fbNew=snap.docs.map(d=>({docId:d.id, col:"feedback", ...d.data()})); fbMerge(); }, ()=>{});
    unsubFbOld=F.onSnapshot(F.query(F.collection(db,"meta"), F.where("kind","==","fb")), snap=>{
      fbOld=snap.docs.map(d=>({docId:d.id, col:"meta", ...d.data()})); fbMerge();
      snap.docs.forEach(async d=>{ const x=d.data(), id=d.id.replace(/^fb-/,"");          // move to the managers-only collection
        try{ await F.setDoc(F.doc(db,"feedback",id), Object.assign({}, x, {_upd:F.serverTimestamp(), _by:me, movedBy:me})); await F.deleteDoc(d.ref); }catch(e){} });
    }, ()=>{});
  }
  function fbShow(f){
    $("#imgView").src=okImg(f.img); $("#imgView").alt="צילום מסך";
    $("#imgName").textContent=(f.text?"“"+f.text+"” — ":"")+(f.by||f.mail||"")+" · "+(f.at?fmtWhen(f.at):"")+(f.view?" · "+f.view:"")+(f.ver?" · v"+f.ver:"")+(f.screen?" · "+f.screen:"");
    $("#imgDl").href=okImg(f.img) || "#"; $("#imgDl").download="משוב.jpg"; $("#dlgImg").showModal();
  }
  window.openFeedback=id=>{ const k=String(id||"").replace(/^fb-/,""), f=fbList.find(x=>x.docId.replace(/^fb-/,"")===k); if(f) fbShow(f); else toast("המשוב לא נמצא"); };
  function paintFeedback(){
    const box=$("#cloudFb"); if(!box) return; box.textContent="";
    const n=fbList.filter(f=>!f.handled).length;
    $("#cloudFbH").textContent="📣 משובים"+(fbList.length ? " ("+n+" פתוחים מתוך "+fbList.length+")" : "");
    if(!fbList.length){ box.appendChild(mk("p","hint","עדיין אין משובים. כל אחד בצוות יכול לשלוח משוב מהכפתור 💬 בפינה — עם צילום המסך.")); return; }
    fbList.forEach(f=>{
      const r=mk("div","fb-row"+(f.handled?" done":""));
      if(okImg(f.img)){ const im=mk("img"); im.src=okImg(f.img); im.alt="צילום מסך"; im.loading="lazy"; im.onclick=()=>fbShow(f); r.appendChild(im); }
      const body=mk("div","fb-b"); body.appendChild(mk("b",null,f.text||"(סימון על צילום המסך)"));
      body.appendChild(mk("span","fb-m",[f.by||String(f.mail||"").split("@")[0], f.at?fmtWhen(f.at):"", f.view, f.ver?"v"+f.ver:""].filter(Boolean).join(" · ")));
      const acts=mk("div","row");
      const op=mk("button","btn mini","פתח"); op.type="button"; op.onclick=()=>fbShow(f);
      const hd=mk("button","btn mini",f.handled?"החזר לפתוח":"✓ טופל"); hd.type="button";
      hd.onclick=async()=>{ try{ await F.setDoc(F.doc(db,f.col,f.docId),{handled:!f.handled,_upd:F.serverTimestamp(),_by:me},{merge:true}); }catch(e){ toast("השמירה נכשלה"); } };
      const cp=mk("button","btn mini","📋 העתק"); cp.type="button"; cp.title="מעתיק את המשוב עם צילום המסך — להדבקה בצ'אט לתיקון"; cp.onclick=()=>fbCopy(f,true);
      const ct=mk("button","btn mini","📝 טקסט"); ct.type="button"; ct.title="מעתיק רק את הטקסט"; ct.onclick=()=>fbCopy(f,false);
      const rp=mk("button","btn mini","↩ ענה"); rp.type="button";
      const rbox=mk("div","fb-reply"); rbox.hidden=true;
      const ta=mk("textarea"); ta.rows=2; ta.maxLength=500; ta.placeholder="התשובה תגיע לשולח (בהודעות 🔔)";
      const send=mk("button","btn mini primary","שלח"); send.type="button";
      send.onclick=async()=>{ const t=ta.value.trim(); if(!t){ ta.focus(); return; } send.disabled=true;
        const ok=await fbReply(f,t); send.disabled=false; if(ok){ ta.value=""; rbox.hidden=true; toast("התשובה נשלחה ל"+(f.by||f.mail)); } else toast("השליחה נכשלה"); };
      rbox.append(ta,send);
      rp.onclick=()=>{ rbox.hidden=!rbox.hidden; if(!rbox.hidden) ta.focus(); };
      const dl=mk("button","btn mini ghost","מחק"); dl.type="button";
      dl.onclick=async()=>{ if(!await confirmDel("למחוק את המשוב?", (f.text||"")+"\n"+(f.by||f.mail||""))) return; try{ await F.deleteDoc(F.doc(db,f.col,f.docId)); }catch(e){ toast("המחיקה נכשלה"); } };
      acts.append(op,cp,ct,rp,hd,dl); body.appendChild(acts);
      (Array.isArray(f.replies)?f.replies:[]).forEach(x=>body.appendChild(mk("div","fb-ans","↩ "+(x.by||"")+": "+(x.text||""))));
      body.appendChild(rbox); r.appendChild(body); box.appendChild(r);
    });
  }
  // copy a feedback to paste into a chat (the screenshot as a picture + the details as text)
  async function fbCopy(f, withImg){
    const txt="משוב מ"+(f.by||f.mail||"")+(f.at?" · "+fmtWhen(f.at):"")+(f.view?" · מסך: "+f.view:"")+(f.ver?" · גרסה "+f.ver:"")+(f.screen?" · "+f.screen:"")+"\n"+(f.text||"(סימון על צילום המסך)");
    try{
      const img=withImg && okImg(f.img);
      if(img && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write){
        const png=await new Promise(res=>{ const im=new Image(); im.onload=()=>{ const c=document.createElement("canvas"); c.width=im.naturalWidth; c.height=im.naturalHeight;
          c.getContext("2d").drawImage(im,0,0); c.toBlob(res,"image/png"); }; im.onerror=()=>res(null); im.src=img; });
        if(png){ await navigator.clipboard.write([new ClipboardItem({"text/plain":new Blob([txt],{type:"text/plain"}),"image/png":png})]);
          toast("הועתק — צילום המסך והטקסט. אם הודבקה רק התמונה: \"📝 טקסט\""); return; }
      }
      await navigator.clipboard.writeText(txt); toast("טקסט המשוב הועתק");
    }catch(e){ prompt("העתק את המשוב:",txt); }
  }
  // reply to a feedback: kept on the feedback, and sent to the sender — meta/me-<mail> (a manager may write it; its owner reads it)
  async function fbReply(f, text){
    if(!f.mail) return false;
    const r={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6), text:text.slice(0,500), by:window.cloudMyName()||me, at:typeof nowLocal==="function"?nowLocal():"", fbText:String(f.text||"").slice(0,120)};
    try{
      await F.setDoc(F.doc(db,f.col,f.docId),{replies:(Array.isArray(f.replies)?f.replies:[]).concat(r),_upd:F.serverTimestamp(),_by:me},{merge:true});
      const ref=F.doc(db,"meta","me-"+String(f.mail).toLowerCase()), s=await F.getDoc(ref);
      const cur=s.exists() && Array.isArray(s.data().fbReplies) ? s.data().fbReplies : [];
      await F.setDoc(ref,{fbReplies:cur.concat(r).slice(-20),_upd:F.serverTimestamp(),_by:me},{merge:true});
      return true;
    }catch(e){ return false; }
  }
  let unsubSeen=null, lastBeat=0; const seen={};
  window.teamSeen=()=>seen; window.teamMembers=()=>members; window.cloudIsAdmin=()=>role==="admin";
  function beat(force){
    if(!started || !me || document.hidden) return;
    if(!force && Date.now()-lastBeat<60e3) return; lastBeat=Date.now();
    F.setDoc(F.doc(db,"presence",me),{email:me,at:F.serverTimestamp(),_upd:F.serverTimestamp(),_by:me}).catch(()=>{});
  }
  setInterval(()=>beat(true), 5*60e3);
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) beat(); });
  setInterval(()=>{ paintMembers(); if(window.paintTeamStrip) window.paintTeamStrip(); }, 60e3);   // "לפני X דק׳" stays current
  function stopSync(){
    initialDone=false;
    members=[]; window.TEAM_NAMES=[];
    [unsubEv,unsubLists,unsubMembers,unsubTasks,unsubSeen,unsubFb,unsubFbOld,unsubMine,unsubBoard,unsubBriefs].forEach(u=>{ if(u) u(); }); unsubEv=unsubLists=unsubMembers=unsubTasks=unsubSeen=unsubFb=unsubFbOld=unsubMine=unsubBoard=unsubBriefs=null; started=false;
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
      if(changed){
        events.sort((a,b)=>(b.when||"").localeCompare(a.when||""));
        // move the "synced up to here" mark only once the log is really kept on this device
        window.saveBig(LS, JSON.stringify(events)).then(ok=>{ if(ok) put(K_SYNC,String(maxU)); else setChip("off","אין מקום לשמור את היומן במכשיר"); });
        rebuildLists(); renderAll();
      } else put(K_SYNC,String(maxU));
      if(fresh.length) announce(fresh);
    }
    // first answer from the server (not the local cache): now we know what the cloud really has
    if(!initialDone && !snap.metadata.fromCache){ initialDone=true; renderAccount(); window.CLOUD_READY=true; if(window.weeklyCheck) setTimeout(window.weeklyCheck,1000); if(window.secDaily) setTimeout(window.secDaily,8000);
      if(window.nosAfterSync) setTimeout(window.nosAfterSync,1500); }
    syncChip(snap.metadata);
  }
  /* which tasks send me a message when someone else changes them: mine / my department's, the ones I opened or wrote in —
     and for a manager (unless turned off in settings → כללי) every task of the team */
  function followsTask(x){
    if(!x) return false;
    if(get(K_ROLE)==="admin" && get("ogg-news-all")!=="0") return true;
    const mineT=window.taskIsMine ? window.taskIsMine(x) : (x.ppl||[]).includes(window.cloudMyName());
    return mineT || !!(window.openedByMe && window.openedByMe(x)) || (x.log||[]).some(l=>l && l.mail===me);
  }
  function applyTasks(snap){
    // the first server answer on a brand-new device is the initial download, not news
    let maxU=+get(K_SYNC_T)||0, changed=false; const firstEver=tFresh && !tInit, fresh=[], assigned=[], news=[]; let mergedLog=false;
    snap.docChanges().forEach(c=>{
      const id=c.doc.id;
      if(c.type!=="removed" && id==="me-"+me && !c.doc.metadata.hasPendingWrites && window.remApply){   // my reminders (another device, or the cloud sent one)
        const RM=c.doc.data().reminders; if(Array.isArray(RM)) window.remApply(RM); }
      if(c.type!=="removed" && id==="me-"+me && !firstEver){                 // a manager answered my feedback
        const R=c.doc.data().fbReplies;
        if(Array.isArray(R) && R.length && typeof inboxAdd==="function"){
          inboxAdd(R.map(x=>({id:"fbr:"+x.id, kind:"fb", reply:true, title:"תשובה למשוב שלך"+(x.fbText?": "+x.fbText.slice(0,40):""), text:x.text||"", by:x.by||"", at:x.at})), false);
          notifyDevice("תשובה למשוב שלך", R[R.length-1].text||"", "ogg-fbr", ()=>{ if(typeof openInbox==="function") openInbox(); }); }
      }
      if(c.type==="removed" || id.indexOf("task-")!==0) return;
      const d=c.doc.data({serverTimestamps:"estimate"}), tid=id.slice(5);
      if(!c.doc.metadata.hasPendingWrites && d._upd && d._upd.toMillis) maxU=Math.max(maxU,d._upd.toMillis());
      const i=tasks.findIndex(t=>t.id===tid);
      if(d._del){ if(i>=0){
          const w=tasks[i];                                  // a task I follow was deleted by someone else: tell me
          if(!firstEver && d._by && d._by!==me && followsTask(w)) news.push({tid:w.id, title:w.title||"", by:whoOf(d._by), id:w.id+":del:"+(d._upd && d._upd.toMillis ? d._upd.toMillis() : Date.now()), kind:"off", text:"המשימה נמחקה"});
          tasks.splice(i,1); changed=true; } delete tSynced[tid]; return; }
      const t=clean(d), js=JSON.stringify(t);
      if(tSynced[tid]===js && i>=0) return;                // our own write coming back
      const mine=window.cloudMyName(), was=i>=0 ? tasks[i] : null;
      // assigned to me by name, or to my department (a change that newly includes me)
      const mineT=x=>window.taskIsMine ? window.taskIsMine(x) : (x.ppl||[]).includes(mine);
      if(!firstEver && mine && d._by && d._by!==me && t.status!=="הושלמה" && mineT(t) && !(was && mineT(was))) assigned.push(t);
      // messages list: anything someone else did to a task of mine (or that stopped being mine),
      // or to a task I'm involved in — I opened it or wrote an update on it
      // a manager also follows tasks they opened or wrote in; a team member their own, their department's and the ones they opened
      const inv=x=>followsTask(x);
      if(!firstEver && d._by && d._by!==me && (inv(t) || inv(was)))
        news.push(...taskNews(was, t, whoOf(d._by), mineT(t), !!was && mineT(was), d._upd && d._upd.toMillis ? d._upd.toMillis() : Date.now()));
      // update log: keep entries this device has that the incoming copy lacks (two people updating at once)
      if(was && Array.isArray(was.log) && was.log.length){
        const have=new Set((t.log||[]).map(l=>l.id)), extra=was.log.filter(l=>l && !have.has(l.id));
        if(extra.length){ t.log=(t.log||[]).concat(extra).sort((x,y)=>String(x.at).localeCompare(String(y.at))); mergedLog=true; }
      }
      // files: keep ones added here meanwhile (two people attaching at once); a removed one stays removed
      if(was && Array.isArray(was.files) && was.files.length){
        const inc=new Map((t.files||[]).map(x=>[x.id,x])); let merged=false;
        was.files.forEach(x=>{ if(!x) return; const y=inc.get(x.id);
          if(!y){ inc.set(x.id,x); merged=true; } else if(x.del && !y.del){ inc.set(x.id,Object.assign({},y,{del:true})); merged=true; } });
        if(merged){ t.files=[...inc.values()]; mergedLog=true; }
      }
      // checklist: keep items added here meanwhile; a removed item (del) stays removed on every device
      if(was && Array.isArray(was.check) && was.check.length){
        const inc=new Map((t.check||[]).map(x=>[x.id,x])); let merged=false;
        was.check.forEach(x=>{ if(!x) return; const y=inc.get(x.id);
          if(!y){ inc.set(x.id,x); merged=true; } else if(x.del && !y.del){ inc.set(x.id,Object.assign({},y,{del:true})); merged=true; } });
        if(merged){ t.check=[...inc.values()]; mergedLog=true; }
      }
      if(i>=0) tasks[i]=t; else { tasks.push(t); if(!firstEver && d._by && d._by!==me && (!window.tkVisible || window.tkVisible(t))) fresh.push(t); }
      tSynced[tid]=js; changed=true;
    });
    const tMark=String(maxU);
    if(!snap.metadata.fromCache){ if(!tInit){ if(window.nosAfterSync) setTimeout(window.nosAfterSync,1800); if(window.filesRetry) setTimeout(window.filesRetry,4000); } tInit=true; window.TASKS_READY=true; }
    if(changed){ window.saveBig("ogg-cloud-tasks", JSON.stringify(tasks)).then(ok=>{ if(ok) put(K_SYNC_T,tMark); }); renderTasks(); }
    else put(K_SYNC_T,tMark);
    if(mergedLog) setTimeout(cloudPushTasks,0);           // send the merged log back
    const openMine=()=>{ if(typeof showMyTasks==="function") showMyTasks(); };
    if(assigned.length){
      const title = assigned.length===1 ? "הוקצתה לך משימה" : "הוקצו לך "+assigned.length+" משימות";
      const body = assigned.map(t=>(t.prio&&t.prio!=="רגילה"&&t.prio!=="נמוכה" ? t.prio+" · " : t.urgent?"דחופה · ":"")+(t.title||"")+(t.due?" · יעד "+t.due.slice(8,10)+"/"+t.due.slice(5,7):"")).join("\n");
      toast(title+": "+(assigned[0].title||""), {label:"הצג", fn:openMine});
      if(!pushOn()) notifyDevice(title, body, "ogg-task", openMine);   // with push on, the phone gets it from the server
      if(typeof addMineUnseen==="function") addMineUnseen(assigned.map(t=>t.id));
    } else if(fresh.length) toast(fresh.length===1 ? "משימה חדשה: "+(fresh[0].title||"") : fresh.length+" משימות חדשות",
      {label:"הצג", fn:()=>{ $("#tabTasks").click(); }});
    if(news.length && typeof inboxAdd==="function") inboxAdd(news, !!assigned.length);
  }
  const whoOf=mail=>{ const m=members.find(x=>x.email===mail); return (m && m.name) || String(mail||"").split("@")[0]; };
  // what changed in one task, as messages for its assignee: new assignment, update-log entries, edited details
  function taskNews(was, t, who, mineNow, mineWas, upd){
    const out=[], base={tid:t.id, title:t.title||"", by:who}, dm=v=>v ? v.slice(8,10)+"/"+v.slice(5,7) : "—";
    if(mineWas && !mineNow){ out.push({...base, id:t.id+":off:"+upd, kind:"off", text:"המשימה כבר לא משויכת אליך"}); return out; }
    if(mineNow && !mineWas){
      if(t.status!=="הושלמה") out.push({...base, id:t.id+":as:"+upd, kind:"assign",
        text:"הוקצתה לך משימה"+(t.prio && t.prio!=="רגילה" ? " · "+t.prio : "")+(t.due ? " · יעד "+dm(t.due) : "")});
      return out;
    }
    if(!was){                                            // a new task that isn't assigned to me (a manager following the whole team)
      out.push({...base, id:t.id+":new:"+upd, kind:"assign", text:"נפתחה משימה חדשה"+((t.ppl||[]).length?" · אחראי: "+t.ppl[0]:"")+((t.depts||[]).length?" · "+t.depts.map(x=>deptIcon(x)+" "+x).join(", "):"")+(t.due ? " · יעד "+dm(t.due) : "")});
      return out; }
    const had=new Set((was.log||[]).map(l=>l && l.id));
    (t.log||[]).filter(l=>l && !had.has(l.id) && l.mail!==me).forEach(l=>out.push({...base, id:t.id+":"+l.id, kind:l.sys ? "status" : "update",
      text:l.text||"", by:l.by||who, at:l.at}));
    const ch=[], same=(a,b)=>JSON.stringify(a||"")===JSON.stringify(b||"");
    if(!same(t.title,was.title)) ch.push("כותרת");
    if(!same(t.due,was.due)) ch.push("יעד "+dm(t.due));
    if(!same(t.start,was.start)) ch.push("התחלה "+dm(t.start));
    if(!same(t.prio,was.prio)) ch.push("עדיפות "+(t.prio||"רגילה"));
    if(!same(t.type,was.type)) ch.push("סוג "+(t.type||"—"));
    if(!same(t.desc,was.desc)) ch.push("תיאור");
    if(!same(t.loc,was.loc)) ch.push("מיקום");
    if(!same(t.eq,was.eq)) ch.push("ציוד");
    if(!same(t.rep,was.rep)) ch.push("מחזוריות");
    const items=x=>(x.check||[]).filter(c=>c && !c.del).map(c=>c.text);
    if(!same(items(t),items(was))) ch.push("רשימת בדיקה");
    if(!same(t.ppl,was.ppl) || !same(t.depts,was.depts)) ch.push("שיוך: "+(t.ppl||[]).concat((t.depts||[]).map(x=>deptIcon(x)+" "+x)).join(", "));
    if(ch.length) out.push({...base, id:t.id+":ed:"+upd, kind:"edit", text:"עודכנו פרטים: "+ch.join(" · ")});
    // files and photos added / removed
    const fl=x=>(x.files||[]).filter(f=>f && !f.del), wasF=new Set(fl(was).map(f=>f.id)), nowF=new Set(fl(t).map(f=>f.id));
    const addF=fl(t).filter(f=>!wasF.has(f.id)), rmF=fl(was).filter(f=>!nowF.has(f.id));
    if(addF.length) out.push({...base, id:t.id+":fa:"+upd, kind:"edit", text:(addF.length===1 ? (/^image\//.test(addF[0].type||"")?"📷 צורפה תמונה: ":"📎 צורף קובץ: ")+(addF[0].name||"") : "📎 צורפו "+addF.length+" קבצים")});
    if(rmF.length) out.push({...base, id:t.id+":fr:"+upd, kind:"edit", text:"הוסר קובץ: "+rmF.map(f=>f.name||"").join(", ")});
    if(!out.length && t.status!==was.status) out.push({...base, id:t.id+":st:"+upd, kind:"status", text:"סטטוס: "+(t.status||"")});
    return out;
  }
  /* files: one document per file in "files" (read/add: team members; remove: admins).
     If the security rules don't allow it yet, the file stays on this device and is sent later. */
  async function pushFile(id){
    try{ const rec=await window.fGet(id); if(!rec || rec.up) return;
      await F.setDoc(F.doc(db,"files",id),{data:rec.data,name:rec.name,type:rec.type,_upd:F.serverTimestamp(),_by:me});
      rec.up=true; await window.fPut(id,rec);
    }catch(e){ /* not allowed yet / offline — retried on the next start */ }
  }
  window.cloudPutFile=id=>{ if(started && me) pushFile(id); };
  window.cloudGetFile=async id=>{ if(!started || !me) return null;
    try{ const d=await F.getDoc(F.doc(db,"files",id)); if(!d.exists()) return null; const x=d.data(); return {data:x.data,name:x.name,type:x.type}; }catch(e){ return null; } };
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
      const opt={body, tag:"ogg-new", renotify:true, icon:"icons/icon-notebook-192.png", badge:"icons/badge-96.png", lang:"he", dir:"rtl"};
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
  $("#sgNav").after(card);                                   // under the topic buttons, like every other settings card
  function renderAccount(){
    card.textContent="";
    card.appendChild(mk("h3",null,"יומן משותף"));
    card.appendChild(mk("p",null,"מחובר כ-"+me+(role==="admin"?" · מנהל":"")+". כל רישום נשמר ביומן המשותף ומגיע לכל הצוות."));
    const nm=mk("p","hint cloud-myname"); nm.id="cloudMyName"; card.appendChild(nm); paintMyName();
    const row=mk("div","row"); const out=mk("button","btn","התנתק"); out.type="button"; out.onclick=logout; row.appendChild(out);
    // something missing on this device? download the whole shared log again (nothing in the cloud changes)
    const rs=mk("button","btn","סנכרון מלא מחדש"); rs.type="button"; rs.title="מוריד מחדש את כל האירועים והמשימות מהענן למכשיר הזה";
    rs.onclick=()=>{ if(!confirm("להוריד מחדש את כל היומן המשותף למכשיר הזה? (שום דבר בענן לא משתנה)")) return;
      put(K_SYNC,null); put(K_SYNC_T,null); location.reload(); };
    row.appendChild(rs); card.appendChild(row);

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
    // push to the phone (task messages also when the app is closed)
    const pb=mk("div","cloud-push"); card.appendChild(pb);
    pushSupported().then(ok=>{ if(ok && role!=="viewer") paintPush(pb); });

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
      const adm=mk("div","cm-admin"); card.appendChild(adm);   // team management — hidden in the phone view
      adm.appendChild(mk("h3","cloud-h","צוות"));
      adm.appendChild(mk("p",null,"רק המיילים ברשימה יכולים להיכנס, לראות ולרשום."));
      const add=mk("div","row cloud-add"); const inp=mk("input","txt"); inp.type="email"; inp.placeholder="מייל של איש צוות"; inp.dir="ltr"; inp.style.flex="1";
      const nameIn=mk("input","txt"); nameIn.placeholder="שם (כמו ברשימת המעורבים)"; nameIn.setAttribute("list","dlPpl"); nameIn.style.flex="1";
      const sel=mk("select","dsel"); [["member","איש צוות"],["admin","מנהל"],["viewer","צופה — מסך משרד"]].forEach(([v,l])=>{ const o=mk("option",null,l); o.value=v; sel.appendChild(o); });
      const b=mk("button","btn","הוסף"); b.type="button";
      b.onclick=async()=>{
        const em=inp.value.trim().toLowerCase(); if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ toast("מייל לא תקין"); return; }
        const name=nameIn.value.trim();
        try{ await F.setDoc(F.doc(db,"members",em),{role:sel.value,added:F.serverTimestamp(),by:me,...(name?{name}:{})}); inp.value=""; nameIn.value=""; toast("נוסף לצוות — שלח לו הזמנה"); showInvite(em); }
        catch(e){ toast("ההוספה נכשלה"); }
      };
      adm.appendChild(mk("p","hint","השם מחבר את איש הצוות למשימות: משימה שהאחראי בה הוא השם הזה תופיע אצלו ב\"שלי\" ויקבל עליה התראה."));
      add.append(inp,nameIn,sel,b); adm.appendChild(add);
      // several at once: one per line — "email", "email name", "name <email>" or "email, name" (from Excel / WhatsApp / a mail)
      const bulk=mk("details","cloud-bulk"); bulk.appendChild(mk("summary",null,"הוספת כמה אנשי צוות בבת אחת"));
      const ta=mk("textarea","txt"); ta.rows=6; ta.dir="auto";
      ta.placeholder="שורה לכל אחד — מייל ושם, למשל:\nyossi@example.com יוסי לוי\nדני כהן <dani@example.com>";
      const brow=mk("div","row"), bsel=mk("select","dsel");
      [["member","איש צוות"],["admin","מנהל"],["viewer","צופה — מסך משרד"]].forEach(([v,l])=>{ const o=mk("option",null,l); o.value=v; bsel.appendChild(o); });
      const bb=mk("button","btn primary","הוסף את כולם"); bb.type="button";
      const bres=mk("p","hint"); bres.hidden=true;
      const parse=txt=>{ const out=new Map(), re=/[^\s<>,;:"'()\[\]]+@[^\s<>,;:"'()\[\]]+\.[^\s<>,;:"'()\[\]]+/g;
        txt.split(/\r?\n|;/).forEach(line=>{ const ems=(line.match(re)||[]).map(x=>x.toLowerCase().replace(/\.$/,""));
          if(!ems.length) return;
          const name = ems.length===1 ? line.replace(re,"").replace(/[<>,;:"'()\[\]|\t]+/g," ").replace(/\s+/g," ").replace(/^[\s\-–]+|[\s\-–]+$/g,"").trim() : "";
          ems.forEach(em=>{ if(!out.has(em) || (name && !out.get(em))) out.set(em, ems.length===1 ? name : ""); }); });
        return out; };
      bb.onclick=async()=>{
        const all=parse(ta.value); if(!all.size){ toast("לא נמצאו מיילים"); return; }
        const have=new Set(members.map(m=>m.email)), add=[...all].filter(([em])=>!have.has(em)), skip=all.size-add.length;
        if(!add.length){ toast("כולם כבר ברשימת הצוות"); return; }
        if(!confirm("להוסיף "+add.length+" אנשי צוות ("+bsel.options[bsel.selectedIndex].text+")?"+(skip?"\n"+skip+" כבר ברשימה — יידלגו.":""))) return;
        bb.disabled=true;
        try{ const w=F.writeBatch(db);
          add.forEach(([em,name])=>w.set(F.doc(db,"members",em),{role:bsel.value,added:F.serverTimestamp(),by:me,...(name?{name}:{})}));
          await w.commit();
          ta.value=""; bres.hidden=false;
          bres.textContent="נוספו "+add.length+(skip?" · "+skip+" כבר היו ברשימה":"")+(add.some(([,n])=>!n)?" · בלי שם: "+add.filter(([,n])=>!n).length+" (אפשר להוסיף שם ברשימה למטה)":"")+". שלח להם הזמנה מהכפתור \"הזמן\" ליד כל אחד.";
          toast("נוספו "+add.length+" אנשי צוות");
        }catch(e){ toast("ההוספה נכשלה"); }
        bb.disabled=false;
      };
      brow.append(bsel,bb); bulk.append(ta,brow,bres); adm.appendChild(bulk);
      const inv=mk("div","cloud-invite"); inv.id="cloudInvite"; inv.hidden=true; adm.appendChild(inv);
      const list=mk("div","cloud-members"); list.id="cloudMembers"; adm.appendChild(list);
      paintMembers();
      const fh=mk("h3","cloud-h","📣 משובים"); fh.id="cloudFbH"; adm.appendChild(fh);
      const fb=mk("div","cloud-fb"); fb.id="cloudFb"; adm.appendChild(fb); paintFeedback();
    }
  }
  let members=[];
  function watchMembers(){
    if(unsubMembers) return;
    unsubMembers=F.onSnapshot(F.collection(db,"members"), s=>{
      members=s.docs.map(d=>({email:d.id,...d.data()})).sort((a,b)=>(a.name||a.email).localeCompare(b.name||b.email));
      window.TEAM_NAMES=members.map(m=>m.name).filter(Boolean);
      paintMembers(); paintMyName(); if(typeof renderTasks==="function") renderTasks(); if(window.paintTeamStrip) window.paintTeamStrip();
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
    try{ await F.setDoc(F.doc(db,"meta","me-"+me),{name:selfName,_upd:F.serverTimestamp(),_by:me},{merge:true}); }catch(e){ toast("השמירה בענן נכשלה — נשמר במכשיר"); }
    if(typeof renderTasks==="function") renderTasks();
  };
  // my reminders (🔔): meta/me-<me>.reminders + remNext (the earliest) — the cloud function reads remNext to know when to send
  let remT=null;
  window.cloudSetRems=list=>{ if(!started || !me) return; clearTimeout(remT); remT=setTimeout(()=>{
    const L=(list||[]).slice(0,50), nx=L.length ? Math.min(...L.map(r=>r.at)) : null;
    F.setDoc(F.doc(db,"meta","me-"+me),{reminders:L, remNext:nx, _upd:F.serverTimestamp(), _by:me},{merge:true}).catch(()=>toast("שמירת התזכורת בענן נכשלה"));
  },400); };
  async function loadSelfName(){
    try{ const s0=await F.getDoc(F.doc(db,"meta","me-"+me)); if(s0.exists() && Array.isArray(s0.data().reminders) && window.remApply) window.remApply(s0.data().reminders); }catch(e){}
    try{ const s=await F.getDoc(F.doc(db,"meta","me-"+me)); if(s.exists() && s.data().name){ selfName=s.data().name; try{ localStorage.setItem(K_SELF(),selfName); }catch(e){} if(typeof renderTasks==="function") renderTasks(); } }catch(e){}
  }
  function paintMyName(){
    const el=$("#cloudMyName"); if(!el) return;
    const n=window.cloudMyName();
    el.textContent = n ? "השם שלך ביומן: "+n+" — משימות שהאחראי בהן \""+n+"\" מופיעות אצלך ב\"שלי\"."
                       : (role==="admin" ? "עדיין לא הוגדר לך שם — לחץ \"שם\" ליד המייל שלך ברשימת הצוות, כדי לקבל משימות והתראות."
                                          : "מנהל היומן עדיין לא הגדיר את השם שלך — בלי שם לא תקבל התראה על משימות שהוקצו לך.");
  }
  /* where a member stands: connected now / last seen / joined / invited, not in yet / not invited yet */
  function memberState(m){
    const t = m.email===me ? Date.now() : seen[m.email];
    if(t && Date.now()-t<7*60e3) return {k:"on", t:"מחובר עכשיו"};
    if(t) return {k:"was", t:"התחבר "+(window.agoHe ? agoHe(t) : new Date(t).toLocaleString("he-IL"))};
    if(tasks.some(x=>(x.log||[]).some(l=>l && l.mail===m.email) || x.openedMail===m.email)) return {k:"was", t:"הצטרף (עוד לא נראה מאז העדכון)"};
    if(m.invitedAt && m.invitedAt.toMillis) return {k:"inv", t:"הוזמן "+new Date(m.invitedAt.toMillis()).toLocaleDateString("he-IL")+" · עוד לא נכנס"};
    return {k:"new", t:"טרם הוזמן"};
  }
  window.memberState=memberState;

  /* security check (🔒, managers): probes the live security rules over the REST API. Nothing is ever written:
     every write probe targets a document that does not exist with "must already exist", so a rule that allows it
     answers NOT_FOUND (404) and one that blocks it answers PERMISSION_DENIED (403). */
  window.cloudSecCheck=async()=>{
    const out=[], add=(g,s,t,d,fix)=>out.push({g,s,t,d:d||"",fix:fix||""});
    const G1="הענן וכללי האבטחה", G2="הצוות וההרשאות";
    if(!started || !me || !auth || !auth.currentUser){ add(G1,"warn","לא מחובר ליומן המשותף","הבדיקות מול הענן לא רצו."); return out; }
    const cfg=window.FIREBASE_CONFIG||{}, dbn=window.FIREBASE_DATABASE||"(default)";
    const host=window.FIREBASE_EMULATOR ? "http://127.0.0.1:8080" : "https://firestore.googleapis.com";
    const root="projects/"+cfg.projectId+"/databases/"+dbn+"/documents", base=host+"/v1/"+root, key="key="+encodeURIComponent(cfg.apiKey||"");
    let tok=""; try{ tok=await auth.currentUser.getIdToken(); }catch(e){}
    const call=async(method,path,opt={})=>{
      try{
        const r=await fetch(path, Object.assign({method, cache:"no-store", headers:Object.assign({"Content-Type":"application/json"}, opt.auth&&tok ? {Authorization:"Bearer "+tok} : {}),
                                                 body:opt.body?JSON.stringify(opt.body):undefined}, opt.noRef?{referrerPolicy:"no-referrer"}:{}));
        let j=null; try{ j=await r.json(); }catch(e){}
        const er=(j && j.error)||{}, why=JSON.stringify(er.details||[])+" "+(er.message||"");
        return {st:r.status, keyBlocked:r.status===403 && /REFERRER_BLOCKED|referer/i.test(why)};
      }catch(e){ return {st:0}; }
    };
    const rnd="zz_secprobe_"+Math.random().toString(36).slice(2,10);
    const ok=r=>r.st===200||r.st===404, denied=r=>r.st===403 && !r.keyBlocked;

    // 1. open to the world? (no sign-in at all)
    const u1=await call("GET",base+"/events?pageSize=1&"+key), u2=await call("GET",base+"/members?pageSize=1&"+key);
    const u3=await call("PATCH",base+"/"+rnd+"/x?currentDocument.exists=true&"+key,{body:{fields:{a:{stringValue:"probe"}}}});
    if(u1.st===200 || u2.st===200) add(G1,"bad","המידע פתוח לכל העולם","בלי כניסה בכלל אפשר לקרוא את "+(u1.st===200?"האירועים":"רשימת הצוות")+".",
      "Firebase Console ← Firestore ← Rules: להדביק את firestore.rules מהמאגר (עם המייל של הבעלים) וללחוץ Publish — מיד.");
    else if(denied(u1) && denied(u2)) add(G1,"ok","אין גישה בלי כניסה","מי שלא מחובר לא יכול לקרוא אירועים או את רשימת הצוות.");
    else add(G1,"warn","לא הצלחתי לבדוק גישה בלי כניסה", u1.keyBlocked ? "מפתח ה-API חסם את הבדיקה (האתר רץ מכתובת שלא ברשימת המפתח)." : "אין חיבור לשרת או תשובה לא צפויה ("+u1.st+").");
    if(u3.st===404) add(G1,"bad","אפשר לכתוב בלי כניסה","הכללים מאפשרים כתיבה למי שלא מחובר.","לפרסם מחדש את firestore.rules מהמאגר.");
    else if(denied(u3)) add(G1,"ok","אין כתיבה בלי כניסה","מי שלא מחובר לא יכול לכתוב שום דבר.");

    // 2. the rules on the server are the current ones (each part of the app can be read)
    const parts=[["events","אירועים"],["members","רשימת הצוות"],["board","לוח המודעות"],["presence","מי מחובר"],["feedback","משובים"],["briefs","שיחות בוקר"]];
    const miss=[];
    for(const [c,n] of parts){ const r=await call("GET",base+"/"+c+"?pageSize=1",{auth:1}); if(!ok(r)) miss.push(n+(r.st?"":" (אין חיבור)")); }
    const pr=await call("GET",base+"/private/"+encodeURIComponent(me),{auth:1}); if(!ok(pr)) miss.push("משימות אישיות");
    const open=u1.st===200 || u2.st===200 || u3.st===404;
    if(!miss.length){ if(!open) add(G1,"ok","הכללים בענן מעודכנים","כל חלקי האפליקציה נפתחים כמו שצריך — הכללים שפורסמו תואמים לגרסה הזו."); }
    else add(G1,"bad","הכללים בענן ישנים או חסרים","חסומים: "+miss.join(", ")+". אולי גם מסך המשרד (צופה) יכול לכתוב.",
      "Firebase Console ← Firestore ← Rules: להדביק את firestore.rules העדכני מהמאגר (להחליף OWNER_EMAIL במייל של הבעלים) וללחוץ Publish.");

    // 3. the rules are strict (signed in as a manager — the most permissive role)
    const s1=await call("PATCH",base+"/"+rnd+"/x?currentDocument.exists=true",{auth:1,body:{fields:{a:{stringValue:"probe"}}}});
    const s2=await call("DELETE",base+"/events/"+rnd+"?currentDocument.exists=true",{auth:1});
    const tw=(by,stamp)=>({writes:[Object.assign({update:{name:root+"/meta/task-"+rnd,fields:Object.assign({id:{stringValue:rnd}},by?{_by:{stringValue:by}}:{})}},
                                                stamp?{updateTransforms:[{fieldPath:"_upd",setToServerValue:"REQUEST_TIME"}]}:{},{currentDocument:{exists:true}})]});
    const cm=host+"/v1/"+root+":commit";
    const s3=await call("POST",cm,{auth:1,body:tw(me,true)}), s4=await call("POST",cm,{auth:1,body:tw("someone-else@example.invalid",true)}), s5=await call("POST",cm,{auth:1,body:tw(me,false)});
    if(s1.st===404) add(G1,"bad","יש בכללים פתח כללי","אפשר לכתוב לאוסף שהאפליקציה לא מכירה — כנראה כלל 'allow … if true' או כלל רחב מדי.","לפרסם מחדש את firestore.rules מהמאגר במקום מה שיש בענן.");
    else if(denied(s1)) add(G1,"ok","אין כתיבה מחוץ לאפליקציה","כל מקום שהאפליקציה לא משתמשת בו חסום, גם למנהל.");
    if(s2.st===404) add(G1,"bad","אפשר למחוק אירועים לצמיתות","הכללים מאפשרים מחיקה מלאה של אירוע (במקום סימון 'נמחק').","לפרסם מחדש את firestore.rules מהמאגר.");
    else if(denied(s2)) add(G1,"ok","אין מחיקה לצמיתות","אירוע לא נמחק מהענן — רק מסומן כמחוק, ומנהל יכול להחזיר אותו.");
    if(s3.st===404 && denied(s4) && denied(s5)) add(G1,"ok","כל שינוי חתום","כל כתיבה נושאת את שעת השרת ואת הכותב — אי אפשר לשנות בשם של מישהו אחר.");
    else if(s3.st===404) add(G1,"bad","אפשר לכתוב בלי חתימה או בשם אחר","הכללים לא מחייבים את שעת השרת ואת הכותב בכל שינוי.","לפרסם מחדש את firestore.rules מהמאגר.");
    else add(G1,"warn","לא הצלחתי לבדוק את החתימה על שינויים","תשובה לא צפויה מהשרת ("+s3.st+").");

    // 4. the API key only works from this site
    const k1=window.FIREBASE_EMULATOR ? {st:-1} : await call("GET",base+"/events?pageSize=1&"+key,{noRef:1});
    if(k1.st===-1){}
    else if(k1.keyBlocked) add(G1,"ok","מפתח ה-API מוגבל לאתר","בקשות שלא מגיעות מהאתר של היומן נחסמות.");
    else if(k1.st===403 || k1.st===200) add(G1,"warn","מפתח ה-API לא מוגבל לאתר","כל אחד יכול להשתמש במפתח מכל מקום (המידע עדיין מוגן בכללים, אבל אפשר להעמיס על הפרויקט).",
      "Google Cloud Console ← APIs & Services ← Credentials ← Browser key ← Application restrictions: Websites — כתובת האתר וכתובת ה-firebaseapp.com של הפרויקט.");
    else add(G1,"warn","לא הצלחתי לבדוק את הגבלת מפתח ה-API","אין חיבור לשרת.");

    // 5. this device's sync
    add(G1, pending ? "warn":"ok", pending ? "יש שינויים שעוד לא הגיעו לענן" : "כל השינויים במכשיר הגיעו לענן",
        pending ? pending+" שמירות ממתינות — בדוק את החיבור לאינטרנט." : "");

    // the team: who can get in, and as what
    const S=members.map(memberState), name=m=>(m.name? m.name+" ("+m.email+")" : m.email);
    const adm=members.filter(m=>m.role==="admin"), vw=members.filter(m=>m.role==="viewer");
    add(G2,"info","בצוות "+members.length+" אנשים", adm.length+" מנהלים, "+vw.length+" צופים (מסך משרד), "+(members.length-adm.length-vw.length)+" חברי צוות.");
    add(G2, adm.length>3 ? "warn":"info", "מנהלים: "+adm.length, adm.map(name).join(" · "),
        adm.length>3 ? "מנהל יכול למחוק, לנהל את הצוות ולראות משובים. כדאי שיהיו מעט מנהלים — בהגדרות ← צוות וחשבון אפשר להוריד תפקיד." : "");
    if(vw.length) add(G2,"info","צופים (מסך משרד)", vw.map(name).join(" · ")+" — רואים הכול ולא יכולים לשנות. המחשב של המסך צריך להיות במקום שרק הצוות מגיע אליו.");
    const DAY=864e5, stale=members.filter(m=>m.email!==me && seen[m.email] && Date.now()-seen[m.email]>30*DAY);
    if(stale.length) add(G2,"warn","לא נכנסו יותר מ-30 יום: "+stale.length, stale.map(m=>name(m)+" — "+new Date(seen[m.email]).toLocaleDateString("he-IL")).join(" · "),
      "מי שעזב או לא צריך יותר גישה — להסיר מהצוות (הגדרות ← צוות וחשבון).");
    else add(G2,"ok","אין חשבונות נטושים","כל מי שנכנס ליומן היה פעיל ב-30 הימים האחרונים.");
    const waiting=members.filter((m,i)=>S[i].k==="inv" && m.invitedAt && m.invitedAt.toMillis && Date.now()-m.invitedAt.toMillis()>14*DAY);
    if(waiting.length) add(G2,"info","הוזמנו לפני יותר משבועיים ועוד לא נכנסו", waiting.map(name).join(" · "),"אם ההזמנה כבר לא רלוונטית — להסיר מהצוות.");
    const dom={}; members.forEach(m=>{ const d=(m.email.split("@")[1]||""); dom[d]=(dom[d]||0)+1; });
    const main=Object.keys(dom).sort((a,b)=>dom[b]-dom[a])[0], other=members.filter(m=>(m.email.split("@")[1]||"")!==main);
    if(main && other.length && members.length>2) add(G2,"info","מיילים מחוץ ל-"+main, other.map(name).join(" · "),"לוודא שזה מכוון (למשל מייל פרטי במקום מייל העבודה).");
    add(G2,"info","מחובר כ-"+me, role==="admin"?"מנהל":role);
    return out;
  };
  function paintMembers(){
    const box=$("#cloudMembers"); if(!box) return; box.textContent="";
    const S=members.map(memberState), cnt=k=>S.filter(x=>x.k===k).length;
    if(role==="admin") box.appendChild(mk("p","cm-sum","📱 "+members.filter(m=>+m.pushDevices>0).length+" מתוך "+members.length+" הפעילו פוש"));
    if(role==="admin") box.appendChild(mk("p","cm-sum","🟢 "+cnt("on")+" מחוברים עכשיו · "+(cnt("on")+cnt("was"))+" הצטרפו · "+cnt("inv")+" הוזמנו ועוד לא נכנסו · "+cnt("new")+" טרם הוזמנו"));
    members.forEach((m,i)=>{
      const r=mk("div","listrow"), who=mk("div","cm-who");
      who.appendChild(mk("b",null,m.name||"(בלי שם)")); who.appendChild(mk("span","cm-mail",m.email));
      if(role==="admin") who.appendChild(mk("span","cm-st st-"+S[i].k,S[i].t));   // who is connected: managers only
      if(role==="admin"){                                  // 📱 push: on how many devices, and how the last one went
        const n=+m.pushDevices||0, t=m.pushAt && m.pushAt.toDate ? m.pushAt.toDate().toLocaleString("he-IL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "";
        const ps=mk("span","cm-push "+(!n?"off":m.pushAt && m.pushOk===false?"bad":"on"),
          !n ? "📵 אין פוש" : "📱 פוש"+(n>1?" ("+n+" מכשירים)":"")+(t ? (m.pushOk===false ? " · ⚠ נכשל "+t : " · ✓ אחרון "+t) : " · עוד לא נשלח"));
        if(m.pushErr) ps.title=m.pushErr; who.appendChild(ps);
      }
      r.appendChild(who);
      const RL={admin:"מנהל",viewer:"צופה — מסך משרד",member:"איש צוות"};
      if(role==="admin" && m.email!==me){                 // a manager changes the role right here
        const rs=mk("select","dsel cm-role"); [["member","איש צוות"],["admin","מנהל"],["viewer","צופה — מסך משרד"]].forEach(([v,l])=>{ const o=mk("option",null,l); o.value=v; rs.appendChild(o); });
        rs.value=RL[m.role]?m.role:"member"; rs.setAttribute("aria-label","תפקיד של "+(m.name||m.email));
        rs.onchange=async()=>{ if(!confirm("לשנות את התפקיד של "+(m.name||m.email)+" ל"+RL[rs.value]+"?")){ rs.value=RL[m.role]?m.role:"member"; return; }
          try{ await F.setDoc(F.doc(db,"members",m.email),{role:rs.value},{merge:true}); toast("התפקיד עודכן"); }catch(e){ toast("השמירה נכשלה"); rs.value=m.role||"member"; } };
        r.appendChild(rs);
      } else r.appendChild(mk("span",null,RL[m.role]||"איש צוות"));
      const nb=mk("button","btn mini","שם"); nb.type="button";
      nb.onclick=async()=>{
        const v=prompt("השם של "+m.email+" ביומן (כמו שמופיע ברשימת המעורבים):", m.name||""); if(v===null) return;
        try{ await F.setDoc(F.doc(db,"members",m.email),{name:v.trim()},{merge:true}); toast("השם נשמר"); }catch(e){ toast("השמירה נכשלה"); }
      };
      r.appendChild(nb);
      if(m.email!==me){
        // change the e-mail: the member moves to the new address with the same name and role (the old one can no longer sign in);
        // their own chosen name and "opened by" / update-log marks on tasks move with them
        const eb=mk("button","btn mini","מייל"); eb.type="button";
        eb.onclick=async()=>{
          const v=(prompt("מייל חדש עבור "+(m.name||m.email)+":", m.email)||"").trim().toLowerCase(); if(!v || v===m.email) return;
          if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)){ toast("מייל לא תקין"); return; }
          if(members.some(x=>x.email===v)){ toast("המייל הזה כבר ברשימת הצוות"); return; }
          if(!confirm("להחליף את המייל של "+(m.name||"איש הצוות")+"?\n"+m.email+"  ←  "+v+"\n\nהכניסה תהיה רק עם המייל החדש (צריך לשלוח לו הזמנה מחדש).")) return;
          try{
            const data={}; Object.keys(m).forEach(k=>{ if(k!=="email") data[k]=m[k]; });
            await F.setDoc(F.doc(db,"members",v), Object.assign(data,{movedFrom:m.email, by:me}));
            try{ const sn=await F.getDoc(F.doc(db,"meta","me-"+m.email));
              if(sn.exists() && sn.data().name) await F.setDoc(F.doc(db,"meta","me-"+v),{name:sn.data().name,_upd:F.serverTimestamp(),_by:me}); }catch(e){}
            await F.deleteDoc(F.doc(db,"members",m.email));
            let n=0; tasks.forEach(t=>{ let ch=false;
              if(t.openedMail===m.email){ t.openedMail=v; ch=true; }
              (t.log||[]).forEach(l=>{ if(l && l.mail===m.email){ l.mail=v; ch=true; } });
              if(ch) n++; });
            if(n) saveTasks();
            toast("המייל עודכן — שלח לו הזמנה למייל החדש"); showInvite(v);
          }catch(e){ toast("ההחלפה נכשלה: "+(e.code||e.message||"")); }
        };
        r.appendChild(eb);
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
    const title=(document.querySelector(".bar .mark")||{}).textContent||"יומן אירועים ומשימות";
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
    // pressing any of the send buttons marks the member as invited (shown in the team list)
    const sent=()=>{ F.setDoc(F.doc(db,"members",em),{invitedAt:F.serverTimestamp()},{merge:true}).catch(()=>{}); };
    const btn=(label,fn,cls)=>{ const b=mk("button","btn"+(cls?" "+cls:""),label); b.type="button"; b.onclick=()=>{ sent(); fn(); }; row.appendChild(b); };
    btn("וואטסאפ",()=>window.open("https://wa.me/?text="+encodeURIComponent(T.text),"_blank","noopener"),"primary");
    btn("מייל",()=>{ location.href="mailto:"+em+"?subject="+encodeURIComponent(T.subject)+"&body="+encodeURIComponent(T.text); });
    if(navigator.share) btn("שתף",async()=>{ try{ await navigator.share({title:T.subject,text:T.text}); }catch(e){} });
    btn("העתק קישור",async()=>{ try{ await navigator.clipboard.writeText(T.url); toast("הקישור הועתק — להדבקה בשורת הכתובת"); }catch(e){ toast("ההעתקה נכשלה"); } });
    btn("העתק הודעה",async()=>{ try{ await navigator.clipboard.writeText(T.text); toast("הודעת ההזמנה הועתקה — להדבקה בוואטסאפ/מייל"); }catch(e){ toast("ההעתקה נכשלה"); } });
    box.appendChild(row);
    box.scrollIntoView({block:"nearest",behavior:"smooth"});
  }
  /* ---------- push to the phone (FCM): task messages even when the app is closed ----------
     Needs FIREBASE_VAPID_KEY (firebase-config.js) and the "taskPush" Cloud Function (functions/). This device's token is kept in
     push/<token> with its owner's mail and the manager's "every task" setting; the function sends what the 📨 list would show. */
  const K_PUSH="ogg-push-token"; let unsubPushDoc=null;
  let pushSup=null;
  async function pushSupported(){
    if(pushSup===null) pushSup=!!(window.FIREBASE_VAPID_KEY && "serviceWorker" in navigator && "Notification" in window && F && F.messagingSupported
                                  && await F.messagingSupported().catch(()=>false));
    return pushSup;
  }
  const pushOn=()=>!!get(K_PUSH) && "Notification" in window && Notification.permission==="granted";
  let pushErr="";                                         // why the last try failed — shown to the user
  async function pushRegister(ask){
    pushErr="";
    if(typeof BETA!=="undefined" && BETA){ pushErr="בגרסת הבטא אין פוש"; return false; }
    if(!me || role==="viewer" || !(await pushSupported())){ pushErr="הדפדפן הזה לא תומך בפוש"; return false; }
    if(ask && Notification.permission==="default"){ try{ await Notification.requestPermission(); }catch(e){} }
    if(Notification.permission!=="granted"){ if(Notification.permission==="denied") put(K_PUSH,null);
      pushErr = Notification.permission==="denied" ? "ההתראות חסומות בדפדפן — הגדרות האתר ← התראות ← אפשר" : "לא אושרה הרשאה להתראות"; return false; }
    let tok="";
    try{
      const reg=await navigator.serviceWorker.ready;
      tok=await F.getToken(F.getMessaging(app),{vapidKey:window.FIREBASE_VAPID_KEY, serviceWorkerRegistration:reg});
    }catch(e){ pushErr="הרישום לשירות הפוש נכשל ("+((e && (e.code||e.message))||"?")+")"; return false; }
    if(!tok){ pushErr="שירות הפוש לא החזיר מזהה למכשיר"; return false; }
    try{
      const old=get(K_PUSH);
      if(old && old!==tok) F.deleteDoc(F.doc(db,"push",old)).catch(()=>{});
      await F.setDoc(F.doc(db,"push",tok),{token:tok, mail:me, all:get("ogg-news-all")!=="0", ua:navigator.userAgent.slice(0,120), _upd:F.serverTimestamp(), _by:me});
    }catch(e){ pushErr = e && e.code==="permission-denied" ? "כללי האבטחה בענן עוד לא מאפשרים (צריך לפרסם את הכללים עם push)" : "השמירה בענן נכשלה ("+((e && (e.code||e.message))||"?")+")"; return false; }
    put(K_PUSH,tok); return true;
  }
  async function pushOff(){
    if(typeof BETA!=="undefined" && BETA) return;            // the beta leaves the phone's push as it is
    const tok=get(K_PUSH); put(K_PUSH,null);
    if(!tok) return;
    try{ await F.deleteDoc(F.doc(db,"push",tok)); }catch(e){}
    try{ await F.deleteToken(F.getMessaging(app)); }catch(e){}
  }
  window.cloudPushPrefs=()=>{ if(me && get(K_PUSH)) pushRegister(false); };   // the manager's "every task" setting changed
  function paintPush(pb){
    pb.textContent="";
    if(typeof BETA!=="undefined" && BETA){ pb.appendChild(mk("p","hint","📱 בגרסת הבטא אין התראות פוש — הן מגיעות מהגרסה הרגילה.")); return; }
    const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
    if(pushOn()){
      pb.appendChild(mk("p","hint","📱 התראות פוש פעילות במכשיר הזה: הודעה על שינוי במשימות שאתה עוקב אחריהן (כמו ברשימת ההודעות 📨) — גם כשהאפליקציה סגורה."));
      // how the last push to this device went (written by the server) — and a test on demand
      const st=mk("p","hint push-st"); st.textContent="בודק…"; pb.appendChild(st);
      if(unsubPushDoc) unsubPushDoc();
      unsubPushDoc=F.onSnapshot(F.doc(db,"push",get(K_PUSH)), s=>{
        if(!s.exists()){ st.textContent="⚠ המכשיר לא רשום בענן — לחץ \"כבה\" ואז \"הפעל\" שוב"; return; }
        const x=s.data(), t=x.lastAt && x.lastAt.toDate ? x.lastAt.toDate().toLocaleString("he-IL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "";
        st.textContent = !t ? "✓ רשום. עוד לא נשלח פוש למכשיר הזה." : x.lastOk ? "✓ פוש אחרון נשלח "+t+(x.lastTitle?" · "+x.lastTitle:"") : "⚠ השליחה האחרונה נכשלה ("+t+"): "+(x.lastErr||"?");
      }, ()=>{ st.textContent="⚠ אין גישה לרישום הפוש — צריך לפרסם את כללי האבטחה עם push"; });
      const row=mk("div","row");
      const ts=mk("button","btn","שלח לי פוש לבדיקה"); ts.type="button";
      ts.onclick=async()=>{ ts.disabled=true;
        try{ await F.setDoc(F.doc(db,"push",get(K_PUSH)),{test:Date.now(),_upd:F.serverTimestamp(),_by:me},{merge:true}); toast("נשלח — ההתראה אמורה להגיע תוך כמה שניות"); }
        catch(e){ toast("השליחה נכשלה: "+(e.code||"")); }
        setTimeout(()=>{ ts.disabled=false; },5000); };
      const b=mk("button","btn","כבה פוש במכשיר הזה"); b.type="button";
      b.onclick=async()=>{ b.disabled=true; await pushOff(); paintPush(pb); toast("התראות הפוש כובו במכשיר הזה"); };
      row.append(ts,b); pb.appendChild(row);
    } else if(Notification.permission!=="denied"){
      pb.appendChild(mk("p","hint","📱 התראות פוש לטלפון: הודעה על שינוי במשימות שלך, של המחלקה ושפתחת — גם כשהאפליקציה סגורה."+(ios?" באייפון — רק מהאפליקציה שהותקנה במסך הבית.":"")));
      const b=mk("button","btn primary","הפעל התראות פוש"); b.type="button";
      b.onclick=async()=>{ b.disabled=true; const ok=await pushRegister(true);
        toast(ok?"התראות פוש הופעלו במכשיר הזה":"לא הצלחתי להפעיל התראות פוש: "+(pushErr||"סיבה לא ידועה")); renderAccount(); };
      pb.appendChild(b);
    }
  }
  /* device notification (when the app is in the background and the user allowed it) */
  function notifyDevice(title, body, tag, onClick){
    if(!(document.hidden && "Notification" in window && Notification.permission==="granted")) return;
    const opt={body, tag, renotify:true, icon:"icons/icon-notebook-192.png", badge:"icons/badge-96.png", lang:"he", dir:"rtl"};
    (navigator.serviceWorker ? navigator.serviceWorker.ready.then(r=>r.showNotification(title,opt)) : Promise.reject())
      .catch(()=>{ try{ const n=new Notification(title,opt); n.onclick=()=>{ window.focus(); onClick(); n.close(); }; }catch(e){} });
  }
  async function logout(){
    if(!confirm("להתנתק? העותק של היומן המשותף יימחק מהמכשיר הזה (הוא נשאר בענן).")) return;
    stopSync();
    await pushOff();                                      // this device stops getting the team's pushes
    try{ await F.signOut(auth); }catch(e){}
    ["ogg-cloud-log","ogg-cloud-lists","ogg-cloud-tasks",K_SYNC,K_SYNC_T,K_ROLE,"ogg-me-todos-"+me,"ogg-sec-last"].forEach(k=>put(k,null));
    try{ await Promise.all(["ogg-cloud-log","ogg-cloud-tasks"].map(k=>window.kvDel ? window.kvDel(k) : null)); }catch(e){}
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
