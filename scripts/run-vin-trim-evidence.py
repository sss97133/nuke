#!/usr/bin/env python3
"""
Page public.record_vin_trim_evidence over every vehicle with a decoded VIN trim.

Resumable: after every committed batch the last vehicle id and running totals are written to --checkpoint, and a
run without --after resumes from it. A run that pages to the end writes --done-file, which is the only signal that
the whole population was covered (a crash or a --max-seconds phase end leaves no done file).

A dropped connection (database restart, pooler timeout) is reconnected and the batch retried; the batch is a single
transaction, so a retry after a lost connection repeats nothing that committed.

Usage:
  dotenvx run -- python3 scripts/run-vin-trim-evidence.py [--batch 25] [--sleep 2] [--max-seconds N]
      [--checkpoint vin.checkpoint.json] [--done-file vin.done] [--after UUID]
"""
import argparse
import importlib.util
import json
import os
import sys
import time

spec = importlib.util.spec_from_file_location(
    "cab_backfill", os.path.join(os.path.dirname(os.path.abspath(__file__)), "backfill-cab-taxonomy-and-outcomes.py")
)
cab_backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cab_backfill)

TOTAL_KEYS = ("scanned", "single_trim", "evidence_accepted", "evidence_pending", "trim_filled")


def read_checkpoint(path):
    if not path or not os.path.exists(path):
        return None, {k: 0 for k in TOTAL_KEYS}
    with open(path) as f:
        cp = json.load(f)
    return cp.get("after"), {k: int(cp.get("totals", {}).get(k, 0)) for k in TOTAL_KEYS}


def write_checkpoint(path, after, totals):
    if not path:
        return
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"after": after, "totals": totals, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f)
    os.replace(tmp, path)


def run_batch(conn, after, batch):
    cur = conn.cursor()
    cur.execute("SET LOCAL statement_timeout = '55s';")
    cur.execute("SELECT public.record_vin_trim_evidence(%s::uuid, %s)", (after, batch))
    r = cur.fetchone()[0]
    conn.commit()
    return r


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=25)
    parser.add_argument("--sleep", type=float, default=2.0, help="seconds between batches")
    parser.add_argument("--max-batches", type=int, default=0)
    parser.add_argument("--max-seconds", type=int, default=0, help="end this phase cleanly after N seconds")
    parser.add_argument("--after", default=None, help="start after this vehicle id (overrides the checkpoint)")
    parser.add_argument("--checkpoint", default=None)
    parser.add_argument("--done-file", default=None)
    args = parser.parse_args()

    cp_after, totals = read_checkpoint(args.checkpoint)
    after = args.after or cp_after
    print(f"start after={after} totals={totals}", flush=True)

    conn = cab_backfill.connect_db()
    t0 = time.time()
    n = 0
    while True:
        for attempt in range(6):
            try:
                r = run_batch(conn, after, args.batch)
                break
            except Exception as err:
                print(f"  [retry {attempt + 1}/6 after {after}] {str(err).splitlines()[0]}", flush=True)
                try:
                    if not conn.closed:
                        conn.rollback()
                except Exception:
                    pass
                time.sleep(5 * (attempt + 1))
                if conn.closed or attempt >= 2:
                    try:
                        conn.close()
                    except Exception:
                        pass
                    conn = cab_backfill.connect_db()
        else:
            write_checkpoint(args.checkpoint, after, totals)
            print(f"stopping: batch after {after} failed 6 times; resume from the checkpoint", flush=True)
            sys.exit(2)

        if not r["scanned"]:
            write_checkpoint(args.checkpoint, after, totals)
            if args.done_file:
                with open(args.done_file, "w") as f:
                    json.dump({"after": after, "totals": totals, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f)
            print(f"done after={after}: {totals} in {time.time() - t0:.0f}s", flush=True)
            return
        for k in TOTAL_KEYS:
            totals[k] += int(r[k] or 0)
        after = r["last_vehicle_id"]
        write_checkpoint(args.checkpoint, after, totals)
        n += 1
        if n % 20 == 0:
            print(f"  batch {n} after={after} {totals} {time.time() - t0:.0f}s", flush=True)
        if args.max_batches and n >= args.max_batches:
            break
        if args.max_seconds and time.time() - t0 >= args.max_seconds:
            break
        time.sleep(args.sleep)
    print(f"phase end after={after}: {totals} in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
