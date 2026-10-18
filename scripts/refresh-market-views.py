#!/usr/bin/env python3
"""
Refresh the market materialized views that read vehicles' series / trim / body_style.

Live views refresh CONCURRENTLY. Only an explicitly selected private, unpopulated beside copy builds plainly. A failure (dropped connection, database restart)
is retried on a fresh connection; a view that still fails is reported and the script exits non-zero rather than
falling back to a blocking refresh.

Usage:
  dotenvx run -- python3 scripts/refresh-market-views.py
  dotenvx run -- python3 scripts/refresh-market-views.py --attempts 1 --views public.mv_model_family_names public.mv_family_market public.mv_family_sales
  python3 scripts/refresh-market-views.py --dry-run --views public.mv_family_year_prices public.mv_family_share_movers
"""
import argparse
import importlib.util
import os
import sys
import time

def connect_db():
    spec = importlib.util.spec_from_file_location(
        "cab_backfill", os.path.join(os.path.dirname(os.path.abspath(__file__)), "backfill-cab-taxonomy-and-outcomes.py")
    )
    cab_backfill = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cab_backfill)
    return cab_backfill.connect_db()

VIEWS = [
    "public.mv_vehicle_name_dictionary",
    "public.mv_model_family_names",
    "public.mv_treemap_outcomes",
    "public.mv_treemap_sale_brands",
    "public.mv_treemap_sale_models",
    "public.mv_brand_market",
    "public.mv_family_market",
    "public.mv_family_sales",
]
EXTRA_VIEWS = ["public.mv_family_year_prices", "public.mv_family_share_movers", "public.mv_family_year_prices_v2"]


def refresh(mv):
    if mv not in VIEWS + EXTRA_VIEWS:
        raise ValueError("Unregistered market view")
    conn = connect_db()
    try:
        conn.autocommit = True
        cur = conn.cursor()
        if mv == "public.mv_family_year_prices_v2":
            # This is an explicit first build, never a blocking fallback for a public view.
            cur.execute("""SELECT c.relispopulated,
                has_table_privilege('anon',c.oid,'SELECT') OR
                has_table_privilege('authenticated',c.oid,'SELECT') OR
                has_table_privilege('service_role',c.oid,'SELECT'),
                EXISTS(SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid
                       WHERE d.refobjid=c.oid AND d.classid='pg_rewrite'::regclass AND r.ev_class<>c.oid),
                pg_get_viewdef(c.oid) LIKE '%named AS MATERIALIZED%'
                  AND pg_get_viewdef(c.oid) LIKE '%p AS MATERIALIZED%'
                FROM pg_class c WHERE c.oid=to_regclass('public.mv_family_year_prices_v2')""")
            state = cur.fetchone()
            if not state or any(state[:3]) or not state[3]:
                raise RuntimeError("Beside copy must be unpopulated, private, unread and cache its expressions")
            # Same planner recipe as its existing owner, with a stricter two-minute build ceiling.
            cur.execute("SET statement_timeout = '120s'; SET lock_timeout = '1s'; "
                        "SET enable_nestloop = off; SET random_page_cost = 4; SET work_mem = '32MB';")
            cur.execute("REFRESH MATERIALIZED VIEW public.mv_family_year_prices_v2;")
        elif mv == "public.mv_family_year_prices":
            # The existing owner sets planner options; retain its cron's 20-minute budget.
            cur.execute("SET statement_timeout = '20min';")
            cur.execute("SELECT public.refresh_family_year_prices();")
        else:
            cur.execute("SET statement_timeout = '5min';" if mv == "public.mv_family_share_movers"
                        else "SET statement_timeout = '15min';")
            cur.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv};")
    finally:
        try:
            conn.close()
        except Exception:
            pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--views", nargs="+", choices=VIEWS + EXTRA_VIEWS,
                        help="Only these registered folds, in dependency order; defaults remain unchanged")
    parser.add_argument("--attempts", type=int, choices=(1, 2, 3), default=3)
    parser.add_argument("--dry-run", action="store_true", help="Print the exact fold plan without connecting")
    args = parser.parse_args(argv)
    selected = [v for v in VIEWS + EXTRA_VIEWS if v in args.views] if args.views else VIEWS
    if args.dry_run:
        print("\n".join(selected))
        return 0
    failed = []
    for mv in selected:
        t0 = time.time()
        for attempt in range(args.attempts):
            try:
                refresh(mv)
                print(f"  refreshed {mv} in {time.time() - t0:.1f}s", flush=True)
                break
            except Exception as err:
                print(f"  [retry {attempt + 1}/{args.attempts}] {mv}: {str(err).splitlines()[0]}", flush=True)
                if attempt + 1 < args.attempts:
                    time.sleep(30 * (attempt + 1))
        else:
            failed.append(mv)
            # A dependent fold must not be rebuilt from failed upstream state.
            break
        time.sleep(2)
    if failed:
        print(f"not refreshed: {failed}", flush=True)
        return 1
    print("all selected views refreshed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
