#!/usr/bin/env python3
"""Cut a screen recording of RIVL's /?clips mode into one video per hand.

The mode shows a dark title card ("HAND n") for about 1.4 s between hands. We read
the average brightness of every frame with ffmpeg's signalstats, find those dark
stretches and cut there:

- each clip starts on the first frame where its title card is fully faded in, so it
  never opens on the 3-2-1 countdown or a flash of the table;
- each clip ends on the last frame of its own answer screen, before the app swaps in
  the next hand's table and fades the next card in, so it never closes on a stray frame.

usage: cut_clips.py RECORDING.mp4 OUTDIR [--vertical] [--first-hand N] [--crf 18]
"""
import argparse, json, os, re, statistics, subprocess, sys

TITLE = 1.5     # at most this many seconds of title card are kept at the head of a clip
STEADY = 1.2    # brightness wobble (0-255 scale) still counted as the same title card


def brightness(path):
    """[(time, average luma, luma change from the previous frame)] for every frame of the video."""
    cmd = ["ffmpeg", "-hide_banner", "-i", path, "-vf",
           "scale=160:-2,signalstats,metadata=print", "-an", "-f", "null", "-"]
    out = subprocess.run(cmd, capture_output=True, text=True).stderr
    t, frames, avg = None, [], None
    for line in out.splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m: t = float(m.group(1)); continue
        m = re.search(r"YAVG=([\d.]+)", line)
        if m: avg = float(m.group(1)); continue
        m = re.search(r"YDIF=([\d.]+)", line)
        if m and t is not None and avg is not None: frames.append((t, avg, float(m.group(1)))); avg = None
    return frames


def dark_runs(frames, thresh, min_len):
    """Index ranges [i, j) of frames darker than thresh lasting at least min_len seconds."""
    runs, start = [], None
    for i, (t, y, _) in enumerate(frames):
        if y < thresh and start is None: start = i
        elif y >= thresh and start is not None:
            if t - frames[start][0] >= min_len: runs.append((start, i))
            start = None
    if start is not None and frames[-1][0] - frames[start][0] >= min_len:
        runs.append((start, len(frames)))  # the recording stopped on a title card
    merged = []
    for r in runs:  # the fade between the countdown and the card can split one dark stretch in two
        if merged and frames[r[0]][0] - frames[merged[-1][1] - 1][0] < 0.4: merged[-1] = (merged[-1][0], r[1])
        else: merged.append(r)
    return merged


def title_start(frames, i, j):
    """First frame of the steady title card that ends a dark run (skips the fade-in and countdown)."""
    last = frames[j - 1][1]
    k = j - 1
    while k > i and abs(frames[k - 1][1] - last) <= STEADY: k -= 1
    return k


def clean_end(frames, j):
    """Index just past the last full-brightness frame before the dark run starting at frame j.

    When the answer screen ends, the app swaps in the next hand's table (a dimmer frame) and fades
    the next card in. Walk back past those frames to the last frame of the answer screen."""
    t0 = frames[j][0]
    plateau = [y for t, y, _ in frames if t0 - 1.0 <= t < t0 - 0.3]
    if not plateau: return j
    level = statistics.median(plateau)
    k = j
    while k > 1 and frames[k - 1][1] < level - STEADY and t0 - frames[k - 1][0] < 0.6: k -= 1
    return k


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("outdir")
    ap.add_argument("--vertical", action="store_true", help="also make 1080x1920 crops")
    ap.add_argument("--thresh", type=float, default=None, help="brightness cutoff (auto if unset)")
    ap.add_argument("--min-len", type=float, default=0.8)
    ap.add_argument("--first-hand", type=int, default=1)
    ap.add_argument("--crf", type=int, default=18, help="x264 quality for the cut clips (lower is better)")
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    frames = brightness(a.video)
    if not frames: sys.exit("could not read the video")
    thresh = a.thresh or sorted(y for _, y, _ in frames)[len(frames) // 2] * 0.75  # well below a table frame
    runs = dark_runs(frames, thresh, a.min_len)
    if not runs: sys.exit(f"no title cards found (thresh {thresh:.1f}); try --thresh")
    step = statistics.median(b[0] - a[0] for a, b in zip(frames, frames[1:])) if len(frames) > 1 else 1 / 30
    end_time = frames[-1][0] + step
    made = []
    for n_run, (i, j) in enumerate(runs):
        k = title_start(frames, i, j)
        s = max(0.0, max(frames[k][0], frames[j - 1][0] - TITLE) - step / 4)  # a hair early so frame k is kept
        if n_run + 1 < len(runs):
            e = frames[clean_end(frames, runs[n_run + 1][0])][0] - step / 2  # stop before that frame
        else:
            e = end_time
        if e - s < 4: continue  # a dark card with nothing after it (end of the recording)
        n = a.first_hand + len(made)
        out = os.path.join(a.outdir, f"hand-{n:02d}.mp4")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{s:.3f}", "-to", f"{e:.3f}",
                        "-i", a.video, "-c:v", "libx264", "-crf", str(a.crf), "-preset", "medium",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", out], check=True)
        if a.vertical:
            vout = out.replace(".mp4", "-9x16.mp4")
            vf = "scale=-2:1920,crop=min(iw\\,1080):1920,pad=1080:1920:(ow-iw)/2:0:black"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out, "-vf", vf,
                            "-c:v", "libx264", "-crf", str(a.crf), "-pix_fmt", "yuv420p", "-c:a", "copy",
                            "-movflags", "+faststart", vout], check=True)
        made.append({"hand": n, "start": round(s, 3), "end": round(e, 3), "file": out})
    json.dump(made, open(os.path.join(a.outdir, "cuts.json"), "w"), indent=1)
    for m in made: print(f"hand {m['hand']:>2}: {m['start']:7.2f}s -> {m['end']:7.2f}s  {m['file']}")


if __name__ == "__main__": main()
