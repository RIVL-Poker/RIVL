/* Daily puzzle: one graded decision per UTC day, the same for everyone. The spots and their grades are built
   ahead of time by scripts/make-puzzles.mjs; the answer and grades are only sent after a player answers. */
import {PUZZLES,PUZZLE_START} from './puzzles.js';
const DAY_MS=86400000;
export const CHOICES=['fold','call','raise'];
export const utcDay=(t=Date.now())=>new Date(t).toISOString().slice(0,10);
const dayNumber=day=>Math.round((Date.parse(day+'T00:00:00Z')-Date.parse(PUZZLE_START+'T00:00:00Z'))/DAY_MS);
export const validDay=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&utcDay(Date.parse(day+'T00:00:00Z'))===day;
// Today's puzzle, or an earlier day's. Never a future one, so nobody can look ahead at tomorrow's answer.
export function puzzleFor(day,now=Date.now()){
  const today=utcDay(now);day=day||today;
  if(!validDay(day)||day>today)return null;
  const i=dayNumber(day);if(i<0)return null;
  // The list repeats after it runs out; the number keeps counting so every day still has its own #.
  return {day,number:i+1,p:PUZZLES[i%PUZZLES.length],today:day===today};
}
// What a player sees before answering: the spot and the three choices, nothing that gives the answer away.
export function publicPuzzle({day,number,p,today},now=Date.now()){
  return {day,number,today,nextIn:Date.parse(utcDay(now)+'T00:00:00Z')+DAY_MS-now,
    street:p.street,position:p.position,villain:p.villain,heroPos:p.heroPos||'',villainPos:p.villainPos||'',difficulty:p.difficulty||'',hero:p.hero,board:p.board,
    pot:p.pot+(p.heroBet||0)+p.bet,heroBet:p.heroBet||0,bet:p.bet,stack:p.stack,bb:100,story:p.story,
    choices:[{key:'fold',label:'Fold'},{key:'call',label:p.callLabel},...(p.grades.raise?[{key:'raise',label:p.raiseLabel}]:[])]};
}
export function reveal({p}){return {best:p.best,eq:p.eq,need:p.need,grades:p.grades,why:p.why||null}}
