/* Welcome and support interactions. No user information is transmitted by this script. */
(()=>{
  const $=id=>document.getElementById(id);
  const seenKey='rivlWelcomeSeenV1';
  const overlay=$('welcomeOverlay');
  const dialog=overlay?.querySelector('[role="dialog"]');
  function closeWelcome(){
    overlay.hidden=true;
    try{sessionStorage.setItem(seenKey,'1')}catch{}
    if(typeof show==='function')show('profile');
    $('accountPanel')?.scrollIntoView({block:'center',behavior:'smooth'});
    if(!window.rivlAccount?.key())$('accountName')?.focus({preventScroll:true});
  }
  $('welcomeOk')?.addEventListener('click',()=>closeWelcome());
  // Welcome appears once per browser tab session; returning visitors are not interrupted repeatedly.
  let seen=false;try{seen=sessionStorage.getItem(seenKey)==='1'}catch{}
  if(overlay&&!seen){overlay.hidden=false;dialog?.focus()}
  overlay?.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();closeWelcome()}
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
    const report='RIVL bug report\nCategory: '+category+'\nPage: '+location.origin+'\nBrowser: '+navigator.userAgent+'\n\n'+details;
    // Recipient must be configured by RIVL's operators before launch.
    const recipient='support@rivlpoker.com';
    location.href='mailto:'+encodeURIComponent(recipient)+'?subject='+encodeURIComponent('RIVL bug: '+category)+'&body='+encodeURIComponent(report);
    $('bugReportStatus').textContent='Your email app should open with the report. Please send it there to submit.';
  });
})();