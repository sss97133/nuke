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
from lib.trace import Source, potrace_mask, smooth_outline

FAMILY = 'Firebird 1971 Script'
FILE = 'pontiac-firebird-fender-script-1971-1981-cut.png'
SLANT = 0.24
SRC = Source(FILE, 'alpha', 0.0, 1.0, cap_px=108.0, baseline_px=109.0, cap_units=700, k=8, blur=0.5, shear=-SLANT)
SRC_INFO = {'page': 'Fender script, 1971-1981 Firebird (reproduction part photograph, OER 486904)', 'url': None}

# letter regions in the de-slanted cutout: list of (col0, col1, row0, row1) boxes whose union is the letter
REGIONS = {
    'F': [(0, 154, 0, 60), (0, 136, 60, 114)],
    'i': [(155, 206, 28, 90), (136, 186, 90, 114), (155, 190, 8, 34)],   # the stud at 187-200 is hardware
    'r': [(206, 288, 30, 114)],
    'e': [(292, 405, 30, 62), (287, 405, 62, 114)],
    'b': [(398, 500, 0, 62), (404, 500, 62, 96), (398, 500, 96, 114)],
    'd': [(690, 800, 0, 70), (683, 800, 70, 114)],
}


def chrome_face(src):
    """The letter is the chrome face, not the cutout: the cutout also holds the casting's side wall and its soft
    shadow, which are smooth greys. The face is where the chrome's reflections change sharply (a 3 px luminance
    range over 100) or go dark (under 120); small enclosed highlights are filled, counters (150 px and up) kept."""
    from scipy import ndimage
    a = src.array()
    L = src.rgb().mean(2) * 255
    rng = ndimage.maximum_filter(L, 3) - ndimage.minimum_filter(L, 3)
    m = (rng > FACE_RANGE) | (L < 120)
    m = ndimage.binary_closing(m, structure=np.ones((3, 3)), iterations=2)
    lab, n = ndimage.label(~m)
    sizes = ndimage.sum(np.ones_like(L), lab, range(1, n + 1))
    holes = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s < 150])
    face = ndimage.binary_opening((m | holes) & (a > 0.3), iterations=1)
    return ndimage.gaussian_filter(face.astype(float), FACE_SMOOTH)


FACE_RANGE = 100
FACE_SMOOTH = 1.1   # px; the reflections leave a ragged edge at 97 px a capital
# the face stands 8.5 px above the cutout's baseline (the wall and shadow were under it) and its F is 97.5 px tall
FACE = Source(FILE, 'alpha', 0.0, 1.0, cap_px=97.5, baseline_px=100.5, cap_units=700, k=8, blur=0.6, shear=-SLANT,
              shear_pivot_px=109.0)
FACE._arr = chrome_face(SRC)


def region_mask(name, src=FACE):
    a = src.array()
    m = np.zeros_like(a)
    for c0, c1, r0, r1 in REGIONS[name]:
        m[r0:r1, c0:c1] = a[r0:r1, c0:c1]
    ys, xs = np.nonzero(m > 0.02)
    X0, X1, Y0, Y1 = max(0, xs.min() - 4), xs.max() + 5, max(0, ys.min() - 4), ys.max() + 5
    return m[Y0:Y1, X0:X1], (X0, Y0)


def trace_letter(name, tol_px=1.3):
    mask, origin = region_mask(name)
    rec, _ = potrace_mask(mask, origin, FACE, alphamax=1.1, opttol=0.4, turdsize=6)
    con = geom.clean(geom.contours_from(rec))
    con = geom.clean(refit(con, tol=tol_px * FACE.scale, corner_deg=40, step=max(1.0, 0.25 * FACE.scale)))
    con = geom.straighten(con, tol=1.1 * FACE.scale, snap_deg=3.0, min_len=40)
    # the emblem's mounting studs hang under the baseline at the i, b and d feet: they are hardware, not letters
    con = geom.clean(geom.intersection(con, geom.rect(-100, -6, 100000, 1000)))
    if OUTLINE_SIGMA:
        # the face's edge follows the reflections: smooth it (curvature, not weight) and refit
        con = geom.clean(smooth_outline(con, sigma_units=OUTLINE_SIGMA))
        con = geom.clean(refit(con, tol=0.6 * FACE.scale, corner_deg=40, step=max(1.0, 0.25 * FACE.scale)))
        con = geom.straighten(con, tol=0.8 * FACE.scale, snap_deg=3.0, min_len=40)
        con = geom.clean(con)
    return Traced(con, FACE, REGIONS[name], mask, origin)


OUTLINE_SIGMA = 12.0   # font units


# ------------------------------------------------------------------------------------------------ measured
XH = 440      # r 424, e 447 (chrome face, v0.2)
ASC = 664     # b 664, d 665
CAP = 700
DESC = -230
SLAB = 48     # the hairline that joins the feet on the baseline: 45-50
STEM = 64     # lowercase stems: i 56, r 68, d 76
LIGHT = 34    # hairlines (bowl tops 40-48, serifs 30)
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


# The i's ball, measured on the photograph (de-sheared, px): an ellipse 157.5-178.8 wide by 14.4-26.9 tall, its centre
# 1.6 px right of the stem's. The face mask cannot hold it: the ball is one bright highlight inside a dark ring that
# does not close, so the trace keeps only a spike of the ring and the neck. The ball is drawn at its measured place.
I_BALL = dict(dx=1.6, cy_px=20.6, rx_px=10.6, ry_px=6.25)


def i_with_ball(con):
    u = FACE.scale
    stem = clip(con, -1000, -1000, 100000, XH + 20)
    mid = geom.bounds(clip(stem, -1000, 150, 100000, 350))
    cx = (mid[0] + mid[2]) / 2 + I_BALL['dx'] * u
    cy = (FACE.baseline_px - I_BALL['cy_px']) * u
    from lib.shapes import SE
    return U(stem, SE(cx, cy, I_BALL['rx_px'] * u, I_BALL['ry_px'] * u).contours())


def traced_parts():
    T = {}
    for n in REGIONS:
        t = trace_letter(n)
        x0 = geom.bounds(t.contours)[0]
        t.dx = -x0
        con = geom.translate(t.contours, -x0, 0)
        T[n] = (i_with_ball(con) if n == 'i' else con, t)
    return T


def lowercase(T):
    """Every derived lowercase, in the de-slanted frame, x from 0. Returns {name: (contours, provenance)}.
    Coordinates are the traced parts' own (measured v0.2: b counter centre x 390, b bowl right side 619-690,
    b stem 51-160, r stem 180-248, d stem 507-583, i stem 127-183)."""
    F, i, r, e, b, d = (T[k][0] for k in 'Fireb d'.replace(' ', ''))
    out = {}
    BC, BR = 390, 692                                   # b counter centre, bowl right edge
    half = clip(b, BC, 36, BR, XH + 40)
    o = U(half, mirror_x(half, BC))
    o = move(o, -geom.bounds(o)[0])
    ob = geom.bounds(o)
    ow = ob[2]
    out['o'] = (o, ('derived', ['b'], "the b's bowl, its right half mirrored about the counter's centre"))
    side = 72                                           # the o's side at mid height
    rstem = clip(r, -10, -60, 252, XH + 40)
    def arch(sx):
        return scale(clip(o, 0, 220, ow, XH + 40), sx, 1.0)
    a1 = arch(0.8)
    aw = geom.bounds(a1)[2]
    n = U(rstem, move(a1, 180), geom.rect(180 + aw - side, 0, 180 + aw, 260))
    out['n'] = (n, ('derived', ['r', 'b'], "the r's stem and entry serif; the o's upper half (0.8 wide) as the arch; "
                                         "right stem carried to the baseline"))
    a2 = arch(0.62)
    aw2 = geom.bounds(a2)[2]
    m = U(rstem, move(a2, 180), geom.rect(180 + aw2 - side, 0, 180 + aw2, 260),
          move(a2, 180 + aw2 - side), geom.rect(180 + 2 * aw2 - 2 * side, 0, 180 + 2 * aw2 - side, 260))
    out['m'] = (m, ('derived', ['r', 'b'], 'n with two arches at 0.62 of the o width'))
    bstem = clip(b, -10, -60, 165, ASC + 20)
    h = U(bstem, move(clip(n, 181, -60, 2000, XH + 40), 51 - 180))
    out['h'] = (h, ('derived', ['b', 'r'], "the b's ascender stem with the n's arch"))
    cup = scale(clip(o, 0, -40, ow, 230), 0.8, 1.0)
    cw = geom.bounds(cup)[2]
    rtop = clip(rstem, -10, 200, 252, XH + 40)
    u = U(move(cup, 180), rtop, geom.rect(180, 150, 248, 260), move(rstem, cw - 68))
    out['u'] = (u, ('derived', ['r', 'b'], "the o's lower half (0.8 wide) between the r's stem top and a full r stem"))
    l = U(bstem, geom.rect(0, 0, 240, SLAB))
    out['l'] = (l, ('derived', ['b'], "the b's ascender stem and foot without the bowl"))
    a = clip(d, -10, -60, 900, XH)
    out['a'] = (a, ('derived', ['d'], 'the d cut down to the x-height (single-storey a)'))
    q = U(a, geom.rect(510, DESC + 30, 582, 80), geom.rect(440, DESC, 660, DESC + SLAB))
    out['q'] = (q, ('derived', ['d'], 'the a with the d stem carried to the descender and a foot'))
    p = U(clip(b, -10, -60, 900, XH - 20), move(clip(rstem, -10, 300, 252, XH + 40), 51 - 180),
          geom.rect(51, DESC + 30, 125, 120), geom.rect(0, DESC, 220, DESC + SLAB))
    out['p'] = (p, ('derived', ['b', 'r'], "the b cut to the x-height with the r's entry serif; stem to a foot"))
    hook = scale(clip(o, 0, -40, ow, 230), 0.7, 0.85)
    hb = geom.bounds(hook)
    hook = move(hook, 582 - hb[2], DESC - hb[1])
    g = U(a, geom.rect(510, DESC + 110, 582, 80), clip(hook, -10, DESC - 10, 900, DESC + 130))
    out['g'] = (g, ('derived', ['d', 'b'], "the a with the d stem carried down into the o's lower half"))
    idot = clip(i, 0, 470, 600, 800)
    db = geom.bounds(idot)
    rb = (db[2] - db[0]) / 2
    cc = geom.difference(o, geom.poly((ow / 2, XH / 2), (ow + 50, XH / 2 - 40), (ow + 50, XH - 110)))
    cc = U(cc, ball(ow - rb - 4, XH - 110 - rb * 0.2, rb * 0.95))
    out['c'] = (cc, ('derived', ['b', 'i'], "the o opened at the right, the i's ball as its terminal"))
    t_ = U(geom.rect(120, 0, 120 + STEM, 580), geom.rect(30, XH - LIGHT, 360, XH), geom.rect(40, 0, 400, SLAB))
    t_ = geom.difference(t_, geom.poly((100, 540), (200, 600), (100, 700)))
    out['t'] = (t_, ('designed', [], 'stem cut at a slant above the x-height, hairline crossbar, foot'))
    fq = clip(o, ow / 2, 220, ow, XH + 40)
    fqb = geom.bounds(fq)
    fq = move(scale(fq, 0.8, 0.7), 0, 0)
    fqb = geom.bounds(fq)
    f = U(geom.rect(90, 0, 90 + STEM, ASC - 120), move(fq, 90 + STEM - 10 - fqb[0] - 40, ASC - fqb[3]),
          geom.rect(20, XH - LIGHT, 340, XH), geom.rect(10, 0, 300, SLAB))
    out['f'] = (f, ('designed', [], 'stem with a hooked top from the o arch, hairline crossbar'))
    istem = clip(i, 100, 100, 260, XH + 40)
    jhook = scale(clip(o, 0, -40, ow, 230), 0.5, 0.8)
    jb = geom.bounds(jhook)
    jhook = move(jhook, 183 - jb[2], DESC - jb[1])
    j = move(U(istem, idot, geom.rect(127, DESC + 100, 183, 160), clip(jhook, -10, DESC - 10, 900, DESC + 110)), 60)
    out['j'] = (j, ('derived', ['i', 'b'], "the i's stem, ball and serif carried into a descender hook"))
    k = U(l, stroke([(160, 150), (400, XH - 30)], LIGHT), stroke([(220, 230), (420, 40)], STEM),
          geom.rect(320, XH - 40, 480, XH), geom.rect(300, 0, 520, SLAB))
    out['k'] = (k, ('designed', [], "the b's ascender with a hairline arm and a heavy leg"))
    s_ = stroke([(380, 370), ((320, 440), (110, 450), (90, 340)), ((70, 240), (360, 250), (360, 130)),
                 ((360, 20), (150, -5), (40, 100))], 54)
    s_ = U(s_, geom.rect(340, 290, 400, 400), geom.rect(14, 50, 74, 160))
    out['s'] = (s_, ('designed', [], 'one spine at the stem weight, terminals with upright serifs'))
    def serif(x0, x1):
        return geom.rect(x0, XH - 34, x1, XH)
    v = U(stroke([(110, XH), (270, 30)], STEM), stroke([(270, 30), (430, XH)], LIGHT), serif(30, 200), serif(370, 500))
    out['v'] = (v, ('designed', [], 'heavy falling, hairline rising stroke, flat serifs'))
    w_ = U(stroke([(110, XH), (240, 30)], STEM), stroke([(240, 30), (370, 380)], LIGHT),
           stroke([(370, 380), (500, 30)], STEM), stroke([(500, 30), (650, XH)], LIGHT), serif(30, 200), serif(590, 720))
    out['w'] = (w_, ('designed', [], 'two v constructions sharing a stroke'))
    x_ = U(stroke([(110, XH - 20), (420, 20)], STEM), stroke([(110, 20), (420, XH - 20)], LIGHT),
           serif(30, 200), serif(340, 500))
    out['x'] = (x_, ('designed', [], 'heavy falling, hairline rising stroke, flat serifs'))
    y_ = U(stroke([(110, XH), (280, 50)], STEM), stroke([(450, XH), (170, DESC + 50)], LIGHT),
           serif(30, 200), serif(380, 520), geom.rect(60, DESC, 280, DESC + SLAB))
    out['y'] = (y_, ('designed', [], 'the v with its rising stroke carried to a descender foot'))
    z_ = U(geom.rect(40, XH - LIGHT, 420, XH), stroke([(400, XH - 30), (60, 40)], STEM), geom.rect(40, 0, 440, SLAB))
    out['z'] = (z_, ('designed', [], 'hairline top bar, heavy diagonal, base'))
    return out


def capitals(T):
    F = T['F'][0]
    out = {}
    # v0.2 F: stem 166-249 (centre 208), top bar 640-700 with a beak at 949-1085, middle bar 320-380 with a beak
    stemF = clip(F, -20, -40, 300, 600)               # stem + foot (no arms)
    top = clip(F, -20, 600, 1200, 720)                 # top bar with its swash and beak
    bottom = mirror_y(clip(F, 208, 600, 1200, 720), 340)
    bottom = move(bottom, 0, -geom.bounds(bottom)[1] - 4)
    Fnobeak = geom.difference(F, geom.rect(700, 150, 1200, 315))
    out['E'] = (U(Fnobeak, bottom), ('derived', ['F'], "the F (middle beak dropped) with its top arm mirrored to the "
                                                      "baseline"))
    out['L'] = (U(stemF, clip(top, -20, 600, 300, 720), bottom), ('derived', ['F'], "the F's stem and swash with the "
                                                                              "mirrored top arm as its foot"))
    rt = clip(top, 208, 600, 1200, 720)
    out['T'] = (U(stemF, rt, mirror_x(rt, 208)), ('derived', ['F'], "the F's stem under its top arm made symmetric"))
    # rounds from the b's bowl, scaled to the capital
    b = T['b'][0]
    half = clip(b, 390, 36, 692, XH + 40)
    o = U(half, mirror_x(half, 390))
    o = move(o, -geom.bounds(o)[0])
    ob = geom.bounds(o)
    O = scale(o, 1.25, (CAP + 16) / (ob[3] - ob[1]))
    O = move(O, -geom.bounds(O)[0], -16 - geom.bounds(O)[1])
    Ob = geom.bounds(O)
    cx, cy = (Ob[0] + Ob[2]) / 2, CAP / 2
    G = geom.difference(O, geom.poly((cx, cy), (Ob[2] + 60, cy + 30), (Ob[2] + 60, CAP - 80)))
    G = U(G, geom.rect(cx + 40, cy - LIGHT - 10, Ob[2] + 10, cy), geom.rect(Ob[2] - 90, 0, Ob[2] - 10, cy))
    out['G'] = (G, ('designed', ['b'], "designed on the b's bowl made symmetric and scaled to the capital; bar and spur designed"))
    bowl = clip(O, cx, -50, 2000, CAP + 20)
    bowl = scale(bowl, 0.95, 0.56, cx, CAP)
    P = U(stemF, clip(top, -20, 600, 420, 720), move(bowl, 208 - cx), geom.rect(208, 300, 380, 300 + LIGHT + 10))
    out['P'] = (P, ('designed', ['F', 'b'], "designed: the F's stem and swash carry a bowl drawn from the b's"))
    st2 = clip(F, 120, -40, 300, 600)
    M = U(stemF, move(st2, 640), stroke([(240, CAP - 40), (520, 40)], 84), stroke([(520, 40), (820, CAP - 40)], LIGHT),
          geom.rect(80, CAP - 40, 300, CAP), geom.rect(760, CAP - 40, 980, CAP))
    out['M'] = (M, ('designed', ['F'], "designed: two F stems with a heavy falling and a light rising diagonal"))
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
            con = clip(con, -50, -50, 540, 800)
        fid = t.score(con)
        method = 'potrace of the chrome face (reflection-contrast mask, side wall and shadow excluded), de-slanted, refit'
        if n == 'i':
            method += "; the stem traced to the x-height, the ball an ellipse at its measured place (I_BALL)"
        items[n] = (con, {'provenance': 'traced', 'method': method,
                          'fidelity': fid, 'fidelityAgainst': 'chrome face mask (v0.2)', 'sourceBoxPx': REGIONS[n], **src_meta}, 'lower')
        if proof_dir:
            overlay_png(t, con, os.path.join(proof_dir, 'script', f'{n}.png'), zoom=6, title=f'{n} IoU {fid["iou"]}')
    con, t = T['F']
    fid = t.score(con)
    items['F'] = (con, {'provenance': 'traced', 'method': 'potrace of the chrome face (reflection-contrast mask, side wall and shadow excluded), de-slanted, refit',
                        'fidelity': fid, 'fidelityAgainst': 'chrome face mask (v0.2)', 'sourceBoxPx': REGIONS['F'], **src_meta}, 'cap')
    if proof_dir:
        overlay_png(t, con, os.path.join(proof_dir, 'script', 'F.png'), zoom=6, title=f'F IoU {fid["iou"]}')
    for n, (con, (prov, frm, method)) in lowercase(T).items():
        items[n] = (con, {'provenance': prov, 'from': frm, 'method': method}, 'lower')
    for n, (con, (prov, frm, method)) in capitals(T).items():
        items[n] = (con, {'provenance': prov, 'from': frm, 'method': method}, 'cap')
    i = T['i'][0]
    dot = clip(i, 0, 470, 600, 800)
    db = geom.bounds(dot)
    dot0 = move(dot, -db[0], -db[1])
    items['period'] = (dot0, {'provenance': 'derived', 'from': ['i'], 'method': "the i's ball dot on the baseline"}, 'punct')
    dw, dh = db[2] - db[0], db[3] - db[1]
    items['comma'] = (U(dot0, stroke([(dw * 0.75, dh * 0.35), (dw * 0.2, -150)], 34)),
                      {'provenance': 'derived', 'from': ['i'], 'method': 'the ball with a falling tail'}, 'punct')
    items['hyphen'] = (geom.rect(0, 190, 240, 240), {'provenance': 'designed', 'method': 'a bar at the bowl-top weight'}, 'punct')
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
            con = U(con, geom.rect(-6, 0, adv + 6, SLAB))   # 6-unit overlap: joins without seams, no overhang at word ends
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
    otf = build(out_dir, FAMILY, 'Regular', glyphs, ascender=900, descender=-250, cap_height=CAP, x_height=XH,
                kerning=kern, file_stem='Firebird1971Script-Regular',
                description='Italic slab script of the 1971-1981 Firebird fender emblem, traced and extended to a '
                            'connecting lowercase and the capitals of the Pontiac model names.',
                sidecar_extra={'rules': __doc__, 'slab': SLAB, 'stem': STEM})
    return otf, glyphs
