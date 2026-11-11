/* Run: node tests-river.js (also run at the end of node tests.js). Checks the River: Call or Fold drill (river.js):
   the range notation, and for every spot the story's amounts, the range, the exact equity (recounted with
   engine.js's separate evaluator), the price, the EV and the grader's labels, and that the write-up's answer is
   the one the count gives. */
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const load=files=>{const c=vm.createContext({console});c.globalThis=c;files.forEach(f=>vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),c));return c};
const RR=load(['engine.js','rating.js','river.js']).RivlRiver;
const eng=load(['engine.js']),score=cs=>vm.runInContext(`evaluate(${JSON.stringify(cs)})`,eng),cmp=(a,b)=>vm.runInContext(`compare(${JSON.stringify(a)},${JSON.stringify(b)})`,eng);
let checks=0;const ok=(c,m)=>{assert(c,m);checks++};
const near=(a,b,m)=>ok(Math.abs(a-b)<1e-9,`${m}: ${a} vs ${b}`);

// The range notation.
const n=t=>RR.combos(t).length;
[['AK',16],['AKs',4],['AKo',12],['QQ',6],['A♠K',4],['A♠K♠',1],['KQ♠',4],['A♥Q',4],['T9s',4]].forEach(([t,c])=>ok(n(t)===c,`${t} has ${c} combos`));
ok(JSON.stringify(RR.expand('TT-77'))==='["TT","99","88","77"]','a run of pairs');
ok(JSON.stringify(RR.expand('A5s-A2s'))==='["A5s","A4s","A3s","A2s"]','a run of kickers');
ok(RR.combos('A♠K').every(c=>c[0]==='A♠'),'a named card stays fixed');
assert.throws(()=>RR.combos('AKx'),/Bad range token/);checks++;

const S=RR.SPOTS,ids=new Set(),answers={};
ok(S.length>=20,'at least 20 spots');
for(const s of S){
  const at=s.id+': ';
  ok(!ids.has(s.id),at+'unique id');ids.add(s.id);
  // The cards: two for you, five on the board, none repeated.
  ok(s.hero.length===2&&s.board.length===5&&new Set([...s.hero,...s.board]).size===7,at+'seven different cards');
  // The title shows before you answer, so it must not name the answer.
  ok(!/\b(call|fold)/i.test(s.title),at+'the title does not give the answer away');
  // The story's amounts add up to the pot, and the river bet is what the story says.
  const nums=s.story.slice(1,-1).map(l=>(l.match(/\bbet?s? ([\d.]+) BB/)||[0,0])[1]*1);
  const dead=(s.heroPos!=='SB'&&s.villainPos!=='SB'?.5:0)+(s.heroPos!=='BB'&&s.villainPos!=='BB'?1:0);
  near(s.pot,dead+2*(s.threeBet||2.5)+2*nums.reduce((a,b)=>a+b,0),at+'the pot is the blinds, the preflop raises and two of every bet');
  ok(s.story[s.story.length-1].includes(`${+s.bet.toFixed(1)} BB into ${+s.pot.toFixed(1)} BB`),at+'the river line names the bet and the pot');
  ok(s.bet<=s.stack&&(s.allIn===(s.bet===s.stack)),at+'the bet fits the stack');
  ok(s.story.length===s.streets.length+2,at+'one story line per street');
  ok(Number.isInteger(s.bet*2)&&Number.isInteger(s.pot*2),at+'amounts in half big blinds');
  // The range: every group has hands, none uses a card you can see, none is listed twice.
  const seen=new Set();let won=false;
  for(const g of s.groups){
    ok(g.n>0,at+g.name+' has live hands');
    for(const c of g.combos){
      ok(!c.some(x=>s.hero.includes(x)||s.board.includes(x)),at+'no visible card in '+c.join(''));
      const k=c.slice().sort().join('');ok(!seen.has(k),at+'listed once: '+k);seen.add(k);
    }
    // A group is all hands that beat you, or all hands you beat (or split): no mixed rows in the table.
    ok(!(g.win&&g.lose)&&!(g.lose&&g.tie),at+g.name+' ends one way at showdown');
    // Strongest first: once a group loses to you, no later group beats you.
    if(g.lose)ok(!won,at+g.name+' is listed before the hands you beat');else won=true;
  }
  // The equity, recounted with engine.js's evaluator: every combo against your hand at showdown.
  const mine=score([...s.hero,...s.board]);let win=0,tie=0,total=0;
  for(const g of s.groups)for(const c of g.combos){const d=cmp(mine,score([...c,...s.board]));total++;if(d>0)win++;else if(!d)tie++}
  ok(total===s.total&&win===s.win&&tie===s.tie,at+`engine.js agrees: ${win} won, ${tie} split of ${total}`);
  ok(s.win>0&&s.lose>0,at+'a bluff catcher: it beats some of the range and loses to some');
  near(s.eq,(win+tie/2)/total,at+'equity is the count');
  // The price and the EV.
  near(s.need,s.bet/(s.pot+2*s.bet),at+'a call needs bet / (pot + bet + call)');
  near(s.evCall,s.eq*(s.pot+2*s.bet)-s.bet,at+'EV of a call');
  ok((s.evCall>0)===(s.eq>s.need),at+'calling pays exactly when equity beats the price');
  ok(s.best===s.answer,at+`the write-up says ${s.answer}, the count says ${s.best}`);
  // Not a coin flip: the right answer is worth at least 3% of the pot (with the bet) more than the other.
  ok(Math.abs(s.evCall)>=.03*(s.pot+s.bet),at+'the answer is clear of the grader\'s "Best" band');
  // The grader: the right play is Best (or Brilliant), the other isn't, and the drill's verdicts follow it.
  const other=s.best==='call'?'fold':'call';
  ok(RR.verdictOf(s.grades[s.best].label)==='right'&&RR.judge(s,s.best).v==='right',at+'the answer is graded Best');
  ok(RR.judge(s,other).v!=='right',at+'the other play is not');
  near(s.grades[other].lossBB,Math.abs(s.evCall),at+'the other play gives up the EV difference');
  ok(s.hand&&s.read&&s.title,at+'has a write-up');
  const k=RR.sizeOf(s);answers[k]=answers[k]||{};answers[k][s.best]=(answers[k][s.best]||0)+1;
}
// Every bet-size filter has both answers, so no filter can be passed by always pressing one button.
for(const [k] of RR.SIZES)ok(answers[k]&&answers[k].call&&answers[k].fold,`${k} bets have calls and folds`);
// Verdicts match the other drills: Best or Brilliant is correct, Excellent or Good is close, worse is a miss.
ok(['Brilliant','Best','Excellent','Good','Inaccuracy','Mistake','Blunder'].map(RR.verdictOf).join()==='right,right,close,close,wrong,wrong,wrong','verdict labels');
console.log(`PASS: ${checks} River: Call or Fold checks (${S.length} spots)`);
