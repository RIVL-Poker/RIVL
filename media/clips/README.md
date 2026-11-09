# Decision clips

Short vertical videos of RIVL's `?clips` mode: one "What's the best play?" hand per file.
This folder is not part of the website build (`scripts/build-site.mjs` copies a fixed list of files), so nothing here is deployed.

- `videos/hand-01.mp4` … `hand-20.mp4`: 1080 × 2338, H.264, no audio, 22 to 29 seconds each. Each opens on its HAND n card and ends on the answer reveal.
- `posters/hand-NN.jpg`: one still from the middle of each hand.
- `clips.json`: one entry per clip with its street, difficulty, cards, options, answer and explanation.
- `all-20-answers.png`: the 20 answer reveals on one sheet.

## Making them again

`scripts/clips/all.sh 1 20` serves the repo locally, records each hand in headless Chromium at phone size (3× resolution), and cuts it with `scripts/clips/cut_clips.py`. The cutter finds the dark HAND n title card between hands and cuts there. It also works on a screen recording you made yourself:

    python3 scripts/clips/cut_clips.py my-recording.mp4 out/ [--vertical]
