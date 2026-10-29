#!/usr/bin/env python3
"""Check: every linked deduction is money out and every linked revenue is money in (v_books_direction_links, v_books_direction_checks, R11).

Read-only: every statement runs as the service role in a transaction that is rolled back. Three parts:
  1. unit test   the views' own SQL (from the migration file) over synthetic rows: a decision is tied to a movement of any register by its own
                 bank_links, by the movement's link back to it, or both; it fails only when no tied movement goes the right way; a card-funding or
                 hold leg beside a right-way link, a fee netted from a deposit (the account says so, or the movement states a fee of the decision's amount), a credit, a closed decision, a zero amount, another owner's movement
                 and a section that is not Expense or Revenue are not errors; a decision whose bank_links name nothing any register holds is
                 reported as not assessed. No books data is read.
  2. live        per year and kind, PASS or FAIL with dollars (a FAIL lists the decisions: both ids and both amounts); an independent recomputation
                 from the decision and movement records must give the same ties, statuses and not-assessed decisions as the view; and the coverage
                 that bounds what the check can say: decisions tested, how they were tied, and the decisions not assessed with their link ids and
                 dollars, by account.
  --with-gate    also runs books_year_gate (slow: about 12 to 45 s a year) and requires R11 to equal the recomputation (decisions flagged, tested and
                 not assessed, dollars, ids); with --migration the gate is the migration's copy, created as books_year_gate_pending inside the
                 rolled-back transaction.
Exit 1 on a failed unit test or invariant, or on a wrong-way decision (--report: exit 0 on wrong-way decisions alone).

  dotenvx run -- python3 scripts/books/books_direction_check.py --owner <uuid> [--years 2022 2023 2024 2025]
      [--migration supabase/migrations/20261105160000_books_large_sums_tuning.sql] [--with-gate] [--report]
"""
import argparse
import re
import sys
from decimal import Decimal

from books_check_sql import money, run, uuid_ok, view_sql, with_substituted_views

DEFAULT_MIGRATION = 'supabase/migrations/20261105160000_books_large_sums_tuning.sql'
VIEWS = ('v_books_direction_links', 'v_books_direction_checks', 'v_books_large_sums')
REC_COLS = ('owner_id uuid, record_kind text, local_id text, year text, section text, status text, category text, description text, record_date text, '
            'account text, amount_value numeric, record jsonb')
A, B = '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
NETTED = re.compile(r'\(netted\)', re.I)

problems, wrong = [], []


def ok(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        problems.append(msg)


def mv(local_id, amount, owner=A, links=(), account='acct', description=None):
    return dict(owner_id=owner, record_kind='retained_bank_movement', local_id=local_id, year='2099', section='Expense', status=None, category=None,
                description=description, record_date='2099-01-01', account=account, amount_value=amount, record={'bank_links': list(links)})


def dc(local_id, amount, links=(), section='Expense', status='Included', owner=A, account='Schedule C'):
    return dict(owner_id=owner, record_kind='retained_ledger_decision', local_id=local_id, year='2099', section=section, status=status, category='c',
                description='d', record_date='2099-01-02', account=account, amount_value=amount, record={'bank_links': list(links)})


SYN = [
    mv('M-OUT-100', -100), mv('M-IN-100', 100), mv('M-IN-200', 200), mv('M-OUT-200', -200), mv('M-IN-50', 50), mv('M-OUT-50', -50), mv('M-ZERO', 0),
    mv('M-IN-30', 30), mv('M-OUT-70', -70, links=['D18-both']),
    mv('M-REV-OUT', -300, links=['D15-reverse-ok']),                                  # the bank line names the decision
    mv('M-REV-IN', 40, links=['D16-reverse-wrong']),
    mv('M-PAY', -99, links=['D17-paypal']), mv('M-FUND', 99, links=['D17-paypal']),    # a purchase paid through PayPal: card funding in, payment out
    mv('M-REV-IN500', 500, links=['D22-reverse-revenue']),
    mv('M-OTHER-OWNER', -12, owner=B, links=['D21-reverse-other-owner']),             # another owner's movement names this owner's decision
    mv('M-CLOSED', -10, links=['D9-closed']),
    mv('M-FEE-IN', 30, links=['D23-fee-in-text', 'D24-fee-mismatch'], description='X | General Payment | USD 30.00 (fee -1.35, net 28.65)'),
    dc('D1-ok', 100, ['M-OUT-100']),                                                  # an expense paid out
    dc('D2-wrong', 100, ['M-IN-100']),                                                # an expense linked to money in
    dc('D3-ok', 200, ['M-IN-200'], 'Revenue'),                                        # revenue received
    dc('D4-wrong', 200, ['M-OUT-200'], 'Revenue'),                                    # revenue linked to money out
    dc('D5-refund', -50, ['M-IN-50']),                                                # a refund is money in: not tested
    dc('D6-negative', -50, ['M-OUT-50']),                                             # negative decisions can link either way: not tested
    dc('D7-unresolved', 10, ['MX']),                                                  # names no bank line of any register: not assessed
    dc('D8-two-links', 10, ['M-OUT-100', 'M-IN-100']),                                # one right, one other leg: not an error
    dc('D9-closed', 30, ['M-IN-100'], status='Closed: not claimed'),                  # not a claimed decision
    dc('D10-rev-negative', -20, ['M-IN-50'], 'Revenue'),                              # a revenue correction: not tested
    dc('D11-zero', 0, ['M-IN-100']),
    dc('D12-other-owner', 10, ['M-IN-100'], owner=B),                                 # owner B holds no such movement
    dc('D13-zero-movement', 10, ['M-ZERO']),                                          # a zero movement is nothing to test
    dc('D14-reference', 100, ['M-IN-100'], 'Reference'),
    dc('D15-reverse-ok', 300, ['X-BANK-1']),                                          # its own link names an id no register holds; the bank line names it
    dc('D16-reverse-wrong', 40, ['X-BANK-2']),                                        # the bank line that names it is money in
    dc('D17-paypal', 99, ['X-BANK-3']),                                               # payment out plus card funding in: right way, the funding is another leg
    dc('D18-both', 70, ['M-OUT-70']),                                                 # named both ways: one pair
    dc('D19-netted', 1.35, ['M-IN-30'], account='PayPal NUKE LTD (netted)'),          # a fee netted from a deposit
    dc('D20-nolinks', 5),                                                             # no link at all: not part of this check
    dc('D21-reverse-other-owner', 12),
    dc('D22-reverse-revenue', 500, [], 'Revenue'),                                    # no link of its own; the bank line names it
    dc('D23-fee-in-text', 1.35),                                                      # the movement states "fee -1.35": a fee netted from that receipt
    dc('D24-fee-mismatch', 2.00),                                                     # the movement states another fee: an expense linked to money in
]
# (decision, movement) -> (status, via); a decision tied to nothing: (decision, None) -> ('unresolved', 'none')
WANT = {
    ('D1-ok', 'M-OUT-100'): ('right_way', 'decision_link'),
    ('D2-wrong', 'M-IN-100'): ('wrong_way', 'decision_link'),
    ('D3-ok', 'M-IN-200'): ('right_way', 'decision_link'),
    ('D4-wrong', 'M-OUT-200'): ('wrong_way', 'decision_link'),
    ('D7-unresolved', None): ('unresolved', 'none'),
    ('D8-two-links', 'M-OUT-100'): ('right_way', 'decision_link'),
    ('D8-two-links', 'M-IN-100'): ('other_leg', 'decision_link'),
    ('D13-zero-movement', None): ('unresolved', 'none'),
    ('D15-reverse-ok', 'M-REV-OUT'): ('right_way', 'movement_link'),
    ('D16-reverse-wrong', 'M-REV-IN'): ('wrong_way', 'movement_link'),
    ('D17-paypal', 'M-PAY'): ('right_way', 'movement_link'),
    ('D17-paypal', 'M-FUND'): ('other_leg', 'movement_link'),
    ('D18-both', 'M-OUT-70'): ('right_way', 'both'),
    ('D19-netted', 'M-IN-30'): ('netted_fee', 'decision_link'),
    ('D22-reverse-revenue', 'M-REV-IN500'): ('right_way', 'movement_link'),
    ('D23-fee-in-text', 'M-FEE-IN'): ('netted_fee', 'movement_link'),
    ('D24-fee-mismatch', 'M-FEE-IN'): ('wrong_way', 'movement_link'),
}
WANT_CHECKS = {('D2-wrong', 'M-IN-100'): ('deduction', 100, 100, 'outflow', 'inflow'),
               ('D4-wrong', 'M-OUT-200'): ('revenue', 200, -200, 'inflow', 'outflow'),
               ('D16-reverse-wrong', 'M-REV-IN'): ('deduction', 40, 40, 'outflow', 'inflow'),
               ('D24-fee-mismatch', 'M-FEE-IN'): ('deduction', 2, 30, 'outflow', 'inflow')}


def unit_test(migration_text):
    print('-- 1. unit test: the views over synthetic rows')
    links_select = with_substituted_views(view_sql(migration_text, 'v_books_direction_links'), {'v_financial_accounting_records': (REC_COLS, SYN)})
    sql = ("select coalesce(jsonb_agg(jsonb_build_object('owner', x.owner_id, 'kind', x.kind, 'd', x.decision_id, 'm', x.movement_id, 'du', x.decision_usd, "
           "'mu', x.movement_usd, 'exp', x.expected, 'found', x.found, 'via', x.via, 'status', x.status, 'ids', x.link_ids, 'acct', x.decision_account) "
           "order by x.decision_id, x.movement_id), '[]'::jsonb) from (" + links_select + ") x")
    checks_select = with_substituted_views(view_sql(migration_text, 'v_books_direction_checks'), {'v_books_direction_links': links_select})
    sql2 = ("select coalesce(jsonb_agg(jsonb_build_object('owner', x.owner_id, 'kind', x.kind, 'd', x.decision_id, 'm', x.movement_id, 'du', x.decision_usd, "
            "'mu', x.movement_usd, 'exp', x.expected, 'found', x.found) order by x.decision_id, x.movement_id), '[]'::jsonb) from (" + checks_select + ") x")
    res = run([('links', sql), ('checks', sql2)])
    rows, chk = res['links'][0], res['checks'][0]
    got = {(r['d'], r['m']): (r['status'], r['via']) for r in rows if r['owner'] == A}
    ok(got == WANT, f'exactly the ties and unresolved decisions of owner A (extra: {sorted(set(got) - set(WANT), key=str)}, missing: {sorted(set(WANT) - set(got), key=str)})')
    for k, w in WANT.items():
        ok(got.get(k) == w, f'{k[0]} -> {k[1]}: {got.get(k)} (expected {w})')
    d12 = [r for r in rows if r['d'] == 'D12-other-owner']
    ok(len(d12) == 1 and d12[0]['owner'] == B and d12[0]['status'] == 'unresolved', "another owner's decision, naming this owner's movement, is tied to nothing of its own: one unresolved row")
    un = {r['d']: r for r in rows if r['status'] == 'unresolved'}
    ok(un['D7-unresolved']['ids'] == ['MX'] and un['D7-unresolved']['m'] is None and un['D7-unresolved']['mu'] is None,
       'an unresolved decision keeps the link ids it names and has no movement')
    ok(all(r['status'] != 'unresolved' or r['via'] == 'none' for r in rows), 'unresolved rows have via none')
    wrong_rows = {(r['d'], r['m']): (r['kind'], r['du'], r['mu'], r['exp'], r['found']) for r in chk if r['owner'] == A}
    ok(wrong_rows == WANT_CHECKS, f'v_books_direction_checks is exactly the wrong_way rows: {sorted(wrong_rows)} (expected {sorted(WANT_CHECKS)})')
    ok(all(not NETTED.search(r['acct'] or '') for r in rows if r['status'] == 'wrong_way'), 'a netted fee is never wrong_way')


def live(owner, migration, years):
    ylist = ','.join("'" + y + "'" for y in years)
    qs = [
        ('links', f"select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from public.v_books_direction_links v where v.owner_id = '{owner}'::uuid and v.year in ({ylist})"),
        ('checks', f"select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from public.v_books_direction_checks v where v.owner_id = '{owner}'::uuid and v.year in ({ylist})"),
        ('dec', "select coalesce(jsonb_agg(jsonb_build_object('id', x.local_id, 'year', x.year, 'section', x.section, 'amount', x.amount_value, 'account', x.account, "
                f"'links', x.record->'bank_links')), '[]'::jsonb) from public.v_financial_accounting_records x where x.owner_id = '{owner}'::uuid "
                "and x.record_kind = 'retained_ledger_decision' and x.section in ('Expense', 'Revenue') and x.amount_value is not null and x.amount_value > 0 "
                "and coalesce(x.status, '') not like 'Closed%' and coalesce(x.status, '') not like 'Open allocation%'"),
        ('mov', "select coalesce(jsonb_agg(jsonb_build_object('id', x.local_id, 'amount', x.amount_value, 'description', x.description, 'links', x.record->'bank_links')), '[]'::jsonb) "
                f"from public.v_financial_accounting_records x where x.owner_id = '{owner}'::uuid and x.record_kind = 'retained_bank_movement' "
                "and x.amount_value is not null and x.amount_value <> 0"),
    ]
    res = run(qs, migration=migration, view_names=VIEWS)
    return res['links'][0], res['checks'][0], res['dec'][0], res['mov'][0], res['links'][1]


def recompute(dec, mov, years):
    """Ties, statuses and unresolved decisions from the raw records, independent of the view's SQL."""
    movs = {m['id']: m for m in mov}
    named_by = {}
    for m in mov:
        for link in (m['links'] if isinstance(m['links'], list) else []):
            named_by.setdefault(link, set()).add(m['id'])
    rows, unresolved = {}, {}
    for d in dec:
        links = d['links'] if isinstance(d['links'], list) else []
        own = {x for x in links if x in movs}
        back = named_by.get(d['id'], set())
        tied = own | back
        if not tied:
            if links:
                unresolved[d['id']] = d
            continue
        right = {mid: ((d['section'] == 'Expense' and movs[mid]['amount'] < 0) or (d['section'] == 'Revenue' and movs[mid]['amount'] > 0)) for mid in tied}
        any_right = any(right.values())
        for mid in tied:
            via = 'both' if mid in own and mid in back else ('decision_link' if mid in own else 'movement_link')
            if right[mid]:
                st = 'right_way'
            elif any_right:
                st = 'other_leg'
            elif NETTED.search(d['account'] or '') or ('fee -' + str(d['amount'])) in (movs[mid]['description'] or ''):
                st = 'netted_fee'
            else:
                st = 'wrong_way'
            rows[(d['id'], mid)] = (d['year'], st, via)
    return rows, unresolved


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', required=True)
    ap.add_argument('--years', nargs='+', default=['2022', '2023', '2024', '2025'])
    ap.add_argument('--migration', help='try this migration file inside the rolled-back transaction (its views; with --with-gate also its gate)')
    ap.add_argument('--with-gate', action='store_true')
    ap.add_argument('--max-seconds', type=float)
    ap.add_argument('--report', action='store_true', help='exit 0 when only the books have wrong-way decisions')
    a = ap.parse_args()
    owner, years = uuid_ok(a.owner), [str(int(y)) for y in a.years]
    unit_test(open(a.migration or DEFAULT_MIGRATION).read())
    print('-- 2. live books')
    links, checks, dec, mov, ms = live(owner, a.migration, years)
    print(f'reads: v_books_direction_links {ms / 1000:.2f} s; {len(dec)} positive decisions, {len(mov)} bank movements')
    if a.max_seconds:
        ok(ms / 1000 <= a.max_seconds, f'the view reads within {a.max_seconds} s')
    rows, unresolved = recompute(dec, mov, years)
    view_rows = {(r['decision_id'], r['movement_id']): (r['year'], r['status'], r['via']) for r in links if r['status'] != 'unresolved'}
    mine = {k: v for k, v in rows.items() if v[0] in years}
    ok(mine == view_rows, f'the view ties the same {len(view_rows)} decision-movement pairs, with the same status and the same way of tying, as an independent recomputation from the records')
    view_un = {r['decision_id'] for r in links if r['status'] == 'unresolved'}
    ok(view_un == {k for k, d in unresolved.items() if d['year'] in years},
       f'the view lists the same {len(view_un)} not-assessed decisions (bank_links name nothing any register holds) as the recomputation')
    ok({(r['decision_id'], r['movement_id']) for r in checks} == {k for k, v in view_rows.items() if v[1] == 'wrong_way'},
       'v_books_direction_checks is exactly the wrong_way rows of v_books_direction_links')
    ok(all(r['expected'] == ('outflow' if r['kind'] == 'deduction' else 'inflow') and r['expected'] != r['found'] for r in checks), 'every wrong-way row names a direction that contradicts its kind')
    dec_by_id = {d['id']: d for d in dec}
    flagged_by_year = {}
    for y in years:
        for kind in ('deduction', 'revenue'):
            section = 'Expense' if kind == 'deduction' else 'Revenue'
            tied = {k[0] for k, v in mine.items() if v[0] == y and dec_by_id[k[0]]['section'] == section}
            bad = {k[0] for k, v in mine.items() if v[0] == y and v[1] == 'wrong_way' and dec_by_id[k[0]]['section'] == section}
            un = [d for k, d in unresolved.items() if d['year'] == y and d['section'] == section]
            via = {w: sum(1 for k, v in mine.items() if v[0] == y and v[2] == w and dec_by_id[k[0]]['section'] == section) for w in ('decision_link', 'movement_link', 'both')}
            ids = {l for d in un for l in d['links']}
            usd = sum(d['amount'] for d in un)
            bad_usd = sum(dec_by_id[k]['amount'] for k in bad)
            flagged_by_year.setdefault(y, {})[kind] = (bad, tied, un)
            verdict = 'PASS' if not bad else 'FAIL'
            print(f"{y} {kind:<9} {verdict}: {len(bad)} wrong-way decisions {money(bad_usd)}; decisions with bank links {len(tied) + len(un)}: tested {len(tied)} "
                  f"(pairs tied by the decision's link {via['decision_link']}, by the bank line's link back {via['movement_link']}, both {via['both']}), "
                  f"not assessed {len(un)} naming {len(ids)} link ids, {money(usd)}")
            if un:
                accts = {}
                for d in un:
                    accts.setdefault(d['account'] or '-', []).append(d['amount'])
                print('     not assessed by account: ' + ', '.join(f'{k} {len(v)} {money(sum(v))}' for k, v in sorted(accts.items(), key=lambda kv: -sum(kv[1]))[:6]))
            for k in sorted(bad)[:5]:
                for r in (r for r in checks if r['decision_id'] == k):
                    print(f"     {r['decision_id']} {money(r['decision_usd'])} -> {r['movement_id']} {money(r['movement_usd'])} ({r['movement_date']}, {r['movement_account']}): expected {r['expected']}, found {r['found']}")
            if bad:
                wrong.append(f'{y} {kind}: {len(bad)} decisions {money(bad_usd)}')
    if a.with_gate:
        print('-- books_year_gate against the recomputation')
        qs = [(f'g{y}', f"select public.books_year_gate{'_pending' if a.migration else ''}('{owner}'::uuid, {int(y)})::text") for y in years]
        res = run(qs, migration=a.migration, view_names=VIEWS, with_gate=bool(a.migration), timeout='115s')
        for y in years:
            g = res[f'g{y}'][0]
            r11 = next((r for r in g['rules'] if r['rule'] == 'R11'), None)
            if r11 is None:
                ok(False, f'{y} gate has no R11')
                continue
            bad = set().union(*(flagged_by_year[y][k][0] for k in ('deduction', 'revenue')))
            tested = set().union(*(flagged_by_year[y][k][1] for k in ('deduction', 'revenue')))
            un = [d for k in ('deduction', 'revenue') for d in flagged_by_year[y][k][2]]
            bad_usd = sum(dec_by_id[k]['amount'] for k in bad)
            want = 'fail' if bad else ('not_assessed' if not tested else 'pass')
            ok(r11['n'] == len(bad) and r11['of'] == len(tested) and abs(Decimal(r11['amount']) - bad_usd) < Decimal('0.01') and r11['status'] == want,
               f"{y} gate R11 {r11['status']}: {r11['n']} decisions {money(r11['amount'])} of {r11['of']} tested = the recomputation's {len(bad)} {money(bad_usd)} of {len(tested)}  ({res[f'g{y}'][1] / 1000:.1f} s)")
            u = r11['unresolved']
            ok(u['n'] == len(un) and abs(Decimal(u['amount']) - sum(d['amount'] for d in un)) < Decimal('0.01') and u['links'] == len({l for d in un for l in d['links']}),
               f"{y} gate R11 not assessed: {u['n']} decisions, {u['links']} link ids, {money(u['amount'])} = the recomputation's")
            ok([r['rule'] for r in g['rules']][-2:] == ['R11', 'R12'], f"{y} R11 and R12 come last, after R10: {[r['rule'] for r in g['rules']][-4:]}")
    print('books_direction:', 'PASS' if not problems and not wrong else
          (f'FAIL ({len(problems)} check(s) failed)' if problems else 'FAIL (' + '; '.join(wrong) + ')'))
    sys.exit(1 if problems or (wrong and not a.report) else 0)


if __name__ == '__main__':
    main()
