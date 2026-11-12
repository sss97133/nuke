"""Trans Am 1973 Decal: the "TRANS AM" fender decal lettering, from the photograph of this car's own decal, extended
to A-Z and 0-9 in the same construction.

Source: pontiac-firebird-trans-am-style-owner-decal-cut.png (the car's decal, cut from vehicle_images
9b8ec6d9-8e27-41f4-9428-5c025a1c46f0, levelled -8.65 degrees by the cutter). The photograph looks along the fender,
so every vertical leans 0.33 px per px (18 degrees); the trace removes that shear before measuring.

Construction, measured on the de-sheared decal (each letter scaled to cap 700 on its own height, 88 px at the T to
96 px at the M, which also removes the perspective scale):
  1. Every stroke is a band of one width (50-60 units, drawn 56); the letters are condensed (T 0.72 H wide, N 0.61,
     M 0.93) and upright.
  2. Strokes that would be heavy in a broad-pen roman are split into two bands with a channel of about 60 units: the
     T, R and E-like stems, the falling diagonals of A, N and M, the M's right stem, the R leg and the whole S. Light
     strokes stay single: the A's left leg, the N's verticals, the M's left stem and rising diagonal, the bars.
  3. Rounds split only where a pen round is heavy: the inner band is a full ring, the channel and the outer band are
     crescents that run out to nothing at the top and bottom (the R bowl; the S does the same at its terminals).
  4. The channel of a split stroke runs on through the stroke it meets and out of the letter (the T's channel cuts
     the bar to the top; the N's split diagonal joins the left stem at the top and the right stem at the base).
  5. In the M the split falling stroke separates: its first band reaches the baseline, its second meets the single
     rising diagonal at a vertex 200 units up.
  The six letters on the car (T R A N S M) ship as traces: potrace at 8x, Schneider refit at 0.8 px, straight runs
  within 1.2 px redrawn as single lines and stems set upright. Their print-softened ends and the taper of the
  diagonals are the decal's own; every other glyph is built from rules 1-4.
The decal is orange on the car; the colour is a finish (CSS colour or the COLR layer), not part of the outline.
"""
from __future__ import annotations

import math
import os

import numpy as np
import pathops

from lib import geom
from lib.fit import refit
from lib.fontbuild import Glyph as FGlyph, build
from lib.glyphs import Traced, overlay_png
from lib.trace import Source, component_mask

FAMILY = 'Trans Am 1973 Decal'
H = 700
w = 56           # band
g = 60           # channel
D = 2 * w + g    # split stroke overall
RO_A = 134        # rounds: inner band's outer semi-axis (O 500 wide, with the S and R)
RO_C = 260
PRINT_R = 16
BAR = 72         # single bars (the T bar measures 80, other bars 56-70)

SRC = Source('pontiac-firebird-trans-am-style-owner-decal-cut.png', 'alpha', 0.0, 1.0, cap_px=88.0,
             baseline_px=100.0, cap_units=H, k=8, blur=0.4, shear=0.33)
SRC_INFO = {'page': "This car's own TRANS AM decal (owner photograph)", 'url': None,
            'vehicleImage': 'vehicle_images:9b8ec6d9-8e27-41f4-9428-5c025a1c46f0'}


# ------------------------------------------------------------------------------------------------ skeleton DSL
def P(*segs):
    """skeleton path: P((x,y), (x,y), ...) for polylines; a 3-tuple of points is a cubic (c1, c2, p)."""
    return list(segs)


def _path(skel, ext0=0.0, ext1=0.0):
    pts = []
    p = pathops.Path()
    pen = p.getPen()
    start = skel[0]
    # extend the start along its tangent
    nxt = skel[1][0] if isinstance(skel[1][0], tuple) else skel[1]
    if ext0:
        dx, dy = start[0] - nxt[0], start[1] - nxt[1]
        L = math.hypot(dx, dy)
        start = (start[0] + dx / L * ext0, start[1] + dy / L * ext0)
    pen.moveTo(start)
    if ext0:
        pen.lineTo(skel[0])
    for s in skel[1:]:
        if isinstance(s[0], tuple):
            pen.curveTo(*s)
            last, prev = s[2], s[1]
        else:
            pen.lineTo(s)
            last, prev = s, None
    if ext1:
        if prev is None:
            q = skel[-2] if not isinstance(skel[-2][0], tuple) else skel[-2][2]
            prev = q
        dx, dy = last[0] - prev[0], last[1] - prev[1]
        L = math.hypot(dx, dy)
        pen.lineTo((last[0] + dx / L * ext1, last[1] + dy / L * ext1))
    pen.endPath()
    return p


def band(skel, width, ext0=0.0, ext1=0.0, cap='butt'):
    p = _path(skel, ext0, ext1)
    p.stroke(width, pathops.LineCap.SQUARE_CAP if cap == 'square' else pathops.LineCap.BUTT_CAP,
             pathops.LineJoin.MITER_JOIN, 6)
    return geom.contours_from(pathops.simplify(p, fix_winding=True))


class St:
    """one stroke: kind 'single' or 'split'; e0/e1 extend the skeleton (beyond the baseline or into a joint);
    c0/c1 extend the split channel beyond the stroke's ends (out through the stroke it meets)."""

    def __init__(self, skel, kind='single', e0=0, e1=0, c0=None, c1=None, width=None, cap='butt'):
        self.skel, self.kind, self.e0, self.e1 = skel, kind, e0, e1
        self.c0 = e0 + 40 if c0 is None else c0
        self.c1 = e1 + 40 if c1 is None else c1
        self.width, self.cap = width, cap


class Raw:
    """ready-made ink contours (a split round) joined to the strokes; split-stroke channels still cut it."""
    kind = 'raw'

    def __init__(self, contours):
        self.contours = contours


def split_round(cx, cy, a, b, x_from=None, x_to=None, wedge=None):
    """A round in the decal's manner, measured on the R bowl and the S: the inner band is a full ring of the
    band width; the channel and the outer band are crescents, full width on the vertical sides (where a pen's
    round is heavy) and running out to nothing at the top and bottom (where it is light). a, b are the inner
    band's outer semi-axes. x_from/x_to keep only part of it (a bowl); wedge (deg0, deg1) cuts an opening."""
    from lib.shapes import SE
    ink = geom.difference(SE(cx, cy, a + g + w, b).contours(), SE(cx, cy, a - w, b - w).contours())
    # the channel ends in points inside the ink near the top and bottom, never on the outline
    channel = geom.difference(SE(cx, cy, a + g, b - 0.6 * w).contours(), SE(cx, cy, a, b).contours())
    out = geom.difference(ink, channel)
    if x_from is not None:
        out = geom.intersection(out, geom.rect(x_from, cy - b - 50, cx + a + g + w + 50, cy + b + 50))
    if x_to is not None:
        out = geom.intersection(out, geom.rect(cx - a - g - w - 50, cy - b - 50, x_to, cy + b + 50))
    if wedge is not None:
        R = 4 * (a + b + g + w)
        t0, t1 = (math.radians(t) for t in wedge)
        pts = [(cx, cy)] + [(cx + R * math.cos(t0 + (t1 - t0) * i / 8), cy + R * math.sin(t0 + (t1 - t0) * i / 8))
                            for i in range(9)]
        out = geom.difference(out, geom.poly(*pts))
    return Raw(geom.clean(out))


def draw(strokes, ylo=0, yhi=H, xlo=-2000, xhi=4000):
    pos, gaps = [], []
    for s in strokes:
        if s.kind == 'raw':
            pos += s.contours
        elif s.kind == 'split':
            pos += band(s.skel, s.width or D, s.e0, s.e1, s.cap)
            gaps += band(s.skel, g, s.c0, s.c1)
        else:
            pos += band(s.skel, s.width or w, s.e0, s.e1, s.cap)
    out = geom.union(pos)
    if gaps:
        out = geom.difference(out, geom.union(gaps))
    out = geom.intersection(out, geom.rect(xlo, ylo, xhi, yhi))
    out = geom.clean(out)
    out = geom.clean(refit(out, tol=1.2, corner_deg=28, step=2.0))
    # the decal is screen-printed: corners carry the ink's radius (the traced ends measure 10-20 units)
    from lib.shapes import round_corners
    return geom.clean(round_corners(out, PRINT_R))


def arc_ellipse(cx, cy, a, b, start, end, n=2.0):
    """skeleton of an elliptic arc from angle start to end (degrees, ccw), quarter-cubic per 90 degrees."""
    k = (8 * 2 ** (-1 / n) - 4) / 3
    pts = []
    def pt(t):
        return (cx + a * math.cos(math.radians(t)), cy + b * math.sin(math.radians(t)))
    segs = [pt(start)]
    step = 90 if end > start else -90
    t = start
    while (end - t) * (1 if step > 0 else -1) > 1e-6:
        t1 = t + step if abs(end - t) >= 90 else end
        span = math.radians(t1 - t)
        kk = 4 / 3 * math.tan(span / 4)
        p0, p1 = pt(t), pt(t1)
        d0 = (-a * math.sin(math.radians(t)), b * math.cos(math.radians(t)))
        d1 = (-a * math.sin(math.radians(t1)), b * math.cos(math.radians(t1)))
        segs.append(((p0[0] + d0[0] * kk, p0[1] + d0[1] * kk), (p1[0] - d1[0] * kk, p1[1] - d1[1] * kk), p1))
        t = t1
    return segs


# ------------------------------------------------------------------------------------------------ alphabet
def letters():
    G, M = {}, {}
    hs = D / 2   # half a split stroke
    def g_(name, strokes, method, prov='designed', ylo=0, yhi=H, **kw):
        G[name] = (strokes, ylo, yhi)
        M[name] = {'provenance': prov, 'method': method, **kw}

    # traced letters (constructed to the de-sheared decal)
    g_('T', [St(P((0, H - BAR / 2), (500, H - BAR / 2)), width=BAR),
             St(P((250, -60), (250, H)), 'split', c1=200)], prov='traced',
       method='bar 500 x 72 single; split stem; the channel runs out through the bar')
    g_('R', [St(P((hs, -60), (hs, H + 60)), 'split'),
             St(P((hs, H - w / 2), (230, H - w / 2), ((330, H - w / 2), (360, 560), (360, 500)),
                  ((360, 430), (320, 380), (230, 380)), (hs, 380)), width=w),
             St(P((235, 380), (430 - hs, -80)), 'split', c0=0)], prov='traced',
       method='split stem; single bowl; split leg falling from the bowl to the baseline')
    g_('A', [St(P((w / 2, -60), (w / 2, H)), cap='square'),
             St(P((hs + 20, H + 120), (520 - hs, -120)), 'split', c0=60),
             St(P((0, 250), (360, 250)), width=w)], prov='traced',
       method='vertical left side single; falling right leg split; crossbar single at 250')
    g_('N', [St(P((w / 2, -60), (w / 2, H + 60))), St(P((480 - w / 2, -60), (480 - w / 2, H + 60))),
             St(P((hs - 20, H + 140), (480 - hs + 20, -140)), 'split')], prov='traced',
       method='single verticals; split diagonal')
    S_skel = P((395, 600), ((350, 690), (300, H - hs + 30), (230, H - hs + 30)),
               ((140, H - hs + 30), (hs, 640), (hs, 530)),
               ((hs, 420), (130, 380), (220, 340)),
               ((330, 290), (440 - hs, 240), (440 - hs, 160)),
               ((440 - hs, 60), (330, hs - 30), (210, hs - 30)),
               ((120, hs - 30), (60, 50), (30, 110)))
    g_('S', [St(S_skel, 'split', c0=30, c1=30)], prov='traced', ylo=-12, yhi=H + 12,
       method='one split S curve; terminals cut along the band normal')
    g_('M', [St(P((w / 2, -60), (w / 2, H + 60))),
             St(P((hs - 10, H + 140), (370, -100)), 'split'),
             St(P((340, -100), (700 - D + 10, H + 140))),
             St(P((700 - hs, -60), (700 - hs, H + 60)), 'split')], prov='traced',
       method='single left stem, split falling diagonal, single rising diagonal, split right stem')

    # designed by the rule
    g_('B', [St(P((hs, -60), (hs, H + 60)), 'split'),
             split_round(hs + 20, 548, 160, 152, x_from=hs + 20), split_round(hs + 20, 200, 185, 200, x_from=hs + 20),
             St(P((hs, H - w / 2), (hs + 21, H - w / 2)), width=w), St(P((hs, 400 - w / 2), (hs + 21, 400 - w / 2)), width=w),
             St(P((hs, w / 2), (hs + 21, w / 2)), width=w)],
       method='split stem; two split bowls (crescent channel, as the R bowl), the lower 30 wider')
    g_('C', [split_round(RO_C, 350, RO_A, 362, wedge=(-40, 40))], ylo=-12, yhi=H + 12,
       method='split round (crescent channel) opened from -40 to 40 degrees')
    g_('D', [St(P((hs, -60), (hs, H + 60)), 'split'), split_round(hs + 40, 350, 200, 350, x_from=hs + 40),
             St(P((hs, H - w / 2), (hs + 41, H - w / 2)), width=w), St(P((hs, w / 2), (hs + 41, w / 2)), width=w)],
       method='split stem; split bowl with a crescent channel (rounds are heavy at the sides)')
    g_('E', [St(P((hs, -60), (hs, H + 60)), 'split', c1=200),
             St(P((0, H - BAR / 2), (400, H - BAR / 2)), width=BAR), St(P((0, 360), (340, 360)), width=BAR),
             St(P((0, BAR / 2), (400, BAR / 2)), width=BAR)],
       method='split stem; three single bars; the channel cuts the top bar like the T')
    g_('F', [St(P((hs, -60), (hs, H + 60)), 'split', c1=200),
             St(P((0, H - BAR / 2), (400, H - BAR / 2)), width=BAR), St(P((0, 340), (340, 340)), width=BAR)],
       method='E without the bottom bar')
    g_('G', [split_round(RO_C, 350, RO_A, 362, wedge=(0, 40)),
             St(P((RO_C, 350 - BAR / 2), (RO_C + RO_A + g + w, 350 - BAR / 2)), width=BAR)],
       ylo=-12, yhi=H + 12, method='the C closed round to the half height, with a single inward bar under the band ends')
    g_('H', [St(P((hs, -60), (hs, H + 60)), 'split'), St(P((480 - hs, -60), (480 - hs, H + 60)), 'split'),
             St(P((hs, 360), (480 - hs, 360)), width=BAR)],
       method='two split stems, single bar')
    g_('I', [St(P((hs, -60), (hs, H + 60)), 'split')], method='split stem')
    g_('J', [St(P((400 - hs, H + 60), (400 - hs, 220), ((400 - hs, 90), (330, hs - 12), (220, hs - 12)),
                  ((120, hs - 12), (hs - 20, 80), (hs - 20, 180))), 'split', c1=20)], ylo=-12,
       method='split stem turning into a split hook')
    g_('K', [St(P((hs, -60), (hs, H + 60)), 'split'),
             St(P((hs, 230), (450, H + 120))), St(P((230, 470), (480 - hs, -120)), 'split', c0=0)],
       method='split stem; single rising arm; split falling leg')
    g_('L', [St(P((hs, -60), (hs, H + 60)), 'split', c0=200), St(P((0, BAR / 2), (390, BAR / 2)), width=BAR)],
       method='split stem; single foot bar cut by the channel')
    g_('O', [split_round(RO_C, 350, RO_A, 362)], ylo=-12, yhi=H + 12,
       method='split round: a ring of the band width with crescent channel and outer band')
    g_('P', [St(P((hs, -60), (hs, H + 60)), 'split'), split_round(hs + 20, 515, 180, 185, x_from=hs + 20),
             St(P((hs, H - w / 2), (hs + 21, H - w / 2)), width=w), St(P((hs, 330 + w / 2), (hs + 21, 330 + w / 2)), width=w)],
       method='split stem; split bowl with a crescent channel, as the traced R')
    g_('Q', [split_round(RO_C, 350, RO_A, 362), St(P((RO_C + 40, 170), (RO_C + 250, -80)))], ylo=-80, yhi=H + 12,
       method='the O with a single tail')
    g_('U', [St(P((hs, H + 60), (hs, 230), ((hs, 90), (130, hs - 12), (240, hs - 12)),
                  ((350, hs - 12), (480 - hs, 90), (480 - hs, 230)), (480 - hs, H + 60)), 'split')], ylo=-12,
       method='one split U')
    g_('V', [St(P((hs - 20, H + 140), (250, -60)), 'split'), St(P((230, -60), (500 - w / 2 + 20, H + 140)))],
       method='split falling stroke, single rising stroke')
    g_('W', [St(P((hs - 20, H + 140), (200, -60)), 'split'), St(P((180, -60), (360, H + 140))),
             St(P((360, H + 140), (520, -60)), 'split'), St(P((500, -60), (680, H + 140)))],
       method='two V constructions')
    g_('X', [St(P((hs - 20, H + 140), (480 - hs + 20, -140)), 'split'), St(P((20, -140), (460, H + 140)))],
       method='split falling, single rising')
    g_('Y', [St(P((hs - 20, H + 140), (250, 320), (250, -60)), 'split'), St(P((250, 300), (480, H + 140)))],
       method='split left arm turning into the split stem (one channel), single right arm')
    g_('Z', [St(P((20, H - BAR / 2), (440, H - BAR / 2)), width=BAR), St(P((0, BAR / 2), (440, BAR / 2)), width=BAR),
             St(P((440 - hs + 30, H + 20), (hs - 30, -20)), 'split', c0=0, c1=0)],
       method='single bars; split diagonal (heavy in a roman Z)')

    # figures: the Phoenix Graphix "400" decal shows split figures in the same family
    g_('zero', [split_round(RO_C, 350, RO_A - 14, 362)], ylo=-12, yhi=H + 12, method='split round, narrower than O')
    g_('one', [St(P((240, -60), (240, H + 60)), 'split'), St(P((60, 560), (200, H)))],
       method='split stem with a single flag')
    two = P((40, 540), ((70, 660), (160, H - hs + 12), (240, H - hs + 12)),
            ((360, H - hs + 12), (420 - hs + 10, 620), (420 - hs + 10, 520)),
            ((420 - hs + 10, 400), (300, 300), (60, 30)))
    g_('two', [St(two, 'split', c0=20, c1=0), St(P((0, BAR / 2), (430, BAR / 2)), width=BAR)], yhi=H + 12,
       method='split curve and diagonal; single base bar')
    three = P((40, 600), ((90, 670), (160, H - hs + 12), (240, H - hs + 12)),
              ((340, H - hs + 12), (410 - hs + 10, 640), (410 - hs + 10, 560)),
              ((410 - hs + 10, 450), (320, 400), (200, 400)))
    three_b = P((200, 400), ((340, 400), (430 - hs + 10, 330), (430 - hs + 10, 210)),
                ((430 - hs + 10, 80), (330, hs - 12), (220, hs - 12)), ((140, hs - 12), (70, 40), (30, 110)))
    g_('three', [St(three, 'split', c0=20, c1=0), St(three_b, 'split', c0=0, c1=20)], ylo=-12, yhi=H + 12,
       method='two split bowls')
    g_('four', [St(P((360, -60), (360, H + 60)), 'split'), St(P((300, H + 20), (20, 200), (20, 190))),
                St(P((0, 200), (470, 200)), width=BAR)],
       method='split stem; single diagonal and bar (after the Phoenix Graphix 400 decal)')
    five = P((52, 420), (240, 420),
             ((360, 420), (430 - hs + 10, 340), (430 - hs + 10, 220)),
             ((430 - hs + 10, 80), (330, hs - 12), (220, hs - 12)), ((140, hs - 12), (70, 40), (30, 110)))
    g_('five', [St(P((52, H - BAR / 2), (420, H - BAR / 2)), width=BAR), St(P((80, H), (80, 420 + 40))),
                St(five, 'split', c0=0, c1=20)], ylo=-12, method='single bar and stem; split bowl entering square')
    six = P((400, 610), ((350, 680), (300, H - hs + 12), (230, H - hs + 12)),
            ((110, H - hs + 12), (hs, 560), (hs, 330)))
    g_('six', [St(six, 'split', c0=20, c1=0),
               St(arc_ellipse(235, 230, 235 - hs, 230 - hs + 12, 180, 540), 'split', c0=0, c1=0)],
       ylo=-12, yhi=H + 12, method='split loop under a split stem curve')
    G['nine'] = ('rot', 'six')
    M['nine'] = {'provenance': 'derived', 'from': ['six'], 'method': 'the 6 turned 180 degrees'}
    g_('seven', [St(P((0, H - BAR / 2), (440, H - BAR / 2)), width=BAR), St(P((440 - hs + 20, H), (120, -60)), 'split', c0=0)],
       method='single bar; split diagonal')
    g_('eight', [St(arc_ellipse(230, 530, 200 - hs, 170 - hs + 12, 0, 360), 'split', c0=0, c1=0),
                 St(arc_ellipse(230, 190, 230 - hs, 190 - hs + 12, 0, 360), 'split', c0=0, c1=0)],
       ylo=-12, yhi=H + 12, method='two split loops, the upper narrower')
    g_('period', [St(P((BAR / 2, 0), (BAR / 2, BAR + 8)), width=BAR + 8)], method='a square of the bar weight')
    g_('comma', [St(P((BAR / 2, BAR + 8), (BAR / 2, 0), (10, -110)), width=BAR + 8)], ylo=-130,
       method='the period square with a falling tail')
    g_('hyphen', [St(P((0, 330), (300, 330)), width=BAR)], method='single bar')
    g_('slash', [St(P((0, -60), (360, H + 60)))], ylo=-60, yhi=H + 60, method='single rising stroke')
    g_('quotesingle', [St(P((w / 2, H), (w / 2, 470)))], method='single stroke')
    g_('quotedbl', [St(P((w / 2, H), (w / 2, 470))), St(P((w / 2 + 120, H), (w / 2 + 120, 470)))],
       method='two single strokes')
    g_('ampersand', [St(arc_ellipse(200, 520, 140, 150, -60, 230), width=w),
                     St(P((110, 410), (480, -60)), 'split', c0=0),
                     St(arc_ellipse(220, 200, 200, 190, 100, 360 + 10), width=w)], ylo=-12, yhi=H + 12,
       method='single loops, split falling stroke')
    return G, M


def glyph_contours(G, name):
    v = G[name]
    if v[0] == 'rot':
        con = glyph_contours(G, v[1])
        b = geom.bounds(con)
        return geom.transform(con, (-1, 0, 0, -1, b[0] + b[2], b[1] + b[3]))
    strokes, ylo, yhi = v
    return draw(strokes, ylo, yhi)


SB = {k: (40, 40) for k in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'}
SB.update({'A': (30, 20), 'T': (20, 20), 'V': (15, 15), 'W': (15, 15), 'X': (15, 15), 'Y': (15, 15),
           'K': (40, 15), 'L': (40, 15), 'P': (40, 25), 'R': (40, 20), 'C': (35, 25), 'O': (35, 35), 'S': (30, 30)})
UNI = {**{c: c for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'},
       'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7',
       'eight': '8', 'nine': '9', 'period': '.', 'comma': ',', 'hyphen': '-', 'slash': '/', 'quotesingle': "'",
       'quotedbl': '"', 'ampersand': '&'}
CLAIMED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.,&/\'" '
KERN = {('T', 'A'): -40, ('A', 'T'): -40, ('L', 'T'): -40, ('A', 'V'): -50, ('V', 'A'): -50, ('A', 'W'): -40,
        ('W', 'A'): -40, ('A', 'Y'): -50, ('Y', 'A'): -50, ('P', 'A'): -30, ('F', 'A'): -30, ('L', 'V'): -40,
        ('T', 'period'): -60, ('T', 'comma'): -60, ('P', 'period'): -60, ('seven', 'period'): -50}

# letters in the de-sheared decal: (first column, last column + 1, cap line row, baseline row), source px.
# The decal recedes from the camera, so each letter carries its own cap height (88 px at the T, 96 at the M);
# every letter is scaled to cap 700 on its own measure, which removes the perspective scale too.
TRACED_BOX = {'T': (31, 94, 13, 101), 'R': (98, 159, 11, 101), 'A': (395, 469, 5, 99), 'N': (238, 295, 8, 100),
              'S': (306, 365, 9, 96), 'M': (479, 567, 2, 98)}
# the S overshoots: its cap/baseline rows are the flat-letter lines interpolated between N and the second A


TRACE_TOL_PX = 0.8   # refit tolerance in source px (88 px a cap): the photo's grain sits under it

STRAIGHT_TOL_PX = 1.2   # a straight run whose nodes stay within 1.2 px of its chord is redrawn as one line


def trace_letter(name):
    """potrace the letter's columns of the de-sheared decal at its own scale; returns a Traced."""
    from lib.trace import potrace_mask
    c0, c1, top, base = TRACED_BOX[name]
    src = Source(SRC.file, 'alpha', 0.0, 1.0, cap_px=base - top, baseline_px=base, cap_units=H, k=8,
                 blur=0.5, shear=SRC.shear, shear_pivot_px=SRC.baseline_px)
    a = src.array()
    mask = np.zeros_like(a[:, c0 - 3:c1 + 3])
    mask[:, 3:-3] = a[:, c0:c1]
    origin = (c0 - 3, 0)
    rec, _ = potrace_mask(mask, origin, src, alphamax=1.0, opttol=0.4)
    con = geom.clean(geom.contours_from(rec))
    con = geom.clean(refit(con, tol=TRACE_TOL_PX * src.scale, corner_deg=35, step=max(1.0, 0.25 * src.scale)))
    con = geom.straighten(con, tol=STRAIGHT_TOL_PX * src.scale, snap_deg=2.5)
    return Traced(con, src, (c0, top, c1, base), mask, origin)


def build_family(out_dir, proof_dir=None):
    G, M = letters()
    glyphs = []
    for name in G:
        info = dict(M[name])
        sb = SB.get(name, (40, 40))
        if info['provenance'] == 'traced':
            t = trace_letter(name)
            con = t.contours
            x0, _, x1, _ = geom.bounds(con)
            placed = geom.translate(con, sb[0] - x0, 0)
            t.dx = sb[0] - x0
            fid = t.score(placed)
            info = {'provenance': 'traced', 'method': 'potrace of the de-sheared decal at the letter\'s own cap '
                    'height, Schneider refit; the construction rule (' + M[name]['method'] + ') is what the '
                    'derived letters copy', 'fidelity': fid, 'sourceBoxPx': TRACED_BOX[name],
                    'source': SRC.file, 'sourceSha256Base64': SRC.sha(), **SRC_INFO, 'deshear': SRC.shear}
            if proof_dir:
                overlay_png(t, placed, os.path.join(proof_dir, 'decal', f'{name}.png'), zoom=8,
                            title=f'{name} IoU {fid["iou"]}')
        else:
            con = glyph_contours(G, name)
            x0, _, x1, _ = geom.bounds(con)
            placed = geom.translate(con, sb[0] - x0, 0)
        adv = (x1 - x0) + sb[0] + sb[1]
        glyphs.append(FGlyph(name, placed, adv, ord(UNI[name]), info))
    glyphs.append(FGlyph('space', [], 220, 0x20, {'provenance': 'designed', 'method': 'measured word space of the decal'}))
    otf = build(out_dir, FAMILY, 'Regular', glyphs, ascender=900, descender=-250, cap_height=H, x_height=H,
                kerning=KERN, extra_cmap={ord(c.lower()): c for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'},
                file_stem='TransAm1973Decal-Regular',
                description='Split-stroke capitals of the 1973 Trans Am fender decal, from the decal on this car, '
                            'extended to A-Z and 0-9.',
                sidecar_extra={'rules': __doc__, 'band': w, 'channel': g})
    return otf, glyphs
