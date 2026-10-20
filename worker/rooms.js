/* RIVL — Cloudflare Worker + Durable Objects. Serves the site (static assets), runs poker rooms,
   and talks to the Directory (accounts, online ratings, lobby, free-plan budget). */
export {Directory} from './directory.js';
import {gradeDecision} from './grading.js';
import {verifyGoogleToken} from './google.js';
import {cleanReport,sendBugReport,BUG_MAX_CHARS} from './bug-report.js';
import {puzzleFor,publicPuzzle,reveal,CHOICES} from './puzzle.js';
const CODE_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHAT_MAX_CHARS=180,CHAT_HISTORY_LIMIT=40,CHAT_COOLDOWN_MS=1500;
const MAX_BODY=1000,MAX_MESSAGE=2000,TURN_MS=12000,NEXT_HAND_MS=13000,IDLE_MS=6*60*60*1000,BOT_RAISES_PER_STREET=4,BOT_THINK_MIN_MS=2000,BOT_THINK_MAX_MS=4800;
// Bots take a fresh random 2–5 seconds on every decision, so play reads like a person thinking.
// The cap sits just under 5 seconds so alarm and network delay never push a move past 5.
const botThinkMs=()=>BOT_THINK_MIN_MS+Math.floor(Math.random()*(BOT_THINK_MAX_MS-BOT_THINK_MIN_MS));
// Blinds rise every 8 hands so a match reaches a finish.
const BLINDS=[[10,20],[15,30],[25,50],[50,100],[75,150],[100,200],[150,300],[200,400],[300,600],[500,1000]];
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
// Ranked is matchmaking only: tables fill from the queue, start on their own, and are never joined by code.
const RANKED_SIZES=[3,6,9],RANKED_COUNTDOWN_MS=15000;
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
      if(request.method==='GET'){
        if(url.pathname==='/api/status')return send(await cached(env,'/status',10000));
        // The Google OAuth client ID is public; the page reads it here so it lives in one place (wrangler.toml).
        if(url.pathname==='/api/config')return json({googleClientId:env.GOOGLE_CLIENT_ID||''});
        if(url.pathname==='/api/puzzle'){
          const pz=puzzleFor(url.searchParams.get('day')||undefined);
          return pz?json(publicPuzzle(pz)):json({error:'No puzzle for that day.'},404);
        }
        if(url.pathname==='/api/lobby')return send(await cached(env,'/lobby',5000));
        if(url.pathname==='/api/leaderboard')return send(await cached(env,'/leaderboard',10000));
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
      if(url.pathname==='/api/google'){
        if(await limited(env.JOIN_LIMITER,request))return json({error:'Too many attempts. Try again in a minute.'},429);
        const body=await readBody(request,6000);
        const claims=await verifyGoogleToken(body.credential,env.GOOGLE_CLIENT_ID);
        if(body.name!=null&&!body.key&&await limited(env.ACCOUNT_LIMITER,request))return json({error:'Too many new accounts from your network. Try again in a minute.'},429);
        return send(await dir(env,'/accounts/google',{sub:claims.sub,name:body.name,key:body.key}));
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
  // One alarm write per turn clock is enough: an early alarm just re-arms itself for the real deadline.
  async armAlarm(at){if(this.alarmAt>Date.now()&&this.alarmAt<=at)return;this.alarmAt=at;await this.state.storage.setAlarm(at)}
  async load(){if(!this.room)this.room=await this.state.storage.get('room')||null;return this.room}
  sockets(){return this.state.getWebSockets().filter(ws=>ws.readyState===1).map(ws=>[ws,ws.deserializeAttachment()?.token]).filter(([,token])=>token)}

  publicState(token){
    const g=this.room.game,m=this.room.members[token];
    const onlineSeats=new Set(this.sockets().map(([,t])=>this.room.members[t]?.seat));
    const shown=g?.phase==='showdown'&&g.shown?Object.fromEntries(g.shown.map(s=>[s,g.hands[s]])):{};
    return {visibility:this.room.visibility,started:!!this.room.started,mySeat:m?m.seat:-1,serverNow:Date.now(),
      seats:this.room.seats.map((s,i)=>s?{type:s.type,name:s.name,avatar:s.avatar,accountId:Object.values(this.room.members).find(m=>m.seat===i)?.accountId||null,level:s.level,isHost:!!s.isHost,verified:!!s.verified,online:s.type==='bot'||onlineSeats.has(i)}:null),
      chat:(this.room.chat||[]).slice(-CHAT_HISTORY_LIMIT),ranked:!!this.room.ranked,rated:this.rated(),startsAt:this.room.startsAt||0,rankedMax:rankedSize(this.room),
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
  }
  matchOver(g=this.room?.game){return !g||g.result==='Match complete'}
  humansAway(g){return g.players.filter(p=>!p.bot&&!p.left).every(p=>p.away)}
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
    await this.syncLobby();
    if(this.matchOver(g))await this.armAlarm(room.lastActive+IDLE_MS);
    else if(g.phase==='showdown'){g.nextHandAt||=Date.now()+NEXT_HAND_MS;this.alarmAt=0;await this.armAlarm(g.nextHandAt)}
    await this.state.storage.put('room',room);this.broadcast();
  }
  // Public rooms with open seats that have not started are listed in the lobby.
  async syncLobby(){
    const room=this.room;if(!room.code)return;
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
    if(!m.ranked){this.room.match=null;return}
    const order=[...standing.sort((a,b)=>b.stack-a.stack).map(p=>[p.seat]),...[...m.out].reverse(),...[...(m.left||[])].reverse().map(s=>[s])];
    const place={};let next=1;for(const group of order){for(const s of group)place[s]=next;next+=group.length}
    // Each Ranked player's decision accuracy (weighted like bot practice) goes with their place.
    const accuracy=seat=>{const d=m.grades?.[seat];return d?.n?{acc:d.s/d.w,decisions:d.n}:{acc:null,decisions:0}};
    const players=Object.entries(m.accounts).map(([seat,id])=>({id,place:place[seat]??next,...accuracy(seat)}));
    if(players.length>=2)this.room.pendingResults={matchId:m.id,players};
    else if(this.room.game)this.room.game.note='Unrated: at least two signed-in players are needed for a rated match.';
    this.room.match=null;
  }
  // Deal the first hand of a new match. Ranked tables call this from their countdown; other rooms from the host's Start.
  async beginMatch(){
    const room=this.room;
    if(room.seats.filter(Boolean).length<2)throw Error('At least two players required');
    const usage=await this.dir('/usage/hand',{newMatch:true});
    if(usage&&!usage.ok)throw Error(CLOSED_MESSAGE);
    room.startsAt=0;
    room.match={id:crypto.randomUUID(),ranked:!!room.ranked,out:[],left:[],accounts:Object.fromEntries(Object.values(room.members).filter(m=>m.accountId).map(m=>[m.seat,m.accountId]))};
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
  async destroy(){if(this.room?.lobbySig)await this.dir('/lobby/remove',{code:this.room.code});for(const ws of this.state.getWebSockets())try{ws.close(1000,'Room closed')}catch{}this.room=null;await this.state.storage.deleteAlarm();await this.state.storage.deleteAll()}
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
    const participants=this.room.seats.flatMap((s,i)=>s?[{seat:i,name:s.name,bot:s.type==='bot',stack:old?carried(i)?.stack??0:1000,bet:0,contribution:0,folded:false,allIn:false,away:!!carried(i)?.away,timeouts:carried(i)?.timeouts||0}]:[]).filter(p=>p.stack>0);
    if(old)this.eliminate(old.players.filter(p=>!participants.some(x=>x.seat===p.seat)).map(p=>p.seat));
    if(participants.length<2||!participants.some(p=>!p.bot)){
      if(old){old.phase='showdown';old.result='Match complete';old.turn=-1;old.deadline=0;old.nextHandAt=0;this.finishMatch(participants)}
      return;
    }
    const handNumber=(old?.handNumber||0)+1,[smallBlind,bigBlind]=BLINDS[Math.min(BLINDS.length-1,Math.floor((handNumber-1)/8))];
    const g={phase:'preflop',handNumber,pot:0,board:[],players:participants,hands:{},deck:this.randomDeck(),turn:-1,deadline:0,currentBet:0,minRaise:bigBlind,smallBlind,bigBlind,acted:[],raiseLocked:[],streetRaises:0,winners:[],result:'',dealer:-1,nextHandAt:0,shown:[]};
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
      const s=score5([cards[a],cards[b],cards[c],cards[d],cards[e]]);
      if(!best||this.compare(s,best)>0)best=s;
    }return best;
  }
  compare(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return d}return 0}
  finishHand(){
    const g=this.room.game;g.turn=-1;g.deadline=0;g.phase='showdown';
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
    g.winners=[...awarded].map(([seat,amount])=>({seat,name:g.players.find(p=>p.seat===seat).name,amount,hand:HAND_NAMES[values.get(seat)[0]]}));
    g.result=g.winners.map(w=>w.name+' wins '+w.amount+' with '+w.hand).join(' · ')||'Hand ended';
    g.pot=0;
  }
  endStreet(){
    const g=this.room.game;
    const alive=g.players.filter(p=>!p.folded);
    // A bot that wins without a showdown turns its cards over; a person keeps theirs hidden, as at a real table.
    if(alive.length===1){alive[0].stack+=g.pot;g.winners=[{seat:alive[0].seat,name:alive[0].name,amount:g.pot}];g.result=alive[0].name+' wins '+g.pot+' (everyone folded)';g.pot=0;g.phase='showdown';g.shown=alive[0].bot?[alive[0].seat]:[];g.turn=-1;g.deadline=0;return}
    if(g.phase==='river'||alive.filter(p=>!p.allIn).length<2){this.finishHand();return}
    g.deck.pop();const count=g.phase==='preflop'?3:1;
    for(let i=0;i<count;i++)g.board.push(g.deck.pop());
    g.phase=g.phase==='preflop'?'flop':g.phase==='flop'?'turn':'river';
    for(const p of g.players)p.bet=0;
    g.currentBet=0;g.minRaise=g.bigBlind;g.acted=[];g.raiseLocked=[];g.streetRaises=0;
    g.turn=this.next(g.dealer,i=>g.players.some(p=>p.seat===i&&!p.folded&&!p.allIn));
    g.deadline=Date.now()+TURN_MS;
  }
  applyAction(seat,action,amount){
    const g=this.room.game,p=g.players.find(x=>x.seat===seat),legal=this.legal(seat);
    if(!legal)throw Error('Not your turn');
    g.botThinking=false;
    const call=Math.max(0,g.currentBet-p.bet);
    // How each player has bet this hand shapes the ranges decision grading assumes for them.
    const line=action==='raise'||action==='allin'&&p.stack>call?2:(action==='call'||action==='allin')&&call>0?1:0;
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
      else if(p.away||p.left)this.applyAction(p.seat,this.legal(p.seat).check?'check':'fold');
      else break;
      if(g.phase==='showdown')break;
    }
    if(g.phase!=='showdown')this.armAlarm(g.deadline).catch(()=>{});
  }
  async alarm(){
    this.alarmAt=0;
    await this.load();const room=this.room;if(!room)return;
    const g=room.game,idleUntil=(room.lastActive||Date.now())+IDLE_MS;
    if(room.ranked&&!room.started&&room.startsAt){
      if(Date.now()<room.startsAt){await this.armAlarm(room.startsAt);return}
      if(room.seats.filter(Boolean).length>=2){try{await this.beginMatch()}catch(e){room.startsAt=0}await this.save();return}
      room.startsAt=0;
    }
    // Finished matches, lobbies and tables where every human is away wait for players; rooms idle for 6 hours are deleted.
    if(this.matchOver(g)||g.phase==='showdown'&&this.humansAway(g)){
      if(room.pendingResults){
        await this.save();
        if(room.pendingResults){await this.state.storage.setAlarm(Date.now()+30000);return}
      }
      if(Date.now()>=idleUntil&&!this.sockets().length)return this.destroy();
      await this.state.storage.setAlarm(Math.max(idleUntil,Date.now()+60000));return;
    }
    if(g.phase==='showdown'){
      if(Date.now()<(g.nextHandAt||0)){await this.armAlarm(g.nextHandAt);return}
      // Each hand is counted against the daily free-plan budget; past the hard limit the match stops unrated.
      const usage=await this.dir('/usage/hand',{});
      if(usage&&!usage.ok){g.result='Match complete';g.note=CLOSED_MESSAGE;g.nextHandAt=0;room.match=null;await this.save();return}
      this.startHand(g);await this.save();return;
    }
    if(Date.now()<g.deadline-50){await this.armAlarm(g.deadline);return}
    const p=g.players.find(x=>x.seat===g.turn),legal=p&&this.legal(p.seat);
    if(p?.bot)this.autoAdvance();
    else if(legal){
      this.applyAction(p.seat,legal.check?'check':'fold');
      if(++p.timeouts>=2)p.away=true;
      this.autoAdvance();
    }
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
    delete room.members[token];
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
    if(!room)return this.reply({error:'Room not found. Check the code.'},404);
    if(path==='/join'&&request.method==='POST'){
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
      let token=ws.deserializeAttachment()?.token;
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
      if(msg.type==='leave')return this.removeMember(token,'You left the room');
      if(msg.type==='action'){
        if(this.matchOver(room.game))throw Error('Match not started');
        const p=room.game.players.find(x=>x.seat===member.seat);
        // Ranked: grade the decision before it changes the table; a failed grade never blocks play.
        let graded=null;
        if(room.match?.ranked&&member.accountId&&this.legal(member.seat))try{graded=gradeDecision(room.game,member.seat,msg.action,msg.amount)}catch{}
        this.applyAction(member.seat,msg.action,msg.amount);
        if(graded){const d=(room.match.grades||={})[member.seat]||={s:0,w:0,n:0};d.s+=graded.acc*graded.weight;d.w+=graded.weight;d.n++}
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
