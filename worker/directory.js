/* RIVL directory — one Durable Object (SQLite) holding accounts, online ratings, the public lobby
   and a daily usage budget that keeps the game inside Cloudflare's free plan. */
import {glicko} from './glicko.js';
import {pairAcc,W_PLACE,W_DEC,MIN_DECISIONS} from './grading.js';
import {startOf} from './tournament.js';

// rating.js (loaded by grading.js) defines the Ranked leagues shared with the site.
const R=globalThis.RivlRating;
const NAME_RE=/^[A-Za-z0-9_\- ]{3,20}$/;
const FRIEND_CHARS='ABCDEFGHJKMNPQRSTUVWXYZ23456789',MAX_FRIENDS=100;
// The page sends a presence heartbeat every minute while it's on screen (account.js), and says when it's hidden.
// If that last message never arrives (a phone that loses signal), the player drops off "active now" after 5 minutes.
const ONLINE_MS=5*60*1000;
// An invite to a casual room shows for 15 minutes, or until the friend joins or says no thanks.
const INVITE_MS=15*60*1000;
const LOBBY_TTL=15*60*1000,BOARD_TTL=10000;
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
    this.sql.exec('CREATE TABLE IF NOT EXISTS game_history(id TEXT PRIMARY KEY,t INTEGER NOT NULL,mode TEXT NOT NULL,players INTEGER NOT NULL,winner TEXT NOT NULL,duration INTEGER NOT NULL DEFAULT 0,hands INTEGER NOT NULL DEFAULT 0)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS game_history_players(game TEXT NOT NULL,account TEXT NOT NULL,name TEXT NOT NULL,place INTEGER NOT NULL,chips INTEGER,accuracy REAL,decisions INTEGER NOT NULL DEFAULT 0,elo_change INTEGER,PRIMARY KEY(game,account))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS game_history_recent ON game_history(t DESC)');
    // Ranked Elo is a fresh ladder kept apart from the older all-rooms rating (r, rd, vol, games, wins).
    const cols=new Set(this.rows('PRAGMA table_info(accounts)').map(c=>c.name));
    for(const [name,def] of [['rr','REAL NOT NULL DEFAULT 1500'],['rrd','REAL NOT NULL DEFAULT 350'],['rvol','REAL NOT NULL DEFAULT 0.06'],['rgames','INTEGER NOT NULL DEFAULT 0'],['rwins','INTEGER NOT NULL DEFAULT 0'],['elo_offset','INTEGER NOT NULL DEFAULT 0'],['avatar','TEXT NOT NULL DEFAULT \'\''],['avatar_blocked','INTEGER NOT NULL DEFAULT 0']])
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
    // Google sign-in: an account can be tied to one Google account (its stable "sub" id, no email is kept).
    // Each Google sign-in gets its own device key in sessions, so signing in on a phone never signs out the laptop.
    if(!cols.has('google_sub'))this.sql.exec('ALTER TABLE accounts ADD COLUMN google_sub TEXT');
    this.sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_google ON accounts(google_sub)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS sessions(key_hash TEXT PRIMARY KEY,account TEXT NOT NULL,created INTEGER NOT NULL)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS avatar_reports(id TEXT PRIMARY KEY,reporter TEXT NOT NULL,target TEXT NOT NULL,reason TEXT NOT NULL,created INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending')`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS avatar_reports_target ON avatar_reports(target,status)');
    // Ladder rank and the leaderboard read only ranked players by rating, so they never scan the whole accounts table.
    this.sql.exec('CREATE INDEX IF NOT EXISTS accounts_ranked ON accounts(rr) WHERE rgames>0');
    // Daily puzzle: one answer per account per UTC day (the first one counts), for streaks and the how-others-answered split.
    this.sql.exec('CREATE TABLE IF NOT EXISTS puzzle_answers(account TEXT NOT NULL,day TEXT NOT NULL,choice TEXT NOT NULL,correct INTEGER NOT NULL,t INTEGER NOT NULL,PRIMARY KEY(account,day))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS puzzle_answers_day ON puzzle_answers(day,choice)');
    // Friends: each account has a public friend code (separate from its secret sign-in code). Entering someone's
    // code adds the friendship both ways; either side can remove it. last_seen is when the player last had RIVL open
    // on screen, and online_until says how long that counts as "active now" (see presence below).
    for(const [name,def] of [['friend_code','TEXT'],['last_seen','INTEGER'],['online_until','INTEGER']])
      if(!this.rows('PRAGMA table_info(accounts)').some(c=>c.name===name))this.sql.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${def}`);
    this.sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_friend_code ON accounts(friend_code)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS friends(account TEXT NOT NULL,friend TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(account,friend))');
    // Invites to a casual room: one per pair of friends, the newest replacing the last. They reach the friend with their presence heartbeat.
    this.sql.exec('CREATE TABLE IF NOT EXISTS invites(sender TEXT NOT NULL,friend TEXT NOT NULL,code TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(sender,friend))');
    // Nightly freeroll results: one row per player per night. Points are entrants minus place plus one, summed by month.
    this.sql.exec('CREATE TABLE IF NOT EXISTS freeroll_results(night TEXT NOT NULL,account TEXT NOT NULL,place INTEGER NOT NULL,entrants INTEGER NOT NULL,points INTEGER NOT NULL,PRIMARY KEY(night,account))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS freeroll_results_place ON freeroll_results(place,night)');
    // Freerolls finished before game history existed get their history card from the saved results.
    for(const {night} of this.rows("SELECT DISTINCT night FROM freeroll_results WHERE 'freeroll:'||night NOT IN (SELECT id FROM game_history)"))
      this.freerollHistory(night,startOf(night),0);
    // Leaderboards are the same for everyone, so one copy is served for a few seconds instead of recomputed per request.
    this.boards=new Map();
  }
  board(key,build){
    const hit=this.boards.get(key);if(hit&&Date.now()-hit.t<BOARD_TTL)return hit.value;
    const value=build();this.boards.set(key,{t:Date.now(),value});
    if(this.boards.size>200)this.boards.delete(this.boards.keys().next().value);
    return value;
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
  // rank is the ladder position; pass false to skip it (rooms only need name and photo when someone sits down).
  publicAccount(a,rank){
    if(!a)return null;
    if(rank===undefined)rank=a.rgames>0?this.one('SELECT COUNT(*)+1 AS n FROM accounts WHERE rgames>0 AND rr>?',a.rr).n:null;
    else if(rank===false)rank=null;
    const displayed=Math.max(0,a.rr-(a.elo_offset||0));
    const t=R.tier(displayed);
    return {id:a.id,name:a.name,avatar:a.avatar_blocked?'':(a.avatar||''),rating:Math.round(displayed),rd:Math.round(a.rrd),games:a.rgames,wins:a.rwins,rank,provisional:a.rrd>110,league:t.name,leagueKey:t.key};
  }
  // What the signed-in player sees about their own account (others only ever get publicAccount).
  selfAccount(a){return {...this.publicAccount(a),google:!!a.google_sub}}
  async byKey(key){
    if(typeof key!=='string'||key.length<20||key.length>64)return null;
    const h=await sha256(key);
    return this.one('SELECT * FROM accounts WHERE key_hash=?',h)||this.one('SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account WHERE s.key_hash=?',h);
  }
  async newSession(id){
    const key=randomKey();
    this.sql.exec('INSERT INTO sessions(key_hash,account,created) VALUES (?,?,?)',await sha256(key),id,Date.now());
    return key;
  }
  // Google sign-in, called by the Worker only after it has verified the ID token. Signs in the account tied to
  // that Google id, ties it to the account the browser is already signed in to, or creates a new account.
  async google({sub,name,key}){
    if(typeof sub!=='string'||!sub)return this.reply({error:'Google sign-in failed.'},400);
    const linked=this.one('SELECT * FROM accounts WHERE google_sub=?',sub);
    if(key){
      const a=await this.byKey(key);
      if(!a)return this.reply({error:'Sign in again, then connect Google.'},401);
      if(linked&&linked.id!==a.id)return this.reply({error:'That Google account is already used by another RIVL account ('+linked.name+').'},409);
      this.sql.exec('UPDATE accounts SET google_sub=? WHERE id=?',sub,a.id);
      return this.reply({account:this.selfAccount(this.one('SELECT * FROM accounts WHERE id=?',a.id)),key});
    }
    if(linked)return this.reply({account:this.selfAccount(linked),key:await this.newSession(linked.id)});
    // First Google sign-in: the browser asks for a table name, then sends the same token back with it.
    if(name==null)return this.reply({needsName:true});
    const clean=String(name).trim().replace(/\s+/g,' ');
    if(!NAME_RE.test(clean))return this.reply({error:'Names are 3 to 20 letters, numbers, spaces, - or _.'},400);
    const s=this.status();if(s.usage.accounts>=s.limits.accounts)return this.reply({error:'New accounts are paused for today. Try again tomorrow.'},503);
    if(this.one('SELECT id FROM accounts WHERE name=?',clean))return this.reply({error:'That name is taken.'},409);
    const id=crypto.randomUUID();
    this.sql.exec('INSERT INTO accounts(id,name,key_hash,created,elo_offset,google_sub) VALUES (?,?,?,?,1500,?)',id,clean,await sha256(randomKey()),Date.now(),sub);
    this.sql.exec('UPDATE usage SET accounts=accounts+1 WHERE day=?',day());
    return this.reply({account:this.selfAccount(this.one('SELECT * FROM accounts WHERE id=?',id)),key:await this.newSession(id),created:true});
  }
  puzzleCounts(d){
    const counts={fold:0,call:0,raise:0};
    for(const r of this.rows('SELECT choice,COUNT(*) AS n FROM puzzle_answers WHERE day=? GROUP BY choice',d))counts[r.choice]=r.n;
    return counts;
  }
  // Streak: consecutive days answered, ending today, or yesterday when today's puzzle is still open.
  puzzleStats(account){
    const days=this.rows('SELECT day FROM puzzle_answers WHERE account=? ORDER BY day DESC LIMIT 1000',account).map(r=>r.day);
    const t=this.one('SELECT COUNT(*) AS played,COALESCE(SUM(correct),0) AS correct FROM puzzle_answers WHERE account=?',account);
    let streak=0,expect=day();
    if(days[0]!==expect)expect=new Date(Date.parse(expect+'T00:00:00Z')-86400000).toISOString().slice(0,10);
    for(const d of days){if(d!==expect)break;streak++;expect=new Date(Date.parse(d+'T00:00:00Z')-86400000).toISOString().slice(0,10)}
    return {streak,played:t.played,correct:t.correct};
  }
  // A friend code is 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L), made the first time it's needed.
  friendCode(a,fresh){
    if(a.friend_code&&!fresh)return a.friend_code;
    for(;;){
      const code=Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>FRIEND_CHARS[n%FRIEND_CHARS.length]).join('');
      if(this.one('SELECT id FROM accounts WHERE friend_code=?',code))continue;
      this.sql.exec('UPDATE accounts SET friend_code=? WHERE id=?',code,a.id);a.friend_code=code;return code;
    }
  }
  // Presence comes only from the page's heartbeat, which runs while RIVL is open and on screen. Loading the
  // friends list or verifying a key doesn't count, so a tab left open in the background doesn't look online.
  presence(a,away){const t=Date.now();this.sql.exec('UPDATE accounts SET last_seen=?,online_until=? WHERE id=?',t,away?0:t+ONLINE_MS,a.id)}
  friendList(a){
    const today=day(),now=Date.now();
    return this.rows(`SELECT x.*,EXISTS(SELECT 1 FROM puzzle_answers p WHERE p.account=x.id AND p.day=?) AS solved FROM friends f JOIN accounts x ON x.id=f.friend
      WHERE f.account=? ORDER BY COALESCE(x.last_seen,0) DESC LIMIT ?`,today,a.id,MAX_FRIENDS)
      // online and seenAgo are worked out here on the server's clock, so a phone with a wrong clock still shows them right.
      .map(x=>({...this.publicAccount(x,false),lastSeen:x.last_seen||null,seenAgo:x.last_seen?Math.max(0,now-x.last_seen):null,online:(x.online_until||0)>now,solvedToday:!!x.solved,puzzleStreak:this.puzzleStats(x.id).streak}));
  }
  invitesFor(a){
    this.sql.exec('DELETE FROM invites WHERE created<?',Date.now()-INVITE_MS);
    return this.rows('SELECT i.sender,i.code,i.created,x.name,x.avatar,x.avatar_blocked FROM invites i JOIN accounts x ON x.id=i.sender WHERE i.friend=? ORDER BY i.created DESC LIMIT 5',a.id)
      .map(i=>({from:i.sender,name:i.name,avatar:i.avatar_blocked?'':(i.avatar||''),code:i.code,created:i.created}));
  }
  friendsReply(a){return this.reply({code:this.friendCode(a),friends:this.friendList(a),max:MAX_FRIENDS})}
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
        return this.reply({account:this.selfAccount(this.one('SELECT * FROM accounts WHERE id=?',id)),key});
      }
      if(path==='/accounts/avatar'){
        const a=await this.byKey(body.key);
        if(!a)return this.reply({error:'Sign in to update your photo.'},401);
        const avatar=body.avatar===null?'':body.avatar;
        if(typeof avatar!=='string'||(avatar!==''&&(!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)||avatar.length>45000)))return this.reply({error:'Invalid photo. Use a small JPEG, PNG or WebP image.'},400);
        if(avatar&&this.one("SELECT id FROM avatar_reports WHERE target=? AND status='pending'",a.id))return this.reply({error:'Your previous photo is awaiting review. Contact support@rivlpoker.com.'},403);
        this.sql.exec('UPDATE accounts SET avatar=?,avatar_blocked=0 WHERE id=?',avatar,a.id);
        this.boards.clear();
        return this.reply({account:this.selfAccount(this.one('SELECT * FROM accounts WHERE id=?',a.id))});
      }
      if(path==='/accounts/report-avatar'){
        const reporter=await this.byKey(body.key),target=this.one('SELECT id,avatar,avatar_blocked FROM accounts WHERE id=?',String(body.targetId||''));
        if(!reporter)return this.reply({error:'Sign in to report a player photo.'},401);
        if(!target||target.id===reporter.id)return this.reply({error:'Invalid player to report.'},400);
        const reason=String(body.reason||'').trim().slice(0,160);
        if(reason.length<8)return this.reply({error:'Please describe the problem (at least 8 characters).'},400);
        if(!target.avatar)return this.reply({error:'That player has no uploaded photo.'},400);
        const recent=this.one('SELECT id FROM avatar_reports WHERE reporter=? AND target=? AND created>?',reporter.id,target.id,Date.now()-86400000);
        if(recent)return this.reply({error:'You already reported this player photo today.'},429);
        this.sql.exec('INSERT INTO avatar_reports(id,reporter,target,reason,created) VALUES (?,?,?,?,?)',crypto.randomUUID(),reporter.id,target.id,reason,Date.now());
        // Hide reported photos immediately. Do not expose the image while awaiting human review.
        this.sql.exec('UPDATE accounts SET avatar_blocked=1 WHERE id=?',target.id);
        this.boards.clear();
        return this.reply({ok:true,message:'Report received. The photo is hidden pending review.'});
      }
      if(path==='/accounts/avatar-reports'){
        if(!this.env.AVATAR_MODERATOR_KEY||body.moderatorKey!==this.env.AVATAR_MODERATOR_KEY)return this.reply({error:'Not authorized.'},403);
        return this.reply({reports:this.rows("SELECT r.id,r.reporter,r.target,r.reason,r.created,r.status,a.name AS player_name FROM avatar_reports r LEFT JOIN accounts a ON a.id=r.target WHERE r.status='pending' ORDER BY r.created DESC LIMIT 100")});
      }
      if(path==='/accounts/moderate-avatar'){
        if(!this.env.AVATAR_MODERATOR_KEY||body.moderatorKey!==this.env.AVATAR_MODERATOR_KEY)return this.reply({error:'Not authorized.'},403);
        const report=this.one('SELECT * FROM avatar_reports WHERE id=?',String(body.reportId||''));
        if(!report||!['approve','remove'].includes(body.action))return this.reply({error:'Invalid report or action.'},400);
        if(body.action==='remove')this.sql.exec("UPDATE accounts SET avatar='',avatar_blocked=0 WHERE id=?",report.target);
        else this.sql.exec('UPDATE accounts SET avatar_blocked=0 WHERE id=?',report.target);
        this.sql.exec("UPDATE avatar_reports SET status=? WHERE target=? AND status='pending'",body.action==='remove'?'removed':'approved',report.target);
        this.boards.clear();
        return this.reply({ok:true});
      }
      if(path==='/accounts/me'||path==='/verify'){
        const a=await this.byKey(body.key);
        if(!a)return this.reply({error:'Sign-in code not recognised.'},401);
        return this.reply({account:path==='/verify'?this.publicAccount(a,false):this.selfAccount(a)});
      }
      if(path==='/accounts/google')return await this.google(body);
      if(path==='/accounts/signout'){
        // Ends one Google device session. Sign-in codes are the account's backup key and keep working.
        if(typeof body.key==='string')this.sql.exec('DELETE FROM sessions WHERE key_hash=?',await sha256(body.key));
        return this.reply({ok:true});
      }
      if(path==='/history'){
        const games=this.rows('SELECT * FROM game_history ORDER BY t DESC LIMIT 60');
        return this.reply({games});
      }
      if(path==='/history/game'){
        const id=String(url.searchParams.get('id')||'');
        const game=this.one('SELECT * FROM game_history WHERE id=?',id);
        if(!game)return this.reply({error:'Game not found'},404);
        return this.reply({game,players:this.rows('SELECT name,place,chips,accuracy,decisions,elo_change FROM game_history_players WHERE game=? ORDER BY place,name',id)});
      }
      if(path==='/leaderboard'){
        return this.reply(this.board('top',()=>{
          // Ranks follow from the sorted list itself: tied ratings share the higher place, as COUNT(rr>me)+1 gives.
          const rows=this.rows('SELECT * FROM accounts WHERE rgames>0 ORDER BY rr DESC LIMIT 50');let rank=0;
          const top=rows.map((a,i)=>{if(!i||a.rr!==rows[i-1].rr)rank=i+1;return this.publicAccount(a,rank)});
          return {players:top,total:this.one('SELECT COUNT(*) AS n FROM accounts WHERE rgames>0').n};
        }));
      }
      if(path==='/leaderboard/league'){
        const r=Number(url.searchParams.get('r'));if(!Number.isFinite(r))return this.reply({error:'Missing rating.'},400);
        return this.reply(this.board('league:'+r,()=>this.league(r)));
      }
      if(path==='/results'){this.boards.clear();return this.reply(this.recordResults(body))}
      if(path==='/lobby/claim'){
        // Ranked queue: pick the fullest Ranked table still filling and count the seat at once, so a rush of
        // players spreads over tables instead of all reading the same list and piling onto the same three.
        this.sql.exec('DELETE FROM lobby WHERE updated<?',Date.now()-LOBBY_TTL);
        const size=[3,6,9].includes(Number(body.size))?Number(body.size):6,skip=(Array.isArray(body.skip)?body.skip:[]).map(String).slice(0,5);
        const room=this.rows(`SELECT code FROM lobby WHERE ranked=1 AND size=? AND players<? ${skip.length?'AND code NOT IN ('+skip.map(()=>'?').join(',')+')':''} ORDER BY players DESC,updated ASC LIMIT 1`,size,size,...skip)[0];
        if(!room)return this.reply({code:null});
        this.sql.exec('UPDATE lobby SET players=players+1,humans=humans+1 WHERE code=?',room.code);
        return this.reply({code:room.code});
      }
      if(path==='/lobby'){
        this.sql.exec('DELETE FROM lobby WHERE updated<?',Date.now()-LOBBY_TTL);
        return this.reply({rooms:this.rows('SELECT code,host,humans,players FROM lobby WHERE ranked=0 ORDER BY humans DESC,updated DESC LIMIT 30')});
      }
      if(path==='/lobby/upsert'){
        this.sql.exec('INSERT OR REPLACE INTO lobby(code,host,humans,players,updated,ranked,size) VALUES (?,?,?,?,?,?,?)',String(body.code),String(body.host||'').slice(0,20),Number(body.humans)||0,Number(body.players)||0,Date.now(),body.ranked?1:0,[3,6,9].includes(Number(body.size))?Number(body.size):6);
        return this.reply({ok:true});
      }
      if(path==='/lobby/remove'){this.sql.exec('DELETE FROM lobby WHERE code=?',String(body.code));return this.reply({ok:true})}
      // The Worker has already checked the day is today and the choice is one of the puzzle's options.
      if(path==='/puzzle/answer'){
        const a=await this.byKey(body.key);
        if(!a)return this.reply({error:'Sign in again to save your answer.'},401);
        if(body.day!==day()||!['fold','call','raise'].includes(body.choice))return this.reply({error:'That puzzle is closed.'},400);
        this.sql.exec('INSERT OR IGNORE INTO puzzle_answers(account,day,choice,correct,t) VALUES (?,?,?,?,?)',a.id,body.day,body.choice,body.correct?1:0,Date.now());
        const mine=this.one('SELECT choice FROM puzzle_answers WHERE account=? AND day=?',a.id,body.day);
        return this.reply({choice:mine.choice,counts:this.puzzleCounts(body.day),stats:this.puzzleStats(a.id)});
      }
      if(path==='/puzzle/me'){
        const a=await this.byKey(body.key);
        if(!a)return this.reply({error:'Sign in again.'},401);
        const mine=this.one('SELECT choice FROM puzzle_answers WHERE account=? AND day=?',a.id,String(body.day||''));
        return this.reply({choice:mine?.choice||null,counts:mine?this.puzzleCounts(body.day):null,stats:this.puzzleStats(a.id)});
      }
      if(path==='/presence'){
        const a=await this.byKey(body.key);
        if(!a)return this.reply({error:'Sign in again.'},401);
        this.presence(a,!!body.away);
        return this.reply({ok:true,invites:body.away?[]:this.invitesFor(a)});
      }
      if(path.startsWith('/friends')){
        const a=await this.byKey(body.key);
        if(!a)return this.reply({error:'Sign in to see your friends.'},401);
        if(path==='/friends')return this.friendsReply(a);
        if(path==='/friends/new-code'){this.friendCode(a,true);return this.friendsReply(a)}
        if(path==='/friends/add'){
          const code=String(body.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
          if(code.length!==8)return this.reply({error:'Friend codes are 8 letters and numbers, like ABCD-2345.'},400);
          const f=this.one('SELECT * FROM accounts WHERE friend_code=?',code);
          if(!f)return this.reply({error:'No player has that friend code. Check it and try again.'},404);
          if(f.id===a.id)return this.reply({error:'That is your own friend code.'},400);
          if(this.one('SELECT 1 AS x FROM friends WHERE account=? AND friend=?',a.id,f.id))return this.reply({error:f.name+' is already your friend.'},409);
          const count=id=>this.one('SELECT COUNT(*) AS n FROM friends WHERE account=?',id).n;
          if(count(a.id)>=MAX_FRIENDS)return this.reply({error:`You can have up to ${MAX_FRIENDS} friends.`},400);
          if(count(f.id)>=MAX_FRIENDS)return this.reply({error:f.name+"'s friends list is full."},400);
          const t=Date.now();
          this.sql.exec('INSERT OR IGNORE INTO friends(account,friend,created) VALUES (?,?,?)',a.id,f.id,t);
          this.sql.exec('INSERT OR IGNORE INTO friends(account,friend,created) VALUES (?,?,?)',f.id,a.id,t);
          return this.reply({added:f.name,code:this.friendCode(a),friends:this.friendList(a),max:MAX_FRIENDS});
        }
        if(path==='/friends/invite'){
          const code=String(body.code||'').toUpperCase();
          if(!/^[A-Z2-9]{6}$/.test(code))return this.reply({error:'Create a room first, then invite friends to it.'},400);
          const f=this.one('SELECT x.name FROM friends JOIN accounts x ON x.id=friends.friend WHERE friends.account=? AND friends.friend=?',a.id,String(body.id||''));
          if(!f)return this.reply({error:'You can only invite your friends.'},400);
          this.sql.exec('INSERT OR REPLACE INTO invites(sender,friend,code,created) VALUES (?,?,?,?)',a.id,String(body.id),code,Date.now());
          return this.reply({ok:true,invited:f.name});
        }
        if(path==='/friends/dismiss-invite'){
          this.sql.exec('DELETE FROM invites WHERE friend=? AND sender=?',a.id,String(body.from||''));
          return this.reply({ok:true,invites:this.invitesFor(a)});
        }
        if(path==='/friends/remove'){
          this.sql.exec('DELETE FROM invites WHERE (sender=? AND friend=?) OR (sender=? AND friend=?)',a.id,String(body.id||''),String(body.id||''),a.id);
          this.sql.exec('DELETE FROM friends WHERE (account=? AND friend=?) OR (account=? AND friend=?)',a.id,String(body.id||''),String(body.id||''),a.id);
          return this.friendsReply(a);
        }
      }
      if(path==='/freeroll/results'){
        const night=String(body.night||''),entrants=Math.max(0,Math.floor(Number(body.entrants)||0));
        if(!/^\d{4}-\d{2}-\d{2}$/.test(night)||!Array.isArray(body.players))return this.reply({error:'Bad results'},400);
        for(const p of body.players){
          const place=Math.floor(Number(p?.place));if(!place||place<1||place>entrants)continue;
          this.sql.exec('INSERT OR IGNORE INTO freeroll_results(night,account,place,entrants,points) VALUES (?,?,?,?,?)',night,String(p.id),place,entrants,entrants-place+1);
        }
        this.freerollHistory(night,Date.now(),body.duration);
        this.boards.clear();return this.reply({ok:true});
      }
      if(path==='/freeroll/board'){
        const night=url.searchParams.get('night')||day(),month=night.slice(0,7);
        return this.reply(this.board('freeroll:'+month,()=>({month,
          leaders:this.rows(`SELECT a.*,SUM(f.points) AS pts,SUM(f.place=1) AS w,COUNT(*) AS n FROM freeroll_results f JOIN accounts a ON a.id=f.account
            WHERE f.night LIKE ? GROUP BY f.account ORDER BY pts DESC,w DESC,a.name LIMIT 10`,month+'-%').map(a=>({...this.publicAccount(a,false),avatar:undefined,points:a.pts,wins:a.w,played:a.n})),
          champions:this.rows(`SELECT f.night,f.entrants,a.* FROM freeroll_results f JOIN accounts a ON a.id=f.account WHERE f.place=1 ORDER BY f.night DESC LIMIT 7`)
            .map(a=>({night:a.night,entrants:a.entrants,...this.publicAccount(a,false),avatar:undefined,wins:this.one('SELECT COUNT(*) AS n FROM freeroll_results WHERE account=? AND place=1',a.id).n}))})));
      }
      if(path==='/puzzle/counts')return this.reply({counts:this.puzzleCounts(url.searchParams.get('day')||day())});
      if(path==='/usage/room'||path==='/usage/hand'){
        const s=this.status(),column=path==='/usage/room'?'rooms':'hands';
        // A new room or match is refused once the day's budget is used; hands in running matches get extra headroom.
        const allowed=column==='rooms'?!s.busy:body.newMatch?!s.handsFull:!s.closed;
        if(allowed)this.sql.exec(`UPDATE usage SET ${column}=${column}+1 WHERE day=?`,day());
        return this.reply({ok:allowed,status:this.status()});
      }
      return this.reply({error:'Not found'},404);
    }catch(e){console.error('Directory request failed:',path,e);return this.reply({error:e.message||'Directory error'},500)}
  }
  // One game history card per freeroll night, built from its saved results (so a backfill matches a live finish).
  freerollHistory(night,t,duration){
    const id='freeroll:'+night;
    if(this.one('SELECT id FROM game_history WHERE id=?',id))return;
    const players=this.rows('SELECT f.account,f.place,f.entrants,a.name FROM freeroll_results f LEFT JOIN accounts a ON a.id=f.account WHERE f.night=? ORDER BY f.place',night);
    if(!players.length)return;
    this.sql.exec('INSERT INTO game_history(id,t,mode,players,winner,duration,hands) VALUES (?,?,?,?,?,?,?)',id,t,'Freeroll',players[0].entrants,players.find(p=>p.place===1)?.name||'Unknown',Math.max(0,Math.round(Number(duration)||0)),0);
    for(const p of players)this.sql.exec('INSERT OR IGNORE INTO game_history_players(game,account,name,place,chips,accuracy,decisions,elo_change) VALUES (?,?,?,?,?,?,?,?)',id,p.account,p.name||'Unknown',p.place,null,null,0,null);
  }
  // Everyone in the league of rating r, nearest to r first (50 at most). A league with under 10 players
  // falls back to the 10 players nearest r on the whole ladder.
  league(r){
    const t=R.tier(r),[,lo,hi]=R.LEAGUES.find(l=>l[0]===t.name),top=hi===Infinity?1e9:hi;
    const total=this.one('SELECT COUNT(*) AS n FROM accounts WHERE rgames>0 AND MAX(0,rr-elo_offset)>=? AND MAX(0,rr-elo_offset)<?',lo,top).n;
    const near=total<10;
    const rows=near?this.rows('SELECT * FROM accounts WHERE rgames>0 ORDER BY ABS(MAX(0,rr-elo_offset)-?) LIMIT 10',r)
      :this.rows('SELECT * FROM accounts WHERE rgames>0 AND MAX(0,rr-elo_offset)>=? AND MAX(0,rr-elo_offset)<? ORDER BY ABS(MAX(0,rr-elo_offset)-?) LIMIT 50',lo,top,r);
    return {league:t.name,leagueKey:t.key,near,total,players:rows.sort((x,y)=>y.rr-x.rr).map(a=>this.publicAccount(a))};
  }
  // Ranked rooms only: Glicko-2 among signed-in players. Against each opponent the score is 60% finishing place
  // and 40% decision accuracy, as in bot practice; with fewer than 3 graded decisions on either side it is place only.
  // Ratings and grades are computed on the server, never trusted from browsers.
  recordResults({matchId,players,duration=0,hands=0}){
    if(!matchId||!Array.isArray(players))return {error:'Bad results'};
    if(this.one('SELECT id FROM matches WHERE id=?',String(matchId)))return {duplicate:true,changes:[]};
    const rows=players.map(p=>({p,a:this.one('SELECT * FROM accounts WHERE id=?',String(p.id))})).filter(x=>x.a);
    const unique=[...new Map(rows.map(x=>[x.a.id,x])).values()];
    if(unique.length<2)return {rated:false,changes:[]};
    const now=Date.now();
    this.sql.exec('INSERT INTO matches(id,t) VALUES (?,?)',String(matchId),now);
    const w=1/Math.sqrt(unique.length-1);
    const graded=p=>Number(p.decisions)>=MIN_DECISIONS&&Number.isFinite(Number(p.acc));
    const score=(me,o)=>{const place=me.place<o.place?1:me.place>o.place?0:.5;return graded(me)&&graded(o)?W_PLACE*place+W_DEC*pairAcc(Number(me.acc),Number(o.acc)):place};
    const updates=unique.map(({p,a})=>({a,p,place:Number(p.place),next:glicko({r:a.rr,rd:a.rrd,vol:a.rvol},unique.filter(o=>o.a.id!==a.id).map(o=>({r:o.a.rr,rd:o.a.rrd,w,s:score(p,o.p)})))}));
    for(const u of updates)this.sql.exec('UPDATE accounts SET rr=?,rrd=?,rvol=?,rgames=rgames+1,rwins=rwins+?,last_played=? WHERE id=?',u.next.r,u.next.rd,u.next.vol,u.place===1?1:0,now,u.a.id);
    const winner=updates.find(u=>u.place===1);
    this.sql.exec('INSERT INTO game_history(id,t,mode,players,winner,duration,hands) VALUES (?,?,?,?,?,?,?)',String(matchId),now,'Ranked',updates.length,winner?.a.name||'Unknown',Math.max(0,Math.round(Number(duration)||0)),Math.max(0,Math.round(Number(hands)||0)));
    for(const u of updates){
      const acc=graded(u.p)?Math.round(Number(u.p.acc)*10)/10:null;
      this.sql.exec('INSERT INTO game_history_players(game,account,name,place,chips,accuracy,decisions,elo_change) VALUES (?,?,?,?,?,?,?,?)',String(matchId),u.a.id,u.a.name,u.place,Number.isFinite(Number(u.p.chips))?Number(u.p.chips):null,acc,Number(u.p.decisions)||0,Math.round(u.next.r-u.a.rr));
    }
    return {rated:true,changes:updates.map(u=>({id:u.a.id,name:u.a.name,before:Math.max(0,Math.round(u.a.rr-(u.a.elo_offset||0))),after:Math.max(0,Math.round(u.next.r-(u.a.elo_offset||0))),accuracy:graded(u.p)?Math.round(Number(u.p.acc)):null}))};
  }
}
