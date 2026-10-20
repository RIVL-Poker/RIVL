// Casino chips: white 5, maroon 25, gold 100, black 500. The pot is drawn as a loose pile of overlapping chips
// that grows with the pot. The layout is seeded by the pot amount, so the same pot always draws the same pile.
(function(){
  const DENOMS=[{v:500,c:'black'},{v:100,c:'gold'},{v:25,c:'maroon'},{v:5,c:'white'}];
  const BREAK={black:['gold',5],gold:['maroon',4],maroon:['white',5]};
  function rng(seed){let s=(seed*2654435761)>>>0||1;return()=>{s^=s<<13;s>>>=0;s^=s>>17;s^=s<<5;s>>>=0;return s/4294967296}}
  // The colors that make up the pot: real change for the amount, with big chips broken into smaller ones
  // a few at a time until there are enough chips for the pile's size, so bigger pots look bigger and show more colors.
  function chipColors(amount){
    let left=Math.max(5,Math.round(amount/5)*5),chips=[];
    DENOMS.forEach(d=>{while(left>=d.v){chips.push(d.c);left-=d.v}});
    const want=Math.max(1,Math.min(26,Math.round(Math.sqrt(amount)*.6)));
    // Break whichever color the pile has most of, so the pot shows a mix of colors rather than one.
    const count=c=>chips.filter(x=>x===c).length;
    while(chips.length<want){
      const c=['black','gold','maroon'].filter(count).sort((a,b)=>count(b)-count(a))[0];if(!c)break;
      const [to,n]=BREAK[c];chips.splice(chips.indexOf(c),1,...Array(n).fill(to));
    }
    return chips.slice(0,30);
  }
  function pileHTML(amount){
    amount=Number(amount)||0;if(amount<=0)return '';
    const rand=rng(amount),chips=chipColors(amount);
    for(let i=chips.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[chips[i],chips[j]]=[chips[j],chips[i]]}
    const n=chips.length,layers=[];let rest=n;
    // Wide bottom layer, narrower layers resting on top of it.
    while(rest>0){const size=layers.length>=3?rest:Math.max(1,Math.ceil(rest*(layers.length?.62:.52)));layers.push(Math.min(size,rest));rest-=size}
    const spread=Math.min(1.9,.35+n*.075),placed=[];let k=0;
    layers.forEach((size,layer)=>{
      const rx=spread*(1-layer*.3),start=rand()*Math.PI*2;
      for(let i=0;i<size;i++){
        const a=start+i*Math.PI*2/size+(rand()-.5)*.6,r=size===1?rand()*.2:rx*(.5+rand()*.5);
        placed.push({c:chips[k++],layer,x:Math.cos(a)*r,y:Math.sin(a)*r*.45-layer*.26,rot:Math.round((rand()-.5)*24)});
      }
    });
    placed.sort((a,b)=>a.layer-b.layer||a.y-b.y);
    return placed.map(p=>`<i class="pile-chip chip-${p.c}" style="left:calc(50% + ${p.x.toFixed(2)}em);top:calc(62% + ${p.y.toFixed(2)}em);--r:${p.rot}deg"></i>`).join('');
  }
  window.rivlChips={pileHTML,chipColors};
})();
