#!/usr/bin/env python3
"""Print the forced-rollback profile of one 100-lot land_index_lots batch as SQL for scripts/data/q.sh.

usage: profile_sql.py <batch file> > profile.sql ; q.sh "$(cat profile.sql)"

EXPLAIN (ANALYZE, BUFFERS) runs the vehicles, vehicle_events and auction_events inserts the action makes (same columns), which
shows each "Trigger X: time=" line; then RAISE EXCEPTION rolls everything back and returns the plans. statement_timeout is set
inside. Nothing is committed. Not covered: writeObservation, an edge-function call that cannot be rolled back; the first real
batch reports its time.
"""
import json
import re
import sys

batch = json.load(open(sys.argv[1]))


def first(t, key, field="name"):
    v = (t or {}).get(key)
    x = v[0] if isinstance(v, list) and v else None
    return x.get(field) if isinstance(x, dict) else x


vehicles, events = [], []
for hit in batch["lots"]:
    t = hit["taxonomies"]
    m = re.search(r"/lots/([A-Za-z0-9-]+)/", hit["permalink"])
    year, make = first(t, "lot_year"), first(t, "make")
    if not (m and year and make):
        continue
    url = "https://www.mecum.com" + hit["permalink"]
    sold = hit.get("sold") == 1
    price = hit.get("highest_bid_or_price") or None
    run = first(t, "run_date")
    vehicles.append({"year": int(year), "make": make, "model": first(t, "model"), "discovery_url": url,
                     "sale_price": price if sold else None, "sale_status": "sold" if sold else None,
                     "sale_date": run if sold else None})
    events.append({"url": url, "lot": hit.get("lot_number_meta") or m.group(1), "price": price,
                   "status": "sold" if sold else ("bid-goes-on" if hit.get("bid_goes_on") == 1 else "listed")})


def lit(rows):
    return "$j$" + json.dumps(rows, separators=(",", ":")).replace("$", "") + "$j$::jsonb"


print(f"""set statement_timeout = '30s';
DO $$ DECLARE r text; o text := ''; BEGIN
  FOR r IN EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    INSERT INTO vehicles (status, year, make, model, sale_price, sale_status, auction_outcome, sale_date, discovery_url, discovery_source, listing_source, source, extractor_version)
    SELECT 'active', x.year, x.make, x.model, x.sale_price, x.sale_status, x.sale_status, x.sale_date::date, x.discovery_url, 'mecum', 'mecum', 'mecum', 'mecum-index-v1'
    FROM jsonb_to_recordset({lit(vehicles)}) AS x(year int, make text, model text, sale_price numeric, sale_status text, sale_date text, discovery_url text)
  LOOP o := o || r || E'\\n'; END LOOP;
  o := o || E'\\n--- vehicle_events\\n';
  FOR r IN EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    INSERT INTO vehicle_events (vehicle_id, source_platform, event_type, source_url, source_listing_id, final_price, event_status, extraction_method, extraction_source, extracted_at, metadata)
    SELECT v.id, 'mecum', 'auction', e.url, e.lot, e.price, e.status, 'mecum-index-v1', 'algolia U6CFCQ7V52/wp_posts_lot', now(), '{{"index_sourced":true}}'::jsonb
    FROM jsonb_to_recordset({lit(events)}) AS e(url text, lot text, price numeric, status text)
    JOIN vehicles v ON v.discovery_url = e.url
  LOOP o := o || r || E'\\n'; END LOOP;
  o := o || E'\\n--- auction_events\\n';
  FOR r IN EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    INSERT INTO auction_events (vehicle_id, source, source_url, outcome, lot_number, sale_price)
    SELECT v.id, 'mecum', e.url, e.status, e.lot, CASE WHEN e.status = 'sold' THEN e.price END
    FROM jsonb_to_recordset({lit(events)}) AS e(url text, lot text, price numeric, status text)
    JOIN vehicles v ON v.discovery_url = e.url
  LOOP o := o || r || E'\\n'; END LOOP;
  RAISE EXCEPTION 'PROFILE%', E'\\n' || o;
END $$;""")
