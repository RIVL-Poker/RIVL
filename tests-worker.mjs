// Simulates the room server (worker/rooms.js) and the directory (worker/directory.js)
// with in-memory storage, an in-memory SQLite database and fake sockets.
// Run: node tests-worker.mjs
import worker,{Room,Directory} from './worker/rooms.js';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

function fakeState(){
  const store=new Map(),sockets=[];let alarm=null;
  return {sockets,get alarm(){return alarm},
    storage:{get:async k=>structuredClone(store.get(k)),put:async(k,v)=>{store.set(k,structuredClone(v))},setAlarm:async t=>{alarm=t},deleteAlarm:async()=>{alarm=null},deleteAll:async()=>store.clear(),has:k=>store.has(k)},
    acceptWebSocket:ws=>sockets.push(ws),getWebSockets:()=>sockets.filter(ws=>ws.readyState===1)};
}
function fakeSocket(){
  let attachment=null;const ws={readyState:1,messages:[],
    send:m=>ws.messages.push(JSON.parse(m)),close:()=>{ws.readyState=3},
    serializeAttachment:a=>{attachment=a},deserializeAttachment:()=>attachment,
    last:type=>ws.messages.filter(m=>m.type===type).at(-1)};
  return ws;
}
async function post(room,path,body){const r=await room.fetch(new Request('https://room'+path,{method:'POST',body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}}
async function connect(room,state,token){const ws=fakeSocket();state.acceptWebSocket(ws);await room.webSocketMessage(ws,JSON.stringify({type:'auth',token}));return ws}
const say=(room,ws,msg)=>room.webSocketMessage(ws,JSON.stringify(msg));
const chips=g=>g.players.reduce((s,p)=>s+p.stack,0)+g.pot;

async function setup(bots=2,humans=2){
  const state=fakeState(),room=new Room(state,{});
  const host=(await post(room,'/create',{name:'Host'})).data;
  const hostWs=await connect(room,state,host.token);
  const players=[{token:host.token,ws:hostWs}];
  for(let i=1;i<humans;i++){const j=(await post(room,'/join',{name:'P'+i})).data;players.push({token:j.token,ws:await connect(room,state,j.token)})}
  for(let i=0;i<bots;i++)await say(room,hostWs,{type:'addBot',seat:humans+i,level:['Beginner','Intermediate','Advanced','Expert'][i%4]});
  return {state,room,players,hostWs};
}

let checks=0;
// 1. Random full matches: chips are conserved in every hand, no stuck turns, matches end.
for(let match=0;match<60;match++){
  const humans=1+match%3,bots=1+match%6;
  const {room,state,players,hostWs}=await setup(bots,humans);
  await say(room,hostWs,{type:'startMatch'});
  let hand=0,total=chips(room.room.game),steps=0;
  while(!room.matchOver()&&steps++<20000){
    const g=room.room.game;
    if(g.handNumber!==hand){hand=g.handNumber;total=chips(g)}
    assert.equal(chips(g),total,'chips conserved within a hand');
    if(g.phase==='showdown'){
      // A table where every human sat out waits; bring one back as a reconnect would.
      if(room.humansAway(g)){const p=g.players.find(x=>!x.bot&&x.away),pl=players.find(x=>room.room.members[x.token].seat===p.seat);pl.ws=await connect(room,state,pl.token);assert.ok(!p.away)}
      g.nextHandAt=0;await room.alarm();continue}
    const me=players.find(p=>room.room.members[p.token]?.seat===g.turn);
    if(!me||Math.random()<.05){g.deadline=0;await room.alarm();continue}
    const l=room.legal(g.turn),r=Math.random();
    const msg=r<.15?{action:'fold'}:r<.6?{action:l.check?'check':'call'}:r<.8&&l.canRaise?{action:'raise',amount:l.raiseToMin+Math.floor(Math.random()*(l.raiseToMax-l.raiseToMin+1))}:r<.85&&l.canRaise?{action:'allin'}:{action:l.check?'check':'call'};
    await say(room,me.ws,{type:'action',...msg});
    assert.ok(!me.ws.last('error')||!/Invalid|below|Cannot/.test(me.ws.last('error').error),me.ws.last('error')?.error);
  }
  assert.ok(room.matchOver(),'match finished (blinds escalate)');
  checks++;
}

// 2. Showdown reveals every non-folded hand to everyone.
{
  const {room,players,hostWs}=await setup(0,2);
  await say(room,hostWs,{type:'startMatch'});
  while(room.room.game.phase!=='showdown'){const g=room.room.game;const me=players.find(p=>room.room.members[p.token].seat===g.turn);await say(room,me.ws,{type:'action',action:room.legal(g.turn).check?'check':'call'})}
  const view=players[1].ws.last('state').state.game;
  assert.equal(Object.keys(view.shown).length,2);assert.match(view.result,/with/);
  checks++;
}

// 3. Reconnecting with the saved token restores the seat; an unknown token is refused.
{
  const {room,state,players}=await setup(1,2);
  players[1].ws.close();
  const again=await connect(room,state,players[1].token);
  assert.equal(again.last('state').state.mySeat,1);
  const stranger=await connect(room,state,'nope');
  assert.equal(stranger.last('removed')?.type,'removed');assert.equal(stranger.readyState,3);
  checks++;
}

// 4. Players who time out twice sit out and are auto-folded; the table keeps moving and resumes on reconnect.
{
  const {room,state,players,hostWs}=await setup(2,2);
  await say(room,hostWs,{type:'startMatch'});
  for(let i=0;i<200&&!room.room.game.players.find(p=>p.seat===1).away;i++){
    const g=room.room.game;if(g.phase==='showdown'){g.nextHandAt=0;await room.alarm();continue}
    if(g.turn===0){await say(room,hostWs,{type:'action',action:room.legal(0).check?'check':'call'});continue}
    g.deadline=0;await room.alarm();
  }
  assert.ok(room.room.game.players.find(p=>p.seat===1).away,'player marked away');
  await connect(room,state,players[1].token);
  assert.ok(!room.room.game.players.find(p=>p.seat===1).away,'reconnect clears away');
  checks++;
}

// 5. Leaving: before a match frees the seat; host leaving hands host to the next human; mid-match leaver is folded out.
{
  const {room,players,hostWs}=await setup(1,3);
  await say(room,players[2].ws,{type:'leave'});
  assert.equal(room.room.seats[2],null);
  await say(room,hostWs,{type:'leave'});
  assert.equal(room.room.hostToken,players[1].token);assert.ok(room.room.seats[1].isHost);
  const j=(await post(room,'/join',{name:'Late'})).data;
  await say(room,players[1].ws,{type:'removePlayer',seat:j.seat});
  assert.equal(room.room.seats[j.seat],null,'host can remove a human before the match');
  await say(room,players[1].ws,{type:'startMatch'});
  assert.equal((await post(room,'/join',{name:'X'})).status,409,'no joining mid-match');
  await say(room,players[1].ws,{type:'leave'});
  assert.equal(room.room,null,'room closes when the last human leaves');
  checks++;
}

// 6. Idle rooms are deleted by the alarm.
{
  const {room,state,players}=await setup(1,1);
  players[0].ws.close();room.room.lastActive=Date.now()-7*3600*1000;
  await room.alarm();
  assert.equal(room.room,null);assert.ok(!state.storage.has('room'));
  checks++;
}

// 7. Bots raise sometimes and do not only check/call.
{
  let raises=0;
  for(let n=0;n<20;n++){const {room,hostWs}=await setup(5,1);await say(room,hostWs,{type:'startMatch'});const orig=room.applyAction.bind(room);room.applyAction=(s,a,x)=>{if(a==='raise')raises++;return orig(s,a,x)};for(let i=0;i<40&&!room.matchOver();i++){const g=room.room.game;if(g.phase==='showdown')g.nextHandAt=0;else g.deadline=0;await room.alarm()}}
  assert.ok(raises>10,'bots raised '+raises+' times');
  checks++;
}

// ---------- Directory: accounts, online ratings, lobby, free-plan budget ----------
function fakeSql(){
  const db=new DatabaseSync(':memory:');
  return {exec(q,...b){const st=db.prepare(q);const rows=/^\s*SELECT/i.test(q)?st.all(...b):(st.run(...b),[]);return {toArray:()=>rows}}};
}
function makeEnv(vars={}){
  const ns=(make)=>{const instances=new Map();return {instances,idFromName:n=>n,get:id=>{if(!instances.has(id))instances.set(id,make());const obj=instances.get(id);return {fetch:(url,init)=>obj.fetch(new Request(url,init))}}}};
  const env={...vars};
  env.DIRECTORY=ns(()=>new Directory({storage:{sql:fakeSql()}},env));
  env.ROOMS=ns(()=>{const state=fakeState();const room=new Room(state,env);room.fakeState=state;return room});
  return env;
}
async function api(env,path,body){
  const r=await worker.fetch(new Request('https://rivl.test'+path,body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),env);
  return {status:r.status,data:await r.json()};
}
const roomOf=(env,code)=>env.ROOMS.instances.get(code);
async function sit(env,code,token){const room=roomOf(env,code);return connect(room,room.fakeState,token)}

// 8. Accounts: names are validated and unique; a key signs in; a room seat uses the account name and is marked verified.
{
  const env=makeEnv();
  assert.equal((await api(env,'/api/accounts',{name:'x'})).status,400);
  const ann=(await api(env,'/api/accounts',{name:'Ann'})).data;
  assert.ok(ann.key&&ann.account.rating===1500);
  assert.equal((await api(env,'/api/accounts',{name:'ann'})).status,409,'names are unique ignoring case');
  assert.equal((await api(env,'/api/me',{key:ann.key})).data.account.name,'Ann');
  assert.equal((await api(env,'/api/me',{key:'x'.repeat(30)})).status,401);
  const created=(await api(env,'/api/rooms',{name:'ignored',key:ann.key})).data;
  const room=roomOf(env,created.code);
  assert.equal(room.room.seats[0].name,'Ann');assert.ok(room.room.seats[0].verified);
  const bob=(await api(env,'/api/accounts',{name:'Bob'})).data;
  const j1=(await api(env,'/api/rooms/'+created.code+'/join',{key:bob.key})).data,j2=(await api(env,'/api/rooms/'+created.code+'/join',{key:bob.key})).data;
  assert.equal(j1.token,j2.token,'the same account gets its seat back from another device');
  checks++;
}

// 9. A match with two signed-in players is rated on the server from the real finishing order; a leaver places last.
{
  const env=makeEnv();
  const acc=[];for(const n of ['Ann','Bob','Cat'])acc.push((await api(env,'/api/accounts',{name:n})).data);
  const {code,token}=(await api(env,'/api/rooms',{key:acc[0].key})).data;
  const tokens=[token];for(const a of acc.slice(1))tokens.push((await api(env,'/api/rooms/'+code+'/join',{key:a.key})).data.token);
  const room=roomOf(env,code),sockets=[];for(const t of tokens)sockets.push(await sit(env,code,t));
  await say(room,sockets[0],{type:'addBot',seat:3,level:'Expert'});
  assert.ok(sockets[0].last('state').state.rated);
  await say(room,sockets[0],{type:'startMatch'});
  await say(room,sockets[2],{type:'leave'});   // Cat abandons: counts as last
  for(let i=0;i<20000&&!room.matchOver();i++){
    const g=room.room.game;
    if(g.phase==='showdown'){g.nextHandAt=0;await room.alarm();continue}
    const seat=g.turn,idx=[0,1].find(k=>room.room.members[tokens[k]]?.seat===seat);
    if(idx===undefined){g.deadline=0;await room.alarm();continue}
    const l=room.legal(seat);await say(room,sockets[idx],{type:'action',...(Math.random()<.3&&l.canRaise?{action:'allin'}:{action:l.check?'check':'call'})});
  }
  assert.ok(room.matchOver(),'match finished');
  const changes=room.room.game.ratingChanges;
  assert.equal(changes.length,3,'all three signed-in players rated');
  const cat=changes.find(c=>c.name==='Cat');assert.ok(cat.after<cat.before,'the leaver loses rating');
  const board=(await api(env,'/api/leaderboard')).data.players;
  assert.equal(board.length,3);assert.ok(board.every(p=>p.games===1));
  assert.equal(board.reduce((n,p)=>n+p.wins,0),1,'exactly one winner');
  checks++;
}

// 10. Lobby and Quick Play: public rooms waiting for players are listed and joined; private and started rooms are not listed.
{
  const env=makeEnv();
  const priv=(await api(env,'/api/rooms',{name:'Priv'})).data;
  assert.equal((await api(env,'/api/lobby')).data.rooms.length,0,'private rooms are not listed');
  const q1=(await api(env,'/api/quickplay',{name:'Solo'})).data;
  assert.notEqual(q1.code,priv.code);
  // The lobby list is cached for a few seconds in the worker; read the directory directly here.
  const lobby=async()=>(await env.DIRECTORY.get('global').fetch('https://dir/lobby')).json();
  assert.deepEqual((await lobby()).rooms.map(r=>r.code),[q1.code]);
  const q2=(await api(env,'/api/quickplay',{name:'Second'})).data;
  assert.equal(q2.code,q1.code,'quick play joins the open table');
  const room=roomOf(env,q1.code),ws=await sit(env,q1.code,q1.token);
  await say(room,ws,{type:'startMatch'});
  assert.equal((await lobby()).rooms.length,0,'started rooms leave the lobby');
  checks++;
}

// 11. Free-plan budget: new rooms and matches stop at the daily limit; running matches stop at the hard limit.
{
  const env=makeEnv({DAILY_ROOM_LIMIT:'2',DAILY_HAND_LIMIT:'4'});
  const a=(await api(env,'/api/rooms',{name:'A'})).data;await api(env,'/api/rooms',{name:'B'});
  const third=await api(env,'/api/rooms',{name:'C'});
  assert.equal(third.status,503);assert.match(third.data.error,/free capacity/);
  const room=roomOf(env,a.code),ws=await sit(env,a.code,a.token);
  await say(room,ws,{type:'addBot',seat:1,level:'Beginner'});
  await say(room,ws,{type:'startMatch'});
  for(let i=0;i<5000&&!room.matchOver();i++){const g=room.room.game;if(g.phase==='showdown'){g.nextHandAt=0;await room.alarm()}else if(g.turn===0)await say(room,ws,{type:'action',action:room.legal(0).check?'check':'fold'});else{g.deadline=0;await room.alarm()}}
  assert.ok(room.matchOver());assert.match(room.room.game.note,/free capacity/);
  assert.ok(room.room.game.handNumber<=5,'hands stop at 125% of the limit');
  await say(room,ws,{type:'startMatch'});
  assert.match(ws.last('error').error,/free capacity/,'no new match once the day is used up');
  assert.ok((await api(env,'/api/status')).data.busy);
  checks++;
}

console.log('PASS: '+checks+' room server checks');
