/* RIVL scripted practice: 10 set hands against 4 bots, always dealt in this order.
   Seats: 0 You, 1 Ace, 2 Rico, 3 Luna, 4 Nash. The bots see only their own cards and play
   the move the grader rates best (RivlRating.chooseBest), with no randomness, so the same
   moves from you replay the same hand. Blinds stay 5/10 and anyone under 1,000 chips tops up
   to 1,000 before each hand, so every hand is played 100 big blinds deep by all five seats.
   "best" is who holds the best hand if everyone goes to the river. */
window.RIVL_SCRIPTED_HANDS=[
  {title:'Aces vs kings',best:'You (set of aces on the river)',
   hole:[['A♠','A♥'],['K♣','K♦'],['9♠','8♠'],['7♦','2♣'],['Q♥','J♣']],
   board:['2♦','7♠','K♥','4♣','A♦']},
  {title:'Flush over flush',best:'You (ace-high flush)',
   hole:[['A♥','5♥'],['9♣','9♦'],['K♥','Q♥'],['J♠','T♠'],['6♣','4♦']],
   board:['J♥','8♥','3♠','2♥','T♣']},
  {title:'Set over set',best:'Luna (set of jacks beats your set of eights)',
   hole:[['8♣','8♦'],['A♣','Q♦'],['K♠','4♠'],['J♦','J♣'],['K♥','T♥']],
   board:['8♥','J♠','3♣','6♦','2♠']},
  {title:'Straight on the river',best:'You (jack-high straight)',
   hole:[['9♠','T♠'],['K♦','K♥'],['A♣','7♣'],['Q♣','Q♦'],['5♥','3♥']],
   board:['7♦','8♣','2♥','K♠','J♦']},
  {title:'Fold the worst hand',best:'Ace and Rico split (both have the ace-high straight)',
   hole:[['7♣','2♦'],['A♦','K♦'],['A♥','K♣'],['9♣','9♥'],['Q♣','Q♥']],
   board:['Q♠','J♦','T♥','4♣','3♠']},
  {title:'Full house vs flush',best:'You (queens full of nines)',
   hole:[['Q♠','Q♣'],['T♦','T♠'],['K♣','J♦'],['6♠','5♠'],['A♥','7♥']],
   board:['Q♥','9♥','4♥','9♣','2♠']},
  {title:'Four of a kind',best:'You (four sixes)',
   hole:[['6♥','6♠'],['K♦','Q♠'],['A♠','2♠'],['9♦','8♦'],['J♥','J♣']],
   board:['6♦','K♣','6♣','K♥','3♦']},
  {title:'Missed draw',best:'Rico (pair of aces); your straight draw misses',
   hole:[['5♦','4♦'],['Q♣','Q♥'],['A♠','9♥'],['8♠','8♣'],['T♥','2♣']],
   board:['A♣','7♦','6♣','K♠','J♣']},
  {title:'Royal flush',best:'You (royal flush on the flop)',
   hole:[['A♣','K♣'],['A♦','K♥'],['Q♥','Q♦'],['9♣','8♣'],['J♠','T♦']],
   board:['Q♣','J♣','T♣','2♦','9♥']},
  {title:'Full house finale',best:'You (aces full of kings)',
   hole:[['A♠','K♦'],['A♥','Q♣'],['8♥','8♦'],['K♠','J♠'],['T♣','9♣']],
   board:['A♦','8♣','2♥','K♥','A♣']}
];
// Builds the deck for a scripted hand so the engine's normal pops deal it: hole cards
// go two at a time to each seat with chips (seat order), then the board in order.
window.rivlScriptedDeck=function(n,players){
  const h=window.RIVL_SCRIPTED_HANDS[n-1],used=new Set([...h.hole.flat(),...h.board]);
  const holes=players.flatMap((p,i)=>p.stack>0?h.hole[i]:[]);
  const rest=shuffle().filter(c=>!used.has(c)),dealt=[...holes,...h.board];
  return [...rest,...h.hole.flatMap((cards,i)=>players[i].stack>0?[]:cards),...dealt.reverse()];
};
