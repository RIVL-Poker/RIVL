/* RIVL room lobby. A deployed Cloudflare Worker is required for shared rooms. */
(()=>{
  const $=id=>document.getElementById(id);
  const API=window.RIVL_ROOM_API||localStorage.getItem('rivlRoomApi')||'';
  let socket=null,roomCode='',token='',snapshot=null,selectedSeat=-1,isHost=false;
  const suit={S:'♠',H:'♥',D:'♦',C:'♣'};
  const pretty=c=>c?c[0]+suit[c[1]]:'🂠';
  let clockTimer=null;
  const status=message=>{$('roomStatus').textContent=message};
  const safeName=value=>(value||'Player').trim().slice(0,20)||'Player';
  const request=async(path,method='GET',body)=>{if(!API)throw Error('Room server not configured. Set window.RIVL_ROOM_API to your deployed Worker URL in index.html.');const response=await fetch(API.replace(/\/$/,'')+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Error(data.error||'Room server error');return data};
  function render(){
    if(!snapshot)return;
    $('roomEntry').hidden=true;$('roomLobby').hidden=false;$('roomCodeLabel').textContent=roomCode;
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
        const add=document.createElement('button');add.textContent='+';add.title=host?'Add a bot':'Waiting for player';add.disabled=!host;add.onclick=()=>{selectedSeat=i;$('roomBotPicker').hidden=false};el.append(add);
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
      const g=snapshot.game,me=g.players.find(p=>snapshot.game.holeCards&&p.name===($('roomName').value||'').trim());
      $('roomGamePhase').textContent='HAND '+g.handNumber+' · '+g.phase.toUpperCase()+' · BLINDS '+g.smallBlind+'/'+g.bigBlind;
      $('roomHoleCards').textContent=g.holeCards?g.holeCards.map(pretty).join('    '):'Spectating';
      $('roomBoard').textContent=g.board.map(pretty).join('    ')||'Waiting for the flop';
      $('roomPot').textContent='POT · '+g.pot+' CHIPS';
      $('roomGamePlayers').replaceChildren();
      for(const p of g.players){
        const item=document.createElement('div');
        item.className='rivl-live-seat'+(p.seat===g.turn?' is-turn':'')+(p.folded?' is-folded':'');
        item.textContent=(p.seat===g.dealer?'Ⓓ ':'')+p.name+' · '+p.stack+' chips'+(p.bet?' · bet '+p.bet:'')+(p.folded?' · FOLDED':p.allIn?' · ALL IN':'')+(p.seat===g.turn?' ◀ TURN':'');
        $('roomGamePlayers').append(item);
      }
      $('roomWinner').textContent=g.result||'';
      $('roomNext').hidden=!isHost||g.phase!=='showdown';
      const l=g.legal;
      $('roomActions').hidden=!l;
      if(l){
        $('roomCall').textContent=l.call?'CALL '+l.call:'CHECK';
        $('roomRaise').disabled=!l.canRaise;
        $('roomAllin').disabled=!l.canRaise&&l.raiseToMax>l.call;
        const amount=$('roomRaiseAmount');
        amount.min=l.raiseToMin;amount.max=l.raiseToMax;
        if(Number(amount.value)<l.raiseToMin||Number(amount.value)>l.raiseToMax)amount.value=l.raiseToMin;
        $('roomBetInfo').textContent='Raise to '+l.raiseToMin+'–'+l.raiseToMax+' chips · 12-second turn';
      }
      clearInterval(clockTimer);
      const tick=()=>{
        const ms=Math.max(0,g.deadline-Date.now()),percent=Math.min(100,ms/120);
        $('roomTimer').style.background='conic-gradient(#dc5555 '+(100-percent)+'%, #52bd76 0)';
        $('roomTimerText').textContent=g.phase==='showdown'?'HAND OVER':g.turn<0?'WAITING':Math.ceil(ms/1000)+'s';
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
  $('leaveRoom').onclick=()=>{socket?.close();socket=null;roomCode='';token='';snapshot=null;$('roomLobby').hidden=true;$('roomEntry').hidden=false;status('Left room.')};
  $('roomStart').onclick=()=>send({type:'startMatch'});
  $('roomFold').onclick=()=>send({type:'action',action:'fold'});
  $('roomCall').onclick=()=>send({type:'action',action:snapshot?.game?.legal?.check?'check':'call'});
  $('roomRaise').onclick=()=>send({type:'action',action:'raise',amount:Number($('roomRaiseAmount').value)});
  $('roomAllin').onclick=()=>send({type:'action',action:'allin'});
  $('roomNext').onclick=()=>send({type:'nextHand'});
  $('roomPrivate').onclick=()=>send({type:'visibility',visibility:'private'});
  $('roomPublic').onclick=()=>send({type:'visibility',visibility:'public'});
  $('copyRoomCode').onclick=()=>navigator.clipboard?.writeText(roomCode).then(()=>status('Room code copied.'),()=>status('Room code: '+roomCode));
  $('cancelBotPicker').onclick=()=>$('roomBotPicker').hidden=true;
  document.querySelectorAll('[data-level]').forEach(button=>button.onclick=()=>{send({type:'addBot',seat:selectedSeat,level:button.dataset.level});$('roomBotPicker').hidden=true});
})();
