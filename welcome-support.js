/* Support page interactions. The Privacy Policy and Terms of Use are privacy.html and terms.html; the welcome / login screen lives in login.js.
   Bug reports are sent anonymously: only the category, the text typed and the browser type go to the
   server, which emails them to RIVL support. No account, sign-in code or email address is sent. */
(()=>{
  const $=id=>document.getElementById(id);
  const stored=k=>{try{return localStorage.getItem(k)}catch{return null}};
  const API=window.RIVL_ROOM_API||stored('rivlRoomApi')||(/^https?:$/.test(location.protocol)?location.origin:'');
  let sending=false;
  $('bugReportForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    if(sending)return;
    const status=$('bugReportStatus'),button=$('bugReportSend');
    const details=$('bugDetails').value.trim();
    if(details.length<10){status.textContent='Please describe the issue in at least 10 characters.';return}
    if(!API){status.textContent='Bug reports need the site to be opened from its web address.';return}
    sending=true;if(button)button.disabled=true;status.textContent='Sending…';
    try{
      const response=await fetch(API.replace(/\/$/,'')+'/api/bug-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:$('bugCategory').value,details,browser:navigator.userAgent})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.error||'Your report could not be sent right now. Please try again later.');
      $('bugDetails').value='';
      status.textContent='Thanks! Your report was sent anonymously.';
    }catch(err){
      status.textContent=err.message||'Your report could not be sent right now. Please try again later.';
    }finally{sending=false;if(button)button.disabled=false}
  });
  let playerSending=false;
  $('playerReportForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    if(playerSending)return;
    const status=$('playerReportStatus'),button=$('playerReportSend');
    const category=$('playerReportCategory').value,player=$('playerReportName').value.trim();
    const room=$('playerReportRoom').value.trim(),details=$('playerReportDetails').value.trim();
    if(!category||!player||details.length<10){status.textContent='Choose a reason, enter a player name and describe what happened (at least 10 characters).';return}
    if(!API){status.textContent='Reports must be submitted from the RIVL website.';return}
    playerSending=true;button.disabled=true;status.textContent='Sending report…';
    try{
      const response=await fetch(API.replace(/\/$/,'')+'/api/player-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category,player,room,details})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.error||'Could not submit your report. Try again later.');
      $('playerReportForm').reset();
      status.textContent='Report received. Thank you for helping keep RIVL safe.';
    }catch(err){status.textContent=err.message||'Could not submit your report.'}
    finally{playerSending=false;button.disabled=false}
  });

})();
