/* Login screen shown when the site opens: Sign in with Google, a sign-in code, or bot practice as a guest.
   A signed-in player skips it, because account.js keeps their key in this browser. */
(()=>{
  const $=id=>document.getElementById(id);
  const account=window.rivlAccount;
  const overlay=$('welcomeOverlay'),dialog=overlay?.querySelector('[role="dialog"]');
  const guestKey='rivlWelcomeSeenV1';
  const status=text=>{if($('loginStatus'))$('loginStatus').textContent=text||''};
  const step=id=>{for(const el of overlay.querySelectorAll('.login-step'))el.hidden=el.id!==id;status('');overlay.querySelector('#'+id+' input')?.focus()};
  let pending=null;

  function close(){overlay.hidden=true}
  function signedIn(text){close();window.show?.('play');const el=$('accountStatus');if(el)el.textContent=text}

  // Google hands us an ID token; our server checks it with Google and signs in, links, or asks for a name.
  async function onGoogle({credential}){
    const linking=!!account.current();
    const say=text=>linking?($('accountStatus').textContent=text):status(text);
    try{
      say('Signing in with Google…');
      const data=await account.google(credential);
      if(data.needsName){
        pending=credential;
        // The token's name is only a suggestion for the box; the server never trusts it.
        let given='';try{given=JSON.parse(atob(credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).given_name||''}catch{}
        overlay.hidden=false;step('loginName');
        $('loginNameInput').value=given.replace(/[^A-Za-z0-9_\- ]/g,'').slice(0,20);
        status('One last step: choose the name other players see at the table.');
        return;
      }
      if(linking)say('Google connected. You can now sign in with Google on any device.');
      else signedIn('Signed in with Google as '+data.account.name+'.');
    }catch(e){say(e.message)}
  }

  function loadGoogle(clientId){
    const ready=()=>{
      google.accounts.id.initialize({client_id:clientId,callback:onGoogle,cancel_on_tap_outside:true});
      for(const slot of document.querySelectorAll('[data-google-slot]')){
        const box=slot.querySelector('.google-button');
        google.accounts.id.renderButton(box,{theme:'filled_black',size:'large',shape:'pill',text:box.classList.contains('login-google')?'continue_with':'signin_with',width:Math.min(320,Math.max(220,(overlay.querySelector('.login-step')?.clientWidth||320)))});
        slot.hidden=false;
      }
      for(const el of document.querySelectorAll('[data-google-fallback]'))el.hidden=true;
    };
    const s=document.createElement('script');
    s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=ready;
    s.onerror=()=>status('Google sign-in could not load. You can use a sign-in code or play bots.');
    document.head.append(s);
  }

  $('welcomeOk')?.addEventListener('click',()=>{try{sessionStorage.setItem(guestKey,'1')}catch{}close()});
  $('loginUseCode')?.addEventListener('click',()=>step('loginCode'));
  $('loginCreate')?.addEventListener('click',()=>{close();window.show?.('profile');$('accountPanel')?.scrollIntoView({block:'center'});$('accountName')?.focus({preventScroll:true})});
  overlay?.querySelectorAll('[data-login-back]').forEach(b=>b.addEventListener('click',()=>{pending=null;step('loginStart')}));
  $('loginName')?.addEventListener('submit',async e=>{
    e.preventDefault();
    try{status('Creating your account…');const data=await account.google(pending,$('loginNameInput').value);pending=null;signedIn('Welcome to RIVL, '+data.account.name+'. You are signed in with Google.')}
    catch(err){status(/expired|failed/i.test(err.message)?'Google sign-in timed out. Go back and choose Google again.':err.message)}
  });
  $('loginCode')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const key=$('loginCodeInput').value.trim();
    try{status('Signing in…');const {account:a}=await account.call('/api/me',{key});account.setAccount(a,key,'code');$('loginCodeInput').value='';signedIn('Signed in as '+a.name+'.')}
    catch(err){status(err.message)}
  });
  overlay?.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();$('welcomeOk')?.click()}
    if(e.key==='Tab'){
      const controls=[...overlay.querySelectorAll('button,input,iframe')].filter(el=>el.offsetParent&&!el.disabled);
      const first=controls[0],last=controls.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
    }
  });

  let guest=false;try{guest=sessionStorage.getItem(guestKey)==='1'}catch{}
  if(overlay&&!account?.current()&&!guest){overlay.hidden=false;dialog?.focus()}
  if(/^https?:$/.test(location.protocol))account?.call('/api/config').then(c=>{if(c.googleClientId)loadGoogle(c.googleClientId)}).catch(()=>{});
})();
