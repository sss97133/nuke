#!/usr/bin/env python3
"""
Training Sampler — Stratified sampling for YONO zone classifier training data.

Builds balanced training sets from surface_observations by:
  - Capping over-represented zones (prevents model bias toward detail_badge, int_dashboard)
  - Upsampling rare zones via duplicate inclusion (ensures model sees ext_roof, panel_trunk)
  - Prioritizing high-confidence observations within each zone
  - Joining vehicle_images (image URL) and vehicles (year/make/model) for full context

The surface_observations table has 166K observations across 41 zones, but distribution
is heavily skewed: top 3 zones hold ~60% of all data, bottom 20 zones hold <5%.

Usage:
  cd /Users/skylar/nuke

  # Show zone distribution with over/under analysis
  python3 -m yono.training_sampler stats

  # Generate a stratified training set
  python3 -m yono.training_sampler sample --output training_set.jsonl \\
      --max-per-zone 5000 --min-per-zone 500 --confidence-threshold 0.5

  # Validate a generated training set
  python3 -m yono.training_sampler validate --input training_set.jsonl
"""

import argparse
import json
import os
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor

NUKE_DIR = Path("/Users/skylar/nuke")


# ─── DB Connection ──────────────────────────────────────────────────

def get_connection():
    """Get database connection. Matches pattern from condition_spectrometer.py."""
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
        if not db_pass:
            env_file = NUKE_DIR / ".env"
            if env_file.exists():
                for line in env_file.read_text().splitlines():
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


# ─── Stats Command ──────────────────────────────────────────────────

def cmd_stats(args):
    """Show zone distribution with over/under representation analysis."""
    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SET statement_timeout = '30s'")

        # Get zone counts and confidence stats
        cur.execute("""
            SELECT
                zone,
                count(*) AS cnt,
                round(avg(confidence)::numeric, 4) AS avg_confidence,
                round(min(confidence)::numeric, 4) AS min_confidence,
                round(max(confidence)::numeric, 4) AS max_confidence,
                count(*) FILTER (WHERE confidence > 0.5) AS above_05,
                count(*) FILTER (WHERE confidence > 0.3) AS above_03,
                count(*) FILTER (WHERE confidence > 0.1) AS above_01,
                count(DISTINCT vehicle_id) AS unique_vehicles
            FROM surface_observations
            GROUP BY zone
            ORDER BY cnt DESC
        """)
        rows = cur.fetchall()

        total = sum(r["cnt"] for r in rows)
        n_zones = len(rows)
        ideal_per_zone = total / n_zones if n_zones > 0 else 0

        print(f"\n{'='*100}")
        print(f"  SURFACE OBSERVATIONS — Zone Distribution")
        print(f"  Total: {total:,} observations across {n_zones} zones")
        print(f"  Ideal per zone (uniform): {ideal_per_zone:,.0f}")
        print(f"{'='*100}\n")

        # Header
        print(f"  {'Zone':<25} {'Count':>8} {'Pct':>7} {'Ratio':>7} "
              f"{'AvgConf':>8} {'MaxConf':>8} "
              f"{'> 0.5':>7} {'> 0.3':>7} {'> 0.1':>7} "
              f"{'Vehicles':>9} {'Status':<15}")
        print(f"  {'-'*24} {'-'*8} {'-'*7} {'-'*7} "
              f"{'-'*8} {'-'*8} "
              f"{'-'*7} {'-'*7} {'-'*7} "
              f"{'-'*9} {'-'*15}")

        for r in rows:
            cnt = r["cnt"]
            pct = (cnt / total * 100) if total > 0 else 0
            ratio = cnt / ideal_per_zone if ideal_per_zone > 0 else 0

            # Determine status
            if ratio > 3.0:
                status = "OVER (cap)"
            elif ratio > 1.5:
                status = "over"
            elif ratio < 0.1:
                status = "RARE (upsample)"
            elif ratio < 0.3:
                status = "under"
            else:
                status = "ok"

            avg_conf = float(r["avg_confidence"]) if r["avg_confidence"] is not None else 0.0
            max_conf = float(r["max_confidence"]) if r["max_confidence"] is not None else 0.0

            print(f"  {r['zone']:<25} {cnt:>8,} {pct:>6.1f}% {ratio:>6.2f}x "
                  f"{avg_conf:>8.4f} {max_conf:>8.4f} "
                  f"{r['above_05']:>7,} {r['above_03']:>7,} {r['above_01']:>7,} "
                  f"{r['unique_vehicles']:>9,} {status:<15}")

        # Summary
        over_zones = [r for r in rows if r["cnt"] / ideal_per_zone > 3.0]
        under_zones = [r for r in rows if r["cnt"] / ideal_per_zone < 0.3]
        rare_zones = [r for r in rows if r["cnt"] / ideal_per_zone < 0.1]

        print(f"\n  Summary:")
        print(f"    Over-represented (>3x ideal):  {len(over_zones)} zones "
              f"({sum(r['cnt'] for r in over_zones):,} obs)")
        print(f"    Under-represented (<0.3x):     {len(under_zones)} zones "
              f"({sum(r['cnt'] for r in under_zones):,} obs)")
        print(f"    Rare (<0.1x, need upsampling): {len(rare_zones)} zones "
              f"({sum(r['cnt'] for r in rare_zones):,} obs)")

        # Confidence threshold analysis
        print(f"\n  Confidence threshold analysis:")
        for threshold in [0.05, 0.1, 0.2, 0.3, 0.5]:
            key = None
            if threshold == 0.5:
                key = "above_05"
            elif threshold == 0.3:
                key = "above_03"
            elif threshold == 0.1:
                key = "above_01"

            if key:
                count = sum(r[key] for r in rows)
            else:
                # Need a separate query for non-standard thresholds
                cur.execute(
                    "SELECT count(*) AS c FROM surface_observations WHERE confidence > %s",
                    (threshold,)
                )
                count = cur.fetchone()["c"]

            print(f"    confidence > {threshold}: {count:>8,} ({count/total*100:.1f}%)")

        print()

    finally:
        conn.close()


# ─── Sample Command ─────────────────────────────────────────────────

def cmd_sample(args):
    """Generate a stratified training set as JSONL."""
    max_per_zone = args.max_per_zone
    min_per_zone = args.min_per_zone
    confidence_threshold = args.confidence_threshold
    output_path = Path(args.output)
    seed = args.seed

    if seed is not None:
        random.seed(seed)

    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SET statement_timeout = '120s'")

        # Step 1: Get all zones and their counts above confidence threshold
        cur.execute("""
            SELECT zone, count(*) AS cnt
            FROM surface_observations
            WHERE confidence > %s OR (confidence IS NULL AND %s <= 0)
            GROUP BY zone
            ORDER BY cnt DESC
        """, (confidence_threshold, confidence_threshold))
        zone_counts = {r["zone"]: r["cnt"] for r in cur.fetchall()}

        if not zone_counts:
            print(f"ERROR: No observations found with confidence > {confidence_threshold}")
            print(f"  Tip: Check your threshold. Run 'stats' to see confidence distributions.")
            sys.exit(1)

        total_raw = sum(zone_counts.values())
        print(f"\n  Stratified Training Sampler")
        print(f"  {'='*60}")
        print(f"  Confidence threshold: > {confidence_threshold}")
        print(f"  Observations passing threshold: {total_raw:,} across {len(zone_counts)} zones")
        print(f"  Max per zone: {max_per_zone:,}")
        print(f"  Min per zone: {min_per_zone:,} (upsample if fewer)")
        if seed is not None:
            print(f"  Random seed: {seed}")
        print()

        # Step 2: Plan sampling strategy per zone
        sampling_plan = {}
        for zone, count in zone_counts.items():
            if count >= max_per_zone:
                # Downsample: take max_per_zone, highest confidence first
                sampling_plan[zone] = {
                    "available": count,
                    "target": max_per_zone,
                    "strategy": "downsample",
                }
            elif count >= min_per_zone:
                # Take all
                sampling_plan[zone] = {
                    "available": count,
                    "target": count,
                    "strategy": "all",
                }
            else:
                # Upsample: include all, then duplicate to reach min_per_zone
                sampling_plan[zone] = {
                    "available": count,
                    "target": min_per_zone,
                    "strategy": "upsample",
                    "duplicates_needed": min_per_zone - count,
                }

        # Print sampling plan
        print(f"  {'Zone':<25} {'Available':>10} {'Target':>8} {'Strategy':<12}")
        print(f"  {'-'*24} {'-'*10} {'-'*8} {'-'*12}")
        for zone in sorted(sampling_plan.keys(), key=lambda z: sampling_plan[z]["available"], reverse=True):
            plan = sampling_plan[zone]
            print(f"  {zone:<25} {plan['available']:>10,} {plan['target']:>8,} {plan['strategy']:<12}")

        total_target = sum(p["target"] for p in sampling_plan.values())
        print(f"\n  Total target samples: {total_target:,}")
        print()

        # Step 3: Fetch observations per zone with join to vehicle_images and vehicles
        all_samples = []
        for zone, plan in sampling_plan.items():
            # For downsampled zones, fetch only what we need (top by confidence)
            # For others, fetch all
            if plan["strategy"] == "downsample":
                limit = plan["target"]
            else:
                limit = plan["available"]

            cur.execute("""
                SELECT
                    so.id AS observation_id,
                    so.vehicle_image_id AS image_id,
                    vi.image_url,
                    so.vehicle_id,
                    so.zone,
                    so.confidence,
                    so.observation_type,
                    so.label,
                    v.year,
                    v.make,
                    v.model
                FROM surface_observations so
                JOIN vehicle_images vi ON vi.id = so.vehicle_image_id
                JOIN vehicles v ON v.id = so.vehicle_id
                WHERE so.zone = %s
                  AND (so.confidence > %s OR (so.confidence IS NULL AND %s <= 0))
                ORDER BY so.confidence DESC NULLS LAST
                LIMIT %s
            """, (zone, confidence_threshold, confidence_threshold, limit))

            rows = cur.fetchall()

            if not rows:
                print(f"  WARNING: Zone '{zone}' returned 0 rows after join (orphaned references?)")
                continue

            # Convert to dicts
            zone_samples = []
            for r in rows:
                sample = {
                    "image_id": str(r["image_id"]),
                    "image_url": r["image_url"],
                    "vehicle_id": str(r["vehicle_id"]),
                    "zone": r["zone"],
                    "confidence": float(r["confidence"]) if r["confidence"] is not None else None,
                    "year": r["year"],
                    "make": r["make"],
                    "model": r["model"],
                }
                zone_samples.append(sample)

            # Handle upsampling by duplicating
            if plan["strategy"] == "upsample" and len(zone_samples) < min_per_zone:
                original_count = len(zone_samples)
                duplicates_needed = min_per_zone - original_count
                # Randomly sample with replacement from originals
                duplicates = [
                    {**s, "_upsampled": True}
                    for s in random.choices(zone_samples, k=duplicates_needed)
                ]
                zone_samples.extend(duplicates)
                print(f"  Upsampled {zone}: {original_count} -> {len(zone_samples)} "
                      f"(+{duplicates_needed} duplicates)")

            all_samples.extend(zone_samples)

        # Step 4: Shuffle the full dataset
        random.shuffle(all_samples)

        # Step 5: Write JSONL
        output_path.parent.mkdir(parents=True, exist_ok=True)
        written = 0
        with open(output_path, "w") as f:
            for sample in all_samples:
                # Remove internal _upsampled flag from output
                sample.pop("_upsampled", None)
                f.write(json.dumps(sample) + "\n")
                written += 1

        # Step 6: Print summary
        zone_dist = Counter(s["zone"] for s in all_samples)
        print(f"\n  Written: {written:,} samples to {output_path}")
        print(f"\n  Final distribution:")
        print(f"  {'Zone':<25} {'Count':>8} {'Pct':>7}")
        print(f"  {'-'*24} {'-'*8} {'-'*7}")
        for zone, cnt in zone_dist.most_common():
            pct = cnt / written * 100
            print(f"  {zone:<25} {cnt:>8,} {pct:>6.1f}%")

        # Compute balance metrics
        counts = list(zone_dist.values())
        max_c, min_c = max(counts), min(counts)
        imbalance_ratio = max_c / min_c if min_c > 0 else float("inf")
        print(f"\n  Balance metrics:")
        print(f"    Zones in output:    {len(zone_dist)}")
        print(f"    Max zone size:      {max_c:,}")
        print(f"    Min zone size:      {min_c:,}")
        print(f"    Imbalance ratio:    {imbalance_ratio:.1f}x (1.0 = perfect balance)")
        print(f"    Unique vehicles:    {len(set(s['vehicle_id'] for s in all_samples)):,}")
        print(f"    Unique images:      {len(set(s['image_id'] for s in all_samples)):,}")
        print()

    finally:
        conn.close()


# ─── Validate Command ───────────────────────────────────────────────

def cmd_validate(args):
    """Validate a training set JSONL file and report statistics."""
    input_path = Path(args.input)

    if not input_path.exists():
        print(f"ERROR: File not found: {input_path}")
        sys.exit(1)

    required_fields = {"image_id", "image_url", "vehicle_id", "zone", "confidence", "year", "make", "model"}

    zone_counts = Counter()
    confidence_values = defaultdict(list)
    ymm_counts = Counter()
    vehicle_ids = set()
    image_ids = set()
    errors = []
    total = 0
    null_confidence = 0
    null_url = 0
    null_ymm = 0

    with open(input_path) as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue

            try:
                record = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f"  Line {line_num}: Invalid JSON: {e}")
                continue

            total += 1

            # Check required fields
            missing = required_fields - set(record.keys())
            if missing:
                errors.append(f"  Line {line_num}: Missing fields: {missing}")
                continue

            zone = record["zone"]
            zone_counts[zone] += 1

            conf = record["confidence"]
            if conf is not None:
                confidence_values[zone].append(conf)
            else:
                null_confidence += 1

            if not record.get("image_url"):
                null_url += 1

            if not record.get("year") or not record.get("make") or not record.get("model"):
                null_ymm += 1
            else:
                # Normalize with suffix stripping so variants coalesce in stats
                from yono.contextual_training.build_ymm_knowledge import strip_model_suffix
                base_model, _ = strip_model_suffix(str(record['model']))
                ymm_key = f"{record['year']} {record['make']} {base_model}"
                ymm_counts[ymm_key] += 1

            vehicle_ids.add(record["vehicle_id"])
            image_ids.add(record["image_id"])

    print(f"\n{'='*80}")
    print(f"  Training Set Validation: {input_path}")
    print(f"{'='*80}\n")

    # Errors
    if errors:
        print(f"  ERRORS ({len(errors)}):")
        for e in errors[:20]:
            print(f"    {e}")
        if len(errors) > 20:
            print(f"    ... and {len(errors) - 20} more")
        print()

    # Basic stats
    print(f"  Records:           {total:,}")
    print(f"  Zones:             {len(zone_counts)}")
    print(f"  Unique vehicles:   {len(vehicle_ids):,}")
    print(f"  Unique images:     {len(image_ids):,}")
    print(f"  Null confidence:   {null_confidence:,} ({null_confidence/total*100:.1f}%)" if total else "")
    print(f"  Null image_url:    {null_url:,}")
    print(f"  Null Y/M/M:        {null_ymm:,}")
    print()

    # Zone distribution
    print(f"  Zone Distribution:")
    print(f"  {'Zone':<25} {'Count':>8} {'Pct':>7} {'AvgConf':>8} {'MinConf':>8} {'MaxConf':>8}")
    print(f"  {'-'*24} {'-'*8} {'-'*7} {'-'*8} {'-'*8} {'-'*8}")

    for zone, cnt in zone_counts.most_common():
        pct = cnt / total * 100 if total > 0 else 0
        confs = confidence_values.get(zone, [])
        if confs:
            avg_c = sum(confs) / len(confs)
            min_c = min(confs)
            max_c = max(confs)
            print(f"  {zone:<25} {cnt:>8,} {pct:>6.1f}% {avg_c:>8.4f} {min_c:>8.4f} {max_c:>8.4f}")
        else:
            print(f"  {zone:<25} {cnt:>8,} {pct:>6.1f}% {'n/a':>8} {'n/a':>8} {'n/a':>8}")

    # Balance analysis
    counts = list(zone_counts.values())
    if counts:
        max_c, min_c = max(counts), min(counts)
        mean_c = sum(counts) / len(counts)
        std_c = (sum((c - mean_c) ** 2 for c in counts) / len(counts)) ** 0.5
        cv = std_c / mean_c if mean_c > 0 else 0
        imbalance = max_c / min_c if min_c > 0 else float("inf")

        print(f"\n  Balance Metrics:")
        print(f"    Max zone:         {max_c:,}")
        print(f"    Min zone:         {min_c:,}")
        print(f"    Mean:             {mean_c:,.1f}")
        print(f"    Std dev:          {std_c:,.1f}")
        print(f"    CV:               {cv:.3f} (0 = perfect, <0.5 = good)")
        print(f"    Imbalance ratio:  {imbalance:.1f}x")

        if imbalance <= 2.0:
            verdict = "EXCELLENT — well balanced"
        elif imbalance <= 5.0:
            verdict = "GOOD — acceptable for training"
        elif imbalance <= 10.0:
            verdict = "FAIR — consider adjusting min/max per zone"
        else:
            verdict = "POOR — high risk of model bias toward dominant zones"
        print(f"    Verdict:          {verdict}")

    # Top Y/M/M
    print(f"\n  Top 15 Year/Make/Model:")
    for ymm, cnt in ymm_counts.most_common(15):
        print(f"    {ymm:<45} {cnt:>6,}")

    # Duplicate detection (same image_id appearing multiple times = upsampled)
    image_count = Counter()
    with open(input_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            image_count[record["image_id"]] += 1

    duplicated = {k: v for k, v in image_count.items() if v > 1}
    if duplicated:
        dup_records = sum(v - 1 for v in duplicated.values())
        print(f"\n  Upsampled records:  {dup_records:,} duplicates across {len(duplicated):,} images")
    else:
        print(f"\n  Upsampled records:  0 (no duplicates)")

    print()

    # Overall verdict
    if errors:
        print(f"  RESULT: FAILED — {len(errors)} errors found")
        sys.exit(1)
    else:
        print(f"  RESULT: PASSED")


# ─── CLI ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Stratified sampler for YONO training data from surface_observations",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 -m yono.training_sampler stats
  python3 -m yono.training_sampler sample --output yono/data/training_set.jsonl
  python3 -m yono.training_sampler sample --output out.jsonl --max-per-zone 3000 --min-per-zone 200 --confidence-threshold 0.05
  python3 -m yono.training_sampler validate --input yono/data/training_set.jsonl
        """,
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # stats
    stats_parser = subparsers.add_parser(
        "stats",
        help="Show zone distribution with over/under representation analysis",
    )
    stats_parser.set_defaults(func=cmd_stats)

    # sample
    sample_parser = subparsers.add_parser(
        "sample",
        help="Generate a stratified training set as JSONL",
    )
    sample_parser.add_argument(
        "--output", "-o",
        required=True,
        help="Output JSONL file path",
    )
    sample_parser.add_argument(
        "--max-per-zone",
        type=int,
        default=5000,
        help="Maximum samples per zone (default: 5000). Over-represented zones are downsampled.",
    )
    sample_parser.add_argument(
        "--min-per-zone",
        type=int,
        default=500,
        help="Minimum samples per zone (default: 500). Rare zones are upsampled via duplication.",
    )
    sample_parser.add_argument(
        "--confidence-threshold",
        type=float,
        default=0.5,
        help="Minimum confidence to include (default: 0.5). "
             "NOTE: most observations have confidence < 0.3; consider using 0.05 for broader coverage.",
    )
    sample_parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for reproducible sampling (default: None = non-deterministic)",
    )
    sample_parser.set_defaults(func=cmd_sample)

    # validate
    validate_parser = subparsers.add_parser(
        "validate",
        help="Validate a training set JSONL file and report statistics",
    )
    validate_parser.add_argument(
        "--input", "-i",
        required=True,
        help="Input JSONL file to validate",
    )
    validate_parser.set_defaults(func=cmd_validate)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
