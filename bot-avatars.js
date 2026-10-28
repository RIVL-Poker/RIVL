/* Profile pictures for the practice bots. To give another bot a picture, add a
   square image (about 160x160, face centred) to assets/bots/ and list it here by
   the bot's name. Bots without an entry keep their letter avatar. */
(()=>{
  const OTHERS='assets/bots/others.jpg';
  const PHOTOS={Ace:'assets/bots/ace.jpg',Rico:OTHERS,Luna:OTHERS,Nash:OTHERS,Mula:OTHERS,Jett:OTHERS,Nova:OTHERS,Blaze:OTHERS};
  function apply(avatar,name){
    if(!avatar)return;
    const src=PHOTOS[name],img=avatar.querySelector(':scope>.rivl-bot-photo');
    if(!src){img?.remove();avatar.classList.remove('has-bot-photo');return}
    if(img?.getAttribute('src')===src)return;
    avatar.classList.add('has-bot-photo');
    avatar.innerHTML=`<img class="rivl-bot-photo" src="${src}" alt="${name}">`;
  }
  window.rivlBotAvatars={apply,photo:name=>PHOTOS[name]||null};
})();
