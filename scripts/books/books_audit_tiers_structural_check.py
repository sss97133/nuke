#!/usr/bin/env python3
"""Test: the structural rules of v_books_audit_tiers hold on the live books, and the refinement moves no dollars.

Run against the deployed views, or before deploy with --from-migration <file> (the migration's views are inlined as CTEs of each
read-only statement; nothing is created). Asserts, per year:
  every structural row   structural_cites names a rule of v_books_structural_rules; tier B with no bank line comes only from the asset
                         register (the year passes the R6 test in v_books_asset_register) or an owner ruling aggregate (its text cites
                         Evidence: and is not an estimate pending evidence); Snap-on rows cite movements of the year's RA ruling, the
                         inheriting rows net to no more than those movements' outflow (an independent sum), an inferred row never
                         inherits; a fee netted from a deposit cites one deposit movement
  excluded rows          the set of rows with is_deduction false is exactly the reviewed list below, each with tier X and a counterpart
  named rows             the rows of the C-tier close land where reviewed (a depreciation line stays unproven in a year whose R6 fails)
  totals                 total_usd = the sum of every row = an independent sum over the books' Expense decisions; A + B + C = deduction_usd;
                         deduction_usd + excluded_usd = total_usd; the rollup (including b_nobank) equals the rows
  expected               --expect-total YEAR=AMOUNT (totals recorded at the close, kept out of the public repo): a year that differs fails;
                         the live books move when rulings land, so the drift is printed with the amount
  gate                   --with-gate: books_year_gate R6 and R10 agree with the views (slow: the gate runs minutes)
Exit 1 on any failed assertion.

  dotenvx run -- python3 scripts/books/books_audit_tiers_structural_check.py --owner <uuid> [--years 2022 2023 2024 2025]
      [--expect-total 2024=<amount> 2025=<amount>] [--from-migration supabase/migrations/20261104180000_books_audit_tiers_structural.sql] [--with-gate]
"""
import argparse, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, uuid_ok  # noqa: E402

OWNER_RULING = ['2024-RULING-674-rent', '2024-RULING-utility-city-history', '2025-RULING-utility-city-history']
DEPRECIATION = ['2024-RULING-dep-674', '2024-RULING-dep-machines', '2025-RULING-dep-674', '2025-RULING-dep-machines']
SNAPON = ['SNAP-ITEM-95', 'SNAP-ITEM-96', 'SNAP-ITEM-97', 'SNAPON-INTEREST-2024', 'SNAPON-INTEREST-2025']
NEVER_PROVEN = {  # stays tier C: an estimate pending evidence is not an owner ruling aggregate with evidence
    '2025-RULING-opportunity-loan-interest': 'ruling that is an estimate pending evidence'}
INFERRED = 'SNAP-CART-INFERRED-SALES-TAX'  # an inferred Snap-on row never inherits the RA payments' proof (it may still be proven another way)
NETTED = '2025-EXPENSE-1153'
# The reviewed set of rows outside the deduction denominator, per year (local_id). Anything else with is_deduction false is a finding.
EXCLUDED_BY_YEAR = {
    '2022': [], '2023': [],
    '2024': ['2024-EXPENSE-418-INVENTORY', 'CASH-CONTEXT-SHANE-200-POOL', 'FUEL-RECLASS-2024-IN', 'FUEL-RECLASS-2024-OUT', 'RECEIPT-CJP-73132264-CREDIT'],
    '2025': ['2025-EXPENSE-1166-INVENTORY', 'RECEIPT-OC-AUTO-00246098-INVENTORY'],
}
EXCLUDING_RULES = ('inventory_share', 'cash_pool_allocation', 'credit_reduction', 'zero_reclass_pair')
VIEWS = ['v_books_structural_rules', 'v_books_asset_register', 'v_books_audit_tiers', 'v_books_audit_tier_years']
MIGRATION_CTES = None  # set by --from-migration: "with v_books_structural_rules as (...), ..."


def load_migration_ctes(path):
    """The migration's views as CTEs, in dependency order, referring to each other by bare name."""
    text = open(path).read()
    bodies = dict(re.findall(r'CREATE OR REPLACE VIEW public\.(\w+) WITH \(security_invoker = true\) AS\n(.*?);\n\nCOMMENT ON VIEW', text, re.S))
    missing = [v for v in VIEWS if v not in bodies]
    if missing:
        sys.exit(f'--from-migration: view(s) not found in {path}: {missing}')
    return 'with ' + ',\n'.join(f'{v} as (\n{re.sub(r"public\.(" + "|".join(VIEWS) + r")\b", r"\1", bodies[v])}\n)' for v in VIEWS) + '\n'


def sql_json(owner, body):
    """Run one SELECT that returns a single json value, as the service role, rolled back. The value is tagged so the
    set_config echo line (which also looks like json) cannot be mistaken for it."""
    stmt = f"select 'JSON:' || ({body})::text;\n"
    if MIGRATION_CTES:
        stmt = MIGRATION_CTES + re.sub(r'public\.(' + '|'.join(VIEWS) + r')\b', r'\1', stmt)
    out = psql("begin read only;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n" + stmt + "rollback;\n")
    line = next((l for l in out.splitlines() if l.startswith('JSON:')), None)
    if line is None:
        raise RuntimeError('no JSON line in psql output: ' + out[-300:])
    return json.loads(line[5:])


def main():
    global MIGRATION_CTES
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', required=True)
    ap.add_argument('--years', nargs='+', default=['2022', '2023', '2024', '2025'])
    ap.add_argument('--expect-total', nargs='*', default=[], metavar='YEAR=AMOUNT', help='fail when a year total differs from the total recorded at the close')
    ap.add_argument('--from-migration', metavar='FILE', help='test the migration file before it is deployed (views inlined as CTEs)')
    ap.add_argument('--with-gate', action='store_true', help='compare books_year_gate R6 and R10 with the views (slow)')
    a = ap.parse_args()
    owner = uuid_ok(a.owner)
    if a.from_migration:
        MIGRATION_CTES = load_migration_ctes(a.from_migration)
    expect = dict(kv.split('=', 1) for kv in a.expect_total)
    problems, notes = [], []
    years = ','.join("'" + str(int(y)) + "'" for y in a.years)

    # ---- reference data
    rules = set(sql_json(owner, "select coalesce(json_agg(rule), '[]'::json) from public.v_books_structural_rules"))
    reg = {r['year']: r['pass'] for r in sql_json(owner, "select coalesce(json_agg(json_build_object('year', q.year, 'pass', q.p)), '[]'::json) from ("
                                                  "select year, bool_and(year_r6_pass) as p from public.v_books_asset_register "
                                                  f"where owner_id='{owner}'::uuid group by year) q")}
    ra = {r['year']: r['links'] for r in sql_json(owner, "select coalesce(json_agg(json_build_object('year', v.year, 'links', v.record->'bank_links')), '[]'::json) "
                                                  "from public.v_financial_accounting_records v where v.owner_id='" + owner + "'::uuid and v.record_kind='retained_ledger_decision' "
                                                  "and v.section='Expense' and v.local_id ~ '-RULING-snapon-ra-payments$'")}
    # ---- every row that carries a structural rule, plus every row outside the denominator, in the years under test
    rows = sql_json(owner, "select coalesce(json_agg(json_build_object('year', t.year, 'id', t.local_id, 'amount', t.amount, 'tier', t.tier,"
                    "'rule', t.structural_rule, 'is_deduction', t.is_deduction, 'pay', t.pay_proof, 'reason', t.exclusion_reason, 'basis', t.proof_basis,"
                    "'cites', t.structural_cites, 'pay_cites', t.payment_cites, 'tier_reason', t.tier_reason,"
                    "'text', (select v.decision from public.v_financial_accounting_records v where v.id = t.id))), '[]'::json)"
                    f" from public.v_books_audit_tiers t where t.owner_id='{owner}'::uuid and t.year in ({years})"
                    " and (t.structural_rule is not null or not t.is_deduction or (t.tier = 'B' and not t.pay_proof)"
                    "      or t.local_id = any(array[" + ','.join("'" + i + "'" for i in OWNER_RULING + DEPRECIATION + SNAPON + list(NEVER_PROVEN) + [INFERRED, NETTED]) + "]))")
    by_id = {(r['year'], r['id']): r for r in rows}

    # ---- every structural row
    for r in rows:
        k = f"{r['year']} {r['id']}"
        if r['rule']:
            c = r['cites'] or []
            if not (c and c[0].get('rule') == r['rule'] and c[0].get('citation') and c[0].get('detail')):
                problems.append(f"{k}: structural_cites does not cite rule {r['rule']} with a citation and detail")
            if r['rule'] not in rules:
                problems.append(f"{k}: rule {r['rule']} is not a row of v_books_structural_rules")
        if r['rule'] in EXCLUDING_RULES:
            if not (r['is_deduction'] is False and r['tier'] == 'X' and r['reason']):
                problems.append(f"{k}: excluded rule {r['rule']} but tier {r['tier']} is_deduction {r['is_deduction']}")
        elif r['is_deduction'] is False:
            problems.append(f"{k}: outside the denominator without an excluding rule")
        if r['tier'] == 'B' and not r['pay']:
            if r['rule'] not in ('asset_register', 'owner_ruling_aggregate') or r['basis'] not in ('asset_register', 'owner_ruling'):
                problems.append(f"{k}: tier B with no bank line from rule {r['rule']} / basis {r['basis']}")
        if r['rule'] == 'asset_register' and not reg.get(r['year']):
            problems.append(f"{k}: asset_register applied although R6 does not pass for {r['year']}")
        if r['rule'] == 'owner_ruling_aggregate':
            text = r['text'] or ''
            if 'Evidence:' not in text or re.search(r'estimate pending|\bfloor\b', text, re.I):
                problems.append(f"{k}: owner_ruling_aggregate without cited evidence, or an estimate pending evidence")
        if r['rule'] == 'snapon_ra_payments':
            if r['id'].upper().find('INFERRED') >= 0:
                problems.append(f"{k}: an inferred row inherited payment proof")
            if not (r['pay'] and r['pay_cites'] and set(r['pay_cites']) <= set(ra.get(r['year']) or [])):
                problems.append(f"{k}: payment_cites is not a subset of the movements the year's RA ruling links")
        if r['rule'] == 'netted_fee_deposit' and not (r['pay'] and len(r['pay_cites'] or []) == 1):
            problems.append(f"{k}: netted fee without exactly one deposit movement")

    # ---- Snap-on coverage, independent of the view: inheriting rows net to no more than the cited movements' outflow
    for y in a.years:
        sn = [r for r in rows if r['year'] == y and r['rule'] == 'snapon_ra_payments']
        if not sn:
            continue
        cited = sorted({m for r in sn for m in r['pay_cites']})
        out = sql_json(owner, "select json_build_object('out', coalesce(sum(-m.amount_value) filter (where m.amount_value < 0), 0), 'n', count(*), 'years', json_agg(distinct m.year)) "
                       "from public.v_financial_accounting_records m "
                       f"where m.owner_id='{owner}'::uuid and m.record_kind='retained_bank_movement' and m.local_id in ({','.join(repr(m) for m in cited)})")
        total = sum(float(r['amount']) for r in sn)
        if out['n'] != len(cited) or out['years'] != [y]:
            problems.append(f"{y}: Snap-on cited movements are not all bank movements dated {y} ({out})")
        if total > float(out['out']) + 0.005:
            problems.append(f"{y}: Snap-on inheriting rows net {total:,.2f} but the cited movements' outflow is {float(out['out']):,.2f}")
        else:
            notes.append(f"{y}: {len(sn)} Snap-on rows net {total:,.2f} <= {float(out['out']):,.2f} outflow of {len(cited)} movements")

    # ---- the reviewed exclusion set, per year
    for y in a.years:
        got = sorted(r['id'] for r in rows if r['year'] == y and r['is_deduction'] is False)
        want = sorted(EXCLUDED_BY_YEAR.get(y, []))
        if y in EXCLUDED_BY_YEAR and got != want:
            problems.append(f"{y}: rows outside the deduction denominator {got} != reviewed list {want}")

    # ---- the named rows
    for i in OWNER_RULING:
        for y in a.years:
            r = by_id.get((y, i))
            if r and not (r['tier'] == 'B' and r['rule'] == 'owner_ruling_aggregate'):
                problems.append(f"{y} {i}: expected tier B owner_ruling_aggregate, got {r['tier']} {r['rule']}")
    for i in DEPRECIATION:
        for y in a.years:
            r = by_id.get((y, i))
            if not r:
                continue
            if reg.get(y):
                if not (r['tier'] == 'B' and r['rule'] == 'asset_register'):
                    problems.append(f"{y} {i}: R6 passes for {y} but got {r['tier']} {r['rule']}")
            else:
                notes.append(f"{y} {i}: R6 does not pass for {y}, so the register rule does not apply (tier {r['tier']}, rule {r['rule']}); correct as designed")
    for i in SNAPON:
        for y in a.years:
            r = by_id.get((y, i))
            if r and not (r['pay'] and r['rule'] == 'snapon_ra_payments' and r['tier'] in ('A', 'B')):
                problems.append(f"{y} {i}: expected inherited payment proof and tier A/B, got pay={r['pay']} {r['rule']} {r['tier']}")
    for i, why in NEVER_PROVEN.items():
        for y in a.years:
            r = by_id.get((y, i))
            if r and not (r['rule'] is None and r['tier'] == 'C'):
                problems.append(f"{y} {i}: a {why} must stay tier C with no structural rule, got {r['tier']} {r['rule']}")
    for y in a.years:
        r = by_id.get((y, INFERRED))
        if r and r['rule'] == 'snapon_ra_payments':
            problems.append(f"{y} {INFERRED}: an inferred row inherited the RA payments' proof")
        r = by_id.get((y, NETTED))
        if r and not (r['rule'] == 'netted_fee_deposit' and r['pay'] and r['tier'] in ('A', 'B')):
            problems.append(f"{y} {NETTED}: expected a fee netted from a deposit with deposit proof and tier A/B, got {r['rule']} pay={r['pay']} {r['tier']}")

    # ---- totals per year
    for y in a.years:
        t = sql_json(owner, "select json_build_object('rows', (select json_build_object('n', count(*), 'total', round(coalesce(sum(amount),0),2),"
                     "'a', round(coalesce(sum(amount) filter (where tier='A'),0),2), 'b', round(coalesce(sum(amount) filter (where tier='B'),0),2),"
                     "'c', round(coalesce(sum(amount) filter (where tier='C'),0),2), 'x', round(coalesce(sum(amount) filter (where tier='X'),0),2),"
                     "'nonded', count(*) filter (where not is_deduction),"
                     "'xmismatch', count(*) filter (where (tier='X') <> (not is_deduction)),"
                     "'bn_n', count(*) filter (where tier='B' and not pay_proof), 'bn', round(coalesce(sum(amount) filter (where tier='B' and not pay_proof),0),2),"
                     "'ded', round(coalesce(sum(amount) filter (where is_deduction),0),2))"
                     f" from public.v_books_audit_tiers where owner_id='{owner}'::uuid and year='{int(y)}'),"
                     "'raw', (select json_build_object('n', count(*), 'total', round(coalesce(sum(amount_value),0),2)) from public.v_financial_accounting_records v"
                     f" where v.owner_id='{owner}'::uuid and v.year='{int(y)}' and v.record_kind='retained_ledger_decision' and v.section='Expense' and v.amount_value is not null"
                     " and coalesce(v.status,'') not like 'Closed%' and coalesce(v.status,'') not like 'Open allocation%'),"
                     f"'roll', (select row_to_json(r) from public.v_books_audit_tier_years r where owner_id='{owner}'::uuid and year='{int(y)}'),"
                     "'excluded', (select coalesce(json_agg(json_build_object('id', local_id, 'amount', amount, 'rule', structural_rule) order by local_id), '[]'::json)"
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
        for k, v in (('total_usd', rw['total']), ('deduction_usd', rw['ded']), ('excluded_usd', rw['x']), ('a_usd', rw['a']), ('b_usd', rw['b']), ('c_usd', rw['c']),
                     ('b_nobank_usd', rw['bn'])):
            if abs(float(roll.get(k, 0)) - float(v)) > 0.005:
                p.append(f"rollup {k} {roll.get(k)} != rows {v}")
        if int(roll.get('excluded_n', 0)) != rw['nonded'] or int(roll.get('decisions', 0)) != rw['n'] or int(roll.get('b_nobank_n', 0)) != rw['bn_n']:
            p.append('rollup counts != rows')
        spec = float(expect[y]) if y in expect else None
        drift = '' if spec is None else ('' if abs(float(rw['total']) - spec) < 0.005 else f" | DRIFT from expected {spec:,.2f}: {float(rw['total']) - spec:+,.2f}")
        if drift:
            p.append(drift.strip(' |'))
        problems += [f'{y}: {x}' for x in p]
        print(y, 'rows', rw['n'], 'total', rw['total'], '= deduction', rw['ded'], '+ excluded', rw['x'], '| A', rw['a'], 'B', rw['b'], f"(no bank line {rw['bn']}, {rw['bn_n']} rows)",
              'C', rw['c'], drift, '|', 'OK' if not p else '; '.join(p))
        for e in t['excluded']:
            print(f"   excluded {e['id']} {e['amount']}: {e['rule']}")

    if a.with_gate:
        from books_year_gate_check import gate  # noqa: E402
        for y in a.years:
            g = gate(owner, y)
            r6 = next(r for r in g['rules'] if r['rule'] == 'R6')
            r10 = next(r for r in g['rules'] if r['rule'] == 'R10')
            if (r6['status'] == 'pass') != bool(reg.get(y)):
                problems.append(f"{y}: gate R6 {r6['status']} but v_books_asset_register year_r6_pass {reg.get(y)}")
            roll = sql_json(owner, f"select row_to_json(r) from public.v_books_audit_tier_years r where owner_id='{owner}'::uuid and year='{int(y)}'") or {}
            if r10.get('of') != roll.get('deductions') or abs(float(r10.get('b_no_bank', {}).get('amount', 0)) - float(roll.get('b_nobank_usd', 0))) > 0.005:
                problems.append(f"{y}: gate R10 deductions/b_no_bank differ from v_books_audit_tier_years")

    for n in notes:
        print('note:', n)
    for x in problems:
        print('FAIL:', x)
    print('books_audit_tiers_structural:', 'PASS' if not problems else f'FAIL ({len(problems)})')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
