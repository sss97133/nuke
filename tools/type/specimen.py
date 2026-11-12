"""Write the specimen page for the period families.

    .venv/bin/python specimen.py OUT_DIR [--proofs DIR]

Fails if any run of text names a character its family does not map (a browser would silently fall back and the
screenshot would lie). OUT_DIR gets specimen.html; fonts and overlays are referenced by absolute file:// URL.
"""
import argparse
import html
import json
import os
import sys

from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from lib.trace import REPO  # noqa: E402

PERIOD = os.path.join(REPO, 'nuke_frontend', 'public', 'fonts', 'period')
FAM = {
    # key: (css family, otf, folder, class)
    'block': ('Pontiac 1973 Block', 'pontiac-1973-block/Pontiac1973Block-Regular.otf', 'period-chrome'),
    'script': ('Firebird 1971 Script', 'firebird-1971-script/Firebird1971Script-Regular.otf', 'period-script-chrome'),
    'decal': ('Trans Am 1973 Decal', 'trans-am-1973-decal/TransAm1973Decal-Regular.otf', 'period-decal'),
    'numerals': ('Pontiac 1973 Brochure Numerals',
                 'pontiac-1973-brochure-numerals/Pontiac1973BrochureNumerals-Regular.otf', 'period-brochure'),
}
CMAP = {k: TTFont(os.path.join(PERIOD, v[1])).getBestCmap() for k, v in FAM.items()}
SIDE = {k: json.load(open(os.path.join(PERIOD, v[1][:-4] + '.provenance.json'))) for k, v in FAM.items()}

SETTINGS = [
    [('1973', 'numerals'), (' ', None), ('PONTIAC', 'block'), (' ', None), ('Firebird', 'script'), (' ', None),
     ('TRANS AM', 'decal'), ('-Style', 'ui')]   # the tribute qualifier is Nuke's statement: UI face, never period,
    [('1974', 'numerals'), (' ', None), ('PONTIAC', 'block'), (' ', None), ('Firebird Formula', 'script')],
    [('1970', 'numerals'), (' ', None), ('PONTIAC', 'block'), (' ', None), ('Firebird Esprit', 'script')],
    [('1981', 'numerals'), (' ', None), ('TRANS AM', 'decal')],
]
CONTROL = {
    'block': ['HHOHH HOHOH', 'PONTIAC FIREBIRD', 'TRANS AM & LE MANS', "GTO 400 / 455 H.O. 'SD'"],
    'decal': ['HHOHH HOHOH', 'TRANS AM', 'FORMULA 400 / 455', 'SUPER DUTY'],
    'script': ['nnonn nonon', 'Firebird Formula', 'Esprit Grand Prix Le Mans', 'Tempest Formula'],
    'numerals': ['1973 1974 1981', '0123456789', 'Pontiac Firebird', "1973-'74 / 1,973."],
}
SIZES = [96, 36, 18, 12]


def check(text, fam):
    miss = sorted({c for c in text if ord(c) not in CMAP[fam] and not c.isspace()})
    if miss:
        raise SystemExit(f'{fam} lacks {miss!r} for {text!r}')


def run(text, fam, size=None):
    if fam is None:
        return '<span class="gap"></span>'
    if fam == 'ui':
        return f'<span class="ui-qualifier">{html.escape(text)}</span>'
    check(text, fam)
    cls = FAM[fam][2] + (' plain' if size and size < 24 and fam in ('block', 'script') else '')
    st = f' style="font-size:{size}px"' if size else ''
    data = f' data-text="{html.escape(text)}"' if fam == 'block' else ''
    return f'<span class="{cls}" data-fam="{fam}"{data}{st}>{html.escape(text)}</span>'


def charset(fam):
    return ''.join(sorted({chr(c) for c in CMAP[fam] if c > 32 and not (fam != 'script' and chr(c).islower()
                                                                       and chr(c).upper() != chr(c)
                                                                       and ord(chr(c).upper()) in CMAP[fam])}))


def counts(fam):
    c = {}
    for g, info in SIDE[fam]['glyphs'].items():
        if g in ('space', '.notdef'):
            continue
        c[info.get('provenance', 'designed')] = c.get(info.get('provenance', 'designed'), 0) + 1
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--proofs')
    a = ap.parse_args()
    css = open(os.path.join(PERIOD, 'period-fonts.css')).read().replace("url('", "url('file://" + PERIOD + '/')
    parts = []
    parts.append('<section><h2>Header settings</h2>')
    for s in SETTINGS:
        parts.append('<div class="setting">' + ''.join(run(t, f, 72) for t, f in s) + '</div>')
    parts.append('</section>')
    for fam in ('block', 'script', 'decal', 'numerals'):
        name = FAM[fam][0]
        c = counts(fam)
        cs = charset(fam)
        parts.append(f'<section><h2>{name}</h2><p class="meta">{SIDE[fam]["glyphCount"]} glyphs (with .notdef): '
                     + ', '.join(f'{v} {k}' for k, v in sorted(c.items())) + '</p>')
        parts.append('<p class="meta">Sizes 12-18 in plain fill (the outline); the material classes need 24 px and up.</p>')
        for size in SIZES:
            parts.append(f'<div class="row"><span class="sz">{size}</span>' + run(CONTROL[fam][1], fam, size) + '</div>')
        parts.append('<h3>Character set</h3><div class="row">' + run(cs, fam, 48) + '</div>')
        parts.append('<h3>Control strings</h3>')
        for t in CONTROL[fam]:
            parts.append('<div class="row">' + run(t, fam, 40) + '</div>')
        parts.append('<h3>Waterfall</h3>')
        for size in (120, 72, 48, 32, 24, 18, 14, 12):
            parts.append(f'<div class="row wf"><span class="sz">{size}</span>' + run(CONTROL[fam][1], fam, size) + '</div>')
        if a.proofs:
            imgs = []
            for root, _, files in os.walk(a.proofs):
                for f in sorted(files):
                    p = os.path.join(root, f)
                    tag = {'block': 'overlay-block-', 'numerals': 'overlay-numerals-'}.get(fam)
                    if (tag and f.startswith(tag)) or (fam in ('decal', 'script') and os.path.basename(root) == fam):
                        imgs.append(p)
            if imgs:
                parts.append('<h3>Traced outlines over the source photograph</h3><div class="ov">'
                             + ''.join(f'<img src="file://{p}" alt="">' for p in imgs) + '</div>')
        parts.append('</section>')
    doc = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Period Type Specimen</title><style>{css}
:root {{ --bg:#f6f5f2; --fg:#16181b; --muted:#6b7077; --rule:#d9d6cf; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg:#111315; --fg:#ececea; --muted:#8d939a; --rule:#2a2d31; }} }}
:root[data-theme="dark"] {{ --bg:#111315; --fg:#ececea; --muted:#8d939a; --rule:#2a2d31; }}
body {{ background:var(--bg); color:var(--fg); font:14px/1.4 -apple-system, system-ui, sans-serif; margin:0; padding:32px 24px; }}
h1 {{ font-size:18px; margin:0 0 4px; }} h2 {{ font-size:15px; margin:40px 0 8px; border-top:1px solid var(--rule); padding-top:16px; }}
h3 {{ font-size:12px; color:var(--muted); font-weight:500; margin:20px 0 6px; text-transform:uppercase; letter-spacing:.06em; }}
.meta, .sz {{ color:var(--muted); font-size:12px; }} .sz {{ display:inline-block; width:36px; }}
.row {{ margin:6px 0; overflow-wrap:anywhere; }} .setting {{ margin:14px 0; line-height:1.1; }}
.gap {{ display:inline-block; width:22px; }}
.ui-qualifier {{ font:500 28px/1 -apple-system, system-ui, sans-serif; color:var(--muted); }}
.plain, .plain::after {{ color:var(--fg) !important; background:none !important; -webkit-text-stroke:0 !important; filter:none !important; }}
.plain::after {{ display:none; }}
.ov img {{ height:240px; margin:0 8px 8px 0; border:1px solid var(--rule); background:#fff; }}
</style></head><body><h1>Period type for the 1973 Firebird header</h1>
<p class="meta">Pontiac 1973 Block, Firebird 1971 Script, Trans Am 1973 Decal, Pontiac 1973 Brochure Numerals. Version 0.100.
Descriptive names; not official General Motors typefaces.</p>
{''.join(parts)}</body></html>"""
    os.makedirs(a.out, exist_ok=True)
    out = os.path.join(a.out, 'specimen.html')
    open(out, 'w').write(doc)
    print(out)


if __name__ == '__main__':
    main()
