#!/usr/bin/env python3
"""Test: run public.books_year_gate(owner, year) for each year and print every rule's status, count, dollars and first ids,
then the citations table (payment proof x purpose proof, dollars) from public.books_year_citations.

Exit 1 when any rule fails or is not assessed (a tax year is trusted only when every rule passes). --report prints the
same table and exits 0. A failure is listed, never fixed here: fix it through the sanctioned writers, then rerun.

  dotenvx run -- python3 scripts/books/books_year_gate_check.py --owner <uuid> [--years 2022 2023 2024 2025] [--report] [--json out.json]
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, uuid_ok  # noqa: E402


def gate(owner, year):
    out = psql("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
               f"select public.books_year_gate('{owner}'::uuid, {int(year)})::text;\nrollback;\n")
    return json.loads(next(l for l in out.splitlines() if l.startswith('{"') and '"rules"' in l))


def citations(owner, year):
    out = psql("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
               f"select public.books_year_citations('{owner}'::uuid, {int(year)})::text;\nrollback;\n")
    return json.loads(next(l for l in out.splitlines() if l.startswith('{"') and '"by_citation"' in l))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', required=True)
    ap.add_argument('--years', nargs='+', default=['2022', '2023', '2024', '2025'])
    ap.add_argument('--report', action='store_true')
    ap.add_argument('--json')
    a = ap.parse_args()
    owner, results, bad = uuid_ok(a.owner), {}, 0
    for y in a.years:
        g = results[y] = gate(owner, y)
        for r in g['rules']:
            bad += r['status'] != 'pass'
            of = f" of {r['of']}" if r.get('of') is not None else ''
            amt = f" ${float(r['amount']):,.2f}" if r.get('amount') is not None else ''
            print(f"{y} {r['rule']:<4} {r['status']:<12} {r['n']}{of}{amt}  {r['title']}"
                  + (f" | {r['detail']}" if r.get('detail') else '') + (f" | grades {r['grades']}" if r.get('grades') else '')
                  + (f" | first: {', '.join(map(str, r['ids'][:3]))}" if r.get('ids') else ''))
        c = g['citations'] = citations(owner, y)
        bc = c['by_citation'] or {}
        print(f"{y} citations: " + ', '.join(f"{k} {v['n']} ${float(v['amount']):,.2f}" for k, v in sorted(bc.items()))
              + f" | searching {c['searching']['n']} ${float(c['searching']['amount']):,.2f} | cash expenses lacking a side {len(c['cash_gaps'])}")
        for t in c['table']:
            print(f"   {t['payment_proof']:<16} x {t['purpose_proof']:<22} {t['n']:>5}  ${float(t['amount']):>12,.2f}")
    if a.json:
        json.dump(results, open(a.json, 'w'), indent=1)
    print('books_year_gate:', 'PASS' if not bad else f'FAIL ({bad} rule-years not passing)')
    sys.exit(0 if a.report or not bad else 1)


if __name__ == '__main__':
    main()
