/* RIVL Training, Big Blind Defense: you are always the big blind, one player opens to 2, 2.5, 3 or 4 BB and everyone
   else folds. 3-bet, call or fold? The answers are rating.js's own gradePreflop() for that exact spot, the same chart
   the decision grader holds your big blind play to, and it defends wider against smaller raises and later openers.
   Runs after training.js: it uses that file's shared drill page and joins the Training hub with RivlTraining.add(). */
(root=>{
  const R=root.RivlRating,T=root.RivlTraining;if(!R||!T)return;
  const {SEATS,CLASSES,tierOf,cutoff,openPct}=T,K=T.kit;
  const {the,who,cap,kind,combos,bbs,ACT_NAME,ACT_VERB,CELL_VS}=K;
  const OPENS=[2,2.5,3,4],ACTS=['raise','call','fold'];
  // 3-bets go to 4x the open, the blinds' size in the facing-a-raise drill and inside the grader's best range.
  const threeBetTo=open=>4*open;
  const behindOf=(size,pos)=>SEATS[size].length-1-SEATS[size].indexOf(pos);
  // The book analyze() builds for this spot (chips in tenths of a big blind, 100 BB deep, the big blind's 1 BB already in).
  function book(size,opener,open,c){
    return{tier:tierOf(c),cls:c,hu:false,raisers:1,pos:'BB',toCall:open*10-10,bb:10,openTier:cutoff(size,opener),
      limpers:0,behind:0,eff:100,size:open,shove:0,currentBet:open*10,heroBet:10,stack:990};
  }
  // The grader's label for each of the three answers.
  function labels(size,opener,open,c){
    const b=book(size,opener,open,c),A={book:b,toCall:b.toCall},L={};
    for(const a of ACTS)L[a]=R.gradePreflop(A,a,a==='raise'?threeBetTo(open)*10:0).label;
    return L;
  }
  const bestOf=L=>ACTS.find(a=>L[a]==='Best')||'fold';
  const best=(size,opener,open,c)=>bestOf(labels(size,opener,open,c));
  function judge(size,opener,open,c,act){
    const L=labels(size,opener,open,c),b=bestOf(L),label=L[act];
    return{L,best:b,label,v:label==='Best'?'right':label==='Excellent'||label==='Good'?'close':'wrong'};
  }
  function shares(size,opener,open){
    const b=CLASSES.map(c=>best(size,opener,open,c));
    const s=a=>Math.round(100*CLASSES.reduce((x,c,i)=>x+(b[i]===a?combos(c):0),0)/1326);
    const raise=s('raise'),call=s('call');return{raise,call,defend:raise+call,fold:100-raise-call};
  }
  // The price: what a call costs, the pot it wins, and the equity that breaks even.
  function price(opener,open){
    const pot=open+(opener==='SB'?0:.5)+1,toCall=open-1;
    return{pot,toCall,need:Math.round(100*toCall/(pot+toCall))};
  }
  const FLAVOR={
    bigPair:'A big pair is ahead of nearly everything that opens.',
    pair:'A pair flops a set about one time in eight, and closing the action means nobody can raise you off the flop.',
    wheelAce:'A suited ace makes the nut flush, and a low one can also make a wheel straight, so it keeps equity when it misses.',
    suitedAce:'A suited ace makes the nut flush and blocks the opener\'s best aces.',
    suitedBroadway:'Two suited high cards make strong top pairs, flushes and straights.',
    connector:'Suited connectors make straights and flushes, and they win big pots when they hit.',
    suitedOther:'Being suited adds flushes, which helps a hand realize its equity out of position.',
    offBroadway:'Two high cards make top pair often, but out of position a call keeps the pot small when your kicker may be beaten.',
    offAce:'An ace makes top pair, but a weak kicker against a raiser plays best in a small pot.',
    offOther:'It is a weak hand, but the price is good and you close the action.',
  };
  // The largest open this hand still defends against from this seat, and the smallest one it folds to.
  const defendsUpTo=(size,opener,c)=>OPENS.filter(o=>best(size,opener,o,c)!=='fold').pop();
  const foldsFrom=(size,opener,c)=>OPENS.find(o=>best(size,opener,o,c)==='fold');
  function handText(size,opener,open,c){
    const b=best(size,opener,open,c),t=tierOf(c),from=the(opener),{pot,toCall,need}=price(opener,open);
    if(b==='raise'){
      if(t===0)return `${c} is one of the very best starting hands. 3-bet for value: you want more chips in while you are ahead of nearly everything that continues, and it is too strong to let the opener see a cheap flop.`;
      const wide=cutoff(size,opener)>=6?`${cap(from)} opens wide, so `:'';
      return `${wide}${c} is ahead of much of the range that opens from ${from}. Out of position, 3-betting is better than calling: you take the betting lead and build the pot while you are ahead.`;
    }
    if(b==='call'){
      const f=foldsFrom(size,opener,c),then=f&&f>open?` Against a raise to ${bbs(f)} it becomes a fold.`:'';
      return `${c} is too good to fold at this price but not strong enough to 3-bet. Calling ${bbs(toCall)} to win a ${bbs(pot)} pot needs only about ${need}% equity. ${FLAVOR[kind(c)]}${then}`;
    }
    const up=defendsUpTo(size,opener,c);
    if(up)return `${c} is not strong enough to call ${bbs(toCall)} more against a raise to ${bbs(open)} from ${from}. The bigger the raise, the worse your price: you would defend it against a raise to ${bbs(up)}${up===OPENS[0]?'':' or less'}.`;
    return `${c} does not defend against ${from}, even against a min-raise. It wins too rarely out of position against a range that opens about ${Math.round(100*openPct(size,opener))}% of hands.`;
  }
  function priceText(size,opener,open){
    const {pot,toCall,need}=price(opener,open),s=shares(size,opener,open);
    const lo=shares(size,opener,OPENS[0]).defend,hi=shares(size,opener,OPENS[OPENS.length-1]).defend;
    return `Calling ${bbs(toCall)} to win a ${bbs(pot)} pot needs about ${need}% equity, because your 1 BB is already in. Against this raise the chart defends ${s.defend}% of hands: ${s.raise}% 3-bet and ${s.call}% call. From the same seat it defends ${lo}% against a ${bbs(OPENS[0])} min-raise and ${hi}% against a raise to ${bbs(OPENS[OPENS.length-1])}: a bigger raise gives you a worse price.`;
  }
  function openerText(size,opener){
    const p=Math.round(100*openPct(size,opener)),behind=behindOf(size,opener)-1;
    const range=opener==='SB'?`The small blind opens about ${p}% of hands, since only you are left to beat.`
      :`${cap(who(opener))} opens about ${p}% of hands, with ${behind} player${behind===1?'':'s'} still to act between them and you.`;
    const feel=p<=20?' A range that tight is full of strong hands, so you continue with fewer hands and 3-bet only the very best.'
      :p>=40?' A range that wide is easy to attack, so you defend most hands and 3-bet more of the strong ones.':' A middle range: defend the hands that play well, and 3-bet the strongest.';
    return range+feel+' You will be out of position after the flop, which is why the chart folds some hands the price alone would allow.';
  }

  T.bbDefense={OPENS,threeBetTo,book,labels,best,judge,shares,price,handText,priceText,openerText};
  if(!T.add)return;
  const rnd=n=>Math.floor(Math.random()*n);
  T.add({view:'bbDefense',pre:'bd',key:'rivlBbDefense',title:'BIG BLIND DEFENSE',chartName:'DEFENDING RANGE',
    eyebrow:'PREFLOP',name:'Big Blind Defense',art:()=>K.miniChart(c=>({raise:'tr-a',call:'tr-c',fold:''})[best(6,'CO',3,c)]),
    text:'You are in the big blind and someone raises. 3-bet, call or fold? Learn how the opener\'s seat and the size of the raise change your defense.',
    fine:'Standard 100 BB charts in the big blind against one open of 2 to 4 BB with everyone else folded, the same ones RIVL grades your play against. 3-bets go to 4x the open.',
    // The seat buttons pick the opener: you are always the big blind.
    heroSeats:size=>SEATS[size].slice(0,-1),seatOf:s=>s.opener,
    deal(size,opener,last){
      const open=OPENS[rnd(OPENS.length)],W=R.bookWindows(book(size,opener,open,'AA'));
      const edges=[W.raise[1],W.raise[1]+1,W.call[1],W.call[1]+1];
      return{pos:'BB',opener,open,cls:K.dealClass(edges.filter(t=>t<=8),last)};
    },
    question:s=>`${s.opener} OPENS TO ${bbs(s.open)}. 3-BET, CALL OR FOLD?`,
    say:s=>`${cap(who(s.opener))} opens to ${bbs(s.open)} and everyone else folds to you.`,
    actions:s=>[{act:'raise',label:'3-BET',sub:`to ${bbs(threeBetTo(s.open))}`,key:'r',alt:'3'},{act:'call',label:'CALL',sub:bbs(s.open-1),key:'c'},{act:'fold',label:'FOLD',key:'f'}],
    table:s=>{const seats=SEATS[s.size],o=seats.indexOf(s.opener),h=seats.indexOf('BB');
      return seats.map((x,i)=>({state:i===h?'me':i===o?'raise':'folded',bet:i===o?String(s.open):x==='SB'?'0.5':x==='BB'?'1':''}))},
    judge(s,act){
      const j=judge(s.size,s.opener,s.open,s.cls,act),b=j.best,c=s.cls,spot=`in the big blind against a raise to ${bbs(s.open)} from ${the(s.opener)}`;
      let text;
      if(j.v==='right')text=`${c} ${spot} is a ${ACT_NAME[b]}.`;
      else if(j.v==='close')text=act==='call'&&b==='raise'?'Calling is sound, but the chart\'s first choice is a 3-bet.'
        :act==='raise'?`${c} is just outside the 3-bet range. The chart ${ACT_VERB[b]} it, so the 3-bet is a small mistake.`
        :`${c} is right on the edge. The chart still ${ACT_VERB[b]} it at this price, so folding is a small mistake.`;
      else text=`The chart ${ACT_VERB[b]} ${c} ${spot}.`;
      return{v:j.v,best:b,text};
    },
    why:s=>[['THE HAND',handText(s.size,s.opener,s.open,s.cls)],['THE PRICE',priceText(s.size,s.opener,s.open)],['THE OPENER',openerText(s.size,s.opener)]],
    tag:s=>`${s.opener} ${s.open}x`,
    // The tabs show the same opener's chart at each raise size.
    tabs:()=>OPENS.map(String),tab:s=>String(s.open),tabLabel:t=>'to '+t,
    chartTitle:(s,t)=>`BB VS ${s.opener} · OPEN TO ${t} BB`,
    chartPct:(s,t)=>{const x=shares(s.size,s.opener,+t);return `defend ${x.defend}% · 3-bet ${x.raise}% · call ${x.call}%`},
    cell:(s,t)=>c=>CELL_VS[best(s.size,s.opener,+t,c)],
    legend:()=>[['hr-3bet','3-bet'],['hr-call','Call'],['hr-out','Fold']],
  });
})(typeof window!=='undefined'?window:globalThis);
