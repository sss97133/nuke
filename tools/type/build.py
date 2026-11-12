"""Build every period family. See build.sh."""
import argparse
import importlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from lib.fontbuild import validate  # noqa: E402
from lib.trace import REPO  # noqa: E402

OUT = os.path.join(REPO, 'nuke_frontend', 'public', 'fonts', 'period')

FAMILIES = [
    # module, output folder, characters the family claims to cover
    ('families.numerals', 'pontiac-1973-brochure-numerals', "0123456789PFontiacrebd.,-'/ "),
    ('families.block', 'pontiac-1973-block', None),
    ('families.decal', 'trans-am-1973-decal', None),
    ('families.script', 'firebird-1971-script', None),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--proofs', help='directory for source overlays and proofs')
    ap.add_argument('--only', help='comma list of output folders to build')
    a = ap.parse_args()
    report = {}
    for mod, folder, claimed in FAMILIES:
        if a.only and folder not in a.only.split(','):
            continue
        try:
            m = importlib.import_module(mod)
        except ModuleNotFoundError as e:
            if e.name == mod:
                continue
            raise
        out_dir = os.path.join(OUT, folder)
        res = m.build_family(out_dir, proof_dir=a.proofs)
        otfs = res[0] if isinstance(res[0], list) else [res[0]]
        chars = claimed or getattr(m, 'CLAIMED', '')
        for otf in otfs:
            v = validate(otf, chars)
            side = json.load(open(otf[:-4] + '.provenance.json'))
            counts = {}
            for gname, gi in side['glyphs'].items():
                if gname in ('space', '.notdef'):
                    continue
                counts[gi.get('provenance', 'designed')] = counts.get(gi.get('provenance', 'designed'), 0) + 1
            v['provenance'] = counts
            report[os.path.relpath(otf, REPO)] = v
            ok = not v['missing'] and not v['emptyOutlines']
            print(('OK  ' if ok else 'FAIL'), json.dumps(v))
            if not ok:
                sys.exit(1)
    path = os.path.join(OUT, 'build-report.json')
    if a.only and os.path.exists(path):
        # A partial build keeps the other families' records.
        report = {**json.load(open(path)), **report}
    with open(path, 'w') as fh:
        json.dump(report, fh, indent=1)
    write_manifest()


def write_manifest():
    """manifest.json: per family, its WOFF2 files (Regular first) and the characters its cmap draws. The vehicle
    identity reads it to load a family and to refuse any word the family does not draw."""
    from fontTools.ttLib import TTFont
    manifest = {}
    for _, folder, _ in FAMILIES:
        d = os.path.join(OUT, folder)
        files = sorted((f for f in os.listdir(d) if f.endswith('.woff2')), key=lambda f: (not f.endswith('-Regular.woff2'), f))
        if not files:
            continue
        cmap = TTFont(os.path.join(d, files[0])).getBestCmap()
        manifest[folder] = {'files': [f'{folder}/{f}' for f in files], 'chars': ''.join(sorted(chr(c) for c in cmap))}
    with open(os.path.join(OUT, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=1, ensure_ascii=False)
        fh.write('\n')


if __name__ == '__main__':
    main()
