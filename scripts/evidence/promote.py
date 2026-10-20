"""Promotion (PLAN K30-6, section 5 step 7): promote_image once per image, after the owner's decisions.

Before the first image and between images: refused 03:15-03:35Z (cron 501's sweep and 499), IO waiters <= 3 (a
stop after 10 minutes above), the daily cap of testimony writes (1,000 by default). promote_image checks the same
inside the database and returns 'halted' with the reason; a halt on the revert watch is a stop condition. A 57014
(the 60 s cap) cancels the call and is recorded with record_promotion_failure (step promote); the image is retried
next run. A 42501 stops the run. Blocked results are read back from evidence_decisions by the scoreboard (M13).

The promotion path ships with every testimony writer disabled (evidence_enabled_writers() = '{}' until M1e), so
until then every image returns blocked: writer_pending:<name>, which is the expected result.

Usage: python3 scripts/evidence/promote.py --user <owner> --images <id> [<id> ...] | --images-file <file>
       [--mode file|db] [--parent <run id>] [--daily-cap 1000]
"""
import argparse
import collections
import sys
import time

import common
import dbops


def plan_images(a):
    ids = list(a.images or [])
    if a.images_file:
        with open(a.images_file) as f:
            ids += [x.strip() for x in f if x.strip()]
    bad = [x for x in ids if not common.is_uuid(x)]
    if bad:
        raise SystemExit('not image ids: %s' % bad[:3])
    return ids


def promote(rest, reader, uid, images, daily_cap=1000, parent=None, now=common.utc_now, sleep=time.sleep,
            clock=time.time):
    """-> counts. Raises StopLoop on a stop condition (the job run closes 'aborted')."""
    counts = collections.Counter()
    blocked = collections.Counter()
    if common.in_sweep_window(now()):
        raise common.StopLoop('sweep_window', 'promotion is refused 03:15-03:35Z')
    dbops.io_gate(reader, sleep=sleep, clock=clock)
    if dbops.testimony_writes_today(reader, uid) >= daily_cap:
        counts['daily_cap_reached'] = 1
        return counts
    with dbops.JobRun(rest, uid, 'promote', 'promote', 'promote.py', {'images': len(images), 'daily_cap': daily_cap},
                      parent) as run:
        for image in images:
            if common.in_sweep_window(now()):
                counts['stopped_sweep_window'] += 1
                break
            for attempt in range(11):
                try:
                    res = rest.rpc('promote_image', {'p_run_id': run.id, 'p_image_id': image, 'p_actor_user_id': uid,
                                                     'p_options': {'daily_cap': daily_cap}})
                except common.RpcError as e:
                    dbops.stop_on(e)
                    if e.code in dbops.TIMEOUT_CODES:
                        dbops.record_failure(rest, run.id, uid, image, e, 'promote')
                        counts['recorded_57014'] += 1
                        break
                    raise
                r = res.get('result')
                if r == 'halted' and res.get('why') == 'io_pressure' and attempt < 10:
                    sleep(60)                      # IO above 3: wait, retry; 10 minutes is a stop
                    continue
                if r == 'halted':
                    why = res.get('why')
                    if why == 'revert_watch':
                        raise common.StopLoop('halting_watch_row', '%s halting image(s)' % res.get('halting_images'))
                    if why == 'io_pressure':
                        raise common.StopLoop('io_pressure', 'promote_image halted for 10 minutes')
                    counts['halted_' + why] += 1
                    run.counts.update(dict(counts))
                    return counts
                counts[r] += 1
                if r == 'blocked':
                    blocked[res.get('why')] += 1
                if r == 'promoted':
                    counts['mode_' + str(res.get('mode'))] += 1
                break
        run.counts.update(dict(counts), blocked=dict(blocked))
    counts.update({'blocked_' + k: v for k, v in blocked.items()})
    return counts


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--user')
    ap.add_argument('--images', nargs='*')
    ap.add_argument('--images-file')
    ap.add_argument('--mode', choices=[common.FILE, common.DB], default=common.FILE)
    ap.add_argument('--parent', help='the loop run this promotion belongs to')
    ap.add_argument('--daily-cap', type=int, default=1000)
    a = ap.parse_args()
    images = plan_images(a)
    if a.mode == common.FILE:
        print('file mode: would call promote_image once per image for %d image(s); sweep window now: %s; daily cap %d. '
              'No call made.' % (len(images), common.in_sweep_window(), a.daily_cap))
        return 0
    rest, reader = common.Rest(), common.Reader()
    try:
        counts = promote(rest, reader, common.owner_id(a.user), images, a.daily_cap, a.parent)
    except common.StopLoop as e:
        common.eprint('STOP: %s' % e)
        return 3
    print(dict(counts))
    return 0


if __name__ == '__main__':
    sys.exit(main())
