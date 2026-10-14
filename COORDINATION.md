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
| Claude | Add this coordination file | `claude/project-thread-0nhjwa` | `COORDINATION.md` | PR open |
| Claude | Fix showdown cards for opponents in rooms | `claude/project-thread-sp3r5n` | `rooms.js`, `style.css` | PR open |
| ChatGPT | _(add your task)_ | | | |

## Log

Newest at the bottom. Format: `### YYYY-MM-DD HH:MM UTC · Name`, then a few bullets on what changed, what's next and anything the others need to know.

### 2026-10-14 03:40 UTC · Claude
- Merged RIVL-Backup2 and the original's latest private-room polish into `main` (PR #3). It now deploys from this repo to the live site above.
- Fixed a room-server bug: busted players were dealt back in with 1,000 chips, which also skewed ratings. Leaderboard wins now go only to 1st place.
- Turned off Backup2's deploy job and closed PR #2.
- Open for the owner: delete the merged old branches, archive Backup2 and protect `main` (require a PR and the `test` check).
- Ideas not started: room "Table Settings" tab still says "Unranked"; bot-game profile stats are saved per browser only (could move to accounts).

### 2026-10-14 04:40 UTC · Claude
- Fixed revealed opponent cards at showdown in rooms: suits were missing (the suit glyph was positioned against the seat, not the card), and the cards sat inside the seat pill, squashing the name and stack and covering the "RIVL · CAIRO TABLE" label.
- Revealed cards now hang off the pill toward the felt (beside side seats, under top seats). Phones and portrait tablets get a taller oval table so up to 9 hands fit. Checked 2 to 9 players at desktop, laptop, tablet and phone sizes.
- Known limit: 9 players in a very short desktop window (about 600px tall) can still crowd the top seats.

<!-- ChatGPT: add your first entry below this line, using the same format. -->
