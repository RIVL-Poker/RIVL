# RIVL coordination

Shared handoff file for everyone working on this repo, people and AI assistants (Claude, ChatGPT). The assistants can't talk to each other, so this file is how they stay in sync.

**Before you start a task:** read this file, then claim the task in "Who's working on what".
**When you finish (or stop):** update your row and add a dated entry to the Log. Don't edit or delete other people's log entries.

## Current state

- **Live site:** https://rivl.seanjallen04.workers.dev. One Cloudflare Worker serves the website and the multiplayer API (`/api/*`, `/ws/*`).
- **`main` is the only source of truth.** It holds the v1.5 menu, private rooms with server-run betting, seat rejoin, accounts, online ratings, Quick Play, the public lobby, rate limits and the daily free-plan budget (merged in PR #3).
- **Deploy:** every push to `main` runs `.github/workflows/deploy.yml`, which runs the tests, builds the site and deploys with Wrangler 4. The settings are the `CLOUDFLARE_API_TOKEN` secret and the `CLOUDFLARE_ACCOUNT_ID` variable.
- **Retired:** `markhenry88/RIVL-Backup2`. Its deploy job is switched off, so don't push work there.
- **Tests:** `node tests.js` (engine and ratings) and `node tests-worker.mjs` (room server). Build with `node scripts/build-site.mjs`.

## Working rules

1. Make one branch per task, cut from the latest `main`: `git checkout main && git pull && git checkout -b feature/<short-name>`.
2. Never commit straight to `main`. Open a PR into `main`.
3. Merge only when the `test` check is green. **Every merge deploys to the live site.**
4. Keep PRs small. Pull `main` often (`git merge origin/main` into your branch).
5. `rooms.js`, `worker/rooms.js`, `index.html` and `style.css` are shared hot spots. Note them in your row below before changing them.
6. The Cloudflare Pages preview links on PRs only serve the static files, so rooms, accounts and the leaderboard don't work there. Test multiplayer locally with `npx wrangler dev`, or on the live site after merging.
7. No secrets, tokens or API keys in this repo, including this file.

### Warning: stale branches

`feature/rivl-frontend-work` and `feature/sean-backend-work` were created from the **old** pre-merge code (`d47e6b3`), not from `main`. Before working on either one, run `git checkout <branch> && git merge origin/main`, or delete it and branch again from `main`.

## Who's working on what

| Who | Task | Branch | Files touched | Status |
|---|---|---|---|---|
| Claude | Multiplayer infrastructure test | (none, test only) | none | Done, see log |
| Claude | Stricter decision grading (preflop charts, tighter thresholds) | `claude/decision-grading-accuracy-cnnv3r` | rating.js, worker/grading.js, tests.js, README.md | PR open |
| Claude | Launch notices: Terms of Use, public privacy page, Support notices, 18+ line | `claude/support-launch-notices-a26yoz` | index.html, style.css, welcome-support.js, privacy.html, terms.html, legal.css, scripts/build-site.mjs | PR open |
| Claude | Training section + hand range trainer | `claude/project-thread-bkyllm` | training.js, index.html, style.css, script.js, rating.js (exports only), tests.js, scripts/build-site.mjs | Merged (#141) |
| Claude | Training: facing-a-raise drill | `claude/project-thread-bkyllm` | training.js, index.html, style.css, script.js, rating.js (exports only), tests.js, README.md | Merged (#142) |
| Claude | Standard facing-a-raise charts in the grader | `claude/project-thread-bkyllm` | rating.js, training.js (export only), tests.js, README.md | PR open |
| Claude | Player stats on the Profile, in every mode, saved to the account | `claude/project-thread-lkcyr9` | hand-stats.js, player-stats.js, player-stats.css, worker/rooms.js, worker/directory.js, worker/grading.js, index.html, script.js, ladder-ui.js, rating.js, account.js, tests.js, tests-worker.mjs, scripts/build-site.mjs, README.md | PR open |
| Claude | Freeroll Champion Banners, secret unlock, player cards | `claude/project-thread-azruh2` | banners.js, banners.css, assets/banners/, index.html, rooms.js, account.js, freeroll.js, worker/rooms.js, worker/tournament.js, worker/directory.js, tests-worker.mjs, scripts/build-site.mjs, README.md | PR open |
| Claude | Champion banners for the 4 Set Hands bots | `claude/project-thread-t0bii5` | scripted-hands.js, banners.js, banners.css, script.js, index.html | PR open |
| ChatGPT | _(add your task)_ | | | |

## Log

Newest at the bottom. Format: `### YYYY-MM-DD HH:MM UTC · Name`, then a few bullets on what changed, what's next and anything the others need to know.

### 2026-10-14 03:40 UTC · Claude
- Merged RIVL-Backup2 and the original's latest private-room polish into `main` (PR #3). It now deploys from this repo to the live site above.
- Fixed a room-server bug: busted players were dealt back in with 1,000 chips, which also skewed ratings. Leaderboard wins now go only to 1st place.
- Turned off Backup2's deploy job and closed PR #2.
- Open for the owner: delete the merged old branches, archive Backup2 and protect `main` (require a PR and the `test` check).
- Ideas not started: room "Table Settings" tab still says "Unranked"; bot-game profile stats are saved per browser only (could move to accounts).

### 2026-10-14 03:58 UTC · Claude
- Tested `main` (2ec4d51) by running the Worker locally with Wrangler 4.150.0: a 3-browser match with a bot, showdown reveal, game panel, refresh-rejoin, a player closing their tab and the host leaving all work. Rate limits, foreign-origin block and bad-input handling work. Load test: 30 tables of 8 for 90s, 0 errors.
- Not verified: the live URL itself (Claude's sandbox can't reach it). Someone should play a quick room on two phones.
- rushrush2005's frontend fixes (bot board isolation, rated label, room header mode) are now on `main` via PR #5.
- Launch limit to know: online play stops for the day after 1,500 hands / 300 rooms / 500 new accounts (free-plan budget in `wrangler.toml`).
- Full results and next steps: project file `reviews/multiplayer-test-2026-10-14.md`.

<!-- ChatGPT: add your first entry below this line, using the same format. -->

### 2026-10-15 02:40 UTC · Claude
- Bots now take a random 2–5 seconds on every decision, in bot practice (`script.js`) and online rooms (`worker/rooms.js`). The bot whose turn it is gets a pulsing gold ring and three bouncing dots, and the status line names who is thinking.
- Online rooms: the server starts a bot's think clock on its turn (`g.botThinking`, `g.deadline`) and the room alarm makes the move when it runs out. Each bot move is now its own alarm and save, so bot-heavy rooms use a few more storage writes per hand than before.

### 2026-10-15 03:30 UTC · Claude
- Login screen on load (`login.js`, replaces the welcome popup): Continue with Google, use a sign-in code, or play bots as a guest. Signed-in players skip it.
- Google sign-in: the Worker verifies the ID token (`worker/google.js`), then the Directory signs in the Google-linked account, links Google to the signed-in code account, or creates one after asking for a name. Each Google sign-in gets its own device key in a new `sessions` table; `/api/signout` ends only that one. Only Google's `sub` id is stored, no email.
- Needs `GOOGLE_CLIENT_ID` in `wrangler.toml` (public value); without it the Google button stays hidden.

### 2026-10-15 04:10 UTC · Claude
- Decision grading is stricter (branch `claude/decision-grading-accuracy-cnnv3r`). Preflop is now graded against standard opening/defending charts by seat instead of equity vs random hands; postflop "Best" needs the top EV option within 1% of the pot (was 2%, plus a floor that lifted small losses to Good).
- Opponent ranges now react to the board and bet size, so overbet shoves with one pair no longer grade as Best. Bots use the same model, so they shove less.
- `rating.js` analyze() reads `sbSeat`/`bbSeat` (player indexes) when present; `worker/grading.js` now passes them. Server grading samples 600 runouts (was 300).

### 2026-10-15 04:10 UTC · Claude
- Bot practice setup has a time limit picker (Off, 5, 10, 15 minutes; remembered per browser). Off is the default and counts time played. Timed games climb the five blind levels evenly over the limit; when time runs out the current hand plays out and the match ends on the normal results screen.
- The raise bar resets to the minimum legal raise at every new decision, in bot practice (`script.js`) and online rooms (`rooms.js`).
- Bot table board cards are centred (`.community` box was wider than its cards and left-aligned them).

### 2026-10-15 04:15 UTC · Claude
- Bot practice has a SAVE button next to LEAVE TABLE. It pauses everything (match clock, decision timer, bots) and stores the game in this browser (`localStorage` key `rivlBotSave`). The Play screen shows a "Saved bot game" card with Resume and Discard; starting a new bot game asks before discarding a save. Resuming clears the save. Saves are per device, not on the account.

### 2026-10-15 04:55 UTC · Claude
- Folded hands now slide into a face-down discard pile by the pot and leave the seat; folded players turn grey until the next deal; every seat shows its stack in big blinds under the avatar. Applies to bot practice, rooms and Ranked. New shared file `muck.js` (added to the build list); touched script.js, rooms.js, index.html, style.css.

### 2026-10-15 07:40 UTC · Claude
- Added a FULL SCREEN button to the match top bar (bot practice, online rooms and Ranked) and a collapse arrow for the desktop sidebar. Both live in `screen-modes.js`; styles are at the end of `style.css`.
- Full screen hides the sidebar and page header and uses the browser's real full screen where allowed (iPhone falls back to the same table-only view). Esc, the button, or leaving the match turns it off. The sidebar choice is saved per device.
- When the scene gets bigger on desktop (full screen or collapsed sidebar), the seat box is sized as a fraction of the scene so it stays on the painted Cairo rail. The normal layout is unchanged.

### 2026-10-20 21:20 UTC · Claude
- Friends moved into Profile, above Bot Practice Mode Rating; the Daily Puzzle opens from Play (Play stays lit, with a back button). Both sidebar entries are gone. `show('friends')` and `?friend=CODE` links land on the Profile section.
- "Active now" fix: any signed-in request (the friends list's own 1-minute refresh, signing in, joining a room) used to mark a player as seen, so a tab left open kept them "active" forever. Presence now comes only from `/api/presence`: a heartbeat every 2 minutes while the page is on screen, plus an "away" beacon when it's hidden or closed. The server decides `online` (5-minute window if no goodbye arrives) and `seenAgo` on its own clock.

### 2026-10-20 22:20 UTC · Claude
- Invite friends to a casual room: the room lobby (after Create Room) has an Invite Friends panel, online friends first, until the match starts. Invites are stored in the directory (`invites` table, one per pair, 15-minute expiry) and reach the friend in the reply to their presence heartbeat, now every 60 seconds. The friend gets a JOIN / NO THANKS pop-up on any page.
- New endpoints: `/api/friends/invite` {key,id,code} and `/api/friends/dismiss-invite` {key,from}; `/api/presence` now returns `invites`.

### 2026-10-20 23:20 UTC · Claude
- Online tables (rooms, Ranked, freeroll) now show your hand like bot practice: two large hole cards, the round clock on their left (shows "–" when it isn't your turn) and your BB count on their right, in place of the small seat pill.
- Dealer, SB and BB badges moved off every avatar into the BB count tag under the seat, in both modes, so profile pictures show in full.
- Fixed online seat spots: 9-player desktop seats were pushed off the rim by old head-first rules; phones and portrait tablets now use the bot practice table and seat ring.
- Known, same in both modes: on 9-player desktop the bottom-left seat sits partly behind your clock.

### 2026-10-21 03:30 UTC · Claude
- Ranked blinds now rise on the match clock every 2.5 minutes (`RANKED_BLINDS` in `worker/rooms.js`): 15/30, 25/50, 50/100, 100/200, 150/300, 250/500 on 1,000 stacks. No new hand is dealt after 14 minutes; the match then ends on chip count. Casual and private rooms keep blinds every 8 hands; the freeroll is unchanged.
- The room snapshot carries `blindClock` (level, next blinds, `nextAt`, `lastDealAt`); the BLINDS label counts down to the next level.
- New `amounts.js`: bets, the pot, the call button and the pot total can show in chips or big blinds. Tap the pot readout under the chip pile to switch; remembered per browser (`rivlAmountUnit`). Applies to bot practice and all online tables. Stacks were left alone (Kaden is working on chip counts).

### 2026-10-21 03:45 UTC · Claude
- The chips/BB toggle now also covers stacks: opponents' seat labels, your stack, and the Balance in the pot HUD (bot practice and online). The BB tag under each avatar stays in big blinds.
- Fixed a merge leftover from #108/#109 that overwrote the online pot total with chips, and gave the phone online HUD short labels (POT · BALANCE · EQUITY) so all three fit on one line.

### 2026-10-21 06:00 UTC · Claude
- Friend requests from Leaderboard → Match History: in a game you played, each other signed-in player gets + ADD FRIEND / REQUESTED / ACCEPT REQUEST / FRIENDS ✓. Requests (`friend_requests` table) only go to players you shared a recorded game with, and become a friendship when accepted; crossed requests become friends at once. Friend codes still add instantly.
- Incoming requests show in Profile → Friends (Accept / Decline) and as a pop-up (Accept / Later) delivered with the presence heartbeat. New endpoints `/api/friends/request|accept|decline`; `/api/friends` now returns `incoming` and `outgoing`; `/api/history/game` rows include the player's account `id`.

### 2026-10-21 06:20 UTC · Claude
- Friends is its own page again: sidebar is now Play, Freeroll, Leaderboard, Friends, Profile, Table Themes, Support. Everything friends-related (code, add, requests, list) moved out of Profile into `#friends`. The `show('friends')` → Profile alias is gone; invite links open the Friends page.

### 2026-10-21 07:30 UTC · Claude
- Player numbers for the owner at `/stats` (stats.html, stats.css, stats.js), locked by a new Cloudflare secret `STATS_KEY` (`npx wrangler secret put STATS_KEY`). Live: players online by activity (bots, casual, Ranked, freeroll, puzzle, browsing) and humans seated at tables dealing hands. History: daily/monthly actives, new players and accounts, players who played online, hands and matches by mode, freeroll turnout, peak online, day 1/7/30 return rates, CSV download.
- Counting lives in `worker/stats.js` (Directory tables `stats_*`). Every open page now sends the heartbeat: signed in to `/api/presence` (now with `visitor` and `activity`), guests to the new `/api/ping` (random `rivlVisitor` id in localStorage, `PING_LIMITER` rate limit). Crawlers and `navigator.webdriver` guests are skipped. Rooms send `dealtTo()` (mode, humans, bots, accounts) with each `/usage/hand` call. History before today was backfilled once from accounts, game history and puzzle answers.
- Privacy page updated (Player counts section, retention line). `rivlRooms.mode()` added to rooms.js.

### 2026-10-21 17:45 UTC · Claude
- All-in runouts: once no more betting is possible, the hands are turned face up and the board is dealt one street at a time (1.2 s apart on server tables via `g.runout` and the room alarm; about 1 s apart in bot games), and the winner is announced only after the river. Uncalled bets are handed back before the runout.
- Hands won by everyone folding no longer reveal undealt board cards in bot games, matching online tables.

### 2026-10-28 03:00 UTC · Claude
- Added the Back Room, an easter egg: knock five times on the spade in Support's new "About RIVL" panel (or open `/#backroom`) and a door opens to 24 hand-picked hard spots. You act with fold, call (showing the equity a call needs) or a raise slider with quick sizes as a share of the pot; every raise size is graded.
- Spots are built by `scripts/make-backroom.mjs` into `backroom-spots.js` (static, works on Pages previews). `puzzle.js` now shares its table and answer screen (`window.RivlPuzzleView`) with `backroom.js`. `tests.js` checks every spot's pot, price, EVs, made hand and answer.
- Support's nav icon is now an SVG like Friends: the "?" never showed in the collapsed sidebar on phones.

### 2026-10-28 03:30 UTC · Claude
- Play → Bot Practice has a fourth table, "5 PLAYERS · SET HANDS": you vs 4 bots (Ace, Rico, Luna, Nash) through 10 scripted hands, always dealt in the same order. The 3/6/9 bot tables are unchanged.
- The cards live in `scripted-hands.js` (hole cards per seat plus the board, with a title and who holds the best hand). Bots still pick their own bets. Anyone who busts rebuys for 1,000 so every seat gets all 10 hands; the match ends after hand 10 and is unrated.
- `style.css` gained 5-seat bot table positions (the 6-seat layout without the head seat).

### 2026-10-28 03:45 UTC · Claude
- Set Hands bots now play `RivlRating.chooseBest` instead of `chooseBot`: the preflop chart's play at the book size, then the top-EV option with no noise or style bias. All-in is only on the menu when it is no bigger than a pot-sized raise, and against a bet and a raise on one street they continue only if they beat the top half of the betting ranges. Every decision is seeded, so the same moves from you replay the same hand. The 3/6/9 bot tables keep `chooseBot`.
- Set Hands also keeps the blinds at 5/10 and tops anyone under 1,000 chips back up to 1,000 before each hand.
- Found in the grader (not changed): the preflop chart counts raisers still in the hand, so a 3-bet after the opener folds is graded as a single raise; and postflop it rates a flop or turn all-in with a big hand above a pot-sized bet, so normal value bets can grade as mistakes.

### 2026-10-28 23:59 UTC · Claude
- Spectator mode, only for freeroll tables and friends' tables. Freeroll page → "Watch a table" (anyone not still playing); Friends page → 👁 WATCH on a friend who is seated at any online table. Spectators get the seatless view (only hands shown at showdown) plus, away from the freeroll, their own friends' hole cards (`game.friendCards`, built per spectator socket); freeroll spectators see no hole cards at all. They can't act or chat, and are capped at 25 per table. Players see "👁 N WATCHING" on the felt.
- Spectators connect to `/ws/watch/<object id>` and send `{type:'watch',key}`; the room checks it's a freeroll table or that the key's account is a friend of someone seated, and drops a friend-spectator when no friend is left at the table. The table's join code is never sent: friends' heartbeats now carry `table` (stored as `accounts.at_table`), the Friends list only gets `watchable`, and `/api/watch` returns the object id. The freeroll view lists `watch` (table, object id, players) while running.

### 2026-10-29 00:31 UTC · Claude
- New **Training** section in the sidebar (`#training`, a hub of drill cards built from `DRILLS` in `training.js`; each drill is its own view, kept lit under Training via `NAV_FOR` in script.js). To add a drill: add an entry to `DRILLS` and a `<section>` in index.html.
- First drill, the **Hand Range Trainer** (`#rangeTrainer`): seat + hand with everyone folded to you, raise or fold, then the verdict (Correct, Close or Miss), why, and the seat's 13×13 opening chart with the other seats one tap away. 6-max and 9-max, any seat or all seats. Progress (streak, accuracy per seat, last hands) is kept in this browser (`localStorage` key `rivlRangeTrainer`).
- The charts are rating.js's preflop tiers (now exported as `RivlRating.TIERS` and `rfiTier`), so the trainer teaches exactly what the decision grader rewards. `tests.js` checks all 4,394 trainer answers against `grade()`.
- Badges/achievements are still parked.

### 2026-10-29 01:00 UTC · Claude
- Second Training drill, **Facing a Raise** (`#vsRaise`): one player opens to 2.5 BB before you and everyone else folds; 3-bet, call or fold. 6-max and 9-max, every seat after UTG including both blinds. After you answer: the verdict, why (the hand and the spot), and your seat's 3-bet / call / fold chart against that opener, with the other openers one tap away. Progress is kept under `localStorage` key `rivlRaiseTrainer`.
- The answers are `RivlRating.gradePreflop()` itself (now exported with `bookWindows`), fed the same book `analyze()` builds for the spot, and 3-bets go to 3x in position or 4x from the blinds, so the drill can never disagree with the grader. Correct = Best, Close = Excellent or Good, Miss = anything worse. `tests.js` checks the labels against `analyze()` + `grade()` for every seat and opener.
- `training.js` is now one shared drill page (`makeDrill`) plus a config per drill, and each drill renders into an empty `<section>` in index.html. To add a drill: add a config to `DRILLS` and an empty `<section id="…" class="view content-view">`, and map the id to `training` in `NAV_FOR`.
- Badges/achievements are still parked.

### 2026-10-29 02:38 UTC · Claude
- The grader's charts for facing one raise (`bookWindows` in rating.js) were too loose against early raises: the small blind 3-bet 11% against UTG (77+, KTs, QTs, JTs, AJo, KQo), and at 9-max a cold caller continued with as many hands as UTG opens. The big blind also defended the same 48% against the hijack as against the button.
- Now the small blind 3-bets tiers 0-1 (about 5%) against UTG to LJ, tiers 0-2 against the hijack and tiers 0-3 against the cutoff or later, with flats never wider than its 3-bet range. Cold callers and the big blind 3-bet only tier 0 against UTG, UTG+1 and MP. Cold calls are one tier tighter against UTG to HJ. Against a 2.5 BB open the big blind defends about 33% against the hijack, 48% against the cutoff and 68% against the button or small blind. Against bigger opens (up to 3.5 BB) it defends one tier tighter against the hijack and one tier wider against the button or small blind.
- This changes live grading (Ranked rooms via worker/grading.js) and the Set Hands bots (`chooseBest`) in these spots, as well as the facing-a-raise drill. `tests.js` now checks that the charts stay close to standard ones.

### 2026-10-29 17:00 UTC · Claude
- New **PLAYER STATS** panel on the Profile (under the Ranked tracker): hands, accuracy, win rate and mistakes in big blinds per 100 hands, VPIP, PFR, 3-bet, steal, c-bet, fold to c-bet, aggression, showdown, won at showdown, hands won; accuracy by street and by seat; the three biggest leaks; decision grades; and My Games with place, hands, accuracy, VPIP/PFR and net big blinds. Tabs for All, Bot Practice, Casual, Ranked and Freeroll.
- Online rooms log every action (`g.log`) and, at the end of each hand, add one record per signed-in player dealt in (`handStats()`, not players sitting out). Every signed-in decision is now graded in every mode, not just Ranked, with the same 1,500 samples as bot practice (`SERVER_ITERS` is `GRADE_ITERS`). A player's records go to the Directory when the match ends (with their place), when they leave or move tables, or every 100 hands; `pendingStats` retries like `pendingResults`.
- Bot practice records each hand in the browser (`window.rivlPracticeStats`, hooks in script.js), keeps a copy in `rivlStatsLive` so a closed tab loses nothing, and uploads finished or abandoned matches to `/api/player-stats/practice` once signed in. Practice uploads have their own daily budget (`DAILY_PRACTICE_LIMIT`, default 2,000 matches), so they never use up online play's.
- The Directory never takes counts from a room or a browser: it checks each hand record and counts it with `hand-stats.js`. Tables: `player_matches` (one row per player per match, or per freeroll table; the hand records are dropped after 90 days, the counts stay) and `player_totals` (each player's sum per mode). New columns `game_history_players.elo_after` and `usage.practice`. A match sent twice is saved once.
- The Ranked tracker's chart and list now come from the server, so they are the same on every device. Match History has a MINE filter. Bot practice lifetime accuracy is weighted by decision from now on (older matches keep their averages). Fixed: Ranked game history saved 0 hands for every match.
- Not done yet: a hand replay view and trends over time (the hand records are already stored for them), importing old browser-only practice history, and all-in luck.

### 2026-10-29 · Claude
- Added Freeroll Champion Banners (banners.js, banners.css). They stay invisible until unlocked from a hidden control in Support; the unlock is saved to the account.
- rooms.js now tags each seat with data-account and calls rivlBanners.decorate(seats) after rendering. worker/rooms.js reports knockouts and the winning five cards to the tournament; the Directory stores a detail column on freeroll_results and a banner column on accounts.
- New routes: /api/banners, /api/banners/me, /api/banners/save, /api/player (public player card).

### 2026-10-30 02:40 UTC · Claude
- Set Hands table only: Ace, Rico, Luna and Nash each wear a champion banner (The Throne, Dragon's Hoard, Moon Wolf, Frost King). The map is `RIVL_SCRIPTED_BANNERS` in scripted-hands.js; `rivlBanners.bot()` paints the seat and hovering it floats the banner. Shown to everyone, no vault needed. Other bot tables are unchanged.
