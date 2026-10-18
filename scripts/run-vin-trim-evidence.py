#!/usr/bin/env python3
"""
Page public.record_vin_trim_evidence over every vehicle with a decoded VIN trim.

Usage:
  dotenvx run -- python3 scripts/run-vin-trim-evidence.py [--batch 100] [--max-batches N] [--after UUID]
"""
import argparse
import importlib.util
import os
import time

spec = importlib.util.spec_from_file_location(
    "cab_backfill", os.path.join(os.path.dirname(os.path.abspath(__file__)), "backfill-cab-taxonomy-and-outcomes.py")
)
cab_backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cab_backfill)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=100)
    parser.add_argument("--max-batches", type=int, default=0)
    parser.add_argument("--after", default=None)
    args = parser.parse_args()

    conn = cab_backfill.connect_db()
    cur = conn.cursor()
    after = args.after
    totals = {"scanned": 0, "single_trim": 0, "evidence_accepted": 0, "evidence_pending": 0, "trim_filled": 0}
    t0 = time.time()
    n = 0
    while True:
        for attempt in range(5):
            try:
                cur.execute("SET LOCAL statement_timeout = '55s';")
                cur.execute("SELECT public.record_vin_trim_evidence(%s::uuid, %s)", (after, args.batch))
                r = cur.fetchone()[0]
                conn.commit()
                break
            except Exception as err:
                conn.rollback()
                print(f"  [retry {attempt + 1}/5 after {after}] {err}", flush=True)
                time.sleep(2 + 2 * attempt)
                if conn.closed:
                    conn = cab_backfill.connect_db()
                    cur = conn.cursor()
        else:
            raise RuntimeError(f"batch after {after} failed after 5 attempts")
        if not r["scanned"]:
            break
        for k in totals:
            totals[k] += int(r[k] or 0)
        after = r["last_vehicle_id"]
        n += 1
        if n % 20 == 0:
            print(f"  batch {n} after={after} {totals} {time.time() - t0:.0f}s", flush=True)
        if args.max_batches and n >= args.max_batches:
            break
    print(f"done after={after}: {totals} in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
