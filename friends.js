/* RIVL friends: every account has a public friend code (never the secret sign-in code). Share yours, enter a
   friend's to add each other, and see their league, Elo, when they were last on and their daily puzzle streak.
   A link like rivlpoker.com/?friend=ABCD2345 opens this page with the code filled in. */
(()=>{
  const $=id=>document.getElementById(id);
  if(!$('friends'))return;
  const ACTIVE_MS=5*60*1000;
  let data=null,busy=false,poll=null,confirmId=null;
  const account=()=>window.rivlAccount?.current?.()||null;
  const status=(t,ok)=>{const el=$('frStatus');el.textContent=t||'';el.classList.toggle('ok',!!ok)};
  const pretty=code=>code?code.slice(0,4)+'-'+code.slice(4):'';
  const link=code=>`${location.origin.startsWith('http')?location.origin:'https://rivlpoker.com'}/?friend=${code}`;
  function ago(t){
    if(!t)return 'Not seen yet';
    const d=Date.now()-t;
    if(d<ACTIVE_MS)return 'Active now';
    const m=Math.round(d/60000),h=Math.round(d/3600000),days=Math.round(d/86400000);
    return 'Active '+(m<60?m+' min ago':h<24?h+(h===1?' hour':' hours')+' ago':days+(days===1?' day':' days')+' ago');
  }
  function avatar(f){
    const el=document.createElement('span');el.className='fr-avatar';
    if(f.avatar&&/^data:image\//.test(f.avatar)){const img=document.createElement('img');img.src=f.avatar;img.alt='';el.append(img)}
    else el.textContent=(f.name||'?')[0].toUpperCase();
    return el;
  }
  function render(){
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
      const active=f.lastSeen&&Date.now()-f.lastSeen<ACTIVE_MS;
      const pic=avatar(f);if(active)pic.classList.add('online');
      const main=document.createElement('div');main.className='fr-main';
      const name=document.createElement('strong');name.textContent=f.name;
      const meta=document.createElement('span');meta.className='fr-meta';
      const league=document.createElement('span');league.className='fr-league league-'+f.leagueKey;league.textContent=`${f.league} · ${Number(f.rating||0).toLocaleString()} Elo`;
      window.rivlLeagueIcons?.decorate(league,f.leagueKey,{prepend:true});
      const seen=document.createElement('span');seen.className='fr-seen'+(active?' on':'');seen.textContent=ago(f.lastSeen);
      meta.append(league,seen);
      const puzzle=document.createElement('span');puzzle.className='fr-puzzle';
      puzzle.textContent=(f.solvedToday?'◆ Solved today’s puzzle':'◆ Hasn’t played today’s puzzle')+(f.puzzleStreak?` · ${f.puzzleStreak}-day streak`:'');
      main.append(name,meta,puzzle);
      const remove=document.createElement('button');remove.type='button';remove.className='outline fr-remove';
      remove.textContent=confirmId===f.id?'CONFIRM REMOVE':'REMOVE';
      remove.onclick=()=>{if(confirmId!==f.id){confirmId=f.id;render();return}confirmId=null;act('/api/friends/remove',{id:f.id},`Removed ${f.name}.`)};
      row.append(pic,main,remove);list.append(row);
    }
  }
  async function act(path,extra,done){
    const acc=account();if(!acc||busy)return;busy=true;
    try{
      const r=await window.rivlAccount.call(path,{key:acc.key,...extra});
      data=r;render();
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
  $('frSignIn')?.addEventListener('click',e=>{e.preventDefault();if(typeof show==='function')show('profile')});
  // Refresh when the page opens, and every minute while it stays open, so "active now" stays current.
  const open=()=>{status('');confirmId=null;load();clearInterval(poll);poll=setInterval(()=>{if($('friends').classList.contains('active'))load();else clearInterval(poll)},60000)};
  document.querySelectorAll('[data-view="friends"]').forEach(b=>b.addEventListener('click',open));
  // ?friend=CODE from an invite link: open Friends with the code ready to add.
  const invited=new URLSearchParams(location.search).get('friend');
  if(invited){
    $('frInput').value=invited.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
    window.history.replaceState(null,'',location.pathname); // window.: script.js has its own global named history
    setTimeout(()=>{if(typeof show==='function')show('friends');open();status(account()?'Press ADD FRIEND to add them.':'Sign in, then come back here to add your friend.')},0);
  }
})();
