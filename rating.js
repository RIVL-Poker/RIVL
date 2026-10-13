/* RIVL v1.4.1 — decision analysis and Glicko-2 ladder.
   Depends on engine.js (preflopStrength). No other dependencies.

   How a rating update works:
   1. Every decision (yours and the bots') is graded by comparing the EV of the
      chosen action with the best available action, using equity against the
      hands each opponent is likely to hold given how they have bet this hand.
   2. At match end each player has a finishing place and a decision accuracy.
   3. Against every other player you get one blended score between 0 and 1:
        60% placement (1 beat them, 0.5 tie, 0 lost)  +  40% accuracy comparison
   4. Glicko-2 turns those scores into new ratings for everyone at the table.
      Each opponent counts as 1/sqrt(N-1) of a game, so a 6-max match is worth
      about 2.2 games of evidence (3-max ≈ 1.4, 9-max ≈ 2.8). */
(function(root){
'use strict';
const R13='23456789TJQKA', S4='♠♥♦♣';
const toInt=c=>R13.indexOf(c[0])*4+S4.indexOf(c[1]);

/* ---------- fast 5–7 card evaluator (higher number = better hand) ---------- */
const CNT=new Int8Array(13);
function straightHigh(m){const m2=(m<<1)|((m>>12)&1);for(let h=13;h>=4;h--)if(((m2>>(h-4))&31)===31)return h-1;return -1}
function topRanks(m,k){let v=0;for(let r=12;r>=0&&k>0;r--)if(m&(1<<r)){v=v*13+r;k--}return v}
function rankHand(cs){
  CNT.fill(0);const sm=[0,0,0,0],sc=[0,0,0,0];let rm=0;
  for(let i=0;i<cs.length;i++){const c=cs[i],r=c>>2,s=c&3;CNT[r]++;sm[s]|=1<<r;sc[s]++;rm|=1<<r}
  let fl=-1;for(let s=0;s<4;s++)if(sc[s]>=5)fl=s;
  if(fl>=0){const sf=straightHigh(sm[fl]);if(sf>=0)return 8*1048576+sf}
  let q=-1,t=-1,t2=-1,p1=-1,p2=-1;
  for(let r=12;r>=0;r--){const n=CNT[r];if(n===4)q=r;else if(n===3){if(t<0)t=r;else if(t2<0)t2=r}else if(n===2){if(p1<0)p1=r;else if(p2<0)p2=r}}
  if(q>=0)return 7*1048576+q*65536+topRanks(rm&~(1<<q),1);
  if(t>=0&&(t2>=0||p1>=0))return 6*1048576+t*65536+Math.max(t2,p1)*4096;
  if(fl>=0)return 5*1048576+topRanks(sm[fl],5);
  const st=straightHigh(rm);if(st>=0)return 4*1048576+st;
  if(t>=0)return 3*1048576+t*65536+topRanks(rm&~(1<<t),2);
  if(p1>=0&&p2>=0)return 2*1048576+p1*65536+p2*4096+topRanks(rm&~(1<<p1)&~(1<<p2),1);
  if(p1>=0)return 1*1048576+p1*65536+topRanks(rm&~(1<<p1),3);
  return topRanks(rm,5);
}
const handCategory=v=>Math.floor(v/1048576);

/* ---------- starting-hand percentiles, used to model ranges ---------- */
let PCT=null;
function pctTable(){
  if(PCT)return PCT;
  const cards=[];for(const r of R13)for(const s of S4)cards.push(r+s);
  const raw=new Float32Array(2704),list=[];
  for(let a=0;a<52;a++)for(let b=a+1;b<52;b++){const v=preflopStrength([cards[a],cards[b]]);raw[a*52+b]=raw[b*52+a]=v;list.push(v)}
  list.sort((x,y)=>x-y);
  const below=v=>{let lo=0,hi=list.length;while(lo<hi){const m=(lo+hi)>>1;if(list[m]<v)lo=m+1;else hi=m}return lo/list.length};
  PCT=new Float32Array(2704);for(let i=0;i<2704;i++)PCT[i]=below(raw[i]);
  return PCT;
}
/* An opponent's "line" this hand: 0 = no voluntary chips, 1 = called, 2 = bet or raised.
   Minimum starting-hand percentile we assume they hold, and how often they fold to a bet. */
const RANGE=[0,.35,.70], RANGE_IF_CALLS=[.35,.60,.85], FOLD_RATE=[.9,.6,.35];

function equity(hero,board,minPct,iters){
  const P=pctTable(),dead=new Uint8Array(52);
  hero.forEach(c=>dead[c]=1);board.forEach(c=>dead[c]=1);
  const rest=[];for(let c=0;c<52;c++)if(!dead[c])rest.push(c);
  const n=rest.length,need=5-board.length,opp=minPct.length;
  const swap=(a,b)=>{const t=rest[a];rest[a]=rest[b];rest[b]=t};
  let win=0;
  for(let it=0;it<iters;it++){
    let k=0;const oh=[];
    for(let j=0;j<opp;j++){
      let tries=0;
      for(;;){
        const i1=k+Math.floor(Math.random()*(n-k));let i2=k+Math.floor(Math.random()*(n-k-1));if(i2>=i1)i2++;
        const c1=rest[i1],c2=rest[i2];
        if(minPct[j]<=0||P[c1*52+c2]>=minPct[j]||++tries>30){
          const p2=i2===k?i1:i2;swap(k,i1);swap(k+1,p2);oh.push(c1,c2);k+=2;break;
        }
      }
    }
    for(let j=0;j<need;j++){swap(k,k+Math.floor(Math.random()*(n-k)));k++}
    const b=board.concat(rest.slice(k-need,k));
    const me=rankHand(hero.concat(b));let ties=0,lost=false;
    for(let j=0;j<opp;j++){const v=rankHand([oh[2*j],oh[2*j+1]].concat(b));if(v>me){lost=true;break}if(v===me)ties++}
    if(!lost)win+=1/(ties+1);
  }
  return win/iters;
}

/* ---------- decision analysis ---------- */
const LABELS=['Brilliant','Best','Excellent','Good','Inaccuracy','Mistake','Blunder'];
const GLYPH={Brilliant:'!!',Best:'★',Excellent:'!',Good:'✓',Inaccuracy:'?!',Mistake:'?',Blunder:'??'};

function analyze(g,i,iters){
  const p=g.players[i],bb=g.bb||g.minRaise||10;
  const opps=g.players.filter((q,j)=>j!==i&&!q.folded&&q.hole&&q.hole.length);
  const toCall=Math.min(Math.max(0,g.currentBet-p.bet),p.stack);
  const pot=g.pot,maxTotal=p.bet+p.stack,minTotal=g.currentBet+g.minRaise;
  const hero=p.hole.map(toInt),board=g.board.map(toInt);
  const eq=opps.length?equity(hero,board,opps.map(q=>RANGE[q.line||0]),iters):1;
  const eqC=opps.length?equity(hero,board,opps.map(q=>RANGE_IF_CALLS[q.line||0]),iters):1;
  const maxOppTotal=Math.max(0,...opps.map(q=>q.bet+q.stack));
  const raiseOpt=T=>{
    const actors=opps.filter(q=>!q.allin);
    const effT=Math.max(g.currentBet,Math.min(T,maxOppTotal));
    const effA=Math.max(toCall,effT-p.bet);
    let F=actors.length&&!opps.some(q=>q.allin)?1:0,callerB=0;
    actors.forEach(q=>{const B=Math.max(0,Math.min(effT-q.bet,q.stack));F*=Math.min(.85,B/(pot+B||1)*FOLD_RATE[q.line||0]);callerB=Math.max(callerB,B)});
    const ev=F*pot+(1-F)*(eqC*(pot+effA+callerB)-effA);
    return{type:'raise',T,ev,label:T>=maxTotal?`All-in ${T}`:g.currentBet===0?`Bet ${T}`:`Raise to ${T}`};
  };
  const opts=[{type:'fold',ev:0,label:'Fold'}];
  opts.push(toCall>0?{type:'call',ev:eq*(pot+toCall)-toCall,label:`Call ${toCall}`}:{type:'check',ev:eq*pot,label:'Check'});
  const canRaise=!p.raiseLocked&&maxTotal>g.currentBet&&opps.some(q=>!q.allin);
  if(canRaise){
    const base=pot+toCall,seen=new Set();
    [minTotal,g.currentBet+base*.5,g.currentBet+base*.75,g.currentBet+base,maxTotal].forEach(t=>{
      t=Math.round(t);if(t<minTotal)t=minTotal;if(t>maxTotal)t=maxTotal;
      if(!seen.has(t)){seen.add(t);opts.push(raiseOpt(t))}
    });
  }
  return{i,opts,eq,eqC,toCall,pot,bb,canRaise,raiseOpt,minTotal,maxTotal,hand:g.hand,street:g.street,
    madeCat:board.length?handCategory(rankHand(hero.concat(board))):0};
}

function grade(A,type,amount){
  let chosen;
  if(type==='raise')chosen=A.opts.find(o=>o.type==='raise'&&o.T===amount)||A.raiseOpt(amount);
  else if(type==='fold')chosen=A.opts[0];
  else chosen=A.opts[1];
  const best=A.opts.concat(chosen).reduce((a,b)=>b.ev>a.ev?b:a);
  const loss=Math.max(0,best.ev-chosen.ev),denom=Math.max(A.pot+A.toCall,2*A.bb);
  const ratio=loss/denom,lossBB=loss/A.bb;
  let label=ratio<=.02?'Best':ratio<=.06?'Excellent':ratio<=.12?'Good':ratio<=.25?'Inaccuracy':ratio<=.5?'Mistake':'Blunder';
  if(lossBB<.25&&LABELS.indexOf(label)>LABELS.indexOf('Good'))label='Good';
  if(label==='Best'&&A.pot>=6*A.bb){
    const passive=A.opts[1].ev,fold=0;
    if(chosen.type==='call'&&A.toCall>=.25*A.pot&&A.eq<.45&&chosen.ev-fold>=.08*denom)label='Brilliant';
    else if(chosen.type==='raise'&&A.eq<.3&&chosen.ev>0&&chosen.ev-passive>=.1*denom)label='Brilliant';
    else if(chosen.type==='fold'&&A.toCall>0&&A.madeCat>=2&&passive<=-.1*denom)label='Brilliant';
  }
  const acc=100*Math.exp(-2.5*ratio),weight=1+Math.log(1+A.pot/A.bb);
  const pct=x=>Math.round(x*100)+'%';
  const need=A.toCall?A.toCall/(A.pot+A.toCall):0;
  let why=`Equity ${pct(A.eq)} against their likely hands`+(A.toCall?`; you needed ${pct(need)} to call.`:'.');
  let verdict=chosen===best||loss<1e-9?`${chosen.label} was the best play.`:`Best was ${best.label}. Your ${chosen.label.toLowerCase()} gave up about ${lossBB.toFixed(1)} BB.`;
  if(label==='Brilliant')verdict=chosen.type==='call'?`A tough call that the math backs up.`:chosen.type==='raise'?`A profitable bluff: they fold often enough.`:`A disciplined laydown of a strong hand.`;
  return{label,glyph:GLYPH[label],acc,weight,lossBB,chosen:chosen.label,best:best.label,eq:A.eq,text:`${why} ${verdict}`,hand:A.hand,street:A.street};
}

/* Bots pick from the same option list, with skill-based noise and a style bias. */
const BOTS={
  Ace:{noise:.06,aggr:.02,r:1650},Rico:{noise:.14,aggr:.06,r:1520},Luna:{noise:.09,aggr:-.02,r:1580},
  Nash:{noise:.20,aggr:0,r:1440},Mula:{noise:.28,aggr:.04,r:1350},Jett:{noise:.12,aggr:.10,r:1480},
  Nova:{noise:.08,aggr:.03,r:1600},Blaze:{noise:.22,aggr:.12,r:1400}};
function gauss(){let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function chooseBot(g,i){
  const A=analyze(g,i,140),prof=BOTS[g.players[i].name]||{noise:.15,aggr:0};
  const denom=Math.max(A.pot+A.toCall,2*A.bb);
  let pick=A.opts[1],bestScore=-Infinity;
  A.opts.forEach(o=>{
    if(o.type==='fold'&&A.toCall===0)return;
    const s=o.ev+prof.noise*denom*gauss()+(o.type==='raise'?prof.aggr*denom:0);
    if(s>bestScore){bestScore=s;pick=o}
  });
  return{A,type:pick.type==='check'?'check':pick.type,amount:pick.T||0};
}

/* ---------- Glicko-2 ---------- */
const SCALE=173.7178,TAU=0.5,W_PLACE=.6,W_DEC=.4,MIN_DECISIONS=3;
function glicko(me,results){ // results: [{r,rd,s}]
  const mu=(me.r-1500)/SCALE,phi=me.rd/SCALE,ph2=phi*phi;
  let vInv=0,dSum=0;
  results.forEach(o=>{const w=o.w==null?1:o.w,pj=o.rd/SCALE,g=1/Math.sqrt(1+3*pj*pj/(Math.PI*Math.PI)),E=1/(1+Math.exp(-g*(mu-(o.r-1500)/SCALE)));vInv+=w*g*g*E*(1-E);dSum+=w*g*(o.s-E)});
  if(!results.length)return{...me};
  const v=1/vInv,delta=v*dSum,a=Math.log(me.vol*me.vol);
  const f=x=>{const ex=Math.exp(x);return ex*(delta*delta-ph2-v-ex)/(2*Math.pow(ph2+v+ex,2))-(x-a)/(TAU*TAU)};
  let A=a,B;
  if(delta*delta>ph2+v)B=Math.log(delta*delta-ph2-v);else{let k=1;while(f(a-k*TAU)<0&&k<100)k++;B=a-k*TAU}
  let fA=f(A),fB=f(B),guard=0;
  while(Math.abs(B-A)>1e-6&&guard++<200){const C=A+(A-B)*fA/(fB-fA),fC=f(C);if(fC*fB<=0){A=B;fA=fB}else fA/=2;B=C;fB=fC}
  const vol=Math.exp(A/2),phiStar=Math.sqrt(ph2+vol*vol),phiNew=1/Math.sqrt(1/(phiStar*phiStar)+1/v);
  return{r:(mu+phiNew*phiNew*dSum)*SCALE+1500,rd:Math.min(350,Math.max(30,phiNew*SCALE)),vol};
}
const pairAcc=(a,b)=>Math.max(0,Math.min(1,.5+(a-b)/30));
const placeScore=(a,b)=>a<b?1:a>b?0:.5;

/* ---------- storage ---------- */
const KEY='rivl-ladder-v1';
function freshStore(){
  const players={You:{r:1500,rd:350,vol:.06,games:0,wins:0,accSum:0,accN:0}};
  Object.entries(BOTS).forEach(([n,b])=>players[n]={r:b.r,rd:120,vol:.06,games:0,wins:0,accSum:0,accN:0});
  return{version:1,players,matches:[],labels:Object.fromEntries(LABELS.map(l=>[l,0]))};
}
let STORE=null;
function store(){
  if(STORE)return STORE;
  STORE=freshStore();
  try{const raw=root.localStorage&&root.localStorage.getItem(KEY);if(raw){const s=JSON.parse(raw);if(s&&s.version===1){STORE.players=Object.assign(STORE.players,s.players);STORE.matches=s.matches||[];STORE.labels=Object.assign(STORE.labels,s.labels)}}}catch(e){}
  return STORE;
}
function save(){try{root.localStorage&&root.localStorage.setItem(KEY,JSON.stringify(STORE))}catch(e){}}
function resetLadder(){STORE=freshStore();save();return STORE}

function matchAccuracy(p){
  const gr=p.grades||[];if(!gr.length)return{acc:null,n:0};
  let s=0,w=0;gr.forEach(x=>{s+=x.acc*x.weight;w+=x.weight});
  return{acc:s/w,n:gr.length};
}
/* places: array of finishing places aligned with game.players (1 = best, ties allowed). */
function recordMatch(players,places){
  const st=store();
  const rows=players.map((p,i)=>{const a=matchAccuracy(p);return{name:p.name,place:places[i],acc:a.acc,n:a.n,before:{...(st.players[p.name]||{r:1500,rd:350,vol:.06})}}});
  const results=(row,mode)=>rows.filter(o=>o!==row).map(o=>{
    const pl=placeScore(row.place,o.place),okAcc=row.n>=MIN_DECISIONS&&o.n>=MIN_DECISIONS;
    const ac=okAcc?pairAcc(row.acc,o.acc):pl;
    const s=mode==='place'?pl:mode==='acc'?ac:W_PLACE*pl+W_DEC*ac;
    return{r:o.before.r,rd:o.before.rd,s,w:1/Math.sqrt(rows.length-1)};
  });
  rows.forEach(row=>{
    row.after=glicko(row.before,results(row,'blend'));
    const dp=glicko(row.before,results(row,'place')).r-row.before.r,da=glicko(row.before,results(row,'acc')).r-row.before.r;
    row.placePart=W_PLACE*dp;row.accPart=W_DEC*da;
  });
  rows.forEach(row=>{
    const s=st.players[row.name]||(st.players[row.name]={games:0,wins:0,accSum:0,accN:0});
    Object.assign(s,{r:row.after.r,rd:row.after.rd,vol:row.after.vol});
    s.games=(s.games||0)+1;if(row.place===1)s.wins=(s.wins||0)+1;
    if(row.acc!=null){s.accSum=(s.accSum||0)+row.acc;s.accN=(s.accN||0)+1}
  });
  const me=rows[0],myGrades=players[0].grades||[];
  const labels=Object.fromEntries(LABELS.map(l=>[l,0]));myGrades.forEach(g=>{labels[g.label]++;st.labels[g.label]=(st.labels[g.label]||0)+1});
  const byLoss=[...myGrades].sort((a,b)=>b.lossBB-a.lossBB);
  const summary={t:Date.now(),size:players.length,place:me.place,acc:me.acc,n:me.n,before:me.before.r,after:me.after.r,rdBefore:me.before.rd,rdAfter:me.after.rd,
    placePart:me.placePart,accPart:me.accPart,labels,
    brilliant:myGrades.find(g=>g.label==='Brilliant')||null,worst:byLoss.find(g=>LABELS.indexOf(g.label)>=4&&g.lossBB>=.5)||null,
    table:rows.map(r=>({name:r.name,place:r.place,acc:r.acc,delta:r.after.r-r.before.r}))};
  st.matches.push({t:summary.t,size:summary.size,place:summary.place,acc:summary.acc,before:summary.before,after:summary.after,placePart:summary.placePart,accPart:summary.accPart});
  if(st.matches.length>300)st.matches.shift();
  save();
  return summary;
}

const TIERS=[['Bronze',0,1400],['Silver',1400,1600],['Gold',1600,1800],['Platinum',1800,2000],['Diamond',2000,Infinity]];
function tier(r){const t=TIERS.find(([,lo,hi])=>r>=lo&&r<hi)||TIERS[0];const lo=t[1]||1200,hi=t[2]===Infinity?lo+200:t[2];return{name:t[0],progress:Math.max(0,Math.min(1,(r-lo)/(hi-lo))),next:t[2]===Infinity?null:t[2]}}

root.RivlRating={toInt,rankHand,handCategory,equity,analyze,grade,chooseBot,glicko,recordMatch,matchAccuracy,store,save,resetLadder,tier,LABELS,GLYPH,BOTS,W_PLACE,W_DEC};
})(typeof window!=='undefined'?window:globalThis);
