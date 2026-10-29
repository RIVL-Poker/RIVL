/* RIVL hand stats: what a player did in each hand, and the totals the Profile shows (player-stats.js).
   Bot practice (script.js) and the room server (worker/rooms.js) both describe a finished hand the same way, as one small
   record per player. The Directory (worker/directory.js) works every count out of those records with count(), so a hand
   counts the same way in every mode and any total can be rebuilt from the records. Every count is a whole number, so
   totals add up exactly, whatever order the records come in. */
(function(root){
const LABELS=['Brilliant','Best','Excellent','Good','Inaccuracy','Mistake','Blunder'];
const POS=['EP','MP','CO','BTN','SB','BB'];
const STREETS=['Preflop','Flop','Turn','River'];
// Graded decisions are grouped by kind: folding, checking or calling, betting or raising.
const KINDS=['fold','call','raise'];
const MODES=['practice','casual','ranked','freeroll'];
// Each hand's full record is kept this long (for replays); the counts it adds to stay for good.
const HAND_DAYS=90;
const SUIT={S:'s',H:'h',D:'d',C:'c','♠':'s','♥':'h','♦':'d','♣':'c'};
const cards=list=>(list||[]).map(c=>c[0]+(SUIT[c[1]]||'')).join('');

// Seats are numbered from the small blind: 0 small blind, 1 big blind, 2 first to act before the flop ... last the button.
// Heads-up the button posts the small blind, so it is seat 0.
function position(n,k){
  if(k===0)return 'SB';if(k===1)return 'BB';
  const j=k-2,m=n-2;
  if(j===m-1)return 'BTN';if(j===m-2)return 'CO';
  return j<Math.floor((m-2)/2)?'EP':'MP';
}

// Graded decisions are summed as [decisions, Σ accuracy×weight, Σ weight, Σ big blinds given up], with accuracy in
// hundredths of a percent, weight in thousandths and big blinds in hundredths, so every sum is a whole number.
const cell=()=>[0,0,0,0];
function blank(){
  return {h:0,vpip:0,pfr:0,tbo:0,tb:0,ft3o:0,ft3:0,sto:0,st:0,cbo:0,cb:0,fcbo:0,fcb:0,sf:0,sd:0,wsd:0,won:0,net:0,
    bets:[0,0,0,0],calls:[0,0,0,0],checks:[0,0,0,0],folds:[0,0,0,0],labels:LABELS.map(()=>0),
    g:cell(),gx:Array.from({length:STREETS.length*KINDS.length},cell),gp:POS.map(cell)};
}
const sum=(x,y)=>Array.isArray(x)?x.map((v,i)=>sum(v,Array.isArray(y)?y[i]:0)):x+(Number(y)||0);
// Adds b into a. Keys a does not have are ignored, so start from blank().
function add(a,b){if(b)for(const k of Object.keys(a))a[k]=sum(a[k],b[k]);return a}
const total=list=>list.reduce((t,c)=>add(t,c),blank());

/* One player's record of a finished hand:
   [players dealt in, their seat (numbered as above), big blind, actions, net chips, chips won, hole cards, board, grades].
   Actions run street by street ('/' between streets, ',' between actions), each one a seat number and f (fold), k (check),
   c (call) or r (bet or raise) with the total raised to: "2r60,3f,0f,1c/1k,2r80,1f". Blinds are not listed.
   Chips won leave out an uncalled bet that comes back. Grades are
   [which action (counting from 0 over the whole hand), label, accuracy×100, weight×1000, big blinds given up×100].
   log: every action in the hand as {seat,street,type,to,grade}, with grade as rating.js gives it, for `me` only. */
function pack({order,me,bb,log,net,won,hole,board}){
  const at=s=>order.indexOf(s),streets=[[],[],[],[]],grades=[];let i=0;
  for(const e of log){
    const k=at(e.seat),s=Math.max(0,Math.min(3,e.street|0));if(k<0)continue;
    streets[s].push(k+e.type+(e.type==='r'?Math.round(e.to):''));
    const g=e.seat===me&&e.grade,l=g?LABELS.indexOf(g.label):-1;
    if(l>=0)grades.push([i,l,Math.round(g.acc*100),Math.round(g.weight*1000),Math.round(g.lossBB*100)]);
    i++;
  }
  while(streets.length>1&&!streets[streets.length-1].length)streets.pop();
  return [order.length,at(me),Math.round(bb),streets.map(s=>s.join(',')).join('/'),Math.round(net),Math.max(0,Math.round(won)),cards(hole),cards(board),grades];
}

const ACT=/^([0-8])([fkc]|r\d{1,9})$/,HOLE=/^(?:[2-9TJQKA][shdc]){0,2}$/,BOARD=/^(?:[2-9TJQKA][shdc]){0,5}$/;
const int=(x,lo,hi)=>Number.isInteger(x)&&x>=lo&&x<=hi;
function actions(acts){
  const list=[];
  String(acts).split('/').forEach((s,street)=>{if(s)for(const a of s.split(',')){const m=ACT.exec(a);list.push(m?{street,k:+m[1],t:m[2][0],to:+m[2].slice(1)||0}:null)}});
  return list;
}
// A record from a browser is checked before it counts: the right shape, sizes that make sense, seats that exist.
function valid(r){
  if(!Array.isArray(r)||r.length!==9)return false;
  const [n,me,bb,acts,net,won,hole,board,grades]=r;
  if(!int(n,2,9)||!int(me,0,n-1)||!int(bb,1,1e9)||!int(net,-1e9,1e9)||!int(won,0,1e9))return false;
  if(typeof acts!=='string'||acts.length>900||acts.split('/').length>4||typeof hole!=='string'||!HOLE.test(hole)||typeof board!=='string'||!BOARD.test(board))return false;
  const list=actions(acts);
  if(list.length>120||list.some(a=>!a||a.k>=n))return false;
  return Array.isArray(grades)&&grades.length<=60&&grades.every(x=>Array.isArray(x)&&x.length===5&&int(x[0],0,list.length-1)&&list[x[0]].k===me&&
    int(x[1],0,LABELS.length-1)&&int(x[2],0,10000)&&int(x[3],0,1e6)&&int(x[4],0,1e9));
}

/* The counts one hand adds, the way tracking software counts them:
   VPIP: called or raised before the flop. PFR: raised before the flop.
   3-bet: re-raised when facing exactly one raise (the chance counts once a hand). Fold to 3-bet: folded after opening and
   being re-raised. Steal: opened from the cutoff, button or small blind when everyone before folded.
   C-bet: bet the flop first after making the last raise before it. Fold to c-bet: folded to that bet.
   Saw flop, went to showdown, won at showdown (chips from a contested pot), won the hand; net is in hundredths of a big blind. */
function count(rec){
  const [n,me,bb,acts,net,won,,board,grades]=rec,c=blank(),pos=position(n,me),list=actions(acts);
  c.h=1;
  const folded=new Set();
  let raises=0,opener=-1,aggr=-1,open=true,first=true,flopBets=0,cbet=false,foldedPre=false;
  for(const a of list){
    const mine=a.k===me;
    if(a.street===0){
      if(mine){
        if(first){first=false;if(open&&(pos==='CO'||pos==='BTN'||pos==='SB')){c.sto=1;if(a.t==='r')c.st=1}}
        if(raises===1&&opener!==me&&!c.tbo){c.tbo=1;if(a.t==='r')c.tb=1}
        if(raises===2&&opener===me&&!c.ft3o){c.ft3o=1;if(a.t==='f')c.ft3=1}
        if(a.t==='c'||a.t==='r')c.vpip=1;
        if(a.t==='r')c.pfr=1;
        if(a.t==='f')foldedPre=true;
      }
      if(a.t==='r'){raises++;if(raises===1)opener=a.k;aggr=a.k}
      if(a.t==='c'||a.t==='r')open=false;
    }else if(a.street===1){
      if(mine&&aggr===me&&flopBets===0&&!c.cbo){c.cbo=1;if(a.t==='r')c.cb=1}
      if(mine&&cbet&&flopBets===1&&aggr!==me&&!c.fcbo){c.fcbo=1;if(a.t==='f')c.fcb=1}
      if(a.t==='r'){if(flopBets===0&&a.k===aggr)cbet=true;flopBets++}
    }
    if(mine)(a.t==='r'?c.bets:a.t==='c'?c.calls:a.t==='k'?c.checks:c.folds)[a.street]++;
    if(a.t==='f')folded.add(a.k);
  }
  if(!foldedPre&&board.length>=6)c.sf=1;
  if(!folded.has(me)&&n-folded.size>=2){c.sd=1;if(won>0)c.wsd=1}
  if(won>0)c.won=1;
  c.net=Math.round(net*100/bb);
  const p=POS.indexOf(pos);
  for(const [i,l,acc,w,loss] of grades){
    const a=list[i];if(!a)continue;
    const kind=a.t==='f'?0:a.t==='r'?2:1;
    for(const x of [c.g,c.gx[a.street*KINDS.length+kind],c.gp[p]]){x[0]++;x[1]+=acc*w;x[2]+=w;x[3]+=loss}
    c.labels[l]++;
  }
  return c;
}

// What the Profile shows for a set of counts. Percentages are null until there is a chance to measure them.
const pct=(a,b)=>b?100*a/b:null;
const accOf=x=>x[2]?x[1]/x[2]/100:null;
function rates(c){
  const post=k=>c[k][1]+c[k][2]+c[k][3];
  return {hands:c.h,vpip:pct(c.vpip,c.h),pfr:pct(c.pfr,c.h),threeBet:pct(c.tb,c.tbo),foldTo3:pct(c.ft3,c.ft3o),steal:pct(c.st,c.sto),
    cbet:pct(c.cb,c.cbo),foldToCbet:pct(c.fcb,c.fcbo),af:post('calls')?post('bets')/post('calls'):post('bets')?Infinity:null,
    sawFlop:pct(c.sf,c.h),wtsd:pct(c.sd,c.sf),wsd:pct(c.wsd,c.sd),won:pct(c.won,c.h),
    // net and losses are in hundredths of a big blind per hand, which is big blinds per 100 hands.
    bb100:c.h?c.net/c.h:null,loss100:c.h?c.g[3]/c.h:null,
    decisions:c.g[0],acc:accOf(c.g),
    streets:STREETS.map((name,s)=>{const x=KINDS.reduce((t,k,i)=>sum(t,c.gx[s*KINDS.length+i]),cell());return {name,n:x[0],acc:accOf(x),lossBB:x[3]/100}}),
    seats:POS.map((name,i)=>({name,n:c.gp[i][0],acc:accOf(c.gp[i]),lossBB:c.gp[i][3]/100})),
    // Biggest leaks: the street and kind of decision that gave up the most big blinds.
    leaks:c.gx.map((x,i)=>({street:STREETS[Math.floor(i/KINDS.length)],kind:KINDS[i%KINDS.length],n:x[0],acc:accOf(x),lossBB:x[3]/100}))
      .filter(x=>x.n&&x.lossBB>0).sort((a,b)=>b.lossBB-a.lossBB),
    labels:LABELS.map((name,i)=>({name,n:c.labels[i]}))};
}

root.RivlHandStats={LABELS,POS,STREETS,KINDS,MODES,HAND_DAYS,position,blank,add,total,pack,valid,count,rates,cards};
})(typeof window!=='undefined'?window:globalThis);
