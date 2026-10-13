/* RIVL room server — Cloudflare Worker + Durable Objects. Lobby only.
   IMPORTANT: No poker hands are dealt or played here yet. */
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Content-Type':'application/json'};
    if(request.method==='OPTIONS')return new Response(null,{headers});
    const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(url.pathname==='/api/rooms'&&request.method==='POST'){
      const code=Array.from(crypto.getRandomValues(new Uint8Array(5)),n=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n%32]).join('');
      const id=env.ROOMS.idFromName(code);
      const stub=env.ROOMS.get(id);
      const response=await stub.fetch(new Request('https://room/create',{method:'POST',body:await request.text()}));
      return new Response(response.body,{status:response.status,headers});
    }
    const match=url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{5})\/join$/);
    if(match&&request.method==='POST'){
      const stub=env.ROOMS.get(env.ROOMS.idFromName(match[1]));
      const response=await stub.fetch(new Request('https://room/join',{method:'POST',body:await request.text()}));
      return new Response(response.body,{status:response.status,headers});
    }
    const ws=url.pathname.match(/^\/ws\/([A-Z2-9]{5})$/);
    if(ws&&request.headers.get('Upgrade')==='websocket'){
      return env.ROOMS.get(env.ROOMS.idFromName(ws[1])).fetch(new Request('https://room/ws?token='+encodeURIComponent(url.searchParams.get('token')||''),{headers:{Upgrade:'websocket'}}));
    }
    return json({error:'Not found'},404);
  }
};
const LEVELS={Beginner:['Mula','Blaze'],Intermediate:['Nash','Jett'],Advanced:['Rico','Luna'],Expert:['Nova','Ace']};
const ALIASES=['Vincent','Theo','Marcus','Ryder','Sterling','Jasper','Milo','Dante','Silas','Roman','Felix','Nico','Remy','Atlas','Cruz','Arlo','Miles','Luca','Orion','Knox','Hugo','Beck','Ellis','Zane','Bishop','Wilder','Mason','Cole','Reid','Ezra','Leo','Finn'];
const AVATARS=['♠','♥','♦','♣','🂡','🂱','🎩','🃏'];
const pick=array=>array[Math.floor(Math.random()*array.length)];
export class Room {
  constructor(state,env){this.state=state;this.env=env;this.sockets=new Map();this.room=null}
  async load(){if(!this.room)this.room=await this.state.storage.get('room')||null;return this.room}
  async save(){await this.state.storage.put('room',this.room);this.broadcast()}
  publicState(){return {visibility:this.room.visibility,seats:this.room.seats,hostToken:this.room.hostToken}}
  broadcast(){for(const [ws] of this.sockets)try{ws.send(JSON.stringify({type:'state',state:this.publicState()}))}catch{}}
  reply(body,status=200){return Response.json(body,{status})}
  async fetch(request){
    const path=new URL(request.url).pathname;
    const room=await this.load();
    if(path==='/create'&&request.method==='POST'){
      if(room)return this.reply({error:'Room code collision'},409);
      const {name}=await request.json();const token=crypto.randomUUID();
      this.room={hostToken:token,visibility:'private',seats:Array(9).fill(null),members:{[token]:{name:String(name||'Host').slice(0,20),seat:0}},started:false};
      this.room.seats[0]={type:'human',name:String(name||'Host').slice(0,20),avatar:'♠',isHost:true};
      await this.save();return this.reply({token});
    }
    if(!room)return this.reply({error:'Room not found'},404);
    if(path==='/join'&&request.method==='POST'){
      if(room.started)return this.reply({error:'Game already started'},409);
      if(room.visibility==='private'||room.visibility==='public'){} // code access works in either mode
      const seat=room.seats.findIndex(s=>s===null);
      if(seat<0)return this.reply({error:'Room is full'},409);
      const {name}=await request.json();const token=crypto.randomUUID();
      room.members[token]={name:String(name||'Guest').slice(0,20),seat};
      room.seats[seat]={type:'human',name:room.members[token].name,avatar:'♣',isHost:false};
      await this.save();return this.reply({token});
    }
    if(path==='/ws'){
      const token=new URL(request.url).searchParams.get('token');
      if(!room.members[token])return this.reply({error:'Unauthorized'},401);
      const pair=new WebSocketPair();const client=pair[0],server=pair[1];server.accept();this.sockets.set(server,token);
      server.send(JSON.stringify({type:'state',state:this.publicState()}));
      server.addEventListener('message',async event=>{
        try{
          const msg=JSON.parse(event.data);if(token!==room.hostToken)throw Error('Host only');
          if(room.started)throw Error('Match already started');
          if(msg.type==='visibility'&&['private','public'].includes(msg.visibility))room.visibility=msg.visibility;
          else if(msg.type==='addBot'){
            const seat=Number(msg.seat),level=String(msg.level);
            if(!Number.isInteger(seat)||seat<0||seat>8||room.seats[seat]||!LEVELS[level])throw Error('Invalid seat or skill level');
            const taken=new Set(room.seats.filter(Boolean).map(s=>s.name));
            const available=ALIASES.filter(name=>!taken.has(name));
            const name=available.length?pick(available):'Player'+crypto.randomUUID().slice(0,5);
            room.seats[seat]={type:'bot',name,avatar:pick(AVATARS),level,profile:pick(LEVELS[level])};
          }else if(msg.type==='removeBot'){
            const seat=Number(msg.seat);if(!Number.isInteger(seat)||seat<0||seat>8||room.seats[seat]?.type!=='bot')throw Error('Invalid bot seat');
            room.seats[seat]=null;
          }else throw Error('Unsupported action');
          await this.save();
        }catch(e){server.send(JSON.stringify({error:e.message}))}
      });
      server.addEventListener('close',()=>this.sockets.delete(server));
      return new Response(null,{status:101,webSocket:client});
    }
    return this.reply({error:'Not found'},404);
  }
}
