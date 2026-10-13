/* RIVL room lobby. A deployed Cloudflare Worker is required for shared rooms. */
(()=>{
  const $=id=>document.getElementById(id);
  const API=window.RIVL_ROOM_API||localStorage.getItem('rivlRoomApi')||'';
  let socket=null,roomCode='',token='',snapshot=null,selectedSeat=-1,isHost=false;
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
  const request=async(path,method='GET',body)=>{if(!API)throw Error('Room server not configured. Set window.RIVL_ROOM_API to your deployed Worker URL in index.html.');const response=await fetch(API.replace(/\/$/,'')+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Error(data.error||'Room server error');return data};
  function render(){
    if(!snapshot)return;
    $('roomEntry').hidden=true;$('roomLobby').hidden=false;$('roomCodeLabel').textContent=roomCode;
    const playing=!!snapshot.started&&!!snapshot.game;
    $('rooms').classList.toggle('rivl-match-mode',playing);
    if(playing&&!wasPlaying){window.scrollTo({top:0,behavior:'instant'});}
    wasPlaying=playing;
    const host=isHost;
    $('roomHostNotice').textContent=host?'You are the host. Add bots using +, remove bots, or switch visibility.':'Waiting for the host. Open seats are reserved for players joining.';
    $('roomPrivate').disabled=!host;$('roomPublic').disabled=!host;
    $('roomPrivate').className=snapshot.visibility==='private'?'gold':'outline';
    $('roomPublic').className=snapshot.visibility==='public'?'gold':'outline';
    const seats=$('roomSeats');seats.replaceChildren();
    snapshot.seats.forEach((seat,i)=>{
      const el=document.createElement('div');el.className='room-seat';
      if(seat){
        const avatar=document.createElement('div');avatar.className='room-avatar';avatar.textContent=seat.avatar||'♠';el.append(avatar);
        const name=document.createElement('strong');name.textContent=seat.name;el.append(name);
        const info=document.createElement('small');info.textContent=seat.type==='bot'?seat.level+' · Bot':seat.isHost?'Host · Human':'Human';el.append(info);
        if(host&&seat.type==='bot'){const remove=document.createElement('button');remove.className='room-remove';remove.textContent='REMOVE';remove.onclick=()=>send({type:'removeBot',seat:i});el.append(remove)}
      }else{
        const add=document.createElement('button');add.textContent='+';add.title=host?'Add a bot':'Waiting for player';add.disabled=!host;add.onclick=()=>{selectedSeat=i;openBotPicker()};el.append(add);
        const label=document.createElement('small');label.textContent='EMPTY · SEAT '+(i+1);el.append(label);
      }
      seats.append(el);
    });
    const occupied=snapshot.seats.filter(Boolean).length;
    $('roomStart').disabled=!host||occupied<2||!!snapshot.started;
    $('roomStart').textContent=snapshot.started?'MATCH IN PROGRESS':occupied<2?'NEED 2 PLAYERS':'START MATCH';
    const gameArea=$('roomGame');
    gameArea.hidden=!snapshot.game;
    if(snapshot.game){
      const g=snapshot.game;
      $('roomBlinds').textContent=g.smallBlind+' / '+g.bigBlind;
      $('roomGamePhase').textContent='HAND '+g.handNumber+' · '+g.phase.toUpperCase();
      const active=g.players.filter(p=>p&&!p.sittingOut);
      $('roomPlayerCount').textContent=active.length;
      const meSeat=snapshot.seats.findIndex(s=>s&&s.type!=='bot'&&s.name===(isHost?$('roomName').value:$('joinName').value).trim());
      const me=g.players.find(p=>p.seat===meSeat)||(g.players.find(p=>p.name===(isHost?$('roomName').value:$('joinName').value).trim()));
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
        const label=document.createElement('span');label.textContent=p.name+' · '+p.stack.toLocaleString()+(p.folded?' · FOLD':p.allIn?' · ALL IN':p.bet?' · BET '+p.bet:'')+(p.seat===g.turn?' ◀ TURN':'');
        item.append(avatar,label);seats.append(item);
      });
      $('roomWinner').textContent=g.result||'';
      $('roomNext').hidden=true;
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
      }else $('roomBetInfo').textContent=g.phase==='showdown'?'Hand complete':'Waiting for next turn';
      clearInterval(clockTimer);
      const tick=()=>{
        const ms=Math.max(0,g.deadline-Date.now()),percent=Math.min(100,ms/120);
        $('roomTimer').style.background='conic-gradient(#dc5555 '+(100-percent)+'%, #52bd76 0)';
        const sec=Math.ceil(ms/1000);if(g.turn===me?.seat&&sec<=5&&sec>0&&sec!==lastTick){pvpSound('tick');lastTick=sec}
        $('roomTimerText').textContent=g.phase==='showdown'?'DONE':g.turn<0?'WAIT':Math.ceil(ms/1000)+'s';
      };
      tick();clockTimer=setInterval(tick,200);
    }else clearInterval(clockTimer);
  }
  function send(message){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));else status('Connection lost. Rejoin the room.')}
  function connect(){
    if(socket)socket.close();
    const wsUrl=API.replace(/^http/,'ws').replace(/\/$/,'')+'/ws/'+encodeURIComponent(roomCode)+'?token='+encodeURIComponent(token);
    socket=new WebSocket(wsUrl);
    socket.onopen=()=>status('Connected to room '+roomCode);
    socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.type==='state'){snapshot=message.state;isHost=!!message.isHost;render()}else if(message.error)status(message.error)};
    socket.onclose=()=>status('Room connection closed. Refresh or rejoin.');
    socket.onerror=()=>status('Could not connect to room server.');
  }
  async function enter(kind){try{
    const name=safeName($(kind==='create'?'roomName':'joinName').value);
    const code=kind==='join'?$('roomCodeInput').value.trim().toUpperCase():'';
    const result=await request(kind==='create'?'/api/rooms':'/api/rooms/'+encodeURIComponent(code)+'/join','POST',{name});
    roomCode=kind==='join'?code:result.code;token=result.token;connect();
  }catch(e){status(e.message)}}
  $('openRooms').onclick=()=>show('rooms');
  $('createRoom').onclick=()=>enter('create');
  $('joinRoom').onclick=()=>enter('join');
  $('leaveRoom').onclick=()=>{closeBotPicker();socket?.close();socket=null;roomCode='';token='';snapshot=null;wasPlaying=false;$('rooms').classList.remove('rivl-match-mode');$('roomLobby').hidden=true;$('roomEntry').hidden=false;status('Left room.')};
  $('roomStart').onclick=()=>send({type:'startMatch'});
  $('roomFold').onclick=()=>send({type:'action',action:'fold'});
  $('roomCall').onclick=()=>send({type:'action',action:snapshot?.game?.legal?.check?'check':'call'});
  $('roomRaise').onclick=()=>send({type:'action',action:'raise',amount:Number($('roomRaiseAmount').value)});
  $('roomAllin').onclick=()=>send({type:'action',action:'allin'});
  $('roomNext').onclick=()=>send({type:'nextHand'});
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
})();
