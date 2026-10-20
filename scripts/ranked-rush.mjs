// Ranked queue rush: creates N accounts, then has them all press Find Ranked Match within SPREAD ms.
// Run against `npx wrangler dev` with [[ratelimits]] removed and the DAILY_* limits raised.
// usage: node scripts/ranked-rush.mjs <baseUrl> <players> <spreadMs>
const [base='http://127.0.0.1:8787',N=600,SPREAD=5000]=process.argv.slice(2).map((v,i)=>i?Number(v):v);
const post=async(p,b)=>{const t=performance.now();const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return {status:r.status,data:await r.json().catch(()=>({})),ms:performance.now()-t}};
const run='r'+Math.random().toString(36).slice(2,7);
const keys=[];
for(let i=0;i<N;i+=50){const batch=await Promise.all(Array.from({length:Math.min(50,N-i)},(_,j)=>post('/api/accounts',{name:run+'_'+(i+j)})));for(const b of batch){if(!b.data.key)throw Error(JSON.stringify(b.data));keys.push(b.data.key)}}
const res=await Promise.all(keys.map(async k=>{await new Promise(r=>setTimeout(r,Math.random()*SPREAD));return post('/api/ranked',{key:k,size:6})}));
const ok=res.filter(r=>r.status===200),codes=new Map();for(const r of ok)codes.set(r.data.code,(codes.get(r.data.code)||0)+1);
const hist={};for(const n of codes.values())hist[n]=(hist[n]||0)+1;
const lat=res.map(r=>r.ms).sort((a,b)=>a-b),q=p=>Math.round(lat[Math.floor(p*(lat.length-1))]);
const errs={};for(const r of res)if(r.status!==200)errs[r.status+' '+(r.data.error||'')]=(errs[r.status+' '+(r.data.error||'')]||0)+1;
console.log(JSON.stringify({players:N,seated:ok.length,tables:codes.size,playersPerTable:hist,fullTablesShare:+((hist[6]||0)*6/ok.length).toFixed(2),latencyMs:{p50:q(.5),p95:q(.95),max:q(1)},errors:errs}));
