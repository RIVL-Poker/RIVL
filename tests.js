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
const lg=r=>R.tier(r).name;
assert(lg(0)==='Prospect'&&lg(349)==='Prospect'&&lg(350)==='Challenger'&&lg(699)==='Challenger'&&lg(700)==='Elite'&&lg(1050)==='Master'&&lg(1400)==='Grandmaster'&&lg(1749)==='Grandmaster'&&lg(1750)==='Champion'&&lg(3500)==='Champion','league bands');
assert(R.tier(525).progress===.5&&R.tier(350).next===700&&R.tier(3000).next===null,'league progress');
console.log('PASS: 12 poker engine checks + 8 rating checks');
