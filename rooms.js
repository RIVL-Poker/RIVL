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
  const cardNode=(code,back=false)=>{const el=document.createElement('div');el.className='card'+(back?' back':'')+(code&&/[HD]$/.test(code)?' red':'');el.textContent=back?'♠':pretty(code);return el};
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  let clockTimer=null,previousHand=0,previousBoard=[],previousTurn=-1,previousPhase='',lastTick=-1;
  function pvpSound(kind){const files={card:'card.wav',chip:'chips.wav',tick:'tick.wav',win:'pot.wav'};if(!files[kind])return;const a=new Audio('sounds/'+files[kind]);a.volume=kind==='tick'?.16:.28;a.play().catch(()=>{})}
  function animatedCard(code,back,delay=0){const el=cardNode(code,back);if(delay){el.classList.add('rivl-deal-in');el.style.animationDelay=delay+'ms'}return el}
  let wasPlaying=false;
  const status=message=>{$('roomStatus').textContent=message};
  const safeName=value=>(value||'Player').trim().slice(0,20)||'Player';
  const request=async(path,method='GET',body)=>{if(!API)throw Error('Online rooms need the site to be opened from its web address, not as a local file.');const response=await fetch(API.replace(/\/$/,'')+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json().catch(()=>({error:'Room server unavailable ('+response.status+')'}));if(!response.ok)throw Error(data.error||'Room server error');return data};
  function render(){
    if(!snapshot)return;
    $('roomEntry').hidden=true;$('roomFinder').hidden=true;$('capacityNote').hidden=true;$('roomLobby').hidden=false;$('roomCodeLabel').textContent=roomCode;
    const playing=!!snapshot.started&&!!snapshot.game;
    $('rooms').classList.toggle('rivl-match-mode',playing);
    if(playing&&!wasPlaying){window.scrollTo({top:0,behavior:'instant'});}
    wasPlaying=playing;
    const host=isHost;
    $('roomHostNotice').textContent=(host?'You are the host. Add bots using +, remove bots, or switch visibility. Public rooms appear in Open Tables.':'Waiting for the host to start.')+(snapshot.rated?' This match will be rated.':' Rated when 2+ signed-in players are seated.');
    $('roomPrivate').disabled=!host;$('roomPublic').disabled=!host;
    $('roomPrivate').className=snapshot.visibility==='private'?'gold':'outline';
    $('roomPublic').className=snapshot.visibility==='public'?'gold':'outline';
    const seats=$('roomSeats');seats.replaceChildren();
    snapshot.seats.forEach((seat,i)=>{
      const el=document.createElement('div');el.className='room-seat';
      if(seat){
        const avatar=document.createElement('div');avatar.className='room-avatar';avatar.textContent=seat.avatar||'♠';el.append(avatar);
        const name=document.createElement('strong');name.textContent=seat.name;if(seat.verified){const v=document.createElement('span');v.className='verified-badge';v.title='Signed-in player';v.textContent='✓';name.append(v)}el.append(name);
        const info=document.createElement('small');info.textContent=(seat.type==='bot'?seat.level+' · Bot':seat.isHost?'Host · Human':'Human')+(i===snapshot.mySeat?' · You':'');el.append(info);
        if(!seat.online){el.classList.add('is-offline');const off=document.createElement('small');off.className='room-offline';off.textContent='Reconnecting…';el.append(off)}
        if(host&&seat.type==='human'&&i!==snapshot.mySeat&&!lobbyLocked()){const kick=document.createElement('button');kick.className='room-remove';kick.textContent='REMOVE';kick.onclick=()=>send({type:'removePlayer',seat:i});el.append(kick)}
        if(host&&seat.type==='bot'&&!lobbyLocked()){const remove=document.createElement('button');remove.className='room-remove';remove.textContent='REMOVE';remove.onclick=()=>send({type:'removeBot',seat:i});el.append(remove)}
      }else{
        const add=document.createElement('button');add.textContent='+';add.title=host?'Add a bot':'Waiting for player';add.disabled=!host||lobbyLocked();add.onclick=()=>{selectedSeat=i;openBotPicker()};el.append(add);
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
      $('roomMode').textContent=snapshot.rated?'PVP · RATED':'PVP · UNRATED';
      $('roomGamePhase').textContent='HAND '+g.handNumber+' · '+g.phase.toUpperCase();
      const active=g.players.filter(p=>p&&!p.sittingOut);
      $('roomPlayerCount').textContent=active.length;
      const me=g.players.find(p=>p.seat===snapshot.mySeat);
      const opponents=g.players.filter(p=>p&&(!me||p.seat!==me.seat));
      $('roomMyName').textContent=me?.name||'Spectator';
      $('roomMyAvatar').textContent=(me?.name||'P').slice(0,1).toUpperCase();
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
        item.className='seat rivl-pvp-seat s'+(i+1)+(p.seat===g.turn?' is-turn':'')+(p.folded?' is-folded':'');
        const avatar=document.createElement('div');avatar.className='avatar';avatar.textContent=(p.name||'P').slice(0,1).toUpperCase();
        const label=document.createElement('span');label.textContent=p.name+' · '+p.stack.toLocaleString()+(p.left?' · LEFT':p.away?' · AWAY':'')+(p.folded?' · FOLD':p.allIn?' · ALL IN':p.bet?' · BET '+p.bet:'')+(p.seat===g.turn?' ◀ TURN':'');
        item.append(avatar,label);
        const cards=g.shown?.[p.seat];
        if(cards){const shown=document.createElement('span');shown.className='rivl-shown';cards.forEach(c=>shown.append(cardNode(c)));item.append(shown)}
        seats.append(item);
      });
      $('roomWinner').textContent=g.result||'';
      $('roomNext').hidden=!(g.matchOver&&host);
      if(g.matchOver){const best=[...g.players].sort((a,b)=>b.stack-a.stack)[0];$('roomWinner').textContent='Match complete · '+best.name+' wins the table'}
      const ratings=$('roomRatings');ratings.replaceChildren();
      if(g.matchOver&&(g.ratingChanges?.length||g.note)){
        for(const c of g.ratingChanges||[]){const line=document.createElement('div'),d=c.after-c.before;line.textContent=`${c.name}: ${c.before} → ${c.after} `;const delta=document.createElement('span');delta.className=d>=0?'up':'down';delta.textContent=(d>=0?'+':'')+d;line.append(delta);ratings.append(line)}
        if(g.note){const n=document.createElement('p');n.className='muted';n.textContent=g.note;ratings.append(n)}
      }
      const l=g.legal;
      $('roomActions').hidden=!l;
      if(l){
        $('roomCall').textContent=l.call?'CALL '+l.call:'CHECK';
        $('roomRaise').disabled=!l.canRaise;
        $('roomAllin').disabled=!l.canRaise&&l.raiseToMax>l.call;
        const amount=$('roomRaiseAmount'),slider=$('roomRaiseSlider');
        amount.min=slider.min=l.raiseToMin;amount.max=slider.max=l.raiseToMax;
        if(Number(amount.value)<l.raiseToMin||Number(amount.value)>l.raiseToMax)amount.value=l.raiseToMin;
        slider.value=amount.value;$('roomAmountLabel').textContent=amount.value;
        $('roomBetInfo').textContent='Raise to '+l.raiseToMin+'–'+l.raiseToMax+' chips · 12-second turn';
      }else $('roomBetInfo').textContent=g.matchOver?(host?'Start a rematch or go back to the lobby':'Waiting for the host'):me?.away?'You were sitting out. Act on your next turn to rejoin play.':g.phase==='showdown'?'Next hand starts shortly':'Waiting for next turn';
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
  function lobbyLocked(){return !!snapshot?.game&&!snapshot.game.matchOver}
  function send(message){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));else status('Reconnecting to the room…')}
  function resetView(message){
    clearTimeout(retryTimer);clearInterval(pingTimer);clearInterval(clockTimer);closeBotPicker();
    if(socket){socket.onclose=null;socket.close()}
    socket=null;roomCode='';token='';snapshot=null;wasPlaying=false;previousHand=0;clearSession();
    $('rooms').classList.remove('rivl-match-mode');$('roomLobby').hidden=true;$('roomEntry').hidden=false;$('roomFinder').hidden=false;status(message);startFinder();
  }
  function connect(){
    clearTimeout(retryTimer);
    if(socket){socket.onclose=null;socket.close()}
    const ws=new WebSocket(API.replace(/^http/,'ws').replace(/\/$/,'')+'/ws/'+encodeURIComponent(roomCode));
    socket=ws;
    ws.onopen=()=>{retry=0;ws.send(JSON.stringify({type:'auth',token}));status('Connected to room '+roomCode);clearInterval(pingTimer);pingTimer=setInterval(()=>{if(socket?.readyState===WebSocket.OPEN)socket.send('ping')},30000)};
    ws.onmessage=event=>{
      if(event.data==='pong')return;
      let message;try{message=JSON.parse(event.data)}catch{return}
      if(message.type==='state'){snapshot=message.state;isHost=!!message.isHost;clockOffset=(snapshot.serverNow||Date.now())-Date.now();render()}
      else if(message.type==='removed')resetView(message.reason||'You are no longer in that room.');
      else if(message.error)status(message.error);
    };
    // Reconnect automatically with backoff; the saved token keeps the seat.
    ws.onclose=()=>{if(socket!==ws||!token)return;clearInterval(pingTimer);const wait=Math.min(15000,1000*2**retry++);status('Connection lost. Reconnecting…');retryTimer=setTimeout(connect,wait)};
  }
  async function enter(kind){try{
    const name=safeName($(kind==='create'?'roomName':'joinName').value);
    window.rivlSetPlayerName?.(name);
    const code=kind==='join'?$('roomCodeInput').value.trim().toUpperCase():'';
    if(kind==='join'&&!/^[A-Z2-9]{6}$/.test(code))throw Error('Room codes are 6 letters and numbers.');
    const key=window.rivlAccount?.key()||undefined;
    const result=kind==='quick'?await request('/api/quickplay','POST',{name,key}):
      await request(kind==='create'?'/api/rooms':'/api/rooms/'+encodeURIComponent(code)+'/join','POST',{name,key,visibility:$('roomListPublic').checked?'public':'private'});
    roomCode=result.code;token=result.token;saveSession();connect();
  }catch(e){status(e.message);refreshCapacity()}}
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
      note.textContent=s.busy?'Online play has used its free capacity for today, so new rooms are paused. Bot practice still works, and rooms open again after midnight UTC.':'';
      for(const id of ['createRoom','quickPlay'])$(id).disabled=s.busy}catch{}
  }
  function startFinder(){clearInterval(lobbyTimer);refreshLobby();refreshCapacity();lobbyTimer=setInterval(()=>finderVisible()?refreshLobby():null,15000)}
  document.querySelectorAll('.nav').forEach(n=>n.addEventListener('click',()=>{if(n.dataset.view!=='rooms')clearInterval(lobbyTimer)}));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&token&&socket?.readyState!==WebSocket.OPEN){retry=0;connect()}});
  $('openRooms').onclick=()=>{show('rooms');startFinder()};
  $('quickPlay').onclick=()=>enter('quick');
  $('createRoom').onclick=()=>enter('create');
  $('joinRoom').onclick=()=>enter('join');
  $('leaveRoom').onclick=()=>{if(lobbyLocked()&&!confirm('Leave this match? You will forfeit your seat and chips.'))return;send({type:'leave'});resetView('Left room.')};
  $('roomStart').onclick=()=>send({type:'startMatch'});
  $('roomFold').onclick=()=>send({type:'action',action:'fold'});
  $('roomCall').onclick=()=>send({type:'action',action:snapshot?.game?.legal?.check?'check':'call'});
  $('roomRaise').onclick=()=>send({type:'action',action:'raise',amount:Number($('roomRaiseAmount').value)});
  $('roomAllin').onclick=()=>send({type:'action',action:'allin'});
  $('roomNext').onclick=()=>send({type:'newMatch'});
  function setRoomBet(value){const l=snapshot?.game?.legal;if(!l)return;const n=clamp(Math.round(Number(value)||l.raiseToMin),l.raiseToMin,l.raiseToMax);$('roomRaiseAmount').value=n;$('roomRaiseSlider').value=n;$('roomAmountLabel').textContent=n;}
  $('roomRaiseAmount').addEventListener('input',e=>{const n=Number(e.target.value);if(Number.isFinite(n)){$('roomRaiseSlider').value=n;$('roomAmountLabel').textContent=e.target.value;}});
  $('roomRaiseAmount').addEventListener('change',e=>setRoomBet(e.target.value));
  $('roomRaiseSlider').addEventListener('input',e=>setRoomBet(e.target.value));
  $('roomMinusBet').onclick=()=>setRoomBet(Number($('roomRaiseAmount').value)-1);
  $('roomPlusBet').onclick=()=>setRoomBet(Number($('roomRaiseAmount').value)+1);
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
