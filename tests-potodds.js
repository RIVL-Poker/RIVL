/* Pot Odds & Draws drill (potodds.js), run from tests.js. Every equity is recounted with engine.js's own evaluator
   (a different code path from the drill's), and every answer must get the decision grader's label for its EV. */
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ctx=vm.createContext({console});
vm.runInContext(['engine.js','rating.js','potodds.js'].map(f=>fs.readFileSync(__dirname+'/'+f,'utf8')).join('\n'),ctx);
const R=ctx.RivlRating,P=ctx.RivlPotOdds,toInt=R.toInt,name=P.cardName;
const ev=cards=>vm.runInContext(`evaluate(${JSON.stringify(cards)})`,ctx);
const cmp=(a,b)=>vm.runInContext(`compare(evaluate(${JSON.stringify(a)}),evaluate(${JSON.stringify(b)}))`,ctx);
// Recount a spot's equity by brute force with the engine: wins plus half the splits over every runout.
function recount(s){
  const dead=new Set([...s.hero,...s.villain,...s.board]),live=[...Array(52).keys()].filter(c=>!dead.has(c)).map(name);
  const H=s.hero.map(name),V=s.villain.map(name),B=s.board.map(name);let w=0,t=0,n=0;
  const score=run=>{const d=Math.sign(cmp(H.concat(B,run),V.concat(B,run)));n++;if(d>0)w++;else if(d===0)t++};
  if(B.length===4)live.forEach(c=>score([c]));else for(let i=0;i<live.length;i++)for(let j=i+1;j<live.length;j++)score([live[i],live[j]]);
  return{w,t,n,eq:(w+t/2)/n};
}
let checks=0;
// A textbook spot, by hand: 7♥6♥ on 2♥ 9♥ K♣ Q♠ against K♦J♣. Nine hearts and nothing else: 9 ÷ 44.
{const s={hero:['7♥','6♥'].map(toInt),villain:['K♦','J♣'].map(toInt),board:['2♥','9♥','K♣','Q♠'].map(toInt),pot:10,bet:5};
  s.solved=P.solve(s.hero,s.villain,s.board);s.draw=P.drawOf(s.hero,s.board);
  assert.strictEqual(s.draw.type,'flush','7♥6♥ on 2♥9♥ is a flush draw');
  assert.strictEqual(s.solved.outs,9,'nine flush outs');assert.strictEqual(s.solved.total,44,'44 unseen river cards');
  assert(Math.abs(s.solved.eq-9/44)<1e-12,'equity is exactly 9/44');
  assert(Math.abs(P.priceOf(10,5).need-.25)<1e-12,'calling 5 into 10 needs 25%');
  assert.strictEqual(P.judge(s,'fold').v,'right','20.5% < 25%: fold');assert.notStrictEqual(P.judge(s,'call').v,'right','20.5% < 25%: calling is not right');
  s.bet=2;assert.strictEqual(P.judge(s,'call').v,'right','calling 2 into 10 needs 14.3%: call');checks+=8}
// The draw names: open-ended, double gutshot, gutshot and one-ended, flush plus straight.
const draw=(h,b)=>P.drawOf(h.map(toInt),b.map(toInt));
assert.strictEqual(draw(['9♣','8♦'],['7♠','6♥','K♣']).type,'oesd','9876 is open-ended');
assert(draw(['9♣','8♦'],['7♠','6♥','K♣']).open,'9876 is four in a row');
assert(!draw(['9♣','7♦'],['2♦','J♥','K♣','8♠']).open&&draw(['9♣','7♦'],['2♦','J♥','K♣','8♠']).type==='gutshot','9 8 7 and J: only a ten');
assert.strictEqual(draw(['9♣','7♦'],['5♠','J♥','K♣']).type,'','no straight draw from 9 7 with 5 J K');
const dg=draw(['9♣','7♦'],['5♠','J♥','8♣','4♦']);assert(dg.type==='oesd'&&!dg.open&&dg.straightRanks.length===2,'5 _ 7 8 9 _ J is a double gutshot');
assert.strictEqual(draw(['A♣','K♦'],['Q♠','J♥','2♣']).type,'gutshot','AKQJ needs only a ten');
assert.strictEqual(draw(['A♥','5♥'],['4♥','3♠','K♥']).type,'combo','A♥5♥ on 4♥ 3♠ K♥: flush draw and gutshot');
assert.strictEqual(draw(['K♠','Q♠'],['9♥','8♥','7♥','6♥']).type,'','the board alone holds the straight draw and the flush');checks+=8;
// Random spots of every kind: the exact count agrees with the engine, every out really wins, and the grade fits the EV.
const rand=R.mulberry32(20261111);
for(const street of ['turn','flop'])for(const type of ['all','flush','oesd','gutshot','combo'])for(let k=0;k<(street==='turn'?24:6);k++){
  const s=P.deal(street,type,rand);assert(s,`dealt a ${street} ${type} spot`);
  const tag=`${street} ${type} ${s.hero.map(name)} | ${s.board.map(name)} v ${s.villain.map(name)}`;
  assert(type==='all'||s.draw.type===type,'draw type '+tag);
  assert(cmp(s.hero.map(name).concat(s.board.map(name)),s.villain.map(name).concat(s.board.map(name)))<0,'you start behind '+tag);
  const r=recount(s);
  assert.strictEqual(s.solved.win,r.w,'wins '+tag);assert.strictEqual(s.solved.tie,r.t,'splits '+tag);assert.strictEqual(s.solved.total,r.n,'runouts '+tag);
  assert.strictEqual(r.n,street==='turn'?44:990,'unseen cards '+tag);
  // On the river an out is exactly a card that wins with one card to come.
  for(const c of s.solved.cards){const run=[name(c.c)],d=Math.sign(cmp(s.hero.map(name).concat(s.board.map(name),run),s.villain.map(name).concat(s.board.map(name),run)));
    assert.strictEqual(c.res==='out'?1:c.res==='split'?0:-1,d,`card ${name(c.c)} ${tag}`)}
  const {need}=P.priceOf(s.pot,s.bet),e=P.evOf(s.solved.eq,s.pot,s.bet);
  assert(Math.abs(e-(s.solved.eq-need)*(s.pot+2*s.bet))<1e-9,'EV is (equity − price) × final pot '+tag);
  for(const act of ['call','fold']){
    const j=P.judge(s,act),loss=act===j.best?0:Math.abs(e),ratio=loss/(s.pot+2*s.bet);
    const want=ratio<=.01?'right':ratio<=.07?'close':'wrong';
    assert.strictEqual(j.v,want,`${act} graded ${j.label} at a ${(100*ratio).toFixed(1)}% loss ${tag}`);
    assert(!/undefined|NaN/.test(P.outsText(s)+P.priceText(s)+P.verdictText(s,act,j)),'texts '+tag);
    checks++;
  }
  checks+=4;
}
module.exports=checks;
console.log('PASS: '+checks+' pot odds and draws checks');
