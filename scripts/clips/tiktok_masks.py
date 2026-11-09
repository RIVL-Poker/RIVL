#!/usr/bin/env python3
"""Make the masks tiktok_frame.sh uses (needs numpy and Pillow). usage: tiktok_masks.py [OUTDIR]

halo-l.png, halo-r.png (160 x 1560): how far the app's own left/right edge colours carry on past the
  picture, mainly the warm glow under the table. Full strength for the 10 px that sit under the
  picture's soft edge, then fading out over about 100 px; tapered at the top and bottom of the picture.
feather.png (780 x 1560): the picture's own soft edge: 8 px at the sides, 24 px at the top, 14 px at the bottom.
"""
import os, sys
import numpy as np
from PIL import Image

W, H, SIDE, UNDER = 780, 1560, 160, 10


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def save(a, path):
    Image.fromarray((a * 255 + 0.5).astype(np.uint8), "L").save(path)


def main(out):
    os.makedirs(out, exist_ok=True)
    y = np.arange(H)[:, None].astype(float)
    x = np.arange(SIDE)[None, :].astype(float)
    taper = smooth(np.minimum(y, H - 1 - y) / 60.0)
    right = np.exp(-(np.maximum(x - UNDER + 0.5, 0) / 50.0) ** 1.5) * taper
    save(right, os.path.join(out, "halo-r.png"))
    save(right[:, ::-1], os.path.join(out, "halo-l.png"))
    xx = np.arange(W)[None, :].astype(float)
    edge = np.minimum(np.minimum(smooth(xx / 8.0), smooth((W - 1 - xx) / 8.0)),
                      np.minimum(smooth(y / 24.0), smooth((H - 1 - y) / 14.0)))
    save(edge, os.path.join(out, "feather.png"))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "tiktok-masks"))
