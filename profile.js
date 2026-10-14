/* Player display name: the online account name when signed in, otherwise a name kept in this browser. */
(()=>{
  const KEY='rivlName';
  const read=()=>{try{return localStorage.getItem(KEY)||''}catch{return ''}};
  const clean=v=>String(v||'').trim().slice(0,20);
  window.rivlPlayerName=()=>window.rivlAccount?.current()?.name||read()||'Player';
  function paint(){
    const name=window.rivlPlayerName();
    document.querySelectorAll('[data-player-name]').forEach(el=>el.textContent=name);
    document.querySelectorAll('[data-player-initial]').forEach(el=>el.textContent=name[0].toUpperCase());
    const signedIn=!!window.rivlAccount?.current();
    for(const id of ['roomName','joinName']){const input=document.getElementById(id);if(!input)continue;if(read()||signedIn)input.value=name;input.disabled=signedIn;input.title=signedIn?'Signed in: your account name is used':''}
  }
  window.rivlPaintName=paint;
  window.rivlSetPlayerName=value=>{const name=clean(value);if(!name)return;try{localStorage.setItem(KEY,name)}catch{}paint();window.refreshRatingUI?.()};
  function init(){
    paint();
    document.getElementById('editName')?.addEventListener('click',()=>{if(window.rivlAccount?.current())return show('profile');const v=prompt('Your display name (up to 20 characters)',window.rivlPlayerName());if(v!=null)window.rivlSetPlayerName(v)});
    for(const id of ['roomName','joinName'])document.getElementById(id)?.addEventListener('change',e=>window.rivlSetPlayerName(e.target.value));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
