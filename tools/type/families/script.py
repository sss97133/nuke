"""Firebird 1971 Script: the fender script of the 1971-1981 Firebird ("Firebird", die-cast chrome, OER 486904),
traced, de-slanted, and extended to a connecting lowercase and the capitals of the Pontiac model names.

Source: pontiac-firebird-fender-script-1971-1981-cut.png (the emblem silhouette; 800 x 114 px).
Measured (de-slanted by 0.24 px/px = 13.5 degrees about the baseline, row 109; F height 108 px = 700 units,
6.48 units/px):
  1. It is an italic slab script, not a pen script: stems carry flat slab serifs, the lowercase stands on one
     continuous baseline slab that joins the word (the i, r, b, i, r feet run into each other), and the i dots
     are balls.
  2. The slant is 13.5 degrees; every glyph is built upright and slanted at the end by the same shear.
  3. Contrast is vertical: stems and the sides of bowls are heavy, the tops of bowls and the arms thin out.
Construction of the rest (rule-derived from the traced parts, never redrawn from memory of a typeface):
  - o is the b's bowl made symmetric (its right half mirrored); c, a, q, p, g are that bowl with the d's stem, the
    b's stem or a designed hook; n, m, h, u reuse the r's stem and entry serif with the upper half of the o as arch;
    l, h, k take the b's ascender; t, f, j, s, v, w, x, y, z are designed in the same stems, slab and slant.
  - Every lowercase stands on the slab (84 units high) from its left to its right edge, so any two letters join.
  - The capitals beyond F (E, G, L, M, P, T, ...) are designed from the F's stem, arms and serifs.
"""
from __future__ import annotations

import math
import os

import numpy as np

from lib import geom
from lib.fit import refit
from lib.fontbuild import Glyph as FGlyph, build
from lib.glyphs import Traced, overlay_png
from lib.trace import Source, potrace_mask

FAMILY = 'Firebird 1971 Script'
FILE = 'pontiac-firebird-fender-script-1971-1981-cut.png'
SLANT = 0.24
SRC = Source(FILE, 'alpha', 0.0, 1.0, cap_px=108.0, baseline_px=109.0, cap_units=700, k=8, blur=0.5, shear=-SLANT)
SRC_INFO = {'page': 'Fender script, 1971-1981 Firebird (reproduction part photograph, OER 486904)', 'url': None}

# letter regions in the de-slanted cutout: list of (col0, col1, row0, row1) boxes whose union is the letter
REGIONS = {
    'F': [(0, 154, 0, 60), (0, 136, 60, 114)],
    'i': [(155, 206, 28, 90), (136, 206, 90, 114), (155, 190, 8, 34)],
    'r': [(206, 288, 30, 114)],
    'e': [(292, 405, 30, 62), (287, 405, 62, 114)],
    'b': [(398, 500, 0, 62), (404, 500, 62, 96), (398, 500, 96, 114)],
    'd': [(690, 800, 0, 70), (683, 800, 70, 114)],
}


def region_mask(name, src=SRC):
    a = src.array()
    m = np.zeros_like(a)
    for c0, c1, r0, r1 in REGIONS[name]:
        m[r0:r1, c0:c1] = a[r0:r1, c0:c1]
    ys, xs = np.nonzero(m > 0.02)
    X0, X1, Y0, Y1 = max(0, xs.min() - 4), xs.max() + 5, max(0, ys.min() - 4), ys.max() + 5
    return m[Y0:Y1, X0:X1], (X0, Y0)


def trace_letter(name, tol_px=0.6):
    mask, origin = region_mask(name)
    rec, _ = potrace_mask(mask, origin, SRC, alphamax=1.0, opttol=0.3)
    con = geom.clean(geom.contours_from(rec))
    con = geom.clean(refit(con, tol=tol_px * SRC.scale, corner_deg=40, step=max(1.0, 0.25 * SRC.scale)))
    con = geom.straighten(con, tol=0.8 * SRC.scale, snap_deg=3.0, min_len=40)
    return Traced(con, SRC, REGIONS[name], mask, origin)


# ------------------------------------------------------------------------------------------------ measured
XH = 482      # r and e tops
ASC = 660     # b and d tops
CAP = 700
DESC = -230
SLAB = 105    # baseline slab: i 130, r 95, b 100, d 110
STEM = 120    # lowercase stems: i 103, r 121, d 115, b 145
LIGHT = 72    # thin strokes (rising diagonals, arms)
SB = 24       # side bearing of the drawn letter inside its slab


def clip(c, x0, y0, x1, y1):
    return geom.intersection(c, geom.rect(x0, y0, x1, y1))


def mirror_x(c, cx):
    return geom.transform(c, (-1, 0, 0, 1, 2 * cx, 0))


def mirror_y(c, cy):
    return geom.transform(c, (1, 0, 0, -1, 0, 2 * cy))


def scale(c, sx, sy, ox=0, oy=0):
    return geom.transform(c, (sx, 0, 0, sy, ox - sx * ox, oy - sy * oy))


def move(c, dx, dy=0):
    return geom.translate(c, dx, dy)


def U(*parts):
    out = []
    for p in parts:
        out += p
    return geom.union(out)


def stroke(points, width, cap='butt'):
    import pathops
    p = pathops.Path()
    pen = p.getPen()
    pen.moveTo(points[0])
    for q in points[1:]:
        if isinstance(q[0], tuple):
            pen.curveTo(*q)
        else:
            pen.lineTo(q)
    pen.endPath()
    p.stroke(width, pathops.LineCap.ROUND_CAP if cap == 'round' else pathops.LineCap.BUTT_CAP,
             pathops.LineJoin.ROUND_JOIN, 4)
    return geom.contours_from(pathops.simplify(p, fix_winding=True))


def ball(cx, cy, r):
    from lib.shapes import SE
    return SE(cx, cy, r, r).contours()


def traced_parts():
    T = {}
    for n in REGIONS:
        t = trace_letter(n)
        x0 = geom.bounds(t.contours)[0]
        t.dx = -x0
        T[n] = (geom.translate(t.contours, -x0, 0), t)
    return T


def lowercase(T):
    """Every derived lowercase, in the de-slanted frame, x from 0. Returns {name: (contours, provenance)}."""
    F, i, r, e, b, d = (T[k][0] for k in 'Fireb d'.replace(' ', ''))
    out = {}

    # o: the b's bowl, right half mirrored (the b's counter is centred at x 370)
    half = clip(b, 370, -40, 800, XH + 10)
    o = U(half, mirror_x(half, 370))
    o = move(o, -geom.bounds(o)[0])
    ow = geom.bounds(o)[2]
    out['o'] = (o, ('derived', ['b'], "the b's bowl, its right half mirrored about the counter's centre"))

    # r's stem with its entry serif and foot (everything left of the arm)
    rstem = clip(r, -10, -10, 268, XH + 10)
    # n: r stem + upper half of o as the arch + the o's right side carried down to the slab
    arch = clip(o, 0, 240, ow, XH + 10)
    arch = move(arch, 143 - 0)                       # o's left side lands on the stem
    rx0, rx1 = 143 + ow - 104, 143 + ow
    n = U(rstem, arch, geom.rect(rx0, 0, rx1, 300))
    out['n'] = (n, ('derived', ['r', 'b'], "the r's stem and entry serif; the o's upper half as the arch; right "
                                         "stem carried to the slab"))
    # m: two narrower arches
    arch2 = scale(clip(o, 0, 240, ow, XH + 10), 0.72, 1.0)
    aw = geom.bounds(arch2)[2]
    m = U(rstem, move(arch2, 143), geom.rect(143 + aw - 100, 0, 143 + aw, 300),
          move(arch2, 143 + aw - 100), geom.rect(143 + 2 * aw - 200, 0, 143 + 2 * aw - 100, 300))
    out['m'] = (m, ('derived', ['r', 'b'], 'n with two arches at 0.72 of the o width'))
    # h: n with the b's ascender for its left stem
    bstem = clip(b, -10, -10, 186, ASC + 10)
    h = U(bstem, move(clip(n, 143, -10, 2000, XH + 10), 41 - 143))
    out['h'] = (h, ('derived', ['b', 'r'], "the b's ascender stem with the n's arch"))
    # u: the o's lower half with the r stem (top part) on the left and a full stem on the right
    cup = clip(o, 0, -10, ow, 240)
    rtop = clip(rstem, -10, 200, 268, XH + 10)
    u = U(move(cup, 143), rtop, geom.rect(143, 150, 264, 300), move(rstem, ow - 121))
    out['u'] = (u, ('derived', ['r', 'b'], "the o's lower half between the r's stem (left) and a full r stem (right)"))
    # l: the b's ascender, its foot slab
    l = U(bstem, geom.rect(0, 0, 260, SLAB))
    out['l'] = (l, ('derived', ['b'], "the b's ascender stem and foot without the bowl"))
    # a: the d cut to the x-height, its stem topped flat
    a = clip(d, -10, -10, 800, XH)
    out['a'] = (a, ('derived', ['d'], 'the d cut down to the x-height (single-storey a)'))
    # q: a with a descender stem and foot
    q = U(a, geom.rect(423, DESC + 40, 538, 120), geom.rect(360, DESC, 620, DESC + SLAB))
    out['q'] = (q, ('derived', ['d'], 'the a with the d stem carried to the descender and a slab foot'))
    # p: the b cut to the x-height, the r's entry serif, the stem down to a slab foot
    p = U(clip(b, -10, -10, 800, XH - 20), move(clip(rstem, -10, 300, 268, XH + 10), 41 - 143),
          geom.rect(41, DESC + 40, 186, 120), geom.rect(0, DESC, 260, DESC + SLAB))
    out['p'] = (p, ('derived', ['b', 'r'], "the b cut to the x-height with the r's entry serif; stem to a slab foot"))
    # g: the a with a descender hooking left (the o's lower half, flattened)
    hook = scale(clip(o, 0, -10, ow, 240), 0.82, 0.8)
    hb = geom.bounds(hook)
    hook = move(hook, 538 - hb[2], DESC - hb[1])
    g = U(a, geom.rect(423, DESC + 120, 538, 120), clip(hook, -10, DESC - 10, 800, DESC + 140))
    out['g'] = (g, ('derived', ['d', 'b'], "the a with the d stem carried down into the o's lower half"))
    # c: the o opened on the right, a ball terminal (the i dot) above
    idot = clip(i, 0, 480, 500, 700)
    db = geom.bounds(idot)
    rb = (db[2] - db[0]) / 2
    cc = geom.difference(o, geom.poly((ow / 2, XH / 2), (ow + 50, XH / 2 - 40), (ow + 50, XH - 120)))
    cc = U(cc, ball(ow - rb - 6, XH - 120 - rb * 0.3, rb * 0.95))
    out['c'] = (cc, ('derived', ['b', 'i'], "the o opened at the right, the i's ball as its terminal"))
    # t: a stem rising above the x-height with a crossbar
    t_ = U(geom.rect(120, 0, 120 + STEM, 600), geom.rect(20, XH - 80, 380, XH), geom.rect(60, 0, 420, SLAB))
    t_ = geom.difference(t_, geom.poly((100, 560), (260, 640), (100, 700)))
    out['t'] = (t_, ('designed', [], 'stem cut at a slant above the x-height, crossbar at the x-height, slab foot'))
    # f: the l with a hooked top (the o's upper right quarter) and a crossbar
    fhook = clip(o, ow / 2, 240, ow, XH + 10)
    fhook = move(scale(fhook, 0.9, 0.75), 41 + 72 - ow * 0.45 * 0.9 * 1.0, ASC - XH * 0.75 + 5)
    f = U(geom.rect(80, 0, 80 + STEM + 10, ASC - 150), clip(fhook, 0, ASC - 300, 800, ASC + 10),
          geom.rect(0, XH - 80, 360, XH), geom.rect(20, 0, 330, SLAB))
    out['f'] = (f, ('designed', [], 'stem with a hooked top from the o arch, crossbar at the x-height'))
    # i is traced; j: the i's stem and ball carried into the g's hook
    istem = clip(i, 100, 120, 300, XH + 10)
    jhook = move(scale(clip(o, 0, -10, ow, 240), 0.62, 0.75), 0, 0)
    jb = geom.bounds(jhook)
    jhook = move(jhook, 262 - jb[2], DESC - jb[1])
    j = U(istem, idot, geom.rect(159, DESC + 100, 262, 200), clip(jhook, -10, DESC - 10, 800, DESC + 120))
    j = move(j, 60)
    out['j'] = (j, ('derived', ['i', 'b'], "the i's stem, ball and serif carried into a descender hook"))
    # k: the l with a light arm and a heavy leg
    k = U(l, stroke([(186, 160), (430, XH - 30)], LIGHT), stroke([(260, 250), (440, 60)], STEM),
          geom.rect(330, XH - 50, 520, XH), geom.rect(300, 0, 560, SLAB))
    out['k'] = (k, ('designed', [], "the b's ascender with a light arm and heavy leg, slab serifs"))
    # s: a monoline S spine at the bowl weight, terminals cut upright
    s_ = stroke([(400, 400), ((340, 470), (110, 480), (90, 370)), ((70, 260), (380, 270), (380, 140)),
                 ((380, 30), (160, 0), (40, 110))], 100)
    s_ = U(s_, geom.rect(330, 300, 420, 430), geom.rect(10, 60, 110, 180))
    out['s'] = (s_, ('designed', [], 'one spine at the bowl weight, terminals with upright serifs'))
    # v w x y z: heavy falling, light rising strokes, slab entry serifs at the x-height
    def serif(x0, x1):
        return geom.rect(x0, XH - 60, x1, XH)
    v = U(stroke([(110, XH), (270, 40)], STEM), stroke([(270, 40), (450, XH)], LIGHT), serif(0, 230), serif(370, 530),
          geom.rect(200, 0, 330, SLAB))
    out['v'] = (v, ('designed', [], 'heavy falling, light rising stroke, slab serifs'))
    w_ = U(stroke([(110, XH), (240, 40)], STEM), stroke([(240, 40), (380, 400)], LIGHT),
           stroke([(380, 400), (520, 40)], STEM), stroke([(520, 40), (680, XH)], LIGHT),
           serif(0, 230), serif(600, 760), geom.rect(170, 0, 600, SLAB))
    out['w'] = (w_, ('designed', [], 'two v constructions sharing a stroke'))
    x_ = U(stroke([(110, XH - 30), (440, 30)], STEM), stroke([(110, 30), (440, XH - 30)], LIGHT),
           serif(0, 240), serif(330, 540))
    out['x'] = (x_, ('designed', [], 'heavy falling, light rising stroke, slab serifs top'))
    y_ = U(stroke([(110, XH), (290, 60)], STEM), stroke([(470, XH), (180, DESC + 60)], LIGHT),
           serif(0, 230), serif(380, 550), geom.rect(60, DESC, 300, DESC + 80))
    out['y'] = (y_, ('designed', [], 'the v with its rising stroke carried to a descender foot'))
    z_ = U(geom.rect(40, XH - 90, 440, XH), stroke([(420, XH - 60), (60, 60)], STEM), geom.rect(40, 0, 480, SLAB))
    out['z'] = (z_, ('designed', [], 'thin top bar, heavy diagonal, slab base'))
    return out


def capitals(T):
    F = T['F'][0]
    out = {}
    stemF = clip(F, -20, -40, 310, 600)               # stem + foot (no arms)
    top = clip(F, -20, 560, 1100, 720)                 # top bar with its swash and beak
    mid = clip(F, 303, 300, 760, 440)                  # middle bar with its beak
    bottom = mirror_y(clip(F, 233, 560, 1100, 720), 340)
    bottom = move(bottom, 0, -geom.bounds(bottom)[1] - 16)
    Fnobeak = geom.difference(F, geom.rect(560, 120, 1100, 318))
    out['E'] = (U(Fnobeak, bottom), ('derived', ['F'], "the F (middle beak dropped) with its top arm mirrored to the "
                                                      "baseline"))
    out['L'] = (U(stemF, clip(top, -20, 560, 310, 720), bottom), ('derived', ['F'], "the F's stem and swash with the "
                                                                              "mirrored top arm as its foot"))
    rt = clip(top, 233, 560, 1100, 720)
    out['T'] = (U(stemF, rt, mirror_x(rt, 233)), ('derived', ['F'], "the F's stem under its top arm made symmetric"))
    # rounds from the b's bowl, scaled to the capital
    b = T['b'][0]
    half = clip(b, 370, -40, 800, XH + 10)
    o = U(half, mirror_x(half, 370))
    o = move(o, -geom.bounds(o)[0])
    ob = geom.bounds(o)
    O = scale(o, 1.25, (CAP + 16) / (ob[3] - ob[1]))
    O = move(O, -geom.bounds(O)[0], -16 - geom.bounds(O)[1])
    Ob = geom.bounds(O)
    cx, cy = (Ob[0] + Ob[2]) / 2, CAP / 2
    G = geom.difference(O, geom.poly((cx, cy), (Ob[2] + 60, cy + 30), (Ob[2] + 60, CAP - 80)))
    G = U(G, geom.rect(cx + 40, cy - 60, Ob[2] + 10, cy + 20), geom.rect(Ob[2] - 120, 0, Ob[2] - 10, cy))
    out['G'] = (G, ('derived', ['b'], "the b's bowl made symmetric and scaled to the capital, opened with a bar and spur"))
    bowl = clip(O, cx, -50, 2000, CAP + 20)
    bowl = scale(bowl, 0.95, 0.56, cx, CAP)
    P = U(stemF, clip(top, -20, 560, 420, 720), move(bowl, 233 - cx), geom.rect(233, 280, 380, 380))
    out['P'] = (P, ('derived', ['F', 'b'], "the F's stem and swash with the b-derived bowl"))
    st2 = clip(F, 120, -40, 360, 600)
    M = U(stemF, move(st2, 640), stroke([(250, CAP - 40), (520, 40)], 140), stroke([(520, 40), (820, CAP - 40)], LIGHT),
          geom.rect(80, CAP - 70, 300, CAP), geom.rect(760, CAP - 70, 980, CAP))
    out['M'] = (M, ('derived', ['F'], "two F stems with a heavy falling and a light rising diagonal"))
    return out


CAPS_SB = (30, 30)
CLAIMED = 'abcdefghijklmnopqrstuvwxyzEFGLMPT.,-\' '


def slant(c):
    return geom.transform(c, (1, 0, SLANT, 1, 0, 0))


def build_family(out_dir, proof_dir=None):
    T = traced_parts()
    src_meta = {'source': FILE, 'sourceSha256Base64': SRC.sha(), **SRC_INFO, 'deslant': SLANT}
    items = {}   # name -> (contours upright, provenance dict, kind)
    for n in 'ireb d'.replace(' ', ''):
        con, t = T[n]
        if n == 'r':
            # the r's flag runs into the e on the emblem; standing alone it ends upright 60 units short of the join
            con = clip(con, -50, -50, 470, 800)
        items[n] = (con, {'provenance': 'traced', 'method': 'potrace of the de-slanted fender script, refit',
                          'fidelity': t.score(), 'sourceBoxPx': REGIONS[n], **src_meta}, 'lower')
        if proof_dir:
            overlay_png(t, con, os.path.join(proof_dir, 'script', f'{n}.png'), zoom=6, title=f'{n} {t.score()["iou"]}')
    con, t = T['F']
    items['F'] = (con, {'provenance': 'traced', 'method': 'potrace of the de-slanted fender script, refit',
                        'fidelity': t.score(), 'sourceBoxPx': REGIONS['F'], **src_meta}, 'cap')
    if proof_dir:
        overlay_png(t, con, os.path.join(proof_dir, 'script', 'F.png'), zoom=6, title=f'F {t.score()["iou"]}')
    for n, (con, (prov, frm, method)) in lowercase(T).items():
        items[n] = (con, {'provenance': prov, 'from': frm, 'method': method}, 'lower')
    for n, (con, (prov, frm, method)) in capitals(T).items():
        items[n] = (con, {'provenance': prov, 'from': frm, 'method': method}, 'cap')
    i = T['i'][0]
    dot = clip(i, 0, 480, 500, 700)
    db = geom.bounds(dot)
    dot0 = move(dot, -db[0], -db[1])
    items['period'] = (dot0, {'provenance': 'derived', 'from': ['i'], 'method': "the i's ball dot on the baseline"}, 'punct')
    dw, dh = db[2] - db[0], db[3] - db[1]
    items['comma'] = (U(dot0, stroke([(dw * 0.75, dh * 0.35), (dw * 0.2, -150)], 46)),
                      {'provenance': 'derived', 'from': ['i'], 'method': 'the ball with a falling tail'}, 'punct')
    items['hyphen'] = (geom.rect(0, 210, 260, 300), {'provenance': 'designed', 'method': 'a bar at the bowl weight'}, 'punct')
    items['quotesingle'] = (geom.poly((0, CAP), (90, CAP), (60, CAP - 220), (30, CAP - 220)),
                            {'provenance': 'designed', 'method': 'a tapered wedge'}, 'punct')
    uni = {'period': '.', 'comma': ',', 'hyphen': '-', 'quotesingle': "'"}
    glyphs = []
    for n, (con, info, kind) in items.items():
        con = geom.clean(con)
        x0, _, x1, _ = geom.bounds(con)
        if kind == 'lower':
            con = move(con, SB - x0)
            adv = (x1 - x0) + 2 * SB
            con = U(con, geom.rect(-14, 0, adv + 14, SLAB))
        elif kind == 'cap':
            con = move(con, CAPS_SB[0] - x0)
            adv = (x1 - x0) + sum(CAPS_SB)
        else:
            con = move(con, 30 - x0)
            adv = (x1 - x0) + 60
        con = geom.clean(slant(con))
        info.setdefault('slant', SLANT)
        glyphs.append(FGlyph(n, con, adv, ord(uni.get(n, n)), info))
    glyphs.append(FGlyph('space', [], 260, 0x20, {'provenance': 'designed', 'method': 'word space'}))
    kern = {('F', 'o'): -120, ('F', 'a'): -100, ('F', 'i'): -80, ('F', 'r'): -60, ('P', 'r'): -40, ('T', 'r'): -80,
            ('T', 'a'): -100, ('T', 'o'): -100, ('L', 'e'): -20}
    otf = build(out_dir, FAMILY, 'Regular', glyphs, ascender=900, descender=-280, cap_height=CAP, x_height=XH,
                kerning=kern, file_stem='Firebird1971Script-Regular',
                description='Italic slab script of the 1971-1981 Firebird fender emblem, traced and extended to a '
                            'connecting lowercase and the capitals of the Pontiac model names.',
                sidecar_extra={'rules': __doc__, 'slab': SLAB, 'stem': STEM})
    return otf, glyphs
