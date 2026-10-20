"""File-mode model of the v8 readers (draft.sql M1w 2.5): vehicle_accounting_evidence and the day records it reads,
computed over a payload directory instead of the store. Line keys stand in for row ids; the payload is one owner's,
so the v5 user filter (p_user_id) is the directory itself. (v8) Reader shapes are v6's; every decision is his.

It follows the SQL: identity = the vehicle plus the confirmed same_vehicle_as pairs, closed transitively (bounded);
candidate status = the latest owner decision, else confirmed_by_album_map, else proposed; one effective day per image
(confirmed capture time, else the combined row's day, else the earliest pass day); custody from the best
non-rejected acquisition and sale claims (confirmed first, then sourced before custody_bounds' upper bounds, then a
start date, then confidence, then the newest), 'unknown' with acquired_by when the window has no start; a day after a
dated sale is outside custody even when the start is unknown; payment-level status per payment_key (owner decision,
placed_elsewhere, contested (a subject_key placement included), disputed, then the confidence band); a payment is
dated by its payment source (paid_on) and a windowed read selects payments by that date; asserted_unpaid with
awaiting_statement after the coverage of the assertion's own account (else the oldest coverage); money_received;
open questions. (v6) A windowed read bands only payments dated in the window and lists undated ones apart
(payments_undated); a closed account (closed_accounts) is complete and an account his map gives to a third party is not
his, so coverage counts his open accounts, an awaiting assertion names the accounts it waits on and a lagging open
account is asked about (money_source_behind); work sessions are his own. (v7) "Closed" is the newest covering run's
word; an assertion naming an account no run covers waits on that account (money_source_missing); his confirmed
who-paid statement closes who_paid / who_received; a photo he said was on the wrong day reads undated until a time is
confirmed. Capture times are confirmed the way the writer confirms them (check:photos_exif_join). His decisions can be
supplied as a list ({"target": <key>, "decision": confirmed|rejected, "reassign_to": <key>}) to read the confirmed
level (a what-if in file mode: in the store only he decides). Amounts are not read (cents are null), so
over_allocated is not evaluated here.

extract_m5() is PLAN section 6 M5 (the exit-test extraction), shared by file and db mode.
"""
import collections

import payloads

BANDS_SUMMED = ('confirmed', 'high', 'med', 'low')
PAYMENT_SOURCES = ('bank_line', 'ledger_line', 'payment_event', 'qb_transaction')
IDENTITY_DEPTH = 8


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
        self.runs = (files.get('run.json') or {}).get('runs') or []
        self.order = {}
        for i, ln in enumerate(self.claims + self.links):
            self.order[ln['key']] = i                    # file order stands in for created_at
        self.dec = {}
        seq = 0
        for d in decisions or []:                        # (v8) every decision is his ('human')
            seq += 1
            self.dec[d['target']] = (d['decision'], d.get('by', 'human'), seq)
            if d.get('reassign_to') and d['decision'] == 'rejected':
                seq += 1
                self.dec[d['reassign_to']] = ('confirmed', d.get('by', 'human'), seq)
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

    def coverage(self):
        """{account_ref: newest coverage_to} over the runs that record coverage (v5, readers v4 #3), and the accounts
        recorded closed (v6, RU4: their final statement was read; (v7, F7b) the word of the newest run covering the
        account, so a later export that is not final reopens it). Run order in run.json stands in for started_at."""
        out, newest_word = {}, {}
        for r in self.runs:
            cfg = (r.get('args') or {}).get('p_config') or {}
            if not cfg.get('coverage_to'):
                continue
            for acct in cfg.get('covers_accounts') or []:
                out[acct] = max(out.get(acct, ''), cfg['coverage_to'])
                newest_word[acct] = acct in (cfg.get('closed_accounts') or [])
        return out, {a for a, closed in newest_word.items() if closed}


def identity_set(st, vehicle):
    """The vehicle and every vehicle the confirmed same_vehicle_as pairs join to it, transitively (depth <= 8)."""
    edges = collections.defaultdict(set)
    for ln in st.claims:
        c = ln['p_claim']
        if c['kind'] == 'same_vehicle_as' and st.status(ln['key']) == 'confirmed' and c.get('vehicle_id') and \
                c.get('related_vehicle_id'):
            edges[c['vehicle_id']].add(c['related_vehicle_id'])
            edges[c['related_vehicle_id']].add(c['vehicle_id'])
    ids, frontier = {vehicle}, {vehicle}
    for _ in range(IDENTITY_DEPTH):
        frontier = {b for a in frontier for b in edges[a]} - ids
        if not frontier:
            break
        ids |= frontier
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


def bound_only(ln):
    return ln.get('p_run_id') == '@run:custody_bounds'


def custody(st, ids):
    ks = [(ln, st.status(ln['key'])) for ln in st.claims if ln['p_claim'].get('vehicle_id') in ids
          and ln['p_claim']['kind'] in ('acquisition', 'sale')]

    def best(kind):
        live = [(ln, s) for ln, s in ks if ln['p_claim']['kind'] == kind and s != 'rejected']
        if kind == 'acquisition':
            live.sort(key=lambda x: (x[1] != 'confirmed', bound_only(x[0]), x[0]['p_claim'].get('occurred_from') is None,
                                     -x[0]['p_claim']['confidence'], -st.order.get(x[0]['key'], 0)))
        else:
            live.sort(key=lambda x: (x[1] != 'confirmed', bound_only(x[0]), -x[0]['p_claim']['confidence'],
                                     -st.order.get(x[0]['key'], 0)))
        return live[0] if live else (None, None)
    acq, acq_st = best('acquisition')
    sal, sal_st = best('sale')
    frm = acq['p_claim'].get('occurred_from') if acq else None
    if acq is None or frm is None:
        status = 'unknown'
    elif acq_st == 'confirmed' and (sal_st or 'confirmed') == 'confirmed':
        status = 'confirmed'
    else:
        status = 'proposed'
    return {'from': frm,
            'acquired_by': acq['p_claim'].get('occurred_to') if acq and frm is None else None,
            'to': (sal['p_claim'].get('occurred_to') or sal['p_claim'].get('occurred_from')) if sal else None,
            'acquisition_claim': acq['key'] if acq else None, 'sale_claim': sal['key'] if sal else None,
            'status': status}


def candidates_for_images(st, image_ids):
    """evidence_candidates_for_images: one effective day per image (a confirmed capture time, else the combined row's
    day, else the earliest pass day), (v7, F1) undated while that pass day is a day his own word rejected for the
    photo; status his decision, else confirmed_by_album_map (his confirmed album, no rejection of his of that truck for
    the photo), else proposed."""
    cs = [ln for ln in st.cands if ln['row']['image_id'] in image_ids]
    album_ok = {}
    for ln in st.links:
        if ln['row'].get('source_kind') == 'photos_album' and st.status(ln['key']) == 'confirmed':
            album_ok[ln['key']] = ln['row'].get('vehicle_id')
    tdays, no_days = collections.defaultdict(list), collections.defaultdict(set)
    for ln in st.times:
        if ln['row']['image_id'] not in image_ids:
            continue
        if st.time_confirmed(ln):
            tdays[ln['row']['image_id']].append(ln['row']['captured_on'])
        elif ln['key'] in st.dec and st.dec[ln['key']][0] == 'rejected' and st.dec[ln['key']][1] == 'human':
            no_days[ln['row']['image_id']].add(ln['row']['captured_on'])
    per = collections.defaultdict(list)
    for ln in cs:
        per[ln['row']['image_id']].append(ln)
    out = []
    for iid, lns in per.items():
        comb = [ln['row'].get('pass_captured_on') for ln in lns if ln['p_run_id'] == '@run:combined'
                and ln['row'].get('pass_captured_on')]
        anyd = [ln['row'].get('pass_captured_on') for ln in lns if ln['row'].get('pass_captured_on')]
        pass_day = min(comb) if comb else (min(anyd) if anyd else None)
        day = min(tdays[iid]) if tdays.get(iid) else (None if pass_day in no_days.get(iid, ()) else pass_day)
        for ln in lns:
            r = ln['row']
            s = st.status(ln['key'])
            if s == 'proposed' and r.get('album_link_id'):
                lk = r['album_link_id'][5:]
                if lk in album_ok and album_ok[lk] == r.get('vehicle_id') and not any(
                        o['row'].get('vehicle_id') == r.get('vehicle_id') and st.status(o['key']) == 'rejected'
                        and st.dec[o['key']][1] == 'human' for o in lns):
                    s = 'confirmed_by_album_map'
            out.append(dict(r, id=ln['key'], pass_=ln['p_run_id'][5:], status=s, captured_on=day,
                            time_unverified=not tdays.get(iid)))
    return out


def _counted(c):
    return c['status'] != 'rejected' and c['verdict'] in ('is_vehicle', 'listing_evidence') and (
        c['pass_'] in ('combined', 'owner_review') or c['status'] in ('confirmed', 'confirmed_by_album_map'))


def in_custody(cust, day):
    """get_vehicle_day_records (v5, readers v4 #9): a day after a dated sale is outside even with no start."""
    if cust.get('to') and day > cust['to']:
        return False
    if not cust.get('from'):
        return None
    return cust['from'] <= day <= (cust.get('to') or '9999-12-31')


def day_records(st, ids, cust, win=('1900-01-01', '2999-12-31'), sessions=None):
    imgs = {ln['row']['image_id'] for ln in st.cands if ln['row'].get('vehicle_id') in ids}
    cand = [c for c in candidates_for_images(st, imgs) if c.get('vehicle_id') in ids and c['captured_on']
            and win[0] <= c['captured_on'] <= win[1] and _counted(c)]
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
    items = collections.Counter()
    for ln in st.links:
        r = ln['row']
        if r.get('vehicle_id') in ids and r.get('source_kind') == 'photos_item' and r.get('occurred_on') and \
                win[0] <= r['occurred_on'] <= win[1] and st.status(ln['key']) != 'rejected':
            items[r['occurred_on']] += 1
    sess = collections.defaultdict(list)
    for s in sessions or []:
        if s.get('vehicle_id', next(iter(ids))) in ids and win[0] <= s['day'] <= win[1]:
            sess[s['day']].append(s['id'])
    out = []
    for day in sorted(set(days) | set(items) | set(sess)):
        d = days[day]
        out.append({'day': day, 'in_custody': in_custody(cust, day), 'own_photos': len(d['own']),
                    'own_photos_confirmed': len(d['confirmed']), 'own_photos_album': len(d['album']),
                    'own_photos_proposed_high': len(d['high']), 'own_photos_proposed_other': len(d['other']),
                    'also_in_frame_photos': len(d['also']), 'third_party_photos': len(d['third_party']),
                    'listing_photos': len(d['listing']), 'document_photos': len(d['document']),
                    'time_unverified': len(d['tu']), 'sessions': len(sess.get(day, [])),
                    'session_ids': sess.get(day) or None, 'photos_items_not_in_nuke': items.get(day, 0)})
    return out


def accounting(files, vehicle, decisions=None, date_from=None, date_to=None, sessions=None):
    """vehicle_accounting_evidence(vehicle, from, to, user) over payload files (v8)."""
    st = Store(files, decisions)
    ids = identity_set(st, vehicle)
    win = (date_from or '1900-01-01', date_to or '2999-12-31')
    cust = custody(st, ids)
    # (v4) a confirmed 'unknown' mapping ("no idea whose") is not mapped
    mapped = {ln['row']['account_ref']: ln['row']['entity_key'] for ln in st.entities
              if st.status(ln['key']) == 'confirmed' and ln['row']['entity_key'] != 'unknown'}
    cov_acct, closed = st.coverage()
    # (v6, RU4) the accounts that could still be missing a payment: open, and not a third party's by his confirmed map
    cov_open = {a: d for a, d in cov_acct.items()
                if a not in closed and not (mapped.get(a) or '').startswith('third_party:')}
    cov = min(cov_open.values()) if cov_open else None
    newest = max(cov_open.values()) if cov_open else None
    windowed = bool(date_from or date_to)
    claims = []
    for ln in st.claims:
        c = ln['p_claim']
        if c.get('vehicle_id') in ids:
            claims.append(dict(c, id=ln['key'], status=st.status(ln['key']), support=claim_support(st, ln['key']),
                               _bound=bound_only(ln)))
    live = [c for c in claims if c['status'] != 'rejected']

    def link_rec(ln):
        r = ln['row']
        d = st.dec.get(ln['key'])
        status = d[0] if d else 'proposed'
        return dict(r, id=ln['key'], source_key=payloads.source_key(
            r.get('source_table'), r.get('source_row_id'), r.get('external_ref'), r.get('anchor')),
            owner_decision=d[0] if d else None, decided_at=d[2] if d else None, status=status,
            payer=r.get('payer_entity') or mapped.get(r.get('from_account_ref')),
            payee=r.get('payee_entity') or mapped.get(r.get('to_account_ref')))
    links_all = [link_rec(ln) for ln in st.links if ln['row'].get('vehicle_id') in ids]
    links = [l for l in links_all if l.get('occurred_on') is None or win[0] <= l['occurred_on'] <= win[1]]
    # (v5, readers v4 #8) a payment is dated by its payment source: transaction_on first, else the posting date
    paid_on = {}
    for k in {l['payment_key'] for l in links_all if l.get('payment_key')}:
        ks = [l for l in links_all if l.get('payment_key') == k]
        src = [l.get('transaction_on') or l.get('occurred_on') for l in ks if l['source_kind'] in PAYMENT_SOURCES
               and (l.get('transaction_on') or l.get('occurred_on'))]
        anyd = [l['occurred_on'] for l in ks if l.get('occurred_on')]
        paid_on[k] = min(src) if src else (min(anyd) if anyd else None)

    def banded(d):
        """(v6, RU3) a windowed read bands only payments dated inside the window; an all-evidence read bands all."""
        return (d is not None and win[0] <= d <= win[1]) if windowed else True
    money_roles = ('payment_out', 'payment_in', 'assertion', 'contradicts')
    keyed = [l for l in links_all if l.get('payment_key') and l['role'] in money_roles and banded(paid_on[l['payment_key']])]
    outside_window = sorted({(l['payment_key'], paid_on[l['payment_key']]) for l in links if l.get('payment_key')
                             and paid_on[l['payment_key']] is not None
                             and not win[0] <= paid_on[l['payment_key']] <= win[1]})
    undated_pay = collections.Counter(l['payment_key'] for l in links_all if windowed and l.get('payment_key')
                                      and paid_on[l['payment_key']] is None and l['role'] in money_roles)
    keys = sorted({l['payment_key'] for l in keyed})
    outside = {}
    for ln in st.links:
        r = ln['row']
        if r.get('payment_key') not in keys:
            continue
        elsewhere = (r.get('vehicle_id') and r['vehicle_id'] not in ids) or (not r.get('vehicle_id') and r.get('subject_key'))
        if not elsewhere:
            continue
        o = outside.setdefault(r['payment_key'], {'placed': False, 'shared': False, 'unalloc': False, 'veh': set()})
        dec = st.status(ln['key'])
        if r['role'] != 'contradicts':
            o['placed'] |= dec == 'confirmed'
            o['shared'] |= dec != 'rejected'
            o['unalloc'] |= dec != 'rejected' and r.get('allocated_cents') is None
        o['veh'].add(r.get('vehicle_id') or r.get('subject_key'))
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
        # (v4) known parties only, owner-confirmed links first; (v5) never from a rejected link
        ranked = sorted((l for l in ks if l['status'] != 'rejected'),
                        key=lambda l: (l['status'] != 'confirmed', -l['confidence'], l['id']))
        cat = sorted((l for l in ks if l.get('cost_category')),
                     key=lambda l: l['source_kind'] not in ('bank_line', 'ledger_line'))
        banded.append({'payment_key': k, 'b': b, 'is_in': any(l['role'] == 'payment_in' for l in ks),
                       'is_out': any(l['role'] in ('payment_out', 'assertion') for l in ks),
                       'category': cat[0]['cost_category'] if cat else None,
                       'payer': next((l['payer'] for l in ranked if l.get('payer')), None),
                       'payee': next((l['payee'] for l in ranked if l.get('payee')), None),
                       'from_account_ref': first('from_account_ref'), 'to_account_ref': first('to_account_ref'),
                       'paid_on': paid_on[k],
                       'other_vehicles': sorted(o['veh']) if o.get('veh') else None,
                       # (v6, RU8) the read's order: by day (undated last), then source
                       'links': [{'link_id': l['id'], 'ref': l['source_key'], 'kind': l['source_kind'],
                                  'role': l['role'], 'label': l.get('source_label'), 'on': l.get('occurred_on'),
                                  'transaction_on': l.get('transaction_on'), 'status': l['status'],
                                  'confidence': l['confidence'],
                                  'payment_join_confidence': l.get('payment_join_confidence')}
                                 for l in sorted(ks, key=lambda l: (l.get('occurred_on') is None,
                                                                    l.get('occurred_on') or '', l['source_key'],
                                                                    l['id']))]})
    unpaid = []
    for l in links:
        if not l.get('payment_key') and l['role'] in ('payment_out', 'assertion') and l.get('direction') == 'out' \
                and l['status'] != 'rejected':
            acct, on = l.get('from_account_ref'), l.get('occurred_on')
            uncovered = bool(acct and cov_acct and acct not in cov_acct)
            if acct and acct in cov_acct:              # (v6, RU4) its own account: complete once closed
                waiting = acct not in closed and bool(on) and on > cov_acct[acct]
            elif uncovered:                            # (v7, F7a) an account no run covers: it waits on that account
                waiting = not (mapped.get(acct) or '').startswith('third_party:')
            else:                                      # else the oldest coverage of his open accounts
                waiting = bool(on and cov and on > cov)
            unpaid.append(dict(l, awaiting_statement=waiting, account_uncovered=uncovered,
                               waiting_on=[acct] if uncovered else sorted(
                                   a for a, d in cov_open.items() if on and d < on and (not acct or a == acct))))
    costs = collections.OrderedDict()
    for b in sorted({x['b'] for x in banded if x['is_out'] and not x['is_in']}):
        ps = [x for x in banded if x['b'] == b and x['is_out'] and not x['is_in']]
        costs[b] = {'cents': None, 'payments': [{'payment_key': x['payment_key'], 'cents': None,
                                                 'category': x['category'], 'paid_on': x['paid_on'],
                                                 'payer': x['payer'] or 'unknown',
                                                 'other_vehicles': x['other_vehicles'], 'links': x['links']}
                                                for x in sorted(ps, key=lambda x: x['payment_key'])]}
    if unpaid:
        costs['asserted_unpaid'] = {'cents': None, 'links': [
            {'link_id': l['id'], 'ref': l['source_key'], 'label': l.get('source_label'), 'on': l.get('occurred_on'),
             'category': l.get('cost_category'), 'status': l['status'], 'awaiting_statement': l['awaiting_statement']}
            for l in sorted(unpaid, key=lambda l: l['source_key'])]}
    link_by_id = {l['id']: l for l in links_all}
    pay_ok = {x['payment_key']: x for x in banded}

    def backed(c, role, side):
        """A supporting payment of his, confirmed, with a known party; or (v7, F5; v8) his own who-paid statement,
        which exists only on his decision in the app and closes the question while that decision stands."""
        for s in c['support'] or []:
            l = link_by_id.get(s['id'])
            if s['kind'] == 'evidence_link' and s['stance'] == 'supports' and l and l['role'] == role:
                p = pay_ok.get(l.get('payment_key'))
                if p and p['b'] == 'confirmed' and (p[side] or 'unknown') != 'unknown':
                    return True
                if l['source_kind'] == 'owner_statement' and l['status'] == 'confirmed' and l.get(side):
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
    # (v5, readers v4 #9) who_paid is not asked of a custody_bounds upper bound: no document backs it
    oq += [{'q': 'who_paid', 'claim_id': c['id'], 'kind': c['kind']} for c in live
           if c['kind'] == 'acquisition' and not c['_bound'] and not backed(c, 'payment_out', 'payer')]
    oq += [{'q': 'who_received', 'claim_id': c['id'], 'kind': c['kind']} for c in live
           if c['kind'] == 'sale' and not backed(c, 'payment_in', 'payee')]
    oq += [dict({'q': 'awaiting_statement' if l['awaiting_statement'] else 'unpaid_assertion', 'link_id': l['id'],
                 'ref': l['source_key'], 'label': l.get('source_label')},
                **({'waiting_on': l['waiting_on'] or None} if l['awaiting_statement'] else {}))
           for l in unpaid if l['status'] == 'proposed']
    # (v7, F7a) an account his assertions name that no run of his covers: is there an export to add?
    oq += [{'q': 'money_source_missing', 'account_ref': a} for a in sorted(
        {l['from_account_ref'] for l in unpaid if l['account_uncovered'] and l['awaiting_statement']})]
    refs = sorted({r for l in links if l['status'] != 'rejected' for r in (l.get('from_account_ref'),
                                                                          l.get('to_account_ref')) if r})
    oq += [{'q': 'account_entity_unknown', 'account_ref': r} for r in refs if r not in mapped]
    # (v6, RU4) an open account whose statements stop before his newest: closed, or is an export missing?
    oq += [{'q': 'money_source_behind', 'account_ref': a, 'coverage_to': d, 'newest_coverage': newest}
           for a, d in sorted(cov_open.items()) if d < newest]
    if cust['status'] != 'confirmed':
        oq.append({'q': 'custody_window', 'status': cust['status']})
    dayrec = day_records(st, ids, cust, win, sessions)
    work = [w for w in dayrec if w['own_photos'] > 0 or w['document_photos'] > 0]
    imgs = {ln['row']['image_id'] for ln in st.cands if ln['row'].get('vehicle_id') in ids}
    undated = {c['image_id'] for c in candidates_for_images(st, imgs) if c.get('vehicle_id') in ids
               and c['captured_on'] is None and c['status'] != 'rejected' and c['verdict'] == 'is_vehicle'
               and c.get('image_class', 'own') == 'own' and c.get('frame_role', 'subject') == 'subject'
               and (c['pass_'] in ('combined', 'owner_review') or c['status'] in ('confirmed', 'confirmed_by_album_map'))}

    def claim_json(c):
        return {k: v for k, v in c.items() if k not in ('user_id', '_bound')}
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
             'album_confirmed': w['own_photos_album'], 'time_unverified': w['time_unverified'],
             'sessions': w['sessions']}
            for w in work if w['in_custody'] and w['own_photos'] > 0],
        'work_days_custody': cust['status'],
        'photo_days_outside_custody': [{'day': w['day'], 'own_photos': w['own_photos'],
                                        'document_photos': w['document_photos'],
                                        'side': 'before' if cust['from'] and w['day'] < cust['from'] else 'after'}
                                       for w in work if w['in_custody'] is False],
        'photo_days_custody_unknown': [w['day'] for w in work if w['in_custody'] is None],
        'undated_own_photos': len(undated),
        'also_in_frame_days': [{'day': d['day'], 'photos': d['also_in_frame_photos'], 'in_custody': d['in_custody']}
                               for d in dayrec if d['also_in_frame_photos'] > 0],
        'session_days': [{'day': d['day'], 'sessions': d['sessions'], 'session_ids': d['session_ids'],
                          'in_custody': d['in_custody']} for d in dayrec if d['sessions'] > 0 and d['own_photos'] == 0],
        'photos_items_not_in_nuke': [{'day': d['day'], 'items': d['photos_items_not_in_nuke']} for d in dayrec
                                     if d['photos_items_not_in_nuke'] > 0],
        'money_sources_cover_to': cov,
        'money_sources_cover_to_by_account': cov_acct,
        'money_sources_closed': sorted(a for a in cov_acct if a in closed),
        'payments_outside_window': [{'payment_key': k, 'paid_on': d} for k, d in outside_window],
        'payments_undated': [{'payment_key': k, 'links': n} for k, n in sorted(undated_pay.items())],
        'costs': costs,
        'money_received': {
            'payments': [{'payment_key': x['payment_key'], 'band': x['b'], 'cents': None, 'paid_on': x['paid_on'],
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
    """PLAN section 6 M5 (v5 tuples) over a vehicle_accounting_evidence result (db or file), plus what the exit test
    reads by key: the claims with their supports, each payment's links and other vehicles, the read's keys."""
    def arr(x):
        return x if isinstance(x, list) else []
    costs = v.get('costs') or {}
    pays = [p for b in costs for p in (costs[b].get('payments') or [])] + \
        arr((v.get('money_received') or {}).get('payments'))
    return {
        'identity': v.get('identity'), 'custody': v.get('custody'),
        'work_days': [d['day'] for d in arr(v.get('work_days'))],
        'work_days_unknown': v.get('work_days') == 'unknown',
        'outside': [[d['day'], d['side'], d.get('own_photos'), d.get('document_photos')]
                    for d in arr(v.get('photo_days_outside_custody'))],
        'custody_unknown_days': arr(v.get('photo_days_custody_unknown')),
        'bands': {b: [p.get('payment_key') or p.get('ref') for p in (costs[b].get('payments') or costs[b].get('links') or [])]
                  for b in costs},
        'band_links': {p['payment_key']: [l['ref'] for l in p.get('links') or []] for p in pays},
        'other_vehicles': {p['payment_key']: p.get('other_vehicles') for p in pays},
        'unpaid_labels': [x.get('label') for x in (costs.get('asserted_unpaid') or {}).get('links') or []],
        'unpaid_refs': [x.get('ref') for x in (costs.get('asserted_unpaid') or {}).get('links') or []],
        'work_performed': [[x.get('party'), x.get('from'), x.get('to')] for x in arr(v.get('work_performed'))],
        'listings': [[x.get('from'), x.get('to')] for x in arr(v.get('listings'))],
        'sale_trade_in': [x.get('trade_in_vehicle_id') for x in arr((v.get('money_received') or {}).get('expected_from_sale'))],
        'income': [[x.get('payment_key'), x.get('band'), x.get('from_account_ref'), x.get('to_account_ref'),
                    x.get('payer'), x.get('payee')] for x in arr((v.get('money_received') or {}).get('payments'))],
        'undated_own_photos': v.get('undated_own_photos'), 'cover_to': v.get('money_sources_cover_to'),
        'payments_undated': [x.get('payment_key') for x in arr(v.get('payments_undated'))],
        'open_questions': arr(v.get('open_questions')),
        'claims': {c['id']: c for k in ('acquisition', 'sale') for c in arr(v.get(k))},
        'keys': sorted(v.keys()),
    }


def sessions_of(ctx):
    """His work sessions read for the case vehicle, as the day reader takes them ((v6, RU2) the reading user's own:
    inputs.work_sessions leaves out the rest)."""
    import inputs
    if not ctx.input_path('work_sessions'):
        return None
    veh = ctx.vid(ctx.case.get('vehicle'))
    return [{'id': s['id'], 'day': s['session_date'], 'vehicle_id': s.get('vehicle_id') or veh}
            for s in inputs.work_sessions(ctx) if s.get('session_date')]


def load_files(d):
    """The payload files plus run.json (the readers take money coverage from its run configs)."""
    import checks
    run, files = checks.load_dir(d)
    files['run.json'] = run
    return files


def read(d, vehicle, decisions=None):
    return accounting(load_files(d), vehicle, decisions)


if __name__ == '__main__':
    import argparse
    import json

    import common
    ap = argparse.ArgumentParser(description='file-mode vehicle_accounting_evidence over a payload dir')
    ap.add_argument('--dir', required=True)
    ap.add_argument('--vehicle', required=True)
    ap.add_argument('--decisions')
    a = ap.parse_args()
    dec = common.load_json(a.decisions) if a.decisions else None
    print(json.dumps(extract_m5(read(a.dir, a.vehicle, dec)), indent=1, default=str))
