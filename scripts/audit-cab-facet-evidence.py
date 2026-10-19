#!/usr/bin/env python3
"""
Audit the series evidence written by backfill-cab-facet-evidence.py.

A derived_chassis_rule row is attributed correctly only if the chassis rule in
backfill-cab-taxonomy-and-outcomes.py (extract_cab_facets) reproduces its value from the vehicle's year, make,
model and titles. Rows it does not reproduce came from another source (e.g. NHTSA series text already on the
vehicle) and are deleted; cars_and_bids_listing rows were checked against the title when written and are kept.

Usage:
  dotenvx run -- python3 scripts/audit-cab-facet-evidence.py [--apply]
"""
import argparse
import importlib.util
import os

spec = importlib.util.spec_from_file_location(
    "cab_backfill", os.path.join(os.path.dirname(os.path.abspath(__file__)), "backfill-cab-taxonomy-and-outcomes.py")
)
cab_backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cab_backfill)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="delete the rows the rule does not reproduce")
    args = parser.parse_args()

    conn = cab_backfill.connect_db()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '5min';")
    cur.execute(
        """
        SELECT e.id, e.proposed_value, v.year, v.make, v.model, v.title, v.listing_title, v.body_style
        FROM public.field_evidence e
        JOIN public.vehicles v ON v.id = e.vehicle_id
        WHERE e.assigned_by = 'backfill_cab_facet_evidence'
          AND e.source_type = 'derived_chassis_rule'
          AND e.field_name = 'series';
        """
    )
    rows = cur.fetchall()

    keep, drop = [], []
    for ev_id, value, year, make, model, title, listing_title, body in rows:
        sub_title = listing_title.split("—", 1)[1].strip() if listing_title and "—" in listing_title else None
        facets = cab_backfill.extract_cab_facets(
            year=year, make=make, model=model, title=title or listing_title, sub_title=sub_title, existing_body_style=body
        )
        (keep if facets["series"] == value else drop).append((ev_id, value, year, make, model))

    print(f"derived_chassis_rule rows: {len(rows)}; reproduced by the rule: {len(keep)}; not reproduced: {len(drop)}")
    by_value = {}
    for _, value, *_ in drop:
        by_value[value] = by_value.get(value, 0) + 1
    print("top values not reproduced:", sorted(by_value.items(), key=lambda kv: -kv[1])[:20])

    if args.apply and drop:
        ids = [d[0] for d in drop]
        for i in range(0, len(ids), 1000):
            cur.execute("DELETE FROM public.field_evidence WHERE id = ANY(%s::uuid[]) AND assigned_by = 'backfill_cab_facet_evidence'", (ids[i : i + 1000],))
        print(f"deleted {len(ids)} misattributed rows")


if __name__ == "__main__":
    main()
