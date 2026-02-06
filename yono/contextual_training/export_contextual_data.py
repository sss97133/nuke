#!/usr/bin/env python3
"""
Export Contextual Training Data

Creates training packages: image + full context
- Vehicle profile
- Listing metadata
- Behavioral signals (comments, bids)
- Outcome (sale price)

This is what makes our training unique - not just images, but DATA PACKAGES.
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

# Load env
for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    key, _, val = line.partition("=")
    os.environ.setdefault(key.strip(), val.strip('"').strip("'"))

DB_URL = os.environ.get("SUPABASE_DB_URL")


def get_connection():
    """Get database connection"""
    return psycopg2.connect(DB_URL)


def export_contextual_packages(limit=10000, price_tier=None, min_comments=10):
    """
    Export training data packages

    Each package = image + full context
    """
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Build query with filters
    where_clauses = ["v.sale_price > 0", "vi.image_url IS NOT NULL"]

    if price_tier == "elite":
        where_clauses.append("v.sale_price >= 500000")
    elif price_tier == "high":
        where_clauses.append("v.sale_price BETWEEN 100000 AND 500000")
    elif price_tier == "mid":
        where_clauses.append("v.sale_price BETWEEN 50000 AND 100000")
    elif price_tier == "entry":
        where_clauses.append("v.sale_price < 50000")

    if min_comments:
        where_clauses.append(f"COALESCE(bl.comment_count, 0) >= {min_comments}")

    query = f"""
    SELECT
        vi.id as image_id,
        vi.image_url,
        vi.category as image_category,
        vi.ai_detected_angle,
        vi.ai_detected_vehicle,
        vi.components,

        v.id as vehicle_id,
        v.year,
        v.make,
        v.model,
        v.color,
        v.mileage,
        v.transmission,
        v.engine_size,
        v.condition_rating,

        v.sale_price,
        v.bid_count,
        v.view_count,

        bl.comment_count,
        bl.sold_at

    FROM vehicle_images vi
    JOIN vehicles v ON v.id = vi.vehicle_id
    LEFT JOIN bat_listings bl ON bl.vehicle_id = v.id
    WHERE {' AND '.join(where_clauses)}
    ORDER BY v.sale_price DESC
    LIMIT {limit}
    """

    cur.execute(query)
    rows = cur.fetchall()
    conn.close()

    return rows


def package_for_training(row):
    """Convert DB row to training package"""

    # Determine price tier
    price = row['sale_price'] or 0
    if price >= 500000:
        price_tier = "elite"
    elif price >= 100000:
        price_tier = "high"
    elif price >= 50000:
        price_tier = "mid"
    else:
        price_tier = "entry"

    # Calculate engagement score
    comments = row['comment_count'] or 0
    bids = row['bid_count'] or 0
    views = row['view_count'] or 0
    engagement = (comments * 10 + bids * 5 + views * 0.01) / 100

    return {
        "image_id": str(row['image_id']),
        "image_url": row['image_url'],
        "image_metadata": {
            "category": row['image_category'],
            "detected_angle": row['ai_detected_angle'],
            "detected_vehicle": row['ai_detected_vehicle'],
            "components": row['components']
        },

        "vehicle_context": {
            "year": row['year'],
            "make": row['make'],
            "model": row['model'],
            "color": row['color'],
            "mileage": row['mileage'],
            "transmission": row['transmission'],
            "engine": row['engine_size'],
            "condition": row['condition_rating']
        },

        "behavioral_signals": {
            "comment_count": comments,
            "bid_count": bids,
            "view_count": views,
            "engagement_score": round(engagement, 2)
        },

        "outcome": {
            "sale_price": price,
            "price_tier": price_tier,
            "sold": price > 0
        }
    }


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10000, help="Max records to export")
    parser.add_argument("--tier", choices=["elite", "high", "mid", "entry"], help="Filter by price tier")
    parser.add_argument("--min-comments", type=int, default=10, help="Minimum comment count")
    parser.add_argument("--output", type=str, help="Output file path")
    args = parser.parse_args()

    print(f"Exporting contextual training data...")
    print(f"  Limit: {args.limit}")
    print(f"  Price tier: {args.tier or 'all'}")
    print(f"  Min comments: {args.min_comments}")

    rows = export_contextual_packages(
        limit=args.limit,
        price_tier=args.tier,
        min_comments=args.min_comments
    )

    print(f"\nFetched {len(rows)} records")

    # Package for training
    packages = [package_for_training(row) for row in rows]

    # Stats
    by_tier = {}
    for p in packages:
        tier = p['outcome']['price_tier']
        by_tier[tier] = by_tier.get(tier, 0) + 1

    print("\nBy price tier:")
    for tier, count in sorted(by_tier.items()):
        print(f"  {tier}: {count}")

    # Save
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_file = Path(args.output) if args.output else OUTPUT_DIR / f"contextual_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl"

    with open(output_file, 'w') as f:
        for p in packages:
            f.write(json.dumps(p) + '\n')

    print(f"\nSaved to: {output_file}")
    print(f"File size: {output_file.stat().st_size / 1024 / 1024:.1f} MB")

    # Show sample
    print("\nSample package:")
    print(json.dumps(packages[0], indent=2))


if __name__ == "__main__":
    main()
