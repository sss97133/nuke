"""File-mode model of the v3 readers (draft.sql M1w 2.5): vehicle_accounting_evidence and the day records it reads,
computed over a payload directory instead of the store. Line keys stand in for row ids.

It follows the SQL: identity = the vehicle plus one hop of confirmed same_vehicle_as; candidate status = the latest
owner decision, else confirmed_by_album_map, else proposed; one effective day per image (confirmed capture time,
else the combined row's day, else the earliest pass day); custody from the best non-rejected acquisition and sale
claims; payment-level status per payment_key (owner decision, placed_elsewhere, contested, disputed, then the
confidence band); asserted_unpaid; money_received; open questions. Capture times are confirmed the way the writer
confirms them (check:photos_exif_join). Owner decisions can be supplied as a list ({"target": <key>, "decision":
confirmed|rejected, "by": "agent"|"human", "reassign_to": <key>}) to read the confirmed level. Amounts are not read
(cents are null), so over_allocated is not evaluated here.

extract_m5() is PLAN section 6 M5 (the exit-test extraction), shared by file and db mode.
"""
import collections

import common
import payloads

BANDS_SUMMED = ('confirmed', 'high', 'med', 'low')


class Store:
    def __init__(self, files, decisions=None):
        C = payloads.C
        self.cands = [ln for f in ('candidates.photos_album.jsonl', 'candidates.combined.jsonl',
                                   'candidates.listing_class.jsonl') for ln in files.get(f, [])]
        self.times = files.get('time_claims.jsonl', [])
        self.links = [ln for f in ('links.album.jsonl', 'links.jsonl') for ln in files.get(f, [])]
        self.claims = files.get('change_claims.jsonl', [])
        self.extra_support = files.get('claim_support.jsonl', [])
        self.entities = files.get('account_entities.jsonl', [])
        self.dec = {}
        seq = 0
        for d in decisions or []:
            seq += 1
            self.dec[d['target']] = (d['decision'], d.get('by', 'agent'), seq)
            if d.get('reassign_to') and d['decision'] == 'rejected':
                seq += 1
                self.dec[d['reassign_to']] = ('confirmed', d.get('by', 'agent'), seq)
        self.allowed = C['allowed_offset_hours']

    def status(self, key):
        d = self.dec.get(key)
        return d[0] if d else 'proposed'

    def time_confirmed(self, ln):
        if ln['key'] in self.dec:
            return self.dec[ln['key']][0] == 'confirmed'
        r = ln['row']
        if r.get('rule') != 'photos_exif_join' or not (r.get('witness') or {}).get('unique_match'):
            return False
        if not r.get('stored_taken_at'):
            return False
        off = payloads.whole_hour_offset(r['stored_taken_at'], r['corrected_taken_at'])[0]
        return off == r.get('offset_seconds') and off % 3600 == 0 and abs(off) // 3600 in self.allowed


def identity_set(st, vehicle):
    ids = {vehicle}
    for ln in st.claims:
        c = ln['p_claim']
        if c['kind'] == 'same_vehicle_as' and st.status(ln['key']) == 'confirmed' and \
                (c['vehicle_id'] in ids or c.get('related_vehicle_id') in ids):
            ids |= {c['vehicle_id'], c['related_vehicle_id']}
    return ids


def claim_support(st, key):
    ln = next((x for x in st.claims if x['key'] == key), None)
    sup = list(ln.get('p_support') or []) if ln else []
    for x in st.extra_support:
        if x['p_claim_id'][5:] == key:
            sup += x['p_support']
    return [{'kind': s['evidence_kind'], 'id': s['evidence_id'][5:] if str(s['evidence_id']).startswith('@key:')
             else s['evidence_id'], 'stance': s['stance'], 'about': s.get('about', 'other'),
             'weight': s.get('weight', 1)} for s in sup]


def custody(st, ids):
    ks = [(ln, st.status(ln['key'])) for ln in st.claims if ln['p_claim']['vehicle_id'] in ids
          and ln['p_claim']['kind'] in ('acquisition', 'sale')]

    def best(kind):
        live = [(ln, s) for ln, s in ks if ln['p_claim']['kind'] == kind and s != 'rejected']
        live.sort(key=lambda x: (x[1] != 'confirmed', -x[0]['p_claim']['confidence']))
        return live[0] if live else (None, None)
    acq, acq_st = best('acquisition')
    sal, sal_st = best('sale')
    status = 'unknown' if acq is None else (
        'confirmed' if acq_st == 'confirmed' and (sal_st or 'confirmed') == 'confirmed' else 'proposed')
    return {'from': acq['p_claim'].get('occurred_from') if acq else None,
            'to': (sal['p_claim'].get('occurred_to') or sal['p_claim'].get('occurred_from')) if sal else None,
            'acquisition_claim': acq['key'] if acq else None, 'sale_claim': sal['key'] if sal else None,
            'status': status}


def candidates_for_images(st, image_ids):
    cs = [ln for ln in st.cands if ln['row']['image_id'] in image_ids]
    album_ok = {}
    for ln in st.links:
        if ln['row'].get('source_kind') == 'photos_album' and st.status(ln['key']) == 'confirmed':
            album_ok[ln['key']] = ln['row'].get('vehicle_id')
    tdays = collections.defaultdict(list)
    for ln in st.times:
        if ln['row']['image_id'] in image_ids and st.time_confirmed(ln):
            tdays[ln['row']['image_id']].append(ln['row']['captured_on'])
    per = collections.defaultdict(list)
    for ln in cs:
        per[ln['row']['image_id']].append(ln)
    out = []
    for iid, lns in per.items():
        comb = [ln['row'].get('pass_captured_on') for ln in lns if ln['p_run_id'] == '@run:combined'
                and ln['row'].get('pass_captured_on')]
        anyd = [ln['row'].get('pass_captured_on') for ln in lns if ln['row'].get('pass_captured_on')]
        day = min(tdays[iid]) if tdays.get(iid) else (min(comb) if comb else (min(anyd) if anyd else None))
        for ln in lns:
            r = ln['row']
            s = st.status(ln['key'])
            if s == 'proposed' and r.get('album_link_id'):
                lk = r['album_link_id'][5:]
                if lk in album_ok and album_ok[lk] == r.get('vehicle_id') and not any(
                        o['row'].get('vehicle_id') == r.get('vehicle_id') and st.status(o['key']) == 'rejected'
                        and st.dec[o['key']][1] in ('agent', 'human') for o in lns):
                    s = 'confirmed_by_album_map'
            out.append(dict(r, id=ln['key'], pass_=ln['p_run_id'][5:], status=s, captured_on=day,
                            time_unverified=not tdays.get(iid)))
    return out


def day_records(st, ids, cust, win=('1900-01-01', '2999-12-31')):
    imgs = {ln['row']['image_id'] for ln in st.cands if ln['row'].get('vehicle_id') in ids}
    cand = [c for c in candidates_for_images(st, imgs) if c.get('vehicle_id') in ids and c['captured_on']
            and win[0] <= c['captured_on'] <= win[1] and c['status'] != 'rejected'
            and c['verdict'] in ('is_vehicle', 'listing_evidence')
            and (c['pass_'] in ('combined', 'owner_review') or c['status'] in ('confirmed', 'confirmed_by_album_map'))]
    days = collections.defaultdict(lambda: collections.defaultdict(set))
    for c in cand:
        own = c.get('image_class', 'own') == 'own'
        subj = c.get('frame_role', 'subject') == 'subject'
        d = days[c['captured_on']]
        if own and subj:
            d['own'].add(c['image_id'])
            if c['status'] == 'confirmed':
                d['confirmed'].add(c['image_id'])
            if c['status'] == 'confirmed_by_album_map':
                d['album'].add(c['image_id'])
            if c['status'] == 'proposed' and c['confidence'] >= 0.85:
                d['high'].add(c['image_id'])
            if c['status'] == 'proposed' and c['confidence'] < 0.85:
                d['other'].add(c['image_id'])
            if c['time_unverified']:
                d['tu'].add(c['image_id'])
        if own and not subj:
            d['also'].add(c['image_id'])
        cls = c.get('image_class', 'own')
        if cls in ('third_party', 'listing', 'document'):
            d[cls].add(c['image_id'])
    out = []
    for day in sorted(days):
        d = days[day]
        inc = None if not cust['from'] else (cust['from'] <= day <= (cust['to'] or '9999-12-31'))
        out.append({'day': day, 'in_custody': inc, 'own_photos': len(d['own']), 'own_photos_confirmed': len(d['confirmed']),
                    'own_photos_album': len(d['album']), 'own_photos_proposed_high': len(d['high']),
                    'own_photos_proposed_other': len(d['other']), 'also_in_frame_photos': len(d['also']),
                    'third_party_photos': len(d['third_party']), 'listing_photos': len(d['listing']),
                    'document_photos': len(d['document']), 'time_unverified': len(d['tu'])})
    return out


def accounting(files, vehicle, decisions=None, date_from=None, date_to=None):
    """vehicle_accounting_evidence(vehicle, from, to) over payload files."""
    st = Store(files, decisions)
    ids = identity_set(st, vehicle)
    win = (date_from or '1900-01-01', date_to or '2999-12-31')
    cust = custody(st, ids)
    mapped = {ln['row']['account_ref']: ln['row']['entity_key'] for ln in st.entities
              if st.status(ln['key']) == 'confirmed'}
    claims = []
    for ln in st.claims:
        c = ln['p_claim']
        if c['vehicle_id'] in ids:
            claims.append(dict(c, id=ln['key'], status=st.status(ln['key']), support=claim_support(st, ln['key'])))
    live = [c for c in claims if c['status'] != 'rejected']
    links = []
    for ln in st.links:
        r = ln['row']
        if r.get('vehicle_id') in ids and (r.get('occurred_on') is None or win[0] <= r['occurred_on'] <= win[1]):
            d = st.dec.get(ln['key'])
            links.append(dict(r, id=ln['key'], source_key=payloads.source_key(
                r.get('source_table'), r.get('source_row_id'), r.get('external_ref'), r.get('anchor')),
                owner_decision=d[0] if d else None, decided_at=d[2] if d else None,
                status=d[0] if d else 'proposed',
                payer=r.get('payer_entity') or mapped.get(r.get('from_account_ref')),
                payee=r.get('payee_entity') or mapped.get(r.get('to_account_ref'))))
    keyed = [l for l in links if l.get('payment_key') and l['role'] in ('payment_out', 'payment_in', 'assertion',
                                                                         'contradicts')]
    keys = sorted({l['payment_key'] for l in keyed})
    outside = {}
    for ln in st.links:
        r = ln['row']
        if r.get('payment_key') in keys and r.get('vehicle_id') and r['vehicle_id'] not in ids:
            o = outside.setdefault(r['payment_key'], {'placed': False, 'shared': False, 'unalloc': False, 'veh': set()})
            dec = st.status(ln['key'])
            if r['role'] != 'contradicts':
                o['placed'] |= dec == 'confirmed'
                o['shared'] |= dec != 'rejected'
                o['unalloc'] |= dec != 'rejected' and r.get('allocated_cents') is None
            o['veh'].add(r['vehicle_id'])
    banded = []
    for k in keys:
        ks = [l for l in keyed if l['payment_key'] == k]
        decs = [(l['decided_at'], 'rejected' if l['role'] == 'contradicts' else l['owner_decision']) for l in ks
                if (l['role'] != 'contradicts' and l['owner_decision']) or
                (l['role'] == 'contradicts' and l['owner_decision'] == 'confirmed')]
        owner_dec = max(decs)[1] if decs else None
        disputed = any(l['role'] == 'contradicts' and l['status'] != 'rejected' for l in ks)
        confs = [l['confidence'] for l in ks if l['role'] != 'contradicts']
        best = max(confs) if confs else None
        allocated = next((l.get('allocated_cents') for l in ks if l.get('allocated_cents') is not None), None)
        o = outside.get(k) or {}
        if owner_dec == 'confirmed':
            b = 'confirmed'
        elif owner_dec == 'rejected':
            b = 'rejected'
        elif o.get('placed'):
            b = 'placed_elsewhere'
        elif o.get('unalloc') or (allocated is None and o.get('shared')):
            b = 'contested'
        elif disputed:
            b = 'disputed'
        elif best is not None and best >= 0.85:
            b = 'high'
        elif best is not None and best >= 0.5:
            b = 'med'
        else:
            b = 'low'
        first = lambda f: next((l[f] for l in ks if l.get(f)), None)  # noqa: E731
        banded.append({'payment_key': k, 'b': b, 'is_in': any(l['role'] == 'payment_in' for l in ks),
                       'is_out': any(l['role'] in ('payment_out', 'assertion') for l in ks),
                       'category': first('cost_category'), 'payer': first('payer'), 'payee': first('payee'),
                       'from_account_ref': first('from_account_ref'), 'to_account_ref': first('to_account_ref'),
                       'other_vehicles': sorted(o['veh']) if o.get('veh') else None,
                       'links': [{'link_id': l['id'], 'ref': l['source_key'], 'kind': l['source_kind'],
                                  'role': l['role'], 'label': l.get('source_label'), 'on': l.get('occurred_on'),
                                  'transaction_on': l.get('transaction_on'), 'status': l['status'],
                                  'confidence': l['confidence'],
                                  'payment_join_confidence': l.get('payment_join_confidence')} for l in ks]})
    unpaid = [l for l in links if not l.get('payment_key') and l['role'] in ('payment_out', 'assertion')
              and l.get('direction') == 'out' and l['status'] != 'rejected']
    costs = collections.OrderedDict()
    for b in sorted({x['b'] for x in banded if x['is_out'] and not x['is_in']}):
        ps = [x for x in banded if x['b'] == b and x['is_out'] and not x['is_in']]
        costs[b] = {'cents': None, 'payments': [{'payment_key': x['payment_key'], 'cents': None,
                                                 'category': x['category'], 'payer': x['payer'] or 'unknown',
                                                 'other_vehicles': x['other_vehicles'], 'links': x['links']}
                                                for x in sorted(ps, key=lambda x: x['payment_key'])]}
    if unpaid:
        costs['asserted_unpaid'] = {'cents': None, 'links': [
            {'link_id': l['id'], 'ref': l['source_key'], 'label': l.get('source_label'), 'on': l.get('occurred_on'),
             'category': l.get('cost_category'), 'status': l['status']} for l in sorted(unpaid, key=lambda l: l['source_key'])]}
    link_by_id = {l['id']: l for l in links}
    pay_ok = {x['payment_key']: x for x in banded}

    def backed(c, role, side):
        for s in c['support'] or []:
            l = link_by_id.get(s['id'])
            if s['kind'] == 'evidence_link' and s['stance'] == 'supports' and l and l['role'] == role:
                p = pay_ok.get(l.get('payment_key'))
                if p and p['b'] == 'confirmed' and (p[side] or 'unknown') != 'unknown':
                    return True
        return False

    oq = []
    for c in live:
        con = sorted({s['about'] for s in c['support'] if s['stance'] == 'contradicts'})
        if c['status'] == 'proposed' and con:
            oq.append({'q': 'contradiction', 'claim_id': c['id'], 'kind': c['kind'], 'about': con})
    oq += [{'q': 'payment_placement', 'payment_key': x['payment_key'], 'other_vehicles': x['other_vehicles']}
           for x in banded if x['b'] == 'contested']
    oq += [{'q': 'disputed_payment', 'payment_key': x['payment_key']} for x in banded if x['b'] == 'disputed']
    oq += [{'q': 'who_paid', 'claim_id': c['id'], 'kind': c['kind']} for c in live
           if c['kind'] == 'acquisition' and not backed(c, 'payment_out', 'payer')]
    oq += [{'q': 'who_received', 'claim_id': c['id'], 'kind': c['kind']} for c in live
           if c['kind'] == 'sale' and not backed(c, 'payment_in', 'payee')]
    oq += [{'q': 'unpaid_assertion', 'link_id': l['id'], 'ref': l['source_key'], 'label': l.get('source_label')}
           for l in unpaid if l['status'] == 'proposed']
    refs = sorted({r for l in links if l['status'] != 'rejected' for r in (l.get('from_account_ref'),
                                                                          l.get('to_account_ref')) if r})
    oq += [{'q': 'account_entity_unknown', 'account_ref': r} for r in refs if r not in mapped]
    if cust['status'] != 'confirmed':
        oq.append({'q': 'custody_window', 'status': cust['status']})
    work = [w for w in day_records(st, ids, cust, win) if w['own_photos'] > 0 or w['document_photos'] > 0]

    def claim_json(c):
        return {k: v for k, v in c.items() if k != 'user_id'}
    by_kind = lambda k: sorted((claim_json(c) for c in live if c['kind'] == k),  # noqa: E731
                               key=lambda c: (c['status'] != 'confirmed', -c['confidence']))
    return {
        'identity': sorted(ids),
        'window': {'from': date_from, 'to': date_to,
                   'basis': 'all evidence' if not date_from and not date_to else 'caller'},
        'custody': cust,
        'acquisition': by_kind('acquisition') or 'unknown',
        'sale': by_kind('sale') or 'unknown',
        'listings': [{'claim_id': c['id'], 'from': c.get('occurred_from'), 'to': c.get('occurred_to'),
                      'summary': c['summary'], 'status': c['status'], 'support': c['support']}
                     for c in sorted(live, key=lambda c: c.get('occurred_from') or '') if c['kind'] == 'listing'],
        'work_performed': [{'claim_id': c['id'], 'from': c.get('occurred_from'), 'to': c.get('occurred_to'),
                            'party': c.get('party_entity'), 'summary': c['summary'], 'status': c['status'],
                            'support': c['support']} for c in live if c['kind'] == 'work_performed'],
        'changes': [{'claim_id': c['id'], 'kind': c['kind'], 'from': c.get('occurred_from'), 'to': c.get('occurred_to'),
                     'summary': c['summary'], 'status': c['status'], 'confidence': c['confidence'],
                     'support': c['support']} for c in live
                    if c['kind'] not in ('acquisition', 'sale', 'listing', 'work_performed')],
        'work_days': 'unknown' if cust['status'] == 'unknown' else [
            {'day': w['day'], 'own_photos': w['own_photos'], 'confirmed': w['own_photos_confirmed'],
             'album_confirmed': w['own_photos_album'], 'time_unverified': w['time_unverified']}
            for w in work if w['in_custody'] and w['own_photos'] > 0],
        'work_days_custody': cust['status'],
        'photo_days_outside_custody': [{'day': w['day'], 'own_photos': w['own_photos'],
                                        'document_photos': w['document_photos'],
                                        'side': 'before' if w['day'] < (cust['from'] or '') else 'after'}
                                       for w in work if w['in_custody'] is False],
        'photo_days_custody_unknown': [w['day'] for w in work if w['in_custody'] is None],
        'costs': costs,
        'money_received': {
            'payments': [{'payment_key': x['payment_key'], 'band': x['b'], 'cents': None,
                          'payer': x['payer'] or 'unknown', 'payee': x['payee'] or 'unknown',
                          'from_account_ref': x['from_account_ref'], 'to_account_ref': x['to_account_ref'],
                          'other_vehicles': x['other_vehicles'], 'links': x['links']}
                         for x in banded if x['is_in']],
            'expected_from_sale': [{'sale_claim': c['id'], 'status': c['status'], 'cash_expected_cents': None,
                                    'trade_in_cents': c.get('trade_in_cents'),
                                    'trade_in_vehicle_id': c.get('related_vehicle_id'),
                                    'backed_by': [link_by_id[s['id']]['payment_key'] for s in c['support']
                                                  if s['kind'] == 'evidence_link' and s['stance'] == 'supports'
                                                  and s['id'] in link_by_id
                                                  and link_by_id[s['id']]['role'] == 'payment_in'
                                                  and link_by_id[s['id']]['status'] != 'rejected']}
                                   for c in live if c['kind'] == 'sale']},
        'shared_sources': [{'payment_key': x['payment_key'], 'band': x['b'], 'other_vehicles': x['other_vehicles']}
                           for x in banded if x['other_vehicles']],
        'open_questions': oq,
    }


def extract_m5(v):
    """PLAN section 6 M5 over a vehicle_accounting_evidence result (db or file), plus the claims' supports."""
    def arr(x):
        return x if isinstance(x, list) else []
    costs = v.get('costs') or {}
    return {
        'identity': v.get('identity'), 'custody': v.get('custody'),
        'work_days': [d['day'] for d in arr(v.get('work_days'))],
        'work_days_unknown': v.get('work_days') == 'unknown',
        'outside': [[d['day'], d['side'], d.get('document_photos')] for d in arr(v.get('photo_days_outside_custody'))],
        'custody_unknown_days': arr(v.get('photo_days_custody_unknown')),
        'bands': {b: [p.get('payment_key') or p.get('ref') for p in (costs[b].get('payments') or costs[b].get('links') or [])]
                  for b in costs},
        'band_links': {p['payment_key']: [l['ref'] for l in p.get('links') or []]
                       for b in costs for p in (costs[b].get('payments') or [])},
        'unpaid_labels': [x.get('label') for x in (costs.get('asserted_unpaid') or {}).get('links') or []],
        'unpaid_refs': [x.get('ref') for x in (costs.get('asserted_unpaid') or {}).get('links') or []],
        'work_performed': [[x.get('party'), x.get('from'), x.get('to')] for x in arr(v.get('work_performed'))],
        'listings': [[x.get('from'), x.get('to')] for x in arr(v.get('listings'))],
        'sale_trade_in': [x.get('trade_in_vehicle_id') for x in arr((v.get('money_received') or {}).get('expected_from_sale'))],
        'income': [[x.get('payment_key'), x.get('band'), x.get('from_account_ref'), x.get('payee')]
                   for x in arr((v.get('money_received') or {}).get('payments'))],
        'open_questions': arr(v.get('open_questions')),
        'claims': {c['id']: c for k in ('acquisition', 'sale') for c in arr(v.get(k))},
        'keys': sorted(v.keys()),
    }


def load_files(d):
    import checks
    return checks.load_dir(d)[1]


def read(d, vehicle, decisions=None):
    return accounting(load_files(d), vehicle, decisions)


if __name__ == '__main__':
    import argparse
    import json
    ap = argparse.ArgumentParser(description='file-mode vehicle_accounting_evidence over a payload dir')
    ap.add_argument('--dir', required=True)
    ap.add_argument('--vehicle', required=True)
    ap.add_argument('--decisions')
    a = ap.parse_args()
    dec = common.load_json(a.decisions) if a.decisions else None
    print(json.dumps(extract_m5(read(a.dir, a.vehicle, dec)), indent=1, default=str))
