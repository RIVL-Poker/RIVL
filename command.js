/* RIVL COMMAND page (/command). Signs in with the RIVL account this browser already uses (account.js keeps it in
   localStorage as rivlAccount); the server answers only accounts on the COMMAND list. Everything shown comes from
   POST /api/command/state, refreshed every 20 seconds while the page is on screen. */
(()=>{
  const $=id=>document.getElementById(id);
  const API=((()=>{try{return localStorage.getItem('rivlRoomApi')}catch{return null}})()||location.origin).replace(/\/$/,'');
  const POLL_MS=20000,CHAT_KEEP=40;
  const TAGS=['general','frontend','backend','grader','content','bug','idea'];
  const ACTIVITY_NAMES={bots:'Bot practice',casual:'Casual',ranked:'Ranked',freeroll:'Freeroll',puzzle:'Daily puzzle',browsing:'Browsing'};
  const FEED_ICON={deploy:'⇪',tests:'✓',pr:'⇄',bug:'!',note:'✎',task:'☐',river:'♠',site:'◉'};

  let key='';try{key=JSON.parse(localStorage.getItem('rivlAccount')||'null')?.key||''}catch{}
  let S=null,dots=null,timer=null,view='command',noteFilter='all',feedFilter='all',editing=null,chat=[],busy=false;

  /* ---------- helpers ---------- */
  function el(tag,attrs={},...kids){
    const n=document.createElement(tag);
    for(const [k,v] of Object.entries(attrs)){
      if(v==null||v===false)continue;
      if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);
      else if(k==='style')n.style.cssText=v;else n.setAttribute(k,v===true?'':v);
    }
    for(const kid of kids.flat())if(kid!=null&&kid!==false)n.append(kid.nodeType?kid:document.createTextNode(String(kid)));
    return n;
  }
  const svg=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n};
  async function call(path,body={}){
    const r=await fetch(API+'/api/command/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,key})});
    const data=await r.json().catch(()=>({error:'The server sent something unexpected.'}));
    if(!r.ok)throw Object.assign(Error(data.error||'Request failed ('+r.status+').'),{status:r.status,data});
    return data;
  }
  const fmt=n=>Number(n||0).toLocaleString();
  function ago(t,now=Date.now()){
    const s=Math.max(0,Math.round((now-t)/1000));
    if(s<45)return 'just now';const m=Math.round(s/60);if(m<60)return m+'m ago';
    const h=Math.round(m/60);if(h<24)return h+'h ago';const d=Math.round(h/24);return d<7?d+'d ago':new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }
  const nameOf=id=>S?.team.find(t=>t.id===id)?.name||'Someone';
  const colorOf=id=>id===S?.me.id?'var(--me)':'var(--them)';
  const other=()=>S?.team.find(t=>t.id!==S.me.id);

  /* ---------- gate ---------- */
  function gate(text,{id,link}={}){
    $('app').hidden=true;$('gate').hidden=false;$('gateText').textContent=text;
    $('gateId').hidden=!id;if(id)$('gateIdValue').textContent=id;
    $('gateLink').hidden=!link;
  }
  $('gateCopy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('gateIdValue').textContent);$('gateCopy').textContent='Copied'}catch{$('gateCopy').textContent='Select and copy it'}});

  /* ---------- clock ---------- */
  function tick(){
    const d=new Date();
    $('clock').textContent=d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    $('date').textContent=d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  }
  tick();setInterval(tick,1000);

  /* ---------- core ticks (drawn once) ---------- */
  {
    const g=$('ticks');
    for(let i=0;i<72;i++){
      const a=i*5*Math.PI/180,major=i%6===0,r1=major?156:160,r2=168;
      g.append(svg('line',{x1:200+r1*Math.cos(a),y1:200+r1*Math.sin(a),x2:200+r2*Math.cos(a),y2:200+r2*Math.sin(a),class:'tick'+(major?' major':'')}));
    }
  }
  const STATE_TEXT={idle:'Standing by',listening:'Listening',thinking:'Thinking',speaking:'Speaking',off:'Offline: add the ANTHROPIC_API_KEY secret to switch RIVER on'};
  function coreState(s){document.querySelector('.console').dataset.state=s;$('coreState').textContent=STATE_TEXT[s]}

  /* ---------- navigation ---------- */
  function go(v){
    view=v;
    document.querySelectorAll('.rail-btn').forEach(b=>{const on=b.dataset.view===v;b.classList.toggle('active',on);on?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current')});
    document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s.id==='view-'+v));
    if(v==='notes'||v==='feed')markSeen(v);
    if(location.hash!=='#'+v)history.replaceState(null,'','#'+v);
  }
  document.querySelectorAll('.rail-btn').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
  document.addEventListener('click',e=>{const t=e.target.closest('[data-go]');if(t)go(t.dataset.go)});
  async function markSeen(what){
    if(!S)return;
    try{const r=await call('seen',{what});S.seen[what]=r.t;}catch{}
    // Keep the "new" dots on screen for this visit; the badges clear now.
    renderBadges();
  }

  /* ---------- state ---------- */
  async function refresh(){
    clearTimeout(timer);
    try{
      const first=!S;
      S=await call('state');
      // The gold dots mark what changed before this visit and stay for the whole visit; the badges clear as you look.
      if(!dots)dots={...S.seen};
      $('gate').hidden=true;$('app').hidden=false;
      render();
      if(first)welcome();
    }catch(e){
      if(e.status===401)gate('Sign in to RIVL in this browser first, then come back to /command.',{link:true});
      else if(e.status===403)gate('This RIVL account isn’t on the COMMAND list. To add it, put this account id in the COMMAND_ACCOUNTS secret.',{id:e.data?.accountId});
      else if(!S)gate('Can’t reach the RIVL server: '+e.message);
      else pill('bad','Connection lost, retrying');
    }
    if(!document.hidden)timer=setTimeout(refresh,POLL_MS);
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S)refresh();else clearTimeout(timer)});

  function render(){
    renderLive();renderTeam();renderFeed();renderNotes();renderTasks();renderBadges();renderQuick();
    if(!S.ai&&!busy)coreState('off');else if(document.querySelector('.console').dataset.state==='off')coreState('idle');
    $('sendBtn').disabled=!S.ai;$('askInput').disabled=!S.ai;$('micBtn').disabled=!S.ai;
  }
  function pill(kind,text){const p=$('sitePill');p.className='status-pill '+kind;p.querySelector('span').textContent=text}

  /* ---------- live systems ---------- */
  function renderLive(){
    const L=S.live,u=L.budget.usage,l=L.budget.limits;
    if(L.budget.closed)pill('bad','Online play closed for today');
    else if(L.budget.busy)pill('bad','New rooms paused: budget used');
    else if(u.hands>=l.hands*.8||u.rooms>=l.rooms*.8)pill('warn','Budget over 80%');
    else{
      const deploy=S.events.find(e=>e.kind==='deploy'||e.kind==='tests');
      if(deploy&&deploy.ok===false)pill('bad','Last check failed');else pill('ok','Site live');
    }
    $('onlineNow').textContent=fmt(L.online);
    $('onlineSplit').textContent=`${fmt(L.signedIn)} signed in, ${fmt(L.guests)} guests${L.today?` · peak today ${fmt(L.today.peakOnline)}`:''}`;
    const max=Math.max(1,...Object.values(L.byActivity));
    $('activityBars').replaceChildren(...Object.entries(ACTIVITY_NAMES).map(([k,name])=>
      el('li',{},el('span',{text:name}),el('span',{class:'bar'},el('i',{style:`width:${(L.byActivity[k]||0)/max*100}%`})),el('b',{text:L.byActivity[k]||0}))));
    $('tablesNow').replaceChildren(...['casual','ranked','freeroll'].map(m=>{const t=L.tables[m]||{tables:0,humans:0};
      return el('div',{},el('dt',{text:ACTIVITY_NAMES[m]}),el('dd',{},String(t.tables),el('small',{text:`${t.humans} player${t.humans===1?'':'s'}`})))}));
    $('gauges').replaceChildren(gauge('Hands',u.hands,l.hands),gauge('Rooms',u.rooms,l.rooms),gauge('Accounts',u.accounts,l.accounts));
    spark(L.week.slice().reverse());
    const T=L.totals;
    $('totals').replaceChildren(...[['Accounts',T.accounts],['Active 7d',T.active7],['Ranked players',T.rankedPlayers]].map(([k,v])=>el('div',{},el('dt',{text:k}),el('dd',{text:fmt(v)}))));
  }
  function gauge(label,used,limit){
    const pct=limit?Math.min(1,used/limit):0,C=2*Math.PI*30;
    const s=svg('svg',{viewBox:'0 0 80 80',role:'img','aria-label':`${label}: ${used} of ${limit} today`});
    s.append(svg('circle',{cx:40,cy:40,r:30,class:'track'}));
    const f=svg('circle',{cx:40,cy:40,r:30,class:'fill','stroke-dasharray':C,'stroke-dashoffset':C*(1-pct),transform:'rotate(-90 40 40)'});s.append(f);
    const t=svg('text',{x:40,y:46});t.textContent=Math.round(pct*100)+'%';s.append(t);
    return el('div',{class:'gauge'+(pct>=1?' bad':pct>=.8?' warn':'')},s,el('div',{text:`${label} ${fmt(used)}/${fmt(limit)}`}));
  }
  function spark(days){
    const s=$('spark'),W=280,H=64,max=Math.max(1,...days.map(d=>d.active));
    const pts=days.map((d,i)=>[days.length>1?i*W/(days.length-1):W/2,H-6-(d.active/max)*(H-14)]);
    const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
    s.replaceChildren(svg('path',{d:line+` L${W} ${H} L0 ${H} Z`,class:'area'}),svg('path',{d:line,class:'line'}));
    const last=pts.at(-1);if(last)s.append(svg('circle',{cx:last[0],cy:last[1],r:3,class:'dot'}));
    s.setAttribute('aria-label','Active players, last 7 days: '+days.map(d=>d.active).join(', '));
  }

  /* ---------- team ---------- */
  function renderTeam(){
    $('team').replaceChildren(...S.team.map(t=>el('div',{class:'mate'+(t.here?' here':''),style:`--c:${colorOf(t.id)}`,title:t.here?`${t.name} is in COMMAND now`:`${t.name} was here ${t.lastHere?ago(t.lastHere,S.serverNow):'never'}`},
      el('b',{text:t.name.slice(0,1).toUpperCase()}),el('span',{text:t.id===S.me.id?'You':t.here?'Here now':t.lastHere?ago(t.lastHere,S.serverNow):'Not yet'}))));
  }

  /* ---------- feed ---------- */
  const isNewEvent=e=>{const seen=dots.feed;return e.t>seen&&e.actor!==S.me.name&&!e.title.endsWith(' for '+S.me.name)};
  function feedItem(e){
    const cls=e.ok===true?'ok':e.ok===false?'fail':e.kind==='bug'?'bug':e.kind==='river'?'river':'';
    return el('li',{class:isNewEvent(e)?'new':null},
      el('span',{class:'k '+cls,'aria-hidden':'true',text:e.ok===false?'✕':FEED_ICON[e.kind]||'◉'}),
      el('div',{},el('div',{class:'t'},e.url?el('a',{href:e.url,target:'_blank',rel:'noopener',text:e.title}):e.title),
        e.detail?el('div',{class:'d',text:e.detail}):null,el('time',{datetime:new Date(e.t).toISOString(),text:ago(e.t,S.serverNow)})));
  }
  const FEED_FILTERS={all:'All',deploy:'Deploys and tests',notes:'Notes and tasks',bug:'Bug reports',river:'RIVER'};
  function renderFeed(){
    const short=S.events.slice(0,8);
    $('feedShort').replaceChildren(...(short.length?short.map(feedItem):[el('li',{class:'empty',text:'Nothing yet. Deploys, test results, bug reports and note changes show up here.'})]));
    $('feedFilters').replaceChildren(...Object.entries(FEED_FILTERS).map(([k,v])=>el('button',{type:'button',role:'tab','aria-selected':String(feedFilter===k),text:v,onclick:()=>{feedFilter=k;renderFeed()}})));
    const match={all:()=>true,deploy:e=>['deploy','tests','pr'].includes(e.kind),notes:e=>['note','task'].includes(e.kind),bug:e=>e.kind==='bug',river:e=>e.kind==='river'}[feedFilter];
    const list=S.events.filter(match);
    $('feedFull').replaceChildren(...(list.length?list.map(feedItem):[el('li',{class:'empty',text:'Nothing here yet.'})]));
  }

  /* ---------- notes ---------- */
  const isNewNote=n=>n.updated>dots.notes&&n.updatedBy!==S.me.id;
  function renderBadges(){
    const n=S.notes.filter(n=>n.updated>S.seen.notes&&n.updatedBy!==S.me.id).length;
    const f=S.events.filter(e=>e.t>S.seen.feed&&e.actor!==S.me.name&&!e.title.endsWith(' for '+S.me.name)).length;
    $('notesBadge').hidden=!n||view==='notes';$('notesBadge').textContent=n;
    $('feedBadge').hidden=!f||view==='feed';$('feedBadge').textContent=f>99?'99+':f;
  }
  function noteFilters(){
    const mate=other();
    return {all:'All',tasks:'Open tasks',mine:'Mine',...(mate?{theirs:mate.name+'’s'}:{}),done:'Done'};
  }
  function renderNotes(){
    $('noteFilters').replaceChildren(...Object.entries(noteFilters()).map(([k,v])=>el('button',{type:'button',role:'tab','aria-selected':String(noteFilter===k),text:v,onclick:()=>{noteFilter=k;renderNotes()}})));
    const mate=other();
    const match={all:n=>!(n.kind==='task'&&n.done),tasks:n=>n.kind==='task'&&!n.done,mine:n=>n.author===S.me.id,theirs:n=>mate&&n.author===mate.id,done:n=>n.kind==='task'&&n.done}[noteFilter]||(()=>true);
    const list=S.notes.filter(match).sort((a,b)=>(b.pinned-a.pinned)||(b.updated-a.updated));
    $('notes').replaceChildren(...(list.length?list.map(noteItem):[el('li',{class:'empty',text:noteFilter==='tasks'?'No open tasks. Add one, or ask RIVER to.':'No notes here yet. Write the first one on the left.'})]));
  }
  function noteItem(n){
    const box=n.kind==='task'?el('input',{type:'checkbox',checked:n.done,'aria-label':(n.done?'Reopen ':'Finish ')+n.title,onchange:e=>quickSave(n,{done:e.target.checked})}):null;
    const edited=n.updatedBy!==n.author||n.updated-n.created>60000;
    return el('li',{class:`note${n.pinned?' pinned':''}${n.done?' done':''}${isNewNote(n)?' new':''}`,style:`--c:${colorOf(n.author)}`},
      el('div',{class:'note-top'},box,el('div',{class:'note-title',text:n.title})),
      n.body?el('p',{class:'note-body',text:n.body}):null,
      el('div',{class:'note-meta'},
        n.pinned?el('span',{class:'pin',text:'Pinned'}):null,
        el('span',{class:'tag',text:n.tag}),
        el('span',{class:'by',text:nameOf(n.author)}),
        el('span',{text:(edited?`edited by ${nameOf(n.updatedBy)} `:'')+ago(n.updated,S.serverNow)}),
        el('span',{class:'note-actions'},
          el('button',{type:'button',class:'link',text:n.pinned?'Unpin':'Pin',onclick:()=>quickSave(n,{pinned:!n.pinned})}),
          el('button',{type:'button',class:'link',text:'Edit',onclick:()=>startEdit(n)}),
          el('button',{type:'button',class:'link',text:'Delete',onclick:()=>{if(confirm(`Delete “${n.title}” for both of you?`))quickSave(n,{delete:true})}}))));
  }
  function renderTasks(){
    const open=S.notes.filter(n=>n.kind==='task'&&!n.done).sort((a,b)=>(b.pinned-a.pinned)||(b.updated-a.updated)).slice(0,6);
    $('openTasks').replaceChildren(...(open.length?open.map(n=>el('li',{style:`--c:${colorOf(n.author)}`},
      el('input',{type:'checkbox','aria-label':'Finish '+n.title,onchange:()=>quickSave(n,{done:true})}),el('span',{text:n.title}))):[el('li',{class:'empty',text:'No open tasks.'})]));
  }
  async function quickSave(n,change){
    try{await call('note',{id:n.id,...change});await refresh()}catch(e){alert(e.message)}
  }
  $('noteTag').replaceChildren(...TAGS.map(t=>el('option',{value:t,text:t[0].toUpperCase()+t.slice(1)})));
  function startEdit(n){
    editing=n.id;go('notes');
    document.querySelector(`input[name=kind][value=${n.kind}]`).checked=true;
    $('noteTitle').value=n.title;$('noteBody').value=n.body;$('noteTag').value=n.tag;$('notePin').checked=n.pinned;
    $('composeTitle').textContent='Edit '+n.kind;$('noteSave').textContent='Save changes';$('noteCancel').hidden=false;$('noteTitle').focus();
  }
  function resetForm(){
    editing=null;$('noteForm').reset();$('composeTitle').textContent='New note';$('noteSave').textContent='Save note';$('noteCancel').hidden=true;$('noteError').textContent='';
  }
  document.querySelectorAll('input[name=kind]').forEach(r=>r.addEventListener('change',()=>{if(!editing){const t=r.value==='task';$('composeTitle').textContent=t?'New task':'New note';$('noteSave').textContent=t?'Save task':'Save note'}}));
  $('noteCancel').addEventListener('click',resetForm);
  $('noteForm').addEventListener('submit',async e=>{
    e.preventDefault();$('noteError').textContent='';
    const body={title:$('noteTitle').value,body:$('noteBody').value,tag:$('noteTag').value,pinned:$('notePin').checked,kind:document.querySelector('input[name=kind]:checked').value};
    if(editing)body.id=editing;
    $('noteSave').disabled=true;
    try{await call('note',body);resetForm();await refresh()}catch(err){$('noteError').textContent=err.message}
    finally{$('noteSave').disabled=false}
  });

  /* ---------- RIVER ---------- */
  const chatKey=()=>'rivlCommandChat:'+S.me.id;
  function loadChat(){try{chat=JSON.parse(localStorage.getItem(chatKey())||'[]').slice(-CHAT_KEEP)}catch{chat=[]}}
  function saveChat(){try{localStorage.setItem(chatKey(),JSON.stringify(chat.slice(-CHAT_KEEP)))}catch{}}
  function renderChat(){
    $('transcript').replaceChildren(...chat.map(m=>el('li',{class:'msg '+(m.role==='user'?'user':'river')+(m.error?' error':'')+(m.pending?' pending':'')},
      el('div',{class:'who',text:m.role==='user'?S.me.name.toUpperCase():'RIVER'}),el('p',{text:m.content}))));
    const t=$('transcript');t.scrollTop=t.scrollHeight;
  }
  function welcome(){
    loadChat();
    if(!chat.length){
      const h=new Date().getHours(),part=h<5?'evening':h<12?'morning':h<18?'afternoon':'evening';
      const L=S.live,mate=other(),open=S.notes.filter(n=>n.kind==='task'&&!n.done).length;
      const fresh=S.notes.filter(n=>n.updated>S.seen.notes&&n.updatedBy!==S.me.id).length;
      let line=`Good ${part}, ${S.me.name}. ${L.online===0?'Nobody is':L.online===1?'One player is':fmt(L.online)+' players are'} on RIVL right now`;
      line+=L.budget.busy?', and online play has used today’s budget.':'.';
      if(mate)line+=mate.here?` ${mate.name} is here with you.`:mate.lastHere?` ${mate.name} was last here ${ago(mate.lastHere,S.serverNow)}.`:'';
      if(fresh)line+=` ${fresh} note${fresh===1?' has':'s have'} changed since you last looked.`;
      if(open)line+=` ${open} open task${open===1?'':'s'}.`;
      if(!S.ai)line+=' My voice is offline until the ANTHROPIC_API_KEY secret is set, but the console, notes and feed all work.';
      chat=[{role:'assistant',content:line,local:true}];
    }
    renderChat();
  }
  function renderQuick(){
    if(!S.ai){$('quick').replaceChildren();return}
    const mate=other();
    const asks=['What happened today?','How is the site doing?','What are our open tasks?',...(mate?[`What has ${mate.name} been working on?`]:[]),'What changed on GitHub lately?'];
    $('quick').replaceChildren(...asks.map(q=>el('button',{type:'button',text:q,onclick:()=>ask(q)})));
  }
  async function ask(text){
    text=String(text||'').trim();if(!text||busy||!S.ai)return;
    stopSpeaking();busy=true;$('sendBtn').disabled=true;coreState('thinking');
    chat.push({role:'user',content:text});const pending={role:'assistant',content:'',pending:true};chat.push(pending);renderChat();
    $('askInput').value='';sizeInput();
    try{
      // Only real turns go to RIVER: the local greeting and errors stay on screen.
      const turns=chat.filter(m=>!m.local&&!m.error&&!m.pending).map(({role,content})=>({role,content}));
      const r=await call('ask',{messages:turns});
      Object.assign(pending,{content:r.reply,pending:false});
      if(r.changed)refresh();
      if($('voiceOut').checked)speak(r.reply);else coreState('idle');
    }catch(e){
      Object.assign(pending,{content:e.message,pending:false,error:true});coreState('idle');
    }finally{
      busy=false;$('sendBtn').disabled=!S.ai;saveChat();renderChat();
    }
  }
  function sizeInput(){const t=$('askInput');t.style.height='auto';t.style.height=Math.min(160,t.scrollHeight)+'px'}
  $('askInput').addEventListener('input',sizeInput);
  $('askInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask($('askInput').value)}});
  $('askForm').addEventListener('submit',e=>{e.preventDefault();ask($('askInput').value)});
  $('clearChat').addEventListener('click',()=>{chat=[];saveChat();welcome()});

  /* Voice out: the browser's own speech, a calm English voice when one is installed. */
  const synth=window.speechSynthesis;
  try{$('voiceOut').checked=localStorage.getItem('rivlCommandVoice')==='1'}catch{}
  if(!synth)$('voiceOut').closest('label').hidden=true;
  $('voiceOut').addEventListener('change',()=>{try{localStorage.setItem('rivlCommandVoice',$('voiceOut').checked?'1':'0')}catch{};if(!$('voiceOut').checked)stopSpeaking()});
  function pickVoice(){
    const vs=synth?.getVoices()||[];
    return vs.find(v=>/en-GB/.test(v.lang)&&/Daniel|Arthur|Male|Google UK English Male/i.test(v.name))||vs.find(v=>/en-GB/.test(v.lang))||vs.find(v=>/^en/.test(v.lang))||null;
  }
  function speak(text){
    if(!synth){coreState('idle');return}
    stopSpeaking();
    const u=new SpeechSynthesisUtterance(text.replace(/[*_#`>]/g,''));
    const v=pickVoice();if(v)u.voice=v;u.rate=1.02;u.pitch=.95;
    u.onstart=()=>coreState('speaking');u.onend=u.onerror=()=>{if(!busy)coreState(S.ai?'idle':'off')};
    synth.speak(u);
  }
  function stopSpeaking(){if(synth?.speaking)synth.cancel()}

  /* Voice in: tap the mic, speak, and RIVER gets the question when you stop. Chrome, Edge and Safari. */
  const Rec=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(Rec){
    let rec=null,heard='';
    $('micBtn').hidden=false;
    $('micBtn').addEventListener('click',()=>{
      if(rec){rec.stop();return}
      if(busy||!S?.ai)return;
      stopSpeaking();heard='';rec=new Rec();rec.lang='en-US';rec.interimResults=true;rec.continuous=false;
      rec.onstart=()=>{$('micBtn').setAttribute('aria-pressed','true');coreState('listening')};
      rec.onresult=e=>{heard=[...e.results].map(r=>r[0].transcript).join('');$('askInput').value=heard;sizeInput()};
      rec.onerror=e=>{if(e.error==='not-allowed'){chat.push({role:'assistant',content:'I can’t hear you: the browser blocked the microphone for this page. Allow it in the address bar’s site settings.',error:true});renderChat()}};
      rec.onend=()=>{rec=null;$('micBtn').setAttribute('aria-pressed','false');if(heard.trim())ask(heard);else coreState(S.ai?'idle':'off')};
      try{rec.start()}catch{rec=null}
    });
  }

  /* ---------- start ---------- */
  const start=(location.hash||'').slice(1);
  if(['command','notes','feed','map'].includes(start))view=start;
  if(!key){gate('Sign in to RIVL in this browser first, then come back to /command.',{link:true})}
  else refresh().then(()=>{if(S)go(view)});
})();
