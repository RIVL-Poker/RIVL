/* RIVL directory — one Durable Object (SQLite) holding accounts, online ratings, the public lobby
   and a daily usage budget that keeps the game inside Cloudflare's free plan. */
import {glicko} from './glicko.js';
import {pairAcc,W_PLACE,W_DEC,MIN_DECISIONS} from './grading.js';

// rating.js (loaded by grading.js) defines the Ranked leagues shared with the site.
const R=globalThis.RivlRating;
const NAME_RE=/^[A-Za-z0-9_\- ]{3,20}$/;
const LOBBY_TTL=15*60*1000;
const day=()=>new Date().toISOString().slice(0,10);
const hex=buf=>[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
const sha256=async text=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
const randomKey=()=>{const b=crypto.getRandomValues(new Uint8Array(24));return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};

export class Directory {
  constructor(state,env){
    this.state=state;this.env=env;this.sql=state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,key_hash TEXT NOT NULL UNIQUE,
      r REAL NOT NULL DEFAULT 1500,rd REAL NOT NULL DEFAULT 350,vol REAL NOT NULL DEFAULT 0.06,games INTEGER NOT NULL DEFAULT 0,wins INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,last_played INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS lobby(code TEXT PRIMARY KEY,host TEXT,humans INTEGER,players INTEGER,updated INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY,rooms INTEGER NOT NULL DEFAULT 0,hands INTEGER NOT NULL DEFAULT 0,accounts INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY,t INTEGER NOT NULL)`);
    // Ranked Elo is a fresh ladder kept apart from the older all-rooms rating (r, rd, vol, games, wins).
    const cols=new Set(this.rows('PRAGMA table_info(accounts)').map(c=>c.name));
    for(const [name,def] of [['rr','REAL NOT NULL DEFAULT 1500'],['rrd','REAL NOT NULL DEFAULT 350'],['rvol','REAL NOT NULL DEFAULT 0.06'],['rgames','INTEGER NOT NULL DEFAULT 0'],['rwins','INTEGER NOT NULL DEFAULT 0'],['elo_offset','INTEGER NOT NULL DEFAULT 0'],['avatar','TEXT NOT NULL DEFAULT \'\'']])
      if(!cols.has(name))this.sql.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${def}`);
    // One-time season reset: preserve account identities and sign-in keys, reset ranked progress.
    this.sql.exec('CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY, applied INTEGER NOT NULL)');
    if(!this.one("SELECT name FROM migrations WHERE name='zero_elo_season_v1'")){
      this.sql.exec('UPDATE accounts SET rr=1500,rrd=350,rvol=0.06,rgames=0,rwins=0,elo_offset=1500,last_played=NULL');
      this.sql.exec("INSERT INTO migrations(name,applied) VALUES ('zero_elo_season_v1',?)",Date.now());
    }
    // Ranked tables waiting for players sit in the same lobby table, flagged so Open Tables and Quick Play never show them.
    if(!this.rows('PRAGMA table_info(lobby)').some(c=>c.name==='ranked'))this.sql.exec('ALTER TABLE lobby ADD COLUMN ranked INTEGER NOT NULL DEFAULT 0');
    if(!this.rows('PRAGMA table_info(lobby)').some(c=>c.name==='size'))this.sql.exec('ALTER TABLE lobby ADD COLUMN size INTEGER NOT NULL DEFAULT 6');
  }
  rows(q,...b){return this.sql.exec(q,...b).toArray()}
  one(q,...b){return this.rows(q,...b)[0]||null}
  limits(){
    const n=(v,d)=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):d;
    return {rooms:n(this.env.DAILY_ROOM_LIMIT,300),hands:n(this.env.DAILY_HAND_LIMIT,1500),accounts:n(this.env.DAILY_ACCOUNT_LIMIT,500)};
  }
  usage(){
    const d=day();this.sql.exec('INSERT OR IGNORE INTO usage(day) VALUES (?)',d);
    return this.one('SELECT rooms,hands,accounts FROM usage WHERE day=?',d);
  }
  status(){
    const u=this.usage(),l=this.limits();
    // Rooms full: no new rooms. Hands full: no new rooms or matches. Closed: running matches stop too (25% headroom).
    const roomsFull=u.rooms>=l.rooms,handsFull=u.hands>=l.hands;
    return {day:day(),usage:u,limits:l,roomsFull,handsFull,busy:roomsFull||handsFull,closed:u.hands>=Math.ceil(l.hands*1.25)};
  }
  publicAccount(a){
    if(!a)return null;
    const rank=a.rgames>0?this.one('SELECT COUNT(*)+1 AS n FROM accounts WHERE rgames>0 AND rr>?',a.rr).n:null;
    const displayed=Math.max(0,a.rr-(a.elo_offset||0));
    const t=R.tier(displayed);
    return {id:a.id,name:a.name,avatar:a.avatar||'',rating:Math.round(displayed),rd:Math.round(a.rrd),games:a.rgames,wins:a.rwins,rank,provisional:a.rrd>110,league:t.name,leagueKey:t.key};
  }
  async byKey(key){
    if(typeof key!=='string'||key.length<20||key.length>64)return null;
    return this.one('SELECT * FROM accounts WHERE key_hash=?',await sha256(key));
  }
  reply(body,status=200){return Response.json(body,{status})}
  async fetch(request){
    const url=new URL(request.url),path=url.pathname;
    const body=request.method==='POST'?await request.json().catch(()=>({})):{};
    try{
      if(path==='/status')return this.reply(this.status());
      if(path==='/accounts/create'){
        const name=String(body.name||'').trim().replace(/\s+/g,' ');
        if(!NAME_RE.test(name))return this.reply({error:'Names are 3 to 20 letters, numbers, spaces, - or _.'},400);
        const s=this.status();if(s.usage.accounts>=s.limits.accounts)return this.reply({error:'New accounts are paused for today. Try again tomorrow.'},503);
        if(this.one('SELECT id FROM accounts WHERE name=?',name))return this.reply({error:'That name is taken.'},409);
        const id=crypto.randomUUID(),key=randomKey();
        this.sql.exec('INSERT INTO accounts(id,name,key_hash,created,elo_offset) VALUES (?,?,?,?,1500)',id,name,await sha256(key),Date.now());
        this.sql.exec('UPDATE usage SET accounts=accounts+1 WHERE day=?',day());
        return this.reply({account:this.publicAccount(this.one('SELECT * FROM accounts WHERE id=?',id)),key});
      }
      if(path==='/accounts/avatar'){
        const a=await this.byKey(body.key);
        if(!a)return this.reply({error:'Sign in to update your photo.'},401);
        const avatar=body.avatar===null?'':body.avatar;
        if(typeof avatar!=='string'||(avatar!==''&&(!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)||avatar.length>45000)))return this.reply({error:'Invalid photo. Use a small JPEG, PNG or WebP image.'},400);
        this.sql.exec('UPDATE accounts SET avatar=? WHERE id=?',avatar,a.id);
        return this.reply({account:this.publicAccount(this.one('SELECT * FROM accounts WHERE id=?',a.id))});
      }
      if(path==='/accounts/me'||path==='/verify'){
        const a=await this.byKey(body.key);
        if(!a)return this.reply({error:'Sign-in code not recognised.'},401);
        return this.reply({account:this.publicAccount(a)});
      }
      if(path==='/leaderboard'){
        const top=this.rows('SELECT * FROM accounts WHERE rgames>0 ORDER BY rr DESC LIMIT 50').map(a=>this.publicAccount(a));
        return this.reply({players:top,total:this.one('SELECT COUNT(*) AS n FROM accounts WHERE rgames>0').n});
      }
      if(path==='/leaderboard/league'){
        // Everyone in the league of rating r, nearest to r first (50 at most). A league with under 10 players
        // falls back to the 10 players nearest r on the whole ladder.
        const r=Number(url.searchParams.get('r'));if(!Number.isFinite(r))return this.reply({error:'Missing rating.'},400);
        const t=R.tier(r),[,lo,hi]=R.LEAGUES.find(l=>l[0]===t.name),top=hi===Infinity?1e9:hi;
        const total=this.one('SELECT COUNT(*) AS n FROM accounts WHERE rgames>0 AND MAX(0,rr-elo_offset)>=? AND MAX(0,rr-elo_offset)<?',lo,top).n;
        const near=total<10;
        const rows=near?this.rows('SELECT * FROM accounts WHERE rgames>0 ORDER BY ABS(MAX(0,rr-elo_offset)-?) LIMIT 10',r)
          :this.rows('SELECT * FROM accounts WHERE rgames>0 AND MAX(0,rr-elo_offset)>=? AND MAX(0,rr-elo_offset)<? ORDER BY ABS(MAX(0,rr-elo_offset)-?) LIMIT 50',lo,top,r);
        return this.reply({league:t.name,leagueKey:t.key,near,total,players:rows.sort((x,y)=>y.rr-x.rr).map(a=>this.publicAccount(a))});
      }
      if(path==='/results')return this.reply(this.recordResults(body));
      if(path==='/lobby'||path==='/lobby/ranked'){
        this.sql.exec('DELETE FROM lobby WHERE updated<?',Date.now()-LOBBY_TTL);
        return this.reply({rooms:path==='/lobby/ranked'?this.rows('SELECT code,host,humans,players FROM lobby WHERE ranked=1 AND size=? ORDER BY humans DESC,updated DESC LIMIT 30',Number(url.searchParams.get('size'))||6):this.rows('SELECT code,host,humans,players FROM lobby WHERE ranked=0 ORDER BY humans DESC,updated DESC LIMIT 30')});
      }
      if(path==='/lobby/upsert'){
        this.sql.exec('INSERT OR REPLACE INTO lobby(code,host,humans,players,updated,ranked,size) VALUES (?,?,?,?,?,?,?)',String(body.code),String(body.host||'').slice(0,20),Number(body.humans)||0,Number(body.players)||0,Date.now(),body.ranked?1:0,[3,6,9].includes(Number(body.size))?Number(body.size):6);
        return this.reply({ok:true});
      }
      if(path==='/lobby/remove'){this.sql.exec('DELETE FROM lobby WHERE code=?',String(body.code));return this.reply({ok:true})}
      if(path==='/usage/room'||path==='/usage/hand'){
        const s=this.status(),column=path==='/usage/room'?'rooms':'hands';
        // A new room or match is refused once the day's budget is used; hands in running matches get extra headroom.
        const allowed=column==='rooms'?!s.busy:body.newMatch?!s.handsFull:!s.closed;
        if(allowed)this.sql.exec(`UPDATE usage SET ${column}=${column}+1 WHERE day=?`,day());
        return this.reply({ok:allowed,status:this.status()});
      }
      return this.reply({error:'Not found'},404);
    }catch(e){return this.reply({error:e.message||'Directory error'},500)}
  }
  // Ranked rooms only: Glicko-2 among signed-in players. Against each opponent the score is 60% finishing place
  // and 40% decision accuracy, as in bot practice; with fewer than 3 graded decisions on either side it is place only.
  // Ratings and grades are computed on the server, never trusted from browsers.
  recordResults({matchId,players}){
    if(!matchId||!Array.isArray(players))return {error:'Bad results'};
    if(this.one('SELECT id FROM matches WHERE id=?',String(matchId)))return {duplicate:true,changes:[]};
    const rows=players.map(p=>({p,a:this.one('SELECT * FROM accounts WHERE id=?',String(p.id))})).filter(x=>x.a);
    const unique=[...new Map(rows.map(x=>[x.a.id,x])).values()];
    if(unique.length<2)return {rated:false,changes:[]};
    this.sql.exec('INSERT INTO matches(id,t) VALUES (?,?)',String(matchId),Date.now());
    const w=1/Math.sqrt(unique.length-1);
    const graded=p=>Number(p.decisions)>=MIN_DECISIONS&&Number.isFinite(Number(p.acc));
    const score=(me,o)=>{const place=me.place<o.place?1:me.place>o.place?0:.5;return graded(me)&&graded(o)?W_PLACE*place+W_DEC*pairAcc(Number(me.acc),Number(o.acc)):place};
    const updates=unique.map(({p,a})=>({a,p,place:Number(p.place),next:glicko({r:a.rr,rd:a.rrd,vol:a.rvol},unique.filter(o=>o.a.id!==a.id).map(o=>({r:o.a.rr,rd:o.a.rrd,w,s:score(p,o.p)})))}));
    for(const u of updates)this.sql.exec('UPDATE accounts SET rr=?,rrd=?,rvol=?,rgames=rgames+1,rwins=rwins+?,last_played=? WHERE id=?',u.next.r,u.next.rd,u.next.vol,u.place===1?1:0,Date.now(),u.a.id);
    return {rated:true,changes:updates.map(u=>({id:u.a.id,name:u.a.name,before:Math.max(0,Math.round(u.a.rr-(u.a.elo_offset||0))),after:Math.max(0,Math.round(u.next.r-(u.a.elo_offset||0))),accuracy:graded(u.p)?Math.round(Number(u.p.acc)):null}))};
  }
}
