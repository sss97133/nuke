"""Pass orchestration for file mode: run the passes in dependency order, keep a key registry, resolve support
selectors, and write run.json plus the canonical JSONL files (payloads.CONTRACT['files'] order is the load order).

A pass module exposes PASSES (the evidence pass names its runs carry) and build(ctx, built) -> {pass: run info}.
"""
import argparse
import collections
import importlib
import sys

import common
import inputs
import payloads

# Build order (supports cite keys built earlier). Load order is the file order in payloads.CONTRACT['files'].
MODULES = ['pass_time', 'pass_photos_album', 'pass_listing_class', 'pass_combined', 'pass_identity', 'pass_ledger',
           'pass_messages', 'pass_deal_document', 'pass_gmail', 'pass_change_infer', 'pass_custody_bounds',
           'pass_day_context', 'pass_account_map']


class Built:
    """Everything built so far: lines by file, and every line by key."""

    def __init__(self):
        self.files = collections.OrderedDict((f, []) for f, _w in payloads.C['files'])
        self.by_key = {}
        self.runs = collections.OrderedDict()

    def add(self, file_name, ln):
        if ln['key'] in self.by_key:
            raise common.EvidenceError('duplicate line key %s' % ln['key'])
        self.files[file_name].append(ln)
        self.by_key[ln['key']] = (file_name, ln)
        return ln['key']

    def has(self, key):
        return key in self.by_key

    def lines(self, *files):
        for f in files:
            for ln in self.files.get(f, []):
                yield ln

    def candidates(self, pass_name):
        return [ln for ln in self.lines('candidates.%s.jsonl' % pass_name)]

    def claims(self):
        return list(self.lines('change_claims.jsonl'))

    def links(self):
        return list(self.lines('links.album.jsonl', 'links.jsonl'))


def claim_key(built, kind, vehicle_id, explicit=None):
    if explicit:
        return explicit
    base = 'claim:%s:%s' % (kind, vehicle_id[:8])
    if not built.has(base):
        return base
    n = 2
    while built.has('%s:%d' % (base, n)):
        n += 1
    return '%s:%d' % (base, n)


def _pick(items, how):
    if not items:
        return []
    if how == 'first':
        return items[:1]
    if how == 'last':
        return items[-1:]
    if how == 'first_middle_last':
        idx = sorted({0, len(items) // 2, len(items) - 1})
        return [items[i] for i in idx]
    return items


def select_supports(ctx, built, specs):
    """Support selectors from the case -> support rows with @key: evidence ids.

      {"cand": {"pass", "day", "album_title_prefix", "pick"}, "stance", "about", "note", "weight"}
      {"link": {"source_key", "vehicle" | "subject_key"}, ...}
      {"claim": "<claim key>", ...}
      {"time": "<image id>", ...}
    A selector that finds nothing is an error: a claim never cites evidence that is not there."""
    join = inputs.photos_join_records(ctx)
    out = []
    for s in specs or []:
        stance, about = s.get('stance', 'supports'), s.get('about', 'other')
        if 'cand' in s:
            q = s['cand']
            rows = []
            for ln in built.candidates(q['pass']):
                r = ln['row']
                if q.get('vehicle') and r.get('vehicle_id') != ctx.vid(q['vehicle']):
                    continue
                if q.get('day') and r.get('pass_captured_on') != q['day']:
                    continue
                if q.get('album_title_prefix'):
                    titles = inputs.albums_of(join.get(r['image_id'], {}))[0]
                    if not any(t.startswith(q['album_title_prefix']) for t in titles):
                        continue
                if q.get('image_class') and r.get('image_class', 'own') != q['image_class']:
                    continue
                rows.append(ln)
            rows.sort(key=lambda ln: ((join.get(ln['row']['image_id']) or {}).get('capture_utc_true') or '',
                                      ln['row']['image_id']))
            chosen = _pick(rows, q.get('pick', 'all'))
            if not chosen:
                raise common.EvidenceError('support selector found no candidate: %s' % q)
            out += [payloads.support('image_candidate', payloads.key_ref(ln['key']), stance, about, s.get('note'),
                                     s.get('weight')) for ln in chosen]
        elif 'link' in s:
            q = s['link']
            key = payloads.link_key(q['source_key'], ctx.vid(q.get('vehicle')), q.get('subject_key'))
            if not built.has(key):
                raise common.EvidenceError('support selector: no link %s' % key)
            out.append(payloads.support('evidence_link', payloads.key_ref(key), stance, about, s.get('note'),
                                        s.get('weight')))
        elif 'claim' in s:
            if not built.has(s['claim']):
                raise common.EvidenceError('support selector: no claim %s (claims cite earlier claims only)' % s['claim'])
            out.append(payloads.support('change_claim', payloads.key_ref(s['claim']), stance, about, s.get('note'),
                                        s.get('weight')))
        elif 'time' in s:
            key = 'time:' + s['time']
            if not built.has(key):
                raise common.EvidenceError('support selector: no capture-time claim for %s' % s['time'])
            out.append(payloads.support('capture_time_claim', payloads.key_ref(key), stance, about, s.get('note'),
                                        s.get('weight')))
        else:
            raise common.EvidenceError('unknown support selector %s' % sorted(s))
    return out


def amount_of(pair):
    """["<amount source>", "<ref>"] -> '@amount:<source>:<ref>' (resolved at load time); None stays None."""
    if pair is None:
        return None
    if isinstance(pair, (list, tuple)) and len(pair) == 2:
        return payloads.amount_ref(pair[0], pair[1])
    raise common.EvidenceError('amounts are named as [source, ref], never written as numbers: %r' % (pair,))


def _amounts_in(value):
    """Nested {"amount": [source, ref]} -> '@amount:<source>:<ref>' (asserted_value figures, v3 FM-8)."""
    if isinstance(value, dict):
        if set(value) == {'amount'}:
            return amount_of(value['amount'])
        return {k: _amounts_in(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_amounts_in(v) for v in value]
    return value


def declared_claims(ctx, built, pass_name, specs):
    """Claims the case declares for this pass, with support selectors. 'window_from_support': the claim window is
    the first and last day of its image-candidate supports about 'date'."""
    n = 0
    for c in specs or []:
        veh = ctx.vid(c['vehicle'])
        key = claim_key(built, c['kind'], veh, c.get('key'))
        sup = select_supports(ctx, built, c.get('support'))
        frm, to = c.get('from'), c.get('to')
        if c.get('window_from_support'):
            days = sorted(built.by_key[s['evidence_id'][5:]][1]['row'].get('pass_captured_on') or ''
                          for s in sup if s['evidence_kind'] == 'image_candidate' and s['about'] == 'date')
            days = [d for d in days if d]
            if not days:
                raise common.EvidenceError('%s: window_from_support found no dated photo' % key)
            frm, to = days[0], days[-1]
        claim = payloads.change_claim(
            veh, c['domain'], c['kind'], c['summary'], c['confidence'], occurred_from=frm, occurred_to=to,
            amount_cents=amount_of(c.get('amount')), trade_in_cents=amount_of(c.get('trade_in')),
            related_vehicle_id=ctx.vid(c.get('related_vehicle')),
            survivor_vehicle_id=ctx.vid(c.get('survivor_vehicle')), party_entity=c.get('party_entity'),
            asserted_value=_amounts_in(c.get('asserted_value')))
        built.add('change_claims.jsonl', payloads.claim_line(key, pass_name, claim, sup))
        n += 1
    return n


def run_entry(ctx, pass_name, config, parent='run:loop', run_kind=None):
    win = ctx.case.get('window') or {}
    return {'key': 'run:' + pass_name, 'writer': 'evidence_open_run', 'args': payloads.open_run(
        '@config.user_id', run_kind or ctx.case.get('run_kind', 'pilot'), pass_name,
        common.producer('loop.py#' + pass_name), ctx.code_version, config,
        {'vehicle_ids': [ctx.vid(v) for v in ctx.case.get('scope_vehicles') or []]},
        win.get('from'), win.get('to'), ('@' + parent) if parent else None)}


def build_all(ctx, only=None):
    """Run every pass (all of them, so cross-pass keys resolve) and keep the runs of `only` when given."""
    payloads.use_contract(ctx.contract)
    ctx.code_version = getattr(ctx, 'code_version', None) or common.code_version()
    built = Built()
    infos = collections.OrderedDict()
    for mod_name in MODULES:
        mod = importlib.import_module(mod_name)
        res = mod.build(ctx, built) or {}
        for p, info in res.items():
            infos[p] = info
    loop_cfg = dict(ctx.case.get('loop_config') or {})
    loop_cfg.update({'mode': ctx.mode, 'case': ctx.case.get('case'), 'contract': ctx.contract['version'],
                     'built_at': common.iso_utc(ctx.now)})
    runs = [run_entry(ctx, 'loop', loop_cfg, parent=None)]
    for p, info in infos.items():
        if info.get('emitted', 0) or info.get('always'):
            ent = run_entry(ctx, p, info.get('config') or {})
            if info.get('close'):
                ent['close'] = info['close']          # runs that are opened and closed at once (time_rule_gate)
            runs.append(ent)
    if only:
        keep = set(only)
        for f in built.files:
            built.files[f] = [ln for ln in built.files[f] if ln.get('p_run_id', '')[5:] in keep]
        runs = [r for r in runs if r['args']['p_pass'] in keep or r['key'] == 'run:loop']
    built.runs = runs
    built.infos = infos
    return built


def write_built(ctx, built, user_id):
    out = ctx.out
    out.mkdir(parents=True, exist_ok=True)
    counts = collections.OrderedDict()
    for f, lines in built.files.items():
        path = out / f
        if lines:
            counts[f] = common.write_jsonl(path, lines)
        elif path.exists():
            path.unlink()
    run_json = {
        'config': {
            'user_id': user_id, 'mode': ctx.mode, 'case': ctx.case.get('case'),
            'vehicle_id': ctx.vid(ctx.case.get('vehicle')), 'scope_vehicle_ids':
                [ctx.vid(v) for v in ctx.case.get('scope_vehicles') or []],
            'window': ctx.case.get('window'), 'built_at': common.iso_utc(ctx.now), 'code_version': ctx.code_version,
            'contract': ctx.contract['version'],
            'placeholders': {'@config.user_id': 'this config.user_id', '@run:<pass>': 'evidence_open_run id',
                             '@key:<line key>': 'the id the writer returned for that line',
                             '@amount:<source>:<ref>': 'money.Sources.cents at load time (pinned source)'},
            'load_order': [f for f, _w in payloads.C['files'] if f in counts],
            'counts': counts,
            'pass_counts': {p: i.get('counts', {}) for p, i in built.infos.items()},
        },
        'runs': built.runs,
    }
    common.dump_json(out / 'run.json', run_json)
    return counts


def pass_main(pass_names, doc):
    """CLI for one pass module: builds every pass (so keys resolve) and writes only this module's lines."""
    ap = argparse.ArgumentParser(description=doc.split('\n')[0])
    ap.add_argument('--case', required=True, help='local case file (never in the repo)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--user', help='owner uuid (else EVIDENCE_OWNER_ID or the loop config)')
    a = ap.parse_args()
    ctx = common.Context(a.case, a.out, user_id=common.owner_id(a.user))
    built = build_all(ctx, only=pass_names)
    counts = write_built(ctx, built, ctx.user_id)
    for f, n in counts.items():
        print('%-34s %6d' % (f, n))
    for n in ctx.notes:
        print('note: ' + n)


if __name__ == '__main__':
    sys.exit('run a pass_*.py module or loop.py')
