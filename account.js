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
  function setAccount(account,key,via){state=account?{...account,key,via:via||state?.via||'code'}:null;persist();render()}
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

  // Ranked leaderboard: "My league" (signed in) or the global top 50.
  let board=null;
  async function loadLeaderboard(){
    const rows=$('onlineRows');if(!rows)return;
    const mine=$('lbMine'),top=$('lbTop');
    if(mine)mine.hidden=!state;
    if(!state||!board)board=state?'mine':'top';
    mine?.setAttribute('aria-pressed',String(board==='mine'));top?.setAttribute('aria-pressed',String(board==='top'));
    const note=text=>{const p=document.createElement('p');p.className='muted';p.textContent=text;rows.append(p)};
    try{
      const data=board==='mine'?await call('/api/leaderboard/league?r='+state.rating+'&key='+encodeURIComponent(state.key)):await call('/api/leaderboard');
      const {players,total}=data;
      rows.replaceChildren();
      if(board==='mine'&&data.near&&players.length)note(`${data.league} has ${total} ${total===1?'player':'players'} so far. Showing the ${players.length} players nearest your Elo.`);
      if(!players.length){note('No ranked matches yet.');return}
      players.forEach((p,i)=>{
        const row=document.createElement('div');row.className='online-row'+(state&&p.id===state.id?' me':'');
        for(const v of [board==='mine'?p.rank:i+1,p.name,p.league,p.rating.toLocaleString(),'',p.games,p.wins]){const c=document.createElement('span');c.textContent=v;row.append(c)}
        window.rivlLeagueIcons?.decorate(row.children[1],p.leagueKey||window.RivlRating?.tier(p.rating).key,{prepend:true});
        row.children[2].className='league-'+p.leagueKey;
        rows.append(row);
      });
      if(board==='mine'&&!data.near&&total>players.length)note(`The ${players.length} of ${total} ${data.league} players nearest your Elo.`);
      if(board==='top'&&total>players.length)note(`Top ${players.length} of ${total} ranked players.`);
    }catch(e){rows.replaceChildren();note(e.message)}
  }

  function init(){
    render();refresh();
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
      if(google){call('/api/signout',{key:state.key}).catch(()=>{});try{window.google?.accounts.id.disableAutoSelect()}catch{}}
      setAccount(null);status('Signed out.');
    });
    document.querySelectorAll('.nav[data-view="leaderboard"]').forEach(b=>b.addEventListener('click',loadLeaderboard));
    $('lbMine')?.addEventListener('click',()=>{board='mine';loadLeaderboard()});
    $('lbTop')?.addEventListener('click',()=>{board='top';loadLeaderboard()});
    document.querySelectorAll('.nav[data-view="profile"]').forEach(b=>b.addEventListener('click',refresh));
    loadLeaderboard();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
