# RIVL online rooms

Private rooms let friends play Texas Hold'em together in the browser, with optional bots. The server deals, runs betting, side pots and showdown; browsers only see their own hole cards until showdown.

## How it is hosted
One Cloudflare Worker (`worker/rooms.js`, config in `wrangler.toml`) serves both the website (copied into `dist/` by `scripts/build-site.mjs`) and the room API (`/api/*`, `/ws/*`). Because the page and the API share one address, no server URL needs to be configured. To point the page at a different server, set `window.RIVL_ROOM_API` before `rooms.js` loads and add the site's origin to `ALLOWED_ORIGINS` in `wrangler.toml`.

Pushing to `main` runs `.github/workflows/deploy.yml`: tests first, then `wrangler deploy`. It needs the `CLOUDFLARE_API_TOKEN` secret and the `CLOUDFLARE_ACCOUNT_ID` variable (see README).

## Run it locally
```
npx wrangler dev
```
Open http://localhost:8787 in two browsers, create a room in one and join with its 6-character code in the other.

## Accounts, ratings and the lobby
- **Accounts** are a name plus a private sign-in code (no email or password). The code is shown once on the Profile page and can be copied to sign in on another device. Only a SHA-256 hash of the code is stored.
- **Online ratings** are computed on the server (`worker/directory.js`) with Glicko-2 from the room's own finishing order: players holding chips rank by stack, everyone else in reverse order of elimination, and leaving a match counts as being knocked out. A match is rated when 2+ signed-in players start it. Bot-practice ratings stay per-browser.
- **Open Tables** lists public rooms that have not started and have open seats. **Quick Play** joins the busiest open table or opens a new public one.
- One `Directory` Durable Object (SQLite) holds accounts, the leaderboard, the lobby and the daily budget.

## Staying on Cloudflare's free plan
The `DAILY_*` values in `wrangler.toml` cap online play per UTC day (defaults: 1,500 hands, 300 rooms, 500 new accounts). From the load test, a hand costs roughly 33 storage writes and 50 seconds of room time, so 1,500 hands stays under the free plan's daily Durable Object limits. When a cap is reached, new rooms and matches are refused with a clear message; matches already running get 25% extra before they stop unrated. Bot practice is static files and keeps working regardless. Keep-alive pings are answered by Cloudflare without waking a room.

## What works
- Up to 9 seats, host adds bots (Beginner to Expert; stronger bots raise more and fold less)
- Server-run hands: blinds that rise every 8 hands, 12-second turns, side pots, every hand at showdown revealed with its hand name
- Your seat survives a refresh, closed tab or dropped connection (the seat token is kept in this browser and reconnects automatically)
- Players who miss two turns sit out (auto check/fold) until they come back; when every human is away the table waits instead of dealing
- Next hand deals automatically; the host is handed to another player if the host leaves
- Leave room, host can remove players before a match, rematch or return to lobby after a match
- Abuse limits: API only answers this site's origin, per-IP rate limits on creating and joining rooms, 6-character codes, size limits on requests and messages, rooms idle for 6 hours are deleted
- Hibernating WebSockets, so idle rooms are not billed as active

## Not yet
- Grading of online decisions (online ratings use finishing order only)
- Account recovery if the sign-in code is lost
- Joining a match that is already running (join between matches instead)
- Chat, hand history download
