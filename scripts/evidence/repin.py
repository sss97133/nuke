"""Re-pin after a merge (PLAN section 5; launchd ag.nuke.evidence-repin at 02:45Z, before the 03:20Z sweep).

evidence_repin_after_merge(run, owner, limit): for every promoted image a merge moved to the survivor
(repin_needed), a new pin on the survivor; for one derive moved back onto a merged row (on_merged_vehicle), a relink
to the survivor and a pin. Each image runs in its own exception block in the database; a raise there is a
promotion_blocked row (step repin) that this script reads back and leaves for the next day's run.

A 57014 (the 60 s cap) cancels the whole call and names no image, so the script retries one image per call; when a
single-image call times out it records the failure (record_promotion_failure, step repin) against the first image
the watch lists (the order the function uses) and stops until the next run. Refused 03:15-03:35Z. With
--window-utc HH:MM-HH:MM it does nothing outside that window (the launchd job wakes every 15 minutes, so the UTC time
holds across daylight saving).

Usage: python3 scripts/evidence/repin.py --user <owner> [--limit 200] [--window-utc 02:45-03:00] [--mode file|db]
"""
import argparse
import sys

import common
import dbops


def first_watch_image(reader, uid):
    rows = reader.read("select image_id from public.evidence_revert_watch(:uid) where kind = 'repin_needed' or "
                       "kind = 'on_merged_vehicle' order by image_id limit 1", {'uid': uid}, tag='repin_first')
    return rows[0]['image_id'] if rows else None


def repin(rest, reader, uid, limit=200, parent=None):
    with dbops.JobRun(rest, uid, 'repin', 'repin', 'repin.py', {'limit': limit}, parent) as run:
        try:
            res = rest.rpc('evidence_repin_after_merge', {'p_run_id': run.id, 'p_user_id': uid, 'p_limit': limit})
        except common.RpcError as e:
            dbops.stop_on(e)
            if e.code not in dbops.TIMEOUT_CODES:
                raise
            res = {'repinned': 0, 'blocked': 0, 'timeouts': 0}
            for _ in range(limit):
                try:
                    one = rest.rpc('evidence_repin_after_merge', {'p_run_id': run.id, 'p_user_id': uid, 'p_limit': 1})
                except common.RpcError as e1:
                    dbops.stop_on(e1)
                    if e1.code not in dbops.TIMEOUT_CODES:
                        raise
                    img = first_watch_image(reader, uid)
                    if img:
                        dbops.record_failure(rest, run.id, uid, img, e1, 'repin')
                    res['timeouts'] += 1
                    break
                if not one.get('repinned') and not one.get('blocked'):
                    break
                res['repinned'] += one.get('repinned', 0)
                res['blocked'] += one.get('blocked', 0)
        blocked = reader.read("select reason, count(*) n from evidence_decisions where user_id = :uid and decision = "
                              "'promotion_blocked' and detail->>'step' = 'repin' and detail->>'run_id' = :run "
                              "group by 1", {'uid': uid, 'run': run.id}, tag='repin_blocked') if res.get('blocked') else []
        run.counts.update(res, blocked_by_reason={b['reason']: b['n'] for b in blocked})
        return dict(res, blocked_by_reason={b['reason']: b['n'] for b in blocked})


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--user')
    ap.add_argument('--limit', type=int, default=200)
    ap.add_argument('--window-utc', help='run only inside this UTC window, e.g. 02:45-03:00')
    ap.add_argument('--mode', choices=[common.FILE, common.DB], default=common.FILE)
    ap.add_argument('--parent')
    a = ap.parse_args()
    if a.window_utc and not common.in_utc_window(a.window_utc):
        return 0
    if common.in_sweep_window():
        common.eprint('repin refused 03:15-03:35Z (the derive sweep runs then)')
        return 2
    if a.mode == common.FILE:
        print('file mode: would call evidence_repin_after_merge(run, owner, %d) once. No call made.' % a.limit)
        return 0
    try:
        print(repin(common.Rest(), common.Reader(), common.owner_id(a.user), a.limit, a.parent))
    except common.StopLoop as e:
        common.eprint('STOP: %s' % e)
        return 3
    return 0


if __name__ == '__main__':
    sys.exit(main())
