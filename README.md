# RIVL — Rated play

Free Texas Hold'em, no real money. Practice against bots (rated on this device), or play online: Quick Play, open tables, or a private room with friends. Signed-in players get a shared online rating and leaderboard.

## Play
- **Online:** once deployed, open the site's address (for example `https://rivl.<your-subdomain>.workers.dev`).
- **Locally:** `npx wrangler dev`, then open http://localhost:8787. Opening `index.html` as a file still works for bot games, but online rooms need the server.

## Deploy (one time setup)
Every push to `main` tests and deploys the site and the rooms server together to Cloudflare (`.github/workflows/deploy.yml`). It needs two settings in GitHub, under Settings > Secrets and variables > Actions:
1. Secret `CLOUDFLARE_API_TOKEN`: a Cloudflare API token made from the **Edit Cloudflare Workers** template.
2. Variable `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID (shown on the Workers & Pages overview page).

### Sign in with Google (optional)
The site opens on a login screen. Its Google button appears once `GOOGLE_CLIENT_ID` in `wrangler.toml` holds an OAuth 2.0 **Web application** client ID from Google Cloud Console (APIs & Services > Credentials), with the site's addresses (for example `https://rivlpoker.com`) under Authorized JavaScript origins. The client ID is public, so it belongs in `wrangler.toml`; no client secret is needed. The server checks every Google token itself (`worker/google.js`).

Then run the workflow from the Actions tab (or push to `main`). The site appears at `https://rivl.<your-subdomain>.workers.dev`; a custom domain can be added in the Cloudflare dashboard under the Worker's Settings > Domains & Routes. See ROOMS.md for how online rooms work.

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
- profile.js — your display name (stored in this browser)
- rooms.js — private rooms client
- worker/rooms.js — Cloudflare Worker: serves the site and runs rooms
- worker/directory.js — accounts, online ratings, lobby and daily free-plan budget
- account.js — sign up / sign in and the online leaderboard
- login.js — the login screen (Google, sign-in code or guest)
- worker/google.js — verifies Google ID tokens

## Tests
`node tests-worker.mjs` plays 60 simulated room matches (chip conservation, no stuck turns, matches end) and checks reveal, reconnect, sit-out, leave/host hand-off, idle cleanup, accounts, rated results, the lobby and the free-plan budget.

`node tests.js` runs the 12 engine checks plus 8 rating checks (fast evaluator vs engine on 3,000 showdowns, equity sanity, Glicko-2 against Glickman's published example, grading of clear right and wrong plays, and the Ranked league bands).

## Known limits of the grader
It is a fast estimate, not a solver. It models ranges from each player's betting line, values the rest of the hand at showdown equity (no future betting, position or implied odds), and treats raises with a simple fold-frequency model. Bots use the same model, so a low-noise bot scores near 100%. Sampling is seeded from the spot, so re-grading the same decision always gives the same label. For solver-quality grading, swap analyze() for precomputed solver data.
