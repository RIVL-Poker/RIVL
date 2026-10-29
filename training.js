/* RIVL Training: a hub of short drills (DRILLS below; each drill is its own view) and the first drill, the hand
   range trainer. It deals a seat and a hand with everyone folded to you; you open-raise or fold, then see the
   chart's answer, why, and the full opening range for that seat. The charts are rating.js's preflop tiers, so the
   trainer teaches exactly what the decision grader rewards. Progress is kept in this browser. */
(root=>{
  const R=root.RivlRating;if(!R)return;

  /* ---------- seats and charts ---------- */
  const SEATS={6:['UTG','HJ','CO','BTN','SB','BB'],9:['UTG','UTG+1','MP','LJ','HJ','CO','BTN','SB','BB']};
  const NAME={UTG:'under the gun','UTG+1':'UTG+1',MP:'middle position',LJ:'lojack',HJ:'hijack',CO:'cutoff',BTN:'button',SB:'small blind',BB:'big blind'};
  const the=p=>p==='UTG'?'under the gun':p==='UTG+1'?'UTG+1':'the '+NAME[p];
  const RANKS='AKQJT98765432';
  const TIER=new Map();R.TIERS.forEach((l,t)=>l.split(' ').forEach(h=>TIER.set(h,t)));
  const tierOf=c=>TIER.has(c)?TIER.get(c):9;
  const CLASSES=[];for(let i=0;i<13;i++)for(let j=0;j<13;j++)CLASSES.push(i===j?RANKS[i]+RANKS[i]:i<j?RANKS[i]+RANKS[j]+'s':RANKS[j]+RANKS[i]+'o');
  const combos=c=>c.length===2?6:c[2]==='s'?4:12;
  // The last tier a seat opens: players behind decide it, and the small blind opens like the button.
  const cutoff=(size,pos)=>{const s=SEATS[size];return R.rfiTier(s.length-1-s.indexOf(pos),false,pos==='SB')};
  const openPct=(size,pos)=>{const r=cutoff(size,pos);return CLASSES.reduce((a,c)=>a+(tierOf(c)<=r?combos(c):0),0)/1326};
  const pct=(c,n)=>n?Math.round(100*c/n)+'%':'–';
  const earliest=(size,t)=>SEATS[size].slice(0,-1).find(p=>cutoff(size,p)>=t);

  /* ---------- saved progress (this browser) ---------- */
  const KEY='rivlRangeTrainer';
  function load(){let s=null;try{s=JSON.parse(localStorage.getItem(KEY))}catch{}
    s=s&&typeof s==='object'?s:{};return Object.assign({size:6,seat:'ALL',n:0,c:0,streak:0,best:0,seats:{},recent:[]},s)}
  const save=s=>{try{localStorage.setItem(KEY,JSON.stringify(s))}catch{}};

  /* ---------- dealing ---------- */
  const SUITS='♠♥♦♣',rnd=n=>Math.floor(Math.random()*n);
  function cardsFor(c){
    const a=rnd(4);let b=rnd(4);
    if(c.length===2)while(b===a)b=rnd(4);else if(c[2]==='s')b=a;else while(b===a)b=rnd(4);
    return [c[0]+SUITS[a],c[1]+SUITS[b]];
  }
  // Half the hands are near the seat's edge, where the real learning is; the rest are dealt at random.
  function dealClass(size,pos,last){
    const r=cutoff(size,pos);
    for(let k=0;k<20;k++){
      let c;
      if(Math.random()<.5){const near=CLASSES.filter(x=>{const t=tierOf(x);return t>=r-1&&t<=Math.min(r+2,8)});c=near[rnd(near.length)]}
      else{const a=rnd(52);let b=rnd(51);if(b>=a)b++;const ra=a>>2,rb=b>>2,hi=Math.min(ra,rb),lo=Math.max(ra,rb);
        c=ra===rb?RANKS[ra]+RANKS[ra]:RANKS[hi]+RANKS[lo]+((a&3)===(b&3)?'s':'o')}
      if(c!==last)return c;
    }
    return 'AA';
  }

  /* ---------- explanations ---------- */
  function kind(c){
    const hi=RANKS.length-1-RANKS.indexOf(c[0]),lo=RANKS.length-1-RANKS.indexOf(c[1]);// 12 = ace
    if(c.length===2)return hi>=8?'bigPair':'pair';
    const suited=c[2]==='s',broad=lo>=8;
    if(suited){if(broad)return 'suitedBroadway';if(hi===12)return lo<=3?'wheelAce':'suitedAce';if(hi-lo<=2&&lo>=1)return 'connector';return 'suitedOther'}
    if(broad)return 'offBroadway';if(hi===12)return 'offAce';return 'offOther';
  }
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
    const s=SEATS[size],behind=s.length-1-s.indexOf(pos),p=Math.round(100*openPct(size,pos));
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
    const k=kind(c),late=seats.length-1-seats.indexOf(pos)<=3;
    // Weak suited hands open only from late seats, where winning the blinds is the main reason.
    const why=k==='suitedOther'&&open&&late?'The suited card adds flush potential, and with only a few players left behind, winning the blinds often is enough to make the raise pay.':WHY[k][open?0:1];
    return line+' '+why;
  }

  let spot=null;
  root.RivlTraining={SEATS,CLASSES,cutoff,tierOf,openPct,judge,handText,seatText,get spot(){return spot}};
  const doc=root.document;if(!doc||!doc.getElementById('training'))return;
  const $=id=>doc.getElementById(id);
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  /* ---------- the hub: add a drill here and give it a section in index.html ---------- */
  const DRILLS=[
    {view:'rangeTrainer',eyebrow:'PREFLOP',title:'Hand Range Trainer',art:()=>miniChart(),
      text:'Everyone folds to you. Open or fold? Learn which hands to raise from every seat, at 6-max and full tables.',
      stat:()=>{const s=load();return s.n?`${s.n} hands played · ${pct(s.c,s.n)} correct · best streak ${s.best}`:'Deal as many hands as you like. Progress is saved in this browser.'}},
  ];
  function paintHub(){
    $('trHub').innerHTML=DRILLS.map((d,i)=>`<article class="panel tr-card"><div class="tr-art" aria-hidden="true">${d.art()}</div><div class="tr-body"><div class="tr-eyebrow">${d.eyebrow}</div><h3>${esc(d.title)}</h3><p>${esc(d.text)}</p><small class="tr-stat">${esc(d.stat())}</small><button type="button" class="gold" data-drill="${i}">${load().n?'CONTINUE':'START TRAINING'}</button></div></article>`).join('')
      +'<article class="panel tr-card tr-soon"><div class="tr-plus" aria-hidden="true">+</div><div class="tr-body"><div class="tr-eyebrow">COMING LATER</div><h3>More drills</h3><p>New drills will appear here as they are added.</p></div></article>';
    $('trHub').querySelectorAll('[data-drill]').forEach(b=>b.onclick=()=>show(DRILLS[+b.dataset.drill].view));
  }

  /* ---------- painting ---------- */
  const st=load();let shownSeat=null;
  const cardHtml=c=>`<span class="pz-card${'♥♦'.includes(c[1])?' red':''}"><b>${c[0]==='T'?'10':c[0]}</b><i>${c[1]}</i></span>`;
  function paintFilters(){
    $('hrSize').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.size===st.size)));
    const seats=SEATS[st.size].slice(0,-1);if(st.seat!=='ALL'&&!seats.includes(st.seat))st.seat='ALL';
    $('hrSeats').style.setProperty('--cols',st.size===6?6:5);// phones lay the seats out in one row (6-max) or two (9-max)
    $('hrSeats').innerHTML=['ALL',...seats].map(p=>{const k=st.seats[st.size+':'+p]||[0,0],acc=p==='ALL'?'':`<small>${k[0]?pct(k[1],k[0]):'–'}</small>`;
      return `<button type="button" data-seat="${p}" aria-pressed="${st.seat===p}"><span>${p==='ALL'?'ALL<span class="hr-long"> SEATS</span>':p}</span>${acc}</button>`}).join('');
    $('hrSeats').querySelectorAll('button').forEach(b=>b.onclick=()=>{st.seat=b.dataset.seat;save(st);paintFilters();deal()});
  }
  function paintFelt(){
    const seats=SEATS[spot.size],n=seats.length,h=seats.indexOf(spot.pos);
    const ring=seats.map((p,i)=>{
      const k=(i-h+n)%n,a=(90+360*k/n)*Math.PI/180,x=50+44*Math.cos(a),y=50+38*Math.sin(a);
      const state=i===h?'me':i<h?'folded':'live',bet=p==='SB'?'0.5':p==='BB'?'1':'';
      const cards=state==='live'?'<span class="hr-backs"><i></i><i></i></span>':'';
      return `<div class="hr-seat hr-s-${state}${x>52?' hr-east':''}" style="left:${x}%;top:${y}%">${cards}<span class="hr-tag"><b>${p}</b>${state==='folded'?'<em>FOLD</em>':state==='me'?'<em>YOU</em>':''}${p==='BTN'?'<span class="hr-dealer" title="Dealer button">D</span>':''}</span>${bet?`<span class="hr-blind"><i class="pz-chip"></i>${bet}</span>`:''}</div>`;
    }).join('');
    $('hrFelt').innerHTML=ring+`<div class="hr-center"><div class="pz-pot">POT <b>1.5 BB</b></div><div class="pz-hand" id="hrHand">${spot.cards.map(cardHtml).join('')}</div></div>`;
    $('hrFelt').setAttribute('aria-label',`${spot.size}-max table. Folded to you ${the(spot.pos)} with ${spot.cards.join(' ')}.`);
  }
  function paintStats(){
    $('hrStreak').textContent=st.streak;$('hrBest').textContent=st.best;$('hrAcc').textContent=pct(st.c,st.n);
    $('hrRecent').innerHTML=st.recent.length?'<small>LAST HANDS</small>'+st.recent.map(r=>`<span class="hr-chip hr-v-${r.v}" title="${esc(r.c+' from '+r.p+': '+r.v)}">${r.c}<i>${r.p}</i></span>`).join(''):'';
  }
  function paintGrid(locked){
    const size=spot.size,pos=shownSeat,r=cutoff(size,pos),seats=SEATS[size],i=seats.indexOf(pos),prev=i>0?cutoff(size,seats[i-1]):-1;
    $('hrGrid').innerHTML=CLASSES.map(c=>{const t=tierOf(c),cl=locked||t>r?'hr-out':t>prev&&i>0?'hr-in-new':'hr-in-old';
      return `<span class="hr-cell ${cl}${!locked&&c===spot.cls?' hr-me':''}">${c}</span>`}).join('');
    $('hrGrid').classList.toggle('hr-locked',locked);$('hrLock').hidden=!locked;
    $('hrChartTitle').textContent=locked?'OPENING RANGE':`${pos} OPENING RANGE`;
    const p=openPct(size,pos);$('hrChartPct').textContent=locked?'':`${Math.round(p*100)}% · ${Math.round(p*1326)} of 1,326 combos`;
    $('hrTabs').hidden=locked;
    // The first seat has nothing earlier to compare with, and the small blind opens the button's range.
    const added=!locked&&CLASSES.some(c=>{const t=tierOf(c);return t<=r&&t>prev});
    $('hrKeyOld').textContent=added&&i>0?'Opens from earlier seats too':'Open';$('hrKeyNew').hidden=!added||i===0;
    $('hrTabs').innerHTML=seats.slice(0,-1).map(p=>`<button type="button" data-seat="${p}" aria-pressed="${p===pos}">${p}</button>`).join('');
    $('hrTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{shownSeat=b.dataset.seat;paintGrid(false)});
  }
  function deal(){
    const seats=SEATS[st.size].slice(0,-1),pos=st.seat==='ALL'?seats[rnd(seats.length)]:st.seat;
    const cls=dealClass(st.size,pos,spot&&spot.cls);
    spot={size:st.size,pos,cls,cards:cardsFor(cls),answered:false};shownSeat=pos;
    paintFelt();paintGrid(true);paintStats();
    $('hrChoices').querySelectorAll('button').forEach(b=>{b.disabled=false;b.classList.remove('best','picked')});
    $('hrAnswer').hidden=$('hrNext2').hidden=true;
  }
  function answer(act){
    if(!spot||spot.answered)return;spot.answered=true;
    const {open,v}=judge(spot.size,spot.pos,spot.cls,act);
    st.n++;if(v==='right'){st.c++;st.streak++;st.best=Math.max(st.best,st.streak)}else if(v==='wrong')st.streak=0;
    const k=st.seats[spot.size+':'+spot.pos]||(st.seats[spot.size+':'+spot.pos]=[0,0]);k[0]++;if(v==='right')k[1]++;
    st.recent=[{c:spot.cls,p:spot.pos,v},...st.recent].slice(0,10);save(st);
    $('hrChoices').querySelectorAll('button').forEach(b=>{b.disabled=true;b.classList.toggle('best',(b.dataset.act==='raise')===open);b.classList.toggle('picked',b.dataset.act===act)});
    const play=open?'raise':'fold';
    const head={right:['CORRECT','✓','var(--g-best)',`${spot.cls} from ${the(spot.pos)} is a ${play}.`],
      close:['CLOSE','≈','var(--g-inaccuracy)',open?`${spot.cls} is the edge of the range. The chart still opens it from ${the(spot.pos)}, so folding is a small mistake.`:`${spot.cls} is just outside the range. The chart folds it from ${the(spot.pos)}, so the raise is a small mistake.`],
      wrong:['MISS','✗','var(--g-blunder)',`The chart ${open?'opens':'folds'} ${spot.cls} from ${the(spot.pos)}.`]}[v];
    $('hrVerdict').style.setProperty('--gc',head[2]);
    $('hrVerdict').innerHTML=`<span class="pz-glyph">${head[1]}</span><div><strong>${head[0]}</strong><span>${esc(head[3])}</span></div>`;
    $('hrWhy').innerHTML=`<div><h4>THE HAND</h4><p>${esc(handText(spot.size,spot.pos,spot.cls,open))}</p></div><div><h4>THE SEAT</h4><p>${esc(seatText(spot.size,spot.pos))}</p></div>`;
    $('hrAnswer').hidden=$('hrNext2').hidden=false;
    paintGrid(false);paintStats();paintFilters();
    // Bring the verdict on screen: phones scroll the question to the top, taller screens just far enough.
    if(matchMedia('(max-width:900px)').matches)$('hrQ').scrollIntoView({behavior:'smooth',block:'start'});
    else{const b=$('hrVerdict').getBoundingClientRect();if(b.bottom>innerHeight)scrollBy({top:b.bottom-innerHeight+24,behavior:'smooth'})}
  }
  function next(){deal();const f=$('hrFelt').getBoundingClientRect();if(f.top<0||f.bottom>innerHeight)$('hrFelt').scrollIntoView({behavior:'smooth',block:matchMedia('(max-width:900px)').matches?'start':'center'})}

  // The hub's card art: the button's range as a tiny chart.
  function miniChart(){const r=cutoff(9,'BTN');return '<span class="tr-mini">'+CLASSES.map(c=>`<i class="${tierOf(c)<=2?'tr-a':tierOf(c)<=r?'tr-b':''}"></i>`).join('')+'</span>'}

  $('hrChoices').querySelectorAll('button').forEach(b=>b.onclick=()=>answer(b.dataset.act));
  $('hrNext').onclick=$('hrNext2').onclick=next;
  $('hrBack').onclick=()=>show('training');
  $('hrSize').querySelectorAll('button').forEach(b=>b.onclick=()=>{st.size=+b.dataset.size;save(st);paintFilters();deal()});
  doc.addEventListener('keydown',e=>{
    if(!spot||!$('rangeTrainer').classList.contains('active')||e.ctrlKey||e.metaKey||e.altKey||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
    const k=e.key.toLowerCase();
    if(!spot.answered&&(k==='r'||k==='f')){e.preventDefault();answer(k==='r'?'raise':'fold')}
    else if(spot.answered&&(k==='enter'||k===' '||k==='n')){e.preventDefault();next()}
  });
  doc.addEventListener('rivl:view',e=>{if(e.detail==='training')paintHub();if(e.detail==='rangeTrainer'&&!spot){paintFilters();deal()}});
  paintHub();
})(typeof window!=='undefined'?window:globalThis);
