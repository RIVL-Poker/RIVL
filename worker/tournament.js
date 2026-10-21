/* Nightly freeroll: one free tournament every night at 9 PM Central for up to 40 signed-in players.
   One Tournament object per night owns sign-ups, the blind clock, chip counts and who sits where. The tables are
   ordinary Room objects in tournament mode: after every hand a table reports its stacks here and is told who to
   keep, who to seat, who moves to another table and who is out. No real money, no Elo; just places and points. */
export const FREEROLL={cap:40,stack:5000,levelMs:6*60000,regOpensMs:10*60000,lateRegMs:10*60000,tableSize:9,maxMs:4*3600000,startHour:21,zone:'America/Chicago'};
// Blinds by level (six minutes each), sized for 5,000-chip stacks so a full field finishes in about an hour and a half.
export const FREEROLL_BLINDS=[[25,50],[50,100],[75,150],[100,200],[150,300],[200,400],[300,600],[400,800],[500,1000],[700,1400],[1000,2000],[1500,3000],[2000,4000],[3000,6000],[4000,8000],[6000,12000],[8000,16000],[10000,20000],[15000,30000],[20000,40000],[30000,60000],[50000,100000]];
const FIRST_HAND_MS=20000,WATCH_MS=60000,STALE_MS=3*60000;
const CODE_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Minutes the zone is ahead of UTC at instant t (negative for the Americas).
function zoneOffset(t){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:FREEROLL.zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(t).map(x=>[x.type,x.value]));
  return Math.round((Date.UTC(+p.year,p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(t/1000)*1000)/60000);
}
// 9 PM Central on the given date, as a UTC timestamp (daylight saving included).
export function startOf(night){
  const wall=Date.parse(night+'T00:00:00Z')+FREEROLL.startHour*3600000;
  const guess=wall-zoneOffset(wall)*60000;
  return wall-zoneOffset(guess)*60000;
}
// Tonight's freeroll. The night rolls over at 4 AM Central so a tournament running past midnight stays "tonight".
export function nightOf(now=Date.now()){return new Date(now+zoneOffset(now)*60000-4*3600000).toISOString().slice(0,10)}
const nextNight=night=>new Date(Date.parse(night+'T12:00:00Z')+86400000).toISOString().slice(0,10);
export const validNight=n=>typeof n==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(n)&&new Date(Date.parse(n+'T00:00:00Z')).toISOString().slice(0,10)===n;
export const levelAt=(t,now)=>Math.max(0,Math.floor((now-t.startAt)/FREEROLL.levelMs));
const blindsFor=level=>FREEROLL_BLINDS[Math.min(FREEROLL_BLINDS.length-1,level)];
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};

export class Tournament {
  constructor(state,env){this.state=state;this.env=env;this.t=null;this.inflight=new Set()}
  reply(body,status=200){return Response.json(body,{status})}
  async load(night){
    if(!this.t)this.t=await this.state.storage.get('t')||null;
    if(!this.t&&validNight(night))this.t={night,startAt:startOf(night),status:'scheduled',players:{},tables:{},breaking:0,entrants:0,finishedAt:0,recorded:false};
    // A night that hasn't started follows the current schedule, so a changed start time applies the same night.
    // Anyone already signed up stays signed up, and the start alarm moves with it.
    const t=this.t,start=t&&startOf(t.night);
    if(t&&t.status==='scheduled'&&start!==t.startAt&&Date.now()<Math.min(start,t.startAt)){
      t.startAt=start;
      if(Object.keys(t.players).length){await this.save();await this.state.storage.setAlarm(start)}
    }
    return this.t;
  }
  async save(){await this.state.storage.put('t',this.t)}
  // Registration opens 10 minutes before the start and stays open for the first ten minutes of play.
  phase(now=Date.now()){
    const t=this.t;
    if(t.status==='running'||t.status==='finished'||t.status==='cancelled')return t.status;
    if(now>=t.startAt+FREEROLL.lateRegMs)return 'cancelled';
    if(now>=t.startAt)return 'starting';
    return now>=t.startAt-FREEROLL.regOpensMs?'registering':'scheduled';
  }
  alive(){return Object.values(this.t.players).filter(p=>p.place==null)}
  assigned(n){return this.alive().filter(p=>p.table===n)}
  openTables(){return Object.entries(this.t.tables).filter(([,x])=>!x.closed).map(([n])=>Number(n))}
  view(now=Date.now()){
    const t=this.t,status=this.phase(now),level=levelAt(t,now),alive=this.alive();
    const players=Object.values(t.players).map(p=>({id:p.id,name:p.name,stack:p.place==null?p.stack:0,table:p.place==null?p.table||0:0,place:p.place??null}))
      .sort((a,b)=>(a.place??0)-(b.place??0)||b.stack-a.stack||a.name.localeCompare(b.name));
    const winner=Object.values(t.players).find(p=>p.place===1);
    return {night:t.night,status,serverNow:now,startAt:t.startAt,regOpensAt:t.startAt-FREEROLL.regOpensMs,lateRegEndsAt:t.startAt+FREEROLL.lateRegMs,nextStartAt:startOf(nextNight(t.night)),
      cap:FREEROLL.cap,entrants:Object.keys(t.players).length,left:status==='running'?alive.length:null,tables:status==='running'?this.openTables().length:0,
      level:status==='running'?{n:level+1,blinds:blindsFor(level),next:blindsFor(level+1),nextAt:t.startAt+(level+1)*FREEROLL.levelMs}:null,
      lateReg:status==='running'&&now<t.startAt+FREEROLL.lateRegMs&&Object.keys(t.players).length<FREEROLL.cap,
      structure:{stack:FREEROLL.stack,blinds:FREEROLL_BLINDS[0],levelMinutes:FREEROLL.levelMs/60000,lateRegMinutes:FREEROLL.lateRegMs/60000,tableSize:FREEROLL.tableSize},
      winner:winner?{id:winner.id,name:winner.name}:null,finishedAt:t.finishedAt||0,note:t.note||'',players};
  }
  // Calls to tables. Adds and pokes are sent after this object's own state is saved, never awaited inside a report.
  room(code,path,body){return this.env.ROOMS.get(this.env.ROOMS.idFromName(code)).fetch('https://room'+path,{method:'POST',body:JSON.stringify(body||{})})}
  later(promise){const p=promise.catch(()=>{}).finally(()=>this.inflight.delete(p));this.inflight.add(p);return p}
  async settle(){while(this.inflight.size)await Promise.all([...this.inflight])}
  async openTable(n,startsAt){
    for(let attempt=0;attempt<4;attempt++){
      const code=Array.from(crypto.getRandomValues(new Uint8Array(6)),x=>CODE_CHARS[x%32]).join('');
      const r=await this.room(code,'/t/setup',{code,tid:this.t.night,table:n,startsAt});
      if(r.status===409)continue;
      if(!r.ok)throw Error('Could not open a freeroll table');
      this.t.tables[n]={code,reportedAt:Date.now(),closed:false};return code;
    }
    throw Error('Could not open a freeroll table');
  }
  seatFor(p){return {id:p.id,name:p.name,avatar:p.avatar,token:p.token,stack:p.stack,ext:p.ext||0}}
  // Point a player at a table with a fresh seat token, then tell that table (after the caller saves).
  assign(p,n){p.table=n;p.token=crypto.randomUUID();p.seated=false;return p}
  sendSeats(n,players){
    const table=this.t.tables[n];if(!table||!players.length)return;
    this.later(this.room(table.code,'/t/add',{players:players.map(p=>this.seatFor(p))}).then(async r=>{
      if(!r.ok)return;
      let changed=false;for(const q of players){const p=this.t.players[q.id];if(p&&p.table===n&&p.token===q.token&&!p.seated){p.seated=true;changed=true}}
      if(changed)await this.save();
    }));
  }
  async start(now=Date.now()){
    const t=this.t,list=shuffle(Object.values(t.players));
    if(list.length<2){t.status='cancelled';t.note='Not enough players signed up tonight.';t.finishedAt=now;return}
    // Tables are opened before anything is marked as started, so a failed start is simply retried by the alarm.
    const count=Math.ceil(list.length/FREEROLL.tableSize),seating={};
    for(let n=1;n<=count;n++)await this.openTable(n,now+FIRST_HAND_MS);
    t.status='running';
    list.forEach((p,i)=>{const n=i%count+1;p.stack=FREEROLL.stack;p.handStart=FREEROLL.stack;this.assign(p,n);(seating[n]||=[]).push(p)});
    await this.save();
    for(let n=1;n<=count;n++)this.sendSeats(n,seating[n]);
  }
  // A late entry sits at the emptiest table with room, or opens a new one that fills as other tables balance.
  async lateSeat(p){
    const open=this.openTables().map(n=>[n,this.assigned(n).length]).filter(([,c])=>c<FREEROLL.tableSize).sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
    let n=open[0]?.[0];
    if(!n){n=Math.max(0,...Object.keys(this.t.tables).map(Number))+1;await this.openTable(n,Date.now()+3000)}
    p.stack=FREEROLL.stack;this.assign(p,n);return n;
  }
  // Busts, table breaks and balancing, decided each time a table finishes a hand. Only the reporting table's
  // players move, so every move happens between that table's hands.
  balance(n,moves){
    const others=()=>this.openTables().filter(x=>x!==n).map(x=>[x,this.assigned(x).length]).sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
    const alive=this.alive().length,needed=Math.ceil(alive/FREEROLL.tableSize),open=this.openTables();
    const send=(p,to)=>{this.assign(p,to);moves[p.id]={table:to};(moves.byTable[to]||=[]).push(p)};
    if(open.length>needed){
      const breaking=this.t.breaking;
      if(!breaking||this.t.tables[breaking]?.closed||!open.includes(breaking))
        this.t.breaking=open.map(x=>[x,this.assigned(x).length]).sort((a,b)=>a[1]-b[1]||b[0]-a[0])[0][0];
      if(this.t.breaking===n){
        for(const p of shuffle(this.assigned(n))){const to=others().find(([,c])=>c<FREEROLL.tableSize);if(to)send(p,to[0])}
        if(!this.assigned(n).length){this.t.tables[n].closed=true;this.t.breaking=0}
        return;
      }
    }
    // Keep tables within one player of each other: move from this table to the emptiest one.
    for(let guard=0;guard<FREEROLL.tableSize;guard++){
      const mine=this.assigned(n),low=others()[0];
      if(!low||mine.length-low[1]<2)break;
      send(shuffle(mine)[0],low[0]);
    }
  }
  finish(now=Date.now()){
    const t=this.t,alive=this.alive().sort((a,b)=>b.stack-a.stack);
    alive.forEach((p,i)=>{p.place=i+1});
    t.status='finished';t.finishedAt=now;t.breaking=0;
    for(const x of Object.values(t.tables))x.closed=true;
    this.later(this.record());
  }
  async record(){
    const t=this.t;if(t.recorded||t.status!=='finished'||!this.env.DIRECTORY)return;
    const r=await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('global')).fetch('https://dir/freeroll/results',{method:'POST',body:JSON.stringify({night:t.night,duration:(t.finishedAt||Date.now())-t.startAt,entrants:Object.keys(t.players).length,players:Object.values(t.players).map(p=>({id:p.id,place:p.place}))})});
    if(r.ok){t.recorded=true;await this.save()}
  }
  plan(n,extra={}){
    const t=this.t,now=Date.now(),level=levelAt(t,now);
    const seats=t.status==='running'?this.assigned(n):[];
    for(const p of seats)p.seated=true;
    const winner=Object.values(t.players).find(p=>p.place===1);
    return {seats:seats.map(p=>this.seatFor(p)),blinds:blindsFor(level),finished:t.status==='finished',close:t.status!=='running'||!!t.tables[n]?.closed,
      winner:winner?.name||'',note:t.note||'',places:t.status==='finished'?Object.fromEntries(Object.values(t.players).map(p=>[p.id,p.place])):null,
      info:{entrants:Object.keys(t.players).length,left:this.alive().length,level:level+1,nextLevelAt:t.startAt+(level+1)*FREEROLL.levelMs,next:blindsFor(level+1)},...extra};
  }
  report({table,players,halted}){
    const t=this.t,n=Number(table),now=Date.now(),here=t.tables[n];
    if(!here)return this.plan(n,{close:true});
    here.reportedAt=now;
    const out={},moves={byTable:{}};
    // Players already moved away or knocked out are told so again in case the last answer was lost.
    for(const r of Array.isArray(players)?players:[]){
      const p=t.players[r?.id];if(!p)continue;
      if(p.place!=null){out[p.id]={place:p.place};continue}
      if(p.table!==n){moves[p.id]={table:p.table};continue}
      const stack=Math.max(0,Math.floor(Number(r.stack)||0));p.stack=stack;p.handStart=Math.floor(Number(r.start)||stack);
      // Time extensions used so far travel with the player to their next table.
      p.ext=Math.max(p.ext||0,Math.floor(Number(r.ext)||0));
    }
    if(t.status==='running'){
      // Everyone who busted on the same hand shares the places below the survivors; a bigger starting stack places higher.
      const busted=this.assigned(n).filter(p=>p.stack<=0&&p.seated).sort((a,b)=>b.handStart-a.handStart);
      let place=this.alive().length;
      for(const p of busted.reverse())p.place=place--;
      for(const p of busted)out[p.id]={place:p.place};
      if(halted){t.note='The freeroll ended early because online play reached its free daily limit. Places are by chip count.';this.finish(now)}
      else if(this.alive().length<=1)this.finish(now);
      else this.balance(n,moves);
    }
    const byTable=moves.byTable;delete moves.byTable;
    const result=this.plan(n,{out,moves});
    return {result,byTable};
  }
  async alarm(){
    await this.load();const t=this.t;if(!t)return;
    const now=Date.now();
    if(t.status==='scheduled'||t.status==='registering'){
      if(now<t.startAt){await this.state.storage.setAlarm(t.startAt);return}
      await this.start(now);
    }
    if(t.status==='running'){
      if(now>t.startAt+FREEROLL.maxMs){t.note='The freeroll reached its four-hour limit. Places are by chip count.';this.finish(now)}
      else for(const n of this.openTables()){
        // A table that has gone quiet is nudged; a table that never answers again is folded into the others when it is broken.
        const x=t.tables[n];if(now-x.reportedAt>STALE_MS)this.later(this.room(x.code,'/t/poke',{}));
      }
    }
    if(t.status==='finished'&&!t.recorded)this.later(this.record());
    await this.save();
    if(t.status==='running'||t.status==='finished'&&!t.recorded)await this.state.storage.setAlarm(now+WATCH_MS);
  }
  async fetch(request){
    const path=new URL(request.url).pathname,body=request.method==='POST'?await request.json().catch(()=>({})):{};
    const t=await this.load(body.night);
    if(!t)return this.reply({error:'No freeroll that night.'},404);
    const now=Date.now();
    if(path==='/view')return this.reply(this.view(now));
    const a=body.account;
    if(path==='/register'){
      const status=this.phase(now);
      if(!a?.id)return this.reply({error:'Sign in to play the freeroll.'},401);
      if(t.players[a.id])return this.reply(this.view(now));
      const late=status==='running'&&now<t.startAt+FREEROLL.lateRegMs;
      if(status==='scheduled')return this.reply({error:'Sign-up opens 10 minutes before the start.'},409);
      if(status!=='registering'&&!late)return this.reply({error:status==='finished'||status==='cancelled'||status==='running'?'Sign-up for tonight has closed.':'The freeroll is starting. Sign-up has closed.'},409);
      if(Object.keys(t.players).length>=FREEROLL.cap)return this.reply({error:`Tonight's freeroll is full (${FREEROLL.cap} players).`},409);
      const p={id:a.id,name:a.name,avatar:/^data:image\//.test(a.avatar||'')?a.avatar:'',stack:FREEROLL.stack,table:0,token:'',seated:false,place:null,handStart:FREEROLL.stack,at:now};
      t.players[a.id]=p;
      let table=0;if(late)table=await this.lateSeat(p);
      await this.save();
      if(table)this.sendSeats(table,[p]);
      if(!late)await this.state.storage.setAlarm(t.startAt);
      return this.reply(this.view(now));
    }
    if(path==='/unregister'){
      if(!a?.id||!t.players[a.id])return this.reply(this.view(now));
      if(t.status!=='scheduled'&&t.status!=='registering'||now>=t.startAt)return this.reply({error:'The freeroll has started. You can sit out, but not unregister.'},409);
      delete t.players[a.id];await this.save();return this.reply(this.view(now));
    }
    if(path==='/seat'){
      const p=t.players[a?.id];
      if(!p)return this.reply({error:'You are not in tonight\'s freeroll.'},404);
      if(p.place!=null)return this.reply({error:`You finished ${p.place} of ${Object.keys(t.players).length}.`,place:p.place},410);
      if(t.status!=='running'||!p.table)return this.reply({error:'Tables are drawn at the start.'},409);
      const table=t.tables[p.table];
      if(!p.seated)return this.reply({error:`Moving you to table ${p.table}…`,table:p.table,wait:true},409);
      return this.reply({code:table.code,token:p.token,table:p.table});
    }
    if(path==='/report'){
      const {result,byTable}=this.report(body);
      await this.save();
      for(const [to,list] of Object.entries(byTable))this.sendSeats(Number(to),list);
      return this.reply(result);
    }
    return this.reply({error:'Not found'},404);
  }
}
