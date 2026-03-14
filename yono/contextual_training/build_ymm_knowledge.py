#!/usr/bin/env python3
"""
Y/M/M Knowledge Base Builder — v2

Compiles raw facts from auction_comments, vehicles specs, and vehicle_images
into structured per-Y/M/M profiles. NO AI synthesis — pure deterministic aggregation.

v2 changes (Condition Spectrometer):
  - Filters seller comments (is_seller=false) — removes ~30% noise
  - Coalesces model variants (Z28, SS, Convertible → base Camaro)
  - Removes regex mod extraction (60-70% false positive rate proven)
  - Adds lifecycle distribution from existing vision data
  - Adds condition score distribution from existing scored vehicles
  - Profiles grow with the taxonomy, not frozen to a regex list

Usage:
  cd /Users/skylar/nuke
  dotenvx run -- python3 yono/contextual_training/build_ymm_knowledge.py --limit 100
  dotenvx run -- python3 yono/contextual_training/build_ymm_knowledge.py --all
  dotenvx run -- python3 yono/contextual_training/build_ymm_knowledge.py --ymm "1984_Chevrolet_K10"

Data sources (TRUSTED):
  - auction_comments: 11.6M rows of expert commentary (non-seller only)
  - vehicles: 200+ spec columns, factory data
  - vehicle_images: zone/condition_score/lifecycle labels from YONO vision

Data sources (EXCLUDED):
  - comment_discoveries: 57.6% hollow, 98% programmatic-v1
  - observation_discoveries: 0% reviewed, 49% avg confidence
  - regex mod extraction: proven 60-70% false positive (v1 mistake)
"""

import os
import sys
import json
import re
import time
import argparse
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict

import psycopg2
from psycopg2.extras import RealDictCursor

# ─── Config ──────────────────────────────────────────────────────────

NUKE_DIR = Path("/Users/skylar/nuke")
BATCH_SIZE = 500  # Y/M/M groups per DB batch
COMMENT_LIMIT = 200  # max expert comments per Y/M/M
MIN_EXPERTISE = 0.5
MIN_WORD_COUNT = 15

# Known model suffixes that should coalesce to base model
# These are body styles, not distinct models
BODY_SUFFIXES = [
    "Convertible", "Coupe", "Fastback", "Hardtop", "Pickup",
    "Custom Coupe", "Custom", "Sport Coupe", "Sedan", "Wagon",
    "Roadster", "Cabriolet", "Targa", "Spyder", "Spider",
    "Hatchback", "Liftback", "Notchback",
]

# Known trim/package identifiers — these are variants of the base model
TRIM_SUFFIXES = [
    "Z28", "Z/28", "SS", "RS", "RS/SS", "SS/RS", "COPO",
    "GT", "GT350", "GT500", "Mach 1", "Boss 302", "Boss 429",
    "Shelby GT350", "Shelby GT500",
    "LS6", "L88", "L78", "L71", "ZL1", "LT1",
    "GTO", "Judge",
    "Hemi", "R/T", "T/A",
    "SC", "Turbo",
    "4x4", "4WD",
]

# Compile for fast matching
_BODY_RE = re.compile(
    r'\s+(' + '|'.join(re.escape(s) for s in sorted(BODY_SUFFIXES, key=len, reverse=True)) + r')$',
    re.IGNORECASE,
)
_TRIM_RE = re.compile(
    r'\s+(' + '|'.join(re.escape(s) for s in sorted(TRIM_SUFFIXES, key=len, reverse=True)) + r')$',
    re.IGNORECASE,
)


def get_connection():
    """Get database connection with env vars loaded from .env"""
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        # Build from password + known pooler endpoint
        db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
        if not db_pass:
            # Try loading from .env
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
            raise RuntimeError(
                "SUPABASE_DB_URL or SUPABASE_DB_PASSWORD not set. "
                "Run with: dotenvx run -- python3 ..."
            )

    if "sslmode" not in db_url:
        db_url += "?sslmode=require" if "?" not in db_url else "&sslmode=require"

    return psycopg2.connect(db_url, connect_timeout=30)


def strip_model_suffix(model: str) -> tuple[str, list[str]]:
    """
    Strip body style and trim suffixes from a model name.
    Returns (base_model, [variant_tags]).

    Examples:
      "Camaro Z28"          → ("Camaro", ["Z28"])
      "Camaro Convertible"  → ("Camaro", ["Convertible"])
      "Camaro SS Convertible" → ("Camaro", ["SS", "Convertible"])
      "Mustang Mach 1 Fastback" → ("Mustang", ["Mach 1", "Fastback"])
      "911"                 → ("911", [])
    """
    variants = []
    current = model.strip()

    # Iteratively strip from the end — longest match first
    for _ in range(5):  # max 5 suffixes
        m = _BODY_RE.search(current)
        if m:
            variants.insert(0, m.group(1))
            current = current[:m.start()].strip()
            continue
        m = _TRIM_RE.search(current)
        if m:
            variants.insert(0, m.group(1))
            current = current[:m.start()].strip()
            continue
        break

    return (current if current else model, variants)


def coalesce_ymm_groups(groups: list[dict]) -> list[dict]:
    """
    Coalesce model variants into base models.

    1969 Camaro Z28 (322 vehicles) + 1969 Camaro SS (269) + 1969 Camaro Convertible (197)
    → 1969 Camaro (788 vehicles, variants: [Z28, SS, Convertible])

    Only coalesces if the base model matches another group OR if stripping
    yields a reasonable base model with combined count >= min_vehicles.
    """
    # Group by (year, make, base_model)
    coalesced = {}  # (year, make, base) → {count, variants, original_models}

    for g in groups:
        year, make, model = g["year"], g["make"], g["model"]
        base, variant_tags = strip_model_suffix(model)
        key = (year, make, base)

        if key not in coalesced:
            coalesced[key] = {
                "year": year,
                "make": make,
                "model": base,
                "vehicle_count": 0,
                "model_variants": [],
                "original_models": [],
            }

        entry = coalesced[key]
        entry["vehicle_count"] += g["vehicle_count"]
        entry["original_models"].append(model)
        if variant_tags:
            entry["model_variants"].extend(variant_tags)
        elif model != base:
            entry["model_variants"].append(model)

    # Deduplicate variant lists
    result = []
    for entry in coalesced.values():
        entry["model_variants"] = sorted(set(entry["model_variants"]))
        result.append(entry)

    result.sort(key=lambda x: x["vehicle_count"], reverse=True)
    return result


def get_ymm_groups(conn, min_vehicles: int = 3, limit: int = None, ymm_filter: str = None):
    """Get all Y/M/M groups with >= min_vehicles, coalesced by base model."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '60s'")

    where = ""
    params = []
    if ymm_filter:
        parts = ymm_filter.split("_", 2)
        if len(parts) == 3:
            where = "AND year = %s AND make = %s AND model ILIKE %s"
            params = [int(parts[0]), parts[1], f"%{parts[2]}%"]

    # Get raw groups (uncoalesced) — we coalesce in Python
    query = f"""
        SELECT year, make, model, COUNT(*) as vehicle_count
        FROM vehicles
        WHERE year IS NOT NULL AND make IS NOT NULL AND model IS NOT NULL
          AND status IN ('active', 'sold', 'pending')
          {where}
        GROUP BY year, make, model
        ORDER BY COUNT(*) DESC
    """
    if params:
        cur.execute(query, params)
    else:
        cur.execute(query)

    raw_groups = cur.fetchall()
    cur.close()

    # Coalesce variants
    coalesced = coalesce_ymm_groups(raw_groups)

    # Filter by min_vehicles after coalescing
    coalesced = [g for g in coalesced if g["vehicle_count"] >= min_vehicles]

    if limit:
        coalesced = coalesced[:limit]

    return coalesced


def _model_where(model: str, original_models: list[str] = None) -> tuple[str, list]:
    """Build WHERE clause fragment that matches base model + all variants."""
    if original_models and len(original_models) > 1:
        placeholders = ", ".join(["%s"] * len(original_models))
        return f"model IN ({placeholders})", list(original_models)
    else:
        return "model = %s", [model]


def build_factory_specs(conn, year: int, make: str, model: str,
                        original_models: list[str] = None) -> dict:
    """Aggregate factory specs for a Y/M/M group (all variants). Pure SQL, deterministic."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")

    model_clause, model_params = _model_where(model, original_models)

    cur.execute(f"""
        SELECT
            mode() WITHIN GROUP (ORDER BY engine_type) as typical_engine,
            mode() WITHIN GROUP (ORDER BY transmission) as typical_transmission,
            mode() WITHIN GROUP (ORDER BY drivetrain) as typical_drivetrain,
            array_agg(DISTINCT engine_type) FILTER (WHERE engine_type IS NOT NULL) as engine_options,
            array_agg(DISTINCT transmission) FILTER (WHERE transmission IS NOT NULL) as transmission_options,
            array_agg(DISTINCT drivetrain) FILTER (WHERE drivetrain IS NOT NULL) as drivetrain_options,
            array_agg(DISTINCT color) FILTER (WHERE color IS NOT NULL) as color_options,
            AVG(sale_price) FILTER (WHERE sale_price > 0) as avg_sale_price,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sale_price)
                FILTER (WHERE sale_price > 0) as median_sale_price,
            MIN(sale_price) FILTER (WHERE sale_price > 0) as min_sale_price,
            MAX(sale_price) FILTER (WHERE sale_price > 0) as max_sale_price,
            COUNT(*) FILTER (WHERE sale_price > 0) as sales_tracked,
            AVG(mileage) FILTER (WHERE mileage > 0 AND mileage < 500000) as avg_mileage,
            AVG(bid_count) FILTER (WHERE bid_count > 0) as avg_bids,
            AVG(view_count) FILTER (WHERE view_count > 0) as avg_views
        FROM vehicles
        WHERE year = %s AND make = %s AND {model_clause}
          AND status IN ('active', 'sold', 'pending')
    """, [year, make] + model_params)

    row = cur.fetchone()
    cur.close()

    if not row:
        return {}

    # Clean up None values and convert Decimals
    def clean(v):
        if v is None:
            return None
        if hasattr(v, 'quantize'):  # Decimal
            return float(v)
        return v

    return {
        "factory_specs": {
            "typical_engine": row["typical_engine"],
            "typical_transmission": row["typical_transmission"],
            "typical_drivetrain": row["typical_drivetrain"],
            "engine_options": row["engine_options"] or [],
            "transmission_options": row["transmission_options"] or [],
            "drivetrain_options": row["drivetrain_options"] or [],
            "color_options": row["color_options"] or [],
        },
        "market": {
            "avg_sale_price": clean(row["avg_sale_price"]),
            "median_sale_price": clean(row["median_sale_price"]),
            "min_sale_price": clean(row["min_sale_price"]),
            "max_sale_price": clean(row["max_sale_price"]),
            "sales_tracked": row["sales_tracked"] or 0,
            "avg_mileage": clean(row["avg_mileage"]),
            "avg_bids": clean(row["avg_bids"]),
            "avg_views": clean(row["avg_views"]),
        },
    }


def get_expert_comments(conn, year: int, make: str, model: str,
                        original_models: list[str] = None) -> list[dict]:
    """
    Fetch top expert comments for a Y/M/M group.
    Raw text, no AI summaries. Non-seller only (is_seller=false).
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")

    model_clause, model_params = _model_where(model, original_models)

    cur.execute(f"""
        SELECT ac.comment_text, ac.expertise_score, ac.word_count,
               ac.key_claims, ac.comment_likes, ac.author_username
        FROM auction_comments ac
        JOIN vehicles v ON v.id = ac.vehicle_id
        WHERE v.year = %s AND v.make = %s
          AND v.{model_clause}
          AND ac.is_seller = false
          AND ac.expertise_score > %s
          AND ac.word_count > %s
          AND ac.comment_text IS NOT NULL
          AND ac.comment_text != ''
        ORDER BY ac.expertise_score DESC, ac.word_count DESC
        LIMIT %s
    """, [year, make] + model_params + [MIN_EXPERTISE, MIN_WORD_COUNT, COMMENT_LIMIT])

    comments = cur.fetchall()
    cur.close()
    return comments


def get_lifecycle_distribution(conn, year: int, make: str, model: str,
                               original_models: list[str] = None) -> dict:
    """
    Get lifecycle state distribution from existing YONO vision condition scores.

    Maps condition_score (1-5) to lifecycle states:
      5 → fresh, 4 → worn, 3 → weathered, 2 → ghost, 1 → archaeological
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")

    model_clause, model_params = _model_where(model, original_models)

    cur.execute(f"""
        SELECT
            CASE
                WHEN vi.condition_score >= 5 THEN 'fresh'
                WHEN vi.condition_score = 4 THEN 'worn'
                WHEN vi.condition_score = 3 THEN 'weathered'
                WHEN vi.condition_score = 2 THEN 'ghost'
                WHEN vi.condition_score = 1 THEN 'archaeological'
            END as lifecycle_state,
            COUNT(*) as cnt
        FROM vehicle_images vi
        JOIN vehicles v ON v.id = vi.vehicle_id
        WHERE v.year = %s AND v.make = %s AND v.{model_clause}
          AND vi.condition_score IS NOT NULL
          AND v.status IN ('active', 'sold', 'pending')
        GROUP BY 1
    """, [year, make] + model_params)

    rows = cur.fetchall()
    cur.close()

    if not rows:
        return {}

    total = sum(r["cnt"] for r in rows)
    return {r["lifecycle_state"]: round(r["cnt"] / total, 3) for r in rows if r["lifecycle_state"]}


def get_condition_distribution(conn, year: int, make: str, model: str,
                               original_models: list[str] = None) -> dict:
    """
    Get condition score distribution from existing scored vehicle images.
    Returns basic stats for the condition spectrometer.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")

    model_clause, model_params = _model_where(model, original_models)

    cur.execute(f"""
        SELECT
            AVG(vi.condition_score) as mean,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY vi.condition_score) as median,
            STDDEV(vi.condition_score) as std,
            MIN(vi.condition_score) as min_score,
            MAX(vi.condition_score) as max_score,
            COUNT(*) as scored_count
        FROM vehicle_images vi
        JOIN vehicles v ON v.id = vi.vehicle_id
        WHERE v.year = %s AND v.make = %s AND v.{model_clause}
          AND vi.condition_score IS NOT NULL
          AND v.status IN ('active', 'sold', 'pending')
    """, [year, make] + model_params)

    row = cur.fetchone()
    cur.close()

    if not row or not row["scored_count"]:
        return {}

    def clean(v):
        if v is None:
            return None
        if hasattr(v, 'quantize'):
            return float(v)
        return v

    return {
        "mean": clean(row["mean"]),
        "median": clean(row["median"]),
        "std": clean(row["std"]),
        "min": clean(row["min_score"]),
        "max": clean(row["max_score"]),
        "scored_count": row["scored_count"],
    }


def build_profile(conn, year: int, make: str, model: str, vehicle_count: int,
                   model_variants: list[str] = None, original_models: list[str] = None) -> dict:
    """
    Build a complete Y/M/M knowledge profile from raw data.
    v2: No regex mods, no seller comments, coalesced variants.
    """
    t0 = time.time()

    # 1. Factory specs + market data (across all variants)
    specs_market = build_factory_specs(conn, year, make, model, original_models)

    # 2. Expert comments — non-seller only (raw text)
    comments = get_expert_comments(conn, year, make, model, original_models)
    expert_quotes = []
    all_key_claims = []
    for c in comments:
        if c["comment_text"]:
            if c["word_count"] and c["word_count"] > 30:
                expert_quotes.append(c["comment_text"][:2000])
        if c["key_claims"]:
            all_key_claims.extend(c["key_claims"])

    # 3. Lifecycle distribution (from existing vision data)
    lifecycle = get_lifecycle_distribution(conn, year, make, model, original_models)

    # 4. Condition score distribution
    condition_dist = get_condition_distribution(conn, year, make, model, original_models)

    elapsed_ms = int((time.time() - t0) * 1000)

    profile = {
        "ymm_key": f"{year}_{make}_{model}",
        "year": year,
        "make": make,
        "model": model,
        "model_variants": model_variants or [],
        "vehicle_count": vehicle_count,
        **specs_market,
        "lifecycle_distribution": lifecycle,
        "condition_distribution": condition_dist,
        "expert_quotes": expert_quotes[:50],
        "key_claims": list(set(all_key_claims))[:100],
        "source_comment_count": len(comments),
    }

    return profile, elapsed_ms


def upsert_profile(conn, profile: dict, elapsed_ms: int):
    """Upsert a Y/M/M profile into ymm_knowledge table."""
    cur = conn.cursor()

    # Keep only 20 quotes in DB (full set available via rebuild)
    stored_profile = {**profile}
    stored_profile["expert_quotes"] = stored_profile["expert_quotes"][:20]

    cur.execute("""
        INSERT INTO ymm_knowledge (
            ymm_key, year, make, model, vehicle_count,
            profile, source_comment_count, source_image_count,
            build_duration_ms, built_at, build_version
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), 'v2')
        ON CONFLICT (ymm_key) DO UPDATE SET
            vehicle_count = EXCLUDED.vehicle_count,
            profile = EXCLUDED.profile,
            source_comment_count = EXCLUDED.source_comment_count,
            source_image_count = EXCLUDED.source_image_count,
            build_duration_ms = EXCLUDED.build_duration_ms,
            built_at = NOW(),
            build_version = 'v2',
            updated_at = NOW()
    """, (
        profile["ymm_key"],
        profile["year"],
        profile["make"],
        profile["model"],
        profile["vehicle_count"],
        json.dumps(stored_profile, default=str),
        profile["source_comment_count"],
        0,  # source_image_count — computed from observations now
        elapsed_ms,
    ))
    conn.commit()
    cur.close()


def compute_feature_vectors(conn):
    """Compute and store feature vectors for all ymm_knowledge profiles."""
    from yono.contextual_training.featurizers import featurize_ymm_profile

    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '60s'")
    cur.execute("SELECT id, ymm_key, profile FROM ymm_knowledge ORDER BY vehicle_count DESC")
    rows = cur.fetchall()
    cur.close()

    print(f"\nComputing feature vectors for {len(rows)} profiles...")

    updated = 0
    for i, row in enumerate(rows):
        profile = row["profile"]
        if isinstance(profile, str):
            profile = json.loads(profile)

        vec = featurize_ymm_profile(profile)

        cur = conn.cursor()
        cur.execute(
            "UPDATE ymm_knowledge SET feature_vector = %s, updated_at = NOW() WHERE id = %s",
            (vec.tolist(), row["id"]),
        )
        conn.commit()
        cur.close()
        updated += 1

        if (i + 1) % 100 == 0:
            print(f"  [{updated}/{len(rows)}] vectors computed")

    print(f"  Feature vectors computed: {updated}/{len(rows)}")


def export_parquet(conn, output_path: str = None):
    """Export ymm_knowledge to local Parquet file for inference."""
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError:
        print("pyarrow not installed. Install with: pip install pyarrow")
        print("Skipping Parquet export.")
        return

    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '60s'")
    cur.execute("""
        SELECT ymm_key, year, make, model, vehicle_count,
               profile, feature_vector,
               source_comment_count, source_image_count,
               built_at, build_version
        FROM ymm_knowledge
        ORDER BY vehicle_count DESC
    """)
    rows = cur.fetchall()
    cur.close()

    if not rows:
        print("No profiles to export.")
        return

    if not output_path:
        output_path = str(NUKE_DIR / "yono" / "data" / "ymm_knowledge.parquet")

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    # Build Arrow table
    table = pa.table({
        "ymm_key": [r["ymm_key"] for r in rows],
        "year": [r["year"] for r in rows],
        "make": [r["make"] for r in rows],
        "model": [r["model"] for r in rows],
        "vehicle_count": [r["vehicle_count"] for r in rows],
        "profile_json": [json.dumps(r["profile"], default=str) for r in rows],
        "source_comment_count": [r["source_comment_count"] or 0 for r in rows],
        "source_image_count": [r["source_image_count"] or 0 for r in rows],
    })

    pq.write_table(table, output_path, compression="snappy")
    size_mb = Path(output_path).stat().st_size / (1024 * 1024)
    print(f"\nExported {len(rows)} profiles to {output_path} ({size_mb:.1f} MB)")


def main():
    parser = argparse.ArgumentParser(description="Build Y/M/M Knowledge Base")
    parser.add_argument("--limit", type=int, help="Max Y/M/M groups to process")
    parser.add_argument("--all", action="store_true", help="Process all Y/M/M groups (>=3 vehicles)")
    parser.add_argument("--ymm", type=str, help="Process single Y/M/M (e.g. '1984_Chevrolet_K10')")
    parser.add_argument("--min-vehicles", type=int, default=3, help="Min vehicles per Y/M/M group")
    parser.add_argument("--export-parquet", action="store_true", help="Export to Parquet after build")
    parser.add_argument("--compute-vectors", action="store_true",
                        help="Compute feature vectors for all stored profiles (standalone)")
    parser.add_argument("--dry-run", action="store_true", help="Show groups without building")
    args = parser.parse_args()

    # Standalone vector computation
    if args.compute_vectors:
        conn = get_connection()
        compute_feature_vectors(conn)
        if args.export_parquet:
            export_parquet(conn)
        conn.close()
        return

    if not args.all and not args.limit and not args.ymm:
        parser.print_help()
        print("\nExample:")
        print("  dotenvx run -- python3 yono/contextual_training/build_ymm_knowledge.py --limit 10")
        sys.exit(1)

    conn = get_connection()

    print("=" * 60)
    print("Y/M/M Knowledge Base Builder")
    print("=" * 60)

    # Get Y/M/M groups
    limit = args.limit if not args.all else None
    groups = get_ymm_groups(conn, min_vehicles=args.min_vehicles,
                            limit=limit, ymm_filter=args.ymm)

    print(f"\nFound {len(groups)} Y/M/M groups")

    if args.dry_run:
        for g in groups[:20]:
            print(f"  {g['year']}_{g['make']}_{g['model']} ({g['vehicle_count']} vehicles)")
        if len(groups) > 20:
            print(f"  ... and {len(groups) - 20} more")
        conn.close()
        return

    # Build profiles
    total = len(groups)
    built = 0
    errors = 0
    total_comments = 0
    t_start = time.time()

    for i, group in enumerate(groups):
        year = group["year"]
        make = group["make"]
        model = group["model"]
        vehicle_count = group["vehicle_count"]
        model_variants = group.get("model_variants", [])
        original_models = group.get("original_models", [])
        ymm_key = f"{year}_{make}_{model}"

        try:
            profile, elapsed_ms = build_profile(
                conn, year, make, model, vehicle_count,
                model_variants=model_variants,
                original_models=original_models,
            )
            upsert_profile(conn, profile, elapsed_ms)
            built += 1
            total_comments += profile["source_comment_count"]

            if (i + 1) % 50 == 0 or i == 0:
                elapsed = time.time() - t_start
                rate = built / elapsed if elapsed > 0 else 0
                eta = (total - built) / rate if rate > 0 else 0
                variants_str = f" +{len(model_variants)} variants" if model_variants else ""
                print(f"  [{built}/{total}] {ymm_key}{variants_str} "
                      f"({profile['source_comment_count']} comments, {elapsed_ms}ms) "
                      f"[{rate:.1f}/s, ETA {eta/60:.0f}m]")

        except Exception as e:
            errors += 1
            print(f"  ERROR [{ymm_key}]: {e}")
            try:
                conn.close()
            except Exception:
                pass
            conn = get_connection()

    elapsed = time.time() - t_start
    print(f"\n{'=' * 60}")
    print(f"Build complete!")
    print(f"  Profiles built: {built}/{total}")
    print(f"  Errors: {errors}")
    print(f"  Total expert comments indexed: {total_comments}")
    print(f"  Elapsed: {elapsed:.0f}s ({built/elapsed:.1f} profiles/s)")
    print(f"{'=' * 60}")

    # Export to Parquet if requested
    if args.export_parquet:
        export_parquet(conn)

    conn.close()


if __name__ == "__main__":
    main()
