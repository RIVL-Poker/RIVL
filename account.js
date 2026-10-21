/* RIVL online account: Sign in with Google, or a name plus a private sign-in code, and the online leaderboard.
   Either way the browser keeps a key in localStorage, so the player stays signed in on later visits. */
(()=>{
  const KEY='rivlAccount';
  const $=id=>document.getElementById(id);
  const API=window.RIVL_ROOM_API||(()=>{try{return localStorage.getItem('rivlRoomApi')}catch{return null}})()||(/^https?:$/.test(location.protocol)?location.origin:'');
  let state=null;try{state=JSON.parse(localStorage.getItem(KEY)||'null')}catch{}
  const persist=()=>{try{state?localStorage.setItem(KEY,JSON.stringify(state)):localStorage.removeItem(KEY)}catch{}};
  async function call(path,body){
    if(!API)throw Error('Online features need the site to be opened from its web address.');
    const response=await fetch(API.replace(/\/$/,'')+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
    const data=await response.json().catch(()=>({error:'Online service unavailable right now ('+response.status+').'}));
    if(!response.ok)throw Object.assign(Error(data.error||'Request failed'),{status:response.status});
    return data;
  }
  const status=text=>{const el=$('accountStatus');if(el)el.textContent=text||''};
  function render(){
    const a=state;
    if($('accountSignedOut'))$('accountSignedOut').hidden=!!a;
    if($('accountSignedIn'))$('accountSignedIn').hidden=!a;
    if(a){
      $('accountTitle').textContent=a.name;
      $('accountRating').textContent=a.games?`Ranked Elo ${a.rating.toLocaleString()}${a.rank?' · #'+a.rank+' on the ladder':''} · ${a.games} ranked ${a.games===1?'match':'matches'}`:'Ranked Elo '+a.rating.toLocaleString()+' · no ranked matches yet';
      $('accountKey').textContent=a.key;
      // A Google sign-in key belongs to this device only, so it is not offered as a code to copy.
      const google=a.via==='google';
      if($('accountKeyNote'))$('accountKeyNote').textContent=google?'Signed in with Google. On another device, choose Sign in with Google.':a.google?'Google is connected. Your sign-in code still works too.':'Save your sign-in code. It is the only way into this account on another device, unless you connect Google below.';
      for(const id of ['accountShowKey','accountCopyKey'])if($(id))$(id).hidden=google;
      if(google&&$('accountKey'))$('accountKey').hidden=true;
      if($('accountGoogleLink'))$('accountGoogleLink').hidden=!!a.google;
    }
    if($('accountHint'))$('accountHint').innerHTML=a?`Signed in as <b></b>.`:`<a href="#" id="goSignIn">Sign in</a> to play Ranked.`;
    if(a&&$('accountHint'))$('accountHint').querySelector('b').textContent=a.name;
    $('goSignIn')?.addEventListener('click',e=>{e.preventDefault();show('profile');$('accountName')?.focus()});
    window.rivlPaintName?.();
    window.refreshRatingUI?.();
  }
  function setAccount(account,key,via){const was=state?.key;state=account?{...account,key,via:via||state?.via||'code'}:null;persist();render();if(state?.key!==was){onScreen();document.dispatchEvent(new Event('rivl:account'))}}
  // Presence for friends' "active now": a heartbeat every minute while this page is on screen, and a last
  // message when it's hidden or closed. A background tab or a locked phone sends nothing, so it drops off.
  // The reply carries game invites and friend requests, which friends.js shows (rivl:invites).
  const HEARTBEAT_MS=60*1000;let beat=null;
  // Guests send the same heartbeat to /api/ping, only to be counted in RIVL's player numbers. The visitor id is a
  // random id kept in this browser (no cookie, nothing personal), so a refresh or a second tab is still one player.
  let visitor='';
  try{visitor=localStorage.getItem('rivlVisitor')||''}catch{}
  if(!/^[A-Za-z0-9_-]{16,40}$/.test(visitor)){
    visitor=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[n%64]).join('');
    try{localStorage.setItem('rivlVisitor',visitor)}catch{}
  }
  // What the player is doing: seated at an online table (by its mode), bot practice, the puzzle, or anything else.
  function activity(){
    const room=window.rivlRooms?.mode?.();if(room)return room;
    const view=document.querySelector('.view.active')?.id;
    return view==='table'?'bots':view==='puzzle'?'puzzle':'browsing';
  }
  function presence(away){
    // Automated browsers (tests, load scripts) are not players: a guest one sends nothing, a signed-in one only friends' presence.
    if(!API||(!state&&navigator.webdriver))return;
    const info=away?{visitor,away:true}:{visitor,activity:activity(),automated:!!navigator.webdriver||undefined};
    const url=API.replace(/\/$/,'')+(state?'/api/presence':'/api/ping'),body=JSON.stringify(state?{key:state.key,...info}:info);
    if(away&&navigator.sendBeacon){try{if(navigator.sendBeacon(url,body))return}catch{}}
    // A plain-text body keeps this a simple request; the server reads it as JSON either way.
    fetch(url,{method:'POST',body,keepalive:true}).then(r=>r.ok?r.json():null)
      .then(d=>{if(!away&&d&&state)document.dispatchEvent(new CustomEvent('rivl:invites',{detail:{invites:d.invites,requests:d.requests}}))}).catch(()=>{});
  }
  function onScreen(){
    clearInterval(beat);beat=null;
    if(document.visibilityState!=='visible')return presence(true);
    presence();beat=setInterval(()=>{if(document.visibilityState==='visible')presence()},HEARTBEAT_MS);
  }
  // Google: the page hands the ID token to our server, which verifies it with Google before signing in.
  // A first-time Google player gets {needsName:true} and sends the same token back with a table name.
  async function google(credential,name){
    const linking=!!state;
    const data=await call('/api/google',{credential,name:name??undefined,key:state?.key});
    if(data.needsName)return data;
    setAccount(data.account,data.key,linking?state.via:'google');
    return data;
  }
  async function refresh(){
    if(!state)return;
    try{const {account}=await call('/api/me',{key:state.key});setAccount(account,state.key)}
    catch(e){if(e.status===401){setAccount(null);status('That sign-in code no longer works. Sign in again.')}}
  }
  window.rivlAccount={current:()=>state,key:()=>state?.key||null,refresh,call,google,setAccount,reportAvatar:async(targetId,reason)=>{if(!state)throw Error('Sign in to report photos.');return call('/api/report-avatar',{key:state.key,targetId,reason})},updateAvatar:async avatar=>{if(!state)throw Error('Sign in to save a profile picture.');const {account}=await call('/api/avatar',{key:state.key,avatar});setAccount(account,state.key);return account}};

  // One global ranked Elo leaderboard, independent of the viewer's league.
  async function loadLeaderboard(){
    const rows=$('onlineRows');if(!rows)return;
    rows.replaceChildren();
    try{
      const data=await call('/api/leaderboard');
      const players=Array.isArray(data.players)?data.players:[];
      if(!players.length){const p=document.createElement('p');p.className='muted';p.textContent='No ranked matches yet.';rows.append(p);return}
      players.forEach((p,i)=>{
        const row=document.createElement('div');
        row.className='online-row'+(state&&p.id===state.id?' me':'');
        const cells=[i+1,p.name,p.league,Number(p.rating||0).toLocaleString(),p.games??0,p.wins??0];
        for(const value of cells){const cell=document.createElement('span');cell.textContent=value;row.append(cell)}
        window.rivlLeagueIcons?.decorate(row.children[1],p.leagueKey||window.RivlRating?.tier(p.rating).key,{prepend:true});
        row.children[2].className='league-'+p.leagueKey;
        rows.append(row);
      });
    }catch(err){const p=document.createElement('p');p.className='muted';p.textContent=err.message;rows.replaceChildren(p)}
  }


  let historyGames=[],historyFilter='All';
  const historyDate=t=>new Date(t).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  const historyNumber=n=>n==null?'—':Number(n).toLocaleString();
  async function showHistoryGame(id,container){
    const panel=container.querySelector('.rivl-history-detail');
    if(!panel)return;
    if(!panel.hidden){panel.hidden=true;return}
    panel.hidden=false;panel.textContent='Loading player results…';
    try{
      const data=await call('/api/history/game?id='+encodeURIComponent(id));
      panel.replaceChildren();
      const header=document.createElement('div');header.className='rivl-history-player rivl-history-player-head';
      for(const text of ['PLACE','PLAYER','FINAL CHIPS','ACCURACY','DECISIONS','ELO +/-']){const cell=document.createElement('span');cell.textContent=text;header.append(cell)}
      panel.append(header);
      // In a game you played, every other player gets a friend button (friendButton below).
      const mine=!!state&&(data.players||[]).some(p=>p.id===state.id);
      for(const p of data.players||[]){
        const row=document.createElement('div');row.className='rivl-history-player';
        const cells=[p.place===1?'♛ 1st':'#'+p.place,p.name,historyNumber(p.chips),p.accuracy==null?'—':Number(p.accuracy).toFixed(1)+'%',p.decisions||'—',p.elo_change==null?'—':(p.elo_change>0?'+':'')+p.elo_change];
        for(const value of cells){const cell=document.createElement('span');cell.textContent=value;row.append(cell)}
        if(mine&&p.id){const add=document.createElement('button');add.type='button';add.className='rivl-history-add';add.dataset.id=p.id;add.dataset.game=id;row.children[1].append(add);paintFriendButton(add)}
        if(p.place===1)row.classList.add('rivl-history-winner');
        panel.append(row);
      }
    }catch(err){panel.textContent=err.message||'Could not load match details.'}
  }
  // The friend button on a Match History player: YOU, FRIENDS, REQUESTED, ACCEPT (they asked you) or ADD FRIEND.
  function paintFriendButton(b){
    const fr=window.rivlFriends?.data?.(),id=b.dataset.id;
    if(!fr){b.hidden=true;window.rivlFriends?.load();return}
    const relation=id===state?.id?'you':fr.friends.some(f=>f.id===id)?'friends':fr.outgoing?.includes(id)?'requested':fr.incoming?.some(f=>f.id===id)?'accept':'add';
    b.hidden=relation==='you';b.disabled=relation==='friends'||relation==='requested';
    b.textContent={friends:'FRIENDS ✓',requested:'REQUESTED',accept:'ACCEPT REQUEST',add:'+ ADD FRIEND'}[relation]||'';
    b.className='rivl-history-add'+(relation==='add'||relation==='accept'?' gold':'');
    b.onclick=async()=>{b.disabled=true;b.textContent='SENDING…';
      const r=await(relation==='accept'?window.rivlFriends.accept(id):window.rivlFriends.request(id,b.dataset.game));
      if(!r){b.disabled=false;b.textContent='TRY AGAIN';b.title=window.rivlFriends.status?.()||''}};
  }
  document.addEventListener('rivl:friends',()=>document.querySelectorAll('.rivl-history-add').forEach(paintFriendButton));
  function paintHistory(){
    const root=$('historyGames');if(!root)return;
    root.replaceChildren();
    const games=historyGames.filter(g=>historyFilter==='All'||g.mode===historyFilter);
    if(!games.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No completed '+(historyFilter==='All'?'online matches':historyFilter.toLowerCase()+' games')+' saved yet.';root.append(empty);return}
    for(const g of games){
      const card=document.createElement('div');card.className='rivl-history-game';
      const toggle=document.createElement('button');toggle.type='button';toggle.className='rivl-history-game-toggle';toggle.setAttribute('aria-label','Show results for '+g.mode+' match');
      const meta=document.createElement('div');meta.className='rivl-history-game-main';
      const mode=document.createElement('strong');mode.textContent=g.mode.toUpperCase()+' · '+g.players+' PLAYERS';
      const when=document.createElement('small');when.textContent=historyDate(g.t);
      meta.append(mode,when);
      const stats=document.createElement('div');stats.className='rivl-history-game-stats';
      const winner=document.createElement('span');winner.textContent='♛ '+g.winner;
      const duration=document.createElement('span');duration.textContent=g.duration?Math.round(g.duration/60000)+' MIN':'— MIN';
      const hands=document.createElement('span');hands.textContent=g.hands?g.hands+' HANDS':'— HANDS';
      const arrow=document.createElement('span');arrow.textContent='⌄';arrow.className='rivl-history-arrow';
      stats.append(winner,duration,hands,arrow);toggle.append(meta,stats);
      const detail=document.createElement('div');detail.className='rivl-history-detail';detail.hidden=true;
      toggle.addEventListener('click',()=>{const opening=detail.hidden;showHistoryGame(g.id,card);toggle.setAttribute('aria-expanded',String(opening))});
      toggle.setAttribute('aria-expanded','false');
      card.append(toggle,detail);root.append(card);
    }
  }
  async function loadHistory(){
    const root=$('historyGames');if(!root)return;
    try{const data=await call('/api/history');historyGames=Array.isArray(data.games)?data.games:[];paintHistory()}
    catch(err){root.textContent=err.message||'Unable to load match history.'}
  }
  function initHistory(){
    $('historyRefresh')?.addEventListener('click',loadHistory);
    document.querySelectorAll('[data-history-filter]').forEach(b=>b.addEventListener('click',()=>{
      historyFilter=b.dataset.historyFilter;
      document.querySelectorAll('[data-history-filter]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b))});
      paintHistory();
    }));
    document.querySelectorAll('.nav[data-view="leaderboard"]').forEach(b=>b.addEventListener('click',loadHistory));
    loadHistory();
  }

  function init(){
    render();refresh();onScreen();
    document.addEventListener('visibilitychange',onScreen);
    window.addEventListener('pagehide',()=>presence(true));
    $('accountCreate')?.addEventListener('click',async()=>{
      try{status('Creating your account…');const {account,key}=await call('/api/accounts',{name:$('accountName').value});setAccount(account,key);
        $('accountKey').hidden=false;$('accountShowKey').textContent='HIDE CODE';status('Account created. Copy your sign-in code now and keep it somewhere safe.')}
      catch(e){status(e.message)}
    });
    $('accountSignIn')?.addEventListener('click',async()=>{
      const key=$('accountKeyInput').value.trim();
      try{status('Signing in…');const {account}=await call('/api/me',{key});setAccount(account,key);$('accountKeyInput').value='';status('Signed in as '+account.name+'.')}
      catch(e){status(e.message)}
    });
    $('accountShowKey')?.addEventListener('click',()=>{const k=$('accountKey');k.hidden=!k.hidden;$('accountShowKey').textContent=k.hidden?'SHOW CODE':'HIDE CODE'});
    $('accountCopyKey')?.addEventListener('click',()=>navigator.clipboard?.writeText(state?.key||'').then(()=>status('Sign-in code copied.'),()=>{$('accountKey').hidden=false;status('Select the code to copy it.')}));
    $('accountSignOut')?.addEventListener('click',()=>{
      const google=state?.via==='google';
      if(!confirm(google?'Sign out on this device? You can sign back in with Google.':'Sign out on this device? You will need your sign-in code to sign back in.'))return;
      presence(true);
      if(google){call('/api/signout',{key:state.key}).catch(()=>{});try{window.google?.accounts.id.disableAutoSelect()}catch{}}
      setAccount(null);status('Signed out.');
    });
    document.querySelectorAll('.nav[data-view="leaderboard"]').forEach(b=>b.addEventListener('click',loadLeaderboard));
    document.querySelectorAll('.nav[data-view="profile"]').forEach(b=>b.addEventListener('click',refresh));
    loadLeaderboard();
    initHistory();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
