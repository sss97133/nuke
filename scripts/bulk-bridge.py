#!/usr/bin/env python3
"""
Bulk bridge: Insert baseline + damage observations for ALL unbridged vehicles
using batch SQL instead of per-image Python round-trips.
"""

import sys, os, json, socket, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from psycopg2.extras import RealDictCursor, execute_values

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


def zone_to_domain(zone):
    if not zone:
        return "exterior"
    z = zone.lower()
    if z.startswith("int_"):
        return "interior"
    elif z.startswith("mech_"):
        return "mechanical"
    elif z.startswith("ext_") or z.startswith("panel_") or z.startswith("wheel_"):
        return "exterior"
    elif z == "detail_odometer":
        return "interior"
    elif z.startswith("detail_"):
        return "exterior"
    elif z.startswith("structural_"):
        return "structural"
    return "exterior"


def severity_from_score(condition_score):
    if condition_score is None:
        return 0.5
    return {1: 0.9, 2: 0.7, 3: 0.5, 4: 0.3, 5: 0.1}.get(int(condition_score), 0.5)


def lifecycle_from_score(condition_score):
    if condition_score is None:
        return None
    cs = int(condition_score)
    if cs >= 5: return "fresh"
    if cs >= 4: return "worn"
    if cs >= 3: return "weathered"
    if cs >= 2: return "ghost"
    return "archaeological"


def main():
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # 1. Load alias map
    cur.execute("SELECT alias_key, descriptor_id FROM condition_aliases")
    alias_map = {}
    for r in cur.fetchall():
        did = str(r["descriptor_id"])
        alias_map[r["alias_key"]] = did
        alias_map[r["alias_key"].lower()] = did
    print(f"Loaded {len(alias_map)} aliases")

    # 2. Load/create baseline descriptors per domain
    baseline_descriptors = {}
    for domain in ["exterior", "interior", "mechanical", "structural", "provenance"]:
        key = f"{domain}.assessed.baseline"
        cur.execute("SELECT descriptor_id FROM condition_taxonomy WHERE canonical_key = %s", (key,))
        row = cur.fetchone()
        if row:
            baseline_descriptors[domain] = str(row["descriptor_id"])
        else:
            cur.execute("""
                INSERT INTO condition_taxonomy
                    (canonical_key, domain, descriptor_type, display_label, taxonomy_version)
                VALUES (%s, %s, 'state', %s, 'v2_2026_03')
                ON CONFLICT (canonical_key) DO NOTHING
                RETURNING descriptor_id
            """, (key, domain, f"{domain.title()} Assessed Baseline"))
            row = cur.fetchone()
            if not row:
                cur.execute("SELECT descriptor_id FROM condition_taxonomy WHERE canonical_key = %s", (key,))
                row = cur.fetchone()
            baseline_descriptors[domain] = str(row["descriptor_id"])
            conn.commit()
    print(f"Baseline descriptors: {baseline_descriptors}")

    # 3. Get all unbridged images (with data) for vehicles in VCS
    print("Fetching unbridged images...")
    cur.execute("""
        SELECT vi.id as image_id, vi.vehicle_id,
               vi.vehicle_zone, vi.condition_score,
               vi.damage_flags, vi.modification_flags
        FROM vehicle_images vi
        JOIN vehicle_condition_scores vcs ON vcs.vehicle_id = vi.vehicle_id
        WHERE (vi.condition_score IS NOT NULL
               OR vi.damage_flags IS NOT NULL
               OR vi.modification_flags IS NOT NULL)
          AND NOT EXISTS (
              SELECT 1 FROM image_condition_observations ico
              WHERE ico.image_id = vi.id AND ico.source = 'yono_v1'
          )
        ORDER BY vi.vehicle_id
    """)
    rows = cur.fetchall()
    print(f"Unbridged images: {len(rows)}")

    if not rows:
        print("All images already bridged!")
        conn.close()
        return

    # 4. Process in batches
    BATCH = 500
    total_obs = 0
    t0 = time.time()

    for batch_start in range(0, len(rows), BATCH):
        batch = rows[batch_start:batch_start + BATCH]
        obs_rows = []

        for row in batch:
            image_id = str(row["image_id"])
            vehicle_id = str(row["vehicle_id"])
            zone = row["vehicle_zone"]
            cs = row["condition_score"]
            damage_flags = row["damage_flags"] or []
            mod_flags = row["modification_flags"] or []

            lifecycle = lifecycle_from_score(cs)
            domain = zone_to_domain(zone)

            # Baseline observation (always written if has condition_score)
            if cs is not None and lifecycle:
                desc_id = baseline_descriptors.get(domain)
                if desc_id:
                    baseline_sev = (int(cs) - 1) / 4.0 if cs else 0.5
                    obs_rows.append((
                        image_id, vehicle_id, desc_id,
                        baseline_sev, lifecycle, zone,
                        1, 0.5, 'yono_v1', None,
                        json.dumps({"baseline": True, "condition_score": int(cs),
                                    "zone": zone, "lifecycle": lifecycle, "domain": domain})
                    ))

            # Damage flag observations
            severity = severity_from_score(cs) if damage_flags else None
            for flag in damage_flags:
                # Resolve flag
                desc_id = alias_map.get(flag) or alias_map.get(flag.lower())
                if not desc_id:
                    spaced = flag.replace("_", " ")
                    desc_id = alias_map.get(spaced) or alias_map.get(spaced.lower())
                if not desc_id:
                    # prefix match
                    for ak, did in alias_map.items():
                        if flag.lower().startswith(ak.lower()) and len(ak) >= 3:
                            desc_id = did
                            break
                if desc_id:
                    obs_rows.append((
                        image_id, vehicle_id, desc_id,
                        severity, lifecycle, zone,
                        1, None, 'yono_v1', None,
                        json.dumps({"raw_flag": flag, "yono_output": {
                            "zone": zone, "condition_score": int(cs) if cs else None}})
                    ))

            # Modification flag observations
            for flag in mod_flags:
                desc_id = alias_map.get(flag) or alias_map.get(flag.lower())
                if not desc_id:
                    spaced = flag.replace("_", " ")
                    desc_id = alias_map.get(spaced) or alias_map.get(spaced.lower())
                if not desc_id:
                    for ak, did in alias_map.items():
                        if flag.lower().startswith(ak.lower()) and len(ak) >= 3:
                            desc_id = did
                            break
                if desc_id:
                    obs_rows.append((
                        image_id, vehicle_id, desc_id,
                        None, lifecycle, zone,
                        1, None, 'yono_v1', None,
                        json.dumps({"raw_flag": flag, "yono_output": {
                            "zone": zone, "condition_score": int(cs) if cs else None}})
                    ))

        # Bulk insert
        if obs_rows:
            execute_values(cur, """
                INSERT INTO image_condition_observations
                    (image_id, vehicle_id, descriptor_id, severity, lifecycle_state,
                     zone, pass_number, confidence, source, source_version, evidence)
                VALUES %s
            """, obs_rows)
            total_obs += len(obs_rows)

        conn.commit()

        elapsed = time.time() - t0
        img_done = batch_start + len(batch)
        rate = img_done / elapsed if elapsed > 0 else 0
        eta = (len(rows) - img_done) / rate if rate > 0 else 0
        print(f"  [{img_done}/{len(rows)}] obs={total_obs} "
              f"rate={rate:.0f} img/s ETA={eta:.0f}s")
        sys.stdout.flush()

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s. Total observations: {total_obs}")

    # 5. Final stats
    cur.execute("SELECT count(*) as n FROM image_condition_observations WHERE source = 'yono_v1'")
    print(f"Total ICOs: {cur.fetchone()['n']}")

    cur.execute("""
        SELECT ct.domain, count(*) as cnt
        FROM image_condition_observations ico
        JOIN condition_taxonomy ct ON ct.descriptor_id = ico.descriptor_id
        WHERE ico.source = 'yono_v1'
        GROUP BY ct.domain ORDER BY cnt DESC
    """)
    print("\nICO by domain:")
    for r in cur.fetchall():
        print(f"  {r['domain']}: {r['cnt']}")

    cur.execute("SELECT count(DISTINCT vehicle_id) as n FROM image_condition_observations WHERE source = 'yono_v1'")
    print(f"\nDistinct vehicles bridged: {cur.fetchone()['n']}")

    cur.execute("""
        SELECT count(DISTINCT ico.descriptor_id) as n
        FROM image_condition_observations ico
        WHERE ico.source = 'yono_v1'
    """)
    print(f"Distinct descriptors in use: {cur.fetchone()['n']}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
