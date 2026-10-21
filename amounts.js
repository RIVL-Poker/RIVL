// Bets and the pot can be shown in chips or in big blinds. The choice is remembered in this browser and applies to
// bot practice and every online table (Ranked, Casual, freeroll). Stacks, bets and the pot all follow it; the BB tag
// under each avatar always stays in big blinds. Tapping the pot readout on the table switches it.
(()=>{
  const KEY='rivlAmountUnit',listeners=new Set();
  let unit='chips';try{if(localStorage.getItem(KEY)==='bb')unit='bb'}catch{}
  // Whole big blinds read as "3 BB"; anything smaller than 100 keeps one decimal, so a 45 bet at 30 reads "1.5 BB".
  const bbText=(chips,bigBlind)=>{const v=chips/bigBlind,r=v>=100?Math.round(v):Math.round(v*10)/10;return r.toLocaleString()+'\u00a0BB'};
  function fmt(chips,bigBlind){chips=Math.max(0,Number(chips)||0);return unit==='bb'&&bigBlind>0?bbText(chips,bigBlind):chips.toLocaleString()}
  // With a unit word, for places that read "1,000 chips" in chip mode.
  const fmtUnit=(chips,bigBlind)=>fmt(chips,bigBlind)+(unit==='bb'&&bigBlind>0?'':' chips');
  function paint(){
    for(const b of document.querySelectorAll('.pot-amount')){
      b.setAttribute('aria-label','Pot '+b.querySelector('b').textContent+'. Show amounts in '+(unit==='bb'?'chips':'big blinds'));
      b.querySelectorAll('[data-unit]').forEach(s=>s.classList.toggle('is-on',s.dataset.unit===unit));
    }
  }
  function set(next){unit=next==='bb'?'bb':'chips';try{localStorage.setItem(KEY,unit)}catch{}paint();listeners.forEach(f=>{try{f(unit)}catch{}})}
  document.addEventListener('click',e=>{if(e.target.closest?.('.pot-amount'))set(unit==='bb'?'chips':'bb')});
  window.rivlAmounts={unit:()=>unit,fmt,fmtUnit,set,paint,onChange:f=>listeners.add(f)};
})();
