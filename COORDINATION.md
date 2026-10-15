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
