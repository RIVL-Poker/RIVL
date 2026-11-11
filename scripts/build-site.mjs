// Copies the static site into dist/ so Cloudflare serves only public files (not the worker source or tests).
import {cpSync,existsSync,mkdirSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('..',import.meta.url),out=new URL('dist/',root);
const files=['index.html','style.css','phone-landscape.css','engine.js','rating.js','hand-stats.js','player-stats.js','player-stats.css','chips.js','muck.js','amounts.js','script.js','scripted-hands.js','bot-avatars.js','ladder-ui.js','rooms.js','table-themes.js','screen-modes.js','profile.js','account.js','login.js','welcome-support.js','league-icons.js','puzzle.js','training.js','potodds.js','potodds.css','pushfold-charts.js','pushfold.js','river.js','river.css','backroom.js','backroom-spots.js','friends.js','freeroll.js','freeroll-popup.js','banners.js','banners.css','install-app.js','clip-spots.js','clip-mode.js','clip-mode.css','privacy.html','terms.html','legal.css','stats.html','stats.css','stats.js','favicon.svg','apple-touch-icon.png','manifest.webmanifest','icons','sw.js','sounds','assets','training-bb.js','cbet.js'];
rmSync(out,{recursive:true,force:true});mkdirSync(out);
for(const f of files){const src=new URL(f,root);if(!existsSync(src))throw Error('Missing site file: '+f);cpSync(src,new URL(f,out),{recursive:true})}
// rivlpoker.com/adjarvis: the feature map page (adjarvis/index.html), with the screenshots and clip stills it shows from feature-map/.
for(const [f,to] of [['adjarvis/index.html','adjarvis/index.html'],['feature-map/shots','adjarvis/shots'],['feature-map/lib','adjarvis/lib']]){const src=new URL(f,root);if(!existsSync(src))throw Error('Missing site file: '+f);cpSync(src,new URL(to,out),{recursive:true})}
writeFileSync(new URL('_headers',out),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
/sw.js
  Cache-Control: no-cache
`);
// The installed app's offline copy: every site file except the big media (saved as it loads), the owner's stats page and the /adjarvis feature map.
// VERSION changes whenever any of them does, so phones pick up each deploy as one complete copy.
const skip=/^(sounds|assets|adjarvis)\/|^(stats\.(html|css|js)|sw\.js|_headers)$/;
const walk=dir=>readdirSync(new URL(dir,out),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+e.name+'/'):[dir+e.name]);
const core=walk('').filter(f=>!skip.test(f)).sort();
const hash=createHash('sha256');for(const f of core)hash.update(f+'\0').update(readFileSync(new URL(f,out)));
const sw=new URL('sw.js',out),version=hash.digest('hex').slice(0,12);
const urls=['/',...core.filter(f=>f!=='index.html').map(f=>'/'+f.split('/').map(encodeURIComponent).join('/'))];
writeFileSync(sw,readFileSync(sw,'utf8').replace("const VERSION='dev';",`const VERSION='${version}';`).replace("const CORE=['/'];",`const CORE=${JSON.stringify(urls)};`));
console.log('Built dist/ with',files.length,'entries');
