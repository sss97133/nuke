#!/usr/bin/env python3
"""
One-off: sync all photos from the "blue 1983" GMC K2500 album(s) in Apple Photos
to the 1983 GMC K2500 vehicle profile so the vehicle page shows your iPhoto images.

Uses Full Disk Access to read Photos Library. Run from Terminal:
  cd nuke && python3 scripts/sync-blue-1983-from-photos.py

Requires: .env with VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
Optional: NUKE_USER_ID (defaults to Skylar's).
"""
import os
import sys
import json
import sqlite3
import hashlib
import subprocess
import tempfile
import time
import shutil
from pathlib import Path
from datetime import datetime, timezone

# 1983 GMC K2500 (blue) vehicle
TARGET_VEHICLE_ID = "a90c008a-3379-41d8-9eb2-b4eda365d74c"
PHOTOS_LIBRARY = Path.home() / "Pictures" / "Photos Library.photoslibrary"
PHOTOS_DB_PATH = PHOTOS_LIBRARY / "database" / "Photos.sqlite"
PHOTOS_ORIGINALS = PHOTOS_LIBRARY / "originals"
CORE_DATA_EPOCH = 978307200
MAX_IMAGE_DIM = 2000
JPEG_QUALITY = 90

# Albums to include (exact or pattern: 1983 + GMC + blue/K2500)
ALBUM_TITLE_PATTERNS = ["1983 GMC K2500 BLUE", "1983 GMC K2500"]


def load_env():
    root = Path(__file__).resolve().parent.parent
    for name in (".env", ".env.local"):
        p = root / name
        if p.exists():
            for line in p.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    v = v.strip().strip('"').strip("'")
                    if k and v and k not in os.environ:
                        os.environ[k] = v
                    elif k and v:
                        os.environ[k] = v


def core_to_dt(ts):
    if ts is None or ts <= 0:
        return None
    return datetime.fromtimestamp(ts + CORE_DATA_EPOCH, tz=timezone.utc)


def get_photos_in_albums():
    """Return list of photo dicts (path, uuid, metadata) for assets in matching albums."""
    if not PHOTOS_DB_PATH.exists():
        return []
    conn = sqlite3.connect(f"file:{PHOTOS_DB_PATH}?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    placeholders = ",".join("?" for _ in ALBUM_TITLE_PATTERNS)
    sql = f"""
        SELECT DISTINCT a.Z_PK, a.ZUUID, a.ZFILENAME, a.ZDIRECTORY,
               a.ZADDEDDATE, a.ZDATECREATED, a.ZWIDTH, a.ZHEIGHT,
               a.ZLATITUDE, a.ZLONGITUDE, b.ZORIGINALFILENAME
        FROM ZASSET a
        LEFT JOIN ZADDITIONALASSETATTRIBUTES b ON b.ZASSET = a.Z_PK
        JOIN Z_33ASSETS ja ON ja.Z_3ASSETS = a.Z_PK
        JOIN ZGENERICALBUM g ON g.Z_PK = ja.Z_33ALBUMS
        WHERE a.ZKIND = 0 AND a.ZTRASHEDSTATE = 0 AND a.ZISDETECTEDSCREENSHOT = 0
          AND g.ZKIND = 2 AND g.ZTITLE IS NOT NULL
          AND (g.ZTITLE IN ({placeholders}) OR (g.ZTITLE LIKE '%1983%' AND g.ZTITLE LIKE '%GMC%' AND (g.ZTITLE LIKE '%blue%' OR g.ZTITLE LIKE '%K2500%')))
        ORDER BY a.ZADDEDDATE ASC
    """
    rows = [dict(r) for r in conn.execute(sql, list(ALBUM_TITLE_PATTERNS)).fetchall()]
    conn.close()
    photos = []
    for r in rows:
        directory = r["ZDIRECTORY"] or ""
        filename = r["ZFILENAME"] or ""
        path = PHOTOS_ORIGINALS / directory / filename
        # Include every photo; path may be None if iCloud-only (we'll export via Photos app)
        path_str = str(path) if path.exists() else None
        lat, lon = r["ZLATITUDE"], r["ZLONGITUDE"]
        if lat is not None and abs(lat) >= 180:
            lat = None
        if lon is not None and abs(lon) >= 180:
            lon = None
        date_taken = core_to_dt(r["ZDATECREATED"])
        date_added = core_to_dt(r["ZADDEDDATE"])
        photos.append({
            "uuid": r["ZUUID"],
            "path": path_str,
            "filename": filename,
            "original_filename": r["ZORIGINALFILENAME"] or filename,
            "date_taken": date_taken.isoformat() if date_taken else None,
            "date_added": date_added.isoformat() if date_added else None,
            "latitude": lat,
            "longitude": lon,
        })
    return photos


def export_via_photos_app(uuid: str, dest_dir: Path):
    """Export one photo by UUID from Photos app (works for iCloud). Returns path to exported file or None."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = str(dest_dir.resolve()).replace("'", "'\"'\"'")
    script = f'''
    (() => {{
      const Photos = Application("Photos");
      Photos.includeStandardAdditions = true;
      const items = Photos.mediaItems().filter(m => String(m.id()) === "{uuid}");
      if (items.length === 0) return JSON.stringify({{ ok: false }});
      const app = Application.currentApplication();
      app.includeStandardAdditions = true;
      try {{ app.doShellScript("mkdir -p " + "{dest}"); }} catch(e) {{}}
      Photos.export(items, {{ to: Path("{dest}"), with: "using originals" }});
      return JSON.stringify({{ ok: true }});
    }})();
    '''
    try:
        out = subprocess.run(
            ["osascript", "-l", "JavaScript", "-e", script],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if out.returncode != 0:
            return None
        try:
            if not json.loads(out.stdout or "{}").get("ok"):
                return None
        except json.JSONDecodeError:
            return None
        # Find exported file (Photos often keeps original name)
        for f in dest_dir.iterdir():
            if not f.name.startswith("."):
                return str(f)
    except Exception:
        pass
    return None


def export_to_jpeg(photo: dict, export_dir: Path):
    """Copy/convert photo to JPEG in export_dir. Uses local path or exports via Photos app if iCloud-only. Returns (path, metadata) or (None, None)."""
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    from PIL import Image

    src_path = photo.get("path")
    if not src_path or not Path(src_path).exists():
        # iCloud-only: export via Photos app (unique dir per photo so no overwrites)
        exported = export_via_photos_app(photo["uuid"], export_dir / f"p_{photo['uuid'][:8]}")
        if not exported:
            return None, None
        src_path = exported
    src = Path(src_path)
    if not src.exists():
        return None, None
    jpeg_name = f"{photo['uuid']}.jpg"
    jpeg_path = export_dir / jpeg_name
    try:
        img = Image.open(src)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        if max(img.size) > MAX_IMAGE_DIM:
            ratio = MAX_IMAGE_DIM / max(img.size)
            new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        img.save(jpeg_path, "JPEG", quality=JPEG_QUALITY)
    except Exception:
        if src.suffix.lower() in (".jpg", ".jpeg"):
            shutil.copy2(src, jpeg_path)
        else:
            return None, None
    metadata = {
        "uuid": photo["uuid"],
        "original_filename": photo["original_filename"],
        "date_taken": photo["date_taken"],
        "date_added": photo["date_added"],
        "latitude": photo["latitude"],
        "longitude": photo["longitude"],
    }
    return str(jpeg_path), metadata


def compute_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def upload_to_storage(file_path: str, file_hash: str, user_id: str, url: str, key: str, bucket: str):
    """Upload to Supabase storage. Returns public URL or None."""
    try:
        import requests
    except ImportError:
        return None
    ext = Path(file_path).suffix.lower() or ".jpg"
    storage_name = f"users/{user_id}/auto-sync/{file_hash[:12]}{ext}"
    public_url = f"{url}/storage/v1/object/public/{bucket}/{storage_name}"
    upload_url = f"{url}/storage/v1/object/{bucket}/{storage_name}"
    content_type = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/" + ext.lstrip(".")
    with open(file_path, "rb") as f:
        data = f.read()
    resp = requests.post(
        upload_url,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        data=data,
        timeout=60,
    )
    if resp.status_code in (200, 201) or (resp.status_code in (400, 409) and "Duplicate" in resp.text):
        return public_url
    return None


def insert_vehicle_image(url: str, key: str, user_id: str, vehicle_id: str, file_hash: str, metadata: dict):
    """Insert vehicle_images row via REST API. Returns new row id or None."""
    try:
        import requests
    except ImportError:
        return None
    supabase_url = os.environ.get("VITE_SUPABASE_URL")
    if not supabase_url:
        return None
    payload = {
        "user_id": user_id,
        "vehicle_id": vehicle_id,
        "image_url": url,
        "source": "photo_auto_sync",
        "is_external": False,
        "file_hash": file_hash,
        "filename": metadata.get("original_filename", ""),
        "taken_at": metadata.get("date_taken"),
        "latitude": metadata.get("latitude"),
        "longitude": metadata.get("longitude"),
        "exif_data": {"photos_uuid": metadata.get("uuid")},
        "ai_processing_status": "pending",
        "organization_status": "organized",
    }
    resp = requests.post(
        f"{supabase_url}/rest/v1/vehicle_images",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        json=payload,
        timeout=15,
    )
    if resp.status_code in (200, 201) and resp.json():
        return resp.json()[0].get("id")
    return None


def main():
    import argparse
    p = argparse.ArgumentParser(description="Sync 1983 GMC K2500 BLUE album to vehicle")
    p.add_argument("--limit", type=int, default=0, help="Max photos to upload (0 = all)")
    args = p.parse_args()
    load_env()
    url = os.getenv("VITE_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    user_id = os.getenv("NUKE_USER_ID", "0b9f107a-d124-49de-9ded-94698f63c1c4")
    bucket = "vehicle-data"
    if not url or not key:
        print("Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
        sys.exit(1)

    try:
        import requests
    except ImportError:
        print("pip install requests")
        sys.exit(1)

    photos = get_photos_in_albums()
    if not photos:
        print("No photos found in blue 1983 album(s), or Photos library not found.")
        print(f"  DB: {PHOTOS_DB_PATH}")
        sys.exit(0)

    # Which are already on this vehicle?
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    existing = set()
    try:
        r = requests.get(
            f"{url}/rest/v1/vehicle_images",
            headers=headers,
            params={
                "vehicle_id": f"eq.{TARGET_VEHICLE_ID}",
                "source": "eq.photo_auto_sync",
                "select": "exif_data",
                "limit": 5000,
            },
            timeout=15,
        )
        if r.status_code == 200:
            for row in r.json():
                pu = (row.get("exif_data") or {}).get("photos_uuid")
                if pu:
                    existing.add(pu)
    except Exception as e:
        print(f"Warning: {e}")

    to_process = [p for p in photos if p["uuid"] not in existing]
    if args.limit > 0:
        to_process = to_process[: args.limit]
        print(f"Limit: uploading at most {args.limit} this run.")
    print(f"Photos in blue 1983 album(s): {len(photos)}")
    print(f"Already on vehicle: {len(existing)}. To upload: {len(to_process)}.")

    if not to_process:
        print("Nothing to do. Refresh the vehicle profile to see all images.")
        return

    export_dir = Path(tempfile.mkdtemp(prefix="nuke_blue1983_"))
    uploaded = errors = 0
    try:
        for i, photo in enumerate(to_process):
            if i > 0:
                time.sleep(0.3)
            if (i + 1) % 50 == 0:
                print(f"  ... progress {i + 1}/{len(to_process)} ...", flush=True)
            try:
                jpeg_path, metadata = export_to_jpeg(photo, export_dir)
                if not jpeg_path:
                    errors += 1
                    continue
                file_hash = compute_hash(jpeg_path)
                image_url = upload_to_storage(jpeg_path, file_hash, user_id, url, key, bucket)
                if not image_url:
                    errors += 1
                    Path(jpeg_path).unlink(missing_ok=True)
                    continue
                image_id = insert_vehicle_image(url, key, user_id, TARGET_VEHICLE_ID, file_hash, metadata)
                Path(jpeg_path).unlink(missing_ok=True)
                if image_id:
                    uploaded += 1
                    print(f"  [{uploaded}/{len(to_process)}] {photo['original_filename'][:50]}", flush=True)
                else:
                    errors += 1
            except Exception as e:
                print(f"  Error: {e}")
                errors += 1
    finally:
        try:
            for f in export_dir.iterdir():
                f.unlink(missing_ok=True)
            export_dir.rmdir()
        except Exception:
            pass

    print(f"Done. Uploaded: {uploaded}, errors: {errors}.")
    print("The vehicle profile should now include all blue 1983 Photos (existing + new). Refresh the page.")


if __name__ == "__main__":
    main()
