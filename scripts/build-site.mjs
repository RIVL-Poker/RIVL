// Copies the static site into dist/ so Cloudflare serves only public files (not the worker source or tests).
import {cpSync,existsSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
const root=new URL('..',import.meta.url),out=new URL('dist/',root);
const files=['index.html','style.css','engine.js','rating.js','chips.js','muck.js','amounts.js','script.js','ladder-ui.js','rooms.js','table-themes.js','screen-modes.js','profile.js','account.js','login.js','welcome-support.js','league-icons.js','puzzle.js','friends.js','freeroll.js','privacy.html','terms.html','legal.css','stats.html','stats.css','stats.js','favicon.svg','sounds','assets'];
rmSync(out,{recursive:true,force:true});mkdirSync(out);
for(const f of files){const src=new URL(f,root);if(!existsSync(src))throw Error('Missing site file: '+f);cpSync(src,new URL(f,out),{recursive:true})}
writeFileSync(new URL('_headers',out),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
`);
console.log('Built dist/ with',files.length,'entries');
