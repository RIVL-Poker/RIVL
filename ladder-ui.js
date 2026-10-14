/* RIVL v1.4.1 — rating UI: live grades, match results, sidebar, profile, leaderboard. */
const LABEL_CLASS=l=>'g-'+l.toLowerCase();
const ord=n=>n+(['th','st','nd','rd'][(n%100>10&&n%100<14)?0:n%10]||'th');
const signed=n=>{n=Math.round(n);return n===0?'±0':(n>0?'+':'−')+Math.abs(n)};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let lastGrade=null,gradeFxTimer=null;

/* Called by action() before every legal decision is applied. */
function gradeAction(i,type,amount){
  if(!game||!window.RivlRating)return;
  const g=game,p=g.players[i];
  try{
    let A=g.pendingAnalysis&&g.pendingAnalysis.i===i?g.pendingAnalysis:null;
    g.pendingAnalysis=null;
    if(!A)A=RivlRating.analyze(g,i,i===0?RivlRating.GRADE_ITERS:140);
    const r=RivlRating.grade(A,type,type==='raise'?Math.round(Number(amount)):0);
    (p.grades||(p.grades=[])).push(r);
    if(i===0){lastGrade=r;if(g.coach)showGradeFx(r)}
  }catch(e){console.error('grading failed',e)}
  const toCall=Math.max(0,g.currentBet-p.bet);
  if(type==='raise')p.line=2;else if(type==='call'&&toCall>0)p.line=Math.max(p.line||0,1);
}

function showGradeFx(r){
  const el=$('gradeFx');if(!el)return;
  el.className='grade-fx visible '+LABEL_CLASS(r.label);
  el.innerHTML=`<b>${r.glyph}</b><span>${r.label.toUpperCase()}</span>${r.lossBB>=.05&&r.label!=='Best'&&r.label!=='Brilliant'?`<small>−${r.lossBB.toFixed(1)} BB</small>`:''}`;
  clearTimeout(gradeFxTimer);gradeFxTimer=setTimeout(()=>el.classList.remove('visible'),2300);
}

function liveAccuracy(){
  if(!game)return null;const a=RivlRating.matchAccuracy(game.players[0]);return a.n?a.acc:null;
}
function afterRender(){
  const el=$('liveAcc');if(!el||!game)return;
  const a=liveAccuracy();
  el.textContent=game.coach?(a==null?'–':a.toFixed(1)+'%'):'HIDDEN';
}

function coachText(){
  const base=buildCoach();
  if(!lastGrade)return 'No graded decisions yet this match. '+base;
  return `Last decision: ${lastGrade.glyph} ${lastGrade.label.toUpperCase()} — ${lastGrade.text}  •  ${base}`;
}
function statsText(){
  const p=game.players[0],gr=p.grades||[];
  const counts=RivlRating.LABELS.map(l=>[l,gr.filter(x=>x.label===l).length]).filter(x=>x[1]);
  const a=liveAccuracy();
  return `Stack ${p.stack.toLocaleString()} · Hand ${game.hand} · ${gr.length} decisions graded`+
    (game.coach?` · Accuracy ${a==null?'–':a.toFixed(1)+'%'}`+(counts.length?' · '+counts.map(([l,n])=>`${l} ${n}`).join(', '):''):' · Grades revealed at match end');
}

/* ---------- match results ---------- */
function hideMatchResult(){const el=$('matchResult');if(el){el.hidden=true;el.innerHTML=''}}
function showMatchResult(s){
  const el=$('matchResult');if(!el)return;
  const d=s.after-s.before,t=RivlRating.tier(s.after),prov=s.rdAfter>110;
  const chips=RivlRating.LABELS.filter(l=>s.labels[l]).map(l=>`<span class="grade-chip ${LABEL_CLASS(l)}"><b>${RivlRating.GLYPH[l]}</b>${l} ${s.labels[l]}</span>`).join('')||'<span class="muted">No decisions graded.</span>';
  const moment=(title,g)=>g?`<div class="moment ${LABEL_CLASS(g.label)}"><small>${title} · HAND ${g.hand}</small><p><b>${g.glyph} ${esc(g.chosen)}</b> — ${esc(g.text)}</p></div>`:'';
  const rows=[...s.table].sort((a,b)=>a.place-b.place).map(r=>`<div class="mr-row${r.name==='You'?' me':''}"><span>${ord(r.place)}</span><span>${esc(r.name)}</span><span>${r.acc==null?'–':r.acc.toFixed(1)+'%'}</span><span class="${r.delta>=0?'positive':'negative'}">${signed(r.delta)}</span></div>`).join('');
  el.innerHTML=`<div class="mr-card" role="dialog" aria-labelledby="mrTitle">
    <div class="eyebrow">♠ RATED MATCH COMPLETE</div>
    <h2 id="mrTitle">${ord(s.place)} <span>of ${s.size}</span></h2>
    <div class="mr-rating"><strong>${Math.round(s.before)} → ${Math.round(s.after)}</strong><em class="${d>=0?'positive':'negative'}">${signed(d)}</em></div>
    <div class="mr-split"><div><small>PLACEMENT · ${Math.round(RivlRating.W_PLACE*100)}%</small><b class="${s.placePart>=0?'positive':'negative'}">≈ ${signed(s.placePart)}</b></div><div><small>DECISIONS · ${Math.round(RivlRating.W_DEC*100)}%</small><b class="${s.accPart>=0?'positive':'negative'}">≈ ${signed(s.accPart)}</b></div><div><small>ACCURACY</small><b>${s.acc==null?'–':s.acc.toFixed(1)+'%'}</b></div></div>
    <p class="mr-tier">${t.name}${t.next?` · ${Math.round(t.next-s.after)} to ${RivlRating.tier(t.next).name}`:''}${prov?` · Provisional (±${Math.round(s.rdAfter)})`:''}</p>
    <div class="grade-chips">${chips}</div>
    ${moment('BEST MOMENT',s.brilliant)}${moment('BIGGEST LEAK',s.worst)}
    <div class="mr-table"><div class="mr-row head"><span>#</span><span>PLAYER</span><span>ACCURACY</span><span>RATING</span></div>${rows}</div>
    <div class="mr-actions"><button class="gold" id="mrAgain" type="button">PLAY AGAIN</button><button class="outline" id="mrLobby" type="button">LOBBY</button></div>
  </div>`;
  el.hidden=false;
  $('mrAgain').onclick=()=>{hideMatchResult();start(s.size)};
  $('mrLobby').onclick=()=>{hideMatchResult();stop();show('play')};
  $('mrAgain').focus();
}

/* ---------- ladder views ---------- */
function ladderRows(){
  const st=RivlRating.store();
  return Object.entries(st.players).map(([name,p])=>({name,...p,avg:p.accN?p.accSum/p.accN:null})).sort((a,b)=>b.r-a.r);
}
function sparkline(points,w=560,h=120){
  if(points.length<2)return '<p class="muted">Play two rated matches to see your rating chart.</p>';
  const pad=10,lo=Math.min(...points)-15,hi=Math.max(...points)+15;
  const X=k=>pad+(w-2*pad)*k/(points.length-1),Y=v=>pad+(h-2*pad)*(1-(v-lo)/(hi-lo));
  const line=points.map((v,k)=>`${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Rating history">
    <polygon points="${X(0)},${h-pad} ${line} ${X(points.length-1)},${h-pad}" fill="#efbd7022"/>
    <polyline points="${line}" fill="none" stroke="#efbd70" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <circle cx="${X(points.length-1)}" cy="${Y(points[points.length-1])}" r="4" fill="#efbd70"/></svg>
    <div class="spark-axis"><span>First match</span><span>High ${Math.round(hi-15)} · Low ${Math.round(lo+15)} · Now ${Math.round(points[points.length-1])}</span></div>`;
}
function renderRankedTracker(acct,elo,games,set){
  const rt=RivlRating.tier(elo);
  set('rtTier',rt.name);const gem=$('rtHeroGem');if(gem){gem.replaceChildren();const svg=window.rivlLeagueIcons?.icon(rt.key);if(svg)gem.append(svg);gem.setAttribute('aria-label',rt.name+' league emblem')}const badge=$('rtTier');if(badge)badge.className='rt-tier league-'+rt.key;
  set('rtRd',acct?`±${acct.rd} rating deviation`:'Sign in to get a Ranked Elo');
  const bar=$('rtBar');if(bar){bar.style.width=(rt.progress*100).toFixed(0)+'%';bar.className='league-'+rt.key}
  set('rtBarFrom',`${rt.name} ${rt.lo.toLocaleString()}`);
  set('rtBarTo',rt.next?`${RivlRating.tier(rt.next).name} ${rt.next.toLocaleString()}`:'Top league');
  set('rtGames',games);set('rtWins',acct?.wins||0);
  set('rtWinRate',games?Math.round(100*(acct.wins||0)/games)+'%':'–');
  set('rtRank',acct?.rank?'#'+acct.rank:'–');
  let hist=[];try{hist=JSON.parse(localStorage.getItem('rivlRankedHistory')||'[]')}catch{}
  hist=Array.isArray(hist)&&acct?hist.filter(m=>m.account===acct.id):[];
  const ch=$('rtChart');
  if(ch)ch.innerHTML=hist.length?sparkline([hist[0].before,...hist.map(m=>m.after)]):'<p class="muted">Your Elo chart starts after your first Ranked match.</p>';
  const ms=$('rtMatches');
  if(ms)ms.innerHTML=hist.length?`<div class="mr-row head"><span>RESULT</span><span>TABLE</span><span>ACC</span><span>ELO</span></div>`+hist.slice(-6).reverse().map(m=>`<div class="mr-row"><span class="${m.result==='Win'?'positive':''}">${m.result==='Win'?'WIN':'LOSS'}</span><span>${m.players} players</span><span>${m.acc==null?'–':m.acc+'%'}</span><span class="${m.after-m.before>=0?'positive':'negative'}">${signed(m.after-m.before)}</span></div>`).join(''):'<p class="muted">No Ranked matches on this device yet.</p>';
}
function refreshRatingUI(){
  if(!window.RivlRating)return;
  const st=RivlRating.store(),me=st.players.You,rows=ladderRows(),rank=rows.findIndex(r=>r.name==='You')+1;
  const t=RivlRating.tier(me.r),prov=me.rd>110,r=Math.round(me.r);
  const set=(id,v)=>{const el=$(id);if(el)el.textContent=v};
  // Ranked Elo comes from the signed-in account; only Ranked rooms change it.
  const acct=window.rivlAccount?.current?.(),games=acct?.games||0,elo=acct?acct.rating:0;
  set('sideTier','ELO');
  set('sideRating',elo.toLocaleString());
  set('sideRatingLabel',!acct?'Sign in to play Ranked':games?`${acct.provisional?'Provisional · ':''}±${acct.rd} · ${games} ranked ${games===1?'match':'matches'}`:'No ranked matches yet');
  set('sideRank',acct?.rank?`Ranked #${acct.rank}`:'');
  document.querySelectorAll('.season .tier-progress').forEach(el=>el.style.width=(RivlRating.tier(elo).progress*100).toFixed(0)+'%');
  set('onlineProfileRating',elo.toLocaleString());
  set('onlineProfileDetails',acct?`Ranked Elo is 60% finishing place and 40% graded decisions. Only Ranked matches change it.`:'Sign in below to play Ranked.');
  set('onlineProfileRecord',`${acct?.wins||0} wins · ${games?Math.round(100*(acct.wins||0)/games):0}% win rate`);
  renderRankedTracker(acct,elo,games,set);
  window.rivlPaintName?.();
  set('homeRating',r.toLocaleString());
  const avg=me.accN?' · '+(me.accSum/me.accN).toFixed(1)+'% avg accuracy':'';
  set('homeStatsLine',`${t.name} · ${me.games||0} bot matches${avg}`);
  const recent=st.matches.slice(-3).reverse();
  const rl=$('recentList');
  let online=[];try{online=JSON.parse(localStorage.getItem('rivlOnlineRecentMatches')||'[]')}catch{}if(!Array.isArray(online))online=[];
  const botRows=recent.map(m=>({date:m.date||m.t||0,html:`<p>BOT · ${ord(m.place)} place · ${m.acc==null?'–':m.acc.toFixed(0)+'%'} <b class="${m.after-m.before>=0?'positive':'negative'}">${signed(m.after-m.before)}</b></p>`}));
  const onlineRows=online.map(m=>({date:m.date||0,html:`<p>${m.mode==='Ranked PvP'||m.mode==='Rated PvP'?'RANKED':'UNRANKED'} PVP · <b class="${m.result==='Win'?'positive':'negative'}">${m.result}</b> · ${m.players} players · ${Number(m.stack||0).toLocaleString()} chips</p>`}));
  if(rl)rl.innerHTML=[...botRows,...onlineRows].sort((a,b)=>b.date-a.date).slice(0,5).map(m=>m.html).join('')||'<p>No completed matches yet.</p>';
  // profile
  set('profRating',`${r.toLocaleString()} rating · ±${Math.round(me.rd)}`);
  set('profTier',`${t.name}${prov?' · Provisional':''} · Ladder #${rank}`);
  set('profGames',me.games||0);set('profWins',me.wins||0);
  set('profWinRate',me.games?Math.round(100*(me.wins||0)/me.games)+'%':'–');
  set('profAcc',me.accN?(me.accSum/me.accN).toFixed(1)+'%':'–');
  const ch=$('profChart');if(ch)ch.innerHTML=sparkline(st.matches.length?[st.matches[0].before,...st.matches.map(m=>m.after)]:[]);
  const lb=$('profLabels');
  if(lb){const total=RivlRating.LABELS.reduce((s,l)=>s+(st.labels[l]||0),0);
    lb.innerHTML=total?RivlRating.LABELS.map(l=>{const n=st.labels[l]||0,w=n/total*100;return `<div class="lbar ${LABEL_CLASS(l)}"><span><b>${RivlRating.GLYPH[l]}</b> ${l}</span><i><em style="width:${w.toFixed(1)}%"></em></i><span>${n}</span></div>`}).join(''):'<p class="muted">Your decision breakdown appears after your first rated match.</p>'}
  const pm=$('profMatches');
  if(pm){const ms=st.matches.slice(-8).reverse();pm.innerHTML=ms.length?`<div class="mr-row head"><span>PLACE</span><span>TABLE</span><span>ACCURACY</span><span>RATING</span></div>`+ms.map(m=>`<div class="mr-row"><span>${ord(m.place)}</span><span>${m.size}-max</span><span>${m.acc==null?'–':m.acc.toFixed(1)+'%'}</span><span class="${m.after-m.before>=0?'positive':'negative'}">${signed(m.after-m.before)} · ${Math.round(m.after)}</span></div>`).join(''):'<p class="muted">No rated matches yet.</p>'}
  // leaderboard
  const lt=$('ladderRows');
  if(lt)lt.innerHTML=rows.map((x,k)=>`<div class="ladder-row${x.name==='You'?' me':''}"><span>${k+1}</span><span>${x.name==='You'?esc((window.rivlPlayerName?.()||'You')+' (you)'):esc(x.name)}${x.name==='You'?'':' <small>BOT</small>'}</span><span class="league-${RivlRating.tier(x.r).key}">${RivlRating.tier(x.r).name}</span><span>${Math.round(x.r).toLocaleString()}</span><span>±${Math.round(x.rd)}</span><span>${x.games||0}</span><span>${x.avg==null?'–':x.avg.toFixed(1)+'%'}</span></div>`).join('');
}

document.addEventListener('DOMContentLoaded',refreshRatingUI);
if(document.readyState!=='loading')refreshRatingUI();
(function wireReset(){
  const b=$('resetLadder'),c=$('resetConfirm');if(!b||!c)return;
  b.onclick=()=>{c.hidden=false;b.hidden=true};
  $('resetNo').onclick=()=>{c.hidden=true;b.hidden=false};
  $('resetYes').onclick=()=>{RivlRating.resetLadder();c.hidden=true;b.hidden=false;refreshRatingUI()};
})();
