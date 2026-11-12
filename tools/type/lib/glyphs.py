"""Glyph-level helpers shared by the families: trace a component into a cleaned glyph, place it on its side
bearings, score it against its source, and draw the fidelity overlay."""
from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw

from . import geom
from .fit import refit
from .trace import Source, component_mask, potrace_mask


class Traced:
    """A traced outline with everything needed to score and overlay it later."""

    def __init__(self, contours, src: Source, box, mask, origin):
        self.contours = contours      # font units, X still in source-absolute units
        self.src = src
        self.box = box
        self.mask = mask
        self.origin = origin
        self.dx = 0.0                 # applied X shift (font units) when placed

    def to_px(self, upsample=1):
        s = self.src.scale
        ox, oy = self.origin
        dx = self.dx
        b = self.src.baseline_px
        return lambda p: (((p[0] - dx) / s - ox) * upsample, (b - p[1] / s - oy) * upsample)

    def score(self, contours=None):
        k = 4
        m = self.mask
        big = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize((m.shape[1] * k, m.shape[0] * k),
                                                                            Image.BILINEAR)) >= 128
        return geom.fidelity(contours if contours is not None else self.contours, big, self.to_px(k))


def trace(src: Source, anchors, alphamax=1.0, opttol=0.4, min_area=20, tol_px=0.7, corner_deg=35, clip=None,
          tol=6):
    mask, origin = component_mask(src, anchors, min_area=min_area, clip=clip, tol=tol)
    box = anchors
    rec, _ = potrace_mask(mask, origin, src, alphamax=alphamax, opttol=opttol)
    con = geom.clean(geom.contours_from(rec))
    con = geom.clean(refit(con, tol=tol_px * src.scale, corner_deg=corner_deg, step=max(1.0, 0.25 * src.scale)))
    return Traced(con, src, box, mask, origin)


def place(contours, lsb, rsb):
    """Shift contours so the left extreme sits at lsb; return (contours, advance, dx)."""
    x0, _, x1, _ = geom.bounds(contours)
    dx = lsb - x0
    return geom.translate(contours, dx, 0), (x1 - x0) + lsb + rsb, dx


def overlay_png(t: Traced, contours_placed, out_path, zoom=6, title=None):
    """Source crop (as the mask sees it, in grey) with the shipped outline stroked on top, at `zoom` x."""
    m = t.mask
    H, W = m.shape
    base = Image.fromarray((255 - m * 180).astype(np.uint8)).convert('RGB').resize((W * zoom, H * zoom), Image.LANCZOS)
    d = ImageDraw.Draw(base, 'RGBA')
    f = t.to_px(zoom)
    for con in contours_placed:
        pts = [f(p) for p in geom.flatten(con)]
        d.line(pts + [pts[0]], fill=(230, 40, 20, 255), width=2)
        for s in con:
            x, y = f(s[1])
            d.rectangle([x - 2, y - 2, x + 2, y + 2], fill=(20, 90, 230, 255))
    if title:
        d.text((6, 4), title, fill=(0, 0, 0, 255))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    base.save(out_path)


def render_preview(contours, out_path, h=200, upm_box=(0, -250, 1000, 950)):
    x0, y0, x1, y1 = geom.bounds(contours)
    s = h / (upm_box[3] - upm_box[1])
    W = int((x1 + 60) * s) + 1
    to = lambda p: (p[0] * s + 10, (upm_box[3] - p[1]) * s)
    r = geom.rasterize(contours, to, W + 20, h, ss=2)
    Image.fromarray((255 - r * 255).astype(np.uint8)).save(out_path)
