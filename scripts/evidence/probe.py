"""Size probe (PLAN pilot step 5b): evidence_probe_write only.

The function moves one of the vehicle's own images to a small sibling vehicle (100 rows or fewer, the owner can edit
it) and back with relink_testimony inside a subtransaction that always rolls back, times both legs in the database
and writes the probe run itself. Under 2 s raises the measured row limit to the vehicle's row count for 7 days; under
5 s opens that vehicle alone for 7 days. A timeout (the 60 s cap) leaves no probe row: that is itself the result, and
it goes to the owner of recompute_vehicle_primary_image. Until M1e the function returns writer_pending.

This script opens a parent run (run_kind promote, pass probe; evidence_open_run refuses run kind probe), calls the
probe once and closes the parent.

Usage: python3 scripts/evidence/probe.py --user <owner> --vehicle <id> --image <id> --sibling <id> [--mode file|db]
"""
import argparse
import sys

import common
import dbops


def probe(rest, uid, vehicle, image, sibling, parent=None):
    with dbops.JobRun(rest, uid, 'promote', 'probe', 'probe.py', {'vehicle_id': vehicle, 'sibling_vehicle_id': sibling},
                      parent) as run:
        try:
            res = rest.rpc('evidence_probe_write', {'p_parent_run_id': run.id, 'p_user_id': uid,
                                                    'p_vehicle_id': vehicle, 'p_image_id': image,
                                                    'p_sibling_vehicle_id': sibling})
        except common.RpcError as e:
            dbops.stop_on(e)
            if e.code not in dbops.TIMEOUT_CODES:
                raise
            res = {'result': 'timeout', 'note': 'no probe row: the timeout is the result; report it to the owner of '
                                                'recompute_vehicle_primary_image'}
        run.counts.update(res if isinstance(res, dict) else {'result': res})
        return res


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--user')
    ap.add_argument('--vehicle', required=True)
    ap.add_argument('--image', required=True)
    ap.add_argument('--sibling', required=True)
    ap.add_argument('--mode', choices=[common.FILE, common.DB], default=common.FILE)
    ap.add_argument('--parent')
    a = ap.parse_args()
    for x in (a.vehicle, a.image, a.sibling):
        if not common.is_uuid(x):
            raise SystemExit('ids must be uuids')
    if a.mode == common.FILE:
        print('file mode: would call evidence_probe_write(parent run, owner, vehicle, image, sibling) once. No call made.')
        return 0
    try:
        print(probe(common.Rest(), common.owner_id(a.user), a.vehicle, a.image, a.sibling, a.parent))
    except common.StopLoop as e:
        common.eprint('STOP: %s' % e)
        return 3
    return 0


if __name__ == '__main__':
    sys.exit(main())
