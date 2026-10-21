// Table extras shared by bot practice and online rooms: folded hands slide into a face-down discard pile
// near the centre of the table, every seat shows its stack in big blinds under the avatar, and the dealer button
// and blinds sit on the felt in front of their players.
(()=>{
  const tables=new WeakMap(),SHOWN=4;
  const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const pileFor=table=>{let el=table.querySelector(':scope>.muck-pile');if(!el){el=document.createElement('div');el.className='muck-pile';el.setAttribute('aria-hidden','true');table.appendChild(el)}return el};
  const back=()=>{const c=document.createElement('i');c.className='muck-card';return c};
  function draw(pile,n){
    pile.querySelectorAll(':scope>.muck-card:not(.muck-flyer)').forEach(c=>c.remove());
    for(let i=0;i<Math.min(n,SHOWN);i++){const c=back();c.style.setProperty('--i',i);pile.prepend(c)}
    pile.classList.toggle('has-cards',n>0);pile.dataset.count=n;
  }
  // folded: [{key, from: Element the cards leave from, cards?: Elements to fly face up (your own hand)}]
  function sync(table,hand,folded){
    if(!table)return;
    let s=tables.get(table);const ready=!!s;
    if(!s||s.hand!==hand){if(s)s.flyers.forEach(f=>f.remove());s={hand,seen:new Set(),landed:0,flyers:[]};tables.set(table,s);const oldPile=table.querySelector(':scope>.muck-pile');if(oldPile){oldPile.replaceChildren();oldPile.classList.remove('has-cards');oldPile.dataset.count='0';}}
    const pile=pileFor(table);
    for(const f of folded){
      if(s.seen.has(f.key))continue;
      s.seen.add(f.key);
      const from=f.from?.getBoundingClientRect();
      if(!ready||reduced()||!from||!from.width){s.landed++;continue}
      const to=pile.getBoundingClientRect(),dx=from.left+from.width/2-(to.left+to.width/2),dy=from.top+from.height/2-(to.top+to.height/2);
      const cards=f.cards?.length?f.cards.map(c=>{const n=c.cloneNode(true);n.classList.add('muck-flyer');return n}):[back(),back()];
      cards.forEach((c,j)=>{
        c.classList.add('muck-flyer');pile.appendChild(c);s.flyers.push(c);
        const anim=c.animate([{transform:`translate(-50%,-50%) translate(${dx+(j?14:-14)}px,${dy}px) rotate(0deg)`,opacity:1},{transform:`translate(-50%,-50%) rotate(${j?18:-12}deg) scale(.6)`,opacity:.25}],{duration:460,delay:j*60,easing:'cubic-bezier(.5,0,.75,0)',fill:'forwards'});
        anim.onfinish=()=>{c.remove();s.flyers=s.flyers.filter(x=>x!==c);if(j===cards.length-1&&tables.get(table)===s){s.landed++;draw(pile,s.landed)}};
      });
    }
    draw(pile,s.landed);
  }
  // Stack in big blinds, rounded down, in a tag centred under the seat's avatar.
  function bbCount(seat,avatar,stack,bigBlind){
    if(!seat)return;
    let tag=seat.querySelector(':scope>.bb-count');
    if(!bigBlind){tag?.remove();return}
    if(!tag){tag=document.createElement('i');tag.className='bb-count';seat.appendChild(tag)}
    tag.textContent=Math.floor(Math.max(0,stack)/bigBlind).toLocaleString()+' BB';
    tag.title=stack.toLocaleString()+' chips = '+(stack/bigBlind).toFixed(1)+' big blinds';
    if(avatar)tag.style.left=avatar.offsetLeft+avatar.offsetWidth/2+'px';
  }
  // Dealer button and blind markers: real discs on the felt in front of their player, between the player and the
  // board. Each marker is one element that glides from seat to seat as the button moves. Spots are tried outward
  // from the seat toward the board and nudged sideways; the closest one clear of the board, pot, discards and seats wins.
  const MARKERS=[['is-dealer','dealer','D'],['is-sb','sb','SB'],['is-bb','bb','BB']];
  const watched=new WeakSet();
  function markers(table){
    if(!table)return;
    if(!watched.has(table)&&window.ResizeObserver){watched.add(table);new ResizeObserver(()=>markers(table)).observe(table)}
    const t=table.getBoundingClientRect();
    if(!t.width)return;
    const ox=t.left+table.clientLeft,oy=t.top+table.clientTop,w=table.clientWidth,h=table.clientHeight;
    const box=r=>({l:r.left-ox,t:r.top-oy,r:r.right-ox,b:r.bottom-oy});
    const seen=el=>el&&el.getClientRects().length&&getComputedStyle(el).display!=='none';
    const union=bs=>bs.length?{l:Math.min(...bs.map(b=>b.l)),t:Math.min(...bs.map(b=>b.t)),r:Math.max(...bs.map(b=>b.r)),b:Math.max(...bs.map(b=>b.b))}:null;
    // A seat's box covers its pill, BB tag and any shown cards; your own spot covers your cards, clock and tag.
    const area=el=>{const parts=[...el.children].filter(c=>seen(c)&&!c.classList.contains('think-dots')).map(c=>box(c.getBoundingClientRect())).filter(b=>b.r>b.l);if(!el.classList.contains('myseat'))parts.push(box(el.getBoundingClientRect()));return union(parts)};
    const seats=[...table.querySelectorAll('.seat,.myseat')].filter(seen);
    const areas=new Map(seats.map(el=>[el,area(el)]));
        // The board box can be wider than its cards, so measure the cards themselves.
    const bb=union([...table.querySelectorAll('.community>*')].filter(seen).map(c=>box(c.getBoundingClientRect())))||{l:w/2,t:h/2,r:w/2,b:h/2};
    const cx=(bb.l+bb.r)/2,cy=(bb.t+bb.b)/2;
    const pad=(b,n)=>({l:b.l-n,t:b.t-n,r:b.r+n,b:b.b+n});
    // Board, pot, discard pile and other markers must stay clear. An empty discard pile is only a mild cost.
    const hard=[pad(bb,5),...[...table.querySelectorAll('.pot-chips>*,.pot-amount,.muck-pile.has-cards')].filter(seen).map(el=>pad(box(el.getBoundingClientRect()),3))];
    // Your own spot is several separate pieces (clock, cards, tag) with open felt between them.
    const pieces=el=>el.classList.contains('myseat')?[...el.children].filter(seen).map(c=>box(c.getBoundingClientRect())).filter(b=>b.r>b.l):[areas.get(el)];
    const soft=seats.flatMap(el=>pieces(el).filter(Boolean).map(b=>({el,...pad(b,3)})));
    // Bot practice draws revealed hands beside the seat rather than inside it.
    soft.push(...[...table.querySelectorAll('.bot-shown')].filter(seen).map(el=>pad(box(el.getBoundingClientRect()),3)));
    const emptyPile=[...table.querySelectorAll('.muck-pile:not(.has-cards)')].filter(seen).map(el=>box(el.getBoundingClientRect()));
    const overlap=(a,b)=>Math.max(0,Math.min(a.r,b.r)-Math.max(a.l,b.l))*Math.max(0,Math.min(a.b,b.b)-Math.max(a.t,b.t));
    const groups=new Map();
    for(const [cls,kind,label] of MARKERS){
      let el=table.querySelector(':scope>.table-marker.marker-'+kind);
      const seat=seats.find(s=>s.classList.contains(cls));
      if(!seat||!areas.get(seat)){el?.classList.remove('is-on');continue}
      if(!el){el=document.createElement('i');el.className='table-marker marker-'+kind;el.setAttribute('aria-hidden','true');el.innerHTML='<b>'+label+'</b>';table.appendChild(el)}
      if(!groups.has(seat))groups.set(seat,[]);
      groups.get(seat).push(el);
    }
    const placed=[];
    for(const [seat,els] of groups){
      const a=areas.get(seat),size=els[0].offsetWidth||34,gap=Math.round(size*.18),gw=els.length*size+(els.length-1)*gap,gh=size;
      // Your own spot is anchored on your cards; everyone else on their pill.
      const hole=seat.classList.contains('myseat')&&seen(seat.querySelector('.holecards'))?box(seat.querySelector('.holecards').getBoundingClientRect()):a;
      const sx=(hole.l+hole.r)/2,sy=(hole.t+hole.b)/2;
      let dx=cx-sx,dy=cy-sy;const len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;
      const near=(x,y,b)=>Math.hypot(Math.max(b.l-x,0,x-b.r),Math.max(b.t-y,0,y-b.b));
      const outside=b=>Math.max(0,2-b.l)+Math.max(0,2-b.t)+Math.max(0,b.r-w+2)+Math.max(0,b.b-h+2);
      // How far the line toward the board runs before it reaches the board: markers never go past it.
      const toBoard=Math.min(dx?Math.max(((dx>0?bb.l:bb.r)-sx)/dx,0):Infinity,dy?Math.max(((dy>0?bb.t:bb.b)-sy)/dy,0):Infinity);
      const others=[...areas].filter(([el,b])=>el!==seat&&b).map(([,b])=>b);
      // Score every spot on a fine grid around the seat. The closest clear spot on the board side of the seat
      // wins; when nothing is clear, brushing its own seat beats covering another seat, and covering the board
      // or pot is the last resort. A spot nearer another player than its own never wins.
      const cost=(x,y,b)=>{
        let n=hard.concat(placed).reduce((n,o)=>n+overlap(b,o),0)*40+outside(b)*size*40;
        for(const o of soft)n+=overlap(b,o)*8;
        for(const o of emptyPile)n+=overlap(b,o);
        const along=(x-sx)*dx+(y-sy)*dy,mine=near(x,y,a);
        if(along>toBoard)n+=(along-toBoard)*size*4;
        if(others.some(o=>near(x,y,o)<mine+size*.25))n+=size*size*6;
        // Stay on the felt, which is roughly the oval inside the table box.
        const ex=(x-w/2)/(w/2-gw/2),ey=(y-h/2)/(h/2-gh/2),oval=ex*ex+ey*ey;
        if(oval>1)n+=(Math.sqrt(oval)-1)*size*size*20;
        // Distance out from the seat's edge toward the board, and sideways off that line. Behind the seat's
        // front edge counts triple.
        const front=Math.abs(((dx>0?a.r:a.l)-sx)*dx)+Math.abs(((dy>0?a.b:a.t)-sy)*dy);
        const ahead=along-front,side=Math.abs((y-sy)*dx-(x-sx)*dy);
        const d=(ahead<0?-ahead*3:ahead)+side*.8;
        return n+d*d*.5;
      };
      const step=Math.max(3,size/5),R=size*3;
      let best=null,bestCost=Infinity;
      for(let y=a.t-R;y<=a.b+R;y+=step)for(let x=a.l-R;x<=a.r+R;x+=step){const b={l:x-gw/2,t:y-gh/2,r:x+gw/2,b:y+gh/2},c=cost(x,y,b);if(c<bestCost){best={x,y,b};bestCost=c}}
      placed.push(pad(best.b,3));
      els.forEach((el,i)=>{el.style.left=(best.x-gw/2+i*(size+gap)+size/2)+'px';el.style.top=best.y+'px';el.classList.add('is-on')});
    }
  }
  window.rivlTable={muck:sync,bbCount,markers};
})();
