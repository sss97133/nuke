"""Manifest of the ids every writer call returned (PLAN section 0 and M10b; DESIGN-v5, guard-mechanism v4 #1).

Every writer call the runner makes through common.Rest appends one JSON line to
<EVIDENCE_MANIFEST_DIR, default loop/manifests>/<UTC date>.jsonl: the writer, the run, the ids the call created
(`ids`; the decision ids also apart as `decision_ids`, `implied_decision_ids`, `reassign_decision_ids`), the support
rows it wrote per claim, the rows it returned without creating them (`existing`) and the per-row results. The runner
only appends. The scoreboard's M10b matches every evidence row created in a window against these lines: a row that
is in neither the manifest nor (an owner decision) the API request log is unmanifested and halts promotion.

A call whose outcome is unknown (a client timeout or a dropped connection) is recorded with outcome 'unknown' and no
ids: if it committed, M10b shows its rows as unmanifested and the lead reads them.
"""
import collections
import datetime as dt
import json
import os
from pathlib import Path

import common

ID_KEYS = ('ids', 'decision_ids', 'implied_decision_ids', 'reassign_decision_ids', 'existing')


def _uuid(x):
    return x if common.is_uuid(x or '') else None


def _items(result):
    return (result or {}).get('items') or [] if isinstance(result, dict) else []


def _decide_items(items, out):
    for it in items:
        out['results'][it.get('result') or 'none'] += 1
        if _uuid(it.get('decision_id')):
            out['decision_ids'].append(it['decision_id'])
        out['implied_decision_ids'] += [x for x in it.get('implied_decision_ids') or [] if _uuid(x)]
        if _uuid(it.get('reassign_decision_id')):
            out['reassign_decision_ids'].append(it['reassign_decision_id'])
        if _uuid(it.get('reassigned_to')):
            out['ids'].append(it['reassigned_to'])      # an owner_review row decide_evidence wrote, or the existing one
        sub = it.get('reassign_result')
        if isinstance(sub, dict):
            _decide_items(sub.get('items') or [], out)


def returned(writer, args, result):
    """The ids one writer call returned, by kind (draft.sql v5 return shapes)."""
    out = {'ids': [], 'decision_ids': [], 'implied_decision_ids': [], 'reassign_decision_ids': [], 'existing': [],
           'support': [], 'results': collections.Counter(), 'image_id': None}
    args = args or {}
    if writer in ('evidence_open_run', 'evidence_record_answers'):
        if _uuid(result):
            out['ids'].append(result)
    elif writer == 'record_promotion_failure':
        if _uuid(result):
            out['decision_ids'].append(result)
        out['image_id'] = args.get('p_image_id')
    elif writer == 'propose_change_claim':
        if _uuid(result):
            out['ids'].append(result)
            n = len(args.get('p_support') or [])
            if n:
                out['support'].append({'claim_id': result, 'count': n})
        else:
            out['results']['not_written'] += 1          # custody_bounds stays out where a sourced acquisition exists
    elif writer == 'propose_claim_support':
        if isinstance(result, int) and not isinstance(result, bool) and result:
            out['support'].append({'claim_id': args.get('p_claim_id'), 'count': result})
    elif writer == 'propose_image_candidates':
        for it in _items(result):
            out['results'][it.get('result') or 'none'] += 1
            if _uuid(it.get('candidate_id')):
                (out['ids'] if it.get('result') == 'proposed' else out['existing']).append(it['candidate_id'])
        if isinstance(result, dict) and result.get('unchanged'):
            out['results']['unchanged'] += int(result['unchanged'])
    elif writer == 'propose_evidence_links':
        for it in _items(result):
            out['results'][it.get('result') or 'none'] += 1
            if _uuid(it.get('link_id')):
                (out['ids'] if it.get('result') in ('proposed', 'superseded') else out['existing']).append(it['link_id'])
    elif writer in ('propose_capture_time_claims', 'propose_account_entities', 'record_day_context',
                    'confirm_capture_times_by_rule'):
        r = result if isinstance(result, dict) else {}
        out['ids'] += [x for x in r.get('ids') or [] if _uuid(x)]
        out['decision_ids'] += [x for x in r.get('decision_ids') or [] if _uuid(x)]
        for k in ('proposed', 'machine_confirmed', 'kept_stronger', 'recorded', 'confirmed'):
            if isinstance(r.get(k), int) and r[k]:
                out['results'][k] += r[k]
        for it in r.get('skipped') or []:
            out['results'][it.get('result') or 'skipped'] += 1
            if _uuid(it.get('id')):
                out['existing'].append(it['id'])
        if r.get('out_of_scope'):
            out['results']['out_of_scope_context'] += len(r['out_of_scope'])
    elif writer == 'decide_evidence':
        _decide_items(_items(result), out)
    elif writer == 'evidence_probe_write':
        r = result if isinstance(result, dict) else {}
        if _uuid(r.get('probe_run')):
            out['ids'].append(r['probe_run'])
        out['results'][r.get('result') or 'none'] += 1
    elif writer in ('promote_image', 'publish_image'):
        r = result if isinstance(result, dict) else {}
        out['image_id'] = args.get('p_image_id')
        out['results'][r.get('result') or 'none'] += 1
        if _uuid(r.get('promotion_id')):
            out['existing'].append(r['promotion_id'])
    elif writer == 'evidence_repin_after_merge':
        r = result if isinstance(result, dict) else {}
        for k in ('repinned', 'blocked'):
            if r.get(k):
                out['results'][k] += int(r[k])
    elif writer == 'evidence_record_reverts':
        if isinstance(result, int) and not isinstance(result, bool) and result:
            out['results']['recorded'] += result
    # every id the call created, decisions included, in one list (M10b matches against it)
    seen = set()
    out['ids'] = [x for x in out['ids'] + out['decision_ids'] + out['implied_decision_ids'] +
                  out['reassign_decision_ids'] if not (x in seen or seen.add(x))]
    return out


def run_of(writer, args, result):
    if writer == 'evidence_open_run':
        return _uuid(result)
    a = args or {}
    for k in ('p_run_id', 'p_gate_run_id', 'p_parent_run_id', 'p_sheet_run'):
        if _uuid(a.get(k)):
            return a[k]
    return None


class Manifest:
    """Append-only JSONL, one line per writer call."""

    def __init__(self, directory=None, clock=None):
        self.dir = Path(directory or common.MANIFEST_DIR).expanduser()
        self.clock = clock or common.utc_now

    def path(self, when=None):
        return self.dir / ('%s.jsonl' % (when or self.clock()).astimezone(dt.timezone.utc).date().isoformat())

    def append(self, rec):
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            with open(self.path(), 'a', encoding='utf-8') as f:
                f.write(json.dumps(rec, sort_keys=True, default=str) + '\n')
                f.flush()
                os.fsync(f.fileno())
        except OSError as e:
            # the call committed but its ids are not recorded: M10b would halt promotion; stop now and say why
            raise common.StopLoop('manifest_write_failed', '%s: %s' % (self.dir, e))
        return rec

    def record(self, writer, args, result):
        r = returned(writer, args, result)
        rec = {'at': common.iso_utc(self.clock()), 'writer': writer, 'run_id': run_of(writer, args, result),
               'outcome': 'ok'}
        for k in ID_KEYS + ('support',):
            if r[k]:
                rec[k] = r[k]
        if r['results']:
            rec['results'] = dict(r['results'])
        if r['image_id']:
            rec['image_id'] = r['image_id']
        return self.append(rec)

    def record_unknown(self, writer, args, code):
        return self.append({'at': common.iso_utc(self.clock()), 'writer': writer, 'run_id': run_of(writer, args, None),
                            'outcome': 'unknown', 'code': code})


def load(directory, since, until=None):
    """Manifest lines from the UTC-dated files covering since..until."""
    d = Path(directory or common.MANIFEST_DIR).expanduser()
    a = common.parse_ts(since).astimezone(dt.timezone.utc).date()
    b = common.parse_ts(until or common.utc_now()).astimezone(dt.timezone.utc).date()
    out = []
    while a <= b:
        p = d / ('%s.jsonl' % a.isoformat())
        if p.exists():
            out += common.read_jsonl(p)
        a += dt.timedelta(days=1)
    return out


def reconcile(created, lines, examples=5):
    """M10b: every evidence row created in the window against the manifest.

    created: {"<table>": [ids], "evidence_decisions": [{"id", "by", "decision", "run", "image"}],
              "vehicle_change_claim_support": {"<claim id>": n}}.
    Owner decisions (human:) are not the runner's: they are counted for the lead to match against the API request
    log. An implied decision must be listed under a call's implied_decision_ids. A promotion-path decision
    (writer:...) matches by its run or image when the writer returns no id."""
    ids, implied, runs, images = set(), set(), set(), set()
    support = collections.Counter()
    reverts_recorded, unknown = 0, 0
    for ln in lines:
        ids |= set(ln.get('ids') or [])
        implied |= set(ln.get('implied_decision_ids') or [])
        if ln.get('run_id'):
            runs.add(ln['run_id'])
        if ln.get('writer') == 'evidence_open_run':
            runs |= set(ln.get('ids') or [])
        if ln.get('image_id'):
            images.add(ln['image_id'])
        for s in ln.get('support') or []:
            support[s['claim_id']] += int(s['count'])
        if ln.get('writer') == 'evidence_record_reverts':
            reverts_recorded += int((ln.get('results') or {}).get('recorded', 0))
        if ln.get('outcome') == 'unknown':
            unknown += 1
    missing = collections.OrderedDict()
    human = 0
    for table, rows in created.items():
        if table == 'vehicle_change_claim_support':
            continue
        miss = []
        if table == 'evidence_decisions':
            reverts = [d for d in rows or [] if d.get('decision') == 'revert_detected']
            for d in rows or []:
                by = d.get('by') or ''
                if by.startswith('human:'):
                    human += 1
                    continue
                if by.startswith('implied:'):
                    ok = d['id'] in implied
                elif by.startswith('writer:'):
                    ok = d['id'] in ids or d.get('run') in runs or d.get('image') in images or (
                        d.get('decision') == 'revert_detected' and len(reverts) <= reverts_recorded)
                else:
                    ok = d['id'] in ids
                if not ok:
                    miss.append(d['id'])
        else:
            miss = [x for x in rows or [] if x not in ids]
        if miss:
            missing[table] = miss
    mismatch = [{'claim_id': c, 'rows': n, 'manifest': support.get(c, 0)}
                for c, n in sorted((created.get('vehicle_change_claim_support') or {}).items())
                if support.get(c, 0) != int(n)]
    return {'unmanifested': sum(len(v) for v in missing.values()) + len(mismatch),
            'by_table': {t: len(v) for t, v in missing.items()},
            'examples': {t: v[:examples] for t, v in missing.items()},
            'support_mismatch': mismatch[:examples],
            'human_decisions_to_match_request_log': human,
            'manifest_lines': len(lines), 'unknown_outcomes': unknown}
