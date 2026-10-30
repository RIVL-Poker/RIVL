/* Champion banners: a secret. Nothing about them shows anywhere until a player finds the vault in Support (the dot in
   the PLAY MONEY ONLY · 18+ heading is a keyhole) and opens it with the best hand in poker on its five dials. That
   unlocks all six banners. From then on:
   - opponents at online tables who wear a banner get a seat pill filled with its artwork, in its colour, at the
     pill's usual size; the reigning freeroll champion also gets a crown, a glow and a slow shine
   - hovering such a seat floats the full banner above it
   - the Profile gets a CHAMPION BANNERS panel: artwork, the one stat the banner shows (chip count, knockouts or the
     winning hand) and the freeroll night it comes from. The stats are the server's record of that night.
   Player cards (click a seat at an online table, or a name on the leaderboards) work for everyone; only their banner
   is hidden until the vault is open. The unlock is kept in this browser and, once signed in, on the account. */
(()=>{
  const $=id=>document.getElementById(id);
  const KEY='rivlBanners';
  const ARTS={dragon:{title:"Dragon's Hoard",c:'#ff3b2f'},throne:{title:'The Throne',c:'#f2c46d'},frost:{title:'Frost King',c:'#5cc8ff'},
    wolf:{title:'Moon Wolf',c:'#c561ff'},olympus:{title:'Olympus',c:'#f0c46a'},abyss:{title:'The Abyss',c:'#2fe0d0'}};
  const STATS={line:'CHIP COUNT',ko:'KNOCKOUTS',hand:'WINNING HAND'};
  const ROYAL=['T','J','Q','K','A'],RANKS=['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  const CROWN='<svg viewBox="0 0 60 48" aria-hidden="true"><path d="M6 44 L3 14 L17 26 L30 4 L43 26 L57 14 L54 44 Z"/></svg>';
  const SUIT={S:'♠',H:'♥',D:'♦',C:'♣'};
  const esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const art=k=>ARTS[k]||ARTS.throne;
  const img=k=>`url(assets/banners/${ARTS[k]?k:'throne'}.jpg)`;
  const account=()=>window.rivlAccount?.current?.()||null;
  const local=()=>{try{return localStorage.getItem(KEY)==='1'}catch{return false}};
  const unlocked=()=>local()||!!account()?.bannersUnlocked;
  const call=(path,body)=>window.rivlAccount.call(path,body);
  const ordinal=n=>n+(n%100>=11&&n%100<=13?'TH':['TH','ST','ND','RD'][n%10]||'TH');
  const nightDate=n=>n?new Date(n+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).toUpperCase():'';
  const clock=t=>new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}).toUpperCase();
  const photo=a=>/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a||'')&&a.length<=45000;
  // A player's own photo, or a practice bot's picture from assets/bots/.
  const avatarHTML=(p,name)=>photo(p)||/^assets\/bots\/[\w-]+\.jpg$/.test(p||'')?`<img src="${p}" alt="">`:esc((name||'?')[0].toUpperCase());

  /* ---------- the banner ---------- */
  // b: {art, stat, wins, night, place, entrants, detail:{series, kos, hand, start, end}}; who: {name, avatar}.
  function banner(b,who){
    const a=art(b.art),d=b.detail||null,gid='rbg'+Math.random().toString(36).slice(2,8);
    const sub=b.place===1?`${b.wins>1?b.wins+'× ':''}FREEROLL CHAMPION · ${nightDate(b.night)}`
      :b.place?`FREEROLL · ${ordinal(b.place)} OF ${b.entrants} · ${nightDate(b.night)}`:'CHAMPION BANNER';
    let extra='',row='';
    if(b.stat==='line'&&d?.series?.length>1){
      const s=d.series,max=Math.max(1,...s),last=s[s.length-1];
      const line=s.map((v,i)=>(i?'L':'M')+(i/(s.length-1)*100).toFixed(1)+' '+(30-28*Math.pow(v/max,.55)).toFixed(1)).join(' ');
      const endY=(30-28*Math.pow(last/max,.55))/30;
      extra=`<svg class="rb-line" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a.c}" stop-opacity=".45"/><stop offset="1" stop-color="${a.c}" stop-opacity="0"/></linearGradient></defs><path d="${line} L100 30 L0 30 Z" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="${a.c}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><path d="${line}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".8" vector-effect="non-scaling-stroke"/></svg>
        <span class="rb-dot" style="bottom:${(6+33*(1-endY)).toFixed(1)}%"></span>
        <div class="rb-end">${(b.place===1?last:max).toLocaleString()}<small>${b.place===1?`ALL ${b.entrants} STACKS`:'PEAK STACK'}</small></div>
        ${d.start&&d.end?`<div class="rb-cap">STACK · ${clock(d.start)} → ${clock(d.end)}</div>`:''}`;
    }
    if(b.stat==='ko'&&d){
      const k=d.kos||[],shown=k.slice(0,8),more=k.length-shown.length;
      row=`<div class="rb-row"><span class="rb-kos">${shown.map(n=>`<i>${esc(String(n)[0]?.toUpperCase()||'?')}</i>`).join('')}${more>0?`<i class="more">+${more}</i>`:''}</span><span class="rb-big">${k.length}</span><span class="rb-lab">${k.length===1?'KNOCKOUT':'KNOCKOUTS'}</span></div>`;
    }
    if(b.stat==='hand'&&d?.hand?.five){
      row=`<div class="rb-row"><span class="rb-cards">${d.hand.five.map(c=>`<span class="${/[HD]/.test(c[1])?'red':''}">${c[0]==='T'?'10':esc(c[0])}<i>${SUIT[c[1]]||''}</i></span>`).join('')}</span><span class="rb-lab">${esc(String(d.hand.name||'').toUpperCase())}</span></div>`;
    }
    return `<div class="rb" style="--rb-c:${a.c};--rb-img:${img(b.art)}" role="img" aria-label="${esc(who.name)}'s champion banner">
      <div class="rb-shade"></div>${extra}
      <div class="rb-plate"><div class="rb-av">${avatarHTML(who.avatar,who.name)}</div><div class="rb-txt">
        <div class="rb-orn"></div><div class="rb-name">${CROWN}<span>${esc(who.name)}</span></div>
        <div class="rb-sub">${sub}</div>${row}<div class="rb-orn"></div>
      </div></div></div>`;
  }

  /* ---------- banners of the players at a table ---------- */
  const cache=new Map(),STALE=5*60000;let champion=null,pending=new Set(),fetchTimer=null,lastSeats=null;
  function want(ids){
    const now=Date.now();
    for(const id of ids){const hit=cache.get(id);if(!hit||now-hit.t>STALE)pending.add(id)}
    if(!pending.size||fetchTimer)return;
    fetchTimer=setTimeout(async()=>{
      const ids=[...pending].slice(0,12);pending=new Set([...pending].slice(12));fetchTimer=null;
      for(const id of ids)cache.set(id,{t:Date.now(),b:cache.get(id)?.b||null});
      // A failed lookup is tried again in 15 seconds rather than leaving the seats plain for five minutes.
      try{const r=await call('/api/banners',{ids});champion=r.champion||null;for(const id of ids)cache.set(id,{t:Date.now(),b:r.banners?.[id]||null})}
      catch{for(const id of ids)cache.set(id,{t:Date.now()-STALE+15000,b:cache.get(id)?.b||null})}
      if(lastSeats?.isConnected)decorate(lastSeats);
      if(pending.size)want([]);
    },60);
  }
  // Called by rooms.js after it paints the opponents' seats.
  function decorate(container){
    lastSeats=container;
    if(!container)return;
    const seats=[...container.querySelectorAll('.rivl-pvp-seat[data-account]')];
    want(seats.map(el=>el.dataset.account));
    for(const el of seats){
      const id=el.dataset.account,b=cache.get(id)?.b,a=b&&art(b.art);
      el.classList.toggle('rb-seat',!!b);el.classList.toggle('rb-champ',!!b&&id===champion);
      if(b){el.style.setProperty('--rb-c',a.c);el.style.setProperty('--rb-img',img(b.art))}
      const av=el.querySelector('.avatar');
      if(av&&b&&id===champion&&!av.querySelector('.rb-crown')){const s=document.createElement('span');s.innerHTML=CROWN;const svg=s.firstChild;svg.classList.add('rb-crown');av.append(svg)}
    }
  }

  /* ---------- the Set Hands bots ---------- */
  // Called by script.js for each bot seat. k is the bot's artwork at the Set Hands table, or nothing at other bot
  // tables. Bots are not players with accounts, so their banners show to everyone, vault or not.
  function bot(el,name,k){
    const a=k&&ARTS[k];
    el.classList.toggle('rb-seat',!!a);
    if(a){el.dataset.banner=k;el.dataset.bot=name;el.style.setProperty('--rb-c',a.c);el.style.setProperty('--rb-img',img(k))}
    else if(el.dataset.banner){delete el.dataset.banner;delete el.dataset.bot;el.style.removeProperty('--rb-c');el.style.removeProperty('--rb-img')}
  }

  /* ---------- the hover banner ---------- */
  let float=null,hoverId='';
  const canHover=()=>matchMedia('(hover:hover) and (pointer:fine)').matches;
  function showFloat(el){
    const id=el.dataset.account||'bot:'+el.dataset.bot,b=el.dataset.account?cache.get(id)?.b:el.dataset.banner&&{art:el.dataset.banner};
    if(!b||document.querySelector(".rb-card[open]"))return hideFloat();
    float||=Object.assign(document.createElement('div'),{className:'rb-float'});
    if(!float.isConnected)document.body.append(float);
    if(hoverId!==id){const name=el.dataset.bot||el.querySelector('.rivl-seat-label b')?.textContent||b.name;float.innerHTML=banner(b,{name,avatar:el.dataset.bot?window.rivlBotAvatars?.photo(el.dataset.bot):el.querySelector('.avatar img')?.src||''});hoverId=id}
    const r=el.getBoundingClientRect(),w=float.offsetWidth||340,x=Math.min(innerWidth-w/2-8,Math.max(w/2+8,r.left+r.width/2));
    float.style.left=x+'px';float.style.top=Math.max(float.offsetHeight+8,r.top-8)+'px';
    requestAnimationFrame(()=>float.classList.add('on'));
  }
  function hideFloat(){if(float){float.classList.remove('on')}hoverId=''}
  document.addEventListener('pointerover',e=>{
    if(!canHover())return;
    const el=e.target.closest?.('#roomGame .rivl-pvp-seat.rb-seat,#table .seat.rb-seat');
    if(el)showFloat(el);else if(hoverId)hideFloat();
  });
  addEventListener('scroll',hideFloat,{passive:true});

  /* ---------- player cards ---------- */
  let dialog=null;
  function cardShell(){
    if(dialog)return dialog;
    dialog=document.createElement('dialog');dialog.className='rb-card';dialog.setAttribute('aria-label','Player');
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
    document.body.append(dialog);return dialog;
  }
  async function openCard(id){
    if(!id)return;hideFloat();
    const d=cardShell();d.innerHTML='<div class="rb-card-body"><p class="rb-card-status">Loading player…</p></div>';
    if(!d.open)d.showModal();
    let data;
    try{data=await call('/api/player',{id,key:window.rivlAccount?.key()||undefined})}
    catch(e){d.innerHTML=`<div class="rb-card-body"><p class="rb-card-status">${esc(e.message||'Could not load that player.')}</p><div class="rb-card-btns"><button type="button" class="outline" data-close>CLOSE</button></div></div>`;d.querySelector('[data-close]').onclick=()=>d.close();return}
    const p=data.player,fr=data.freeroll||{},b=data.banner||null;
    const head=b?banner(b,{name:p.name,avatar:p.avatar}):`<div class="rb-card-head"><span class="rb-card-av">${avatarHTML(p.avatar,p.name)}</span><h2>${esc(p.name)}</h2></div>`;
    const pills=[data.champion?'<span class="rb-pill champ">★ FREEROLL CHAMPION</span>':'',p.league?`<span class="rb-pill">${esc(p.league.toUpperCase())} LEAGUE</span>`:''].join('');
    const friend={add:'+ ADD FRIEND',accept:'ACCEPT REQUEST',requested:'REQUESTED',friends:'FRIENDS ✓'}[data.relation];
    d.innerHTML=`<div class="rb-card-body">${head}
      <div class="rb-card-meta"><div class="rb-pills">${pills}</div><div class="rb-elo">${Number(p.rating||0).toLocaleString()}<small>Ranked Elo${p.rank?' · #'+p.rank:''}</small></div></div>
      <div class="rb-tiles"><div><small>RANKED MATCHES</small><b>${p.games||0}</b></div><div><small>RANKED WINS</small><b>${p.wins||0}</b></div><div><small>FREEROLL WINS</small><b>${fr.wins||0}</b></div><div><small>MONTH POINTS</small><b>${fr.points||0}</b></div></div>
      <p class="rb-card-status" role="status"></p>
      <div class="rb-card-btns">${friend?`<button type="button" class="${data.relation==='add'||data.relation==='accept'?'gold':'outline'}" data-friend ${data.relation==='add'||data.relation==='accept'?'':'disabled'}>${friend}</button>`:''}<button type="button" class="outline" data-close>CLOSE</button></div></div>`;
    d.querySelector('[data-close]').onclick=()=>d.close();
    const fb=d.querySelector('[data-friend]');
    if(fb)fb.onclick=async()=>{
      fb.disabled=true;fb.textContent='SENDING…';
      const ok=await(data.relation==='accept'?window.rivlFriends?.accept(id):window.rivlFriends?.request(id,data.game));
      fb.textContent=ok?(data.relation==='accept'?'FRIENDS ✓':'REQUESTED'):'TRY AGAIN';if(!ok)fb.disabled=false;
      d.querySelector('.rb-card-status').textContent=window.rivlFriends?.status?.()||'';
    };
  }
  // Seats at online tables, and names on the Ranked and freeroll leaderboards.
  document.addEventListener('click',e=>{
    if(e.target.closest('button,a'))return;
    const seat=e.target.closest('#roomGame .rivl-pvp-seat[data-account]'),named=e.target.closest('[data-player]');
    const id=seat?.dataset.account||named?.dataset.player;
    if(id)openCard(id);
  });

  /* ---------- the vault ---------- */
  const dials=[0,0,0,0,0];
  function paintVault(){
    const v=$('rbVault');if(!v)return;
    const open=unlocked();v.classList.toggle('open',open);
    $('rbDials').innerHTML=(open?ROYAL:dials.map(i=>RANKS[i])).map((r,i)=>`<button type="button" class="rb-dial" data-dial="${i}" ${open?'disabled':''} aria-label="Dial ${i+1}: ${r==='T'?'10':r}">${r==='T'?'10':r}<i>♠</i></button>`).join('');
    $('rbVaultHint').hidden=open;
    const shown=$('rbVaultOpen');shown.hidden=!open;
    if(open)shown.innerHTML=`<h4>CHAMPION BANNERS UNLOCKED</h4><p class="rb-note">All six banners are yours. Pick one on your Profile and it shows at every online table, built from your own freeroll nights.</p>
      <p class="rb-note" id="rbSync">${esc(syncNote())}</p>
      <div class="rb-vault-arts">${Object.entries(ARTS).map(([k,a])=>`<span style="--rb-img:${img(k)};--rb-c:${a.c}" title="${esc(a.title)}"></span>`).join('')}</div>
      <div><button type="button" class="gold" id="rbChoose">CHOOSE YOUR BANNER</button></div>`;
    $('rbChoose')?.addEventListener('click',()=>{if(typeof show==='function')show('profile');setTimeout(()=>$('rbPanel')?.scrollIntoView({block:'start',behavior:'smooth'}),60)});
  }
  // Other players only see a banner the server has, so the unlock must reach the account. The vault says whether it did.
  let syncError='';
  async function syncUnlock(){
    const key=window.rivlAccount?.key();
    if(!key||account()?.bannersUnlocked){syncError='';return}
    try{await call('/api/banners/save',{key,unlock:true});syncError='';await window.rivlAccount.refresh()}
    catch(e){syncError=e.message||'Could not reach RIVL.'}
  }
  function syncNote(){
    if(account()?.bannersUnlocked)return 'Saved to your account, so other players see your banner and your other devices have it too.';
    if(!window.rivlAccount?.key())return 'Only on this device for now. Sign in and they move to your account.';
    return 'Not saved to your account yet'+(syncError?' ('+syncError+')':'')+'. Open the vault again to retry.';
  }
  async function unlock(){
    try{localStorage.setItem(KEY,'1')}catch{}
    paintVault();await syncUnlock();paintVault();paintPanel();
  }
  function setupVault(){
    const hole=$('rbKeyhole'),v=$('rbVault');if(!hole||!v)return;
    hole.addEventListener('click',async()=>{v.hidden=!v.hidden;if(!v.hidden){paintVault();v.scrollIntoView({block:'nearest',behavior:'smooth'});if(local()){await syncUnlock();paintVault()}}});
    $('rbDials').addEventListener('click',e=>{
      const b=e.target.closest('[data-dial]');if(!b||unlocked())return;
      const i=+b.dataset.dial;dials[i]=(dials[i]+1)%RANKS.length;paintVault();$('rbDials').querySelector(`[data-dial="${i}"]`)?.focus();
      const set=dials.map(x=>RANKS[x]);
      if(ROYAL.every(r=>set.includes(r)))unlock();
    });
  }

  /* ---------- Profile: CHAMPION BANNERS ---------- */
  let mine=null,saving=null;
  async function loadMine(){
    const key=window.rivlAccount?.key();mine=null;
    if(key&&unlocked()){
      try{
        mine=await call('/api/banners/me',{key});
        // Unlocked here before signing in: the account takes the unlock too.
        if(!mine.unlocked){mine=await call('/api/banners/save',{key,unlock:true});window.rivlAccount.refresh()}
      }catch{mine=null}
    }
    paintPanel();
  }
  function paintPanel(){
    const panel=$('rbPanel');if(!panel)return;
    panel.hidden=!unlocked();if(panel.hidden)return;
    const me=account(),key=window.rivlAccount?.key();
    if(!key){panel.innerHTML='<h3>♠ CHAMPION BANNERS</h3><p class="rb-note">Sign in to wear a banner at the tables. It keeps your unlock on every device.</p>';return}
    if(!mine){panel.innerHTML='<h3>♠ CHAMPION BANNERS</h3><p class="rb-note">Loading your banner…</p>';return}
    const prefs=mine.prefs||{art:'throne',stat:'line',night:''},b=mine.banner||{art:prefs.art,stat:prefs.stat};
    const nights=mine.nights||[];
    const missing=!b.detail?'Your banner fills in with your freeroll nights: play one to add your stack line, knockouts and, once you win, the winning hand.'
      :prefs.stat==='hand'&&!b.detail.hand?'The winning hand shows on a night you won. Pick a win, or another stat.':'';
    panel.innerHTML=`<h3>♠ CHAMPION BANNERS</h3>${banner(b,{name:me?.name||'You',avatar:me?.avatar})}
      <div class="rb-panel-grid">
        <div><p class="rb-label">ARTWORK</p><div class="rb-arts">${Object.entries(ARTS).map(([k,a])=>`<button type="button" class="rb-art" data-art="${k}" aria-pressed="${k===prefs.art}" aria-label="${esc(a.title)}" title="${esc(a.title)}" style="--rb-img:${img(k)};--rb-c:${a.c}"></button>`).join('')}</div></div>
        <div><p class="rb-label">SHOW ON MY BANNER</p><div class="rb-choices">${Object.entries(STATS).map(([k,l])=>`<button type="button" data-stat="${k}" aria-pressed="${k===prefs.stat}">${l}</button>`).join('')}</div>
          ${nights.length?`<p class="rb-label" style="margin-top:14px">FROM THE NIGHT</p><select id="rbNight" aria-label="Freeroll night"><option value="">My latest win (or best finish)</option>${nights.map(n=>`<option value="${n.night}" ${n.night===prefs.night?'selected':''}>${nightDate(n.night)} · ${ordinal(n.place)} of ${n.entrants}</option>`).join('')}</select>`:''}
          <p class="rb-note" style="margin-top:12px">${missing||'The stats come from the freeroll itself and can’t be edited. Only the look and the stat shown are yours to choose.'}</p>
          <p class="rb-note" id="rbStatus" role="status"></p></div>
      </div>`;
    panel.querySelectorAll('[data-art]').forEach(x=>x.onclick=()=>save({art:x.dataset.art}));
    panel.querySelectorAll('[data-stat]').forEach(x=>x.onclick=()=>save({stat:x.dataset.stat}));
    $('rbNight')?.addEventListener('change',e=>save({night:e.target.value}));
  }
  async function save(change){
    const key=window.rivlAccount?.key();if(!key||!mine)return;
    mine.prefs={...mine.prefs,...change};mine.banner={...(mine.banner||{}),...('art' in change?{art:change.art}:{}),...('stat' in change?{stat:change.stat}:{})};paintPanel();
    const run=saving=call('/api/banners/save',{key,...mine.prefs});
    try{const r=await run;if(run===saving){mine=r;paintPanel();for(const [id] of cache)if(id===account()?.id)cache.delete(id)}}
    catch(e){if($('rbStatus'))$('rbStatus').textContent=e.message||'Could not save your banner.'}
  }

  document.addEventListener('rivl:view',e=>{if(e.detail==='profile')loadMine();if(e.detail==='support')paintVault()});
  document.addEventListener('rivl:account',loadMine);
  setupVault();paintPanel();
  // Opened on this device but the account never heard (signed out then, or the save failed): tell it now, so
  // the player's other devices see banners too.
  setTimeout(async()=>{if(local()&&window.rivlAccount?.key()&&!account()?.bannersUnlocked){await syncUnlock();loadMine()}},4000);
  window.rivlBanners={decorate,bot,openCard,unlocked,banner};
})();
