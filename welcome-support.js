/* Welcome and support interactions. No user information is transmitted by this script. */
(()=>{
  const $=id=>document.getElementById(id);
  const seenKey='rivlWelcomeSeenV1';
  const overlay=$('welcomeOverlay');
  const dialog=overlay?.querySelector('[role="dialog"]');
  let priorFocus=null;
  function closeWelcome(goAccount){
    overlay.hidden=true;
    try{sessionStorage.setItem(seenKey,'1')}catch{}
    if(goAccount){
      if(typeof show==='function')show('profile');
      if(window.rivlAccount?.key()){
        $('accountPanel')?.scrollIntoView({block:'center',behavior:'smooth'});
      }else{
        $('accountPanel')?.scrollIntoView({block:'center',behavior:'smooth'});
        $('accountName')?.focus({preventScroll:true});
      }
    }else priorFocus?.focus?.();
  }
  $('welcomeOk')?.addEventListener('click',()=>closeWelcome(true));
  $('welcomeSkip')?.addEventListener('click',()=>closeWelcome(false));
  // Welcome appears once per browser tab session; returning visitors are not interrupted repeatedly.
  let seen=false;try{seen=sessionStorage.getItem(seenKey)==='1'}catch{}
  if(overlay&&!seen){priorFocus=document.activeElement;overlay.hidden=false;dialog?.focus()}
  overlay?.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();closeWelcome(false)}
    if(e.key==='Tab'){
      const controls=[...overlay.querySelectorAll('button:not([disabled])')];
      const first=controls[0],last=controls.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
    }
  });
  $('viewPrivacy')?.addEventListener('click',()=>show('privacy'));
  $('backToSupport')?.addEventListener('click',()=>show('support'));
  $('bugReportForm')?.addEventListener('submit',e=>{
    e.preventDefault();
    const details=$('bugDetails').value.trim();
    if(details.length<10){$('bugReportStatus').textContent='Please describe the issue in at least 10 characters.';return}
    const category=$('bugCategory').value;
    const report='RIVL bug report\\nCategory: '+category+'\\nPage: '+location.origin+'\\nBrowser: '+navigator.userAgent+'\\n\\n'+details;
    // Recipient must be configured by RIVL's operators before launch.
    const recipient=window.RIVL_SUPPORT_EMAIL||'';
    if(!recipient){$('bugReportStatus').textContent='Support email has not been configured yet. Copy your report below and send it to the RIVL team.';navigator.clipboard?.writeText(report).then(()=>{$('bugReportStatus').textContent+=' Report copied to clipboard.'}).catch(()=>{});return}
    location.href='mailto:'+encodeURIComponent(recipient)+'?subject='+encodeURIComponent('RIVL bug: '+category)+'&body='+encodeURIComponent(report);
    $('bugReportStatus').textContent='Your email app should open with the report. Please send it there to submit.';
  });
})();