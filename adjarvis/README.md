# rivlpoker.com/adjarvis

The RIVL feature map (the casino-night 3D map of features, PRs and ideas) as a page on the site.

- `adjarvis/index.html` is the page. Edit it here and merge to `main`; the next deploy puts it live at https://rivlpoker.com/adjarvis.
- The screenshots and clip stills it shows come from `feature-map/shots/` and `feature-map/lib/`. `scripts/build-site.mjs` copies them to `/adjarvis/shots/` and `/adjarvis/lib/` when it builds the site. Add new images there.
- It started as a copy of `feature-map/feature-map.html` (version 23, 11 Nov 2026). The only changes are the head lines at the top (doctype, charset, `noindex`, viewport, and `<base href="/adjarvis/">` so the images load whether or not the address ends in a slash). Refreshing `feature-map/` does not change this page; copy the new map over `index.html` and keep those head lines if you want it updated.
- The installed app's offline copy skips `/adjarvis`, so it never caches the map in place of the game.
- The page isn't linked from the game's menus and asks search engines not to index it. Remove the `noindex` line to change that.
