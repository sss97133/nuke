#!/usr/bin/env python3
"""Test: the structural rows of the C-tier close (20 local_ids) get a cited rule instead of tier C, and the refinement moves no dollars.

Run against the live views after the migration 20261104180000 is deployed. Asserts, per row and per year:
  rows        each of the 20 structural rows exists and carries a structural_rule with a non-empty structural_cites:
              depreciation lines   tier B, rule asset_register (only if the year's R6 test passes in v_books_asset_register)
              owner-ruling rows    tier B, rule owner_ruling_aggregate
              Snap-on lines        pay_proof true, rule snapon_ra_payments, payment_cites = the RA payment movements of the year's RA ruling
              inventory shares, zero reclass pairs, credits, netted fees   is_deduction false, tier X, an exclusion_reason
  totals      per year total_usd = the sum of every row = an independent sum over the Expense decisions of the books, so the refinement
              dropped and added nothing; A + B + C = deduction_usd; deduction_usd + excluded_usd = total_usd; X rows are exactly the
              rows with is_deduction false
  expected    with --expect-total YEAR=AMOUNT (the totals recorded at the close, kept out of the public repo) a year whose total differs
              fails; the live books move when rulings land, so the drift is printed with the amount
  gate        with --with-gate, R6 in books_year_gate agrees with year_r6_pass of v_books_asset_register (slow: the gate runs minutes)
The excluded rows are listed per year with their amounts and reasons. Exit 1 on any failed assertion.

  dotenvx run -- python3 scripts/books/books_audit_tiers_structural_check.py --owner <uuid> [--years 2024 2025] [--expect-total 2024=<amount> 2025=<amount>] [--with-gate]
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, uuid_ok  # noqa: E402

OWNER_RULING = ['2024-RULING-674-rent', '2024-RULING-utility-city-history', '2025-RULING-utility-city-history']
DEPRECIATION = ['2024-RULING-dep-674', '2024-RULING-dep-machines', '2025-RULING-dep-674', '2025-RULING-dep-machines']
SNAPON = ['SNAP-CART-INFERRED-SALES-TAX', 'SNAP-ITEM-95', 'SNAP-ITEM-96', 'SNAP-ITEM-97', 'SNAPON-INTEREST-2024', 'SNAPON-INTEREST-2025']
EXCLUDED = ['FUEL-RECLASS-2024-IN', 'FUEL-RECLASS-2024-OUT', '2024-EXPENSE-418-INVENTORY', '2025-EXPENSE-1166-INVENTORY',
            'RECEIPT-OC-AUTO-00246098-INVENTORY', 'RECEIPT-CJP-73132264-CREDIT', '2025-EXPENSE-1153']
STRUCTURAL = OWNER_RULING + DEPRECIATION + SNAPON + EXCLUDED
assert len(STRUCTURAL) == 20 and len(set(STRUCTURAL)) == 20


def sql_json(owner, body):
    """Run one SELECT that returns a single json value, as the service role, rolled back."""
    out = psql("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
               f"select ({body})::text;\nrollback;\n")
    return json.loads(next(l for l in out.splitlines() if l[:1] in '[{'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', required=True)
    ap.add_argument('--years', nargs='+', default=['2024', '2025'])
    ap.add_argument('--expect-total', nargs='*', default=[], metavar='YEAR=AMOUNT', help='fail when a year total differs from the total recorded at the close')
    ap.add_argument('--with-gate', action='store_true', help='compare year_r6_pass with books_year_gate R6 (slow)')
    a = ap.parse_args()
    owner = uuid_ok(a.owner)
    expect = dict(kv.split('=', 1) for kv in a.expect_total)
    problems, notes = [], []

    # ---- the 20 rows
    ids = ','.join("'" + i + "'" for i in STRUCTURAL)
    rows = sql_json(owner, "select coalesce(json_agg(json_build_object('year', t.year, 'id', t.local_id, 'amount', t.amount, 'tier', t.tier,"
                    "'rule', t.structural_rule, 'is_deduction', t.is_deduction, 'pay', t.pay_proof, 'reason', t.exclusion_reason,"
                    "'cites', t.structural_cites, 'pay_cites', t.payment_cites, 'tier_reason', t.tier_reason)), '[]'::json)"
                    f" from public.v_books_audit_tiers t where t.owner_id='{owner}'::uuid and t.local_id in ({ids})")
    by_id = {r['id']: r for r in rows}
    reg = {r['year']: r['pass'] for r in sql_json(owner, "select coalesce(json_agg(json_build_object('year', q.year, 'pass', q.p)), '[]'::json) from ("
                                                  "select year, bool_and(year_r6_pass) as p from public.v_books_asset_register "
                                                  f"where owner_id='{owner}'::uuid group by year) q")}
    ra = {r['year']: r['links'] for r in sql_json(owner, "select coalesce(json_agg(json_build_object('year', v.year, 'links', v.record->'bank_links')), '[]'::json) "
                                                  "from public.v_financial_accounting_records v where v.owner_id='" + owner + "'::uuid and v.record_kind='retained_ledger_decision' "
                                                  "and v.section='Expense' and v.local_id ~ '-RULING-snapon-ra-payments$'")}
    for i in STRUCTURAL:
        r = by_id.get(i)
        if r is None:
            problems.append(f'{i}: row not found')
            continue
        if not r['cites']:
            problems.append(f"{i}: structural_cites empty")
        if i in OWNER_RULING and not (r['tier'] == 'B' and r['rule'] == 'owner_ruling_aggregate'):
            problems.append(f"{i}: expected tier B owner_ruling_aggregate, got {r['tier']} {r['rule']}")
        if i in DEPRECIATION:
            if reg.get(r['year']):
                if not (r['tier'] == 'B' and r['rule'] == 'asset_register'):
                    problems.append(f"{i}: R6 passes for {r['year']} but got {r['tier']} {r['rule']}")
            elif r['rule'] == 'asset_register':
                problems.append(f"{i}: asset_register rule applied although R6 does not pass for {r['year']}")
            else:
                notes.append(f"{i}: R6 does not pass for {r['year']}, stays {r['tier']} (rule works as designed)")
        if i in SNAPON:
            ra_links = ra.get(r['year']) or []
            if not (r['pay'] and r['rule'] == 'snapon_ra_payments' and r['tier'] in ('A', 'B')):
                problems.append(f"{i}: expected inherited payment proof and tier A/B, got pay={r['pay']} {r['rule']} {r['tier']}")
            if not ra_links or r['pay_cites'] != ra_links:
                problems.append(f"{i}: payment_cites is not the {len(ra_links)} RA payment movements of the year's RA ruling")
        if i in EXCLUDED and not (r['is_deduction'] is False and r['tier'] == 'X' and r['reason'] and r['rule'] == 'excluded'):
            problems.append(f"{i}: expected excluded (is_deduction false, tier X, reason), got {r['tier']} {r['rule']} deduction={r['is_deduction']}")
        if r['tier'] == 'C':
            problems.append(f"{i}: still tier C ({r['tier_reason']})")

    # ---- totals per year
    for y in a.years:
        t = sql_json(owner, "select json_build_object('rows', (select json_build_object('n', count(*), 'total', round(coalesce(sum(amount),0),2),"
                     "'a', round(coalesce(sum(amount) filter (where tier='A'),0),2), 'b', round(coalesce(sum(amount) filter (where tier='B'),0),2),"
                     "'c', round(coalesce(sum(amount) filter (where tier='C'),0),2), 'x', round(coalesce(sum(amount) filter (where tier='X'),0),2),"
                     "'xn', count(*) filter (where tier='X'), 'nonded', count(*) filter (where not is_deduction),"
                     "'xmismatch', count(*) filter (where (tier='X') <> (not is_deduction)),"
                     "'ded', round(coalesce(sum(amount) filter (where is_deduction),0),2))"
                     f" from public.v_books_audit_tiers where owner_id='{owner}'::uuid and year='{int(y)}'),"
                     "'raw', (select json_build_object('n', count(*), 'total', round(coalesce(sum(amount_value),0),2)) from public.v_financial_accounting_records v"
                     f" where v.owner_id='{owner}'::uuid and v.year='{int(y)}' and v.record_kind='retained_ledger_decision' and v.section='Expense' and v.amount_value is not null"
                     " and coalesce(v.status,'') not like 'Closed%' and coalesce(v.status,'') not like 'Open allocation%'),"
                     f"'roll', (select row_to_json(r) from public.v_books_audit_tier_years r where owner_id='{owner}'::uuid and year='{int(y)}'),"
                     "'excluded', (select coalesce(json_agg(json_build_object('id', local_id, 'amount', amount, 'reason', exclusion_reason) order by local_id), '[]'::json)"
                     f" from public.v_books_audit_tiers where owner_id='{owner}'::uuid and year='{int(y)}' and not is_deduction))")
        rw, raw, roll = t['rows'], t['raw'], t['roll'] or {}
        p = []
        if rw['n'] != raw['n'] or abs(float(rw['total']) - float(raw['total'])) > 0.005:
            p.append(f"view {rw['n']} rows / {rw['total']} != books {raw['n']} rows / {raw['total']}")
        if abs(float(rw['a']) + float(rw['b']) + float(rw['c']) - float(rw['ded'])) > 0.005:
            p.append('A+B+C != deduction dollars')
        if abs(float(rw['ded']) + float(rw['x']) - float(rw['total'])) > 0.005:
            p.append('deduction + excluded != total')
        if rw['xmismatch']:
            p.append(f"{rw['xmismatch']} rows where tier X and is_deduction disagree")
        for k, v in (('total_usd', rw['total']), ('deduction_usd', rw['ded']), ('excluded_usd', rw['x']), ('a_usd', rw['a']), ('b_usd', rw['b']), ('c_usd', rw['c'])):
            if abs(float(roll.get(k, 0)) - float(v)) > 0.005:
                p.append(f"rollup {k} {roll.get(k)} != rows {v}")
        if int(roll.get('excluded_n', 0)) != rw['nonded'] or int(roll.get('decisions', 0)) != rw['n']:
            p.append('rollup counts != rows')
        spec = float(expect[y]) if y in expect else None
        drift = '' if spec is None else ('' if abs(float(rw['total']) - spec) < 0.005 else f" | DRIFT from expected {spec:,.2f}: {float(rw['total']) - spec:+,.2f}")
        if drift:
            p.append(drift.strip(' |'))
        problems += [f'{y}: {x}' for x in p]
        print(y, 'rows', rw['n'], 'total', rw['total'], '= deduction', rw['ded'], '+ excluded', rw['x'], '| A', rw['a'], 'B', rw['b'], 'C', rw['c'], drift,
              '|', 'OK' if not p else '; '.join(p))
        for e in t['excluded']:
            print(f"   excluded {e['id']} {e['amount']}: {e['reason']}")

    if a.with_gate:
        from books_year_gate_check import gate  # noqa: E402
        for y in a.years:
            r6 = next(r for r in gate(owner, y)['rules'] if r['rule'] == 'R6')
            if (r6['status'] == 'pass') != bool(reg.get(y)):
                problems.append(f"{y}: gate R6 {r6['status']} but v_books_asset_register year_r6_pass {reg.get(y)}")

    for n in notes:
        print('note:', n)
    for x in problems:
        print('FAIL:', x)
    print('books_audit_tiers_structural:', 'PASS' if not problems else f'FAIL ({len(problems)})')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
