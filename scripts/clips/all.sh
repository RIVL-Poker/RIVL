#!/bin/bash
# Record and cut RIVL's ?clips hands one at a time, at phone size.
# usage: scripts/clips/all.sh FIRST LAST [WORKDIR]   e.g. scripts/clips/all.sh 1 20
# Set TIKTOK=1 to make the TikTok versions instead (media/clips/tiktok/): see tiktok_frame.sh.
# Needs node with Playwright + Chromium, python3 and ffmpeg. Finished clips land in media/clips/videos/.
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd); HERE="$REPO/scripts/clips"
W=${3:-$(mktemp -d)}; mkdir -p "$W"
(cd "$REPO" && setsid python3 -m http.server 8765 </dev/null >/dev/null 2>&1 &); sleep 1
OUT="$REPO/media/clips"; VF="fps=30,scale=1080:-2:flags=lanczos,format=yuv420p"; CRF=17
if [ "${TIKTOK:-}" = 1 ]; then
  # A 390 x 780 layout keeps every seat clear of the question box. clip-fixes.css applies to the recording
  # only. Keep the full 3x picture until tiktok_frame.sh places it clear of TikTok's buttons and text.
  export CLIP_H=780 CLIP_CSS="${CLIP_CSS:-$HERE/clip-fixes.css}"; OUT="$REPO/media/clips/tiktok"
  VF="fps=30,format=yuv420p"; CRF=12
fi
finish() { if [ "${TIKTOK:-}" = 1 ]; then bash "$HERE/tiktok_frame.sh" "$1" "$2"; else cp "$1" "$2"; fi; }
mkdir -p "$OUT/videos" "$OUT/posters"
for n in $(seq "$1" "$2"); do
  nn=$(printf %02d "$n")
  for try in 1 2; do
    node "$HERE/record_clips.js" "$W" 60 "$n" one && \
    ffmpeg -loglevel error -y -f concat -safe 0 -i "$W/frames.txt" -vf "$VF" \
      -c:v libx264 -crf "$CRF" -preset medium "$W/raw-$n.mp4" && \
    python3 "$HERE/cut_clips.py" "$W/raw-$n.mp4" "$W/cut-$n" --first-hand "$n" --crf "$CRF" && \
    finish "$W/cut-$n/hand-$nn.mp4" "$OUT/videos/hand-$nn.mp4" && \
    ffmpeg -loglevel error -y -ss 12 -i "$OUT/videos/hand-$nn.mp4" -frames:v 1 -vf scale=360:-2 -q:v 4 "$OUT/posters/hand-$nn.jpg" && \
    echo "OK $n" && break
    echo "RETRY $n"
  done
done
pkill -f "http.server 8765"
echo DONE
