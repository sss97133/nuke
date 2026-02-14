#!/usr/bin/env python3
"""
Description Intelligence Extractor — Direct database approach.

Reads vehicle descriptions from the database, extracts structured fields
using regex patterns (Tier 1), and upserts to vehicle_intelligence.

No edge function calls. No LLM costs. Pure regex extraction.

Usage:
  python3 scripts/extract-description-intelligence.py [--limit 200000] [--batch-size 500]
"""
import sys
import re
import json
import time
import argparse

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Installing psycopg2-binary...", file=sys.stderr)
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'psycopg2-binary', '-q'])
    import psycopg2
    import psycopg2.extras

DB_URL = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"


def extract_tier1(description):
    """Extract structured fields from description using regex patterns."""
    if not description or len(description) < 40:
        return None

    r = {}

    # Ownership
    for pat, val in [
        (r'\b(?:one|single|1st|first)[- ]?owner\b', 1),
        (r'\b(?:two|2nd|second)[- ]?owner\b', 2),
        (r'\b(?:three|3rd|third)[- ]?owner\b', 3),
        (r'\b(?:four|4th|fourth)[- ]?owner\b', 4),
        (r'\b(?:five|5th|fifth)[- ]?owner\b', 5),
    ]:
        if re.search(pat, description, re.I):
            r['owner_count'] = val
            break

    # Acquisition
    m = re.search(r'(?:acquired|purchased|bought)(?: by the seller)?(?: in)? (\d{4})', description, re.I)
    if m:
        yr = int(m.group(1))
        if 1900 <= yr <= 2026:
            r['acquisition_year'] = yr

    if re.search(r'(?:sold|listed|purchased) on (?:BaT|Bring a Trailer)', description, re.I):
        r['previous_bat_sale_url'] = 'mentioned'

    # Documentation
    if re.search(r'\b(?:service records?|maintenance records?|service history)\b', description, re.I):
        r['has_service_records'] = True
    m = re.search(r'service records?(?: dating)?(?: (?:back )?to| from) (\d{4})', description, re.I)
    if m:
        r['service_records_from_year'] = int(m.group(1))
        r['has_service_records'] = True
    if re.search(r'\b(?:window sticker|monroney)\b', description, re.I):
        r['has_window_sticker'] = True
    if re.search(r"\b(?:owner'?s? manual|books?)\b", description, re.I):
        r['has_owners_manual'] = True
    if re.search(r'\b(?:tool (?:roll|kit)|tools)\b', description, re.I):
        r['has_tools'] = True
    if re.search(r'\bspare key\b', description, re.I):
        r['has_spare_key'] = True

    # Condition
    if re.search(r'\b(?:running[- ]and[- ]driving|runs and drives)\b', description, re.I):
        r['is_running'] = True
        r['is_driving'] = True
    if re.search(r'\b(?:project|barn find|needs work|non[- ]running|not running)\b', description, re.I):
        r['is_project'] = True
    if re.search(r'\b(?:restored|restoration|frame[- ]off|rotisserie)\b', description, re.I):
        r['is_restored'] = True

    # Authenticity
    if re.search(r'\b(?:numbers?[- ]matching|matching[- ]numbers?)\b', description, re.I):
        r['matching_numbers'] = True
    if re.search(r'\b(?:refinished in|repainted|respray|new paint)\b', description, re.I):
        r['is_repainted'] = True
    if re.search(r'\b(?:original (?:color|paint)|factory (?:color|paint)|born with)\b', description, re.I):
        r['is_original_color'] = True

    # Provenance
    if re.search(r'\b(?:california car|CA car|remained (?:registered )?in California)\b', description, re.I):
        r['is_california_car'] = True
    if re.search(r'\b(?:never seen snow|dry climate|never (?:driven|used) in winter|garaged winters?)\b', description, re.I):
        r['never_winter_driven'] = True
    if re.search(r'\b(?:rust[- ]free|no rust|zero rust)\b', description, re.I):
        r['is_rust_free'] = True

    # Rarity
    m = re.search(r'\bone of (?:only )?(\d+)\b', description, re.I)
    if m:
        r['total_production'] = int(m.group(1))
    m = re.search(r'#?(\d+)\s*(?:of|\/)\s*(\d+)', description)
    if m:
        r['production_number'] = int(m.group(1))
        r['total_production'] = int(m.group(2))
    if re.search(r'\b(?:limited edition|special edition|anniversary edition)\b', description, re.I):
        r['is_limited_edition'] = True

    # Awards
    awards = []
    if re.search(r'\bNCRS Top Flight\b', description):
        awards.append({"name": "NCRS Top Flight", "year": None, "score": None})
    if re.search(r'\bBloomington Gold\b', description):
        awards.append({"name": "Bloomington Gold", "year": None, "score": None})
    if re.search(r'\bPCA\b', description):
        awards.append({"name": "PCA Award", "year": None, "score": None})
    if awards:
        r['awards'] = json.dumps(awards)
        r['is_show_winner'] = True
    if re.search(r'\bconcours\b', description, re.I):
        r['is_concours_quality'] = True

    # Modifications detection
    if re.search(r'\b(?:modified|upgraded|aftermarket|custom|swapped?)\b', description, re.I):
        r['is_modified'] = True
        # Determine level
        if re.search(r'\b(?:engine swap|ls swap|turbo|supercharg|wide.?body|full custom|extensively modified)\b', description, re.I):
            r['modification_level'] = 'extensive'
        elif re.search(r'\b(?:performance|exhaust|intake|suspension|lowered|coilovers|big brake|tune[dr])\b', description, re.I):
            r['modification_level'] = 'moderate'
        else:
            r['modification_level'] = 'mild'

    # Parts replaced
    parts_matches = re.findall(r'replaced?\s+(?:the\s+)?([^.]{3,150})', description, re.I)
    if parts_matches:
        parts = [p.strip() for p in parts_matches if 3 < len(p.strip()) < 150]
        if parts:
            r['parts_replaced'] = json.dumps(parts[:10])

    # Known issues
    issues = []
    for pat in [r'(?:known issues?|noted):?\s*([^.]{5,200})',
                r'(?:needs?|requiring|requires)\s+([^.]{5,150})']:
        for m in re.finditer(pat, description, re.I):
            issues.append(m.group(1).strip())
    if issues:
        r['known_issues'] = json.dumps(issues[:5])

    # Additional field: fuel type from description
    if re.search(r'\bdiesel\b', description, re.I):
        r['_fuel_type'] = 'Diesel'
    elif re.search(r'\belectric\b(?!\s*(?:window|seat|mirror|lock|sun|fold))', description, re.I):
        r['_fuel_type'] = 'Electric'
    elif re.search(r'\bhybrid\b', description, re.I):
        r['_fuel_type'] = 'Hybrid'

    return r if r else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=200000)
    parser.add_argument('--batch-size', type=int, default=500)
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    # Get vehicles with descriptions that haven't been analyzed
    # Use keyset pagination (WHERE id > last_id) which is O(1) vs OFFSET which is O(n)
    print(f"[{time.strftime('%H:%M:%S')}] Finding vehicles with unanalyzed descriptions...", file=sys.stderr)

    # First get existing vehicle_intelligence IDs (small table, fast query)
    cur.execute("SELECT vehicle_id FROM vehicle_intelligence")
    existing_ids = set(str(r[0]) for r in cur.fetchall())
    print(f"  ... {len(existing_ids)} already analyzed", file=sys.stderr)

    # Keyset pagination through vehicles with descriptions
    vehicles = []
    last_id = '00000000-0000-0000-0000-000000000000'
    page_size = 5000
    while len(vehicles) < args.limit:
        cur.execute("""
            SELECT v.id, v.description, v.fuel_type
            FROM vehicles v
            WHERE v.description IS NOT NULL
              AND LENGTH(v.description) > 40
              AND v.id > %s
            ORDER BY v.id
            LIMIT %s
        """, (last_id, page_size))
        page = cur.fetchall()
        if not page:
            break
        last_id = str(page[-1][0])
        # Filter out already analyzed in Python
        for row in page:
            if str(row[0]) not in existing_ids:
                vehicles.append(row)
        print(f"  ... scanned to {last_id[:8]}..., {len(vehicles)} need analysis", file=sys.stderr)
        if len(vehicles) >= args.limit:
            break

    vehicles = vehicles[:args.limit]
    print(f"[{time.strftime('%H:%M:%S')}] Found {len(vehicles)} vehicles to analyze", file=sys.stderr)

    total = 0
    inserted = 0
    skipped = 0
    errors = 0
    fuel_updates = 0
    start = time.time()

    for vid, description, existing_fuel in vehicles:
        total += 1
        vehicle_id = str(vid)

        try:
            fields = extract_tier1(description)
            if not fields:
                skipped += 1
                continue

            # Extract fuel_type for vehicles table update (not for vehicle_intelligence)
            fuel_type = fields.pop('_fuel_type', None)

            # Build intelligence record
            intel = {
                'vehicle_id': vehicle_id,
                'extraction_version': 'v1.0-batch',
                'extraction_method': 'regex',
                'extraction_confidence': 0.6,
                'raw_tier1_extraction': json.dumps(fields),
            }
            intel.update({k: v for k, v in fields.items() if not k.startswith('_')})

            # Build the INSERT columns and values
            cols = list(intel.keys())
            vals = [intel[c] for c in cols]
            placeholders = ['%s'] * len(cols)

            sql = f"""
                INSERT INTO vehicle_intelligence ({', '.join(cols)})
                VALUES ({', '.join(placeholders)})
                ON CONFLICT (vehicle_id) DO NOTHING
            """
            cur.execute(sql, vals)
            inserted += 1

            # Update fuel_type on vehicles table if we detected it and it's empty
            if fuel_type and not existing_fuel:
                cur.execute(
                    "UPDATE vehicles SET fuel_type = %s WHERE id = %s AND fuel_type IS NULL",
                    (fuel_type, vehicle_id)
                )
                fuel_updates += 1

        except Exception as e:
            errors += 1
            if errors <= 10:
                print(f"Error on {vehicle_id}: {e}", file=sys.stderr)

        if total % args.batch_size == 0:
            elapsed = time.time() - start
            rate = total / max(elapsed, 1)
            remaining = (len(vehicles) - total) / max(rate, 0.1)
            print(
                f"[{time.strftime('%H:%M:%S')}] {total}/{len(vehicles)} ({total*100//len(vehicles)}%) "
                f"| Inserted: {inserted} | Skipped: {skipped} | Errors: {errors} "
                f"| Fuel: {fuel_updates} | {rate:.0f}/sec | ~{int(remaining//60)}m left",
                file=sys.stderr
            )

    cur.close()
    elapsed = time.time() - start
    print(f"\n[{time.strftime('%H:%M:%S')}] ===== COMPLETE =====", file=sys.stderr)
    print(f"Total: {total} | Inserted: {inserted} | Skipped: {skipped} | Errors: {errors}", file=sys.stderr)
    print(f"Fuel type updates: {fuel_updates}", file=sys.stderr)
    print(f"Duration: {int(elapsed//60)}m {int(elapsed%60)}s | Rate: {total/max(elapsed,1):.0f}/sec", file=sys.stderr)
    conn.close()


if __name__ == '__main__':
    main()
