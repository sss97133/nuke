"""Publication (PLAN K30-4 g, section 5 step 7): publish_image once per image.

A confirmed publication releases the image's evidence-privacy hold, but only when the gate before filing was
'approved' (the phone's VisionEngine verdict) or the owner decided the publication per image in the app or on the
owner page; a chat answer on an untriaged photo returns needs_app_review. A public image whose privacy state is held
or unheld with no confirmed publication is held again (privacy_reheld). A 57014 is recorded with
record_promotion_failure (step publish); a 42501 stops the run.

Images: --images, or with --from-watch the revert watch's published_without_decision rows plus the images with a
confirmed publication decision (read through q.sh).

Usage: python3 scripts/evidence/publish.py --user <owner> (--images <id> ... | --from-watch) [--mode file|db]
"""
import argparse
import collections
import sys

import common
import dbops


def watch_images(reader, uid):
    rows = reader.read("select image_id from public.evidence_revert_watch(:uid) where kind = "
                       "'published_without_decision' union select d.target_id from evidence_decisions d where "
                       "d.user_id = :uid and d.target_kind = 'image_publication' and d.decision = 'confirmed' "
                       "and d.detail->>'writer' = 'decide_evidence'", {'uid': uid}, tag='publish_images')
    return sorted({r.get('image_id') or r.get('target_id') for r in rows})


def publish(rest, reader, uid, images, parent=None):
    counts = collections.Counter()
    with dbops.JobRun(rest, uid, 'promote', 'publication', 'publish.py', {'images': len(images)}, parent) as run:
        for image in images:
            try:
                res = rest.rpc('publish_image', {'p_run_id': run.id, 'p_actor_user_id': uid, 'p_image_id': image})
            except common.RpcError as e:
                dbops.stop_on(e)
                if e.code in dbops.TIMEOUT_CODES:
                    dbops.record_failure(rest, run.id, uid, image, e, 'publish')
                    counts['recorded_57014'] += 1
                    continue
                raise
            counts[res.get('result')] += 1
        run.counts.update(dict(counts))
    return counts


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--user')
    ap.add_argument('--images', nargs='*')
    ap.add_argument('--from-watch', action='store_true')
    ap.add_argument('--mode', choices=[common.FILE, common.DB], default=common.FILE)
    ap.add_argument('--parent')
    a = ap.parse_args()
    if a.mode == common.FILE:
        print('file mode: would call publish_image once per image (%s). No call made.'
              % ('from the revert watch' if a.from_watch else '%d image(s)' % len(a.images or [])))
        return 0
    rest, reader = common.Rest(), common.Reader()
    uid = common.owner_id(a.user)
    images = list(a.images or []) + (watch_images(reader, uid) if a.from_watch else [])
    try:
        print(dict(publish(rest, reader, uid, images, a.parent)))
    except common.StopLoop as e:
        common.eprint('STOP: %s' % e)
        return 3
    return 0


if __name__ == '__main__':
    sys.exit(main())
