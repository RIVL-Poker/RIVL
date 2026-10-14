/* Glicko-2 (same maths as rating.js), used by the server for online ratings. */
const SCALE=173.7178,TAU=0.5;
export function glicko(me,results){ // results: [{r,rd,s,w}]
  const mu=(me.r-1500)/SCALE,phi=me.rd/SCALE,ph2=phi*phi;
  let vInv=0,dSum=0;
  results.forEach(o=>{const w=o.w==null?1:o.w,pj=o.rd/SCALE,g=1/Math.sqrt(1+3*pj*pj/(Math.PI*Math.PI)),E=1/(1+Math.exp(-g*(mu-(o.r-1500)/SCALE)));vInv+=w*g*g*E*(1-E);dSum+=w*g*(o.s-E)});
  if(!results.length)return{...me};
  const v=1/vInv,delta=v*dSum,a=Math.log(me.vol*me.vol);
  const f=x=>{const ex=Math.exp(x);return ex*(delta*delta-ph2-v-ex)/(2*Math.pow(ph2+v+ex,2))-(x-a)/(TAU*TAU)};
  let A=a,B;
  if(delta*delta>ph2+v)B=Math.log(delta*delta-ph2-v);else{let k=1;while(f(a-k*TAU)<0&&k<100)k++;B=a-k*TAU}
  let fA=f(A),fB=f(B),guard=0;
  while(Math.abs(B-A)>1e-6&&guard++<200){const C=A+(A-B)*fA/(fB-fA),fC=f(C);if(fC*fB<=0){A=B;fA=fB}else fA/=2;B=C;fB=fC}
  const vol=Math.exp(A/2),phiStar=Math.sqrt(ph2+vol*vol),phiNew=1/Math.sqrt(1/(phiStar*phiStar)+1/v);
  return{r:(mu+phiNew*phiNew*dSum)*SCALE+1500,rd:Math.min(350,Math.max(30,phiNew*SCALE)),vol};
}
