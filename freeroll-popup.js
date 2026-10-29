/* Freeroll reminder shown when someone opens the site or signs in: a live countdown to the next nightly freeroll
   with "Prize included" underneath. It waits until the login screen is closed, shows at most once per freeroll night
   in this browser, and never interrupts a game. Close with ×, the CLOSE button, Escape or a click outside. */
(()=>{
  const $=id=>document.getElementById(id);
  const API=window.RIVL_ROOM_API||(/^https?:$/.test(location.protocol)?location.origin:'');
  const SEEN='rivlFreerollPopupNight';
  const stored=()=>{try{return localStorage.getItem(SEEN)}catch{return null}};
  const remember=night=>{try{localStorage.setItem(SEEN,night)}catch{}};
  const two=n=>String(n).padStart(2,'0');
  let el=null,tick=null,offset=0,checking=false,shown=false;

  const busy=()=>document.body.classList.contains('in-game')||!!window.rivlRooms?.code?.()||document.querySelector('.view.active')?.id==='freeroll'
    ||!$('welcomeOverlay')?.hidden||$('frlNotice');

  // Which moment to count down to: tonight's start, the end of late sign-up while it's running, or tomorrow's start.
  function target(d,now){
    if(d.status==='scheduled'||d.status==='registering')return {at:d.startAt,label:'STARTS IN'};
    if(d.status==='running'&&now<d.lateRegEndsAt)return {at:d.lateRegEndsAt,label:'LIVE NOW · LATE SIGN-UP CLOSES IN',live:true};
    return {at:d.nextStartAt,label:'STARTS IN'};
  }
  function build(d){
    el=document.createElement('div');el.id='frlPopup';el.className='frl-popup';
    el.innerHTML=`<div class="frl-popup-card" role="dialog" aria-modal="true" aria-labelledby="frlPopupLabel" tabindex="-1">
      <button type="button" class="frl-popup-x" aria-label="Close">×</button>
      <div class="frl-popup-eyebrow">★ NIGHTLY FREEROLL</div>
      <p class="frl-popup-label" id="frlPopupLabel"></p>
      <div class="frl-popup-clock" aria-live="off">
        <div><strong data-u="h">00</strong><small>HRS</small></div><i>:</i>
        <div><strong data-u="m">00</strong><small>MIN</small></div><i>:</i>
        <div><strong data-u="s">00</strong><small>SEC</small></div>
      </div>
      <p class="frl-popup-prize"></p>
      <p class="frl-popup-when"></p>
      <div class="frl-popup-actions"><button type="button" class="gold" data-go>VIEW FREEROLL</button><button type="button" class="frl-popup-close">Close</button></div>
    </div>`;
    // The prize line uses the freeroll's own prize when the server sends one.
    el.querySelector('.frl-popup-prize').textContent=d.prize?`Prize included: ${d.prize}`:'Prize included';
    el.querySelector('.frl-popup-x').onclick=close;
    el.querySelector('.frl-popup-close').onclick=close;
    el.querySelector('[data-go]').onclick=()=>{close();window.show?.('freeroll');window.rivlFreeroll?.refresh?.()};
    el.addEventListener('click',e=>{if(e.target===el)close()});
    el.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}});
    document.body.append(el);
  }
  function paint(d){
    const now=Date.now()+offset,{at,label,live}=target(d,now);
    const s=Math.max(0,Math.floor((at-now)/1000));
    el.querySelector('#frlPopupLabel').textContent=label;
    el.querySelector('[data-u="h"]').textContent=two(Math.floor(s/3600));
    el.querySelector('[data-u="m"]').textContent=two(Math.floor(s/60)%60);
    el.querySelector('[data-u="s"]').textContent=two(s%60);
    el.classList.toggle('live',!!live);
    const start=live?d.startAt:at,central=new Date(start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'});
    const local=new Date(start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    const day=new Date(start).toDateString()===new Date(now).toDateString()?'Tonight':new Date(start).toLocaleDateString([],{weekday:'long'});
    el.querySelector('.frl-popup-when').textContent=live?'Free to enter · up to 40 players':`${day} at ${local}${local===central?'':` (${central} Central)`} · free to enter`;
    if(s===0&&!live){clearInterval(tick);setTimeout(()=>{if(el)close()},1500)}
  }
  // Tells install-app.js the reminder is out of the way (closed, or not needed this time) so its card can follow.
  const settled=()=>document.dispatchEvent(new Event('rivl:freeroll-popup-settled'));
  function close(){clearInterval(tick);el?.remove();el=null;settled()}

  async function check(){
    if(shown||checking||!API||busy())return;
    checking=true;
    try{
      const r=await fetch(API.replace(/\/$/,'')+'/api/freeroll');if(!r.ok)return settled();
      const d=await r.json();
      if(!d?.night||stored()===d.night||d.status==='starting'||(d.status==='running'&&!d.lateRegEndsAt))return settled();
      if(busy())return;
      offset=(d.serverNow||Date.now())-Date.now();
      shown=true;remember(d.night);
      build(d);paint(d);tick=setInterval(()=>paint(d),1000);
      el.querySelector('.frl-popup-card').focus();
    }catch{settled()}finally{checking=false}
  }

  // Show it once the login screen is out of the way, whether the visitor signed in or chose to play as a guest.
  const overlay=$('welcomeOverlay');
  if(overlay)new MutationObserver(()=>{if(overlay.hidden)setTimeout(check,400)}).observe(overlay,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('rivl:account',()=>setTimeout(check,400));
  setTimeout(check,1200);
})();
