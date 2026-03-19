#!/usr/bin/env python3
"""
Backfill vehicles table with regex-extracted fields from descriptions.
v2: Simpler pagination, reconnects between pages, no named cursors.
"""

import json
import os
import re
import sys
import time

import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from yono.extractors.description_regex import DescriptionRegexExtractor

DB_HOST = "54.177.55.191"  # aws-0-us-west-1.pooler.supabase.com (DNS workaround)
DB_PORT = 6543
DB_USER = "postgres.qkgaybvrernstplzjaam"
DB_PASS = "RbzKq32A0uhqvJMQ"
DB_NAME = "postgres"
PAGE_SIZE = 1000
BATCH_SIZE = 500

VALID_DRIVETRAINS = {'RWD', 'FWD', 'AWD', '4WD', '2WD'}
DRIVETRAIN_NORMALIZE = {
    'rear-wheel-drive': 'RWD', 'rear-wheel drive': 'RWD',
    'front-wheel-drive': 'FWD', 'front-wheel drive': 'FWD',
    'all-wheel-drive': 'AWD', 'all-wheel drive': 'AWD',
    'four-wheel-drive': '4WD', 'four-wheel drive': '4WD',
    '4x4': '4WD',
}


def get_conn():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER,
        password=DB_PASS, dbname=DB_NAME,
        options="-c statement_timeout=60000",
        connect_timeout=10
    )


def parse_mileage(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return int(val)
    s = str(val).strip().lower()
    m = re.match(r'([\d,.]+)\s*k\s*(?:miles?|mi\.?)?', s)
    if m:
        return int(float(m.group(1).replace(',', '')) * 1000)
    m = re.match(r'([\d,]+)', s)
    if m:
        num = int(m.group(1).replace(',', ''))
        if 0 <= num <= 999999:
            return num
    return None


def normalize_drivetrain(val):
    if not val:
        return None
    vl = val.lower().strip()
    for pattern, normalized in DRIVETRAIN_NORMALIZE.items():
        if pattern.lower() == vl:
            return normalized
    if val.upper() in VALID_DRIVETRAINS:
        return val.upper()
    return None


def build_engine_string(engine_results):
    if not engine_results:
        return None
    parts = {'displacement': None, 'config': None, 'forced': None, 'family': None}
    for item in engine_results:
        p = item.get('pattern', '')
        v = item.get('value', '')
        if p in ('engine_liter', 'engine_ci', 'engine_cc') and not parts['displacement']:
            parts['displacement'] = v
        elif p == 'engine_config' and not parts['config']:
            parts['config'] = v
        elif p == 'engine_forced_induction' and not parts['forced']:
            parts['forced'] = v
        elif p == 'engine_family' and not parts['family']:
            parts['family'] = v
    result_parts = []
    if parts['displacement']:
        result_parts.append(parts['displacement'])
    if parts['config']:
        result_parts.append(parts['config'])
    if parts['forced']:
        result_parts.append(parts['forced'])
    if not result_parts and parts['family']:
        result_parts.append(parts['family'])
    return ' '.join(result_parts) if result_parts else None


def extract_vehicle_updates(extractor, desc, year, make, model, existing):
    """Run regex extractor and build dict of updates for NULL fields."""
    if not desc or len(desc.strip()) < 20:
        return {}

    try:
        result = extractor.extract(desc, year=year, make=make, model=model)
    except Exception:
        return {}

    updates = {}

    if existing.get('engine_size') is None:
        val = build_engine_string(result.get('engine', []))
        if val:
            updates['engine_size'] = val

    if existing.get('transmission') is None:
        trans = result.get('transmission', [])
        if trans:
            priority = {'transmission_specific': 3, 'transmission_type': 2, 'transmission_generic': 1}
            best = max(trans, key=lambda r: (priority.get(r['pattern'], 0), r['confidence']))
            updates['transmission'] = best['value']

    if existing.get('color') is None:
        colors = result.get('exterior_color', [])
        if colors:
            best = max(colors, key=lambda r: r['confidence'])
            val = best['value'].strip()
            val = re.sub(r'\s+(?:over|with|and)\s*$', '', val, flags=re.I)
            if 2 <= len(val) <= 80:
                updates['color'] = val

    if existing.get('interior_color') is None:
        interiors = result.get('interior', [])
        if interiors:
            best = max(interiors, key=lambda r: r['confidence'])
            val = best['value'].strip()
            val = re.sub(r'\s+(?:and|with)\s*$', '', val, flags=re.I)
            if 2 <= len(val) <= 80:
                updates['interior_color'] = val

    if existing.get('mileage') is None:
        mileage_results = result.get('mileage', [])
        if mileage_results:
            priority = {'odometer_context': 3, 'mileage_shows': 2, 'mileage_general': 1, 'mileage_k': 1}
            best = max(mileage_results, key=lambda r: (priority.get(r['pattern'], 0), r['confidence']))
            val = parse_mileage(best['value'])
            if val is not None and 0 < val < 500000:
                updates['mileage'] = val

    if existing.get('drivetrain') is None:
        dt_results = result.get('drivetrain', [])
        if dt_results:
            best = max(dt_results, key=lambda r: r['confidence'])
            val = normalize_drivetrain(best['value'])
            if val:
                updates['drivetrain'] = val

    if existing.get('body_style') is None:
        bs_results = result.get('body_style', [])
        if bs_results:
            best = max(bs_results, key=lambda r: r['confidence'])
            val = best['value'].strip()
            val = val[0].upper() + val[1:].lower() if val else val
            if len(val) >= 3:
                updates['body_style'] = val

    if existing.get('horsepower') is None:
        hp_results = result.get('horsepower', [])
        if hp_results:
            best = max(hp_results, key=lambda r: r['confidence'])
            try:
                hp_val = int(best['value'].replace(',', ''))
                if 10 <= hp_val <= 2000:
                    updates['horsepower'] = hp_val
            except (ValueError, AttributeError):
                pass

    return updates


def main():
    print("=" * 70)
    print("REGEX EXTRACTION BACKFILL v2 — BaT Vehicles")
    print("=" * 70, flush=True)

    extractor = DescriptionRegexExtractor()

    # Get BEFORE counts
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            count(*) as total,
            count(*) FILTER (WHERE engine_size IS NULL) as e,
            count(*) FILTER (WHERE transmission IS NULL) as t,
            count(*) FILTER (WHERE color IS NULL) as c,
            count(*) FILTER (WHERE interior_color IS NULL) as ic,
            count(*) FILTER (WHERE mileage IS NULL) as m,
            count(*) FILTER (WHERE drivetrain IS NULL) as d,
            count(*) FILTER (WHERE body_style IS NULL) as b,
            count(*) FILTER (WHERE horsepower IS NULL) as h
        FROM vehicles WHERE auction_source = 'bat' AND status = 'active' AND description IS NOT NULL
    """)
    before = cur.fetchone()
    cur.close()
    conn.close()

    print(f"\nBEFORE: {before[0]:,} BaT vehicles with descriptions")
    fields = ['engine_size', 'transmission', 'color', 'interior_color', 'mileage', 'drivetrain', 'body_style', 'horsepower']
    before_dict = dict(zip(['total'] + fields, before))
    for f in fields:
        print(f"  NULL {f}: {before_dict[f]:,}", flush=True)

    # Process in pages with keyset pagination
    last_id = '00000000-0000-0000-0000-000000000000'
    total_scanned = 0
    total_updated = 0
    total_fields = 0
    field_counts = {f: 0 for f in fields}
    t0 = time.time()
    page_num = 0

    while True:
        page_num += 1
        try:
            conn = get_conn()
            cur = conn.cursor()
            cur.execute("""
                SELECT id, description, year, make, model,
                       engine_size, transmission, color, interior_color,
                       mileage, drivetrain, body_style, horsepower
                FROM vehicles
                WHERE auction_source = 'bat' AND status = 'active'
                AND description IS NOT NULL
                AND (engine_size IS NULL OR transmission IS NULL OR color IS NULL
                     OR interior_color IS NULL OR mileage IS NULL OR drivetrain IS NULL
                     OR body_style IS NULL OR horsepower IS NULL)
                AND id > %s
                ORDER BY id LIMIT %s
            """, (last_id, PAGE_SIZE))
            rows = cur.fetchall()
            cur.close()
        except Exception as e:
            print(f"\n  [ERROR] Fetch page {page_num}: {e}", flush=True)
            try:
                conn.close()
            except:
                pass
            time.sleep(2)
            continue

        if not rows:
            conn.close()
            break

        last_id = str(rows[-1][0])
        total_scanned += len(rows)

        # Process all rows, build batch of updates
        batch = []
        for row in rows:
            vid = str(row[0])
            desc = row[1]
            year, make, model = row[2], row[3], row[4]
            existing = {
                'engine_size': row[5], 'transmission': row[6], 'color': row[7],
                'interior_color': row[8], 'mileage': row[9], 'drivetrain': row[10],
                'body_style': row[11], 'horsepower': row[12]
            }

            updates = extract_vehicle_updates(extractor, desc, year, make, model, existing)
            if updates:
                batch.append((vid, updates))

        # Execute batch updates
        if batch:
            cur = conn.cursor()
            batch_updated = 0
            for vid, updates in batch:
                set_clauses = []
                params = []
                for col, val in updates.items():
                    set_clauses.append(f"{col} = COALESCE({col}, %s)")
                    params.append(val)
                params.append(vid)
                try:
                    cur.execute(f"UPDATE vehicles SET {', '.join(set_clauses)} WHERE id = %s", params)
                    if cur.rowcount > 0:
                        batch_updated += 1
                        total_fields += len(updates)
                        for col in updates:
                            field_counts[col] += 1
                except Exception as e:
                    conn.rollback()

            conn.commit()
            total_updated += batch_updated
            cur.close()

        conn.close()

        elapsed = time.time() - t0
        rate = total_scanned / elapsed if elapsed > 0 else 0
        print(f"  Page {page_num}: scanned={total_scanned:,}, updated={total_updated:,}, "
              f"fields={total_fields:,}, rate={rate:.0f}/s", flush=True)

        time.sleep(0.1)  # Brief pause between pages

    elapsed = time.time() - t0

    # Get AFTER counts
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT
                count(*) as total,
                count(*) FILTER (WHERE engine_size IS NULL) as e,
                count(*) FILTER (WHERE transmission IS NULL) as t,
                count(*) FILTER (WHERE color IS NULL) as c,
                count(*) FILTER (WHERE interior_color IS NULL) as ic,
                count(*) FILTER (WHERE mileage IS NULL) as m,
                count(*) FILTER (WHERE drivetrain IS NULL) as d,
                count(*) FILTER (WHERE body_style IS NULL) as b,
                count(*) FILTER (WHERE horsepower IS NULL) as h
            FROM vehicles WHERE auction_source = 'bat' AND status = 'active' AND description IS NOT NULL
        """)
        after = cur.fetchone()
        cur.close()
        conn.close()
        after_dict = dict(zip(['total'] + fields, after))
    except Exception as e:
        print(f"[ERROR] Getting after counts: {e}")
        after_dict = None

    print(f"\n{'='*70}")
    print("RESULTS SUMMARY")
    print(f"{'='*70}")
    print(f"\nProcessing time: {elapsed:.1f}s ({total_scanned/elapsed:.0f} vehicles/s)")
    print(f"Vehicles scanned: {total_scanned:,}")
    print(f"Vehicles updated: {total_updated:,}")
    print(f"Total fields set: {total_fields:,}")
    print(f"\nPer-field fills:")
    for f in sorted(field_counts.keys(), key=lambda k: -field_counts[k]):
        print(f"  {f:20s}: {field_counts[f]:,}")

    if after_dict:
        print(f"\n{'Field':<20s} {'Before':>10s} {'After':>10s} {'Filled':>10s} {'%':>8s}")
        print("-" * 58)
        grand_total = 0
        for f in fields:
            b = before_dict[f]
            a = after_dict[f]
            filled = b - a
            grand_total += filled
            pct = (filled / b * 100) if b > 0 else 0
            print(f"  {f:<18s} {b:>8,}   {a:>8,}   {filled:>8,}   {pct:>6.1f}%")
        print("-" * 58)
        print(f"  {'TOTAL':<18s} {'':>8s}   {'':>8s}   {grand_total:>8,}")

    print("\nDone.", flush=True)


if __name__ == '__main__':
    main()
