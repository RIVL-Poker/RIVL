# RIVL feature map

A 3D map of everything built in RIVL: 67 features, 154 merged pull requests, 130 ideas and the content creation system, with the project threads and PRs behind each one.

- **Live version:** https://claude.ai/artifact/UfEHkEs7DYPHyUkt6RGrcZ. This is the one that gets updated as work lands.
- **This folder:** an unchanged copy of version 22 of that page (9 Nov 2026), with its screenshots and clip stills and the files it is built from.

## Open it

Clone or download the repo and open `feature-map/feature-map.html` in a browser. Keep `shots/` and `lib/` next to it, because the page shows the images in them. It needs an internet connection, because it loads three.js from cdn.jsdelivr.net.

Two things only work in the live version on claude.ai:

- the Save buttons in the Library, which read the project's files;
- the links to project threads, which need a claude.ai sign-in to the project.

## It is not part of the site

`scripts/build-site.mjs` copies a fixed list of files into `dist/`, so nothing in this folder is deployed to rivlpoker.com. `node tests.js` and `node tests-worker.mjs` don't read it either.

## How it is made (`source/`)

| File | What it holds |
| --- | --- |
| `features.py` | Every feature, idea and content piece, the links between them, and the Video cutting and Library stars. Most changes happen here. |
| `threads.json` | The project's threads: title, dates and state. |
| `prs.json` | Every merged PR with its files and line counts, made by `getprs_main.py` from `git log origin/main`. |
| `build.py` | Checks the data (each merged PR belongs to exactly one feature, and every link points at a real feature), then writes `site/data.js`. |
| `template.html` | The page itself: layout, 3D scene, panels and styles. |
| `assemble.sh` | Puts `site/data.js` into `template.html` and writes `site/feature-map.html`. |
| `getprs.py`, `recolor.py`, `branches.txt` | Helpers used while building it. |

To rebuild, put the files from `source/` in one folder and run `python3 build.py && bash assemble.sh` there. `build.py` needs Python 3 with Pillow. It reads the RIVL repo from `/home/user/rivl`, and screenshots and `clip-cutter/clips.json` from the project's files at `/mnt/project-files`. Outside a Claude session, point those two paths at local copies first.
