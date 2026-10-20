"""Loader (PLAN pilot step 3): replay a payload directory through the writers, in load order.

file mode (default)  a dry run: builds every call exactly as db mode would (batches, gates, placeholder order)
                     and writes load-plan.json. No network; amounts are checked to resolve, never written.
db mode              evidence_open_run for each run in run.json, then each file's lines as PostgREST RPC with the
                     service-role key (refused unless EVIDENCE_DB_WRITES=1), then evidence_close_run. Writes
                     load-manifest.json (line key -> id) for the exit test and the review sheet.

Rules: at most 500 rows per call (account entities 200, support 50; one claim per call); one row per image (or per
source key) in a call, so each result maps back to its line; listing_class rows only once the dedupe lists the vehicle
(its done list), with is_duplicate re-checked per image id right before each call (a copy is dropped, never sent);
IO waiters <= 3 before a batch and no lock waiters after it (reads through q.sh). A writer's 42501, an insert or
append-only guard refusal, a pinned-source refusal or IO above 3 for 10 minutes stops the load and closes every
open run 'aborted' with the reason. After the capture-time claims, confirm_capture_times_by_rule is called with the
batch_offset_v1 claims of the closed gate run (the writer confirms only what the gate passes).

(v5-v9) Per-row results the writers return are counted, never retried: already_decided, already_rejected,
kept_stronger, unchanged, owner_answer_missing, entity_is_owners_call (the next run or the next sheet asks again), and
so are the refusals (image_not_eligible, vehicle_not_in_scope, source_not_users, vehicle_not_found). (v9) A photo's
'already_rejected' (a truck he said no to, or a place other than the subject he confirmed) writes nothing and leaves
the line off the sheet; skips a writer itemizes are counted once. A claim his decision or his who-paid statement
answers is never superseded: the line's support goes onto that claim (propose_claim_support) and is reported as
claim_carries_owner_decision; a claim no longer current is claim_not_current. No job decides (v8): the loader never
calls decide_evidence. Every id a writer returns goes to the manifest (common.Rest; manifest.py).

Usage: python3 scripts/evidence/loader.py --dir <payload dir> --case <case.json> [--mode file|db] [--user <uuid>]
"""
import argparse
import collections
import os
import re
import sys
import time

import common
import money
import payloads

IO_LIMIT = 3
IO_WAIT_S = 600


class Loader:
    def __init__(self, ctx, mode=common.FILE, rest=None, reader=None, sleep=time.sleep, clock=time.time):
        self.ctx = ctx
        self.mode = mode
        self.rest = rest
        self.reader = reader
        self.sleep, self.clock = sleep, clock
        self.sources = money.Sources(ctx)
        self.runs = collections.OrderedDict()           # run key -> id (db) or key (file)
        self.ids = {}                                   # line key -> id
        self.skipped = collections.OrderedDict()        # line key -> reason
        self.calls = []
        self.counts = collections.defaultdict(collections.Counter)
        self.outcomes = collections.Counter()           # reported per-row results, never retried
        self.open_runs = []

    # ------------------------------------------------------------------ placeholders
    def resolve(self, obj, amounts=True):
        if isinstance(obj, dict):
            return {k: self.resolve(v, amounts) for k, v in obj.items()}
        if isinstance(obj, list):
            return [self.resolve(v, amounts) for v in obj]
        if isinstance(obj, str) and obj.startswith('@'):
            if obj == '@config.user_id':
                return self.ctx.user_id
            if obj.startswith('@run:'):
                if obj[1:] not in self.runs:
                    raise KeyError(obj)
                return self.runs[obj[1:]]
            if obj.startswith('@key:'):
                if obj[5:] not in self.ids:
                    raise KeyError(obj)
                return self.ids[obj[5:]]
            if obj.startswith('@amount:'):
                if self.mode == common.DB and amounts:
                    return self.sources.cents(obj)
                if not self.sources.resolves(obj):
                    raise common.EvidenceError('amount placeholder does not resolve: ' + obj)
                return '<amount>'
        return obj

    # ------------------------------------------------------------------ db plumbing
    def call(self, writer, args, meta):
        rec = dict(meta, writer=writer)
        self.calls.append(rec)
        if self.mode == common.FILE:
            return None
        try:
            return self.rest.rpc(writer, payloads.rpc_args(writer, args))
        except common.RpcError as e:
            msg = (e.message or '').lower()
            if e.code == '42501' and ('append-only' in msg or 'written only by the evidence writers' in msg):
                raise common.StopLoop('guard_fired', '%s: %s' % (writer, e.message))
            if e.code == '42501':
                raise common.StopLoop('writer_refused_42501', '%s: %s' % (writer, e.message))
            raise

    def io_gate(self):
        if self.mode == common.FILE:
            return
        start = self.clock()
        while True:
            n = int(self.reader.read("select count(*) n from pg_stat_activity where wait_event_type = 'IO' "
                                     "and state = 'active'", tag='io_gate')[0]['n'])
            if n <= IO_LIMIT:
                return
            if self.clock() - start >= IO_WAIT_S:
                raise common.StopLoop('io_pressure', '%d IO waiters for 10 minutes' % n)
            self.sleep(60)

    def lock_check(self):
        if self.mode == common.FILE:
            return
        n = int(self.reader.read("select count(*) n from pg_stat_activity where wait_event_type = 'Lock'",
                                 tag='lock_check')[0]['n'])
        if n > 0:
            raise common.StopLoop('lock_waiters_after_batch', '%d sessions waiting on a lock' % n)

    # ------------------------------------------------------------------ runs
    def open_runs_from(self, run_json):
        for r in run_json['runs']:
            key = r['key']
            if self.mode == common.FILE:
                self.runs[key] = key
                self.calls.append({'writer': 'evidence_open_run', 'run': key})
                if r.get('close'):
                    self.calls.append({'writer': 'evidence_close_run', 'run': key, 'status': r['close']['status']})
                continue
            args = self.resolve(r['args'])
            rid = self.call('evidence_open_run', args, {'run': key})
            self.runs[key] = rid
            if r.get('close'):
                self.call('evidence_close_run', payloads.close_run(rid, r['close']['status'], r['close'].get('counts')),
                          {'run': key})
            else:
                self.open_runs.append(key)

    def close_runs(self, status='done', reason=None, keep_open=()):
        for key in reversed([k for k in self.open_runs if k not in keep_open]):
            counts = dict(self.counts.get(key, {}))
            if reason:
                counts['stop_reason'] = reason
            if self.mode == common.DB:
                try:
                    self.call('evidence_close_run', payloads.close_run(self.runs[key], status, counts), {'run': key})
                except common.EvidenceError as e:
                    common.eprint('close %s failed: %s' % (key, e))
        self.open_runs = [k for k in self.open_runs if k in keep_open]

    # ------------------------------------------------------------------ batching
    @staticmethod
    def batches(lines, limit, ident):
        """Chunks of <= limit lines with no identity twice in a chunk (results map back by image_id or ref)."""
        out, cur, seen = [], [], set()
        for ln in lines:
            k = ident(ln)
            if len(cur) >= limit or k in seen:
                out.append(cur)
                cur, seen = [], set()
            cur.append(ln)
            seen.add(k)
        if cur:
            out.append(cur)
        return out

    def dedupe_ok(self, vehicle_id):
        p = self.ctx.input_path('dedupe_done')
        return bool(p and p.exists() and vehicle_id in {x.strip() for x in p.read_text().splitlines()})

    def duplicates(self, image_ids):
        """Image ids that are is_duplicate or superseded now (db: q.sh read; file: the listing rows read)."""
        if self.mode == common.FILE:
            import inputs
            rows = {r['id']: r for r in inputs.listing_rows(self.ctx)}
            return {i for i in image_ids if rows.get(i, {}).get('dup') or rows.get(i, {}).get('sup')}
        out = set()
        ids = sorted(image_ids)
        for k in range(0, len(ids), 100):
            rows = self.reader.read('select id from vehicle_images where id = any(:ids) and (coalesce(is_duplicate, '
                                    'false) or coalesce(is_superseded, false))', {'ids': ids[k:k + 100]},
                                    tag='is_duplicate_recheck')
            out |= {r['id'] for r in rows}
        return out

    def load_rows(self, f, writer, lines):
        spec = payloads.C['writers'][writer]
        limit = spec.get('max_rows', 500)
        ident = {'propose_image_candidates': lambda ln: ln['row']['image_id'],
                 'propose_evidence_links': lambda ln: payloads.source_key(
                     ln['row'].get('source_table'), ln['row'].get('source_row_id'), ln['row'].get('external_ref'),
                     ln['row'].get('anchor')),
                 'propose_capture_time_claims': lambda ln: ln['row']['image_id']}.get(writer, lambda ln: ln['key'])
        by_run = collections.OrderedDict()
        for ln in lines:
            by_run.setdefault(ln['p_run_id'][1:], []).append(ln)
        for run_key, rl in by_run.items():
            if f == 'candidates.listing_class.jsonl':
                vehicles = {ln['row'].get('vehicle_id') for ln in rl}
                pending = [v for v in vehicles if not self.dedupe_ok(v)]
                if pending:
                    for ln in rl:
                        self.skipped[ln['key']] = 'dedupe_pending'
                    self.counts[run_key]['skipped_dedupe_pending'] += len(rl)
                    continue
            for batch in self.batches(rl, limit, ident):
                if f == 'candidates.listing_class.jsonl':
                    dup = self.duplicates({ln['row']['image_id'] for ln in batch})
                    for ln in batch:
                        if ln['row']['image_id'] in dup:
                            self.skipped[ln['key']] = 'is_duplicate_now'
                    batch = [ln for ln in batch if ln['row']['image_id'] not in dup]
                    self.counts[run_key]['dropped_is_duplicate'] += len(dup)
                    if not batch:
                        continue
                rows, sent = [], []
                for ln in batch:
                    try:
                        rows.append(self.resolve(ln['row']))
                        sent.append(ln)
                    except KeyError as e:
                        self.skipped[ln['key']] = 'dependency_not_loaded:%s' % e.args[0]
                if not rows:
                    continue
                self.io_gate()
                res = self.call(writer, {'p_run_id': self.runs[run_key], 'p_rows': rows},
                                {'run': run_key, 'file': f, 'rows': len(rows), 'first': sent[0]['key'],
                                 'last': sent[-1]['key']})
                self.lock_check()
                self.counts[run_key]['sent'] += len(rows)
                self.map_results(writer, run_key, sent, res)

    def map_results(self, writer, run_key, sent, res):
        if self.mode == common.FILE:
            for ln in sent:
                self.ids[ln['key']] = ln['key']
            return
        res = res or {}
        items = res.get('items') or []
        if writer == 'propose_image_candidates':
            by = {it['image_id']: it for it in items}
            if res.get('unchanged'):
                self.outcomes['unchanged'] += int(res['unchanged'])      # (v6) the same row again is not news
            missing = []
            for ln in sent:
                it = by.get(ln['row']['image_id'])
                if it is None:
                    missing.append(ln)                     # 'unchanged': the writer returns no item
                    continue
                self.counts[run_key][it.get('result', 'refused')] += 1
                if it.get('result') in payloads.C['reported_outcomes']:
                    self.outcomes[it['result']] += 1
                if it.get('candidate_id') and it.get('result') in ('proposed', 'already_decided'):
                    self.ids[ln['key']] = it['candidate_id']     # 'already_decided' names the decided row
                else:
                    # (v9) 'already_rejected': his word on this photo answers the row (a truck he said no to, or a
                    # place other than the subject he confirmed); nothing is written and the sheet does not ask it
                    self.skipped[ln['key']] = it.get('result', 'refused')
            if missing:
                self.read_back_candidates(run_key, missing)
        elif writer == 'propose_evidence_links':
            by = {it['ref']: it for it in items}
            for ln in sent:
                r = ln['row']
                it = by.get(payloads.source_key(r.get('source_table'), r.get('source_row_id'), r.get('external_ref'),
                                                r.get('anchor')))
                result = (it or {}).get('result', 'no_result')
                self.counts[run_key][result] += 1
                if result in payloads.C['reported_outcomes']:
                    self.outcomes[result] += 1
                if it and it.get('link_id'):
                    self.ids[ln['key']] = it['link_id']          # 'already_decided' names the decided row
                else:
                    self.skipped[ln['key']] = result
        else:
            # capture-time claims, day context and account entities return their ids in write order but not per
            # line (rows the writer skips are absent): read the ids back by run (current rows of this owner)
            itemized = {it.get('result', 'skipped') for it in res.get('skipped') or []}
            for k, v in res.items():
                if isinstance(v, int) and not isinstance(v, bool) and k not in itemized:
                    # (v9, M5) a writer that itemizes its skips may also count them: each is counted once, below
                    self.counts[run_key][k] += v
                    if k in payloads.C['reported_outcomes'] and v:
                        self.outcomes[k] += v
            for it in res.get('skipped') or []:
                self.counts[run_key][it.get('result', 'skipped')] += 1
                if it.get('result') in payloads.C['reported_outcomes']:
                    self.outcomes[it['result']] += 1
            self.read_back(writer, run_key, sent, res)

    def read_back_candidates(self, run_key, lines):
        """Rows the writer left unchanged return no item: read their ids back (current row, same pass)."""
        pass_name = lines[0]['p_run_id'][5:]
        if pass_name not in payloads.C['pass_names']:
            raise common.EvidenceError('unknown pass %s' % pass_name)
        rows = self.reader.read('select id, image_id, vehicle_id, subject_key from image_vehicle_candidates where '
                                "image_id = any(:ids) and user_id = :uid and superseded_by is null and pass = '%s'"
                                % pass_name, {'ids': sorted({ln['row']['image_id'] for ln in lines}),
                                              'uid': self.ctx.user_id}, tag='read_back')
        by = {(r['image_id'], r.get('vehicle_id') or r.get('subject_key')): r['id'] for r in rows}
        for ln in lines:
            cid = by.get((ln['row']['image_id'], ln['row'].get('vehicle_id') or ln['row'].get('subject_key')))
            if cid:
                self.ids[ln['key']] = cid
                self.counts[run_key]['unchanged'] += 1
            else:
                self.skipped[ln['key']] = 'no_result'

    def read_back(self, writer, run_key, sent, res=None):
        if writer == 'propose_capture_time_claims':
            rows = self.reader.read('select id, image_id from image_capture_time_claims where image_id = any(:ids) '
                                    'and user_id = :uid and superseded_by is null',
                                    {'ids': [ln['row']['image_id'] for ln in sent], 'uid': self.ctx.user_id},
                                    tag='read_back')
            by = {r['image_id']: r['id'] for r in rows}
            missing = set((res or {}).get('owner_answer_missing_ids') or [])      # (v9, M6) named by the writer
            for ln in sent:
                if ln['row']['image_id'] in missing and ln['row'].get('rule') == 'owner':
                    self.skipped[ln['key']] = 'owner_answer_missing'
                elif ln['row']['image_id'] in by:
                    self.ids[ln['key']] = by[ln['row']['image_id']]   # written now, or a decided / stronger claim kept
                else:
                    self.skipped[ln['key']] = 'not_written (compare-and-set, not eligible or already rejected)'
        elif writer == 'record_day_context':
            rows = self.reader.read('select id, day::text, place_cluster, vehicle_id from user_day_vehicle_context '
                                    'where run_id = :run and superseded_by is null', {'run': self.runs[run_key]},
                                    tag='read_back')
            by = {(r['day'], r['place_cluster'], r['vehicle_id']): r['id'] for r in rows}
            why = {(it.get('day'), it.get('vehicle_id')): it for it in (res or {}).get('skipped') or []}
            for ln in sent:
                r = ln['row']
                k = (r['day'], r['place_cluster'], r['vehicle_id'])
                sk = why.get((r['day'], r['vehicle_id'])) or {}
                if k in by:
                    self.ids[ln['key']] = by[k]
                elif sk.get('id'):
                    self.ids[ln['key']] = sk['id']             # already_decided: the decided row stands
                else:
                    self.skipped[ln['key']] = sk.get('result', 'not_written')
        else:
            rows = self.reader.read('select id, account_ref from evidence_account_entities where run_id = :run',
                                    {'run': self.runs[run_key]}, tag='read_back')
            by = {r['account_ref']: r['id'] for r in rows}
            # (v9, M5) the writer itemizes what it kept: his decided row stands (left off the sheet: he answered it)
            kept = {it.get('account_ref'): it for it in (res or {}).get('skipped') or []}
            for ln in sent:
                if ln['row']['account_ref'] in by:
                    self.ids[ln['key']] = by[ln['row']['account_ref']]
                else:
                    self.skipped[ln['key']] = (kept.get(ln['row']['account_ref']) or {}).get('result', 'already_decided')

    def load_claims(self, lines):
        for ln in lines:
            run_key = ln['p_run_id'][1:]
            try:
                claim = self.resolve(ln['p_claim'])
                sup = self.resolve(ln['p_support'] or [])
                old = self.resolve(ln.get('p_supersedes'))
            except KeyError as e:
                self.skipped[ln['key']] = 'dependency_not_loaded:%s' % e.args[0]
                continue
            self.io_gate()
            try:
                res = self.call('propose_change_claim', {'p_run_id': self.runs[run_key], 'p_claim': claim,
                                                         'p_support': sup, 'p_supersedes': old},
                                {'run': run_key, 'file': 'change_claims.jsonl', 'rows': 1, 'first': ln['key'],
                                 'support_rows': len(sup)})
            except common.RpcError as e:
                if not old or not self.supersede_refused(ln, run_key, old, sup, e):
                    raise
                continue
            self.lock_check()
            if self.mode == common.DB and res is None:
                # (v5) custody_bounds writes nothing where a sourced acquisition exists on the identity
                self.skipped[ln['key']] = 'sourced_acquisition_exists'
                self.counts[run_key]['not_written'] += 1
                continue
            self.ids[ln['key']] = res if self.mode == common.DB else ln['key']
            self.counts[run_key]['claims'] += 1

    def supersede_refused(self, ln, run_key, old, sup, e):
        """(v9, W4/M7) A pass never re-writes a claim his decision or his who-paid statement answers: its support goes
        onto that claim instead (propose_claim_support), and the line names his claim. A claim that is no longer
        current is nothing to supersede: the line is skipped. Both are reported, never retried. -> handled?"""
        if re.match(r'^claim \S+ carries an owner decision', e.message or ''):
            for k in range(0, len(sup), payloads.C['writers']['propose_claim_support']['max_rows']):
                self.call('propose_claim_support', {'p_run_id': self.runs[run_key], 'p_claim_id': old,
                                                    'p_support': sup[k:k + 50]},
                          {'run': run_key, 'file': 'change_claims.jsonl', 'rows': len(sup[k:k + 50]),
                           'first': ln['key']})
            self.ids[ln['key']] = old
            self.counts[run_key]['support_rows'] += len(sup)
            outcome = 'claim_carries_owner_decision'
        elif e.code == '22023' and 'is not a current claim' in (e.message or ''):
            self.skipped[ln['key']] = outcome = 'claim_not_current'
        else:
            return False
        self.counts[run_key][outcome] += 1
        self.outcomes[outcome] += 1
        return True

    def load_support(self, lines):
        for ln in lines:
            run_key = ln['p_run_id'][1:]
            try:
                cid = self.resolve(ln['p_claim_id'])
                sup = self.resolve(ln['p_support'])
            except KeyError as e:
                self.skipped[ln['key']] = 'dependency_not_loaded:%s' % e.args[0]
                continue
            for k in range(0, len(sup), payloads.C['writers']['propose_claim_support']['max_rows']):
                self.call('propose_claim_support', {'p_run_id': self.runs[run_key], 'p_claim_id': cid,
                                                    'p_support': sup[k:k + 50]},
                          {'run': run_key, 'file': 'claim_support.jsonl', 'rows': len(sup[k:k + 50]),
                           'first': ln['key']})
            self.ids[ln['key']] = ln['key']
            self.counts[run_key]['support_rows'] += len(sup)

    def confirm_by_rule(self, lines):
        """confirm_capture_times_by_rule(gate run, batch claim ids), <= 1000 ids a call, once the claims are in."""
        if 'run:time_rule_gate' not in self.runs:
            return
        keys = [ln['key'] for ln in lines if ln['row'].get('rule') == 'batch_offset_v1' and ln['key'] in self.ids]
        limit = payloads.C['writers']['confirm_capture_times_by_rule']['max_rows']
        for k in range(0, len(keys), limit):
            chunk = keys[k:k + limit]
            self.io_gate()
            res = self.call('confirm_capture_times_by_rule', {'p_gate_run_id': self.runs['run:time_rule_gate'],
                                                              'p_claim_ids': [self.ids[x] for x in chunk]},
                            {'run': 'run:time_rule_gate', 'file': 'time_claims.jsonl', 'rows': len(chunk),
                             'first': chunk[0], 'last': chunk[-1]})
            self.lock_check()
            self.counts['run:time_rule_gate']['confirmed'] += int((res or {}).get('confirmed') or 0)

    # ------------------------------------------------------------------ main
    def load_dir(self, d, only=None, keep_open=()):
        run_json = common.load_json(os.path.join(d, 'run.json'))
        if self.mode == common.DB:
            uid = run_json['config'].get('user_id')
            if uid and uid != self.ctx.user_id:
                raise common.EvidenceError('run.json was built for another owner id')
        self.open_runs_from(run_json)
        try:
            for f, writer in payloads.C['files']:
                p = os.path.join(d, f)
                if not os.path.exists(p) or (only and f not in only):
                    continue
                lines = common.read_jsonl(p)
                if writer == 'propose_change_claim':
                    self.load_claims(lines)
                elif writer == 'propose_claim_support':
                    self.load_support(lines)
                else:
                    self.load_rows(f, writer, lines)
                if writer == 'propose_capture_time_claims':
                    self.confirm_by_rule(lines)
        except common.StopLoop as e:
            self.close_runs('aborted', e.reason)
            raise
        except Exception as e:
            # a writer raised (a CHECK the local checks missed, a timeout): the call rolled back; close every open
            # run 'failed' so none is left running, and surface the error
            self.close_runs('failed', '%s: %s' % (type(e).__name__, str(e)[:200]))
            raise
        self.close_runs('done', keep_open=keep_open)

    def manifest(self):
        return {'mode': self.mode, 'at': common.iso_utc(common.utc_now()), 'runs': dict(self.runs),
                'ids': self.ids, 'skipped': self.skipped, 'skipped_by_reason': dict(collections.Counter(
                    r.split(':')[0] for r in self.skipped.values())),
                'calls': len(self.calls), 'calls_by_writer': dict(collections.Counter(c['writer'] for c in self.calls)),
                'max_rows_in_a_call': max([c.get('rows', 0) for c in self.calls] or [0]),
                'outcomes_reported_not_retried': dict(self.outcomes),
                'counts': {k: dict(v) for k, v in self.counts.items()}}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dir', required=True)
    ap.add_argument('--case', required=True)
    ap.add_argument('--mode', choices=[common.FILE, common.DB], default=common.FILE)
    ap.add_argument('--user')
    ap.add_argument('--only', nargs='*', help='file names to load (default: all, in load order)')
    a = ap.parse_args()
    ctx = common.Context(a.case, a.dir, mode=a.mode, user_id=common.owner_id(a.user))
    payloads.use_contract(ctx.contract)
    rest = reader = None
    if a.mode == common.DB:
        rest = common.Rest()
        reader = common.Reader(log=common.log_to(os.path.join(a.dir, 'runner.log')))
    ld = Loader(ctx, a.mode, rest, reader)
    code = 0
    try:
        ld.load_dir(a.dir, a.only)
    except common.StopLoop as e:
        common.eprint('STOP: %s' % e)
        code = 3
    man = ld.manifest()
    out = os.path.join(a.dir, 'load-manifest.json' if a.mode == common.DB else 'load-plan.json')
    if a.mode == common.FILE:
        man['plan'] = ld.calls
    common.dump_json(out, man)
    print('calls %d (%s), max rows in a call %d, ids %d, skipped %s -> %s' % (
        man['calls'], man['calls_by_writer'], man['max_rows_in_a_call'], len(man['ids']), man['skipped_by_reason'], out))
    return code


if __name__ == '__main__':
    sys.exit(main())
