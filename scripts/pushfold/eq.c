// Heads-up preflop all-in equity for every pair of the 169 hand classes, plus exact compatible-combo counts.
// Output: eq.bin (169*169 doubles: equity of class a vs class b, ties split) and w.bin (compatible b combos per a combo).
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
static int straightHigh(int m){int m2=(m<<1)|((m>>12)&1);for(int h=13;h>=4;h--)if(((m2>>(h-4))&31)==31)return h-1;return -1;}
static int topRanks(int m,int k){int v=0;for(int r=12;r>=0&&k>0;r--)if(m&(1<<r)){v=v*13+r;k--;}return v;}
static int rankHand(const int*cs,int n){
  int cnt[13]={0},sm[4]={0},sc[4]={0},rm=0;
  for(int i=0;i<n;i++){int c=cs[i],r=c>>2,s=c&3;cnt[r]++;sm[s]|=1<<r;sc[s]++;rm|=1<<r;}
  int fl=-1;for(int s=0;s<4;s++)if(sc[s]>=5)fl=s;
  if(fl>=0){int sf=straightHigh(sm[fl]);if(sf>=0)return 8*1048576+sf;}
  int q=-1,t=-1,t2=-1,p1=-1,p2=-1;
  for(int r=12;r>=0;r--){int k=cnt[r];if(k==4)q=r;else if(k==3){if(t<0)t=r;else if(t2<0)t2=r;}else if(k==2){if(p1<0)p1=r;else if(p2<0)p2=r;}}
  if(q>=0)return 7*1048576+q*65536+topRanks(rm&~(1<<q),1);
  if(t>=0&&(t2>=0||p1>=0))return 6*1048576+t*65536+(t2>p1?t2:p1)*4096;
  if(fl>=0)return 5*1048576+topRanks(sm[fl],5);
  int st=straightHigh(rm);if(st>=0)return 4*1048576+st;
  if(t>=0)return 3*1048576+t*65536+topRanks(rm&~(1<<t),2);
  if(p1>=0&&p2>=0)return 2*1048576+p1*65536+p2*4096+topRanks(rm&~(1<<p1)&~(1<<p2),1);
  if(p1>=0)return 1*1048576+p1*65536+topRanks(rm&~(1<<p1),3);
  return topRanks(rm,5);
}
static int nc[169],cc[169][12][2];
static void build(){
  for(int i=0;i<13;i++)for(int j=0;j<13;j++){int k=i*13+j,n=0;
    if(i==j){int r=12-i;for(int a=0;a<4;a++)for(int b=a+1;b<4;b++){cc[k][n][0]=r*4+a;cc[k][n][1]=r*4+b;n++;}}
    else if(i<j){int h=12-i,l=12-j;for(int s=0;s<4;s++){cc[k][n][0]=h*4+s;cc[k][n][1]=l*4+s;n++;}}
    else{int h=12-j,l=12-i;for(int a=0;a<4;a++)for(int b=0;b<4;b++)if(a!=b){cc[k][n][0]=h*4+a;cc[k][n][1]=l*4+b;n++;}}
    nc[k]=n;}
}
static uint64_t s0,s1;
static inline uint64_t nx(){uint64_t x=s0,y=s1;s0=y;x^=x<<23;s1=x^y^(x>>17)^(y>>26);return s1+y;}
static inline int rn(int n){return (int)((nx()>>33)%n);}
int main(int argc,char**argv){
  long N=atol(argv[1]);int part=atoi(argv[2]),parts=atoi(argv[3]);
  build();
  static double EQ[169][169],W[169][169];
  for(int a=0;a<169;a++)for(int b=0;b<169;b++){int c=0;
    for(int x=0;x<nc[a];x++)for(int y=0;y<nc[b];y++){int*p=cc[a][x],*q=cc[b][y];if(p[0]!=q[0]&&p[0]!=q[1]&&p[1]!=q[0]&&p[1]!=q[1])c++;}
    W[a][b]=(double)c/nc[a];}
  int pairIdx=0;
  for(int a=0;a<169;a++)for(int b=a;b<169;b++,pairIdx++){
    if(pairIdx%parts!=part)continue;
    s0=0x9E3779B97F4A7C15ULL^(uint64_t)(a*1000+b+1)*0xBF58476D1CE4E5B9ULL;s1=0x94D049BB133111EBULL+(uint64_t)(b*977+a);for(int k=0;k<20;k++)nx();
    double win=0;
    for(long it=0;it<N;it++){
      int*p,*q;do{p=cc[a][rn(nc[a])];q=cc[b][rn(nc[b])];}while(p[0]==q[0]||p[0]==q[1]||p[1]==q[0]||p[1]==q[1]);
      int used[52]={0};used[p[0]]=used[p[1]]=used[q[0]]=used[q[1]]=1;
      int h1[7]={p[0],p[1]},h2[7]={q[0],q[1]};
      for(int k=0;k<5;k++){int c;do c=rn(52);while(used[c]);used[c]=1;h1[2+k]=h2[2+k]=c;}
      int r1=rankHand(h1,7),r2=rankHand(h2,7);win+=r1>r2?1:r1==r2?.5:0;
    }
    EQ[a][b]=win/N;EQ[b][a]=1-win/N;
    printf("%d %d %.6f\n",a,b,win/N);
  }
  if(part==0){FILE*f=fopen("w.bin","wb");fwrite(W,sizeof W,1,f);fclose(f);}
  return 0;
}
