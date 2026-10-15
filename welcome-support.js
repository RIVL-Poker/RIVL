/* Support and privacy page interactions (the welcome / login screen lives in login.js). No user information is transmitted by this script. */
(()=>{
  const $=id=>document.getElementById(id);
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