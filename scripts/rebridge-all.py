#!/usr/bin/env python3
"""Re-bridge all vehicles from vehicle_condition_scores that haven't been bridged yet."""

import sys, os, socket, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from psycopg2.extras import RealDictCursor

# DNS probe + IP fallback
try:
    socket.setdefaulttimeout(2)
    socket.getaddrinfo('aws-0-us-west-1.pooler.supabase.com', 6543)
    HOST = 'aws-0-us-west-1.pooler.supabase.com'
    print("DNS OK, using hostname")
except Exception:
    HOST = '52.8.172.168'
    print("DNS failed, using IP fallback")
socket.setdefaulttimeout(None)

DB_PARAMS = dict(
    host=HOST, port=6543, dbname='postgres',
    user='postgres.qkgaybvrernstplzjaam',
    password='RbzKq32A0uhqvJMQ',
    connect_timeout=10,
)

def get_conn():
    return psycopg2.connect(**DB_PARAMS)

from yono.condition_spectrometer import bridge_vehicle_images

def main():
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Get all vehicle IDs from vehicle_condition_scores
    cur.execute('SELECT vehicle_id FROM vehicle_condition_scores ORDER BY vehicle_id')
    all_vids = [str(r['vehicle_id']) for r in cur.fetchall()]

    # Check which already have yono_v1 observations
    cur.execute("""
        SELECT DISTINCT vehicle_id::text
        FROM image_condition_observations
        WHERE source = 'yono_v1'
    """)
    already_bridged = set(r['vehicle_id'] for r in cur.fetchall())
    cur.close()

    remaining = [v for v in all_vids if v not in already_bridged]
    print(f"Total vehicles: {len(all_vids)}, Already bridged: {len(already_bridged)}, Remaining: {len(remaining)}")

    if not remaining:
        print("All vehicles already bridged!")
        return

    bridged = 0
    errors = 0
    total_obs = 0
    t0 = time.time()

    for i, vid in enumerate(remaining):
        try:
            result = bridge_vehicle_images(conn, vehicle_id=vid, limit=500)
            bridged += 1
            total_obs += result.get("observations_written", 0)
        except Exception as e:
            errors += 1
            try:
                conn.rollback()
            except Exception:
                conn.close()
                conn = get_conn()
            if errors <= 10:
                print(f"  Error on {vid}: {str(e)[:100]}")

        if (i + 1) % 25 == 0:
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            eta = (len(remaining) - i - 1) / rate if rate > 0 else 0
            print(f"  [{i+1}/{len(remaining)}] bridged={bridged} obs={total_obs} errors={errors} "
                  f"rate={rate:.1f}/s ETA={eta:.0f}s")
            sys.stdout.flush()

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.0f}s. Bridged: {bridged}, Observations: {total_obs}, Errors: {errors}")

    # Final stats
    cur2 = conn.cursor(cursor_factory=RealDictCursor)
    cur2.execute("""
        SELECT count(*) as n FROM image_condition_observations WHERE source = 'yono_v1'
    """)
    r = cur2.fetchone()
    print(f"Total ICOs now: {r['n']}")

    cur2.execute("""
        SELECT ct.domain, count(*) as cnt
        FROM image_condition_observations ico
        JOIN condition_taxonomy ct ON ct.descriptor_id = ico.descriptor_id
        GROUP BY ct.domain ORDER BY cnt DESC
    """)
    print("\nICO by domain:")
    for r in cur2.fetchall():
        print(f"  {r['domain']}: {r['cnt']}")
    cur2.close()
    conn.close()

if __name__ == "__main__":
    main()
