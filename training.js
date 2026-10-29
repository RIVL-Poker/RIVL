/* RIVL Training: a hub of short drills (DRILLS below; each drill is its own view) built on one shared drill page:
   a seat filter, a mini table, the choices, the verdict with why, and a 13x13 chart. Two drills so far:
   - Hand range trainer: everyone folds to you, open-raise or fold.
   - Facing a raise: one player opens to 2.5 BB before you, 3-bet, call or fold.
   The answers are rating.js's own preflop book (the tiers, and gradePreflop() for facing a raise), so the drills
   teach exactly what the decision grader rewards. Progress is kept in this browser. */
(root=>{
  const R=root.RivlRating;if(!R)return;

  /* ---------- seats and hands ---------- */
  const SEATS={6:['UTG','HJ','CO','BTN','SB','BB'],9:['UTG','UTG+1','MP','LJ','HJ','CO','BTN','SB','BB']};
  const NAME={UTG:'under the gun','UTG+1':'UTG+1',MP:'middle position',LJ:'lojack',HJ:'hijack',CO:'cutoff',BTN:'button',SB:'small blind',BB:'big blind'};
  const the=p=>p==='UTG'?'under the gun':p==='UTG+1'?'UTG+1':'the '+NAME[p];
  const who=p=>p==='UTG'?'the player under the gun':the(p),cap=t=>t[0].toUpperCase()+t.slice(1);
  const RANKS='AKQJT98765432';
  const TIER=new Map();R.TIERS.forEach((l,t)=>l.split(' ').forEach(h=>TIER.set(h,t)));
  const tierOf=c=>TIER.has(c)?TIER.get(c):9;
  const CLASSES=[];for(let i=0;i<13;i++)for(let j=0;j<13;j++)CLASSES.push(i===j?RANKS[i]+RANKS[i]:i<j?RANKS[i]+RANKS[j]+'s':RANKS[j]+RANKS[i]+'o');
  const combos=c=>c.length===2?6:c[2]==='s'?4:12;
  const share=test=>CLASSES.reduce((a,c)=>a+(test(c)?combos(c):0),0)/1326;
  const pct=(c,n)=>n?Math.round(100*c/n)+'%':'–';
  const behindOf=(size,pos)=>SEATS[size].length-1-SEATS[size].indexOf(pos);
  // The last tier a seat opens first in: players behind decide it, and the small blind opens like the button.
  const cutoff=(size,pos)=>R.rfiTier(behindOf(size,pos),false,pos==='SB');
  const openPct=(size,pos)=>{const r=cutoff(size,pos);return share(c=>tierOf(c)<=r)};
  const earliest=(size,t)=>SEATS[size].slice(0,-1).find(p=>cutoff(size,p)>=t);
  function kind(c){
    const hi=RANKS.length-1-RANKS.indexOf(c[0]),lo=RANKS.length-1-RANKS.indexOf(c[1]);// 12 = ace
    if(c.length===2)return hi>=8?'bigPair':'pair';
    const suited=c[2]==='s',broad=lo>=8;
    if(suited){if(broad)return 'suitedBroadway';if(hi===12)return lo<=3?'wheelAce':'suitedAce';if(hi-lo<=2&&lo>=1)return 'connector';return 'suitedOther'}
    if(broad)return 'offBroadway';if(hi===12)return 'offAce';return 'offOther';
  }

  /* ---------- drill 1: everyone folds to you, open or fold ---------- */
  const WHY={
    bigPair:['A big pair is ahead of nearly every hand that can call you, so you want to build the pot now.'],
    pair:['A pair is often the best hand before the flop, and it flops a set about once in eight tries, which can win a big pot.',
      'Small pairs mostly win by flopping a set, about one flop in eight. With this many players behind, you will too often face a 3-bet and have to fold before seeing a flop.'],
    wheelAce:['A suited ace can make the nut flush, and a low ace can also make a straight to the five. It plays well and blocks opponents from holding aces.',
      'It can make the nut flush, but when it only pairs, the kicker is weak against the hands that call or 3-bet a raise from this seat.'],
    suitedAce:['A suited ace can make the nut flush, and holding the ace makes it less likely anyone behind has aces or ace-king.',
      'It has nut-flush potential, but a pair of aces with a middling kicker loses to the stronger aces that continue against a raise from this seat.'],
    suitedBroadway:['Two suited high cards make strong top pairs, flushes and straights, and they win plenty of pots when the blinds fold.',
      'Suited high cards play well, but a weaker one is often dominated by the better broadway hands that call or 3-bet from behind.'],
    connector:['Suited connectors make straights and flushes and play well after the flop, especially when you will have position.',
      'Suited connectors need position and few players behind. They rarely make top pair with a good kicker, so from here they lose more than they win.'],
    suitedOther:['A high card with a decent suited kicker makes top pairs and flushes that hold up, so it is worth opening even with players behind.',
      'Being suited adds only a few percent of equity. With a weak second card it makes weak pairs and second-best flushes.'],
    offBroadway:['Two offsuit high cards make top pair with a good kicker, and they dominate the weaker high cards that call a raise.',
      'Offsuit broadway hands make top pair, but a player who calls or 3-bets from behind often has a better kicker, which costs big pots.'],
    offAce:['An ace makes top pair, and holding it makes it less likely a player behind has a big ace. From a late seat, that is enough to open.',
      'Weak offsuit aces make top pair with a bad kicker. They are dominated by the better aces that continue against your raise.'],
    offOther:['From a late seat, any two decent cards can open: the blinds fold often, and you will have position if they call.',
      'Unsuited and unconnected, it rarely makes a strong hand and is hard to play after the flop.'],
  };
  function seatText(size,pos){
    const behind=behindOf(size,pos),p=Math.round(100*openPct(size,pos));
    if(pos==='SB')return `Only the big blind is left. This chart plays raise-or-fold from the small blind and opens about ${p}% of hands, like the button: you will be out of position after the flop, but a raise wins the blinds often.`;
    if(pos==='BTN')return `The widest seat at the table, about ${p}% of hands. Only the blinds are left to act, and you will act last on every later street.`;
    if(pos==='CO')return `Only the button and the blinds are left, about ${p}% of hands. You will often have position after the flop, so suited connectors and more offsuit high cards become opens.`;
    if(behind>=5)return `${behind} players still act behind you, and any of them can wake up with a big hand, so open only about ${p}% of hands: big pairs, strong high cards and suited aces.`;
    return `With ${behind} players left to act you can open a little wider, about ${p}% of hands: more pairs, suited aces and suited broadways, while offsuit hands still need strong kickers.`;
  }
  // Right, close (one tier either side of the seat's edge, which the grader marks Good) or wrong. Folding the
  // small blind's edge hands is an Inaccuracy to the grader, because a limp is also allowed there.
  function judge(size,pos,c,act){
    const t=tierOf(c),r=cutoff(size,pos),open=t<=r;
    return{open,v:(act==='raise')===open?'right':(open?t===r&&pos!=='SB':t===r+1&&t<9)?'close':'wrong'};
  }
  function handText(size,pos,c,open){
    const t=tierOf(c),r=cutoff(size,pos),from=earliest(size,t),seats=SEATS[size];
    let line;
    if(open){
      if(from===seats[0])line=`${c} is an open from every seat${size===9?', even at a full table':''}.`;
      else if(from===pos)line=`${c} is one of the last hands in the ${pos} range: this is the first seat that opens it.`;
      else if(cutoff(size,from)===r)line=`${c} is one of the last hands in the ${pos} range. It first becomes an open from ${the(from)}.`;
      else line=`${c} is a clear open here. It is in the range from ${the(from)} onward.`;
    }else if(t===9)line=`${c} is a fold from every seat, even on the button.`;
    else if(!from)line=`${c} is a fold from every seat at a ${size}-handed table, even the button. Only heads-up does the chart open it.`;
    else{const next=seats.indexOf(from)-seats.indexOf(pos);line=`${c} is not strong enough here. It becomes an open from ${the(from)}${next===1?', one seat later':''}.`}
    const k=kind(c),late=behindOf(size,pos)<=3;
    // Weak suited hands open only from late seats, where winning the blinds is the main reason.
    const why=k==='suitedOther'&&open&&late?'The suited card adds flush potential, and with only a few players left behind, winning the blinds often is enough to make the raise pay.':WHY[k][open?0:1];
    return line+' '+why;
  }

  /* ---------- drill 2: one player opens to 2.5 BB, 3-bet, call or fold ---------- */
  const OPEN_TO=2.5,ACTS=['raise','call','fold'];
  const blindOf=pos=>pos==='SB'?.5:pos==='BB'?1:0;
  // 3-bets go to 3x the open in position and 4x from the blinds, both standard sizes to the grader.
  const threeBetTo=pos=>(pos==='SB'||pos==='BB'?4:3)*OPEN_TO;
  // The same book analyze() builds for this spot (chips in tenths of a big blind, 100 BB deep).
  function vsBook(size,opener,pos,c){
    const heroBet=blindOf(pos)*10;
    return{tier:tierOf(c),cls:c,hu:false,raisers:1,pos:pos==='SB'||pos==='BB'?pos:'',toCall:OPEN_TO*10-heroBet,bb:10,openTier:cutoff(size,opener),
      limpers:0,behind:behindOf(size,pos),eff:100,size:OPEN_TO,shove:0,currentBet:OPEN_TO*10,heroBet,stack:1000-heroBet};
  }
  // The grader's label for each of the three answers.
  function labels(size,opener,pos,c){
    const b=vsBook(size,opener,pos,c),A={book:b,toCall:b.toCall},L={};
    for(const a of ACTS)L[a]=R.gradePreflop(A,a,a==='raise'?threeBetTo(pos)*10:0).label;
    return L;
  }
  const bestOf=L=>ACTS.find(a=>L[a]==='Best')||'fold';
  function vsJudge(size,opener,pos,c,act){
    const L=labels(size,opener,pos,c),best=bestOf(L),label=L[act];
    return{L,best,label,v:label==='Best'?'right':label==='Excellent'||label==='Good'?'close':'wrong'};
  }
  const vsShares=(size,opener,pos)=>{const b=CLASSES.map(c=>bestOf(labels(size,opener,pos,c)));const s=a=>Math.round(100*CLASSES.reduce((x,c,i)=>x+(b[i]===a?combos(c):0),0)/1326);return{raise:s('raise'),call:s('call'),fold:s('fold')}};
  const posPhrase=pos=>pos==='SB'||pos==='BB'?'in the '+NAME[pos]:pos==='BTN'?'on the button':'from '+the(pos);
  const bbs=x=>+x.toFixed(1)+' BB';
  const ACT_NAME={raise:'3-bet',call:'call',fold:'fold'},ACT_VERB={raise:'3-bets',call:'calls',fold:'folds'};
  function vsHandText(size,opener,pos,c){
    const best=bestOf(labels(size,opener,pos,c)),t=tierOf(c),from=the(opener);
    const pot=OPEN_TO+(opener==='SB'?0:.5)+1,toCall=OPEN_TO-blindOf(pos),need=Math.round(100*toCall/(pot+toCall));
    if(best==='raise'){
      if(t===0)return `${c} is one of the very best starting hands. 3-bet for value: you want more chips in while you are ahead of nearly everything that continues.`;
      if(t===1)return `${c} is ahead of most of the hands that open from ${from}, so 3-bet for value and build the pot while you are ahead.`;
      if(pos==='SB')return `From the small blind the chart plays 3-bet or fold, and ${c} is strong enough to 3-bet against a raise from ${from}.`;
      return `The ${NAME[opener]} opens wide, so ${c} is strong enough to 3-bet: it is ahead of much of that range and often wins the pot right away.`;
    }
    if(best==='call'){
      if(pos==='BB')return `${c} is too good to fold but not strong enough to 3-bet for value. You already have 1 BB in and close the action, so calling ${bbs(toCall)} into a ${bbs(pot)} pot needs only about ${need}% equity.`;
      return `${c} is too good to fold but not strong enough to 3-bet for value. Calling keeps the opener's weaker hands in, and you will have position on the opener after the flop.`;
    }
    if(pos==='SB')return `From the small blind the chart plays 3-bet or fold, and ${c} is not strong enough to 3-bet against a raise from ${from}. Calling would leave you out of position with the big blind still to act.`;
    if(pos==='BB')return `Even with the discount in the big blind, ${c} does not win often enough against a raise from ${from} to call ${bbs(toCall)}.`;
    return `${c} does not do well against a raise from ${from}: when it hits, it is often dominated by a better kicker or a bigger pair${behindOf(size,pos)>0?', and the players behind you can still 3-bet':''}.`;
  }
  function vsSpotText(size,opener,pos){
    const p=Math.round(100*openPct(size,opener)),s=vsShares(size,opener,pos),from=the(opener);
    if(pos==='BB')return `The big blind closes the action at a discount, so it defends wider than any other seat. Against a ${OPEN_TO} BB raise from ${from}, which opens about ${p}% of hands, the chart 3-bets ${s.raise}% and calls ${s.call}%.`;
    if(pos==='SB')return `In the small blind you will be out of position after the flop and the big blind can still raise behind you, so the chart plays 3-bet or fold: it 3-bets ${s.raise}% of hands against a raise from ${from}. Flat-calling is allowed but rated lower.`;
    const behind=behindOf(size,pos),feel=p<=15?' A tight range like that beats most hands, so you continue with very few.':p>=33?' A wide range like that is easier to attack, so you 3-bet more often.':'';
    return `${cap(who(opener))} opens about ${p}% of hands${behind?`, and ${behind} player${behind>1?'s':''} still act behind you`:''}. Against that, the chart 3-bets ${s.raise}% and calls ${s.call}%.${feel}`;
  }

  const drills={};
  root.RivlTraining={SEATS,CLASSES,tierOf,cutoff,openPct,
    open:{judge,handText,seatText},
    vsRaise:{OPEN_TO,threeBetTo,labels,best:bestOf,shares:vsShares,judge:vsJudge,handText:vsHandText,spotText:vsSpotText},
    drill:view=>drills[view]};
  const doc=root.document;if(!doc||!doc.getElementById('training'))return;
  const $=id=>doc.getElementById(id);
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const SUITS='♠♥♦♣',rnd=n=>Math.floor(Math.random()*n);
  function cardsFor(c){
    const a=rnd(4);let b=rnd(4);
    if(c[2]==='s')b=a;else while(b===a)b=rnd(4);
    return [c[0]+SUITS[a],c[1]+SUITS[b]];
  }
  const randomClass=()=>{const a=rnd(52);let b=rnd(51);if(b>=a)b++;const ra=a>>2,rb=b>>2,hi=Math.min(ra,rb),lo=Math.max(ra,rb);
    return ra===rb?RANKS[ra]+RANKS[ra]:RANKS[hi]+RANKS[lo]+((a&3)===(b&3)?'s':'o')};
  // Half the hands come from the tiers where the answer changes, where the real learning is; the rest are random.
  function dealClass(near,last){
    const pool=CLASSES.filter(c=>near.includes(tierOf(c)));
    for(let k=0;k<20;k++){const c=pool.length&&Math.random()<.5?pool[rnd(pool.length)]:randomClass();if(c!==last)return c}
    return 'AA';
  }
  const cardHtml=c=>`<span class="pz-card${'♥♦'.includes(c[1])?' red':''}"><b>${c[0]==='T'?'10':c[0]}</b><i>${c[1]}</i></span>`;
  const miniChart=cell=>'<span class="tr-mini">'+CLASSES.map(c=>`<i class="${cell(c)}"></i>`).join('')+'</span>';

  /* ---------- the drill page, shared by every drill ----------
     Each drill names its elements with its own prefix (hr… for the range trainer, vr… for facing a raise) and
     supplies the rules: who it deals, the answers, the verdict, why, and how to colour the chart. */
  function page(pre,title){
    return `<button class="rivl-back outline" id="${pre}Back" type="button">← BACK TO TRAINING</button>
      <h1>${title}</h1>
      <div class="hr-head"><div class="hr-seats" id="${pre}Seats" role="group" aria-label="Seats to practice"></div>
        <div class="hr-seg" id="${pre}Size" role="group" aria-label="Table size"><button type="button" data-size="6">6-MAX</button><button type="button" data-size="9">9-MAX</button></div></div>
      <div class="pz-layout hr-layout">
        <div class="panel hr-spot">
          <div class="hr-felt" id="${pre}Felt" role="img"></div>
          <h3 class="pz-q" id="${pre}Q"></h3>
          <div class="pz-choices hr-choices" id="${pre}Choices"></div>
          <div class="hr-answer" id="${pre}Answer" hidden aria-live="polite">
            <div id="${pre}Verdict" class="pz-verdict"></div>
            <div id="${pre}Why" class="pz-why"></div>
            <button type="button" class="gold hr-next" id="${pre}Next">NEXT HAND</button>
            <p class="hr-keys" id="${pre}Keys"></p>
          </div>
        </div>
        <div class="panel hr-chart">
          <div class="hr-chart-head"><h3 class="pz-sub" id="${pre}ChartTitle"></h3><span id="${pre}ChartPct" class="hr-pct"></span></div>
          <div class="hr-tabs" id="${pre}Tabs" role="group" aria-label="Show another chart"></div>
          <div class="hr-grid-wrap"><div class="hr-grid" id="${pre}Grid"></div><div class="hr-lock" id="${pre}Lock"><span>Make your call to see the chart</span></div></div>
          <div class="hr-legend" id="${pre}Legend"></div>
          <p class="hr-fine" id="${pre}Fine"></p>
          <button type="button" class="gold hr-next hr-next-low" id="${pre}Next2" hidden>NEXT HAND</button>
          <h3 class="pz-sub hr-prog-title">YOUR PROGRESS</h3>
          <div class="pz-stats hr-stats"><div><b id="${pre}Streak">0</b><small>STREAK</small></div><div><b id="${pre}Acc">–</b><small>CORRECT</small></div><div><b id="${pre}Best">0</b><small>BEST STREAK</small></div></div>
          <div class="hr-recent" id="${pre}Recent" aria-label="Your last hands"></div>
        </div>
      </div>`;
  }
  const VERDICT={right:['CORRECT','✓','var(--g-best)'],close:['CLOSE','≈','var(--g-inaccuracy)'],wrong:['MISS','✗','var(--g-blunder)']};
  function makeDrill(cfg){
    const p=id=>$(cfg.pre+id);
    $(cfg.view).innerHTML=page(cfg.pre,cfg.title);
    const load=()=>{let s=null;try{s=JSON.parse(localStorage.getItem(cfg.key))}catch{}
      s=s&&typeof s==='object'?s:{};return Object.assign({size:6,seat:'ALL',n:0,c:0,streak:0,best:0,seats:{},recent:[]},s)};
    const st=load(),save=()=>{try{localStorage.setItem(cfg.key,JSON.stringify(st))}catch{}};
    let spot=null,tab=null;
    function paintFilters(){
      p('Size').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.size===st.size)));
      const seats=cfg.heroSeats(st.size);if(st.seat!=='ALL'&&!seats.includes(st.seat))st.seat='ALL';
      p('Seats').style.setProperty('--cols',seats.length<6?seats.length+1:5);// phones lay the seats out in one row or two
      p('Seats').innerHTML=['ALL',...seats].map(s=>{const k=st.seats[st.size+':'+s]||[0,0],acc=s==='ALL'?'':`<small>${k[0]?pct(k[1],k[0]):'–'}</small>`;
        return `<button type="button" data-seat="${s}" aria-pressed="${st.seat===s}"><span>${s==='ALL'?'ALL<span class="hr-long"> SEATS</span>':s}</span>${acc}</button>`}).join('');
      p('Seats').querySelectorAll('button').forEach(b=>b.onclick=()=>{st.seat=b.dataset.seat;save();paintFilters();deal()});
    }
    function paintFelt(){
      const seats=SEATS[spot.size],n=seats.length,h=seats.indexOf(spot.pos),table=cfg.table(spot);
      const ring=seats.map((s,i)=>{
        const k=(i-h+n)%n,a=(90+360*k/n)*Math.PI/180,x=50+44*Math.cos(a),y=50+38*Math.sin(a),{state,bet}=table[i];
        const cards=state==='live'||state==='raise'?'<span class="hr-backs"><i></i><i></i></span>':'';
        const em={folded:'FOLD',me:'YOU',raise:'RAISE'}[state]||'';
        return `<div class="hr-seat hr-s-${state}${x>52?' hr-east':''}" style="left:${x}%;top:${y}%">${cards}<span class="hr-tag"><b>${s}</b>${em?`<em>${em}</em>`:''}${s==='BTN'?'<span class="hr-dealer" title="Dealer button">D</span>':''}</span>${bet?`<span class="hr-blind"><i class="pz-chip"></i>${bet}</span>`:''}</div>`;
      }).join('');
      const pot=table.reduce((a,s)=>a+(+s.bet||0),0);
      p('Felt').innerHTML=ring+`<div class="hr-center"><div class="pz-pot">POT <b>${bbs(pot)}</b></div><div class="pz-hand">${spot.cards.map(cardHtml).join('')}</div></div>`;
      p('Felt').setAttribute('aria-label',`${spot.size}-max table. You are ${the(spot.pos)} with ${spot.cards.join(' ')}. ${cfg.say(spot)}`);
    }
    function paintStats(){
      p('Streak').textContent=st.streak;p('Best').textContent=st.best;p('Acc').textContent=pct(st.c,st.n);
      p('Recent').innerHTML=st.recent.length?'<small>LAST HANDS</small>'+st.recent.map(r=>`<span class="hr-chip hr-v-${r.v}" title="${esc(r.c+' '+r.p+': '+r.v)}">${esc(r.c)}<i>${esc(r.p)}</i></span>`).join(''):'';
    }
    function paintGrid(locked){
      const cell=cfg.cell(spot,tab);
      p('Grid').innerHTML=CLASSES.map(c=>`<span class="hr-cell ${locked?'hr-out':cell(c)}${!locked&&c===spot.cls?' hr-me':''}">${c}</span>`).join('');
      p('Grid').classList.toggle('hr-locked',locked);p('Lock').hidden=!locked;
      p('ChartTitle').textContent=locked?cfg.chartName:cfg.chartTitle(spot,tab);
      p('ChartPct').textContent=locked?'':cfg.chartPct(spot,tab);
      p('Legend').innerHTML=cfg.legend(spot,tab,locked).map(([k,l])=>`<span><i class="hr-key ${k}"></i>${esc(l)}</span>`).join('');
      p('Tabs').hidden=locked;
      p('Tabs').innerHTML=cfg.tabs(spot).map(t=>`<button type="button" data-tab="${t}" aria-pressed="${t===tab}">${cfg.tabLabel(t)}</button>`).join('');
      p('Tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;paintGrid(false)});
    }
    function deal(){
      const seats=cfg.heroSeats(st.size),pos=st.seat==='ALL'?seats[rnd(seats.length)]:st.seat;
      spot=Object.assign({size:st.size,pos},cfg.deal(st.size,pos,spot&&spot.cls));spot.cards=cardsFor(spot.cls);spot.answered=false;tab=cfg.tab(spot);
      paintFelt();paintGrid(true);paintStats();
      p('Q').textContent=cfg.question(spot);
      const acts=cfg.actions(spot);
      p('Choices').style.setProperty('--n',acts.length);
      p('Choices').innerHTML=acts.map(a=>`<button type="button" class="pz-choice" data-act="${a.act}">${a.label}${a.sub?`<small>${a.sub}</small>`:''}<kbd>${a.key.toUpperCase()}</kbd></button>`).join('');
      p('Choices').querySelectorAll('button').forEach(b=>b.onclick=()=>answer(b.dataset.act));
      p('Keys').textContent='Keys: '+acts.map(a=>`${a.key.toUpperCase()} ${a.label.toLowerCase()}`).join(', ')+', Enter next hand';
      p('Answer').hidden=p('Next2').hidden=true;
    }
    function answer(act){
      if(!spot||spot.answered)return;spot.answered=true;
      const j=cfg.judge(spot,act),v=j.v;
      st.n++;if(v==='right'){st.c++;st.streak++;st.best=Math.max(st.best,st.streak)}else if(v==='wrong')st.streak=0;
      const k=st.seats[spot.size+':'+spot.pos]||(st.seats[spot.size+':'+spot.pos]=[0,0]);k[0]++;if(v==='right')k[1]++;
      st.recent=[{c:spot.cls,p:cfg.tag(spot),v},...st.recent].slice(0,10);save();
      p('Choices').querySelectorAll('button').forEach(b=>{b.disabled=true;b.classList.toggle('best',b.dataset.act===j.best);b.classList.toggle('picked',b.dataset.act===act)});
      const [word,glyph,color]=VERDICT[v];
      p('Verdict').style.setProperty('--gc',color);
      p('Verdict').innerHTML=`<span class="pz-glyph">${glyph}</span><div><strong>${word}</strong><span>${esc(j.text)}</span></div>`;
      p('Why').innerHTML=cfg.why(spot).map(([h,t])=>`<div><h4>${h}</h4><p>${esc(t)}</p></div>`).join('');
      p('Answer').hidden=p('Next2').hidden=false;
      paintGrid(false);paintStats();paintFilters();
      // Bring the verdict on screen: phones scroll the question to the top, taller screens just far enough.
      if(matchMedia('(max-width:900px)').matches)p('Q').scrollIntoView({behavior:'smooth',block:'start'});
      else{const b=p('Verdict').getBoundingClientRect();if(b.bottom>innerHeight)scrollBy({top:b.bottom-innerHeight+24,behavior:'smooth'})}
    }
    function next(){deal();const f=p('Felt').getBoundingClientRect();if(f.top<0||f.bottom>innerHeight)p('Felt').scrollIntoView({behavior:'smooth',block:matchMedia('(max-width:900px)').matches?'start':'center'})}
    p('Next').onclick=p('Next2').onclick=next;
    p('Back').onclick=()=>show('training');
    p('Fine').textContent=cfg.fine;
    p('Size').querySelectorAll('button').forEach(b=>b.onclick=()=>{st.size=+b.dataset.size;save();paintFilters();deal()});
    return{
      get spot(){return spot},
      open(){if(!spot){paintFilters();deal()}},
      key(e){const k=e.key.toLowerCase();if(!spot)return false;
        if(!spot.answered){const a=cfg.actions(spot).find(x=>x.key===k||x.alt===k);if(a){answer(a.act);return true}}
        else if(k==='enter'||k===' '||k==='n'){next();return true}
        return false},
      stat(){const s=load();return s.n?`${s.n} hands played · ${pct(s.c,s.n)} correct · best streak ${s.best}`:'Deal as many hands as you like. Progress is saved in this browser.'},
      started:()=>load().n>0,
    };
  }

  /* ---------- the two drills ---------- */
  const rangeTrainer={view:'rangeTrainer',pre:'hr',key:'rivlRangeTrainer',title:'HAND RANGE TRAINER',chartName:'OPENING RANGE',
    eyebrow:'PREFLOP',name:'Hand Range Trainer',art:()=>{const r=cutoff(9,'BTN');return miniChart(c=>tierOf(c)<=2?'tr-a':tierOf(c)<=r?'tr-b':'')},
    text:'Everyone folds to you. Open or fold? Learn which hands to raise from every seat, at 6-max and full tables.',
    fine:'Standard 100 BB charts with no antes, the same ones RIVL grades your preflop play against. The small blind plays raise-or-fold.',
    heroSeats:size=>SEATS[size].slice(0,-1),
    deal(size,pos,last){const r=cutoff(size,pos);return{cls:dealClass([r-1,r,r+1,r+2].filter(t=>t>=0&&t<=8),last)}},
    question:()=>'EVERYONE FOLDS TO YOU. OPEN OR FOLD?',say:()=>'Everyone before you folds.',
    actions:()=>[{act:'raise',label:'RAISE',sub:`to ${bbs(OPEN_TO)}`,key:'r'},{act:'fold',label:'FOLD',key:'f'}],
    table:s=>SEATS[s.size].map((x,i,a)=>({state:x===s.pos?'me':i<a.indexOf(s.pos)?'folded':'live',bet:x==='SB'?'0.5':x==='BB'?'1':''})),
    judge(s,act){
      const {open,v}=judge(s.size,s.pos,s.cls,act),play=open?'raise':'fold',from=the(s.pos);
      const text=v==='right'?`${s.cls} from ${from} is a ${play}.`:v==='close'?(open?`${s.cls} is the edge of the range. The chart still opens it from ${from}, so folding is a small mistake.`:`${s.cls} is just outside the range. The chart folds it from ${from}, so the raise is a small mistake.`):`The chart ${open?'opens':'folds'} ${s.cls} from ${from}.`;
      return{v,best:play,text};
    },
    why:s=>{const {open}=judge(s.size,s.pos,s.cls,'raise');return[['THE HAND',handText(s.size,s.pos,s.cls,open)],['THE SEAT',seatText(s.size,s.pos)]]},
    tag:s=>s.pos,
    tabs:s=>SEATS[s.size].slice(0,-1),tab:s=>s.pos,tabLabel:t=>t,
    chartTitle:(s,t)=>`${t} OPENING RANGE`,
    chartPct:(s,t)=>{const x=openPct(s.size,t);return `${Math.round(x*100)}% · ${Math.round(x*1326)} of 1,326 combos`},
    // Light gold marks the hands this seat adds to the one before it (nothing to compare with at the first seat).
    cell(s,t){const seats=SEATS[s.size],i=seats.indexOf(t),r=cutoff(s.size,t),prev=i>0?cutoff(s.size,seats[i-1]):r;
      return c=>{const x=tierOf(c);return x>r?'hr-out':x>prev?'hr-in-new':'hr-in-old'}},
    legend(s,t,locked){
      const seats=SEATS[s.size],i=seats.indexOf(t),r=cutoff(s.size,t),prev=i>0?cutoff(s.size,seats[i-1]):r;
      return locked||prev===r?[['hr-in-old','Open'],['hr-out','Fold']]:[['hr-in-old','Opens from earlier seats too'],['hr-in-new','Added at this seat'],['hr-out','Fold']];
    },
  };
  const CELL_VS={raise:'hr-3bet',call:'hr-call',fold:'hr-out'};
  const vsRaise={view:'vsRaise',pre:'vr',key:'rivlRaiseTrainer',title:'FACING A RAISE',chartName:'DEFENDING RANGE',
    eyebrow:'PREFLOP',name:'Facing a Raise',art:()=>miniChart(c=>({raise:'tr-a',call:'tr-c',fold:''})[bestOf(labels(9,'BTN','BB',c))]),
    text:'Someone opens before you. 3-bet, call or fold? Learn how to answer a raise from every seat, blinds included.',
    fine:`Standard 100 BB charts against one ${OPEN_TO} BB open with everyone else folded, the same ones RIVL grades your play against. 3-bets go to 3x in position and 4x from the blinds.`,
    heroSeats:size=>SEATS[size].slice(1),
    deal(size,pos,last){
      const seats=SEATS[size],opener=seats[rnd(seats.indexOf(pos))],W=R.bookWindows(vsBook(size,opener,pos,'AA'));
      const edges=[W.raise[1],W.raise[1]+1];if(W.call&&!W.weakCall)edges.push(W.call[1],W.call[1]+1);
      return{opener,cls:dealClass(edges.filter(t=>t<=8),last)};
    },
    question:s=>`${s.opener} OPENS TO ${OPEN_TO} BB. 3-BET, CALL OR FOLD?`,
    say:s=>`${cap(who(s.opener))} opens to ${OPEN_TO} BB${SEATS[s.size].indexOf(s.pos)>1?' and the others before you fold':''}.`,
    actions:s=>[{act:'raise',label:'3-BET',sub:`to ${bbs(threeBetTo(s.pos))}`,key:'r',alt:'3'},{act:'call',label:'CALL',sub:bbs(OPEN_TO-blindOf(s.pos)),key:'c'},{act:'fold',label:'FOLD',key:'f'}],
    table:s=>{const seats=SEATS[s.size],o=seats.indexOf(s.opener),h=seats.indexOf(s.pos);
      return seats.map((x,i)=>({state:i===h?'me':i===o?'raise':i<h?'folded':'live',bet:i===o?String(OPEN_TO):x==='SB'?'0.5':x==='BB'?'1':''}))},
    judge(s,act){
      const j=vsJudge(s.size,s.opener,s.pos,s.cls,act),against=`against a raise from ${the(s.opener)}`,best=j.best,c=s.cls;
      let text;
      if(j.v==='right')text=`${c} ${posPhrase(s.pos)} ${against} is a ${ACT_NAME[best]}.`;
      else if(j.v==='close')text=act==='call'&&best==='raise'?(s.pos==='SB'?'Flat-calling from the small blind is allowed, but the chart prefers a 3-bet.':'Calling is sound, but the chart\'s first choice is a 3-bet.')
        :act==='raise'?`${c} is just outside the 3-bet range. The chart ${ACT_VERB[best]} it, so the 3-bet is a small mistake.`
        :`${c} is right on the edge. The chart still ${ACT_VERB[best]} it, so folding is a small mistake.`;
      else text=`The chart ${ACT_VERB[best]} ${c} ${posPhrase(s.pos)} ${against}.`;
      return{v:j.v,best,text};
    },
    why:s=>[['THE HAND',vsHandText(s.size,s.opener,s.pos,s.cls)],['THE SPOT',vsSpotText(s.size,s.opener,s.pos)]],
    tag:s=>`${s.pos} v ${s.opener}`,
    tabs:s=>SEATS[s.size].slice(0,SEATS[s.size].indexOf(s.pos)),tab:s=>s.opener,tabLabel:t=>'vs '+t,
    chartTitle:(s,t)=>`${s.pos} VS ${t} OPEN`,
    chartPct:(s,t)=>{const x=vsShares(s.size,t,s.pos);return `3-bet ${x.raise}% · `+(x.call?`call ${x.call}%`:'fold the rest')},
    cell:(s,t)=>c=>CELL_VS[bestOf(labels(s.size,t,s.pos,c))],
    // The small blind's charts have no calls, so they drop the Call key.
    legend:(s,t)=>[['hr-3bet','3-bet'],...vsShares(s.size,t,s.pos).call?[['hr-call','Call']]:[],['hr-out','Fold']],
  };

  /* ---------- the hub: add a drill to DRILLS and an empty <section class="view content-view"> in index.html ---------- */
  const DRILLS=[rangeTrainer,vsRaise];
  DRILLS.forEach(d=>drills[d.view]=makeDrill(d));
  function paintHub(){
    $('trHub').innerHTML=DRILLS.map((d,i)=>{const m=drills[d.view];
      return `<article class="panel tr-card"><div class="tr-art" aria-hidden="true">${d.art()}</div><div class="tr-body"><div class="tr-eyebrow">${d.eyebrow}</div><h3>${esc(d.name)}</h3><p>${esc(d.text)}</p><small class="tr-stat">${esc(m.stat())}</small><button type="button" class="gold" data-drill="${i}">${m.started()?'CONTINUE':'START TRAINING'}</button></div></article>`}).join('')
      +'<article class="panel tr-card tr-soon"><div class="tr-plus" aria-hidden="true">+</div><div class="tr-body"><div class="tr-eyebrow">COMING LATER</div><h3>More drills</h3><p>New drills will appear here as they are added.</p></div></article>';
    $('trHub').querySelectorAll('[data-drill]').forEach(b=>b.onclick=()=>show(DRILLS[+b.dataset.drill].view));
  }
  doc.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
    const d=DRILLS.find(x=>$(x.view).classList.contains('active'));
    if(d&&drills[d.view].key(e))e.preventDefault();
  });
  doc.addEventListener('rivl:view',e=>{if(e.detail==='training')paintHub();if(drills[e.detail])drills[e.detail].open()});
  paintHub();
})(typeof window!=='undefined'?window:globalThis);
