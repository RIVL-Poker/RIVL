/* Verifies a "Sign in with Google" ID token on the server: RS256 signature against Google's published keys,
   issuer, audience (our OAuth client ID) and expiry. Only the verified claims are trusted, never the browser. */
const CERTS_URL='https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS=['accounts.google.com','https://accounts.google.com'];
const SKEW=60;
let certs={keys:[],until:0};

const b64url=s=>{const t=s.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(t+'='.repeat((4-t.length%4)%4)),c=>c.charCodeAt(0))};
const part=s=>JSON.parse(new TextDecoder().decode(b64url(s)));

async function googleKeys(force){
  if(!force&&certs.until>Date.now())return certs.keys;
  const response=await fetch(CERTS_URL);
  if(!response.ok)throw Object.assign(Error('Google sign-in is unavailable right now. Try again shortly.'),{status:503});
  const maxAge=Number(/max-age=(\d+)/.exec(response.headers.get('Cache-Control')||'')?.[1])||3600;
  certs={keys:(await response.json()).keys||[],until:Date.now()+Math.min(maxAge,86400)*1000};
  return certs.keys;
}

export async function verifyGoogleToken(token,clientId,now=Date.now()){
  if(!clientId)throw Object.assign(Error('Google sign-in is not set up on this site yet.'),{status:503});
  const bad=()=>Object.assign(Error('Google sign-in failed. Please try again.'),{status:401});
  if(typeof token!=='string'||token.length>4096)throw bad();
  const [h,p,s]=token.split('.');
  let header,claims;
  try{header=part(h);claims=part(p)}catch{throw bad()}
  if(header.alg!=='RS256'||!header.kid)throw bad();
  let jwk=(await googleKeys()).find(k=>k.kid===header.kid);
  // Google rotates keys; a kid we have not seen yet means our copy is stale.
  if(!jwk)jwk=(await googleKeys(true)).find(k=>k.kid===header.kid);
  if(!jwk)throw bad();
  const key=await crypto.subtle.importKey('jwk',{kty:jwk.kty,n:jwk.n,e:jwk.e,alg:'RS256',ext:true},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  let ok=false;try{ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64url(s||''),new TextEncoder().encode(h+'.'+p))}catch{}
  const t=now/1000;
  if(!ok||!ISSUERS.includes(claims.iss)||claims.aud!==clientId||!(claims.exp+SKEW>t)||(claims.iat&&claims.iat-SKEW>t)||typeof claims.sub!=='string'||!claims.sub)throw bad();
  return claims;
}
// Tests reset the cached keys between runs.
export const resetGoogleKeys=()=>{certs={keys:[],until:0}};
