#!/bin/bash
# Record and cut RIVL's ?clips hands one at a time, at phone size.
# usage: scripts/clips/all.sh FIRST LAST [WORKDIR]   e.g. scripts/clips/all.sh 1 20
# Needs node with Playwright + Chromium, python3 and ffmpeg. Finished clips land in media/clips/videos/.
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd); HERE="$REPO/scripts/clips"
W=${3:-$(mktemp -d)}; mkdir -p "$W"
(cd "$REPO" && setsid python3 -m http.server 8765 </dev/null >/dev/null 2>&1 &); sleep 1
for n in $(seq "$1" "$2"); do
  nn=$(printf %02d "$n")
  for try in 1 2; do
    node "$HERE/record_clips.js" "$W" 60 "$n" one && \
    ffmpeg -loglevel error -y -f concat -safe 0 -i "$W/frames.txt" -vf "fps=30,scale=1080:-2:flags=lanczos,format=yuv420p" \
      -c:v libx264 -crf 17 -preset medium "$W/raw-$n.mp4" && \
    python3 "$HERE/cut_clips.py" "$W/raw-$n.mp4" "$W/cut-$n" --first-hand "$n" && \
    cp "$W/cut-$n/hand-$nn.mp4" "$REPO/media/clips/videos/" && \
    ffmpeg -loglevel error -y -ss 12 -i "$REPO/media/clips/videos/hand-$nn.mp4" -frames:v 1 -vf scale=360:-2 -q:v 4 "$REPO/media/clips/posters/hand-$nn.jpg" && \
    echo "OK $n" && break
    echo "RETRY $n"
  done
done
pkill -f "http.server 8765"
echo DONE
