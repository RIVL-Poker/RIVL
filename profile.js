/* Player display name: the online account name when signed in, otherwise a name kept in this browser. */
(()=>{
  const KEY='rivlName';
  const read=()=>{try{return localStorage.getItem(KEY)||''}catch{return ''}};
  const clean=v=>String(v||'').trim().slice(0,20);
  window.rivlPlayerName=()=>window.rivlAccount?.current()?.name||read()||'Player';
  function paint(){
    const name=window.rivlPlayerName();
    document.querySelectorAll('[data-player-name]').forEach(el=>{el.textContent=name;window.rivlLeagueIcons?.decorate(el,window.rivlAccount?.current()?.leagueKey||window.RivlRating?.tier(window.rivlAccount?.current()?.rating||1500).key,{prepend:true})});
    document.querySelectorAll('[data-player-initial]').forEach(el=>el.textContent=name[0].toUpperCase());
    const signedIn=!!window.rivlAccount?.current();
    for(const id of ['roomName','joinName']){const input=document.getElementById(id);if(!input)continue;if(read()||signedIn)input.value=name;input.disabled=signedIn;input.title=signedIn?'Signed in: your account name is used':''}
  }
  window.rivlPaintName=paint;
  window.rivlSetPlayerName=value=>{const name=clean(value);if(!name)return;try{localStorage.setItem(KEY,name)}catch{}paint();window.refreshRatingUI?.()};
  function openNameDialog(){
    let dialog=document.getElementById('rivlNameDialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='rivlNameDialog';dialog.className='rivl-dialog';dialog.innerHTML='<form method="dialog"><div class="rivl-dialog-brand">♠ RIVL · PLAYER PROFILE</div><h2>YOUR DISPLAY NAME</h2><p>Choose the name other players will see at the table.</p><label for="rivlNameInput">PLAYER NAME</label><input id="rivlNameInput" maxlength="20" autocomplete="nickname" required><div class="rivl-dialog-actions"><button value="cancel" class="outline">CANCEL</button><button value="save" class="gold">SAVE NAME</button></div></form>';document.body.append(dialog);
      dialog.addEventListener('close',()=>{if(dialog.returnValue==='save')window.rivlSetPlayerName(dialog.querySelector('input').value)});
    }
    dialog.querySelector('input').value=window.rivlPlayerName();dialog.showModal();dialog.querySelector('input').focus();
  }
  function init(){
    paint();
    document.getElementById('editName')?.addEventListener('click',()=>{if(window.rivlAccount?.current())return show('profile');openNameDialog()});
    for(const id of ['roomName','joinName'])document.getElementById(id)?.addEventListener('change',e=>window.rivlSetPlayerName(e.target.value));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
