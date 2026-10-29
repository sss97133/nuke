#!/usr/bin/env python3
"""Check: every linked deduction is money out and every linked revenue is money in (v_books_direction_checks, books_year_gate R11).

Read-only: every statement runs as the service role in a transaction that is rolled back. Three parts:
  1. unit test   the view's own SQL (from the migration file) over synthetic rows: the wrong-way pairs are listed, and nothing else is (a credit
                 or correction can link either way, a closed decision, a zero amount, a link that names no retained movement, another owner's
                 movement and a section that is not Expense or Revenue are not). No books data is read.
  2. live        the wrong-way pairs of the books, per year and kind, as PASS or FAIL with dollars (a FAIL lists the pairs: both ids and both
                 amounts); an independent recomputation from the decision and movement records must give the same pairs as the view; and the
                 coverage that bounds what the check can say: how many links name a retained movement (tested) and how many name a bank line
                 the register does not hold (not assessed), plus the negative decisions that are not tested.
  --with-gate    also runs books_year_gate (slow: about 12 to 45 s a year) and requires R11 to equal the view (pairs, dollars, links tested);
                 with --migration the gate is the migration's copy, created as books_year_gate_pending inside the rolled-back transaction.
Exit 1 on a failed unit test or invariant, or on a wrong-way pair (--report: exit 0 on pairs alone).

  dotenvx run -- python3 scripts/books/books_direction_check.py --owner <uuid> [--years 2022 2023 2024 2025]
      [--migration supabase/migrations/20261105140000_books_big_sum_rules.sql] [--with-gate] [--report]
"""
import argparse
import sys
from decimal import Decimal

from books_check_sql import money, run, uuid_ok, view_sql, with_substituted_views

DEFAULT_MIGRATION = 'supabase/migrations/20261105140000_books_big_sum_rules.sql'
REC_COLS = ('owner_id uuid, record_kind text, local_id text, year text, section text, status text, category text, record_date text, account text, '
            'amount_value numeric, record jsonb')
A, B = '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'

problems, wrong = [], []


def ok(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        problems.append(msg)


def mv(local_id, amount, owner=A):
    return dict(owner_id=owner, record_kind='retained_bank_movement', local_id=local_id, year='2099', section='Expense', status=None, category=None,
                record_date='2099-01-01', account='acct', amount_value=amount, record={'bank_links': []})


def dc(local_id, amount, links, section='Expense', status='Included', owner=A):
    return dict(owner_id=owner, record_kind='retained_ledger_decision', local_id=local_id, year='2099', section=section, status=status, category='c',
                record_date='2099-01-02', account='Schedule C', amount_value=amount, record={'bank_links': links})


SYN = [
    mv('M-OUT-100', -100), mv('M-IN-100', 100), mv('M-IN-200', 200), mv('M-OUT-200', -200), mv('M-IN-50', 50), mv('M-OUT-50', -50), mv('M-ZERO', 0),
    dc('D1-ok', 100, ['M-OUT-100']),                                       # an expense paid out
    dc('D2-wrong', 100, ['M-IN-100']),                                     # an expense linked to money in
    dc('D3-ok', 200, ['M-IN-200'], 'Revenue'),                             # revenue received
    dc('D4-wrong', 200, ['M-OUT-200'], 'Revenue'),                         # revenue linked to money out
    dc('D5-refund', -50, ['M-IN-50']),                                     # a refund is money in: not tested
    dc('D6-negative', -50, ['M-OUT-50']),                                  # negative decisions can link either way: not tested
    dc('D7-unresolved', 10, ['MX']),                                       # names no retained movement: cannot be tested
    dc('D8-two-links', 10, ['M-OUT-100', 'M-IN-100']),                     # one right, one wrong: one pair
    dc('D9-closed', 30, ['M-IN-100'], status='Closed: not claimed'),       # not a claimed decision
    dc('D10-rev-negative', -20, ['M-IN-50'], 'Revenue'),                   # a revenue correction: not tested
    dc('D11-zero', 0, ['M-IN-100']),
    dc('D12-other-owner', 10, ['M-IN-100'], owner=B),                      # owner B holds no such movement
    dc('D13-zero-movement', 10, ['M-ZERO']),
    dc('D14-reference', 100, ['M-IN-100'], 'Reference'),
]
WANT = {('D2-wrong', 'M-IN-100'): ('deduction', 100, 100, 'outflow', 'inflow'),
        ('D4-wrong', 'M-OUT-200'): ('revenue', 200, -200, 'inflow', 'outflow'),
        ('D8-two-links', 'M-IN-100'): ('deduction', 10, 100, 'outflow', 'inflow')}


def unit_test(migration_text):
    print('-- 1. unit test: the view over synthetic rows')
    select = with_substituted_views(view_sql(migration_text, 'v_books_direction_checks'), {'v_financial_accounting_records': (REC_COLS, SYN)})
    sql = ("select coalesce(jsonb_agg(jsonb_build_object('owner', x.owner_id, 'kind', x.kind, 'd', x.decision_id, 'm', x.movement_id, 'du', x.decision_usd, "
           "'mu', x.movement_usd, 'exp', x.expected, 'found', x.found) order by x.decision_id, x.movement_id), '[]'::jsonb) from (" + select + ") x")
    rows = run([('unit', sql)])['unit'][0]
    got = {(r['d'], r['m']): (r['kind'], r['du'], r['mu'], r['exp'], r['found']) for r in rows}
    ok(set(got) == set(WANT), f'exactly the wrong-way pairs: {sorted(got)} (expected {sorted(WANT)})')
    for k, w in WANT.items():
        ok(got.get(k) == w, f'{k[0]} -> {k[1]}: {got.get(k)} (expected {w})')
    ok(all(r['owner'] == A for r in rows), 'only the owner whose decision it is')


def live(owner, migration, years):
    ylist = ','.join("'" + y + "'" for y in years)
    qs = [
        ('view', f"select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from public.v_books_direction_checks v where v.owner_id = '{owner}'::uuid and v.year in ({ylist})"),
        ('dec', "select coalesce(jsonb_agg(jsonb_build_object('id', x.local_id, 'year', x.year, 'section', x.section, 'amount', x.amount_value, 'status', x.status, "
                f"'links', x.record->'bank_links')), '[]'::jsonb) from public.v_financial_accounting_records x where x.owner_id = '{owner}'::uuid "
                "and x.record_kind = 'retained_ledger_decision' and x.section in ('Expense', 'Revenue') and x.amount_value is not null and x.amount_value <> 0 "
                "and jsonb_typeof(x.record->'bank_links') = 'array' and jsonb_array_length(x.record->'bank_links') > 0"),
        ('mov', "select coalesce(jsonb_agg(jsonb_build_object('id', x.local_id, 'year', x.year, 'amount', x.amount_value)), '[]'::jsonb) from public.v_financial_accounting_records x "
                f"where x.owner_id = '{owner}'::uuid and x.record_kind = 'retained_bank_movement' and x.amount_value is not null and x.amount_value <> 0"),
    ]
    res = run(qs, migration=migration, view_names=('v_books_large_sums', 'v_books_direction_checks'))
    return res['view'][0], res['dec'][0], res['mov'][0], res['view'][1]


def recompute(dec, mov):
    """Wrong-way pairs and coverage from the raw records, independent of the view's SQL."""
    movs = {m['id']: m for m in mov}
    pairs, cov = {}, {}
    for d in dec:
        if (d['status'] or '').startswith(('Closed', 'Open allocation')):
            continue
        for link in d['links']:
            m = movs.get(link)
            key = (d['year'], 'deduction' if d['section'] == 'Expense' else 'revenue')
            c = cov.setdefault(key, dict(links=0, tested=0, unresolved=0, negative=0))
            if d['amount'] < 0:
                c['negative'] += 1
                continue
            c['links'] += 1
            if m is None:
                c['unresolved'] += 1
                continue
            c['tested'] += 1
            if (d['section'] == 'Expense' and m['amount'] > 0) or (d['section'] == 'Revenue' and m['amount'] < 0):
                pairs[(d['id'], link)] = (d['year'], key[1], d['amount'], m['amount'])
    return pairs, cov


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', required=True)
    ap.add_argument('--years', nargs='+', default=['2022', '2023', '2024', '2025'])
    ap.add_argument('--migration', help='try this migration file inside the rolled-back transaction (its views; with --with-gate also its gate)')
    ap.add_argument('--with-gate', action='store_true')
    ap.add_argument('--max-seconds', type=float)
    ap.add_argument('--report', action='store_true', help='exit 0 when only the books have wrong-way pairs')
    a = ap.parse_args()
    owner, years = uuid_ok(a.owner), [str(int(y)) for y in a.years]
    unit_test(open(a.migration or DEFAULT_MIGRATION).read())
    print('-- 2. live books')
    view, dec, mov, ms = live(owner, a.migration, years)
    print(f'reads: v_books_direction_checks {ms / 1000:.2f} s; {len(dec)} linked decisions, {len(mov)} bank movements')
    if a.max_seconds:
        ok(ms / 1000 <= a.max_seconds, f'the view reads within {a.max_seconds} s')
    pairs, cov = recompute(dec, mov)
    view_pairs = {(r['decision_id'], r['movement_id']): (r['year'], r['kind'], r['decision_usd'], r['movement_usd']) for r in view}
    mine = {k: v for k, v in pairs.items() if v[0] in years}
    ok(mine == view_pairs, f'the view lists the same {len(view_pairs)} wrong-way pairs as an independent recomputation from the decision and movement records')
    ok(all(r['expected'] == ('outflow' if r['kind'] == 'deduction' else 'inflow') and r['expected'] != r['found'] for r in view), 'every row names a direction that contradicts its kind')
    for y in years:
        for kind in ('deduction', 'revenue'):
            c = cov.get((y, kind), dict(links=0, tested=0, unresolved=0, negative=0))
            rows = [r for r in view if r['year'] == y and r['kind'] == kind]
            usd = sum(abs(r['decision_usd']) for r in rows)
            verdict = 'PASS' if not rows else 'FAIL'
            print(f"{y} {kind:<9} {verdict}: {len(rows)} wrong-way pairs {money(usd)}; links of positive decisions {c['links']}: tested {c['tested']}, "
                  f"not assessed (name a bank line the register does not hold) {c['unresolved']}; negative decisions' links, not tested: {c['negative']}")
            for r in rows[:5]:
                print(f"     {r['decision_id']} {money(r['decision_usd'])} -> {r['movement_id']} {money(r['movement_usd'])} ({r['movement_date']}): expected {r['expected']}, found {r['found']}")
            if rows:
                wrong.append(f'{y} {kind}: {len(rows)} pairs {money(usd)}')
    if a.with_gate:
        print('-- books_year_gate against the view')
        qs = [(f'g{y}', f"select public.books_year_gate{'_pending' if a.migration else ''}('{owner}'::uuid, {int(y)})::text") for y in years]
        res = run(qs, migration=a.migration, view_names=('v_books_large_sums', 'v_books_direction_checks'), with_gate=bool(a.migration), timeout='115s')
        for y in years:
            g = res[f'g{y}'][0]
            r11 = next((r for r in g['rules'] if r['rule'] == 'R11'), None)
            rows = [r for r in view if r['year'] == y]
            if r11 is None:
                ok(False, f'{y} gate has no R11')
                continue
            usd = sum({r['decision_id']: abs(r['decision_usd']) for r in rows}.values())
            want = 'fail' if rows else ('not_assessed' if r11['of'] == 0 else 'pass')
            ok(r11['n'] == len(rows) and abs(Decimal(r11['amount']) - usd) < Decimal('0.01') and r11['status'] == want,
               f"{y} gate R11 {r11['status']}: {r11['n']} pairs {money(r11['amount'])} of {r11['of']} links tested = the view's {len(rows)} pairs {money(usd)}  ({res[f'g{y}'][1] / 1000:.1f} s)")
            ok([r['rule'] for r in g['rules']][-2:] == ['R11', 'R12'], f"{y} R11 and R12 come last, after R10: {[r['rule'] for r in g['rules']][-4:]}")
    print('books_direction:', 'PASS' if not problems and not wrong else
          (f'FAIL ({len(problems)} check(s) failed)' if problems else 'FAIL (' + '; '.join(wrong) + ')'))
    sys.exit(1 if problems or (wrong and not a.report) else 0)


if __name__ == '__main__':
    main()
