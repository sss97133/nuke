"""
Phase 8: Supabase storage upload + vehicle_images insert.

Follows iphoto-intake.mjs pattern:
1. HEIC -> JPEG via sips
2. Upload to vehicle-photos/{vehicle_id}/iphoto/{filename}
3. Insert vehicle_images row with source='iphoto', ai_processing_status='pending'
4. Batch size: 10 concurrent uploads
5. Skip already-uploaded (dedup by filename + vehicle_id)
"""

import asyncio
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

from .db import get_db, count, log_run

BUCKET = "vehicle-photos"
BATCH_SIZE = 10
USER_ID = "0b9f107a-d124-49de-9ded-94698f63c1c4"


def _get_supabase():
    from supabase import create_client
    url = os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url, key)


def _convert_heic_to_jpeg(src_path: str, dest_dir: str) -> str | None:
    """Convert HEIC to JPEG using sips. Returns output path or None."""
    src = Path(src_path)
    if src.suffix.lower() != ".heic":
        return src_path  # Already JPEG/PNG

    out_name = src.stem + ".jpg"
    out_path = Path(dest_dir) / out_name
    try:
        subprocess.run(
            ["sips", "-s", "format", "jpeg", str(src), "--out", str(out_path), "-s", "formatOptions", "85"],
            capture_output=True, check=True, timeout=30
        )
        return str(out_path)
    except Exception:
        return None


def upload_profile(profile_id: str, dry_run: bool = False, on_progress=None) -> dict:
    """
    Upload all photos for a vehicle profile to Supabase.

    Returns:
        {uploaded: int, skipped: int, errors: int, total: int}
    """
    db = get_db()
    sb = _get_supabase()
    t0 = time.time()

    # Get profile
    profile = db.execute("SELECT * FROM vehicle_profiles WHERE id=?", [profile_id]).fetchone()
    if not profile:
        return {"error": f"Profile {profile_id} not found"}

    vehicle_id = profile["supabase_vehicle_id"]
    if not vehicle_id:
        return {"error": f"Profile {profile_id} has no Supabase vehicle match"}

    # Get uploadable photos (local path, not yet uploaded)
    photos = db.execute(
        "SELECT uuid, path, filename, original_filename, date, latitude, longitude, "
        "place, labels, score_overall "
        "FROM photos WHERE profile_id=? AND path IS NOT NULL AND ismissing=0 AND uploaded=0",
        [profile_id]
    ).fetchall()

    if not photos:
        already = count(db, "photos", f"profile_id='{profile_id}' AND uploaded=1")
        return {"uploaded": 0, "skipped": already, "errors": 0, "total": already}

    total = len(photos)
    print(f"  Upload: {total} photos for {profile['year']} {profile['make']} {profile['model']}")

    if dry_run:
        print(f"    DRY RUN: would upload {total} photos to vehicle {vehicle_id}")
        return {"uploaded": 0, "skipped": 0, "errors": 0, "total": total, "dry_run": True}

    # Check existing uploads in Supabase (dedup)
    existing_names = set()
    try:
        result = sb.table("vehicle_images").select("file_name").eq(
            "vehicle_id", vehicle_id
        ).eq("source", "iphoto").execute()
        existing_names = {r["file_name"] for r in (result.data or [])}
    except Exception as e:
        print(f"    Warning: could not check existing uploads: {e}")

    uploaded = 0
    skipped = 0
    errors = 0
    tmp_dir = tempfile.mkdtemp(prefix="photo_intel_")

    for i, photo in enumerate(photos):
        src_path = photo["path"]
        filename = photo["original_filename"] or photo["filename"] or Path(src_path).name

        # Normalize extension
        base = Path(filename).stem
        jpeg_name = base + ".jpg"

        if jpeg_name in existing_names or filename in existing_names:
            skipped += 1
            db.execute("UPDATE photos SET uploaded=1 WHERE uuid=?", [photo["uuid"]])
            continue

        # Convert HEIC if needed
        upload_path = _convert_heic_to_jpeg(src_path, tmp_dir)
        if not upload_path:
            errors += 1
            continue

        actual_name = Path(upload_path).name
        storage_path = f"{vehicle_id}/iphoto/{actual_name}"
        mime_type = "image/png" if actual_name.lower().endswith(".png") else "image/jpeg"

        try:
            with open(upload_path, "rb") as f:
                file_data = f.read()
            file_size = len(file_data)

            sb.storage.from_(BUCKET).upload(
                storage_path, file_data,
                {"content-type": mime_type, "upsert": "true"}
            )

            public_url = sb.storage.from_(BUCKET).get_public_url(storage_path)

            # Extract metadata
            place = None
            if photo["place"]:
                try:
                    p = json.loads(photo["place"])
                    if isinstance(p, dict):
                        place = p.get("address_str") or p.get("name")
                except (json.JSONDecodeError, TypeError):
                    pass

            labels = []
            if photo["labels"]:
                try:
                    labels = json.loads(photo["labels"])
                except (json.JSONDecodeError, TypeError):
                    pass

            row = {
                "vehicle_id": vehicle_id,
                "image_url": public_url,
                "storage_path": storage_path,
                "source": "iphoto",
                "mime_type": mime_type,
                "file_name": actual_name,
                "file_size": file_size,
                "is_external": False,
                "ai_processing_status": "pending",
                "documented_by_user_id": USER_ID,
            }
            if photo["latitude"]:
                row["latitude"] = photo["latitude"]
            if photo["longitude"]:
                row["longitude"] = photo["longitude"]
            if place:
                row["location_name"] = place
            if photo["date"]:
                row["taken_at"] = photo["date"]
            if labels or photo["score_overall"]:
                exif = {}
                if labels:
                    exif["labels"] = labels
                if photo["score_overall"]:
                    exif["score"] = {"overall": photo["score_overall"]}
                row["exif_data"] = json.dumps(exif)

            sb.table("vehicle_images").insert(row).execute()

            # Record in SQLite
            db.execute(
                "INSERT OR REPLACE INTO upload_state (photo_uuid, vehicle_id, storage_path, image_url, uploaded_at) "
                "VALUES (?, ?, ?, ?, datetime('now'))",
                [photo["uuid"], vehicle_id, storage_path, public_url]
            )
            db.execute("UPDATE photos SET uploaded=1 WHERE uuid=?", [photo["uuid"]])
            uploaded += 1
            existing_names.add(actual_name)

        except Exception as e:
            err_msg = str(e)
            if "duplicate" in err_msg.lower() or "unique" in err_msg.lower():
                skipped += 1
                db.execute("UPDATE photos SET uploaded=1 WHERE uuid=?", [photo["uuid"]])
            else:
                errors += 1
                if errors <= 5:
                    print(f"    Error uploading {actual_name}: {err_msg[:200]}")
                db.execute(
                    "INSERT OR REPLACE INTO upload_state (photo_uuid, vehicle_id, error, uploaded_at) "
                    "VALUES (?, ?, ?, datetime('now'))",
                    [photo["uuid"], vehicle_id, err_msg[:500]]
                )

        if (i + 1) % 10 == 0:
            db.commit()
            if on_progress:
                on_progress(i + 1, total, uploaded, errors)
            print(f"\r    {i+1}/{total} ({uploaded} up, {skipped} skip, {errors} err)", end="", flush=True)

    db.commit()
    print()

    # Cleanup temp dir
    import shutil
    shutil.rmtree(tmp_dir, ignore_errors=True)

    duration = time.time() - t0
    log_run(db, "upload", total, uploaded, duration,
            f"profile={profile_id}, skipped={skipped}, errors={errors}")
    if on_progress:
        on_progress(total, total, uploaded, errors)
    print(f"  Upload complete: {uploaded} new, {skipped} skipped, {errors} errors in {duration:.1f}s")
    db.close()
    return {"uploaded": uploaded, "skipped": skipped, "errors": errors, "total": total}


def upload_all(dry_run: bool = False, on_progress=None) -> dict:
    """Upload all profiles that have Supabase vehicle matches."""
    db = get_db()
    profiles = db.execute(
        "SELECT id, album_name, year, make, model FROM vehicle_profiles WHERE supabase_vehicle_id IS NOT NULL"
    ).fetchall()
    db.close()

    total_uploaded = 0
    total_errors = 0
    for p in profiles:
        print(f"\n  {p['year']} {p['make']} {p['model']}:")
        result = upload_profile(p["id"], dry_run=dry_run, on_progress=on_progress)
        total_uploaded += result.get("uploaded", 0)
        total_errors += result.get("errors", 0)

    return {"profiles": len(profiles), "uploaded": total_uploaded, "errors": total_errors}
