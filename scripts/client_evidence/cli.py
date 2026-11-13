#!/usr/bin/env python3
"""Dry-run by default; nothing here writes unless `apply --execute` is run by an operator with a verified backup artifact.
  plan    MANIFEST --owner UUID --clock ISO [--rates F] [--images F --vehicle ID] [--out F]   offline; manifest -> full plan
  backup  CHANGESET --owner UUID --out PATH --token-env NAME                                  read-only preflight snapshot
  apply   CHANGESET --owner UUID --backup PATH --receipt-sha SHA [--execute --token-env NAME] offline check unless --execute
  projection-backup PCS --owner UUID --out PATH --token-env NAME                              read-only pre-state of every projection head
  projection-apply  PCS --owner UUID --backup PATH --receipt-sha SHA [--execute --token-env NAME]  offline check unless --execute
                    (private image/labor projections; apply the financial changeset first. `plan --projection-out F` writes PCS)
  labor-hold IMAGES
  publish-timeline                                                                             always refuses"""
import argparse, json, os, sys
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mail_manifest as mm, labor, pipeline, projection, timeline, transport
from common import ContractError

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _load(p):
    with open(p) as fh:
        return json.load(fh)


def main(argv=None, now=None, make_transport=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('plan'); p.add_argument('manifest'); p.add_argument('--owner', required=True); p.add_argument('--clock', required=True)
    p.add_argument('--rates'); p.add_argument('--images'); p.add_argument('--vehicle'); p.add_argument('--out'); p.add_argument('--projection-out')
    b = sub.add_parser('backup'); b.add_argument('changeset'); b.add_argument('--owner', required=True); b.add_argument('--out', required=True)
    b.add_argument('--token-env', required=True)
    a = sub.add_parser('apply'); a.add_argument('changeset'); a.add_argument('--owner', required=True); a.add_argument('--backup', required=True)
    a.add_argument('--receipt-sha', required=True); a.add_argument('--execute', action='store_true'); a.add_argument('--token-env')
    pb = sub.add_parser('projection-backup'); pb.add_argument('changeset'); pb.add_argument('--owner', required=True)
    pb.add_argument('--out', required=True); pb.add_argument('--token-env', required=True)
    pa = sub.add_parser('projection-apply'); pa.add_argument('changeset'); pa.add_argument('--owner', required=True)
    pa.add_argument('--backup', required=True); pa.add_argument('--receipt-sha', required=True)
    pa.add_argument('--execute', action='store_true'); pa.add_argument('--token-env')
    h = sub.add_parser('labor-hold'); h.add_argument('images')
    sub.add_parser('publish-timeline')
    ns = ap.parse_args(argv)
    now = now or datetime.now(timezone.utc)
    mk = make_transport or (lambda env: transport.HttpTransport.from_env(env))
    try:
        if ns.cmd == 'plan':
            out = pipeline.build(_load(ns.manifest), ns.owner, ns.clock, rates=_load(ns.rates) if ns.rates else (),
                                 images=_load(ns.images) if ns.images else (), vehicle_id=ns.vehicle)
            if ns.projection_out:
                if not out['private_projection_changeset']:
                    raise ContractError('no persistable private projection items: ' + json.dumps(out['private_projection_unpersistable'])[:300])
                with open(ns.projection_out, 'x') as fh:
                    json.dump(out['private_projection_changeset'], fh, sort_keys=True)
                out = {**out, 'private_projection_changeset': {
                    'written_to': ns.projection_out, 'changeset_sha256': mm.changeset_hash(out['private_projection_changeset']),
                    'items': len(out['private_projection_changeset']['items'])}}
            if ns.out:
                with open(ns.out, 'x') as fh:
                    json.dump(out['changeset'], fh, sort_keys=True)
                out = {**out, 'changeset': {'written_to': ns.out, 'changeset_sha256': mm.changeset_hash(out['changeset']),
                                            'envelopes': len(out['changeset']['envelopes'])}}
        elif ns.cmd == 'backup':
            cs, t = _load(ns.changeset), mk(ns.token_env)
            art = mm.make_backup_artifact(cs, ns.owner, t.read, now)
            out = {**mm.write_backup_artifact(art, ns.out, REPO), 'documents_existing': art['documents_existing'],
                   'documents_absent': art['documents_absent']}
        elif ns.cmd == 'apply':
            cs = _load(ns.changeset)
            art = mm.load_backup(ns.backup, ns.receipt_sha)
            if not ns.execute:
                mm.validate_changeset(cs, ns.owner)
                mm.verify_backup(art, cs, ns.owner, now)
                out = {'mode': 'offline_check_only', 'would_apply': len(cs['envelopes']), 'writes': 0}
            else:
                if not ns.token_env:
                    raise ContractError('--execute needs --token-env')
                out = mm.apply(cs, ns.owner, art, mk(ns.token_env), now)
        elif ns.cmd == 'projection-backup':
            pcs, t = _load(ns.changeset), mk(ns.token_env)
            art = projection.make_backup(pcs, ns.owner, t, now)
            out = {**mm.write_backup_artifact(art, ns.out, REPO), 'projections_existing': art['projections_existing'],
                   'projections_absent': art['projections_absent']}
        elif ns.cmd == 'projection-apply':
            pcs = _load(ns.changeset)
            art = mm.load_backup(ns.backup, ns.receipt_sha)
            if not ns.execute:
                projection.validate_changeset(pcs, ns.owner)
                projection.verify_backup(art, pcs, ns.owner, now)
                out = {'mode': 'offline_check_only', 'would_apply_items': len(pcs['items']), 'batches': len(projection.batches(pcs)), 'writes': 0}
            else:
                if not ns.token_env:
                    raise ContractError('--execute needs --token-env')
                out = projection.apply(pcs, ns.owner, art, mk(ns.token_env), now)
        elif ns.cmd == 'labor-hold':
            out = labor.default_hold(_load(ns.images))
        else:
            timeline.publish()
    except (ContractError, OSError, ValueError) as e:   # includes refusing to overwrite and unreadable inputs
        print(f'refused: {e}', file=sys.stderr)
        return 2
    print(json.dumps(out, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
