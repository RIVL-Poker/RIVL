/* RIVL Training: Push or Fold, the short-stack drill. Everyone has 3 to 12 big blinds, as in the late stages of a
   tournament. Folded to you, shove all-in or fold; in the big blind against a shove, call or fold.
   The answers are the push/fold Nash charts in pushfold-charts.js (chip EV, equal stacks, blinds 0.5/1, no ante),
   built by scripts/pushfold/make-charts.mjs. It runs on training.js's shared drill page. Progress is kept in this
   browser. */
(root=>{
  const T=root.RivlTraining,CH=root.RivlPushFoldCharts;if(!T||!CH)return;
  const {SEATS,CLASSES}=T;
  const STACKS=CH.stacks;
  const NAME={UTG:'under the gun','UTG+1':'UTG+1',MP:'middle position',LJ:'lojack',HJ:'hijack',CO:'cutoff',BTN:'button',SB:'small blind',BB:'big blind'};
  const from=p=>p==='UTG'?'under the gun':p==='UTG+1'?'from UTG+1':'from the '+NAME[p];
  const the=p=>p==='UTG'?'the player under the gun':p==='UTG+1'?'UTG+1':'the '+NAME[p];
  const cap=t=>t[0].toUpperCase()+t.slice(1),bbs=x=>+x.toFixed(1)+' BB',bbs2=x=>x.toFixed(2)+' BB';
  const combos=c=>c.length===2?6:c[2]==='s'?4:12;
  const count=test=>CLASSES.reduce((a,c)=>a+(test(c)?combos(c):0),0),share=test=>Math.round(100*count(test)/1326);
  const behindOf=(size,pos)=>SEATS[size].length-1-SEATS[size].indexOf(pos);

  /* ---------- the charts ---------- */
  // Each entry lists the stacks (in BB) where a hand is in the range; see pushfold-charts.js.
  const parse=e=>e==='-'?[]:e.split(',').map(r=>r==='*'?[CH.from,CH.to]:r.endsWith('+')?[+r.slice(0,-1),CH.to]:r.includes('-')?r.split('-').map(Number):[CH.from,+r]);
  const RUNS={push:{},call:{}};
  for(const kind of ['push','call'])for(const n in CH[kind])RUNS[kind][n]=CH[kind][n].split(' ').map(parse);
  const runsOf=(kind,n,c)=>RUNS[kind][n][CLASSES.indexOf(c)];
  const inRuns=(runs,S)=>runs.some(([a,b])=>S>=a-1e-9&&S<=b+1e-9);
  // The EV of shoving (or calling) minus folding, in BB, for a drill stack; see pushfold-charts.js.
  const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const EVS={push:{},call:{}};
  for(const kind of ['push','call'])for(const n in CH.ev[kind])EVS[kind][n]=CH.ev[kind][n].split(' ');
  function evOf(kind,n,c,S){const row=EVS[kind][n][CH.stacks.indexOf(S)],h=2*CLASSES.indexOf(c);
    return (B64.indexOf(row[h])*64+B64.indexOf(row[h+1])-2048)/100}
  // The spot's chart: who shoves (folded to the hero's seat) or who calls (the big blind against a shove from `opener`).
  const spotKind=s=>s.pos==='BB'?'call':'push';
  const spotN=(s,seat)=>behindOf(s.size,seat||(s.pos==='BB'?s.opener:s.pos));
  const inChart=(s,c,seat)=>inRuns(runsOf(spotKind(s),spotN(s,seat),c),s.stack);
  const chartShare=(s,seat)=>share(c=>inChart(s,c,seat));
  const spotEv=s=>evOf(spotKind(s),spotN(s),s.cls,s.stack);
  // Graded by what the answer costs against the chart's best play: right (nothing, or under 0.02 BB where the
  // equilibrium mixes the hand), close (up to 0.1 BB) or wrong.
  const MIXED=.02,CLOSE=.1;
  function judge(s,act){
    const yes=s.pos==='BB'?'call':'shove',inR=inChart(s,s.cls),best=inR?yes:'fold',ev=spotEv(s);
    const loss=Math.max(0,act===yes?-ev:ev);
    return{best,inR,ev,loss,mixed:Math.abs(ev)<MIXED,v:act===best||loss<MIXED?'right':loss<=CLOSE+1e-9?'close':'wrong'};
  }
  // "up to 9.4 BB", "between 4.1 and 7.3 BB", ...
  function rangeText(runs){
    if(!runs.length)return 'at no stack from 1 to 20 BB';
    const one=([a,b])=>a<=CH.from&&b>=CH.to?'at every stack from 1 to 20 BB':a<=CH.from?`at any stack up to ${bbs(b)}`:b>=CH.to?`from ${bbs(a)} up`:a===b?`at exactly ${bbs(a)}`:`between ${bbs(a)} and ${bbs(b)}`;
    return runs.map(one).join(', and ');
  }

  /* ---------- the words ---------- */
  function kind(c){
    const hi=12-'AKQJT98765432'.indexOf(c[0]),lo=12-'AKQJT98765432'.indexOf(c[1]);
    if(c.length===2)return hi>=8?'bigPair':'pair';
    if(hi===12)return 'ace';if(hi===11)return 'king';
    if(c[2]==='s'&&hi-lo<=2)return 'connector';
    return lo>=8?'broadway':'other';
  }
  const WHY_SHOVE={
    bigPair:'A big pair is ahead of every hand that can call you except a bigger pair, so you want all the chips in.',
    pair:'A pair is a small favourite against two high cards, the hands that usually call, and wins the blinds when nobody does.',
    ace:'Holding an ace makes it less likely anyone behind has a big ace, and an ace-high hand has close to 30% or more against nearly every calling hand.',
    king:'A king is often the highest card out. When everyone folds you win the blinds; when called, it still has a fair share against most hands that call.',
    connector:'Suited connected cards are rarely far behind: against two high cards they still win about a third of the time with straights and flushes.',
    broadway:'Two high cards win the blinds often and are live against most calling hands that are not a pair or a better ace.',
    other:'At this stack the blinds are a big share of what you have, so winning them uncontested often is worth more than the times you are called and behind.',
  };
  const WHY_FOLD={
    bigPair:'',pair:'A small pair is a coin flip at best against the high cards that call, and behind every bigger pair.',
    ace:'A weak ace is dominated by the better aces that call a shove, which keeps it to roughly 25-30% when called.',
    king:'When a king gets called it is often by an ace or a bigger king, and then it wins little more than a quarter of the time.',
    connector:'It wins the blinds when everyone folds, but when called it is behind almost every calling hand.',
    broadway:'The hands that call a shove are mostly better high cards and pairs, which this hand rarely beats.',
    other:'When called, it is far behind the hands that call, so the blinds are not worth the risk.',
  };
  const WHY_CALL={
    bigPair:'A big pair is ahead of nearly every hand that shoves, so call.',
    pair:'Against a wide shoving range a pair is usually ahead, or a coin flip against two high cards.',
    ace:'An ace is ahead of the many kings, queens and weaker hands in a wide shoving range.',
    king:'A king beats the weaker high cards in the shoving range and is rarely dominated when the range is wide.',
    connector:'Suited connected cards keep about a third against most of the shoving range, and the price is good.',
    broadway:'Two high cards are ahead of the weaker high cards in the shoving range.',
    other:'The price is so good that even a weak hand wins often enough against a wide shoving range.',
  };
  const WHY_PASS={
    bigPair:'',pair:'A small pair is often a coin flip at best against the high cards that shove, and that is not enough at this price.',
    ace:'A weak ace is dominated by the better aces in the shoving range.',
    king:'Against this range a king is too often dominated by an ace or a better king.',
    connector:'It rarely wins against the high cards and pairs that shove from this seat.',
    broadway:'The shoving range from this seat holds too many pairs and better high cards for this hand to call.',
    other:'This hand is behind nearly everything in the shoving range.',
  };
  const callCost=s=>s.stack-1,potIfCall=s=>2*s.stack+(s.opener==='SB'?0:.5);
  const needEq=s=>Math.round(100*callCost(s)/potIfCall(s));
  function handText(s){
    const kindName=spotKind(s),runs=runsOf(kindName,spotN(s),s.cls),inR=inRuns(runs,s.stack),k=kind(s.cls);
    if(s.pos==='BB'){
      const line=`Against a shove ${from(s.opener)}, the chart calls with ${s.cls} ${rangeText(runs)}.`;
      return line+' '+(inR?WHY_CALL[k]:WHY_PASS[k]||WHY_PASS.other);
    }
    const line=`${cap(from(s.pos))}, the chart shoves ${s.cls} ${rangeText(runs)}.`;
    return line+' '+(inR?WHY_SHOVE[k]:WHY_FOLD[k]||WHY_FOLD.other);
  }
  function spotText(s){
    if(s.pos==='BB'){
      const p=share(c=>inRuns(runsOf('push',behindOf(s.size,s.opener),c),s.stack)),q=chartShare(s);
      return `${cap(the(s.opener))} shoves about ${p}% of hands at ${bbs(s.stack)}. You have 1 BB in already, so calling costs ${bbs(callCost(s))} more to win a pot of ${bbs(potIfCall(s))}: you need about ${needEq(s)}% equity against that range. The chart calls ${q}%.`;
    }
    const n=behindOf(s.size,s.pos),p=chartShare(s),bb=share(c=>inRuns(runsOf('call',n,c),s.stack));
    if(s.pos==='SB')return `Only the big blind is left. At ${bbs(s.stack)} the small blind shoves ${p}% of hands, and the big blind calls ${bb}% against it. This is the heads-up push/fold game.`;
    return `${n} players still act behind you, and any of them can wake up with a hand. At ${bbs(s.stack)} the chart shoves ${p}% of hands from here; the big blind calls ${bb}% against it.${n>=6?' Early seats shove tight because a call is likely to come from someone.':n<=3?' Late seats shove wide: few players are left to call, and the blinds are worth winning.':''}`;
  }
  root.RivlPushFold={STACKS,MIXED,CLOSE,runsOf,inRuns,evOf,spotEv,rangeText,judge,handText,spotText,chartShare,behindOf};

  /* ---------- the drill ---------- */
  const add=T.add;if(!add)return;
  const rnd=n=>Math.floor(Math.random()*n);
  const randomClass=()=>{let r=rnd(1326);for(const c of CLASSES){r-=combos(c);if(r<0)return c}return '72o'};
  // Half the hands come from the edge of the chart at this stack, where the learning is; the rest are random.
  function dealClass(s,last){
    const near=CLASSES.filter(c=>Math.abs(evOf(spotKind(s),spotN(s),c,s.stack))<=.5);
    for(let k=0;k<20;k++){const c=near.length&&Math.random()<.5?near[rnd(near.length)]:randomClass();if(c!==last)return c}
    return 'AA';
  }
  const verb=s=>s.pos==='BB'?'call':'shove';
  const cfg={view:'pushFold',pre:'pf',key:'rivlPushFold',title:'PUSH OR FOLD',chartName:'NASH CHART',
    eyebrow:'SHORT STACK',name:'Push or Fold',
    art:()=>'<span class="tr-mini">'+CLASSES.map(c=>`<i class="${inRuns(runsOf('push',3,c),10)?'tr-b':''}"></i>`).join('')+'</span>',
    text:'Tournament short stack, 12 big blinds or less. Shove all-in or fold? And in the big blind, call the shove or fold? Learn the Nash push/fold charts.',
    fine:'Push/fold Nash charts: chip EV, every stack equal, blinds 0.5/1 BB with no ante, solved for every 0.1 BB from 1 to 20 BB. A miss that costs 0.1 BB or less counts as close.',
    heroSeats:size=>SEATS[size],
    deal(size,pos,last){
      const s={size,pos,stack:STACKS[rnd(STACKS.length)]};
      if(pos==='BB'){const seats=SEATS[size].slice(0,-1);s.opener=seats[rnd(seats.length)]}
      s.cls=dealClass(s,last);return s;
    },
    question:s=>s.pos==='BB'?`${s.opener} SHOVES ${bbs(s.stack)}. CALL OR FOLD?`:`${bbs(s.stack)} STACKS. EVERYONE FOLDS TO YOU. SHOVE OR FOLD?`,
    say:s=>`Everyone has ${bbs(s.stack)}. `+(s.pos==='BB'?`${cap(the(s.opener))} shoves all-in${SEATS[s.size].indexOf(s.opener)<SEATS[s.size].length-2?' and the others fold':''}.`:'Everyone before you folds.'),
    actions:s=>s.pos==='BB'?[{act:'call',label:'CALL',sub:bbs(s.stack-1),key:'c'},{act:'fold',label:'FOLD',key:'f'}]
      :[{act:'shove',label:'SHOVE',sub:`all-in ${bbs(s.stack)}`,key:'s',alt:'a'},{act:'fold',label:'FOLD',key:'f'}],
    table:s=>{const seats=SEATS[s.size],h=seats.indexOf(s.pos),o=s.opener?seats.indexOf(s.opener):-1;
      return seats.map((x,i)=>({state:i===h?'me':i===o?'raise':i<h?'folded':'live',em:i===o?'ALL-IN':'',bet:i===o?String(s.stack):x==='SB'?'0.5':x==='BB'?'1':''}))},
    judge(s,act){
      const j=judge(s,act),c=s.cls,at=`at ${bbs(s.stack)}`,where=s.pos==='BB'?`against a shove ${from(s.opener)}`:from(s.pos);
      const y=verb(s),gain=bbs2(Math.abs(j.ev)),play=j.inR?y:'fold';
      let text;
      if(j.mixed)text=`${c} ${where} ${at} is a coin toss for the chart: shoving and folding are worth the same within 0.02 BB, so either is right.`.replace('shoving',s.pos==='BB'?'calling':'shoving');
      else if(j.v==='right')text=`${c} ${where} ${at} is a ${play}. ${j.inR?cap(y==='call'?'calling':'shoving')+' earns':'Folding saves'} ${gain} over the other play.`;
      else if(j.v==='close')text=`Close. The chart ${j.inR?y+'s':'folds'} ${c} ${at}, but only by ${gain}, so this is a small mistake.`;
      else text=`The chart ${j.inR?y+'s':'folds'} ${c} ${where} ${at}. Your play gives up ${gain}.`;
      return{v:j.v,best:j.best,text};
    },
    why:s=>[['THE HAND',handText(s)],['THE SPOT',spotText(s)]],
    tag:s=>s.pos==='BB'?`BB v ${s.opener} ${s.stack}`:`${s.pos} ${s.stack}`,
    tabs:s=>SEATS[s.size].slice(0,-1),tab:s=>s.pos==='BB'?s.opener:s.pos,tabLabel:t=>t,
    chartTitle:(s,t)=>s.pos==='BB'?`BB CALLS VS ${t} · ${bbs(s.stack)}`:`${t} SHOVES · ${bbs(s.stack)}`,
    chartPct:(s,t)=>{const n=count(c=>inChart(s,c,t));return `${s.pos==='BB'?'Call':'Shove'} ${Math.round(100*n/1326)}% · ${n} of 1,326 combos`},
    cell:(s,t)=>c=>inChart(s,c,t)?(s.pos==='BB'?'hr-call':'hr-in-old'):'hr-out',
    legend:s=>s.pos==='BB'?[['hr-call','Call'],['hr-out','Fold']]:[['hr-in-old','Shove'],['hr-out','Fold']],
  };
  add(cfg);
})(typeof window!=='undefined'?window:globalThis);
