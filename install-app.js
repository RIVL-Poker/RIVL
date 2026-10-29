/* Installed app: starts the offline helper (sw.js) and, on phones, offers "Add RIVL to your home screen"
   once a player is back on the home screen after a game. Android gets a one-tap Install button; iPhone
   (which has no install button for websites) gets the Share > Add to Home Screen steps. */
(()=>{
  const KEY='rivlInstallCard';
  const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const inMatch=()=>document.body.classList.contains('in-game')||!!document.querySelector('#rooms.active.rivl-match-mode');

  // The offline helper only runs on the real site (https or localhost), never from a file.
  if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
    const hadCopy=!!navigator.serviceWorker.controller;
    // A new deploy finished installing: reload into it straight away unless a match is on screen
    // (then it takes over the next time the app opens). A first install has nothing to replace.
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadCopy&&!inMatch())location.reload()});
    addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
  }

  // Dismissed: hidden for a week; dismissed three times or installed: never again.
  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY))||{}}catch{return {}}};
  const write=v=>{try{localStorage.setItem(KEY,JSON.stringify(v))}catch{}};
  const resting=()=>{const s=read();return s.installed||(s.dismissed||0)>=3||Date.now()<(s.until||0)};

  const phone=matchMedia('(pointer: coarse) and (max-width: 1024px)');
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
  let prompt=null,played=false,card=null;
  addEventListener('beforeinstallprompt',e=>{e.preventDefault();prompt=e});
  addEventListener('appinstalled',()=>{write({...read(),installed:true});close()});

  const SHARE='<svg viewBox="0 0 24 24" aria-label="Share"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H5.5v10.5h13V10H16"/></svg>';
  function close(){card?.remove();card=null}
  function dismiss(){const s=read();write({...s,dismissed:(s.dismissed||0)+1,until:Date.now()+7*864e5});close()}
  function offer(){
    if(card||standalone()||!phone.matches||resting()||!(prompt||ios))return;
    card=document.createElement('div');
    card.className='install-card';
    card.setAttribute('role','dialog');card.setAttribute('aria-label','Add RIVL to your home screen');
    card.innerHTML=`<img src="icons/icon-192.png" alt=""><div class="install-text"><strong>ADD RIVL TO YOUR HOME SCREEN</strong>`+
      (prompt?`<span>Opens full screen with no browser bars.</span></div><button type="button" class="gold install-go">INSTALL</button>`
             :`<span>Tap Share ${SHARE} then <b>Add to Home Screen</b>. It opens full screen with no browser bars.</span></div>`)+
      `<button type="button" class="install-close" aria-label="Not now">×</button>`;
    card.querySelector('.install-close').onclick=dismiss;
    const go=card.querySelector('.install-go');
    if(go)go.onclick=async()=>{const p=prompt;prompt=null;close();try{await p.prompt();const {outcome}=await p.userChoice;if(outcome!=='accepted')dismiss()}catch{}};
    document.body.appendChild(card);
  }

  // A game counts once the table or an online match has been on screen; the card waits for the home screen.
  document.addEventListener('rivl:view',e=>{
    if(played&&e.detail==='play'){played=false;setTimeout(offer,600)}
  });
  const watch=new MutationObserver(()=>{if(inMatch())played=true});
  for(const el of [document.body,document.getElementById('rooms')])if(el)watch.observe(el,{attributes:true,attributeFilter:['class']});
})();
