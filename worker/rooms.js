/* RIVL room server — Cloudflare Worker + Durable Objects. Initial private hand dealing. */
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
      const data=await response.json();return json(response.ok?{...data,code}:data,response.status);
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

  publicState(token){
    const g=this.room.game,m=this.room.members[token];
    return {visibility:this.room.visibility,started:!!g,
      seats:this.room.seats.map(s=>s?{type:s.type,name:s.name,avatar:s.avatar,level:s.level,isHost:s.isHost}:null),
      game:g?{phase:g.phase,handNumber:g.handNumber,pot:g.pot,board:g.board,players:g.players.map(p=>({seat:p.seat,name:p.name,bot:p.bot,stack:p.stack,bet:p.bet,folded:p.folded,allIn:p.allIn,contribution:p.contribution})),
        holeCards:m?g.hands[m.seat]||null:null,turn:g.turn,deadline:g.deadline,currentBet:g.currentBet,minRaise:g.minRaise,smallBlind:g.smallBlind,bigBlind:g.bigBlind,dealer:g.dealer,
        winners:g.winners||[],result:g.result||'',legal:m?this.legal(m.seat):null}:null};
  }
  broadcast(){for(const [ws,token] of this.sockets)try{ws.send(JSON.stringify({type:'state',state:this.publicState(token),isHost:token===this.room.hostToken}))}catch{}}
  async save(){const g=this.room?.game;if(g?.phase==='showdown'&&g.result!=='Match complete'){g.nextHandAt ||= Date.now()+5000;await this.state.storage.setAlarm(g.nextHandAt)}await this.state.storage.put('room',this.room);this.broadcast()}
  next(seat,eligible){for(let n=1;n<=9;n++){const i=(seat+n)%9;if(eligible(i))return i}return -1}
  randomDeck(){
    const deck=[];for(const s of 'SHDC')for(const r of '23456789TJQKA')deck.push(r+s);
    for(let i=deck.length-1;i>0;i--){const b=new Uint32Array(1);crypto.getRandomValues(b);const j=Math.floor(b[0]/4294967296*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]]}return deck;
  }
  legal(seat){
    const g=this.room.game,p=g?.players.find(x=>x.seat===seat);
    if(!g||g.phase==='showdown'||g.turn!==seat||!p||p.folded||p.allIn)return null;
    const call=Math.min(p.stack,Math.max(0,g.currentBet-p.bet));
    return {call,check:call===0,raiseToMin:Math.min(p.bet+p.stack,g.currentBet+g.minRaise),raiseToMax:p.bet+p.stack,canRaise:p.stack>call&&!g.raiseLocked?.includes(seat),timeRemaining:Math.max(0,g.deadline-Date.now())};
  }
  startHand(previous){
    const old=previous||this.room.game;
    const participants=this.room.seats.flatMap((s,i)=>s?[{seat:i,name:s.name,bot:s.type==='bot',stack:old?.players.find(p=>p.seat===i)?.stack??1000,bet:0,contribution:0,folded:false,allIn:false}]:[]).filter(p=>p.stack>0);
    if(participants.length<2){if(old){old.phase='showdown';old.result='Match complete';old.turn=-1}return}
    const g={phase:'preflop',handNumber:(old?.handNumber||0)+1,pot:0,board:[],players:participants,hands:{},deck:this.randomDeck(),turn:-1,deadline:0,currentBet:0,minRaise:20,smallBlind:10,bigBlind:20,acted:[],raiseLocked:[],winners:[],result:'',dealer:-1};
    const alive=i=>participants.some(p=>p.seat===i);
    g.dealer=this.next(old?.dealer??8,alive);
    const sb=participants.length===2?g.dealer:this.next(g.dealer,alive);
    const bb=this.next(sb,alive);
    for(const p of participants)g.hands[p.seat]=[g.deck.pop(),g.deck.pop()];
    const blind=(seat,amount)=>{const p=participants.find(x=>x.seat===seat);const v=Math.min(p.stack,amount);p.stack-=v;p.bet+=v;p.contribution+=v;g.pot+=v;p.allIn=p.stack===0};
    blind(sb,g.smallBlind);blind(bb,g.bigBlind);
    g.currentBet=Math.max(...participants.map(p=>p.bet));
    this.room.game=g;this.room.started=true;
    g.turn=this.next(bb,i=>participants.some(p=>p.seat===i&&!p.folded&&!p.allIn));
    g.deadline=Date.now()+12000;
    this.autoAdvance();
  }
  handValue(cards){
    const rank=c=>'23456789TJQKA'.indexOf(c[0])+2;
    const score5=cs=>{
      const vals=cs.map(rank).sort((a,b)=>b-a),freq=new Map(),suits=cs.map(c=>c[1]);
      for(const v of vals)freq.set(v,(freq.get(v)||0)+1);
      const uniq=[...new Set(vals)],straight=arr=>{const v=arr.includes(14)?[...arr,1]:arr;for(let i=0;i<=v.length-5;i++)if(v[i]-v[i+4]===4)return v[i];return 0};
      const flush=suits.every(x=>x===suits[0]),st=straight(uniq);
      const groups=[...freq].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
      if(flush&&st)return [8,st];
      if(groups[0][1]===4)return [7,groups[0][0],groups[1][0]];
      if(groups[0][1]===3&&groups[1][1]>=2)return [6,groups[0][0],groups[1][0]];
      if(flush)return [5,...vals];
      if(st)return [4,st];
      if(groups[0][1]===3)return [3,groups[0][0],...groups.slice(1).map(x=>x[0]).sort((a,b)=>b-a)];
      if(groups[0][1]===2&&groups[1][1]===2)return [2,Math.max(groups[0][0],groups[1][0]),Math.min(groups[0][0],groups[1][0]),groups[2][0]];
      if(groups[0][1]===2)return [1,groups[0][0],...groups.slice(1).map(x=>x[0]).sort((a,b)=>b-a)];
      return [0,...vals];
    };
    let best=null;for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)for(let d=c+1;d<cards.length-1;d++)for(let e=d+1;e<cards.length;e++){
      const s=score5([cards[a],cards[b],cards[c],cards[d],cards[e]]);
      if(!best||this.compare(s,best)>0)best=s;
    }return best;
  }
  compare(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return d}return 0}
  finishHand(){
    const g=this.room.game;g.turn=-1;g.deadline=0;g.phase='showdown';
    const contenders=g.players.filter(p=>!p.folded);
    while(g.board.length<5){if(g.board.length===0||g.board.length===3||g.board.length===4)g.deck.pop();g.board.push(g.deck.pop())}
    const layers=[...new Set(g.players.map(p=>p.contribution).filter(Boolean))].sort((a,b)=>a-b);
    let previous=0;const awarded=new Map();
    for(const cap of layers){
      const contributors=g.players.filter(p=>p.contribution>=cap);
      const amount=(cap-previous)*contributors.length;previous=cap;
      const eligible=contenders.filter(p=>p.contribution>=cap);
      if(!eligible.length)continue;
      const scored=eligible.map(p=>({p,v:this.handValue([...g.hands[p.seat],...g.board])})).sort((a,b)=>this.compare(b.v,a.v));
      const winners=scored.filter(x=>this.compare(x.v,scored[0].v)===0).map(x=>x.p);
      const each=Math.floor(amount/winners.length);let remainder=amount%winners.length;
      for(const p of winners){const chips=each+(remainder-->0?1:0);p.stack+=chips;awarded.set(p.seat,(awarded.get(p.seat)||0)+chips)}
    }
    g.winners=[...awarded].map(([seat,amount])=>({seat,name:g.players.find(p=>p.seat===seat).name,amount}));
    g.result=g.winners.map(w=>w.name+' wins '+w.amount).join(' · ')||'Hand ended';
    g.pot=0;
  }
  endStreet(){
    const g=this.room.game;
    const alive=g.players.filter(p=>!p.folded);
    if(alive.length===1){alive[0].stack+=g.pot;g.winners=[{seat:alive[0].seat,name:alive[0].name,amount:g.pot}];g.result=alive[0].name+' wins '+g.pot+' (everyone folded)';g.pot=0;g.phase='showdown';g.turn=-1;g.deadline=0;return}
    if(g.phase==='river'||alive.filter(p=>!p.allIn).length<2){this.finishHand();return}
    g.deck.pop();const count=g.phase==='preflop'?3:1;
    for(let i=0;i<count;i++)g.board.push(g.deck.pop());
    g.phase=g.phase==='preflop'?'flop':g.phase==='flop'?'turn':'river';
    for(const p of g.players)p.bet=0;
    g.currentBet=0;g.minRaise=g.bigBlind;g.acted=[];g.raiseLocked=[];
    g.turn=this.next(g.dealer,i=>g.players.some(p=>p.seat===i&&!p.folded&&!p.allIn));
    g.deadline=Date.now()+12000;
  }
  applyAction(seat,action,amount){
    const g=this.room.game,p=g.players.find(x=>x.seat===seat),legal=this.legal(seat);
    if(!legal)throw Error('Not your turn');
    const call=Math.max(0,g.currentBet-p.bet);
    if(action==='fold')p.folded=true;
    else if(action==='check'){if(call)throw Error('Must call, raise, or fold')}
    else if(action==='call'||action==='allin'&&p.stack<=call){const v=Math.min(p.stack,call);p.stack-=v;p.bet+=v;p.contribution+=v;g.pot+=v}
    else if(action==='raise'||action==='allin'){
      if(!legal.canRaise)throw Error('Cannot raise');
      const target=action==='allin'?p.bet+p.stack:Number(amount);
      if(!Number.isInteger(target)||target<=g.currentBet||target>legal.raiseToMax)throw Error('Invalid raise amount');
      if(target<g.currentBet+g.minRaise&&target!==legal.raiseToMax)throw Error('Raise below minimum');
      const increment=target-g.currentBet,wasMin=g.minRaise;
      const v=target-p.bet;p.stack-=v;p.bet=target;p.contribution+=v;g.pot+=v;
      g.currentBet=target;
      if(increment>=wasMin){g.minRaise=increment;g.acted=[];g.raiseLocked=[]}
      else g.raiseLocked=[...new Set([...g.raiseLocked,...g.acted])];
    }else throw Error('Invalid action');
    if(p.stack===0)p.allIn=true;
    g.acted=[...new Set([...g.acted,seat])];
    const active=g.players.filter(x=>!x.folded&&!x.allIn);
    const alive=g.players.filter(x=>!x.folded);
    if(alive.length===1||active.every(x=>g.acted.includes(x.seat)&&x.bet===g.currentBet)||active.length===0){this.endStreet()}
    else{g.turn=this.next(seat,i=>active.some(p=>p.seat===i));g.deadline=Date.now()+12000}
    this.autoAdvance();
  }
  autoAdvance(){
    const g=this.room.game;if(!g||g.phase==='showdown')return;
    let guard=0;
    while(guard++<150){
      const alive=g.players.filter(p=>!p.folded),active=alive.filter(p=>!p.allIn);
      if(alive.length<2||active.length===0||active.length===1&&active[0].bet===g.currentBet){this.endStreet();if(g.phase==='showdown')break;continue}
      const p=g.players.find(x=>x.seat===g.turn);
      if(!p){this.endStreet();if(g.phase==='showdown')break;continue}
      if(!p.bot)break;
      const call=Math.max(0,g.currentBet-p.bet);
      const cards=g.hands[p.seat],ranks=cards.map(c=>'23456789TJQKA'.indexOf(c[0])+2);
      const strong=ranks[0]===ranks[1]||Math.max(...ranks)>=12;
      const risk=call/Math.max(1,p.stack);
      const action=call>0&&risk>.35&&!strong?'fold':call>0?'call':'check';
      this.applyBot(seatOr(p.seat),action);
      if(g.phase==='showdown')break;
    }
    function seatOr(v){return v}
    if(g.phase!=='showdown')this.state.storage.setAlarm(g.deadline).catch(()=>{});
  }
  applyBot(seat,action){
    const g=this.room.game,p=g.players.find(x=>x.seat===seat);
    if(action==='fold')p.folded=true;
    else if(action==='call'){const v=Math.min(p.stack,Math.max(0,g.currentBet-p.bet));p.stack-=v;p.bet+=v;p.contribution+=v;g.pot+=v}
    if(p.stack===0)p.allIn=true;
    g.acted=[...new Set([...g.acted,seat])];
    const active=g.players.filter(x=>!x.folded&&!x.allIn),alive=g.players.filter(x=>!x.folded);
    if(alive.length===1||active.every(x=>g.acted.includes(x.seat)&&x.bet===g.currentBet)||active.length===0)this.endStreet();
    else{g.turn=this.next(seat,i=>active.some(x=>x.seat===i));g.deadline=Date.now()+12000}
  }
  async alarm(){
    await this.load();const g=this.room?.game;if(!g)return;
    if(g.phase==='showdown'){if(g.result==='Match complete')return;if(Date.now()<(g.nextHandAt||0)){await this.state.storage.setAlarm(g.nextHandAt);return}this.startHand(g);await this.save();return}
    if(Date.now()<g.deadline-50){await this.state.storage.setAlarm(g.deadline);return}
    const p=g.players.find(x=>x.seat===g.turn);
    if(p){const legal=this.legal(p.seat);if(legal)this.applyAction(p.seat,legal.check?'check':'fold')}
    await this.save();
  }
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
      server.send(JSON.stringify({type:'state',state:this.publicState(token),isHost:token===room.hostToken}));
      server.addEventListener('message',async event=>{
        try{
          const msg=JSON.parse(event.data);if(msg.type==='action'){
            if(!room.started)throw Error('Match not started');
            const seat=room.members[token].seat;
            this.applyAction(seat,msg.action,msg.amount);
            await this.save();return;
          }
          if(msg.type==='nextHand'){
            if(token!==room.hostToken)throw Error('Host only');
            if(room.game?.phase!=='showdown')throw Error('Finish current hand first');
            this.startHand(room.game);await this.save();return;
          }
          if(token!==room.hostToken)throw Error('Host only');
          if(room.started)throw Error('Match already started');
          if(msg.type==='startMatch'){
            if(room.seats.filter(Boolean).length<2)throw Error('At least two players required');
            this.startHand();
          }else if(msg.type==='visibility'&&['private','public'].includes(msg.visibility))room.visibility=msg.visibility;
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
