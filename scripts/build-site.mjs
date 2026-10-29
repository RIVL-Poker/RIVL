// Copies the static site into dist/ so Cloudflare serves only public files (not the worker source or tests).
import {cpSync,existsSync,mkdirSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('..',import.meta.url),out=new URL('dist/',root);
const files=['index.html','style.css','engine.js','rating.js','chips.js','muck.js','amounts.js','script.js','scripted-hands.js','bot-avatars.js','ladder-ui.js','rooms.js','table-themes.js','screen-modes.js','profile.js','account.js','login.js','welcome-support.js','league-icons.js','puzzle.js','training.js','backroom.js','backroom-spots.js','friends.js','freeroll.js','freeroll-popup.js','install-app.js','privacy.html','terms.html','legal.css','stats.html','stats.css','stats.js','favicon.svg','manifest.webmanifest','icons','sw.js','sounds','assets'];
rmSync(out,{recursive:true,force:true});mkdirSync(out);
for(const f of files){const src=new URL(f,root);if(!existsSync(src))throw Error('Missing site file: '+f);cpSync(src,new URL(f,out),{recursive:true})}
writeFileSync(new URL('_headers',out),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
/sw.js
  Cache-Control: no-cache
`);
// The installed app's offline copy: every site file except the big media (saved as it loads) and the owner's stats page.
// VERSION changes whenever any of them does, so phones pick up each deploy as one complete copy.
const skip=/^(sounds|assets)\/|^(stats\.(html|css|js)|sw\.js|_headers)$/;
const walk=dir=>readdirSync(new URL(dir,out),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+e.name+'/'):[dir+e.name]);
const core=walk('').filter(f=>!skip.test(f)).sort();
const hash=createHash('sha256');for(const f of core)hash.update(f+'\0').update(readFileSync(new URL(f,out)));
const sw=new URL('sw.js',out),version=hash.digest('hex').slice(0,12);
const urls=['/',...core.filter(f=>f!=='index.html').map(f=>'/'+f.split('/').map(encodeURIComponent).join('/'))];
writeFileSync(sw,readFileSync(sw,'utf8').replace("const VERSION='dev';",`const VERSION='${version}';`).replace("const CORE=['/'];",`const CORE=${JSON.stringify(urls)};`));
console.log('Built dist/ with',files.length,'entries');
