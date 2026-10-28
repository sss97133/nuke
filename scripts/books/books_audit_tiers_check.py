#!/usr/bin/env python3
"""Test: v_books_audit_tiers partitions each year's deductions exactly once, and books_year_gate R10 reports the same dollars.

For each year: A + B + C dollars equal the year's total, the rollup view equals the row view, and R10's detail names the same
total. Exit 1 on any mismatch. R10 itself may fail (that is the finding); this test checks the machinery, not the books.

  dotenvx run -- python3 scripts/books/books_audit_tiers_check.py --owner <uuid> [--years 2022 2023 2024 2025]
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, uuid_ok  # noqa: E402
from books_year_gate_check import gate  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', required=True)
    ap.add_argument('--years', nargs='+', default=['2022', '2023', '2024', '2025'])
    a = ap.parse_args()
    owner, bad = uuid_ok(a.owner), 0
    for y in a.years:
        out = psql("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
                   "select json_build_object('rows', (select json_build_object('n', count(*), 'total', round(coalesce(sum(amount),0),2),"
                   "'a', round(coalesce(sum(amount) filter (where tier='A'),0),2), 'b', round(coalesce(sum(amount) filter (where tier='B'),0),2),"
                   "'c', round(coalesce(sum(amount) filter (where tier='C'),0),2), 'other', count(*) filter (where tier not in ('A','B','C')))"
                   f" from public.v_books_audit_tiers where owner_id='{owner}'::uuid and year='{int(y)}'),"
                   f"'roll', (select row_to_json(r) from public.v_books_audit_tier_years r where owner_id='{owner}'::uuid and year='{int(y)}'))::text;\nrollback;\n")
        j = json.loads(next(l for l in out.splitlines() if l.startswith('{"rows"')))
        rows, roll = j['rows'], j['roll'] or {}
        r10 = next(r for r in gate(owner, y)['rules'] if r['rule'] == 'R10')
        problems = []
        if rows['other']: problems.append(f"{rows['other']} rows outside A/B/C")
        if abs(float(rows['a']) + float(rows['b']) + float(rows['c']) - float(rows['total'])) > 0.005: problems.append('A+B+C != total')
        if rows['n'] and (float(roll.get('total_usd', 0)) != float(rows['total']) or int(roll.get('decisions', 0)) != rows['n']): problems.append('rollup != rows')
        if rows['n'] and r10['status'] == 'not_assessed': problems.append('R10 not assessed despite rows')
        if rows['n'] and r10.get('of') != rows['n']: problems.append(f"R10 of {r10.get('of')} != {rows['n']}")
        if not rows['n'] and r10['status'] != 'not_assessed': problems.append('R10 assessed with no rows')
        bad += bool(problems)
        print(y, 'n', rows['n'], 'total', rows['total'], 'A', rows['a'], 'B', rows['b'], 'C', rows['c'], '| R10', r10['status'], r10['n'], '|', 'OK' if not problems else '; '.join(problems))
    print('books_audit_tiers:', 'PASS' if not bad else f'FAIL ({bad} years)')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
