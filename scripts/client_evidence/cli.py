#!/usr/bin/env python3
"""Dry-run by default. plan-mail <manifest.json> --owner <uuid>; apply is refused without a backup receipt for the exact changeset.
Usage: python3 scripts/client_evidence/cli.py plan-mail MANIFEST --owner UUID [--clock ISO]"""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mail_manifest as mm, labor
from common import ContractError


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('plan-mail'); p.add_argument('manifest'); p.add_argument('--owner', required=True); p.add_argument('--clock', required=True)
    h = sub.add_parser('labor-hold'); h.add_argument('images')
    a = ap.parse_args(argv)
    try:
        if a.cmd == 'plan-mail':
            out = mm.plan(json.load(open(a.manifest)), a.owner, a.clock)
        else:
            out = labor.default_hold(json.load(open(a.images)))
    except ContractError as e:
        print(f'refused: {e}', file=sys.stderr)
        return 2
    print(json.dumps(out, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
