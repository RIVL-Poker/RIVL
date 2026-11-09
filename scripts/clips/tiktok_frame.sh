#!/bin/bash
# Frame one hand for TikTok's iPhone app.
# usage: scripts/clips/tiktok_frame.sh IN.mp4 OUT.mp4
#
# IN is a hand recorded at 390 x 780 css px at 3x (1170 x 2340), as TIKTOK=1 scripts/clips/all.sh does.
# OUT is 1080 x 2338 with the hand at 780 x 1560 in the middle (x 150-930, y 420-1980).
# Measured from an iPhone screenshot: TikTok shows a 1080 x 2338 video 1.0917x larger and 122 screen px
# higher, so its search bar covers video y < ~383, its caption covers y > ~2016 and its
# like / comment / share column covers x > ~933. The box above stays clear of all three.
# The app's own left/right edge colours (mainly the glow under the table) fade out past the sides,
# so the picture has no hard box edge. The masks in tiktok-masks/ come from tiktok_masks.py.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd); M="$HERE/tiktok-masks"
IN=$1; OUT=$2
# The masks and the backdrop are endless inputs, so stop after the clip's own frame count.
N=$(ffprobe -v error -count_packets -select_streams v -show_entries stream=nb_read_packets -of csv=p=0 "$IN")
ffmpeg -loglevel error -y -i "$IN" -loop 1 -i "$M/halo-l.png" -loop 1 -i "$M/halo-r.png" -loop 1 -i "$M/feather.png" -filter_complex "
[0:v]scale=780:1560:flags=lanczos,format=gbrp,split=3[fg][a][b];
[a]crop=2:1560:0:0,scale=1:104:flags=area,scale=160:1560:flags=bicubic,format=gbrap[l0];
[b]crop=2:1560:778:0,scale=1:104:flags=area,scale=160:1560:flags=bicubic,format=gbrap[r0];
[1:v]format=gray[hl];[l0][hl]alphamerge[l];
[2:v]format=gray[hr];[r0][hr]alphamerge[r];
[fg]format=gbrap[fga];[3:v]format=gray[fm];[fga][fm]alphamerge[fgm];
color=c=0x0a0705:s=1080x2338:r=30,format=gbrp[bg];
[bg][l]overlay=0:420:shortest=1:format=gbrp[b1];[b1][r]overlay=920:420:shortest=1:format=gbrp[b2];
[b2][fgm]overlay=150:420:shortest=1:format=gbrp,format=yuv420p" \
  -frames:v "$N" -c:v libx264 -crf 16 -preset slow -profile:v high -pix_fmt yuv420p \
  -colorspace bt470bg -color_range tv -movflags +faststart -r 30 "$OUT"
