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
const lg=r=>R.tier(r).name;
assert(lg(0)==='Prospect'&&lg(349)==='Prospect'&&lg(350)==='Challenger'&&lg(699)==='Challenger'&&lg(700)==='Elite'&&lg(1050)==='Master'&&lg(1400)==='Grandmaster'&&lg(1749)==='Grandmaster'&&lg(1750)==='Champion'&&lg(3500)==='Champion','league bands');
assert(R.tier(525).progress===.5&&R.tier(350).next===700&&R.tier(3000).next===null,'league progress');
// Online rooms also draw .seat elements, so the bot table must only ever paint its own seats.
assert(!/querySelector(All)?\('\.(seat|myseat)/.test(source),'bot table seat lookups stay inside #table');
console.log('PASS: 12 poker engine checks + 17 rating checks');
