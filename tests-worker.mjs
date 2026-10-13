// Simulates the room server (worker/rooms.js) with in-memory storage and fake sockets.
// Run: node tests-worker.mjs
import {Room} from './worker/rooms.js';
import assert from 'node:assert/strict';

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

console.log('PASS: '+checks+' room server checks');
