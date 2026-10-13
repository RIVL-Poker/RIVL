# RIVL online rooms — Phase 2 foundation

This branch adds a live shared **lobby**, not playable multiplayer poker yet.

## Deploy (Cloudflare)
1. Install Node.js and run `npx wrangler login`.
2. From the repo root run `npx wrangler deploy`. Cloudflare Durable Objects availability and plan requirements may apply.
3. Copy the resulting Worker HTTPS URL.
4. Set `window.RIVL_ROOM_API = 'https://YOUR-WORKER.workers.dev'` in `index.html` before the `rooms.js` script tag, or temporarily run `localStorage.setItem('rivlRoomApi','https://YOUR-WORKER.workers.dev')` in the browser console and reload.
5. Serve the frontend via Cloudflare Pages (or a local web server). Open two browsers, create a room and join with its five-character code.

## Working scope
- 9 slots, with the host occupying a seat after creating the room
- Real-time join/visibility/bot updates via WebSockets and Durable Objects
- Skill-only bot selection (Beginner, Intermediate, Advanced, Expert)
- Duplicate personalities permitted, unique generated names and poker avatars
- Host-only bot controls, private/public visibility state
- Bot practice unchanged

## Not yet implemented
- Public room discovery/search (public visibility is stored but not listed)
- Multiplayer poker gameplay, server-side shuffling, betting, turn clocks, and hand settlement
- Reconnection/reservation/leave cleanup, persistent identity, authentication, moderation, rate limiting
- Start match remains disabled deliberately; **do not advertise online poker as playable**.
- Room tokens must be protected against leakage, origin abuse, replay, and brute-force attacks before public deployment.

## Security notes
Do not publicly deploy this prototype until host authentication and authorization are hardened, including hiding host credentials from other clients, validating input and origins, handling disconnects, and limiting room creation. Room codes are not authorization tokens.
