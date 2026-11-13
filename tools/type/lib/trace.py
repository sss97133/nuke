"""Trace letters out of a committed source image into font-unit contours.

The pipeline for one glyph:
  source image -> crop (source pixels) -> one channel (or alpha) -> component mask (the glyph's own ink only,
  so tightly kerned neighbours never leak in) -> upsample by K with Lanczos -> Gaussian blur -> threshold at the
  ink midpoint -> potrace (bezier fit, corner detection) -> font units via one affine map shared by every glyph
  of the source (scale = capUnits / capPixels, origin = the measured baseline).

The raw potrace path is the measurement. `lib.geom.clean` turns it into the shipped outline (extrema nodes,
no micro segments) and `fidelity` scores the shipped outline against the source mask (IoU, worst deviation).
"""
from __future__ import annotations

import hashlib
import math
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
MAKES = os.path.join(REPO, 'nuke_frontend', 'public', 'stacks', 'makes')


def sha256_b64(path: str) -> str:
    import base64
    return base64.b64encode(hashlib.sha256(open(path, 'rb').read()).digest()).decode()


def load_channel(file: str, channel: str) -> np.ndarray:
    """Float array 0..1 where 1 = ink. channel: 'l-light' (white ink on dark), 'l-dark' (dark ink on light),
    'alpha' (cutout alpha), 'g-light' etc."""
    im = Image.open(os.path.join(MAKES, file))
    if channel == 'alpha':
        a = np.asarray(im.convert('RGBA'))[..., 3].astype(float) / 255.0
        return a
    name, pol = channel.split('-')
    rgb = np.asarray(im.convert('RGB')).astype(float) / 255.0
    if name == 'l':
        v = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    else:
        v = rgb[..., 'rgb'.index(name)]
    return v if pol == 'light' else 1.0 - v


@dataclass
class Source:
    """One committed source image and the affine map from its pixels to font units."""
    file: str
    channel: str
    lo: float            # ink levels: value <= lo is ground, >= hi is ink
    hi: float
    cap_px: float        # measured capital (or figure) height in source pixels
    baseline_px: float   # measured baseline row (source pixels, y down)
    cap_units: float     # target capital height in font units
    tilt_deg: float = 0.0  # measured page/part rotation, removed before tracing
    k: int = 8           # upsample factor
    blur: float = 0.55   # Gaussian sigma in source pixels
    shear: float = 0.0   # x shift per unit height removed (for photographed perspective), source px per px
    shear_pivot_px: float | None = None   # row the shear turns about (default: the baseline)
    _arr: np.ndarray | None = field(default=None, repr=False)

    @property
    def scale(self) -> float:
        return self.cap_units / self.cap_px

    def array(self) -> np.ndarray:
        if self._arr is None:
            a = load_channel(self.file, self.channel)
            a = np.clip((a - self.lo) / (self.hi - self.lo), 0, 1)
            if self.tilt_deg:
                a = ndimage.rotate(a, self.tilt_deg, reshape=False, order=1, mode='constant', cval=0)
            if self.shear:
                # remove a photographed lean: a point h px above the baseline sits shear*h px to the left in the
                # photo; move it back right. The image grows on the right so nothing is cut.
                pv = self.baseline_px if self.shear_pivot_px is None else self.shear_pivot_px
                pad = int(math.ceil(abs(self.shear) * pv)) + 2
                a = np.pad(a, ((0, 0), (0, pad)))
                a = ndimage.affine_transform(a, [[1, 0], [self.shear, 1]], offset=[0, -self.shear * pv], order=1)
            self._arr = a
        return self._arr

    def rgb(self) -> np.ndarray:
        """The photograph itself (cutouts over white), with the same levelling and de-shear as array()."""
        im = Image.open(os.path.join(MAKES, self.file)).convert('RGBA')
        bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        rgb = np.asarray(bg.convert('RGB')).astype(float) / 255.0
        chans = []
        for k in range(3):
            a = rgb[..., k]
            if self.tilt_deg:
                a = ndimage.rotate(a, self.tilt_deg, reshape=False, order=1, mode='constant', cval=1)
            if self.shear:
                pv = self.baseline_px if self.shear_pivot_px is None else self.shear_pivot_px
                pad = int(math.ceil(abs(self.shear) * pv)) + 2
                a = np.pad(a, ((0, 0), (0, pad)), constant_values=1)
                a = ndimage.affine_transform(a, [[1, 0], [self.shear, 1]], offset=[0, -self.shear * pv], order=1,
                                             cval=1)
            chans.append(a)
        return np.stack(chans, -1)

    def sha(self) -> str:
        return sha256_b64(os.path.join(MAKES, self.file))


def labels(src: Source, thr=0.5):
    key = ('_lab', thr)
    cache = src.__dict__.setdefault('_cache', {})
    if key not in cache:
        lab, n = ndimage.label(src.array() > thr)
        objs = ndimage.find_objects(lab)
        info = []
        for i, sl in enumerate(objs):
            if sl is None:
                continue
            area = int((lab[sl] == i + 1).sum())
            info.append((i + 1, (sl[1].start, sl[0].start, sl[1].stop, sl[0].stop), area))
        cache[key] = (lab, info)
    return cache[key]


def component_mask(src: Source, anchors, min_area=20, margin=6, tol=6, clip=None):
    """Soft ink of whole components picked by the (x0, y0) of their full bounding box (source px, after
    levelling), so a neighbour that a crop box would cut through can never leak in. `clip` (x0,y0,x1,y1) limits
    the picked ink to a region (to split a ligature). Returns (mask, (ox, oy))."""
    lab, info = labels(src)
    chosen = []
    for ax, ay in anchors:
        best = None
        for idx, bb, area in info:
            if area < min_area:
                continue
            d = max(abs(bb[0] - ax), abs(bb[1] - ay))
            if d <= tol and (best is None or d < best[0]):
                best = (d, idx, bb)
        if best is None:
            raise ValueError(f'no component near {ax},{ay} in {src.file}')
        chosen.append(best[1:])
    Hh, Ww = lab.shape
    X0 = max(0, min(bb[0] for _, bb in chosen) - margin)
    Y0 = max(0, min(bb[1] for _, bb in chosen) - margin)
    X1 = min(Ww, max(bb[2] for _, bb in chosen) + margin)
    Y1 = min(Hh, max(bb[3] for _, bb in chosen) + margin)
    a = src.array()[Y0:Y1, X0:X1]
    L = lab[Y0:Y1, X0:X1]
    keep = np.isin(L, [i for i, _ in chosen])
    grown = ndimage.binary_dilation(keep, iterations=2)
    # pixels of other components never count, even inside the grown rim
    others = (L > 0) & ~keep
    m = np.where(grown & ~ndimage.binary_dilation(others, iterations=1), a, 0.0)
    if clip is not None:
        cx0, cy0, cx1, cy1 = clip
        yy, xx = np.mgrid[Y0:Y1, X0:X1]
        m = np.where((xx >= cx0) & (xx < cx1) & (yy >= cy0) & (yy < cy1), m, 0.0)
    return m, (X0, Y0)


def potrace_mask(mask: np.ndarray, origin, src: Source, alphamax=1.0, opttol=0.2, turdsize=20):
    """Upsample, blur, threshold and potrace a soft mask; return a RecordingPen in font units."""
    k = src.k
    h, w = mask.shape
    pad = 4
    m = np.pad(mask, pad)
    im = Image.fromarray((m * 255).astype(np.uint8))
    im = im.resize(((w + 2 * pad) * k, (h + 2 * pad) * k), Image.LANCZOS)
    if src.blur:
        im = im.filter(ImageFilter.GaussianBlur(src.blur * k))
    bw = (np.asarray(im) >= 128)
    H, W = bw.shape
    with tempfile.TemporaryDirectory() as td:
        pbm = os.path.join(td, 'g.pbm')
        Image.fromarray(np.where(bw, 0, 255).astype(np.uint8)).convert('1').save(pbm)
        svg = os.path.join(td, 'g.svg')
        subprocess.run(['potrace', pbm, '-s', '-o', svg, '-a', str(alphamax), '-O', str(opttol),
                        '-t', str(turdsize * k * k), '--flat'], check=True)
        text = open(svg).read()
    ox, oy = origin
    s = src.scale
    rec = RecordingPen()
    # potrace svg: <g transform="translate(0,H) scale(0.1,-0.1)">; internal coords are 0.1 upsampled px, y up.
    # internal (px,py) -> upsampled (u,v) = (0.1px, H - 0.1py) -> source (ox - pad + u/k, oy - pad + v/k)
    # -> font (X,Y) = ((sx) * s, (baseline - sy) * s); X origin is fixed later by the glyph's left side bearing.
    sx_ = 0.1 / k
    a_ = s * sx_
    tx = s * (ox - pad)
    # Y = s*(baseline - (oy - pad + (H - 0.1py)/k)) = s*(baseline - oy + pad - H/k) + s*0.1/k*py
    ty = s * (src.baseline_px - oy + pad - H / k)
    pen = TransformPen(rec, (a_, 0, 0, a_, tx, ty))
    for d in re.findall(r'<path d="([^"]+)"', text):
        parse_path(d, pen)
    return rec, bw


def mask_to_units_raster(mask: np.ndarray, origin, src: Source, upm_px=0.5):
    """Rasterise a source mask into a font-unit grid (for fidelity scoring). Returns (bool array, transform)
    where transform maps grid (col,row) to font units: X = col*g + X0, Y = Y0 - row*g."""
    s = src.scale
    ox, oy = origin
    return mask > 0.5, (s, ox, oy)


def smooth_outline(contours, sigma_units=14.0, grid=4.0, alphamax=1.1, opttol=0.4):
    """Curvature-smooth an outline in font units: rasterise at `grid` units a pixel, blur by sigma, threshold at 0.5 and
    potrace. Thresholding the blur at half keeps a straight edge where it was and a member's width wherever it is
    wider than about three sigma; it removes bumps and dents narrower than that and rounds corners by about sigma.
    The reflections in a chrome photograph leave exactly such bumps along the traced stems and bowls."""
    from lib import geom
    x0, y0, x1, y1 = geom.bounds(contours)
    pad = int(4 * sigma_units / grid) + 4
    W = int((x1 - x0) / grid) + 2 * pad
    H = int((y1 - y0) / grid) + 2 * pad
    to_px = lambda p: ((p[0] - x0) / grid + pad, (y1 - p[1]) / grid + pad)
    r = geom.rasterize(contours, to_px, W, H, ss=4).astype(float)
    bw = ndimage.gaussian_filter(r, sigma_units / grid) >= 0.5
    with tempfile.TemporaryDirectory() as td:
        pbm = os.path.join(td, 'g.pbm')
        Image.fromarray(np.where(bw, 0, 255).astype(np.uint8)).convert('1').save(pbm)
        svg = os.path.join(td, 'g.svg')
        subprocess.run(['potrace', pbm, '-s', '-o', svg, '-a', str(alphamax), '-O', str(opttol), '-t', '4', '--flat'],
                       check=True)
        text = open(svg).read()
    rec = RecordingPen()
    # potrace internal (px, py), 0.1 px, y up from the bottom: X = x0 + (0.1px - pad) * grid, Y = y1 - (H - 0.1py - pad) * grid
    a = 0.1 * grid
    pen = TransformPen(rec, (a, 0, 0, a, x0 - pad * grid, y1 - (H - pad) * grid))
    for d in re.findall(r'<path d="([^"]+)"', text):
        parse_path(d, pen)
    return geom.contours_from(rec)
