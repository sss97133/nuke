#!/usr/bin/env python3
"""
Backfill vehicles table with regex-extracted fields from descriptions.

Reads BaT vehicles with descriptions in pages, runs DescriptionRegexExtractor,
and updates NULL fields with extracted values. Also processes GLiNER results
from /tmp/gliner-extract-results.json for the 10 test vehicles.

ONLY fills NULL fields — never overwrites existing data.
Batches updates 500 at a time with pg_sleep(0.1) between.
"""

import json
import os
import re
import sys
import time

import psycopg2
import psycopg2.extras

# Add project root to path for yono imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from yono.extractors.description_regex import DescriptionRegexExtractor

# --- Config ---
DB_HOST = "aws-0-us-west-1.pooler.supabase.com"
DB_PORT = 6543
DB_USER = "postgres.qkgaybvrernstplzjaam"
DB_PASS = "RbzKq32A0uhqvJMQ"
DB_NAME = "postgres"
PAGE_SIZE = 1000
BATCH_SIZE = 500

# --- Mapping from extract_flat() keys to vehicles columns ---
# extract_flat() key -> vehicles column
FIELD_MAP = {
    'exterior_color': 'color',
    'mileage': 'mileage',
    'drivetrain': 'drivetrain',
    'body_style': 'body_style',
    'horsepower': 'horsepower',
}

# These need special handling (list -> single value)
LIST_FIELD_MAP = {
    'engine': 'engine_size',        # Combine displacement + config
    'transmission': 'transmission',  # Best match
    'interior': 'interior_color',    # Best match
}

# GLiNER label -> vehicles column
GLINER_MAP = {
    'engine_displacement': 'engine_size',
    'engine_type': 'engine_type',
    'transmission_type': 'transmission',
    'exterior_paint_color': 'color',
    'interior_upholstery_color': 'interior_color',
    'odometer_mileage': 'mileage',
    'drivetrain_type': 'drivetrain',
}

VALID_DRIVETRAINS = {'RWD', 'FWD', 'AWD', '4WD', '2WD',
                     'rear-wheel-drive', 'front-wheel-drive',
                     'all-wheel-drive', 'four-wheel-drive',
                     'rear-wheel drive', 'front-wheel drive',
                     'all-wheel drive', 'four-wheel drive',
                     '4x4'}

DRIVETRAIN_NORMALIZE = {
    'rear-wheel-drive': 'RWD', 'rear-wheel drive': 'RWD',
    'front-wheel-drive': 'FWD', 'front-wheel drive': 'FWD',
    'all-wheel-drive': 'AWD', 'all-wheel drive': 'AWD',
    'four-wheel-drive': '4WD', 'four-wheel drive': '4WD',
    '4x4': '4WD', '2WD': '2WD',
    'RWD': 'RWD', 'FWD': 'FWD', 'AWD': 'AWD', '4WD': '4WD',
}


def parse_mileage(val):
    """Parse mileage from various formats to integer."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return int(val)
    s = str(val).strip().lower()
    # "79k miles" -> 79000
    m = re.match(r'([\d,.]+)\s*k\s*(?:miles?|mi\.?)?', s)
    if m:
        return int(float(m.group(1).replace(',', '')) * 1000)
    # "54,000 miles" or "54000"
    m = re.match(r'([\d,]+)', s)
    if m:
        num = int(m.group(1).replace(',', ''))
        # Sanity check: mileage should be 0 - 999,999
        if 0 <= num <= 999999:
            return num
    return None


def normalize_drivetrain(val):
    """Normalize drivetrain to standard abbreviation."""
    if not val:
        return None
    val_lower = val.lower().strip()
    for pattern, normalized in DRIVETRAIN_NORMALIZE.items():
        if pattern.lower() == val_lower:
            return normalized
    # Check if it's already a valid abbreviation
    if val.upper() in ('RWD', 'FWD', 'AWD', '4WD', '2WD'):
        return val.upper()
    return None


def build_engine_string(engine_results):
    """Combine engine extraction results into a single string.

    Priority: displacement first, then config, then forced induction, then family.
    Example outputs: "3.5L V8", "327ci", "2.0L turbocharged inline-4"
    """
    if not engine_results:
        return None

    parts = {'displacement': None, 'config': None, 'forced': None, 'family': None}

    for item in engine_results:
        if isinstance(item, dict):
            pattern = item.get('pattern', '')
            value = item.get('value', '')
        else:
            pattern = getattr(item, 'pattern', '')
            value = getattr(item, 'value', '')

        if pattern in ('engine_liter', 'engine_ci', 'engine_cc') and not parts['displacement']:
            parts['displacement'] = value
        elif pattern == 'engine_config' and not parts['config']:
            parts['config'] = value
        elif pattern == 'engine_forced_induction' and not parts['forced']:
            parts['forced'] = value
        elif pattern == 'engine_family' and not parts['family']:
            parts['family'] = value

    # Build string: "3.5L V8 turbocharged" or "LS3" or "327ci V8"
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


def build_transmission_string(trans_results):
    """Pick best transmission match."""
    if not trans_results:
        return None

    # Prefer specific > type > generic
    priority = {'transmission_specific': 3, 'transmission_type': 2, 'transmission_generic': 1}

    best = None
    best_score = -1
    for item in trans_results:
        if isinstance(item, dict):
            pattern = item.get('pattern', '')
            value = item.get('value', '')
            conf = item.get('confidence', 0)
        else:
            pattern = getattr(item, 'pattern', '')
            value = getattr(item, 'value', '')
            conf = getattr(item, 'confidence', 0)

        score = priority.get(pattern, 0) * 10 + conf
        if score > best_score:
            best_score = score
            best = value

    return best


def build_interior_string(interior_results):
    """Pick best interior match."""
    if not interior_results:
        return None

    best = max(interior_results,
               key=lambda r: r['confidence'] if isinstance(r, dict) else r.confidence)
    return best['value'] if isinstance(best, dict) else best.value


def process_gliner_results(conn, gliner_file):
    """Process GLiNER extraction results and update vehicles table."""
    if not os.path.exists(gliner_file):
        print(f"[GLiNER] File not found: {gliner_file}")
        return 0, 0

    with open(gliner_file) as f:
        data = json.load(f)

    if not isinstance(data, list) or not data:
        print("[GLiNER] No records in file")
        return 0, 0

    vehicles_updated = 0
    fields_filled = 0

    cur = conn.cursor()

    for record in data:
        vid = record.get('id')
        entities = record.get('entities', [])
        if not vid or not entities:
            continue

        # Group entities by label, pick highest confidence per label
        by_label = {}
        for ent in entities:
            label = ent.get('label', '')
            score = ent.get('score', 0)
            text = ent.get('text', '')
            if label not in by_label or score > by_label[label][1]:
                by_label[label] = (text, score)

        updates = {}
        for gliner_label, (text, score) in by_label.items():
            if score < 0.5:  # Skip low confidence
                continue

            col = GLINER_MAP.get(gliner_label)
            if not col:
                continue

            if col == 'mileage':
                val = parse_mileage(text)
                if val is not None:
                    updates[col] = val
            elif col == 'drivetrain':
                val = normalize_drivetrain(text)
                if val:
                    updates[col] = val
            else:
                # String fields: skip very short or clearly bad
                if len(text.strip()) >= 2:
                    updates[col] = text.strip()

        if not updates:
            continue

        # Build UPDATE with COALESCE to only fill NULLs
        set_clauses = []
        params = []
        for col, val in updates.items():
            set_clauses.append(f"{col} = COALESCE({col}, %s)")
            params.append(val)

        params.append(vid)
        sql = f"UPDATE vehicles SET {', '.join(set_clauses)} WHERE id = %s"
        cur.execute(sql, params)

        if cur.rowcount > 0:
            vehicles_updated += 1
            fields_filled += len(updates)

    conn.commit()
    cur.close()

    print(f"[GLiNER] Updated {vehicles_updated} vehicles, filled {fields_filled} field slots")
    return vehicles_updated, fields_filled


def get_before_counts(conn):
    """Get current NULL field counts for BaT vehicles with descriptions."""
    cur = conn.cursor()
    cur.execute("""
        SELECT
            count(*) as total,
            count(*) FILTER (WHERE engine_size IS NULL) as missing_engine,
            count(*) FILTER (WHERE transmission IS NULL) as missing_trans,
            count(*) FILTER (WHERE color IS NULL) as missing_color,
            count(*) FILTER (WHERE interior_color IS NULL) as missing_interior,
            count(*) FILTER (WHERE mileage IS NULL) as missing_mileage,
            count(*) FILTER (WHERE drivetrain IS NULL) as missing_drivetrain,
            count(*) FILTER (WHERE body_style IS NULL) as missing_body,
            count(*) FILTER (WHERE horsepower IS NULL) as missing_hp
        FROM vehicles
        WHERE auction_source = 'bat' AND status = 'active'
        AND description IS NOT NULL
    """)
    row = cur.fetchone()
    cur.close()
    return {
        'total': row[0],
        'engine_size': row[1],
        'transmission': row[2],
        'color': row[3],
        'interior_color': row[4],
        'mileage': row[5],
        'drivetrain': row[6],
        'body_style': row[7],
        'horsepower': row[8],
    }


def check_locks(conn):
    """Check for lock waiters."""
    cur = conn.cursor()
    cur.execute("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'")
    count = cur.fetchone()[0]
    cur.close()
    return count


def run_regex_backfill(conn):
    """Main backfill: run regex extractor on all BaT vehicles with descriptions."""
    extractor = DescriptionRegexExtractor()

    total_vehicles = 0
    total_updated = 0
    total_fields = 0
    field_counts = {
        'engine_size': 0, 'transmission': 0, 'color': 0,
        'interior_color': 0, 'mileage': 0, 'drivetrain': 0,
        'body_style': 0, 'horsepower': 0,
    }

    batch = []
    batch_num = 0
    last_id = '00000000-0000-0000-0000-000000000000'

    while True:
        # Keyset pagination — fetch next page
        cur_read = conn.cursor()
        cur_read.execute("""
            SELECT id, description, year, make, model,
                   engine_size, transmission, color, interior_color,
                   mileage, drivetrain, body_style, horsepower
            FROM vehicles
            WHERE auction_source = 'bat'
            AND status = 'active'
            AND description IS NOT NULL
            AND (engine_size IS NULL OR transmission IS NULL OR color IS NULL
                 OR interior_color IS NULL OR mileage IS NULL OR drivetrain IS NULL
                 OR body_style IS NULL OR horsepower IS NULL)
            AND id > %s
            ORDER BY id
            LIMIT %s
        """, (last_id, PAGE_SIZE))

        rows = cur_read.fetchall()
        cur_read.close()

        if not rows:
            break

        last_id = rows[-1][0]  # Track last ID for next page

        cur_write = conn.cursor()

        for row in rows:
            vid, desc, year, make, model = row[0], row[1], row[2], row[3], row[4]
            existing = {
                'engine_size': row[5],
                'transmission': row[6],
                'color': row[7],
                'interior_color': row[8],
                'mileage': row[9],
                'drivetrain': row[10],
                'body_style': row[11],
                'horsepower': row[12],
            }

            total_vehicles += 1

            if not desc or len(desc.strip()) < 20:
                continue

            # Run regex extractor
            try:
                result = extractor.extract(desc, year=year, make=make, model=model)
            except Exception as e:
                continue

            updates = {}

            # Engine size: combine displacement + config
            if existing['engine_size'] is None:
                engine_str = build_engine_string(result.get('engine', []))
                if engine_str:
                    updates['engine_size'] = engine_str

            # Transmission
            if existing['transmission'] is None:
                trans_str = build_transmission_string(result.get('transmission', []))
                if trans_str:
                    updates['transmission'] = trans_str

            # Color
            if existing['color'] is None:
                colors = result.get('exterior_color', [])
                if colors:
                    best = max(colors, key=lambda r: r['confidence'])
                    val = best['value'].strip()
                    # Clean up: remove trailing prepositions
                    val = re.sub(r'\s+(?:over|with|and)\s*$', '', val, flags=re.I)
                    if len(val) >= 2 and len(val) <= 80:
                        updates['color'] = val

            # Interior color
            if existing['interior_color'] is None:
                interiors = result.get('interior', [])
                if interiors:
                    best = max(interiors, key=lambda r: r['confidence'])
                    val = best['value'].strip()
                    val = re.sub(r'\s+(?:and|with)\s*$', '', val, flags=re.I)
                    if len(val) >= 2 and len(val) <= 80:
                        updates['interior_color'] = val

            # Mileage
            if existing['mileage'] is None:
                mileage_results = result.get('mileage', [])
                if mileage_results:
                    # Prefer high-context patterns
                    priority = {'odometer_context': 3, 'mileage_shows': 2,
                                'mileage_general': 1, 'mileage_k': 1}
                    best = max(mileage_results,
                               key=lambda r: (priority.get(r['pattern'], 0), r['confidence']))
                    val = parse_mileage(best['value'])
                    if val is not None and 0 < val < 500000:
                        updates['mileage'] = val

            # Drivetrain
            if existing['drivetrain'] is None:
                dt_results = result.get('drivetrain', [])
                if dt_results:
                    best = max(dt_results, key=lambda r: r['confidence'])
                    val = normalize_drivetrain(best['value'])
                    if val:
                        updates['drivetrain'] = val

            # Body style
            if existing['body_style'] is None:
                bs_results = result.get('body_style', [])
                if bs_results:
                    best = max(bs_results, key=lambda r: r['confidence'])
                    val = best['value'].strip().lower()
                    # Capitalize first letter
                    val = val[0].upper() + val[1:] if val else val
                    if len(val) >= 3:
                        updates['body_style'] = val

            # Horsepower
            if existing['horsepower'] is None:
                hp_results = result.get('horsepower', [])
                if hp_results:
                    best = max(hp_results, key=lambda r: r['confidence'])
                    try:
                        hp_val = int(best['value'].replace(',', ''))
                        if 10 <= hp_val <= 2000:
                            updates['horsepower'] = hp_val
                    except (ValueError, AttributeError):
                        pass

            if updates:
                batch.append((vid, updates))

            # Flush batch
            if len(batch) >= BATCH_SIZE:
                batch_num += 1
                updated, filled, fc = flush_batch(cur_write, batch)
                total_updated += updated
                total_fields += filled
                for k, v in fc.items():
                    field_counts[k] += v
                conn.commit()

                # Check locks
                locks = check_locks(conn)
                if locks > 0:
                    print(f"  [WARNING] {locks} lock waiters detected! Pausing 2s...")
                    time.sleep(2)
                else:
                    time.sleep(0.1)  # Standard pause between batches

                if batch_num % 10 == 0:
                    print(f"  Batch {batch_num}: {total_vehicles} processed, "
                          f"{total_updated} updated, {total_fields} fields filled")

                batch = []

        cur_write.close()

    # Final flush
    if batch:
        cur_write = conn.cursor()
        updated, filled, fc = flush_batch(cur_write, batch)
        total_updated += updated
        total_fields += filled
        for k, v in fc.items():
            field_counts[k] += v
        conn.commit()
        cur_write.close()

    return total_vehicles, total_updated, total_fields, field_counts


def flush_batch(cur, batch):
    """Execute a batch of updates. Returns (vehicles_updated, fields_filled, field_counts)."""
    updated = 0
    filled = 0
    fc = {
        'engine_size': 0, 'transmission': 0, 'color': 0,
        'interior_color': 0, 'mileage': 0, 'drivetrain': 0,
        'body_style': 0, 'horsepower': 0,
    }

    for vid, updates in batch:
        set_clauses = []
        params = []
        for col, val in updates.items():
            # Use COALESCE so we only fill NULLs (race-safe)
            set_clauses.append(f"{col} = COALESCE({col}, %s)")
            params.append(val)

        params.append(vid)
        sql = f"UPDATE vehicles SET {', '.join(set_clauses)} WHERE id = %s"

        try:
            cur.execute(sql, params)
            if cur.rowcount > 0:
                updated += 1
                filled += len(updates)
                for col in updates:
                    fc[col] += 1
        except Exception as e:
            print(f"  [ERROR] Vehicle {vid}: {e}")
            cur.connection.rollback()

    return updated, filled, fc


def main():
    print("=" * 70)
    print("REGEX EXTRACTION BACKFILL — BaT Vehicles")
    print("=" * 70)
    print()

    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER,
        password=DB_PASS, dbname=DB_NAME,
        options="-c statement_timeout=60000"  # 60s per statement
    )
    conn.autocommit = False

    # --- BEFORE counts ---
    print("[1/4] Measuring BEFORE state...")
    before = get_before_counts(conn)
    print(f"  Total BaT vehicles with descriptions: {before['total']:,}")
    print(f"  NULL engine_size:   {before['engine_size']:,}")
    print(f"  NULL transmission:  {before['transmission']:,}")
    print(f"  NULL color:         {before['color']:,}")
    print(f"  NULL interior_color:{before['interior_color']:,}")
    print(f"  NULL mileage:       {before['mileage']:,}")
    print(f"  NULL drivetrain:    {before['drivetrain']:,}")
    print(f"  NULL body_style:    {before['body_style']:,}")
    print(f"  NULL horsepower:    {before['horsepower']:,}")
    print()

    # --- GLiNER results ---
    print("[2/4] Processing GLiNER extraction results...")
    gliner_updated, gliner_filled = process_gliner_results(
        conn, '/tmp/gliner-extract-results.json'
    )
    print()

    # --- Regex backfill ---
    print("[3/4] Running regex extractor on ALL BaT vehicles with NULL fields...")
    t0 = time.time()
    total_vehicles, total_updated, total_fields, field_counts = run_regex_backfill(conn)
    elapsed = time.time() - t0
    print()
    print(f"  Regex extraction complete in {elapsed:.1f}s")
    print(f"  Vehicles scanned:  {total_vehicles:,}")
    print(f"  Vehicles updated:  {total_updated:,}")
    print(f"  Total fields set:  {total_fields:,}")
    print(f"  Per-field breakdown:")
    for field, count in sorted(field_counts.items(), key=lambda x: -x[1]):
        print(f"    {field:20s}: {count:,}")
    print()

    # --- AFTER counts ---
    print("[4/4] Measuring AFTER state...")
    after = get_before_counts(conn)

    print()
    print("=" * 70)
    print("RESULTS SUMMARY")
    print("=" * 70)
    print()
    print(f"{'Field':<20s} {'Before NULL':>12s} {'After NULL':>12s} {'Filled':>10s} {'Fill %':>8s}")
    print("-" * 62)

    total_filled_overall = 0
    for field in ['engine_size', 'transmission', 'color', 'interior_color',
                  'mileage', 'drivetrain', 'body_style', 'horsepower']:
        b = before[field]
        a = after[field]
        filled = b - a
        total_filled_overall += filled
        pct = (filled / b * 100) if b > 0 else 0
        print(f"  {field:<18s} {b:>10,}   {a:>10,}   {filled:>8,}   {pct:>6.1f}%")

    print("-" * 62)
    print(f"  {'TOTAL':<18s} {'':>10s}   {'':>10s}   {total_filled_overall:>8,}")
    print()

    # Field completeness
    print(f"BaT vehicles with descriptions: {before['total']:,}")
    print(f"Total NULL fields filled: {total_filled_overall:,}")
    print(f"GLiNER contributed: {gliner_filled} fields across {gliner_updated} vehicles")
    print(f"Processing rate: {total_vehicles / elapsed:.0f} vehicles/second")
    print()

    conn.close()
    print("Done.")


if __name__ == '__main__':
    main()
