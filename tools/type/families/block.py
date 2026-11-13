"""Pontiac 1973 Block: the chrome block capitals of the 1970-73 Firebird tail panel letters (OER K1049,
"P O N T I A C"), drawn as one constructive system and extended to A-Z, 0-9 and punctuation.

Source (committed in nuke_frontend/public/stacks/makes): pontiac-firebird-tail-letters-1970-1973.jpg (OER catalogue
photograph, 1000 px, letters 82 px tall) and its silhouette cutout pontiac-firebird-tail-letters-1970-1973-cut.png.
The letters are loose parts photographed in a row, so their gaps are not spacing evidence; the C touches the right
edge of the photograph, so its terminal cut is placed at the edge (traced width is a lower bound).

Design rules, measured on the source (8.5 font units per source pixel, cap height 700):
  1. Extended proportions: O is 1.73 H wide, P 1.79 H, N 1.63 H, T 1.73 H, A 1.91 H; I is a single 0.46 H stem.
  2. Vertical contrast: stems 285-330 (I 320, P 330, T 285 under its bar), round sides 300-320; horizontals 200-210.
     Letters with three horizontals (E F B S 3 5 6 8 9 2) take 150 so their counters stay open. The source has
     no such letter: this is the system's rule, not a measurement.
  3. Diagonals follow broad-pen logic although the parts are die-cut: strokes falling left to right are heavy
     (N diagonal 330 perpendicular, A right leg 200), strokes rising left to right are light (A left leg 155), and a
     vertical that carries a heavy diagonal thins to 215 (N). Z and 7 break the rule for colour, as in a roman.
  4. Rounds are superellipses: outer n = 2.05 (close to an ellipse), counters n = 3.2, flat-topped and slot-like
     (O counter 613 x 298, P counter a 545 x 145 slot).
  5. Terminals are cut square (C, G, S, J, digits) and every corner carries the die radius (14, inner 7).
  6. The chrome part is a rim around a flat face: the face is the same construction inset by 30 units (3.5 px).
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw

from lib import geom
from lib.fontbuild import Glyph as FGlyph, build
from lib.glyphs import Traced, place, overlay_png
from lib.shapes import Rect, Poly, SE, RRect, Glyph
from lib.trace import Source, component_mask

FAMILY = 'Pontiac 1973 Block'
H = 700
OV = 8
S = 320          # stem
SR = 310         # round side
B = 205          # horizontal
B3 = 150         # horizontal in three-storey letters
TV = 215         # thin vertical beside a heavy diagonal
DT = 300         # heavy diagonal, perpendicular
DN = 165         # light diagonal, perpendicular
R = 14           # die radius
FACE = 30        # face inset
NO = 2.05
NI = 3.2

SRC = Source('pontiac-firebird-tail-letters-1970-1973-cut.png', 'alpha', 0.0, 1.0, cap_px=82.2, baseline_px=84.7,
             cap_units=H, k=8, blur=0.5)
SRC_INFO = {'page': 'OER K1049 "PONTIAC" rear panel letters, Firebird 1970-73 (catalogue photograph)',
            'url': 'https://www.oerparts.com/product/1973/pontiac/firebird/parts/k1049.html',
            'photo': 'pontiac-firebird-tail-letters-1970-1973.jpg'}
# (x0, y0) of each letter's component in the cutout; its left ink edge in source px
ANCHORS = {'P': ((1, 3), 0.8), 'O': ((164, 3), 163.8), 'N': ((322, 2), 321.5), 'T': ((475, 2), 474.4),
           'I': ((639, 3), 638.9), 'A': ((700, 3), 700.1), 'C': ((870, 3), 869.9)}
# counters measured on the photograph (source px, y down): white ground seen through the part, grown 3 px to
# the material edge
COUNTERS_PX = {'P': ('rrect', (38, 26, 102, 43)), 'O': ('se', (199, 26, 271, 61)),
               'A': ('poly', [(748, 60), (800, 60), (772, 38)]), 'C': ('se', (905, 27, 1120, 54))}


def hw(perp, dx, dy):
    """horizontal width of a straight stroke of perpendicular weight `perp` and direction (dx, dy)"""
    return perp * math.hypot(dx, dy) / abs(dy)


def stroke(xb, xt, w_perp, y0=0, y1=H):
    """straight stroke between two horizontals; its left edge runs from (xb, y0) to (xt, y1)"""
    w = hw(w_perp, xt - xb, y1 - y0)
    return Poly((xb, y0), (xb + w, y0), (xt + w, y1), (xt, y1))


def ring(x0, y0, x1, y1, side, top, bottom=None, rx=None, ry=None, corners='1111', cn='1111'):
    bottom = top if bottom is None else bottom
    w, h = x1 - x0, y1 - y0
    rx = rx if rx is not None else w / 2
    ry = ry if ry is not None else h / 2
    outer = RRect(x0, y0, x1, y1, rx, ry, NO, corners)
    ih = h - top - bottom
    inner = RRect(x0 + side, y0 + bottom, x1 - side, y1 - top, max(30, rx - side * 0.9), ih / 2, NI, cn)
    return outer, inner


def letters():
    G, M = {}, {}

    def g(name, pos, neg=(), method='', prov='designed', **kw):
        G[name] = Glyph(pos, neg)
        M[name] = {'provenance': prov, 'method': method, **kw}

    # ---------------------------------------------------------------- traced: constructed to the source
    W = 1213
    g('O', [SE(W / 2, H / 2, W / 2, H / 2 + OV, NO)], [SE(W / 2, 351, 306.5, 149, NI)], prov='traced',
      method='superellipse n 2.05, 1213 x 716; counter n 3.2, 613 x 298; fitted to the part photograph')
    W = 1256
    g('P', [Rect(0, 0, 330, H), RRect(0, 176, W, H, 600, 262, NO, corners='1100')],
      [RRect(317, 355, 862, 500, 72, 72, NI)], prov='traced',
      method='stem 330; bowl 176-700 with superellipse right side (rx 600); slot counter 545 x 145')
    W = 1138
    g('N', [Rect(0, 0, 217, 600), Rect(920, 80, W, H), Poly((0, 371), (W, 0), (W, 318), (0, H))],
      prov='traced', method='verticals 217; diagonal from the top-left corner to the bottom-right corner, '
                            '330 perpendicular, slope 18.5 degrees')
    W = 1211
    g('T', [Rect(0, 490, W, H), Rect(461, 0, 746, H)], prov='traced', method='bar 1211 x 210; stem 285')
    g('I', [Rect(0, 0, 320, H)], prov='traced', method='stem 320')
    W = 1340
    ax = 0.485 * W
    g('A', [Poly((0, 0), (W, 0), (ax, H))],
      [Poly((247, -40), (1044, -40), (883, 95), (340, 95)), Poly((409, 210), (852, 210), (613, 398))],
      prov='traced', method='triangle 1340 x 700, apex at 0.485 W; light left leg 155, heavy right leg 200; '
                            'doorway with 45-degree jambs under a 115 crossbar; triangular counter')
    W = 1102
    g('C', [SE(606, H / 2, 606, H / 2 + OV, NO)],
      [RRect(303, 261, 1300, 490, 260, 114, NI), Rect(780, 304, 2000, 457), Rect(W, -100, 3000, 900)],
      prov='traced', method='O outer; counter 261-490 (top arm 210, bottom arm 261); mouth 304-457; terminals '
                            'cut square at the photograph edge (1102, a lower bound)')

    # ---------------------------------------------------------------- designed by the rules
    W = 1180
    uo, ui = ring(0, 350 - B3 / 2, 1080, H, SR, B3, rx=420, corners='1100', cn='1111')
    lo, li = ring(0, 0, W, 350 + B3 / 2, SR, B3, rx=440, corners='1100', cn='1111')
    g('B', [Rect(0, 0, S, H), uo, lo], [ui, li, Rect(-200, -10, 0, 900)],
      method='stem; two bowls of the P construction with three-storey horizontals 150, lower bowl 100 wider')
    W = 1213
    o, i = ring(0, 0, W, H, SR, B, rx=600, corners='1100')
    g('D', [Rect(0, 0, 330, H), o], [RRect(330, B, W - SR, H - B, 260, 145, NI)],
      method='P stem with the O right half: superellipse right side over the full height')
    W = 1000
    g('E', [Rect(0, 0, S, H), Rect(0, H - B3, W, H), Rect(0, 350 - B3 / 2, W - 120, 350 + B3 / 2), Rect(0, 0, W, B3)],
      method='stem; three horizontals 150; middle arm 120 shorter')
    g('F', [Rect(0, 0, S, H), Rect(0, H - B3, 980, H), Rect(0, 330 - B3 / 2, 860, 330 + B3 / 2)],
      method='E without the bottom arm; middle arm lowered 20 for balance')
    W = 1213
    g('G', [SE(606, H / 2, 606, H / 2 + OV, NO), Rect(640, 255, W - SR / 2, 255 + B3)],
      [SE(606, 351, 306.5, 149, NI), Rect(780, 405, 2000, 490), Rect(W - 55, 405, 3000, 900)],
      method='O with the C mouth above a bar (150) reaching into the counter; the jaw is the O side below')
    W = 1150
    g('H', [Rect(0, 0, S, H), Rect(W - S, 0, W, H), Rect(0, 360 - B / 2, W, 360 + B / 2)],
      method='two stems; crossbar 205 centred 10 above the middle')
    W = 1000
    jo, ji = ring(0, 0, W, 520, SR, B, rx=500, ry=260)
    g('J', [Rect(W - S, 260, W, H), jo], [ji, Rect(-100, 260, W - S, 900)],
      method='stem on the right; hook = lower half of a ring (sides 310, bottom 205), cut square at its middle')
    W = 1180
    g('K', [Rect(0, 0, S, H),
            stroke(S - 20, W - hw(200, W - S, 440), 200, 260, H),
            Poly((W - hw(DT, W - 480, 420), 0), (W, 0), (480 + hw(DT, W - 480, 420), 420), (480, 420))],
      method='stem; light arm rising to the top right (200); heavy leg falling to the bottom right (300)')
    g('L', [Rect(0, 0, S, H), Rect(0, 0, 980, B)], method='stem; foot bar 205')
    W = 1560
    vx = 780
    hwH, hwL = hw(DT, vx, H), hw(DN, W - S - vx, H)
    g('M', [Rect(0, 0, TV, H), Rect(W - S, 0, W, H),
            Poly((0, H), (hwH, H), (vx + 70, 0), (vx + 70 - hwH, 0)),
            Poly((W - S - hwL + 30, H), (W - S + 30, H), (vx + 70, 0), (vx + 70 - hwL, 0))],
      method='N rule: thin left vertical, heavy diagonal to a vertex at the baseline, light diagonal rising '
             'to a full stem on the right')
    W = 1213
    g('Q', [SE(W / 2, H / 2, W / 2, H / 2 + OV, NO), Poly((700, 200), (880, 300), (1260, -60), (1060, -90))],
      [SE(W / 2, 351, 306.5, 149, NI)], method='O with a heavy tail falling through the lower right')
    W = 1256
    g('R', [Rect(0, 0, 330, H), RRect(0, 176, W, H, 600, 262, NO, corners='1100'),
            Poly((470, 330), (810, 330), (W, 0), (W - 340, 0))],
      [RRect(317, 355, 862, 500, 72, 72, NI)],
      method='the traced P with a heavy leg (340 wide) falling from the bowl to the bottom right')
    W = 1150
    uo, ui = ring(20, 350 - B3 / 2, W - 30, H, SR, B3, rx=420)
    lo, li = ring(0, 0, W, 350 + B3 / 2, SR, B3, rx=440)
    G['S'] = ('raw', lambda d, U=(uo, ui), L=(lo, li), W=W: _s_like(U, L, W, d))
    M['S'] = {'provenance': 'designed', 'method': 'two rings of the B (horizontals 150) sharing the middle bar; '
              'upper right and lower left sides removed; terminals cut square 70 below and above the arms'}
    W = 1150
    uo2, ui2 = ring(0, 0, W, 1400, S, B, rx=560, ry=350)
    g('U', [uo2], [ui2, Rect(-100, H, 3000, 3000)], method='lower half of a ring (sides 320, bottom 205) '
      'carried up to the cap height')
    W = 1320
    v0 = W / 2
    g('V', [Poly((0, H), (hw(DT, v0, H), H), (v0 + 75, 0), (v0 + 75 - hw(DT, v0, H), 0)),
            Poly((W - hw(DN, W - v0, H), H), (W, H), (v0 + 75, 0), (v0 - 20, 0))],
      method='heavy stroke falling to the baseline vertex (300), light stroke rising to the top right (165)')
    W = 1900
    a1, a2, a3 = 480, 950, 1420
    g('W', [Poly((0, H), (hw(DT, a1, H), H), (a1 + 60, 0), (a1 + 60 - hw(DT, a1, H), 0)),
            Poly((a2 - 60, H), (a2 + 60, H), (a1 + 60, 0), (a1 - 40, 0)),
            Poly((a2 - 60, H), (a2 - 60 + hw(DT, a3 - a2, H), H), (a3 + 60, 0), (a3 + 60 - hw(DT, a3 - a2, H), 0)),
            Poly((W - hw(DN, W - a3, H), H), (W, H), (a3 + 60, 0), (a3 - 40, 0))],
      method='two V constructions sharing a pointed middle apex')
    W = 1260
    g('X', [Poly((0, H), (hw(DT, W, H), H), (W, 0), (W - hw(DT, W, H), 0)),
            Poly((W - hw(DN, W, H), H), (W, H), (hw(DN, W, H), 0), (0, 0))],
      method='heavy stroke falling, light stroke rising, crossing at the middle')
    W = 1240
    yc = 330
    g('Y', [Poly((0, H), (hw(DT, W / 2, H - yc), H), (W / 2 + 160, yc), (W / 2 + 160 - hw(DT, W / 2, H - yc), yc)),
            Poly((W - hw(DN, W / 2, H - yc), H), (W, H), (W / 2 + 160, yc - 40), (W / 2 - 160, yc - 40)),
            Rect(W / 2 - 160, 0, W / 2 + 160, yc + 20)],
      method='V arms meeting at 330 on a stem 320')
    W = 1100
    hz = hw(250, W - 40, H)
    g('Z', [Rect(0, H - B, W - 40, H), Rect(0, 0, W, B),
            Poly((W - 40 - hz, H), (W - 40, H), (hz, 0), (0, 0))],
      method='bars 205; diagonal 250 rising (an exception to rule 3, as in a roman Z)')

    # ---------------------------------------------------------------- figures
    W = 1000
    g('zero', [SE(W / 2, H / 2, W / 2, H / 2 + OV, NO)], [SE(W / 2, H / 2, W / 2 - SR, H / 2 - B, NI)],
      method='O construction at 1000 wide')
    g('one', [Rect(260, 0, 260 + S, H), Poly((260, H), (260, 470), (0, 400), (0, 560))],
      method='stem with a light flag falling to the left')
    W = 1000
    uo, ui = ring(0, 330, W, H, SR, B3, rx=440)
    G['two'] = ('raw', lambda d, U=(uo, ui), W=W: _two(U, W, d))
    M['two'] = {'provenance': 'designed', 'method': 'S upper ring with its left side removed; heavy diagonal to '
                'the bottom left; base bar 150'}
    uo, ui = ring(40, 350 - B3 / 2, W - 30, H, SR, B3, rx=420)
    lo, li = ring(0, 0, W, 350 + B3 / 2, SR, B3, rx=440)
    G['three'] = ('raw', lambda d, U=(uo, ui), L=(lo, li), W=W: _three(U, L, W, d))
    M['three'] = {'provenance': 'designed', 'method': 'the S rings with both left sides removed; middle bar starts at 0.35 W'}
    W = 1080
    g('four', [Rect(640, 0, 640 + S, H), Rect(0, 170, W, 170 + B3 + 20),
               Poly((0, 170), (hw(DN, 640, H - 170) + 40, 170), (640 + 40, H), (640 - hw(DN, 640, H - 170) + 40, H))],
      method='stem; crossbar 170; light diagonal rising from the crossbar to the stem top')
    W = 1000
    lo, li = ring(0, 0, W, 430, SR, B3, rx=460)
    G['five'] = ('raw', lambda d, L=(lo, li), W=W: _five(L, W, d))
    M['five'] = {'provenance': 'designed', 'method': 'top bar 150 and left stem on a lower ring of 430 whose upper '
                 'left side is removed; bottom terminal cut square'}
    lo, li = ring(0, 0, W, 440, SR, B3, rx=460)
    bo, bi = ring(0, 0, W, H, SR, B3, rx=480)
    G['six'] = ('raw', lambda d, L=(lo, li), Bg=(bo, bi), W=W: _six(L, Bg, W, d))
    M['six'] = {'provenance': 'designed', 'method': 'a closed lower ring of 440 inside a full ring kept for its left '
                'side and top arm; top terminal cut square'}
    G['nine'] = ('raw', lambda d, L=(lo, li), Bg=(bo, bi), W=W: geom.transform(_six(L, Bg, W, d), (-1, 0, 0, -1, W, H)))
    M['nine'] = {'provenance': 'derived', 'from': ['six'], 'method': 'the 6 turned 180 degrees'}
    W = 980
    h7 = hw(250, W - 300, H)
    g('seven', [Rect(0, H - B, W, H), Poly((W - h7, H), (W, H), (300 + h7, 0), (300, 0))],
      method='bar 205; diagonal 250 to the baseline (an exception to rule 3)')
    W = 1000
    uo, ui = ring(50, 350 - B3 / 2, W - 50, H, SR, B3, rx=420)
    lo, li = ring(0, 0, W, 350 + B3 / 2, SR, B3, rx=440)
    g('eight', [uo, lo], [ui, li], method='two closed rings of the B, the upper one 100 narrower')

    # ---------------------------------------------------------------- punctuation
    g('period', [Rect(0, 0, 300, 230)], method='square dot: stem width by horizontal weight')
    g('comma', [Rect(0, 0, 300, 230), Poly((120, 0), (300, 0), (170, -200), (20, -200))],
      method='the dot with a tail falling left')
    g('hyphen', [Rect(0, 270, 520, 270 + 180)], method='bar 180 at mid cap height')
    g('slash', [Poly((0, -60), (hw(220, 760, H + 120), -60), (760 + hw(220, 760, H + 120), H + 60), (760, H + 60))],
      method='light diagonal 220')
    g('quotesingle', [Poly((0, H), (240, H), (190, 430), (50, 430))], method='tapered stem 240 to 140')
    g('quotedbl', [Poly((0, H), (240, H), (190, 430), (50, 430)), Poly((360, H), (600, H), (550, 430), (410, 430))],
      method='two single quotes 120 apart')
    g('ampersand', [*ring(140, 360, 780, H, 230, B3, rx=320)[:1], *ring(0, 0, 1000, 440, SR, B3, rx=460)[:1],
                    Poly((140, 520), (140 + hw(DT, 980, 520), 520), (1120, 0), (1120 - hw(DT, 980, 520), 0))],
      [ring(140, 360, 780, H, 230, B3, rx=320)[1], ring(0, 0, 1000, 440, SR, B3, rx=460)[1],
       Rect(700, 230, 2000, 420)],
      method='small upper loop over a larger lower loop opened at the right, crossed by a heavy diagonal tail')
    return G, M


def _rings(U, d):
    o, i = U
    return geom.difference(o.contours(d), i.contours(-d))


def _s_like(U, L, W, d):
    up = geom.difference(_rings(U, d), geom.rect(W * 0.5, 350 - B3 / 2 - 2 - d, 3000, H - B3 - 70 + d))
    lo = geom.difference(_rings(L, d), geom.rect(-100, B3 + 70 - d, W * 0.5, 350 + B3 / 2 + 2 + d))
    return geom.union(up, lo)


def _three(U, L, W, d):
    up = geom.difference(_rings(U, d), geom.rect(-100, 350 - B3 / 2 - 2 - d, W * 0.35 + d, H - B3 - 70 + d))
    lo = geom.difference(_rings(L, d), geom.rect(-100, B3 + 70 - d, W * 0.35 + d, 350 + B3 / 2 + 2 + d))
    return geom.union(up, lo)


def _two(U, W, d):
    up = geom.difference(_rings(U, d), geom.rect(-100, 200, W * 0.45 + d, H - B3 - 70 + d))
    up = geom.difference(up, geom.rect(-100, 200, W * 0.62 + d, 330 + B3 + d))
    diag = Poly((W - SR - 20, 520), (W, 520), (hw(DT, W, 520) * 0.9, B3 - 2), (0, B3 - 2)).contours(d)
    base = Rect(0, 0, W, B3).contours(d)
    return geom.union(up, diag, base)


def _five(L, W, d):
    lo = geom.difference(_rings(L, d), geom.rect(-100, B3 + 70 - d, S + 1 + d, 430 - B3 - 1 + d))
    stem = Rect(0, 280, S, H).contours(d)
    bar = Rect(0, H - B3, W - 40, H).contours(d)
    return geom.union(lo, stem, bar)


def _six(L, Bg, W, d):
    lo = _rings(L, d)
    big = geom.difference(_rings(Bg, d), geom.rect(W * 0.5 - d, -100, 3000, H - B3 - 70 + d))
    return geom.union(lo, big)


def contours_for(G, name, d):
    g = G[name]
    if isinstance(g, tuple):
        con = geom.clean(g[1](d))
        from lib.shapes import round_corners
        return geom.clean(round_corners(con, R if d == 0 else R * 0.6))
    return g.contours(d, R if d == 0 else R * 0.6)


SB = {  # side bearings: straight 70, round 50, diagonal/open 25
    'A': (25, 25), 'B': (70, 45), 'C': (50, 30), 'D': (70, 50), 'E': (70, 35), 'F': (70, 30), 'G': (50, 50),
    'H': (70, 70), 'I': (70, 70), 'J': (30, 70), 'K': (70, 20), 'L': (70, 25), 'M': (70, 70), 'N': (70, 70),
    'O': (50, 50), 'P': (70, 40), 'Q': (50, 40), 'R': (70, 25), 'S': (45, 45), 'T': (25, 25), 'U': (65, 65),
    'V': (20, 20), 'W': (20, 20), 'X': (20, 20), 'Y': (20, 20), 'Z': (40, 40),
    'zero': (50, 50), 'one': (40, 70), 'two': (45, 45), 'three': (40, 50), 'four': (30, 60), 'five': (60, 45),
    'six': (50, 45), 'seven': (35, 20), 'eight': (50, 50), 'nine': (45, 50),
    'period': (60, 60), 'comma': (60, 60), 'hyphen': (40, 40), 'slash': (10, 10), 'quotesingle': (60, 60),
    'quotedbl': (60, 60), 'ampersand': (40, 30),
}
UNI = {**{c: c for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'},
       'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7',
       'eight': '8', 'nine': '9', 'period': '.', 'comma': ',', 'hyphen': '-', 'slash': '/', 'quotesingle': "'",
       'quotedbl': '"', 'ampersand': '&'}
KERN = {('A', 'V'): -120, ('V', 'A'): -120, ('A', 'W'): -100, ('W', 'A'): -100, ('A', 'T'): -60, ('T', 'A'): -60,
        ('A', 'Y'): -100, ('Y', 'A'): -100, ('L', 'T'): -60, ('L', 'V'): -80, ('L', 'Y'): -80, ('P', 'A'): -80,
        ('F', 'A'): -60, ('T', 'O'): -20, ('O', 'T'): -20, ('T', 'period'): -80, ('T', 'comma'): -80,
        ('P', 'period'): -100, ('P', 'comma'): -100, ('V', 'period'): -100, ('F', 'period'): -80,
        ('seven', 'period'): -80, ('one', 'one'): 20, ('R', 'A'): 20, ('K', 'O'): -30, ('X', 'O'): -20,
        ('A', 'C'): -20, ('A', 'O'): -20, ('A', 'Q'): -20, ('A', 'G'): -20, ('C', 'A'): -20, ('O', 'A'): -20,
        ('D', 'A'): -20, ('A', 'U'): -20, ('U', 'A'): -20, ('L', 'O'): -20, ('A', 'quotesingle'): -60,
        ('A', 'quotedbl'): -60, ('L', 'quotesingle'): -60, ('L', 'quotedbl'): -60, ('hyphen', 'T'): -40,
        ('T', 'hyphen'): -40, ('A', 'M'): 0}
CLAIMED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.,&/\'" '


def _target_mask(letter):
    (anchor, left_px) = ANCHORS[letter]
    m, origin = component_mask(SRC, [anchor])
    kind, geo = COUNTERS_PX.get(letter, (None, None))
    if kind:
        im = Image.fromarray((m * 255).astype(np.uint8))
        dr = ImageDraw.Draw(im)
        ox, oy = origin
        if kind == 'rrect':
            x0, y0, x1, y1 = geo
            dr.rounded_rectangle((x0 - ox, y0 - oy, x1 - ox, y1 - oy), radius=(y1 - y0) / 2, fill=0)
        elif kind == 'se':
            x0, y0, x1, y1 = geo
            dr.ellipse((x0 - ox, y0 - oy, x1 - ox, y1 - oy), fill=0)
        else:
            dr.polygon([(x - ox, y - oy) for x, y in geo], fill=0)
        m = np.asarray(im).astype(float) / 255
    return m, origin, left_px


def build_family(out_dir, proof_dir=None):
    G, M = letters()
    out = []
    for style, d in (('Regular', 0), ('Face', FACE)):
        glyphs = []
        for name in G:
            con = contours_for(G, name, d)
            sil = contours_for(G, name, 0) if d else con
            # spacing is decided on the silhouette so both styles share advances (the layers register)
            sb = SB.get(name, (50, 50))
            x0 = geom.bounds(sil)[0]
            xr = geom.bounds(sil)[2]
            dx = sb[0] - x0
            placed = geom.translate(con, dx, 0)
            adv = (xr - x0) + sb[0] + sb[1]
            info = dict(M[name])
            if style == 'Regular' and info['provenance'] == 'traced':
                m, origin, left_px = _target_mask(name)
                t = Traced(placed, SRC, [ANCHORS[name][0]], m, origin)
                t.dx = dx - SRC.scale * left_px
                info.update({'source': SRC.file, 'sourceSha256Base64': SRC.sha(), 'counterSource': SRC_INFO['photo'],
                             'fidelity': t.score(placed), 'pxPerUnit': round(1 / SRC.scale, 5), **SRC_INFO})
                if proof_dir:
                    overlay_png(t, placed, f'{proof_dir}/overlay-block-{name}.png', zoom=6)
            glyphs.append(FGlyph(name, placed, adv, ord(UNI[name]), info))
        glyphs.append(FGlyph('space', [], 320, 0x20, {'provenance': 'designed', 'method': 'about half an I'}))
        otf = build(out_dir, FAMILY, style, glyphs, ascender=900, descender=-250, cap_height=H, x_height=H,
                    kerning=KERN, extra_cmap={ord(c.lower()): c for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'}, file_stem=f'Pontiac1973Block-{style}',
                    description=('Chrome block capitals of the 1970-73 Firebird tail panel letters, extended to a '
                                 'full set. ' + ('Silhouette.' if d == 0 else 'Face layer: the flat chrome face, '
                                                 'inset 30 units; set it over the Regular for the rim.')),
                    sidecar_extra={'rules': __doc__, 'faceInset': FACE if d else 0})
        out.append(otf)
    return out, None
