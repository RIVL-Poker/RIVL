/* RIVL player stats: records each bot practice hand (online hands are recorded by the room server), keeps finished
   practice matches in this browser until the server has them, and paints the Profile's PLAYER STATS panel.
   Signed in, every count comes from the server, so it is the same on every device. A guest's practice matches wait
   here and are saved to the first account that signs in on this device. Counting is in hand-stats.js. */
(()=>{
  const HS=window.RivlHandStats;if(!HS)return;
  const OUTBOX='rivlStatsOutbox',LIVE='rivlStatsLive',MODE_KEY='rivlStatsMode',MAX_OUTBOX=300,BATCH_CHARS=200000;
  const $=id=>document.getElementById(id);
  const read=(key,fallback)=>{try{const v=JSON.parse(localStorage.getItem(key)||'null');return v??fallback}catch{return fallback}};
  const write=(key,value)=>{try{value==null?localStorage.removeItem(key):localStorage.setItem(key,JSON.stringify(value))}catch{}};
  const account=()=>window.rivlAccount?.current?.()||null;
  const newId=()=>crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');

  /* ---------- bot practice: one record per hand, one match per game ---------- */
  // A finished (or abandoned) match moves to the outbox, tagged with who was signed in, until the server confirms it.
  function finalize(m,place){
    if(!m?.hands?.length)return;
    const box=read(OUTBOX,[]).filter(x=>x.id!==m.id);
    box.push({id:m.id,t0:m.t0,t:Date.now(),size:m.size,place:place??null,account:account()?.id||null,hands:m.hands});
    while(box.length>MAX_OUTBOX)box.shift();
    write(OUTBOX,box);
  }
  const clearLive=g=>{if(read(LIVE,null)?.id===g.statId)write(LIVE,null)};
  const practice={
    // Set Hands deals scripted cards, so like the rating it leaves stats alone.
    begin(g){
      if(g.scripted)return;
      const live=read(LIVE,null);if(live&&live.id!==g.statId)finalize(live,null);
      g.statId=newId();g.statT0=Date.now();g.statHands=[];write(LIVE,null);
    },
    // Called by settle() once the pots are paid. Every hand is also kept in LIVE, so closing the page mid-match loses nothing.
    hand(g,awards){
      if(!g.statHands)return;
      const p=g.players[0];if(p.hole.length!==2)return;
      const dealt=g.players.map((x,i)=>i).filter(i=>g.players[i].hole.length===2),at=dealt.indexOf(g.sbSeat);
      const order=at<0?dealt:[...dealt.slice(at),...dealt.slice(0,at)];
      // Chips that come back because nobody called them are not winnings.
      const back=Math.max(0,p.committed-Math.max(0,...g.players.slice(1).map(x=>x.committed)));
      try{g.statHands.push(HS.pack({order,me:0,bb:g.bb,log:g.log||[],net:p.stack-p.handStart,won:Math.max(0,awards[0]-back),hole:p.hole,board:g.board}))}
      catch(e){console.error('hand stats failed',e);return}
      write(LIVE,{id:g.statId,t0:g.statT0,size:g.players.length,hands:g.statHands});
    },
    // The match is over: its hands count with the place. Leaving early counts the hands too (the match stays unrated).
    end(g,place){
      if(!g?.statHands)return;
      finalize({id:g.statId,t0:g.statT0,size:g.players.length,hands:g.statHands},place);
      g.statHands=null;clearLive(g);flush();
    },
    abandon(g){practice.end(g,null)},
  };
  window.rivlPracticeStats=practice;
  // A match whose page closed mid-game is saved as it stood, unless it is the paused game waiting to be resumed.
  {const live=read(LIVE,null),saved=read('rivlBotSave',null);if(live&&live.id!==saved?.game?.statId){finalize(live,null);write(LIVE,null)}}

  /* ---------- the outbox: practice matches wait here until the server has them ---------- */
  let flushing=null;
  const uploadable=a=>read(OUTBOX,[]).filter(m=>!m.account||m.account===a.id);
  function flush(){
    const a=account();if(!a||flushing||!uploadable(a).length)return flushing||Promise.resolve();
    flushing=(async()=>{
      try{
        for(let guard=0;guard<20;guard++){
          const batch=[];let chars=0;
          for(const m of uploadable(a)){const {account:_,...match}=m,n=JSON.stringify(match).length;if(batch.length&&(batch.length>=5||chars+n>BATCH_CHARS))break;batch.push(match);chars+=n}
          if(!batch.length)break;
          const r=await window.rivlAccount.call('/api/player-stats/practice',{key:a.key,matches:batch});
          const done=new Set(r.saved||[]),box=read(OUTBOX,[]),left=box.filter(m=>!done.has(m.id));write(OUTBOX,left);
          if(r.full||left.length===box.length)break;
        }
      }catch{}
      finally{flushing=null}
      load(true);
    })();
    return flushing;
  }

  /* ---------- the Profile panel ---------- */
  let data=null,loading=null,mode=read(MODE_KEY,'all');
  if(!['all',...HS.MODES].includes(mode))mode='all';
  // Signed in: the server's totals and games, plus any practice match this browser has not sent yet.
  // force asks again once a request already on its way is back, so a match just saved is in the answer.
  function load(force){
    const a=account();
    if(!a){data=null;paint();return Promise.resolve()}
    if(loading)return force?loading.then(()=>load()):loading;
    loading=window.rivlAccount.call('/api/player-stats',{key:a.key}).then(d=>{data={...d,account:a.id}},e=>{if(data?.account!==a.id)data={error:e.message,account:a.id}})
      .finally(()=>{loading=null;paint();window.refreshRatingUI?.()});
    return loading;
  }
  const local=m=>{const hands=(m.hands||[]).filter(HS.valid);return {id:'practice:'+m.id,mode:'practice',t:m.t,t0:m.t0,size:m.size,place:m.place,hands:hands.length,stats:HS.total(hands.map(HS.count)),pending:true}};
  function view(){
    const a=account(),games=[],totals=Object.fromEntries(HS.MODES.map(m=>[m,HS.blank()]));
    const server=a&&data?.account===a.id&&!data.error?data:null;
    if(server){for(const m of HS.MODES)HS.add(totals[m],server.totals?.[m]);games.push(...(server.games||[]))}
    const seen=new Set(games.map(g=>g.id));
    for(const m of read(OUTBOX,[]).filter(m=>a?m.account===a.id||!m.account:!m.account).map(local)){
      if(seen.has(m.id)||!m.hands||a&&!server)continue;
      HS.add(totals.practice,m.stats);games.push(m);
    }
    games.sort((x,y)=>y.t-x.t);
    return {a,server,totals,games};
  }
  const fmt=(v,digits=0,unit='%')=>v==null?'–':v===Infinity?'∞':v.toFixed(digits)+unit;
  const signed=(v,digits=1)=>v==null?'–':(v>0?'+':v<0?'−':'±')+Math.abs(v).toFixed(digits);
  const ord=n=>n+(['th','st','nd','rd'][(n%100>10&&n%100<14)?0:n%10]||'th');
  const MODE_NAME={practice:'BOT PRACTICE',casual:'CASUAL',ranked:'RANKED',freeroll:'FREEROLL'};
  const KIND_NAME={fold:'folds',call:'checks and calls',raise:'bets and raises'};
  const bars=(rows,label)=>rows.map(r=>`<div class="ps-bar"><span>${label(r)}</span><i><em style="width:${(r.acc||0).toFixed(1)}%"></em></i><b>${fmt(r.acc,1)}</b><small>${r.n.toLocaleString()}</small></div>`).join('');
  function paint(){
    const root=$('playerStats');if(!root)return;
    document.querySelectorAll('[data-ps-mode]').forEach(b=>{const on=b.dataset.psMode===mode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});
    const {a,server,totals,games}=view(),c=mode==='all'?HS.total(Object.values(totals)):totals[mode],r=HS.rates(c);
    const shown=games.filter(g=>mode==='all'||g.mode===mode).slice(0,12);
    $('psNote').textContent=a&&!server?(data?.error?'Your stats could not load: '+data.error:'Loading your stats…')
      :!a?'Bot practice stats are kept on this device until you sign in. Signed in, every hand you play online and in practice counts, on any device.'
      :r.hands?'Every hand you have played signed in since player stats started, on any device.':'No hands yet. Play bot practice or an online table and your stats start here.';
    const tile=(label,value,hint)=>`<div title="${hint}"><small>${label}</small><b>${value}</b><span>${hint}</span></div>`;
    $('psTiles').innerHTML=[
      tile('HANDS',r.hands.toLocaleString(),'dealt in'),
      tile('ACCURACY',fmt(r.acc,1),r.decisions.toLocaleString()+' graded decisions'),
      tile('WIN RATE',r.bb100==null?'–':signed(r.bb100),'big blinds per 100 hands'),
      tile('MISTAKES',r.loss100==null?'–':'−'+r.loss100.toFixed(1),'big blinds given up per 100 hands'),
      tile('VPIP',fmt(r.vpip),'put chips in before the flop'),
      tile('PFR',fmt(r.pfr),'raised before the flop'),
      tile('3-BET',fmt(r.threeBet),'re-raised a single raise'),
      tile('STEAL',fmt(r.steal),'raised first from the cutoff, button or small blind'),
      tile('C-BET',fmt(r.cbet),'bet the flop after raising before it'),
      tile('FOLD TO C-BET',fmt(r.foldToCbet),'folded to a continuation bet'),
      tile('AGGRESSION',fmt(r.af,1,''),'bets and raises per call after the flop'),
      tile('SHOWDOWN',fmt(r.wtsd),'of flops seen went to showdown'),
      tile('WON AT SHOWDOWN',fmt(r.wsd),'of showdowns won'),
      tile('HANDS WON',fmt(r.won),'of hands dealt'),
    ].join('');
    $('psStreets').innerHTML=r.decisions?bars(r.streets,x=>x.name):'<p class="muted">Accuracy by street shows once a decision is graded.</p>';
    $('psSeats').innerHTML=r.decisions?bars(r.seats.filter(x=>x.n),x=>x.name):'<p class="muted">Accuracy by seat shows once a decision is graded.</p>';
    const leaks=r.leaks.slice(0,3);
    $('psLeaks').innerHTML=leaks.length?leaks.map(x=>`<div class="ps-leak"><b>${x.street} ${KIND_NAME[x.kind]}</b><span>${fmt(x.acc,1)} accuracy · ${x.n.toLocaleString()} ${x.n===1?'decision':'decisions'}</span><em>−${x.lossBB.toFixed(1)} BB</em></div>`).join('')
      :'<p class="muted">Where your decisions give up the most big blinds shows here.</p>';
    const graded=r.labels.reduce((n,x)=>n+x.n,0);
    $('psGrades').innerHTML=graded?r.labels.map(x=>`<div class="lbar g-${x.name.toLowerCase()}"><span><b>${window.RivlRating?.GLYPH?.[x.name]||''}</b> ${x.name}</span><i><em style="width:${(100*x.n/graded).toFixed(1)}%"></em></i><span>${x.n.toLocaleString()}</span></div>`).join('')
      :'<p class="muted">Your decision grades show here.</p>';
    // On a phone each game is two lines and its numbers carry their own labels (data-k), so the header row is hidden.
    const head='<div class="ps-game head"><span>GAME</span><span>PLACE</span><span>HANDS</span><span>ACC</span><span>VPIP / PFR</span><span>NET BB</span></div>';
    $('psGames').innerHTML=shown.length?head+shown.map(g=>{
      const x=HS.rates(g.stats),when=new Date(g.t).toLocaleDateString(undefined,{month:'short',day:'numeric'});
      const place=g.place?ord(g.place)+(g.mode==='freeroll'?'':' of '+g.size):g.mode==='freeroll'?'–':'Left';
      const elo=g.mode==='ranked'&&g.elo!=null?` <em class="${g.elo>=0?'positive':'negative'}">${g.elo>0?'+':''}${g.elo} Elo</em>`:'';
      return `<div class="ps-game"><span><b>${MODE_NAME[g.mode]}</b><small>${when}${g.pending?a?' · saving…':' · this device':''}</small></span><span>${place}${elo}</span>`+
        `<span data-k="HANDS">${g.hands}</span><span data-k="ACC">${fmt(x.acc,1)}</span><span data-k="VPIP / PFR">${fmt(x.vpip)} / ${fmt(x.pfr)}</span>`+
        `<span data-k="NET BB" class="${x.bb100>0?'positive':x.bb100<0?'negative':''}">${signed(g.stats.net/100)}</span></div>`;
    }).join(''):`<p class="muted">No ${mode==='all'?'':MODE_NAME[mode].toLowerCase()+' '}games with stats yet.</p>`;
  }

  /* ---------- the Ranked Elo chart and list, from the server on every device ---------- */
  // Rows from before the server kept the Elo after each match are worked back from the next one with its Elo change.
  function ranked(a){
    if(!a||data?.account!==a.id||!Array.isArray(data.ranked))return null;
    let next=data.rating??a.rating;const rows=[];
    for(const m of data.ranked){const after=m.after??next,before=Math.max(0,after-(m.change||0));rows.push({date:m.t,before,after,acc:m.accuracy==null?null:Math.round(m.accuracy),result:m.place===1?'Win':'Loss',players:m.players});next=before}
    return rows.reverse();
  }
  window.rivlPlayerStats={load,flush,paint,ranked};

  function init(){
    document.querySelectorAll('[data-ps-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.psMode;write(MODE_KEY,mode);paint()}));
    $('psRefresh')?.addEventListener('click',()=>{flush();load()});
    document.querySelectorAll('.nav[data-view="profile"]').forEach(b=>b.addEventListener('click',()=>{flush();load()}));
    document.addEventListener('rivl:account',()=>{data=null;paint();flush();load()});
    window.addEventListener('online',()=>flush());
    paint();flush();load();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
