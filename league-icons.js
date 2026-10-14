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
 function icon(key){
  const t=tiers[key];if(!t)return null;
  const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 48 48');svg.setAttribute('aria-hidden','true');svg.classList.add('rivl-league-icon');
  if(t.shape==='stone'){
   svg.append(path('M11 8 25 5 39 13 43 27 34 41 18 43 5 31 6 17Z',t.base));
   svg.append(path('M11 8 25 5 28 19 18 25 6 17Z',t.light,.78));
   svg.append(path('M28 19 39 13 43 27 34 41 18 43 18 25Z',t.dark,.54));
   svg.append(path('M18 25 28 19 34 41 18 43 5 31Z',t.base,.86));
  }else{
   svg.append(path('M14 5H34L44 17 40 30 24 45 8 30 4 17Z',t.base));
   svg.append(path('M14 5 24 16 4 17Z M34 5 24 16 44 17Z',t.light,.8));
   svg.append(path('M4 17 24 16 15 28 8 30Z M44 17 24 16 33 28 40 30Z',t.dark,.64));
   svg.append(path('M24 16 33 28 24 45 15 28Z',t.light,.53));
   svg.append(path('M8 30 15 28 24 45Z M40 30 33 28 24 45Z',t.dark,.75));
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
