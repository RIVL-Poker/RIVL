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
