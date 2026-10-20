/* RIVL nightly freeroll page: a free tournament every night at 9 PM Eastern for up to 40 signed-in players.
   Sign up from an hour before, get taken to your table at the start, follow the blind clock and standings,
   and see the month's points race. The tables themselves are the normal online table screen (rooms.js). */
(()=>{
  const $=id=>document.getElementById(id);
  if(!$('freeroll'))return;
  const API=window.RIVL_ROOM_API||(/^https?:$/.test(location.protocol)?location.origin:'');
  let data=null,board=null,offset=0,timer=null,tick=null,busy=false,confirmDrop=false,seating=null,result=null,startCheck=null,autoNight='';
  const account=()=>window.rivlAccount?.current?.()||null;
  const now=()=>Date.now()+offset;
  const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const status=(t,ok)=>{const el=$('frlStatus');el.textContent=t||'';el.classList.toggle('ok',!!ok)};
  const time=t=>new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  const ordinal=n=>n+(n%100>=11&&n%100<=13?'th':['th','st','nd','rd'][n%10]||'th');
  const chips=n=>Number(n||0).toLocaleString();
  function clock(ms){
    ms=Math.max(0,ms);const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s/60)%60,sec=s%60;
    return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(sec).padStart(2,'0');
  }
  async function request(path,body){
    if(!API)throw Error('The freeroll needs the site to be opened from its web address.');
    const r=await fetch(API.replace(/\/$/,'')+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
    const json=await r.json().catch(()=>({error:'The freeroll is unavailable right now ('+r.status+').'}));
    return {ok:r.ok,status:r.status,data:json};
  }
  const me=()=>{const a=account();return a&&data?data.players.find(p=>p.id===a.id)||null:null};
  const inRoom=()=>!!window.rivlRooms?.code?.();
  const active=()=>$('freeroll').classList.contains('active')&&document.visibilityState==='visible';

  async function load(){
    try{
      const r=await request('/api/freeroll');if(!r.ok)throw Error(r.data.error);
      data=r.data;offset=(data.serverNow||Date.now())-Date.now();
      // Registered players with the site open are taken to their table when the cards go in the air.
      clearTimeout(startCheck);
      const mine=me();
      if(mine&&(data.status==='registering'||data.status==='starting'||data.status==='scheduled')){
        const wait=data.startAt-now();if(wait<6*3600000)startCheck=setTimeout(load,Math.max(3000,wait+4000));
      }
      const view=document.querySelector('.view.active')?.id;
      if(mine&&data.status==='running'&&mine.place==null&&!inRoom()&&(view==='freeroll'||view==='play')&&autoNight!==data.night&&!seating){autoNight=data.night;takeSeat(true)}
    }catch(e){if(!data)status(e.message)}
    render();schedule();
  }
  async function loadBoard(){try{const r=await request('/api/freeroll/board');if(r.ok){board=r.data;renderBoard()}}catch{}}
  function schedule(){
    clearTimeout(timer);
    if(!active())return;
    const s=data?.status,soon=data&&Math.abs(data.startAt-now())<10*60000;
    timer=setTimeout(load,seating?4000:s==='running'||s==='starting'||soon?10000:30000);
  }
  // Ask for this player's seat token and sit down. A player being moved waits a moment for the new table to seat them.
  async function takeSeat(auto,tries=0){
    const a=account();if(!a)return;
    seating={table:me()?.table||0};render();
    const r=await request('/api/freeroll/seat',{key:a.key}).catch(e=>({ok:false,status:0,data:{error:e.message}}));
    if(r.ok){seating=null;window.rivlRooms?.enter(r.data.code,r.data.token);return}
    if(r.data.wait&&tries<40){seating={table:r.data.table||0};render();setTimeout(()=>takeSeat(auto,tries+1),2500);return}
    seating=null;
    if(r.status===410)result={kind:'out',place:r.data.place,entrants:data?.entrants};
    else if(!auto)status(r.data.error||'Could not find your seat.');
    load();
  }
  async function act(path,done){
    const a=account();if(!a||busy)return;busy=true;status('');
    try{
      const r=await request(path,{key:a.key});
      if(!r.ok){status(r.data.error);if(r.status===401)window.rivlAccount.refresh?.();return}
      data=r.data;offset=(data.serverNow||Date.now())-Date.now();status(done,true);
    }finally{busy=false;render();schedule()}
  }

  function hero(){
    const a=account(),d=data,mine=me(),st=d.status;
    // Eastern-time players see "Tonight at 9:00 PM"; everyone else sees the Eastern time and their own.
    const eastern=new Date(d.startAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'}),local=time(d.startAt)===eastern;
    let badge='TONIGHT',title=local?`Tonight at ${eastern}`:`${eastern} Eastern`,sub=`Every night at 9:00 PM Eastern · ${d.cap} players max · free to play`,count='',countLabel='',primary=null,secondary=null;
    const regOpen=st==='registering'||d.lateReg;
    if(st==='scheduled'){countLabel='STARTS IN';count=clock(d.startAt-now());primary={text:`SIGN-UP OPENS AT ${time(d.regOpensAt)}`,disabled:true}}
    else if(st==='registering'){countLabel='STARTS IN';count=clock(d.startAt-now());badge=mine?'YOU’RE IN':'SIGN-UP OPEN'}
    else if(st==='starting'){countLabel='STATUS';count='Drawing tables…';badge='STARTING'}
    else if(st==='running'){badge='LIVE';title='The freeroll is live';countLabel=d.lateReg?'LATE SIGN-UP CLOSES IN':'PLAYERS LEFT';count=d.lateReg?clock(d.lateRegEndsAt-now()):`${d.left} of ${d.entrants}`}
    else if(st==='finished'){badge='FINISHED';title=d.winner?`${d.winner.name} won tonight`:'Tonight’s freeroll is over';countLabel='NEXT FREEROLL';count=clock(d.nextStartAt-now())}
    else{badge='NOT RUNNING';title='No freeroll tonight';sub=d.note||'Not enough players signed up tonight.';countLabel='NEXT FREEROLL';count=clock(d.nextStartAt-now())}
    if(st==='finished'||st==='cancelled')sub=(d.note?d.note+' ':'')+`Next one: ${new Date(d.nextStartAt).toLocaleDateString([],{weekday:'long'})} at ${time(d.nextStartAt)}.`;
    if(!a){if(regOpen)primary={text:'SIGN IN TO PLAY',action:()=>show('profile')};else if(st!=='scheduled')primary=null}
    else if(mine&&mine.place!=null&&st==='running')primary={text:`YOU FINISHED ${ordinal(mine.place).toUpperCase()}`,disabled:true};
    else if(mine&&st==='running')primary=seating?{text:seating.table?`MOVING YOU TO TABLE ${seating.table}…`:'FINDING YOUR SEAT…',disabled:true}:inRoom()?{text:'BACK TO MY TABLE',action:()=>show('rooms')}:{text:`GO TO MY TABLE (${mine.table})`,action:()=>takeSeat(false)};
    else if(mine&&st==='registering'){primary={text:'YOU’RE REGISTERED',disabled:true,done:true};secondary={text:confirmDrop?'TAP AGAIN TO UNREGISTER':'UNREGISTER',action:()=>{if(!confirmDrop){confirmDrop=true;render();return}confirmDrop=false;act('/api/freeroll/unregister','You are no longer registered.')}}}
    else if(!mine&&regOpen){const full=d.entrants>=d.cap;primary=full?{text:'FULL TONIGHT',disabled:true}:{text:st==='running'?'LATE REGISTER':'REGISTER',action:()=>act('/api/freeroll/register',st==='running'?'You’re in. Taking you to your table…':'You’re registered. Be here at '+time(d.startAt)+'.').then(()=>{if(me()&&data.status==='running')takeSeat(false)})}}
    if(mine&&st==='finished'&&mine.place)sub=`You finished ${ordinal(mine.place)} of ${d.entrants}. `+sub;
    $('frlBadge').textContent=badge;$('frlBadge').dataset.state=st;
    $('frlTitle').textContent=title;
    const day=new Date(d.startAt).toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'});
    $('frlWhen').textContent=st==='finished'||st==='cancelled'||st==='running'?'':local?day:`${day} · ${time(d.startAt)} your time`;
    $('frlSub').textContent=sub;
    $('frlCountLabel').textContent=countLabel;$('frlCount').textContent=count;
    const b=$('frlAction');b.hidden=!primary;
    if(primary){b.textContent=primary.text;b.disabled=!!primary.disabled||busy;b.classList.toggle('done',!!primary.done);b.onclick=primary.action||null}
    const s=$('frlSecondary');s.hidden=!secondary;if(secondary){s.textContent=secondary.text;s.onclick=secondary.action}
  }
  function facts(){
    const d=data,st=d.status;
    const tiles=st==='running'&&d.level?[
      ['LEVEL',d.level.n],['BLINDS',`${chips(d.level.blinds[0])}/${chips(d.level.blinds[1])}`],['NEXT LEVEL',clock(d.level.nextAt-now()),`${chips(d.level.next[0])}/${chips(d.level.next[1])}`],
      ['AVERAGE STACK',chips(Math.round(d.entrants*d.structure.stack/Math.max(1,d.left)))]]
      :[['PLAYERS',`${d.entrants}/${d.cap}`],['STARTING CHIPS',chips(d.structure.stack)],['BLINDS UP',`every ${d.structure.levelMinutes} min`],['LATE SIGN-UP',`${d.structure.lateRegMinutes} min`]];
    $('frlFacts').innerHTML=tiles.map(([k,v,x])=>`<div><small>${k}</small><b>${esc(v)}</b>${x?`<em>${esc(x)}</em>`:''}</div>`).join('');
  }
  function standings(){
    const d=data,a=account(),list=$('frlList'),st=d.status;
    $('frlListTitle').textContent=st==='running'?'CHIP COUNTS':st==='finished'?'FINAL STANDINGS':'REGISTERED PLAYERS';
    $('frlListCount').textContent=d.players.length?`${d.players.length} ${d.players.length===1?'PLAYER':'PLAYERS'}`:'';
    if(!d.players.length){list.innerHTML=`<p class="frl-empty">${st==='scheduled'||st==='registering'?'Nobody has signed up yet. Be the first.':'Nobody played tonight.'}</p>`;return}
    let rank=0;
    list.innerHTML=d.players.map(p=>{
      const out=p.place!=null,pos=out?p.place:++rank,mine=a&&p.id===a.id,signup=st==='registering'||st==='scheduled'||st==='starting';
      const right=signup?'':out?(p.place===1&&st==='finished'?'<span class="frl-win">WINNER</span>':`<span class="frl-out">${st==='finished'?'':'OUT · '}${ordinal(p.place)}</span>`):`<b>${chips(p.stack)}</b><small>T${p.table}</small>`;
      return `<div class="frl-row${mine?' me':''}${out&&st!=='finished'?' busted':''}"><span class="frl-pos">${pos}</span><span class="frl-name">${esc(p.name)}${mine?' <i>YOU</i>':''}</span><span class="frl-right">${right}</span></div>`;
    }).join('');
  }
  function renderBoard(){
    if(!board)return;
    const month=new Date(board.month+'-15T12:00:00Z').toLocaleDateString([],{month:'long',timeZone:'UTC'});
    $('frlMonth').textContent=month.toUpperCase()+' POINTS';
    $('frlLeaders').innerHTML=board.leaders.length?board.leaders.map((p,i)=>`<div class="frl-row"><span class="frl-pos">${i+1}</span><span class="frl-name">${esc(p.name)}${p.wins?` <span class="frl-cups" title="${p.wins} ${p.wins===1?'win':'wins'}">${'★'.repeat(Math.min(5,p.wins))}</span>`:''}</span><span class="frl-right"><b>${p.points}</b><small>PTS</small></span></div>`).join('')
      :'<p class="frl-empty">No results yet this month. Win a freeroll to top the table.</p>';
    $('frlChamps').innerHTML=board.champions.length?board.champions.map(c=>`<div class="frl-row"><span class="frl-pos">★</span><span class="frl-name">${esc(c.name)}</span><span class="frl-right"><small>${new Date(c.night+'T12:00:00Z').toLocaleDateString([],{month:'short',day:'numeric',timeZone:'UTC'})} · ${c.entrants} players</small></span></div>`).join('')
      :'<p class="frl-empty">The first champion is still to be crowned.</p>';
  }
  function resultCard(){
    const el=$('frlResult');
    if(!result){el.hidden=true;return}
    el.hidden=false;
    const won=result.place===1;
    $('frlResultTitle').textContent=won?'YOU WON THE FREEROLL':result.place?`YOU FINISHED ${ordinal(result.place).toUpperCase()}`:'THE FREEROLL IS OVER';
    $('frlResultText').textContent=won?`Champion out of ${result.entrants} players. Your win is on the board below.`:result.place?`Out of ${result.entrants||data?.entrants||''} players. ${result.entrants?`That's ${result.entrants-result.place+1} points this month. `:''}Same time tomorrow night.`:(result.winner?`${result.winner} won tonight.`:'');
    el.classList.toggle('won',won);
  }
  function render(){
    const signedIn=!!account();
    $('frlSignedOutNote').hidden=signedIn;
    if(!data){$('frlBody').hidden=true;return}
    $('frlBody').hidden=false;
    hero();facts();standings();resultCard();
  }
  // Messages from the table: a move to another table, a knock-out, or the final result.
  function handle(message){
    show('freeroll');
    if(message.kind==='moved'){status(message.table?`Table balancing: you're moving to table ${message.table}.`:'Finding your new seat…',true);takeSeat(true);return}
    result=message.kind==='out'||message.kind==='finished'?{kind:message.kind,place:message.place,entrants:message.entrants,winner:message.winner}:null;
    status('');load();loadBoard();
  }
  function open(){status('');confirmDrop=false;load();loadBoard();clearInterval(tick);tick=setInterval(()=>{if(!$('freeroll').classList.contains('active')){clearInterval(tick);return}if(data){hero();if(data.status==='running')facts()}},1000)}
  document.querySelectorAll('[data-view="freeroll"]').forEach(b=>b.addEventListener('click',open));
  document.addEventListener('visibilitychange',()=>{if(active())load()});
  $('frlSignIn')?.addEventListener('click',e=>{e.preventDefault();show('profile')});
  window.rivlFreeroll={handle,refresh:open};
  // Check once on page load so a registered player who opens the site at 9 PM is taken to their table.
  if(API)setTimeout(()=>{if(account())load()},1500);
})();
