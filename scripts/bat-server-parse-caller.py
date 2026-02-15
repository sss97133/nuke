#!/usr/bin/env python3
"""
Server-side BaT archive parser caller.

Calls the PostgreSQL function parse_bat_archive_fill() for each vehicle.
No HTML transferred over the network - all parsing happens inside PostgreSQL.

Usage:
  python3 scripts/bat-server-parse-caller.py [--limit 200000] [--page-size 5000]
  python3 scripts/bat-server-parse-caller.py --limit 100   # small test run
"""
import sys
import time
import argparse
import threading
from collections import defaultdict

try:
    import psycopg2
except ImportError:
    print("Installing psycopg2-binary...", file=sys.stderr)
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'psycopg2-binary', '-q'])
    import psycopg2

DB_URL = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"


def main():
    parser = argparse.ArgumentParser(
        description="Call server-side parse_bat_archive_fill() for sparse BaT vehicles"
    )
    parser.add_argument('--limit', type=int, default=200000,
                        help="Max vehicles to process (default: 200000)")
    parser.add_argument('--page-size', type=int, default=5000,
                        help="Page size for loading vehicle IDs (default: 5000)")
    parser.add_argument('--offset', type=int, default=0,
                        help="Starting offset for vehicle ID query (default: 0)")
    parser.add_argument('--all', action='store_true',
                        help="Process ALL BaT vehicles, not just sparse ones")
    parser.add_argument('--workers', type=int, default=4,
                        help="Number of parallel DB connections (default: 4)")
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    # Verify the function exists
    cur.execute("""
        SELECT 1 FROM pg_proc
        WHERE proname = 'parse_bat_archive_fill'
    """)
    if not cur.fetchone():
        print("ERROR: Function parse_bat_archive_fill() not found in database!", file=sys.stderr)
        print("Run the migration first:", file=sys.stderr)
        print("  psql < supabase/migrations/20260214_bat_server_side_parser.sql", file=sys.stderr)
        sys.exit(1)

    # Load vehicle IDs (paginated to avoid timeout)
    print(f"[{time.strftime('%H:%M:%S')}] Loading BaT vehicle IDs (page_size={args.page_size})...", file=sys.stderr)
    vehicles = []
    offset = args.offset

    if args.all:
        # Process ALL BaT vehicles regardless of sparseness
        query = """
            SELECT v.id FROM vehicles v
            WHERE COALESCE(v.listing_source, v.platform_source, v.source) IN ('bringatrailer', 'bat_simple_extract', 'bat')
              AND v.listing_url IS NOT NULL
              AND v.listing_url LIKE '%%bringatrailer.com/listing/%%'
            ORDER BY v.id LIMIT %s OFFSET %s
        """
    else:
        # Only vehicles missing key fields
        query = """
            SELECT v.id FROM vehicles v
            WHERE COALESCE(v.listing_source, v.platform_source, v.source) IN ('bringatrailer', 'bat_simple_extract', 'bat')
              AND v.listing_url IS NOT NULL
              AND v.listing_url LIKE '%%bringatrailer.com/listing/%%'
              AND (v.description IS NULL OR v.mileage IS NULL OR v.vin IS NULL
                   OR v.color IS NULL OR v.sale_price IS NULL OR v.transmission IS NULL)
            ORDER BY v.id LIMIT %s OFFSET %s
        """

    while len(vehicles) < args.limit:
        cur.execute(query, (args.page_size, offset))
        page = [r[0] for r in cur.fetchall()]
        if not page:
            break
        vehicles.extend(page)
        offset += args.page_size
        print(f"  ... {len(vehicles)} vehicles loaded", file=sys.stderr)

    vehicles = vehicles[:args.limit]
    mode = "ALL" if args.all else "sparse"
    n_workers = args.workers
    print(f"[{time.strftime('%H:%M:%S')}] Processing {len(vehicles)} {mode} vehicles with {n_workers} workers...", file=sys.stderr)

    if not vehicles:
        print("No vehicles to process.", file=sys.stderr)
        conn.close()
        return

    # Shared counters (protected by lock)
    lock = threading.Lock()
    counters = defaultdict(int)  # total, updated, errors, vin_dupes, no_html
    start = time.time()

    def worker(worker_id, chunk):
        """Process a chunk of vehicle IDs using its own DB connection."""
        w_conn = psycopg2.connect(DB_URL)
        w_conn.autocommit = True
        w_cur = w_conn.cursor()
        local_total = local_updated = local_errors = local_vin = local_nohtml = 0
        consecutive_errors = 0

        for vid in chunk:
            local_total += 1
            try:
                w_cur.execute("SELECT parse_bat_archive_fill(%s)", (str(vid),))
                result = w_cur.fetchone()[0]
                consecutive_errors = 0  # reset on success
                if result is None or result == 0:
                    local_nohtml += 1
                elif result == -1:
                    local_vin += 1
                elif result > 0:
                    local_updated += 1
            except Exception as e:
                local_errors += 1
                consecutive_errors += 1
                if local_errors <= 5:
                    print(f"  W{worker_id} ERROR [{vid}]: {e}", file=sys.stderr)
                # Reconnect if connection is broken
                try:
                    w_conn.rollback()
                except Exception:
                    pass
                if consecutive_errors >= 3:
                    # Connection is likely dead — reconnect
                    try:
                        w_cur.close()
                        w_conn.close()
                    except Exception:
                        pass
                    try:
                        time.sleep(2)
                        w_conn = psycopg2.connect(DB_URL)
                        w_conn.autocommit = True
                        w_cur = w_conn.cursor()
                        consecutive_errors = 0
                        print(f"  W{worker_id} reconnected after {local_errors} errors", file=sys.stderr)
                    except Exception as re:
                        print(f"  W{worker_id} RECONNECT FAILED: {re}", file=sys.stderr)
                        break  # give up on this worker

            # Update shared counters every 50 vehicles
            if local_total % 50 == 0:
                with lock:
                    counters['total'] += 50
                    counters['updated'] += local_updated
                    counters['errors'] += local_errors
                    counters['vin_dupes'] += local_vin
                    counters['no_html'] += local_nohtml
                local_updated = local_errors = local_vin = local_nohtml = 0

        # Flush remaining
        with lock:
            remainder = local_total % 50
            counters['total'] += remainder
            counters['updated'] += local_updated
            counters['errors'] += local_errors
            counters['vin_dupes'] += local_vin
            counters['no_html'] += local_nohtml

        try:
            w_cur.close()
            w_conn.close()
        except Exception:
            pass

    # Split vehicles into chunks for workers
    chunk_size = (len(vehicles) + n_workers - 1) // n_workers
    chunks = [vehicles[i:i + chunk_size] for i in range(0, len(vehicles), chunk_size)]

    # Start progress reporter
    def progress_reporter():
        while not done_event.is_set():
            done_event.wait(timeout=60)
            with lock:
                t = counters['total']
                u = counters['updated']
                e = counters['errors']
                vd = counters['vin_dupes']
                nh = counters['no_html']
            if t > 0:
                elapsed = time.time() - start
                rate = t / max(elapsed, 1)
                remaining = (len(vehicles) - t) / max(rate, 0.01)
                pct = 100.0 * t / len(vehicles)
                print(
                    f"[{time.strftime('%H:%M:%S')}] "
                    f"{t}/{len(vehicles)} ({pct:.1f}%) | "
                    f"Updated: {u} | No HTML: {nh} | "
                    f"VIN dupes: {vd} | Errors: {e} | "
                    f"{rate:.1f}/sec | ~{int(remaining // 60)}m left",
                    file=sys.stderr
                )

    done_event = threading.Event()
    reporter = threading.Thread(target=progress_reporter, daemon=True)
    reporter.start()

    # Launch workers
    threads = []
    for i, chunk in enumerate(chunks):
        t = threading.Thread(target=worker, args=(i, chunk))
        t.start()
        threads.append(t)
        print(f"  Worker {i}: {len(chunk)} vehicles", file=sys.stderr)

    # Wait for all workers
    for t in threads:
        t.join()
    done_event.set()

    elapsed = time.time() - start
    t = counters['total']
    u = counters['updated']
    e = counters['errors']
    vd = counters['vin_dupes']
    nh = counters['no_html']
    print(f"\n{'='*60}", file=sys.stderr)
    print(f"[{time.strftime('%H:%M:%S')}] COMPLETE", file=sys.stderr)
    print(f"  Total processed:  {t}", file=sys.stderr)
    print(f"  Fields updated:   {u} ({100*u/max(t,1):.1f}%)", file=sys.stderr)
    print(f"  No HTML found:    {nh}", file=sys.stderr)
    print(f"  VIN dupes:        {vd}", file=sys.stderr)
    print(f"  Errors:           {e}", file=sys.stderr)
    print(f"  Duration:         {int(elapsed//60)}m{int(elapsed%60):02d}s", file=sys.stderr)
    print(f"  Rate:             {t/max(elapsed,1):.1f} vehicles/sec", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)

    conn.close()


if __name__ == '__main__':
    main()
