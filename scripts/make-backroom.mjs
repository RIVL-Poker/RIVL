// Builds backroom-spots.js: the Back Room, a hidden set of 24 hand-picked decisions that most players get wrong.
// It opens from a secret door on the Support page (backroom.js). Each spot is written here by hand: the hand, the
// action so far and why the answer is right. The amounts in the story are worked out from the bet sizes, so the
// pot, the price and the story always agree. Fold, call and raise are graded by the same analysis as the daily
// puzzle and Ranked (scripts/make-puzzles.mjs → rating.js), at more samples than either. The build stops if a
// spot's answer isn't the one its write-up explains, or if another option is within 1 BB of it.
// Run: node scripts/make-backroom.mjs   (deterministic: the same input always builds the same file)
import {writeFileSync} from 'node:fs';
import {spotState} from './make-puzzles.mjs';
const R=globalThis.RivlRating;
const BB=100,ITERS=40000;
const round=x=>Math.max(BB/2,Math.round(x/(BB/2))*(BB/2));
const bb=x=>`${+(x/BB).toFixed(1)} BB`;
const pct=x=>Math.round(x*100)+'%';
const cap=t=>t[0].toUpperCase()+t.slice(1);
const NAME={BTN:'the button',CO:'the cutoff',BB:'the big blind'};
const AT={BTN:'on the button',CO:'on the cutoff',BB:'in the big blind'};
const STREETS=['Flop','Turn','River'];
const cards=t=>t.match(/../g);
const T=1/3,H=1/2,TT=2/3,TQ=3/4;

/* ---------- the spot, from its action ----------
   streets: one entry per street before the decision: 'x' (checked through), ['h',size] (you bet, they call) or
   ['v',size] (they bet, you call), sizes as a share of the pot. last: {bet:size} (they bet into you) or
   {xr:size, x} (you bet that share of the pot and they raise to x times it). */
function build(d){
  const depth=(d.depth||100)*BB,v=NAME[d.villainPos],V=cap(v),ip=d.heroPos!=='BB';
  // The small blind folds; its 0.5 BB is in the pot. So is the big blind's when neither player is in it.
  const dead=50+(d.heroPos!=='BB'&&d.villainPos!=='BB'?BB:0);
  const open=2.5*BB,put=d.threeBet?d.threeBet*BB:open;
  const story=[d.threeBet?`You open to 2.5 BB ${AT[d.heroPos]}. ${V} 3-bets to ${bb(put)}. You call.`
    :ip?`You open to 2.5 BB ${AT[d.heroPos]}. ${V} calls.`:`${V} opens to 2.5 BB. You call ${AT[d.heroPos]}.`];
  let pot=dead+2*put,stack=depth-put;
  const board=cards(d.board),n=board.length-3,dealt=s=>board.slice(s?2+s:0,3+s).join(' ');
  for(let s=0;s<n;s++){
    const a=d.streets[s];
    if(a==='x'){story.push(`${STREETS[s]} ${dealt(s)}: checked through.`);continue}
    const b=round(pot*a[1]);
    story.push(`${STREETS[s]} ${dealt(s)}: `+(a[0]==='v'?(ip?`${v} bets ${bb(b)}, you call.`:`you check, ${v} bets ${bb(b)}, you call.`)
      :ip?`${v} checks, you bet ${bb(b)}, they call.`:`you bet ${bb(b)}, ${v} calls.`));
    pot+=2*b;stack-=b;
  }
  const L=d.last,head=`${STREETS[n]} ${dealt(n)}: `;
  let heroBet=0,bet;
  if(L.bet!=null){
    bet=Math.min(stack,round(pot*L.bet));
    const what=bet>=stack?`moves all-in for ${bb(bet)}`:`bets ${bb(bet)}`;
    story.push(head+(ip?`${v} ${what} into ${bb(pot)}.`:`you check, ${v} ${what} into ${bb(pot)}.`));
  }else{
    heroBet=round(pot*L.xr);bet=Math.min(stack,round(heroBet*L.x));
    story.push(head+`${v} checks, you bet ${bb(heroBet)}, ${v} ${bet>=stack?`moves all-in for ${bb(bet)}`:`raises to ${bb(bet)}`}.`);
  }
  // Your raise: about 3x a bet, 2.5x a raise; all-in once that commits most of the stack anyway (as the daily puzzle).
  let raiseTo=round(heroBet?bet*2.5:Math.max(3*bet,bet+pot*.6));
  if(raiseTo>=stack*.6)raiseTo=stack;
  return {hero:cards(d.hero),board,street:STREETS[n],pot,heroBet,bet,stack,raiseTo,position:ip?'IP':'OOP',
    heroPos:d.heroPos,villainPos:d.villainPos,villain:v,story,size:bet/(pot+heroBet),depth:depth/BB,threeBet:!!d.threeBet};
}

/* ---------- the 24 spots, in the order they are played ----------
   title is shown before you answer, so it never gives the answer away; tag is shown after.
   In the write-ups {eq} is your equity now, {need} the share a call needs, {fold} how often they fold to your
   raise and {eqC} your equity when they call it, {loss} what the second-best option gives up. */
const SPOTS=[
 {id:'blocker',title:'Top pair vs a river check-raise',tag:'HERO CALL',answer:'call',
  hero:'A♥K♣',board:'5♣J♥K♦8♥Q♥',heroPos:'BTN',villainPos:'BB',streets:[['h',TT],['h',H]],last:{xr:TT,x:3.5},
  why:{hand:'You have top pair with the best kicker, and the A♥. With that card in your hand, nobody can hold the ace-high flush.',
   range:'A river check-raise once the third heart lands is flushes, straights and two pair, plus the hands that gave up on winning at showdown and turned into bluffs.',
   lesson:'You need {need} and have about {eq}, so you lose more often than you win and the call still makes money. Raising is the real blunder: only better hands call.'}},
 {id:'kk-wet',title:'Kings on a soaking-wet turn',tag:'BIG LAYDOWN',answer:'fold',
  hero:'K♠K♦',board:'9♥8♥6♣7♥',heroPos:'BTN',villainPos:'BB',streets:[['h',T]],last:{xr:TT,x:3},
  why:{hand:'You have an overpair, kings, with no heart. The board now reads 6-7-8-9 with three hearts: any 5 or 10 is a straight and any heart is a flush.',
   range:'A turn check-raise on this card is straights, flushes, sets and two pair, plus combo draws that are ahead of you anyway. Few hands you beat raise here.',
   lesson:'You have about {eq} and a call needs {need}, and there is still a river to come that is often bad news. Kings feel huge, but here they are a bluff catcher that rarely catches anything. Fold.'}},
 {id:'jam-k9',title:'Check-raised with a big draw',tag:'SEMI-BLUFF',answer:'raise',allIn:true,
  hero:'K♠9♠',board:'5♦Q♠J♠',heroPos:'CO',villainPos:'BB',depth:40,streets:[],last:{xr:TT,x:3.5},
  why:{hand:'You have the king-high flush draw and a gutshot: nine spades and three more tens make a flush or a straight, about 12 outs with two cards to come.',
   range:'A flop check-raise on Q-J-5 with two spades is two pair, sets and strong top pairs, but also plenty of draws that are behind yours.',
   lesson:'With 40 BB stacks, move all-in. They fold about {fold} of the time, and when they call you still win about {eqC}. Calling is fine but worse: you give up the fold equity and face another big bet on the turn.'}},
 {id:'eights',title:'Eights on a paired board',tag:'HERO CALL',answer:'call',
  hero:'8♦8♣',board:'J♥3♣2♥J♠7♦',heroPos:'CO',villainPos:'BB',streets:[['h',T],'x'],last:{bet:H},
  why:{hand:'You have pocket eights on a board with a pair of jacks. You beat bluffs, a 3, a 2 and smaller pairs, and little else.',
   range:'The big blind check-called the flop and led the river after the turn checked through. That line has a jack or a 7 sometimes, but also missed heart draws and hands like 6-5 and 5-4 taking a shot.',
   lesson:'You win about {eq} and need {need}. It doesn\'t feel like much of a hand, but at half the pot a pair that beats every bluff is enough. Call.'}},
 {id:'aces',title:'Pocket aces, four to a straight',tag:'BIG LAYDOWN',answer:'fold',
  hero:'A♥A♦',board:'8♣9♣T♦J♥2♣',heroPos:'BTN',villainPos:'BB',streets:[['h',T],['h',H]],last:{bet:1},
  why:{hand:'You have pocket aces, but the board reads 8-9-10-J: any queen or any 7 makes a straight, and the river 2♣ is the third club.',
   range:'The big blind called two bets on a board this connected, then bet the pot on the river. They hold straights, flushes, sets and two pair far more often than a bluff.',
   lesson:'Against that range you have about {eq} and need {need}. One pair, even aces, is close to the bottom of the hands that can call here. Fold.'}},
 {id:'65',title:'Bottom pair and a gutshot',tag:'CALL, DON\'T RAISE',answer:'call',
  hero:'6♦5♦',board:'9♦7♠2♣5♣',heroPos:'BTN',villainPos:'BB',streets:[['h',T]],last:{bet:H},
  why:{hand:'You have bottom pair, fives, plus a gutshot: an 8 makes 5-6-7-8-9. A 5 or a 6 on the river also improves you.',
   range:'A turn lead after check-calling the flop is a wide mix of pairs, draws and the odd two pair.',
   lesson:'You need {need} and have about {eq} with the river to come. That is enough to call half the pot. Raising would fold out the hands you beat and get called by the ones that beat you.'}},
 {id:'nfd-xr',title:'Nut flush draw on a monotone flop',tag:'SEMI-BLUFF',answer:'raise',
  hero:'A♣T♥',board:'3♣K♣5♣',heroPos:'BB',villainPos:'CO',streets:[],last:{bet:TQ},
  why:{hand:'You have the nut flush draw: with the A♣, any club makes you the best possible flush.',
   range:'A big c-bet on three clubs comes from made flushes, kings and draws, but also from many hands without a club that want the pot now.',
   lesson:'Check-raise. They fold about {fold} of the time, and when they call you still have about {eqC}. You never draw to a second-best flush, which is what makes this hand the one to raise with.'}},
 {id:'top-set',title:'Top set when the straight comes',tag:'BIG LAYDOWN',answer:'fold',
  hero:'K♠K♥',board:'2♦T♥K♦Q♠J♥',heroPos:'BTN',villainPos:'BB',streets:['x',['h',TT]],last:{xr:T,x:3},
  why:{hand:'You have top set, but the river J♥ puts K-Q-J-10 on the board: any ace makes broadway and any 9 makes a king-high straight.',
   range:'The big blind called your turn bet and check-raised the river. Hands like A-x, 9-x and Q-J that called the turn are exactly what this line looks like; bluffs are rare.',
   lesson:'You win about {eq} of the time and need {need}. Folding top set hurts, and it is the play.'}},
 {id:'qt-paired',title:'Top pair when the river pairs',tag:'HERO CALL',answer:'call',
  hero:'Q♣T♦',board:'T♠9♣5♦3♦9♥',heroPos:'BB',villainPos:'CO',depth:40,streets:[['v',T],['v',T]],last:{bet:TQ},
  why:{hand:'You have top pair, tens with a queen kicker, but the river 9♥ paired the board.',
   range:'The cutoff bet small on the flop and turn, then bigger on the river. That includes 9s and better tens, but also the diamond draws and straight draws (J-8, 8-7) that just missed.',
   lesson:'You need {need} and have about {eq}. The paired river looks scary, but there are enough missed draws in their range to call.'}},
 {id:'kt-xr',title:'30 BB to call with one pair',tag:'HERO CALL',answer:'call',
  hero:'K♦T♦',board:'5♣3♣4♥7♠T♣',heroPos:'BTN',villainPos:'BB',streets:[['h',H],['h',H]],last:{xr:H,x:3.5},
  why:{hand:'You have top pair, tens, with a king kicker. Any 6 has made a straight since the turn, and the river T♣ is the third club.',
   range:'The big blind check-called twice and then check-raised the river: straights, flushes and sets, plus a fair share of hands that missed and know you are capped.',
   lesson:'You need {need} and have about {eq}. Calling 30 BB with one pair hurts, but folding gives up {loss} BB on average. Call.'}},
 {id:'set88',title:'A set on 7-8-9-10',tag:'BIG LAYDOWN',answer:'fold',
  hero:'8♥8♠',board:'8♦7♦9♦T♣A♣',heroPos:'BTN',villainPos:'BB',streets:['x',['h',TT]],last:{bet:TT},
  why:{hand:'You flopped a set of eights, but the flop also came with three diamonds, and now 7-8-9-10 is on the board: any 6 or jack is a straight.',
   range:'The big blind checked the flop, called your turn bet and led the river. On this board that is mostly flushes and straights.',
   lesson:'At about {eq} you are short of the {need} a call needs. A set is a strong hand on most boards, but this board makes better hands easy to hold. Fold.'}},
 {id:'turn-raise',title:'The turn pairs the board',tag:'VALUE RAISE',answer:'raise',
  hero:'A♠3♣',board:'6♠3♠6♦2♠',heroPos:'BB',villainPos:'CO',streets:['x'],last:{bet:1},
  why:{hand:'You have two pair, sixes and threes, plus the nut flush draw: the A♠ with three spades on the board.',
   range:'The cutoff checked the flop, then bet the pot when the turn paired the six. That is sometimes a 6, but more often a hand trying to take the pot because the flop was checked.',
   lesson:'You are ahead of most of their range (about {eq}), and even a 6 has to sweat your flush draw. Raise: they fold about {fold} of the time, and when they call you have about {eqC}.'}},
 {id:'at',title:'Top pair, ten kicker, two barrels',tag:'HERO CALL',answer:'call',
  hero:'A♦T♣',board:'5♦K♥A♠9♥7♦',heroPos:'BB',villainPos:'CO',streets:['x',['v',TT]],last:{bet:TT},
  why:{hand:'You have top pair, aces, with a ten kicker.',
   range:'The cutoff checked the flop, then bet the turn and the river. Better aces bet like this, but so do the diamond and heart draws that missed and the straight draws the turn gave them.',
   lesson:'You need {need} and have about {eq}: behind their value, ahead of every bluff. Call; a raise only gets called by better.'}},
 {id:'jacks-xr',title:'Checked down, then check-raised',tag:'HERO CALL',answer:'call',
  hero:'J♣J♦',board:'2♦K♥4♣4♠6♥',heroPos:'CO',villainPos:'BB',streets:['x','x'],last:{xr:T,x:3.5},
  why:{hand:'You have pocket jacks under the king, on a paired board. Nobody showed strength on the flop or turn.',
   range:'A river check-raise after two checks is polarized: a king or a 4 that slow-played, or a hand that missed and read your small bet as weakness.',
   lesson:'You win about {eq} and need only {need}: your small bet keeps the price good. Call. Don\'t re-raise, because only better hands would call.'}},
 {id:'straight',title:'A straight vs an overbet',tag:'BIG LAYDOWN',answer:'fold',
  hero:'A♠3♥',board:'7♦6♦5♠4♦Q♦',heroPos:'CO',villainPos:'BB',streets:[['h',H],['h',H]],last:{bet:1.5},
  why:{hand:'You have a straight, 3 to 7, but the river Q♦ is the fourth diamond, and any 8 makes a higher straight.',
   range:'A bet of 1.5 times the pot on a four-flush board is polarized: a flush or a better straight, or a bluff.',
   lesson:'At about {eq} you are well short of the {need} this bet asks for. You only beat their bluffs, and a bet this big doesn\'t need many to work. Your straight is a bluff catcher here. Fold.'}},
 {id:'j8',title:'Eights when the queen pairs',tag:'HERO CALL',answer:'call',
  hero:'J♦8♥',board:'8♣5♠Q♠3♦Q♣',heroPos:'BB',villainPos:'CO',streets:['x',['v',H]],last:{bet:H},
  why:{hand:'You have a pair of eights with a jack kicker, and the river Q♣ paired the queen on the board.',
   range:'The cutoff checked the flop, bet the turn and bet half the pot again when the river paired. That is a queen or a 5 sometimes, but also the spade draws and overcards that missed.',
   lesson:'You need {need} and have about {eq}. The second queen makes it look like they have it, but it actually makes a queen less likely for them: one of the four is now on the board. Call.'}},
 {id:'ak-lead',title:'Top pair facing an overbet lead',tag:'VALUE RAISE',answer:'raise',
  hero:'A♠K♠',board:'K♦T♠J♣',heroPos:'CO',villainPos:'BB',streets:[],last:{bet:1.5},
  why:{hand:'You have top pair with the best kicker, a gutshot to the nut straight (any queen) and a backdoor flush draw.',
   range:'A big lead from the big blind on K-J-10 is two pair, sets and straights sometimes, but also queens with a draw and weaker kings that want to protect themselves.',
   lesson:'Raise. Even when they call you have about {eqC}, and they fold about {fold} of the time. Calling lets their draws see the turn at their price.'}},
 {id:'k4',title:'Top pair, no kicker',tag:'HERO CALL',answer:'call',
  hero:'K♣4♣',board:'9♠3♠K♥9♥7♦',heroPos:'BB',villainPos:'CO',streets:[['v',T],'x'],last:{bet:H},
  why:{hand:'You have top pair, kings, with a weak kicker, on a paired board.',
   range:'The cutoff bet the flop, checked the turn and bet half the pot on the river. A check on the turn usually means a medium hand or nothing, and the missed spade and heart draws bet the river as bluffs.',
   lesson:'You need {need} and have about {eq}. A weak kicker is still a king. Call.'}},
 {id:'aces-up',title:'Aces up vs a check-raise',tag:'HERO CALL',answer:'call',
  hero:'A♣5♠',board:'K♦4♠J♥A♠J♠',heroPos:'BTN',villainPos:'BB',streets:[['h',T],'x'],last:{xr:H,x:3},
  why:{hand:'You have two pair, aces and jacks (the jacks are on the board), with the board\'s king as your kicker.',
   range:'The river A♠ is the third spade. A check-raise here is flushes and full houses, plus bluffs: you checked the turn back, so they can represent almost anything.',
   lesson:'You need {need} and have about {eq}. You are behind most of their value, but you beat every bluff, and they bluff often enough. Call, and never re-raise: no worse hand calls.'}},
 {id:'bottom-set',title:'Bottom set, check-raised on the river',tag:'VALUE RAISE',answer:'raise',allIn:true,
  hero:'4♦4♠',board:'K♣J♦4♥7♣2♦',heroPos:'BTN',villainPos:'BB',streets:[['h',T],['h',H]],last:{xr:H,x:3},
  why:{hand:'You have a set of fours. Both flush draws missed and no straight is possible, so only a bigger set beats you.',
   range:'The big blind called two bets and check-raised the river: two pair and sets, plus the missed club and diamond draws turned into bluffs.',
   lesson:'You beat almost all of it (about {eq}). Don\'t just call: move all-in. Their two pair can\'t fold, and even when they call you win about {eqC}.'}},
 {id:'a7',title:'Two pair on a broadway board',tag:'HERO CALL',answer:'call',
  hero:'A♣7♣',board:'4♥A♥Q♣K♣K♠',heroPos:'BB',villainPos:'CO',streets:[['v',TT],['v',H]],last:{bet:H},
  why:{hand:'You have two pair, aces and kings (the kings are on the board), with the board\'s queen as your kicker.',
   range:'The cutoff bet every street. A king, J-10 or a full house beats you, but many of their bets are other aces that only split the pot with you, and draws that missed.',
   lesson:'You need {need} and have about {eq}, counting a split as half a win. Call.'}},
 {id:'jj-3bet',title:'Jacks vs a river shove',tag:'HERO CALL',answer:'call',
  hero:'J♦J♠',board:'8♥6♣2♠4♦Q♥',heroPos:'BTN',villainPos:'BB',threeBet:11,streets:[['v',T],['v',H]],last:{bet:1},
  why:{hand:'You have pocket jacks: an overpair until the river Q♥ put an overcard on the board.',
   range:'The big blind 3-bet before the flop and bet every street, so their range is strong: queens, kings and aces, but also hands like A-K and A-5 that missed and can only win by betting.',
   lesson:'You need {need} and have about {eq}. Plenty of their range beats you, but the shove comes from enough missed hands that folding gives up {loss} BB on average. Call.'}},
 {id:'boat',title:'A full house on the river',tag:'BIG LAYDOWN',answer:'fold',
  hero:'5♥5♣',board:'6♣6♠K♣5♦6♦',heroPos:'CO',villainPos:'BB',depth:40,streets:[['h',H],'x'],last:{bet:TQ},
  why:{hand:'You have a full house, sixes full of fives. It is the smallest full house this board allows.',
   range:'When the big blind leads the river after the turn checks through, it is usually a hand that beats you: any king (sixes full of kings), any pocket pair from sevens up, or the last six for four of a kind.',
   lesson:'You win about {eq} and a call needs {need}. Almost every hand that bets for value has you beat, and the bluffs are few. Folding a full house is the play most players never make.'}},
 {id:'acehigh',title:'Ace-high vs a check-raise',tag:'HERO CALL',answer:'call',
  hero:'A♠8♦',board:'7♦3♠3♦5♠5♣',heroPos:'BTN',villainPos:'BB',depth:60,streets:[['h',TT],['h',H]],last:{xr:T,x:3.5},
  why:{hand:'The board has two pair, fives and threes, so your ace plays: you have fives and threes with an ace kicker. You beat every hand that missed, and you split with any other ace.',
   range:'The big blind called your flop and turn bets, then check-raised a small river bet. Their value is a 7, a 5 or a 3, or a pocket pair from fours up; their bluffs are the busted diamond draws and big cards that missed.',
   lesson:'Calling a check-raise with ace-high sounds crazy. But with two pair on the board, every bluff loses to your ace. You win about {eq} and need {need}. Call.'}},
];

/* ---------- grading ----------
   Every raise size you can pick on the slider is graded, not just one: from the minimum raise to all-in, in steps of
   0.5 BB (1 BB when there is more than 30 BB to choose from), plus the half-pot, three-quarter-pot and pot-sized
   raises the quick buttons use. They all join the analysis's option list, so fold, call and each size are graded
   against the best of everything (rating.js grade()). */
const LABELS=R.LABELS;
function gradeAll(s){
  const A=R.analyze(spotState(s),0,ITERS),need=A.toCall/(A.pot+A.toCall);
  let raise=null;
  if(A.canRaise){
    const hi=A.maxTotal,lo=Math.min(A.minTotal,hi),step=hi-lo<=30*BB?BB/2:BB;
    // When a min-raise is more than you have, all-in is the only raise.
    // A raise of x times the pot: call, then raise by x times the pot after the call (as the analysis sizes them).
    const share=x=>Math.min(hi,Math.max(lo,round(A.callTo+x*(A.pot+A.toCall))));
    const presets={min:lo,half:share(.5),threeq:share(.75),pot:share(1),allin:hi};
    const stops=new Set([lo,hi,...Object.values(presets)]);
    for(let t=Math.ceil(lo/step)*step;t<hi;t+=step)if(t>lo)stops.add(t);
    A.opts=A.opts.filter(o=>o.type!=='raise');
    const sizes=[...stops].sort((x,y)=>x-y);
    for(const T of sizes)A.opts.push(A.raiseOpt(T));
    raise={min:lo,max:hi,presets,stops:sizes.map(T=>{
      const g=R.grade(A,'raise',T),o=A.opts.find(x=>x.type==='raise'&&x.T===T),B=Math.min(T-s.bet,s.stack-s.bet);
      // How often they fold: the same rule the analysis uses for a player who bet (rating.js foldShare, line 2).
      const fold=Math.min(.9,Math.max(.05,1-A.pot/(A.pot+B||1)*1.6));
      return [T,LABELS.indexOf(g.label),+g.lossBB.toFixed(1),+(o.ev/BB).toFixed(1),Math.round(fold*100),Math.round(o.eqC*100)];
    })};
    raise.best=raise.stops.reduce((a,x)=>x[3]>a[3]?x:a)[0];
  }
  const one=(type,note)=>{const g=R.grade(A,type,0),o=type==='fold'?A.opts[0]:A.opts[1];return {label:g.label,glyph:g.glyph,lossBB:+g.lossBB.toFixed(1),ev:+(o.ev/BB).toFixed(1),note}};
  const grades={fold:one('fold','Gives up the pot. Nothing more to lose.'),call:one('call',`Wins the pot about ${pct(A.eq)} of the time; you need ${pct(need)}.`)};
  return {A,eq:A.eq,need,grades,raise,callLabel:`Call ${bb(A.toCall)}`};
}
const fill=(t,v)=>t.replace(/\{(\w+)\}/g,(m,k)=>{if(!(k in v))throw Error('Unknown placeholder '+m);return v[k]});
const out=SPOTS.map((d,i)=>{
  const s=build(d),r=gradeAll(s);
  const loss={fold:r.grades.fold.lossBB,call:r.grades.call.lossBB};
  if(r.raise)loss.raise=Math.min(...r.raise.stops.map(x=>x[2]));
  const best=Object.keys(loss).reduce((a,k)=>loss[k]<loss[a]?k:a);
  const bestLabel=best==='raise'?LABELS[r.raise.stops.find(x=>x[0]===r.raise.best)[1]]:r.grades[best].label;
  if(best!==d.answer)throw Error(`${d.id}: the grader's best play is ${best}, the write-up explains ${d.answer}`);
  if(!['Brilliant','Best'].includes(bestLabel))throw Error(`${d.id}: the best play only grades ${bestLabel}`);
  const second=Math.min(...Object.keys(loss).filter(k=>k!==best).map(k=>loss[k]));
  if(second<1)throw Error(`${d.id}: another kind of play is within ${second} BB of the best`);
  if(d.allIn&&r.raise.stops.at(-1)[1]>1)throw Error(`${d.id}: the write-up says all-in, but all-in only grades ${LABELS[r.raise.stops.at(-1)[1]]}`);
  const at=r.raise&&r.raise.stops.find(x=>x[0]===(d.allIn?r.raise.max:r.raise.best));
  const nums={eq:pct(r.eq),need:pct(r.need),loss:second,...(at&&{fold:at[4]+'%',eqC:at[5]+'%'})};
  const why=Object.fromEntries(Object.entries(d.why).map(([k,t])=>[k,fill(t,nums)]));
  return {n:i+1,id:d.id,title:d.title,tag:d.tag,hero:s.hero,board:s.board,street:s.street,
    pot:s.pot+s.heroBet+s.bet,heroBet:s.heroBet,bet:s.bet,stack:s.stack,depth:s.depth,threeBet:s.threeBet,heroPos:s.heroPos,villainPos:s.villainPos,
    story:s.story,callLabel:r.callLabel,best,eq:+r.eq.toFixed(3),need:+r.need.toFixed(3),grades:r.grades,raise:r.raise,why};
});
const tally=out.reduce((m,p)=>(m[p.best]=(m[p.best]||0)+1,m),{});
writeFileSync(new URL('../backroom-spots.js',import.meta.url),
`/* Generated by scripts/make-backroom.mjs — do not edit by hand. The Back Room's ${out.length} spots, with their grades.
   Answers: ${JSON.stringify(tally)}. */
window.RIVL_BACKROOM=${JSON.stringify(out)};
`);
console.log('Wrote',out.length,'spots',tally);
for(const p of out){
  const rz=p.raise&&p.raise.stops,best=rz&&rz.find(x=>x[0]===p.raise.best),bestRaise=rz&&rz.reduce((a,x)=>x[2]<a[2]?x:a);
  console.log(String(p.n).padStart(2),p.id.padEnd(11),p.best.padEnd(5),'eq',pct(p.eq).padStart(4),'need',pct(p.need).padStart(4),
    `fold ${p.grades.fold.label} −${p.grades.fold.lossBB}, call ${p.grades.call.label} −${p.grades.call.lossBB}`,
    rz?`, raise best to ${bb(best[0])} (${LABELS[best[1]]}), least-bad raise −${bestRaise[2]}, ${rz.length} sizes, Best sizes ${rz.filter(x=>x[1]<=1).map(x=>bb(x[0])).join(' ')}`:'');
}
