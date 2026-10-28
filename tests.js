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
console.log('PASS: 12 poker engine checks + 17 rating checks + 24 Back Room spots + 10 scripted hands + 5 Set Hands bot checks');
