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

// Side pots: unmatched all-in bets must be refunded, never lost or counted as winnings.
{
  const {room,hostWs}=await setup(0,3);
  await say(room,hostWs,{type:'startMatch'});
  const g=room.room.game;
  g.board=['2S','3H','4D','8C','9S'];
  g.hands={0:['AS','AH'],1:['KS','KH'],2:['QS','QH']};
  const amounts=[100,200,500];
  for(let i=0;i<3;i++){g.players[i].stack=1000-amounts[i];g.players[i].contribution=amounts[i];g.players[i].bet=amounts[i];g.players[i].allIn=false;g.players[i].folded=false}
  g.pot=amounts.reduce((a,b)=>a+b,0);
  const total=chips(g);
  room.finishHand();
  assert.equal(chips(g),total,'unmatched bets cannot make chips disappear');
  assert.deepEqual(g.players.map(p=>p.stack),[1200,1000,800],'main and side pots go to eligible winners; uncalled 300 is returned');
  assert.equal(g.pot,0);
  checks++;
}

// Deterministic hand-ranking and tied-showdown edge cases.
{
  const {room,hostWs}=await setup(0,3);
  await say(room,hostWs,{type:'startMatch'});
  const val=cards=>room.handValue(cards);
  assert.equal(val(['AS','2H','3D','4C','5S'])[0],4,'wheel is a straight');
  assert.equal(val(['AS','2H','3D','4C','5S'])[1],5,'wheel is five-high');
  assert.ok(room.compare(val(['TS','JS','QS','KS','AS']),val(['9S','TS','JS','QS','KS']))>0,'higher straight flush wins');
  assert.ok(room.compare(val(['AS','AH','AD','AC','2S']),val(['KS','KH','KD','KC','AS']))>0,'higher quads win');
  assert.ok(room.compare(val(['AS','AH','AD','KS','KH']),val(['QS','QH','QD','AS','AH']))>0,'full house compares trips first');
  assert.ok(room.compare(val(['AS','KS','QS','JS','9S']),val(['AH','KH','QH','JH','8H']))>0,'flush kickers break ties');
  const g=room.room.game;
  g.board=['AS','KS','QS','JS','TS'];
  g.hands={0:['2H','3D'],1:['4H','5D'],2:['6H','7D']};
  const amounts=[101,101,101];
  for(let i=0;i<3;i++){g.players[i].stack=1000-amounts[i];g.players[i].contribution=amounts[i];g.players[i].bet=amounts[i];g.players[i].folded=false}
  g.pot=303;
  const total=chips(g);
  room.finishHand();
  assert.equal(chips(g),total,'tied showdown conserves chips');
  assert.deepEqual(g.players.map(p=>p.stack),[1000,1000,1000],'three-way board tie splits equally');
  assert.equal(g.winners.length,3);
  checks++;
}

// Raises use five-chip increments; a genuine all-in remains legal.
{
  const {room,hostWs}=await setup(0,2);
  await say(room,hostWs,{type:'startMatch'});
  const g=room.room.game,seat=g.turn,p=g.players.find(x=>x.seat===seat),l=room.legal(seat);
  const invalid=l.raiseToMin+1;
  if(invalid<l.raiseToMax){assert.throws(()=>room.applyAction(seat,'raise',invalid),/increments of 5/);assert.equal(p.contribution,p.bet,'invalid raise does not move chips')}
  const valid=Math.ceil(l.raiseToMin/5)*5;
  if(valid<=l.raiseToMax){room.applyAction(seat,'raise',valid);assert.equal(p.bet,valid)}
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

// 8. Bots think for a random 2–5 seconds before every move instead of acting at once.
{
  const {room,state,hostWs}=await setup(3,1);await say(room,hostWs,{type:'startMatch'});
  const delays=new Set(),moves=[],orig=room.applyAction.bind(room);
  room.applyAction=(s,a,x)=>{moves.push(s);return orig(s,a,x)};
  for(let i=0;i<30&&!room.matchOver();i++){
    const g=room.room.game;
    if(g.phase==='showdown'){g.nextHandAt=0;await room.alarm();continue}
    if(g.turn===0){await say(room,hostWs,{type:'action',action:room.legal(0).check?'check':'call'});continue}
    const seat=g.turn,left=g.deadline-Date.now();
    assert.ok(g.players.find(p=>p.seat===seat).bot,'only a bot can hold the turn here');
    assert.ok(g.botThinking&&left>1900&&left<=5000,'bot think time is 2–5 seconds, got '+left+'ms');
    assert.ok(state.alarm<=g.deadline,'an alarm is set for the bot\'s move');
    delays.add(Math.round(left/250));
    await room.alarm();
    assert.equal(room.room.game.turn,seat,'an early alarm does not let the bot act before its time');
    const before=moves.length;
    room.room.game.deadline=Date.now();await room.alarm();
    assert.equal(moves[before],seat,'the bot moves once its time is up');
  }
  assert.ok(delays.size>2,'think times vary from move to move');
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
  assert.ok(ann.key&&ann.account.rating===0);
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

// 9. Ranked is a matchmaking queue: only it is rated, on the server, from the real finishing order; a leaver places last.
{
  const env=makeEnv();
  const acc=[];for(const n of ['Ann','Bob','Cat','Dan','Eve'])acc.push((await api(env,'/api/accounts',{name:n})).data);
  // Guests cannot queue; there is no way to create a Ranked room directly.
  assert.equal((await api(env,'/api/ranked',{name:'Guest'})).status,401);
  const plain=(await api(env,'/api/rooms',{key:acc[0].key,mode:'ranked'})).data;
  assert.ok(!roomOf(env,plain.code).room.ranked,'room creation cannot make a Ranked room');
  // Four players queue one after another and land at the same table.
  const seated=[];for(const a of acc.slice(0,4))seated.push((await api(env,'/api/ranked',{key:a.key})).data);
  const code=seated[0].code,tokens=seated.map(x=>x.token);
  assert.ok(seated.every(x=>x.code===code),'the queue fills one table');
  const room=roomOf(env,code);
  assert.ok(room.room.ranked);assert.equal(room.room.visibility,'private');
  // Ranked tables never show in Open Tables, cannot be joined by code, and Quick Play never lands in one.
  assert.equal((await (await env.DIRECTORY.get('global').fetch('https://dir/lobby')).json()).rooms.length,0);
  const byCode=await api(env,'/api/rooms/'+code+'/join',{key:acc[4].key});
  assert.equal(byCode.status,403);assert.match(byCode.data.error,/matchmade/);
  assert.notEqual((await api(env,'/api/quickplay',{key:acc[4].key})).data.code,code);
  const sockets=[];for(const t of tokens)sockets.push(await sit(env,code,t));
  await say(room,sockets[0],{type:'addBot',seat:5,level:'Expert'});
  assert.match(sockets[0].last('error').error,/no bots/);
  await say(room,sockets[0],{type:'visibility',visibility:'public'});
  assert.equal(room.room.visibility,'private');
  await say(room,sockets[0],{type:'removePlayer',seat:1});
  assert.match(sockets[0].last('error').error,/matchmade/);assert.ok(room.room.seats[1],'the first player cannot kick anyone');
  await say(room,sockets[0],{type:'startMatch'});
  assert.match(sockets[0].last('error').error,/start on their own/);
  const view=sockets[0].last('state').state;assert.ok(view.ranked&&view.rated&&view.startsAt>Date.now(),'a countdown runs once two players sit');
  let sent=null;const dirCall=room.dir.bind(room);room.dir=(path,body)=>{if(path==='/results')sent=body;return dirCall(path,body)};
  room.room.startsAt=Date.now()-1;await room.alarm();   // the countdown ends
  assert.ok(room.room.started&&room.room.game,'the match starts on its own');
  await say(room,sockets[2],{type:'leave'});   // Cat abandons with chips: places last, below anyone who busts later
  const busted=new Set(),bustOrder=[];
  for(let i=0;i<20000&&!room.matchOver();i++){
    const g=room.room.game;
    for(const p of g.players)assert.ok(!busted.has(p.seat),'a busted player is not dealt back in');
    if(g.phase==='showdown'){for(const p of g.players)if(p.stack===0&&!busted.has(p.seat)){busted.add(p.seat);bustOrder.push(p.seat)}g.nextHandAt=0;await room.alarm();continue}
    const seat=g.turn,idx=[0,1,3].find(k=>room.room.members[tokens[k]]?.seat===seat);
    if(idx===undefined){g.deadline=0;await room.alarm();continue}
    const l=room.legal(seat);await say(room,sockets[idx],{type:'action',...(Math.random()<.04&&l.canRaise?{action:'allin'}:{action:l.check?'check':'call'})});
  }
  assert.ok(room.matchOver(),'match finished');
  assert.ok(bustOrder.length>=1,'someone else busted after Cat left');
  const changes=room.room.game.ratingChanges;
  assert.equal(changes.length,4,'all four signed-in players rated');
  const cat=changes.find(c=>c.name==='Cat');assert.equal(cat.before,0,'new ranked accounts begin at zero');assert.equal(cat.after,0,'displayed Elo cannot drop below zero');
  const catInternal=env.DIRECTORY.instances.get('global').sql.exec('SELECT rr FROM accounts WHERE id=?',acc[2].account.id).toArray()[0].rr;
  assert.ok(catInternal<1500,'the leaver loses internal Glicko rating even at the zero display floor');
  // Every explicit action by a Ranked player was graded on the server; long-lasting players have an accuracy.
  const graded=sent.players.filter(p=>p.decisions>0);
  assert.ok(graded.length>=1&&graded.every(p=>p.acc>=0&&p.acc<=100),'ranked decisions are graded on the server');
  assert.equal(sent.players.find(p=>p.id===acc[2].account.id).decisions,0,'Cat made no decisions before leaving');
  assert.ok(changes.every(c=>c.name==='Cat'||c.after>=cat.after),'the leaver cannot outrank others at the zero Elo floor');
  const board=(await api(env,'/api/leaderboard')).data.players;
  assert.equal(board.length,4);assert.ok(board.every(p=>p.games===1));
  assert.ok(board.some(p=>p.name==='Cat'&&p.rating===0),'leaver remains at zero displayed Elo');
  assert.equal(board.reduce((n,p)=>n+p.wins,0),1,'only the match winner is credited a win');
  checks++;
}

// 9c. A Ranked table starts at once when full, the next player opens a new table, and the countdown stops below two players.
{
  const env=makeEnv();
  const keys=[];for(let i=0;i<7;i++)keys.push((await api(env,'/api/accounts',{name:'Rank'+i})).data.key);
  const first=(await api(env,'/api/ranked',{key:keys[0]})).data,second=(await api(env,'/api/ranked',{key:keys[1]})).data;
  const room=roomOf(env,first.code);assert.ok(room.room.startsAt>0);
  await room.webSocketMessage(await sit(env,first.code,second.token),JSON.stringify({type:'leave'}));
  assert.equal(room.room.startsAt,0,'countdown stops when a player leaves the queue');
  for(let i=1;i<6;i++)await api(env,'/api/ranked',{key:keys[i]});
  assert.ok(room.room.started,'a full table of six starts immediately');
  const next=(await api(env,'/api/ranked',{key:keys[6]})).data;
  assert.notEqual(next.code,first.code,'started tables leave the queue');
  checks++;
}

// 9a. Ranked Elo blends place (60%) with decision accuracy (40%); too few graded decisions means place only.
{
  const env=makeEnv();
  const ids=[];for(const n of ['Gus','Hal','Ivy','Joe'])ids.push((await api(env,'/api/accounts',{name:n})).data.account.id);
  const results=async body=>(await env.DIRECTORY.get('global').fetch('https://dir/results',{method:'POST',body:JSON.stringify(body)})).json();
  // Same finish both times; in the second match the loser played far better.
  const plain=await results({matchId:'m1',players:[{id:ids[0],place:1,acc:70,decisions:10},{id:ids[1],place:2,acc:70,decisions:10}]});
  const skill=await results({matchId:'m2',players:[{id:ids[2],place:1,acc:40,decisions:10},{id:ids[3],place:2,acc:98,decisions:10}]});
  const gain=r=>r.changes[0].after-r.changes[0].before;
  assert.ok(gain(skill)<gain(plain),'a winner with poor decisions gains less');
  const internal=id=>env.DIRECTORY.instances.get('global').sql.exec('SELECT rr FROM accounts WHERE id=?',id).toArray()[0].rr;
  assert.ok(internal(ids[3])>internal(ids[1]),'a loser with much better decisions loses less internally, even when both display zero');
  assert.equal(skill.changes[1].accuracy,98);
  const few=await results({matchId:'m3',players:[{id:ids[0],place:2,acc:99,decisions:2},{id:ids[1],place:1,acc:10,decisions:10}]});
  assert.equal(few.changes[0].accuracy,null,'fewer than 3 decisions: place only');assert.ok(internal(ids[0])<plain.changes[0].after+1500,'the place-only loss is recorded internally');
  checks++;
}

// 9b. Quick Play and private rooms are unranked even with two signed-in players.
{
  const env=makeEnv();
  const a=(await api(env,'/api/accounts',{name:'Eve'})).data,b=(await api(env,'/api/accounts',{name:'Fay'})).data;
  const {code,token}=(await api(env,'/api/rooms',{key:a.key})).data;
  const t2=(await api(env,'/api/rooms/'+code+'/join',{key:b.key})).data.token;
  const room=roomOf(env,code),ws=[await sit(env,code,token),await sit(env,code,t2)];
  assert.ok(!ws[0].last('state').state.rated,'private room is unranked');
  await say(room,ws[0],{type:'startMatch'});
  await say(room,ws[1],{type:'leave'});
  for(let i=0;i<20&&!room.matchOver();i++){const g=room.room.game;if(g.phase==='showdown')g.nextHandAt=0;else g.deadline=0;await room.alarm()}
  assert.ok(room.matchOver());
  assert.equal(room.room.game.ratingChanges,undefined);
  // The worker caches the leaderboard for a few seconds; read the directory directly.
  assert.equal((await (await env.DIRECTORY.get('global').fetch('https://dir/leaderboard')).json()).players.length,0,'no Elo from unranked rooms');
  assert.equal((await api(env,'/api/me',{key:a.key})).data.account.games,0);
  checks++;
}

// 9d. Leagues: every account carries its league; "My league" lists that league, or the 10 nearest when it is small.
{
  const env=makeEnv();
  const elos=[100,400,450,475,500,525,550,575,600,625,650,800,1900];
  const accts=[];for(let i=0;i<elos.length;i++)accts.push((await api(env,'/api/accounts',{name:'League'+i})).data.account);
  const d=env.DIRECTORY.instances.get('global');
  accts.forEach((a,i)=>d.sql.exec('UPDATE accounts SET rr=?,rgames=1 WHERE id=?',elos[i]+1500,a.id));
  const mine=(await api(env,'/api/leaderboard/league?r=500')).data;
  assert.equal(mine.league,'Challenger');assert.equal(mine.near,false);assert.equal(mine.total,10);
  assert.ok(mine.players.every(p=>p.league==='Challenger'&&p.rating>=350&&p.rating<700),'only Challenger players');
  assert.deepEqual(mine.players.map(p=>p.rating),[...mine.players.map(p=>p.rating)].sort((x,y)=>y-x),'sorted by Elo');
  const champ=(await api(env,'/api/leaderboard/league?r=1950')).data;
  assert.equal(champ.league,'Champion');assert.equal(champ.near,true,'a small league falls back to nearest players');
  assert.equal(champ.players.length,10);assert.equal(champ.players[0].rating,1900);
  assert.equal((await api(env,'/api/leaderboard/league?r=abc')).status,400);
  assert.equal((await (await d.fetch(new Request('https://dir/leaderboard'))).json()).players[0].league,'Champion','the top 50 shows leagues too');
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

// Ranked result delivery survives a temporary Directory outage and retries on alarm.
{
  const {room,state,hostWs}=await setup(0,2);
  await say(room,hostWs,{type:'startMatch'});
  room.room.game.phase='showdown';room.room.game.result='Match complete';
  room.room.pendingResults={matchId:'retry-test',players:[{id:'a',place:1},{id:'b',place:2}]};
  const original=room.dir.bind(room);
  let calls=0;
  room.dir=async(path,body)=>{if(path==='/results'){calls++;if(calls===1)return null;return {rated:true,changes:[{id:'a'}]}}return original(path,body)};
  await room.save();
  assert.ok(room.room.pendingResults,'a failed result delivery remains pending');
  await room.alarm();
  assert.equal(calls,2,'idle alarm retries failed result delivery');
  assert.equal(room.room.pendingResults,null,'successful delivery clears pending results');
  assert.deepEqual(room.room.game.ratingChanges,[{id:'a'}]);
  checks++;
}


// Chat: private and ranked players can exchange authenticated messages; reconnect sees history.
{
  const {room,state,players}=await setup(0,2);
  const [host,guest]=players;
  await say(room,host.ws,{type:'chat',text:'Good luck at the table!'});
  const event=guest.ws.last('chat');
  assert.equal(event.message.name,'Host');assert.equal(event.message.text,'Good luck at the table!');
  assert.equal(host.ws.last('chat').message.seat,0);
  await say(room,host.ws,{type:'chat',text:'spam'});
  assert.match(host.ws.last('error').error,/wait/i,'chat is rate limited');
  await say(room,guest.ws,{type:'chat',text:'<script>alert(1)</script>'});
  assert.equal(host.ws.last('chat').message.text,'<script>alert(1)</script>','chat is plain text');
  await say(room,guest.ws,{type:'chat',text:'x'.repeat(181)});
  assert.match(guest.ws.last('error').error,/180/,'message length checked');
  const stranger=fakeSocket();state.acceptWebSocket(stranger);
  await say(room,stranger,{type:'chat',text:'intrusion'});
  assert.equal(stranger.last('removed').type,'removed','unauthenticated socket is rejected');
  const reconnect=await connect(room,state,guest.token);
  assert.equal(reconnect.last('state').state.chat.length,2,'history persists for reconnect');
  assert.equal(reconnect.last('state').state.chat[0].name,'Host');
  checks++;
}

// Google sign-in: the Worker verifies the ID token (signature, issuer, audience, expiry) before the Directory
// signs in, links or creates an account. Each Google sign-in gets its own device key; sign-out ends only that one.
{
  const {resetGoogleKeys}=await import('./worker/google.js');
  const CLIENT='test-client.apps.googleusercontent.com';
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const other=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
  const realFetch=globalThis.fetch;let certFetches=0;
  globalThis.fetch=async url=>{if(String(url).startsWith('https://www.googleapis.com/oauth2/v3/certs')){certFetches++;return Response.json({keys:[{...jwk,kid:'k1',alg:'RS256',use:'sig'}]},{headers:{'Cache-Control':'public, max-age=3600'}})}return realFetch(url)};
  resetGoogleKeys();
  const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  const token=async(claims={},{key=pair.privateKey,kid='k1'}={})=>{
    const now=Math.floor(Date.now()/1000);
    const body=enc({alg:'RS256',kid,typ:'JWT'})+'.'+enc({iss:'https://accounts.google.com',aud:CLIENT,sub:'g-111',email:'a@example.com',given_name:'Ann',iat:now,exp:now+3600,...claims});
    return body+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(body))).toString('base64url');
  };
  const unset=makeEnv();
  assert.equal((await api(unset,'/api/config')).data.googleClientId,'','no client ID: the page hides the Google button');
  assert.equal((await api(unset,'/api/google',{credential:await token()})).status,503);
  const env=makeEnv({GOOGLE_CLIENT_ID:CLIENT});
  assert.equal((await api(env,'/api/config')).data.googleClientId,CLIENT);
  for(const [claims,opts,why] of [[{aud:'someone-else'},{},'wrong audience'],[{iss:'https://evil.example'},{},'wrong issuer'],[{exp:Math.floor(Date.now()/1000)-600},{},'expired'],[{},{key:other.privateKey},'bad signature'],[{},{kid:'nope'},'unknown key']])
    assert.equal((await api(env,'/api/google',{credential:await token(claims,opts)})).status,401,why);
  assert.equal((await api(env,'/api/google',{credential:'not.a.token'})).status,401);
  // First sign-in asks for a name; the same token then creates the account.
  const first=(await api(env,'/api/google',{credential:await token()})).data;
  assert.deepEqual(first,{needsName:true});
  assert.equal((await api(env,'/api/google',{credential:await token(),name:'x'})).status,400);
  const made=(await api(env,'/api/google',{credential:await token(),name:'Gina'})).data;
  assert.ok(made.created&&made.key&&made.account.google&&made.account.name==='Gina');
  assert.equal((await api(env,'/api/me',{key:made.key})).data.account.name,'Gina','the Google device key works like a sign-in code');
  // Signing in again (another device) returns a different key; both stay valid until signed out.
  const again=(await api(env,'/api/google',{credential:await token()})).data;
  assert.ok(!again.needsName&&again.account.id===made.account.id&&again.key!==made.key);
  await api(env,'/api/signout',{key:again.key});
  assert.equal((await api(env,'/api/me',{key:again.key})).status,401,'signed-out device key stops working');
  assert.equal((await api(env,'/api/me',{key:made.key})).status,200,'other devices stay signed in');
  // A sign-in-code account can connect Google; that Google account then signs in to it.
  const coder=(await api(env,'/api/accounts',{name:'Hank'})).data;
  assert.equal(coder.account.google,false);
  const linked=(await api(env,'/api/google',{credential:await token({sub:'g-222'}),key:coder.key})).data;
  assert.ok(linked.account.google&&linked.key===coder.key,'linking keeps the sign-in code');
  assert.equal((await api(env,'/api/google',{credential:await token({sub:'g-222'})})).data.account.name,'Hank');
  assert.equal((await api(env,'/api/google',{credential:await token({sub:'g-111'}),key:coder.key})).status,409,'one Google account per RIVL account');
  assert.equal((await api(env,'/api/signout',{key:coder.key})).status,200);
  assert.equal((await api(env,'/api/me',{key:coder.key})).status,200,'sign-out never deletes a sign-in code');
  assert.equal(certFetches,2,'Google keys are cached (the one refetch was for the unknown key id)');
  assert.equal((await api(env,'/api/leaderboard')).data.players.some(p=>'google' in p),false,'others never see how a player signs in');
  globalThis.fetch=realFetch;
  checks++;
}

// Dealer, small blind and big blind move one live seat clockwise each hand, skip busted seats, follow the
// heads-up rule, and reach the browser in every snapshot.
{
  const {room,hostWs}=await setup(8,1);
  await say(room,hostWs,{type:'startMatch'});
  const seen=[];
  for(let h=0;h<9;h++){
    const g=room.room.game,live=g.players.map(p=>p.seat);
    const nextLive=s=>live[(live.indexOf(s)+1)%live.length];
    assert.equal(g.sbSeat,nextLive(g.dealer),'small blind sits left of the dealer');
    assert.equal(g.bbSeat,nextLive(g.sbSeat),'big blind sits left of the small blind');
    assert.equal(g.turn,nextLive(g.bbSeat),'preflop action starts left of the big blind');
    const snap=room.publicState(room.room.hostToken).game;
    assert.deepEqual([snap.dealer,snap.sbSeat,snap.bbSeat],[g.dealer,g.sbSeat,g.bbSeat],'buttons are sent to players');
    seen.push(g.dealer);
    if(h===3)g.players.find(p=>p.seat===nextLive(g.dealer)).stack=0; // the next dealer busts this hand
    room.startHand();
  }
  assert.deepEqual(seen.slice(0,4),[0,1,2,3]);
  assert.equal(seen[4],5,'a busted seat is skipped by the button');
  // Heads-up: the dealer posts the small blind and acts first preflop.
  const duel=await setup(1,1);
  await say(duel.room,duel.hostWs,{type:'startMatch'});
  for(let h=0;h<3;h++){
    const g=duel.room.room.game;
    assert.equal(g.sbSeat,g.dealer,'heads-up dealer is the small blind');
    assert.notEqual(g.bbSeat,g.dealer);
    if(g.turn!==g.dealer)assert.ok(g.players.find(p=>p.seat===g.dealer).allIn,'heads-up dealer acts first preflop');
    const before=g.dealer;duel.room.startHand();
    assert.notEqual(duel.room.room.game.dealer,before,'heads-up button alternates');
  }
  checks++;
}

console.log('PASS: '+checks+' room server checks');
