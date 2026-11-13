"""Pontiac 1973 Brochure Numerals: the heavy serif of the 1973 Pontiac full-line brochure ("Pontiac 1973" on the
cover, "Firebird" on pages 10-11), extended to 0-9 with the capitals and lowercase the brochure prints.

Sources (committed originals in nuke_frontend/public/stacks/makes):
  cover  = pontiac-1973-full-line-cover.jpg            "Pontiac 1973": P o n t+i (ligature) a c 1 9 7 3; cap 159 px
  spread = pontiac-1973-full-line-firebird-spread.jpg  "Firebird" heading: F r e b d; cap 63 px
Design rules (measured on the cover, font units at cap 700):
  figures are lining and taller than the capitals (720 vs 700, rounds overshoot about 15 below and above);
  capital stem 125-136, lowercase stem 110-114, bowl maximum 140-155 on the stress, hairline 45-60;
  stems are slightly waisted (concave) and flare into bracketed, cupped serifs;
  the stress is oblique (thin at 10-11 o'clock and 4-5 o'clock), terminals are tapered beaks, not balls.
"""
from __future__ import annotations

from lib import geom
from lib.fontbuild import Glyph, build, validate
from lib.glyphs import trace, place, overlay_png
from lib.trace import Source

FAMILY = 'Pontiac 1973 Brochure Numerals'
CAP = 700
FIG = 720
XH = 472

COVER = Source('pontiac-1973-full-line-cover.jpg', 'l-light', 90 / 255, 220 / 255, cap_px=159.0, baseline_px=389.8,
               cap_units=CAP, tilt_deg=-0.376, k=8, blur=0.6)
SPREAD = Source('pontiac-1973-full-line-firebird-spread.jpg', 'l-dark', 0.25, 0.7, cap_px=63.1, baseline_px=148.5,
                cap_units=CAP, tilt_deg=-0.3, k=12, blur=0.6)

# glyph -> (source, anchors = (x0, y0) of each ink component's bounding box in the levelled image, clip)
TRACE = {
    'P': (COVER, [(323, 231)], None),
    'o': (COVER, [(431, 283)], None),
    'n': (COVER, [(534, 283)], None),
    't_i': (COVER, [(643, 258), (708, 235)], None),
    'a': (COVER, [(749, 284)], None),
    'c': (COVER, [(847, 282)], None),
    'one': (COVER, [(994, 230)], None),
    'nine': (COVER, [(1047, 228)], None),
    'seven': (COVER, [(1153, 226)], None),
    'three': (COVER, [(1238, 228)], None),
    'F': (SPREAD, [(71, 86)], None),
    'r': (SPREAD, [(113, 105)], (138, 0, 168, 400)),
    'e': (SPREAD, [(113, 105)], (172, 0, 207, 400)),
    'b': (SPREAD, [(198, 82)], None),
    'd': (SPREAD, [(294, 80)], None),
}
SOURCE_INFO = {
    COVER.file: {'page': '1973 Pontiac full-line brochure, cover',
                 'url': 'https://oldcarbrochures.org/United%20States/Pontiac/1973%20Pontiac/1973-Pontiac-Full-Line-Brochure/slides/1973_Pontiac_Full_Line-01.html'},
    SPREAD.file: {'page': '1973 Pontiac full-line brochure, pp. 10-11 (Firebird)',
                  'url': 'https://oldcarbrochures.org/United%20States/Pontiac/1973%20Pontiac/1973-Pontiac-Full-Line-Brochure/slides/1973_Pontiac_Full_Line-10-11.html'},
}

# side bearings by rule: straight side 40, round side 30, open/diagonal side 15 (capitals and figures +5)
SB = {
    'zero': (38, 38), 'one': (45, 45), 'two': (30, 30), 'three': (28, 34), 'four': (22, 34), 'five': (36, 30),
    'six': (38, 32), 'seven': (30, 16), 'eight': (34, 34), 'nine': (32, 38),
    'P': (40, 14), 'F': (40, 10), 'o': (30, 30), 'n': (36, 34), 't': (16, 14), 'i': (36, 34), 't_i': (16, 34),
    'a': (28, 30), 'c': (30, 14), 'r': (36, 8), 'e': (30, 24), 'b': (36, 30), 'd': (30, 34),
    'period': (40, 40), 'comma': (40, 40), 'hyphen': (24, 24), 'quotesingle': (40, 40), 'slash': (10, 10),
}


def _scale_about(con, sx, sy, cx=0, cy=0):
    return geom.transform(con, (sx, 0, 0, sy, cx - sx * cx, cy - sy * cy))


def _split_rings(con):
    """outer contours (counter-clockwise, positive area) and counters (negative)."""
    outer = [c for c in con if geom.signed_area(c) > 0]
    inner = [c for c in con if geom.signed_area(c) < 0]
    return outer, inner


def derive(T):
    """T: name -> contours (absolute X, baseline 0). Returns name -> (contours, provenance)."""
    out = {}
    # --- 0: the cover o, outer and counter re-proportioned separately so the strokes keep their weight
    o = T['o']
    ob = geom.bounds(o)
    outer, inner = _split_rings(o)
    ib = geom.bounds(inner)
    top_t, bot_t = ob[3] - ib[3], ib[1] - ob[1]
    lo, hi = -15, FIG + 12
    sy_o = (hi - lo) / (ob[3] - ob[1])
    sx = 0.97
    cx = (ob[0] + ob[2]) / 2
    O2 = geom.transform(outer, (sx, 0, 0, sy_o, cx - sx * cx, lo - sy_o * ob[1]))
    ih = (hi - top_t * 1.08) - (lo + bot_t * 1.08)
    sy_i = ih / (ib[3] - ib[1])
    I2 = geom.transform(inner, (sx * 0.985, 0, 0, sy_i, cx - sx * 0.985 * cx, (lo + bot_t * 1.08) - sy_i * ib[1]))
    out['zero'] = (geom.clean(O2 + I2), {'provenance': 'derived', 'from': ['o'],
                   'method': 'outer contour and counter of the traced o scaled vertically to figure height '
                             'separately, keeping its top and bottom stroke weights (x 0.97)'})
    # --- 6: the traced 9 turned 180 degrees about its centre
    n9 = T['nine']
    b9 = geom.bounds(n9)
    c9 = ((b9[0] + b9[2]) / 2, (b9[1] + b9[3]) / 2)
    six = geom.transform(n9, (-1, 0, 0, -1, 2 * c9[0], 2 * c9[1]))
    out['six'] = (geom.clean(six), {'provenance': 'derived', 'from': ['nine'], 'method': 'rotation 180 degrees'})
    # --- 8: the 9's bowl closed by mirroring its left half; a smaller copy stacked on a full-size one
    bowl9 = geom.intersection(n9, geom.rect(b9[0] - 5, 235, b9[2] + 5, b9[3] + 5))
    bb = geom.bounds(bowl9)
    # mirror line through the counter's top extreme, where the bowl's tangent is horizontal
    counters = [c for c in bowl9 if geom.signed_area(c) < 0]
    ctop = max((s[-1] for c in counters for s in c), key=lambda p: p[1])
    mid = ctop[0]
    left = geom.intersection(bowl9, geom.rect(bb[0] - 5, bb[1] - 5, mid + 1, bb[3] + 5))
    mirrored = geom.transform(left, (-1, 0, 0, 1, 2 * mid, 0))
    loop = geom.union(left, mirrored)
    lb = geom.bounds(loop)
    lcx = (lb[0] + lb[2]) / 2
    H = lb[3] - lb[1]
    waist = 72                                   # the shared stroke where the loops meet
    total = (FIG + 12) - (-15)
    h_low = (total + waist) / (1 + 0.86)
    h_up = total + waist - h_low
    low = _scale_about(loop, 0.98, h_low / H, lcx, lb[1])
    low = geom.translate(low, 0, -15 - geom.bounds(low)[1])
    up = _scale_about(loop, 0.86, h_up / H, lcx, lb[3])
    up = geom.translate(up, 0, (FIG + 12) - geom.bounds(up)[3])
    out['eight'] = (geom.clean(geom.union(up, low)), {'provenance': 'derived', 'from': ['nine'],
                    'method': 'bowl of the traced 9, closed by mirroring its left half; two loops sized 1 : 0.86 '
                              'whose top and bottom strokes coincide in one 72-unit waist'})
    # --- 5: the 3's lower bowl (with its middle bar), a stem, and the 7's top bar turned end for end
    n3, n7, n1 = T['three'], T['seven'], T['one']
    b3, b7, b1 = geom.bounds(n3), geom.bounds(n7), geom.bounds(n1)
    def norm(c, b):
        return geom.translate(c, -b[0], 0)
    three, seven, one = norm(n3, b3), norm(n7, b7), norm(n1, b1)
    lower = geom.intersection(three, geom.union(geom.rect(160, -40, 600, 395), geom.rect(-10, -40, 600, 250)))
    bar = geom.intersection(seven, geom.rect(-10, 560, 300, 760))
    bar = geom.transform(bar, (-1, 0, 0, 1, 300, 0))           # 7's left end becomes the 5's right end
    bar = geom.translate(bar, 95, 0)
    stem5 = geom.poly((104, 262), (200, 262), (215, FIG - 40), (95, FIG - 40))
    out['five'] = (geom.clean(geom.union(lower, bar, stem5)), {'provenance': 'derived', 'from': ['three', 'seven'],
                   'designedParts': ['stem'],
                   'method': "lower bowl and middle bar of the traced 3, the traced 7's top bar turned end for end, "
                             'joined by a 110-unit stem'})
    # --- 2: the 3's top arch, a designed spine, a base bar with the 7's bar weight
    arch = geom.intersection(three, geom.rect(-10, 540, 600, 760))
    spine = [[('line', (40, 60), (190, 60)),
              ('curve', (190, 60), (250, 170), (412, 360), (411, 575)),
              ('line', (411, 575), (281, 575)),
              ('curve', (281, 575), (284, 400), (120, 200), (40, 60))]]
    base = [[('line', (28, 0), (432, 0)), ('line', (432, 0), (446, 170)), ('line', (446, 170), (424, 170)),
             ('curve', (424, 170), (408, 110), (388, 92), (340, 92)), ('line', (340, 92), (28, 92))]]
    out['two'] = (geom.clean(geom.union(arch, spine, base)), {'provenance': 'derived', 'from': ['three'],
                  'designedParts': ['spine', 'base'],
                  'method': "top arch and beak terminal of the traced 3; spine thinning from 125 to 85 units on the "
                            'oblique stress; flat base 92 units with an up-turned right serif'})
    # --- 4: the 1's stem and foot serif, a hairline diagonal and a crossbar
    stem = geom.intersection(one, geom.rect(40, -40, 400, 560))
    stem = geom.translate(stem, 150, 0)
    sb4 = geom.bounds(geom.intersection(stem, geom.rect(0, 300, 1000, 400)))
    upper = geom.poly((sb4[0], 520), (sb4[2], 520), (sb4[2], FIG), (sb4[0] + 40, FIG))
    diag = geom.poly((18, 250), (100, 250), (sb4[0] + 10, FIG - 150), (sb4[0] + 40, FIG), (sb4[0] - 10, FIG))
    cross = geom.poly((18, 180), (sb4[2] + 70, 180), (sb4[2] + 78, 262), (18, 262))
    out['four'] = (geom.clean(geom.union(stem, upper, diag, cross)), {'provenance': 'derived', 'from': ['one'],
                   'designedParts': ['diagonal', 'crossbar'],
                   'method': "stem and foot serif of the traced 1 (cut below its flag); hairline diagonal to a "
                             'closed apex; crossbar 82 units'})
    return out


def traced_all():
    return {name: trace(src, anchors, clip=clip, tol=8) for name, (src, anchors, clip) in TRACE.items()}


def build_family(out_dir, proof_dir=None):
    tr = traced_all()
    absolute = {n: t.contours for n, t in tr.items()}
    derived = derive(absolute)
    # t and i out of the cover's ti ligature: t = left of the gap between its stems; i = the n's left stem + the dot
    ti = absolute['t_i']
    tb = geom.bounds(ti)
    split_x = tb[0] + 0.53 * (tb[2] - tb[0])
    t_only = geom.clean(geom.intersection(ti, geom.rect(tb[0] - 5, -50, split_x, 800)))
    derived['t'] = (t_only, {'provenance': 'derived', 'from': ['t_i'],
                             'method': 'left part of the traced ti ligature, cut through its shared crossbar'})
    nb = geom.bounds(absolute['n'])
    stem_row = geom.bounds(geom.intersection(absolute['n'], geom.rect(nb[0] - 5, 180, nb[0] + 0.45 * (nb[2] - nb[0]), 220)))
    stem = geom.intersection(absolute['n'], geom.rect(nb[0] - 5, -50, stem_row[2] + 4, XH + 40))
    dot = [c for c in ti if geom.bounds([c])[1] > XH + 30 and geom.bounds([c])[0] > split_x]
    db = geom.bounds(dot)
    sb_ = geom.bounds(stem)
    dot = geom.translate(dot, ((sb_[0] + sb_[2]) / 2 + 12) - (db[0] + db[2]) / 2, 0)
    derived['i'] = (geom.clean(geom.union(stem, dot)), {'provenance': 'derived', 'from': ['n', 't_i'],
                    'method': 'left stem and entry serif of the traced n, cut before the shoulder, with the dot of '
                              'the ti ligature'})
    dot0 = geom.translate(dot, -geom.bounds(dot)[0], -geom.bounds(dot)[1])
    derived['period'] = (geom.clean(dot0), {'provenance': 'derived', 'from': ['t_i'], 'method': 'the i dot on the baseline'})
    d0 = geom.bounds(dot0)
    w = d0[2] - d0[0]
    tail = [[('line', (w * 0.97, w * 0.55), (w * 0.97, w * 0.40)),
             ('curve', (w * 0.97, w * 0.40), (w * 1.0, -w * 0.45), (w * 0.45, -w * 1.05), (-w * 0.10, -w * 1.35)),
             ('line', (-w * 0.10, -w * 1.35), (-w * 0.18, -w * 1.22)),
             ('curve', (-w * 0.18, -w * 1.22), (w * 0.25, -w * 0.85), (w * 0.42, -w * 0.45), (w * 0.38, w * 0.08)),
             ('line', (w * 0.38, w * 0.08), (w * 0.97, w * 0.55))]]
    comma = geom.union(dot0, tail)
    derived['comma'] = (geom.clean(comma), {'provenance': 'designed', 'from': ['period'],
                        'method': 'the period with a tapered tail, the same beak taper as the 7 and 3 terminals'})
    quote = geom.translate(comma, 0, FIG - geom.bounds(comma)[3])
    derived['quotesingle'] = (geom.clean(quote), {'provenance': 'designed', 'from': ['comma'],
                              'method': 'comma raised to figure height'})
    derived['hyphen'] = (geom.rect(0, 250, 260, 312), {'provenance': 'designed',
                         'method': 'bar 260 x 62 at 250, weight of the 7 top bar'})
    derived['slash'] = (geom.poly((0, -60), (70, -60), (330, FIG + 20), (260, FIG + 20)),
                        {'provenance': 'designed', 'method': 'diagonal 70 units wide, 72 degrees'})

    glyphs = []
    for name, t in tr.items():
        lsb, rsb = SB.get(name, (30, 30))
        placed, adv, dx = place(t.contours, lsb, rsb)
        t.dx = dx
        info = {'provenance': 'traced', 'source': t.src.file, 'sourceSha256Base64': t.src.sha(),
                'components': t.box, 'levelDeg': t.src.tilt_deg, 'pxPerUnit': round(1 / t.src.scale, 5),
                'baselinePx': t.src.baseline_px, 'fidelity': t.score(placed), **SOURCE_INFO[t.src.file]}
        if proof_dir:
            overlay_png(t, placed, f'{proof_dir}/overlay-numerals-{name}.png', zoom=4)
        glyphs.append((name, placed, adv, info))
    for name, (con, info) in derived.items():
        lsb, rsb = SB.get(name, (30, 30))
        placed, adv, dx = place(con, lsb, rsb)
        glyphs.append((name, placed, adv, info))
    uni = {'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7',
           'eight': '8', 'nine': '9', 'P': 'P', 'F': 'F', 'o': 'o', 'n': 'n', 't': 't', 'i': 'i', 'a': 'a', 'c': 'c',
           'r': 'r', 'e': 'e', 'b': 'b', 'd': 'd', 'period': '.', 'comma': ',', 'hyphen': '-',
           'quotesingle': "'", 'slash': '/'}
    G = [Glyph('space', [], 230, 0x20, {'provenance': 'designed', 'method': 'tight word space, as the cover setting'})]
    for name, con, adv, info in glyphs:
        G.append(Glyph(name, con, adv, ord(uni[name]) if name in uni else None, info))
    kern = {('one', 'nine'): -10, ('seven', 'three'): -20, ('seven', 'period'): -60, ('seven', 'comma'): -60,
            ('P', 'o'): -20, ('P', 'a'): -20, ('P', 'e'): -20, ('P', 'period'): -60, ('F', 'o'): -20, ('F', 'i'): -10,
            ('r', 'period'): -40, ('r', 'comma'): -40, ('one', 'one'): 10, ('seven', 'four'): -30,
            ('seven', 'zero'): -10, ('seven', 'six'): -10, ('seven', 'eight'): -10, ('seven', 'nine'): -10}
    fea = 'feature liga {\n    sub t i by t_i;\n} liga;\n'
    otf = build(out_dir, FAMILY, 'Regular', G, ascender=900, descender=-250, cap_height=CAP, x_height=XH,
                kerning=kern, fea_extra=fea,
                description='Heavy serif of the 1973 Pontiac full-line brochure cover, traced from the printed '
                            'headline and extended to the ten figures.',
                file_stem='Pontiac1973BrochureNumerals-Regular',
                sidecar_extra={'sources': SOURCE_INFO, 'figureHeight': FIG, 'rules': __doc__})
    return otf, G


if __name__ == '__main__':
    import os, sys
    d = sys.argv[1]
    os.makedirs(d, exist_ok=True)
    otf, G = build_family(os.path.join(d, 'fonts'), proof_dir=d)
    print(otf)
    for g in G:
        print(g.name, g.advance, g.provenance.get('provenance'), g.provenance.get('fidelity'))
    print(validate(otf, '0123456789PFontiacrebd.,-\'/ '))
