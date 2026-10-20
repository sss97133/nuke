"""The daily evidence loop (PLAN section 5; launchd ag.nuke.evidence-loop at 04:00 PT).

file mode (default)  build every pass from the case's inputs, validate the payloads (checks.py), plan the load
                     (loader.py dry run), read the exit fixture against the file-mode reader (exit_test.py), write the
                     review sheet, and report. Nothing leaves the machine. Exit 1 on a payload violation or a failed
                     structural exit assertion.
db mode              (refused unless EVIDENCE_DB_WRITES=1) the same build and checks, then: load through the writers
                     (the loop run stays open), the scoreboard, the review sheet when it is due (its review run
                     stores each row's targets; it stays open until the sheet is sent), repin, promote per image he
                     decided, publish, pick the gap, close the loop run with the scoreboard and the gap. Every writer
                     call appends its returned ids to the manifest (loop/manifests/<UTC date>.jsonl); M10b reconciles
                     them, and any unmanifested row holds promotion and publication for the run. (v8) The loop never
                     decides: every decision is his, from his own step-up session in the app.

Stop conditions (the run closes 'aborted' with the reason): a halting row in evidence_revert_watch; a writer's
42501; the insert or append-only guard firing; the integrity check failing (fewer guard triggers firing ALWAYS than
deployed, or a guard or writer body that differs from the deployed md5); IO waiters above 3 for 10 minutes; a STOP
file (dedupe or another lane) naming a vehicle in scope; the pinned-source check refusing a path; a manifest line
that cannot be written; the Jev cap (Jev is not wired: no call is made until OWNER-DECISIONS 1 says yes).

Usage: python3 scripts/evidence/loop.py --case <case.json> --out <dir> [--mode file|db] [--user <uuid>]
       [--fixture <exit-expected.json>] [--date YYYY-MM-DD] [--skip-scoreboard]
"""
import argparse
import datetime as dt
import os
import re
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
        sessions = readers.sessions_of(ctx)
        results, summary = exit_test.run(fixture, files, lambda dec: readers.accounting(files, vehicle, dec,
                                                                                         sessions=sessions))
        common.dump_json(ctx.out / ('exit-test-%s.json' % a.date), {'mode': 'file', 'vehicle_id': vehicle,
                                                                     'summary': summary, 'results': results})
        report['exit_test'] = summary
        ok = summary['structural_pass']
    read = readers.accounting(files, ctx.vid(ctx.case['vehicle']), sessions=readers.sessions_of(ctx))
    rows, decisions = review_sheet.build_rows(ctx, files, read)
    side = review_sheet.issue(ctx, rows, decisions, a.date, ctx.out)
    report['review_sheet'] = {'rows': side['items'], 'decisions': len(decisions), 'sha256': side['sheet_sha256']}
    return ok


# the promotion path (M1p) ships after the store (M1a/M1w): until then its reader does not exist
PROMOTION_MISSING = re.compile(r'42883|evidence_revert_watch\S* does not exist')


def db_steps(ctx, a, report, rest, reader):
    """PLAN section 5 steps 7-8 after the build. The loop run closes 'aborted' on a stop condition and 'failed' on
    any other error, then the error is raised. Before the promotion path (M1p) is deployed, repin, promote and
    publish are skipped and the report says so."""
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
    report['outcomes_reported_not_retried'] = dict(ld.outcomes)
    try:
        md5_file = common.LOOP_DIR / 'deployed_md5s.json'
        sb = {} if a.skip_scoreboard else scoreboard.run(
            reader, ctx.user_id, ctx.vid(ctx.case['vehicle']),
            deployed_md5s=common.load_json(md5_file) if md5_file.exists() else None)
        report['scoreboard'] = {k: scoreboard.scalar(v) for k, v in sb.items()}
        report['answers_runs_disputed_by_transcript'] = scoreboard.dispute_failed_answers(sb)
        bad = scoreboard.integrity_failed(sb.get('M10_integrity'))
        if bad:
            raise common.StopLoop('integrity_check_failed', bad)
        unmanifested = (sb.get('M10b') or {}).get('unmanifested') or 0
        try:
            watch, promotion_live = dbops.watch(reader, ctx.user_id), True
        except common.ReadError as e:
            if not PROMOTION_MISSING.search(str(e)):
                raise
            watch, promotion_live = [], False
            report['promotion_path'] = 'not deployed (M1p): repin, promote and publish skipped'
        halting = [w for w in watch if w.get('halting')]
        if halting:
            raise common.StopLoop('halting_watch_row', '%d image(s)' % len(halting))
        files = readers.load_files(str(ctx.out))
        rows, decisions = review_sheet.build_rows(ctx, files, readers.accounting(
            files, ctx.vid(ctx.case['vehicle']), sessions=readers.sessions_of(ctx)))
        weekday = (ctx.case.get('review') or {}).get('weekday', 6)          # Sunday; or when the queue passes 50
        if rows and (dt.date.fromisoformat(a.date).weekday() == weekday or len(rows) > 50):
            side = review_sheet.issue(ctx, rows, decisions, a.date, ctx.out, common.DB, rest, ctx.user_id, ld.ids)
            report['review_sheet'] = {'rows': side['items'], 'sheet_run': side['sheet_run'],
                                      'left_off_not_loaded': len(side['left_off_not_loaded'])}
        if promotion_live:
            report['repin'] = repin.repin(rest, reader, ctx.user_id, parent=loop_run)
        # (v8) only his own decisions exist; (v7) the status view holds one row per user: his
        decided = [] if not promotion_live else reader.read(
            "select distinct c.image_id from image_vehicle_candidates c join v_evidence_status s on "
            "s.target_kind = 'image_candidate' and s.target_id = c.id and s.user_id = :uid "
            "where c.user_id = :uid and c.superseded_by is null and s.status in ('confirmed', 'rejected') and "
            "s.channel = 'human'", {'uid': ctx.user_id}, tag='decided_images')
        imgs = [r['image_id'] for r in decided]
        if promotion_live and unmanifested:
            # (v5, M10b) a row no writer call returned: promotion and publication wait; the lead reads the rows
            report['promotion_held'] = {'reason': 'unmanifested_rows', 'rows': unmanifested,
                                        'by_table': (sb.get('M10b') or {}).get('by_table')}
        elif promotion_live:
            report['promote'] = dict(promote.promote(rest, reader, ctx.user_id, imgs, parent=loop_run)) if imgs else {}
            report['publish'] = dict(publish.publish(rest, reader, ctx.user_id,
                                                     publish.watch_images(reader, ctx.user_id), parent=loop_run))
        gap = pick_gap(report.get('scoreboard') or {})
        rest.rpc('evidence_close_run', payloads.close_run(loop_run, 'done', {'files': report.get('files')},
                                                          scoreboard=sb or None, gap_picked=gap))
        report['gap_picked'] = gap
    except common.StopLoop as e:
        rest.rpc('evidence_close_run', payloads.close_run(loop_run, 'aborted', {'stop_reason': e.reason,
                                                                               'detail': str(e)[:300]}))
        raise
    except Exception as e:
        rest.rpc('evidence_close_run', payloads.close_run(loop_run, 'failed', {
            'error': '%s: %s' % (type(e).__name__, str(e)[:200])}))
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
