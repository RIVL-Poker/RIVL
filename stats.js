/* The owner's player numbers page (stats.html). It asks the server for the report with the STATS_KEY secret,
   which is remembered on this device only, and refreshes the live numbers every 15 seconds while on screen. */
(()=>{
  const $=id=>document.getElementById(id);
  const API=(()=>{try{return localStorage.getItem('rivlRoomApi')}catch{return null}})()||location.origin;
  const STORE='rivlStatsKey',REFRESH_MS=15000;
  let key='';try{key=localStorage.getItem(STORE)||''}catch{}
  let last=null,timer=null;
  const fmt=n=>(n||0).toLocaleString();
  const pct=r=>r.rate===null?'–':r.rate+'%';
  const ACTIVITY={bots:'Bot practice',casual:'Casual rooms',ranked:'Ranked',freeroll:'Freeroll',puzzle:'Daily puzzle',browsing:'Browsing'};
  const MODE={casual:'casual',ranked:'Ranked',freeroll:'freeroll'};
  const shortDay=d=>new Date(d+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};

  async function load(){
    const r=await fetch(API.replace(/\/$/,'')+'/api/stats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({statsKey:key})});
    const data=await r.json().catch(()=>({error:'The server did not answer ('+r.status+').'}));
    if(!r.ok)throw Object.assign(Error(data.error||'Request failed'),{status:r.status});
    return data;
  }
  function locked(message){
    clearInterval(timer);timer=null;
    $('statsBody').hidden=true;$('statsLogin').hidden=false;$('statsError').textContent=message||'';$('statsKey').focus();
  }
  async function refresh(){
    try{last=await load();$('statsLogin').hidden=true;$('statsBody').hidden=false;paint(last)}
    catch(e){if(e.status===403){try{localStorage.removeItem(STORE)}catch{}key='';locked(e.message==='Not authorized.'?'That key is not right, or STATS_KEY is not set on the server yet.':e.message)}
      else $('statsUpdated').textContent='Could not refresh: '+e.message}
  }
  function start(){clearInterval(timer);refresh();timer=setInterval(()=>{if(document.visibilityState==='visible')refresh()},REFRESH_MS)}

  function paint(r){
    const L=r.live;
    $('statsUpdated').textContent='Updated '+new Date(r.serverNow).toLocaleTimeString()+' · refreshes every 15 seconds';
    $('liveOnline').textContent=fmt(L.online);
    $('liveSplit').textContent=`${fmt(L.signedIn)} signed in · ${fmt(L.guests)} guests`;
    const modes=Object.entries(L.tables),seated=modes.reduce((s,[,t])=>s+t.humans,0);
    $('liveSeated').textContent=fmt(seated);
    $('liveTables').textContent=modes.filter(([,t])=>t.tables).map(([m,t])=>`${t.tables} ${MODE[m]} ${t.tables===1?'table':'tables'}`).join(' · ')||'No tables dealing right now';
    const acts=$('liveActivity');acts.replaceChildren();
    const top=Math.max(1,...Object.values(L.byActivity));
    for(const [k,label] of Object.entries(ACTIVITY)){
      const row=el('div','bar');row.append(el('span','',label));
      const track=el('span'),fill=el('i');fill.style.width=(100*(L.byActivity[k]||0)/top)+'%';if(!L.byActivity[k])fill.style.opacity='.25';track.append(fill);
      row.append(track,el('em','',fmt(L.byActivity[k])));acts.append(row);
    }
    $('liveWaiting').textContent=L.waiting.tables?`${fmt(L.waiting.humans)} waiting for players at ${fmt(L.waiting.tables)} open ${L.waiting.tables===1?'table':'tables'}.`:'';

    const T=r.totals,today=r.days[0];
    const tiles=[[today.active,'today',`${fmt(today.playedOnline)} played online`],[T.active7,'last 7 days',`${fmt(T.playedOnline7)} played online`],
      [T.active30,'last 30 days',`${fmt(T.playedOnline30)} played online`],[today.newPlayers,'new today',`${fmt(today.newAccounts)} new accounts`],
      [T.accounts,'accounts',`${fmt(T.rankedPlayers)} have played Ranked`],[T.players,'players ever',r.firstDay?'since '+shortDay(r.firstDay):'']];
    $('totals').replaceChildren(...tiles.map(([n,label,sub])=>{const t=el('div','tile');t.append(el('b','',fmt(n)),el('span','',label),el('small','',sub));return t}));

    // Daily actives, oldest on the left: online players in green under everyone else.
    const days=[...r.days].reverse(),peak=Math.max(1,...days.map(d=>d.active)),chart=$('dauChart');chart.replaceChildren();
    for(const d of days){
      const col=el('div','col'),on=Math.min(d.playedOnline,d.active);
      col.title=`${shortDay(d.day)}: ${d.active} active, ${d.playedOnline} played online`;
      const a=el('i','on');a.style.height=(100*on/peak)+'%';
      const b=el('i','other');b.style.height=(100*(d.active-on)/peak)+'%';
      const n=el('span','n',d.active?String(d.active):'');n.style.bottom=`calc(${100*d.active/peak}% + 2px)`;
      col.append(a,b,n);chart.append(col);
    }
    chart.setAttribute('aria-label','Daily active players for the last 30 days: '+days.map(d=>shortDay(d.day)+' '+d.active).join(', '));
    let axis=chart.nextElementSibling;
    if(!axis?.classList.contains('chart-days')){axis=el('div','chart-days');chart.after(axis)}
    axis.replaceChildren(el('span','',shortDay(days[0].day)),el('span','',shortDay(days[15].day)),el('span','','Today'));

    const ret=$('retention');ret.replaceChildren();
    for(const [label,rows] of [['Everyone',r.retention.all],['Signed in',r.retention.signedIn]]){
      const tr=el('tr');tr.append(el('td','',label));
      for(const x of rows){const td=el('td');td.append(el('b','',pct(x)),el('small','',x.players?`${fmt(x.back)} of ${fmt(x.players)}`:'not enough days yet'));tr.append(td)}
      ret.append(tr);
    }

    const cell=(tr,v)=>{const td=el('td',v?'':'zero',typeof v==='number'?fmt(v):v);tr.append(td)};
    $('days').replaceChildren(...r.days.map(d=>{const tr=el('tr');
      for(const v of [d.day===r.today?'Today':shortDay(d.day),d.active,d.signedIn,d.playedOnline,d.botPractice,d.puzzle,d.newPlayers,d.newAccounts,d.hands,d.handsByMode.casual,d.handsByMode.ranked,d.handsByMode.freeroll,d.rankedMatches,d.freerollEntrants,d.peakOnline])cell(tr,v);
      return tr}));
    $('months').replaceChildren(...(r.months.length?r.months:[{month:r.today.slice(0,7),active:0,signedIn:0,playedOnline:0,newPlayers:0}]).map(m=>{const tr=el('tr');
      for(const v of [new Date(m.month+'-15T12:00:00Z').toLocaleDateString(undefined,{month:'long',year:'numeric',timeZone:'UTC'}),m.active,m.signedIn,m.playedOnline,m.newPlayers])cell(tr,v);
      return tr}));
    if(r.guestsSince)$('guestsSince').textContent=shortDay(r.guestsSince);
  }

  function csv(){
    if(!last)return;
    const head=['day','active','signed_in','played_online','bot_practice','puzzle','new_players','new_accounts','hands','casual_hands','ranked_hands','freeroll_hands','player_hands','ranked_matches','freeroll_entrants','peak_online','peak_seated'];
    const rows=[...last.days].reverse().map(d=>[d.day,d.active,d.signedIn,d.playedOnline,d.botPractice,d.puzzle,d.newPlayers,d.newAccounts,d.hands,d.handsByMode.casual,d.handsByMode.ranked,d.handsByMode.freeroll,d.playerHands,d.rankedMatches,d.freerollEntrants,d.peakOnline,d.peakSeated]);
    const blob=new Blob([[head,...rows].map(r=>r.join(',')).join('\n')+'\n'],{type:'text/csv'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='rivl-players-'+last.today+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  $('statsLogin').addEventListener('submit',e=>{
    e.preventDefault();key=$('statsKey').value.trim();if(!key)return;
    try{localStorage.setItem(STORE,key)}catch{}
    $('statsKey').value='';$('statsError').textContent='Opening…';start();
  });
  $('statsForget').addEventListener('click',()=>{try{localStorage.removeItem(STORE)}catch{}key='';last=null;locked('Key forgotten on this device.')});
  $('statsCsv').addEventListener('click',csv);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&key&&timer)refresh()});
  if(key)start();else locked();
})();
