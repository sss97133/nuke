#!/Users/skylar/nuke/yono/.venv/bin/python3
"""
Zone Inference Runner — applies the trained zone classifier to BaT vehicle images.

Fetches BaT vehicle images without vehicle_zone, calls the YONO sidecar
/analyze endpoint (which now has the trained zone model), and writes
vehicle_zone + zone_confidence back to vehicle_images in batches.

This must run AFTER:
  1. train_zone_classifier.py finishes → saves yono_zone_head.safetensors
  2. server.py is restarted → loads the new zone model

Then bat_reconstruct.py can use zone data to filter exterior images for COLMAP.

Usage:
    python scripts/run_zone_inference.py [--vehicle-ids ID1 ID2 ...] [--limit N]
    python scripts/run_zone_inference.py --bat-top 10    # top 10 BaT vehicles by image count
    python scripts/run_zone_inference.py --all-bat       # all BaT vehicles (slow)
"""

import argparse
import csv
import io
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────────────────
SIDECAR_URL = "http://127.0.0.1:8472"
BATCH_SIZE = 20          # images per /analyze/batch call
WRITE_BATCH = 100        # images to buffer before writing to DB
MAX_PER_VEHICLE = 500    # cap per vehicle (exterior filtering handles the rest)
DB_WRITE_TIMEOUT = 45    # seconds for psql upsert

PG_CONN = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres.qkgaybvrernstplzjaam:REDACTED@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
)

# Top BaT vehicle IDs by image count (pre-queried, avoids timeout)
# These are the reconstruction candidates from the session
BAT_TOP_VEHICLES = [
    ("6169c011-be07-4baa-af12-4a151b5beb95", "1982 VW Vanagon L Westfalia",       10742),
    ("273cc5f1-1bbf-4bd4-bf14-eb432bd665d0", "1954 Austin-Healey 100 BN1",         10406),
    ("b5f3087c-77cf-4000-bd14-b7a3ed42e5c1", "1982 Porsche 911SC Coupe",           9936),
    ("d920bc61-154c-40c6-9fa6-8d0f041d834a", "1982 Porsche 911SC Coupe",           9660),
    ("5eb4db03-f8e7-49ac-842c-8f43b9a4db49", "1972 Oldsmobile Vista Cruiser",      9529),
    ("a0b341c6-ae47-4a02-b413-91b3c67b93d5", "1979 Toyota Land Cruiser FJ55",      9366),
    ("a980bdf3-ab9c-4072-b373-5929991fa54d", "1968 Oldsmobile 442 Convertible",    9312),
    ("60c67fea-8993-45a2-8f71-bc47baae4041", "1965 MG MGB Roadster",               9017),
    ("767249b8-4510-4a1e-bdb6-bc15c3038e60", "2001 Jeep Cherokee Sport 4x4",       8806),
    ("5c58b8e3-d2a5-471c-9ebb-16295ffba12c", "1999 Chevrolet Blazer 4x4",          8700),
    ("22e85cbb-0af0-4c12-899d-f852eb2ddfd6", "1993 Saab 900 Turbo Convertible",    8569),
    ("0dc98259-2a2e-437e-9db9-36dbe35b0b73", "1997 Ferrari F355 Berlinetta",       8423),
    ("316e290d-7359-435f-bbff-c98885787558", "1982 Porsche 911SC Coupe",           8386),
    ("dd473bc0-b93f-404a-b23c-c7f2cd48ef13", "2003 Ferrari 360 Spider",            8159),
    ("e6188ad2-857e-4ab4-9b3c-b3ecc8c1476f", "1977 Ford Bronco",                   8047),
    ("1a4cf91b-40b9-4a12-a57a-0764f426e0ff", "1999 Porsche 911 Carrera Coupe",    7945),
    ("d2ce7792-ccae-498e-9d93-f0354626ab66", "1976 BMW 2002 5-Speed",              7788),
    ("4c85229d-846a-49b7-b60d-a71baa6b3d1a", "2004 Bentley Arnage R Mulliner",     7705),
    ("ec0bc8c4-3e46-461d-a0ad-506fd0352fb8", "1971 Chevrolet K10 4x4 Pickup",     7592),
    ("14d4542a-4658-4ea8-b125-de8aab918b81", "1959 Porsche 356A Reutter Coupe",   7533),
]


# ── DB helpers ─────────────────────────────────────────────────────────────

def psql(sql: str, timeout: int = 90) -> list:
    env = os.environ.copy()
    env["PGOPTIONS"] = "-c statement_timeout=85000"
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


def fetch_images_for_vehicle(vehicle_id: str, limit: int = MAX_PER_VEHICLE) -> list:
    """Get images without zone classification for a vehicle."""
    sql = f"""
    COPY (
        SELECT id, image_url
        FROM vehicle_images
        WHERE vehicle_id = '{vehicle_id}'
          AND image_url IS NOT NULL
          AND image_url != ''
          AND vehicle_zone IS NULL
        LIMIT {limit}
    ) TO STDOUT WITH CSV HEADER;
    """
    return psql(sql)


def write_zones_to_db(updates: list):
    """
    Write zone results back to vehicle_images.
    updates: list of {image_id, vehicle_zone, zone_confidence}
    """
    if not updates:
        return

    cases_zone = " ".join(
        f"WHEN id = '{u['image_id']}' THEN '{u['vehicle_zone']}'" for u in updates
    )
    cases_conf = " ".join(
        f"WHEN id = '{u['image_id']}' THEN {u['zone_confidence']}" for u in updates
    )
    ids = ", ".join(f"'{u['image_id']}'" for u in updates)

    sql = f"""
    UPDATE vehicle_images SET
        vehicle_zone = CASE {cases_zone} END,
        zone_confidence = CASE {cases_conf} END
    WHERE id IN ({ids});
    """
    env = os.environ.copy()
    env["PGOPTIONS"] = "-c statement_timeout=30000"
    result = subprocess.run(
        ["psql", PG_CONN],
        input=sql, capture_output=True, text=True, timeout=DB_WRITE_TIMEOUT, env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"DB write failed: {result.stderr.strip()[:200]}")


# ── Sidecar helpers ─────────────────────────────────────────────────────────

def check_server_health() -> dict:
    try:
        with urllib.request.urlopen(f"{SIDECAR_URL}/health", timeout=5) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}


def analyze_batch(image_rows: list) -> list:
    """Call /analyze/batch, return list of result dicts."""
    payload = json.dumps({
        "images": [{"image_url": r["image_url"]} for r in image_rows]
    }).encode()
    req = urllib.request.Request(
        f"{SIDECAR_URL}/analyze/batch",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    return data.get("results", [])


# ── Main logic ──────────────────────────────────────────────────────────────

def run_inference_for_vehicle(vehicle_id: str, label: str, verbose: bool = True) -> dict:
    """Run zone inference for a single vehicle. Returns stats dict."""
    if verbose:
        print(f"\n{'─'*60}")
        print(f"  {label} ({vehicle_id[:8]})")

    # Check for pending images
    images = fetch_images_for_vehicle(vehicle_id)
    if not images:
        if verbose:
            print(f"  No unclassified images — already done.")
        return {"vehicle_id": vehicle_id, "processed": 0, "errors": 0}

    if verbose:
        print(f"  {len(images)} images to classify")

    processed = 0
    errors = 0
    pending_writes = []
    t0 = time.time()

    for batch_start in range(0, len(images), BATCH_SIZE):
        batch = images[batch_start:batch_start + BATCH_SIZE]

        try:
            results = analyze_batch(batch)
        except Exception as e:
            print(f"  Batch error ({batch_start}–{batch_start+len(batch)}): {e}")
            errors += len(batch)
            continue

        for img_row, result in zip(batch, results):
            if result.get("error"):
                errors += 1
                continue
            zone = result.get("vehicle_zone")
            conf = result.get("zone_confidence", 0.0)
            if zone:
                pending_writes.append({
                    "image_id": img_row["id"],
                    "vehicle_zone": zone,
                    "zone_confidence": round(float(conf), 3),
                })
                processed += 1
            else:
                errors += 1

        # Flush writes periodically
        if len(pending_writes) >= WRITE_BATCH:
            write_zones_to_db(pending_writes)
            pending_writes = []

        elapsed = time.time() - t0
        rate = processed / elapsed if elapsed > 0 else 0
        if verbose and (batch_start // BATCH_SIZE) % 5 == 0:
            print(f"  [{batch_start+len(batch)}/{len(images)}] "
                  f"{processed} written, {errors} errors, {rate:.1f} img/s")

    # Final flush
    if pending_writes:
        write_zones_to_db(pending_writes)

    elapsed = time.time() - t0
    if verbose:
        print(f"  Done: {processed} zones written, {errors} errors, {elapsed:.1f}s")

    return {"vehicle_id": vehicle_id, "processed": processed, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description="Run zone inference on BaT vehicle images")
    parser.add_argument("--bat-top", type=int, default=None,
                        help="Process top N BaT vehicles by image count")
    parser.add_argument("--vehicle-ids", nargs="+", default=None,
                        help="Specific vehicle IDs to process")
    parser.add_argument("--limit", type=int, default=None,
                        help="Limit to N vehicles total")
    args = parser.parse_args()

    # Check server health
    print("Checking YONO sidecar...")
    health = check_server_health()
    if "error" in health:
        print(f"ERROR: Sidecar not running: {health['error']}")
        print("Start with: python yono/server.py --host 127.0.0.1 --port 8472 &")
        sys.exit(1)

    zone_ok = health.get("zone_available", False)
    vision_ok = health.get("vision_available", False)
    print(f"  Server: {health.get('model_version', '?')} | "
          f"zone={'✓' if zone_ok else '✗'} | vision={'✓' if vision_ok else '✗'}")

    if not zone_ok:
        print("\nWARNING: Zone classifier not loaded.")
        print("  Either zone model isn't trained yet, or server.py needs restart.")
        print("  Zone inference will use zero-shot Florence-2 (less accurate).")
        print("  Restart server after training: pkill -f server.py && python yono/server.py &")
        inp = input("\nContinue anyway? [y/N] ").strip().lower()
        if inp != "y":
            sys.exit(0)

    # Build vehicle list
    if args.vehicle_ids:
        vehicles = [(vid, vid, 0) for vid in args.vehicle_ids]
    elif args.bat_top is not None:
        vehicles = BAT_TOP_VEHICLES[:args.bat_top]
    else:
        vehicles = BAT_TOP_VEHICLES

    if args.limit:
        vehicles = vehicles[:args.limit]

    print(f"\nProcessing {len(vehicles)} vehicles...")
    total_processed = 0
    total_errors = 0
    t_start = time.time()

    for vehicle_id, label, img_count in vehicles:
        stats = run_inference_for_vehicle(vehicle_id, label)
        total_processed += stats["processed"]
        total_errors += stats["errors"]

    elapsed = time.time() - t_start
    print(f"\n{'='*60}")
    print(f"Zone inference complete:")
    print(f"  Vehicles: {len(vehicles)}")
    print(f"  Zones written: {total_processed:,}")
    print(f"  Errors: {total_errors:,}")
    print(f"  Total time: {elapsed/60:.1f} min")
    print(f"\nNext: python yono/scripts/bat_reconstruct.py --limit 5 --skip-existing")


if __name__ == "__main__":
    main()
