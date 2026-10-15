/* Server-side decision grading for Ranked rooms. Reuses the bot-practice analysis in rating.js, so a decision
   gets the same EV-based grade online as it would against bots. Opponents' real cards are never used:
   equity is estimated against the ranges their betting suggests. */
import '../rating.js';
const RANKS='23456789TJQKA';
// Same starting-hand strength as engine.js; rating.js reads it as a global the first time it builds its range table.
globalThis.preflopStrength??=cards=>{const a=RANKS.indexOf(cards[0][0])+2,b=RANKS.indexOf(cards[1][0])+2,hi=Math.max(a,b),lo=Math.min(a,b),pair=a===b,suited=cards[0][1]===cards[1][1];return Math.min(.97,(pair?.50+hi/35:.15+hi/28+lo/60)+(suited?.07:0)+(hi-lo<=2?.04:0))};
const R=globalThis.RivlRating;
const SUIT={S:'♠',H:'♥',D:'♦',C:'♣'};
const card=c=>c[0]+SUIT[c[1]];
// Fewer samples than the browser's live coach keeps each graded action well inside a Worker's CPU budget.
export const SERVER_ITERS=600;
const STREETS={preflop:'Preflop',flop:'Flop',turn:'Turn',river:'River'};

// Grade the decision `seat` is about to make in room game `g`. Returns {label,acc,weight,lossBB} or null.
export function gradeDecision(g,seat,action,amount){
  const i=g.players.findIndex(p=>p.seat===seat);if(i<0)return null;
  const idx=s=>g.players.findIndex(p=>p.seat===s);
  const state={sbSeat:idx(g.sbSeat),bbSeat:idx(g.bbSeat),pot:g.pot,currentBet:g.currentBet,minRaise:g.minRaise,bb:g.bigBlind,board:g.board.map(card),hand:g.handNumber,street:STREETS[g.phase]||g.phase,
    players:g.players.map(p=>({hole:(g.hands[p.seat]||[]).map(card),bet:p.bet,stack:p.stack,folded:p.folded,allin:p.allIn,line:p.line||0,raiseLocked:!!g.raiseLocked?.includes(p.seat)}))};
  const type=action==='allin'?(state.players[i].stack<=Math.max(0,g.currentBet-g.players[i].bet)?'call':'raise'):action==='check'?'call':action;
  const target=action==='allin'?g.players[i].bet+g.players[i].stack:Math.round(Number(amount)||0);
  const r=R.grade(R.analyze(state,i,SERVER_ITERS),type,type==='raise'?target:0);
  return {label:r.label,acc:r.acc,weight:r.weight,lossBB:r.lossBB};
}
export const pairAcc=(a,b)=>Math.max(0,Math.min(1,.5+(a-b)/30));
export const {W_PLACE,W_DEC}=R;
export const MIN_DECISIONS=3;
