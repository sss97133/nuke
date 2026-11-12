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
            report[os.path.relpath(otf, REPO)] = v
            ok = not v['missing'] and not v['emptyOutlines']
            print(('OK  ' if ok else 'FAIL'), json.dumps(v))
            if not ok:
                sys.exit(1)
    with open(os.path.join(OUT, 'build-report.json'), 'w') as fh:
        json.dump(report, fh, indent=1)


if __name__ == '__main__':
    main()
