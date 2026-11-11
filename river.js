/* RIVL Training: River Call or Fold. You hold a bluff catcher, they bet the river, and you call or fold.
   Every spot is written by hand below: the hand, the action so far, and the hands they would bet the river with.
   The answer is never a guess. Every two-card hand in their range is counted exactly, after removing the cards
   you can see, and checked at showdown against yours (rating.js's evaluator), so your equity is a plain count:
   the hands you beat over all the hands they bet. A call needs bet / (pot after the bet + your call). Calling
   is worth equity x (pot + call) - call; folding is worth 0. Both are graded by rating.js's own grade(), the one
   that grades every decision after the flop in bot practice and Ranked, so the room teaches what the grader rewards.
   Progress is kept in this browser (localStorage key rivlRiverTrainer). tests-river.js checks every spot. */
(root=>{
  const R=root.RivlRating;if(!R)return;

  /* ---------- ranges ----------
     A range is a list of groups, strongest first. Each group is a name and space-separated hands:
     "AK" every ace-king, "AKs" / "AKo" suited / offsuit, "QQ" a pair, "TT-77" a run of pairs, "A5s-A2s" a run of
     kickers, "A♠K" a specific card with any of the other, "A♠K♠" one exact combo.
     Cards you can see (your hand and the board) are removed. A combo listed in two groups counts only in the first. */
  const RANKS='23456789TJQKA',SUITS='♠♥♦♣';
  const TOKEN=/^([2-9TJQKA])([♠♥♦♣]?)([2-9TJQKA])([♠♥♦♣]?)([so]?)$/;
  function expand(tok){
    const m=tok.match(/^(.+)-(.+)$/);
    if(!m)return [tok];
    const a=m[1].match(TOKEN),b=m[2].match(TOKEN);
    if(!a||!b)throw Error('Bad range token '+tok);
    const out=[];
    if(a[1]===a[3]){for(let r=RANKS.indexOf(a[1]);r>=RANKS.indexOf(b[1]);r--)out.push(RANKS[r]+RANKS[r])}
    else for(let r=RANKS.indexOf(a[3]);r>=RANKS.indexOf(b[3]);r--)out.push(a[1]+RANKS[r]+a[5]);
    return out;
  }
  function combos(tok){
    const m=tok.match(TOKEN);if(!m)throw Error('Bad range token '+tok);
    const [,r1,s1,r2,s2,k]=m,suited=k==='s',off=k==='o';
    const out=[],seen=new Set();
    for(const a of s1||SUITS)for(const b of s2||SUITS){
      const c1=r1+a,c2=r2+b;if(c1===c2||suited&&a!==b||off&&a===b)continue;
      const key=[c1,c2].sort().join('');if(seen.has(key))continue;seen.add(key);out.push([c1,c2]);
    }
    return out;
  }
  // Every group with its live combos and how each one ends at showdown against your hand.
  function rangeOf(spot){
    const dead=new Set([...spot.hero,...spot.board]),used=new Set();
    const toI=cs=>cs.map(R.toInt),boardI=toI(spot.board),mine=R.rankHand(toI(spot.hero).concat(boardI));
    return spot.range.map(([name,hands])=>{
      const list=[];let win=0,lose=0,tie=0;
      hands.split(/\s+/).flatMap(expand).forEach(tok=>combos(tok).forEach(c=>{
        const key=c.slice().sort().join('');
        if(dead.has(c[0])||dead.has(c[1])||used.has(key))return;
        used.add(key);list.push(c);
        const theirs=R.rankHand(toI(c).concat(boardI));
        if(theirs>mine)lose++;else if(theirs<mine)win++;else tie++;
      }));
      return {name,hands,combos:list,n:list.length,win,lose,tie};
    });
  }

  /* ---------- the spot, from its action ----------
     Heads-up, 100 BB deep. The small blind folds; its 0.5 BB is in the pot, and so is the big blind's when
     neither player is in it. streets: one entry per street before the river: 'x' (checked through), ['v',size]
     (they bet, you call) or ['h',size] (you bet, they call), sizes as a share of the pot. river: their bet as a
     share of the pot. Amounts round to the nearest half big blind. */
  const NAME={UTG:'under the gun',HJ:'the hijack',CO:'the cutoff',BTN:'the button',SB:'the small blind',BB:'the big blind'};
  const AT={HJ:'in the hijack',CO:'on the cutoff',BTN:'on the button',SB:'in the small blind',BB:'in the big blind'};
  const PRE=['UTG','HJ','CO','BTN','SB','BB'],POST=['SB','BB','UTG','HJ','CO','BTN'];
  const round=x=>Math.max(.5,Math.round(x*2)/2);
  const bb=x=>`${+x.toFixed(1)} BB`;
  const cap=t=>t[0].toUpperCase()+t.slice(1);
  const cards=t=>t.match(/[2-9TJQKA][♠♥♦♣]/g);
  const STREETS=['Flop','Turn'];
  function build(d){
    const hero=cards(d.hero),board=cards(d.board),v=NAME[d.villainPos],V=cap(v);
    const ip=POST.indexOf(d.heroPos)>POST.indexOf(d.villainPos),heroOpens=PRE.indexOf(d.heroPos)<PRE.indexOf(d.villainPos);
    const dead=(d.heroPos!=='SB'&&d.villainPos!=='SB'?.5:0)+(d.heroPos!=='BB'&&d.villainPos!=='BB'?1:0);
    const put=d.threeBet||2.5;
    let pre=heroOpens?`You open to 2.5 BB ${AT[d.heroPos]}. ${V} `+(d.threeBet?`3-bets to ${bb(put)}. You call.`:'calls.')
      :`${V} opens to 2.5 BB. You `+(d.threeBet?`3-bet to ${bb(put)} ${AT[d.heroPos]}. ${V} calls.`:`call ${AT[d.heroPos]}.`);
    const story=[pre];
    let pot=dead+2*put,stack=100-put;
    d.streets.forEach((a,s)=>{
      const head=`${STREETS[s]} ${board.slice(s?2+s:0,3+s).join(' ')}: `;
      if(a==='x'){story.push(head+'checked through.');return}
      const b=round(pot*a[1]);
      story.push(head+(a[0]==='v'?(ip?`${v} bets ${bb(b)}, you call.`:`you check, ${v} bets ${bb(b)}, you call.`)
        :ip?`${v} checks, you bet ${bb(b)}, ${v} calls.`:`you bet ${bb(b)}, ${v} calls.`));
      pot+=2*b;stack-=b;
    });
    const bet=Math.min(stack,round(pot*d.river)),allIn=bet>=stack;
    const what=allIn?`moves all-in for ${bb(bet)}`:`bets ${bb(bet)}`;
    story.push(`River ${board[4]}: `+(ip?`${v} ${what} into ${bb(pot)}.`:`you check, ${v} ${what} into ${bb(pot)}.`));
    const spot={...d,hero,board,pot,bet,stack,allIn,ip,villain:v,story,share:bet/pot};
    // The price: you put in bet to win the pot and their bet.
    spot.need=bet/(pot+2*bet);
    spot.groups=rangeOf(spot);
    const sum=k=>spot.groups.reduce((a,g)=>a+g[k],0);
    spot.total=sum('n');spot.win=sum('win');spot.lose=sum('lose');spot.tie=sum('tie');
    spot.eq=(spot.win+spot.tie/2)/spot.total;
    spot.evCall=spot.eq*(pot+2*bet)-bet;
    spot.grades=gradeSpot(spot);
    spot.best=spot.evCall>0?'call':'fold';
    return spot;
  }
  // rating.js's grader on the exact EVs: the same labels, accuracy and BB lost as every decision after the flop.
  function gradeSpot(s){
    const toI=cs=>cs.map(R.toInt),boardI=toI(s.board);
    const A={pot:s.pot+s.bet,toCall:s.bet,bb:1,eq:s.eq,street:'river',
      madeCat:R.handCategory(R.rankHand(toI(s.hero).concat(boardI))),boardCat:R.handCategory(R.rankHand(boardI)),
      opts:[{type:'fold',ev:0,label:'Fold'},{type:'call',ev:s.evCall,label:`Call ${bb(s.bet)}`}]};
    return {call:R.grade(A,'call'),fold:R.grade(A,'fold')};
  }
  // The bet-size filters: small (up to about half the pot), big (up to pot) and overbets.
  const SIZES=[['SMALL','Up to half pot',s=>s.share<=.55],['BIG','Two-thirds to pot',s=>s.share>.55&&s.share<=1.05],['OVER','Overbets',s=>s.share>1.05]];
  const sizeOf=s=>SIZES.find(z=>z[2](s))[0];

  /* ---------- the spots ----------
     title shows before you answer and never gives the answer away. answer is the play the write-up explains;
     tests-river.js fails if the count disagrees. hand: what you hold. read: why they bet these hands like this. */
  const T=1/3,H=1/2,TT=2/3,TQ=3/4;
  const SPOTS=[
   {id:'k9-three-barrels',title:'Top pair, weak kicker, three barrels',answer:'fold',
    hero:'K♦9♦',board:'K♠8♠3♦2♣4♥',heroPos:'BB',villainPos:'BTN',streets:[['v',T],['v',TT]],river:TQ,
    hand:'Top pair with a 9 kicker. It beats every missed draw, but every king with a better kicker beats you.',
    read:'Three bets from the button on this board is mostly strong kings, sets and the straights the 4 just made. The only draws to bluff with are the spades that missed, and there are not many of them.',
    range:[['Ace-king','AK'],['King-queen, king-jack','KQs KQo KJs'],['Two pair','K8s K3s'],['Sets','88 33'],['Straights (5-6, A-5)','65s A5s'],
     ['Missed spade draws','A♠Q♠ A♠J♠ A♠T♠ Q♠J♠ Q♠T♠ J♠T♠ T♠9♠ 9♠7♠ 7♠6♠']]},
   {id:'97-busted-hearts',title:'Second pair after the king',answer:'call',
    hero:'9♠7♠',board:'9♥8♥2♣K♣3♠',heroPos:'BB',villainPos:'CO',streets:[['v',H],['v',TT]],river:H,
    hand:'A pair of nines with a 7. The king on the turn put you behind every king, but you still beat ace-high and every draw that missed.',
    read:'A flop of 9-8 with two hearts gives the cutoff lots of draws: flush draws, straight draws and both at once. None of them got there, and half a pot is a cheap bluff to try with all of them.',
    range:[['Kings','AK KQs KQo KJs'],['Aces','AA'],['Sets','99 88 22'],
     ['Missed heart draws','A♥Q♥ A♥J♥ A♥T♥ A♥5♥ A♥4♥ Q♥J♥ Q♥T♥ J♥T♥ T♥7♥ 7♥6♥ 6♥5♥'],['Missed straight draws','JTs JTo 76s T7s']]},
   {id:'at-overbet',title:'Top pair against a river overbet',answer:'call',
    hero:'A♠T♦',board:'A♣7♦4♠9♣2♥',heroPos:'BTN',villainPos:'BB',streets:[['h',T],'x'],river:1.25,
    hand:'Top pair with a 10 kicker. You checked the turn behind, so your hand looks capped to them.',
    read:'The big blind checked and called the flop, then saw you check the turn. A big overbet now says two pair, a set or a wheel, or the club and straight draws from the turn that missed.',
    range:[['Sets','77 44 99 22'],['Two pair','A9s A9o A7s A4s A2s 97s 74s'],['Wheels (5-3)','53s'],
     ['Missed club draws','K♣Q♣ K♣J♣ K♣T♣ K♣8♣ Q♣J♣ Q♣T♣ J♣T♣ T♣8♣ 8♣6♣ 6♣5♣'],['Missed straight draws','86s 65s T8s 86o']]},
   {id:'flush-completes-lead',title:'Top pair when the flush card lands',answer:'fold',
    hero:'A♥K♣',board:'K♦9♦4♣7♠2♦',heroPos:'BTN',villainPos:'BB',streets:[['h',H],['h',H]],river:1,
    hand:'Top pair, top kicker, but no diamond. The third diamond on the river makes every flush draw a flush.',
    read:'The big blind called two bets and now leads out for the whole pot as the flush comes in. Most players lead big here with flushes, sets and two pair. Only the suited straight draws that missed turn into bluffs.',
    range:[['Flushes','A♦Q♦ A♦J♦ A♦T♦ A♦8♦ A♦6♦ A♦5♦ A♦3♦ Q♦J♦ Q♦T♦ J♦T♦ J♦8♦ T♦8♦ 8♦6♦ 6♦5♦ 5♦3♦'],
     ['Sets','99 77 44 22'],['Two pair','K9s K7s 97s'],['Missed straight draws','T8s 86s 65s']]},
   {id:'block-bet',title:'A small lead on the river',answer:'call',
    hero:'J♥9♥',board:'J♠7♦3♣Q♣5♥',heroPos:'BTN',villainPos:'BB',streets:[['h',T],'x'],river:.25,
    hand:'A pair of jacks with a 9 kicker. The queen on the turn put a higher card on the board, so you checked behind.',
    read:'A quarter-pot lead is a small bet to see a showdown cheaply: weak queens and jacks bet for a little value, and draws that missed bet small as a cheap bluff.',
    range:[['Queens','QJs Q9s Q8s Q6s Q5s Q4s'],['Better jacks','KJs JTs'],['Missed draws','86s 98s T9s A2s A4s K♣T♣ T♣9♣']]},
   {id:'kk-paired-dry',title:'Nines on a paired king board',answer:'fold',
    hero:'9♥9♣',board:'K♣K♦7♠2♥4♣',heroPos:'BB',villainPos:'BTN',streets:[['v',T],['v',H]],river:TT,
    hand:'A pair of nines under a king. You beat every bluff and nothing else.',
    read:'K-K-7, a deuce and a four: no flush draw until the river, and almost no straight draws. The button kept betting with kings and big pairs, and has very few hands that missed to bluff with.',
    range:[['Kings','AK KQs KQo KJs KTs K9s K8s K7s'],['Overpairs','AA QQ JJ TT'],['Full houses','77 22 44'],['Bluffs','A5s A3s 65s 86s']]},
   {id:'jj-3bet-pot',title:'Jacks in a 3-bet pot',answer:'call',
    hero:'J♥J♣',board:'Q♦8♣4♥2♠8♦',heroPos:'BTN',villainPos:'BB',threeBet:11,streets:[['v',T],'x'],river:H,
    hand:'A pair of jacks under the queen. You beat every ace-high hand and lose to any queen.',
    read:'The big blind 3-bet, bet small on the flop and checked the turn. Strong hands often bet the turn, so the range that bets half the pot now still has plenty of ace-high hands trying to win the pot.',
    range:[['Overpairs','AA KK'],['Queens','QQ AQs AQo KQs'],['Ace-high','AKs AKo A5s A3s']]},
   {id:'a6-ace-high',title:'Ace-high after the turn checks through',answer:'call',
    hero:'A♦6♦',board:'J♦T♦4♣2♠3♥',heroPos:'BB',villainPos:'BTN',streets:[['v',T],'x'],river:H,
    hand:'Ace-high. Your flush draw missed, but the ace still beats every king-high and queen-high draw that missed too.',
    read:'The button checked the turn, so they rarely have a strong hand. Half a pot on the river is a pair trying for thin value, the 6-5 that made a straight, or a draw that missed trying to take the pot.',
    range:[['Pairs','AJo AJs KJs QJs J9s ATs KTs QTs T9s'],['Straights','65s A5s'],['Missed draws','K♦Q♦ K♦9♦ Q♦9♦ 9♦8♦ KQo KQs Q9s 98s']]},
   {id:'t9-unblocker',title:'Second pair, no spade',answer:'call',
    hero:'T♥9♥',board:'T♠7♠3♦2♣K♥',heroPos:'BB',villainPos:'BTN',streets:[['v',T],['v',H]],river:1,
    hand:'A pair of tens with a 9. You hold no spade, so you do not take any of their missed flush draws away.',
    read:'Three barrels from the button: kings, overpairs and sets for value, and every spade draw that missed when the king of hearts came.',
    range:[['Kings','AK KQs KJs'],['Overpairs','AA QQ JJ'],['Sets','TT 77 33'],
     ['Missed spade draws','A♠Q♠ A♠J♠ A♠9♠ A♠8♠ A♠6♠ A♠5♠ A♠4♠ A♠3♠ A♠2♠ Q♠J♠ Q♠9♠ Q♠8♠ J♠9♠ J♠8♠ 9♠8♠ 8♠6♠ 6♠5♠ 6♠4♠ 5♠4♠'],['Missed straight draws','98s 86s']]},
   {id:'at-blocker',title:'Second pair with the ace of spades',answer:'fold',
    hero:'A♠T♣',board:'T♠7♠3♦2♣K♥',heroPos:'BB',villainPos:'BTN',streets:[['v',T],['v',H]],river:1,
    hand:'A pair of tens with an ace. It is a better hand than ten-nine, but the A♠ in your hand means they can never hold the missed nut-flush draws.',
    read:'The same three barrels: kings, overpairs and sets for value, and the spade draws that missed. With the A♠ in your hand, nine of their missed spade draws are gone.',
    range:[['Kings','AK KQs KJs'],['Overpairs','AA QQ JJ'],['Sets','TT 77 33'],
     ['Missed spade draws','A♠Q♠ A♠J♠ A♠9♠ A♠8♠ A♠6♠ A♠5♠ A♠4♠ A♠3♠ A♠2♠ Q♠J♠ Q♠9♠ Q♠8♠ J♠9♠ J♠8♠ 9♠8♠ 8♠6♠ 6♠5♠ 6♠4♠ 5♠4♠'],['Missed straight draws','98s 86s']]},
   {id:'qq-four-flush-overbet',title:'An overpair on a four-flush board',answer:'fold',
    hero:'Q♠Q♦',board:'8♥5♥2♣J♥3♥',heroPos:'BTN',villainPos:'BB',streets:[['h',H],['h',H]],river:1.5,
    hand:'Queens, with no heart. The fourth heart means any single heart beats you.',
    read:'The big blind called two bets and now overbets one and a half times the pot on the fourth heart. Any heart is a flush, and the only bluffs are the straight draws that missed.',
    range:[['Flushes','A♥K A♥Q A♥T A♥9 K♥Q K♥T K♥9 Q♥T T♥9♥ 9♥7♥ 7♥6♥ 6♥4♥'],['Straights','A4s 64s'],['Missed straight draws','76s 97s T9s']]},
   {id:'kq-river-shove',title:'Top pair facing a river shove',answer:'call',
    hero:'K♠Q♠',board:'K♥T♣6♦4♥9♣',heroPos:'CO',villainPos:'BB',threeBet:10,streets:[['v',H],['v',TT]],river:1,
    hand:'Top pair, queen kicker. You only lose to ace-king, two pair, sets and straights.',
    read:'The big blind 3-bet and fired three times in a 3-bet pot, ending with the rest of the stack. Ace-king and the strong hands shove for value, but so do the ace-high draws and the hearts that missed.',
    range:[['Ace-king','AK'],['Sets and two pair','KK TT 66 K9s'],['Straights','QJs 87s'],['Overpairs','AA'],
     ['Missed draws','A♥5♥ A♥4♥ A♥3♥ A♥2♥ A♥Q♥ A♥J♥ AQs AJs A5s']]},
   {id:'small-third-pair',title:'A small pair against a third of the pot',answer:'call',
    hero:'6♣6♦',board:'Q♠9♦4♣2♥7♣',heroPos:'BTN',villainPos:'BB',streets:[['h',H],'x'],river:T,
    hand:'Sixes, below three of the board cards. They beat ace-high and the draws that missed, but not much else.',
    read:'The big blind check-called the flop, saw you check the turn, and now bets a third of the pot. Small bets like this are often thin value from a pair of nines or worse queens, and misses that want a cheap win.',
    range:[['Queens','QJs QTs Q8s Q7s Q5s'],['Nines and sevens','A9s K9s T9s 98s 97s 87s 76s'],['Missed draws','JTs JTo T8s 86s 53s A5s A3s K♣J♣ K♣T♣']]},
   {id:'tt-king-lead',title:'Tens when the king lands',answer:'fold',
    hero:'T♦T♣',board:'9♠6♥3♣2♦K♠',heroPos:'BTN',villainPos:'BB',streets:[['h',H],['h',H]],river:H,
    hand:'Tens with a king now on the board. You beat a bare 9 and any draw, and lose to the king and everything stronger.',
    read:'The big blind check-called twice and now leads half the pot on the king. Leads on a river card that helps them are mostly kings and the two pair and sets they slow-played, with only a few missed straight draws.',
    range:[['Kings','K9s K6s K3s KQs KJs'],['Sets','99 66 33 22'],['Two pair','96s 63s 32s'],['Straights','54s 54o'],['Missed draws','87s T8s 75s']]},
   {id:'ace-high-overbet-bluff',title:'A big bet after a check-check turn',answer:'call',
    hero:'A♣Q♦',board:'J♥7♥5♠3♣2♣',heroPos:'BB',villainPos:'BTN',streets:[['v',T],'x'],river:1.5,
    hand:'Ace-queen high: no pair, but it beats every king-high and queen-high hand that missed.',
    read:'The button checked the turn, which strong hands rarely do on this wet board, then overbets the river. Players polarize here: the occasional slow-played set or straight, and plenty of heart draws and broadway cards giving up on showdown value.',
    range:[['Straights','64s A4s'],['Sets','JJ 77 55'],['Missed heart draws','K♥Q♥ K♥T♥ K♥9♥ Q♥T♥ Q♥9♥ T♥9♥ 9♥8♥ 8♥6♥ K♥8♥ Q♥8♥'],['Missed straight draws','T9s 98s 86s KQs']]},
   {id:'aq-dry-ace-three-streets',title:'Top pair on a dry ace-high board',answer:'fold',
    hero:'A♦Q♣',board:'A♠8♥3♣5♦K♥',heroPos:'BB',villainPos:'CO',streets:[['v',T],['v',H]],river:1,
    hand:'Top pair, queen kicker, now that the king fell on the river. You lose to ace-king and every two pair.',
    read:'A-8-3 has almost nothing to draw to. The cutoff bet three times and finishes with a pot-sized bet on the king: ace-king, two pair and sets. There are only a few gutshots that missed to bluff with.',
    range:[['Ace-king','AK'],['Two pair','A8s A5s A3s K8s'],['Sets','88 33 55 KK'],['Straights','42s'],['Missed gutshots','76s 74s']]},
   {id:'pair-board-river-shove-3b',title:'Kings face a shove on a paired board',answer:'fold',
    hero:'K♦K♣',board:'A♠9♦9♣4♠6♥',heroPos:'BTN',villainPos:'SB',threeBet:12,streets:[['v',T],['v',H]],river:2,
    hand:'Kings under an ace on a paired board. You lose to every ace and every nine.',
    read:'The small blind 3-bet, then bet all three streets on an ace-high board and shoves the river. Aces are a big part of a 3-bet range, and the only real bluffs are the spade draws that missed.',
    range:[['Aces','AKs AKo AQs AQo AJs ATs'],['Nines and full houses','A9s 99 44 66'],['Missed spade draws','K♠Q♠ K♠J♠ Q♠J♠ Q♠T♠ J♠T♠ 8♠7♠']]},
   {id:'87-half-pot',title:'Third pair against half the pot',answer:'call',
    hero:'8♣7♣',board:'Q♦8♦4♠T♥2♠',heroPos:'BB',villainPos:'BTN',streets:[['v',T],['v',H]],river:H,
    hand:'Third pair, with a 7. Any queen, any ten and every overpair beats you.',
    read:'Q-8-4 with two diamonds, then a ten: the button has flush draws, straight draws and both. All of them missed on the 2, and half a pot is the cheapest bluff they can make.',
    range:[['Queens','AQs AQo KQs QJs'],['Overpairs','AA KK'],['Two pair and sets','QQ 88 44 T8s'],['Straights','J9s'],
     ['Missed diamond draws','A♦K♦ A♦J♦ A♦5♦ K♦J♦ K♦9♦ J♦9♦ 9♦7♦ 7♦6♦ 6♦5♦'],['Missed straight draws','KJs KJo 96s 76s']]},
   {id:'q8-paired-overbet',title:'Top pair against a big overbet',answer:'fold',
    hero:'Q♦8♦',board:'Q♠T♦5♣5♥2♦',heroPos:'BB',villainPos:'BTN',streets:[['v',T],['v',TT]],river:1.5,
    hand:'Top pair with an 8 kicker, which does not play: the 10 on the board is your kicker. A queen with a jack or better beats you, and so does any 5.',
    read:'The board pairs on the turn and the button keeps betting, then overbets the river. That is queens with good kickers, trips and full houses. The straight draws that missed are the only bluffs, and there are not many.',
    range:[['Better queens','AQs AQo KQs QJs'],['Two pair and trips','QTs A5s 65s 54s'],['Full houses','TT QQ 55 22'],['Missed straight draws','KJs J9s 98s']]},
   {id:'aa-four-straight',title:'Aces when the straight comes in',answer:'fold',
    hero:'A♠A♦',board:'7♣6♦2♠8♥5♣',heroPos:'BTN',villainPos:'BB',streets:[['h',H],['h',H]],river:1.5,
    hand:'Aces, an overpair, on a board that now reads 5-6-7-8. Any 9 or any 4 makes a straight.',
    read:'The big blind called two bets on a connected board and now leads one and a half times the pot. Everything that hit the straight leads big. With no flush draw on this board, the only bluffs are a few big cards that never paired.',
    range:[['Straights','T9s 98s 97s 96s 94s 43s 54s 64s 74s 84s 9♣4♣'],['Sets','77 66 22 55'],['Two pair','76s 65s'],['Missed overcards','KQs KJs QJs']]},
   {id:'j9-pot-bet',title:'Top pair against a pot-sized bet',answer:'call',
    hero:'J♦9♦',board:'J♣T♣5♦4♥2♠',heroPos:'BB',villainPos:'BTN',streets:[['v',T],['v',TT]],river:1,
    hand:'Top pair with a 9 kicker. Every jack with a better kicker beats you, and so does anything stronger.',
    read:'J-10 with two clubs is the board the button has the most draws on: flush draws, open-enders and gutshots. None of them got there, and the button bets the pot with all of the hands that would rather not show down.',
    range:[['Better jacks','AJs AJo KJs QJs'],['Two pair and sets','JTs JJ TT 55'],['Straights','A3s 63s'],
     ['Missed club draws','A♣K♣ A♣Q♣ A♣9♣ A♣8♣ A♣7♣ A♣6♣ K♣Q♣ K♣9♣ Q♣9♣ 9♣8♣ 8♣7♣ 7♣6♣'],['Missed straight draws','KQs Q9s 98s 87s']]},
  ];
  const BUILT=SPOTS.map(build);

  // Correct when the grader rates your play Best (or Brilliant), close when it is Excellent or Good, a miss otherwise:
  // the same verdicts as the other Training drills.
  const verdictOf=label=>label==='Best'||label==='Brilliant'?'right':label==='Excellent'||label==='Good'?'close':'wrong';
  const judge=(s,act)=>({label:s.grades[act].label,v:verdictOf(s.grades[act].label),best:s.best});
  root.RivlRiver={SPOTS:BUILT,build,rangeOf,combos,expand,SIZES,sizeOf,gradeSpot,judge,verdictOf};

  /* ---------- the page ----------
     A Training drill, joined to the hub with RivlTraining.add (this file loads after training.js). The table and the story are the
     daily puzzle's (RivlPuzzleView); the bet-size filter, the verdict and the progress look like the other drills. */
  const doc=root.document;if(!doc)return;
  const pct=x=>Math.round(x*100)+'%',pctOf=(c,n)=>n?Math.round(100*c/n)+'%':'–';
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const mini=c=>`<span class="pz-mini${'♥♦'.includes(c[1])?' red':''}">${c[0]==='T'?'10':c[0]}${c[1]}</span>`;
  const short=s=>s.hero.map(c=>c[0]).join('')+(s.hero[0][1]===s.hero[1][1]?'s':s.hero[0][0]===s.hero[1][0]?'':'o');
  const VERDICT={right:['CORRECT','✓','var(--g-best)'],close:['CLOSE','≈','var(--g-inaccuracy)'],wrong:['MISS','✗','var(--g-blunder)']};
  const KEY='rivlRiverTrainer';
  function make(){
    const view=doc.getElementById('riverCall'),$=id=>doc.getElementById('rc'+id),V=root.RivlPuzzleView;
    if(!view||!V)return null;
    view.innerHTML=`<button class="rivl-back outline" id="rcBack" type="button">← BACK TO TRAINING</button>
      <h1>RIVER: CALL OR FOLD</h1>
      <div class="hr-head"><div class="hr-seats rc-sizes" id="rcSizes" role="group" aria-label="Bet sizes to practice"></div></div>
      <div class="pz-layout hr-layout">
        <div class="panel pz-spot hr-spot" id="rcSpot">
          <div class="pz-felt">
            <div class="pz-tags"><span id="rcDifficulty" class="pz-diff" hidden></span><span id="rcDepth"></span></div>
            <div class="pz-seat pz-villain"><div class="pz-hidden-cards"><span class="pz-card back sm"></span><span class="pz-card back sm"></span></div><div class="pz-seat-tag"><span class="pz-pos" id="rcVillainPos"></span><span>Opponent</span></div></div>
            <div class="pz-bet" id="rcVillainBet"></div>
            <div class="pz-center"><div class="pz-street" id="rcStreet"></div><div class="pz-board" id="rcBoard"></div><div class="pz-pot">POT <b id="rcPot">–</b></div></div>
            <div class="pz-bet pz-hero-bet" id="rcHeroBet" hidden></div>
            <div class="pz-seat pz-me"><div class="pz-hand" id="rcHand"></div><div class="pz-seat-tag"><span class="pz-pos" id="rcHeroPos"></span><span>You · <span id="rcStack"></span></span></div></div>
          </div>
          <ol class="pz-story" id="rcStory"></ol>
          <h3 class="pz-q" id="rcQ"></h3>
          <div class="pz-choices hr-choices" id="rcChoices"></div>
          <div class="hr-answer" id="rcAnswer" hidden aria-live="polite">
            <div id="rcVerdict" class="pz-verdict"></div>
            <div id="rcWhy" class="pz-why"></div>
            <button type="button" class="gold hr-next" id="rcNext">NEXT HAND</button>
            <p class="hr-keys">Keys: C call, F fold, Enter next hand</p>
          </div>
        </div>
        <div class="panel hr-chart rc-math">
          <div class="hr-chart-head"><h3 class="pz-sub">THE MATH</h3><span id="rcSize" class="hr-pct"></span></div>
          <div class="rc-math-wrap"><div id="rcMath"></div><div class="hr-lock" id="rcLock"><span>Make your call to see the math</span></div></div>
          <p class="hr-fine">Every hand in their range is counted exactly, after removing the cards you can see. Calling is worth equity × (pot + your call) − your call; folding is worth 0. RIVL's decision grader rates both, the same way it grades your river decisions at the table.</p>
          <button type="button" class="gold hr-next hr-next-low" id="rcNext2" hidden>NEXT HAND</button>
          <h3 class="pz-sub hr-prog-title">YOUR PROGRESS</h3>
          <div class="pz-stats hr-stats"><div><b id="rcStreak">0</b><small>STREAK</small></div><div><b id="rcAcc">–</b><small>CORRECT</small></div><div><b id="rcBest">0</b><small>BEST STREAK</small></div></div>
          <div class="hr-recent" id="rcRecent" aria-label="Your last hands"></div>
        </div>
      </div>`;
    const load=()=>{let s=null;try{s=JSON.parse(localStorage.getItem(KEY))}catch{}
      s=s&&typeof s==='object'?s:{};return Object.assign({size:'ALL',n:0,c:0,streak:0,best:0,sizes:{},recent:[]},s)};
    const st=load(),save=()=>{try{localStorage.setItem(KEY,JSON.stringify(st))}catch{}};
    if(!['ALL',...SIZES.map(z=>z[0])].includes(st.size))st.size='ALL';
    let spot=null,answered=false,bag=[];
    const pool=()=>BUILT.filter(s=>st.size==='ALL'||sizeOf(s)===st.size);
    // Every spot in the filter comes up once before any repeats, never the same one twice in a row.
    function pick(){
      if(!bag.length){bag=pool().slice();for(let i=bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]]}
        if(bag.length>1&&spot&&bag[bag.length-1]===spot)bag.unshift(bag.pop())}
      return bag.pop();
    }
    function paintSizes(){
      $('Sizes').style.setProperty('--cols',4);
      $('Sizes').innerHTML=[['ALL','All bets'],...SIZES].map(([k,label])=>{const a=st.sizes[k]||[0,0];
        return `<button type="button" data-size="${k}" aria-pressed="${st.size===k}" title="${label}"><span>${k==='ALL'?'ALL<span class="hr-long"> BETS</span>':k==='OVER'?'OVERBET':k}</span>${k==='ALL'?'':`<small>${a[0]?pctOf(a[1],a[0]):'–'}</small>`}</button>`}).join('');
      $('Sizes').querySelectorAll('button').forEach(b=>b.onclick=()=>{st.size=b.dataset.size;bag=[];save();paintSizes();deal()});
    }
    function paintStats(){
      $('Streak').textContent=st.streak;$('Best').textContent=st.best;$('Acc').textContent=pctOf(st.c,st.n);
      $('Recent').innerHTML=st.recent.length?'<small>LAST HANDS</small>'+st.recent.map(r=>`<span class="hr-chip hr-v-${r.v}" title="${esc(r.c+' · '+r.p+': '+r.v)}">${esc(r.c)}<i>${esc(r.p)}</i></span>`).join(''):'';
    }
    function paintMath(locked){
      $('Lock').hidden=!locked;$('Math').classList.toggle('hr-locked',locked);
      const s=spot;
      $('Size').textContent=`${Math.round(s.share*100)}% of the pot`;
      if(locked){$('Math').innerHTML=`<div class="br-math rc-numbers"><div class="br-math-row"><div><small>YOUR EQUITY</small><b>??</b></div><div><small>NEEDED</small><b>??</b></div><div><small>POT ODDS</small><b>??</b></div></div><div class="br-eqbar"></div></div><div class="rc-range">${s.groups.map(()=>'<div class="rc-row"><span>&nbsp;</span></div>').join('')}</div>`;return}
      const rows=s.groups.map(g=>{
        const kind=g.lose?'lose':g.win?'win':'tie',tag={lose:'BEATS YOU',win:'YOU WIN',tie:'SPLIT'}[kind];
        return `<details class="rc-row rc-${kind}"><summary><span class="rc-name">${esc(g.name)}</span><b>${g.n}</b><em>${tag}</em></summary><p>${g.combos.map(c=>`<span class="rc-combo">${c.map(mini).join('')}</span>`).join('')}</p></details>`}).join('');
      const g=s.grades,sign=x=>x>0?'+'+x.toFixed(1):x<0?'−'+(-x).toFixed(1):'0';
      $('Math').innerHTML=`<div class="br-math rc-numbers"><div class="br-math-row"><div><small>YOUR EQUITY</small><b>${pct(s.eq)}</b></div><div><small>NEEDED</small><b>${pct(s.need)}</b></div><div><small>POT ODDS</small><b>${((s.pot+s.bet)/s.bet).toFixed(1)} : 1</b></div></div>
        <div class="br-eqbar ${s.eq>=s.need?'over':'under'}" role="img" aria-label="Equity ${pct(s.eq)}; a call needs ${pct(s.need)}"><span style="--w:${(s.eq*100).toFixed(1)}%"></span><i style="left:${(s.need*100).toFixed(1)}%"></i></div>
        <p>You call ${bb(s.bet)} to win ${bb(s.pot+s.bet)}: ${bb(s.bet)} ÷ ${bb(s.pot+2*s.bet)} = ${pct(s.need)}. You beat ${s.win}${s.tie?` and split ${s.tie}`:''} of the ${s.total} hands they bet: ${pct(s.eq)}.</p></div>
        <div class="rc-range"><div class="rc-range-head"><span>THEIR RIVER BETS</span><span>HANDS</span></div>${rows}
          <div class="rc-total"><span>${s.lose} beat you · ${s.win} you beat${s.tie?` · ${s.tie} split`:''}</span><b>${s.total}</b></div></div>
        <div class="rc-evs">${['call','fold'].map(a=>`<div class="rc-ev g-${g[a].label.toLowerCase()}${a===s.best?' best':''}"><span>${a==='call'?`Call ${bb(s.bet)}`:'Fold'}</span><b>${a==='call'?sign(s.evCall)+' BB':'0 BB'}</b><em><i>${esc(g[a].glyph)}</i>${esc(g[a].label)}</em></div>`).join('')}</div>`;
    }
    function deal(){
      spot=pick();answered=false;
      const s=spot;
      V.paintSpot('rc',{...s,street:'River',pot:s.pot*100,bet:s.bet*100,stack:s.stack*100,heroBet:0,choices:[]},()=>{});
      $('Depth').textContent=`${s.threeBet?'3-BET POT':'HEADS-UP'} · 100 BB DEEP`;
      $('Q').textContent=`${s.villainPos} ${s.allIn?'IS ALL-IN FOR':'BETS'} ${bb(s.bet).toUpperCase()} INTO ${bb(s.pot).toUpperCase()}. CALL OR FOLD?`;
      $('Choices').style.setProperty('--n',2);
      $('Choices').innerHTML=`<button type="button" class="pz-choice" data-act="call">CALL<small>${bb(s.bet)} to win ${bb(s.pot+s.bet)}</small><kbd>C</kbd></button><button type="button" class="pz-choice" data-act="fold">FOLD<kbd>F</kbd></button>`;
      $('Choices').querySelectorAll('button').forEach(b=>b.onclick=()=>answer(b.dataset.act));
      $('Answer').hidden=$('Next2').hidden=true;
      paintMath(true);paintStats();
    }
    function answer(act){
      if(!spot||answered)return;answered=true;
      const s=spot,j=judge(s,act),v=j.v,size=sizeOf(s);
      st.n++;if(v==='right'){st.c++;st.streak++;st.best=Math.max(st.best,st.streak)}else if(v==='wrong')st.streak=0;
      const k=st.sizes[size]||(st.sizes[size]=[0,0]);k[0]++;if(v==='right')k[1]++;
      st.recent=[{c:short(s),p:size==='OVER'?'OVERBET':size,v},...st.recent].slice(0,10);save();
      $('Choices').querySelectorAll('button').forEach(b=>{b.disabled=true;b.classList.toggle('best',b.dataset.act===s.best);b.classList.toggle('picked',b.dataset.act===act)});
      const [word,glyph,color]=VERDICT[v],eq=pct(s.eq),need=pct(s.need),Best=s.best==='call'?'Call':'Fold';
      const loss=s.grades[act].lossBB;
      const text=v==='right'?`${Best}. You win ${eq} of the time against the hands they bet, and a call needs ${need}.`
        :v==='close'?`${Best} is a little better: you win ${eq} and need ${need}, so the ${act} gives up only about ${loss.toFixed(1)} BB.`
        :`${Best}. You win ${eq} of the time against the hands they bet, and a call needs ${need}. The ${act} gives up about ${loss.toFixed(1)} BB.`;
      $('Verdict').style.setProperty('--gc',color);
      $('Verdict').innerHTML=`<span class="pz-glyph">${glyph}</span><div><strong>${word}</strong><span>${esc(text)}</span></div>`;
      const ev=Math.abs(s.evCall).toFixed(1);
      const play=s.best==='call'?`You need to win ${need} of the time and you win ${eq}, so calling makes about ${ev} BB on average.${s.eq<.5?' You lose this pot more often than you win it, but the wins pay for the losses.':''}`
        :`You need to win ${need} of the time and you win only ${eq}, so calling loses about ${ev} BB on average. Your hand is good against their bluffs, but they do not have enough of them.`;
      $('Why').innerHTML=[['YOUR HAND',s.hand],['THEIR RANGE',`${s.read} That is ${s.lose} hands that beat you and ${s.win} you beat${s.tie?`, plus ${s.tie} that split`:''}.`],['THE PRICE',play]]
        .map(([h,t])=>`<div><h4>${h}</h4><p>${esc(t).replace(/\b([2-9TJQKA])([♠♥♦♣])/g,(m,r,u)=>mini(r+u))}</p></div>`).join('');
      $('Answer').hidden=$('Next2').hidden=false;
      paintMath(false);paintStats();paintSizes();
      if(matchMedia('(max-width:900px)').matches)$('Q').scrollIntoView({behavior:'smooth',block:'start'});
      else{const b=$('Verdict').getBoundingClientRect();if(b.bottom>innerHeight)scrollBy({top:b.bottom-innerHeight+24,behavior:'smooth'})}
    }
    function next(){deal();const f=$('Spot').getBoundingClientRect();if(f.top<0)$('Spot').scrollIntoView({behavior:'smooth',block:'start'})}
    $('Next').onclick=$('Next2').onclick=next;
    $('Back').onclick=()=>root.show('training');
    return{
      get spot(){return spot},
      open(){if(!spot){paintSizes();deal()}},
      key(e){const k=e.key.toLowerCase();if(!spot)return false;
        if(!answered){if(k==='c'||k==='f'){answer(k==='c'?'call':'fold');return true}}
        else if(k==='enter'||k===' '||k==='n'){next();return true}
        return false},
      stat(){const s=load();return s.n?`${s.n} hands played · ${pctOf(s.c,s.n)} correct · best streak ${s.best}`:`${BUILT.length} river spots. Progress is saved in this browser.`},
      started:()=>load().n>0,
    };
  }
  // The hub card: a river board with the call-or-fold question.
  const art=()=>`<span class="rc-art"><span>${['K♠','8♠','3♦','2♣','4♥'].map(mini).join('')}</span><span class="rc-art-q"><b>CALL</b><i>or</i><b>FOLD</b></span></span>`;
  const T2=root.RivlTraining;
  if(T2&&T2.add&&doc.getElementById('riverCall'))T2.add({view:'riverCall',eyebrow:'RIVER',name:'River: Call or Fold',art,make,
    text:'They bet the river and you hold a bluff catcher. Learn to call or fold from the price and the hands their story allows.'});
})(typeof window!=='undefined'?window:globalThis);
