// Load test for the rooms server: opens N tables of simulated players who act after a think time.
// Run against `npx wrangler dev -c <config without [[ratelimits]]>` or a test deployment with rate limits raised.
// usage: node scripts/load-test.mjs <baseUrl> <tables> <seconds> <humans> <bots> <thinkMinMs> <thinkMaxMs>
const [base='http://127.0.0.1:8787',TABLES=50,SECS=60,H=4,B=4,TMIN=1500,TMAX=4000]=process.argv.slice(2).map((v,i)=>i?Number(v):v);
const wsBase=base.replace(/^http/,'ws');
const stats={http:0,httpErr:0,wsOpen:0,wsClose:0,sent:0,recv:0,errors:{},lat:[],hands:new Map(),tables:0};
const post=async(path,body)=>{stats.http++;const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok){stats.httpErr++;throw Error(d.error)}return d};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let stopping=false;
function player(code,token,onState){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(wsBase+'/ws/'+code);let pending=null;
    ws.onopen=()=>{stats.wsOpen++;ws.send(JSON.stringify({type:'auth',token}));stats.sent++;resolve(ws)};
    ws.onerror=e=>reject(e);ws.onclose=()=>stats.wsClose++;
    ws.onmessage=ev=>{stats.recv++;const m=JSON.parse(ev.data);
      if(m.type==='error'){stats.errors[m.error]=(stats.errors[m.error]||0)+1;return}
      if(m.type!=='state')return;
      if(pending&&m.state.game?.handNumber!==undefined){stats.lat.push(performance.now()-pending);pending=null}
      onState(m.state,(msg)=>{if(stopping||ws.readyState!==1)return;stats.sent++;pending=performance.now();ws.send(JSON.stringify(msg))});
    };
  });
}
async function table(i){
  await sleep(i*20);
  const host=await post('/api/rooms',{name:'H'+i});const code=host.code;
  const tokens=[host.token];
  for(let h=1;h<H;h++)tokens.push((await post('/api/rooms/'+code+'/join',{name:'P'+h})).token);
  const acting=new Set();
  const sockets=[];
  for(const t of tokens)sockets.push(await player(code,t,(state,send)=>{
    const g=state.game;if(!g)return;
    stats.hands.set(code,g.handNumber);
    const l=g.legal;const key=g.handNumber+':'+g.phase+':'+g.turn+':'+g.currentBet;
    if(!l||acting.has(t+key))return;acting.add(t+key);
    setTimeout(()=>{const r=Math.random();send({type:'action',...(r<.15&&!l.check?{action:'fold'}:r<.85||!l.canRaise?{action:l.check?'check':'call'}:{action:'raise',amount:l.raiseToMin})})},TMIN+Math.random()*(TMAX-TMIN));
  }));
  const hostWs=sockets[0];
  for(let b=0;b<B;b++){hostWs.send(JSON.stringify({type:'addBot',seat:H+b,level:['Beginner','Intermediate','Advanced','Expert'][b%4]}));stats.sent++}
  await sleep(300);hostWs.send(JSON.stringify({type:'startMatch'}));stats.sent++;
  stats.tables++;
  return sockets;
}
const t0=performance.now();
const all=await Promise.allSettled(Array.from({length:TABLES},(_,i)=>table(i)));
const failed=all.filter(x=>x.status==='rejected');
console.log('tables up',stats.tables,'failed',failed.length,failed[0]?.reason?.message||'', 'setup s',((performance.now()-t0)/1000).toFixed(1));
const s0={...stats,sent:stats.sent,recv:stats.recv};const h0=[...stats.hands.values()].reduce((a,b)=>a+b,0);const lat0=stats.lat.length;
await sleep(SECS*1000);
stopping=true;
const lat=stats.lat.slice(lat0).sort((a,b)=>a-b),q=p=>lat[Math.floor(p*(lat.length-1))]?.toFixed(0);
const hands=[...stats.hands.values()].reduce((a,b)=>a+b,0)-h0;
console.log(JSON.stringify({tables:stats.tables,seconds:SECS,clientMsgsSent:stats.sent-s0.sent,serverMsgsRecv:stats.recv-s0.recv,hands,actionLatencyMs:{p50:q(.5),p95:q(.95),p99:q(.99),max:q(1)},wsClosed:stats.wsClose,errors:stats.errors}));
process.exit(0);
