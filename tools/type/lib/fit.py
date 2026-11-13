"""Refit a dense outline (potrace output, or a constructed polygon) with few, clean cubic segments.

Per closed contour:
  1. sample densely; find corners (tangent turn above `corner_deg` within a short window);
  2. split every smooth run where its tangent passes an axis direction (horizontal or vertical), so nodes sit
     on the extrema with axis-aligned handles;
  3. fit each piece with Schneider's least-squares cubic (Graphics Gems I), splitting further only where the
     error exceeds `tol` (font units); a piece that stays within `tol` of its chord becomes a line.
Smooth joins share one tangent, so the result is G1 everywhere except at the detected corners.
"""
from __future__ import annotations

import math

import numpy as np

from .geom import flatten


def _unit(v):
    n = math.hypot(v[0], v[1])
    return (v[0] / n, v[1] / n) if n > 1e-12 else (0.0, 0.0)


def resample(con, step=2.0):
    pts = flatten(con, steps=24)
    out = [pts[0]]
    acc = 0.0
    for i in range(1, len(pts)):
        p0, p1 = pts[i - 1], pts[i]
        d = math.dist(p0, p1)
        while acc + d >= step and d > 0:
            t = (step - acc) / d
            q = (p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)
            out.append(q)
            d -= (step - acc)
            p0 = q
            acc = 0.0
        acc += d
    if math.dist(out[-1], out[0]) < step * 0.5:
        out.pop()
    return np.array(out)


def _tangent_angles(P, w):
    n = len(P)
    ang = np.zeros(n)
    for i in range(n):
        a = P[(i + w) % n] - P[(i - w) % n]
        ang[i] = math.atan2(a[1], a[0])
    return ang


def _turn(P, i, w):
    n = len(P)
    a = P[i] - P[(i - w) % n]
    b = P[(i + w) % n] - P[i]
    t = math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])
    return abs(math.degrees(t))


def find_corners(P, corner_deg=35, w=3):
    n = len(P)
    turns = np.array([_turn(P, i, w) for i in range(n)])
    corners = []
    i = 0
    while i < n:
        if turns[i] > corner_deg:
            j = i
            while j + 1 < n and turns[j + 1] > corner_deg:
                j += 1
            seg = range(i, j + 1)
            # the sharpest single-step turn in the cluster
            k = max(seg, key=lambda q: _turn(P, q, 1))
            corners.append(k)
            i = j + 1
        else:
            i += 1
    # merge wrap-around duplicates
    if len(corners) > 1 and corners[0] + n - corners[-1] <= 2 * w:
        corners.pop()
    return corners


def _axis_splits(P, idx_from, idx_to, min_gap=6, w=2, cluster=20):
    """Indices strictly inside (idx_from, idx_to) (cyclic) where the run's tangent crosses an axis direction.
    Crossings closer than `cluster` samples are one event: kept (at their mean) only when the sign changes net,
    so a wiggle on a near-straight side never makes a node."""
    n = len(P)
    m = (idx_to - idx_from) % n or n
    idx = [(idx_from + k) % n for k in range(m + 1)]
    if m < 2 * min_gap:
        return []
    vecs = []
    for k in range(m + 1):
        i = idx[k]
        a = P[(i + w) % n] - P[(i - w) % n] if 0 < k < m else (P[idx[min(k + 1, m)]] - P[idx[max(k - 1, 0)]])
        vecs.append(a)
    out = []
    for comp in (0, 1):
        s = [v[comp] for v in vecs]
        xs = [k for k in range(1, m + 1) if (s[k - 1] > 0) != (s[k] > 0)]
        groups = []
        for k in xs:
            if groups and k - groups[-1][-1] <= cluster:
                groups[-1].append(k)
            else:
                groups.append([k])
        for g in groups:
            if len(g) % 2 == 1:
                k = int(round(sum(g) / len(g)))
                if min_gap <= k <= m - min_gap:
                    out.append((k, comp))
    out.sort()
    res = []
    for k, comp in out:
        if res and k - res[-1][0] < min_gap:
            continue
        res.append((k, comp))
    return [(idx[k], comp) for k, comp in res]


# ---------------------------------------------------------------- Schneider
def _bez(ctrl, t):
    p0, p1, p2, p3 = ctrl
    mt = 1 - t
    return mt ** 3 * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t ** 3 * p3


def _bez_d(ctrl, t):
    p0, p1, p2, p3 = ctrl
    mt = 1 - t
    return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2)


def _bez_dd(ctrl, t):
    p0, p1, p2, p3 = ctrl
    return 6 * (1 - t) * (p2 - 2 * p1 + p0) + 6 * t * (p3 - 2 * p2 + p1)


def _chord_param(pts):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    return d / d[-1] if d[-1] > 0 else d


def _generate(pts, u, t1, t2):
    p0, p3 = pts[0], pts[-1]
    A1 = np.outer(3 * (1 - u) ** 2 * u, t1)
    A2 = np.outer(3 * (1 - u) * u ** 2, t2)
    C = np.array([[np.sum(A1 * A1), np.sum(A1 * A2)], [np.sum(A1 * A2), np.sum(A2 * A2)]])
    B0 = (1 - u) ** 3
    B3 = u ** 3
    tmp = pts - (np.outer(B0 + 3 * (1 - u) ** 2 * u, p0) + np.outer(3 * (1 - u) * u ** 2 + B3, p3))
    X = np.array([np.sum(A1 * tmp), np.sum(A2 * tmp)])
    det = C[0, 0] * C[1, 1] - C[0, 1] * C[1, 0]
    seg = np.linalg.norm(p3 - p0)
    if abs(det) > 1e-12:
        a1 = (X[0] * C[1, 1] - X[1] * C[0, 1]) / det
        a2 = (C[0, 0] * X[1] - C[1, 0] * X[0]) / det
    else:
        a1 = a2 = seg / 3
    eps = 1e-6 * seg
    if a1 < eps or a2 < eps or a1 > seg * 1.6 or a2 > seg * 1.6:
        a1 = a2 = seg / 3
    return [p0, p0 + t1 * a1, p3 + t2 * a2, p3]


def _max_err(pts, ctrl, u):
    d = np.array([np.linalg.norm(_bez(ctrl, t) - p) for p, t in zip(pts, u)])
    i = int(np.argmax(d))
    return d[i], i


def _reparam(pts, ctrl, u):
    out = []
    for p, t in zip(pts, u):
        q = _bez(ctrl, t) - p
        d1 = _bez_d(ctrl, t)
        d2 = _bez_dd(ctrl, t)
        den = d1 @ d1 + q @ d2
        out.append(t - (q @ d1) / den if abs(den) > 1e-12 else t)
    out = np.clip(np.array(out), 0, 1)
    return out


def fit_cubic(pts, t1, t2, tol, depth=0):
    if len(pts) == 2:
        dist = np.linalg.norm(pts[1] - pts[0]) / 3
        return [[pts[0], pts[0] + t1 * dist, pts[1] + t2 * dist, pts[1]]]
    u = _chord_param(pts)
    ctrl = _generate(pts, u, t1, t2)
    err, split = _max_err(pts, ctrl, u)
    if err < tol:
        return [ctrl]
    if err < tol * 6:
        for _ in range(6):
            u2 = _reparam(pts, ctrl, u)
            if not np.all(np.diff(u2) >= -1e-9):
                break
            u = u2
            ctrl = _generate(pts, u, t1, t2)
            err, split = _max_err(pts, ctrl, u)
            if err < tol:
                return [ctrl]
    split = min(max(split, 1), len(pts) - 2)
    tc = pts[split - 1] - pts[split + 1]
    tc = tc / (np.linalg.norm(tc) or 1)
    if depth > 30:
        return [ctrl]
    return fit_cubic(pts[:split + 1], t1, tc, tol, depth + 1) + fit_cubic(pts[split:], -tc, t2, tol, depth + 1)


def _end_tangent(P, i, direction, n, w=3, axis=None):
    if axis is not None:
        # tangent snapped to the axis, signed by the local direction of travel
        v = P[(i + direction * w) % n] - P[i]
        if axis == 0:   # x-component crossed zero => vertical tangent
            return np.array([0.0, math.copysign(1.0, v[1])])
        return np.array([math.copysign(1.0, v[0]), 0.0])
    v = P[(i + direction * w) % n] - P[i]
    return v / (np.linalg.norm(v) or 1)


def refit_contour(con, tol=2.0, corner_deg=35, step=2.0, line_tol=None, tw_units=8.0, gap_units=30.0):
    P = resample(con, step)
    n = len(P)
    tw = max(2, int(round(tw_units / step)))
    gap = max(4, int(round(gap_units / step)))
    if n < 8:
        return con
    corners = find_corners(P, corner_deg, w=max(3, int(round(5.0 / step))))
    if not corners:
        # anchor a smooth contour on its leftmost point (an x extremum)
        corners_free = True
        start = int(np.argmin(P[:, 0]))
        breaks = [(start, 0)]
    else:
        corners_free = False
        breaks = [(c, None) for c in corners]
    # add axis splits inside each run
    allb = []
    for j in range(len(breaks)):
        a = breaks[j][0]
        b = breaks[(j + 1) % len(breaks)][0]
        allb.append(breaks[j])
        allb.extend(_axis_splits(P, a, b if len(breaks) > 1 else a, min_gap=gap, w=tw, cluster=gap))
    # dedupe keeping order
    seen, B = set(), []
    for i, ax in allb:
        if i not in seen:
            seen.add(i)
            B.append((i, ax))
    corner_set = set(corners)
    line_tol = line_tol if line_tol is not None else tol * 0.6
    segs = []
    for j in range(len(B)):
        i0, ax0 = B[j]
        i1, ax1 = B[(j + 1) % len(B)]
        m = (i1 - i0) % n or n
        pts = np.array([P[(i0 + k) % n] for k in range(m + 1)])
        chord = pts[-1] - pts[0]
        L = np.linalg.norm(chord)
        if L > 1e-9:
            q = pts - pts[0]; dev = np.abs(chord[0] * q[:, 1] - chord[1] * q[:, 0]) / L
            if dev.max() < line_tol:
                segs.append(('line', tuple(pts[0]), tuple(pts[-1])))
                continue
        t1 = _end_tangent(P, i0, +1, n, w=tw, axis=None if i0 in corner_set else ax0)
        t2 = _end_tangent(P, i1, -1, n, w=tw, axis=None if i1 in corner_set else ax1)
        if i0 not in corner_set and ax0 is None:
            t1 = _unit(P[(i0 + tw) % n] - P[(i0 - tw) % n]); t1 = np.array(t1)
        if i1 not in corner_set and ax1 is None:
            t2 = _unit(P[(i1 - tw) % n] - P[(i1 + tw) % n]); t2 = np.array(t2)
        for c in fit_cubic(pts, t1, t2, tol):
            segs.append(('curve',) + tuple(tuple(map(float, q)) for q in c))
    # chain exactly
    for k in range(len(segs)):
        prev = segs[k - 1]
        s = segs[k]
        if s[1] != prev[-1]:
            segs[k] = (s[0], prev[-1]) + s[2:]
    return segs


def refit(contours, tol=2.0, corner_deg=35, step=2.0):
    return [refit_contour(c, tol=tol, corner_deg=corner_deg, step=step) for c in contours]
