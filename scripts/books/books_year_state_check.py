#!/usr/bin/env python3
"""Test: public.books_year_state(owner, year) Schedule C line 31 equals the drift-check totals, per schedule, for each year.

The drift-check totals are schedule_c_rulings.lines_by_schedule (what db-books/drift_check.py compares every built return
against). A difference means the read API and the return builders disagree; fix the reader, never the expected number.
Also fails when a year has ledger categories with no Schedule C line, or no return result.

  dotenvx run -- python3 scripts/books/books_year_state_check.py --owner <uuid> --line-map line-map.json [--years 2022 2023 2024 2025]
"""
import argparse, json, os, sys
from decimal import Decimal as D

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, uuid_ok, lines_by_schedule  # noqa: E402


def year_state(owner, year):
    out = psql("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
               f"select public.books_year_state('{owner}'::uuid, {int(year)})::text;\nrollback;\n")
    return json.loads(next(l for l in out.splitlines() if l.startswith('{"') and '"schedule_c"' in l))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', required=True)
    ap.add_argument('--line-map', required=True)
    ap.add_argument('--years', nargs='+', default=['2022', '2023', '2024', '2025'])
    a = ap.parse_args()
    owner, line_map, bad = uuid_ok(a.owner), json.load(open(a.line_map)), 0
    for y in a.years:
        want = {s: v['31'] for s, v in lines_by_schedule(owner, y, line_map).items()}
        st = year_state(owner, y)
        got = {s: D(str(v['31'])) for s, v in st['schedule_c'].items()}
        r = st.get('result') or {}
        ok = want == got and not st['unmapped'] and r.get('amount') is not None
        bad += not ok
        print(f"{y}: {'PASS' if ok else 'FAIL'} line 31 api {({k: str(v) for k, v in got.items()})} drift {({k: str(v) for k, v in want.items()})}"
              f" | {r.get('form')} {r.get('result')} {r.get('amount')} ({r.get('from')}) | rulings {len(st['rulings'])}"
              f" facts {len(st['facts'])} open {len(st['open_items'])}{' | unmapped ' + str(st['unmapped']) if st['unmapped'] else ''}")
    print('books_year_state check:', 'FAIL' if bad else 'PASS')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
