// Records the page with Chrome's screencast at full device resolution, keeping each frame's timestamp.
const {chromium}=require('playwright');const fs=require('fs');
(async()=>{
  const [S,secs,start]=[process.argv[2],+process.argv[3],process.argv[4]||'1'];const one=process.argv[5]==='one';
  const dir=S+'/frames';fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir);
  const b=await chromium.launch({args:['--force-device-scale-factor=3']});
  const c=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const p=await c.newPage();p.on('pageerror',e=>console.log('ERR',e.message));
  await p.goto('http://localhost:8765/?clips='+start);await p.waitForSelector('#clipGo');await p.waitForTimeout(1500);
  const cdp=await c.newCDPSession(p);const list=[];let n=0;
  cdp.on('Page.screencastFrame',async f=>{const name=`f${String(n++).padStart(5,'0')}.jpg`;
    fs.writeFileSync(`${dir}/${name}`,Buffer.from(f.data,'base64'));list.push([name,f.metadata.timestamp]);
    cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId}).catch(()=>{})});
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:95,maxWidth:1170,maxHeight:2532,everyNthFrame:1});
  await p.waitForTimeout(1200);await p.tap('#clipGo');
  if(one){ // stop once the NEXT title card (or the closing card) is on screen
    await p.waitForTimeout(6000);
    await p.waitForFunction(n=>{const t=document.getElementById('clipTitle');return t&&!t.hidden&&!t.textContent.includes('HAND '+n+'')||(t&&!t.hidden&&/HAND \d/.test(t.textContent)&&!t.textContent.includes('HAND '+n+'FLOP')&&!new RegExp('HAND '+n+'(?!\\d)').test(t.textContent))},+start,{timeout:secs*1000,polling:100});
    await p.waitForTimeout(1300);
  } else await p.waitForTimeout(secs*1000);
  await cdp.send('Page.stopScreencast');
  const end=Date.now()/1000;let txt='';
  list.forEach(([nm,t],i)=>{const d=((list[i+1]?.[1]??end)-t);txt+=`file '${dir}/${nm}'\nduration ${Math.max(d,0.001).toFixed(4)}\n`});
  txt+=`file '${dir}/${list.at(-1)[0]}'\n`;fs.writeFileSync(S+'/frames.txt',txt);
  console.log(n,'frames');await b.close();
})();
