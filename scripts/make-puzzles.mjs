// Builds worker/puzzles.js: one graded poker decision per day, the same for everyone.
// Each spot is a heads-up single-raised pot, 100 BB deep: you defend the big blind and face a c-bet or barrel,
// or you opened and the big blind check-raises or leads into you. Hands come from real opening and defending
// ranges. Fold, call and raise are graded ahead of time by the same analysis that grades Ranked (rating.js), at
// many more samples than a live table can afford. A spot is kept only when one answer is clearly right, and the
// difficulty follows the week: easy on Monday and Tuesday, medium midweek, hard from Friday.
// Puzzle #1 was already live when this generator was rewritten, so it keeps its spot.
// Run: node scripts/make-puzzles.mjs [days]   (deterministic: the same input always builds the same file)
import {writeFileSync} from 'node:fs';
import '../worker/grading.js';
const R=globalThis.RivlRating;
export const START='2026-10-20';
const DAYS=Number(process.argv[2])||366,ITERS=12000,QUICK=1500,BB=100,STACK=100*BB;
const RANKS='23456789TJQKA',SUITS='♠♥♦♣',RANK_NAMES=['2','3','4','5','6','7','8','9','10','jack','queen','king','ace'];
const PLURAL=['2s','3s','4s','5s','6s','7s','8s','9s','10s','jacks','queens','kings','aces'];
const DECK=[...RANKS].flatMap(r=>[...SUITS].map(s=>r+s));
const GOOD=new Set(['Brilliant','Best','Excellent']),CLEAR=new Set(['Inaccuracy','Mistake','Blunder']);
const STREETS=['Flop','Turn','River'];
const round=x=>Math.max(BB/2,Math.round(x/(BB/2))*(BB/2));
const cap=t=>t[0].toUpperCase()+t.slice(1);
const bb=x=>`${+(x/BB).toFixed(1)} BB`;
const pct=x=>Math.round(x*100)+'%';
const I=c=>R.toInt(c);
const tier=h=>R.handTier(I(h[0]),I(h[1]));

/* ---------- the spot ---------- */
// kind: 'barrel' (you defend the big blind; the opener bets into you), 'xr' (you opened and c-bet; the big
// blind check-raises), 'lead' (you opened; the big blind bets into you on the turn or river).
function spot(rand){
  const pick=a=>a[Math.floor(rand()*a.length)],chance=p=>rand()<p;
  const deck=DECK.slice();for(let i=deck.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]]}
  const hero=[deck.pop(),deck.pop()];
  const r=rand(),kind=r<.5?'barrel':r<.75?'xr':'lead';
  const seat=pick(['the button','the cutoff']),seatPos=seat==='the button'?'BTN':'CO';
  const ip=kind!=='barrel';
  // Real ranges: the button opens the top ~48% (tiers 0–7), the cutoff ~33% (0–6); the big blind flats tiers 3–7
  // and 3-bets the strongest hands, so those never reach a single-raised pot.
  const t=tier(hero);
  if(ip?t>(seatPos==='BTN'?7:6):t<3||t>7)return null;
  const street=kind==='barrel'?pick([0,0,1,1,1,2,2,2]):kind==='xr'?pick([0,0,0,1,1]):pick([1,1,2,2,2]);
  const board=deck.splice(0,3+street);
  const vName=ip?'the big blind':seat;
  let pot=BB/2+2*2.5*BB,stack=STACK-2.5*BB;
  const cards=s=>board.slice(s?2+s:0,3+s).join(' ');
  const story=[ip?`You open to 2.5 BB on ${seat}. The big blind calls.`:`${cap(seat)} opens to 2.5 BB. You call in the big blind.`];
  for(let s=0;s<street;s++){
    if(chance(ip?.35:.3)){story.push(`${STREETS[s]} ${cards(s)}: checked through.`);continue}
    const b=round(pot*pick(s?[1/2,2/3,3/4]:[1/3,1/2,2/3]));
    story.push(ip?`${STREETS[s]} ${cards(s)}: the big blind checks, you bet ${bb(b)}, they call.`:`${STREETS[s]} ${cards(s)}: you check, ${vName} bets ${bb(b)}, you call.`);
    pot+=2*b;stack-=b;
  }
  let heroBet=0,bet,line;
  if(kind==='xr'){
    heroBet=round(pot*pick([1/3,1/2,2/3]));
    bet=Math.min(stack,round(heroBet*pick([3,3.5,4])));
    line=`${STREETS[street]} ${cards(street)}: the big blind checks, you bet ${bb(heroBet)}, the big blind raises to ${bb(bet)}.`;
  }else{
    const sizes=kind==='lead'?[1/3,1/2,2/3,3/4,1]:[[1/3,1/2,2/3,3/4],[1/2,2/3,3/4,1],[1/2,2/3,3/4,1,1.25]][street];
    bet=Math.min(stack,round(pot*pick(sizes)));
    line=kind==='lead'?`${STREETS[street]} ${cards(street)}: the big blind bets ${bb(bet)} into ${bb(pot)}.`:`${STREETS[street]} ${cards(street)}: you check, ${vName} bets ${bb(bet)} into ${bb(pot)}.`;
  }
  story.push(line);
  // Your raise: about 3x a bet, 2.5x a raise; all-in once that commits most of the stack anyway.
  let raiseTo=round(kind==='xr'?bet*2.5:Math.max(3*bet,bet+pot*.6));
  if(raiseTo>=stack*.6)raiseTo=stack;
  return {kind,hero,board,street:STREETS[street],pot,heroBet,bet,stack,raiseTo,position:ip?'IP':'OOP',
    heroPos:ip?seatPos:'BB',villainPos:ip?'BB':seatPos,villain:vName,story,size:bet/(pot+heroBet)};
}

/* ---------- describing your hand ---------- */
function describe(hero,board){
  const h=hero.map(I),b=board.map(I),all=h.concat(b),v=R.rankHand(all),cat=R.handCategory(v),bcat=R.handCategory(R.rankHand(b));
  const hr=h.map(c=>c>>2),br=b.map(c=>c>>2).sort((x,y)=>y-x),top=br[0],kick=k=>k>=10?'a strong kicker':k>=7?'a medium kicker':'a weak kicker';
  const hasRank=r=>hr.includes(r),boardHas=r=>br.includes(r);
  let made;
  if(cat===1){
    const p=Math.floor(v/65536)%16;
    if(!hasRank(p))made=`no pair of your own (${RANK_NAMES[Math.max(...hr)]}-high; the pair is on the board)`;
    else if(hr[0]===hr[1])made=p>top?`an overpair (${PLURAL[p]})`:p<br[br.length-1]?`a pocket pair below the board (${PLURAL[p]})`:`a middle pocket pair (${PLURAL[p]})`;
    else if(p===top){const other=hr[0]===p?hr[1]:hr[0];made=`top pair (${PLURAL[p]}) with ${kick(other)}`}
    else made=p===br[1]?`second pair (${PLURAL[p]})`:p===br[2]?`third pair (${PLURAL[p]})`:`a low pair (${PLURAL[p]})`;
  }else if(cat===0)made=`no pair, ${RANK_NAMES[Math.max(...hr)]}-high`;
  else if(cat===2)made=bcat===1&&!(hasRank(Math.floor(v/65536)%16)&&hasRank(Math.floor(v/4096)%16))?'two pair, one of them on the board':'two pair';
  else if(cat===3){const tr=Math.floor(v/65536)%16,other=hr[0]===tr?hr[1]:hr[0];made=hr[0]===hr[1]&&boardHas(hr[0])?`a set of ${PLURAL[hr[0]]}`:hasRank(tr)?`trips (${PLURAL[tr]}) with ${kick(other)}`:`no hand of your own (the three ${PLURAL[tr]} are on the board)`}
  else made=['','','','','a straight','a flush','a full house','four of a kind','a straight flush'][cat];
  if(cat>=4&&bcat===cat)made+=' that is already on the board';
  // Draws, before the river, when you don't already have a straight or better.
  const draws=[];
  if(board.length<5&&cat<4){
    const suits=[0,0,0,0];all.forEach(c=>suits[c&3]++);
    const fs=suits.findIndex(n=>n===4);if(fs>=0&&h.some(c=>(c&3)===fs))draws.push('a flush draw');
    const mask=all.reduce((m,c)=>m|1<<(c>>2),0),has=m=>(r=>r===-1?(m>>12)&1:(m>>r)&1);
    let outs=0;
    for(let r=0;r<13;r++){if((mask>>r)&1)continue;const m=mask|1<<r,need=hr;
      for(let lo=-1;lo<=8;lo++){const run=[0,1,2,3,4].map(k=>lo+k);if(run.every(x=>has(m)(x))&&run.some(x=>need.includes(x<0?12:x))&&run.includes(r)){outs++;break}}}
    if(outs>=2)draws.push('an open-ended straight draw');else if(outs===1)draws.push('a gutshot straight draw');
  }
  return {made,draws,cat,text:`You have ${made}${draws.length?(cat>0?', plus ':' but ')+draws.join(' and '):''}.`};
}

// What their bet usually means, by kind of action and size.
function rangeLine(s){
  const who=s.villainPos==='BB'?'The big blind':s.villain==='the button'?'The button':'The cutoff';
  if(s.kind==='xr')return `${who}'s check-raise is weighted toward strong hands (two pair and sets) and good draws, with a few bluffs.`;
  if(s.size>=1)return s.street==='River'?`A bet this big on the river is polarized: strong hands or bluffs, rarely anything in between.`:`A pot-sized bet means a strong range: big made hands and strong draws, with some bluffs.`;
  if(s.size<=.4)return `A small bet like this comes from a wide range: many medium hands, draws and some air.`;
  if(s.kind==='lead')return s.street==='River'?`Leading the river into the player who raised before the flop usually means a hand that improved, or a missed draw turned into a bluff.`:`Leading into the player who raised before the flop usually means a hand that improved on this card, or a draw.`;
  return s.street==='River'?`A river bet this size is mostly made hands that beat a lot, plus some missed draws.`:`This bet is a mix of value hands, draws and some air.`;
}

/* ---------- grading ---------- */
function grade(s,iters=ITERS){
  const potNow=s.pot+s.heroBet+s.bet,toCall=s.bet-s.heroBet;
  const state={pot:potNow,currentBet:s.bet,minRaise:Math.max(s.bet-s.heroBet,BB),bb:BB,board:s.board,hand:1,street:s.street,
    players:[{hole:s.hero,bet:s.heroBet,stack:s.stack-s.heroBet,folded:false,allin:false,line:s.position==='IP'?2:1},
             {hole:['?','?'],bet:s.bet,stack:s.stack-s.bet,folded:false,allin:s.stack===s.bet,line:2}]};
  const A=R.analyze(state,0,iters),allIn=s.raiseTo>=s.stack;
  const g={fold:R.grade(A,'fold',0),call:R.grade(A,'call',0)};
  const canRaise=A.canRaise&&s.raiseTo>s.bet;
  let raise=null;
  if(canRaise){
    g.raise=R.grade(A,'raise',s.raiseTo);
    const o=A.raiseOpt(s.raiseTo),B=Math.min(s.raiseTo-s.bet,s.stack-s.bet);
    // The same fold rate the analysis uses for a player who bet (rating.js foldShare, line 2).
    const fold=s.stack===s.bet?0:Math.min(.9,Math.max(.05,1-A.pot/(A.pot+B||1)*1.6));
    raise={ev:o.ev,fold,eqC:o.eqC};
  }
  const grades={};
  for(const [k,x] of Object.entries(g))grades[k]={label:x.label,glyph:x.glyph,lossBB:+x.lossBB.toFixed(1)};
  const need=toCall/(potNow+toCall),callEv=A.opts[1].ev;
  grades.fold.ev=0;grades.call.ev=+(callEv/BB).toFixed(1);if(raise)grades.raise.ev=+(raise.ev/BB).toFixed(1);
  grades.fold.note='Gives up the pot. Nothing more to lose.';
  grades.call.note=`Wins the pot about ${pct(A.eq)} of the time; you need ${pct(need)}.`;
  if(raise)grades.raise.note=raise.fold?`They fold about ${pct(raise.fold)} of the time. When they call, you have about ${pct(raise.eqC)}.`:`They are all-in already, so a raise only calls.`;
  const label=s.kind==='xr'?'Re-raise':s.position==='OOP'?'Check-raise':'Raise';
  return {A,grades,raise,need,eq:A.eq,toCall,
    raiseLabel:canRaise?(allIn?`All-in ${bb(s.stack)}`:`${label} to ${bb(s.raiseTo)}`):null,callLabel:`Call ${bb(toCall)}`};
}

// The lesson: why the best answer is best, in plain words.
function lesson(best,r,hand){
  const eq=r.eq,need=r.need,rz=r.raise;
  if(best==='fold')return eq<need?`At ${pct(eq)} you are short of the ${pct(need)} a call needs${rz?`, and raising doesn't fold out enough of their range (about ${pct(rz.fold)}) to work as a bluff`:''}. Let it go.`
    :`Your raw equity looks close, but you win less than that share of the pot: you rarely get paid when ahead, and you often face another bet. Folding loses least.`;
  if(best==='call')return eq>=need?`You have the ${pct(need)} a call needs (about ${pct(eq)}). Raising is worse: ${rz&&rz.eqC<.5?`the hands that call a raise have you beat (you'd have about ${pct(rz.eqC)})`:'it folds out the hands you beat'}, so keep their bluffs in and call.`
    :`Your equity alone (${pct(eq)}) is a little short, but the price is right once you count the pot you win when they are bluffing. Raising risks too much; calling is best.`;
  return rz&&rz.eqC>=.5?`You are ahead of most hands that would call a raise (about ${pct(rz.eqC)} when called), so raise for value and build the pot while they are willing to put chips in.`
    :hand.draws.length?`With ${hand.draws.join(' and ')} you win often when called, and they fold about ${pct(rz.fold)} of the time. Raising wins the pot more ways than calling.`
    :`They fold about ${pct(rz.fold)} of the time, which is enough for a raise to profit even though you are behind when called (about ${pct(rz.eqC)}).`;
}

// A spot is a good puzzle when exactly one answer grades well and the others are clear errors.
function clearAnswer(grades){
  const keys=Object.keys(grades),good=keys.filter(k=>GOOD.has(grades[k].label));
  if(good.length!==1||keys.length<3)return null;
  return keys.every(k=>k===good[0]||CLEAR.has(grades[k].label))?good[0]:null;
}
// Difficulty is how much the second-best answer gives up: a big gap is easy to see, a small one is hard.
const difficultyOf=(grades,best)=>{const m=Math.min(...Object.keys(grades).filter(k=>k!==best).map(k=>grades[k].lossBB));return m<1?null:m>=6?'Easy':m>=2.5?'Medium':'Hard'};
const weekdayTarget=d=>['Hard','Easy','Easy','Medium','Medium','Hard','Hard'][new Date(Date.parse(START+'T00:00:00Z')+d*86400000).getUTCDay()];

function build(s,best,r,difficulty,n){
  const hand=describe(s.hero,s.board);
  return {n,kind:s.kind,hero:s.hero,board:s.board,street:s.street,pot:s.pot,heroBet:s.heroBet,bet:s.bet,stack:s.stack,raiseTo:s.raiseTo,
    position:s.position,heroPos:s.heroPos,villainPos:s.villainPos,villain:s.villain,story:s.story,difficulty,
    raiseLabel:r.raiseLabel,callLabel:r.callLabel,eq:+r.eq.toFixed(3),need:+r.need.toFixed(3),best,grades:r.grades,
    why:{hand:hand.text,range:rangeLine(s),lesson:lesson(best,r,hand)}};
}

/* ---------- a year of puzzles ---------- */
const puzzles=[];
// #1 was live before this rewrite; keep its spot (and answer) so today's answers stay valid.
{
  const s={kind:'lead',hero:['2♣','K♥'],board:['K♦','3♦','Q♦'],street:'Flop',pot:550,heroBet:0,bet:550,stack:9750,raiseTo:1650,position:'IP',
    heroPos:'BTN',villainPos:'BB',villain:'the big blind',story:['You open to 2.5 BB on the button. The big blind calls.','Flop K♦ 3♦ Q♦: the big blind bets 5.5 BB into 5.5 BB.'],size:1};
  const r=grade(s),best=clearAnswer(r.grades);
  if(best!=='call')throw Error('Puzzle #1 changed its answer');
  puzzles.push(build(s,best,r,difficultyOf(r.grades,best),1));
}
const rand=R.mulberry32(20261021);
const want=['call','fold','raise'];
for(let d=1;d<DAYS;d++){
  // Rotate the answer and follow the week's difficulty; relax the difficulty, then the answer, if a match is rare.
  let made=null;
  const level=weekdayTarget(d);
  for(let attempt=0;!made&&attempt<8000;attempt++){
    const s=spot(rand);if(!s)continue;
    // A quick low-sample pass screens candidates; a kept spot is graded again at full samples and must still qualify.
    const ok=r=>{const best=clearAnswer(r.grades);if(!best||best==='fold'&&r.eq<.1||r.eq>.92)return null; // Nothing to think about.
      const difficulty=difficultyOf(r.grades,best);if(!difficulty||attempt<5000&&difficulty!==level||attempt<7000&&best!==want[d%3])return null;return {best,difficulty}};
    if(!ok(grade(s,QUICK)))continue;
    const r=grade(s),k=ok(r);if(!k)continue;
    made=build(s,k.best,r,k.difficulty,d+1);
  }
  if(!made)throw Error('No clear spot found for day '+(d+1));
  puzzles.push(made);
  if((d+1)%30===0)console.log('built',d+1);
}
const tally=key=>puzzles.reduce((m,p)=>(m[p[key]]=(m[p[key]]||0)+1,m),{});
writeFileSync(new URL('../worker/puzzles.js',import.meta.url),
`/* Generated by scripts/make-puzzles.mjs — do not edit by hand. One daily puzzle per day from ${START}.
   Answers: ${JSON.stringify(tally('best'))}. Difficulty: ${JSON.stringify(tally('difficulty'))}. */
export const PUZZLE_START='${START}';
export const PUZZLES=${JSON.stringify(puzzles)};
`);
console.log('Wrote',puzzles.length,'puzzles',tally('best'),tally('difficulty'),tally('kind'));
