#!/usr/bin/env python3
"""Test: books_year_gate R8b recomputes the EIC from the stored credit inputs and the IRS table, and matches the returns.

Asserts, against the live data (read-only, in a transaction that is rolled back). No return figure is written here: the expected
values come from the stored credit:<year> cells (the claim) and from the public IRS parameter rows.
  - books_eic_parameters holds 2023, 2024 and 2025 for both filing statuses and 0 to 3 children, each row with a Revenue Procedure URL,
    and every row's completed phase-out equals phase-out start + maximum credit / rate within $5
  - books_eic_amount reproduces cells printed in the IRS EIC Tables (Form 1040 instructions), including the lines that hold the earned
    income amount and the phase-out start
  - for each year with a stored claim, R8b assesses the EIC and the recomputation equals the stored claim (a pass, with no EIC finding or gap)
  - gates and amount on the 2024 inputs changed one at a time: spouse days -> 0; a child with 3 months -> one qualifying child;
    investment income above the limit -> 0; owner days -> 0; AGI and earned income 40,000 -> the phase-out amount; AGI below the
    phase-out start with higher earned income -> the credit on earned income (Worksheet A); each against the stored claim -> 'differs'
Exit 1 on any mismatch.

  dotenvx run -- python3 scripts/books/books_eic_gate_check.py --owner <uuid> [--migration supabase/migrations/20261104200000_books_eic_gate.sql]

--migration applies that file inside the rolled-back transaction first, to prove a migration that is not deployed yet.
"""
import argparse, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, uuid_ok  # noqa: E402

# Printed cells of the IRS EIC Tables (Form 1040 instructions): (income at the start of the $50 line, parameter row, printed credit).
TABLE_CELLS = (
    (34000, "(2024, 'mfj', 2)", 6037),       # 2024 joint, 2 children, in the phase-out
    (34000, "(2024, 'mfj', 3)", 6907),
    (12350, "(2024, 'single_hoh_qss', 1)", 4213),  # the line holding the earned income amount
    (12350, "(2024, 'mfj', 1)", 4213),
    (40000, "(2024, 'mfj', 2)", 4773),       # in the phase-out
    (17850, "(2025, 'single_hoh_qss', 2)", 7152),  # the line holding the earned income amount
    (17850, "(2025, 'single_hoh_qss', 3)", 8046),
    (28100, "(2023, 'mfj', 3)", 7430),       # the line holding the phase-out start
)

PRE = "begin;\nset local statement_timeout='60s';\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"


def run(owner, migration, years):
    sql = PRE + (open(migration).read() + "\n" if migration else '')
    sql += "".join(f"select 'GATE{y}|' || public.books_year_gate('{owner}'::uuid, {y})::text;\n" for y in years)
    cell = (f"(select e.value_normalized->'value' from public.financial_document_extractions e join public.financial_documents d "
            f"on d.id = e.document_id and d.owner_id = '{owner}'::uuid and d.source_filename = 'books-register-inputs.txt' "
            f"where e.owner_id = '{owner}'::uuid and not e.is_superseded and e.field_key = 'credit:2024' order by e.created_at desc limit 1)")
    for y in years:
        c = cell.replace("credit:2024", f"credit:{y}")
        sql += f"select 'CLAIM{y}|' || coalesce({c}->>'eic', '');\n"
    sql += ("select 'PARAMS|' || (select json_build_object('n', count(*), 'years', array_agg(distinct tax_year), 'no_url', count(*) filter (where source_url !~ '^https://www.irs.gov/pub/irs-drop/rp-'),"
            "'bad_phaseout', count(*) filter (where abs(phaseout_start + max_credit / phaseout_rate - completed_phaseout) > 5)) from public.books_eic_parameters)::text;\n")
    sql += ("select 'ROW|' || (select json_agg(json_build_object('q', qualifying_children, 'max', max_credit, 'ps', phaseout_start, 'rate', phaseout_rate) order by qualifying_children) "
            "from public.books_eic_parameters where tax_year = 2024 and filing_status = 'mfj')::text;\n")
    # IRS EIC Table cells: (income, pct, earned income amount, maximum, phase-out start, rate) -> printed credit. Public IRS figures.
    for i, (inc, row, _) in enumerate(TABLE_CELLS):
        sql += (f"select 'TAB|{i}|' || public.books_eic_amount({inc}, p.credit_pct, p.earned_income_amount, p.max_credit, p.phaseout_start, p.phaseout_rate)::text "
                f"from public.books_eic_parameters p where (p.tax_year, p.filing_status, p.qualifying_children) = {row};\n")
    # The 2024 cell with inputs changed. Spouse and child keys are found by shape, as the function finds them.
    def mod(cond, val):
        return (f"(select jsonb_object_agg(t.k, case when {cond} then to_jsonb({val}) else t.v end) from jsonb_each({cell}) as t(k, v))")
    def mod2(pairs):
        arms = ' '.join(f"when t.k = '{k}' then to_jsonb({v})" for k, v in pairs)
        return f"(select jsonb_object_agg(t.k, case {arms} else t.v end) from jsonb_each({cell}) as t(k, v))"
    first_child = f"(select min(k2) from jsonb_object_keys({cell}) k2 where k2 ~ '_months_us$')"
    cases = (('base', cell),
             ('spouse_days', mod("t.k ~ '_us_days$' and t.k !~ '^(owner|children)_'", 100)),
             ('one_child_3_months', mod(f"t.k = {first_child}", 3)),
             ('investment', mod("t.k = 'investment_income'", 12000)),
             ('agi_40000', mod("t.k in ('agi', 'earned_income')", 40000)),
             ('agi_below_start', mod2((('earned_income', 20000), ('agi', 15000)))),
             ('owner_days', mod("t.k = 'owner_us_days'", 100)))
    for name, expr in cases:
        sql += f"select 'CASE|{name}|' || public.books_eic_recompute({expr}, 2024)::text;\n"
    sql += "rollback;\n"
    out = psql(sql)
    gates, cases, params, claims, rows, tab = {}, {}, None, {}, None, {}
    for l in out.splitlines():
        if l.startswith('GATE'):
            gates[l[4:8]] = json.loads(l[9:])
        elif l.startswith('CASE|'):
            _, n, j = l.split('|', 2)
            cases[n] = json.loads(j)
        elif l.startswith('CLAIM'):
            claims[l[5:9]] = l[10:]
        elif l.startswith('ROW|'):
            rows = json.loads(l[4:])
        elif l.startswith('TAB|'):
            _, i, v = l.split('|')
            tab[int(i)] = float(v)
        elif l.startswith('PARAMS|'):
            params = json.loads(l[7:])
    return gates, cases, params, claims, rows, tab


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', required=True)
    ap.add_argument('--migration')
    a = ap.parse_args()
    owner = uuid_ok(a.owner)
    gates, cases, params, claims, rows, tab = run(owner, a.migration, [2024, 2025])
    problems = []

    def check(ok, msg):
        print(('ok   ' if ok else 'FAIL ') + msg)
        if not ok:
            problems.append(msg)

    check(params and params['n'] == 24 and params['years'] == [2023, 2024, 2025], f"parameters: {params}")
    check(params and params['no_url'] == 0 and params['bad_phaseout'] == 0, 'every parameter row cites a Revenue Procedure and its completed phase-out agrees')
    for i, (inc, row, want) in enumerate(TABLE_CELLS):
        check(tab.get(i) == want, f"IRS EIC Table, income {inc}, {row}: printed {want}, computed {tab.get(i)}")
    for y in ('2024', '2025'):
        claim = claims.get(y)
        r8b = next(r for r in gates[y]['rules'] if r['rule'] == 'R8b')
        m = re.search(r'EIC (\d+) recomputed', r8b['detail'])
        check(bool(claim) and m is not None and m.group(1) == str(int(float(claim))), f"{y} R8b recomputes the stored EIC claim: {r8b['status']} | {r8b['detail'][:90]}")
        check(r8b['status'] == 'pass' and 'EIC' not in r8b['detail'].split('not assessed:')[1] and 'EIC' not in r8b['detail'].split('differs:')[1].split('| not assessed')[0],
              f"{y} R8b is pass with no EIC finding or gap")
    claim24 = float(claims['2024'])
    by_q = {r['q']: r for r in rows}
    base = cases.get('base', {})
    check(base.get('status') == 'pass' and base.get('computed') == claim24, f"base 2024 inputs: {base.get('status')} computed equals the stored claim")
    for name in ('spouse_days', 'investment', 'owner_days'):
        c = cases.get(name, {})
        check(c.get('computed') == 0 and c.get('status') == 'differs', f"{name}: computed {c.get('computed')} against the stored claim -> {c.get('status')}")
    c = cases.get('one_child_3_months', {})
    check(c.get('computed') == by_q[1]['max'] and c.get('status') == 'differs', f"one child under 7 months: computed {c.get('computed')} (one qualifying child, the table maximum {by_q[1]['max']}) -> {c.get('status')}")
    r2 = by_q[2]
    want = round(r2['max'] - r2['rate'] * (40025 - r2['ps']))
    c = cases.get('agi_40000', {})
    check(c.get('computed') == want and c.get('status') == 'differs', f"earned income and AGI 40,000: computed {c.get('computed')} (maximum less the phase-out rate on 40,025 less the start = {want}) -> {c.get('status')}")
    c = cases.get('agi_below_start', {})
    check(c.get('computed') == r2['max'] and c.get('status') in ('pass', 'differs'), f"AGI below the phase-out start, higher earned income: computed {c.get('computed')} = the maximum {r2['max']} (AGI not looked up)")
    print('books_eic_gate:', 'PASS' if not problems else f'FAIL ({len(problems)})')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
