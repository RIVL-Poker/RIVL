/* Player display name: the online account name when signed in, otherwise a name kept in this browser. */
(()=>{
  const KEY='rivlName';
  const read=()=>{try{return localStorage.getItem(KEY)||''}catch{return ''}};
  const clean=v=>String(v||'').trim().slice(0,20);
  window.rivlPlayerName=()=>window.rivlAccount?.current()?.name||read()||'Player';
  function paint(){
    const name=window.rivlPlayerName();
    document.querySelectorAll('[data-player-name]').forEach(el=>{el.textContent=name;if(el.id!=='rtTitle')window.rivlLeagueIcons?.decorate(el,window.rivlAccount?.current()?.leagueKey||window.RivlRating?.tier(window.rivlAccount?.current()?.rating??0).key,{prepend:true})});
    // Your own avatar circles (header, bot table seat): saved photo when set, otherwise the initial.
    const photo=window.rivlAccount?.current()?.avatar||'';
    document.querySelectorAll('[data-player-initial]').forEach(el=>{
      if(validPhoto(photo)){if(el.querySelector('img')?.getAttribute('src')===photo)return;const img=document.createElement('img');img.src=photo;img.alt='';img.className='rivl-avatar-photo';el.replaceChildren(img)}
      else el.textContent=name[0].toUpperCase();
    });
    window.rivlPaintAvatar?.();
    const signedIn=!!window.rivlAccount?.current();
    for(const id of ['roomName','joinName']){const input=document.getElementById(id);if(!input)continue;if(read()||signedIn)input.value=name;input.disabled=signedIn;input.title=signedIn?'Signed in: your account name is used':''}
  }
  const validPhoto=a=>typeof a==='string'&&a.length<=45000&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a);
  window.rivlPaintAvatar=()=>{
    const el=document.getElementById('rtHeroGem');if(!el)return;
    const account=window.rivlAccount?.current?.(),photo=account?.avatar||'';
    el.replaceChildren();
    if(validPhoto(photo)){const img=document.createElement('img');img.src=photo;img.alt='Your profile picture';img.className='rivl-avatar-photo';el.append(img)}
    else{const initial=document.createElement('span');initial.className='profile-initial';initial.textContent=(window.rivlPlayerName?.()||'P')[0].toUpperCase();el.append(initial)}
    if(!el.querySelector('.rivl-avatar-plus')){const plus=document.createElement('span');plus.className='rivl-avatar-plus';plus.setAttribute('aria-hidden','true');plus.textContent='+';el.append(plus)}
    const upload=document.getElementById('profilePhotoInput');if(upload)upload.disabled=!account;
    el.title=account?'Change profile picture':'Sign in to change your profile picture';
  };
  function setupPhoto(){
    const input=document.getElementById('profilePhotoInput'),avatar=document.getElementById('rtHeroGem'),notice=document.getElementById('rivlPhotoNotice');
    avatar?.addEventListener('click',()=>{if(!window.rivlAccount?.current()){const status=document.getElementById('profilePhotoStatus');if(status){status.hidden=false;status.textContent='Sign in to change your profile picture.'}return}input?.click()});
    document.getElementById('rivlPhotoNoticeClose')?.addEventListener('click',()=>notice?.close());
    if(!input)return;
    input.addEventListener('change',async()=>{
      const file=input.files?.[0],status=document.getElementById('profilePhotoStatus');input.value='';
      if(!file)return;
      if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>5*1024*1024){if(status)status.textContent='Choose a JPEG, PNG or WebP photo under 5 MB.';return}
      try{
        const bitmap=await createImageBitmap(file);
        const canvas=document.createElement('canvas');canvas.width=112;canvas.height=112;
        const ctx=canvas.getContext('2d');const size=Math.min(bitmap.width,bitmap.height);
        ctx.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,112,112);
        bitmap.close?.();
        const data=canvas.toDataURL('image/jpeg',0.72);
        if(data.length>45000)throw Error('Image too large after resizing.');
        if(status)status.textContent='Saving photo…';
        await window.rivlAccount.updateAvatar(data);window.rivlPaintAvatar();if(status){status.hidden=true;status.textContent=''}notice?.showModal();
      }catch(e){if(status){status.hidden=false;status.textContent=e.message||'Photo could not be saved.'}}
    });
  }
  document.addEventListener('DOMContentLoaded',setupPhoto);
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
