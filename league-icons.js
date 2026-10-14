/* RIVL ranked league gemstones — small accessible, inline SVG emblems. */
(()=>{
 const NS='http://www.w3.org/2000/svg';
 const tiers={
  prospect:{name:'Prospect',base:'#aa744b',light:'#e6ae75',dark:'#5b392b',shape:'stone'},
  challenger:{name:'Challenger',base:'#b7c2d0',light:'#f5f8ff',dark:'#5b6a7e',shape:'stone'},
  elite:{name:'Elite',base:'#dfab32',light:'#fff1a6',dark:'#8c5716',shape:'stone'},
  master:{name:'Master',base:'#2376d6',light:'#8ce0ff',dark:'#143d90',shape:'gem'},
  grandmaster:{name:'Grandmaster',base:'#9656cc',light:'#e7adff',dark:'#512178',shape:'gem'},
  champion:{name:'Champion',base:'#d8223f',light:'#ff9caa',dark:'#750d26',shape:'gem'}
 };
 const path=(d,fill,opacity=1)=>{const e=document.createElementNS(NS,'path');e.setAttribute('d',d);e.setAttribute('fill',fill);e.setAttribute('opacity',opacity);return e};
 let serial=0;
 function gradient(defs,id,stops,x1='0%',y1='0%',x2='100%',y2='100%'){
  const g=document.createElementNS(NS,'linearGradient');g.setAttribute('id',id);
  for(const [attr,value] of Object.entries({x1,y1,x2,y2}))g.setAttribute(attr,value);
  for(const [offset,color] of stops){const stop=document.createElementNS(NS,'stop');stop.setAttribute('offset',offset);stop.setAttribute('stop-color',color);g.append(stop)}
  defs.append(g);return 'url(#'+id+')';
 }
 function icon(key){
  const t=tiers[key];if(!t)return null;
  const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 48 48');svg.setAttribute('aria-hidden','true');svg.classList.add('rivl-league-icon');
  const id='rivl-metal-'+(++serial),defs=document.createElementNS(NS,'defs');
  const metal=gradient(defs,id+'-body',[['0%',t.light],['19%',t.base],['38%',t.dark],['53%',t.light],['68%',t.base],['100%',t.dark]]);
  const bevel=gradient(defs,id+'-bevel',[['0%','#ffffff'],['24%',t.light],['55%',t.base],['100%',t.dark]],'10%','0%','85%','100%');
  const shadow=gradient(defs,id+'-shadow',[['0%',t.base],['50%',t.dark],['100%','#160e16']]);
  svg.append(defs);
  if(t.shape==='stone'){
   svg.append(path('M11 8 25 5 39 13 43 27 34 41 18 43 5 31 6 17Z',metal));
   svg.append(path('M11 8 25 5 28 19 18 25 6 17Z',bevel,.95));
   svg.append(path('M28 19 39 13 43 27 34 41 18 43 18 25Z',shadow,.76));
   svg.append(path('M18 25 28 19 34 41 18 43 5 31Z',metal,.92));
   svg.append(path('M12 11 24 8 19 13 9 20Z','#ffffff',.65));
  }else{
   svg.append(path('M14 5H34L44 17 40 30 24 45 8 30 4 17Z',metal));
   svg.append(path('M14 5 24 16 4 17Z M34 5 24 16 44 17Z',bevel,.94));
   svg.append(path('M4 17 24 16 15 28 8 30Z M44 17 24 16 33 28 40 30Z',shadow,.77));
   svg.append(path('M24 16 33 28 24 45 15 28Z',bevel,.8));
   svg.append(path('M8 30 15 28 24 45Z M40 30 33 28 24 45Z',shadow,.8));
   svg.append(path('M15 7H32L23 14Z','#ffffff',.64));
  }
  // Premium dual-layer gold setting, beveled to catch the light.
  const border=gradient(defs,id+'-gold',[['0%','#fff6d3'],['18%','#f3c66e'],['36%','#795019'],['55%','#ffe6a2'],['76%','#bf812b'],['100%','#fff2c4']]);
  const outer=t.shape==='stone'?'M11 3 26 1 42 10 47 27 36 45 17 47 1 33 2 16Z':'M12 2H36L47 16 43 32 24 48 5 32 1 16Z';
  const inner=t.shape==='stone'?'M11 8 25 5 39 13 43 27 34 41 18 43 5 31 6 17Z':'M14 5H34L44 17 40 30 24 45 8 30 4 17Z';
  const goldRim=path(outer,'none');goldRim.setAttribute('stroke',border);goldRim.setAttribute('stroke-width','3.4');goldRim.setAttribute('stroke-linejoin','miter');svg.append(goldRim);
  const darkInset=path(inner,'none');darkInset.setAttribute('stroke','#1c1010');darkInset.setAttribute('stroke-width','2.6');darkInset.setAttribute('stroke-linejoin','miter');svg.append(darkInset);
  const innerRim=path(inner,'none');innerRim.setAttribute('stroke',border);innerRim.setAttribute('stroke-width','1.2');innerRim.setAttribute('stroke-linejoin','miter');svg.append(innerRim);
  // Small highlights stay legible even when the badge is only 17px tall.
  for(const [x,y,r] of [[12,5,2.7],[39,13,1.7],[8,30,1.4]]){
   const shine=path('M'+(x-r)+' '+y+' H'+(x+r)+' M'+x+' '+(y-r)+' V'+(y+r),'none');
   shine.setAttribute('stroke','#fff9e9');shine.setAttribute('stroke-width',r>2?1.1:.75);shine.setAttribute('stroke-linecap','round');svg.append(shine);
  }
  return svg;
 }
 function decorate(element,key,{prepend=false}={}){
  if(!element)return;
  element.querySelectorAll(':scope > .rivl-league-icon').forEach(x=>x.remove());
  if(!tiers[key])return;
  const svg=icon(key);svg.setAttribute('data-league',key);
  if(prepend)element.prepend(svg);else element.append(svg);
  element.classList.add('rivl-league-name');element.title=tiers[key].name+' league';
 }
 window.rivlLeagueIcons={decorate,icon,tiers};
})();
