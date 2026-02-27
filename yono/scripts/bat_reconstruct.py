#!/Users/skylar/nuke/yono/.venv/bin/python3
"""
BaT 3D Reconstruction Pipeline — COLMAP Structure-from-Motion on BaT vehicle images.

PREREQUISITE: COLMAP must be installed.
  macOS: brew install colmap
  Verify: colmap --version

This script queries BaT vehicles with 20+ images, downloads their images,
runs COLMAP Structure-from-Motion to extract camera poses and a sparse 3D
point cloud, then stores the results in the vehicle_reconstructions table.

This is Phase 1 of the YONO coordinate system pipeline (VISION_ROADMAP.md):
  Zone classifier (L0) → COLMAP poses (L2) → pixel-to-surface mapping (L3)

The camera poses enable upgrading zone tags ("driver side") to precise surface
coordinates ("142.3", 18.7" from front-center-ground origin").

Usage:
    python scripts/bat_reconstruct.py --check          # verify COLMAP installed
    python scripts/bat_reconstruct.py --list           # list candidate vehicles
    python scripts/bat_reconstruct.py                  # run reconstruction pipeline
    python scripts/bat_reconstruct.py --vehicle-id <uuid>  # single vehicle
    python scripts/bat_reconstruct.py --limit 10       # process first 10 vehicles
    python scripts/bat_reconstruct.py --skip-existing  # skip already-reconstructed

Output per vehicle:
    /tmp/colmap_<vehicle_id>/
        images/         — downloaded images
        sparse/         — COLMAP sparse reconstruction
        sparse/0/cameras.bin, images.bin, points3D.bin
    → Stored in vehicle_reconstructions table as JSON camera poses

DB table (created by migration 20260226_vehicle_reconstructions.sql):
    vehicle_reconstructions (
        id, vehicle_id, point_cloud_url, camera_poses jsonb,
        reconstruction_quality, image_count, reconstructed_at
    )
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Optional

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
YONO_DIR = Path(__file__).parent.parent

# COLMAP settings
COLMAP_BIN = "colmap"
MIN_IMAGES = 20          # minimum images to attempt reconstruction
MAX_IMAGE_DL = 100       # max images to download per vehicle (COLMAP works best with 30-100)
TARGET_LONG_EDGE = 1600  # resize to this max dimension for COLMAP efficiency


def check_colmap() -> bool:
    """Check if COLMAP is installed and working."""
    try:
        result = subprocess.run(
            [COLMAP_BIN, "help"],
            capture_output=True, text=True, timeout=10,
        )
        # colmap exits 0 on help; parse version from output
        output = result.stdout.strip() or result.stderr.strip()
        if "COLMAP" in output:
            version_line = output.split("\n")[0]
            print(f"COLMAP found: {version_line[:80]}")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return False


def psql(sql: str, timeout: int = 90) -> list:
    """Run a psql COPY query and return rows as dicts."""
    import csv, io
    env = os.environ.copy()
    env["PGOPTIONS"] = "-c statement_timeout=85000"
    result = subprocess.run(
        ["psql", PG_CONN, "-t"],
        input=sql,
        capture_output=True, text=True, timeout=timeout, env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql error: {result.stderr.strip()[:300]}")
    rows = []
    reader = csv.DictReader(io.StringIO(result.stdout))
    for row in reader:
        rows.append(dict(row))
    return rows


def get_bat_candidates(limit: int = 100, skip_existing: bool = True) -> list:
    """
    Query BaT vehicles with >= MIN_IMAGES images.
    Returns list of {vehicle_id, make, model, year, img_count}.
    """
    existing_filter = ""
    if skip_existing:
        existing_filter = """
          AND v.id NOT IN (
              SELECT vehicle_id FROM vehicle_reconstructions
              WHERE reconstruction_quality != 'failed'
          )
        """

    # Drive from bat_listings (small table, indexed) to avoid 28M-row scan on vehicle_images
    existing_clause = ""
    if skip_existing:
        existing_clause = """
          AND bl.vehicle_id NOT IN (
              SELECT vehicle_id FROM vehicle_reconstructions
              WHERE reconstruction_quality NOT IN ('failed', 'pending')
          )
        """

    sql = f"""
    COPY (
        SELECT
            v.id,
            v.year,
            v.make,
            v.model,
            COUNT(vi.id) AS img_count
        FROM bat_listings bl
        JOIN vehicles v ON v.id = bl.vehicle_id
        JOIN vehicle_images vi ON vi.vehicle_id = bl.vehicle_id
        WHERE vi.image_url IS NOT NULL
          {existing_clause}
        GROUP BY v.id, v.year, v.make, v.model
        HAVING COUNT(vi.id) >= {MIN_IMAGES}
        ORDER BY COUNT(vi.id) DESC
        LIMIT {limit}
    ) TO STDOUT WITH CSV HEADER;
    """
    rows = psql(sql)
    return rows


EXTERIOR_ZONES = (
    "ext_front", "ext_front_driver", "ext_front_passenger",
    "ext_driver_side", "ext_passenger_side",
    "ext_rear", "ext_rear_driver", "ext_rear_passenger",
    "ext_roof",
)


def get_vehicle_images(vehicle_id: str, limit: int = MAX_IMAGE_DL) -> list:
    """
    Get image URLs for a vehicle, preferring exterior shots for COLMAP.

    Priority order:
    1. Images with exterior zone classification (best for SfM — overlapping angles)
    2. All images if no zone data available yet

    COLMAP needs images that overlap in 3D space. Interior/detail shots don't
    overlap with exterior shots, so mixing them kills the reconstruction.
    """
    zones_str = ", ".join(f"'{z}'" for z in EXTERIOR_ZONES)

    sql = f"""
    COPY (
        SELECT id, image_url, vehicle_zone
        FROM vehicle_images
        WHERE vehicle_id = '{vehicle_id}'
          AND image_url IS NOT NULL
          AND image_url != ''
        ORDER BY
          CASE WHEN vehicle_zone IN ({zones_str}) THEN 0 ELSE 1 END,
          id
        LIMIT {limit}
    ) TO STDOUT WITH CSV HEADER;
    """
    return psql(sql)


def download_images(image_rows: list, dest_dir: Path) -> list:
    """
    Download images to dest_dir, resizing large ones.
    Returns list of successfully downloaded local paths.
    """
    import urllib.request
    from PIL import Image as PILImage

    dest_dir.mkdir(parents=True, exist_ok=True)
    downloaded = []

    for i, row in enumerate(image_rows):
        url = row["image_url"]
        img_id = row["id"]
        ext = Path(url.split("?")[0]).suffix.lower() or ".jpg"
        if ext not in (".jpg", ".jpeg", ".png", ".webp"):
            ext = ".jpg"

        dest = dest_dir / f"{i:04d}_{img_id[:8]}{ext}"

        try:
            urllib.request.urlretrieve(url, dest)

            # Resize if too large
            try:
                img = PILImage.open(dest)
                w, h = img.size
                max_dim = max(w, h)
                if max_dim > TARGET_LONG_EDGE:
                    scale = TARGET_LONG_EDGE / max_dim
                    new_size = (int(w * scale), int(h * scale))
                    img = img.resize(new_size, PILImage.LANCZOS).convert("RGB")
                    img.save(dest, "JPEG", quality=90)
            except Exception:
                pass  # keep original if resize fails

            downloaded.append(dest)

        except Exception as e:
            print(f"  Download failed ({img_id[:8]}): {e}")
            continue

    return downloaded


def run_colmap(image_dir: Path, output_dir: Path, vehicle_id: str) -> dict:
    """
    Run COLMAP feature extraction + matching + reconstruction.

    Returns dict with:
        quality: 'good' | 'poor' | 'failed'
        n_images_registered: int
        n_points3d: int
        camera_poses: dict  # {image_name: {R: [[...]], t: [...]}}
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    sparse_dir = output_dir / "sparse"
    sparse_dir.mkdir(exist_ok=True)
    db_path = output_dir / "colmap.db"

    def run(args, step):
        """Run a COLMAP command and return success bool."""
        try:
            result = subprocess.run(
                [COLMAP_BIN] + args,
                capture_output=True, text=True, timeout=600,
            )
            if result.returncode != 0:
                print(f"  COLMAP {step} failed: {result.stderr[:200]}")
                return False
            return True
        except subprocess.TimeoutExpired:
            print(f"  COLMAP {step} timed out (>10min)")
            return False
        except Exception as e:
            print(f"  COLMAP {step} error: {e}")
            return False

    # Step 1: Feature extraction
    print(f"  [COLMAP] Extracting features...")
    ok = run([
        "feature_extractor",
        "--database_path", str(db_path),
        "--image_path", str(image_dir),
        # Note: don't use single_camera — BaT images have mixed dimensions
        "--FeatureExtraction.use_gpu", "0",  # MPS not supported by COLMAP's CUDA SIFT
        "--FeatureExtraction.num_threads", "4",
    ], "feature_extractor")
    if not ok:
        return {"quality": "failed", "n_images_registered": 0, "n_points3d": 0, "camera_poses": {}}

    # Step 2: Exhaustive matching — BaT photos are unordered listing shots,
    # not video sequences. Sequential matching fails because adjacent images
    # (by filename) show completely different zones. Exhaustive matching
    # checks all N*(N-1)/2 pairs and finds the overlapping exterior shots.
    # ~100 images = 4950 pairs, ~2min. For >100 images use vocab-tree.
    print(f"  [COLMAP] Exhaustive matching (unordered photos)...")
    run([
        "exhaustive_matcher",
        "--database_path", str(db_path),
        "--FeatureMatching.use_gpu", "0",
        "--FeatureMatching.num_threads", "4",
    ], "exhaustive_matcher")

    # Step 3: Sparse reconstruction
    print(f"  [COLMAP] Running sparse mapper...")
    ok = run([
        "mapper",
        "--database_path", str(db_path),
        "--image_path", str(image_dir),
        "--output_path", str(sparse_dir),
        "--Mapper.num_threads", "4",
        "--Mapper.init_min_num_inliers", "15",
        "--Mapper.abs_pose_min_num_inliers", "15",
        "--Mapper.min_num_matches", "10",
    ], "mapper")

    if not ok:
        return {"quality": "failed", "n_images_registered": 0, "n_points3d": 0, "camera_poses": {}}

    # Step 4: Extract camera poses from reconstruction
    recon_dirs = sorted(sparse_dir.iterdir()) if sparse_dir.exists() else []
    if not recon_dirs:
        return {"quality": "failed", "n_images_registered": 0, "n_points3d": 0, "camera_poses": {}}

    # Use the largest reconstruction
    best_recon = recon_dirs[0]

    # Convert binary to text format for parsing
    text_dir = output_dir / "sparse_text"
    text_dir.mkdir(exist_ok=True)
    ok = run([
        "model_converter",
        "--input_path", str(best_recon),
        "--output_path", str(text_dir),
        "--output_type", "TXT",
    ], "model_converter")

    camera_poses = {}
    n_images_registered = 0
    n_points3d = 0

    if ok and (text_dir / "images.txt").exists():
        # Parse images.txt for camera poses
        # Format: IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME
        with open(text_dir / "images.txt") as f:
            lines = [l.strip() for l in f if l.strip() and not l.startswith("#")]

        # Images.txt has 2 lines per image: pose line, then point line
        for i in range(0, len(lines), 2):
            parts = lines[i].split()
            if len(parts) < 10:
                continue
            try:
                img_id = parts[0]
                qw, qx, qy, qz = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
                tx, ty, tz = float(parts[5]), float(parts[6]), float(parts[7])
                img_name = parts[9]

                # Convert quaternion to rotation matrix
                R = quaternion_to_rotation_matrix(qw, qx, qy, qz)

                camera_poses[img_name] = {
                    "image_id": img_id,
                    "R": R,  # 3x3 rotation matrix (list of lists)
                    "t": [tx, ty, tz],  # translation vector
                    # Full 4x4 world-to-camera transform:
                    # [R | t]
                    # [0 | 1]
                }
                n_images_registered += 1
            except (ValueError, IndexError):
                continue

        # Count 3D points
        if (text_dir / "points3D.txt").exists():
            with open(text_dir / "points3D.txt") as f:
                n_points3d = sum(1 for l in f if l.strip() and not l.startswith("#"))

    quality = "failed"
    if n_images_registered >= 10:
        quality = "good"
    elif n_images_registered >= 3:
        quality = "poor"

    return {
        "quality": quality,
        "n_images_registered": n_images_registered,
        "n_points3d": n_points3d,
        "camera_poses": camera_poses,
    }


def quaternion_to_rotation_matrix(qw: float, qx: float, qy: float, qz: float) -> list:
    """Convert unit quaternion to 3x3 rotation matrix (list of lists)."""
    # Normalize
    norm = (qw**2 + qx**2 + qy**2 + qz**2) ** 0.5
    if norm < 1e-8:
        return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    qw, qx, qy, qz = qw/norm, qx/norm, qy/norm, qz/norm

    R = [
        [1 - 2*(qy**2 + qz**2), 2*(qx*qy - qz*qw), 2*(qx*qz + qy*qw)],
        [2*(qx*qy + qz*qw), 1 - 2*(qx**2 + qz**2), 2*(qy*qz - qx*qw)],
        [2*(qx*qz - qy*qw), 2*(qy*qz + qx*qw), 1 - 2*(qx**2 + qy**2)],
    ]
    # Round to 6 decimal places for storage
    return [[round(v, 6) for v in row] for row in R]


def store_reconstruction(vehicle_id: str, result: dict):
    """Upsert reconstruction results into vehicle_reconstructions table."""
    camera_poses_json = json.dumps(result["camera_poses"]).replace("'", "''")
    quality = result["quality"].replace("'", "''")
    n_images = result["n_images_registered"]
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    sql = f"""
    COPY (
        SELECT 1 FROM vehicle_reconstructions LIMIT 0
    ) TO STDOUT;
    """
    # Use INSERT ... ON CONFLICT for upsert
    upsert_sql = f"""
    INSERT INTO vehicle_reconstructions
        (vehicle_id, camera_poses, reconstruction_quality, image_count, reconstructed_at)
    VALUES
        ('{vehicle_id}', '{camera_poses_json}'::jsonb, '{quality}', {n_images}, '{now}'::timestamptz)
    ON CONFLICT (vehicle_id)
    DO UPDATE SET
        camera_poses = EXCLUDED.camera_poses,
        reconstruction_quality = EXCLUDED.reconstruction_quality,
        image_count = EXCLUDED.image_count,
        reconstructed_at = EXCLUDED.reconstructed_at;
    """
    env = os.environ.copy()
    env["PGOPTIONS"] = "-c statement_timeout=30000"
    result_proc = subprocess.run(
        ["psql", PG_CONN],
        input=upsert_sql,
        capture_output=True, text=True, timeout=35, env=env,
    )
    if result_proc.returncode != 0:
        raise RuntimeError(f"DB write failed: {result_proc.stderr[:200]}")


def reconstruct_vehicle(vehicle: dict, work_dir: Path, skip_colmap: bool = False) -> dict:
    """
    Full pipeline for a single vehicle:
    1. Download images
    2. Run COLMAP
    3. Store results in DB

    Returns result dict.
    """
    vehicle_id = vehicle["id"]
    make = vehicle.get("make", "?")
    model = vehicle.get("model", "?")
    year = vehicle.get("year", "?")
    img_count = vehicle.get("img_count", "?")

    print(f"\nVehicle: {year} {make} {model} ({vehicle_id[:8]})")
    print(f"  DB image count: {img_count}")

    # Fetch image URLs
    image_rows = get_vehicle_images(vehicle_id)
    print(f"  Fetched {len(image_rows)} image URLs")

    if len(image_rows) < MIN_IMAGES:
        print(f"  Too few images ({len(image_rows)} < {MIN_IMAGES}), skipping")
        return {"quality": "failed", "n_images_registered": 0, "n_points3d": 0}

    # Work directory for this vehicle
    vehicle_work = work_dir / vehicle_id
    image_dir = vehicle_work / "images"
    colmap_output = vehicle_work / "colmap_output"

    # Clean stale COLMAP DB so re-runs start fresh
    stale_db = colmap_output / "colmap.db"
    if stale_db.exists():
        stale_db.unlink()

    # Download images (skip existing files to speed up re-runs)
    t0 = time.time()
    existing = {f.name for f in image_dir.glob("*.jpg")} if image_dir.exists() else set()
    if existing:
        print(f"  Reusing {len(existing)} existing images")
        downloaded = sorted(image_dir.glob("*.jpg"))
    else:
        downloaded = download_images(image_rows, image_dir)
        print(f"  Downloaded {len(downloaded)} images in {time.time()-t0:.1f}s")

    if len(downloaded) < 10:
        print(f"  Too few successful downloads, skipping")
        result = {"quality": "failed", "n_images_registered": 0, "n_points3d": 0, "camera_poses": {}}
        store_reconstruction(vehicle_id, result)
        return result

    # Log zone coverage — exterior images are what COLMAP needs
    exterior_count = sum(1 for r in image_rows if r.get("vehicle_zone", "") in EXTERIOR_ZONES)
    null_zone_count = sum(1 for r in image_rows if not r.get("vehicle_zone"))
    if null_zone_count > 0:
        print(f"  Zone data: {len(image_rows) - null_zone_count} classified, "
              f"{null_zone_count} unclassified (run zone classifier first for best results)")
    if exterior_count > 0:
        print(f"  Exterior images: {exterior_count}/{len(image_rows)} — good for COLMAP overlap")
    elif null_zone_count == len(image_rows):
        print(f"  WARNING: No zone data — using random {len(image_rows)} images. "
              f"COLMAP may fail due to mixed zones (interior+exterior+detail).")

    if skip_colmap:
        print("  --skip-colmap: skipping COLMAP, storing placeholder")
        result = {"quality": "skipped", "n_images_registered": len(downloaded), "n_points3d": 0, "camera_poses": {}}
        store_reconstruction(vehicle_id, result)
        return result

    # Run COLMAP
    t1 = time.time()
    output_dir = vehicle_work / "colmap_output"
    result = run_colmap(image_dir, output_dir, vehicle_id)
    elapsed = time.time() - t1

    print(f"  COLMAP done in {elapsed:.0f}s: quality={result['quality']} "
          f"images={result['n_images_registered']} points={result['n_points3d']}")

    # Store in DB
    store_reconstruction(vehicle_id, result)
    print(f"  Stored in vehicle_reconstructions")

    return result


def main():
    parser = argparse.ArgumentParser(description="BaT 3D reconstruction pipeline")
    parser.add_argument("--check", action="store_true", help="Check COLMAP installation and exit")
    parser.add_argument("--list", action="store_true", help="List candidate vehicles and exit")
    parser.add_argument("--vehicle-id", type=str, help="Process a single vehicle_id")
    parser.add_argument("--limit", type=int, default=100, help="Max vehicles to process")
    parser.add_argument("--skip-existing", action="store_true", default=True,
                        help="Skip already-reconstructed vehicles (default: True)")
    parser.add_argument("--no-skip-existing", action="store_false", dest="skip_existing")
    parser.add_argument("--skip-colmap", action="store_true",
                        help="Download images but skip COLMAP (for testing download pipeline)")
    parser.add_argument("--work-dir", type=str, default="/tmp/colmap_reconstructions",
                        help="Working directory for COLMAP files")
    args = parser.parse_args()

    # Check COLMAP
    colmap_available = check_colmap()

    if args.check:
        if colmap_available:
            print("COLMAP is installed and ready.")
        else:
            print("COLMAP NOT FOUND.")
            print("Install with: brew install colmap")
            print("Then verify: colmap --version")
        sys.exit(0 if colmap_available else 1)

    if not colmap_available and not args.skip_colmap:
        print("=" * 60)
        print("COLMAP NOT INSTALLED")
        print("=" * 60)
        print()
        print("This script requires COLMAP for 3D reconstruction.")
        print()
        print("Install:")
        print("  brew install colmap")
        print()
        print("Once installed, run this script again.")
        print()
        print("Alternative: use --skip-colmap to test the image download")
        print("pipeline without running reconstruction.")
        sys.exit(1)

    work_dir = Path(args.work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("BaT 3D Reconstruction Pipeline")
    print("=" * 60)
    print(f"Work dir: {work_dir}")
    print(f"Min images: {MIN_IMAGES}")
    print(f"Max download per vehicle: {MAX_IMAGE_DL}")
    print()

    # Single vehicle mode
    if args.vehicle_id:
        vehicle = {
            "id": args.vehicle_id,
            "make": "?", "model": "?", "year": "?",
            "img_count": "?",
        }
        result = reconstruct_vehicle(vehicle, work_dir, skip_colmap=args.skip_colmap)
        print(f"\nResult: {result['quality']}")
        return

    # List mode
    if args.list:
        print("Querying BaT vehicles with 20+ images...")
        candidates = get_bat_candidates(limit=50, skip_existing=False)
        print(f"\n{'ID':36s} {'Year':5s} {'Make':12s} {'Model':20s} {'Images':7s}")
        print("-" * 85)
        for v in candidates:
            print(f"{v['id']} {v.get('year','?'):5s} {v.get('make','?'):12s} {v.get('model','?'):20s} {v.get('img_count','?'):7s}")
        print(f"\n{len(candidates)} candidates found")
        return

    # Batch mode
    print("Querying BaT candidate vehicles...")
    candidates = get_bat_candidates(limit=args.limit, skip_existing=args.skip_existing)
    print(f"Found {len(candidates)} candidates")

    if not candidates:
        print("No vehicles to process.")
        return

    # Process each vehicle
    results = {"good": 0, "poor": 0, "failed": 0, "skipped": 0}
    t_start = time.time()

    for i, vehicle in enumerate(candidates, 1):
        print(f"\n[{i}/{len(candidates)}]", end="")
        try:
            result = reconstruct_vehicle(vehicle, work_dir, skip_colmap=args.skip_colmap)
            quality = result.get("quality", "failed")
            results[quality] = results.get(quality, 0) + 1
        except Exception as e:
            print(f"\nError processing {vehicle['id']}: {e}")
            results["failed"] += 1

        # Clean up work dir after each vehicle to save disk space
        vehicle_work = work_dir / vehicle["id"]
        if vehicle_work.exists() and result.get("quality") != "failed":
            shutil.rmtree(vehicle_work, ignore_errors=True)

    elapsed = time.time() - t_start
    print("\n")
    print("=" * 60)
    print("RECONSTRUCTION COMPLETE")
    print("=" * 60)
    print(f"  Total:   {len(candidates)}")
    print(f"  Good:    {results.get('good', 0)}")
    print(f"  Poor:    {results.get('poor', 0)}")
    print(f"  Failed:  {results.get('failed', 0)}")
    print(f"  Skipped: {results.get('skipped', 0)}")
    print(f"  Time:    {elapsed/60:.1f} minutes")
    print()
    print("Next: build pixel-to-surface projection using camera poses")
    print("See: VISION_ROADMAP.md Phase 2")


if __name__ == "__main__":
    main()
