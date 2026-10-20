"""The daily evidence loop (PLAN section 5; launchd ag.nuke.evidence-loop at 04:00 PT).

file mode (default)  build every pass from the case's inputs, validate the payloads (checks.py), plan the load
                     (loader.py dry run), read the exit fixture against the file-mode reader (exit_test.py), write the
                     review sheet, and report. Nothing leaves the machine. Exit 1 on a payload violation or a failed
                     structural exit assertion.
db mode              (refused unless EVIDENCE_DB_WRITES=1) the same build and checks, then: load through the writers
                     (the loop run stays open), the scoreboard, the review sheet when it is due, repin, promote per
                     decided image, publish, pick the gap, close the loop run with the scoreboard and the gap.

Stop conditions (the run closes 'aborted' with the reason): a halting row in evidence_revert_watch; a writer's
42501; the insert or append-only guard firing; IO waiters above 3 for 10 minutes; a STOP file (dedupe or another
lane) naming a vehicle in scope; the pinned-source check refusing a path; the Jev cap (Jev is not wired: no call
is made until OWNER-DECISIONS 1 says yes).

Usage: python3 scripts/evidence/loop.py --case <case.json> --out <dir> [--mode file|db] [--user <uuid>]
       [--fixture <exit-expected.json>] [--date YYYY-MM-DD] [--skip-scoreboard]
"""
import argparse
import datetime as dt
import os
import sys

import checks
import common
import exit_test
import loader
import money
import passlib
import payloads
import readers
import review_sheet


def stop_files(ctx, now=None):
    """Stop when a STOP file (empty = everything, else vehicle ids one per line) or the dedupe's recent work names a
    vehicle in scope. case.stop_checks: {"files": [...], "dedupe_log": path, "dedupe_recent_minutes": 15}."""
    sc = ctx.case.get('stop_checks') or {}
    scope = {ctx.vid(v) for v in (ctx.case.get('scope_vehicles') or []) + [ctx.case.get('vehicle')] if v}
    for f in sc.get('files') or []:
        p = ctx.path(f)
        if p and p.exists():
            named = {x.strip() for x in p.read_text().splitlines() if x.strip()}
            if not named or named & scope:
                raise common.StopLoop('stop_file', '%s names %s' % (p, sorted(named & scope) or 'everything'))
    log = ctx.path(sc['dedupe_log']) if sc.get('dedupe_log') else None
    if log and log.exists():
        tail = log.read_text(errors='replace').splitlines()[-1:] or ['']
        parts = tail[0].split()
        if len(parts) >= 3 and parts[1] == 'vehicle' and parts[2] in scope:
            try:
                age = (now or common.utc_now()) - common.parse_ts(parts[0])
                if age <= dt.timedelta(minutes=sc.get('dedupe_recent_minutes', 15)):
                    raise common.StopLoop('stop_file', 'the dedupe is working on %s' % parts[2])
            except ValueError:
                pass


def build_and_check(ctx, a, report):
    built = passlib.build_all(ctx)
    counts = passlib.write_built(ctx, built, ctx.user_id)
    report['files'] = dict(counts)
    report['pass_counts'] = {p: i.get('counts') for p, i in built.infos.items()}
    report['notes'] = list(ctx.notes)
    rep = checks.validate_dir(str(ctx.out), ctx, money.Sources(ctx))
    common.dump_json(ctx.out / 'checks.json', rep.as_dict())
    report['violations'] = rep.total
    report['writer_would_confirm_times'] = getattr(rep, 'would_confirm', None)
    if rep.total:
        rep.print(5)
    return rep.total == 0


def file_steps(ctx, a, report):
    ld = loader.Loader(ctx, common.FILE)
    ld.load_dir(str(ctx.out))
    plan = ld.manifest()
    plan['plan'] = ld.calls
    common.dump_json(ctx.out / 'load-plan.json', plan)
    report['load_plan'] = {'calls': plan['calls'], 'calls_by_writer': plan['calls_by_writer'],
                           'max_rows_in_a_call': plan['max_rows_in_a_call'], 'skipped': plan['skipped_by_reason']}
    files = readers.load_files(str(ctx.out))
    fx = a.fixture or ((ctx.case.get('exit_fixture') and str(ctx.path(ctx.case['exit_fixture']))) or None)
    ok = True
    if fx:
        fixture = common.load_json(fx)
        vehicle = fixture.get('vehicle_id') or ctx.vid(ctx.case['vehicle'])
        results, summary = exit_test.run(fixture, files, lambda dec: readers.accounting(files, vehicle, dec))
        common.dump_json(ctx.out / ('exit-test-%s.json' % a.date), {'mode': 'file', 'vehicle_id': vehicle,
                                                                     'summary': summary, 'results': results})
        report['exit_test'] = summary
        ok = summary['structural_pass']
    read = readers.accounting(files, ctx.vid(ctx.case['vehicle']))
    rows = review_sheet.build_rows(ctx, files, read)
    md = review_sheet.render(ctx, rows, a.date)
    (ctx.out / ('review-%s.md' % a.date)).write_text(md, encoding='utf-8')
    side = {'sheet': str(ctx.out / ('review-%s.md' % a.date)), 'sheet_sha256': common.sha256_bytes(md.encode('utf-8')),
            'items': len(rows), 'date': a.date, 'sheet_run': None, 'rows': rows}
    common.dump_json(ctx.out / ('review-%s.json' % a.date), side)
    report['review_sheet'] = {'rows': len(rows), 'sha256': side['sheet_sha256']}
    return ok


def db_steps(ctx, a, report, rest, reader):
    """PLAN section 5 steps 7-8 after the build. Raises StopLoop; the caller closes the loop run 'aborted'."""
    import dbops
    import promote
    import publish
    import repin
    import scoreboard
    ld = loader.Loader(ctx, common.DB, rest, reader)
    try:
        ld.load_dir(str(ctx.out), keep_open={'run:loop'})
    finally:
        common.dump_json(ctx.out / 'load-manifest.json', ld.manifest())
    loop_run = ld.runs['run:loop']
    report['loop_run'] = loop_run
    try:
        sb = {} if a.skip_scoreboard else scoreboard.run(reader, ctx.user_id, ctx.vid(ctx.case['vehicle']))
        report['scoreboard'] = {k: scoreboard.scalar(v) for k, v in sb.items()}
        halting = [w for w in dbops.watch(reader, ctx.user_id) if w.get('halting')]
        if halting:
            raise common.StopLoop('halting_watch_row', '%d image(s)' % len(halting))
        files = readers.load_files(str(ctx.out))
        rows = review_sheet.build_rows(ctx, files, readers.accounting(files, ctx.vid(ctx.case['vehicle'])))
        weekday = (ctx.case.get('review') or {}).get('weekday', 6)          # Sunday; or when the queue passes 50
        if rows and (dt.date.fromisoformat(a.date).weekday() == weekday or len(rows) > 50):
            md = review_sheet.render(ctx, rows, a.date)
            (ctx.out / ('review-%s.md' % a.date)).write_text(md, encoding='utf-8')
            sha = common.sha256_bytes(md.encode('utf-8'))
            sheet_run = rest.rpc('evidence_open_run', payloads.open_run(
                ctx.user_id, 'review', 'review_sheet', common.producer('loop.py#review_sheet'), common.code_version(),
                {'sheet_sha256': sha, 'items': str(len(rows))}))
            rest.rpc('evidence_close_run', payloads.close_run(sheet_run, 'done', {'items': len(rows)}))
            common.dump_json(ctx.out / ('review-%s.json' % a.date), {
                'sheet': str(ctx.out / ('review-%s.md' % a.date)), 'sheet_sha256': sha, 'items': len(rows),
                'date': a.date, 'sheet_run': sheet_run, 'rows': rows})
            report['review_sheet'] = {'rows': len(rows), 'sheet_run': sheet_run}
        report['repin'] = repin.repin(rest, reader, ctx.user_id, parent=loop_run)
        decided = reader.read("select distinct c.image_id from image_vehicle_candidates c join v_evidence_status s on "
                              "s.target_kind = 'image_candidate' and s.target_id = c.id where c.user_id = :uid and "
                              "c.superseded_by is null and s.status in ('confirmed', 'rejected') and "
                              "s.channel in ('human', 'agent')", {'uid': ctx.user_id}, tag='decided_images')
        imgs = [r['image_id'] for r in decided]
        report['promote'] = dict(promote.promote(rest, reader, ctx.user_id, imgs, parent=loop_run)) if imgs else {}
        report['publish'] = dict(publish.publish(rest, reader, ctx.user_id, publish.watch_images(reader, ctx.user_id),
                                                 parent=loop_run))
        gap = pick_gap(report.get('scoreboard') or {})
        rest.rpc('evidence_close_run', payloads.close_run(loop_run, 'done', {'files': report.get('files')},
                                                          scoreboard=sb or None, gap_picked=gap))
        report['gap_picked'] = gap
    except common.StopLoop as e:
        rest.rpc('evidence_close_run', payloads.close_run(loop_run, 'aborted', {'stop_reason': e.reason,
                                                                               'detail': str(e)[:300]}))
        raise


def pick_gap(scalars):
    """The largest open count among the backlog measures (M1 unfiled, M7 untimed, M12 merged-row images)."""
    open_counts = {k: v for k, v in scalars.items() if k in ('M1', 'M7', 'M12') and isinstance(v, int) and v > 0}
    return max(open_counts, key=open_counts.get) if open_counts else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--case', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--mode', choices=[common.FILE, common.DB], default=common.FILE)
    ap.add_argument('--user')
    ap.add_argument('--fixture')
    ap.add_argument('--date')
    ap.add_argument('--skip-scoreboard', action='store_true')
    a = ap.parse_args()
    a.date = a.date or common.today()
    if a.mode == common.DB:
        common.require_db_writes()
    report = {'mode': a.mode, 'date': a.date, 'started': common.iso_utc(common.utc_now())}
    code = 0
    try:
        ctx = common.Context(a.case, a.out, mode=a.mode, user_id=common.owner_id(a.user))
        payloads.use_contract(ctx.contract)
        report['case'] = ctx.case.get('case')
        stop_files(ctx)
        if not build_and_check(ctx, a, report):
            raise common.StopLoop('payload_invalid', '%d violation(s); see checks.json' % report['violations'])
        if a.mode == common.FILE:
            code = 0 if file_steps(ctx, a, report) else 1
        else:
            db_steps(ctx, a, report, common.Rest(), common.Reader(log=common.log_to(ctx.out / 'runner.log')))
    except common.StopLoop as e:
        report['stopped'] = {'reason': e.reason, 'detail': str(e)}
        code = 1 if e.reason == 'payload_invalid' else 3
    report['finished'] = common.iso_utc(common.utc_now())
    out = os.path.join(a.out, 'loop-report-%s.json' % a.date)
    common.dump_json(out, report)
    for f, n in (report.get('files') or {}).items():
        print('%-34s %6d' % (f, n))
    for k in ('violations', 'writer_would_confirm_times', 'load_plan', 'exit_test', 'review_sheet', 'stopped'):
        if k in report:
            print('%s: %s' % (k, report[k]))
    for n in report.get('notes') or []:
        print('note: ' + n)
    print('report -> %s' % out)
    return code


if __name__ == '__main__':
    sys.exit(main())
