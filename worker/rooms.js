/* RIVL — Cloudflare Worker + Durable Objects. Serves the site (static assets), runs poker rooms,
   and talks to the Directory (accounts, online ratings, lobby, free-plan budget). */
export {Directory} from './directory.js';
export {Tournament} from './tournament.js';
import {nightOf} from './tournament.js';
import {gradeDecision} from './grading.js';
import '../hand-stats.js';
import {verifyGoogleToken} from './google.js';
import {cleanReport,sendBugReport,BUG_MAX_CHARS,cleanPlayerReport,sendPlayerReport} from './bug-report.js';
import {puzzleFor,publicPuzzle,reveal,CHOICES} from './puzzle.js';
import {CRAWLER_RE} from './stats.js';
const CODE_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHAT_MAX_CHARS=180,CHAT_HISTORY_LIMIT=40,CHAT_COOLDOWN_MS=1500;
const MAX_BODY=1000,MAX_MESSAGE=2000,TURN_MS=12000,NEXT_HAND_MS=11000,RANKED_NEXT_HAND_MS=6000,RUNOUT_MS=1200,IDLE_MS=6*60*60*1000,BOT_RAISES_PER_STREET=4,BOT_THINK_MIN_MS=2000,BOT_THINK_MAX_MS=4800;
// Bots take a fresh random 2–5 seconds on every decision, so play reads like a person thinking.
// The cap sits just under 5 seconds so alarm and network delay never push a move past 5.
const botThinkMs=()=>BOT_THINK_MIN_MS+Math.floor(Math.random()*(BOT_THINK_MAX_MS-BOT_THINK_MIN_MS));
// Blinds rise every 8 hands so a match reaches a finish.
const BLINDS=[[10,20],[15,30],[25,50],[50,100],[75,150],[100,200],[150,300],[200,400],[300,600],[500,1000]];
// Ranked blinds go up on the clock, every 2.5 minutes, from 33 big blinds deep (1,000 chips at 15/30) down to two
// by the last level, so a typical match ends around 10 minutes. No new hand is dealt after 14 minutes; the
// match then ends on chip count once that hand finishes, so a match never runs much past 15.
const RANKED_BLINDS=[[15,30],[25,50],[50,100],[100,200],[150,300],[250,500]],RANKED_LEVEL_MS=150000,RANKED_LAST_DEAL_MS=14*60000;
const rankedLevel=startedAt=>Math.min(RANKED_BLINDS.length-1,Math.floor(Math.max(0,Date.now()-startedAt)/RANKED_LEVEL_MS));
// Player stats (hand-stats.js): each signed-in player's hands are sent to the Directory when their match ends, when they
// leave or move tables, or every 100 hands at a long table, so a room never holds too many at once.
const HS=globalThis.RivlHandStats,STATS_CHUNK=100,STREET_OF={preflop:0,flop:1,turn:2,river:3};
const HAND_NAMES=['High Card','Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush'];

function allowedOrigin(request,env){
  const origin=request.headers.get('Origin');
  if(!origin)return {ok:true,origin:null};
  const self=new URL(request.url).origin;
  const extra=String(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
  return {ok:origin===self||extra.includes(origin),origin};
}
async function readBody(request,maxLength=MAX_BODY){
  const text=await request.text();
  if(text.length>maxLength)throw Object.assign(Error('Request too large'),{status:413});
  try{return text?JSON.parse(text):{}}catch{throw Object.assign(Error('Invalid JSON'),{status:400})}
}
const dirStub=env=>env.DIRECTORY.get(env.DIRECTORY.idFromName('global'));
async function dir(env,path,body){
  const response=await dirStub(env).fetch('https://dir'+path,body===undefined?undefined:{method:'POST',body:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
}
// Short in-memory cache for public lists, so polling pages do not each wake the Directory.
const cache=new Map();
async function cached(env,path,ttl){
  const hit=cache.get(path);if(hit&&Date.now()-hit.t<ttl)return hit.value;
  const value=await dir(env,path);if(value.status===200)cache.set(path,{t:Date.now(),value});return value;
}
// One Tournament object per night runs the nightly freeroll (see worker/tournament.js).
async function tourney(env,night,path,body){
  const response=await env.TOURNEYS.get(env.TOURNEYS.idFromName(night)).fetch('https://t'+path,{method:'POST',body:JSON.stringify({...body,night})});
  return {status:response.status,data:await response.json()};
}
async function cachedTourney(env,night){
  const key='freeroll:'+night,hit=cache.get(key);if(hit&&Date.now()-hit.t<3000)return hit.value;
  const value=await tourney(env,night,'/view',{});if(value.status===200)cache.set(key,{t:Date.now(),value});return value;
}
// Ranked is matchmaking only: tables fill from the queue, start on their own, and are never joined by code.
const RANKED_SIZES=[3,6,9],RANKED_COUNTDOWN_MS=15000;
// Players can add 5 seconds to their own turn clock: three times per Ranked match, five times per freeroll.
const RANKED_EXTENSIONS=3,FREEROLL_EXTENSIONS=5,EXTENSION_MS=5000;
// Spectators: anyone can watch a freeroll table; other tables only by a friend of someone seated there.
// They get the same view as a player with no seat (no hole cards until showdown) plus, away from the freeroll, the
// hole cards of the friends they came to watch. They cannot act or chat.
const MAX_WATCHERS=25;
const rankedSize=room=>RANKED_SIZES.includes(Number(room?.rankedMax))?Number(room.rankedMax):6;
const RANKED_SIGN_IN='Sign in or create an account to play Ranked.';
const CLOSED_MESSAGE='Online play has used its free capacity for today. Bot practice still works. New rooms open again after midnight UTC.';
async function limited(limiter,request){
  if(!limiter)return false;
  const {success}=await limiter.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});
  return !success;
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    const api=url.pathname.startsWith('/api/'),socket=url.pathname.startsWith('/ws/');
    if(!api&&!socket)return env.ASSETS?env.ASSETS.fetch(request):new Response('Not found',{status:404});
    const {ok,origin}=allowedOrigin(request,env);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
    if(origin&&ok)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type',Vary:'Origin'});
    const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(!ok)return json({error:'Origin not allowed'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    try{
      const createRoom=async body=>{
        const usage=await dir(env,'/usage/room',{});
        if(!usage.data.ok)return {status:503,data:{error:CLOSED_MESSAGE}};
        for(let attempt=0;attempt<4;attempt++){
          const code=Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>CODE_CHARS[n%32]).join('');
          const response=await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch('https://room/create',{method:'POST',body:JSON.stringify({...body,code})});
          if(response.status===409)continue;
          const data=await response.json();return {status:response.status,data:response.ok?{...data,code}:data};
        }
        return {status:503,data:{error:'Could not allocate a room code'}};
      };
      const joinRoom=async(code,body)=>{
        const response=await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch('https://room/join',{method:'POST',body:JSON.stringify(body)});
        return {status:response.status,data:{...await response.json(),code}};
      };
      const send=r=>json(r.data,r.status);
      const ws=url.pathname.match(/^\/ws\/([A-Z2-9]{6})$/);
      if(ws&&request.headers.get('Upgrade')==='websocket'){
        return env.ROOMS.get(env.ROOMS.idFromName(ws[1])).fetch('https://room/ws',{headers:{Upgrade:'websocket'}});
      }
      // Spectators reach a table by its object id, so watching a friend never hands out a private room's join code.
      const watchWs=url.pathname.match(/^\/ws\/watch\/([0-9a-f]{64})$/);
      if(watchWs&&request.headers.get('Upgrade')==='websocket'){
        let id;try{id=env.ROOMS.idFromString(watchWs[1])}catch{return json({error:'Table not found'},404)}
        return env.ROOMS.get(id).fetch('https://room/ws',{headers:{Upgrade:'websocket'}});
      }
      if(request.method==='GET'){
        if(url.pathname==='/api/status')return send(await cached(env,'/status',10000));
        // The Google OAuth client ID is public; the page reads it here so it lives in one place (wrangler.toml).
        if(url.pathname==='/api/config')return json({googleClientId:env.GOOGLE_CLIENT_ID||''});
        if(url.pathname==='/api/puzzle'){
          const pz=puzzleFor(url.searchParams.get('day')||undefined);
          return pz?json(publicPuzzle(pz)):json({error:'No puzzle for that day.'},404);
        }
        if(url.pathname==='/api/freeroll'){
          if(!env.TOURNEYS)return json({error:'The freeroll is not available.'},404);
          const r=await cachedTourney(env,nightOf());return json(r.status===200?{...r.data,serverNow:Date.now()}:r.data,r.status);
        }
        if(url.pathname==='/api/freeroll/board')return send(await cached(env,'/freeroll/board?night='+nightOf(),30000));
        if(url.pathname==='/api/lobby')return send(await cached(env,'/lobby',5000));
        if(url.pathname==='/api/leaderboard')return send(await cached(env,'/leaderboard',10000));
        if(url.pathname==='/api/history')return send(await cached(env,'/history',15000));
        if(url.pathname==='/api/history/game'){
          const id=url.searchParams.get('id')||'';
          if(id.length>100)return json({error:'Invalid game'},400);
          return send(await dir(env,'/history/game?id='+encodeURIComponent(id)));
        }
        if(url.pathname==='/api/leaderboard/league'){
          const r=Math.round(Number(url.searchParams.get('r'))/10)*10;
          if(!Number.isFinite(r)||r<0||r>5000)return json({error:'Missing rating.'},400);
          return send(await cached(env,'/leaderboard/league?r='+r,10000));
        }
      }
      if(request.method!=='POST')return json({error:'Not found'},404);
      if(url.pathname==='/api/accounts'){
        if(await limited(env.ACCOUNT_LIMITER,request))return json({error:'Too many new accounts from your network. Try again in a minute.'},429);
        return send(await dir(env,'/accounts/create',await readBody(request)));
      }
      if(url.pathname==='/api/report-avatar'){
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Too many reports. Please try later.'},429);
        return send(await dir(env,'/accounts/report-avatar',await readBody(request)));
      }
      if(url.pathname==='/api/avatar-reports'||url.pathname==='/api/moderate-avatar'){
        return send(await dir(env,url.pathname==='/api/avatar-reports'?'/accounts/avatar-reports':'/accounts/moderate-avatar',await readBody(request)));
      }
      if(url.pathname==='/api/avatar'){
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Please wait before changing your photo again.'},429);
        return send(await dir(env,'/accounts/avatar',await readBody(request,50000)));
      }
      if(url.pathname==='/api/me'){
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Too many attempts. Try again in a minute.'},429);
        return send(await dir(env,'/accounts/me',await readBody(request)));
      }
      // Champion banners and player cards. Reading the banners at a table or someone's card is open to anyone;
      // a player's own banners need their key.
      if(url.pathname==='/api/banners'||url.pathname==='/api/player'){
        if(await limited(env.PING_LIMITER,request))return json({error:'Too many requests. Try again in a minute.'},429);
        return send(await dir(env,url.pathname==='/api/banners'?'/banners/get':'/player',await readBody(request)));
      }
      if(url.pathname==='/api/banners/me'||url.pathname==='/api/banners/save'){
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Too many requests. Try again in a minute.'},429);
        const body=await readBody(request);
        if(!body.key)return json({error:'Sign in to keep a banner.'},401);
        return send(await dir(env,url.pathname.replace('/api',''),body));
      }
      // Player stats: the signed-in player's own totals and games, a finished practice match to save, Match History's MINE.
      const pstats={'/api/player-stats':'/pstats/me','/api/player-stats/practice':'/pstats/practice','/api/history/mine':'/history/mine'}[url.pathname];
      if(pstats){
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Too many requests. Try again in a minute.'},429);
        const body=await readBody(request,pstats==='/pstats/practice'?250000:MAX_BODY);
        if(!body.key)return json({error:'Sign in to keep your stats.'},401);
        return send(await dir(env,pstats,body));
      }
      if(url.pathname==='/api/google'){
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Too many attempts. Try again in a minute.'},429);
        const body=await readBody(request,6000);
        const claims=await verifyGoogleToken(body.credential,env.GOOGLE_CLIENT_ID);
        if(body.name!=null&&!body.key&&await limited(env.ACCOUNT_LIMITER,request))return json({error:'Too many new accounts from your network. Try again in a minute.'},429);
        return send(await dir(env,'/accounts/google',{sub:claims.sub,name:body.name,key:body.key}));
      }
      if(url.pathname==='/api/player-report'){
        if(await limited(env.BUG_LIMITER,request))return json({error:'Too many reports from your network. Try again later.'},429);
        const report=cleanPlayerReport(await readBody(request,5000));
        if(report.error)return json({error:report.error},400);
        if(!env.BUG_REPORT_EMAIL)return json({error:'Reports are temporarily unavailable. Email support@rivlpoker.com.'},503);
        try{
          const {EmailMessage}=env.EmailMessage?{EmailMessage:env.EmailMessage}:await import('cloudflare:email');
          await sendPlayerReport(env,report,url.origin,EmailMessage);
        }catch(err){console.error('player report send failed',err?.message);return json({error:'Report could not be sent. Please try again later.'},502)}
        return json({ok:true});
      }
      if(url.pathname==='/api/bug-report'){
        if(await limited(env.BUG_LIMITER,request))return json({error:'Too many reports from your network. Try again in a minute.'},429);
        const report=cleanReport(await readBody(request,BUG_MAX_CHARS*2+1000));
        if(report.error)return json({error:report.error},400);
        if(!env.BUG_REPORT_EMAIL)return json({error:'Bug reports are not set up yet. Please try again later.'},503);
        try{
          const {EmailMessage}=env.EmailMessage?{EmailMessage:env.EmailMessage}:await import('cloudflare:email');
          await sendBugReport(env,report,url.origin,EmailMessage);
        }catch(err){
          console.error('bug report send failed',err?.message);
          return json({error:'Your report could not be sent right now. Please try again later.'},502);
        }
        return json({ok:true});
      }
      if(url.pathname==='/api/puzzle/answer'||url.pathname==='/api/puzzle/me'){
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Too many attempts. Try again in a minute.'},429);
        const body=await readBody(request),pz=puzzleFor(String(body.day||''));
        if(!pz)return json({error:'No puzzle for that day.'},404);
        if(url.pathname==='/api/puzzle/me'){
          if(!body.key)return json({error:'Sign in to keep a streak.'},401);
          const r=await dir(env,'/puzzle/me',{key:body.key,day:pz.day});
          return r.status===200&&r.data.choice?json({...r.data,...reveal(pz)}):send(r);
        }
        const choice=String(body.choice||'');
        if(!CHOICES.includes(choice)||!pz.p.grades[choice])return json({error:'Pick fold, call or raise.'},400);
        // Only today's puzzle is saved; earlier days can be replayed for practice. Signed-out players see the split without adding to it.
        if(!pz.today||!body.key)return json({choice,saved:false,counts:(await cached(env,'/puzzle/counts?day='+pz.day,10000)).data.counts||null,...reveal(pz)});
        const r=await dir(env,'/puzzle/answer',{key:body.key,day:pz.day,choice,correct:choice===pz.p.best});
        return r.status===200?json({...r.data,saved:true,...reveal(pz)}):send(r);
      }
      const freeroll=url.pathname.match(/^\/api\/freeroll\/(register|unregister|seat)$/);
      if(freeroll){
        if(!env.TOURNEYS)return json({error:'The freeroll is not available.'},404);
        if(freeroll[1]!=='seat'&&await limited(env.JOIN_LIMITER,request))return json({error:'Too many attempts. Try again in a minute.'},429);
        const body=await readBody(request);
        if(!body.key)return json({error:'Sign in to play the freeroll.'},401);
        const me=await dir(env,'/verify',{key:body.key});
        if(me.status!==200||!me.data.account)return json({error:'Your sign-in code was not recognised. Sign in again.'},401);
        const night=nightOf();cache.delete('freeroll:'+night);
        const r=await tourney(env,night,'/'+freeroll[1],{account:me.data.account});
        return send(r);
      }
      if(url.pathname==='/api/watch'){
        // Watch a friend's table: the Directory checks the friendship and knows the table from the friend's heartbeat;
        // the table checks the friend is really seated there before anyone gets its id.
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Too many attempts. Try again in a minute.'},429);
        const body=await readBody(request);
        if(!body.key)return json({error:'Sign in to watch a friend.'},401);
        const r=await dir(env,'/watch/friend',{key:body.key,id:body.friend});
        if(r.status!==200)return send(r);
        const id=env.ROOMS.idFromName(r.data.code);
        const seated=await env.ROOMS.get(id).fetch('https://room/seated',{method:'POST',body:JSON.stringify({id:String(body.friend||'')})}).then(x=>x.json()).catch(()=>null);
        if(!seated?.ok)return json({error:r.data.name+' is not at a table right now.'},404);
        return json({room:String(id),name:r.data.name,seat:seated.seat,kind:seated.kind});
      }
      const friends=url.pathname.match(/^\/api\/friends(\/add|\/remove|\/new-code|\/invite|\/dismiss-invite|\/request|\/accept|\/decline)?$/);
      if(friends){
        if(friends[1]&&!['/remove','/dismiss-invite','/accept','/decline'].includes(friends[1])&&await limited(env.JOIN_LIMITER,request))return json({error:'Too many attempts. Try again in a minute.'},429);
        return send(await dir(env,'/friends'+(friends[1]||''),await readBody(request)));
      }
      // Heartbeats from an open page: /presence for a signed-in player, /ping for a guest. Crawlers are left out of the player numbers.
      const crawler=CRAWLER_RE.test(request.headers.get('User-Agent')||'');
      if(url.pathname==='/api/presence')return send(await dir(env,'/presence',{...await readBody(request),crawler}));
      if(url.pathname==='/api/ping'){
        if(await limited(env.PING_LIMITER,request))return json({ok:false},429);
        return send(await dir(env,'/stats/ping',{...await readBody(request),crawler}));
      }
      if(url.pathname==='/api/stats'){
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Too many tries. Wait a minute.'},429);
        return send(await dir(env,'/stats/report',await readBody(request)));
      }
      if(url.pathname==='/api/signout')return send(await dir(env,'/accounts/signout',await readBody(request)));
      if(url.pathname==='/api/rooms'){
        if(await limited(env.CREATE_LIMITER,request))return json({error:'Too many rooms created. Try again in a minute.'},429);
        const body=await readBody(request);
        return send(await createRoom({name:body.name,key:body.key,visibility:body.visibility==='public'?'public':'private'}));
      }
      if(url.pathname==='/api/quickplay'){
        // Join the busiest open public table, or open a new public one.
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Too many join attempts. Try again in a minute.'},429);
        const body=await readBody(request),lobby=await dir(env,'/lobby');
        for(const room of (lobby.data.rooms||[]).slice(0,3)){
          const joined=await joinRoom(room.code,{name:body.name,key:body.key});
          if(joined.status===200)return send(joined);
        }
        if(await limited(env.CREATE_LIMITER,request))return json({error:'Too many rooms created. Try again in a minute.'},429);
        return send(await createRoom({name:body.name,key:body.key,visibility:'public'}));
      }
      if(url.pathname==='/api/ranked'){
        // Ranked queue: sit at the fullest Ranked table still filling up, or open a new one. Signed-in players only.
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Too many join attempts. Try again in a minute.'},429);
        const body=await readBody(request);
        if(!body.key)return json({error:RANKED_SIGN_IN},401);
        const size=body.size==null?6:Number(body.size);
        if(!RANKED_SIZES.includes(size))return json({error:'Choose a 3, 6, or 9-player ranked table.'},400);
        // The Directory hands out one filling table per request and counts the seat straight away.
        const skip=[];
        for(let attempt=0;attempt<3;attempt++){
          const {data}=await dir(env,'/lobby/claim',{size,skip});if(!data.code)break;
          const joined=await joinRoom(data.code,{key:body.key,ranked:true,size});
          if(joined.status===200||joined.status===401)return send(joined);
          skip.push(data.code);
        }
        if(await limited(env.CREATE_LIMITER,request))return json({error:'Too many rooms created. Try again in a minute.'},429);
        return send(await createRoom({key:body.key,ranked:true,size}));
      }
      const join=url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/join$/);
      if(join){
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Too many join attempts. Try again in a minute.'},429);
        const body=await readBody(request);
        return send(await joinRoom(join[1],{name:body.name,key:body.key}));
      }
      return json({error:'Not found'},404);
    }catch(e){return json({error:e.status?e.message:'Server error'},e.status||500)}
  }
};

const LEVELS={Beginner:{noise:.28,aggression:.15},Intermediate:{noise:.18,aggression:.3},Advanced:{noise:.1,aggression:.45},Expert:{noise:.05,aggression:.6}};
const ALIASES=['Vincent','Theo','Marcus','Ryder','Sterling','Jasper','Milo','Dante','Silas','Roman','Felix','Nico','Remy','Atlas','Cruz','Arlo','Miles','Luca','Orion','Knox','Hugo','Beck','Ellis','Zane','Bishop','Wilder','Mason','Cole','Reid','Ezra','Leo','Finn'];
const AVATARS=['♠','♥','♦','♣','🂡','🂱','🎩','🃏'];
const pick=array=>array[Math.floor(Math.random()*array.length)];
const cleanName=(value,fallback)=>String(value||'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,20)||fallback;
const rankOf=c=>'23456789TJQKA'.indexOf(c[0])+2;

export class Room {
  constructor(state,env){
    this.state=state;this.env=env;this.room=null;this.alarmAt=0;this.photosSent=new WeakMap();
    // Keep-alive pings are answered by Cloudflare without waking the room, so idle tables cost nothing.
    if(typeof WebSocketRequestResponsePair!=='undefined')state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  }
  async dir(path,body){
    if(!this.env.DIRECTORY)return null;
    try{const r=await dirStub(this.env).fetch('https://dir'+path,{method:'POST',body:JSON.stringify(body||{})});return await r.json()}catch{return null}
  }
  // Who is dealt in, sent with each hand's budget check for the owner's player numbers (worker/stats.js).
  // Seated members are the humans; bots are counted apart so they never pass for players.
  dealtTo(){
    const room=this.room,humans=Object.values(room.members).filter(m=>m.seat>=0);
    return {code:room.code,mode:room.tourney?'freeroll':room.ranked?'ranked':'casual',humans:humans.length,
      bots:room.seats.filter(s=>s?.type==='bot').length,accounts:humans.map(m=>m.accountId).filter(Boolean)};
  }
  // One alarm write per turn clock is enough: an early alarm just re-arms itself for the real deadline.
  async armAlarm(at){if(this.alarmAt>Date.now()&&this.alarmAt<=at)return;this.alarmAt=at;await this.state.storage.setAlarm(at)}
  async load(){if(!this.room)this.room=await this.state.storage.get('room')||null;return this.room}
  sockets(){return this.state.getWebSockets().filter(ws=>ws.readyState===1).map(ws=>[ws,ws.deserializeAttachment()?.token]).filter(([,token])=>token)}
  watchers(){return this.state.getWebSockets().filter(ws=>ws.readyState===1&&ws.deserializeAttachment()?.watch)}
  // Spectators who came to watch a friend are sent away once none of their friends is seated here any more.
  friendGone(ws){
    const friends=ws.deserializeAttachment()?.friends;
    if(this.room.tourney||!friends?.length)return false;
    const seated=new Set(Object.values(this.room.members).map(m=>m.accountId));
    return !friends.some(id=>seated.has(id));
  }
  // Someone watching a friend sees that friend's own hole cards. Freeroll spectators never see any (friends get no list there).
  friendCards(ws){
    const g=this.room.game,friends=ws.deserializeAttachment()?.friends;
    if(this.room.tourney||!g||!friends?.length)return {};
    return Object.fromEntries(Object.values(this.room.members).filter(m=>friends.includes(m.accountId)&&g.hands[m.seat]).map(m=>[m.seat,g.hands[m.seat]]));
  }
  async watch(ws,msg){
    const room=this.room,out=reason=>{this.send(ws,{type:'removed',reason,watch:true});try{ws.close(1000,reason)}catch{}};
    if(this.watchers().length>=MAX_WATCHERS)return out('This table has as many spectators as it can take. Try again later.');
    let friends=[];
    if(!room.tourney){
      const a=msg.key?(await this.dir('/verify',{key:String(msg.key)}))?.account:null;
      if(!a)return out('Sign in to watch a friend’s table.');
      const ids=Object.values(room.members).map(m=>m.accountId).filter(Boolean);
      friends=(await this.dir('/watch/among',{id:a.id,ids}))?.ids||[];
      if(!friends.length)return out('You can only watch tables where a friend is playing.');
    }
    ws.serializeAttachment({watch:true,friends});
    this.broadcast();
  }

  publicState(token){
    const g=this.room.game,m=this.room.members[token];
    const onlineSeats=new Set(this.sockets().map(([,t])=>this.room.members[t]?.seat));
    const shown=(g?.phase==='showdown'||g?.runout)&&g.shown?Object.fromEntries(g.shown.map(s=>[s,g.hands[s]])):{};
    return {visibility:this.room.visibility,started:!!this.room.started,mySeat:m?m.seat:-1,serverNow:Date.now(),watching:!m,watchers:this.watchers().length,
      seats:this.room.seats.map((s,i)=>s?{type:s.type,name:s.name,avatar:s.avatar,accountId:Object.values(this.room.members).find(m=>m.seat===i)?.accountId||null,level:s.level,isHost:!!s.isHost,verified:!!s.verified,online:s.type==='bot'||onlineSeats.has(i)}:null),
      chat:(this.room.chat||[]).slice(-CHAT_HISTORY_LIMIT),ranked:!!this.room.ranked,rated:this.rated(),
      extensionsLeft:this.extensionsLeft(m),startsAt:this.room.startsAt||0,rankedMax:rankedSize(this.room),blindClock:this.blindClock(),
      tourney:this.room.tourney?{table:this.room.tourney.table,info:this.room.tourney.info||null,blinds:this.room.tourney.blinds||null,done:!!this.room.tourney.done}:null,
      game:g?{phase:g.phase,handNumber:g.handNumber,pot:g.pot,board:g.board,players:g.players.map(p=>({seat:p.seat,name:p.name,bot:p.bot,stack:p.stack,bet:p.bet,folded:p.folded,allIn:p.allIn,away:!!p.away,left:!!p.left,contribution:p.contribution})),
        holeCards:m?g.hands[m.seat]||null:null,shown,turn:g.turn,deadline:g.deadline,currentBet:g.currentBet,minRaise:g.minRaise,smallBlind:g.smallBlind,bigBlind:g.bigBlind,dealer:g.dealer,sbSeat:g.sbSeat??-1,bbSeat:g.bbSeat??-1,
        winners:g.winners||[],result:g.result||'',note:g.note||'',ratingChanges:g.ratingChanges||null,matchOver:this.matchOver(g),nextHandAt:g.nextHandAt||0,legal:m?this.legal(m.seat):null}:null};
  }
  send(ws,message){try{ws.send(JSON.stringify(message))}catch{}}
  // Profile photos are sent to each socket once; later updates leave them out until a seat or photo changes,
  // so every bet does not resend up to nine photos to every player.
  broadcast(){
    const photos=this.room.seats.map(s=>s?.avatar||'').join('|');
    for(const [ws,token] of this.sockets()){
      const state=this.publicState(token);
      if(this.photosSent.get(ws)===photos){for(const seat of state.seats)if(/^data:/.test(seat?.avatar||''))delete seat.avatar}
      else this.photosSent.set(ws,photos);
      this.send(ws,{type:'state',state,isHost:token===this.room.hostToken});
    }
    if(!this.watchers().length)return;
    const view=this.publicState(null);
    for(const ws of this.watchers()){
      if(this.friendGone(ws)){this.send(ws,{type:'removed',reason:'Your friend has left this table.',watch:true});try{ws.close(1000,'Friend left')}catch{}continue}
      const state={...view,seats:view.seats.map(s=>s&&{...s})};
      if(state.game)state.game={...state.game,friendCards:this.friendCards(ws)};
      if(this.photosSent.get(ws)===photos){for(const seat of state.seats)if(/^data:/.test(seat?.avatar||''))delete seat.avatar}
      else this.photosSent.set(ws,photos);
      this.send(ws,{type:'state',state,isHost:false});
    }
  }
  matchOver(g=this.room?.game){return !g||g.result==='Match complete'}
  // Ranked level clock for the table header: the next blinds and when they arrive, and when the last hand is dealt.
  blindClock(){
    const t=this.room?.match?.ranked&&this.room.match.startedAt;if(!t||this.matchOver())return null;
    const level=rankedLevel(t),last=level>=RANKED_BLINDS.length-1;
    return {level:level+1,next:last?null:RANKED_BLINDS[level+1],nextAt:last?0:t+(level+1)*RANKED_LEVEL_MS,lastDealAt:t+RANKED_LAST_DEAL_MS};
  }
  // Freeroll extensions follow the player from table to table (the Tournament keeps the count); Ranked ones reset each match.
  extensionsLeft(m){
    const room=this.room;if(!m)return null;
    if(room.tourney)return room.tourney.done?null:Math.max(0,FREEROLL_EXTENSIONS-(room.tourney.ext?.[m.accountId]||0));
    return room.ranked&&room.match?.ranked?Math.max(0,RANKED_EXTENSIONS-(room.match.extensions?.[m.seat]||0)):null;
  }
  humansAway(g){return g.players.filter(p=>!p.bot&&!p.left).every(p=>p.away&&!this.seatOnline(p.seat))}
  seatOnline(seat){return this.sockets().some(([,t])=>this.room.members[t]?.seat===seat)}
  ratedSeats(){return Object.values(this.room.members).filter(m=>m.accountId)}
  // Only Ranked rooms change Elo; Quick Play and private rooms are unranked.
  rated(){return !!this.room.ranked&&(this.ratedSeats().length>=2||Object.keys(this.room.match?.accounts||{}).length>=2||!!this.room.game?.ratingChanges?.length)}
  async save(){
    const room=this.room;room.lastActive=Date.now();
    const g=room.game;
    if(room.pendingResults){
      // Ratings are computed by the Directory from the server's own finishing order.
      const out=await this.dir('/results',room.pendingResults);
      // A transient Directory failure must not silently discard a ranked match result.
      // The Directory deduplicates by matchId, so retrying is safe.
      if(out&&!out.error){
        if(g){g.ratingChanges=out.changes||[];if(out.rated===false)g.note='Unrated: at least two signed-in players are needed for a rated match.'}
        room.pendingResults=null;
      }
    }
    if(room.pendingStats?.length&&await this.sendStats())room.pendingStats=null;
    await this.syncLobby();
    if(room.tourney)await this.tArm();
    else if(this.matchOver(g))await this.armAlarm(room.lastActive+IDLE_MS);
    else if(g.phase==='showdown'){g.nextHandAt||=Date.now()+(room.match?.ranked?RANKED_NEXT_HAND_MS:NEXT_HAND_MS);this.alarmAt=0;await this.armAlarm(g.nextHandAt)}
    await this.state.storage.put('room',room);this.broadcast();
  }
  // Public rooms with open seats that have not started are listed in the lobby.
  async syncLobby(){
    const room=this.room;if(!room.code||room.tourney)return;
    const humans=Object.keys(room.members).length,players=room.seats.filter(Boolean).length;
    const listed=room.ranked?!room.started&&players<rankedSize(room)&&humans>0:room.visibility==='public'&&this.matchOver(room.game)&&players<9&&humans>0;
    const sig=listed?[humans,players,room.seats.find(s=>s?.isHost)?.name].join('|'):'';
    const stale=Date.now()-(room.lobbyAt||0)>5*60*1000;
    if(sig===(room.lobbySig||'')&&!(listed&&stale))return;
    room.lobbySig=sig;room.lobbyAt=Date.now();
    if(listed)await this.dir('/lobby/upsert',{code:room.code,host:room.seats.find(s=>s?.isHost)?.name,humans,players,ranked:!!room.ranked,size:rankedSize(room)});
    else await this.dir('/lobby/remove',{code:room.code});
  }
  // Finishing order: players still holding chips by stack, then everyone else in reverse order of elimination.
  // In Ranked, anyone who leaves while still holding chips places below every busted player.
  eliminate(seats){
    const m=this.room.match;if(!m)return;
    const fresh=seats.filter(s=>!m.out.flat().includes(s)&&!m.left?.includes(s));
    if(fresh.length)m.out.push(fresh);
  }
  finishMatch(standing){
    const m=this.room.match;if(!m)return;
    const order=[...standing.sort((a,b)=>b.stack-a.stack).map(p=>[p.seat]),...[...m.out].reverse(),...[...(m.left||[])].reverse().map(s=>[s])];
    const place={};let next=1;for(const group of order){for(const s of group)place[s]=next;next+=group.length}
    // Every signed-in player's hands from the match go to their stats, with the place they finished.
    this.closeAllStats(Object.fromEntries(Object.entries(m.accounts).map(([seat,id])=>[id,{place:place[seat]??null}])));
    if(!m.ranked){this.room.match=null;return}
    // Each Ranked player's decision accuracy (weighted like bot practice) goes with their place.
    const accuracy=seat=>{const d=m.grades?.[seat];return d?.n?{acc:d.s/d.w,decisions:d.n}:{acc:null,decisions:0}};
    const players=Object.entries(m.accounts).map(([seat,id])=>({id,place:place[seat]??next,chips:standing.find(p=>p.seat===Number(seat))?.stack??0,...accuracy(seat)}));
    if(players.length>=2)this.room.pendingResults={matchId:m.id,players,duration:Date.now()-m.startedAt,hands:this.room.game?.handNumber||0};
    else if(this.room.game)this.room.game.note='Unrated: at least two signed-in players are needed for a rated match.';
    this.room.match=null;
  }
  // Which stats a hand here counts toward: the match (casual or Ranked), or tonight's freeroll for its tables.
  statsKey(){const room=this.room;return room.tourney?{game:'freeroll:'+room.tourney.id,mode:'freeroll'}:room.match?{game:room.match.id,mode:room.match.ranked?'ranked':'casual'}:null}
  // A finished hand is added to the stats record of each signed-in player dealt into it (hand-stats.js).
  handStats(){
    const room=this.room,g=room.game,key=this.statsKey();
    if(!g?.acct||g.statsDone||!key||!this.env.DIRECTORY)return;
    g.statsDone=true;
    const seats=g.players.map(p=>p.seat).sort((a,b)=>a-b),at=Math.max(0,seats.indexOf(g.sbSeat)),order=[...seats.slice(at),...seats.slice(0,at)];
    const won=g.statsWon||Object.fromEntries((g.winners||[]).map(w=>[w.seat,w.amount]));
    const here=new Set(Object.values(room.members).map(m=>m.accountId).filter(Boolean));
    for(const [seat,id] of Object.entries(g.acct)){
      const p=g.players.find(x=>x.seat===Number(seat));if(!p)continue;
      const stats=room.stats||={};
      if(stats[id]&&stats[id].game!==key.game)this.closeStats(id);
      // A player's record at a freeroll table starts with the hand they sat down for; they may sit at a table twice.
      const r=stats[id]||={...key,part:(room.tourney?room.code+':':'')+g.handNumber,t0:Date.now(),size:0,hands:[]};
      r.hands.push(HS.pack({order,me:p.seat,bb:g.bigBlind,log:g.log||[],net:p.stack-(g.starts?.[seat]??p.stack),won:won[seat]||0,hole:g.hands[seat],board:g.board}));
      r.size=Math.max(r.size,g.players.length);r.t=Date.now();
      // Someone who left during the hand is not coming back to this match: their last hand is sent now, with no place.
      if(r.hands.length>=STATS_CHUNK||!here.has(id))this.closeStats(id);
    }
  }
  // A closed record waits in pendingStats until the Directory has it; save() keeps trying, like Ranked results.
  closeStats(id,extra){
    const room=this.room,r=room.stats?.[id];if(!r)return;
    delete room.stats[id];
    if(r.hands.length)(room.pendingStats||=[]).push({account:id,...r,...extra});
  }
  closeAllStats(extra={}){for(const id of Object.keys(this.room.stats||{}))this.closeStats(id,extra[id])}
  async sendStats(){const out=await this.dir('/pstats/record',{records:this.room.pendingStats});return !!out&&!out.error}
  // Deal the first hand of a new match. Ranked tables call this from their countdown; other rooms from the host's Start.
  async beginMatch(){
    const room=this.room;
    if(room.seats.filter(Boolean).length<2)throw Error('At least two players required');
    const usage=await this.dir('/usage/hand',{...this.dealtTo(),newMatch:true});
    if(usage&&!usage.ok)throw Error(CLOSED_MESSAGE);
    room.startsAt=0;this.closeAllStats();
    room.match={id:crypto.randomUUID(),ranked:!!room.ranked,startedAt:Date.now(),out:[],left:[],accounts:Object.fromEntries(Object.values(room.members).filter(m=>m.accountId).map(m=>[m.seat,m.accountId]))};
    room.game=null;this.startHand();
  }
  // A Ranked table counts down once two players sit, and starts at once when full.
  async rankedCountdown(){
    const room=this.room;if(!room.ranked||room.started)return;
    const players=room.seats.filter(Boolean).length;
    if(players<2){room.startsAt=0;return}
    if(players>=rankedSize(room)){await this.beginMatch().catch(()=>{});return}
    if(!room.startsAt){room.startsAt=Date.now()+RANKED_COUNTDOWN_MS;this.alarmAt=0;await this.armAlarm(room.startsAt)}
  }
  async destroy(){
    // The room's last hands go to the players' stats before its storage is deleted (one retry if the Directory is busy).
    if(this.room){this.closeAllStats();for(let k=0;k<2&&this.room.pendingStats?.length;k++)if(await this.sendStats())this.room.pendingStats=null}
    if(this.room?.lobbySig)await this.dir('/lobby/remove',{code:this.room.code});for(const ws of this.state.getWebSockets())try{ws.close(1000,'Room closed')}catch{}this.room=null;await this.state.storage.deleteAlarm();await this.state.storage.deleteAll()}
  next(seat,eligible){for(let n=1;n<=9;n++){const i=(seat+n)%9;if(eligible(i))return i}return -1}
  randomDeck(){
    const deck=[];for(const s of 'SHDC')for(const r of '23456789TJQKA')deck.push(r+s);
    for(let i=deck.length-1;i>0;i--){const b=new Uint32Array(1);crypto.getRandomValues(b);const j=Math.floor(b[0]/4294967296*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]]}return deck;
  }
  legal(seat){
    const g=this.room.game,p=g?.players.find(x=>x.seat===seat);
    if(!g||g.phase==='showdown'||g.turn!==seat||!p||p.folded||p.allIn)return null;
    const call=Math.min(p.stack,Math.max(0,g.currentBet-p.bet));
    return {call,check:call===0,raiseToMin:Math.min(p.bet+p.stack,g.currentBet+g.minRaise),raiseToMax:p.bet+p.stack,canRaise:p.stack>call&&!g.raiseLocked?.includes(seat),timeRemaining:Math.max(0,g.deadline-Date.now())};
  }
  startHand(previous){
    const old=previous||this.room.game;
    // A seat missing from the previous hand busted out earlier in this match; only a fresh match starts at 1,000.
    const carried=i=>old?.players.find(p=>p.seat===i);
    const participants=this.room.tourney?this.tParticipants(old):this.room.seats.flatMap((s,i)=>s?[{seat:i,name:s.name,bot:s.type==='bot',stack:old?carried(i)?.stack??0:1000,bet:0,contribution:0,folded:false,allIn:false,away:!!carried(i)?.away,timeouts:carried(i)?.timeouts||0}]:[]).filter(p=>p.stack>0);
    if(old)this.eliminate(old.players.filter(p=>!participants.some(x=>x.seat===p.seat)).map(p=>p.seat));
    const ranked=this.room.match?.ranked&&this.room.match.startedAt,timeUp=!!old&&!!ranked&&Date.now()-ranked>=RANKED_LAST_DEAL_MS;
    if(participants.length<2||!participants.some(p=>!p.bot)||timeUp){
      if(old){old.phase='showdown';old.result='Match complete';old.turn=-1;old.deadline=0;old.nextHandAt=0;if(timeUp&&participants.length>1)old.note='Time is up: places go by chip count.';this.finishMatch(participants)}
      return;
    }
    const handNumber=(old?.handNumber||0)+1,[smallBlind,bigBlind]=this.room.tourney?.blinds||(ranked?RANKED_BLINDS[rankedLevel(ranked)]:BLINDS[Math.min(BLINDS.length-1,Math.floor((handNumber-1)/8))]);
    const g={phase:'preflop',handNumber,pot:0,board:[],players:participants,hands:{},deck:this.randomDeck(),turn:-1,deadline:0,currentBet:0,minRaise:bigBlind,smallBlind,bigBlind,acted:[],raiseLocked:[],streetRaises:0,winners:[],result:'',dealer:-1,nextHandAt:0,shown:[]};
    // Every action is logged, and each signed-in player at the table (not sitting out) gets the hand in their stats.
    g.log=[];g.starts=Object.fromEntries(participants.map(p=>[p.seat,p.stack]));
    g.acct=Object.fromEntries(Object.values(this.room.members).filter(m=>m.accountId&&participants.some(p=>p.seat===m.seat&&!p.away)).map(m=>[m.seat,m.accountId]));
    const alive=i=>participants.some(p=>p.seat===i);
    g.dealer=this.next(old?.dealer??8,alive);
    const sb=participants.length===2?g.dealer:this.next(g.dealer,alive);
    const bb=this.next(sb,alive);
    g.sbSeat=sb;g.bbSeat=bb;
    for(const p of participants)g.hands[p.seat]=[g.deck.pop(),g.deck.pop()];
    const blind=(seat,amount)=>{const p=participants.find(x=>x.seat===seat);const v=Math.min(p.stack,amount);p.stack-=v;p.bet+=v;p.contribution+=v;g.pot+=v;p.allIn=p.stack===0};
    blind(sb,g.smallBlind);blind(bb,g.bigBlind);
    g.currentBet=Math.max(...participants.map(p=>p.bet));
    this.room.game=g;this.room.started=true;
    g.turn=this.next(bb,i=>participants.some(p=>p.seat===i&&!p.folded&&!p.allIn));
    g.deadline=Date.now()+TURN_MS;
    this.autoAdvance();
  }
  handValue(cards){
    const score5=cs=>{
      const vals=cs.map(rankOf).sort((a,b)=>b-a),freq=new Map(),suits=cs.map(c=>c[1]);
      for(const v of vals)freq.set(v,(freq.get(v)||0)+1);
      const uniq=[...new Set(vals)],straight=arr=>{const v=arr.includes(14)?[...arr,1]:arr;for(let i=0;i<=v.length-5;i++)if(v[i]-v[i+4]===4)return v[i];return 0};
      const flush=suits.every(x=>x===suits[0]),st=straight(uniq);
      const groups=[...freq].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
      if(flush&&st)return [8,st];
      if(groups[0][1]===4)return [7,groups[0][0],groups[1][0]];
      if(groups[0][1]===3&&groups[1][1]>=2)return [6,groups[0][0],groups[1][0]];
      if(flush)return [5,...vals];
      if(st)return [4,st];
      if(groups[0][1]===3)return [3,groups[0][0],...groups.slice(1).map(x=>x[0]).sort((a,b)=>b-a)];
      if(groups[0][1]===2&&groups[1][1]===2)return [2,Math.max(groups[0][0],groups[1][0]),Math.min(groups[0][0],groups[1][0]),groups[2][0]];
      if(groups[0][1]===2)return [1,groups[0][0],...groups.slice(1).map(x=>x[0]).sort((a,b)=>b-a)];
      return [0,...vals];
    };
    let best=null;for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)for(let d=c+1;d<cards.length-1;d++)for(let e=d+1;e<cards.length;e++){
      const five=[cards[a],cards[b],cards[c],cards[d],cards[e]],s=score5(five);
      if(!best||this.compare(s,best)>0){best=s;best.five=five}
    }return best;
  }
  compare(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return d}return 0}
  finishHand(){
    const g=this.room.game;g.turn=-1;g.deadline=0;g.phase='showdown';g.runout=false;
    const contenders=g.players.filter(p=>!p.folded);
    while(g.board.length<5){if(g.board.length===0||g.board.length===3||g.board.length===4)g.deck.pop();g.board.push(g.deck.pop())}
    const values=new Map(contenders.map(p=>[p.seat,this.handValue([...g.hands[p.seat],...g.board])]));
    const layers=[...new Set(g.players.map(p=>p.contribution).filter(Boolean))].sort((a,b)=>a-b);
    let previous=0;const awarded=new Map();
    for(const cap of layers){
      const contributors=g.players.filter(p=>p.contribution>=cap);
      const amount=(cap-previous)*contributors.length;previous=cap;
      const eligible=contenders.filter(p=>p.contribution>=cap);
      // An unmatched top contribution is an uncalled bet, not a contested pot.
      // Return it to its contributor even when every other player is all-in.
      if(contributors.length===1){
        const p=contributors[0];p.stack+=amount;
        continue;
      }
      if(!eligible.length)throw Error('Side pot has no eligible player');
      const scored=eligible.map(p=>({p,v:values.get(p.seat)})).sort((a,b)=>this.compare(b.v,a.v));
      const winners=scored.filter(x=>this.compare(x.v,scored[0].v)===0).map(x=>x.p);
      const each=Math.floor(amount/winners.length);let remainder=amount%winners.length;
      for(const p of winners){const chips=each+(remainder-->0?1:0);p.stack+=chips;awarded.set(p.seat,(awarded.get(p.seat)||0)+chips)}
    }
    // Every hand that reached showdown is revealed so players can verify the result.
    g.shown=contenders.map(p=>p.seat);
    // The five cards that won go with each winner, for the freeroll champion's banner (worker/tournament.js).
    g.winners=[...awarded].map(([seat,amount])=>({seat,name:g.players.find(p=>p.seat===seat).name,amount,hand:HAND_NAMES[values.get(seat)[0]],five:values.get(seat).five}));
    g.result=g.winners.map(w=>w.name+' wins '+w.amount+' with '+w.hand).join(' · ')||'Hand ended';
    g.pot=0;this.handStats();
  }
  endStreet(){
    const g=this.room.game;
    const alive=g.players.filter(p=>!p.folded);
    // A bot that wins without a showdown turns its cards over; a person keeps theirs hidden, as at a real table.
    if(alive.length===1){
      // What the winner takes back of their own last bet (nobody called it) is not counted as won in their stats.
      const p=alive[0],back=Math.max(0,p.contribution-Math.max(0,...g.players.filter(x=>x!==p).map(x=>x.contribution)));
      p.stack+=g.pot;g.winners=[{seat:p.seat,name:p.name,amount:g.pot}];g.result=p.name+' wins '+g.pot+' (everyone folded)';g.statsWon={[p.seat]:g.pot-back};
      g.pot=0;g.phase='showdown';g.shown=p.bot?[p.seat]:[];g.turn=-1;g.deadline=0;this.handStats();return;
    }
    if(g.phase==='river'){this.finishHand();return}
    // Once no more betting is possible the hands are turned face up and the board is dealt one street at a time,
    // so every card is on the table before the winner is announced. The first pause lets players see the hands.
    if(alive.filter(p=>!p.allIn).length<2){
      const started=g.runout;g.runout=true;g.shown=alive.map(p=>p.seat);g.turn=-1;g.deadline=Date.now()+RUNOUT_MS;
      for(const p of g.players)p.bet=0;
      g.currentBet=0;
      if(!started){
        // Hand back an uncalled bet now, so the pot on the table is only what the hands are playing for.
        const top=Math.max(...g.players.map(p=>p.contribution)),leaders=g.players.filter(p=>p.contribution===top);
        if(leaders.length===1){const p=leaders[0],back=top-Math.max(0,...g.players.filter(x=>x!==p).map(x=>x.contribution));p.stack+=back;p.contribution-=back;g.pot-=back;p.allIn=p.stack===0}
        return;
      }
    }
    g.deck.pop();const count=g.phase==='preflop'?3:1;
    for(let i=0;i<count;i++)g.board.push(g.deck.pop());
    g.phase=g.phase==='preflop'?'flop':g.phase==='flop'?'turn':'river';
    for(const p of g.players)p.bet=0;
    g.currentBet=0;g.minRaise=g.bigBlind;g.acted=[];g.raiseLocked=[];g.streetRaises=0;
    if(g.runout)return;
    g.turn=this.next(g.dealer,i=>g.players.some(p=>p.seat===i&&!p.folded&&!p.allIn));
    g.deadline=Date.now()+TURN_MS;
  }
  applyAction(seat,action,amount,grade=null){
    const g=this.room.game,p=g.players.find(x=>x.seat===seat),legal=this.legal(seat);
    if(!legal)throw Error('Not your turn');
    g.botThinking=false;
    const call=Math.max(0,g.currentBet-p.bet);
    // How each player has bet this hand shapes the ranges decision grading assumes for them.
    const raising=action==='raise'||action==='allin'&&p.stack>call,line=raising?2:(action==='call'||action==='allin')&&call>0?1:0;
    if(action==='fold')p.folded=true;
    else if(action==='check'){if(call)throw Error('Must call, raise, or fold')}
    else if(action==='call'||action==='allin'&&p.stack<=call){const v=Math.min(p.stack,call);p.stack-=v;p.bet+=v;p.contribution+=v;g.pot+=v}
    else if(action==='raise'||action==='allin'){
      if(!legal.canRaise)throw Error('Cannot raise');
      const target=action==='allin'?p.bet+p.stack:Number(amount);
      if(!Number.isInteger(target)||target<=g.currentBet||target>legal.raiseToMax)throw Error('Invalid raise amount');
      if(target%5!==0&&target!==legal.raiseToMax)throw Error('Raises must be in increments of 5');
      if(target<g.currentBet+g.minRaise&&target!==legal.raiseToMax)throw Error('Raise below minimum');
      const increment=target-g.currentBet,wasMin=g.minRaise;
      const v=target-p.bet;p.stack-=v;p.bet=target;p.contribution+=v;g.pot+=v;
      g.currentBet=target;g.streetRaises=(g.streetRaises||0)+1;
      if(increment>=wasMin){g.minRaise=increment;g.acted=[];g.raiseLocked=[]}
      else g.raiseLocked=[...new Set([...g.raiseLocked,...g.acted])];
    }else throw Error('Invalid action');
    if(p.stack===0)p.allIn=true;
    p.line=Math.max(p.line||0,line);
    g.acted=[...new Set([...g.acted,seat])];
    (g.log||=[]).push({seat,street:STREET_OF[g.phase]??0,type:action==='fold'?'f':raising?'r':call>0?'c':'k',to:raising?p.bet:0,grade});
    const active=g.players.filter(x=>!x.folded&&!x.allIn);
    const alive=g.players.filter(x=>!x.folded);
    if(alive.length===1||active.every(x=>g.acted.includes(x.seat)&&x.bet===g.currentBet)||active.length===0){this.endStreet()}
    else{g.turn=this.next(seat,i=>active.some(p=>p.seat===i));g.deadline=Date.now()+TURN_MS}
  }
  // Rough hand strength 0..1 for bots: preflop from the two cards, postflop from the made hand,
  // discounted when the pair or trips is only on the board.
  botStrength(p,g){
    const cards=g.hands[p.seat],[hi,lo]=cards.map(rankOf).sort((a,b)=>b-a);
    if(!g.board.length){
      if(hi===lo)return .5+hi/28;
      return (hi+lo)/30+(cards[0][1]===cards[1][1]?.06:0)+(hi-lo===1?.04:0)-.15;
    }
    const mine=this.handValue([...cards,...g.board]);
    const counts=[...g.board.reduce((m,c)=>m.set(rankOf(c),(m.get(rankOf(c))||0)+1),new Map()).values()].sort((a,b)=>b-a);
    const boardCategory=counts[0]>=3?3:counts[0]===2?(counts[1]===2?2:1):0;
    if(mine[0]<=boardCategory)return .12+hi/100;
    return [.2,.5,.68,.76,.84,.88,.94,.98,1][mine[0]]+(mine[0]===1?(mine[1]-8)/40:0);
  }
  botAction(p,g){
    const legal=this.legal(p.seat),style=LEVELS[this.room.seats[p.seat]?.level]||LEVELS.Intermediate;
    const strength=this.botStrength(p,g)+(Math.random()*2-1)*style.noise;
    const potOdds=legal.call/Math.max(1,g.pot+legal.call);
    const mayRaise=legal.canRaise&&(g.streetRaises||0)<BOT_RAISES_PER_STREET;
    if(mayRaise&&(strength>.72&&Math.random()<style.aggression+.2||legal.check&&strength>.55&&Math.random()<style.aggression)){
      // Raises go in steps of 5 (the server rejects anything else short of all-in), even when the bet to beat is not.
      const step=x=>5*Math.ceil(x/5),want=Math.max(step(legal.raiseToMin),step(g.currentBet+g.pot*(.5+Math.random()*.4)));
      const target=want>=legal.raiseToMax?legal.raiseToMax:want;
      if(target>g.currentBet)return ['raise',target];
    }
    if(legal.check)return ['check'];
    if(strength>potOdds+.18||legal.call<=g.bigBlind&&strength>.3)return ['call'];
    return ['fold'];
  }
  autoAdvance(){
    const g=this.room.game;if(!g||g.phase==='showdown')return;
    let guard=0;
    while(guard++<200){
      if(g.runout){if(Date.now()<g.deadline-50)break;this.endStreet();if(g.phase==='showdown')break;continue}
      const alive=g.players.filter(p=>!p.folded),active=alive.filter(p=>!p.allIn);
      if(alive.length<2||active.length===0||active.length===1&&active[0].bet===g.currentBet){this.endStreet();if(g.phase==='showdown')break;continue}
      const p=g.players.find(x=>x.seat===g.turn);
      if(!p){this.endStreet();if(g.phase==='showdown')break;continue}
      if(p.bot){
        // The first pass starts the bot's think clock; the alarm at that deadline makes the move.
        if(!g.botThinking){g.botThinking=true;g.deadline=Date.now()+botThinkMs();break}
        if(Date.now()<g.deadline-50)break;
        const [action,amount]=this.botAction(p,g);this.applyAction(p.seat,action,amount);
      }
      // Away players are skipped only while disconnected; one who still has the table open gets a normal turn and can act to come back.
      else if(p.left||p.away&&!this.seatOnline(p.seat))this.applyAction(p.seat,this.legal(p.seat).check?'check':'fold');
      else break;
      if(g.phase==='showdown')break;
    }
    if(g.phase!=='showdown')this.armAlarm(g.deadline).catch(()=>{});
  }
  async alarm(){
    this.alarmAt=0;
    await this.load();const room=this.room;if(!room)return;
    if(room.tourney)return this.tAlarm();
    const g=room.game,idleUntil=(room.lastActive||Date.now())+IDLE_MS;
    if(room.ranked&&!room.started&&room.startsAt){
      if(Date.now()<room.startsAt){await this.armAlarm(room.startsAt);return}
      if(room.seats.filter(Boolean).length>=2){try{await this.beginMatch()}catch(e){room.startsAt=0}await this.save();return}
      room.startsAt=0;
    }
    // Finished matches, lobbies and tables where every human is away wait for players; rooms idle for 6 hours are deleted.
    if(this.matchOver(g)||g.phase==='showdown'&&this.humansAway(g)){
      const pending=()=>room.pendingResults||room.pendingStats?.length;
      if(pending()){
        await this.save();
        if(pending()){await this.state.storage.setAlarm(Date.now()+30000);return}
      }
      if(Date.now()>=idleUntil&&!this.sockets().length)return this.destroy();
      await this.state.storage.setAlarm(Math.max(idleUntil,Date.now()+60000));return;
    }
    if(g.phase==='showdown'){
      if(Date.now()<(g.nextHandAt||0)){await this.armAlarm(g.nextHandAt);return}
      // Each hand is counted against the daily free-plan budget; past the hard limit the match stops unrated.
      const usage=await this.dir('/usage/hand',this.dealtTo());
      if(usage&&!usage.ok){g.result='Match complete';g.note=CLOSED_MESSAGE;g.nextHandAt=0;this.closeAllStats();room.match=null;await this.save();return}
      this.startHand(g);await this.save();return;
    }
    if(Date.now()<g.deadline-50){await this.armAlarm(g.deadline);return}
    const p=g.players.find(x=>x.seat===g.turn),legal=p&&this.legal(p.seat);
    if(p?.bot||g.runout)this.autoAdvance();
    else if(legal){
      this.applyAction(p.seat,legal.check?'check':'fold');
      if(++p.timeouts>=2)p.away=true;
      this.autoAdvance();
    }
    await this.save();
  }
  // Freeroll tables: the Tournament object decides who sits here; this table deals, reports after each hand and follows its plan.
  tourneyCall(path,body){
    if(!this.env.TOURNEYS)return Promise.resolve(null);
    return this.env.TOURNEYS.get(this.env.TOURNEYS.idFromName(this.room.tourney.id)).fetch('https://t'+path,{method:'POST',body:JSON.stringify({night:this.room.tourney.id,...body})})
      .then(r=>r.ok?r.json():null).catch(()=>null);
  }
  seatT(p){
    const room=this.room,id=String(p?.id||''),token=String(p?.token||'');if(!id||!token)return true;
    const had=Object.entries(room.members).find(([,m])=>m.accountId===id);
    if(had&&had[0]===token)return true;
    const seat=had?had[1].seat:room.seats.findIndex(s=>s===null);
    if(seat<0)return false;
    if(had)delete room.members[had[0]];
    else{room.tourney.stacks[id]=Math.max(0,Math.floor(Number(p.stack)||0));(room.tourney.ext||={})[id]=Math.max(0,Math.floor(Number(p.ext)||0))}
    const name=cleanName(p.name,'Player');
    room.members[token]={name,seat,accountId:id};
    room.seats[seat]={type:'human',name,avatar:/^data:image\//.test(p.avatar||'')?p.avatar:name[0].toUpperCase(),isHost:false,verified:true};
    return true;
  }
  tNotify(token,message){for(const [ws,t] of this.sockets())if(t===token){this.send(ws,{type:'freeroll',...message});try{ws.close(1000,'Freeroll')}catch{}}}
  // Everyone seated with chips is dealt in. A player with no open connection sits out the hand (folded when it is their turn).
  tParticipants(old){
    const room=this.room,online=new Set(this.sockets().map(([,t])=>t));
    return Object.entries(room.members).map(([token,m])=>{
      const prev=old?.players.find(p=>p.seat===m.seat&&p.name===m.name),stack=room.tourney.stacks[m.accountId]??0;
      return {seat:m.seat,name:m.name,bot:false,stack,start:stack,bet:0,contribution:0,folded:false,allIn:false,away:!online.has(token),timeouts:prev?.timeouts||0};
    }).filter(p=>p.stack>0).sort((a,b)=>a.seat-b.seat);
  }
  async tArm(){
    const t=this.room.tourney,g=this.room.game,now=Date.now();
    let at;
    if(t.done)at=Math.max(t.closeAt||0,now+60000);
    else if(g&&g.phase!=='showdown')at=g.deadline||now+TURN_MS;
    else if(g&&!t.waiting){g.nextHandAt||=now+NEXT_HAND_MS;at=Math.max(g.nextHandAt,t.wakeAt||0)}
    else at=t.wakeAt||now+15000;
    this.alarmAt=0;await this.armAlarm(at);
  }
  async tAlarm(){
    const room=this.room,t=room.tourney,g=room.game,now=Date.now();
    if(t.done){
      t.closeAt||=now+10*60*1000;
      if(now>=t.closeAt&&!this.sockets().length)return this.destroy();
      await this.save();return;
    }
    if(!g||g.phase==='showdown'){
      const due=Math.max(g&&!t.waiting?g.nextHandAt||0:0,t.wakeAt||0);
      if(now<due-50){this.alarmAt=0;await this.armAlarm(due);return}
      return this.tCycle();
    }
    if(now<g.deadline-50){this.alarmAt=0;await this.armAlarm(g.deadline);return}
    const p=g.players.find(x=>x.seat===g.turn),legal=p&&this.legal(p.seat);
    if(legal){this.applyAction(p.seat,legal.check?'check':'fold');if(++p.timeouts>=2)p.away=true}
    this.autoAdvance();await this.save();
  }
  // Between hands: report stacks, follow the plan (knock-outs, moves, new seats, final standings), then deal.
  async tCycle(halted=false){
    const room=this.room,t=room.tourney,g=room.game;
    // For the champion banners: who the hand's biggest winner knocked out, and the five cards each showdown winner won with.
    const ended=g?.phase==='showdown'&&!this.matchOver(g),top=ended?[...(g.winners||[])].sort((a,b)=>b.amount-a.amount)[0]:null;
    const busted=ended?g.players.filter(p=>p.start>0&&p.stack<=0&&p.seat!==top?.seat).map(p=>p.name):[];
    const players=Object.values(room.members).map(m=>{
      const p=g?.players.find(x=>x.seat===m.seat&&x.name===m.name);
      if(p)t.stacks[m.accountId]=p.stack;
      const w=ended&&p?g.winners.find(x=>x.seat===p.seat):null;
      return {id:m.accountId,stack:t.stacks[m.accountId]??0,start:p?.start??t.stacks[m.accountId]??0,ext:t.ext?.[m.accountId]||0,
        ...(top&&p&&top.seat===p.seat&&busted.length?{ko:busted}:{}),...(w?.five?{won:{five:w.five,name:w.hand}}:{})};
    });
    const plan=await this.tourneyCall('/report',{table:t.table,hand:ended?g.handNumber:0,players,halted});
    if(!plan){t.wakeAt=Date.now()+10000;t.waiting=true;await this.save();return}
    t.info=plan.info||t.info;t.blinds=plan.blinds||t.blinds;
    const keep=new Set((plan.seats||[]).map(s=>s.id));
    for(const [token,m] of Object.entries(room.members)){
      if(keep.has(m.accountId))continue;
      const id=m.accountId,entrants=plan.info?.entrants||0;
      const note=plan.finished?{kind:'finished',place:plan.places?.[id]??null,entrants,winner:plan.winner}
        :plan.out?.[id]?{kind:'out',place:plan.out[id].place,entrants}
        :plan.moves?.[id]?{kind:'moved',table:plan.moves[id].table}:{kind:'moved',table:0};
      this.tNotify(token,note);this.closeStats(id,{place:note.place??null});
      delete room.members[token];room.seats[m.seat]=null;delete t.stacks[id];if(t.ext)delete t.ext[id];
    }
    for(const s of plan.seats||[])this.seatT(s);
    if(plan.finished){
      t.done=true;t.closeAt=Date.now()+10*60*1000;
      if(g){g.result='Match complete';g.note=plan.note||(plan.winner?plan.winner+' wins tonight’s freeroll.':'');g.nextHandAt=0;g.turn=-1}
      await this.save();return;
    }
    if(plan.close||!Object.keys(room.members).length)return this.destroy();
    const seated=Object.values(room.members).filter(m=>(t.stacks[m.accountId]??0)>0).length;
    if(seated<2){t.waiting=true;t.wakeAt=Date.now()+15000;await this.save();return}
    // Freeroll hands count against the free daily budget like any other; past the hard limit the tournament ends by chip count.
    const usage=await this.dir('/usage/hand',this.dealtTo());
    if(usage&&!usage.ok&&!halted)return this.tCycle(true);
    t.waiting=false;t.wakeAt=0;
    this.startHand(g&&g.phase==='showdown'?g:null);
    await this.save();
  }
  reply(body,status=200){return Response.json(body,{status})}
  handOffHost(){
    const room=this.room,next=Object.entries(room.members).find(([token])=>token!==room.hostToken);
    for(const s of room.seats)if(s)s.isHost=false;
    if(!next)return false;
    room.hostToken=next[0];room.seats[next[1].seat].isHost=true;return true;
  }
  async removeMember(token,reason){
    const room=this.room,m=room.members[token];if(!m)return;
    // A player who leaves has their hands sent with no place (they left), unless they busted out of the match: then
    // their record waits for the match to end, which gives them their place.
    delete room.members[token];if(m.accountId&&!room.match?.out?.some(group=>group.includes(m.seat)))this.closeStats(m.accountId);
    const g=room.game,p=g?.players.find(x=>x.seat===m.seat);
    if(p&&!this.matchOver(g)){
      p.left=true;
      const match=room.match,busted=match?.out.flat().includes(p.seat);
      if(match?.ranked&&!busted)match.left=[...(match.left||[]),p.seat];else this.eliminate([p.seat]);
      if(g.phase!=='showdown'&&g.turn===p.seat){this.applyAction(p.seat,'fold');this.autoAdvance()}
    }
    room.seats[m.seat]=null;
    for(const [ws,t] of this.sockets())if(t===token){this.send(ws,{type:'removed',reason});try{ws.close(1000,reason)}catch{}}
    if(token===room.hostToken&&!this.handOffHost())return this.destroy();
    await this.rankedCountdown();
    await this.save();
  }
  async fetch(request){
    const path=new URL(request.url).pathname;
    const room=await this.load();
    const account=async key=>key?(await this.dir('/verify',{key}))?.account||null:null;
    if(path==='/create'&&request.method==='POST'){
      if(room)return this.reply({error:'Room code collision'},409);
      const body=await request.json(),a=await account(body.key);
      if(body.key&&!a)return this.reply({error:'Your sign-in code was not recognised. Sign in again.'},401);
      if(body.ranked&&!a)return this.reply({error:RANKED_SIGN_IN},401);
      const token=crypto.randomUUID(),host=a?a.name:cleanName(body.name,'Host');
      // Ranked tables are listed only in the Ranked queue, so Open Tables and Quick Play never seat anyone in one.
      this.room={code:String(body.code||''),hostToken:token,ranked:!!body.ranked,rankedMax:body.ranked&&RANKED_SIZES.includes(Number(body.size))?Number(body.size):6,visibility:!body.ranked&&body.visibility==='public'?'public':'private',seats:Array(9).fill(null),members:{[token]:{name:host,seat:0,accountId:a?.id||null}},started:false,game:null};
      this.room.seats[0]={type:'human',name:host,avatar:a?.avatar||host[0].toUpperCase(),isHost:true,verified:!!a};
      await this.save();return this.reply({token,seat:0});
    }
    if(path==='/t/setup'&&request.method==='POST'){
      if(room)return this.reply({error:'Room code collision'},409);
      const body=await request.json();
      this.room={code:String(body.code||''),hostToken:null,ranked:false,rankedMax:9,visibility:'private',seats:Array(9).fill(null),members:{},started:false,game:null,
        tourney:{id:String(body.tid),table:Number(body.table),wakeAt:Number(body.startsAt)||Date.now(),stacks:{},info:null,blinds:null,done:false,waiting:false}};
      await this.save();return this.reply({ok:true});
    }
    if(!room)return this.reply({error:'Room not found. Check the code.'},404);
    if(path==='/t/add'&&request.method==='POST'){
      if(!room.tourney||room.tourney.done)return this.reply({error:'Not a freeroll table'},409);
      const body=await request.json();
      for(const p of Array.isArray(body.players)?body.players:[])if(!this.seatT(p))return this.reply({error:'Table is full'},409);
      // A table waiting for opponents deals as soon as someone is seated with it.
      if(room.tourney.waiting){room.tourney.waiting=false;room.tourney.wakeAt=Date.now()+1500}
      await this.save();return this.reply({ok:true});
    }
    if(path==='/seated'&&request.method==='POST'){
      const id=String((await request.json()).id||''),m=id&&Object.values(room.members).find(x=>x.accountId===id);
      return this.reply(m?{ok:true,seat:m.seat,kind:room.tourney?'freeroll':room.ranked?'ranked':'casual'}:{ok:false});
    }
    if(path==='/t/poke'){if(room.tourney){this.alarmAt=0;await this.save()}return this.reply({ok:true})}
    if(path==='/join'&&request.method==='POST'){
      if(room.tourney)return this.reply({error:'Freeroll tables are seated by the tournament.'},403);
      if(room.started&&!this.matchOver(room.game))return this.reply({error:'Match already in progress'},409);
      const body=await request.json(),a=await account(body.key);
      if(body.key&&!a)return this.reply({error:'Your sign-in code was not recognised. Sign in again.'},401);
      // Signing in from another device takes back the same seat.
      const mine=a&&Object.entries(room.members).find(([,m])=>m.accountId===a.id);
      if(mine){room.seats[mine[1].seat].avatar=a.avatar||a.name[0].toUpperCase();await this.save();return this.reply({token:mine[0],seat:mine[1].seat})}
      if(room.ranked&&!a)return this.reply({error:RANKED_SIGN_IN},401);
      if(room.ranked&&!body.ranked)return this.reply({error:'Ranked tables are matchmade. Use Find Ranked Match.'},403);
      if(room.ranked&&Number(body.size)!==rankedSize(room))return this.reply({error:'Wrong ranked table size.'},409);
      if(room.ranked&&room.seats.filter(Boolean).length>=rankedSize(room))return this.reply({error:'Room is full'},409);
      const seat=room.seats.findIndex(s=>s===null);
      if(seat<0)return this.reply({error:'Room is full'},409);
      const token=crypto.randomUUID(),name=a?a.name:cleanName(body.name,'Guest');
      room.members[token]={name,seat,accountId:a?.id||null};
      room.seats[seat]={type:'human',name,avatar:a?.avatar||name[0].toUpperCase(),isHost:false,verified:!!a};
      await this.rankedCountdown();
      await this.save();return this.reply({token,seat});
    }
    if(path==='/ws'){
      const pair=new WebSocketPair();
      // Hibernatable sockets: a room is not billed while players sit idle in it.
      this.state.acceptWebSocket(pair[1]);
      return new Response(null,{status:101,webSocket:pair[0]});
    }
    return this.reply({error:'Not found'},404);
  }
  async webSocketMessage(ws,data){
    const room=await this.load();
    if(!room){this.send(ws,{type:'removed',reason:'This room has closed'});try{ws.close(1000,'Room closed')}catch{}return}
    try{
      if(data==='ping'){try{ws.send('pong')}catch{}return}
      if(typeof data!=='string'||data.length>MAX_MESSAGE)throw Error('Message too large');
      const msg=JSON.parse(data);
      const attached=ws.deserializeAttachment();
      if(attached?.watch){
        if(msg.type==='ping')return this.send(ws,{type:'pong'});
        throw Error('Spectators can watch but not play or chat');
      }
      let token=attached?.token;
      if(!token&&msg.type==='watch')return this.watch(ws,msg);
      if(!token){
        // The seat token is sent as the first message, never in the URL.
        if(msg.type!=='auth'||!room.members[msg.token]){this.send(ws,{type:'removed',reason:'Your seat in this room is gone'});ws.close(1008,'Unauthorized');return}
        token=msg.token;ws.serializeAttachment({token});
        const p=room.game?.players.find(x=>x.seat===room.members[token].seat);
        if(p?.away&&!p.left){p.away=false;p.timeouts=0;if(room.game.phase==='showdown'&&!this.matchOver(room.game))room.game.nextHandAt=Date.now()+2000}
        await this.save();return;
      }
      const member=room.members[token];
      if(!member){ws.close(1008,'Unauthorized');return}
      const host=token===room.hostToken;
      if(msg.type==='ping')return this.send(ws,{type:'pong'});
      if(msg.type==='chat'){
        // Only authenticated seated humans can chat; never trust a client-supplied name or seat.
        const text=typeof msg.text==='string'?msg.text.trim():'';
        if(!text||text.length>CHAT_MAX_CHARS||/[\u0000-\u001f\u007f]/.test(text))throw Error('Chat must be 1–180 characters with no control characters');
        const now=Date.now();if(now-(member.lastChatAt||0)<CHAT_COOLDOWN_MS)throw Error('Please wait a moment before chatting');
        member.lastChatAt=now;
        const entry={id:crypto.randomUUID(),seat:member.seat,name:member.name,text,at:now};
        room.chat=[...(room.chat||[]),entry].slice(-CHAT_HISTORY_LIMIT);
        room.lastActive=now;
        await this.state.storage.put('room',room);
        for(const [client] of this.sockets())this.send(client,{type:'chat',message:entry});
        return;
      }
      if(msg.type==='leave'){
        // Leaving a freeroll table keeps the seat: hands are folded until the player comes back.
        if(room.tourney){const p=room.game?.players.find(x=>x.seat===member.seat);if(p&&!this.matchOver(room.game))p.away=true;try{ws.close(1000,'Left the table')}catch{}await this.save();return}
        return this.removeMember(token,'You left the room');
      }
      if(msg.type==='extend'){
        const left=this.extensionsLeft(member);
        if(left==null||this.matchOver(room.game))throw Error('Time extensions are for Ranked matches and the freeroll');
        if(!this.legal(member.seat))throw Error('You can add time only on your turn');
        if(left<=0)throw Error(room.tourney?'No time extensions left this tournament':'No time extensions left this match');
        if(room.tourney){const used=room.tourney.ext||={};used[member.accountId]=(used[member.accountId]||0)+1}
        else{const used=room.match.extensions||={};used[member.seat]=(used[member.seat]||0)+1}
        room.game.deadline+=EXTENSION_MS;
        const p=room.game.players.find(x=>x.seat===member.seat);if(p)p.timeouts=0;
        await this.save();return;
      }
      if(msg.type==='action'){
        if(this.matchOver(room.game))throw Error('Match not started');
        const p=room.game.players.find(x=>x.seat===member.seat);
        // A signed-in player's decision is graded before it changes the table, for their stats in every mode and for
        // Ranked Elo; a failed grade never blocks play.
        let graded=null;const legal=member.accountId&&this.legal(member.seat);
        if(legal&&['fold','check','call','raise','allin'].includes(msg.action)&&(msg.action!=='check'||legal.check))try{graded=gradeDecision(room.game,member.seat,msg.action,msg.amount)}catch{}
        this.applyAction(member.seat,msg.action,msg.amount,graded);
        if(graded&&room.match?.ranked){const d=(room.match.grades||={})[member.seat]||={s:0,w:0,n:0};d.s+=graded.acc*graded.weight;d.w+=graded.weight;d.n++}
        if(p){p.timeouts=0;p.away=false}
        this.autoAdvance();await this.save();return;
      }
      if(!host)throw Error('Host only');
      if(msg.type==='newMatch'){
        if(!this.matchOver(room.game))throw Error('Match still running');
        if(room.ranked)throw Error('Find a new Ranked match from the queue');
        room.game=null;room.started=false;await this.save();return;
      }
      if(msg.type==='removePlayer'){
        if(room.ranked)throw Error('Ranked tables are matchmade');
        const seat=Number(msg.seat),entry=Object.entries(room.members).find(([,m])=>m.seat===seat);
        if(!this.matchOver(room.game))throw Error('Cannot remove players during a match');
        if(!entry||entry[0]===token)throw Error('Invalid player seat');
        return this.removeMember(entry[0],'The host removed you from the room');
      }
      if(!this.matchOver(room.game))throw Error('Match already started');
      if(msg.type==='startMatch'){
        if(room.ranked)throw Error('Ranked matches start on their own once players are found');
        await this.beginMatch();
      }else if(msg.type==='visibility'&&['private','public'].includes(msg.visibility)){
        if(room.ranked)throw Error('Ranked tables are matchmade');
        room.visibility=msg.visibility;
      }else if(msg.type==='addBot'){
        if(room.ranked)throw Error('Ranked rooms are for signed-in players only, no bots');
        const seat=Number(msg.seat),level=String(msg.level);
        if(!Number.isInteger(seat)||seat<0||seat>8||room.seats[seat]||!LEVELS[level])throw Error('Invalid seat or skill level');
        const taken=new Set(room.seats.filter(Boolean).map(s=>s.name));
        const available=ALIASES.filter(name=>!taken.has(name));
        const name=available.length?pick(available):'Player'+crypto.randomUUID().slice(0,5);
        room.seats[seat]={type:'bot',name,avatar:pick(AVATARS),level};
      }else if(msg.type==='removeBot'){
        const seat=Number(msg.seat);if(!Number.isInteger(seat)||seat<0||seat>8||room.seats[seat]?.type!=='bot')throw Error('Invalid bot seat');
        room.seats[seat]=null;
      }else throw Error('Unsupported action');
      await this.save();
    }catch(e){this.send(ws,{type:'error',error:e.message})}
  }
  async webSocketClose(ws){try{ws.close()}catch{}if(await this.load())this.broadcast()}
  async webSocketError(ws){try{ws.close()}catch{}}
}
