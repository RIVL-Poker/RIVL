/* RIVL room lobby. A deployed Cloudflare Worker is required for shared rooms. */
(()=>{
  const $=id=>document.getElementById(id);
  const API=window.RIVL_ROOM_API||localStorage.getItem('rivlRoomApi')||'';
  let socket=null,roomCode='',token='',snapshot=null,selectedSeat=-1,isHost=false;
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
    $('roomStart').textContent=occupied<2?'NEED 2 PLAYERS':'START MATCH — GAMEPLAY COMING NEXT';
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
    roomCode=result.code;token=result.token;connect();
  }catch(e){status(e.message)}}
  $('openRooms').onclick=()=>show('rooms');
  $('createRoom').onclick=()=>enter('create');
  $('joinRoom').onclick=()=>enter('join');
  $('leaveRoom').onclick=()=>{socket?.close();socket=null;roomCode='';token='';snapshot=null;$('roomLobby').hidden=true;$('roomEntry').hidden=false;status('Left room.')};
  $('roomPrivate').onclick=()=>send({type:'visibility',visibility:'private'});
  $('roomPublic').onclick=()=>send({type:'visibility',visibility:'public'});
  $('copyRoomCode').onclick=()=>navigator.clipboard?.writeText(roomCode).then(()=>status('Room code copied.'),()=>status('Room code: '+roomCode));
  $('cancelBotPicker').onclick=()=>$('roomBotPicker').hidden=true;
  document.querySelectorAll('[data-level]').forEach(button=>button.onclick=()=>{send({type:'addBot',seat:selectedSeat,level:button.dataset.level});$('roomBotPicker').hidden=true});
})();
