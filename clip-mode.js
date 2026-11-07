/* Clip playthrough: open the site with ?clips (or ?clips=7 to start at hand 7) and it plays 20 graded spots on the
   Ranked table, one after another, with nothing to click. Each hand is dealt and played to a decision, asks the
   viewer for the best play with a countdown, then reveals the answer, the equity and every option's grade. A title
   card between hands marks where to cut. Space pauses, the arrow keys skip back and forward, R replays the hand.
   The spots come from clip-spots.js (scripts/make-clips.mjs), graded the same way as the daily puzzle. */
(()=>{
  const q=new URLSearchParams(location.search);
  if(!q.has('clips'))return;
  // Only the clip page loads the spots and the clip styles; nobody else pays for them.
  const css=document.createElement('link');css.rel='stylesheet';css.href='clip-mode.css';document.head.append(css);
  const data=document.createElement('script');data.src='clip-spots.js';data.onload=start;document.body.append(data);
  function start(){
  const CLIPS=window.RIVL_CLIPS||[],rooms=window.rivlRooms;
  if(!CLIPS.length||!rooms?.preview)return;
  const $=id=>document.getElementById(id);
  const BB=100,STACK=100*BB,DECIDE_MS=5000,REVEAL_MS=6500,TITLE_MS=1400;
  const ORDER=['BTN','SB','BB','UTG','HJ','CO'],PREFLOP=['UTG','HJ','CO','BTN','SB','BB'];
  const POS={BTN:'the button',CO:'the cutoff',HJ:'the hijack',UTG:'under the gun',SB:'the small blind',BB:'the big blind'};
  const BOTS=['Ace','Luna','Nash','Rico','Jett','Nova','Blaze','Mula'];
  const SUIT={'♠':'S','♥':'H','♦':'D','♣':'C'};
  const code=c=>c[0]+SUIT[c[1]];
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const cardsIn=t=>esc(t).replace(/\b([2-9TJQKA])([♠♥♦♣])/g,(m,r,s)=>`<span class="clip-mini${'♥♦'.includes(s)?' red':''}">${r==='T'?'10':r}${s}</span>`);
  const bbText=x=>`${+(x/BB).toFixed(1)} BB`;
  const GOOD=new Set(['Brilliant','Best','Excellent']);

  document.body.classList.add('clip-mode','table-focus');
  try{document.querySelector('#welcomeOverlay')?.setAttribute('hidden','')}catch{}
  // Bets and stacks read in big blinds, like the story. The viewer's own choice comes back when the page closes.
  const unitBefore=window.rivlAmounts?.unit();window.rivlAmounts?.set('bb');
  addEventListener('pagehide',()=>{if(unitBefore&&unitBefore!=='bb')window.rivlAmounts.set(unitBefore)});

  // The clip's own layer over the table: the question, the answer and the title card between hands.
  const layer=document.createElement('div');layer.className='clip-layer';
  layer.innerHTML=`<div class="clip-top"><span class="clip-brand">♠ RIVL</span><span class="clip-count" id="clipCount"></span><span class="clip-street" id="clipStreet"></span></div>
    <div class="clip-caption" id="clipCaption"></div>
    <div class="clip-ask" id="clipAsk" hidden><strong>WHAT'S THE BEST PLAY?</strong><div class="clip-choices" id="clipChoices"></div><span class="clip-hint">Comment your answer before the reveal</span></div>
    <div class="clip-reveal" id="clipReveal" hidden></div>
    <div class="clip-title" id="clipTitle" hidden></div>
    <div class="clip-start" id="clipStart"><div><span class="clip-brand big">♠ RIVL</span><h2>CLIP PLAYTHROUGH</h2>
      <p>${CLIPS.length} hands play by themselves, about 20 seconds each. Start your screen recording, then press start. A title card between hands shows where to cut.</p>
      <p class="clip-keys"><kbd>Space</kbd> pause · <kbd>←</kbd> <kbd>→</kbd> previous / next hand · <kbd>R</kbd> replay hand · tap the screen to pause on a phone</p>
      <button type="button" class="gold" id="clipGo">START</button></div></div>
    <div class="clip-paused" id="clipPaused" hidden><div><strong>PAUSED</strong><div class="clip-paused-row"><button type="button" class="outline" data-clip="prev">◀ PREV</button><button type="button" class="gold" data-clip="resume">RESUME</button><button type="button" class="outline" data-clip="next">NEXT ▶</button></div><button type="button" class="outline" data-clip="replay">REPLAY THIS HAND</button></div></div>`;
  $('roomPokerTable').closest('#roomGame').append(layer);

  /* ---------- timing that can pause and skip ---------- */
  let run=0,paused=false,pausedAt=0,index=Math.max(0,Math.min(CLIPS.length-1,(parseInt(q.get('clips'),10)||1)-1)),game=null,snap=null;
  const Skip=Symbol('skip');
  async function wait(ms,my){
    let left=ms,last=performance.now();
    while(left>0){
      await new Promise(r=>setTimeout(r,Math.min(50,left)));
      if(my!==run)throw Skip;
      const now=performance.now();if(!paused)left-=now-last;last=now;
    }
  }
  function paint(){rooms.preview(snap);dress()}
  // The table's own seats show letters for bots online; give them their practice pictures.
  function dress(){
    document.querySelectorAll('#roomGamePlayers .seat').forEach(el=>{const name=el.querySelector('.rivl-seat-label b')?.textContent;window.rivlBotAvatars?.apply(el.querySelector('.avatar'),name)});
  }

  /* ---------- one hand ---------- */
  function newHand(p,n){
    const seatOf=pos=>(ORDER.indexOf(pos)-ORDER.indexOf(p.heroPos)+6)%6;
    // A different cast each hand, with the opponent named so the caption can say who did what.
    const names=BOTS.slice(n%BOTS.length).concat(BOTS.slice(0,n%BOTS.length));
    const seats=[],players=[];
    for(let s=0;s<6;s++){
      const hero=s===0,name=hero?'YOU':names[s-1];
      seats.push({name,type:hero?'human':'bot',level:'',online:true});
      players.push({seat:s,id:'clip'+s,name,bot:!hero,stack:STACK,bet:0,folded:false,allIn:false,contribution:0});
    }
    game={smallBlind:BB/2,bigBlind:BB,handNumber:n,phase:'preflop',pot:0,board:[],players,holeCards:p.hero.map(code),
      dealer:seatOf('BTN'),sbSeat:seatOf('SB'),bbSeat:seatOf('BB'),turn:-1,deadline:0,currentBet:0,legal:null,shown:{},result:'',winners:[],matchOver:false};
    snap={seats,mySeat:0,ranked:true,rankedMax:6,started:true,visibility:'public',game,extensionsLeft:null,blindClock:null};
    return {seatOf,villain:players[seatOf(p.villainPos)],hero:players[0]};
  }
  const put=(pl,to)=>{const v=Math.min(pl.stack,to-pl.bet);pl.stack-=v;pl.bet+=v;pl.contribution+=v;game.pot+=v;pl.allIn=pl.stack===0;game.currentBet=Math.max(game.currentBet,pl.bet)};
  const caption=html=>{$('clipCaption').innerHTML=html;$('clipCaption').classList.toggle('on',!!html)};

  async function play(i,my){
    const p=CLIPS[i],n=i+1;
    $('clipAsk').hidden=true;$('clipReveal').hidden=true;caption('');$('clipStreet').textContent='';
    $('clipCount').textContent=`HAND ${n} / ${CLIPS.length}`;
    // The title card: the cut point between hands.
    const title=$('clipTitle');title.innerHTML=`<span class="clip-brand big">♠ RIVL</span><strong>HAND ${n}</strong><small>${esc(p.street.toUpperCase())} DECISION · ${esc(p.difficulty.toUpperCase())}</small>`;
    title.hidden=false;
    const {seatOf,villain,hero}=newHand(p,n);
    const vName=villain.name,who=pl=>pl===hero?'You':pl.name;
    put(game.players[game.sbSeat],BB/2);put(game.players[game.bbSeat],BB);
    paint();
    await wait(TITLE_MS,my);title.hidden=true;
    $('clipStreet').textContent='PREFLOP';
    await wait(500,my);
    // Preflop: everyone folds to the opener, who makes it 2.5 BB; the big blind calls.
    const opener=p.heroPos==='BB'?villain:hero;
    let opened=false;
    for(const pos of PREFLOP){
      const pl=game.players[seatOf(pos)];
      game.turn=pl.seat;paint();
      if(pl===opener){await wait(500,my);put(pl,2.5*BB);opened=true;caption(`<b>${who(pl)}</b> ${pl===hero?'open':'opens'} to 2.5 BB on ${POS[pos]}`)}
      else if(opened&&pos==='BB'){await wait(500,my);put(pl,2.5*BB);caption(`<b>${who(pl)}</b> ${pl===hero?'call':'calls'} in the big blind`)}
      else{await wait(220,my);pl.folded=true}
      paint();await wait(pl===opener||pos==='BB'?650:120,my);
    }
    // The streets before the decision, then the decision's street, from the spot's story.
    const lines=p.story.slice(1);
    for(let li=0;li<lines.length;li++){
      const m=lines[li].match(/^(Flop|Turn|River) ([^:]+): (.*?)\.?$/);if(!m)continue;
      const [,street,cards,text]=m,last=li===lines.length-1;
      game.players.forEach(pl=>pl.bet=0);game.currentBet=0;game.turn=-1;
      game.phase=street.toLowerCase();game.board.push(...cards.split(' ').map(code));
      $('clipStreet').textContent=street.toUpperCase();caption('');
      paint();await wait(900,my);
      if(text==='checked through'){
        for(const pl of [hero.seat===game.bbSeat?hero:villain,hero.seat===game.bbSeat?villain:hero]){game.turn=pl.seat;paint();await wait(420,my)}
        game.turn=-1;caption('Checked through');paint();await wait(650,my);continue;
      }
      for(const clause of text.split(', ')){
        const pl=/^you\b/.test(clause)?hero:villain;
        game.turn=pl.seat;paint();await wait(pl===hero?380:560,my);
        let m2;
        if(m2=clause.match(/raises to ([\d.]+) BB/)){put(pl,Math.round(m2[1]*BB));caption(`<b>${vName}</b> raises to ${m2[1]} BB`)}
        else if(m2=clause.match(/bets? ([\d.]+) BB/)){put(pl,Math.round(m2[1]*BB));caption(`<b>${who(pl)}</b> ${pl===hero?'bet':'bets'} ${m2[1]} BB`)}
        else if(/call/.test(clause)){put(pl,game.currentBet);caption(`<b>${who(pl)}</b> ${pl===hero?'call':'calls'}`)}
        else caption(`<b>${who(pl)}</b> ${pl===hero?'check':'checks'}`);
        game.turn=-1;paint();await wait(last?500:520,my);
      }
      if(!last)await wait(250,my);
    }
    // The decision: the real clock runs on your seat and the action bar offers the three plays.
    const call=villain.bet-hero.bet;
    game.turn=hero.seat;game.deadline=Date.now()+DECIDE_MS;
    game.legal={call,canRaise:!!p.grades.raise,raiseToMin:p.raiseTo,raiseToMax:Math.max(p.raiseTo,hero.stack+hero.bet)};
    paint();
    const choices=[['fold','Fold'],['call',p.callLabel],...(p.grades.raise?[['raise',p.raiseLabel]]:[])];
    $('clipChoices').innerHTML=choices.map(([k,l])=>`<span class="clip-choice c-${k}" data-k="${k}">${esc(l)}</span>`).join('');
    $('clipAsk').hidden=false;$('clipAsk').classList.remove('done');
    caption(`You have ${p.hero.map(c=>cardsIn(c)).join('')} · ${bbText(call)} to call into ${bbText(game.pot)}`);
    await wait(DECIDE_MS,my);
    // The reveal.
    game.turn=-1;game.legal=null;game.deadline=0;paint();
    const best=p.grades[p.best],bestLabel=choices.find(c=>c[0]===p.best)[1];
    $('clipAsk').classList.add('done');
    $('clipChoices').querySelectorAll('[data-k]').forEach(el=>el.classList.toggle('best',el.dataset.k===p.best));
    const eq=Math.round(p.eq*100),need=Math.round(p.need*100);
    $('clipReveal').innerHTML=`<div class="clip-verdict"><span class="clip-glyph">${esc(best.glyph)}</span><div><small>THE BEST PLAY</small><strong>${esc(bestLabel.toUpperCase())}</strong></div></div>
      <div class="clip-eq"><div><small>YOUR EQUITY</small><b>${eq}%</b></div><div><small>NEEDED TO CALL</small><b>${need}%</b></div></div>
      <div class="clip-grades">${choices.map(([k,l])=>{const g=p.grades[k];return `<div class="clip-grade g-${g.label.toLowerCase()}${k===p.best?' best':''}${GOOD.has(g.label)?' good':''}"><span>${esc(k==='raise'?'Raise':k==='call'?'Call':'Fold')}</span><b>${esc(g.glyph)} ${esc(g.label)}</b>${g.lossBB?`<small>−${g.lossBB} BB</small>`:'<small>best</small>'}</div>`}).join('')}</div>
      <p class="clip-lesson">${cardsIn(p.why.lesson)}</p>`;
    $('clipAsk').hidden=true;$('clipReveal').hidden=false;caption('');
    await wait(REVEAL_MS,my);
  }

  async function from(i){
    const my=++run;index=i;
    try{
      for(;index<CLIPS.length;index++)await play(index,my);
      $('clipReveal').hidden=true;$('clipStreet').textContent='';caption('');
      const title=$('clipTitle');title.innerHTML=`<span class="clip-brand big">♠ RIVL</span><strong>THAT'S ${CLIPS.length}</strong><small>PRESS ← TO GO BACK, OR R TO REPLAY</small>`;title.hidden=false;index=CLIPS.length-1;
    }catch(e){if(e!==Skip)throw e}
  }
  function pause(on){
    if(on===paused)return;paused=on;$('clipPaused').hidden=!on;
    if(on)pausedAt=Date.now();
    else if(game?.deadline){game.deadline+=Date.now()-pausedAt;paint()}
  }
  const go=i=>{pause(false);from(Math.max(0,Math.min(CLIPS.length-1,i)))};
  const actions={prev:()=>go(index-1),next:()=>go(index+1),replay:()=>go(index),resume:()=>pause(false)};
  layer.querySelectorAll('[data-clip]').forEach(b=>b.onclick=e=>{e.stopPropagation();actions[b.dataset.clip]()});
  $('clipGo').onclick=async e=>{
    e.stopPropagation();const start=$('clipStart');start.innerHTML='<div class="clip-countdown" id="clipCountdown">3</div>';
    for(const t of ['3','2','1']){$('clipCountdown').textContent=t;await new Promise(r=>setTimeout(r,800))}
    start.remove();from(index);
  };
  layer.addEventListener('click',()=>{if(!$('clipStart'))pause(!paused)});
  addEventListener('keydown',e=>{
    if($('clipStart'))return;
    if(e.key===' '){e.preventDefault();pause(!paused)}
    else if(e.key==='ArrowRight')actions.next();
    else if(e.key==='ArrowLeft')actions.prev();
    else if(e.key==='r'||e.key==='R')actions.replay();
  });
  // Paint the first hand's empty table behind the start card.
  show('rooms');newHand(CLIPS[index],index+1);paint();
  }
})();
