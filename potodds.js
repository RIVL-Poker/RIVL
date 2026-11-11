/* RIVL Training: Pot Odds & Draws. You hold a draw, the opponent bets, and you call or fold.
   Their cards are face-up, so the answer is exact arithmetic, not an estimate:
   - Turn spots: one card to come. Every one of the 44 cards you can't see is checked against their hand.
   - Flop spots: they are all-in, so one call sees both cards. All 990 turn-and-river pairs are checked.
   Your equity (wins, plus half the splits) is compared with the price, call ÷ (pot after your call), and the
   call's EV is graded by rating.js's own grade(), the same EV-loss scale the decision grader uses after the flop.
   The room joins the Training hub through RivlTraining.add (training.js). Progress is kept in this browser. */
(root=>{
  const R=root.RivlRating;if(!R)return;
  const R13='23456789TJQKA',S4='♠♥♦♣',RANK_NAME=['two','three','four','five','six','seven','eight','nine','ten','jack','queen','king','ace'];
  const SUIT_NAME=['spades','hearts','diamonds','clubs'];
  const cardName=c=>R13[c>>2]+S4[c&3],rankOf=c=>c>>2,suitOf=c=>c&3;
  const CAT=['high card','a pair','two pair','three of a kind','a straight','a flush','a full house','four of a kind','a straight flush'];
  const catOf=v=>Math.floor(v/1048576),score=cs=>R.rankHand(cs);
  const BB=10;// chips per big blind, as at the tables

  /* ---------- draws ---------- */
  const maskOf=cs=>cs.reduce((m,c)=>m|1<<rankOf(c),0);
  const straightHigh=m=>{const m2=(m<<1)|((m>>12)&1);for(let h=13;h>=4;h--)if(((m2>>(h-4))&31)===31)return h-1;return -1};
  // What the hero is drawing to, using at least one hole card: a flush (four of a suit) and the ranks that make a straight.
  function drawOf(hero,board){
    const all=hero.concat(board),n=[0,0,0,0],mine=[0,0,0,0];all.forEach(c=>n[suitOf(c)]++);hero.forEach(c=>mine[suitOf(c)]++);
    const flushSuit=n.findIndex((k,s)=>k===4&&mine[s]>0),made=n.some(k=>k>=5);
    const m=maskOf(all),bm=maskOf(board),now=straightHigh(m),ranks=[];
    for(let r=0;r<13;r++){if(m&1<<r)continue;const s=straightHigh(m|1<<r);if(s>now&&s>straightHigh(bm|1<<r))ranks.push(r)}
    // Four ranks in a row (the ace also counts low) is open-ended; two separate gaps is a double gutshot.
    const m2=(m<<1)|((m>>12)&1);let row=false;for(let h=13;h>=3;h--)if(((m2>>(h-3))&15)===15){row=true;break}
    const flush=flushSuit>=0&&!made,straight=now<0?ranks.length:0;
    const type=flush&&straight?'combo':flush?'flush':straight>=2?'oesd':straight===1?'gutshot':'';
    return{type,flushSuit:flush?flushSuit:-1,straightRanks:now<0?ranks:[],open:row,madeStraight:now>=0,madeFlush:made};
  }
  const TYPES=['flush','oesd','gutshot','combo'];
  const TYPE_LABEL={flush:'FLUSH DRAW',oesd:'OPEN-ENDER',gutshot:'GUTSHOT',combo:'COMBO DRAW'};
  const TYPE_SHORT={flush:'Flush',oesd:'OESD',gutshot:'Gutshot',combo:'Combo'};

  /* ---------- exact equity ----------
     Every unseen card (and, on the flop, every pair of them) is dealt out and both hands are scored. */
  function solve(hero,villain,board){
    const dead=new Uint8Array(52);hero.concat(villain,board).forEach(c=>dead[c]=1);
    const live=[];for(let c=0;c<52;c++)if(!dead[c])live.push(c);
    const before=catOf(score(hero.concat(board)));
    // The next card on its own: does it put you ahead, split, or complete your draw and still lose?
    const cards=live.map(c=>{
      const h=score(hero.concat(board,[c])),v=score(villain.concat(board,[c])),hc=catOf(h);
      return{c,res:h>v?'out':h===v?'split':hc>=4&&hc>before?'dirty':'blank',heroCat:hc,villainCat:catOf(v),win:0,tie:0,n:0};
    });
    let win=0,tie=0,total=0;
    if(board.length===4){
      cards.forEach(x=>{x.n=1;if(x.res==='out')x.win=1;else if(x.res==='split')x.tie=1});
      win=cards.filter(x=>x.res==='out').length;tie=cards.filter(x=>x.res==='split').length;total=cards.length;
    }else{
      const H=hero.concat(board),V=villain.concat(board);
      for(let i=0;i<live.length;i++)for(let j=i+1;j<live.length;j++){
        const a=live[i],b=live[j],h=score(H.concat([a,b])),v=score(V.concat([a,b]));total++;
        const w=h>v?1:0,t=h===v?1:0;win+=w;tie+=t;
        for(const x of [cards[i],cards[j]]){x.n++;x.win+=w;x.tie+=t}
      }
    }
    return{cards,win,tie,total,eq:(win+tie/2)/total,outs:cards.filter(x=>x.res==='out').length,splits:cards.filter(x=>x.res==='split').length,
      oneCard:board.length===4,heroNow:score(hero.concat(board)),villainNow:score(villain.concat(board))};
  }

  /* ---------- the price and the grade ---------- */
  // pot is what was in the middle before their bet; bet is what you must call. Amounts in big blinds.
  const priceOf=(pot,bet)=>({need:bet/(pot+2*bet),final:pot+2*bet});
  const evOf=(eq,pot,bet)=>eq*(pot+2*bet)-bet;
  // The grader's own analysis object for a call-or-fold spot with known equity, so grade() labels the answer.
  function analysis(s){
    const eq=s.solved.eq,pot=(s.pot+s.bet)*BB,toCall=s.bet*BB;
    return{i:0,eq,toCall,callTo:toCall,pot,bb:BB,canRaise:false,minTotal:toCall,maxTotal:toCall,hand:1,street:s.board.length===4?2:1,book:null,
      opts:[{type:'fold',ev:0,label:'Fold'},{type:'call',ev:eq*(pot+toCall)-toCall,label:`Call ${s.bet} BB`}],
      madeCat:catOf(s.solved.heroNow),boardCat:catOf(score(s.board))};
  }
  const ACTS=['call','fold'];
  function labels(s){const A=analysis(s),L={};for(const a of ACTS)L[a]=R.grade(A,a,0).label;return L}
  // The better play by EV; at exactly break-even calling and folding are worth the same, and both grade Best.
  const bestOf=s=>evOf(s.solved.eq,s.pot,s.bet)>=0?'call':'fold';
  const verdictOf=label=>label==='Best'||label==='Brilliant'?'right':label==='Excellent'||label==='Good'?'close':'wrong';
  function judge(s,act){const L=labels(s);return{L,best:bestOf(s),label:L[act],v:verdictOf(L[act])}}

  /* ---------- dealing ---------- */
  const POTS={turn:[6,8,10,12,14,16,20,24,30],flop:[6,7,8,10,12,15,18]};
  const SIZES={turn:[1/4,1/3,1/2,2/3,3/4,1,5/4,3/2,2],flop:[3/4,1,5/4,3/2,2,5/2,3]};
  const half=x=>Math.max(1,Math.round(x*2)/2);
  // A spot: hero holds a draw of the chosen type and is behind a made hand (a pair up to a set, nothing that already
  // beats every draw). Half the bets are sized close to the break-even price, where the decision is a real one.
  function deal(street,type,rand=Math.random,last){
    const rnd=n=>Math.floor(rand()*n),nb=street==='turn'?4:3;
    for(let tries=0;tries<20000;tries++){
      const deck=[...Array(52).keys()];
      for(let k=0;k<4+nb;k++){const j=k+rnd(52-k);[deck[k],deck[j]]=[deck[j],deck[k]]}
      const hero=deck.slice(0,2),villain=deck.slice(2,4),board=deck.slice(4,4+nb);
      const d=drawOf(hero,board);
      if(!d.type||(type&&type!=='all'&&d.type!==type))continue;
      if(d.madeStraight||d.madeFlush)continue;
      const hv=score(hero.concat(board)),vv=score(villain.concat(board)),vc=catOf(vv);
      if(catOf(hv)>1||vv<=hv||vc<1||vc>3||vc<=catOf(score(board)))continue;// you hold at most a pair; they hold a pair or better of their own
      if(last&&String(last)===String(hero.concat(board)))continue;
      const solved=solve(hero,villain,board),pot=POTS[street][rnd(POTS[street].length)];
      const options=SIZES[street].map(f=>{const bet=half(f*pot);return{bet,gap:Math.abs(priceOf(pot,bet).need-solved.eq)}});
      const near=options.slice().sort((a,b)=>a.gap-b.gap).slice(0,3);
      const bet=(rand()<.5?near[rnd(near.length)]:options[rnd(options.length)]).bet;
      return{street,hero,villain,board,draw:d,solved,pot,bet};
    }
    return null;
  }

  /* ---------- why ---------- */
  const pct1=x=>(Math.round(x*1000)/10).toFixed(1)+'%';
  const bbs=x=>(Math.round(x*10)/10)+' BB';
  const list=a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1];
  const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
  const WORD={4:'straight',5:'flush',8:'straight flush',6:'full house',7:'four of a kind',3:'three of a kind',2:'two pair',1:'pair'};
  function drawText(s){
    const d=s.draw,parts=[];
    if(d.flushSuit>=0)parts.push(`a ${SUIT_NAME[d.flushSuit].slice(0,-1)} flush draw`);
    if(d.straightRanks.length){const r=d.straightRanks,one=r.length===1&&`(only ${/^[ae]/.test(RANK_NAME[r[0]])?'an':'a'} ${RANK_NAME[r[0]]} makes it)`;
      parts.push(r.length>=2?(d.open?'an open-ended straight draw':'a double gutshot'):d.open?`a one-ended straight draw ${one}`:`a gutshot ${one}`)}
    return list(parts);
  }
  function outsText(s){
    const x=s.solved,groups=new Map();
    x.cards.filter(c=>c.res==='out').forEach(c=>{const k=c.heroCat;groups.set(k,(groups.get(k)||0)+1)});
    const made=[...groups.entries()].sort((a,b)=>b[0]-a[0]).map(([k,n],i)=>`${n} ${i?'more ':''}make${n===1?'s':''} ${k===1?'a pair that wins':k===2?'two pair that wins':k===3?'trips that win':CAT[k]}`);
    const dirty=x.cards.filter(c=>c.res==='dirty'),why=new Map();
    dirty.forEach(c=>{const k=c.villainCat;why.set(k,(why.get(k)||[]).concat(cardName(c.c)))});
    const dirtyText=dirty.length?' '+[...why.entries()].map(([k,cs])=>`The ${list(cs)} complete${cs.length===1?'s':''} your draw but give${cs.length===1?'s':''} them ${k===dirty.find(c=>c.villainCat===k).heroCat?'a better '+CAT[k].slice(2):CAT[k]}, so ${cs.length===1?'it is':'they are'} not outs.`).join(' '):'';
    // Their hole cards can't come: say so when they hold cards you would want.
    const want=c=>s.draw.flushSuit===suitOf(c)||s.draw.straightRanks.includes(rankOf(c));
    const blocked=s.villain.filter(want).map(cardName);
    const blockText=blocked.length?` They hold the ${list(blocked)}, ${blocked.length===1?'a card':'cards'} you wanted, so ${blocked.length===1?'it':'those'} can't come.`:'';
    const splitText=x.splits?` ${plural(x.splits,'card')} would split the pot, which counts as half a win.`:'';
    const lead=`You have ${drawText(s)}. `;
    if(x.oneCard){
      const n=x.cards.length;
      return lead+(x.outs?`${plural(x.outs,'card')} of the ${n} you can't see win${x.outs===1?'s':''}: ${list(made)}.`:`None of the ${n} cards you can't see wins for you.`)+dirtyText+blockText+splitText
        +` One card to come: ${x.outs}${x.splits?` + ${x.splits}÷2`:''} ÷ ${n} = ${pct1(x.eq)} to win.`;
    }
    const four=Math.min(100,x.outs*4);
    return lead+(x.outs?`On the turn, ${plural(x.outs,'card')} put you ahead: ${list(made)}.`:'No single turn card puts you ahead.')+dirtyText+blockText
      +` They are all-in, so you see both cards for one call: you win ${x.win}${x.tie?` and split ${x.tie}`:''} of the ${x.total} possible turn-and-river pairs, ${pct1(x.eq)}.`
      +(x.outs?` The quick rule of 4 (outs × 4) says about ${four}%${Math.abs(four-100*x.eq)>=3?`, ${four>100*x.eq?'too high here: it counts runouts where both cards are outs twice, and they can still improve after you hit':'too low: it misses the backdoor runouts where both cards help you'}`:', close to the exact count'}.`:'');
  }
  function priceText(s){
    const {need,final}=priceOf(s.pot,s.bet),eq=s.solved.eq,ev=evOf(eq,s.pot,s.bet);
    const verb=s.board.length===3?'went all-in for':'bet';
    return `The pot was ${bbs(s.pot)} and they ${verb} ${bbs(s.bet)}. If you call, the pot is ${bbs(final)} and ${bbs(s.bet)} of it is yours, so you need ${bbs(s.bet)} ÷ ${bbs(final)} = ${pct1(need)} equity to break even. `
      +`You have ${pct1(eq)}, so a call ${Math.abs(ev)<.05?'breaks even':ev>0?`wins about ${bbs(ev)} on average`:`loses about ${bbs(-ev)} on average`}: ${pct1(eq)} × ${bbs(final)} − ${bbs(s.bet)}.`;
  }
  function verdictText(s,act,j){
    const {need}=priceOf(s.pot,s.bet),eq=s.solved.eq,ev=evOf(eq,s.pot,s.bet),cmp=`${pct1(eq)} equity against the ${pct1(need)} the price needs`;
    const other=act==='call'?'fold':'call';
    if(j.v==='right'){
      if(Math.abs(ev)<.05)return `Break-even: ${cmp}, so calling and folding are worth about the same.`;
      if(act!==j.best)return `Near break-even: ${cmp}. ${cap(j.best)} is a hair better, but only by ${bbs(Math.abs(ev))}, too little to count as a mistake.`;
      return `${cap(act)}: ${cmp}.`+(verdictOf(j.L[other])==='right'?` It is close: ${other==='call'?'calling':'folding'} would cost only ${bbs(Math.abs(ev))}.`:'');
    }
    if(j.v==='close')return `Close, but ${j.best} is better: ${cmp}. The ${act} costs about ${bbs(Math.abs(ev))}.`;
    return `${cap(j.best)}: ${cmp}. ${act==='call'?`Calling gives up about ${bbs(-ev)}`:`Folding gives up about ${bbs(ev)}`} each time.`;
  }
  const cap=t=>t[0].toUpperCase()+t.slice(1);

  const API={TYPES,TYPE_LABEL,drawOf,solve,priceOf,evOf,analysis,labels,judge,best:bestOf,deal,outsText,priceText,verdictText,cardName};
  root.RivlPotOdds=API;

  /* ---------- the drill page ---------- */
  const doc=root.document,T=root.RivlTraining;
  if(!doc||!doc.getElementById('potOdds')||!T||!T.add)return;
  // Keep Training lit in the sidebar while this drill is open (script.js's NAV_FOR).
  try{if(typeof NAV_FOR==='object')NAV_FOR.potOdds='training'}catch{}
  const $=id=>doc.getElementById(id),esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const KEY='rivlPotOdds',VIEW='potOdds';
  const cardHtml=(c,cls='')=>{const n=cardName(c);return `<span class="pz-card${cls}${'♥♦'.includes(n[1])?' red':''}"><b>${n[0]==='T'?'10':n[0]}</b><i>${n[1]}</i></span>`};
  const load=()=>{let s=null;try{s=JSON.parse(localStorage.getItem(KEY))}catch{}
    s=s&&typeof s==='object'?s:{};return Object.assign({street:'all',type:'all',n:0,c:0,streak:0,best:0,types:{},recent:[]},s)};
  const st=load(),save=()=>{try{localStorage.setItem(KEY,JSON.stringify(st))}catch{}};
  const pct=(c,n)=>n?Math.round(100*c/n)+'%':'–';
  $(VIEW).innerHTML=`<button class="rivl-back outline" id="poBack" type="button">← BACK TO TRAINING</button>
    <h1>POT ODDS &amp; DRAWS</h1>
    <div class="hr-head"><div class="hr-seats" id="poTypes" role="group" aria-label="Draws to practice"></div>
      <div class="hr-seg" id="poStreet" role="group" aria-label="Street"><button type="button" data-street="all">BOTH</button><button type="button" data-street="flop">FLOP</button><button type="button" data-street="turn">TURN</button></div></div>
    <div class="pz-layout hr-layout">
      <div class="panel hr-spot">
        <div class="hr-felt po-felt" id="poFelt" role="img"></div>
        <h3 class="pz-q" id="poQ"></h3>
        <div class="pz-choices hr-choices" id="poChoices" style="--n:2"></div>
        <div class="hr-answer" id="poAnswer" hidden aria-live="polite">
          <div id="poVerdict" class="pz-verdict"></div>
          <div id="poWhy" class="pz-why"></div>
          <button type="button" class="gold hr-next" id="poNext">NEXT HAND</button>
          <p class="hr-keys">Keys: C call, F fold, Enter next hand</p>
        </div>
      </div>
      <div class="panel hr-chart">
        <div class="hr-chart-head"><h3 class="pz-sub" id="poChartTitle">YOUR OUTS</h3><span id="poChartPct" class="hr-pct"></span></div>
        <div class="hr-grid-wrap"><div class="po-deck" id="poDeck"></div><div class="hr-lock" id="poLock"><span>Make your call to see your outs</span></div></div>
        <div class="hr-legend" id="poLegend"></div>
        <div class="po-math" id="poMath" hidden></div>
        <p class="hr-fine">Their cards are shown so every out is exact. On the turn, each of the 44 cards you can't see is equally likely; on the flop they are all-in, so you see both cards for one price. Equity counts a split as half a win. Only the money in the pot counts, not future bets.</p>
        <button type="button" class="gold hr-next hr-next-low" id="poNext2" hidden>NEXT HAND</button>
        <h3 class="pz-sub hr-prog-title">YOUR PROGRESS</h3>
        <div class="pz-stats hr-stats"><div><b id="poStreak">0</b><small>STREAK</small></div><div><b id="poAcc">–</b><small>CORRECT</small></div><div><b id="poBest">0</b><small>BEST STREAK</small></div></div>
        <div class="hr-recent" id="poRecent" aria-label="Your last hands"></div>
      </div>
    </div>`;
  let spot=null;
  const VERDICT={right:['CORRECT','✓','var(--g-best)'],close:['CLOSE','≈','var(--g-inaccuracy)'],wrong:['MISS','✗','var(--g-blunder)']};
  function paintFilters(){
    $('poStreet').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.street===st.street)));
    $('poTypes').style.setProperty('--cols',5);
    $('poTypes').innerHTML=['all',...TYPES].map(t=>{const k=st.types[t]||[0,0],acc=t==='all'?'':`<small>${k[0]?pct(k[1],k[0]):'–'}</small>`;
      return `<button type="button" data-type="${t}" aria-pressed="${st.type===t}"><span>${t==='all'?'ALL<span class="hr-long"> DRAWS</span>':TYPE_LABEL[t].replace(' DRAW','<span class="hr-long"> DRAW</span>')}</span>${acc}</button>`}).join('');
    $('poTypes').querySelectorAll('button').forEach(b=>b.onclick=()=>{st.type=b.dataset.type;save();paintFilters();dealNext()});
  }
  function paintFelt(){
    const s=spot,allin=s.street==='flop',seen=s.answered;
    $('poFelt').innerHTML=`<div class="po-villain"><div class="po-cards">${s.villain.map(c=>cardHtml(c,' sm')).join('')}</div>
        <span class="hr-tag"><b>THEM</b><em>${allin?'ALL-IN':'BET'}</em></span><span class="hr-blind"><i class="pz-chip"></i>${bbs(s.bet)}</span></div>
      <div class="hr-center po-center"><div class="pz-pot">${s.street.toUpperCase()} · POT <b>${bbs(s.pot)}</b></div><div class="po-board">${s.board.map(c=>cardHtml(c)).join('')}${s.board.length===3?'<span class="pz-card back po-next"></span>':''}<span class="pz-card back po-next"></span></div></div>
      <div class="po-hero"><div class="pz-hand">${s.hero.map(c=>cardHtml(c)).join('')}</div><span class="hr-tag po-you"><b>YOU</b></span></div>`;
    $('poFelt').setAttribute('aria-label',`${s.street==='flop'?'Flop':'Turn'}. Board ${s.board.map(cardName).join(' ')}. You hold ${s.hero.map(cardName).join(' ')}. They hold ${s.villain.map(cardName).join(' ')} and ${allin?'go all-in for':'bet'} ${bbs(s.bet)} into ${bbs(s.pot)}.`);
  }
  const RES_CLASS={out:'po-out',split:'po-split',dirty:'po-dirty',blank:'po-blank'};
  function paintDeck(locked){
    const s=spot,x=s.solved,by=new Map(x.cards.map(c=>[c.c,c])),mine=new Set(s.hero),theirs=new Set(s.villain),board=new Set(s.board);
    let html='';
    for(let su=0;su<4;su++){
      html+=`<span class="po-suit${su===1||su===2?' red':''}">${S4[su]}</span>`;
      for(let r=12;r>=0;r--){
        const c=r*4+su,n=cardName(c),info=by.get(c),label=(R13[r]==='T'?'10':R13[r]);
        if(!info){const who=mine.has(c)?'yours':theirs.has(c)?'theirs':'on the board';html+=`<span class="po-cell po-seen" title="${n}: ${who}">${label}</span>`;continue}
        const res=locked?'po-blank':RES_CLASS[info.res];
        const tip=locked?n:x.oneCard?`${n}: ${info.res==='out'?'you win':info.res==='split'?'split pot':info.res==='dirty'?'completes your draw but they still win':'they win'}`
          :`${n} on the turn: ${info.res==='out'?'puts you ahead':info.res==='split'?'tied':info.res==='dirty'?'completes your draw but they are still ahead':'you are still behind'}; you win ${Math.round(100*(info.win+info.tie/2)/info.n)}% by the river`;
        html+=`<span class="po-cell ${res}" title="${esc(tip)}">${label}</span>`;
      }
    }
    $('poDeck').innerHTML=html;$('poDeck').classList.toggle('hr-locked',locked);$('poLock').hidden=!locked;
    $('poChartTitle').textContent=locked?'YOUR OUTS':x.oneCard?'YOUR OUTS ON THE RIVER':'YOUR OUTS ON THE TURN';
    $('poChartPct').textContent=locked?'':`${plural(x.outs,'out')} · ${pct1(x.eq)} to win${x.oneCard?'':' by the river'}`;
    const has=k=>!locked&&x.cards.some(c=>c.res===k);// the locked chart doesn't hint at splits or dirty outs
    $('poLegend').innerHTML=[['po-out','Out: you '+(x.oneCard?'win':'go ahead')],has('split')&&['po-split','Split'],has('dirty')&&['po-dirty','Makes your draw, still loses'],['po-blank','No help'],['po-seen','Already dealt']]
      .filter(Boolean).map(([k,l])=>`<span><i class="hr-key ${k}"></i>${esc(l)}</span>`).join('');
  }
  function paintMath(){
    const s=spot,{need}=priceOf(s.pot,s.bet),eq=s.solved.eq,ev=evOf(eq,s.pot,s.bet),w=v=>Math.min(100,100*v).toFixed(1)+'%';
    $('poMath').hidden=!s.answered;if(!s.answered)return;
    $('poMath').innerHTML=`<div class="po-bar" role="img" aria-label="Equity ${pct1(eq)}, needed ${pct1(need)}"><i class="${eq>=need?'po-good':'po-bad'}" style="width:${w(eq)}"></i><b style="left:${w(need)}"></b></div>
      <div class="po-nums"><span>YOUR EQUITY<b>${pct1(eq)}</b></span><span>PRICE NEEDS<b>${pct1(need)}</b></span><span>CALL EV<b class="${ev>=0?'po-pos':'po-neg'}">${ev>=0?'+':'−'}${bbs(Math.abs(ev))}</b></span></div>`;
  }
  function paintStats(){
    $('poStreak').textContent=st.streak;$('poBest').textContent=st.best;$('poAcc').textContent=pct(st.c,st.n);
    $('poRecent').innerHTML=st.recent.length?'<small>LAST HANDS</small>'+st.recent.map(r=>`<span class="hr-chip hr-v-${r.v}" title="${esc(r.c+' on the '+r.p.toLowerCase()+': '+r.v)}">${esc(r.c)}<i>${esc(r.p)}</i></span>`).join(''):'';
  }
  function dealNext(){
    const street=st.street==='all'?(Math.random()<.5?'flop':'turn'):st.street;
    spot=deal(street,st.type,Math.random,spot&&spot.hero.concat(spot.board))||deal(street,'all');spot.answered=false;
    paintFelt();paintDeck(true);paintMath();paintStats();
    $('poQ').textContent=street==='flop'?`THEY GO ALL-IN FOR ${bbs(spot.bet)} INTO ${bbs(spot.pot)}. CALL OR FOLD?`:`THEY BET ${bbs(spot.bet)} INTO ${bbs(spot.pot)}. CALL OR FOLD?`;
    $('poChoices').innerHTML=`<button type="button" class="pz-choice" data-act="call">CALL<small>${bbs(spot.bet)}</small><kbd>C</kbd></button><button type="button" class="pz-choice" data-act="fold">FOLD<kbd>F</kbd></button>`;
    $('poChoices').querySelectorAll('button').forEach(b=>b.onclick=()=>answer(b.dataset.act));
    $('poAnswer').hidden=$('poNext2').hidden=true;
  }
  function answer(act){
    if(!spot||spot.answered)return;spot.answered=true;
    const j=judge(spot,act),v=j.v,t=spot.draw.type;
    st.n++;if(v==='right'){st.c++;st.streak++;st.best=Math.max(st.best,st.streak)}else if(v==='wrong')st.streak=0;
    const k=st.types[t]||(st.types[t]=[0,0]);k[0]++;if(v==='right')k[1]++;
    st.recent=[{c:TYPE_SHORT[t],p:spot.street.toUpperCase(),v},...st.recent].slice(0,10);save();
    $('poChoices').querySelectorAll('button').forEach(b=>{b.disabled=true;b.classList.toggle('best',b.dataset.act===j.best);b.classList.toggle('picked',b.dataset.act===act)});
    const [word,glyph,color]=VERDICT[v];
    $('poVerdict').style.setProperty('--gc',color);
    $('poVerdict').innerHTML=`<span class="pz-glyph">${glyph}</span><div><strong>${word}</strong><span>${esc(verdictText(spot,act,j))}</span></div>`;
    $('poWhy').innerHTML=[['THE OUTS',outsText(spot)],['THE PRICE',priceText(spot)]].map(([h,x])=>`<div><h4>${h}</h4><p>${esc(x)}</p></div>`).join('');
    $('poAnswer').hidden=$('poNext2').hidden=false;
    paintDeck(false);paintMath();paintStats();paintFilters();
    if(matchMedia('(max-width:900px)').matches)$('poQ').scrollIntoView({behavior:'smooth',block:'start'});
    else{const b=$('poVerdict').getBoundingClientRect();if(b.bottom>innerHeight)scrollBy({top:b.bottom-innerHeight+24,behavior:'smooth'})}
  }
  function next(){dealNext();const f=$('poFelt').getBoundingClientRect();if(f.top<0||f.bottom>innerHeight)$('poFelt').scrollIntoView({behavior:'smooth',block:matchMedia('(max-width:900px)').matches?'start':'center'})}
  $('poNext').onclick=$('poNext2').onclick=next;
  $('poBack').onclick=()=>show('training');
  $('poStreet').querySelectorAll('button').forEach(b=>b.onclick=()=>{st.street=b.dataset.street;save();paintFilters();dealNext()});
  // The hub card's picture: a deck with the nine flush cards lit, as in the room's outs chart.
  const art=()=>'<span class="tr-mini po-mini">'+[...Array(52)].map((_,i)=>`<i class="${i>=13&&i<26?(i===13||i===17||i===21||i===25?'tr-b':'tr-c'):''}"></i>`).join('')+'</span>';
  const page={
    get spot(){return spot},
    open(){if(!spot){paintFilters();dealNext()}},
    key(e){const k=e.key.toLowerCase();if(!spot)return false;
      if(!spot.answered){if(k==='c'||k==='f'){answer(k==='c'?'call':'fold');return true}}
      else if(k==='enter'||k===' '||k==='n'){next();return true}
      return false},
    stat(){const s=load();return s.n?`${s.n} hands played · ${pct(s.c,s.n)} correct · best streak ${s.best}`:'Deal as many hands as you like. Progress is saved in this browser.'},
    started:()=>load().n>0,
  };
  T.add({view:VIEW,eyebrow:'POSTFLOP',name:'Pot Odds & Draws',art,make:()=>page,
    text:'You hold a draw and they bet. Call or fold? Count your outs, work out the price, and see the exact math.'});
})(typeof window!=='undefined'?window:globalThis);
