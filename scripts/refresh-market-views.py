#!/usr/bin/env python3
"""
Refresh the market materialized views that read vehicles' series / trim / body_style.

Each view is refreshed CONCURRENTLY so readers are never blocked. A failure (dropped connection, database restart)
is retried on a fresh connection; a view that still fails is reported and the script exits non-zero rather than
falling back to a blocking refresh.

Usage:
  dotenvx run -- python3 scripts/refresh-market-views.py
"""
import importlib.util
import os
import sys
import time

spec = importlib.util.spec_from_file_location(
    "cab_backfill", os.path.join(os.path.dirname(os.path.abspath(__file__)), "backfill-cab-taxonomy-and-outcomes.py")
)
cab_backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cab_backfill)

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


def refresh(mv):
    conn = cab_backfill.connect_db()
    try:
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SET statement_timeout = '15min';")
        cur.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv};")
    finally:
        try:
            conn.close()
        except Exception:
            pass


failed = []
for mv in VIEWS:
    t0 = time.time()
    for attempt in range(3):
        try:
            refresh(mv)
            print(f"  refreshed {mv} in {time.time() - t0:.1f}s", flush=True)
            break
        except Exception as err:
            print(f"  [retry {attempt + 1}/3] {mv}: {str(err).splitlines()[0]}", flush=True)
            time.sleep(30 * (attempt + 1))
    else:
        failed.append(mv)
    time.sleep(2)

if failed:
    print(f"not refreshed: {failed}", flush=True)
    sys.exit(1)
print("all views refreshed", flush=True)
