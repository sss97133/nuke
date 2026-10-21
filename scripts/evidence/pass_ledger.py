"""Money passes over the pinned sources: ledger_vendor_date (the reviewed bank ledger) and pnl_allocation (the
P&L files that allocate payments to vehicles).

Placement only, never characterisation (OWNER-DECISIONS 5): a link says which payment (payment_key 'bank:<line id>')
the source shows, where it is placed, from which account to which, and on whose word. Roles payment_out /
payment_in; cost_category physical kinds only; source_label is the business name or role the line names (from the
case, never the line's free text: descriptions carry people's names and phone numbers). The card date of a card line
goes to transaction_on (v3, FM-16). Amounts are @amount placeholders resolved at load time.

ledger_vendor_date  one link per placement the case lists ({line_id, vehicle, source_label, cost_category, payee,
                    confidence, join_key, note}). The ledger is a payment source: its run records coverage_to (the
                    case's statement end, else the newest line date) with covers_accounts, the account refs whose
                    statements the export is (v5, readers v4 #3); with no covers_accounts it records no coverage.
                    (v6, RU4) closed_accounts: the accounts whose final statement the export is (a subset).
pnl_allocation      a link per allocation on the allocated vehicle, with the same payment_key (v3, ET2-1/ET2-9):
                    disposition rows cite a payment by its bank reference ('Bank payment<ref>'); job rows of the
                    independent P&L ledger carry '<job>-<line id>' ids. A job with no Nuke vehicle row is written with
                    subject_key 'label:<job>' (the reader then reads the payment contested, with the label in
                    other_vehicles). By default only payments the case already places are allocated. No coverage.
Payer and payee are third parties the source names, or NULL (v5): whose account it was comes from the account map.
"""
import os
import re

import common
import money
import payloads

PASSES = ['ledger_vendor_date', 'pnl_allocation']
BANK_REF = re.compile(r'Bank payment\s*([0-9A-Z]{10,14})')


def build(ctx, built):
    lcfg = ctx.pass_cfg('ledger_vendor_date')
    if not lcfg:
        return {}
    src = money.Sources(ctx)
    lname = lcfg['source']
    sha = src.sha256(lname)
    ledger_name = lcfg.get('ledger_name', 'ledger')
    account = lcfg['account_ref']
    placements = lcfg.get('lines') or []
    meta = src.ledger_lines(lname, [p['line_id'] for p in placements])
    n = 0
    placed = set()
    for p in placements:
        m = meta[p['line_id']]
        ext = 'ledger:%s:%s' % (ledger_name, p['line_id'])
        veh = ctx.vid(p['vehicle'])
        role = 'payment_out' if m['direction'] == 'out' else 'payment_in'
        ev = [{'kind': 'ledger', 'ref': '%s:%s' % (ledger_name, p['line_id']), 'file_sha256': sha}]
        ev += [dict(e) for e in lcfg.get('evidence') or []]
        if p.get('note'):
            ev.append({'kind': 'note', 'ref': p['note']})
        built.add('links.jsonl', payloads.line(
            payloads.link_key(payloads.source_key(external_ref=ext), veh), 'propose_evidence_links',
            'ledger_vendor_date', payloads.evidence_link(
                veh, 'ledger_line', role, p.get('join_key', 'vendor+date'), p['confidence'], ev, external_ref=ext,
                source_sha256=sha, source_label=p.get('source_label'), occurred_on=m['date'],
                transaction_on=m['card_date'], amount_cents=payloads.amount_ref(lname, p['line_id']),
                cost_category=p.get('cost_category'), counterparty_label=p.get('counterparty_label'),
                payment_key='bank:' + p['line_id'], payer_entity=p.get('payer_entity'),
                payee_entity=p.get('payee_entity'),
                from_account_ref=account if role == 'payment_out' else p.get('from_account_ref'),
                to_account_ref=p.get('to_account_ref') if role == 'payment_out' else account,
                summary=p.get('summary'))))
        placed.add(p['line_id'])
        n += 1
    lconf = {'ledger': ledger_name, 'ledger_sha256': sha, 'lines': n, 'payment_key': 'bank:<line id>',
             'account_ref': account, 'amounts': 'resolved at load time from the pinned file; never in these files'}
    if lcfg.get('covers_accounts'):
        lconf['coverage_to'] = lcfg.get('coverage_to') or src.newest_date(lname)
        lconf['covers_accounts'] = list(lcfg['covers_accounts'])
        if lcfg.get('closed_accounts'):
            lconf['closed_accounts'] = list(lcfg['closed_accounts'])   # (v6, RU4) the export is their final statement
        bad = payloads.coverage_problem('ledger_vendor_date', lconf, ctx.now.date())     # (v7, F7c) never the future
        if bad:
            raise common.EvidenceError('ledger_vendor_date: %s' % bad)
    else:
        ctx.note('ledger_vendor_date: no covers_accounts in the case; the run records no money coverage')
    res = {'ledger_vendor_date': {'emitted': n, 'config': lconf, 'counts': {'links': n}}}

    pcfg = ctx.pass_cfg('pnl_allocation')
    if not pcfg:
        return res
    only = pcfg.get('only_payments_in_case', True)
    na, skipped = 0, {'no_bank_ref': 0, 'payment_not_in_case': 0, 'asset_not_mapped': 0, 'job_not_mapped': 0}
    shas = {}
    for s in pcfg.get('sources') or []:
        name = s['name']
        shas[name] = src.sha256(name)
        fname = os.path.basename(src.path(name))
        if s['kind'] == 'disposition':
            for i, r in enumerate(src.rows(name)):
                mref = BANK_REF.search(r.get('evidence') or '')
                if not mref:
                    skipped['no_bank_ref'] += 1
                    continue
                ref = mref.group(1)
                line_id = src.ledger_line_by_ref(lname, ref)
                if not line_id or (only and line_id not in placed):
                    skipped['payment_not_in_case'] += 1
                    continue
                if r['asset'] not in (s.get('assets') or {}):
                    skipped['asset_not_mapped'] += 1
                    continue
                veh = ctx.vid(s['assets'][r['asset']])
                lm = src.ledger_lines(lname, [line_id])[line_id]
                ext = 'pnl:disposition:' + ref
                cat = next((c for word, c in (s.get('cost_category') or {}).items()
                            if word in (r.get('component') or '').lower()), None)
                built.add('links.jsonl', payloads.line(
                    payloads.link_key(payloads.source_key(external_ref=ext), veh), 'propose_evidence_links',
                    'pnl_allocation', payloads.evidence_link(
                        veh, 'pnl_line', 'payment_out', 'P&L allocation (%s)' % r['asset'], s.get('confidence', 0.7),
                        [{'kind': 'pnl', 'ref': fname, 'row': i + 1, 'bank_ref': ref, 'asset': r['asset'],
                          'file_sha256': shas[name]}],
                        external_ref=ext, source_sha256=shas[name], source_label=r.get('component'),
                        occurred_on=lm['date'], transaction_on=lm['card_date'],
                        amount_cents=payloads.amount_ref(name, ref), cost_category=cat,
                        payment_key='bank:' + line_id, from_account_ref=account,
                        summary='%s: %s' % (r['asset'], r.get('component') or ''))))
                na += 1
        elif s['kind'] == 'independent_ledger':
            jobs = s.get('jobs') or {}
            for r in src.rows(name):
                job = next((j for j in jobs if r.get('id', '').startswith(j + '-')), None)
                if job is None:
                    continue
                line_id = (r.get('bank_links') or '').split(';')[0].strip()
                if not line_id or (only and line_id not in placed):
                    skipped['payment_not_in_case'] += 1
                    continue
                spec = jobs[job] if isinstance(jobs[job], dict) else {'vehicle': jobs[job]}
                veh = ctx.vid(spec.get('vehicle'))
                subject = None if veh else 'label:' + job
                ext = 'pnl:independent:' + r['id']
                ev = [{'kind': 'pnl', 'ref': fname, 'row': r['id'], 'job': job, 'file_sha256': shas[name]}]
                if not veh:
                    ev.append({'kind': 'note', 'ref': 'no Nuke vehicle row is identified for job %s' % job})
                built.add('links.jsonl', payloads.line(
                    payloads.link_key(payloads.source_key(external_ref=ext), veh, subject), 'propose_evidence_links',
                    'pnl_allocation', payloads.evidence_link(
                        veh, 'pnl_line', 'payment_out', 'P&L job allocation (%s)' % job, spec.get('confidence', 0.9),
                        ev, external_ref=ext, subject_key=subject, source_sha256=shas[name],
                        source_label=spec.get('source_label', job), occurred_on=r.get('date'),
                        amount_cents=payloads.amount_ref(lname, line_id), cost_category=spec.get('cost_category'),
                        payment_key='bank:' + line_id, from_account_ref=account,
                        summary=spec.get('summary', 'P&L places this payment on job %s' % job))))
                na += 1
        else:
            raise common.EvidenceError('pnl_allocation: unknown source kind %s' % s['kind'])
    res['pnl_allocation'] = {'emitted': na, 'config': {
        'sources': [{'name': s['name'], 'kind': s['kind'], 'sha256': shas.get(s['name'])} for s in pcfg['sources']],
        'rule': 'an allocation in a pinned source creates a link on the allocated vehicle with the same payment_key',
        'only_payments_in_case': only},
        'counts': {'links': na, 'skipped': skipped}}
    return res


if __name__ == '__main__':
    import passlib
    passlib.pass_main(PASSES, __doc__)
