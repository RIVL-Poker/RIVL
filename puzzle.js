/* RIVL daily puzzle: one poker decision a day, the same for everyone. Pick fold, call or raise, then see the
   grade for every option, how other players answered, and your streak. Signed-in answers are saved on the
   server (first answer of the day counts); signed-out players keep their answers in this browser. */
(()=>{
  const $=id=>document.getElementById(id);
  if(!$('puzzle'))return;
  const LOCAL='rivlPuzzleAnswers',SITE='rivlpoker.com';
  const NAMES={fold:'Fold',call:'Call',raise:'Raise'};
  const GOOD=new Set(['Brilliant','Best','Excellent']);
  let puzzle=null,result=null,today=null,busy=false,timer=null,todayInfo=null;
  const local=()=>{try{return JSON.parse(localStorage.getItem(LOCAL)||'{}')}catch{return {}}};
  const saveLocal=(day,choice)=>{try{const all=local();all[day]=choice;const keep=Object.keys(all).sort().slice(-60);localStorage.setItem(LOCAL,JSON.stringify(Object.fromEntries(keep.map(k=>[k,all[k]]))))}catch{}};
  const account=()=>window.rivlAccount?.current?.()||null;
  async function get(path){
    const api=window.RIVL_ROOM_API||(/^https?:$/.test(location.protocol)?location.origin:'');
    const r=await fetch(api.replace(/\/$/,'')+path);const data=await r.json().catch(()=>({error:'Puzzle unavailable right now.'}));
    if(!r.ok)throw Error(data.error||'Puzzle unavailable right now.');return data;
  }
  const post=(path,body)=>window.rivlAccount.call(path,body);
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const card=c=>`<span class="pz-card${'♥♦'.includes(c[1])?' red':''}"><b>${c[0]==='T'?'10':c[0]}</b><i>${c[1]}</i></span>`;
  // Story lines name cards like "K♦"; show them as small inline cards.
  const storyLine=t=>esc(t).replace(/\b([2-9TJQKA])([♠♥♦♣])/g,(m,r,s)=>`<span class="pz-mini${'♥♦'.includes(s)?' red':''}">${r==='T'?'10':r}${s}</span>`);
  const bb=x=>`${+(x/100).toFixed(1)} BB`;
  const dateLabel=day=>new Date(day+'T12:00:00Z').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'});
  const shiftDay=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const status=t=>{$('pzStatus').textContent=t||''};

  function renderSpot(){
    const p=puzzle;
    $('pzTitle').textContent=`#${p.number} · ${dateLabel(p.day)}`;
    $('pzStreet').textContent=p.street.toUpperCase();
    $('pzPot').textContent=bb(p.pot);
    $('pzBoard').innerHTML=p.board.map(card).join('')+'<span class="pz-card back"></span>'.repeat(5-p.board.length);
    $('pzHand').innerHTML=p.hero.map(card).join('');
    $('pzStack').textContent=`Stack ${bb(p.stack)} · ${p.position==='IP'?'in position':'out of position'}`;
    $('pzStory').innerHTML=p.story.map(t=>`<li>${storyLine(t)}</li>`).join('');
    $('pzChoices').innerHTML=p.choices.map(c=>`<button type="button" class="pz-choice" data-choice="${c.key}">${esc(c.label)}</button>`).join('');
    $('pzChoices').querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>answer(b.dataset.choice));
    $('pzPrev').disabled=p.number<=1;
    $('pzNext').hidden=p.today;$('pzBackToday').hidden=p.today;
    $('pzPractice').hidden=p.today;
  }
  function renderResult(){
    const p=puzzle,r=result,box=$('pzResult');
    $('pzSpot').classList.toggle('answered',!!r);
    if(!r){box.hidden=true;return}
    box.hidden=false;
    const mine=r.grades[r.choice],right=r.choice===r.best,ok=GOOD.has(mine.label);
    $('pzChoices').querySelectorAll('[data-choice]').forEach(b=>{b.disabled=true;b.classList.toggle('picked',b.dataset.choice===r.choice);b.classList.toggle('best',b.dataset.choice===r.best)});
    const bestLabel=p.choices.find(c=>c.key===r.best).label;
    $('pzVerdict').className='pz-verdict '+(right?'good':ok?'ok':'bad');
    $('pzVerdict').innerHTML=`<span class="pz-glyph">${esc(mine.glyph)}</span><div><strong>${esc(mine.label.toUpperCase())}</strong><span>${right?'You found the best play.':`The best play was <span class="pz-best-name">${esc(bestLabel)}</span>. Yours gave up about ${mine.lossBB} BB.`}</span></div>`;
    $('pzWhy').textContent=`Against the hands they would bet like this, you had about ${Math.round(r.eq*100)}% equity. Calling needed ${Math.round(r.need*100)}% to break even${r.best==='raise'?', and raising gets more from the hands that call.':r.best==='fold'?', so folding saves chips.':', so calling wins chips over time.'}`;
    const counts=r.counts,total=counts?Object.values(counts).reduce((a,b)=>a+b,0):0;
    $('pzOptions').innerHTML=p.choices.map(c=>{
      const g=r.grades[c.key],share=total?Math.round(100*(counts[c.key]||0)/total):null;
      return `<div class="pz-option${c.key===r.best?' best':''}${c.key===r.choice?' mine':''}"><div class="pz-option-top"><span>${esc(c.label)}${c.key===r.choice?' <em>your pick</em>':''}</span><span class="pz-grade">${esc(g.glyph)} ${esc(g.label)}${g.lossBB?` · −${g.lossBB} BB`:''}</span></div>${share===null?'':`<div class="pz-bar"><span style="width:${share}%"></span></div><small>${share}% of players</small>`}</div>`;
    }).join('');
    $('pzCount').textContent=total?`${total.toLocaleString()} signed-in ${total===1?'player has':'players have'} answered${p.today?' today':''}.`:p.today?'You are among the first to answer today.':'';
    const s=r.stats;
    $('pzStats').hidden=!s;
    if(s){$('pzStreak').textContent=s.streak;$('pzPlayed').textContent=s.played;$('pzCorrect').textContent=s.played?Math.round(100*s.correct/s.played)+'%':'–'}
    $('pzSignIn').hidden=!!account()||!p.today;
    $('pzShare').hidden=!p.today;
  }
  function tick(){
    if(!puzzle)return;
    const left=Math.max(0,Date.parse(shiftDay(today,1)+'T00:00:00Z')-Date.now()),h=Math.floor(left/3600000),m=Math.floor(left/60000)%60;
    $('pzNextIn').textContent=left?`Next puzzle in ${h}h ${String(m).padStart(2,'0')}m`:'A new puzzle is ready. Reload to play it.';
  }
  async function load(day){
    status('Loading…');
    try{
      puzzle=await get('/api/puzzle'+(day?'?day='+day:''));
      if(puzzle.today)today=puzzle.day;else today??=new Date(Date.now()).toISOString().slice(0,10);
      result=null;renderSpot();renderResult();status('');
      // Already answered: on the server when signed in, otherwise in this browser.
      const acc=account();
      if(acc&&puzzle.today){
        try{const me=await post('/api/puzzle/me',{key:acc.key,day:puzzle.day});if(me.choice){result=me;homeStats=me.stats;renderResult()}else if(me.stats){result=null;showStats(me.stats)}}catch{}
      }else if(local()[puzzle.day]&&puzzle.today){await answer(local()[puzzle.day],true)}
      tick();clearInterval(timer);timer=setInterval(tick,30000);
      paintHome();
    }catch(e){status(e.message);paintHome()}
  }
  function showStats(s){$('pzStats').hidden=false;$('pzStreak').textContent=s.streak;$('pzPlayed').textContent=s.played;$('pzCorrect').textContent=s.played?Math.round(100*s.correct/s.played)+'%':'–';homeStats=s;paintHome()}
  let homeStats=null;
  async function answer(choice,restoring){
    if(busy||!puzzle||(result&&!restoring))return;busy=true;status(restoring?'':'Grading…');
    try{
      const acc=account();
      result=await post('/api/puzzle/answer',{day:puzzle.day,choice,key:acc&&puzzle.today?acc.key:undefined});
      if(puzzle.today&&!acc)saveLocal(puzzle.day,result.choice);
      if(result.stats)homeStats=result.stats;
      renderResult();status('');paintHome();
      if(!restoring)$('pzResult').scrollIntoView?.({behavior:'smooth',block:'nearest'});
    }catch(e){status(e.message)}finally{busy=false}
  }
  // The home page card: today's number, and whether it's done.
  function paintHome(){
    const el=$('puzzleHome');if(!el)return;
    if(puzzle?.today)todayInfo={number:puzzle.number,result};
    const t=todayInfo,g=t?.result&&t.result.grades[t.result.choice],streak=homeStats?.streak;
    $('puzzleHomeInfo').textContent=(!t?'One poker decision a day, graded like a chess move.':g?`#${t.number} solved: ${g.glyph} ${g.label}.`:`#${t.number} is ready. One decision, graded like a chess move.`)+(streak?` Streak ${streak}.`:'');
    $('openPuzzle').textContent=g?'SEE RESULT':'SOLVE TODAY’S PUZZLE';
  }
  async function share(){
    const r=result,g=r.grades[r.choice];
    const text=`RIVL Daily Puzzle #${puzzle.number}\n${g.glyph} ${g.label}${r.stats?.streak?` · streak ${r.stats.streak}`:''}\n${SITE}`;
    try{if(navigator.share&&matchMedia('(pointer:coarse)').matches){await navigator.share({text});return}await navigator.clipboard.writeText(text);status('Result copied. Paste it anywhere.')}catch{status('Could not copy. '+text.replace(/\n/g,' · '))}
  }
  $('pzShare').onclick=share;
  $('pzPrev').onclick=()=>puzzle&&load(shiftDay(puzzle.day,-1));
  $('pzNext').onclick=()=>puzzle&&load(shiftDay(puzzle.day,1));
  $('pzBackToday').onclick=()=>load();
  $('pzSignIn').querySelector('a')?.addEventListener('click',e=>{e.preventDefault();if(typeof show==='function')show('profile')});
  $('openPuzzle')?.addEventListener('click',()=>{if(typeof show==='function')show('puzzle')});
  load();
})();
