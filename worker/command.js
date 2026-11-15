/* RIVL COMMAND: the owners' console at /command. Only accounts listed in the COMMAND_ACCOUNTS secret (comma-separated
   account ids) get any answer. It keeps shared notes and tasks, an activity feed (deploys and test results posted by
   GitHub Actions, bug reports, note changes), and the live numbers from worker/stats.js. RIVER, the console's
   assistant, is Claude through the Anthropic API with ANTHROPIC_API_KEY; without that secret the console still works
   and the assistant is switched off.

   The Directory side (setupCommand, commandRoute) lives in the Directory object; the Worker side (askRiver) runs in
   the Worker, so a slow model reply never holds up the Directory. */
import {report} from './stats.js';

export const NOTE_TAGS=['general','frontend','backend','grader','content','bug','idea'];
const NOTE_TITLE=120,NOTE_BODY=4000,TAG_RE=/^[a-z]{2,12}$/;
const EVENT_KINDS=['deploy','tests','pr','bug','note','task','river','site'];
const KEEP_EVENTS=500,FEED=120,NOTES=400;
// Who is in COMMAND right now: a poll rewrites the row at most once a minute (storage writes count on the free plan).
const HERE_MS=90*1000,HERE_WRITE_MS=60*1000;
// The live numbers are built from the stats report, shared by both owners for 15 seconds.
const LIVE_TTL=15000;

export function commandIds(env){return String(env.COMMAND_ACCOUNTS||'').split(',').map(s=>s.trim()).filter(Boolean)}
const clip=(v,n)=>String(v??'').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b-\u001f]/g,'').trim().slice(0,n);
const newId=()=>crypto.randomUUID().replace(/-/g,'').slice(0,16);

export function setupCommand(dir){
  const {sql}=dir;
  sql.exec(`CREATE TABLE IF NOT EXISTS command_notes(id TEXT PRIMARY KEY,author TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'note',
    title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tag TEXT NOT NULL DEFAULT 'general',pinned INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL,updated_by TEXT NOT NULL)`);
  sql.exec('CREATE INDEX IF NOT EXISTS command_notes_updated ON command_notes(updated DESC)');
  sql.exec(`CREATE TABLE IF NOT EXISTS command_events(id INTEGER PRIMARY KEY AUTOINCREMENT,t INTEGER NOT NULL,kind TEXT NOT NULL,
    title TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',actor TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',ok INTEGER)`);
  sql.exec('CREATE INDEX IF NOT EXISTS command_events_t ON command_events(t DESC)');
  // seen: when each owner last opened the notes or feed, so the other's changes since then show as new.
  sql.exec('CREATE TABLE IF NOT EXISTS command_seen(account TEXT PRIMARY KEY,notes INTEGER NOT NULL DEFAULT 0,feed INTEGER NOT NULL DEFAULT 0,here INTEGER NOT NULL DEFAULT 0)');
}

export function addEvent(dir,e){
  const kind=EVENT_KINDS.includes(e.kind)?e.kind:'site';
  const url=/^https:\/\/[^\s]{1,300}$/.test(String(e.url||''))?String(e.url):'';
  dir.sql.exec('INSERT INTO command_events(t,kind,title,detail,actor,url,ok) VALUES (?,?,?,?,?,?,?)',
    Date.now(),kind,clip(e.title,160)||kind,clip(e.detail,600),clip(e.actor,40),url,e.ok===true?1:e.ok===false?0:null);
  dir.sql.exec('DELETE FROM command_events WHERE id<=(SELECT id FROM command_events ORDER BY id DESC LIMIT 1 OFFSET ?)',KEEP_EVENTS);
}

async function member(dir,env,key){
  const a=await dir.byKey(key);
  if(!a)return {error:{status:401,body:{error:'Sign in to RIVL in this browser first.'}}};
  if(!commandIds(env).includes(a.id))return {error:{status:403,body:{error:'This account is not on the COMMAND list.',accountId:a.id}}};
  return {a};
}
function team(dir,env,now){
  return commandIds(env).map(id=>{
    const a=dir.one('SELECT id,name FROM accounts WHERE id=?',id);if(!a)return null;
    const s=dir.one('SELECT here FROM command_seen WHERE account=?',id);
    return {id:a.id,name:a.name,lastHere:s?.here||0,here:!!s&&now-s.here<HERE_MS};
  }).filter(Boolean);
}
const noteOut=n=>({id:n.id,author:n.author,kind:n.kind,title:n.title,body:n.body,tag:n.tag,pinned:!!n.pinned,done:!!n.done,created:n.created,updated:n.updated,updatedBy:n.updated_by});
const eventOut=e=>({id:e.id,t:e.t,kind:e.kind,title:e.title,detail:e.detail,actor:e.actor,url:e.url,ok:e.ok==null?null:!!e.ok});

// The live numbers: who is on RIVL now and doing what, tables running, today's free-plan budget, and the last 7 days.
function live(dir){
  const hit=dir.commandLive;if(hit&&Date.now()-hit.t<LIVE_TTL)return hit.value;
  const r=report(dir),s=dir.status();
  const week=r.days.slice(0,7).map(d=>({day:d.day,active:d.active,hands:d.hands,newAccounts:d.newAccounts,rankedMatches:d.rankedMatches,freerollEntrants:d.freerollEntrants}));
  const value={at:r.serverNow,online:r.live.online,signedIn:r.live.signedIn,guests:r.live.guests,byActivity:r.live.byActivity,tables:r.live.tables,waiting:r.live.waiting,
    budget:{usage:s.usage,limits:s.limits,busy:s.busy,closed:s.closed},
    today:r.days[0]?{active:r.days[0].active,newPlayers:r.days[0].newPlayers,newAccounts:r.days[0].newAccounts,playedOnline:r.days[0].playedOnline,peakOnline:r.days[0].peakOnline}:null,
    totals:{accounts:r.totals.accounts,rankedPlayers:r.totals.rankedPlayers,active7:r.totals.active7,active30:r.totals.active30,rankedMatches:r.totals.rankedMatches,freerolls:r.totals.freerolls},
    week};
  dir.commandLive={t:Date.now(),value};
  return value;
}

function saveNote(dir,a,body){
  const now=Date.now(),old=body.id?dir.one('SELECT * FROM command_notes WHERE id=?',String(body.id)):null;
  if(body.id&&!old)return {status:404,body:{error:'That note was deleted.'}};
  if(body.delete){
    dir.sql.exec('DELETE FROM command_notes WHERE id=?',old.id);
    addEvent(dir,{kind:old.kind==='task'?'task':'note',title:`${a.name} deleted “${old.title}”`,actor:a.name});
    return {status:200,body:{ok:true}};
  }
  const title=clip(body.title??old?.title,NOTE_TITLE),text=clip(body.body??old?.body??'',NOTE_BODY);
  if(!title)return {status:400,body:{error:'Give the note a title.'}};
  const kind=(body.kind??old?.kind)==='task'?'task':'note';
  const tag=TAG_RE.test(String(body.tag??''))?String(body.tag):old?.tag||'general';
  const pinned=body.pinned==null?old?.pinned||0:body.pinned?1:0,done=kind==='task'&&(body.done==null?old?.done:body.done)?1:0;
  const id=old?.id||newId();
  dir.sql.exec(`INSERT INTO command_notes(id,author,kind,title,body,tag,pinned,done,created,updated,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,body=excluded.body,tag=excluded.tag,pinned=excluded.pinned,done=excluded.done,updated=excluded.updated,updated_by=excluded.updated_by`,
    id,old?.author||a.id,kind,title,text,tag,pinned,done,old?.created||now,now,a.id);
  const what=!old?(kind==='task'?'added a task':'added a note'):done&&!old.done?'finished':!done&&old.done&&kind==='task'?'reopened':'updated';
  addEvent(dir,{kind,title:`${a.name} ${what} “${title}”`,actor:a.name});
  return {status:200,body:{note:noteOut(dir.one('SELECT * FROM command_notes WHERE id=?',id))}};
}

// Called by Directory.fetch for every /command/* path; returns null for any other path.
export async function commandRoute(dir,path,body){
  if(!path.startsWith('/command/'))return null;
  const env=dir.env,reply=(b,s=200)=>Response.json(b,{status:s});
  // Events from the Worker itself (GitHub hook after its token check, bug reports). Never reachable from a browser:
  // the Worker forwards only the paths below with the caller's key.
  if(path==='/command/event'){addEvent(dir,body);return reply({ok:true})}
  const m=await member(dir,env,body.key);if(m.error)return reply(m.error.body,m.error.status);
  const a=m.a,now=Date.now();
  if(path==='/command/state'){
    const seen=dir.one('SELECT * FROM command_seen WHERE account=?',a.id)||{notes:0,feed:0,here:0};
    if(now-seen.here>HERE_WRITE_MS)dir.sql.exec('INSERT INTO command_seen(account,here) VALUES (?,?) ON CONFLICT(account) DO UPDATE SET here=excluded.here',a.id,now);
    return reply({serverNow:now,me:{id:a.id,name:a.name},team:team(dir,env,now),ai:!!env.ANTHROPIC_API_KEY,live:live(dir),
      seen:{notes:seen.notes,feed:seen.feed},
      notes:dir.rows('SELECT * FROM command_notes ORDER BY updated DESC,rowid DESC LIMIT ?',NOTES).map(noteOut),
      events:dir.rows('SELECT * FROM command_events ORDER BY id DESC LIMIT ?',FEED).map(eventOut)});
  }
  if(path==='/command/seen'){
    const col=body.what==='feed'?'feed':'notes';
    dir.sql.exec(`INSERT INTO command_seen(account,${col}) VALUES (?,?) ON CONFLICT(account) DO UPDATE SET ${col}=excluded.${col}`,a.id,now);
    return reply({ok:true,t:now});
  }
  if(path==='/command/note'){const r=saveNote(dir,a,body);return reply(r.body,r.status)}
  // What RIVER is told on every question: who is asking, the team, the live numbers, open tasks, notes and the feed.
  if(path==='/command/context'){
    const names=Object.fromEntries(team(dir,env,now).map(t=>[t.id,t.name]));
    const note=n=>({id:n.id,kind:n.kind,title:n.title,body:n.body.slice(0,600),tag:n.tag,pinned:!!n.pinned,done:!!n.done,
      by:names[n.author]||'someone',updatedBy:names[n.updated_by]||'someone',updated:new Date(n.updated).toISOString()});
    return reply({me:{id:a.id,name:a.name},team:team(dir,env,now),live:live(dir),
      notes:dir.rows('SELECT * FROM command_notes ORDER BY done,pinned DESC,updated DESC,rowid DESC LIMIT 60').map(note),
      events:dir.rows('SELECT * FROM command_events ORDER BY id DESC LIMIT 40').map(e=>({at:new Date(e.t).toISOString(),kind:e.kind,title:e.title,detail:e.detail.slice(0,240),ok:e.ok==null?null:!!e.ok}))});
  }
  // A tool call from RIVER, made as the owner who asked.
  if(path==='/command/river-note'){
    const r=saveNote(dir,a,body);
    if(r.status===200&&!body.delete)addEvent(dir,{kind:'river',title:`RIVER saved “${r.body.note.title}” for ${a.name}`,actor:'RIVER'});
    return reply(r.body,r.status);
  }
  return reply({error:'Not found'},404);
}

/* ---------- RIVER: the console's assistant (runs in the Worker) ---------- */

const MAX_TURNS=24,MAX_TEXT=4000,TOOL_ROUNDS=5;
const RIVER_SYSTEM=`You are RIVER, the operations assistant inside RIVL COMMAND, the private console of RIVL's two builders. RIVL is a free, no-money Texas Hold'em site (rivlpoker.com) on one Cloudflare Worker: bot practice, casual rooms, Ranked with a Glicko-2 rating shown as Elo (60% placement, 40% graded decisions), a nightly freeroll, training drills, a daily puzzle, friends and player stats.

How you speak: calm, sharp and brief, like a trusted chief of staff. Lead with the answer. Two to four sentences unless asked for more, because replies may be read aloud. Plain sentences, no markdown headers or tables; a short list only when it truly helps. Use real names and numbers from the context; never invent numbers, PRs or events. If the context doesn't hold the answer, say so plainly.

What you can do: read the live site numbers, the shared notes and tasks, and the activity feed in the context below; save or update notes and tasks with your tools; read recent GitHub commits and pull requests. What you can't do: change code, deploy or touch players' accounts. For code changes, suggest the next step and that they run it in Claude Code; offer to save it as a task.

When someone asks you to remember, note, log or assign something, save it with a tool and confirm in one sentence. A task "for" the other builder still goes in the shared list; put their name in the title.`;

const TOOLS=[
  {name:'save_note',description:'Create a new shared note or task in COMMAND. Both owners see it.',
    input_schema:{type:'object',properties:{title:{type:'string',description:'Short title, under 120 characters'},body:{type:'string',description:'Details, optional'},
      kind:{type:'string',enum:['note','task']},tag:{type:'string',enum:NOTE_TAGS},pinned:{type:'boolean'}},required:['title','kind']}},
  {name:'update_note',description:'Change an existing note or task by its id from the context: mark a task done or not, pin it, or rewrite its text.',
    input_schema:{type:'object',properties:{id:{type:'string'},title:{type:'string'},body:{type:'string'},done:{type:'boolean'},pinned:{type:'boolean'},tag:{type:'string',enum:NOTE_TAGS}},required:['id']}},
  {name:'github_activity',description:'Read the most recent commits on main or the most recent pull requests in the RIVL repository.',
    input_schema:{type:'object',properties:{what:{type:'string',enum:['commits','pulls']}},required:['what']}}
];

async function github(env,what,fetchFn){
  const repo=/^[\w.-]+\/[\w.-]+$/.test(env.COMMAND_REPO||'')?env.COMMAND_REPO:'RIVL-Poker/RIVL';
  const headers={'User-Agent':'rivl-command','Accept':'application/vnd.github+json'};
  if(env.GITHUB_TOKEN)headers.Authorization='Bearer '+env.GITHUB_TOKEN;
  const url=`https://api.github.com/repos/${repo}/${what==='pulls'?'pulls?state=all&per_page=10':'commits?per_page=12'}`;
  const r=await fetchFn(url,{headers});
  if(!r.ok)return {error:`GitHub answered ${r.status}${r.status===403?' (rate limited; a GITHUB_TOKEN secret raises the limit)':''}.`};
  const list=await r.json();
  return what==='pulls'
    ?list.map(p=>({number:p.number,title:p.title,state:p.merged_at?'merged':p.state,by:p.user?.login,updated:p.updated_at}))
    :list.map(c=>({sha:String(c.sha).slice(0,7),message:String(c.commit?.message||'').split('\n')[0],by:c.commit?.author?.name,at:c.commit?.author?.date}));
}

function cleanTurns(messages){
  if(!Array.isArray(messages))return null;
  const turns=messages.slice(-MAX_TURNS).map(m=>({role:m?.role==='assistant'?'assistant':'user',content:clip(m?.content,MAX_TEXT)})).filter(m=>m.content);
  while(turns.length&&turns[0].role!=='user')turns.shift();
  if(!turns.length||turns.at(-1).role!=='user')return null;
  // The API needs turns to alternate; merge any two in a row from the same side.
  return turns.reduce((out,m)=>{const last=out.at(-1);if(last&&last.role===m.role)last.content+='\n\n'+m.content;else out.push({...m});return out},[]);
}

// dirCall(path,body) reaches the Directory; fetchFn is fetch (tests pass their own).
export async function askRiver(env,body,dirCall,fetchFn=fetch){
  const ctx=await dirCall('/command/context',{key:body.key});
  if(ctx.status!==200)return ctx;
  if(!env.ANTHROPIC_API_KEY)return {status:503,data:{error:'RIVER is off. Add the ANTHROPIC_API_KEY secret to switch it on.'}};
  const turns=cleanTurns(body.messages);
  if(!turns)return {status:400,data:{error:'Ask RIVER something first.'}};
  const c=ctx.data;
  const system=RIVER_SYSTEM+`\n\nNow: ${new Date().toISOString()}. Asking: ${c.me.name}. Team: ${c.team.map(t=>t.name+(t.here?' (in COMMAND now)':'')).join(', ')}.\n\nContext (JSON):\n`+JSON.stringify({live:c.live,notes:c.notes,feed:c.events});
  const messages=turns.map(m=>({role:m.role,content:m.content}));
  let changed=false;
  for(let round=0;round<TOOL_ROUNDS;round++){
    const r=await fetchFn('https://api.anthropic.com/v1/messages',{method:'POST',
      headers:{'content-type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:env.COMMAND_MODEL||'claude-sonnet-5-5',max_tokens:1024,system,tools:TOOLS,messages})});
    const out=await r.json().catch(()=>({}));
    if(!r.ok){
      console.error('RIVER api error',r.status,out?.error?.type);
      return {status:502,data:{error:r.status===401?'RIVER’s API key was refused. Check ANTHROPIC_API_KEY.':r.status===429?'RIVER is rate limited. Try again in a minute.':'RIVER could not answer right now.'}};
    }
    const content=Array.isArray(out.content)?out.content:[];
    const uses=content.filter(b=>b.type==='tool_use');
    if(out.stop_reason!=='tool_use'||!uses.length){
      return {status:200,data:{reply:content.filter(b=>b.type==='text').map(b=>b.text).join('\n').trim()||'Done.',changed}};
    }
    messages.push({role:'assistant',content});
    const results=[];
    for(const u of uses){
      let result;
      try{
        if(u.name==='save_note'||u.name==='update_note'){
          const x=await dirCall('/command/river-note',{...u.input,key:body.key,id:u.name==='update_note'?u.input?.id:undefined});
          result=x.status===200?{ok:true,id:x.data.note?.id}:{error:x.data.error};if(x.status===200)changed=true;
        }else if(u.name==='github_activity')result=await github(env,u.input?.what,fetchFn);
        else result={error:'Unknown tool'};
      }catch(e){result={error:'The tool failed: '+(e?.message||'unknown error')}}
      results.push({type:'tool_result',tool_use_id:u.id,content:JSON.stringify(result).slice(0,6000)});
    }
    messages.push({role:'user',content:results});
  }
  return {status:200,data:{reply:'I ran out of steps on that one. Try asking in smaller pieces.',changed}};
}
