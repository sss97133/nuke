"""Local checker for file-mode payloads before any load (port of the pilot's validate.py to the v11 contract).

Checks every line of run.json and the canonical JSONL files against the CHECK constraints and writer rules in
payloads.CONTRACT (vocabularies; er_coverage_source; ivc_*, ictc_*, el_*, eae_*, vcc_*, udvc_* shapes, the v5 entity
rule and (v8) the rule that a job never writes his word: no owner statement, no 'owner:' key, no rule 'owner' capture
time, no owner_review run; the unique-current indexes; the writer's whole-hour offset rule; custody_bounds'
upper-bound rule; scope in load order; image eligibility; placeholders) and the privacy rules: no
amounts (only @amount placeholders), no contact details, no people's names (hashed list from the local case), no
coordinates, the owner id only in run.json config.user_id, no FOR-SIGNING / jenny-inbox paths.

Usage: python3 scripts/evidence/checks.py --dir <payload dir> [--case <case.json>] [--show 5]
"""
import argparse
import collections
import datetime as dt
import hashlib
import os
import re
import sys

import common
import payloads

RUN_FILE = 'run.json'
EMAIL = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
PHONE = re.compile(r'(\(\d{3}\)\s?\d{3}-\d{4})|(\b\d{3}[-. ]\d{3}[-. ]\d{4}\b)|(\b1-8\d\d-\d{7}\b)')
STREET = re.compile(r'\b\d{2,5}\s+[A-Za-z]+\s+(rd|road|st|street|ave|avenue|blvd|dr|drive|ln|lane|way)\b', re.I)
COORDS = re.compile(r'(?<![:\d.])-?\d{2,3}\.\d{4,}(?![\d:])')
MONEY = re.compile(r'(?<![\w.:-])(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})(?![\w.:-])')
DOLLAR = re.compile(r'\$\s?\d')


class Report:
    def __init__(self):
        self.by_file = collections.defaultdict(list)
        self.counts = collections.OrderedDict()
        self.notes = []

    def add(self, f, where, msg):
        self.by_file[f].append('%s: %s' % (where, msg))

    @property
    def total(self):
        return sum(len(v) for v in self.by_file.values())

    def as_dict(self):
        return {'violations': self.total, 'counts': self.counts,
                'by_file': {f: v for f, v in self.by_file.items() if v}, 'notes': self.notes}

    def print(self, show=5, out=sys.stdout):
        for f in [RUN_FILE] + [f for f, _w in payloads.C['files']]:
            if f not in self.counts and not self.by_file.get(f):
                continue
            vs = self.by_file.get(f, [])
            print('%-34s %6s lines  %3d violations' % (f, self.counts.get(f, ''), len(vs)), file=out)
            for x in vs[:show]:
                print('    - ' + x, file=out)
        for f in sorted(set(self.by_file) - set(self.counts) - {RUN_FILE}):
            for x in self.by_file[f][:show]:
                print('%-34s - %s' % (f, x), file=out)
        for n in self.notes:
            print('note: ' + n, file=out)
        print('TOTAL violations: %d' % self.total, file=out)


def conf_ok(c):
    return isinstance(c, (int, float)) and not isinstance(c, bool) and 0 <= c <= 1 and round(c, 3) == c


def is_date(s):
    try:
        dt.date.fromisoformat(s)
        return True
    except (TypeError, ValueError):
        return False


def is_ts(s):
    try:
        common.parse_ts(s)
        return True
    except (TypeError, ValueError, AttributeError):
        return False


def walk(o, path=''):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from walk(v, path + '.' + k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, '%s[%d]' % (path, i))
    else:
        yield path, o


def load_dir(d):
    run = common.load_json(os.path.join(d, RUN_FILE))
    files = collections.OrderedDict()
    for f, _w in payloads.C['files']:
        p = os.path.join(d, f)
        files[f] = common.read_jsonl(p) if os.path.exists(p) else []
    return run, files


def validate_dir(d, ctx=None, money_sources=None, show_notes=True):
    """ctx: a common.Context for the case (scope, eligibility, privacy lists); money_sources: money.Sources (amounts
    resolve; amount text scan). Both optional: without them the scope, eligibility and amount checks are skipped."""
    C = payloads.C
    v = Report()
    run, files = load_dir(d)
    uid = (run.get('config') or {}).get('user_id')
    case = ctx.case if ctx else {}
    vid = ctx.vid if ctx else (lambda x: x)
    base_scope = {vid(x) for x in case.get('base_scope') or []} if ctx else None
    # account refs the local case declares (its ledger's and its account map's): their names may carry digits
    passes = case.get('passes') or {}
    led = passes.get('ledger_vendor_date') or {}
    known_accounts = set(led.get('covers_accounts') or []) | {led.get('account_ref')} | {
        a.get('account_ref') for a in (passes.get('account_map') or {}).get('accounts') or []}
    images = {}
    listing = {}
    if ctx and ctx.input_path('image_rows'):
        import inputs
        images = {r['id']: r for r in inputs.image_rows(ctx)}
        listing = {r['id']: r for r in inputs.listing_rows(ctx)}

    # ------------------------------------------------------------------ run.json
    run_keys = {}
    v.counts[RUN_FILE] = len(run.get('runs') or [])
    if not common.is_uuid(uid or ''):
        v.add(RUN_FILE, 'config', 'config.user_id is not a uuid')
    for i, r in enumerate(run.get('runs') or []):
        w = 'runs[%d] %s' % (i, r.get('key'))
        a = r.get('args') or {}
        if r.get('writer') != 'evidence_open_run':
            v.add(RUN_FILE, w, 'writer must be evidence_open_run')
        if set(a) - set(C['writers']['evidence_open_run']['args']):
            v.add(RUN_FILE, w, 'args the writer does not take: %s' % sorted(set(a) - set(C['writers']['evidence_open_run']['args'])))
        if a.get('p_user_id') != '@config.user_id':
            v.add(RUN_FILE, w, 'p_user_id must be @config.user_id (the id lives only in config)')
        if a.get('p_run_kind') not in C['run_kinds'] or a.get('p_run_kind') in C['run_kinds_own_writer']:
            v.add(RUN_FILE, w, 'run_kind %r not allowed through evidence_open_run' % a.get('p_run_kind'))
        if a.get('p_pass') not in C['pass_names']:
            v.add(RUN_FILE, w, 'er_pass_ok: pass %r' % a.get('p_pass'))
        if r.get('key') != 'run:' + str(a.get('p_pass')):
            v.add(RUN_FILE, w, 'run key must be run:<pass>')
        for f in ('p_producer', 'p_code_version'):
            if not a.get(f):
                v.add(RUN_FILE, w, '%s is NOT NULL' % f)
        if not isinstance(a.get('p_config'), dict):
            v.add(RUN_FILE, w, 'p_config must be a json object')
        if a.get('p_from') and a.get('p_to') and a['p_to'] < a['p_from']:
            v.add(RUN_FILE, w, 'er_window')
        if a.get('p_run_kind') == 'review' and not ('sheet_sha256' in (a.get('p_config') or {})
                                                  and str((a.get('p_config') or {}).get('items', '')).isdigit()):
            v.add(RUN_FILE, w, 'er_review_shape')
        if a.get('p_run_kind') == 'review' and payloads.review_rows_problem(a.get('p_config') or {}):
            v.add(RUN_FILE, w, payloads.review_rows_problem(a.get('p_config') or {}))
        cov = payloads.coverage_problem(a.get('p_pass'), a.get('p_config') if isinstance(a.get('p_config'), dict) else {},
                                        ctx.now.date() if ctx else None)
        if cov:
            v.add(RUN_FILE, w, 'er_coverage_source: ' + cov)
        if a.get('p_pass') == 'owner_review':
            v.add(RUN_FILE, w, 'a job never opens an owner_review run (v8: owner_answer_missing)')
        par = a.get('p_parent_run_id')
        if par is not None and (not isinstance(par, str) or not par.startswith('@run:') or par[1:] not in run_keys):
            v.add(RUN_FILE, w, 'parent %r is not an earlier run key' % par)
        if r.get('key') in run_keys:
            v.add(RUN_FILE, w, 'duplicate run key')
        run_keys[r.get('key')] = a.get('p_pass')
        if r.get('close'):
            if r['close'].get('status') not in ('done', 'failed', 'aborted'):
                v.add(RUN_FILE, w, 'close status must be done, failed or aborted')

    # ------------------------------------------------------------------ keys across files (load order)
    keys = {}
    order = [f for f, _w in C['files']]
    for f in order:
        for i, ln in enumerate(files[f]):
            k = ln.get('key')
            if not k:
                v.add(f, 'line %d' % (i + 1), 'missing key')
            elif k in keys:
                v.add(f, 'line %d' % (i + 1), 'duplicate key %s' % k)
            else:
                keys[k] = (f, i, ln)

    def run_pass(f, i, ln):
        p = ln.get('p_run_id', '')
        if not (isinstance(p, str) and p.startswith('@run:') and p[1:] in run_keys):
            v.add(f, 'line %d' % (i + 1), 'p_run_id %r does not resolve to a run' % p)
            return None
        return run_keys[p[1:]]

    writer_of = dict(C['files'])
    for f in order:
        for i, ln in enumerate(files[f]):
            if ln.get('writer') != writer_of[f]:
                v.add(f, 'line %d' % (i + 1), 'writer must be %s' % writer_of[f])
        v.counts[f] = len(files[f])

    amounts = []

    def amount_ok(f, where, val, field):
        if val is None:
            return
        if not (isinstance(val, str) and val.startswith('@amount:')):
            v.add(f, where, '%s must be an @amount: placeholder (no amounts in files), got %r' % (field, val))
            return
        amounts.append(val)
        if money_sources is not None and not money_sources.resolves(val):
            v.add(f, where, '%s placeholder does not resolve against the pinned sources' % field)

    def eligible(iid):
        if not images and not listing:
            return True
        r = images.get(iid) or listing.get(iid)
        if r is None or r.get('sup') or r.get('dup'):
            return False
        if iid in images:
            return bool(r.get('his') or r.get('uid_null'))
        return bool(r.get('uid_null')) and (base_scope is None or r.get('vehicle_id') in base_scope)

    scope = set(base_scope) if base_scope is not None else None

    def in_scope(veh):
        return scope is None or veh in scope

    # ------------------------------------------------------------------ capture-time claims
    f = 'time_claims.jsonl'
    seen, would_confirm = set(), 0
    for i, ln in enumerate(files[f]):
        w = 'line %d' % (i + 1)
        p = run_pass(f, i, ln)
        r = ln.get('row') or {}
        if p != 'time_offset':
            v.add(f, w, 'capture-time claims come from the time_offset run, not %r' % p)
        iid = r.get('image_id')
        if not common.is_uuid(iid or ''):
            v.add(f, w, 'image_id not a uuid')
        if iid in seen:
            v.add(f, w, 'ictc_one_current: second claim for image %s' % iid)
        seen.add(iid)
        if r.get('rule') not in C['time_rules']:
            v.add(f, w, 'rule %r' % r.get('rule'))
        if r.get('rule') == 'batch_offset_v1' and not r.get('batch_key'):
            v.add(f, w, 'ictc_batch: batch_offset_v1 needs batch_key')
        if r.get('rule') == 'owner':
            v.add(f, w, "owner_answer_missing: a job never proposes a rule 'owner' capture time (v8: his day comes "
                        'from his own decision in the app)')
        if not is_ts(r.get('corrected_taken_at')):
            v.add(f, w, 'corrected_taken_at NOT NULL timestamptz')
        if not is_date(r.get('captured_on')):
            v.add(f, w, 'captured_on NOT NULL date')
        if not isinstance(r.get('witness'), dict):
            v.add(f, w, 'witness NOT NULL jsonb object')
        elif not is_date((r.get('witness') or {}).get('upload_day')):
            v.add(f, w, 'witness.upload_day missing: the batch gate confirms a pooled claim by its own upload day')
        if not conf_ok(r.get('confidence')):
            v.add(f, w, 'confidence not numeric(4,3) in [0,1]')
        if r.get('offset_seconds') is not None and not isinstance(r['offset_seconds'], int):
            v.add(f, w, 'offset_seconds must be an integer')
        if not eligible(iid):
            v.add(f, w, 'image not eligible (not his, superseded or a dedupe copy)')
        live = images.get(iid)
        if live and r.get('stored_taken_at') and is_ts(r.get('corrected_taken_at')):
            if common.parse_ts(live['taken_at']) != common.parse_ts(r['stored_taken_at']):
                v.add(f, w, 'compare-and-set: stored_taken_at differs from the live taken_at (the writer skips it)')
        if r.get('stored_taken_at') and is_ts(r.get('corrected_taken_at')):
            off, _res = payloads.whole_hour_offset(r['stored_taken_at'], r['corrected_taken_at'])
            if off != r.get('offset_seconds'):
                v.add(f, w, 'offset_seconds %r is not the writer\'s value %d' % (r.get('offset_seconds'), off))
            if (r.get('rule') == 'photos_exif_join' and (r.get('witness') or {}).get('unique_match') is True
                    and off == r.get('offset_seconds') and off % 3600 == 0
                    and abs(off) // 3600 in C['allowed_offset_hours']):
                would_confirm += 1
    if files[f]:
        v.notes.append('time_claims: the writer would machine-confirm %d of %d (check:photos_exif_join)'
                       % (would_confirm, len(files[f])))
    v.would_confirm = would_confirm

    # ------------------------------------------------------------------ candidates
    for f in ('candidates.photos_album.jsonl', 'candidates.combined.jsonl', 'candidates.listing_class.jsonl'):
        uniq = set()
        for i, ln in enumerate(files[f]):
            w = 'line %d' % (i + 1)
            p = run_pass(f, i, ln)
            r = ln.get('row') or {}
            if f != 'candidates.%s.jsonl' % p:
                v.add(f, w, 'file holds %s rows but p_run_id is %r' % (f.split('.')[1], p))
            iid, veh, verdict = r.get('image_id'), r.get('vehicle_id'), r.get('verdict')
            if not common.is_uuid(iid or ''):
                v.add(f, w, 'image_id not a uuid')
            if verdict not in C['verdicts']:
                v.add(f, w, 'verdict %r' % verdict)
            sk = r.get('subject_key')
            if not ((verdict == 'is_vehicle' and (veh or sk)) or (verdict == 'listing_evidence' and veh)
                    or (verdict in C['no_vehicle_verdicts'] and veh is None) or verdict == 'ambiguous'):
                v.add(f, w, 'ivc_vehicle_shape: verdict %s with vehicle %r' % (verdict, veh))
            fr = r.get('frame_role', 'subject')
            if fr not in C['frame_roles']:
                v.add(f, w, 'frame_role %r' % fr)
            if fr != 'subject' and verdict != 'is_vehicle':
                v.add(f, w, 'ivc_also_in_frame: also_in_frame rows are is_vehicle')
            if sk is not None and (veh is not None or not re.match(C['subject_key_re'], sk)):
                v.add(f, w, 'ivc_subject_key')
            if r.get('image_class', 'own') not in C['image_classes']:
                v.add(f, w, 'image_class %r' % r.get('image_class'))
            if not conf_ok(r.get('confidence')):
                v.add(f, w, 'confidence not numeric(4,3) in [0,1]')
            if not r.get('join_key'):
                v.add(f, w, 'join_key NOT NULL')
            ev = r.get('evidence')
            if not (isinstance(ev, list) and ev):
                v.add(f, w, 'ivc_evidence_nonempty')
            has_album = r.get('album_link_id') is not None
            if (p == 'photos_album') != has_album:
                v.add(f, w, 'ivc_album_link: photos_album rows (and only they) carry album_link_id')
            if has_album:
                al = r['album_link_id']
                tgt = keys.get(al[5:]) if isinstance(al, str) and al.startswith('@key:') else None
                if not tgt or (tgt[2].get('row') or {}).get('source_kind') != 'photos_album':
                    v.add(f, w, 'album_link_id %r does not resolve to a photos_album link' % al)
                elif tgt[2]['row'].get('vehicle_id') != veh:
                    v.add(f, w, 'album link vehicle differs from the candidate vehicle (never confirmed_by_album_map)')
                elif order.index(tgt[0]) >= order.index(f):
                    v.add(f, w, 'album link loads after its candidates')
            if r.get('pass_captured_on') is not None and not is_date(r['pass_captured_on']):
                v.add(f, w, 'pass_captured_on not a date')
            u = (iid, veh or sk or '-', p)
            if u in uniq:
                v.add(f, w, 'ivc_one_current: (image, vehicle or subject_key, pass) twice')
            uniq.add(u)
            if not eligible(iid):
                v.add(f, w, 'image not eligible (evidence_image_eligible; is_duplicate copies are refused)')
            if veh is not None and not in_scope(veh):
                v.add(f, w, 'vehicle %s not in scope when candidates load' % veh)
            if not (ln.get('key') or '').startswith('cand:%s:%s' % (p, iid)):
                v.add(f, w, 'key must be cand:<pass>:<image_id>[@vehicle8]')

    f = 'candidates.listing_class.jsonl'
    if files[f] and listing:
        by_url = collections.defaultdict(list)
        lveh = {(ln.get('row') or {}).get('vehicle_id') for ln in files[f]}
        for r in listing.values():
            if r.get('vehicle_id') in lveh:
                by_url[r['image_url']].append(r)
        covered, urls = set(), set()
        for i, ln in enumerate(files[f]):
            w = 'line %d' % (i + 1)
            r = ln.get('row') or {}
            ev = {e.get('kind'): e for e in r.get('evidence') or []}
            url = (ev.get('vehicle_image_source') or {}).get('image_url')
            if url not in by_url:
                v.add(f, w, 'image_url is not a listing row url read live')
                continue
            if url in urls:
                v.add(f, w, 'second candidate for one image_url')
            urls.add(url)
            dups = set((ev.get('url_copies_on_vehicle') or {}).get('duplicate_row_ids') or [])
            if dups != {x['id'] for x in by_url[url]} - {r.get('image_id')}:
                v.add(f, w, 'duplicate_row_ids differ from the other copies of this url')
            covered |= dups | {r.get('image_id')}
        missing = {r['id'] for rs in by_url.values() for r in rs} - covered
        if missing:
            v.add(f, 'file', '%d listing rows neither a candidate nor a listed copy' % len(missing))

    # ------------------------------------------------------------------ links
    link_uniq = {}
    for f in ('links.album.jsonl', 'links.jsonl'):
        for i, ln in enumerate(files[f]):
            w = 'line %d %s' % (i + 1, ln.get('key'))
            p = run_pass(f, i, ln)
            r = ln.get('row') or {}
            sk, role = r.get('source_kind'), r.get('role')
            if sk not in C['source_kinds']:
                v.add(f, w, 'source_kind %r' % sk)
            if role not in C['roles']:
                v.add(f, w, 'role %r (v3: payment_out / payment_in / assertion / supports / contradicts / context)' % role)
            if not ((r.get('source_table') and r.get('source_row_id')) or r.get('external_ref')):
                v.add(f, w, 'el_source_named')
                continue
            if r.get('source_row_id') is not None and not common.is_uuid(str(r['source_row_id'])):
                v.add(f, w, 'source_row_id not a uuid')
            skey = payloads.source_key(r.get('source_table'), r.get('source_row_id'), r.get('external_ref'),
                                       r.get('anchor'))
            if sk in C['anchor_required'] and not r.get('anchor'):
                v.add(f, w, 'el_anchor_required: %s needs an anchor' % sk)
            amt, dirn = r.get('amount_cents'), r.get('direction')
            if role in C['payment_roles'] and not (amt is not None and dirn in ('out', 'in')):
                v.add(f, w, 'el_money_shape: %s needs amount_cents and direction in/out' % role)
            if role == 'assertion' and not (dirn in ('out', 'in') and (amt is not None or r.get('payment_key') is None
                                                                       or r.get('payment_join_confidence') is not None)):
                v.add(f, w, 'el_money_shape: an assertion needs a direction; joined to a payment it carries an amount '
                            'or a payment_join_confidence')
            if role in C['payment_roles'] and dirn != C['payment_roles'][role]:
                v.add(f, w, 'el_direction_role')
            if r.get('allocated_cents') is not None and amt is None:
                v.add(f, w, 'el_allocation: allocated_cents needs amount_cents')
            amount_ok(f, w, amt, 'amount_cents')
            amount_ok(f, w, r.get('allocated_cents'), 'allocated_cents')
            if dirn is not None and dirn not in C['directions']:
                v.add(f, w, 'direction %r' % dirn)
            if r.get('cost_category') is not None and r['cost_category'] not in C['cost_categories']:
                v.add(f, w, 'cost_category %r (v3: physical kinds only)' % r['cost_category'])
            pk = r.get('payment_key')
            if pk is not None and not re.match(C['payment_key_re'], pk):
                v.add(f, w, 'payment_key shape %r' % pk)
            if pk and sk == 'ledger_line' and pk != 'bank:' + skey.rsplit(':', 1)[-1]:
                v.add(f, w, "a ledger line's payment_key is bank:<its line id>")
            if r.get('payment_join_confidence') is not None and (pk is None or not conf_ok(r['payment_join_confidence'])):
                v.add(f, w, 'payment_join_confidence needs a payment_key and numeric(4,3)')
            for fld in ('payer_entity', 'payee_entity'):
                if r.get(fld) is not None and not re.match(C['entity_key_re'], r[fld]):
                    v.add(f, w, '%s shape %r' % (fld, r[fld]))
                if r.get(fld) == 'unknown':
                    v.add(f, w, "%s 'unknown' blocks the account map; leave it NULL (FM-7)" % fld)
                elif r.get(fld) is not None and not r[fld].startswith('third_party:'):
                    v.add(f, w, "el_entity_owner_word: %s %r: a pass names only third parties; his entities come from "
                                "the confirmed account map (the writer returns entity_is_owners_call)" % (fld, r[fld]))
            if sk == 'owner_statement' or (pk or '').startswith('owner:'):
                # (v8) his word is written only by his own who-paid decision in the app, never by a job
                v.add(f, w, 'owner_answer_missing: a job never writes an owner statement or an owner: payment key')
            if sk == 'photos_item' and (pk or amt is not None or role != 'context'):
                v.add(f, w, 'a photos_item link is context only (no payment, no amount)')
            for fld in ('from_account_ref', 'to_account_ref'):
                if r.get(fld) is not None and not re.match(C['account_ref_re'], r[fld]):
                    v.add(f, w, '%s shape %r' % (fld, r[fld]))
                if r.get(fld) and r[fld] not in known_accounts and re.search(r'\d{4,}', r[fld].split(':', 1)[1]):
                    v.add(f, w, '%s looks like an account number' % fld)
            if 'account_ref' in r:
                v.add(f, w, 'account_ref is v2; v3 writes from_account_ref / to_account_ref')
            for fld, mx in (('source_label', C['label_max']), ('summary', C['summary_max'])):
                if r.get(fld) is not None and len(r[fld]) > mx:
                    v.add(f, w, '%s longer than %d characters' % (fld, mx))
            if not conf_ok(r.get('confidence')):
                v.add(f, w, 'confidence not numeric(4,3) in [0,1]')
            if not r.get('join_key'):
                v.add(f, w, 'join_key NOT NULL')
            ev = r.get('evidence')
            if not (isinstance(ev, list) and ev):
                v.add(f, w, 'el_evidence_nonempty')
            for fld in ('occurred_on', 'transaction_on'):
                if r.get(fld) is not None and not is_date(r[fld]):
                    v.add(f, w, '%s not a date' % fld)
            veh, subj = r.get('vehicle_id'), r.get('subject_key')
            if subj is not None and (veh is not None or not re.match(C['subject_key_re'], subj)):
                v.add(f, w, 'el_subject_key')
            if veh is not None and not in_scope(veh):
                v.add(f, w, 'vehicle %s not in scope when links load (links load before claims)' % veh)
            u = (skey, veh or subj or '-')
            if u in link_uniq:
                v.add(f, w, 'el_one_current: (source_key, vehicle or subject_key) twice: %s' % skey)
            link_uniq[u] = ln.get('key')
            if ln.get('key') != payloads.link_key(skey, veh, subj):
                v.add(f, w, 'key must be %s' % payloads.link_key(skey, veh, subj))
            if (sk == 'photos_album') != (p == 'photos_album'):
                v.add(f, w, 'photos_album links (and only they) come from the photos_album run')

    # ------------------------------------------------------------------ account entities
    f = 'account_entities.jsonl'
    acc = set()
    for i, ln in enumerate(files[f]):
        w = 'line %d' % (i + 1)
        p = run_pass(f, i, ln)
        r = ln.get('row') or {}
        if p != 'account_map':
            v.add(f, w, 'account entities come from the account_map run')
        if not re.match(C['account_ref_re'], r.get('account_ref') or ''):
            v.add(f, w, 'account_ref shape %r' % r.get('account_ref'))
        if (r.get('account_ref') or '').startswith('nuke_org:') and not common.is_uuid(r['account_ref'][9:]):
            v.add(f, w, 'nuke_org refs carry the full organization uuid (scope reads substr(account_ref,10)::uuid)')
        if not re.match(C['entity_key_re'], r.get('entity_key') or ''):
            v.add(f, w, 'entity_key shape %r' % r.get('entity_key'))
        if not conf_ok(r.get('confidence')):
            v.add(f, w, 'confidence not numeric(4,3) in [0,1]')
        if not (isinstance(r.get('evidence'), list) and r['evidence']):
            v.add(f, w, 'evidence must be a non-empty array')
        if r.get('account_ref') in acc:
            v.add(f, w, 'eae_one_current: account_ref twice')
        acc.add(r.get('account_ref'))

    # ------------------------------------------------------------------ day context
    f = 'day_context.jsonl'
    dc, out_of_scope_days = set(), 0
    for i, ln in enumerate(files[f]):
        w = 'line %d' % (i + 1)
        p = run_pass(f, i, ln)
        r = ln.get('row') or {}
        if p != 'day_context':
            v.add(f, w, 'day context comes from the day_context run')
        if not is_date(r.get('day')):
            v.add(f, w, 'day not a date')
        if not r.get('place_cluster'):
            v.add(f, w, 'place_cluster NOT NULL')
        if COORDS.search(r.get('place_cluster') or ''):
            v.add(f, w, 'place_cluster carries coordinates')
        if not in_scope(r.get('vehicle_id')):
            out_of_scope_days += 1                      # (v4) recorded as context and listed under out_of_scope
        b = r.get('basis')
        if not (isinstance(b, list) and b and set(b) <= set(C['day_basis'])):
            v.add(f, w, 'basis must be a non-empty subset of the day basis vocabulary')
        if not conf_ok(r.get('confidence')):
            v.add(f, w, 'confidence not numeric(4,3) in [0,1]')
        u = (r.get('day'), r.get('place_cluster'), r.get('vehicle_id'))
        if u in dc:
            v.add(f, w, 'udvc_one_current: (day, cluster, vehicle) twice')
        dc.add(u)
    if out_of_scope_days:
        v.notes.append('day_context: %d row(s) name a vehicle outside scope (recorded as context, listed out_of_scope)'
                       % out_of_scope_days)

    # ------------------------------------------------------------------ change claims and support (load order)
    kind_files = {'image_candidate': ('candidates.',), 'evidence_link': ('links.',),
                  'capture_time_claim': ('time_claims.',), 'change_claim': ('change_claims.',)}

    def check_supports(f, w, i, sups, limit=None):
        if limit and len(sups) > limit:
            v.add(f, w, 'at most %d support rows per call' % limit)
        for j, s in enumerate(sups or []):
            sw = '%s support[%d]' % (w, j)
            if s.get('evidence_kind') not in C['support_kinds']:
                v.add(f, sw, 'evidence_kind %r' % s.get('evidence_kind'))
            if s.get('stance') not in C['stances']:
                v.add(f, sw, 'stance %r' % s.get('stance'))
            if s.get('about') not in C['about']:
                v.add(f, sw, 'about %r' % s.get('about'))
            if s.get('weight') is not None and not conf_ok(s['weight']):
                v.add(f, sw, 'weight not numeric(4,3)')
            if s.get('note') is not None and len(s['note']) > C['note_max']:
                v.add(f, sw, 'note longer than %d' % C['note_max'])
            eid = s.get('evidence_id', '')
            tgt = keys.get(eid[5:]) if isinstance(eid, str) and eid.startswith('@key:') else None
            if not tgt:
                if not common.is_uuid(str(eid)):
                    v.add(f, sw, 'evidence_id %r does not resolve to a line key' % eid)
                continue
            if not tgt[0].startswith(kind_files.get(s.get('evidence_kind'), ('?',))):
                v.add(f, sw, 'evidence_kind %s points at a %s line' % (s.get('evidence_kind'), tgt[0]))
            if order.index(tgt[0]) > order.index(f) or (tgt[0] == f and tgt[1] >= i):
                v.add(f, sw, 'cites a line that loads later')
            if tgt[0] == 'candidates.listing_class.jsonl':
                v.add(f, sw, 'cites a listing_class row, which loads only after the dedupe')

    f = 'change_claims.jsonl'
    for i, ln in enumerate(files[f]):
        w = 'line %d %s' % (i + 1, ln.get('key'))
        p = run_pass(f, i, ln)
        c = ln.get('p_claim') or {}
        if set(c) - set(C['fields']['claim']):
            v.add(f, w, 'claim fields the writer does not read: %s' % sorted(set(c) - set(C['fields']['claim'])))
        if c.get('claim_domain') not in C['claim_domains']:
            v.add(f, w, 'claim_domain %r' % c.get('claim_domain'))
        if c.get('kind') not in C['claim_kinds']:
            v.add(f, w, 'kind %r' % c.get('kind'))
        for fld in ('occurred_from', 'occurred_to'):
            if c.get(fld) is not None and not is_date(c[fld]):
                v.add(f, w, '%s not a date' % fld)
        if c.get('occurred_from') and c.get('occurred_to') and c['occurred_to'] < c['occurred_from']:
            v.add(f, w, 'vcc_range')
        if c.get('kind') == 'same_vehicle_as' and not c.get('related_vehicle_id'):
            v.add(f, w, 'vcc_identity_target')
        if c.get('survivor_vehicle_id') is not None and not (
                c.get('kind') == 'same_vehicle_as' and c['survivor_vehicle_id'] in (c.get('vehicle_id'), c.get('related_vehicle_id'))):
            v.add(f, w, 'vcc_survivor')
        if c.get('trade_in_cents') is not None and c.get('kind') not in C['trade_in_kinds']:
            v.add(f, w, 'vcc_trade_in')
        if c.get('party_entity') is not None:
            if c.get('kind') not in C['party_kinds']:
                v.add(f, w, 'vcc_party: party only on %s' % C['party_kinds'])
            if not re.match(C['entity_key_re'], c['party_entity']):
                v.add(f, w, 'party_entity shape %r' % c['party_entity'])
            if not (c['party_entity'].startswith('third_party:') or
                    (c['party_entity'] == 'owner' and c.get('kind') in C['owner_party_kinds'])):
                v.add(f, w, 'vcc_party_not_entity: party %r (third parties, or the owner as the worker only)'
                      % c['party_entity'])
        amount_ok(f, w, c.get('amount_cents'), 'amount_cents')
        amount_ok(f, w, c.get('trade_in_cents'), 'trade_in_cents')
        for path, val in walk(c.get('asserted_value') or {}):
            if isinstance(val, (int, float)) and not isinstance(val, bool) and 'cents' in path:
                v.add(f, w, 'asserted_value%s holds a number; name it as an @amount placeholder' % path)
            elif isinstance(val, str) and val.startswith('@amount:'):
                amount_ok(f, w, val, 'asserted_value' + path)
        if not c.get('summary'):
            v.add(f, w, 'summary NOT NULL')
        if not conf_ok(c.get('confidence')):
            v.add(f, w, 'confidence not numeric(4,3) in [0,1]')
        veh, subj = c.get('vehicle_id'), c.get('subject_key')
        if (veh is None) == (subj is None) or (subj is not None and (
                c.get('kind') not in C['subject_claim_kinds'] or not re.match(C['subject_key_re'], subj))):
            v.add(f, w, 'vcc_subject: a vehicle_id, or a subject_key on %s only' % '/'.join(C['subject_claim_kinds']))
        elif veh is not None and not common.is_uuid(veh):
            v.add(f, w, 'vehicle_id not a uuid')
        elif veh is not None and not in_scope(veh) and c.get('kind') != 'worked_on':
            v.add(f, w, 'vehicle %s not in scope at this point of the load (the writer raises 22023)' % veh)
        if ln.get('p_run_id') == '@run:custody_bounds':
            if c.get('kind') != 'acquisition' or c.get('occurred_from') is not None or not c.get('occurred_to') \
                    or not (isinstance(c.get('confidence'), (int, float)) and c['confidence'] <= 0.5):
                v.add(f, w, 'custody_bounds proposes only an acquisition upper bound (occurred_to, no occurred_from, '
                            'confidence <= 0.5), never a sale')
            elif any(o['p_claim'].get('vehicle_id') == veh and o['p_claim'].get('kind') == 'acquisition'
                     and o.get('p_run_id') != '@run:custody_bounds' for o in files[f]):
                v.add(f, w, 'custody_bounds: a sourced acquisition exists for this vehicle (the writer writes nothing)')
        if p not in C['pass_names']:
            v.add(f, w, 'run pass not in evidence_pass_names')
        if ln.get('p_supersedes') is not None:
            v.add(f, w, 'p_supersedes is null in a first load')
        check_supports(f, w, i, ln.get('p_support'))
        if scope is not None and c.get('kind') in C['scope_claim_kinds'] and c.get('related_vehicle_id') and veh in scope:
            scope.add(c['related_vehicle_id'])            # evidence_scope_vehicle_ids (b)

    f = 'claim_support.jsonl'
    for i, ln in enumerate(files[f]):
        w = 'line %d %s' % (i + 1, ln.get('key'))
        run_pass(f, i, ln)
        cid = ln.get('p_claim_id', '')
        tgt = keys.get(cid[5:]) if isinstance(cid, str) and cid.startswith('@key:') else None
        if not tgt or tgt[0] != 'change_claims.jsonl':
            v.add(f, w, 'p_claim_id %r is not a claim key' % cid)
        check_supports(f, w, i, ln.get('p_support'), limit=C['writers']['propose_claim_support']['max_rows'])

    # ------------------------------------------------------------------ placeholders and privacy, every file
    cents, money_text = (money_sources.money_tokens(amounts) if money_sources is not None else (set(), set()))
    people = set((case.get('privacy') or {}).get('people_sha16') or [])
    docs = [(RUN_FILE, run)] + [(f, ln) for f in order for ln in files[f]]
    for extra in ('exit-expected.json',):
        if os.path.exists(os.path.join(d, extra)):
            docs.append((extra, common.load_json(os.path.join(d, extra))))
    for n, doc in docs:
        where = doc.get('key', 'file') if isinstance(doc, dict) else 'file'
        for path, val in walk(doc):
            if isinstance(val, str):
                if uid and uid in val and not (n == RUN_FILE and path == '.config.user_id'):
                    v.add(n, where, 'owner id outside run.json config (%s)' % path)
                if common.refused_path(val):
                    v.add(n, where, 'a refused private path is named (%s)' % path)
                if EMAIL.search(val):
                    v.add(n, where, 'e-mail address in %s' % path)
                if PHONE.search(val):
                    v.add(n, where, 'phone number in %s' % path)
                if STREET.search(val):
                    v.add(n, where, 'street address in %s' % path)
                if COORDS.search(val):
                    v.add(n, where, 'coordinates in %s' % path)
                if people and any(hashlib.sha256(t.lower().encode()).hexdigest()[:16] in people
                                  for t in re.findall(r'[A-Za-z]+', val)):
                    v.add(n, where, "a person's name in %s" % path)
                if DOLLAR.search(val):
                    v.add(n, where, 'dollar amount in %s' % path)
                for m in MONEY.finditer(val):
                    if m.group(1) in money_text:
                        v.add(n, where, 'an input amount appears in %s' % path)
                if val.startswith('@'):
                    ok = (val == '@config.user_id' or (val.startswith('@run:') and val[1:] in run_keys)
                          or (val.startswith('@key:') and val[5:] in keys) or val.startswith('@amount:'))
                    if not ok:
                        v.add(n, where, 'unresolved placeholder %r at %s' % (val, path))
            elif isinstance(val, (int, float)) and not isinstance(val, bool) and int(val) == val and \
                    int(val) in cents and val >= 1000:
                v.add(n, where, 'a number equal to an input amount in cents at %s' % path)
    return v


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dir', required=True)
    ap.add_argument('--case', help='local case file: scope, eligibility, privacy lists, pinned amount sources')
    ap.add_argument('--show', type=int, default=5)
    ap.add_argument('--json', help='also write the report here')
    a = ap.parse_args()
    ctx = srcs = None
    if a.case:
        import money
        ctx = common.Context(a.case, a.dir)
        payloads.use_contract(ctx.contract)
        srcs = money.Sources(ctx)
    rep = validate_dir(a.dir, ctx, srcs)
    rep.print(a.show)
    if a.json:
        common.dump_json(a.json, rep.as_dict())
    return 0 if rep.total == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
