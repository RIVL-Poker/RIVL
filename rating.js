/* RIVL v1.4.1 — decision analysis and Glicko-2 ladder.
   Depends on engine.js (preflopStrength). No other dependencies.

   How a rating update works:
   1. Every decision (yours and the bots') is graded. Preflop, against standard
      opening and defending charts; after the flop, by comparing the EV of the
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

/* ---------- starting hands: standard opening-chart tiers ----------
   Each tier adds the hands a seat one step later opens (100 BB, no ante), so the tiers nest:
   T0–T2 is a 9-handed under-the-gun range (~11%), T0–T4 a 6-max UTG range (~20%), T0–T5 the
   hijack (~25%), T0–T6 the cutoff (~33%), T0–T7 the button (~48%), T0–T8 heads-up (~67%).
   Anything not listed is tier 9 (never opened). */
const TIERS=[
  'AA KK QQ AKs AKo',
  'JJ TT AQs AJs KQs AQo',
  '99 88 77 ATs KJs KTs QJs QTs JTs A5s AJo KQo',
  '66 55 A9s A8s A4s K9s T9s ATo KJo',
  '44 A7s A6s A3s A2s Q9s J9s 98s 87s QJo KTo',
  '33 22 K8s K7s T8s 97s 76s 65s A9o QTo JTo',
  'K6s K5s Q8s J8s 86s 75s 54s A8o A7o A5o K9o Q9o J9o T9o',
  'K4s K3s K2s Q7s Q6s Q5s Q4s J7s J6s T7s T6s 96s 85s 74s 64s 53s 43s A6o A4o A3o A2o K8o Q8o J8o T8o 98o 87o',
  'Q3s Q2s J5s J4s J3s J2s T5s T4s T3s T2s 95s 94s 93s 84s 83s 73s 63s 52s 42s 32s K7o K6o K5o K4o K3o K2o Q7o Q6o Q5o J7o T7o 97o 86o 76o 65o'];
const TIER=new Map();TIERS.forEach((l,t)=>l.split(' ').forEach(h=>TIER.set(h,t)));
// Hand class like "AKs", "T9o" or "77" from two card ints.
function handClass(a,b){const ra=a>>2,rb=b>>2,hi=Math.max(ra,rb),lo=Math.min(ra,rb);return R13[hi]+R13[lo]+(hi===lo?'':(a&3)===(b&3)?'s':'o')}
const handTier=(a,b)=>{const t=TIER.get(handClass(a,b));return t==null?9:t};
let PCT=null;
function pctTable(){
  if(PCT)return PCT;
  const cards=[];for(const r of R13)for(const s of S4)cards.push(r+s);
  // Rank by chart tier first, then by the engine's strength score inside a tier.
  const raw=new Float32Array(2704),list=[];
  for(let a=0;a<52;a++)for(let b=a+1;b<52;b++){const v=(9-handTier(a,b))+preflopStrength([cards[a],cards[b]]);raw[a*52+b]=raw[b*52+a]=v;list.push(v)}
  list.sort((x,y)=>x-y);
  const below=v=>{let lo=0,hi=list.length;while(lo<hi){const m=(lo+hi)>>1;if(list[m]<v)lo=m+1;else hi=m}return lo/list.length};
  PCT=new Float32Array(2704);for(let i=0;i<2704;i++)PCT[i]=below(raw[i]);
  return PCT;
}
/* An opponent's "line" this hand: 0 = no voluntary chips, 1 = called, 2 = bet or raised.
   Minimum starting-hand percentile we assume they hold, and how much more than minimum defence
   they continue with against a bet (1 = exactly the share the bet's pot odds call for, the
   rest folds). Big overbets are folded to far more often than small bets, as in real play. */
const RANGE=[0,.35,.70], DEFEND=[1.05,1.3,1.6];
const foldShare=(B,pot,line)=>Math.min(.9,Math.max(.05,1-pot/(pot+B||1)*DEFEND[line||0]));
// Share of a bettor's range that is value (the rest is bluffs and draws) on the flop, turn and river.
const VALUE_SHARE={3:.5,4:.4,5:.33};

/* Seeded generator so the same spot always gets the same estimate (and the same grade). */
function mulberry32(seed){return function(){seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hashSpot(parts){let h=2166136261;for(const x of parts){h^=x&0xffffffff;h=Math.imul(h,16777619)}return h>>>0}

/* Every two-card holding an opponent could have, given the cards we can see, with its
   starting-hand percentile and its strength on this board (the starting percentile preflop).
   Postflop strength is the made hand, with flush and open-ended straight draws counted as a
   middle pair, since those hands continue too. */
function holdings(hero,board){
  const P=pctTable(),dead=new Uint8Array(52);hero.forEach(c=>dead[c]=1);board.forEach(c=>dead[c]=1);
  const c1=[],c2=[],pct=[],score=[];
  for(let a=0;a<52;a++)if(!dead[a])for(let b=a+1;b<52;b++)if(!dead[b]){
    c1.push(a);c2.push(b);pct.push(P[a*52+b]);
    if(!board.length){score.push(P[a*52+b]);continue}
    let v=rankHand([a,b].concat(board));
    if(board.length<5&&v<2*1048576){
      const all=[a,b].concat(board),sc=[0,0,0,0];let m=0;all.forEach(c=>{sc[c&3]++;m|=1<<(c>>2)});
      const fd=sc[a&3]>=4||sc[b&3]>=4,mine=(1<<(a>>2))|(1<<(b>>2));
      let oesd=false;for(let lo=0;lo<=8;lo++){const run=15<<lo;if((m&run)===run&&(mine&run)&&lo>0&&lo<9)oesd=true}
      if(fd||oesd)v=Math.max(v,1*1048576+(fd?7:5)*65536);
    }
    score.push(v);
  }
  return{c1,c2,pct,score,n:c1.length};
}
// Indexes of the holdings in a range (starting percentile ≥ minPct), strongest first.
function rangeOf(H,minPct){const idx=[];for(let k=0;k<H.n;k++)if(H.pct[k]>=minPct)idx.push(k);return idx.sort((x,y)=>H.score[y]-H.score[x])}
// The strongest `frac` of a range (keeping ties together).
function topOf(H,idx,frac){
  let n=Math.max(1,Math.min(idx.length,Math.ceil(frac*idx.length)));
  while(n<idx.length&&H.score[idx[n]]===H.score[idx[n-1]])n++;
  return idx.slice(0,n);
}
/* Monte Carlo equity against one holding per opponent. Each opponent is either a starting-hand
   percentile (any holding at least that strong) or {a, b, beta}: a list of holdings, plus a
   second list `b` they hold instead with probability `beta` (a bettor's bluffs and draws). */
function equity(hero,board,opps,iters,rand,H){
  rand=rand||Math.random;H=H||holdings(hero,board);
  const specs=opps.map(o=>typeof o==='number'?{a:rangeOf(H,o)}:o);
  const used=new Uint8Array(52),base=new Uint8Array(52);hero.forEach(c=>base[c]=1);board.forEach(c=>base[c]=1);
  const need=5-board.length,deck=[];
  let win=0;
  for(let it=0;it<iters;it++){
    used.set(base);const oh=[];
    for(const sp of specs){
      const list=sp.b&&rand()<sp.beta?sp.b:sp.a;let k=-1;
      for(let t=0;t<40;t++){const j=list[Math.floor(rand()*list.length)];if(!used[H.c1[j]]&&!used[H.c2[j]]){k=j;break}}
      if(k<0)for(let j=0;j<H.n;j++)if(!used[H.c1[j]]&&!used[H.c2[j]]){k=j;break}
      used[H.c1[k]]=used[H.c2[k]]=1;oh.push(H.c1[k],H.c2[k]);
    }
    deck.length=0;for(let c=0;c<52;c++)if(!used[c])deck.push(c);
    const b=board.slice();
    for(let j=0;j<need;j++){const r=j+Math.floor(rand()*(deck.length-j)),t=deck[r];deck[r]=deck[j];deck[j]=t;b.push(t)}
    const me=rankHand(hero.concat(b));let ties=0,lost=false;
    for(let j=0;j<specs.length;j++){const v=rankHand([oh[2*j],oh[2*j+1]].concat(b));if(v>me){lost=true;break}if(v===me)ties++}
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
  // Both estimates use the same seed derived from the spot, so re-grading a decision is reproducible.
  const seed=hashSpot([...hero,99,...board,98,...opps.map(q=>q.line||0),97,pot,toCall,g.currentBet,p.stack]);
  /* Ranges: what each opponent holds now, and what they would continue with against a raise.
     Someone who bet this street holds value (the top of their range on this board) or, as
     often as their bet size makes a bluff break even, anything from their range. Against a
     raise, the opponent keeps the strongest part of that range and folds the rest. */
  const H=holdings(hero,board),vshare=VALUE_SHARE[board.length]||1;
  const ranges=opps.map(q=>{
    const all=rangeOf(H,RANGE[q.line||0]),aggr=board.length>0&&q.line===2&&q.bet>0&&q.bet>=g.currentBet&&toCall>0;
    return{all,aggr,now:aggr?{a:topOf(H,all,vshare),b:all,beta:Math.min(.45,q.bet/(pot+q.bet))}:{a:all}};
  });
  const eqCache=new Map(),rnd=()=>mulberry32(seed);
  const eqVs=(key,specs)=>{if(!eqCache.has(key))eqCache.set(key,equity(hero,board,specs,iters,rnd(),H));return eqCache.get(key)};
  const eq=opps.length?eqVs('now',ranges.map(r=>r.now)):1;
  const maxOppTotal=Math.max(0,...opps.map(q=>q.bet+q.stack));
  const raiseOpt=T=>{
    const actors=opps.filter(q=>!q.allin);
    const effT=Math.max(g.currentBet,Math.min(T,maxOppTotal));
    const effA=Math.max(toCall,effT-p.bet);
    let F=actors.length&&!opps.some(q=>q.allin)?1:0,callerB=0;
    const fr=opps.map((q,j)=>{
      if(q.allin)return 1;
      const B=Math.max(0,Math.min(effT-q.bet,q.stack)),f=foldShare(B,pot,q.line);
      F*=f;callerB=Math.max(callerB,B);return(1-f)*(ranges[j].aggr?vshare:1);
    });
    const eqC=opps.length?eqVs(fr.map(x=>x.toFixed(3)).join(),fr.map((x,j)=>x>=1?ranges[j].now:{a:topOf(H,ranges[j].all,x)})):1;
    const ev=F*pot+(1-F)*(eqC*(pot+effA+callerB)-effA);
    return{type:'raise',T,ev,eqC,label:T>=maxTotal?`All-in ${T}`:g.currentBet===0?`Bet ${T}`:`Raise to ${T}`};
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
  return{i,opts,eq,toCall,callTo:g.currentBet,pot,bb,canRaise,raiseOpt,minTotal,maxTotal,hand:g.hand,street:g.street,book:board.length?null:preflopSpot(g,i,opps,bb,hero,toCall),
    madeCat:board.length?handCategory(rankHand(hero.concat(board))):0,boardCat:board.length?handCategory(rankHand(board)):0};
}

/* ---------- preflop book ----------
   Preflop, the equity model above can't see position or initiative (it would happily open-limp
   any hand that beats random cards), so decisions there are graded against standard 100 BB
   charts instead: open-raise or fold by seat, 3-bet / call / fold against one raise, and only
   the top of the range against a 3-bet or more. Short stacks (15 BB or less) are push-or-fold
   spots where the chip-EV model is the book, so those keep the EV grade. */
function preflopSpot(g,i,opps,bb,hero,toCall){
  const p=g.players[i],n=g.players.length,dealt=k=>g.players[k].hole&&g.players[k].hole.length;
  const raisers=opps.filter(q=>q.line===2).length+(p.line===2?1:0);
  const shove=opps.find(q=>q.allin&&q.line===2);
  // Seats in preflop acting order (first to act ... big blind), when the table says where the blinds are.
  let order=null;
  if(Number.isInteger(g.bbSeat)&&g.bbSeat>=0&&g.bbSeat<n&&dealt(g.bbSeat)){order=[];for(let k=1;k<=n;k++){const j=(g.bbSeat+k)%n;if(dealt(j))order.push(j)}}
  // Blinds post without a voluntary line, so without seat info a line-0 player with chips in is a blind.
  const pos=order?(i===g.bbSeat?'BB':i===g.sbSeat?'SB':''):p.line?'':p.bet>=bb?'BB':p.bet>0?'SB':'';
  const hu=g.players.filter((q,k)=>dealt(k)).length===2;
  // How wide the single raiser opens from their seat; a middle seat when we can't tell.
  let openTier=5;const opener=opps.filter(q=>q.line===2);
  if(order&&opener.length===1){const k=g.players.indexOf(opener[0]),at=order.indexOf(k);if(at>=0)openTier=rfiTier(order.length-1-at,hu,k===g.sbSeat)}
  return{tier:handTier(hero[0],hero[1]),cls:handClass(hero[0],hero[1]),hu,raisers,pos,toCall,bb,openTier,
    limpers:raisers?0:opps.filter(q=>q.line===1).length,behind:opps.filter(q=>q.line===0).length,
    eff:Math.min(p.bet+p.stack,Math.max(0,...opps.map(q=>q.bet+q.stack)))/bb,
    size:g.currentBet/bb,shove:shove?shove.bet/bb:0,currentBet:g.currentBet,heroBet:p.bet,stack:p.stack};
}
// Highest tier that opens from a seat with `behind` players still to act (blinds included).
const rfiTier=(behind,hu,sb)=>hu?8:sb||behind<=2?7:behind===3?6:behind===4?5:behind===5?4:behind===6?3:2;
/* The book's continuing windows for this spot: tiers [lo,hi] where raising or calling is the
   book play. `main` is the primary action where both windows cover a hand; `weakCall` marks a
   call the book allows but rates below the alternatives. Folding is the book everywhere else. */
function bookWindows(b){
  const W={raise:null,call:null,check:false,main:'raise',weakCall:false,spot:''};
  const hu=b.hu,Ro=b.openTier,bbs=x=>+x.toFixed(1)+' BB';
  if(b.shove>15){ // A deep all-in: continue with the top of the range only.
    W.call=[0,b.shove>40?0:1];W.main='call';W.spot=`facing a ${bbs(b.shove)} all-in`;
  }else if(b.raisers===0&&b.pos==='BB'){ // Big blind option: check, or raise for value over limpers.
    W.check=true;W.raise=[0,b.limpers>1?1:2];W.main='check';W.spot='in the big blind with the option';
  }else if(b.raisers===0){
    const R=rfiTier(b.behind,hu,b.pos==='SB');
    if(b.limpers){ // Isolate with the stronger part of the opening range; edge hands may over-limp.
      W.raise=[0,Math.max(0,R-1)];W.call=[R,R];W.spot=`after ${b.limpers} limp${b.limpers>1?'s':''}`;
    }else{
      W.raise=[0,R];
      if(b.pos==='SB'&&!hu){W.call=[3,8];W.weakCall=true}
      W.spot=hu?'first in heads-up':b.pos==='SB'?'first in from the small blind':`first in with ${b.behind} players behind`;
    }
  }else if(b.raisers===1&&b.pos==='BB'){ // Closing the action at a discount: defend wider against smaller raises and wider openers.
    const hi=b.size<=2.5?Math.min(7,Ro+2):b.size<=3.5?Math.min(6,Ro+1):b.size<=5?Math.min(4,Ro):b.size<=8?2:1;
    W.raise=[0,Ro>=6?2:1];W.call=[1,Math.max(1,hi)];W.spot=`in the big blind against a raise to ${bbs(b.size)}`;
  }else if(b.raisers===1&&b.pos==='SB'){ // Out of position with the big blind behind: 3-bet or fold, flatting is weaker.
    W.raise=[0,Ro>=6?3:2];W.call=[1,2];W.weakCall=true;W.spot=`in the small blind against a raise to ${bbs(b.size)}`;
  }else if(b.raisers===1){ // Cold-calling: tighter against early openers and bigger raises.
    const hi=Math.max(1,Math.min(4,Math.max(2,Ro-1))-(b.size>5?2:b.size>3.5?1:0));
    W.raise=[0,Ro>=6?2:1];W.call=[1,hi];W.spot=`against a raise to ${bbs(b.size)}`;
  }else if(b.raisers===2){
    W.raise=[0,0];W.call=[0,1];W.spot='against a 3-bet';
  }else{
    W.raise=[0,0];W.call=[0,0];W.main='call';W.spot='against a 4-bet or more';
  }
  return W;
}
const PRE_RATIO={Best:0,Excellent:.02,Good:.05,Inaccuracy:.11,Mistake:.22,Blunder:.45};
const worse=(a,b)=>LABELS.indexOf(a)>LABELS.indexOf(b)?a:b;
function gradePreflop(A,type,amount){
  const b=A.book,W=bookWindows(b),t=b.tier,premium=b.cls==='AA'||b.cls==='KK';
  const inW=w=>!!w&&t>=w[0]&&t<=w[1];
  const top=Math.max(W.raise?W.raise[1]:-1,W.call?W.call[1]:-1);
  const share=x=>x/Math.max(1,b.stack+b.heroBet);
  const bookAct=inW(W.raise)&&(W.main==='raise'||!inW(W.call)&&!W.check)?'raise':inW(W.call)&&!W.weakCall?'call':W.check?'check':inW(W.raise)?'raise':'fold';
  let label;
  if(type==='fold'){
    if(W.check)label=t<=2?'Blunder':'Mistake'; // Folding when checking is free.
    else if(t>top)label='Best';
    else if(premium)label='Blunder';
    else label=t<=1||top-t>=3?'Mistake':t===top?'Good':'Inaccuracy';
  }else if(type!=='raise'&&A.toCall===0){ // Check
    label=inW(W.raise)?(t===0?'Inaccuracy':'Good'):'Best';
  }else if(type==='raise'){
    if(inW(W.raise))label=W.main==='raise'||!inW(W.call)?'Best':'Excellent';
    else{
      const d=t-(W.raise?W.raise[1]:-2);
      label=d===1?'Good':d===2?'Inaccuracy':'Mistake';
      if(share(amount)>=.5&&b.eff>25)label='Blunder'; // Jamming a deep stack with a hand outside the range.
    }
    label=worse(label,sizeCap(b,amount,t));
  }else{ // Call, or limp when nobody has raised
    if(inW(W.call))label=W.weakCall?'Good':W.main==='call'||!inW(W.raise)?'Best':'Excellent';
    else if(inW(W.raise))label='Inaccuracy'; // Too strong to just call: the book raises.
    else{
      const d=t-top;
      label=d<=1?'Inaccuracy':'Mistake';
      if(d>=2&&share(A.toCall)>=.25)label='Blunder';
    }
  }
  return{label,bookAct,W};
}
// Raise sizes the book uses: opens 2–3.5 BB (+1 per limper), 3-bets 2.5–5x the raise, 4-bets 2–3x.
// A size well outside that still gets the hand right but caps the grade.
function sizeCap(b,T,t){
  const x=T/b.bb,allin=T>=b.heroBet+b.stack;
  if(allin)return b.eff<=25||b.raisers>=2&&b.eff<=60||b.raisers>=3?'Best':t===0?'Inaccuracy':'Mistake'; // Jamming deep wastes a strong hand and risks the stack with the rest.
  if(b.raisers===0){
    if(b.pos==='BB'){const lo=2.5+b.limpers,hi=5+b.limpers;return x>=lo&&x<=hi?'Best':x>=2&&x<=hi+3?'Good':'Inaccuracy'}
    const lo=2+b.limpers,hi=(b.pos==='SB'||b.hu?4:3.5)+b.limpers;
    return x>=lo&&x<=hi?'Best':x<=hi+2?'Good':'Inaccuracy';
  }
  const m=T/Math.max(1,b.currentBet),[lo,hi]=b.raisers===1?[2.5,5]:[2,3];
  return m>=lo&&m<=hi?'Best':m>=lo-.5&&m<=hi+1.5?'Good':'Inaccuracy';
}
// Book raise size for a preflop spot, as a raise-to total.
function bookSize(A){
  const b=A.book,x=b.raisers===0?(b.pos==='BB'?3.5+b.limpers:2.5+b.limpers)*b.bb:b.raisers===1?3*b.currentBet:b.raisers===2?2.3*b.currentBet:A.maxTotal;
  return Math.max(A.minTotal,Math.min(A.maxTotal,Math.round(x)));
}
/* EV loss as a share of the pot → grade. "Best" means the top option (within Monte Carlo noise);
   each step after that is a real, measurable giveaway. */
const evLabel=r=>r<=.01?'Best':r<=.03?'Excellent':r<=.07?'Good':r<=.15?'Inaccuracy':r<=.3?'Mistake':'Blunder';
function grade(A,type,amount){
  let chosen;
  if(type==='raise')chosen=A.opts.find(o=>o.type==='raise'&&o.T===amount)||A.raiseOpt(amount);
  else if(type==='fold')chosen=A.opts[0];
  else chosen=A.opts[1];
  const denom=Math.max(A.pot+A.toCall,2*A.bb),weight=1+Math.log(1+A.pot/A.bb);
  const pct=x=>Math.round(x*100)+'%';
  if(A.book&&A.book.eff>15){
    const {label,bookAct,W}=gradePreflop(A,type,amount),ratio=PRE_RATIO[label];
    const bestLabel=bookAct==='raise'?`Raise to ${bookSize(A)}`:bookAct==='call'?`Call ${A.toCall}`:bookAct==='check'?'Check':'Fold';
    const offSize=type==='raise'&&bookAct==='raise'&&sizeCap(A.book,amount,A.book.tier)!=='Best';
    const verdict=label==='Best'?`${chosen.label} is the book play.`:offSize?`Raising is right, but the book size is about ${bookSize(A)}.`:label==='Excellent'?`${chosen.label} is sound; the book's first choice is ${bestLabel.toLowerCase()}.`:`The book play is ${bestLabel.toLowerCase()}.`;
    return{label,glyph:GLYPH[label],acc:100*Math.exp(-2.5*ratio),weight,lossBB:ratio*denom/A.bb,chosen:chosen.label,best:bestLabel,eq:A.eq,
      text:`Preflop chart, ${A.book.cls} ${W.spot}. ${verdict}`,hand:A.hand,street:A.street};
  }
  const best=A.opts.concat(chosen).reduce((a,b)=>b.ev>a.ev?b:a);
  let loss=Math.max(0,best.ev-chosen.ev);
  // Between two standard sizes (a third of the pot to pot-sized) the model's preference is
  // within its own error, so a bet or raise of a standard size only loses what exceeds 5% of the pot.
  if(chosen.type==='raise'&&best.type==='raise'&&chosen.T<A.maxTotal&&best.T<A.maxTotal){
    const share=x=>(x-A.callTo)/(A.pot+A.toCall);
    if(share(chosen.T)>=.3&&share(chosen.T)<=1.1)loss=Math.max(0,loss-.05*denom);
  }
  const ratio=loss/denom,lossBB=loss/A.bb;
  let label=evLabel(ratio);
  // Brilliant: the clearly best play (every other kind of action loses 5%+ of the pot) in a spot most players get wrong.
  if(label==='Best'&&loss<1e-9&&A.pot>=6*A.bb){
    const passive=A.opts[1].ev,next=Math.max(...A.opts.filter(o=>o.type!==chosen.type).map(o=>o.ev));
    if(chosen.ev-next>=.05*denom){
      if(chosen.type==='call'&&A.toCall>=A.pot/3&&A.eq<.4)label='Brilliant';
      else if(chosen.type==='raise'&&A.eq<.25&&chosen.ev>0&&chosen.ev-passive>=.1*denom)label='Brilliant';
      else if(chosen.type==='fold'&&A.toCall>0&&(A.madeCat>=3&&A.madeCat>A.boardCat||A.madeCat===2&&A.boardCat===0)&&A.eq>=.1&&passive<=-.1*denom)label='Brilliant'; // Trips or better, or two pair from both hole cards: not a hand the board gives everyone.
    }
  }
  const acc=100*Math.exp(-2.5*ratio);
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

// Ranked leagues: fixed 350-point bands. All accounts start at zero displayed Elo in Prospect after a one-time season reset.
const LEAGUES=[['Prospect',0,350,'prospect'],['Challenger',350,700,'challenger'],['Elite',700,1050,'elite'],['Master',1050,1400,'master'],['Grandmaster',1400,1750,'grandmaster'],['Champion',1750,Infinity,'champion']];
const BAND=350;
function tier(r){const t=LEAGUES.find(([,lo,hi])=>r>=lo&&r<hi)||LEAGUES[0];const lo=t[1]||t[2]-BAND,hi=t[2]===Infinity?lo+BAND:t[2];return{name:t[0],key:t[3],lo,progress:Math.max(0,Math.min(1,(r-lo)/(hi-lo))),next:t[2]===Infinity?null:t[2]}}

root.RivlRating={GRADE_ITERS:1500,mulberry32,toInt,rankHand,handCategory,handTier,handClass,equity,analyze,grade,chooseBot,glicko,recordMatch,matchAccuracy,store,save,resetLadder,tier,LEAGUES,LABELS,GLYPH,BOTS,W_PLACE,W_DEC};
})(typeof window!=='undefined'?window:globalThis);
