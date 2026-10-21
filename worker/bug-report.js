/* Anonymous bug reports. The text a player submits is emailed from the support address to the
   support address through Cloudflare Email Routing (the BUG_REPORT_EMAIL send_email binding),
   so no player email, account or IP address is ever part of the report. */
export const BUG_CATEGORIES=['Gameplay','Ranked / Elo','Account','Matchmaking','Other'];
export const BUG_MIN_CHARS=10,BUG_MAX_CHARS=3000;

// Checks the submitted form and returns the report fields, or {error} with a message for the player.
export function cleanReport(body){
  const category=BUG_CATEGORIES.includes(body?.category)?body.category:'Other';
  const details=String(body?.details??'').replace(/\r\n?/g,'\n').trim();
  if(details.length<BUG_MIN_CHARS)return {error:'Please describe the issue in at least '+BUG_MIN_CHARS+' characters.'};
  if(details.length>BUG_MAX_CHARS)return {error:'Please keep the report under '+BUG_MAX_CHARS+' characters.'};
  const browser=String(body?.browser??'').replace(/[\r\n]+/g,' ').slice(0,300);
  return {category,details,browser};
}

const base64=text=>{
  const bytes=new TextEncoder().encode(text);let bin='';
  for(const b of bytes)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/.{76}/g,'$&\r\n');
};

// Builds the raw MIME message. Only fixed text, the category list and base64-encoded body go into
// headers, so nothing a player types can add or change a header.
export function buildEmail({from,to,category,details,browser,origin,now=new Date()}){
  const report='RIVL bug report (anonymous)\nCategory: '+category+'\nSite: '+(origin||'unknown')+'\nBrowser: '+(browser||'unknown')+'\n\n'+details+'\n';
  const domain=from.split('@')[1]||'rivlpoker.com';
  return [
    'From: "RIVL Bug Reports" <'+from+'>',
    'To: <'+to+'>',
    'Subject: RIVL bug: '+category,
    'Date: '+now.toUTCString(),
    'Message-ID: <'+crypto.randomUUID()+'@'+domain+'>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(report.replace(/\n/g,'\r\n')),
  ].join('\r\n');
}

// Sends one report. EmailMessage comes from 'cloudflare:email' in production and is passed in by tests.
export async function sendBugReport(env,report,origin,EmailMessage){
  const from=env.BUG_REPORT_FROM||'support@rivlpoker.com',to=env.BUG_REPORT_TO||from;
  const raw=buildEmail({from,to,origin,...report});
  await env.BUG_REPORT_EMAIL.send(new EmailMessage(from,to,raw));
}


export const PLAYER_REPORT_CATEGORIES=['Offensive gamertag','Offensive chat','Inappropriate profile picture'];
export function cleanPlayerReport(body){
  const category=String(body?.category||'');
  if(!PLAYER_REPORT_CATEGORIES.includes(category))return {error:'Choose a valid report reason.'};
  const player=String(body?.player||'').trim().replace(/[\r\n]/g,' ');
  const room=String(body?.room||'').trim().replace(/[\r\n]/g,' ');
  const details=String(body?.details||'').replace(/\r\n?/g,'\n').trim();
  if(!player||player.length>40)return {error:'Enter the reported player’s gamertag (up to 40 characters).'};
  if(room.length>20)return {error:'Room code is too long.'};
  if(details.length<10||details.length>2000)return {error:'Description must be 10–2000 characters.'};
  return {category,player,room,details};
}
export async function sendPlayerReport(env,report,origin,EmailMessage){
  const from=env.BUG_REPORT_FROM||'support@rivlpoker.com',to=env.BUG_REPORT_TO||from;
  const details='Reported player: '+report.player+'\nRoom code: '+(report.room||'not supplied')+'\n\n'+report.details;
  const raw=buildEmail({from,to,category:'Player misconduct - '+report.category,details,browser:'Support player report',origin});
  await env.BUG_REPORT_EMAIL.send(new EmailMessage(from,to,raw));
}
