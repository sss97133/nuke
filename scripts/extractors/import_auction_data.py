#!/usr/bin/env python3
"""
Import extracted auction data to Nuke database.

Usage:
  python import_auction_data.py data/glenmarch/glenmarch_20260206.json
  python import_auction_data.py data/barrett_jackson/barrett_jackson_20260206.json
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime
import psycopg2
from psycopg2.extras import execute_values

# Config
NUKE_DIR = Path("/Users/skylar/nuke")

# Load env
for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    key, _, val = line.partition("=")
    os.environ.setdefault(key.strip(), val.strip('"').strip("'"))

DB_URL = os.environ.get("SUPABASE_DB_URL")


def get_connection():
    return psycopg2.connect(DB_URL)


def normalize_record(record):
    """Normalize extracted record to vehicle schema"""
    return {
        'year': record.get('year'),
        'make': record.get('make'),
        'model': record.get('model'),
        'sale_price': record.get('sale_price'),
        'vin': record.get('vin'),
        'mileage': record.get('mileage'),
        'color': record.get('color'),
        'listing_url': record.get('source_url') or record.get('detail_url'),
        'notes': json.dumps({
            'lot_number': record.get('lot_number'),
            'auction_house': record.get('auction_house'),
            'auction_name': record.get('auction_name'),
            'title': record.get('title'),
            'status': record.get('status'),
            'extracted_at': record.get('extracted_at'),
            'source': record.get('source'),
        }),
    }


def import_records(filepath):
    """Import records from JSON file"""
    print(f"Loading {filepath}...")

    with open(filepath) as f:
        records = json.load(f)

    print(f"Loaded {len(records)} records")

    # Normalize
    normalized = [normalize_record(r) for r in records]

    # Filter out records without year or make
    valid = [r for r in normalized if r.get('year') or r.get('make')]
    print(f"Valid records: {len(valid)}")

    if not valid:
        print("No valid records to import")
        return 0

    conn = get_connection()
    cur = conn.cursor()

    # Prepare batch insert
    columns = ['year', 'make', 'model', 'sale_price', 'vin', 'mileage', 'color', 'listing_url', 'notes']

    values = []
    for r in valid:
        values.append((
            r.get('year'),
            r.get('make'),
            r.get('model'),
            r.get('sale_price'),
            r.get('vin'),
            r.get('mileage'),
            r.get('color'),
            r.get('listing_url'),
            r.get('notes'),
        ))

    # Insert in batches
    batch_size = 1000
    inserted = 0

    for i in range(0, len(values), batch_size):
        batch = values[i:i+batch_size]

        query = f"""
        INSERT INTO vehicles ({', '.join(columns)})
        VALUES %s
        ON CONFLICT DO NOTHING
        """

        try:
            execute_values(cur, query, batch)
            conn.commit()
            inserted += len(batch)
            print(f"  Inserted batch {i//batch_size + 1}: {len(batch)} records (total: {inserted})")
        except Exception as e:
            print(f"  Error on batch {i//batch_size + 1}: {e}")
            conn.rollback()

    cur.close()
    conn.close()

    return inserted


def main():
    if len(sys.argv) < 2:
        print("Usage: python import_auction_data.py <json_file>")
        print("\nExample:")
        print("  python import_auction_data.py data/glenmarch/glenmarch_20260206.json")
        sys.exit(1)

    filepath = Path(sys.argv[1])
    if not filepath.exists():
        print(f"File not found: {filepath}")
        sys.exit(1)

    print("=" * 60)
    print("Auction Data Importer")
    print(f"File: {filepath}")
    print(f"Started: {datetime.now().isoformat()}")
    print("=" * 60)

    count = import_records(filepath)

    print("\n" + "=" * 60)
    print(f"IMPORT COMPLETE: {count} records")
    print("=" * 60)


if __name__ == "__main__":
    main()
