/* Player numbers for the owner's stats page (stats.html): who has RIVL open right now and what they are doing,
   and daily history (active players, new players, return rates, hands and matches by mode). Everything is
   counted here, in the Directory, from the server's own records; nothing goes to an outside service.
   A player is "a:<account id>" when signed in and "v:<random id kept in that browser>" as a guest, so a
   refresh or a second tab is the same player, and a signed-in player is one player on every device. */

// The page sends a heartbeat every minute while it's on screen. A tab that stops sending drops off after 5 minutes.
const LIVE_MS=5*60*1000;
// A live row is rewritten only when it would run out within 3 minutes, so a steady player costs a write every
// 2 or 3 heartbeats instead of every one (storage writes count against the free plan).
const LIVE_REFRESH_MS=3*60*1000;
// A table counts as running for 3 minutes after its last deal.
const TABLE_MS=3*60*1000;
// The live player count is checked against the day's peak at most this often.
const PEAK_EVERY_MS=30*1000;
// One row per player per day is kept for about 13 months (monthly actives and return rates need them);
// older days survive only as the totals in stats_summary, and a guest id not seen since is removed.
const KEEP_DAYS=400;
export const ACTIVITIES=['bots','casual','ranked','freeroll','puzzle','browsing'];
const MODES=['casual','ranked','freeroll'];
// Flags on a player's day: played an online hand (reported by the room server), bot practice, the daily puzzle.
export const ONLINE=1,BOTS=2,PUZZLE=4;
const VISITOR_RE=/^[A-Za-z0-9_-]{16,40}$/;
export const CRAWLER_RE=/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|monitor|uptime/i;

const dayOf=t=>new Date(t).toISOString().slice(0,10);
const addDays=(d,n)=>dayOf(Date.parse(d+'T00:00:00Z')+n*86400000);

export function setupStats(dir){
  const {sql}=dir;
  sql.exec('CREATE TABLE IF NOT EXISTS stats_players(who TEXT PRIMARY KEY,first_day TEXT NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS stats_players_first ON stats_players(first_day)');
  sql.exec('CREATE TABLE IF NOT EXISTS stats_days(day TEXT NOT NULL,who TEXT NOT NULL,played INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,who))');
  sql.exec('CREATE INDEX IF NOT EXISTS stats_days_who ON stats_days(who,day)');
  sql.exec('CREATE TABLE IF NOT EXISTS stats_counts(day TEXT NOT NULL,key TEXT NOT NULL,n INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,key))');
  sql.exec('CREATE TABLE IF NOT EXISTS stats_live(who TEXT PRIMARY KEY,activity TEXT NOT NULL,until INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS stats_summary(day TEXT PRIMARY KEY,active INTEGER NOT NULL,signed_in INTEGER NOT NULL,new_players INTEGER NOT NULL,played_online INTEGER NOT NULL,bots INTEGER NOT NULL,puzzle INTEGER NOT NULL)');
  // Days before tracking began, filled in once from what the server already kept for signed-in players:
  // when each account was made, the Ranked and freeroll games they played, their puzzle answers and their last visit.
  if(!dir.one("SELECT name FROM migrations WHERE name='stats_backfill_v1'")){
    sql.exec("INSERT OR IGNORE INTO stats_players(who,first_day) SELECT 'a:'||id,date(created/1000,'unixepoch') FROM accounts");
    const add=`INSERT INTO stats_days(day,who,played) SELECT * FROM (%) WHERE true ON CONFLICT(day,who) DO UPDATE SET played=played|excluded.played`;
    sql.exec(add.replace('%',"SELECT DISTINCT date(h.t/1000,'unixepoch'),'a:'||p.account,"+ONLINE+" FROM game_history_players p JOIN game_history h ON h.id=p.game"));
    sql.exec(add.replace('%',"SELECT day,'a:'||account,"+PUZZLE+" FROM puzzle_answers"));
    sql.exec(add.replace('%',"SELECT date(created/1000,'unixepoch'),'a:'||id,0 FROM accounts"));
    sql.exec(add.replace('%',"SELECT date(last_seen/1000,'unixepoch'),'a:'||id,0 FROM accounts WHERE last_seen IS NOT NULL"));
    sql.exec("INSERT INTO migrations(name,applied) VALUES ('stats_backfill_v1',?)",Date.now());
  }
  // Kept in memory to skip repeat writes; losing them (the object restarting) only costs a few extra writes.
  dir.statSeen=new Map();dir.statLive=new Map();dir.statTables=new Map();dir.statPeakAt=0;
}

// Marks a player active today (with any flags), the first time each flag is seen that day.
function track(dir,who,flags,now){
  const d=dayOf(now),k=d+'|'+who,had=dir.statSeen.get(k);
  if(had!==undefined&&(had|flags)===had)return;
  if(dir.statSeen.size>50000||(dir.statSeen.size&&!dir.statSeen.keys().next().value.startsWith(d)))dir.statSeen.clear();
  dir.sql.exec('INSERT OR IGNORE INTO stats_players(who,first_day) VALUES (?,?)',who,d);
  dir.sql.exec('INSERT INTO stats_days(day,who,played) VALUES (?,?,?) ON CONFLICT(day,who) DO UPDATE SET played=played|excluded.played WHERE (played|excluded.played)!=played',d,who,flags);
  dir.statSeen.set(k,(had||0)|flags);
}
function bump(dir,key,n,now){
  if(n>0)dir.sql.exec('INSERT INTO stats_counts(day,key,n) VALUES (?,?,?) ON CONFLICT(day,key) DO UPDATE SET n=n+excluded.n',dayOf(now),key,n);
}
function peak(dir,key,n,now){
  dir.sql.exec('INSERT INTO stats_counts(day,key,n) VALUES (?,?,?) ON CONFLICT(day,key) DO UPDATE SET n=excluded.n WHERE excluded.n>n',dayOf(now),key,n);
}
function liveTables(dir,now){
  for(const [code,t] of dir.statTables)if(now-t.t>TABLE_MS)dir.statTables.delete(code);
  return [...dir.statTables.values()];
}
function checkPeak(dir,now){
  if(now-dir.statPeakAt<PEAK_EVERY_MS)return;
  dir.statPeakAt=now;
  peak(dir,'peak_online',dir.one('SELECT COUNT(*) AS n FROM stats_live WHERE until>?',now).n,now);
  peak(dir,'peak_seated',liveTables(dir,now).reduce((s,t)=>s+t.humans,0),now);
}

// A heartbeat from an open page. who is the player; visitor is the browser's own id, so a guest who has just
// signed in stops counting twice.
export function heartbeat(dir,{who,visitor,activity,away,now=Date.now()}){
  if(visitor&&VISITOR_RE.test(visitor)&&who!=='v:'+visitor&&dir.statLive.get('v:'+visitor)!==null){
    dir.sql.exec('DELETE FROM stats_live WHERE who=?','v:'+visitor);dir.statLive.set('v:'+visitor,null);
  }
  if(away){
    if(dir.statLive.get(who)!==null)dir.sql.exec('DELETE FROM stats_live WHERE who=?',who);
    dir.statLive.set(who,null);return;
  }
  activity=ACTIVITIES.includes(activity)?activity:'browsing';
  track(dir,who,activity==='bots'?BOTS:activity==='puzzle'?PUZZLE:0,now);
  let row=dir.statLive.get(who);
  if(row===undefined)row=dir.one('SELECT activity,until FROM stats_live WHERE who=?',who);
  if(!row||row.activity!==activity||row.until-now<LIVE_REFRESH_MS){
    row={activity,until:now+LIVE_MS};
    dir.sql.exec('INSERT INTO stats_live(who,activity,until) VALUES (?,?,?) ON CONFLICT(who) DO UPDATE SET activity=excluded.activity,until=excluded.until',who,activity,row.until);
  }
  if(dir.statLive.size>20000)dir.statLive.clear();
  dir.statLive.set(who,row);
  checkPeak(dir,now);
}
export const guestId=visitor=>typeof visitor==='string'&&VISITOR_RE.test(visitor)?'v:'+visitor:null;

// A hand was dealt at an online table (the room server reports every deal for the daily budget).
// The humans and accounts come from the room's own seats, so bots and spectators never count as players.
export function handDealt(dir,{code,mode,humans,bots,accounts,newMatch},now=Date.now()){
  if(!MODES.includes(mode))return;
  humans=Math.max(0,Math.min(9,Math.round(Number(humans)||0)));bots=Math.max(0,Math.min(9,Math.round(Number(bots)||0)));
  bump(dir,'hands:'+mode,1,now);
  bump(dir,'player_hands',humans,now);
  if(newMatch)bump(dir,'matches:'+mode,1,now);
  for(const id of Array.isArray(accounts)?accounts.slice(0,9):[])if(typeof id==='string'&&id.length<=64)track(dir,'a:'+id,ONLINE,now);
  if(typeof code==='string'&&code){dir.statTables.set(code,{mode,humans,bots,t:now});if(dir.statTables.size>5000)dir.statTables.delete(dir.statTables.keys().next().value)}
  checkPeak(dir,now);
}

function dayTotals(dir,d){
  return dir.one(`SELECT COUNT(*) AS active,SUM(who LIKE 'a:%') AS signed_in,SUM((played&${ONLINE})>0) AS played_online,SUM((played&${BOTS})>0) AS bots,
    SUM((played&${PUZZLE})>0) AS puzzle,(SELECT COUNT(*) FROM stats_players WHERE first_day=?) AS new_players FROM stats_days WHERE day=?`,d,d);
}
// Finished days are totalled once into stats_summary; per-player rows past KEEP_DAYS are then removed.
function summarize(dir,today,now){
  for(const {day} of dir.rows('SELECT DISTINCT day FROM stats_days WHERE day<? AND day NOT IN (SELECT day FROM stats_summary)',today)){
    const t=dayTotals(dir,day);
    dir.sql.exec('INSERT INTO stats_summary(day,active,signed_in,new_players,played_online,bots,puzzle) VALUES (?,?,?,?,?,?,?)',day,t.active,t.signed_in||0,t.new_players,t.played_online||0,t.bots||0,t.puzzle||0);
  }
  dir.sql.exec('DELETE FROM stats_days WHERE day<?',addDays(today,-KEEP_DAYS));
  // A guest's random id goes too once it hasn't been seen for that long; an account keeps the day it first came.
  dir.sql.exec("DELETE FROM stats_players WHERE who LIKE 'v:%' AND first_day<? AND who NOT IN (SELECT who FROM stats_days)",addDays(today,-KEEP_DAYS));
  dir.sql.exec('DELETE FROM stats_live WHERE until<?',now-LIVE_MS);
}
const distinct=(dir,from,to,extra='')=>dir.one(`SELECT COUNT(DISTINCT who) AS n FROM stats_days WHERE day>=? AND day<=? ${extra}`,from,to).n;

// Return rates: of the players first seen on each of the last 30 complete cohort days, how many came back
// exactly N days later. Only cohorts whose day N is already over are counted, so today never drags a rate down.
function retention(dir,today,n,signedIn){
  const to=addDays(today,-n-1),from=addDays(to,-29);
  const r=dir.one(`SELECT COUNT(*) AS players,COALESCE(SUM(EXISTS(SELECT 1 FROM stats_days d WHERE d.who=p.who AND d.day=date(p.first_day,'+${n} days'))),0) AS back
    FROM stats_players p WHERE p.first_day>=? AND p.first_day<=? ${signedIn?"AND p.who LIKE 'a:%'":''}`,from,to);
  return {days:n,players:r.players,back:r.back,rate:r.players?Math.round(1000*r.back/r.players)/10:null};
}

export function report(dir,now=Date.now()){
  const today=dayOf(now),from=addDays(today,-29);
  summarize(dir,today,now);
  const live=dir.rows('SELECT who,activity FROM stats_live WHERE until>?',now);
  const byActivity=Object.fromEntries(ACTIVITIES.map(a=>[a,0]));for(const r of live)byActivity[r.activity]=(byActivity[r.activity]||0)+1;
  const tables=Object.fromEntries(MODES.map(m=>[m,{tables:0,humans:0,bots:0}]));
  for(const t of liveTables(dir,now)){const x=tables[t.mode];x.tables++;x.humans+=t.humans;x.bots+=t.bots}
  const waiting=dir.one('SELECT COUNT(*) AS tables,COALESCE(SUM(humans),0) AS humans FROM lobby WHERE updated>?',now-15*60*1000);
  // History: one row per day for the last 30 days, newest first.
  const counts=new Map();
  for(const r of dir.rows('SELECT day,key,n FROM stats_counts WHERE day>=?',from)){if(!counts.has(r.day))counts.set(r.day,{});counts.get(r.day)[r.key]=r.n}
  const byDay=(q,...b)=>new Map(dir.rows(q,...b).map(r=>[r.day,r.n]));
  const accountsMade=byDay("SELECT date(created/1000,'unixepoch') AS day,COUNT(*) AS n FROM accounts WHERE created>=? GROUP BY day",Date.parse(from+'T00:00:00Z'));
  const ranked=byDay("SELECT date(t/1000,'unixepoch') AS day,COUNT(*) AS n FROM game_history WHERE mode='Ranked' AND t>=? GROUP BY day",Date.parse(from+'T00:00:00Z'));
  const freeroll=byDay('SELECT night AS day,MAX(entrants) AS n FROM freeroll_results WHERE night>=? GROUP BY night',from);
  const hands=byDay('SELECT day,hands AS n FROM usage WHERE day>=?',from);
  const summary=new Map(dir.rows('SELECT * FROM stats_summary WHERE day>=?',from).map(r=>[r.day,r]));
  const days=[];
  for(let i=0;i<30;i++){
    const d=addDays(today,-i),s=d===today?dayTotals(dir,d):summary.get(d)||{},c=counts.get(d)||{};
    days.push({day:d,active:s.active||0,signedIn:s.signed_in||0,newPlayers:s.new_players||0,newAccounts:accountsMade.get(d)||0,
      playedOnline:s.played_online||0,botPractice:s.bots||0,puzzle:s.puzzle||0,hands:hands.get(d)||0,playerHands:c.player_hands||0,
      handsByMode:Object.fromEntries(MODES.map(m=>[m,c['hands:'+m]||0])),matchesByMode:Object.fromEntries(MODES.map(m=>[m,c['matches:'+m]||0])),
      rankedMatches:ranked.get(d)||0,freerollEntrants:freeroll.get(d)||0,peakOnline:c.peak_online||0,peakSeated:c.peak_seated||0});
  }
  // Calendar months, newest first, from the per-player day rows (about 13 months of them are kept).
  const months=dir.rows(`SELECT substr(day,1,7) AS month,COUNT(DISTINCT who) AS active,COUNT(DISTINCT CASE WHEN who LIKE 'a:%' THEN who END) AS signed_in,
    COUNT(DISTINCT CASE WHEN (played&${ONLINE})>0 THEN who END) AS played_online FROM stats_days GROUP BY month ORDER BY month DESC LIMIT 13`)
    .map(m=>({month:m.month,active:m.active,signedIn:m.signed_in,playedOnline:m.played_online,
      newPlayers:dir.one('SELECT COUNT(*) AS n FROM stats_players WHERE first_day LIKE ?',m.month+'-%').n}));
  const firstDay=dir.one('SELECT MIN(day) AS d FROM (SELECT MIN(day) AS day FROM stats_days UNION ALL SELECT MIN(day) FROM stats_summary)').d;
  const guestsSince=dir.one("SELECT MIN(first_day) AS d FROM stats_players WHERE who LIKE 'v:%'").d;
  return {serverNow:now,today,firstDay,guestsSince,
    live:{online:live.length,signedIn:live.filter(r=>r.who.startsWith('a:')).length,guests:live.filter(r=>r.who.startsWith('v:')).length,byActivity,tables,waiting},
    totals:{accounts:dir.one('SELECT COUNT(*) AS n FROM accounts').n,rankedPlayers:dir.one('SELECT COUNT(*) AS n FROM accounts WHERE rgames>0').n,
      players:dir.one('SELECT COUNT(*) AS n FROM stats_players').n,
      active7:distinct(dir,addDays(today,-6),today),active30:distinct(dir,from,today),
      playedOnline7:distinct(dir,addDays(today,-6),today,`AND (played&${ONLINE})>0`),playedOnline30:distinct(dir,from,today,`AND (played&${ONLINE})>0`),
      rankedMatches:dir.one("SELECT COUNT(*) AS n FROM game_history WHERE mode='Ranked'").n,freerolls:dir.one('SELECT COUNT(DISTINCT night) AS n FROM freeroll_results').n},
    retention:{all:[1,7,30].map(n=>retention(dir,today,n,false)),signedIn:[1,7,30].map(n=>retention(dir,today,n,true))},
    days,months};
}
