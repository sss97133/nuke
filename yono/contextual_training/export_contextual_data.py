#!/usr/bin/env python3
"""
Export Contextual Training Data — v2

Creates training packages: image + Y/M/M knowledge + vehicle context + labels.
Each package includes the pre-computed Y/M/M feature vector from ymm_knowledge.

V2 changes (contextual intelligence pipeline):
  - Joins with ymm_knowledge.feature_vector for Y/M/M context
  - Includes zone labels, damage_flags, modification_flags for multi-task training
  - Includes vehicle instance features for featurize_vehicle_instance()
  - Compatible with ContextualModelV2 training pipeline

Usage:
  cd /Users/skylar/nuke
  dotenvx run -- python3 yono/contextual_training/export_contextual_data.py --limit 10000
  dotenvx run -- python3 yono/contextual_training/export_contextual_data.py --all
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime

import psycopg2
from psycopg2.extras import RealDictCursor

# Config
NUKE_DIR = Path("/Users/skylar/nuke")
OUTPUT_DIR = NUKE_DIR / "yono" / "contextual_training" / "data"


def get_connection():
    """Get database connection."""
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
        if not db_pass:
            for line in (NUKE_DIR / ".env").read_text().splitlines():
                if line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip('"').strip("'"))
            db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
        if db_pass:
            db_url = (
                f"postgresql://postgres.qkgaybvrernstplzjaam:{db_pass}"
                f"@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
                f"?sslmode=require"
            )
        else:
            raise RuntimeError("SUPABASE_DB_PASSWORD not set")
    elif "sslmode" not in db_url:
        db_url += "?sslmode=require" if "?" not in db_url else "&sslmode=require"
    return psycopg2.connect(db_url, connect_timeout=30)


def export_contextual_packages(
    conn, limit: int = 10000, price_tier: str = None,
    require_zone: bool = True, require_condition: bool = False,
):
    """
    Export training data packages with Y/M/M feature vectors.

    Each package = image + vehicle context + Y/M/M knowledge vector + labels.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '120s'")

    where = ["v.sale_price > 0", "vi.image_url IS NOT NULL",
             "v.year IS NOT NULL", "v.make IS NOT NULL", "v.model IS NOT NULL"]

    if require_zone:
        where.append("vi.vehicle_zone IS NOT NULL")
    if require_condition:
        where.append("vi.condition_score IS NOT NULL")

    if price_tier == "elite":
        where.append("v.sale_price >= 500000")
    elif price_tier == "high":
        where.append("v.sale_price >= 100000 AND v.sale_price < 500000")
    elif price_tier == "mid":
        where.append("v.sale_price >= 50000 AND v.sale_price < 100000")
    elif price_tier == "entry":
        where.append("v.sale_price >= 10000 AND v.sale_price < 50000")
    elif price_tier == "budget":
        where.append("v.sale_price > 0 AND v.sale_price < 10000")

    query = f"""
    SELECT
        vi.id as image_id,
        vi.image_url,
        vi.vehicle_zone,
        vi.condition_score,
        vi.damage_flags,
        vi.modification_flags,
        vi.created_at as image_timestamp,

        v.id as vehicle_id,
        v.year, v.make, v.model,
        v.color, v.mileage, v.transmission,
        v.engine_type, v.drivetrain, v.vin,
        v.condition_rating,
        v.sale_price, v.bid_count, v.view_count,

        CONCAT(v.year, '_', v.make, '_', v.model) as ymm_key,

        yk.feature_vector as ymm_feature_vector,
        yk.vehicle_count as ymm_vehicle_count,
        yk.source_comment_count as ymm_comment_count

    FROM vehicle_images vi
    JOIN vehicles v ON v.id = vi.vehicle_id
    LEFT JOIN LATERAL (
        SELECT feature_vector, vehicle_count, source_comment_count
        FROM ymm_knowledge
        WHERE year = v.year AND make = v.make
          AND (model = v.model OR v.model LIKE model || ' %')
        ORDER BY (model = v.model)::int DESC, vehicle_count DESC
        LIMIT 1
    ) yk ON true
    WHERE {' AND '.join(where)}
    ORDER BY RANDOM()
    LIMIT {limit}
    """

    cur.execute(query)
    rows = cur.fetchall()
    cur.close()
    return rows


def package_for_training(row: dict) -> dict:
    """Convert DB row to training package with Y/M/M context."""
    price = row['sale_price'] or 0
    if price >= 500000:
        price_tier = "elite"
    elif price >= 100000:
        price_tier = "high"
    elif price >= 50000:
        price_tier = "mid"
    elif price >= 10000:
        price_tier = "entry"
    else:
        price_tier = "budget"

    return {
        "image_id": str(row['image_id']),
        "image_url": row['image_url'],

        # Labels (multi-task targets)
        "labels": {
            "vehicle_zone": row['vehicle_zone'],
            "condition_score": row['condition_score'],
            "damage_flags": row['damage_flags'] or [],
            "modification_flags": row['modification_flags'] or [],
            "price_tier": price_tier,
            "sale_price": price,
        },

        # Vehicle instance context (for featurize_vehicle_instance)
        "vehicle": {
            "vehicle_id": str(row['vehicle_id']),
            "year": row['year'],
            "make": row['make'],
            "model": row['model'],
            "color": row['color'],
            "mileage": row['mileage'],
            "transmission": row['transmission'],
            "engine_type": row['engine_type'],
            "drivetrain": row['drivetrain'],
            "vin": row['vin'],
            "condition_rating": row['condition_rating'],
            "sale_price": price,
            "bid_count": row['bid_count'],
            "view_count": row['view_count'],
        },

        # Y/M/M knowledge context (pre-computed feature vector)
        "ymm_key": row['ymm_key'],
        "ymm_feature_vector": row['ymm_feature_vector'],  # float[] or None
        "ymm_vehicle_count": row['ymm_vehicle_count'],
        "ymm_comment_count": row['ymm_comment_count'],

        # Timestamp for timeline features
        "image_timestamp": row['image_timestamp'].isoformat() if row.get('image_timestamp') else None,
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Export contextual training data v2")
    parser.add_argument("--limit", type=int, default=10000, help="Max records")
    parser.add_argument("--all", action="store_true", help="Export all matching records (no limit)")
    parser.add_argument("--tier", choices=["elite", "high", "mid", "entry", "budget"],
                        help="Filter by price tier")
    parser.add_argument("--require-zone", action="store_true", default=True,
                        help="Only images with zone labels (default: true)")
    parser.add_argument("--no-require-zone", action="store_false", dest="require_zone")
    parser.add_argument("--require-condition", action="store_true",
                        help="Only images with condition scores")
    parser.add_argument("--output", type=str, help="Output file path")
    args = parser.parse_args()

    conn = get_connection()

    limit = 999999999 if args.all else args.limit
    print(f"Exporting contextual training data v2...")
    print(f"  Limit: {'all' if args.all else args.limit}")
    print(f"  Price tier: {args.tier or 'all'}")
    print(f"  Require zone: {args.require_zone}")
    print(f"  Require condition: {args.require_condition}")

    rows = export_contextual_packages(
        conn, limit=limit, price_tier=args.tier,
        require_zone=args.require_zone,
        require_condition=args.require_condition,
    )

    print(f"\nFetched {len(rows)} records")

    # Package
    packages = [package_for_training(row) for row in rows]

    # Stats
    by_tier = {}
    with_ymm = 0
    with_damage = 0
    with_mods = 0
    for p in packages:
        tier = p['labels']['price_tier']
        by_tier[tier] = by_tier.get(tier, 0) + 1
        if p.get('ymm_feature_vector'):
            with_ymm += 1
        if p['labels']['damage_flags']:
            with_damage += 1
        if p['labels']['modification_flags']:
            with_mods += 1

    print("\nBy price tier:")
    for tier, count in sorted(by_tier.items()):
        print(f"  {tier}: {count}")

    print(f"\nWith Y/M/M knowledge: {with_ymm}/{len(packages)} ({100*with_ymm/max(len(packages),1):.0f}%)")
    print(f"With damage labels:   {with_damage}/{len(packages)}")
    print(f"With mod labels:      {with_mods}/{len(packages)}")

    # Save
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_file = (
        Path(args.output) if args.output
        else OUTPUT_DIR / f"contextual_v2_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl"
    )

    with open(output_file, 'w') as f:
        for p in packages:
            f.write(json.dumps(p, default=str) + '\n')

    size_mb = output_file.stat().st_size / (1024 * 1024)
    print(f"\nSaved to: {output_file} ({size_mb:.1f} MB)")

    # Sample
    if packages:
        sample = packages[0]
        print(f"\nSample — {sample['ymm_key']}:")
        print(f"  Zone: {sample['labels']['vehicle_zone']}")
        print(f"  Condition: {sample['labels']['condition_score']}")
        print(f"  Damage: {sample['labels']['damage_flags']}")
        print(f"  Mods: {sample['labels']['modification_flags']}")
        print(f"  YMM vector: {'present' if sample['ymm_feature_vector'] else 'missing'}")

    conn.close()


if __name__ == "__main__":
    main()
