# RIVL v1.4.1 — Rated play

Open index.html in Chrome. Bot opponents only; no real money. Ratings are saved in this browser (localStorage).

## v1.4.1
- Rating blend switched to **60% placement + 40% decision accuracy** (was 40/60). Interface is the original v1.4.0 RIVL look.

## What's new in v1.4
- **Decision grading.** Every fold, call, check and raise (yours and the bots') is graded. RIVL estimates your equity against the hands each opponent is likely to hold given how they've bet this hand, compares the expected value of your action with the best option, and labels it Brilliant, Best, Excellent, Good, Inaccuracy, Mistake or Blunder.
- **Glicko-2 rating.** At match end you get one blended score against every opponent: 60% placement + 40% decision accuracy. Glicko-2 updates everyone's rating. Each opponent counts as 1/sqrt(N-1) of a game, so a 6-max match is about 2.2 games of evidence. New players start at 1500 ±350; below ±110 the rating is no longer provisional.
- **Live grades** appear on the table when AI Learning Mode is on. With it off, grades stay hidden until the match ends. The coach never shows the best move before you act.
- **Results screen** with rating change split into placement and decisions, accuracy, grade counts, best moment and biggest leak.
- **Real profile and ladder.** Sidebar, home, profile and leaderboard now show your actual rating, tier, history and the bot ladder. Reset is on the leaderboard page.
- **Smarter bots.** Bots choose from the same EV model with skill-based noise and their own styles (Ace is strongest, Mula weakest), and each carries its own rating.
- **Fixes.** 9-player tables now show all 8 opponents (v1.3.4 had 5 seats). Phone layout uses a tall table so seats no longer cover the board. Placement uses bust order for eliminated players. The match ends when you're knocked out. Leaving early leaves the match unrated.

## Files
- engine.js — cards, shuffle, hand evaluation (unchanged)
- rating.js — fast evaluator, range-based equity, decision grader, bot brain, Glicko-2, storage
- script.js — game flow (hooks added for grading, bust order and match results)
- ladder-ui.js — live grades, results screen, profile, leaderboard

## Tests
`node tests.js` runs the 12 engine checks plus 6 rating checks (fast evaluator vs engine on 3,000 showdowns, equity sanity, Glicko-2 against Glickman's published example, and grading of clear right and wrong plays).

## Known limits of the grader
It is a fast estimate, not a solver. It models ranges from each player's betting line, values the rest of the hand at showdown equity (no future betting, position or implied odds), and treats raises with a simple fold-frequency model. Bots use the same model, so a low-noise bot scores near 100%. For solver-quality grading, swap analyze() for precomputed solver data.
