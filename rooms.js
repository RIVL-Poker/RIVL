/* RIVL private rooms client. The room server is served from the same origin as the site unless window.RIVL_ROOM_API overrides it. */
(()=>{
  const $=id=>document.getElementById(id);
  const stored=key=>{try{return localStorage.getItem(key)}catch{return null}};
  const API=window.RIVL_ROOM_API||stored('rivlRoomApi')||(/^https?:$/.test(location.protocol)?location.origin:'');
  const SESSION='rivlRoomSession';
  let socket=null,roomCode='',token='',snapshot=null,selectedSeat=-1,isHost=false,clockOffset=0,retry=0,retryTimer=null,pingTimer=null;
  const saveSession=()=>{try{localStorage.setItem(SESSION,JSON.stringify({code:roomCode,token}))}catch{}};
  const clearSession=()=>{try{localStorage.removeItem(SESSION)}catch{}};
  const suit={S:'♠',H:'♥',D:'♦',C:'♣'};
  const pretty=c=>c?c[0]+suit[c[1]]:'🂠';
  const cardNode=(code,back=false)=>{const el=document.createElement('div');el.className='card'+(back?' back':'')+(code&&/[HD]$/.test(code)?' red':'');if(back){el.textContent='♠';return el}if(!code)return el;const rank=document.createElement('strong');rank.textContent=code[0]==='T'?'10':code[0];const center=document.createElement('span');center.className='rivl-card-center';center.textContent=suit[code[1]];el.append(rank,center);return el};
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
  const paintSeatAvatar=(el,p)=>{const a=avatarFor(p);el.replaceChildren();if(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a)&&a.length<=45000){const img=document.createElement('img');img.src=a;img.alt='';img.className='rivl-avatar-photo';el.append(img)}else el.textContent=a};
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  let clockTimer=null,previousHand=0,previousBoard=[],previousTurn=-1,previousPhase='',lastTick=-1;
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
    if(roomTab==='stats'){target.textContent=g?.players?.map(p=>p.name+': '+p.stack.toLocaleString()+' chips'+(p.folded?' (folded)':'')).join(' • ')||'Waiting for match.';return}
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
    $('roomEntry').hidden=true;$('roomFinder').hidden=true;$('capacityNote').hidden=true;$('roomLobby').hidden=false;$('roomCodeLabel').textContent=snapshot.ranked?'· RANKED '+(snapshot.rankedMax||6)+' PLAYERS':roomCode;
    const playing=!!snapshot.started&&!!snapshot.game;
    const disclaimer=document.querySelector('.room-disclaimer');
    if(disclaimer)disclaimer.textContent=(snapshot.ranked?'Ranked':'Unranked')+' multiplayer · server-controlled betting · no real-money wagering. Your seat is kept if you refresh or lose connection.';
    const heading=document.querySelector('.crumb');
    if(heading)heading.textContent=playing?'TEXAS HOLD’EM · '+(snapshot.ranked?'RANKED':'UNRANKED')+' MULTIPLAYER':'TEXAS HOLD’EM · ONLINE ROOMS';
    $('rooms').classList.toggle('rivl-match-mode',playing);
    if(playing&&!wasPlaying){window.scrollTo({top:0,behavior:'instant'});}
    wasPlaying=playing;
    const host=isHost;
    $('roomHostNotice').textContent=snapshot.ranked?rankedQueueText():
      (host?'You are the host. Tap + to add a bot.':'Waiting for the host to start.');
    $('roomPrivate').disabled=!host;$('roomPublic').disabled=!host;
    // Ranked tables are matchmade: no visibility switch, no room code to share and no Start button.
    const visibilityRow=document.querySelector('.room-visibility');if(visibilityRow)visibilityRow.hidden=!!snapshot.ranked;
    $('roomStart').hidden=!!snapshot.ranked;
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
        const info=document.createElement('small');info.textContent=(seat.type==='bot'?seat.level+' · Bot':seat.isHost?'Host · Human':'Human')+(i===snapshot.mySeat?' · You':'');el.append(info);appendReport(el,seat);
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
      $('roomMode').textContent=snapshot.ranked?'PVP · RANKED':'PVP · UNRANKED';
      $('roomGamePhase').textContent='HAND '+g.handNumber+' · '+g.phase.toUpperCase();
      const active=g.players.filter(p=>p&&!p.sittingOut);
      $('roomPlayerCount').textContent=active.length;
      const me=g.players.find(p=>p.seat===snapshot.mySeat);
      const opponents=g.players.filter(p=>p&&(!me||p.seat!==me.seat));
      $('roomMyName').textContent=me?.name||'Spectator';
      paintSeatAvatar($('roomMyAvatar'),snapshot.seats[me?.seat]||me);$('roomMyAvatar').parentElement.classList.toggle('is-dealer',!!me&&me.seat===g.dealer);
      $('roomMyStack').textContent=(me?.stack??0).toLocaleString()+' chips';
      $('roomTimer').hidden=g.turn!==me?.seat||g.phase==='showdown';
      const newHand=g.handNumber!==previousHand;
      if(newHand){previousHand=g.handNumber;previousBoard=[];previousTurn=-1;lastTick=-1}
      const hole=$('roomHoleCards');
      if(newHand||hole.children.length!==2){
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
      const seats=$('roomGamePlayers');seats.replaceChildren();
      const count=Math.min(9,opponents.length+1);
      $('roomPokerTable').dataset.playerCount=String(count);
      opponents.forEach((p,i)=>{
        const item=document.createElement('div');
        item.className='seat rivl-pvp-seat s'+(i+1)+(p.seat===g.turn?' is-turn':'')+(p.folded?' is-folded':'')+(p.seat===g.dealer?' is-dealer':'');
        const avatar=document.createElement('div');avatar.className='avatar';paintSeatAvatar(avatar,snapshot.seats[p.seat]||p);
        const label=document.createElement('span');label.className='rivl-seat-label';const who=document.createElement('b');who.textContent=p.name;if(snapshot?.ranked&&p.id===window.rivlAccount?.current()?.id)window.rivlLeagueIcons?.decorate(who,window.rivlAccount.current().leagueKey||window.RivlRating?.tier(window.rivlAccount.current().rating).key,{prepend:true});const info=document.createElement('small');info.textContent=p.stack.toLocaleString()+(p.left?' · LEFT':p.away?' · AWAY':'')+(p.folded?' · FOLD':p.allIn?' · ALL IN':p.bet?' · BET '+p.bet:'')+(p.seat===g.turn?' ◀ TURN':'');label.append(who,info);
        item.append(avatar,label);appendReport(item,snapshot.seats[p.seat]);
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
      });
      if(g.result&&lastRecordedResult!==g.handNumber+':'+g.result){roomHistory.push('Hand '+g.handNumber+': '+g.result);if(roomHistory.length>100)roomHistory.shift();lastRecordedResult=g.handNumber+':'+g.result}
      renderRoomPanel();
      $('roomWinner').textContent=g.result||'';
      $('roomNext').hidden=!(g.matchOver&&(host||snapshot.ranked));
      $('roomNext').textContent=snapshot.ranked?'FIND NEXT RANKED MATCH':'BACK TO LOBBY';
      if(g.matchOver)recordMatch(g);
      if(g.matchOver){const best=g.players.filter(p=>!p.left).sort((a,b)=>b.stack-a.stack)[0];$('roomWinner').textContent=best?'Match complete · '+best.name+' wins the table':'Match complete'}
      const ratings=$('roomRatings');ratings.replaceChildren();
      if(g.matchOver&&(g.ratingChanges?.length||g.note)){
        for(const c of g.ratingChanges||[]){const line=document.createElement('div'),d=c.after-c.before;line.textContent=`${c.name}: ${c.before} → ${c.after} `;const delta=document.createElement('span');delta.className=d>=0?'up':'down';delta.textContent=(d>=0?'+':'')+d;line.append(delta);if(c.accuracy!=null)line.append(` · ${c.accuracy}% decision accuracy`);ratings.append(line)}
        if(g.note){const n=document.createElement('p');n.className='muted';n.textContent=g.note;ratings.append(n)}
      }
      const l=g.legal;
      $('roomActions').hidden=!l;
      if(l){
        $('roomCall').textContent=l.call?'CALL '+l.call:'CHECK';
        $('roomRaise').disabled=!l.canRaise;
        $('roomAllin').disabled=!l.canRaise&&l.raiseToMax>l.call;
        const amount=$('roomRaiseAmount'),slider=$('roomRaiseSlider');
        const first=5*Math.ceil(l.raiseToMin/5),last=5*Math.floor(l.raiseToMax/5);
        amount.min=slider.min=first;amount.max=slider.max=last;amount.step=slider.step=5;
        if(Number(amount.value)<first||Number(amount.value)>last||Number(amount.value)%5)amount.value=first;
        slider.value=amount.value;$('roomAmountLabel').textContent=amount.value;
        $('roomBetInfo').textContent='Raise to '+l.raiseToMin+'–'+l.raiseToMax+' chips · 12-second turn';
      }else $('roomBetInfo').textContent=g.matchOver?(snapshot.ranked?'Find your next Ranked match or go back to the lobby':host?'Start a rematch or go back to the lobby':'Waiting for the host'):me?.away?'You are sitting out. Act on your turn to rejoin.':g.phase==='showdown'?'Next hand starts shortly':'Waiting for next turn';
      clearInterval(clockTimer);
      const tick=()=>{
        const ms=Math.max(0,g.deadline-(Date.now()+clockOffset)),percent=Math.min(100,ms/120);
        $('roomTimer').style.background='conic-gradient(#dc5555 '+(100-percent)+'%, #52bd76 0)';
        const sec=Math.ceil(ms/1000);if(g.turn===me?.seat&&sec<=5&&sec>0&&sec!==lastTick){pvpSound('tick');lastTick=sec}
        $('roomTimerText').textContent=g.phase==='showdown'?'DONE':g.turn<0?'WAIT':Math.ceil(ms/1000)+'s';
      };
      tick();clockTimer=setInterval(tick,200);
    }else clearInterval(clockTimer);
  }
  let queueTimer=null,rankedEntry=false;
  function rankedQueueText(){
    const seated=snapshot.seats.filter(Boolean).length,max=snapshot.rankedMax||6;
    const wait=snapshot.startsAt?Math.max(0,Math.ceil((snapshot.startsAt-Date.now()-clockOffset)/1000)):0;
    const head=snapshot.started?'Ranked match.':seated<2?`Finding players… ${seated} of ${max} seated.`:`Starts in ${wait}s · ${seated} of ${max} seated.`;
    return head+' Leaving early places you last.';
  }
  function lobbyLocked(){return !!snapshot?.game&&!snapshot.game.matchOver}
  function send(message){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));else status('Reconnecting to the room…')}
  function resetView(message){
    clearTimeout(retryTimer);clearInterval(pingTimer);clearInterval(clockTimer);closeBotPicker();
    if(socket){socket.onclose=null;socket.close()}
    clearInterval(queueTimer);socket=null;roomCode='';token='';snapshot=null;wasPlaying=false;previousHand=0;roomHistory=[];roomChat=[];lastRecordedResult='';clearSession();
    const heading=document.querySelector('.crumb');if(heading)heading.textContent='TEXAS HOLD’EM';
    $('rooms').classList.remove('rivl-match-mode');$('roomLobby').hidden=true;$('roomEntry').hidden=false;$('roomFinder').hidden=false;status(message);startFinder();
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
      if(message.type==='state'){snapshot=message.state;roomChat=Array.isArray(snapshot.chat)?snapshot.chat.slice(-40):[];isHost=!!message.isHost;clockOffset=(snapshot.serverNow||Date.now())-Date.now();render()}
      else if(message.type==='chat')addChatMessage(message.message);
      else if(message.type==='removed')resetView(message.reason||'You are no longer in that room.');
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
  $('openRanked').onclick=()=>{show('play');$('modeSelect').hidden=true;$('playerSelect').hidden=true;$('rankedSelect').hidden=false;$('rankedSelectStatus').textContent=window.rivlAccount?.key()?'':'Sign in on your Profile to play Ranked.'};
  $('backFromRanked').onclick=()=>{show('play');$('rankedSelect').hidden=true;$('modeSelect').hidden=false};
  $('joinRoom').onclick=()=>enter('join');
  $('leaveRoom').onclick=()=>{if(lobbyLocked()&&!confirm(snapshot?.ranked?'Leave this Ranked match? You will place last and lose Elo.':'Leave this match? You will forfeit your seat and chips.'))return;send({type:'leave'});resetView('Left room.')};
  $('roomStart').onclick=()=>send({type:'startMatch'});
  $('roomFold').onclick=()=>send({type:'action',action:'fold'});
  $('roomCall').onclick=()=>send({type:'action',action:snapshot?.game?.legal?.check?'check':'call'});
  $('roomRaise').onclick=()=>{setRoomBet($('roomRaiseAmount').value);send({type:'action',action:'raise',amount:Number($('roomRaiseAmount').value)})};
  $('roomRaiseAmount').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('roomRaise').click()}});
  $('roomAllin').onclick=()=>send({type:'action',action:'allin'});
  $('roomNext').onclick=()=>{if(!snapshot?.ranked)return send({type:'newMatch'});send({type:'leave'});resetView('Finding your next Ranked match…');enter('ranked')};
  function setRoomBet(value){const l=snapshot?.game?.legal;if(!l)return;const first=5*Math.ceil(l.raiseToMin/5),last=5*Math.floor(l.raiseToMax/5);const raw=Number(value);const n=clamp(5*Math.round((Number.isFinite(raw)?raw:first)/5),first,last);$('roomRaiseAmount').value=n;$('roomRaiseSlider').value=n;$('roomAmountLabel').textContent=n;}
  $('roomRaiseAmount').addEventListener('input',e=>{const n=Number(e.target.value);if(Number.isFinite(n)){const l=snapshot?.game?.legal;if(l){const first=5*Math.ceil(l.raiseToMin/5),last=5*Math.floor(l.raiseToMax/5);$('roomRaiseSlider').value=clamp(5*Math.round(n/5),first,last)}$('roomAmountLabel').textContent=e.target.value;}});
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
  // Resume a saved seat after a refresh or a closed tab.
  try{const saved=JSON.parse(stored(SESSION)||'null');if(API&&saved?.code&&saved?.token){roomCode=saved.code;token=saved.token;show('rooms');status('Rejoining room '+roomCode+'…');connect()}}catch{}
})();
