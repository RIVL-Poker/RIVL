/* RIVL private rooms client. The room server is served from the same origin as the site unless window.RIVL_ROOM_API overrides it. */
(()=>{
  const $=id=>document.getElementById(id);
  const stored=key=>{try{return localStorage.getItem(key)}catch{return null}};
  const API=window.RIVL_ROOM_API||stored('rivlRoomApi')||(/^https?:$/.test(location.protocol)?location.origin:'');
  const SESSION='rivlRoomSession';
  let socket=null,roomCode='',token='',snapshot=null,selectedSeat=-1,isHost=false,clockOffset=0,retry=0,retryTimer=null,pingTimer=null,roomWinKey='',roomWinTimer=null;
  const saveSession=()=>{try{localStorage.setItem(SESSION,JSON.stringify({code:roomCode,token}))}catch{}};
  const clearSession=()=>{try{localStorage.removeItem(SESSION)}catch{}};
  const suit={S:'♠',H:'♥',D:'♦',C:'♣'};
  const pretty=c=>c?c[0]+suit[c[1]]:'🂠';
  const cardNode=(code,back=false)=>{const el=document.createElement('div');el.className='card'+(back?' back':'')+(code&&/[HD]$/.test(code)?' red':'');if(back){el.textContent='♠';return el}if(!code)return el;const rank=document.createElement('strong');rank.textContent=code[0]==='T'?'10':code[0];const corner=document.createElement('small');corner.textContent=suit[code[1]];rank.append(corner);const center=document.createElement('span');center.className='rivl-card-center';center.textContent=suit[code[1]];el.append(rank,center);return el};
  const avatarFor=p=>p?.avatar||p?.name?.[0]?.toUpperCase()||'♠';
  const reportPhoto=async seat=>{
    if(!seat?.accountId)return;
    if(!window.rivlAccount?.key()){alert('Sign in on Profile to report a photo.');return}
    if(seat.accountId===window.rivlAccount?.current()?.id)return;
    const reason=prompt('Why are you reporting this profile photo? (e.g. explicit, hateful, impersonation)');
    if(reason===null)return;
    try{const result=await window.rivlAccount.reportAvatar(seat.accountId,reason);alert(result.message||'Report received.');}
    catch(e){alert(e.message||'Could not submit report.')}
  };
  const appendReport=(el,seat)=>{
    if(!seat?.accountId||seat.accountId===window.rivlAccount?.current()?.id||!/^data:image\//.test(seat.avatar||''))return;
    const b=document.createElement('button');b.type='button';b.className='rivl-report-photo';b.textContent='REPORT PHOTO';b.title='Report inappropriate profile picture';b.onclick=()=>reportPhoto(seat);el.append(b);
  };
  // The server sends each seat's photo once; later states leave it out while the seat is unchanged.
  const keepPhotos=(before,now)=>now?.seats?.forEach((s,i)=>{const old=before?.seats?.[i];if(s&&s.avatar===undefined&&old&&old.name===s.name&&old.accountId===s.accountId)s.avatar=old.avatar});
  const paintSeatAvatar=(el,p)=>{const a=avatarFor(p);el.replaceChildren();if(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a)&&a.length<=45000){const img=document.createElement('img');img.src=a;img.alt='';img.className='rivl-avatar-photo';el.append(img)}else el.textContent=a};
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  let clockTimer=null,roomBetKey='',previousHand=0,previousBoard=[],previousTurn=-1,previousPhase='',lastTick=-1,clockKey='',clockSpan=12000;
  function pvpSound(kind){const files={card:'card.wav',chip:'chips.wav',tick:'tick.wav',win:'pot.wav'};if(!files[kind])return;const a=new Audio('sounds/'+files[kind]);a.volume=kind==='tick'?.16:.28;a.play().catch(()=>{})}
  function animatedCard(code,back,delay=0){const el=cardNode(code,back);if(delay){el.classList.add('rivl-deal-in');el.style.animationDelay=delay+'ms'}return el}
  let roomTab='chat',roomHistory=[],roomChat=[];
  const CHAT_LIMIT=180;
  function addChatMessage(entry){
    if(!entry||typeof entry.text!=='string')return;
    if(roomChat.some(m=>m.id===entry.id))return;
    roomChat=[...roomChat,entry].slice(-40);
    if(roomTab==='chat')renderRoomPanel();
  }
  function sendChat(event){
    event.preventDefault();
    const input=$('roomChatInput'),text=input?.value.trim();
    if(!text||!snapshot||socket?.readyState!==WebSocket.OPEN)return;
    if(text.length>CHAT_LIMIT)return;
    send({type:'chat',text});input.value='';input.focus();
  }
  document.addEventListener('submit',event=>{if(event.target?.id==='roomChatForm')sendChat(event)});
  function renderRoomPanel(){
    const target=$('roomTabContent');if(!target)return;
    const g=snapshot?.game;
    if(roomTab==='chat'){
      // Preserve the input and focus while live chat messages arrive.
      let feed=$('roomChatFeed');
      if(!feed||!target.contains(feed)){
        target.replaceChildren();
        const shell=document.createElement('div');shell.className='room-chat';
        feed=document.createElement('div');feed.id='roomChatFeed';feed.className='room-chat-feed';feed.setAttribute('role','log');feed.setAttribute('aria-label','Table chat');
        const form=document.createElement('form');form.id='roomChatForm';form.className='room-chat-form';
        const input=document.createElement('input');input.id='roomChatInput';input.name='message';input.maxLength=CHAT_LIMIT;input.autocomplete='off';input.placeholder='Message the table…';input.setAttribute('aria-label','Table chat message');
        const button=document.createElement('button');button.type='submit';button.textContent='SEND';button.className='gold';
        form.append(input,button);shell.append(feed,form);target.append(shell);
      }
      feed.replaceChildren();
      if(!roomChat.length){const empty=document.createElement('div');empty.className='room-chat-empty';empty.textContent='No messages yet. Say hello!';feed.append(empty)}
      for(const m of roomChat){const row=document.createElement('div');row.className='room-chat-line'+(m.seat===snapshot?.mySeat?' mine':'');const name=document.createElement('b');name.textContent=m.name+': ';const content=document.createElement('span');content.textContent=m.text;row.append(name,content);feed.append(row)}
      feed.scrollTop=feed.scrollHeight;
      return;
    }
    if(roomTab==='history'){target.textContent=roomHistory.length?roomHistory.slice(-12).reverse().join(' • '):'No completed hands yet.';return}
    if(roomTab==='stats'&&snapshot?.tourney){const i=snapshot.tourney.info;target.textContent=(g?.players?.map(p=>p.name+': '+p.stack.toLocaleString()).join(' • ')||'Waiting for the first hand.')+(i?` • ${i.left} of ${i.entrants} players left`:'');return}
    if(roomTab==='stats'){target.textContent=g?.players?.map(p=>p.name+': '+p.stack.toLocaleString()+' chips'+(p.folded?' (folded)':'')).join(' • ')||'Waiting for match.';return}
    if(snapshot?.tourney){const i=snapshot.tourney.info;target.textContent=`Nightly Freeroll · Table ${snapshot.tourney.table}`+(i?` · Level ${i.level} · ${i.left} of ${i.entrants} left`:'')+' · 12-second turns';return}
    target.textContent=(snapshot?.ranked?'Ranked · leaving early places you last':'Unranked')+' · 12-second turns';
  }
  $('roomTogglePanel')?.addEventListener('click',()=>{
    const collapsed=$('roomGamePanel').classList.toggle('collapsed');
    $('roomTogglePanel').textContent=collapsed?'⌃   OPEN GAME PANEL':'⌄   HIDE GAME PANEL';
    $('roomTogglePanel').setAttribute('aria-expanded',String(!collapsed));
    renderRoomPanel();
  });
  document.querySelectorAll('[data-room-tab]').forEach(button=>button.addEventListener('click',()=>{
    roomTab=button.dataset.roomTab;
    document.querySelectorAll('[data-room-tab]').forEach(b=>b.classList.toggle('selected',b===button));
    renderRoomPanel();
  }));
  const MATCH_KEY='rivlOnlineRecentMatches';
  // Ranked Elo history for the Profile tracker: one entry per match, filled in once the server reports the rating change.
  function recordRanked(g,id,result){
    const acct=window.rivlAccount?.current?.(),c=acct&&g.ratingChanges?.find(x=>x.id===acct.id);if(!c)return;
    let list=[];try{list=JSON.parse(localStorage.getItem('rivlRankedHistory')||'[]')}catch{}if(!Array.isArray(list))list=[];
    if(list.some(m=>m.id===id))return;
    list.push({id,account:acct.id,date:Date.now(),before:c.before,after:c.after,acc:c.accuracy??null,result,players:g.players.length});
    try{localStorage.setItem('rivlRankedHistory',JSON.stringify(list.slice(-100)))}catch{}
  }
  function recordMatch(g){
    if(!g?.matchOver||!roomCode)return;
    const id=roomCode+':'+(g.matchId||g.handNumber)+':'+(g.players?.map(p=>p.name).join('|')||'');
    if(snapshot.ranked){const me=g.players?.find(p=>p.seat===snapshot.mySeat),best=g.players?.filter(p=>!p.left).sort((a,b)=>b.stack-a.stack)[0];if(me)recordRanked(g,id,best?.seat===me.seat?'Win':'Loss')}
    let records=[];try{records=JSON.parse(localStorage.getItem(MATCH_KEY)||'[]')}catch{}
    if(!Array.isArray(records))records=[];
    if(records.some(m=>m.id===id))return;
    const me=g.players?.find(p=>p.seat===snapshot.mySeat);
    if(!me)return;
    const winner=g.players.filter(p=>!p.left).sort((a,b)=>b.stack-a.stack)[0];
    records.push({id,date:Date.now(),mode:snapshot.ranked?'Ranked PvP':'Unranked PvP',players:g.players.length,result:winner?.seat===me.seat?'Win':'Loss',stack:me.stack});
    try{localStorage.setItem(MATCH_KEY,JSON.stringify(records.slice(-50)))}catch{}
    if(snapshot.ranked)window.rivlAccount?.refresh?.();
    window.refreshRatingUI?.();
  }
  let lastRecordedResult='';
  let wasPlaying=false;
  const status=message=>{$('roomStatus').textContent=message};
  const safeName=value=>(value||'Player').trim().slice(0,20)||'Player';
  const request=async(path,method='GET',body)=>{if(!API)throw Error('Online rooms need the site to be opened from its web address, not as a local file.');const response=await fetch(API.replace(/\/$/,'')+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json().catch(()=>({error:'Room server unavailable ('+response.status+')'}));if(!response.ok)throw Error(data.error||'Room server error');return data};
  function render(){
    if(!snapshot)return;
    const fr=snapshot.tourney;
    $('roomEntry').hidden=true;$('roomFinder').hidden=true;$('capacityNote').hidden=true;$('roomLobby').hidden=false;$('roomCodeLabel').textContent=fr?'· FREEROLL TABLE '+fr.table:snapshot.ranked?'· RANKED '+(snapshot.rankedMax||6)+' PLAYERS':roomCode;
    const playing=!!snapshot.started&&!!snapshot.game;
    const disclaimer=document.querySelector('.room-disclaimer');
    if(disclaimer)disclaimer.textContent=fr?'Nightly Freeroll · free to play, no real money, no Elo change. Your seat is kept if you refresh or lose connection.':(snapshot.ranked?'Ranked':'Unranked')+' multiplayer · server-controlled betting · no real-money wagering. Your seat is kept if you refresh or lose connection.';
    const heading=document.querySelector('.crumb');
    if(heading)heading.textContent=fr?'TEXAS HOLD’EM · NIGHTLY FREEROLL':playing?'TEXAS HOLD’EM · '+(snapshot.ranked?'RANKED':'UNRANKED')+' MULTIPLAYER':'TEXAS HOLD’EM · ONLINE ROOMS';
    $('rooms').classList.toggle('rivl-match-mode',playing);
    if(playing&&!wasPlaying){window.scrollTo({top:0,behavior:'instant'});}
    wasPlaying=playing;
    const host=isHost;
    $('roomHostNotice').textContent=fr?'Freeroll table '+fr.table+'. The first hand is dealt when the tournament starts.':snapshot.ranked?rankedQueueText():
      (host?'You are the host. Tap + to add a bot.':'Waiting for the host to start.');
    $('roomPrivate').disabled=!host;$('roomPublic').disabled=!host;
    // Ranked tables are matchmade: no visibility switch, no room code to share and no Start button.
    const visibilityRow=document.querySelector('.room-visibility');if(visibilityRow)visibilityRow.hidden=!!snapshot.ranked||!!fr;
    $('roomStart').hidden=!!snapshot.ranked||!!fr;
    clearInterval(queueTimer);if(snapshot.ranked&&!snapshot.started)queueTimer=setInterval(()=>{$('roomHostNotice').textContent=rankedQueueText()},1000);
    $('roomPrivate').className=snapshot.visibility==='private'?'gold':'outline';
    $('roomPublic').className=snapshot.visibility==='public'?'gold':'outline';
    const seats=$('roomSeats');seats.replaceChildren();
    snapshot.seats.forEach((seat,i)=>{
      if(snapshot.ranked&&i>=(snapshot.rankedMax||6))return;
      const el=document.createElement('div');el.className='room-seat';
      if(seat){
        const avatar=document.createElement('div');avatar.className='room-avatar';paintSeatAvatar(avatar,seat);el.append(avatar);
        const name=document.createElement('strong');name.textContent=seat.name;if(seat.name===window.rivlAccount?.current()?.name&&seat.verified)window.rivlLeagueIcons?.decorate(name,window.rivlAccount.current().leagueKey||window.RivlRating?.tier(window.rivlAccount.current().rating).key,{prepend:true});if(seat.verified){const v=document.createElement('span');v.className='verified-badge';v.title='Signed-in player';v.textContent='✓';name.append(v)}el.append(name);
        const info=document.createElement('small');info.textContent=(seat.type==='bot'?seat.level+' · Bot':seat.isHost?'Host · Human':'Human')+(i===snapshot.mySeat?' · You':'');el.append(info);if(!snapshot.ranked)appendReport(el,seat);
        if(!seat.online){el.classList.add('is-offline');const off=document.createElement('small');off.className='room-offline';off.textContent='Reconnecting…';el.append(off)}
        if(host&&!snapshot.ranked&&seat.type==='human'&&i!==snapshot.mySeat&&!lobbyLocked()){const kick=document.createElement('button');kick.className='room-remove';kick.textContent='REMOVE';kick.onclick=()=>send({type:'removePlayer',seat:i});el.append(kick)}
        if(host&&seat.type==='bot'&&!lobbyLocked()){const remove=document.createElement('button');remove.className='room-remove';remove.textContent='REMOVE';remove.onclick=()=>send({type:'removeBot',seat:i});el.append(remove)}
      }else{
        const add=document.createElement('button');add.textContent='+';add.title=host?'Add a bot':'Waiting for player';add.disabled=!host||lobbyLocked()||!!snapshot.ranked;if(snapshot.ranked)add.title='Open seat';add.onclick=()=>{selectedSeat=i;openBotPicker()};el.append(add);
        const label=document.createElement('small');label.textContent='EMPTY · SEAT '+(i+1);el.append(label);
      }
      seats.append(el);
    });
    const occupied=snapshot.seats.filter(Boolean).length;
    $('roomStart').disabled=!host||occupied<2||lobbyLocked();
    $('roomStart').textContent=lobbyLocked()?'MATCH IN PROGRESS':occupied<2?'NEED 2 PLAYERS':snapshot.game?.matchOver?'REMATCH':'START MATCH';
    const gameArea=$('roomGame');
    gameArea.hidden=!snapshot.game;
    if(snapshot.game){
      const g=snapshot.game;
      $('roomBlinds').textContent=g.smallBlind+' / '+g.bigBlind;
      $('roomMode').textContent=fr?'FREEROLL · TABLE '+fr.table:snapshot.ranked?'PVP · RANKED':'PVP · UNRANKED';
      $('roomGamePhase').textContent='#'+g.handNumber+' · '+g.phase.toUpperCase();
      const active=g.players.filter(p=>p&&!p.sittingOut);
      $('roomPlayerCount').textContent=active.length;
      const me=g.players.find(p=>p.seat===snapshot.mySeat);
      // Opponents are laid out clockwise starting at your left, in the server's turn order (seat index order
      // starting after yours), so the action, dealer and blinds travel around the table instead of jumping.
      const after=p=>me?(p.seat-me.seat+9)%9:p.seat;
      const opponents=g.players.filter(p=>p&&(!me||p.seat!==me.seat)).sort((a,b)=>after(a)-after(b));
      $('roomMyName').textContent=me?.name||'Spectator';
      paintSeatAvatar($('roomMyAvatar'),snapshot.seats[me?.seat]||me);const mySpot=$('roomMyAvatar').parentElement;for(const [cls,seat] of [['is-dealer',g.dealer],['is-sb',g.sbSeat],['is-bb',g.bbSeat]])mySpot.classList.toggle(cls,!!me&&me.seat===seat);
      $('roomMyStack').textContent=window.rivlAmounts.fmtUnit(me?.stack??0,g.bigBlind);
      // Like bot practice, your clock always sits beside your cards and counts down only on your turn.
      const myTurn=!!me&&g.turn===me.seat&&g.phase!=='showdown';$('roomTimer').hidden=!me;$('roomTimer').classList.toggle('is-live',myTurn);
      // Ranked: three +5 second extensions per match, usable on your own turn.
      const ext=$('roomExtend'),extLeft=snapshot.extensionsLeft;ext.hidden=!me||extLeft==null||g.matchOver||!!me.folded;
      if(!ext.hidden){ext.disabled=!myTurn||!extLeft;ext.classList.toggle('is-live',myTurn&&extLeft>0);$('roomExtendLeft').textContent=extLeft?extLeft+' left':'none left'}
      const newHand=g.handNumber!==previousHand;
      if(newHand){previousHand=g.handNumber;previousBoard=[];previousTurn=-1;lastTick=-1}
      const hole=$('roomHoleCards'),table=$('roomPokerTable'),seatOf=new Map([...$('roomGamePlayers').children].map(el=>[+el.dataset.seat,el]));
      // Folded hands (yours face up, others face down) slide from their seat into the discard pile.
      window.rivlTable?.muck(table,roomCode+':'+(g.matchId||'')+':'+g.handNumber,g.players.filter(p=>p&&p.folded&&!p.sittingOut).map(p=>me&&p.seat===me.seat?{key:p.seat,from:hole,cards:[...hole.children]}:{key:p.seat,from:seatOf.get(p.seat)}));
      mySpot.classList.toggle('is-folded',!!me?.folded);
      window.rivlTable?.bbCount(mySpot,$('roomMyAvatar'),me?.stack??0,me?g.bigBlind:0);
      if(me?.folded)hole.replaceChildren();
      else if(newHand||hole.children.length!==2){
        hole.replaceChildren();
        for(let i=0;i<2;i++)hole.append(animatedCard(g.holeCards?.[i],!g.holeCards?.[i],i*170+100));
        if(g.holeCards?.length){setTimeout(()=>pvpSound('card'),100);setTimeout(()=>pvpSound('card'),270)}
      }
      const board=$('roomBoard');
      const revealed=g.board.length;
      if(newHand)board.replaceChildren();
      // Refresh previously hidden placeholders as the server reveals each street.
      // Do not replay the deal animation or audio for unchanged cards.
      for(let i=0;i<5;i++){
        const code=g.board[i],old=board.children[i];
        if(!old||old.dataset.code!==(code||'')){
          const newlyRevealed=!!code&&i>=previousBoard.length;
          const el=animatedCard(code,!code,newlyRevealed?100+(i-previousBoard.length)*180:0);
          el.dataset.code=code||'';
          if(old)old.replaceWith(el);else board.append(el);
        }
      }
      if(revealed>previousBoard.length){
        g.board.slice(previousBoard.length).forEach((_,i)=>setTimeout(()=>pvpSound('card'),100+i*180));
      }
      previousBoard=[...g.board];
      if(previousTurn!==g.turn&&g.phase!=='showdown'){if(previousTurn!==-1)pvpSound('chip');previousTurn=g.turn}
      if(previousPhase!=='showdown'&&g.phase==='showdown')pvpSound('win');
      previousPhase=g.phase;
      $('roomPot').textContent=g.pot;
      const amt=(n)=>window.rivlAmounts.fmt(n,g.bigBlind);
      window.rivlAmounts.fill($('roomPotTotal'),g.pot,g.bigBlind);$('roomPotLabel').textContent=amt(g.pot);window.rivlAmounts.paint();
      window.rivlAmounts.fill($('roomBalance'),me?.stack??0,g.bigBlind);
      const myContribution=Number(g.players.find(p=>p.seat===snapshot.mySeat)?.contribution||0);
      $('roomPotEquity').textContent=g.pot?Math.round(100*myContribution/g.pot)+'%':'0%';
      const potEl=$('roomPotChips');if(potEl.dataset.pot!==String(g.pot||0)){potEl.dataset.pot=g.pot||0;potEl.innerHTML=window.rivlChips.pileHTML(g.pot)}
      const seats=$('roomGamePlayers');seats.replaceChildren();
      const count=Math.min(9,opponents.length+1);
      $('roomPokerTable').dataset.playerCount=String(count);
      opponents.forEach((p,i)=>{
        const item=document.createElement('div'),thinking=p.bot&&p.seat===g.turn&&g.phase!=='showdown';
        item.dataset.seat=p.seat;item.className='seat rivl-pvp-seat s'+(i+1)+(p.seat===g.turn?' is-turn':'')+(thinking?' is-thinking':'')+(p.folded?' is-folded':'')+(p.seat===g.dealer?' is-dealer':'')+(p.seat===g.sbSeat?' is-sb':'')+(p.seat===g.bbSeat?' is-bb':'');
        const avatar=document.createElement('div');avatar.className='avatar';paintSeatAvatar(avatar,snapshot.seats[p.seat]||p);
        const label=document.createElement('span');label.className='rivl-seat-label';const who=document.createElement('b');who.textContent=p.name;if(snapshot?.ranked&&p.id===window.rivlAccount?.current()?.id)window.rivlLeagueIcons?.decorate(who,window.rivlAccount.current().leagueKey||window.RivlRating?.tier(window.rivlAccount.current().rating).key,{prepend:true});const info=document.createElement('small');info.textContent=amt(p.stack)+(p.left?' · LEFT':p.away&&snapshot.seats[p.seat]?.online===false?' · AWAY':'')+(p.folded?' · FOLD':p.allIn?' · ALL IN':p.bet?' · BET '+amt(p.bet):'')+(p.seat===g.turn&&!thinking?' ◀ TURN':'');label.append(who,info);
        item.append(avatar,label);
        if(thinking){const dots=document.createElement('i');dots.className='think-dots';dots.setAttribute('aria-hidden','true');dots.append(...[0,1,2].map(()=>document.createElement('b')));item.append(dots)}
        const cards=g.shown?.[p.seat];
        if(cards){const shown=document.createElement('span');shown.className='rivl-shown';cards.forEach(c=>shown.append(cardNode(c)));item.append(shown)}
        // Evenly distribute opponents along a mirrored arc around the Cairo table.
        const total=opponents.length;
        // On the tall phone table, 4 opponents spread wider so the two top seats don't touch.
        const tall=$('roomPokerTable').clientHeight>$('roomPokerTable').clientWidth;
        const span=total===1?0:total===2?70:total===4&&tall?150:Math.min(220,100+Math.max(0,total-3)*24);
        const angle=(270-span/2+(total===1?0:span*i/(total-1)))*Math.PI/180;
        item.style.left=(50+51*Math.cos(angle))+'%';
        item.style.top=(50+59*Math.sin(angle))+'%';
        item.style.right='auto';item.style.bottom='auto';
        item.style.transform='translate(-50%,-50%)';
        // Revealed cards sit off the pill, toward the felt, so they never cover the name, stack or rim label.
        // Side seats tuck them in beside the pill on wide tables; phones stack them above or below.
        if(cards){
          const cos=Math.cos(angle);
          item.classList.add('has-shown',Math.sin(angle)>0.3?'shown-above':'shown-below');
          if(Math.abs(cos)>0.45)item.classList.add(cos<0?'shown-right':'shown-left');
        }
        seats.append(item);
        window.rivlTable?.bbCount(item,avatar,p.stack,g.bigBlind);
      });
      if(g.result&&lastRecordedResult!==g.handNumber+':'+g.result){roomHistory.push('Hand '+g.handNumber+': '+g.result);if(roomHistory.length>100)roomHistory.shift();lastRecordedResult=g.handNumber+':'+g.result}
      renderRoomPanel();
      // Large showdown banner. Use only publicly revealed cards from the server.
      const winnerOverlay=$('rivlRoomWinFx')||(()=>{const el=document.createElement('div');el.id='rivlRoomWinFx';el.className='rivl-room-win-fx';el.setAttribute('aria-live','polite');$('roomPokerTable').append(el);return el})();
      // It shows once per hand and steps aside after a few seconds so the board and every revealed hand stay visible.
      const winKey=roomCode+':'+g.handNumber;
      if(g.phase==='showdown'&&g.result&&!g.matchOver){if(winKey!==roomWinKey){roomWinKey=winKey;clearTimeout(roomWinTimer);roomWinTimer=setTimeout(()=>winnerOverlay.classList.remove('visible'),WIN_BANNER_MS);
        const winner=g.winners?.length===1?g.winners[0]:null;
        const winnerCards=winner?g.shown?.[winner.seat]:null;
        winnerOverlay.replaceChildren();
        const heading=document.createElement('strong');heading.textContent=winner?winner.name+' WINS':g.winners?.length>1?'SPLIT POT':'HAND COMPLETE';
        const hand=document.createElement('div');hand.className='rivl-win-hand';hand.textContent=winner?.hand||'UNCONTESTED';
        winnerOverlay.append(heading);
        if(Array.isArray(winnerCards)&&winnerCards.length===2){const cards=document.createElement('div');cards.className='rivl-winner-cards';winnerCards.forEach(code=>cards.append(cardNode(code)));winnerOverlay.append(cards)}
        winnerOverlay.append(hand);
        if(winner&&Number.isFinite(Number(winner.amount))){const gain=document.createElement('small');gain.className='rivl-victory-gain';gain.textContent=winner.name+' +'+amt(winner.amount);winnerOverlay.append(gain)}
        winnerOverlay.classList.add('visible');}
      }else{roomWinKey='';clearTimeout(roomWinTimer);winnerOverlay.classList.remove('visible')}
      $('roomWinner').textContent=g.result||'';
      $('roomNext').hidden=!(g.matchOver&&(host||snapshot.ranked||fr));
      $('roomNext').textContent=fr?'FREEROLL RESULTS':snapshot.ranked?'FIND NEXT RANKED MATCH':'BACK TO LOBBY';
      if(g.matchOver&&!fr)recordMatch(g);
      if(g.matchOver&&fr)$('roomWinner').textContent=g.note||'The freeroll is over.';
      else if(g.matchOver){const best=g.players.filter(p=>!p.left).sort((a,b)=>b.stack-a.stack)[0];$('roomWinner').textContent=best?'Match complete · '+best.name+' wins the table':'Match complete'}
      const ratings=$('roomRatings');ratings.replaceChildren();
      if(g.matchOver&&(g.ratingChanges?.length||g.note)){
        for(const c of g.ratingChanges||[]){const line=document.createElement('div'),d=c.after-c.before;line.textContent=`${c.name}: ${c.before} → ${c.after} `;const delta=document.createElement('span');delta.className=d>=0?'up':'down';delta.textContent=(d>=0?'+':'')+d;line.append(delta);if(c.accuracy!=null)line.append(` · ${c.accuracy}% decision accuracy`);ratings.append(line)}
        if(g.note){const n=document.createElement('p');n.className='muted';n.textContent=g.note;ratings.append(n)}
      }
      const l=g.legal;
      // Keep pot, equity and balance visible while waiting, folded, or between turns.
      $('roomActions').hidden=false;
      $('roomActions').classList.toggle('is-waiting',!l);
      if(l){
        $('roomCall').textContent=l.call?'CALL '+amt(l.call):'CHECK';
        $('roomRaise').disabled=!l.canRaise;
        $('roomAllin').disabled=!l.canRaise&&l.raiseToMax>l.call;
        const amount=$('roomRaiseAmount'),slider=$('roomRaiseSlider');
        const first=5*Math.ceil(l.raiseToMin/5),last=5*Math.floor(l.raiseToMax/5);
        amount.min=slider.min=first;amount.max=slider.max=last;amount.step=slider.step=5;
        // Each new decision starts the raise bar back at the minimum legal raise.
        const betKey=[g.handNumber,g.board.length,l.call,first].join(':');
        if(betKey!==roomBetKey||Number(amount.value)<first||Number(amount.value)>last||Number(amount.value)%5)amount.value=first;
        roomBetKey=betKey;
        slider.value=amount.value;window.rivlAmounts.raiseLabel($('roomAmountLabel'),amount.value,snapshot?.game?.bigBlind);
        $('roomBetInfo').parentElement.hidden=true;
        $('roomBetInfo').textContent='Raise to '+l.raiseToMin+'–'+l.raiseToMax+' chips'+(window.rivlAmounts.unit()==='bb'?' ('+amt(l.raiseToMin)+'–'+amt(l.raiseToMax)+')':'')+' · 12-second turn';
      }else{roomBetKey='';$('roomBetInfo').parentElement.hidden=false;$('roomBetInfo').textContent=fr&&g.matchOver?'The freeroll is over':fr&&!me?'You are seated. You will be dealt in on the next hand.':fr&&me?.away?'You are sitting out. Your hands are folded until you come back.':g.matchOver?(snapshot.ranked?'Find your next Ranked match or go back to the lobby':host?'Start a rematch or go back to the lobby':'Waiting for the host'):me?.away?'You are sitting out. Act on your turn to rejoin.':g.phase==='showdown'?'Next hand starts shortly':g.players.find(x=>x.seat===g.turn&&x.bot)?g.players.find(x=>x.seat===g.turn).name+' is thinking…':'Waiting for next turn';}
      clearInterval(clockTimer);
      const tick=()=>{
        // The ring drains over the whole turn, extensions included, so an extension refills it.
        const ms=Math.max(0,g.deadline-(Date.now()+clockOffset)),key=[g.handNumber,g.turn,g.board.length,g.currentBet].join(':');
        if(key!==clockKey){clockKey=key;clockSpan=12000}clockSpan=Math.max(clockSpan,ms);const percent=Math.min(100,ms/clockSpan*100);
        $('roomTimer').style.background=myTurn?'conic-gradient(#dc5555 '+(100-percent)+'%, #52bd76 0)':'';
        const sec=Math.ceil(ms/1000);if(g.turn===me?.seat&&sec<=5&&sec>0&&sec!==lastTick){pvpSound('tick');lastTick=sec}
        $('roomTimerText').textContent=myTurn?Math.ceil(ms/1000):'–';
        $('roomBlindsLabel').innerHTML=blindClockText(snapshot.blindClock);
      };
      tick();clockTimer=setInterval(tick,200);
    }else{clearInterval(clockTimer);$('roomBlindsLabel').textContent='BLINDS'}
  }
  // Ranked blinds rise on the match clock: count down to the next level, then to the last hand.
  function blindClockText(bc){
    if(!bc)return 'BLINDS';
    const tag=(long,short,t)=>'BLINDS<span class="blind-clock"><span class="blind-clock-long"> · '+long+' '+t+'</span><span class="blind-clock-short"> '+short+t+'</span></span>';
    const now=Date.now()+clockOffset,left=at=>{const s=Math.max(0,Math.ceil((at-now)/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
    return bc.nextAt>now?tag('UP IN','↑',left(bc.nextAt)):bc.lastDealAt>now?tag('LAST HAND IN','LAST HAND ',left(bc.lastDealAt)):tag('FINAL HAND','FINAL','');
  }
  window.rivlAmounts?.onChange(()=>render());
  let queueTimer=null,rankedEntry=false;
  function rankedQueueText(){
    const seated=snapshot.seats.filter(Boolean).length,max=snapshot.rankedMax||6;
    const wait=snapshot.startsAt?Math.max(0,Math.ceil((snapshot.startsAt-Date.now()-clockOffset)/1000)):0;
    const head=snapshot.started?'Ranked match.':seated<2?`Finding players… ${seated} of ${max} seated.`:`Starts in ${wait}s · ${seated} of ${max} seated.`;
    return head+' Leaving early places you last.';
  }
  function lobbyLocked(){return !!snapshot?.game&&!snapshot.game.matchOver}
  function send(message){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));else status('Reconnecting to the room…')}
  // Ranked lobbies get their own browser history entry, so the phone or browser back gesture leaves the lobby
  // instead of the site. Leaving a Ranked room by any route lands on the 3/6/9 Ranked menu, not the casual finder.
  // (script.js declares a global `history` array, so the browser API is reached through window.history.)
  let skipRankedPop=false;
  const inRankedHistory=()=>!!window.history.state?.rivlRankedRoom;
  function markRankedHistory(){if(!inRankedHistory())try{window.history.pushState({rivlRankedRoom:true},'')}catch{}}
  function dropRankedHistory(){if(inRankedHistory()){skipRankedPop=true;window.history.back()}}
  function showRankedMenu(message){
    show('play');$('modeSelect').hidden=true;$('playerSelect').hidden=true;$('rankedSelect').hidden=false;
    $('rankedSelectStatus').textContent=window.rivlAccount?.key()?(message||''):'Sign in on your Profile to play Ranked.';
  }
  function leaveRoom(){
    if(snapshot?.tourney){
      // A freeroll seat is kept: leaving the table just sits you out until you come back from the Freeroll page.
      if(!snapshot.tourney.done&&!confirm('Leave the table? You stay in the freeroll, but your hands are folded until you come back.'))return false;
      send({type:'leave'});resetView('Left the freeroll table.');show('freeroll');window.rivlFreeroll?.refresh();return true;
    }
    if(lobbyLocked()&&!confirm(snapshot?.ranked?'Leave this Ranked match? You will place last and lose Elo.':'Leave this match? You will forfeit your seat and chips.'))return false;
    const ranked=!!snapshot?.ranked||rankedEntry;
    send({type:'leave'});resetView('Left room.');
    if(ranked){dropRankedHistory();showRankedMenu()}
    return true;
  }
  window.addEventListener('popstate',()=>{
    if(skipRankedPop){skipRankedPop=false;return}
    if(!token||!(snapshot?.ranked||rankedEntry))return;
    // Back out of a running Ranked match only after the same confirm as the Leave button; otherwise stay put.
    if(!leaveRoom())markRankedHistory();
  });
  function resetView(message){
    clearTimeout(retryTimer);clearInterval(pingTimer);clearInterval(clockTimer);closeBotPicker();
    if(socket){socket.onclose=null;socket.close()}
    clearInterval(queueTimer);socket=null;roomCode='';token='';rankedEntry=false;snapshot=null;wasPlaying=false;previousHand=0;roomHistory=[];roomChat=[];lastRecordedResult='';clearSession();
    const heading=document.querySelector('.crumb');if(heading)heading.textContent='TEXAS HOLD’EM';
    $('rooms').classList.remove('rivl-match-mode');$('roomLobby').hidden=true;$('roomEntry').hidden=false;$('roomFinder').hidden=false;status(message);startFinder();document.dispatchEvent(new Event('rivl:room'));
  }
  function connect(){
    clearTimeout(retryTimer);
    if(socket){socket.onclose=null;socket.close()}
    const ws=new WebSocket(API.replace(/^http/,'ws').replace(/\/$/,'')+'/ws/'+encodeURIComponent(roomCode));
    socket=ws;
    ws.onopen=()=>{retry=0;ws.send(JSON.stringify({type:'auth',token}));status(snapshot?.ranked||rankedEntry?'Connected to the Ranked queue':'Connected to room '+roomCode);clearInterval(pingTimer);pingTimer=setInterval(()=>{if(socket?.readyState===WebSocket.OPEN)socket.send('ping')},30000)};
    ws.onmessage=event=>{
      if(event.data==='pong')return;
      let message;try{message=JSON.parse(event.data)}catch{return}
      if(message.type==='state'){const before=snapshot;snapshot=message.state;keepPhotos(before,snapshot);if(snapshot.ranked)markRankedHistory();roomChat=Array.isArray(snapshot.chat)?snapshot.chat.slice(-40):[];isHost=!!message.isHost;clockOffset=(snapshot.serverNow||Date.now())-Date.now();render();document.dispatchEvent(new Event('rivl:room'))}
      else if(message.type==='chat')addChatMessage(message.message);
      else if(message.type==='freeroll'){resetView('');window.rivlFreeroll?.handle(message)}
      else if(message.type==='removed'){const ranked=!!snapshot?.ranked||rankedEntry,reason=message.reason||'You are no longer in that room.';resetView(reason);if(ranked){dropRankedHistory();showRankedMenu(reason)}}
      else if(message.error)status(message.error);
    };
    // Reconnect automatically with backoff; the saved token keeps the seat.
    ws.onclose=()=>{if(socket!==ws||!token)return;clearInterval(pingTimer);const wait=Math.min(15000,1000*2**retry++);status('Connection lost. Reconnecting…');retryTimer=setTimeout(connect,wait)};
  }
  let rankedSize=6;
  async function enter(kind){try{
    rankedEntry=kind==='ranked';
    if(kind==='ranked'&&!window.rivlAccount?.key())throw Error('Sign in on your Profile to play Ranked.');
    const name=safeName($(kind==='create'?'roomName':'joinName').value);
    window.rivlSetPlayerName?.(name);
    const code=kind==='join'?$('roomCodeInput').value.trim().toUpperCase():'';
    if(kind==='join'&&!/^[A-Z2-9]{6}$/.test(code))throw Error('Room codes are 6 letters and numbers.');
    const key=window.rivlAccount?.key()||undefined;
    const result=kind==='quick'?await request('/api/quickplay','POST',{name,key}):
      kind==='ranked'?await request('/api/ranked','POST',{key,size:rankedSize}):
      await request(kind==='create'?'/api/rooms':'/api/rooms/'+encodeURIComponent(code)+'/join','POST',{name,key,visibility:$('roomListPublic').checked?'public':'private'});
    roomCode=result.code;token=result.token;saveSession();if(kind==='ranked')show('rooms');connect();
  }catch(e){status(e.message);if(kind==='ranked')$('rankedSelectStatus').textContent=e.message;refreshCapacity()}}
  // Open tables: public rooms waiting for players. Refreshed only while this screen is on show.
  let lobbyTimer=null;
  function finderVisible(){return $('rooms').classList.contains('active')&&!$('roomEntry').hidden&&document.visibilityState==='visible'}
  async function refreshLobby(){
    if(!API||!finderVisible())return;
    try{
      const {rooms}=await request('/api/lobby');
      const list=$('lobbyList');list.replaceChildren();
      if(!rooms.length){list.innerHTML='<p class="muted">No open tables right now. Press Quick Play to open one, and others can join you.</p>';return}
      for(const r of rooms){
        const row=document.createElement('div');row.className='lobby-room';
        const label=document.createElement('span');label.textContent=`${r.host}'s table · ${r.humans} ${r.humans===1?'player':'players'}${r.players>r.humans?' + '+(r.players-r.humans)+' bots':''} · ${9-r.players} seats open`;
        const join=document.createElement('button');join.className='outline';join.textContent='JOIN';join.onclick=()=>{$('roomCodeInput').value=r.code;enter('join')};
        row.append(label,join);list.append(row);
      }
    }catch(e){$('lobbyList').textContent=e.message}
  }
  async function refreshCapacity(){
    if(!API)return;
    try{const s=await request('/api/status');const note=$('capacityNote');note.hidden=!s.busy;
      note.textContent=s.busy?'Online rooms are full for today and reopen at midnight UTC. Bot practice still works.':'';
      for(const id of ['createRoom','quickPlay'])$(id).disabled=s.busy}catch{}
  }
  function startFinder(){clearInterval(lobbyTimer);refreshLobby();refreshCapacity();lobbyTimer=setInterval(()=>finderVisible()?refreshLobby():null,15000)}
  document.querySelectorAll('.nav').forEach(n=>n.addEventListener('click',()=>{if(n.dataset.view!=='rooms')clearInterval(lobbyTimer)}));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&token&&socket?.readyState!==WebSocket.OPEN){retry=0;connect()}});
  $('openRooms').onclick=()=>{show('rooms');startFinder()};
  $('quickPlay').onclick=()=>enter('quick');
  $('createRoom').onclick=()=>enter('create');
  document.querySelectorAll('[data-ranked-count]').forEach(btn=>btn.addEventListener('click',()=>{rankedSize=Number(btn.dataset.rankedCount);enter('ranked')}));
  $('openRanked').onclick=()=>showRankedMenu();
  $('backFromRanked').onclick=()=>{show('play');$('rankedSelect').hidden=true;$('modeSelect').hidden=false};
  $('joinRoom').onclick=()=>enter('join');
  $('leaveRoom').onclick=leaveRoom;
  $('roomStart').onclick=()=>send({type:'startMatch'});
  $('roomFold').onclick=()=>send({type:'action',action:'fold'});
  $('roomCall').onclick=()=>send({type:'action',action:snapshot?.game?.legal?.check?'check':'call'});
  $('roomRaise').onclick=()=>{setRoomBet($('roomRaiseAmount').value);send({type:'action',action:'raise',amount:Number($('roomRaiseAmount').value)})};
  $('roomRaiseAmount').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('roomRaise').click()}});
  $('roomAllin').onclick=()=>send({type:'action',action:'allin'});
  $('roomExtend').onclick=()=>{$('roomExtend').disabled=true;send({type:'extend'})};
  $('roomNext').onclick=()=>{if(snapshot?.tourney){resetView('');show('freeroll');window.rivlFreeroll?.refresh();return}if(!snapshot?.ranked)return send({type:'newMatch'});send({type:'leave'});resetView('Finding your next Ranked match…');enter('ranked')};
  function setRoomBet(value){const l=snapshot?.game?.legal;if(!l)return;const first=5*Math.ceil(l.raiseToMin/5),last=5*Math.floor(l.raiseToMax/5);const raw=Number(value);const n=clamp(5*Math.round((Number.isFinite(raw)?raw:first)/5),first,last);$('roomRaiseAmount').value=n;$('roomRaiseSlider').value=n;window.rivlAmounts.raiseLabel($('roomAmountLabel'),n,snapshot?.game?.bigBlind);}
  $('roomRaiseAmount').addEventListener('input',e=>{const n=Number(e.target.value);if(Number.isFinite(n)){const l=snapshot?.game?.legal;if(l){const first=5*Math.ceil(l.raiseToMin/5),last=5*Math.floor(l.raiseToMax/5);$('roomRaiseSlider').value=clamp(5*Math.round(n/5),first,last)}window.rivlAmounts.raiseLabel($('roomAmountLabel'),e.target.value,snapshot?.game?.bigBlind);}});
  $('roomRaiseAmount').addEventListener('change',e=>setRoomBet(e.target.value));
  $('roomRaiseSlider').addEventListener('input',e=>setRoomBet(e.target.value));
  $('roomMinusBet').onclick=()=>setRoomBet(Number($('roomRaiseAmount').value)-5);
  $('roomPlusBet').onclick=()=>setRoomBet(Number($('roomRaiseAmount').value)+5);
  document.querySelectorAll('[data-room-bet]').forEach(button=>button.onclick=()=>{const l=snapshot?.game?.legal,g=snapshot?.game;if(!l||!g)return;const kind=button.dataset.roomBet;setRoomBet(kind==='min'?l.raiseToMin:kind==='all'?l.raiseToMax:kind==='half'?l.raiseToMin+Math.floor(g.pot/2):l.raiseToMin+g.pot)});

  $('roomPrivate').onclick=()=>send({type:'visibility',visibility:'private'});
  $('roomPublic').onclick=()=>send({type:'visibility',visibility:'public'});
  $('copyRoomCode').onclick=()=>navigator.clipboard?.writeText(roomCode).then(()=>status('Room code copied.'),()=>status('Room code: '+roomCode));
  function closeBotPicker(){ $('roomBotPicker').hidden=true;document.body.classList.remove('rivl-modal-open'); }
  function openBotPicker(){ $('roomBotPicker').hidden=false;document.body.classList.add('rivl-modal-open');$('roomBotPicker').querySelector('[data-level]')?.focus(); }
  $('cancelBotPicker').onclick=closeBotPicker;
  $('roomBotPicker').addEventListener('click',event=>{if(event.target===$('roomBotPicker'))closeBotPicker()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('roomBotPicker').hidden)closeBotPicker()});
  document.querySelectorAll('[data-level]').forEach(button=>button.onclick=()=>{send({type:'addBot',seat:selectedSeat,level:button.dataset.level});closeBotPicker()});
  // The Freeroll page seats players at their tournament table with a token the tournament hands out.
  window.rivlRooms={enter(code,seatToken){if(token&&socket){socket.onclose=null;socket.close()}roomCode=code;token=seatToken;snapshot=null;saveSession();show('rooms');status('Joining your freeroll table…');connect()},code:()=>roomCode,freeroll:()=>!!snapshot?.tourney,
    // The kind of table this player is seated at, for the player numbers heartbeat (account.js).
    mode:()=>roomCode&&snapshot?(snapshot.tourney?'freeroll':snapshot.ranked?'ranked':'casual'):'',
    // Friends can be invited to a casual room until its match starts (friends.js).
    casual:()=>!!snapshot&&!snapshot.ranked&&!snapshot.tourney&&!snapshot.started,
    // Accepting a friend's invite: leave any other room first, then take a seat at theirs.
    join(code){if(code===roomCode){show('rooms');return}if(token&&leaveRoom()===false)return;show('rooms');$('roomCodeInput').value=code;enter('join')}};
  // Resume a saved seat after a refresh or a closed tab.
  try{const saved=JSON.parse(stored(SESSION)||'null');if(API&&saved?.code&&saved?.token){roomCode=saved.code;token=saved.token;show('rooms');status('Rejoining room '+roomCode+'…');connect()}}catch{}
})();
