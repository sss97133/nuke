#!/Users/skylar/nuke/yono/.venv/bin/python3
"""
Generate per-vehicle condition reports from vision analysis results.

For a given vehicle_id:
1. Reads all vehicle_images where vision_analyzed_at IS NOT NULL
2. Aggregates findings by zone (condition_score, damage_flags, modification_flags)
3. Computes zone coverage and surface_coverage_score
4. Writes to vehicle_condition_reports table (upsert)
5. Updates vehicle_coverage_map table (upsert)

This produces the insurance-grade condition report described in VISION_ROADMAP.md.

Usage:
    python scripts/generate_condition_report.py --vehicle-id <uuid>
    python scripts/generate_condition_report.py --all-bat        # all BaT vehicles with analyses
    python scripts/generate_condition_report.py --all-analyzed   # all vehicles with any vision data
    python scripts/generate_condition_report.py --limit 100      # batch with limit
    python scripts/generate_condition_report.py --dry-run <uuid> # print report without writing
"""

import argparse
import json
import os
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

# Load .env
NUKE_DIR = Path(__file__).parent.parent.parent
for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    k, v = k.strip(), v.strip().strip('"').strip("'")
    if k and v and k not in os.environ:
        os.environ[k] = v

PG_CONN = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

# All 40 meaningful zones (excludes 'other')
MEANINGFUL_ZONES = [
    "ext_front", "ext_front_driver", "ext_front_passenger",
    "ext_driver_side", "ext_passenger_side",
    "ext_rear", "ext_rear_driver", "ext_rear_passenger",
    "ext_roof", "ext_undercarriage",
    "panel_hood", "panel_trunk",
    "panel_door_fl", "panel_door_fr", "panel_door_rl", "panel_door_rr",
    "panel_fender_fl", "panel_fender_fr", "panel_fender_rl", "panel_fender_rr",
    "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr",
    "int_dashboard", "int_front_seats", "int_rear_seats", "int_cargo", "int_headliner",
    "int_door_panel_fl", "int_door_panel_fr", "int_door_panel_rl", "int_door_panel_rr",
    "mech_engine_bay", "mech_transmission", "mech_suspension",
    "detail_vin", "detail_badge", "detail_damage", "detail_odometer",
]
N_ZONES = len(MEANINGFUL_ZONES)
ZONE_SET = set(MEANINGFUL_ZONES)

# Zone importance weights for overall_score (some zones matter more for valuation)
ZONE_WEIGHTS = {
    # High-value exterior zones — buyers look here first
    "ext_front": 1.5,
    "ext_front_driver": 1.3,
    "ext_front_passenger": 1.2,
    "ext_driver_side": 1.4,
    "ext_passenger_side": 1.3,
    "ext_rear": 1.3,
    "ext_rear_driver": 1.2,
    "ext_rear_passenger": 1.1,
    # Panel damage is very specific and high-signal
    "panel_fender_rl": 1.4,
    "panel_fender_rr": 1.4,
    "panel_fender_fl": 1.3,
    "panel_fender_fr": 1.3,
    "panel_door_fl": 1.3,
    "panel_door_fr": 1.2,
    # Engine bay matters for mechanical integrity
    "mech_engine_bay": 1.3,
    # Interior condition matters for livability
    "int_dashboard": 1.2,
    "int_front_seats": 1.2,
}
DEFAULT_WEIGHT = 1.0


def psql(sql: str, timeout: int = 30) -> list:
    """Run psql query, return rows as dicts."""
    import csv, io
    env = os.environ.copy()
    env["PGOPTIONS"] = "-c statement_timeout=25000"
    result = subprocess.run(
        ["psql", PG_CONN, "-t"],
        input=sql, capture_output=True, text=True, timeout=timeout, env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql error: {result.stderr.strip()[:300]}")
    rows = []
    reader = csv.DictReader(io.StringIO(result.stdout))
    for row in reader:
        rows.append(dict(row))
    return rows


def psql_exec(sql: str, timeout: int = 30):
    """Execute a DML statement (no output expected)."""
    env = os.environ.copy()
    env["PGOPTIONS"] = "-c statement_timeout=25000"
    result = subprocess.run(
        ["psql", PG_CONN],
        input=sql, capture_output=True, text=True, timeout=timeout, env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql exec error: {result.stderr.strip()[:300]}")


def get_analyzed_images(vehicle_id: str) -> list:
    """
    Fetch all vision-analyzed images for a vehicle.
    Returns list of dicts with zone, condition_score, damage_flags, etc.
    """
    sql = f"""
    COPY (
        SELECT
            id,
            image_url,
            vehicle_zone,
            zone_confidence,
            condition_score,
            damage_flags,
            modification_flags,
            photo_quality_score,
            vision_model_version,
            surface_coord_u,
            surface_coord_v
        FROM vehicle_images
        WHERE vehicle_id = '{vehicle_id}'
          AND vision_analyzed_at IS NOT NULL
        ORDER BY photo_quality_score DESC NULLS LAST
    ) TO STDOUT WITH CSV HEADER;
    """
    return psql(sql)


def parse_pg_array(pg_array: str) -> list:
    """Parse PostgreSQL array string like '{{rust,dent}}' to Python list."""
    if not pg_array or pg_array in ("{}", "NULL", ""):
        return []
    # Remove braces and split
    inner = pg_array.strip("{}").strip()
    if not inner:
        return []
    return [x.strip().strip('"') for x in inner.split(",") if x.strip()]


def aggregate_findings(images: list) -> dict:
    """
    Aggregate zone findings from analyzed images.

    Returns:
        {
            zone_data: {zone: {images, conditions, damages, mods, best_condition, avg_condition}},
            covered_zones: [zone, ...],
            uncovered_zones: [zone, ...],
            findings: [{zone, finding, severity, confidence, source_images, coord_u, coord_v}],
            overall_score: float,
            coverage_score: float,
            damage_zone_count: int,
            modification_count: int,
        }
    """
    # Group by zone
    zone_data = defaultdict(lambda: {
        "images": [],          # image ids
        "conditions": [],      # condition_scores
        "damages": defaultdict(list),     # {flag: [image_ids]}
        "mods": defaultdict(list),        # {flag: [image_ids]}
        "coord_u": None,
        "coord_v": None,
    })

    total_images = 0
    for img in images:
        zone = img.get("vehicle_zone") or "other"
        img_id = img.get("id", "")

        zone_data[zone]["images"].append(img_id)
        total_images += 1

        # Condition score
        try:
            score = int(img.get("condition_score") or 0)
            if score > 0:
                zone_data[zone]["conditions"].append(score)
        except (ValueError, TypeError):
            pass

        # Damage flags
        for flag in parse_pg_array(img.get("damage_flags", "{}")):
            zone_data[zone]["damages"][flag].append(img_id)

        # Mod flags
        for flag in parse_pg_array(img.get("modification_flags", "{}")):
            zone_data[zone]["mods"][flag].append(img_id)

        # Best surface coordinate (first non-null)
        if zone_data[zone]["coord_u"] is None:
            try:
                u = img.get("surface_coord_u")
                v = img.get("surface_coord_v")
                if u and u != "" and u != "None":
                    zone_data[zone]["coord_u"] = float(u)
                    zone_data[zone]["coord_v"] = float(v) if v and v != "" else None
            except (ValueError, TypeError):
                pass

    # Determine covered zones
    covered_zones = [z for z in MEANINGFUL_ZONES if z in zone_data and zone_data[z]["images"]]
    uncovered_zones = [z for z in MEANINGFUL_ZONES if z not in zone_data or not zone_data[z]["images"]]

    # Build findings list
    findings = []
    all_mod_flags = set()

    for zone in covered_zones:
        zd = zone_data[zone]
        conditions = zd["conditions"]
        avg_cond = sum(conditions) / len(conditions) if conditions else None
        best_cond = max(conditions) if conditions else None
        coord_u = zd.get("coord_u")
        coord_v = zd.get("coord_v")

        # Damage findings (one finding per damage type per zone)
        for flag, src_images in zd["damages"].items():
            severity = 1
            if flag in ("rust", "accident_damage"):
                severity = 3
            elif flag in ("paint_fade", "missing_parts"):
                severity = 2
            elif flag in ("dent", "crack"):
                severity = 2

            confidence = min(1.0, len(src_images) / max(1, len(zd["images"])))
            findings.append({
                "zone": zone,
                "finding": flag,
                "finding_type": "damage",
                "severity": severity,
                "confidence": round(confidence, 3),
                "source_image_ids": src_images[:5],  # cap at 5
                "coord_u": coord_u,
                "coord_v": coord_v,
                "avg_condition": round(avg_cond, 1) if avg_cond else None,
            })

        # Modification findings
        for flag, src_images in zd["mods"].items():
            all_mod_flags.add(flag)
            confidence = min(1.0, len(src_images) / max(1, len(zd["images"])))
            findings.append({
                "zone": zone,
                "finding": flag,
                "finding_type": "modification",
                "severity": None,
                "confidence": round(confidence, 3),
                "source_image_ids": src_images[:5],
                "coord_u": coord_u,
                "coord_v": coord_v,
                "avg_condition": None,
            })

    # Overall score: weighted average of zone condition scores
    weighted_sum = 0.0
    weight_total = 0.0
    for zone in covered_zones:
        zd = zone_data[zone]
        if not zd["conditions"]:
            continue
        avg_cond = sum(zd["conditions"]) / len(zd["conditions"])
        weight = ZONE_WEIGHTS.get(zone, DEFAULT_WEIGHT)
        weighted_sum += avg_cond * weight
        weight_total += weight

    overall_score = round(weighted_sum / weight_total, 1) if weight_total > 0 else None

    coverage_score = round(len(covered_zones) / N_ZONES, 3)
    damage_zone_count = sum(1 for z in covered_zones if zone_data[z]["damages"])

    return {
        "zone_data": dict(zone_data),
        "covered_zones": covered_zones,
        "uncovered_zones": uncovered_zones,
        "findings": findings,
        "overall_score": overall_score,
        "coverage_score": coverage_score,
        "damage_zone_count": damage_zone_count,
        "modification_count": len(all_mod_flags),
        "total_images": total_images,
    }


def write_condition_report(vehicle_id: str, agg: dict, model_version: str = "zone_classifier_v1"):
    """Upsert into vehicle_condition_reports."""
    findings_json = json.dumps(agg["findings"]).replace("'", "''")
    uncovered_json = "{" + ",".join(f'"{z}"' for z in agg["uncovered_zones"]) + "}"
    overall = agg["overall_score"] if agg["overall_score"] else "NULL"
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    sql = f"""
    INSERT INTO vehicle_condition_reports
        (vehicle_id, surface_coverage, uncovered_zones, overall_score, image_count,
         findings, damage_zone_count, modification_count, model_version, generated_at)
    VALUES
        ('{vehicle_id}', {agg['coverage_score']}, '{uncovered_json}',
         {overall if overall != "NULL" else "NULL"},
         {agg['total_images']},
         '{findings_json}'::jsonb,
         {agg['damage_zone_count']}, {agg['modification_count']},
         '{model_version}', '{now}'::timestamptz)
    ON CONFLICT (vehicle_id)
    DO UPDATE SET
        surface_coverage = EXCLUDED.surface_coverage,
        uncovered_zones = EXCLUDED.uncovered_zones,
        overall_score = EXCLUDED.overall_score,
        image_count = EXCLUDED.image_count,
        findings = EXCLUDED.findings,
        damage_zone_count = EXCLUDED.damage_zone_count,
        modification_count = EXCLUDED.modification_count,
        model_version = EXCLUDED.model_version,
        generated_at = EXCLUDED.generated_at;
    """
    psql_exec(sql)


def write_coverage_map(vehicle_id: str, agg: dict):
    """Upsert into vehicle_coverage_map."""
    covered = set(agg["covered_zones"])
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # Build column assignments
    zone_cols = []
    for zone in MEANINGFUL_ZONES:
        col = f"has_{zone}"
        val = "true" if zone in covered else "false"
        zone_cols.append((col, val))

    col_names = ", ".join(c for c, _ in zone_cols)
    col_vals = ", ".join(v for _, v in zone_cols)
    update_set = ", ".join(f"{c} = EXCLUDED.{c}" for c, _ in zone_cols)

    sql = f"""
    INSERT INTO vehicle_coverage_map
        (vehicle_id, {col_names},
         total_zones_covered, coverage_score, image_count, updated_at)
    VALUES
        ('{vehicle_id}', {col_vals},
         {len(agg['covered_zones'])}, {agg['coverage_score']},
         {agg['total_images']}, '{now}'::timestamptz)
    ON CONFLICT (vehicle_id)
    DO UPDATE SET
        {update_set},
        total_zones_covered = EXCLUDED.total_zones_covered,
        coverage_score = EXCLUDED.coverage_score,
        image_count = EXCLUDED.image_count,
        updated_at = EXCLUDED.updated_at;
    """
    psql_exec(sql)


def print_report(vehicle_id: str, agg: dict):
    """Print human-readable condition report to stdout."""
    print(f"\nCondition Report: {vehicle_id[:8]}...")
    print(f"  Images analyzed: {agg['total_images']}")
    print(f"  Overall score:   {agg['overall_score'] or 'N/A'} / 5.0")
    print(f"  Zone coverage:   {agg['coverage_score']:.0%} ({len(agg['covered_zones'])}/{N_ZONES} zones)")
    print(f"  Damage zones:    {agg['damage_zone_count']}")
    print(f"  Modifications:   {agg['modification_count']}")

    if agg["uncovered_zones"]:
        print(f"\n  Uncovered zones ({len(agg['uncovered_zones'])}):")
        for z in agg["uncovered_zones"][:10]:
            print(f"    - {z}")
        if len(agg["uncovered_zones"]) > 10:
            print(f"    ... +{len(agg['uncovered_zones'])-10} more")

    damage_findings = [f for f in agg["findings"] if f["finding_type"] == "damage"]
    mod_findings = [f for f in agg["findings"] if f["finding_type"] == "modification"]

    if damage_findings:
        print(f"\n  Damage findings ({len(damage_findings)}):")
        for f in sorted(damage_findings, key=lambda x: -x["severity"]):
            coord = f"({f['coord_u']:.1f}\", {f['coord_v']:.1f}\")" if f.get("coord_u") else ""
            print(f"    [{f['zone']}] {f['finding']} — severity={f['severity']} conf={f['confidence']:.0%} {coord}")

    if mod_findings:
        seen_mods = set()
        print(f"\n  Modifications detected:")
        for f in mod_findings:
            if f["finding"] not in seen_mods:
                seen_mods.add(f["finding"])
                print(f"    [{f['zone']}] {f['finding']} (conf={f['confidence']:.0%})")


def get_vehicles_to_report(source_filter: str = None, limit: int = 0) -> list:
    """Query vehicle_ids that have vision analysis but no (or stale) condition report."""
    source_clause = f"AND v.listing_source = '{source_filter}'" if source_filter else ""
    limit_clause = f"LIMIT {limit}" if limit > 0 else ""

    sql = f"""
    COPY (
        SELECT DISTINCT vi.vehicle_id
        FROM vehicle_images vi
        JOIN vehicles v ON v.id = vi.vehicle_id
        WHERE vi.vision_analyzed_at IS NOT NULL
          AND vi.vehicle_zone IS NOT NULL
          {source_clause}
        AND vi.vehicle_id NOT IN (
            SELECT vehicle_id FROM vehicle_condition_reports
            WHERE generated_at > NOW() - INTERVAL '7 days'
        )
        {limit_clause}
    ) TO STDOUT WITH CSV HEADER;
    """
    rows = psql(sql)
    return [r["vehicle_id"] for r in rows]


def main():
    parser = argparse.ArgumentParser(description="Generate per-vehicle condition reports")
    parser.add_argument("--vehicle-id", type=str, help="Generate report for single vehicle_id")
    parser.add_argument("--all-bat", action="store_true", help="All BaT vehicles with vision data")
    parser.add_argument("--all-analyzed", action="store_true", help="All vehicles with vision data")
    parser.add_argument("--limit", type=int, default=0, help="Max vehicles to process")
    parser.add_argument("--dry-run", action="store_true", help="Print report without writing to DB")
    args = parser.parse_args()

    print("=" * 60)
    print("YONO Condition Report Generator")
    print("=" * 60)

    if args.vehicle_id:
        # Single vehicle
        vehicle_ids = [args.vehicle_id]
    elif args.all_bat:
        print("Querying BaT vehicles with vision data...")
        vehicle_ids = get_vehicles_to_report(source_filter="bat", limit=args.limit)
    elif args.all_analyzed:
        print("Querying all vehicles with vision data...")
        vehicle_ids = get_vehicles_to_report(limit=args.limit)
    else:
        parser.print_help()
        sys.exit(1)

    print(f"Vehicles to process: {len(vehicle_ids)}")

    if not vehicle_ids:
        print("No vehicles found with vision analysis data.")
        print("Run yono-analyze on images first.")
        return

    success = 0
    error = 0
    t_start = time.time()

    for i, vid in enumerate(vehicle_ids, 1):
        try:
            images = get_analyzed_images(vid)

            if not images:
                print(f"[{i}/{len(vehicle_ids)}] {vid[:8]}... — no analyzed images, skipping")
                continue

            agg = aggregate_findings(images)

            if args.dry_run:
                print_report(vid, agg)
            else:
                write_condition_report(vid, agg)
                write_coverage_map(vid, agg)

                if i % 10 == 0 or i == len(vehicle_ids):
                    elapsed = time.time() - t_start
                    rate = i / elapsed if elapsed > 0 else 0
                    print(
                        f"  [{i:4d}/{len(vehicle_ids)}] "
                        f"ok={success} err={error} rate={rate:.1f}/s"
                    )

            success += 1

        except Exception as e:
            print(f"  Error {vid[:8]}...: {e}")
            error += 1

    elapsed = time.time() - t_start
    print()
    print("=" * 60)
    print("REPORT GENERATION COMPLETE")
    print("=" * 60)
    print(f"  Processed: {success:,}")
    print(f"  Errors:    {error:,}")
    print(f"  Time:      {elapsed:.1f}s")


if __name__ == "__main__":
    main()
