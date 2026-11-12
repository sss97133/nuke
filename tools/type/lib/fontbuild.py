"""Compile a family's glyphs into OTF (CFF) + WOFF2, with kerning, name table and a provenance sidecar."""
from __future__ import annotations

import json
import os

from fontTools.fontBuilder import FontBuilder
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.ttLib import TTFont

from .geom import draw_contours, bounds, lint

UPM = 1000
VERSION = '0.100'
VENDOR = 'NUKE'

LICENSE = ('Drawn for Nuke (nuke.ag) from the cited period sources listed in the provenance sidecar. '
           'Descriptive family name; not an official General Motors or Pontiac typeface and not endorsed by '
           'General Motors. Pontiac, Firebird and Trans Am are trademarks of General Motors. '
           'Font software: SIL Open Font License 1.1.')
LICENSE_URL = 'https://openfontlicense.org'


class Glyph:
    def __init__(self, name, contours, advance, unicode=None, provenance=None, lsb=None):
        self.name = name
        self.contours = contours
        self.advance = int(round(advance))
        self.unicode = unicode
        self.provenance = provenance or {}


def char_name(ch):
    from fontTools.agl import UV2AGL
    cp = ord(ch)
    return UV2AGL.get(cp, 'uni%04X' % cp)


def build(out_dir, family, style, glyphs: list[Glyph], *, ascender, descender, cap_height, x_height,
          kerning=None, fea_extra='', description='', designer_note='', sidecar_extra=None, file_stem=None,
          extra_cmap=None):
    """Write <out_dir>/<stem>.otf, .woff2 and <stem>.provenance.json. Returns the TTFont path."""
    os.makedirs(out_dir, exist_ok=True)
    stem = file_stem or (family + '-' + style).replace(' ', '')
    order = ['.notdef'] + [g.name for g in glyphs if g.name != '.notdef']
    by = {g.name: g for g in glyphs}
    if '.notdef' not in by:
        w = 500
        from .geom import rect, difference
        box = difference(rect(50, 0, w - 50, cap_height), rect(100, 50, w - 100, cap_height - 50))
        by['.notdef'] = Glyph('.notdef', box, w)
    if 'space' not in by:
        raise ValueError('family needs a space glyph')
    fb = FontBuilder(UPM, isTTF=False)
    fb.setupGlyphOrder(order)
    cmap = {g.unicode: g.name for g in glyphs if g.unicode is not None}
    for cp, name in (extra_cmap or {}).items():
        cmap.setdefault(cp, name)
    fb.setupCharacterMap(cmap)
    charstrings, metrics = {}, {}
    for name in order:
        g = by[name]
        pen = T2CharStringPen(g.advance, None)
        draw_contours(g.contours, pen)
        charstrings[name] = pen.getCharString()
        b = bounds(g.contours) if g.contours else (0, 0, 0, 0)
        metrics[name] = (g.advance, int(b[0]))
    ps_name = (family + '-' + style).replace(' ', '')
    fb.setupCFF(ps_name, {'FullName': f'{family} {style}', 'FamilyName': family, 'Weight': style},
                charstrings, {})
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ascender, descent=descender)
    fb.setupNameTable({
        'copyright': 'Outlines drawn 2026 for Nuke (nuke.ag) from cited period sources; see provenance sidecar.',
        'familyName': family,
        'styleName': style,
        'uniqueFontIdentifier': f'{VENDOR}:{ps_name}:{VERSION}',
        'fullName': f'{family} {style}',
        'version': f'Version {VERSION}',
        'psName': ps_name,
        'manufacturer': 'Nuke',
        'designer': 'Nuke type workshop (agent-drawn, owner-directed)',
        'description': description,
        'vendorURL': 'https://nuke.ag',
        'licenseDescription': LICENSE + (' ' + designer_note if designer_note else ''),
        'licenseInfoURL': LICENSE_URL,
        'typographicFamily': family,
        'typographicSubfamily': style,
    })
    fb.setupOS2(sTypoAscender=ascender, sTypoDescender=descender, sTypoLineGap=200,
                usWinAscent=max(ascender, int(max((bounds(g.contours)[3] for g in by.values() if g.contours), default=0)) + 10),
                usWinDescent=max(-descender, -int(min((bounds(g.contours)[1] for g in by.values() if g.contours), default=0)) + 10),
                sxHeight=x_height, sCapHeight=cap_height, achVendID=VENDOR, fsType=0,
                usWeightClass=400 if style in ('Regular', 'Face') else 700, fsSelection=0x40 | 0x80, version=4)
    fb.setupPost(isFixedPitch=0, underlinePosition=-100, underlineThickness=50)
    from fontTools.misc.timeTools import timestampFromString
    ts = timestampFromString('Wed Nov 11 00:00:00 2026')   # fixed, so rebuilds are byte-identical
    fb.setupHead(unitsPerEm=UPM, fontRevision=float(VERSION), created=ts, modified=ts)
    fea = ''
    if kerning:
        lines = [f'    pos {a} {b} {v};' for (a, b), v in sorted(kerning.items()) if v and a in by and b in by]
        if lines:
            fea += 'feature kern {\n' + '\n'.join(lines) + '\n} kern;\n'
    fea += fea_extra
    if fea:
        addOpenTypeFeaturesFromString(fb.font, fea)
    otf = os.path.join(out_dir, stem + '.otf')
    fb.save(otf)
    f = TTFont(otf)
    f.flavor = 'woff2'
    f.save(os.path.join(out_dir, stem + '.woff2'))
    side = {
        'family': family, 'style': style, 'version': VERSION, 'unitsPerEm': UPM,
        'capHeight': cap_height, 'xHeight': x_height, 'ascender': ascender, 'descender': descender,
        'license': LICENSE, 'glyphCount': len(order),
        'glyphs': {g.name: {'unicode': ('U+%04X' % g.unicode) if g.unicode is not None else None,
                            'advance': g.advance, **g.provenance, 'lint': lint(g.contours)}
                   for g in glyphs},
    }
    if sidecar_extra:
        side.update(sidecar_extra)
    with open(os.path.join(out_dir, stem + '.provenance.json'), 'w') as fh:
        json.dump(side, fh, indent=1, ensure_ascii=False)
    return otf


def validate(otf_path, claimed_chars):
    """Re-open the font, check every claimed character maps to a glyph with an outline (except space)."""
    f = TTFont(otf_path)
    cmap = f.getBestCmap()
    missing = [c for c in claimed_chars if ord(c) not in cmap]
    gs = f.getGlyphSet()
    empty = []
    from fontTools.pens.boundsPen import BoundsPen
    for c in claimed_chars:
        if ord(c) in cmap and not c.isspace():
            bp = BoundsPen(gs)
            gs[cmap[ord(c)]].draw(bp)
            if bp.bounds is None:
                empty.append(c)
    return {'file': os.path.basename(otf_path), 'glyphs': len(f.getGlyphOrder()), 'cmap': len(cmap),
            'missing': missing, 'emptyOutlines': empty}
