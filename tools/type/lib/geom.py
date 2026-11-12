"""Outline hygiene shared by every family: overlap removal, direction, extrema nodes, rounding, lint, fidelity.

A contour is a list of segments: ('line', p0, p1) or ('curve', p0, c1, c2, p1), closed (last p1 == first p0).
"""
from __future__ import annotations

import math

import numpy as np
import pathops
from PIL import Image, ImageDraw
from fontTools.misc.bezierTools import splitCubicAtT, calcCubicParameters, solveQuadratic
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.basePen import BasePen
from fontTools.pens.transformPen import TransformPen


# ----------------------------------------------------------------------------------------------------- conversion
class _ContourPen(BasePen):
    def __init__(self):
        super().__init__(None)
        self.contours, self.cur, self.start = [], [], None

    def _moveTo(self, p):
        self.cur, self.start = [], p

    def _lineTo(self, p):
        p0 = self._getCurrentPoint()
        if math.dist(p0, p) > 1e-9:
            self.cur.append(('line', p0, p))

    def _curveToOne(self, c1, c2, p):
        self.cur.append(('curve', self._getCurrentPoint(), c1, c2, p))

    def _closePath(self):
        p0 = self._getCurrentPoint()
        if self.start is not None and math.dist(p0, self.start) > 1e-9:
            self.cur.append(('line', p0, self.start))
        if self.cur:
            self.contours.append(self.cur)
        self.cur = []

    _endPath = _closePath


def contours_from(drawable) -> list:
    """drawable: RecordingPen, pathops.Path or anything with .draw(pen) / .replay(pen)."""
    pen = _ContourPen()
    if isinstance(drawable, RecordingPen):
        drawable.replay(pen)
    else:
        drawable.draw(pen)
    return pen.contours


def draw_contours(contours, pen):
    for c in contours:
        pen.moveTo(c[0][1])
        for s in c:
            if s[0] == 'line':
                pen.lineTo(s[2])
            else:
                pen.curveTo(s[2], s[3], s[4])
        pen.closePath()


def to_path(contours) -> pathops.Path:
    p = pathops.Path()
    draw_contours(contours, p.getPen())
    return p


def transform(contours, m):
    """m = (a, b, c, d, e, f) affine."""
    a, b, c, d, e, f = m
    T = lambda p: (a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f)
    out = [[(s[0],) + tuple(T(p) for p in s[1:]) for s in con] for con in contours]
    if a * d - b * c < 0:   # a mirror reverses orientation: reverse back so outer stays counter-clockwise
        out = [reverse(con) for con in out]
    return out


def reverse(con):
    return [(s[0],) + tuple(reversed(s[1:])) for s in reversed(con)]


def translate(contours, dx, dy):
    return transform(contours, (1, 0, 0, 1, dx, dy))


def bounds(contours):
    xs, ys = [], []
    for c in contours:
        for s in c:
            for p in s[1:]:
                xs.append(p[0]); ys.append(p[1])
    if not xs:
        return (0, 0, 0, 0)
    # control points bound the curve; with extrema nodes they equal the true bounds
    return (min(xs), min(ys), max(xs), max(ys))


# -------------------------------------------------------------------------------------------------------- booleans
def normalize(shape):
    """Each shape on its own: overlaps removed, outer contours counter-clockwise, counters clockwise."""
    return contours_from(pathops.simplify(to_path(shape), fix_winding=True, clockwise=False))


def union(*shapes):
    p = pathops.Path()
    for s in shapes:
        draw_contours(normalize(s), p.getPen())
    return contours_from(pathops.simplify(p, fix_winding=True, keep_starting_points=False))


def difference(a, b):
    return contours_from(pathops.op(to_path(normalize(a)), to_path(normalize(b)), pathops.PathOp.DIFFERENCE, fix_winding=True))


def intersection(a, b):
    return contours_from(pathops.op(to_path(normalize(a)), to_path(normalize(b)), pathops.PathOp.INTERSECTION, fix_winding=True))


def rect(x0, y0, x1, y1):
    return [[('line', (x0, y0), (x1, y0)), ('line', (x1, y0), (x1, y1)), ('line', (x1, y1), (x0, y1)),
             ('line', (x0, y1), (x0, y0))]]


def poly(*pts):
    pts = list(pts)
    return [[('line', pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]]


# -------------------------------------------------------------------------------------------------------- hygiene
def signed_area(con):
    a = 0.0
    for s in con:
        pts = s[1:]
        # polygonal approximation through control points is enough for orientation
        for i in range(len(pts) - 1):
            a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return a / 2


def _split_extrema(seg):
    if seg[0] != 'curve':
        return [seg]
    p0, c1, c2, p1 = seg[1:]
    ts = []
    for i in (0, 1):
        # derivative of cubic component: 3[(c1-p0)(1-t)^2 + 2(c2-c1)t(1-t) + (p1-c2)t^2]
        a = p0[i]; b = c1[i]; c = c2[i]; d = p1[i]
        A = -a + 3 * b - 3 * c + d
        B = 2 * (a - 2 * b + c)
        C = b - a
        for t in solveQuadratic(3 * A, 3 * B, 3 * C) if abs(A) > 1e-12 else ([-C / B] if abs(B) > 1e-12 else []):
            if 0.02 < t < 0.98:
                ts.append(t)
    ts = sorted(set(round(t, 6) for t in ts))
    # merge near-duplicate splits
    merged = []
    for t in ts:
        if not merged or t - merged[-1] > 0.04:
            merged.append(t)
    if not merged:
        return [seg]
    parts = splitCubicAtT(p0, c1, c2, p1, *merged)
    return [('curve',) + tuple(tuple(map(float, q)) for q in part) for part in parts]


def _is_flat(seg, tol=0.6):
    if seg[0] != 'curve':
        return False
    p0, c1, c2, p1 = seg[1:]
    L = math.dist(p0, p1)
    if L < 1e-9:
        return True
    def dist(p):
        return abs((p1[0] - p0[0]) * (p0[1] - p[1]) - (p0[0] - p[0]) * (p1[1] - p0[1])) / L
    return dist(c1) < tol and dist(c2) < tol


def smooth_joins(con, max_deg=12.0):
    """Make near-smooth joins exactly smooth: align the handles on both sides of a node whose tangent turn is
    under max_deg (a line side keeps its direction; two curves meet on their mean direction)."""
    con = [list(s) for s in con]
    n = len(con)
    for i in range(n):
        a, b = con[i], con[(i + 1) % n]
        ta, tb = _tangent_out(tuple(a)), _tangent_in(tuple(b))
        if not ta or not tb:
            continue
        ang = abs(math.degrees(math.atan2(ta[0] * tb[1] - ta[1] * tb[0], ta[0] * tb[0] + ta[1] * tb[1])))
        if ang < 0.05 or ang > max_deg:
            continue
        p = a[-1]
        if a[0] == 'line' and b[0] == 'line':
            continue
        if a[0] == 'line':
            d = ta
        elif b[0] == 'line':
            d = tb
        else:
            d = (ta[0] + tb[0], ta[1] + tb[1])
            L = math.hypot(*d)
            d = (d[0] / L, d[1] / L)
        if a[0] == 'curve':
            la = math.dist(a[3], p)
            a[3] = (p[0] - d[0] * la, p[1] - d[1] * la)
        if b[0] == 'curve':
            lb = math.dist(b[2], p)
            b[2] = (p[0] + d[0] * lb, p[1] + d[1] * lb)
    return [tuple(s) for s in con]


def clean(contours, min_seg=3.0, ccw=True):
    """Remove overlaps, set PostScript direction (outer counter-clockwise), put nodes at extrema, round to
    integers, collapse flat curves to lines and drop micro segments."""
    if not contours:
        return []
    p = to_path(contours)
    p = pathops.simplify(p, fix_winding=True, keep_starting_points=False, clockwise=not ccw)
    out = []
    for con in contours_from(p):
        segs = []
        for s in con:
            segs.extend(_split_extrema(s))
        # flat curves -> lines
        segs = [('line', s[1], s[4]) if _is_flat(s) else s for s in segs]
        segs = smooth_joins(segs)
        # round
        R = lambda q: (round(q[0]), round(q[1]))
        segs = [(s[0],) + tuple(R(q) for q in s[1:]) for s in segs]
        # drop micro segments by merging their end into the next segment start
        res = []
        for s in segs:
            if math.dist(s[1], s[-1]) < min_seg and len(segs) > 3:
                # skip; next segment will start at our start
                if res:
                    continue
            res.append(s)
        # re-chain: every segment starts where the previous ended
        for i in range(len(res)):
            prev = res[i - 1]
            s = res[i]
            if s[1] != prev[-1]:
                res[i] = (s[0], prev[-1]) + s[2:]
        res = [s for s in res if not (s[0] == 'line' and s[1] == s[2])]
        if len(res) >= 2 and abs(signed_area(res)) > 4:
            out.append(res)
    return out


def lint(contours, upm=1000):
    """Return a dict of hygiene measures: nodes, missing extrema, micro segments, near-kinks."""
    nodes = sum(len(c) for c in contours)
    missing_ext = 0
    micro = 0
    kinks = 0
    for con in contours:
        for i, s in enumerate(con):
            if math.dist(s[1], s[-1]) < 2:
                micro += 1
            if s[0] == 'curve':
                p0, c1, c2, p1 = s[1:]
                for k in (0, 1):
                    lo, hi = min(p0[k], p1[k]), max(p0[k], p1[k])
                    if min(c1[k], c2[k]) < lo - 1.5 or max(c1[k], c2[k]) > hi + 1.5:
                        missing_ext += 1
                        break
            # tangent continuity at the join with the next segment
            n = con[(i + 1) % len(con)]
            tin = _tangent_out(s)
            tout = _tangent_in(n)
            if tin and tout:
                ang = abs(math.degrees(math.atan2(tin[0] * tout[1] - tin[1] * tout[0], tin[0] * tout[0] + tin[1] * tout[1])))
                if 3.0 < ang < 12:
                    kinks += 1
    return {'nodes': nodes, 'missingExtrema': missing_ext, 'microSegments': micro, 'nearKinks': kinks}


def _tangent_out(s):
    a, b = (s[-2], s[-1]) if s[0] == 'curve' else (s[1], s[2])
    if s[0] == 'curve' and math.dist(a, b) < 1e-6:
        a = s[2]
    v = (b[0] - a[0], b[1] - a[1])
    L = math.hypot(*v)
    return (v[0] / L, v[1] / L) if L > 1e-6 else None


def _tangent_in(s):
    a, b = (s[1], s[2])
    if s[0] == 'curve' and math.dist(a, b) < 1e-6:
        b = s[3]
    v = (b[0] - a[0], b[1] - a[1])
    L = math.hypot(*v)
    return (v[0] / L, v[1] / L) if L > 1e-6 else None


# ------------------------------------------------------------------------------------------------------ raster
def flatten(con, steps=16):
    pts = [con[0][1]]
    for s in con:
        if s[0] == 'line':
            pts.append(s[2])
        else:
            p0, c1, c2, p1 = s[1:]
            for k in range(1, steps + 1):
                t = k / steps
                mt = 1 - t
                pts.append((mt ** 3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * p1[0],
                            mt ** 3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * p1[1]))
    return pts


def rasterize(contours, to_px, W, H, ss=1):
    """Nonzero-winding raster of contours. to_px maps a font-unit point to (x, y) pixel coords."""
    acc = np.zeros((H * ss, W * ss), dtype=np.int32)
    for con in contours:
        pts = [to_px(p) for p in flatten(con)]
        pts = [(x * ss, y * ss) for x, y in pts]
        im = Image.new('L', (W * ss, H * ss), 0)
        ImageDraw.Draw(im).polygon(pts, fill=1)
        # orientation in pixel space (y down flips sign)
        a = 0.0
        for i in range(len(pts) - 1):
            a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
        sign = 1 if a < 0 else -1  # y-down: font ccw becomes cw (negative area)
        acc += sign * np.asarray(im, dtype=np.int32)
    r = acc != 0
    if ss > 1:
        r = r.reshape(H, ss, W, ss).mean(axis=(1, 3))
    return r


def fidelity(contours, target: np.ndarray, to_px):
    """IoU of the outline against a boolean target mask (same pixel grid), and the worst boundary deviation in
    target pixels (symmetric Hausdorff on boundaries)."""
    from scipy import ndimage
    H, W = target.shape
    r = rasterize(contours, to_px, W, H) > 0.5
    inter = np.logical_and(r, target).sum()
    uni = np.logical_or(r, target).sum()
    iou = inter / uni if uni else 0.0
    eb = r ^ ndimage.binary_erosion(r)
    tb = target ^ ndimage.binary_erosion(target)
    if eb.any() and tb.any():
        dt_t = ndimage.distance_transform_edt(~tb)
        dt_r = ndimage.distance_transform_edt(~eb)
        dev = max(dt_t[eb].max(), dt_r[tb].max())
        mean = (dt_t[eb].mean() + dt_r[tb].mean()) / 2
    else:
        dev = mean = float('inf')
    return {'iou': round(float(iou), 4), 'maxDevPx': round(float(dev), 2), 'meanDevPx': round(float(mean), 3)}
