/* RIVL online account: a name plus a private sign-in code (no email or password), and the online leaderboard. */
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
      $('accountRating').textContent=a.games?`Online rating ${a.rating.toLocaleString()} (±${a.rd})${a.rank?' · #'+a.rank+' on the leaderboard':''} · ${a.games} rated ${a.games===1?'match':'matches'}`:'No rated matches yet';
      $('accountKey').textContent=a.key;
    }
    if($('accountHint'))$('accountHint').innerHTML=a?`Signed in as <b></b>. Matches with 2+ signed-in players are rated.`:`Playing as a guest. <a href="#" id="goSignIn">Sign in or create an account</a> to play rated matches.`;
    if(a&&$('accountHint'))$('accountHint').querySelector('b').textContent=a.name;
    $('goSignIn')?.addEventListener('click',e=>{e.preventDefault();show('profile');$('accountName')?.focus()});
    window.rivlPaintName?.();
    window.refreshRatingUI?.();
  }
  function setAccount(account,key){state=account?{...account,key}:null;persist();render()}
  async function refresh(){
    if(!state)return;
    try{const {account}=await call('/api/me',{key:state.key});setAccount(account,state.key)}
    catch(e){if(e.status===401){setAccount(null);status('That sign-in code no longer works. Sign in again.')}}
  }
  window.rivlAccount={current:()=>state,key:()=>state?.key||null,refresh,call};

  async function loadLeaderboard(){
    const rows=$('onlineRows');if(!rows)return;
    try{
      const {players,total}=await call('/api/leaderboard');
      rows.replaceChildren();
      if(!players.length){rows.innerHTML='<p class="muted">No rated matches yet. Play a room match with another signed-in player to appear here.</p>';return}
      players.forEach((p,i)=>{
        const row=document.createElement('div');row.className='online-row'+(state&&p.id===state.id?' me':'');
        for(const v of [i+1,p.name+(p.provisional?' ?':''),p.rating.toLocaleString(),'±'+p.rd,p.games,p.wins]){const c=document.createElement('span');c.textContent=v;row.append(c)}
        rows.append(row);
      });
      if(total>players.length){const more=document.createElement('p');more.className='muted';more.textContent=`Top ${players.length} of ${total} rated players. "?" marks a provisional rating.`;rows.append(more)}
    }catch(e){rows.innerHTML='';const p=document.createElement('p');p.className='muted';p.textContent=e.message;rows.append(p)}
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
    $('accountSignOut')?.addEventListener('click',()=>{if(confirm('Sign out on this device? You will need your sign-in code to sign back in.')){setAccount(null);status('Signed out.')}});
    document.querySelectorAll('.nav[data-view="leaderboard"]').forEach(b=>b.addEventListener('click',loadLeaderboard));
    document.querySelectorAll('.nav[data-view="profile"]').forEach(b=>b.addEventListener('click',refresh));
    loadLeaderboard();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
