#!/usr/bin/env python3
"""Cut a screen recording of RIVL's /?clips mode into one video per hand.

The mode shows a dark ~1.4 s title card ("HAND n") between hands. We find those
dark stretches with ffmpeg's signalstats (average brightness) and cut there, so
each output clip opens on its own title card and ends right before the next one.

usage: cut_clips.py RECORDING.mp4 OUTDIR [--vertical] [--first-hand N]
"""
import argparse, json, os, re, subprocess, sys

TITLE = 1.5  # seconds of title card kept at the head of each clip (the app shows it for 1.4 s)

def dark_runs(path, thresh, min_len):
    cmd = ["ffmpeg", "-hide_banner", "-i", path, "-vf",
           "scale=160:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
           "-an", "-f", "null", "-"]
    out = subprocess.run(cmd, capture_output=True, text=True).stderr
    t, frames = None, []
    for line in out.splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m: t = float(m.group(1)); continue
        m = re.search(r"YAVG=([\d.]+)", line)
        if m and t is not None: frames.append((t, float(m.group(1))))
    runs, start = [], None
    for t, y in frames:
        if y < thresh and start is None: start = t
        elif y >= thresh and start is not None:
            if t - start >= min_len: runs.append((start, t))
            start = None
    if start is not None and frames and frames[-1][0] - start >= min_len:
        runs.append((start, frames[-1][0]))  # the recording stopped on a title card
    merged = []
    for r in runs:  # a stray bright frame can split one title card in two
        if merged and r[0] - merged[-1][1] < 0.4: merged[-1] = (merged[-1][0], r[1])
        else: merged.append(r)
    return merged, (frames[-1][0] if frames else 0), frames

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("outdir")
    ap.add_argument("--vertical", action="store_true", help="also make 1080x1920 crops")
    ap.add_argument("--thresh", type=float, default=None, help="brightness cutoff (auto if unset)")
    ap.add_argument("--min-len", type=float, default=0.8)
    ap.add_argument("--first-hand", type=int, default=1)
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    thresh = a.thresh
    if thresh is None:
        _, _, frames = dark_runs(a.video, 0, 99)  # just sample brightness
        ys = sorted(y for _, y in frames)
        thresh = ys[int(len(ys) * 0.5)] * 0.75   # well below the typical table frame
    runs, end, _ = dark_runs(a.video, thresh, a.min_len)
    if not runs: sys.exit(f"no title cards found (thresh {thresh:.1f}); try --thresh")
    # Start each clip on its title card only (skip the 3-2-1 countdown or a pause before it),
    # and end it where the next dark card begins.
    starts = [max(s, e - TITLE) for s, e in runs]
    stops = [s for s, _ in runs[1:]] + [end]
    made = []
    for i in range(len(runs)):
        s, e = starts[i], stops[i]
        if e - s < 4: continue  # a dark card with nothing after it (end of the recording)
        n = a.first_hand + i
        out = os.path.join(a.outdir, f"hand-{n:02d}.mp4")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{s:.3f}", "-to", f"{e:.3f}",
                        "-i", a.video, "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", out], check=True)
        if a.vertical:
            vout = out.replace(".mp4", "-9x16.mp4")
            vf = "scale=-2:1920,crop=min(iw\\,1080):1920,pad=1080:1920:(ow-iw)/2:0:black"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out, "-vf", vf,
                            "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy",
                            "-movflags", "+faststart", vout], check=True)
        made.append({"hand": n, "start": round(s, 2), "end": round(e, 2), "file": out})
    json.dump(made, open(os.path.join(a.outdir, "cuts.json"), "w"), indent=1)
    for m in made: print(f"hand {m['hand']:>2}: {m['start']:7.2f}s -> {m['end']:7.2f}s  {m['file']}")

if __name__ == "__main__": main()
