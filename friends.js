/* RIVL friends: every account has a public friend code (never the secret sign-in code). Share yours, enter a
   friend's to add each other, and see their league, Elo, when they were last on and their daily puzzle streak.
   Friends has its own page in the sidebar. A link like rivlpoker.com/?friend=ABCD2345 opens it with the code filled in.
   From a casual room's lobby you can invite friends to it; they get a pop-up to join. From Match History you can
   send a friend request to someone you played with; they accept it on this page or from a pop-up. */
(()=>{
  const $=id=>document.getElementById(id);
  if(!$('friends'))return;
  let data=null,loadedAt=0,busy=false,poll=null,confirmId=null;
  const account=()=>window.rivlAccount?.current?.()||null;
  const status=(t,ok)=>{const el=$('frStatus');el.textContent=t||'';el.classList.toggle('ok',!!ok)};
  const pretty=code=>code?code.slice(0,4)+'-'+code.slice(4):'';
  const link=code=>`${location.origin.startsWith('http')?location.origin:'https://rivlpoker.com'}/?friend=${code}`;
  // The server says who is online right now and how long ago everyone else was on, measured on its own clock.
  function ago(f){
    if(f.online)return 'Active now';
    if(f.seenAgo==null)return 'Not seen yet';
    const d=f.seenAgo;
    const m=Math.max(1,Math.round(d/60000)),h=Math.round(d/3600000),days=Math.round(d/86400000);
    return 'Active '+(m<60?m+' min ago':h<24?h+(h===1?' hour':' hours')+' ago':days+(days===1?' day':' days')+' ago');
  }
  function avatar(f){
    const el=document.createElement('span');el.className='fr-avatar';
    if(f.avatar&&/^data:image\//.test(f.avatar)){const img=document.createElement('img');img.src=f.avatar;img.alt='';el.append(img)}
    else el.textContent=(f.name||'?')[0].toUpperCase();
    return el;
  }
  function render(){renderList();renderRequests();paintInvite();document.dispatchEvent(new Event('rivl:friends'))}
  // Requests waiting on your answer, above your friends list.
  function renderRequests(){
    const panel=$('frRequests'),list=$('frReqList');if(!panel)return;
    const incoming=account()&&data?.incoming||[];
    panel.hidden=!incoming.length;list.replaceChildren();
    $('frReqCount').textContent=incoming.length?`${incoming.length} WAITING`:'';
    for(const f of incoming){
      const row=document.createElement('div');row.className='fr-row';
      const main=document.createElement('div');main.className='fr-main';
      const name=document.createElement('strong');name.textContent=f.name;
      const league=document.createElement('span');league.className='fr-league league-'+f.leagueKey;league.textContent=`${f.league} · ${Number(f.rating||0).toLocaleString()} Elo`;
      window.rivlLeagueIcons?.decorate(league,f.leagueKey,{prepend:true});
      main.append(name,league);
      const yes=document.createElement('button');yes.type='button';yes.className='gold';yes.textContent='ACCEPT';yes.onclick=()=>accept(f);
      const no=document.createElement('button');no.type='button';no.className='outline';no.textContent='DECLINE';no.onclick=()=>act('/api/friends/decline',{id:f.id},`Declined ${f.name}'s request.`);
      const buttons=document.createElement('div');buttons.className='fr-req-actions';buttons.append(yes,no);
      row.append(avatar(f),main,buttons);list.append(row);
    }
  }
  const accept=f=>act('/api/friends/accept',{id:f.id},r=>`${r.added} is now your friend.`);
  function renderList(){
    const acc=account();
    $('frSignedOut').hidden=!!acc;$('frSignedIn').hidden=!acc;
    if(!acc||!data)return;
    $('frCode').textContent=pretty(data.code);
    const list=$('frList');list.replaceChildren();
    $('frCount').textContent=data.friends.length?`${data.friends.length} ${data.friends.length===1?'FRIEND':'FRIENDS'}`:'';
    if(!data.friends.length){
      const p=document.createElement('p');p.className='fr-empty';
      p.textContent='No friends yet. Send someone your code, or enter theirs above.';
      list.append(p);return;
    }
    for(const f of data.friends){
      const row=document.createElement('div');row.className='fr-row';
      const active=!!f.online;
      const pic=avatar(f);if(active)pic.classList.add('online');
      const main=document.createElement('div');main.className='fr-main';
      const name=document.createElement('strong');name.textContent=f.name;
      const meta=document.createElement('span');meta.className='fr-meta';
      const league=document.createElement('span');league.className='fr-league league-'+f.leagueKey;league.textContent=`${f.league} · ${Number(f.rating||0).toLocaleString()} Elo`;
      window.rivlLeagueIcons?.decorate(league,f.leagueKey,{prepend:true});
      const seen=document.createElement('span');seen.className='fr-seen'+(active?' on':'');seen.textContent=ago(f);
      meta.append(league,seen);
      const puzzle=document.createElement('span');puzzle.className='fr-puzzle';
      puzzle.textContent=(f.solvedToday?'◆ Solved today’s puzzle':'◆ Hasn’t played today’s puzzle')+(f.puzzleStreak?` · ${f.puzzleStreak}-day streak`:'');
      main.append(name,meta,puzzle);
      const remove=document.createElement('button');remove.type='button';remove.className='outline fr-remove';
      remove.textContent=confirmId===f.id?'CONFIRM REMOVE':'REMOVE';
      remove.onclick=()=>{if(confirmId!==f.id){confirmId=f.id;render();return}confirmId=null;act('/api/friends/remove',{id:f.id},`Removed ${f.name}.`)};
      // A friend seated at an online table can be watched as a spectator.
      const buttons=document.createElement('div');buttons.className='fr-row-actions';
      if(f.watchable){const w=document.createElement('button');w.type='button';w.className='gold fr-watch';w.textContent='👁 WATCH';w.title=`Watch ${f.name}’s table. Spectators never see hole cards unless they are shown at showdown.`;w.onclick=()=>watch(f,w);buttons.append(w)}
      buttons.append(remove);
      row.append(pic,main,buttons);list.append(row);
    }
  }
  async function watch(f,btn){
    const acc=account();if(!acc)return;btn.disabled=true;status('');
    try{
      const r=await window.rivlAccount.call('/api/watch',{key:acc.key,friend:f.id});
      // Leaving a bot match mid-hand ends it unrated, so ask first, the same as joining a friend's room.
      if(typeof game!=='undefined'&&game&&typeof confirmLeave==='function'){if(!confirmLeave())return;stop()}
      window.rivlRooms?.watch(r.room,f.id);
    }catch(e){status(e.message);if(e.status===404)load()}
    finally{btn.disabled=false}
  }
  async function act(path,extra,done){
    const acc=account();if(!acc||busy)return;busy=true;
    try{
      const r=await window.rivlAccount.call(path,{key:acc.key,...extra});
      data=r;loadedAt=Date.now();requests=requests.filter(q=>(r.incoming||[]).some(f=>f.id===q.id));render();showToast();
      if(done)status(typeof done==='function'?done(r):done,true);
      return r;
    }catch(e){status(e.message);if(e.status===401)window.rivlAccount.refresh?.()}
    finally{busy=false}
  }
  const load=()=>account()?act('/api/friends',{}):(render(),null);
  async function add(e){
    e?.preventDefault();
    const code=$('frInput').value.trim();
    if(!code){status('Enter a friend code first.');return}
    const r=await act('/api/friends/add',{code},r=>`${r.added} is now your friend.`);
    if(r)$('frInput').value='';
  }
  async function copy(text,msg){
    try{if(navigator.share&&matchMedia('(pointer:coarse)').matches){await navigator.share({text});return}await navigator.clipboard.writeText(text);status(msg,true)}
    catch{status('Copy this: '+text)}
  }
  $('frAdd').addEventListener('submit',add);
  $('frCopy').onclick=()=>data&&copy(pretty(data.code),'Friend code copied.');
  $('frShare').onclick=()=>data&&copy(`Add me as a friend on RIVL Poker: ${pretty(data.code)}\n${link(data.code)}`,'Invite copied. Paste it to a friend.');
  $('frNewCode').onclick=()=>{
    if($('frNewCode').dataset.confirm!=='1'){$('frNewCode').dataset.confirm='1';$('frNewCode').textContent='Sure? Your old code stops working.';return}
    $('frNewCode').dataset.confirm='';$('frNewCode').textContent='Get a new code';
    act('/api/friends/new-code',{},'You have a new friend code. Friends you already added stay.');
  };
  // Signed out: sign in on Profile, then come back.
  $('frSignIn')?.addEventListener('click',e=>{e.preventDefault();if(typeof show==='function')show('profile');$('accountPanel')?.scrollIntoView({block:'center'});$('accountName')?.focus({preventScroll:true})});
  // Refresh when Friends opens, and every minute while it stays open and on screen, so "active now" stays current.
  const onFriends=()=>$('friends').classList.contains('active');
  const open=()=>{status('');confirmId=null;load();clearInterval(poll);poll=setInterval(()=>{if(!onFriends())clearInterval(poll);else if(document.visibilityState==='visible')load()},60000)};
  document.addEventListener('rivl:view',e=>{if(e.detail==='friends')open()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&onFriends())load()});
  // Signing in or out shows or hides the friends list straight away.
  document.addEventListener('rivl:account',()=>{if(onFriends())load()});
  // Invite friends from a casual room's lobby, online friends first. The list is the same one the Friends page shows.
  const sent=new Set();let inviteRoom='';
  const inviteStatus=(t,ok)=>{const el=$('roomInviteStatus');el.textContent=t||'';el.classList.toggle('ok',!!ok)};
  function paintInvite(){
    const panel=$('roomInvite');if(!panel)return;
    const casual=!!window.rivlRooms?.casual?.();
    panel.hidden=!casual;if(!casual)return;
    const code=window.rivlRooms.code();
    if(code!==inviteRoom){inviteRoom=code;sent.clear();inviteStatus('')}
    const list=$('roomInviteList');list.replaceChildren();
    const note=text=>{const p=document.createElement('p');p.className='fr-empty';p.textContent=text;list.append(p)};
    if(!account())return note('Sign in on your Profile to invite friends.');
    if(!data)return note('Loading your friends…');
    if(!data.friends.length)return note('No friends yet. Add friends on the Friends page, then invite them here.');
    for(const f of [...data.friends].sort((a,b)=>b.online-a.online)){
      const row=document.createElement('div');row.className='room-invite-row';
      const pic=avatar(f);if(f.online)pic.classList.add('online');
      const main=document.createElement('div');main.className='fr-main';
      const name=document.createElement('strong');name.textContent=f.name;
      const seen=document.createElement('span');seen.className='fr-seen'+(f.online?' on':'');seen.textContent=ago(f);
      main.append(name,seen);
      const btn=document.createElement('button');btn.type='button';btn.className=sent.has(f.id)?'outline':'gold';
      btn.textContent=sent.has(f.id)?'INVITED ✓':'INVITE';btn.disabled=sent.has(f.id);
      btn.onclick=()=>invite(f,btn);
      row.append(pic,main,btn);list.append(row);
    }
  }
  async function invite(f,btn){
    const acc=account();if(!acc)return;btn.disabled=true;
    try{
      await window.rivlAccount.call('/api/friends/invite',{key:acc.key,id:f.id,code:window.rivlRooms.code()});
      sent.add(f.id);inviteStatus(f.online?`Invite sent to ${f.name}.`:`Invite sent. ${f.name} will see it if they open RIVL in the next 15 minutes.`,true);
    }catch(e){inviteStatus(e.message);btn.disabled=false}
    paintInvite();
  }
  // Keep the lobby's list current: load it when a casual lobby opens, then at most once a minute as the room updates.
  document.addEventListener('rivl:room',()=>{if(window.rivlRooms?.casual?.()&&account()&&!busy&&Date.now()-loadedAt>60000)load();else paintInvite()});

  // A friend's invite or a friend request: a pop-up over any page. Both arrive with the presence heartbeat.
  // Invites come first (JOIN / NO THANKS); requests offer ACCEPT / LATER, and LATER hides one until the next visit.
  let invites=[],requests=[],shown=null;const later=new Set();
  function showToast(){
    const t=$('inviteToast');if(!t)return;
    const inv=invites.find(i=>i.code!==window.rivlRooms?.code?.());
    shown=inv?{...inv,kind:'invite'}:(()=>{const q=requests.find(q=>!later.has(q.id));return q?{...q,kind:'request'}:null})();
    t.hidden=!shown;if(!shown)return;
    const req=shown.kind==='request';
    $('inviteToastWhat').textContent=req?'wants to be your friend':'invited you to a casual game';
    $('inviteToastJoin').textContent=req?'ACCEPT':'JOIN';$('inviteToastNo').textContent=req?'LATER':'NO THANKS';
    $('inviteToastName').textContent=shown.name;
    const pic=avatar(shown);$('inviteToastPic').replaceChildren(...pic.childNodes);
  }
  function dismiss(i){
    if(i.kind==='request'){later.add(i.id);showToast();return}
    invites=invites.filter(x=>x.from!==i.from);showToast();
    const acc=account();if(acc)window.rivlAccount.call('/api/friends/dismiss-invite',{key:acc.key,from:i.from}).catch(()=>{});
  }
  document.addEventListener('rivl:invites',e=>{
    invites=Array.isArray(e.detail?.invites)?e.detail.invites:[];
    const next=Array.isArray(e.detail?.requests)?e.detail.requests:[];
    // A new request also refreshes the list, so Friends and Match History show it straight away.
    if(next.some(q=>!requests.some(x=>x.id===q.id))&&!busy)load();
    requests=next;showToast();
  });
  document.addEventListener('rivl:account',()=>{invites=[];requests=[];later.clear();showToast()});
  $('inviteToastNo')?.addEventListener('click',()=>shown&&dismiss(shown));
  $('inviteToastJoin')?.addEventListener('click',()=>{
    const i=shown;if(!i)return;
    if(i.kind==='request'){requests=requests.filter(q=>q.id!==i.id);showToast();accept(i);return}
    // Leaving a bot match mid-hand ends it unrated, so ask first, the same as the sidebar does.
    if(typeof game!=='undefined'&&game&&typeof confirmLeave==='function'){if(!confirmLeave())return;stop()}
    dismiss(i);window.rivlRooms?.join(i.code);
  });

  // Match History asks for the friends list to decide each player's button, and sends requests through here.
  window.rivlFriends={
    data:()=>account()&&data||null,
    load:()=>{if(account()&&!busy&&Date.now()-loadedAt>15000)load()},
    request:(id,game)=>act('/api/friends/request',{id,game},r=>r.added?`${r.added} is now your friend.`:`Friend request sent to ${r.requested}.`),
    accept:id=>{const f=data?.incoming?.find(x=>x.id===id);return f&&accept(f)},
    status:()=>$('frStatus').textContent
  };

  // ?friend=CODE from an invite link: open Friends with the code ready to add.
  const invited=new URLSearchParams(location.search).get('friend');
  if(invited){
    $('frInput').value=invited.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
    window.history.replaceState(null,'',location.pathname); // window.: script.js has its own global named history
    setTimeout(()=>{if(typeof show==='function')show('friends');status(account()?'Press ADD FRIEND to add them.':'Sign in, then come back here to add your friend.')},0);
  }
})();
