/* The Back Room: an easter egg. Knock five times on the spade in Support's "About RIVL" panel (or open
   rivlpoker.com/#backroom) and a door opens to 24 hand-picked decisions that most players get wrong. Unlike the
   daily puzzle there are no answer buttons: you act as at a table, folding, calling or raising any amount with the
   slider. The spots and the grade of every raise size are built ahead of time by scripts/make-backroom.mjs
   (backroom-spots.js), so the room works without the server. Answers stay in this browser; START OVER clears them. */
(()=>{
  const $=id=>document.getElementById(id);
  const S=window.RIVL_BACKROOM,V=window.RivlPuzzleView;
  if(!$('backroom')||!S||!V)return;
  const KEY='rivlBackRoom',KNOCKS=5,SITE='rivlpoker.com';
  // The same labels and glyphs as rating.js, in the order the build numbers them.
  const LABELS=['Brilliant','Best','Excellent','Good','Inaccuracy','Mistake','Blunder'];
  const GLYPH={Brilliant:'!!',Best:'★',Excellent:'!',Good:'✓',Inaccuracy:'?!',Mistake:'?',Blunder:'??'};
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}};
  const saved=load();
  let answers=saved.answers&&typeof saved.answers==='object'?saved.answers:{},at=Math.min(S.length-1,Math.max(0,saved.at|0)),final=false,size=0;
  const save=()=>{try{localStorage.setItem(KEY,JSON.stringify({answers,at}))}catch{}};
  const esc=V.esc,bb=V.bb,pct=x=>Math.round(x*100)+'%';
  const view=()=>$('backroom').classList.contains('active');

  /* ---------- sizes and grades ---------- */
  // A raise's size as a share of the pot: what it adds on top of a call, against the pot after the call.
  const potShare=(p,T)=>(T-p.bet)/(p.pot+p.bet-p.heroBet);
  const sizeName=(p,T)=>T>=p.raise.max?`All-in ${bb(T)}`:`Raise to ${bb(T)}`;
  const sizeLong=(p,T)=>T>=p.raise.max?`All-in ${bb(T)}`:`Raise to ${bb(T)} (${pct(potShare(p,T))} pot)`;
  const stop=(p,T)=>p.raise.stops.find(x=>x[0]===T);
  function raiseGrade(p,T){
    const [,l,lossBB,ev,fold,eqC]=stop(p,T),label=LABELS[l];
    return {label,glyph:GLYPH[label],lossBB,ev,note:`They fold about ${fold}% of the time. When they call, you have about ${eqC}%.`};
  }
  // "raise:2400" is a raise to 24 BB.
  const raisedTo=a=>a&&a.startsWith('raise:')?+a.slice(6):null;
  const gradeOf=(p,a)=>raisedTo(a)?raiseGrade(p,raisedTo(a)):p.grades[a];
  const isBest=(p,a)=>!!a&&(raisedTo(a)?p.best==='raise'&&['Brilliant','Best'].includes(gradeOf(p,a).label):a===p.best);
  const right=()=>S.filter(p=>isBest(p,answers[p.id])).length;
  const done=()=>S.filter(p=>answers[p.id]).length;

  /* ---------- the door ---------- */
  let knocks=0,knockTimer=null;
  $('brKnock').addEventListener('click',()=>{
    const panel=$('brDoorPanel');
    if(panel.classList.contains('open'))return;
    knocks++;clearTimeout(knockTimer);knockTimer=setTimeout(()=>{knocks=0;panel.style.setProperty('--knock',0)},2500);
    panel.style.setProperty('--knock',knocks/KNOCKS);
    const k=$('brKnock');k.classList.remove('hit');void k.offsetWidth;k.classList.add('hit');
    if(knocks>=KNOCKS){clearTimeout(knockTimer);knocks=0;$('brDoor').hidden=false;requestAnimationFrame(()=>panel.classList.add('open'))}
  });
  const enter=()=>{if(typeof show==='function')show('backroom');try{history.replaceState(null,'','#backroom')}catch{}};
  $('brEnter').onclick=enter;
  $('brBack').onclick=()=>{if(typeof show==='function')show('support')};
  // Opening the room paints the current hand; leaving it by any route drops #backroom from the address, so a reload doesn't bring it back.
  document.addEventListener('rivl:view',e=>{
    if(e.detail==='backroom')return render();
    if(location.hash==='#backroom')try{history.replaceState(null,'',location.pathname+location.search)}catch{}
  });
  const fromHash=()=>{if(location.hash==='#backroom'&&!view())enter()};
  addEventListener('hashchange',fromHash);

  /* ---------- a hand ---------- */
  function render(){
    final=false;
    const p=S[at],mine=answers[p.id];
    $('brPlay').hidden=false;$('brFinal').hidden=true;
    $('brTitle').innerHTML=`<b>HAND ${p.n}</b> ${esc(p.title)}`;
    $('brDepth').textContent=`${p.threeBet?'3-BET POT':'HEADS-UP'} · ${p.depth} BB DEEP`;
    V.paintSpot('br',{...p,choices:[]},()=>{});
    paintBar(p);
    paintResult(mine);
    $('brPrev').disabled=at===0;$('brNext').disabled=false;
    $('brNext').textContent=at===S.length-1?'SCORE →':'NEXT →';
    paintProgress();
  }
  // Fold, call (with the equity a call needs), and a raise slider with quick sizes as a share of the pot.
  function paintBar(p){
    const toCall=p.bet-p.heroBet;
    $('brCallLabel').textContent=`CALL ${bb(toCall)}`;
    $('brCallNeed').textContent=`needs ${pct(p.need)} equity`;
    const r=p.raise;
    $('brRaise').hidden=!r;$('brNoRaise').hidden=!!r;
    if(r){
      const stops=r.stops.map(x=>x[0]);
      // All-in is sometimes the only raise left (a min-raise would cost more than your stack): no slider then.
      $('brRaise').classList.toggle('single',stops.length===1);
      // Quick sizes; one that comes out the same as a bigger one (a pot raise that is all-in anyway) shows once, under the bigger name.
      const names=[['min','MIN'],['half','½ POT'],['threeq','¾ POT'],['pot','POT'],['allin','ALL-IN']];
      const quick=names.filter(([k],i)=>!names.slice(i+1).some(([k2])=>r.presets[k2]===r.presets[k]));
      $('brPresets').style.setProperty('--n',quick.length);
      $('brPresets').innerHTML=quick.map(([k,name])=>`<button type="button" class="br-preset" data-t="${r.presets[k]}">${name}</button>`).join('');
      $('brPresets').querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>setSize(stops.indexOf(+b.dataset.t)));
      const mineT=raisedTo(answers[p.id]);
      setSize(mineT?stops.indexOf(mineT):0);
    }
    const a=answers[p.id];
    $('brBar').classList.toggle('done',!!a);
    ['brFold','brCall','brRaiseGo','brSlider','brLess','brMore'].forEach(id=>$(id).disabled=!!a);
    $('brPresets').querySelectorAll('button').forEach(b=>b.disabled=!!a);
    $('brFold').classList.toggle('picked',a==='fold');$('brCall').classList.toggle('picked',a==='call');$('brRaiseGo').classList.toggle('picked',!!raisedTo(a));
    const best=a?p.best:null;
    $('brFold').classList.toggle('best',best==='fold');$('brCall').classList.toggle('best',best==='call');
    $('brRaiseGo').classList.toggle('best',best==='raise'&&(!raisedTo(a)||isBest(p,a)));
    // Once answered, a raise spot marks the best size on the slider.
    const mark=$('brBestMark');mark.hidden=!(a&&r&&p.best==='raise');
    if(!mark.hidden)mark.style.left=`calc(14px + (100% - 28px) * ${slidePos(r,r.best)/1000})`;
  }
  // The slider is curved: its first half covers the smaller quarter of the sizes, where a few BB matter most.
  const slidePos=(r,T)=>r.max>r.min?Math.round(1000*Math.sqrt((T-r.min)/(r.max-r.min))):1000;
  function slideTo(v){
    const r=S[at].raise;if(!r)return;
    const T=r.min+(r.max-r.min)*(v/1000)**2;
    setSize(r.stops.reduce((b,x,i)=>Math.abs(x[0]-T)<Math.abs(r.stops[b][0]-T)?i:b,0),v);
  }
  function setSize(i,v){
    const p=S[at],r=p.raise;if(!r)return;
    size=Math.max(0,Math.min(r.stops.length-1,i));
    const T=r.stops[size][0],allIn=T>=r.max,slider=$('brSlider');
    slider.value=v??slidePos(r,T);
    slider.style.setProperty('--fill',slider.value/10+'%');
    $('brRaiseTo').textContent=allIn?`ALL-IN ${bb(T)}`:bb(T);
    $('brRaisePct').textContent=`${pct(potShare(p,T))} of the pot · ${pct((T-p.heroBet)/(p.stack-p.heroBet))} of your stack`;
    $('brRaiseLabel').textContent=allIn?`ALL-IN ${bb(T)}`:`RAISE TO ${bb(T)}`;
    $('brPresets').querySelectorAll('[data-t]').forEach(b=>b.classList.toggle('on',+b.dataset.t===T));
  }
  $('brSlider').addEventListener('input',e=>slideTo(+e.target.value));
  $('brLess').onclick=()=>setSize(size-1);$('brMore').onclick=()=>setSize(size+1);
  $('brFold').onclick=()=>answer('fold');
  $('brCall').onclick=()=>answer('call');
  $('brRaiseGo').onclick=()=>{const p=S[at];if(p.raise)answer('raise:'+p.raise.stops[size][0])};

  // The answer screen: every kind of play, your raise size and the best one.
  function paintResult(a){
    const p=S[at];
    if(!a){V.paintResult('br',p,null);return}
    const mineT=raisedTo(a),r=p.raise,bestT=r&&r.best;
    const choices=[{key:'fold',label:'Fold'},{key:'call',label:p.callLabel}],grades={fold:p.grades.fold,call:p.grades.call};
    let best=p.best;
    if(r){
      const shown=mineT||bestT;
      const bestNote=g=>({...g,note:`The best of every raise size. ${g.note}`});
      choices.push({key:'raise',label:sizeLong(p,shown)});grades.raise=mineT?raiseGrade(p,mineT):bestNote(raiseGrade(p,bestT));
      // You raised, the right play is a raise, but another size is clearly better: show that size too.
      if(mineT&&p.best==='raise'&&!isBest(p,a)){choices.push({key:'braise',label:sizeLong(p,bestT)});grades.braise=bestNote(raiseGrade(p,bestT));best='braise'}
    }
    V.paintResult('br',{...p,choices},{choice:mineT?'raise':a,best,grades,why:p.why,eq:p.eq,need:p.need});
    $('brTag').textContent=p.tag;
    const toCall=p.bet-p.heroBet;
    $('brMath').innerHTML=`<div class="br-math-row"><div><small>EQUITY</small><b>${pct(p.eq)}</b></div><div><small>NEEDED</small><b>${pct(p.need)}</b></div><div><small>POT ODDS</small><b>${(p.pot/toCall).toFixed(1)} : 1</b></div></div>
      <div class="br-eqbar ${p.eq>=p.need?'over':'under'}" role="img" aria-label="Equity ${pct(p.eq)}; a call needs ${pct(p.need)}"><span style="--w:${(p.eq*100).toFixed(1)}%"></span><i style="left:${(p.need*100).toFixed(1)}%"></i></div>
      <p>Equity is how often you win against the hands they play this way. You call ${bb(toCall)} to win a pot of ${bb(p.pot)}.${r&&p.best==='raise'?` The best raise is ${bestT>=r.max?`all-in for ${bb(bestT)}`:`to ${bb(bestT)}, ${pct(potShare(p,bestT))} of the pot`}.`:''}</p>`;
    $('brNextHand').textContent=at===S.length-1?'SEE YOUR SCORE →':'NEXT HAND →';
  }
  function paintProgress(){
    $('brCount').textContent=final?`${done()} / ${S.length} PLAYED`:`HAND ${at+1} / ${S.length}`;
    const k=right();$('brScore').textContent=`${k} BEST ${k===1?'PLAY':'PLAYS'} FOUND`;
    $('brDots').innerHTML=S.map((p,i)=>{const a=answers[p.id],g=a&&gradeOf(p,a);
      return `<button type="button" role="listitem" class="br-dot${g?' done '+V.gclass(g.label):''}${!final&&i===at?' now':''}" data-i="${i}" aria-label="Hand ${i+1}${g?`: ${g.label}`:''}"></button>`}).join('');
    $('brDots').querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>go(+b.dataset.i));
  }
  function answer(a){
    const p=S[at];
    if(answers[p.id]||(a==='call'||a==='fold'?false:!p.raise||!stop(p,raisedTo(a))))return;
    answers[p.id]=a;save();
    paintBar(p);paintResult(a);paintProgress();
    $('brResult').scrollIntoView?.({behavior:'smooth',block:'nearest'});
  }
  function go(i){
    if(i>=S.length)return showFinal();
    at=Math.max(0,i);save();render();window.scrollTo({top:0,behavior:'smooth'});
  }
  const next=()=>go(at+1);
  $('brPrev').onclick=()=>final?go(S.length-1):go(at-1);
  $('brNext').onclick=next;$('brNextHand').onclick=next;

  /* ---------- the score ---------- */
  const RANKS=[[24,'Back Room Legend','A perfect run. Nobody does that.'],[20,'High Roller','You belong in here.'],[15,'Shark','Strong. A few of these got you, and they get almost everyone.'],
    [10,'Grinder','Solid. The big laydowns and thin calls are where the points hide.'],[0,'Fresh Fish','These are the hands that break most players. Review them and run it back.']];
  function showFinal(){
    final=true;
    const k=right(),n=done(),left=S.length-n,[,rank,line]=RANKS.find(([min])=>k>=min);
    $('brPlay').hidden=true;$('brFinal').hidden=false;
    $('brTitle').innerHTML='<b>FINAL SCORE</b>';
    $('brPrev').disabled=false;$('brNext').textContent='NEXT →';$('brNext').disabled=true;
    $('brFinalScore').textContent=k;
    $('brFinalRank').textContent=left?`${left} ${left===1?'hand':'hands'} still to play`:rank;
    $('brFinalText').textContent=left?`You found the best play in ${k} of the ${n} hands you've played. Finish the rest to get your rank.`:`You found the best play in ${k} of ${S.length} hands. ${line}`;
    const tally={};for(const p of S){const a=answers[p.id];if(a){const l=gradeOf(p,a).label;tally[l]=(tally[l]||0)+1}}
    $('brFinalGrades').innerHTML=LABELS.filter(l=>tally[l]).map(l=>`<span class="pz-grade ${V.gclass(l)}"><b>${esc(GLYPH[l])}</b>${tally[l]} ${l}</span>`).join('');
    $('brReview').textContent=left?'PLAY THE REST':'REVIEW HANDS';
    $('brShare').hidden=!!left;$('brShareStatus').textContent='';
    paintProgress();window.scrollTo({top:0,behavior:'smooth'});
  }
  $('brReview').onclick=()=>{const open=S.findIndex(p=>!answers[p.id]);go(open<0?0:open)};
  $('brRestart').onclick=()=>{answers={};go(0)};
  $('brShare').onclick=async()=>{
    const text=`I found the best play in ${right()} of ${S.length} hands in the RIVL Back Room ♠\nCan you find the door? ${SITE}`;
    try{if(navigator.share&&matchMedia('(pointer:coarse)').matches){await navigator.share({text});return}await navigator.clipboard.writeText(text);$('brShareStatus').textContent='Score copied. Paste it anywhere.'}
    catch{$('brShareStatus').textContent=text.replace(/\n/g,' · ')}
  };
  // Desktop shortcuts inside the room: F fold, C call, R raise the slider's amount, arrows to move between hands.
  document.addEventListener('keydown',e=>{
    if(!view()||e.metaKey||e.ctrlKey||e.altKey||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
    const key=e.key.toLowerCase();
    if(!final&&key==='f'){e.preventDefault();answer('fold')}
    else if(!final&&key==='c'){e.preventDefault();answer('call')}
    else if(!final&&key==='r'){e.preventDefault();$('brRaiseGo').click()}
    else if(e.key==='ArrowRight'&&!final){e.preventDefault();next()}
    else if(e.key==='ArrowLeft'){e.preventDefault();$('brPrev').click()}
  });
  fromHash();
})();
