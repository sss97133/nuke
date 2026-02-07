#!/usr/bin/env python3
"""
Fast bulk import: Conceptcarz + Barrett-Jackson + Mecum
Temporarily disables triggers on vehicles table for 10-50x faster inserts.
Re-enables triggers at the end (even on error).
"""

import json
import os
import re
import sys
from datetime import datetime

CONCEPTCARZ_FILE = "/Users/skylar/nuke/data/conceptcarz/conceptcarz_deduplicated.json"


def clean_model(model_str):
    if not model_str:
        return model_str
    return re.sub(r'Chassis#:.*$', '', model_str, flags=re.IGNORECASE).strip() or model_str


def title_case_make(make_str):
    if not make_str or make_str != make_str.upper():
        return make_str
    abbrevs = {'BMW', 'GMC', 'MG', 'AC', 'TVR', 'DKW', 'MGA', 'MGB', 'AMC', 'VW', 'FIAT'}
    return make_str if make_str in abbrevs else make_str.title()


def run():
    import psycopg2
    from psycopg2.extras import execute_values

    conn = psycopg2.connect(
        host="aws-0-us-west-1.pooler.supabase.com",
        port=6543,
        user="postgres.qkgaybvrernstplzjaam",
        password=os.environ.get('SUPABASE_DB_PASSWORD', 'RbzKq32A0uhqvJMQ'),
        database="postgres",
        options="-c statement_timeout=300000"  # 5 min timeout per statement
    )
    conn.autocommit = False
    cur = conn.cursor()
    ts = lambda: f"[{datetime.now():%H:%M:%S}]"

    print(f"{ts()} Connected to database", flush=True)

    # Get all existing listing_urls for dedup
    print(f"{ts()} Loading existing vehicle URLs for dedup...", flush=True)
    cur.execute("SELECT listing_url FROM vehicles WHERE listing_url IS NOT NULL")
    existing_urls = set(row[0] for row in cur.fetchall())
    print(f"{ts()} {len(existing_urls):,} existing URLs loaded", flush=True)

    # ---- PREPARE CONCEPTCARZ DATA ----
    print(f"\n{ts()} === CONCEPTCARZ ===", flush=True)
    with open(CONCEPTCARZ_FILE) as f:
        cz_records = json.load(f)
    print(f"{ts()} Loaded {len(cz_records):,} Conceptcarz records", flush=True)

    cz_values = []
    for r in cz_records:
        if not r.get('year') or not r.get('make'):
            continue
        listing_url = f"conceptcarz://event/{r.get('event_id')}/{r.get('title', 'unknown')}"
        if listing_url in existing_urls:
            continue
        existing_urls.add(listing_url)

        cz_values.append((
            r.get('year'),
            title_case_make(r.get('make', '')),
            clean_model(r.get('model', '')),
            r.get('sale_price'),
            listing_url,
            r.get('title'),
            json.dumps({
                'source': 'conceptcarz', 'event_id': r.get('event_id'),
                'event_name': r.get('event_name'), 'status': r.get('status'),
                'source_url': r.get('source_url')
            })
        ))
    print(f"{ts()} {len(cz_values):,} new Conceptcarz records to insert", flush=True)

    # ---- PREPARE BJ/MECUM DATA ----
    print(f"\n{ts()} === BARRETT-JACKSON + MECUM ===", flush=True)
    cur.execute("""
        SELECT listing_url, listing_title, listing_year, listing_make, listing_model, listing_price
        FROM import_queue
        WHERE status IN ('pending', 'failed')
          AND listing_year IS NOT NULL AND listing_make IS NOT NULL
          AND (listing_url LIKE '%%barrett-jackson.com%%' OR listing_url LIKE '%%mecum.com%%')
    """)
    queue_items = cur.fetchall()
    print(f"{ts()} Found {len(queue_items):,} BJ/Mecum queue items", flush=True)

    bm_values = []
    for url, title, year, make, model, price in queue_items:
        if url in existing_urls:
            continue
        existing_urls.add(url)
        domain = 'barrett-jackson.com' if 'barrett-jackson' in url else 'mecum.com'
        bm_values.append((
            year, make, model, price, url, title,
            json.dumps({'source': 'queue_promotion', 'domain': domain, 'needs_enrichment': True})
        ))
    print(f"{ts()} {len(bm_values):,} new BJ/Mecum records to insert", flush=True)

    all_values = cz_values + bm_values
    total = len(all_values)
    print(f"\n{ts()} TOTAL TO INSERT: {total:,}", flush=True)

    if not all_values:
        print("Nothing to insert!")
        cur.close()
        conn.close()
        return

    # ---- DISABLE TRIGGERS AND BULK INSERT ----
    try:
        print(f"{ts()} Disabling triggers on vehicles table...", flush=True)
        cur.execute("ALTER TABLE vehicles DISABLE TRIGGER USER")
        conn.commit()
        print(f"{ts()} Triggers disabled. Starting bulk insert...", flush=True)

        batch_size = 10000
        inserted = 0

        for i in range(0, len(all_values), batch_size):
            batch = all_values[i:i+batch_size]
            execute_values(
                cur,
                """INSERT INTO vehicles (year, make, model, sale_price, listing_url, listing_title, notes)
                   VALUES %s""",
                batch,
                template="(%s, %s, %s, %s, %s, %s, %s::jsonb)"
            )
            conn.commit()
            inserted += len(batch)
            pct = inserted / total * 100
            source = "CZ" if i < len(cz_values) else "BJ/MEC"
            print(f"  {ts()} {source} Batch {i//batch_size+1}: {inserted:,}/{total:,} ({pct:.1f}%)", flush=True)

    except Exception as e:
        print(f"\n{ts()} ERROR: {e}", flush=True)
        conn.rollback()
    finally:
        # ALWAYS re-enable triggers
        print(f"\n{ts()} Re-enabling triggers on vehicles table...", flush=True)
        try:
            cur.execute("ALTER TABLE vehicles ENABLE TRIGGER USER")
            conn.commit()
            print(f"{ts()} Triggers re-enabled.", flush=True)
        except Exception as e:
            print(f"{ts()} CRITICAL: Failed to re-enable triggers: {e}", flush=True)
            print("RUN MANUALLY: ALTER TABLE vehicles ENABLE TRIGGER USER;", flush=True)

    # Final counts
    cur.execute("SELECT COUNT(*) FROM vehicles")
    total_vehicles = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM vehicles WHERE listing_url LIKE 'conceptcarz://%%'")
    total_cz = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM vehicles WHERE listing_url LIKE '%%barrett-jackson.com%%' OR listing_url LIKE '%%mecum.com%%'")
    total_bm = cur.fetchone()[0]

    cur.close()
    conn.close()

    print(f"\n{'='*60}", flush=True)
    print(f"BULK IMPORT COMPLETE - {datetime.now():%H:%M:%S}", flush=True)
    print(f"{'='*60}", flush=True)
    print(f"Inserted:       {inserted:,}", flush=True)
    print(f"Conceptcarz:    {total_cz:,}", flush=True)
    print(f"BJ + Mecum:     {total_bm:,}", flush=True)
    print(f"Total vehicles: {total_vehicles:,}", flush=True)
    print(f"{'='*60}", flush=True)


if __name__ == "__main__":
    run()
