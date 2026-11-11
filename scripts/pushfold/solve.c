// Push/fold Nash equilibrium (chip EV, linearly averaged fictitious play) for a table of n players with equal stacks S (in big blinds), blinds 0.5/1, no ante.
// Seats 0..n-1 in preflop order; n-2 is the small blind, n-1 the big blind. A player folded to either shoves or folds;
// players behind a shove call or fold in turn. Once someone calls, the rest fold (no overcalls).
// Input: eq.txt ("a b equity" for a<=b) and w.bin. Output, one line per stack:
//   S <n> <stack> then for each first-in seat i: push mask (169 chars 0/1), then for each seat i the BB's call mask,
//   then for each first-in seat i the 169 EV gaps (shove EV minus fold EV, BB), then the BB's call-minus-fold EV gaps.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#define H 169
static double EQ[H][H],W[H][H];
int main(int argc,char**argv){
  int n=atoi(argv[1]);double S=atof(argv[2]);int T=atoi(argv[3]);
  FILE*f=fopen("eq.txt","r");int a,b;double e;
  while(fscanf(f,"%d %d %lf",&a,&b,&e)==3){EQ[a][b]=e;EQ[b][a]=1-e;}fclose(f);
  f=fopen("w.bin","rb");fread(W,sizeof W,1,f);fclose(f);
  double blind[9]={0};blind[n-2]=.5;blind[n-1]=1;double tot=1.5;
  static double P[9][H],C[9][9][H],BP[9][H],BC[9][9][H],EVp[9][H],EVc[9][9][H];
  for(int i=0;i<n;i++)for(int h=0;h<H;h++){P[i][h]=.5;for(int j=0;j<n;j++)C[i][j][h]=.2;}
  for(int t=1;t<=T;t++){
    // Callers' best responses to the current shoving ranges.
    for(int i=0;i<n-1;i++){
      for(int j=i+1;j<n;j++){
        double pot=2*S+tot-blind[i]-blind[j];
        for(int h=0;h<H;h++){double m=0,q=0;for(int x=0;x<H;x++){double wp=W[h][x]*P[i][x];m+=wp;q+=wp*EQ[h][x];}
          double ev=m>0?q/m*pot-S:-S;EVc[i][j][h]=ev-(-blind[j]);BC[i][j][h]=ev>-blind[j]?1:0;}
      }
    }
    // Shovers' best responses to the current calling ranges.
    for(int i=0;i<n-1;i++){
      for(int h=0;h<H;h++){
        double fr=1,ev=0;
        for(int j=i+1;j<n;j++){
          double pot=2*S+tot-blind[i]-blind[j],m=0,q=0;
          for(int x=0;x<H;x++){double wc=W[h][x]*C[i][j][x];m+=wc;q+=wc*EQ[h][x];}
          m/=1225;q/=1225;ev+=fr*(q*pot-m*S);fr*=1-m;
        }
        ev+=fr*(tot-blind[i]);
        EVp[i][h]=ev-(-blind[i]);BP[i][h]=ev>-blind[i]?1:0;
      }
    }
    double st=2.0/(t+2); // linearly weighted average: later rounds count more, which converges far faster
    for(int i=0;i<n-1;i++)for(int h=0;h<H;h++){P[i][h]+=(BP[i][h]-P[i][h])*st;for(int j=i+1;j<n;j++)C[i][j][h]+=(BC[i][j][h]-C[i][j][h])*st;}
  }
  // Settle on pure ranges (frequency over one half), then report the EV gaps against those ranges.
  // EV gaps below are measured against the averaged (mixed) strategies, the equilibrium itself.
  printf("S %d %.1f\n",n,S);
  for(int i=0;i<n-1;i++){for(int h=0;h<H;h++)putchar(P[i][h]>.5?'1':'0');putchar('\n');}
  for(int i=0;i<n-1;i++){for(int h=0;h<H;h++)putchar(C[i][n-1][h]>.5?'1':'0');putchar('\n');}
  // Recompute EVs against the pure ranges.
  for(int i=0;i<n-1;i++)for(int j=i+1;j<n;j++){double pot=2*S+tot-blind[i]-blind[j];
    for(int h=0;h<H;h++){double m=0,q=0;for(int x=0;x<H;x++){double wp=W[h][x]*P[i][x];m+=wp;q+=wp*EQ[h][x];}EVc[i][j][h]=(m>0?q/m*pot-S:-S)+blind[j];}}
  for(int i=0;i<n-1;i++)for(int h=0;h<H;h++){double fr=1,ev=0;
    for(int j=i+1;j<n;j++){double pot=2*S+tot-blind[i]-blind[j],m=0,q=0;for(int x=0;x<H;x++){double wc=W[h][x]*C[i][j][x];m+=wc;q+=wc*EQ[h][x];}m/=1225;q/=1225;ev+=fr*(q*pot-m*S);fr*=1-m;}
    EVp[i][h]=ev+fr*(tot-blind[i])+blind[i];}
  int bad=0;double worst=0;
  for(int i=0;i<n-1;i++)for(int h=0;h<H;h++){if((EVp[i][h]>0)!=(P[i][h]>.5)){bad++;if(fabs(EVp[i][h])>worst)worst=fabs(EVp[i][h]);}printf("%.4f ",EVp[i][h]);}
  putchar('\n');
  for(int i=0;i<n-1;i++)for(int h=0;h<H;h++){if((EVc[i][n-1][h]>0)!=(C[i][n-1][h]>.5)){bad++;if(fabs(EVc[i][n-1][h])>worst)worst=fabs(EVc[i][n-1][h]);}printf("%.4f ",EVc[i][n-1][h]);}
  putchar('\n');
  for(int i=0;i<n-1;i++)for(int j=i+1;j<n-1;j++)for(int h=0;h<H;h++)if((EVc[i][j][h]>0)!=(C[i][j][h]>.5)){bad++;if(fabs(EVc[i][j][h])>worst)worst=fabs(EVc[i][j][h]);}
  fprintf(stderr,"n=%d S=%.1f off-best-response hands=%d worst gap=%.4f BB\n",n,S,bad,worst);
  return 0;
}
