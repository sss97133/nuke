#!/usr/bin/env python3
"""
Promote import_queue pending items (Barrett-Jackson + Mecum) directly to vehicles.
These items already have year/make/model/title - no external fetch needed.
"""

import json
import os
import sys
from datetime import datetime

def promote():
    import psycopg2
    from psycopg2.extras import execute_values

    conn = psycopg2.connect(
        host="aws-0-us-west-1.pooler.supabase.com",
        port=6543,
        user="postgres.qkgaybvrernstplzjaam",
        password=os.environ.get('SUPABASE_DB_PASSWORD', 'RbzKq32A0uhqvJMQ'),
        database="postgres"
    )
    cur = conn.cursor()
    print(f"[{datetime.now():%H:%M:%S}] Connected", flush=True)

    # Get existing vehicle listing_urls for BJ and Mecum to avoid dupes
    cur.execute("""
        SELECT listing_url FROM vehicles
        WHERE listing_url LIKE '%%barrett-jackson.com%%'
           OR listing_url LIKE '%%mecum.com%%'
    """)
    existing = set(row[0] for row in cur.fetchall())
    print(f"[{datetime.now():%H:%M:%S}] {len(existing)} existing BJ/Mecum vehicles", flush=True)

    # Fetch all pending BJ and Mecum items
    cur.execute("""
        SELECT id, listing_url, listing_title, listing_year, listing_make, listing_model, listing_price
        FROM import_queue
        WHERE status IN ('pending', 'failed')
          AND listing_year IS NOT NULL
          AND listing_make IS NOT NULL
          AND (listing_url LIKE '%%barrett-jackson.com%%' OR listing_url LIKE '%%mecum.com%%')
    """)
    queue_items = cur.fetchall()
    print(f"[{datetime.now():%H:%M:%S}] Found {len(queue_items)} queue items to promote", flush=True)

    # Filter out existing
    to_insert = []
    queue_ids = []
    for qid, url, title, year, make, model, price in queue_items:
        if url in existing:
            continue
        existing.add(url)  # prevent intra-batch dupes

        domain = 'barrett-jackson.com' if 'barrett-jackson' in url else 'mecum.com'
        notes = json.dumps({
            'source': 'queue_promotion',
            'domain': domain,
            'queue_id': str(qid),
            'needs_enrichment': True,
            'promoted_at': datetime.now().isoformat()
        })

        to_insert.append((year, make, model, price, url, title, notes))
        queue_ids.append(qid)

    print(f"[{datetime.now():%H:%M:%S}] {len(to_insert)} new vehicles to create", flush=True)

    if not to_insert:
        print("Nothing to insert!")
        cur.close()
        conn.close()
        return

    # Batch insert vehicles
    batch_size = 2000
    total_inserted = 0

    for i in range(0, len(to_insert), batch_size):
        batch = to_insert[i:i+batch_size]
        batch_qids = queue_ids[i:i+batch_size]

        try:
            execute_values(
                cur,
                """INSERT INTO vehicles (year, make, model, sale_price, listing_url, listing_title, notes)
                   VALUES %s""",
                batch,
                template="(%s, %s, %s, %s, %s, %s, %s::jsonb)"
            )

            # Skip queue update for now - just create vehicles fast

            conn.commit()
            total_inserted += len(batch)
            pct = total_inserted / len(to_insert) * 100
            print(f"  [{datetime.now():%H:%M:%S}] Batch {i//batch_size+1}: {total_inserted:,}/{len(to_insert):,} ({pct:.1f}%)", flush=True)
        except Exception as e:
            print(f"  [{datetime.now():%H:%M:%S}] Error: {e}", flush=True)
            conn.rollback()

    # Final stats
    cur.execute("SELECT COUNT(*) FROM vehicles")
    total = cur.fetchone()[0]

    cur.close()
    conn.close()

    print(f"\n{'='*60}", flush=True)
    print(f"PROMOTION COMPLETE", flush=True)
    print(f"{'='*60}", flush=True)
    print(f"Vehicles created:  {total_inserted:,}", flush=True)
    print(f"Total vehicles:    {total:,}", flush=True)
    print(f"{'='*60}", flush=True)


if __name__ == "__main__":
    promote()
