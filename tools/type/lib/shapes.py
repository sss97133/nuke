"""Constructive glyph drawing for the geometric families (Block, Decal).

A glyph is positives minus negatives, built from primitives that know how to inset themselves, so one
construction yields both the silhouette (inset 0) and the chrome face (inset d) with the same skeleton:
  positives shrink by d (the face sits inside the rim), negatives (counters, openings) grow by d.
Corners are rounded after the booleans; quarter curves use the superellipse handle rule
k = (8 * 2^(-1/n) - 4) / 3 (k = 0.552 for an ellipse, 0.783 for n = 3), so every round has extrema nodes.
"""
from __future__ import annotations

import math

from . import geom


def _k(n):
    return (8 * 2 ** (-1 / n) - 4) / 3


class Rect:
    def __init__(self, x0, y0, x1, y1):
        self.b = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))

    def contours(self, d=0.0):
        x0, y0, x1, y1 = self.b
        if x1 - x0 <= 2 * d or y1 - y0 <= 2 * d:
            return []
        return geom.rect(x0 + d, y0 + d, x1 - d, y1 - d)


class Poly:
    """Convex polygon (points counter-clockwise or clockwise); inset moves every edge inward by d."""

    def __init__(self, *pts):
        self.pts = list(pts)

    def contours(self, d=0.0):
        pts = self.pts
        a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
        if a < 0:
            pts = pts[::-1]
        if d == 0:
            return geom.poly(*pts)
        n = len(pts)
        lines = []
        for i in range(n):
            p, q = pts[i], pts[(i + 1) % n]
            dx, dy = q[0] - p[0], q[1] - p[1]
            L = math.hypot(dx, dy)
            nx, ny = -dy / L, dx / L      # inward normal for a counter-clockwise polygon
            lines.append(((p[0] + nx * d, p[1] + ny * d), (dx, dy)))
        out = []
        for i in range(n):
            (p1, d1), (p2, d2) = lines[i - 1], lines[i]
            den = d1[0] * d2[1] - d1[1] * d2[0]
            if abs(den) < 1e-9:
                out.append(p2)
                continue
            t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
            out.append((p1[0] + d1[0] * t, p1[1] + d1[1] * t))
        # a collapsed polygon has flipped orientation
        a2 = sum(out[i][0] * out[(i + 1) % n][1] - out[(i + 1) % n][0] * out[i][1] for i in range(n))
        if a2 <= 0:
            return []
        return geom.poly(*out)


class SE:
    """Superellipse |x/a|^n + |y/b|^n = 1 centred at (cx, cy), drawn as four cubics with extrema nodes."""

    def __init__(self, cx, cy, a, b, n=2.0):
        self.cx, self.cy, self.a, self.b, self.n = cx, cy, a, b, n

    def contours(self, d=0.0):
        a, b = self.a - d, self.b - d
        if a <= 0 or b <= 0:
            return []
        cx, cy, k = self.cx, self.cy, _k(self.n)
        E, N, W, S = (cx + a, cy), (cx, cy + b), (cx - a, cy), (cx, cy - b)
        return [[('curve', E, (cx + a, cy + k * b), (cx + k * a, cy + b), N),
                 ('curve', N, (cx - k * a, cy + b), (cx - a, cy + k * b), W),
                 ('curve', W, (cx - a, cy - k * b), (cx - k * a, cy - b), S),
                 ('curve', S, (cx + k * a, cy - b), (cx + a, cy - k * b), E)]]


class RRect:
    """Rectangle whose corners are superelliptic quarters of radii (rx, ry): a stadium-like round with flat
    sides, the counter shape of the emblem O and the bowl ends of P, B, D."""

    def __init__(self, x0, y0, x1, y1, rx, ry, n=2.0, corners='1111'):
        """corners: which corners are round, in the order bottom-right, top-right, top-left, bottom-left."""
        self.b = (x0, y0, x1, y1)
        self.rx, self.ry, self.n, self.corners = rx, ry, n, corners

    def contours(self, d=0.0):
        x0, y0, x1, y1 = self.b
        x0 += d; y0 += d; x1 -= d; y1 -= d
        rx = max(1.0, min(self.rx - d, (x1 - x0) / 2))
        ry = max(1.0, min(self.ry - d, (y1 - y0) / 2))
        if x1 - x0 <= 2 or y1 - y0 <= 2:
            return []
        k = _k(self.n)
        segs = []
        cn = iter(self.corners)
        def corner(p0, c1, c2, p1):
            if next(cn) == '1':
                segs.append(('curve', p0, c1, c2, p1))
            else:
                # square corner: go to the box corner
                q = (c1[0], c2[1]) if abs(c1[1] - p0[1]) < 1e-9 else (c2[0], c1[1])
                q = (p1[0], p0[1]) if p0[1] in (y0, y1) else (p0[0], p1[1])
                segs.append(('line', p0, q))
                segs.append(('line', q, p1))
        def line(p0, p1):
            if math.dist(p0, p1) > 0.5:
                segs.append(('line', p0, p1))
        # counter-clockwise from the bottom-right corner's start
        line((x0 + rx, y0), (x1 - rx, y0))
        corner((x1 - rx, y0), (x1 - rx + k * rx, y0), (x1, y0 + ry - k * ry), (x1, y0 + ry))
        line((x1, y0 + ry), (x1, y1 - ry))
        corner((x1, y1 - ry), (x1, y1 - ry + k * ry), (x1 - rx + k * rx, y1), (x1 - rx, y1))
        line((x1 - rx, y1), (x0 + rx, y1))
        corner((x0 + rx, y1), (x0 + rx - k * rx, y1), (x0, y1 - ry + k * ry), (x0, y1 - ry))
        line((x0, y1 - ry), (x0, y0 + ry))
        corner((x0, y0 + ry), (x0, y0 + ry - k * ry), (x0 + rx - k * rx, y0), (x0 + rx, y0))
        # chain
        for i in range(len(segs)):
            prev = segs[i - 1]
            s = segs[i]
            if s[1] != prev[-1]:
                segs[i] = (s[0], prev[-1]) + s[2:]
        return [segs]


class Glyph:
    def __init__(self, pos, neg=(), clip=()):
        self.pos, self.neg, self.clip = list(pos), list(neg), list(clip)

    def contours(self, d=0.0, round_r=0.0):
        P = []
        for p in self.pos:
            P += p.contours(d)
        out = geom.union(P) if P else []
        for c in self.clip:
            out = geom.intersection(out, c.contours(d))
        Nn = []
        for n in self.neg:
            Nn += n.contours(-d)
        if Nn:
            out = geom.difference(out, geom.union(Nn))
        if round_r:
            out = round_corners(out, round_r)
        return geom.clean(out)


def round_corners(contours, r, min_turn=12.0):
    """Round every line-line corner: convex ones by r, concave ones by r/2."""
    res = []
    for con in contours:
        n = len(con)
        out = []
        # precompute trims at each node i (between seg i and seg i+1)
        trims = {}
        for i in range(n):
            a, b = con[i], con[(i + 1) % n]
            if a[0] != 'line' or b[0] != 'line':
                continue
            u = (a[2][0] - a[1][0], a[2][1] - a[1][1])
            v = (b[2][0] - b[1][0], b[2][1] - b[1][1])
            lu, lv = math.hypot(*u), math.hypot(*v)
            if lu < 1e-6 or lv < 1e-6:
                continue
            cross = u[0] * v[1] - u[1] * v[0]
            dot = u[0] * v[0] + u[1] * v[1]
            turn = math.degrees(math.atan2(cross, dot))
            if abs(turn) < min_turn:
                continue
            rr = r if turn > 0 else r * 0.5    # counter-clockwise contour: left turn = convex
            t = rr * math.tan(math.radians(abs(turn)) / 2)
            t = min(t, lu * 0.45, lv * 0.45)
            trims[i] = (t, u, v, lu, lv, abs(turn))
        for i in range(n):
            s = con[i]
            p0, p1 = s[1], s[-1]
            if s[0] == 'line':
                if (i - 1) % n in trims:
                    t, u, v, lu, lv, _ = trims[(i - 1) % n]
                    p0 = (p0[0] + v[0] / lv * t, p0[1] + v[1] / lv * t)
                if i in trims:
                    t, u, v, lu, lv, _ = trims[i]
                    p1 = (p1[0] - u[0] / lu * t, p1[1] - u[1] / lu * t)
                out.append(('line', p0, p1))
            else:
                out.append(s)
            if i in trims:
                t, u, v, lu, lv, turn = trims[i]
                c = s[-1]
                a0 = (c[0] - u[0] / lu * t, c[1] - u[1] / lu * t)
                a1 = (c[0] + v[0] / lv * t, c[1] + v[1] / lv * t)
                h = 4 / 3 * math.tan(math.radians(turn) / 4) / math.tan(math.radians(turn) / 2) if turn < 179 else 0.55
                h1 = (a0[0] + u[0] / lu * t * h, a0[1] + u[1] / lu * t * h)
                h2 = (a1[0] - v[0] / lv * t * h, a1[1] - v[1] / lv * t * h)
                out.append(('curve', a0, h1, h2, a1))
        for k in range(len(out)):
            prev = out[k - 1]
            s = out[k]
            if s[1] != prev[-1]:
                out[k] = (s[0], prev[-1]) + s[2:]
        res.append(out)
    return res
