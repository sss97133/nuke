#!/usr/bin/env python3
"""
MSRP Enrichment Pipeline
========================
Enriches vehicles.msrp from oem_trim_levels reference data.

Strategy (in priority order):
  1. EXACT TRIM MATCH: vehicles.trim = oem_trim_levels.trim_name
     (case-insensitive, using normalized_model or raw model for model_family match)
  2. FUZZY TRIM MATCH: vehicles.trim ILIKE any oem_trim_levels.trim_name
     (catches "SS 396" matching "SS", "GT350" matching "Shelby GT350")
  3. MODEL-LEVEL FALLBACK: Average base_msrp_usd across all trims for that
     make + model_family + year range (labeled "oem_model_avg")

Only fills vehicles where msrp IS NULL (COALESCE behavior).
Sets msrp_source to distinguish match quality.

Usage:
  cd /Users/skylar/nuke
  dotenvx run -- python3 scripts/enrich-msrp.py
  dotenvx run -- python3 scripts/enrich-msrp.py --dry-run
  dotenvx run -- python3 scripts/enrich-msrp.py --limit 500
  dotenvx run -- python3 scripts/enrich-msrp.py --make Porsche
  dotenvx run -- python3 scripts/enrich-msrp.py --strategy exact  # only exact trim
  dotenvx run -- python3 scripts/enrich-msrp.py --strategy model  # skip to model-avg

DB connection: Uses DATABASE_URL env var, or falls back to hardcoded pooler URL.
"""

import argparse
import os
import sys
import time
from collections import defaultdict

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 not installed. Run: pip3 install psycopg2-binary")
    sys.exit(1)

# ── Config ───────────────────────────────────────────────────────────────────

_POOLER_URL = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"

_env_url = os.environ.get("DATABASE_URL", "")
# Use env var only if it looks like a real postgres URL; otherwise use hardcoded pooler
DB_URL = _env_url if _env_url.startswith("postgresql") else _POOLER_URL

BATCH_SIZE = 500       # vehicles loaded per page
WRITE_BATCH = 100      # updates committed per batch
PROGRESS_EVERY = 200   # print progress every N vehicles


# ── CLI Args ─────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Enrich vehicles with MSRP from OEM trim data")
    p.add_argument("--dry-run", action="store_true", help="Don't write, just report matches")
    p.add_argument("--limit", type=int, default=0, help="Max vehicles to process (0=all)")
    p.add_argument("--make", type=str, default=None, help="Filter to specific make")
    p.add_argument("--strategy", choices=["all", "exact", "fuzzy", "model"], default="all",
                   help="Which matching strategies to run (default: all)")
    p.add_argument("--verbose", "-v", action="store_true", help="Print every match")
    return p.parse_args()


# ── Load OEM Trim Reference Data ─────────────────────────────────────────────

def load_oem_trims(conn):
    """Load oem_trim_levels into lookup structures for fast matching."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute("""
        SELECT make, model_family, trim_name, trim_level, year_start, year_end, base_msrp_usd
        FROM oem_trim_levels
        WHERE base_msrp_usd IS NOT NULL
        ORDER BY make, model_family, year_start
    """)
    rows = cur.fetchall()
    cur.close()

    # Exact lookup: (make_lower, model_family_lower, trim_name_lower) -> [(year_start, year_end, msrp)]
    exact_lookup = defaultdict(list)
    # Model-level lookup: (make_lower, model_family_lower) -> [(year_start, year_end, msrp)]
    model_lookup = defaultdict(list)
    # All trims for fuzzy matching: (make_lower, model_family_lower) -> [(trim_name_lower, year_start, year_end, msrp)]
    fuzzy_lookup = defaultdict(list)

    for r in rows:
        make_l = r["make"].lower()
        model_l = r["model_family"].lower()
        trim_l = r["trim_name"].lower() if r["trim_name"] else ""
        ys, ye, msrp = r["year_start"], r["year_end"], r["base_msrp_usd"]

        exact_lookup[(make_l, model_l, trim_l)].append((ys, ye, msrp))
        model_lookup[(make_l, model_l)].append((ys, ye, msrp))
        if trim_l:
            fuzzy_lookup[(make_l, model_l)].append((trim_l, ys, ye, msrp))

    print(f"  Loaded {len(rows)} OEM trim rows")
    print(f"  Exact keys:  {len(exact_lookup)}")
    print(f"  Model keys:  {len(model_lookup)}")
    print(f"  Fuzzy keys:  {len(fuzzy_lookup)}")

    return exact_lookup, model_lookup, fuzzy_lookup


# ── Matching Functions ────────────────────────────────────────────────────────

def match_exact(vehicle, exact_lookup):
    """Try exact trim match. Returns (msrp, source_label) or None."""
    make = (vehicle["make"] or "").lower()
    model = (vehicle["normalized_model"] or vehicle["model"] or "").lower()
    trim = (vehicle["trim"] or "").lower().strip()
    year = vehicle["year"]

    if not make or not model or not trim or not year:
        return None

    key = (make, model, trim)
    candidates = exact_lookup.get(key, [])
    for ys, ye, msrp in candidates:
        if ys <= year <= ye:
            return (msrp, "oem", "exact")

    return None


def match_fuzzy(vehicle, fuzzy_lookup):
    """Try fuzzy trim match (trim contains oem_trim_name or vice versa).
    Picks the longest-matching trim name to avoid false positives.
    Returns (msrp, source_label) or None."""
    make = (vehicle["make"] or "").lower()
    model = (vehicle["normalized_model"] or vehicle["model"] or "").lower()
    trim = (vehicle["trim"] or "").lower().strip()
    year = vehicle["year"]

    if not make or not model or not trim or not year:
        return None

    key = (make, model)
    candidates = fuzzy_lookup.get(key, [])
    if not candidates:
        return None

    best = None
    best_len = 0
    for trim_name_l, ys, ye, msrp in candidates:
        if ys <= year <= ye:
            # Check: vehicle trim contains OEM trim_name, or OEM trim_name contains vehicle trim
            if trim_name_l in trim or trim in trim_name_l:
                if len(trim_name_l) > best_len:
                    best = (msrp, "oem", "fuzzy")
                    best_len = len(trim_name_l)

    return best


def match_model_avg(vehicle, model_lookup):
    """Fallback: average MSRP across all trims for the model+year.
    Returns (msrp, source_label) or None."""
    make = (vehicle["make"] or "").lower()
    model = (vehicle["normalized_model"] or vehicle["model"] or "").lower()
    year = vehicle["year"]

    if not make or not model or not year:
        return None

    key = (make, model)
    candidates = model_lookup.get(key, [])
    matching_msrps = [msrp for ys, ye, msrp in candidates if ys <= year <= ye]

    if not matching_msrps:
        return None

    # Use average, rounded to nearest dollar
    avg_msrp = round(sum(matching_msrps) / len(matching_msrps))
    return (avg_msrp, "oem", "model_avg")


# ── Paginated Vehicle Loading ────────────────────────────────────────────────

def load_vehicle_batch(conn, offset, limit, make_filter=None):
    """Load a batch of vehicles that need MSRP enrichment."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    where_clauses = [
        "v.msrp IS NULL",
        "v.year IS NOT NULL",
        "v.make IS NOT NULL",
        "v.make != ''",
    ]
    params = []

    if make_filter:
        where_clauses.append("LOWER(v.make) = LOWER(%s)")
        params.append(make_filter)

    query = f"""
        SELECT v.id, v.year, v.make, v.model, v.normalized_model, v.trim
        FROM vehicles v
        WHERE {' AND '.join(where_clauses)}
        ORDER BY v.id
        OFFSET %s LIMIT %s
    """
    params.extend([offset, limit])

    cur.execute(query, params)
    rows = cur.fetchall()
    cur.close()
    return rows


# ── Batch Write ──────────────────────────────────────────────────────────────

def write_updates(conn, updates, dry_run=False):
    """Write a batch of MSRP updates. Each update = (vehicle_id, msrp, msrp_source)."""
    if not updates or dry_run:
        return 0

    cur = conn.cursor()
    # Use executemany with a parameterized UPDATE
    cur.executemany("""
        UPDATE vehicles
        SET msrp = %s, msrp_source = %s
        WHERE id = %s AND msrp IS NULL
    """, [(u[1], u[2], u[0]) for u in updates])
    affected = cur.rowcount
    conn.commit()
    cur.close()
    return affected


# ── Main Pipeline ────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    print("=" * 70)
    print("MSRP ENRICHMENT PIPELINE")
    print("=" * 70)
    print(f"  Strategy:  {args.strategy}")
    print(f"  Dry run:   {args.dry_run}")
    print(f"  Limit:     {args.limit or 'all'}")
    print(f"  Make:      {args.make or 'all'}")
    print(f"  Verbose:   {args.verbose}")
    print("=" * 70)

    # Connect
    print("\nConnecting to database...")
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False

    # Load reference data
    print("Loading OEM trim reference data...")
    exact_lookup, model_lookup, fuzzy_lookup = load_oem_trims(conn)

    # Stats
    stats = {
        "total_scanned": 0,
        "exact_matches": 0,
        "fuzzy_matches": 0,
        "model_matches": 0,
        "no_match": 0,
        "skipped_no_year": 0,
        "skipped_no_make": 0,
        "written": 0,
        "write_errors": 0,
    }
    match_by_make = defaultdict(int)
    match_by_source = defaultdict(int)
    sample_matches = []
    start_time = time.time()

    # Paginated processing
    offset = 0
    pending_updates = []
    total_limit = args.limit if args.limit > 0 else 10_000_000  # effectively unlimited

    print(f"\nScanning vehicles for MSRP matches...\n")

    while stats["total_scanned"] < total_limit:
        batch_limit = min(BATCH_SIZE, int(total_limit - stats["total_scanned"]))
        vehicles = load_vehicle_batch(conn, offset, batch_limit, args.make)

        if not vehicles:
            break

        offset += len(vehicles)

        for v in vehicles:
            if stats["total_scanned"] >= total_limit:
                break

            stats["total_scanned"] += 1
            vid = v["id"]
            year = v["year"]
            make = v["make"] or ""
            model = v["normalized_model"] or v["model"] or ""
            trim = v["trim"] or ""

            # Try matching strategies in order
            result = None

            if args.strategy in ("all", "exact"):
                result = match_exact(v, exact_lookup)

            if result is None and args.strategy in ("all", "fuzzy"):
                result = match_fuzzy(v, fuzzy_lookup)

            if result is None and args.strategy in ("all", "model"):
                result = match_model_avg(v, model_lookup)

            if result:
                msrp, db_source, quality = result
                pending_updates.append((str(vid), msrp, db_source))
                match_by_make[make] += 1
                match_by_source[quality] += 1

                if quality == "exact":
                    stats["exact_matches"] += 1
                elif quality == "fuzzy":
                    stats["fuzzy_matches"] += 1
                elif quality == "model_avg":
                    stats["model_matches"] += 1

                if args.verbose or len(sample_matches) < 10:
                    label = f"{year} {make} {model}"
                    if trim:
                        label += f" [{trim}]"
                    if args.verbose:
                        print(f"  MATCH [{quality:16s}] ${msrp:>10,}  {label}")
                    if len(sample_matches) < 10:
                        sample_matches.append((label, msrp, quality))
            else:
                stats["no_match"] += 1

            # Write batch when full
            if len(pending_updates) >= WRITE_BATCH:
                try:
                    written = write_updates(conn, pending_updates, args.dry_run)
                    stats["written"] += written if not args.dry_run else len(pending_updates)
                except Exception as e:
                    stats["write_errors"] += 1
                    print(f"\n  WRITE ERROR: {e}")
                    conn.rollback()
                pending_updates = []

            # Progress reporting
            if stats["total_scanned"] % PROGRESS_EVERY == 0:
                elapsed = time.time() - start_time
                rate = stats["total_scanned"] / elapsed if elapsed > 0 else 0
                matched = stats["exact_matches"] + stats["fuzzy_matches"] + stats["model_matches"]
                match_pct = (matched / stats["total_scanned"] * 100) if stats["total_scanned"] > 0 else 0
                print(f"  [{stats['total_scanned']:>8,} scanned] "
                      f"{matched:>6,} matched ({match_pct:.1f}%) | "
                      f"exact:{stats['exact_matches']} fuzzy:{stats['fuzzy_matches']} model:{stats['model_matches']} | "
                      f"{rate:.0f}/sec | {elapsed:.0f}s", flush=True)

    # Write remaining
    if pending_updates:
        try:
            written = write_updates(conn, pending_updates, args.dry_run)
            stats["written"] += written if not args.dry_run else len(pending_updates)
        except Exception as e:
            stats["write_errors"] += 1
            print(f"\n  WRITE ERROR: {e}")
            conn.rollback()

    elapsed = time.time() - start_time
    matched = stats["exact_matches"] + stats["fuzzy_matches"] + stats["model_matches"]

    # ── Final Report ─────────────────────────────────────────────────────────

    print("\n" + "=" * 70)
    print("MSRP ENRICHMENT COMPLETE" + (" (DRY RUN)" if args.dry_run else ""))
    print("=" * 70)
    print(f"  Total scanned:    {stats['total_scanned']:>10,}")
    print(f"  Total matched:    {matched:>10,}  ({matched / stats['total_scanned'] * 100:.1f}%)" if stats['total_scanned'] else "")
    print(f"  No match:         {stats['no_match']:>10,}")
    print()
    print(f"  Exact trim:       {stats['exact_matches']:>10,}")
    print(f"  Fuzzy trim:       {stats['fuzzy_matches']:>10,}")
    print(f"  Model average:    {stats['model_matches']:>10,}")
    print()
    if not args.dry_run:
        print(f"  Rows written:     {stats['written']:>10,}")
        print(f"  Write errors:     {stats['write_errors']:>10,}")
    print(f"  Duration:         {elapsed:>10.1f}s")
    print(f"  Rate:             {stats['total_scanned'] / elapsed:>10.0f}/sec" if elapsed > 0 else "")

    if match_by_source:
        print(f"\n  Matches by source:")
        for src, cnt in sorted(match_by_source.items(), key=lambda x: -x[1]):
            print(f"    {src:20s}  {cnt:>8,}")

    if match_by_make:
        print(f"\n  Top makes matched:")
        for make, cnt in sorted(match_by_make.items(), key=lambda x: -x[1])[:15]:
            print(f"    {make:20s}  {cnt:>8,}")

    if sample_matches:
        print(f"\n  Sample matches:")
        for label, msrp, source in sample_matches:
            print(f"    ${msrp:>10,}  [{source:16s}]  {label}")

    print("=" * 70)

    conn.close()


if __name__ == "__main__":
    main()
