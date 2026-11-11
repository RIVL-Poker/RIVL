/* RIVL Training: Flop C-Bet drill. You open, the big blind calls, the flop comes and the big blind checks to you.
   Check, bet a third of the pot, or bet two thirds?
   The answers come from a small c-bet book built on published solver studies of this spot (button against the big
   blind, 100 BB, single-raised pot):
   - GTO Wizard, "Flop Heuristics: IP C-Betting in Cash Games" (blog.gtowizard.com/flop-heuristics-ip-c-betting-in-cash-games/)
   - GTO Wizard, "The Mechanics of C-Bet Sizing" (blog.gtowizard.com/the-mechanics-of-c-bet-sizing/)
   Their findings, as this book uses them:
   1. Dry flops (paired, or no open-ended straight draw possible) are bet often and small, about a third of the pot.
      A small bet also protects the middle of the range (Q♥Q♣6♦: "mostly at 33% pot").
   2. Flops with straight draws but no straight yet are bet less often and bigger: strong hands and strong draws bet,
      the middle of the range checks (K♥J♥7♦: "classic polarized range that loves a bigger bet size").
   3. Flops that complete straights or flushes for the caller are bet less often and smaller (Q♦J♦T♦: "check or bet
      roughly 50/50, with a small bet as the main size"; "size down and bet less on flops that complete straights and
      flushes in your opponent's range").
   Solvers mix many hands between two options. The book names one play per hand class, and an option the solvers also
   use for that class counts as Close, not a Miss. */
(root=>{
  const T=root.RivlTraining,R=root.RivlRating;if(!T||!R)return;
  const {SEATS,CLASSES,tierOf,cutoff}=T;
  const RANKS='23456789TJQKA',SUITS='♠♥♦♣';
  const rv=c=>RANKS.indexOf(c[0])+2;// 2..14
  const POT=5.5,SMALL=1/3,BIG=2/3,OPEN_TO=2.5;
  const bbs=x=>+x.toFixed(1)+' BB';
  const ACTS=['check','small','big'];
  const ACT_NAME={check:'check',small:'bet a third of the pot',big:'bet two thirds of the pot'};

  /* ---------- the flop ---------- */
  const bit=r=>1<<r|(r===14?2:0);// aces also play low
  const mask=cards=>cards.reduce((m,c)=>m|bit(rv(c)),0);
  // A straight is already possible: some two cards fill a five-card run with all three flop cards.
  const straightPossible=b=>{const m=mask(b);for(let lo=1;lo<=10;lo++){const run=31<<lo;let n=0;for(let r=lo;r<lo+5;r++)if(m&1<<r)n++;if(n>=3)return true}return false};
  // An open-ended straight draw is possible: two flop cards fit inside a four-card run that is open at both ends.
  const oesdPossible=b=>{const m=mask(b);for(let lo=2;lo<=10;lo++){let n=0;for(let r=lo;r<lo+4;r++)if(m&1<<r)n++;if(n>=2)return true}return false};
  function texture(board){
    const rs=board.map(rv),suits=new Set(board.map(c=>c[1])),paired=new Set(rs).size<3;
    const mono=suits.size===1,twoTone=suits.size===2,straight=!paired&&straightPossible(board),oesd=!paired&&oesdPossible(board);
    // Straights on high flops (Q-J-T, A-K-Q) use the cards the raiser opens most, so only lower ones count as very wet.
    const kind=mono||straight&&Math.max(...rs)<=11?'veryWet':paired||!oesd?'dry':'wet';
    return{kind,paired,mono,twoTone,straight,oesd,high:Math.max(...rs),suit:board[0][1]};
  }

  /* ---------- your hand on it ----------
     nutted: two pair from both hole cards, trips, a set, or better. value: an overpair, or top pair with a ten or better
     kicker. draw: a flush draw (on a three-suited flop, only with the ace or king of the suit) or an open-ended
     straight draw. thin: top pair, weaker kicker. showdown: any other pair. gutshot: an inside straight draw and no
     pair. equity: two overcards, a backdoor flush draw or a low flush draw. air: nothing. */
  function draws(hole,board){
    const all=hole.concat(board),bySuit={};all.forEach(c=>bySuit[c[1]]=(bySuit[c[1]]||0)+1);
    const mono=new Set(board.map(c=>c[1])).size===1;
    let fd=false,weakFd=false,bdfd=false;
    for(const s of SUITS){
      const mine=hole.filter(c=>c[1]===s);if(!mine.length)continue;
      if(bySuit[s]===4){if(mono&&mine.length===1&&rv(mine[0])<13)weakFd=true;else fd=true}
      if(bySuit[s]===3&&mine.length===2)bdfd=true;
    }
    const m=mask(all),mine=mask(hole);let oesd=false,gut=false;
    for(let lo=2;lo<=10;lo++){const run=15<<lo;if((m&run)===run&&mine&run)oesd=true}// four in a row, open at both ends (J-Q-K-A and A-2-3-4 are not)
    for(let lo=1;lo<=10;lo++){const run=31<<lo;let n=0;for(let r=lo;r<lo+5;r++)if(m&1<<r)n++;if(n===4&&mine&run)gut=true}
    return{fd,weakFd,bdfd,oesd,gut:gut&&!oesd};
  }
  function handClass(hole,board){
    const v=R.rankHand(hole.concat(board).map(R.toInt)),cat=R.handCategory(v),bcat=R.handCategory(R.rankHand(board.map(R.toInt)));
    const brs=board.map(rv),top=Math.max(...brs),[a,b]=hole.map(rv),pocket=a===b;
    const d=draws(hole,board),hits=[a,b].filter(r=>brs.includes(r));
    let made='none';
    if(cat>=3&&cat>bcat)made='nutted';// trips with a hole card, a set, straight, flush, full house
    else if(cat===2&&bcat===0&&hits.length===2&&a!==b)made='nutted';// two pair from both hole cards
    else if(pocket&&a>top)made='overpair';
    else if(hits.includes(top)&&!(brs.filter(r=>r===top).length>1)){const kick=a===top?b:a;made=kick>=10?'topGood':'topWeak'}
    else if(pocket||hits.length)made='pair';
    const strongDraw=d.fd||d.oesd;
    let cls;
    if(made==='nutted')cls='nutted';
    else if(made==='overpair'||made==='topGood')cls='value';
    else if(strongDraw)cls='draw';
    else if(made==='topWeak')cls='thin';
    else if(made==='pair')cls='showdown';
    else if(d.gut)cls='gutshot';
    else if(d.bdfd||d.weakFd||Math.min(a,b)>top)cls='equity';
    else cls='air';
    return{cls,made,d,overs:Math.min(a,b)>top,top};
  }

  /* ---------- the book: [best, close...] for each flop kind and hand class; anything else is a Miss ---------- */
  const BOOK={
    dry:{nutted:['small','big','check'],value:['small','big','check'],draw:['small','big','check'],thin:['small','check'],showdown:['small','check'],gutshot:['small','check','big'],equity:['small','check','big'],air:['small','check','big']},
    wet:{nutted:['big','small'],value:['big','small','check'],draw:['big','small','check'],thin:['check','small','big'],showdown:['check','small'],gutshot:['big','check','small'],equity:['check','big','small'],air:['check','big']},
    veryWet:{nutted:['small','big','check'],value:['small','check','big'],draw:['small','check','big'],thin:['check','small'],showdown:['check','small'],gutshot:['check','small'],equity:['check','small'],air:['check']},
  };
  // On a dry ace-high flop, ace-x with a weak kicker and kings to jacks check back far more often (GTO Wizard's A-7-3 example).
  const ACE_HIGH_CHECK=['check','small'];
  const aceHighChecker=(t,h,hole)=>t.kind==='dry'&&!t.paired&&t.high===14&&(h.cls==='thin'||h.cls==='showdown'&&hole[0][0]===hole[1][0]&&rv(hole[0])>=11);
  function judge(hole,board,act){
    const t=texture(board),h=handClass(hole,board),row=aceHighChecker(t,h,hole)?ACE_HIGH_CHECK:BOOK[t.kind][h.cls],best=row[0];
    return{best,t,h,v:act===best?'right':row.includes(act)?'close':'wrong'};
  }

  /* ---------- your range on this flop ---------- */
  const comboCards=(c,board)=>{
    const out=[],dead=new Set(board);
    for(let i=0;i<4;i++)for(let j=0;j<4;j++){
      if(c.length===2?j<=i:c[2]==='s'?j!==i:j===i)continue;
      const x=c[0]+SUITS[i],y=c[1]+SUITS[j];if(!dead.has(x)&&!dead.has(y))out.push([x,y]);
    }
    return out;
  };
  const inRange=(size,pos,c)=>tierOf(c)<=cutoff(size,pos);
  // The book's play for each hand in the chart: the play for most of its suit combos on this flop.
  function rangePlan(size,pos,board){
    const cell={},n={check:0,small:0,big:0};
    for(const c of CLASSES){
      if(!inRange(size,pos,c))continue;
      const k={check:0,small:0,big:0};
      for(const h of comboCards(c,board)){const a=judge(h,board,'check').best;k[a]++;n[a]++}
      cell[c]=ACTS.reduce((x,y)=>k[y]>k[x]?y:x);
    }
    const tot=n.check+n.small+n.big||1;
    return{cell,share:{check:Math.round(100*n.check/tot),small:Math.round(100*n.small/tot),big:Math.round(100*n.big/tot)}};
  }

  /* ---------- words ---------- */
  const SUIT_NAME={'♠':'spades','♥':'hearts','♦':'diamonds','♣':'clubs'};
  const RNAME={14:'ace',13:'king',12:'queen',11:'jack',10:'ten',9:'nine',8:'eight',7:'seven',6:'six',5:'five',4:'four',3:'three',2:'two'};
  function flopText(t,plan){
    const mix=`Your range here: bet a third ${plan.share.small}%, bet two thirds ${plan.share.big}%, check ${plan.share.check}%.`;
    if(t.kind==='dry'){
      const why=t.paired?'A paired flop gives the big blind only two cards to connect with':'No open-ended straight draw is possible'+(t.twoTone?', and only one suit can make a flush draw':'');
      return `A dry flop. ${why}, so the big blind misses most of the time, and your range holds more of the big pairs and high cards. Solver studies bet small here, about a third of the pot, with ${plan.share.check>=10?'most of the range (on ace-high flops, weak aces and kings to jacks check back)':'nearly the whole range'}: it wins the pot often and still gets called by worse. ${mix}`;
    }
    if(t.kind==='wet')return `A wet flop: straight draws are possible${t.twoTone?', and a flush draw too':''}, so many of the big blind's hands have real equity against you. Solver studies bet less often here and bigger, about two thirds of the pot: strong hands and strong draws bet to charge the draws, and the middle of the range checks. ${mix}`;
    return `A very wet flop: ${t.mono?`all three cards are ${SUIT_NAME[t.suit]}, so a flush is already possible`:'a straight is already possible'}${t.mono&&t.straight?', and so is a straight':''}. The big blind defends many suited and connected hands, so it makes more of the strongest hands here than you do. Solver studies check about half the range and bet small with the rest. ${mix}`;
  }
  function handText(hole,board,best){
    const {cls,made,d,top}=handClass(hole,board),t=texture(board),topN=RNAME[top];
    const drawName=d.fd&&d.oesd?'a flush draw and an open-ended straight draw':d.fd?'a flush draw':d.oesd?'an open-ended straight draw':'';
    const eqName=[d.weakFd&&'a low flush draw',d.bdfd&&'a backdoor flush draw',Math.min(...hole.map(rv))>top&&'two overcards'].filter(Boolean);
    const list=a=>a.length>1?a.slice(0,-1).join(', ')+' and '+a[a.length-1]:a[0]||'';
    let what;
    if(cls==='nutted')what='You have a very strong hand: two pair or better.';
    else if(made==='overpair')what=`You have an overpair to the ${topN}${drawName?', plus '+drawName:''}.`;
    else if(made==='topGood')what=`You have top pair, ${topN}s, with a good kicker${drawName?', plus '+drawName:''}.`;
    else if(cls==='draw')what=`You have ${drawName}${made==='pair'||made==='topWeak'?' and a pair':''}.`;
    else if(cls==='thin')what=`You have top pair, ${topN}s, with a weak kicker.`;
    else if(cls==='showdown')what='You have a pair below top pair: a hand with some showdown value but little to gain from a bet.';
    else if(cls==='gutshot')what=`You have no pair, but a gutshot${d.bdfd?' and a backdoor flush draw':''}: four cards to a straight with a gap.`;
    else if(cls==='equity')what=`You have no pair, but ${list(eqName)}: some equity to win later.`;
    else what='You have no pair and no draw.';
    let why;
    if(t.kind==='dry'&&best==='check')why='On a dry ace-high flop the book bets small with most hands but checks this one: few worse hands call a bet, it beats much of what the big blind bluffs with later, and checking keeps your checks from being all weak hands.';
    else if(t.kind==='dry')why=best==='small'?'On a dry flop the book bets a third of the pot with nearly every hand: strong hands get called by worse, middling hands are protected, and weak hands win the pot often enough.':'';
    else if(t.kind==='wet'){
      if(best==='big')why=cls==='draw'?'Strong draws make the best bluffs: if called you still have plenty of outs, so bet two thirds.':cls==='gutshot'?'A gutshot is a fine bluff here: the big blind\'s one-pair hands and weak draws fold to a big bet often, and when called you can still make a straight.':'Bet two thirds for value: the big blind\'s draws and weaker pairs pay a big price, and a small bet would give them a cheap card.';
      else why=cls==='air'?'With no pair and no draw, give up: a bluff here has little to fall back on when called.':cls==='equity'?'Backdoor draws and overcards mostly check here and take a free card. Solvers bluff with some of them, so a bet is close.':'A one-pair hand like this is too weak to bet big for value and too strong to turn into a bluff. Check and keep the pot small.';
    }else{
      if(best==='small')why=cls==='nutted'?'Even very strong hands bet small here: the big blind has many strong hands too, and a small bet still gets called by its pairs and draws.':cls==='draw'?'A strong draw bets small here: the bet often wins the pot now, and when called you still have plenty of outs.':'Bet small: your hand is good now but has little room to grow, and a small bet denies equity to the big blind\'s many draws without risking much.';
      else why='On a flop that favours the big blind, check hands like this and keep the pot small.';
    }
    return what+' '+why;
  }

  /* ---------- dealing ---------- */
  const rnd=n=>Math.floor(Math.random()*n);
  const DECK=[];for(const r of 'AKQJT98765432')for(const s of SUITS)DECK.push(r+s);
  // Each flop kind comes up a third of the time, so dry flops (the most common) don't crowd out the others.
  function dealSpot(size,pos,lastCls){
    const want=['dry','wet','veryWet'][rnd(3)];
    let board;for(let k=0;k<200;k++){const d=DECK.slice();board=[];for(let i=0;i<3;i++)board.push(d.splice(rnd(d.length),1)[0]);if(texture(board).kind===want)break}
    const range=CLASSES.filter(c=>inRange(size,pos,c));
    for(let k=0;k<50;k++){
      const c=range[rnd(range.length)],combos=comboCards(c,board);
      if(!combos.length||c===lastCls&&k<49)continue;
      // Pick hands by combo, as the cards would fall.
      if(Math.random()>combos.length/12)continue;
      return{cls:c,cards:combos[rnd(combos.length)],board};
    }
    const c=range[0];return{cls:c,cards:comboCards(c,board)[0],board};
  }

  T.cbet={POT,SMALL,BIG,BOOK,texture,handClass,judge,rangePlan,comboCards,flopText,handText,dealSpot,inRange};
  if(!T.add)return;

  /* ---------- the drill ---------- */
  const CELL={check:'hr-in-old',small:'hr-call',big:'hr-3bet'};
  const boardStr=b=>b.join(' ');
  T.add({view:'cbet',pre:'cb',key:'rivlCbetTrainer',title:'FLOP C-BET',chartName:'YOUR RANGE ON THIS FLOP',
    eyebrow:'FLOP',name:'Flop C-Bet',
    art:()=>{const p=rangePlan(9,'BTN',['K♥','J♥','7♦']).cell;return T.miniChart(c=>p[c]==='small'?'tr-c':p[c]==='big'?'tr-a':p[c]?'tr-b':'')},
    text:'You raised, the big blind called and checks the flop to you. Check, bet small or bet big? Learn to read the board.',
    fine:`The big blind calls your ${OPEN_TO} BB open, 100 BB deep, and checks. A simplified c-bet book from published solver studies of the button against the big blind (GTO Wizard: "Flop Heuristics: IP C-Betting in Cash Games" and "The Mechanics of C-Bet Sizing"). Solvers mix many hands between options, so a play they also use counts as Close.`,
    heroSeats:size=>SEATS[size].slice(0,-2),
    deal:(size,pos,last)=>dealSpot(size,pos,last),
    question:s=>`THE BIG BLIND CHECKS ON ${boardStr(s.board)}. CHECK OR BET?`,
    say:s=>`You opened to ${OPEN_TO} BB, the big blind called. The flop is ${boardStr(s.board)} and the big blind checks.`,
    board:s=>s.board,pot:()=>POT,
    actions:()=>[{act:'check',label:'CHECK',key:'c',alt:'k'},{act:'small',label:'BET 1/3',sub:bbs(POT*SMALL),key:'s',alt:'1'},{act:'big',label:'BET 2/3',sub:bbs(POT*BIG),key:'b',alt:'2'}],
    table:s=>SEATS[s.size].map(x=>({state:x===s.pos?'me':x==='BB'?'live':'folded',bet:''})),
    judge(s,act){
      const j=judge(s.cards,s.board,act),play=ACT_NAME[j.best],hand=s.cards.join(' ');
      const text=j.v==='right'?`${hand} on this flop: ${play}.`:j.v==='close'?`Solvers sometimes play it this way, but the book's play is to ${play}.`:`The book's play with ${hand} here is to ${play}.`;
      return{v:j.v,best:j.best,text};
    },
    why:s=>{const j=judge(s.cards,s.board,'check');return[['THE HAND',handText(s.cards,s.board,j.best)],['THE FLOP',flopText(j.t,rangePlan(s.size,s.pos,s.board))]]},
    tag:s=>s.pos,
    tabs:()=>[],tab:()=>'',tabLabel:t=>t,
    chartTitle:s=>`${s.pos} RANGE ON ${boardStr(s.board)}`,
    chartPct:s=>{const x=rangePlan(s.size,s.pos,s.board).share;return `bet ⅓ ${x.small}% · bet ⅔ ${x.big}% · check ${x.check}%`},
    cell(s){const p=rangePlan(s.size,s.pos,s.board).cell;return c=>p[c]?CELL[p[c]]:'hr-out'},
    legend:()=>[['hr-call','Bet 1/3'],['hr-3bet','Bet 2/3'],['hr-in-old','Check'],['hr-out','Not in your opening range']],
  });
})(typeof window!=='undefined'?window:globalThis);
