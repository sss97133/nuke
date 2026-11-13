#!/usr/bin/env python3
"""Test: run public.books_year_gate(owner, year) for each year and print every rule's status, count, dollars and first ids.

Exit 1 when any rule fails or is not assessed (a tax year is trusted only when every rule passes). --report prints the
same table and exits 0. A failure is listed, never fixed here: fix it through the sanctioned writers, then rerun.

  dotenvx run -- python3 scripts/books/books_year_gate_check.py --owner <uuid> [--years 2022 2023 2024 2025] [--report] [--json out.json]
  dotenvx run -- python3 scripts/books/books_year_gate_check.py --owner <uuid> --record [--bound 120] [--pause 5]

--record stores each run in books_gate_runs through record_books_gate_run (service role), which is what the books docket reads: the
gate takes 8 to 30 s a year, so a page can never call it. Per year, one repeatable-read transaction reads the book's
signature and the gate's definition hash, runs the gate, reads the run's denominators (books_gate_context: the year's deduction
dollars, the deductions with no bank line, rule R10 part b and the head rule R12 tests) and writes the row, so the signature and the
denominators are exactly the book the gate saw.
The statement bound is explicit (120 s by default, 300 s at most, never 0). A year that hits the bound or fails writes a timed_out
or error row in a second transaction, so the docket says "Did not finish" instead of silence. Years run in sequence with a pause
between them; run it off intake hours (v_job_health) and after the last landing: any landing changes the book's signature and marks
every stored run stale, so land the filing state first (return_facts.py) and record the gate last.
"""
import argparse, datetime, json, os, re, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, q, uuid_ok  # noqa: E402
from books_check_sql import SERVICE, SERVICE_WRITER  # noqa: E402

WRITER = 'books_year_gate_check.py'
MAX_BOUND_S = 300


def gate(owner, year):
    out = psql("begin;\n" + SERVICE + f"select public.books_year_gate('{owner}'::uuid, {int(year)})::text;\nrollback;\n")
    return json.loads(next(l for l in out.splitlines() if l.startswith('{"') and '"rules"' in l))



def bound_seconds(value):
    """An explicit, finite statement bound: positive, at most MAX_BOUND_S. Never 0 (no limit)."""
    n = int(value)
    if not 1 <= n <= MAX_BOUND_S:
        raise SystemExit(f'--bound must be 1 to {MAX_BOUND_S} seconds (never 0)')
    return n


def record_sql(owner, year, bound_s):
    """One year in one repeatable-read transaction: signature, definition hash, the gate, the run's denominators (books_gate_context), then the row.
    The run's clock stops when the gate returns, so the stored duration is the gate's, not the gate's plus the context's. Prints the gate's JSON, then RUN <id>."""
    return ('begin isolation level repeatable read;\n'
            f"set local statement_timeout = '{bound_seconds(bound_s)}s';\nset local lock_timeout = '5s';\n" + SERVICE_WRITER +
            f"select public.books_book_signature('{owner}'::uuid) as sig \\gset\n"
            "select public.books_gate_md5() as md5 \\gset\n"
            "select clock_timestamp() as t0 \\gset\n"
            f"select public.books_year_gate('{owner}'::uuid, {int(year)})::text as res \\gset\n"
            "select clock_timestamp() as t1 \\gset\n"
            f"select public.books_gate_context('{owner}'::uuid, {int(year)})::text as ctx \\gset\n"
            "select :'res';\n"
            f"select 'RUN ' || public.record_books_gate_run('{owner}'::uuid, {int(year)}, 'complete', :'t0'::timestamptz, :'t1'::timestamptz, "
            f":'sig', :'md5', :'res'::jsonb, NULL, '{WRITER}', :'ctx'::jsonb);\n"
            'commit;\n')


def failure_sql(owner, year, status, started, finished, error):
    """The second transaction after a run that did not finish: the reason, with the signature and hash as they are now."""
    return ('begin;\n' + SERVICE_WRITER +
            f"select 'RUN ' || public.record_books_gate_run('{owner}'::uuid, {int(year)}, '{status}', {q(started)}::timestamptz, {q(finished)}::timestamptz, "
            f"public.books_book_signature('{owner}'::uuid), public.books_gate_md5(), NULL, {q(error)}, '{WRITER}');\n"
            'commit;\n')


def classify_failure(message):
    return 'timed_out' if re.search(r'statement timeout|canceling statement|lock timeout', message, re.I) else 'error'


def short_error(message, bound_s):
    """What the page may say: the server's error line, bounded; never a connection string or a stack of context."""
    line = next((l.strip() for l in message.splitlines() if 'ERROR:' in l), '') or (message.strip().splitlines() or ['unknown error'])[-1]
    line = re.sub(r'^.*?ERROR:\s*', '', line)[:300]
    return f'stopped at {bound_s} s: {line}' if classify_failure(message) == 'timed_out' else line


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds')


def record_year(owner, year, bound_s):
    """Run the gate for one year and store the attempt. Returns (gate JSON or None, run id, status)."""
    started = utc_now()
    try:
        out = psql(record_sql(owner, year, bound_s))
    except RuntimeError as failure:
        status = classify_failure(str(failure))
        out = psql(failure_sql(owner, year, status, started, utc_now(), short_error(str(failure), bound_s)))
        return None, next(l[4:] for l in out.splitlines() if l.startswith('RUN ')), status
    g = json.loads(next(l for l in out.splitlines() if l.startswith('{"') and '"rules"' in l))
    return g, next(l[4:] for l in out.splitlines() if l.startswith('RUN ')), 'complete'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', required=True)
    ap.add_argument('--years', nargs='+', default=['2022', '2023', '2024', '2025'])
    ap.add_argument('--report', action='store_true')
    ap.add_argument('--json')
    ap.add_argument('--record', action='store_true', help='store each run in books_gate_runs (what the books docket reads)')
    ap.add_argument('--bound', type=int, default=120, help='statement bound in seconds for --record (1-300, never 0)')
    ap.add_argument('--pause', type=int, default=5, help='seconds to wait between years with --record')
    a = ap.parse_args()
    owner, results, bad = uuid_ok(a.owner), {}, 0
    if a.record:
        bound_seconds(a.bound)
    for i, y in enumerate(a.years):
        if a.record:
            if i:
                time.sleep(max(0, a.pause))
            g, run_id, status = record_year(owner, y, a.bound)
            if g is None:
                results[y] = {'status': status}
                bad += 1
                print(f"{y} NOT FINISHED {status} (bound {a.bound} s), recorded as run {run_id}")
                continue
            print(f"{y} recorded as run {run_id}")
        else:
            g = gate(owner, y)
        results[y] = g
        for r in g['rules']:
            bad += r['status'] != 'pass'
            of = f" of {r['of']}" if r.get('of') is not None else ''
            amt = f" ${float(r['amount']):,.2f}" if r.get('amount') is not None else ''
            print(f"{y} {r['rule']:<4} {r['status']:<12} {r['n']}{of}{amt}  {r['title']}"
                  + (f" | {r['detail']}" if r.get('detail') else '') + (f" | grades {r['grades']}" if r.get('grades') else '')
                  + (f" | first: {', '.join(map(str, r['ids'][:3]))}" if r.get('ids') else ''))
    if a.json:
        json.dump(results, open(a.json, 'w'), indent=1)
    print('books_year_gate:', 'PASS' if not bad else f'FAIL ({bad} rule-years not passing)')
    sys.exit(0 if a.report or not bad else 1)


if __name__ == '__main__':
    main()
