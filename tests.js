/* Run: node tests.js — engine checks without a browser */
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ctx=vm.createContext({console,crypto:require('crypto').webcrypto});
vm.runInContext(fs.readFileSync(__dirname+'/engine.js','utf8'),ctx);
const score=cards=>vm.runInContext(`evaluate(${JSON.stringify(cards)})`,ctx);
const cmp=(a,b)=>vm.runInContext(`compare(${JSON.stringify(a)},${JSON.stringify(b)})`,ctx);
assert(score(['A♠','2♠','3♠','4♠','5♠','K♦','Q♣'])[0]===8,'wheel straight flush');
assert(score(['A♠','A♥','A♦','K♠','K♥','2♣','3♣'])[0]===6,'full house');
assert(score(['A♠','A♥','A♦','K♠','K♥','K♣','3♣'])[0]===6,'two triples full house');
assert(score(['2♠','2♥','3♦','3♠','A♥','K♣','Q♣'])[0]===2,'two pair');
assert(cmp(score(['A♠','A♥','K♦','Q♠','J♥']),score(['A♣','A♦','K♠','Q♦','T♥']))>0,'pair kicker');
assert(cmp(score(['A♠','K♠','Q♠','J♠','T♠']),score(['9♣','8♣','7♣','6♣','5♣']))>0,'straight flush comparison');
const deck=vm.runInContext('shuffle()',ctx);assert(new Set(deck).size===52,'unique shuffle');
// Exercise the real action function in isolation, with controlled state and stub UI.
const source=fs.readFileSync(__dirname+'/script.js','utf8');
const fn=source.slice(source.indexOf('function action(i,type,amount=0)'),source.indexOf('function botAction(i)'));
const players=[0,1,2].map(i=>({name:'P'+i,stack:1000,bet:0,committed:0,folded:false,allin:false,acted:false,raiseLocked:false}));
const g={players,currentBet:20,minRaise:20,pot:0,turn:0,finished:false,handPending:false};
players[0].bet=20;players[0].stack=980;players[0].committed=20;
const env=vm.createContext({game:g,stopCountdown(){},note(){},render(){},advanceTurn(){},nextEligible(i){return (i+1)%3},sound(){}});
vm.runInContext('function pay(i,n){let p=game.players[i],v=Math.min(n,p.stack);p.stack-=v;p.bet+=v;p.committed+=v;game.pot+=v;if(!p.stack)p.allin=true;return v};'+fn,env);
vm.runInContext('action(0,"raise",30)',env);assert(g.currentBet===20,'reject illegal under-min raise');
vm.runInContext('action(0,"raise",40)',env);assert(g.currentBet===40&&g.minRaise===20,'accept full raise');
g.turn=1;players[1].stack=50;players[1].bet=0;players[1].acted=false;
vm.runInContext('action(1,"raise",50)',env);assert(g.currentBet===50&&g.minRaise===20,'short all-in keeps min raise');
assert(players[0].raiseLocked,'short all-in locks prior aggressor');
g.turn=0;vm.runInContext('action(0,"raise",70)',env);assert(g.currentBet===50,'locked player cannot reraise');
vm.runInContext('action(0,"call")',env);assert(players[0].bet===50,'locked player may call');
// v1.4 rating + decision grading checks
const rctx=vm.createContext({console,crypto:require('crypto').webcrypto});
vm.runInContext(fs.readFileSync(__dirname+'/engine.js','utf8')+'\n'+fs.readFileSync(__dirname+'/rating.js','utf8'),rctx);
const R=rctx.RivlRating;
let disagree=0;for(let t=0;t<3000;t++){const d=vm.runInContext('shuffle()',rctx),a=d.slice(0,7),b=d.slice(7,14);const e=Math.sign(vm.runInContext(`compare(evaluate(${JSON.stringify(a)}),evaluate(${JSON.stringify(b)}))`,rctx)),f=Math.sign(R.rankHand(a.map(R.toInt))-R.rankHand(b.map(R.toInt)));if(e!==f)disagree++}
assert(disagree===0,'fast evaluator agrees with engine on 3,000 random showdowns');
const aa=R.equity(['A♠','A♥'].map(R.toInt),[],[0],4000);assert(aa>.82&&aa<.88,'AA is ~85% vs one random hand');
const gl=R.glicko({r:1500,rd:200,vol:.06},[{r:1400,rd:30,s:1},{r:1550,rd:100,s:0},{r:1700,rd:300,s:0}]);
assert(Math.abs(gl.r-1464.06)<.1&&Math.abs(gl.rd-151.52)<.1,'Glicko-2 matches Glickman paper example');
const mk=(hole,board,toCall,pot)=>({bb:10,minRaise:10,currentBet:toCall?toCall+10:0,pot,board,hand:1,street:board.length?1:0,players:[{name:'You',hole,bet:10*!!toCall,stack:990,folded:false,allin:false,raiseLocked:false,line:0},{name:'Ace',hole:['2♣','3♦'],bet:toCall?toCall+10:0,stack:900,folded:false,allin:false,line:2}]});
let g1=mk(['A♠','A♥'],[],20,45);assert(['Blunder','Mistake'].includes(R.grade(R.analyze(g1,0,600),'fold').label),'folding aces to a raise is a big error');
let g2=mk(['A♠','K♠'],['Q♠','J♠','T♠'],40,100);assert(R.grade(R.analyze(g2,0,400),'fold').label==='Blunder','folding a royal flush is a blunder');
assert(['Best','Excellent','Good'].includes(R.grade(R.analyze(g2,0,400),'raise',1000).label),'shoving the nuts grades well');
let g3=mk(['9♥','8♥'],['7♣','2♥','K♦'],30,80);const once=JSON.stringify(R.analyze(g3,0,R.GRADE_ITERS).opts.map(o=>o.ev));
assert(once===JSON.stringify(R.analyze(g3,0,R.GRADE_ITERS).opts.map(o=>o.ev)),'the same spot always gets the same analysis (seeded)');
// Preflop is graded against standard opening/defending charts; the table is 9-handed with the hero at seat `at`.
const P9=(hole,at,acts,heroBet=0)=>{const players=[];for(let k=0;k<9;k++){const a=k===at?{bet:heroBet,line:0}:acts[k]||(k===7?{bet:5,line:0}:k===8?{bet:10,line:0}:{bet:0,line:0});players.push({name:'p'+k,hole:k===at?hole:['2♣','3♦'],bet:a.bet,stack:990,folded:!!a.f,allin:false,raiseLocked:false,line:a.line||0})}return{bb:10,minRaise:10,currentBet:Math.max(...players.map(p=>p.bet)),pot:players.reduce((s,p)=>s+p.bet,0),board:[],hand:1,street:0,sbSeat:7,bbSeat:8,players}};
const pf=(hole,at,acts,type,amt,heroBet)=>R.grade(R.analyze(P9(hole,at,acts,heroBet),at,400),type,amt||0).label;
const F={bet:0,f:1},early={0:F,1:F,2:F,3:F,4:F,5:F};
assert(pf(['A♠','Q♦'],0,{},'fold')==='Mistake','folding AQo first in under the gun is a mistake');
assert(pf(['J♠','8♦'],0,{},'raise',25)==='Mistake','opening J8o under the gun is a mistake');
assert(pf(['K♠','9♦'],6,early,'raise',25)==='Best','opening K9o on the button is the book play');
assert(pf(['A♠','A♦'],0,{},'call')==='Inaccuracy','open-limping aces is not best');
assert(pf(['9♦','8♣'],5,{0:F,1:F,2:F,3:F,4:F},'raise',1000)==='Blunder','a 100 BB open-shove with 98o is a blunder');
const bbVs=opener=>({...Object.fromEntries([0,1,2,3,4,5,6].map(k=>[k,k===opener?{bet:25,line:2}:F])),7:{bet:5,f:1}});
assert(pf(['9♠','6♠'],8,bbVs(6),'call',0,10)==='Best'&&pf(['9♠','6♠'],8,bbVs(0),'call',0,10)==='Mistake','the big blind defends 96s against the button, not under the gun');
assert(pf(['7♠','2♦'],8,{...early,6:F,7:{bet:5,line:1}},'fold',0,10)==='Mistake','folding when checking is free');
const post=(hole,board,pot,bet,line)=>({bb:10,minRaise:10,currentBet:bet,pot,board,hand:1,street:1,players:[{name:'You',hole,bet:0,stack:900,folded:false,allin:false,line:1},{name:'Ace',hole:['2♣','3♦'],bet,stack:900,folded:false,allin:false,line}]});
assert(R.grade(R.analyze(post(['K♠','Q♦'],['K♥','7♣','2♦'],100,0,1),0,1500),'raise',900).label!=='Best','a 9x-pot shove with top pair is not the best play');
assert(R.grade(R.analyze(post(['4♠','6♥'],['K♦','K♠','K♥','3♦','J♠'],205,100,2),0,1500),'fold').label!=='Brilliant','folding trips the board gives everyone is not brilliant');
// Set Hands bots (chooseBest): the chart's play preflop, legal sizes, no deep jams, the same move every time.
const cb=(g,i)=>{const d=R.chooseBest(g,i);return d.type+(d.amount?' '+d.amount:'')};
assert(cb(P9(['A♠','A♦'],0,{}),0)==='raise 25'&&cb(P9(['7♠','2♦'],0,{}),0)==='fold','best bot opens aces to 2.5 BB and folds 72o');
const sq=P9(['K♠','J♠'],7,{0:{bet:25,line:2,f:1},1:F,2:F,3:F,4:F,5:F,6:{bet:75,line:2}},5);sq.streetRaises=2;
assert(cb(sq,7)==='fold','best bot folds KJs to a button 3-bet even after the opener has folded');
const set=post(['K♠','K♦'],['K♥','7♣','2♦'],100,0,1),sd=R.chooseBest(set,0);
assert(sd.type==='raise'&&sd.amount<900&&sd.amount%5===0&&cb(set,0)===cb(set,0),'best bot bets top set with a legal size, not a 9x-pot jam, and repeats itself');
assert(cb(post(['4♠','5♥'],['K♦','Q♠','9♥'],200,200,2),0)==='fold','best bot folds air to a pot-sized bet');
const lg=r=>R.tier(r).name;
assert(lg(0)==='Prospect'&&lg(349)==='Prospect'&&lg(350)==='Challenger'&&lg(699)==='Challenger'&&lg(700)==='Elite'&&lg(1050)==='Master'&&lg(1400)==='Grandmaster'&&lg(1749)==='Grandmaster'&&lg(1750)==='Champion'&&lg(3500)==='Champion','league bands');
assert(R.tier(525).progress===.5&&R.tier(350).next===700&&R.tier(3000).next===null,'league progress');
// Online rooms also draw .seat elements, so the bot table must only ever paint its own seats.
assert(!/querySelector(All)?\('\.(seat|myseat)/.test(source),'bot table seat lookups stay inside #table');
// The Back Room (backroom-spots.js): the story's amounts add up, the price and EVs agree with the equity,
// the hands are what the write-ups say, and re-grading reproduces the answer.
const bctx=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(__dirname+'/backroom-spots.js','utf8'),bctx);
const BR=bctx.window.RIVL_BACKROOM,BB=100,num=t=>Math.round(parseFloat(t)*BB);
assert(BR.length===24&&new Set(BR.map(p=>p.id)).size===24,'the Back Room has 24 different spots');
const MADE={boat:6,straight:4,'top-set':3,set88:3,'bottom-set':3,acehigh:2,'aces-up':2,a7:2,'turn-raise':2,aces:1,'kk-wet':1,blocker:1,'jj-3bet':1};
for(const p of BR){
  // Rebuild the pot from the story text alone: blinds, the preflop raise, each street's bet and call.
  const pre=p.story[0],put=num((pre.match(/3-bets to ([\d.]+) BB/)||pre.match(/to ([\d.]+) BB/))[1]);
  let pot=50+(p.heroPos!=='BB'&&p.villainPos!=='BB'?BB:0)+2*put;
  for(const line of p.story.slice(1,-1)){const m=line.match(/bets? ([\d.]+) BB/);if(m)pot+=2*num(m[1]);else assert(/checked through/.test(line),p.id+' story line')}
  const last=p.story.at(-1),into=last.match(/into ([\d.]+) BB/),raised=last.match(/you bet ([\d.]+) BB, .* (?:raises to|all-in for) ([\d.]+) BB/);
  if(raised){assert(num(raised[1])===p.heroBet&&num(raised[2])===p.bet,p.id+' raise in the story matches the table')}
  else{assert(into&&num(into[1])===pot&&num(last.match(/(?:bets|all-in for) ([\d.]+) BB/)[1])===p.bet,p.id+' bet in the story matches the table')}
  assert(pot+p.heroBet+p.bet===p.pot,p.id+' the pot adds up');
  const toCall=p.bet-p.heroBet;
  assert(Math.abs(p.need-toCall/(p.pot+toCall))<.001,p.id+' pot odds');
  assert(Math.abs(p.grades.call.ev-(p.eq*(p.pot+toCall)-toCall)/BB)<.2,p.id+' calling EV is equity times the pot minus the call');
  assert(p.depth*BB-put-(p.stack-0)===p.story.slice(1,-1).reduce((s,l)=>{const m=l.match(/bets? ([\d.]+) BB/);return s+(m?num(m[1]):0)},0),p.id+' stack behind');
  if(MADE[p.id])assert(vm.runInContext(`evaluate(${JSON.stringify(p.hero.concat(p.board))})`,rctx)[0]===MADE[p.id],p.id+' made hand matches the write-up');
  // The answer: best kind of play at Best or Brilliant, every other kind at least 1 BB worse, every raise size legal.
  const loss={fold:p.grades.fold.lossBB,call:p.grades.call.lossBB};
  if(p.raise){const st=p.raise.stops;assert(st.every((x,i)=>x[0]>=p.raise.min&&x[0]<=p.raise.max&&(!i||x[0]>st[i-1][0])),p.id+' raise sizes');
    assert(st[0][0]===Math.min(p.bet+Math.max(toCall,BB),p.stack)&&st.at(-1)[0]===p.stack,p.id+' the slider runs from a min-raise to all-in');loss.raise=Math.min(...st.map(x=>x[2]))}
  const best=Object.keys(loss).reduce((a,k)=>loss[k]<loss[a]?k:a);
  assert(best===p.best&&Object.keys(loss).every(k=>k===best||loss[k]>=1),p.id+' one clear answer');
  // Re-grade at fewer samples: the equity and the answer hold.
  const st={pot:p.pot,currentBet:p.bet,minRaise:Math.max(toCall,BB),bb:BB,board:p.board,hand:1,street:p.street,
    players:[{hole:p.hero,bet:p.heroBet,stack:p.stack-p.heroBet,folded:false,allin:false,line:p.heroPos==='BB'?1:2},{hole:['?','?'],bet:p.bet,stack:p.stack-p.bet,folded:false,allin:p.stack===p.bet,line:2}]};
  const A=R.analyze(st,0,4000);
  assert(Math.abs(A.eq-p.eq)<.03,p.id+' equity re-grades within 3%');
  const evs={fold:0,call:A.opts[1].ev};if(p.raise)evs.raise=A.raiseOpt(p.raise.best).ev;
  assert(Object.keys(evs).reduce((a,k)=>evs[k]>evs[a]?k:a)===p.best,p.id+' re-grading finds the same answer');
}
// Scripted table: 10 set hands, each with 15 unique cards, dealt in seat order by the engine's normal pops.
ctx.window={};vm.runInContext(fs.readFileSync(__dirname+'/scripted-hands.js','utf8'),ctx);
const SH=ctx.window.RIVL_SCRIPTED_HANDS;assert(SH.length===10,'10 scripted hands');
SH.forEach((h,k)=>{const all=[...h.hole.flat(),...h.board];assert(h.hole.length===5&&h.board.length===5&&new Set(all).size===15,'scripted hand '+(k+1)+' cards');
  for(const busted of [-1,3]){const ps=[0,1,2,3,4].map(i=>({stack:i===busted?0:1000}));
    const d=ctx.window.rivlScriptedDeck(k+1,ps);assert(new Set(d).size===52,'scripted deck '+(k+1)+' is a full deck');
    ps.forEach((p,i)=>{if(p.stack>0)assert.strictEqual(String([d.pop(),d.pop()]),String(h.hole[i]),'scripted hand '+(k+1)+' seat '+i)});
    assert.strictEqual(String([d.pop(),d.pop(),d.pop(),d.pop(),d.pop()]),String(h.board),'scripted hand '+(k+1)+' board')}});
// Training drills (training.js): every answer is the grader's own chart play, from every seat at 6-max and 9-max.
vm.runInContext(fs.readFileSync(__dirname+'/training.js','utf8'),rctx);
const TR=rctx.RivlTraining,holeOf=c=>c.length===2?[c[0]+'♠',c[0]+'♥']:[c[0]+'♠',c[1]+(c[2]==='s'?'♠':'♥')];
const firstIn=(n,at,hole)=>({bb:10,minRaise:10,currentBet:10,pot:15,board:[],hand:1,street:0,sbSeat:n-2,bbSeat:n-1,
  players:[...Array(n)].map((_,k)=>({name:'p'+k,hole:k===at?hole:['2♣','3♦'],bet:k===n-2?5:k===n-1?10:0,stack:990,folded:k<at,allin:false,raiseLocked:false,line:0}))});
let trChecks=0;
for(const size of [6,9])TR.SEATS[size].slice(0,-1).forEach((pos,at)=>TR.CLASSES.forEach(c=>{
  const A=R.analyze(firstIn(size,at,holeOf(c)),at,1);
  for(const act of ['raise','fold']){
    const {open,v}=TR.open.judge(size,pos,c,act),label=R.grade(A,act,act==='raise'?25:0).label;trChecks++;
    // In the small blind the grader also allows a limp with its widest hands, so folding them is Good there, not Best.
    const ok=v==='right'?label==='Best'||pos==='SB'&&act==='fold'&&TR.tierOf(c)===8&&label==='Good':v==='close'?label==='Good':!['Best','Excellent','Good'].includes(label);
    assert(ok,`range trainer ${size}-max ${pos} ${c} ${act}: trainer says ${v}, grader says ${label}`);
    assert(!/undefined|NaN/.test(TR.open.handText(size,pos,c,open)+TR.open.seatText(size,pos)),`range trainer text for ${c} from ${pos}`);
  }
}));
// Facing a raise: one open to 2.5 BB, everyone else before you folded. The drill's 3-bet, call and fold get the grader's labels.
const facing=(n,o,at,hole)=>({bb:10,minRaise:15,currentBet:25,pot:25+(o===n-2?0:5)+10,board:[],hand:1,street:0,sbSeat:n-2,bbSeat:n-1,
  players:[...Array(n)].map((_,k)=>{const bet=k===o?25:k===n-2?5:k===n-1?10:0;
    return{name:'p'+k,hole:k===at?hole:['2♣','3♦'],bet,stack:1000-bet,folded:k<at&&k!==o,allin:false,raiseLocked:false,line:k===o?2:0}})});
// The chart sees only a hand's tier (and whether it is aces or kings), so one hand per tier, plus QQ and 72o, covers a spot.
const VR=TR.vsRaise,EACH_TIER=[...R.TIERS.map(l=>l.split(' ')[0]),'QQ','72o'];let vrChecks=0;
for(const size of [6,9])TR.SEATS[size].forEach((pos,at)=>TR.SEATS[size].slice(0,at).forEach((opener,o)=>{
  for(const c of TR.CLASSES){
    const L=VR.labels(size,opener,pos,c);
    if(EACH_TIER.includes(c)){
      const A=R.analyze(facing(size,o,at,holeOf(c)),at,1);
      for(const act of ['raise','call','fold']){vrChecks++;
        assert.strictEqual(L[act],R.grade(A,act,act==='raise'?VR.threeBetTo(pos)*10:0).label,`facing a raise ${size}-max ${pos} v ${opener} ${c} ${act}`)}
    }
    assert(['raise','call','fold'].some(a=>L[a]==='Best'),`facing a raise ${size}-max ${pos} v ${opener} ${c} has a Best answer`);
    assert(!/undefined|NaN/.test(VR.handText(size,opener,pos,c)),`facing a raise text for ${c} ${pos} v ${opener}`);
  }
  assert(!/undefined|NaN/.test(VR.spotText(size,opener,pos)),`facing a raise text for ${pos} v ${opener}`);
}));
// The charts stay close to standard ones: you continue with less than the opener opens (the big blind aside), early raises
// get tight answers, and the big blind defends more the later the raise.
const openP=(size,p)=>Math.round(100*TR.openPct(size,p)),cont=(size,op,pos)=>{const x=VR.shares(size,op,pos);return x.raise+x.call};
for(const size of [6,9])TR.SEATS[size].forEach((pos,at)=>{if(pos!=='BB')TR.SEATS[size].slice(0,at).forEach(op=>
  assert(cont(size,op,pos)<openP(size,op),`${size}-max ${pos} continues against ${op} with fewer hands than ${op} opens`))});
assert(VR.shares(6,'UTG','SB').raise<=7&&VR.shares(9,'UTG','SB').raise<=7,'the small blind 3-bets about 5% against a UTG raise');
assert(cont(9,'UTG','BTN')<=6,'at a full table the button continues with about 5% against UTG');
assert(cont(6,'BTN','BB')>=55&&cont(6,'BTN','BB')>cont(6,'HJ','BB'),'the big blind defends most hands against the button, and more than against the hijack');
const near=(size,pos,lo,hi)=>{const p=TR.openPct(size,pos);return p>=lo&&p<=hi};
assert(near(9,'UTG',.09,.13)&&near(6,'UTG',.17,.22)&&near(9,'BTN',.44,.5),'opening ranges: about 11% under the gun at a full table, 20% at 6-max, 48% on the button');
// Player stats (hand-stats.js): seats are named from the small blind, a hand's record counts the way tracking software
// counts it, a bad record from a browser is refused, and totals are exact sums in any order.
require(__dirname+'/hand-stats.js');
let hsChecks=0;
const hsEq=(a,b,m)=>{assert.deepStrictEqual(a,b,m);hsChecks++},hsOk=(c,m)=>{assert(c,m);hsChecks++},hsNear=(a,b,m)=>hsOk(Math.abs(a-b)<1e-9,m+': '+a+' is not '+b);
{
const HS=globalThis.RivlHandStats;
hsEq([0,1,2,3,4,5].map(k=>HS.position(6,k)),['SB','BB','EP','MP','CO','BTN'],'6-max seats');
hsEq([...Array(9).keys()].map(k=>HS.position(9,k)),['SB','BB','EP','EP','MP','MP','MP','CO','BTN'],'9-max seats');
hsEq([0,1].map(k=>HS.position(2,k)).concat([0,1,2].map(k=>HS.position(3,k))),['SB','BB','SB','BB','BTN'],'heads-up and 3-handed seats');
// A room's log becomes one record: seats renumbered from the small blind, a seat not dealt in left out, only this player's grades kept.
const hsBest={label:'Best',acc:100,weight:2.1,lossBB:0},hsExc={label:'Excellent',acc:95,weight:3,lossBB:.12};
const steal=HS.pack({order:[5,0,1,3],me:3,bb:20,net:70,won:130,hole:['A♠','K♦'],board:['A♥','7♣','2♦'],log:[
  {seat:1,street:0,type:'f'},{seat:7,street:0,type:'f'},{seat:3,street:0,type:'r',to:60,grade:hsBest},{seat:5,street:0,type:'f'},{seat:0,street:0,type:'c',grade:hsBest},
  {seat:0,street:1,type:'k'},{seat:3,street:1,type:'r',to:80,grade:hsExc},{seat:0,street:1,type:'f'}]});
hsEq(steal,[4,3,20,'2f,3r60,0f,1c/1k,3r80,1f',70,130,'AsKd','Ah7c2d',[[1,1,10000,2100,0],[5,2,9500,3000,12]]],'a hand packs to its record');
hsEq(HS.pack({order:[4,2],me:4,bb:10,net:-5,won:0,log:[{seat:4,street:0,type:'f'}]}),[2,0,10,'0f',-5,0,'','',[]],'a hand that ends before the flop');
// The same hands from other seats: a 3-bet and the opener folding to it, a heads-up showdown from both sides, a c-bet and the fold to it.
const threeBet='2f,3f,4r50,5f,0f,1r150,4f',showdown='0c,1k/1k,0r20,1c/1k,0k/1r40,0c',cbet='2r30,0f,1c/1k,2r30,1f';
const hsHands={steal,bb3:[6,1,20,threeBet,60,110,'QsQh','',[]],co3:[6,4,20,threeBet,-50,0,'AhTc','',[]],
  sdWin:[2,0,10,showdown,70,140,'9s9d','9h5c2dKsQh',[]],sdLose:[2,1,10,showdown,-70,0,'AsKs','9h5c2dKsQh',[]],
  fcb:[3,1,10,cbet,-30,0,'8s7s','Kd4h2c',[[2,3,9000,1500,40],[3,1,10000,500,0],[5,5,6000,2000,150]]],cb:[3,2,10,cbet,35,65,'AdJc','Kd4h2c',[]]};
const KEYS=['vpip','pfr','tbo','tb','ft3o','ft3','sto','st','cbo','cb','fcbo','fcb','sf','sd','wsd','won','net'];
const hsCounts=Object.fromEntries(Object.entries(hsHands).map(([k,r])=>[k,HS.count(r)])),flags=k=>KEYS.map(x=>hsCounts[k][x]);
hsOk(Object.values(hsHands).every(HS.valid),'every crafted record is valid');
hsEq(flags('steal'),[1,1,0,0,0,0,1,1,1,1,0,0,1,0,0,1,350],'button steal, then a c-bet that takes it down');
hsEq(flags('bb3'),[1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,1,300],'the big blind 3-bets');
hsEq(flags('co3'),[1,1,0,0,1,1,1,1,0,0,0,0,0,0,0,0,-250],'the cutoff steals and folds to the 3-bet');
hsEq(flags('sdWin'),[1,0,0,0,0,0,1,0,0,0,0,0,1,1,1,1,700],'heads-up the button limps (a steal chance not taken) and wins at showdown');
hsEq(flags('sdLose'),[0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,-700],'the big blind checks it through and loses at showdown');
hsEq(flags('fcb'),[1,0,1,0,0,0,0,0,0,0,1,1,1,0,0,0,-300],'calls a raise (a 3-bet chance) and folds to the c-bet');
hsEq(flags('cb'),[1,1,0,0,0,0,1,1,1,1,0,0,1,0,0,1,350],'the button steals and c-bets');
hsEq([hsCounts.sdWin.bets,hsCounts.sdWin.calls,hsCounts.sdWin.checks,hsCounts.sdLose.bets,hsCounts.sdLose.calls,hsCounts.sdLose.checks],
  [[0,1,0,0],[1,0,0,1],[0,0,1,0],[0,0,0,1],[0,1,0,0],[1,1,1,0]],'bets, calls and checks by street');
hsEq(hsCounts.steal.g,[2,10000*2100+9500*3000,5100,12],'graded decisions add accuracy times weight');
hsEq([hsCounts.steal.gx[2],hsCounts.steal.gx[5],hsCounts.steal.gp[3]],[[1,21000000,2100,0],[1,28500000,3000,12],hsCounts.steal.g],'by street and kind, and by seat');
hsEq([hsCounts.fcb.gx[1],hsCounts.fcb.gx[3],hsCounts.fcb.gx[4],hsCounts.fcb.gp[5]],[[1,13500000,1500,40],[1,12000000,2000,150],[1,5000000,500,0],[3,30500000,4000,190]],'a call, a check and a fold');
// A bad record is refused.
const plain=[...steal.slice(0,8),[]],set=(r,i,v)=>Object.assign([...r],{[i]:v});
hsOk(HS.valid(plain),'a record with no grades');
for(const [r,why] of [[null,'not a record'],[steal.slice(0,8),'too short'],[set(plain,0,1),'one player'],[set(plain,0,10),'ten players'],
  [set(plain,1,4),'a seat not dealt in'],[set(plain,2,0),'no big blind'],[set(plain,4,1.5),'part of a chip'],[set(plain,5,-1),'won less than nothing'],
  [set(plain,3,'2f,3x'),'an unknown action'],[set(plain,3,'2f,5f'),'a seat past the table'],[set(plain,3,'2f/3f/0f/1f/2f'),'five streets'],
  [set(plain,3,'2f,'.repeat(130)+'2f'),'too many actions'],[set(plain,3,'2r123456789,'.repeat(80)+'2f'),'too long'],
  [set(plain,6,'AsKdQh'),'three hole cards'],[set(plain,6,'XxYy'),'cards that do not exist'],[set(plain,7,'AhKhQhJhTh9h'),'six board cards'],
  [set(steal,8,[[0,1,10000,2100,0]]),'a grade on another player’s action'],[set(steal,8,[[8,1,10000,2100,0]]),'a grade on an action not there'],
  [set(steal,8,[[1,7,10000,2100,0]]),'an unknown grade'],[set(steal,8,[[1,1,10001,2100,0]]),'over 100%'],[set(steal,8,[[1,1,10000,2100]]),'a short grade'],
  [set(steal,8,Array(61).fill([1,1,10000,2100,0])),'too many grades']])hsOk(!HS.valid(r),'refused: '+why);
// Totals: exact sums, the same in any order, only of known counts.
const all=Object.values(hsCounts),t=HS.total(all);
const whole=x=>Array.isArray(x)?x.every(whole):x&&typeof x==='object'?Object.values(x).every(whole):Number.isInteger(x);
hsEq(t,HS.total([...all].reverse()),'the same total in any order');hsOk(whole(t),'every count is a whole number');
hsEq(HS.total([]),HS.blank(),'no hands');hsEq(HS.add(HS.blank(),{h:3,junk:5}),{...HS.blank(),h:3},'a key it does not know is ignored');
hsEq(HS.add(HS.total(all.slice(0,3)),HS.total(all.slice(3))),t,'totals of totals');
const r=HS.rates(t);
hsEq([r.hands,r.vpip,r.pfr,r.threeBet,r.foldTo3,r.steal,r.cbet,r.foldToCbet,r.af,r.wtsd,r.wsd,r.decisions],[7,600/7,400/7,50,100,75,100,100,2,40,50,5],'the Profile’s rates');
hsNear(r.sawFlop,500/7,'saw the flop');hsNear(r.won,400/7,'won the hand');hsNear(r.bb100,450/7,'big blinds won per 100 hands');hsNear(r.loss100,202/7,'big blinds given up per 100 hands');
hsNear(r.acc,80000000/9100/100,'accuracy is weighted by how much each decision matters');
hsEq(r.streets.map(x=>[x.name,x.n,x.lossBB]),[['Preflop',2,.4],['Flop',3,1.62],['Turn',0,0],['River',0,0]],'decisions by street');
hsNear(r.streets[1].acc,45500000/5500/100,'flop accuracy');hsEq([r.streets[2].acc,r.seats[0].acc],[null,null],'no accuracy without decisions');
hsEq(r.leaks.map(x=>[x.street,x.kind,x.lossBB]),[['Flop','fold',1.5],['Preflop','call',.4],['Flop','raise',.12]],'biggest leaks first');
hsEq(r.labels.map(x=>x.n),[0,2,1,1,0,1,0],'grades by label');
const none=HS.rates(HS.blank());
hsEq([none.hands,none.vpip,none.af,none.bb100,none.acc,none.leaks],[0,null,null,null,null,[]],'nothing to show yet');
hsEq(HS.rates(hsCounts.steal).af,Infinity,'bets with no calls');
}
// Bot practice lifetime accuracy (rating.js) weighs every decision; matches from before that keep their averages and
// count as a typical match since does, so nobody's accuracy jumps when the weighting starts.
{
  const st=R.store();st.players.Old={r:1500,rd:350,vol:.06,games:2,wins:0,accSum:160,accN:2};
  hsNear(R.lifetimeAccuracy(st.players.Old),80,'before any weighted match: the average of match averages');
  const grade=(acc,weight)=>({acc,weight,label:'Good',lossBB:0});
  R.recordMatch([{name:'Old',grades:[grade(70,10),grade(50,10),grade(60,30)]},{name:'New',grades:[grade(90,1),grade(30,3)]}],[1,2]);
  const o=st.players.Old,n=st.players.New;
  hsEq([o.accOldN,o.accOldSum,o.accN,o.accS,o.accW],[2,160,3,3000,50],'the older averages are kept apart');
  hsNear(R.lifetimeAccuracy(o),(80+80+60)/3,'one weighted match since: it counts as one of three');
  hsNear(R.lifetimeAccuracy(n),(90+90)/4,'a new player: Σ accuracy×weight over Σ weight');
  hsEq([R.lifetimeAccuracy({}),R.lifetimeAccuracy(null)],[null,null],'no matches yet');
}
console.log('PASS: 12 poker engine checks + 17 rating checks + 24 Back Room spots + 10 scripted hands + 5 Set Hands bot checks + '+trChecks+' range trainer answers + '+vrChecks+' facing-a-raise answers + '+hsChecks+' player stats checks');
