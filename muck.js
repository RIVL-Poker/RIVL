// Table extras shared by bot practice and online rooms: folded hands slide into a face-down discard pile
// near the centre of the table, and every seat shows its stack in big blinds under the avatar.
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
  window.rivlTable={muck:sync,bbCount};
})();
