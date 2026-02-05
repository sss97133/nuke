#!/usr/bin/env python3
"""
Upload photos to Supabase Storage for cloud processing
Usage: python upload_to_cloud.py photo.jpg
       python upload_to_cloud.py /path/to/folder/
"""

import os
import sys
import hashlib
import requests
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

# Config
NUKE_DIR = Path("/Users/skylar/nuke")
for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    key, _, val = line.partition("=")
    os.environ.setdefault(key.strip(), val.strip('"').strip("'"))

SUPABASE_URL = os.environ["VITE_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
USER_ID = "13450c45-3e8b-4124-9f5b-5c512094ff04"
BUCKET = "vehicle-photos"

EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".webp"}

def get_file_hash(path):
    """Quick hash for dedup"""
    h = hashlib.md5()
    with open(path, "rb") as f:
        h.update(f.read(8192))  # First 8KB
    return h.hexdigest()[:12]

def upload_photo(path):
    """Upload single photo to Supabase Storage, queue for processing"""
    path = Path(path)
    if not path.exists():
        return False, "not found"

    # Generate unique path: user_id/YYYY-MM/hash_filename
    file_hash = get_file_hash(path)
    date_prefix = datetime.now().strftime("%Y-%m")
    storage_path = f"{USER_ID}/{date_prefix}/{file_hash}_{path.name}"

    # Read file
    with open(path, "rb") as f:
        file_bytes = f.read()

    # Upload to storage
    resp = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{storage_path}",
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
            "Content-Type": "application/octet-stream",
            "x-upsert": "true"
        },
        data=file_bytes,
        timeout=60
    )

    if resp.status_code not in (200, 201):
        return False, f"upload failed: {resp.status_code}"

    # Get public URL
    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{storage_path}"

    # Queue for processing
    queue_resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/photo_inbox",
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        json={
            "user_id": USER_ID,
            "image_data": public_url,
            "source": "cloud_upload",
            "notes": str(path)  # Original path for reference
        },
        timeout=10
    )

    if queue_resp.status_code in (200, 201):
        return True, public_url
    return True, f"uploaded but queue failed: {queue_resp.status_code}"

def main():
    if len(sys.argv) < 2:
        print("Usage: python upload_to_cloud.py <photo(s) or folder>")
        sys.exit(1)

    # Gather files
    files = []
    for arg in sys.argv[1:]:
        p = Path(arg).expanduser()
        if p.is_dir():
            for ext in EXTENSIONS:
                files.extend(p.glob(f"*{ext}"))
                files.extend(p.glob(f"*{ext.upper()}"))
        elif p.exists() and p.suffix.lower() in EXTENSIONS:
            files.append(p)

    if not files:
        print("No images found")
        sys.exit(1)

    print(f"Uploading {len(files)} photos to cloud...\n")

    # Parallel upload
    ok = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(upload_photo, f): f for f in files}

        for future in as_completed(futures):
            path = futures[future]
            success, msg = future.result()
            if success:
                ok += 1
                print(f"  ✓ {path.name}")
            else:
                failed += 1
                print(f"  ✗ {path.name}: {msg}")

    print(f"\nDone: {ok} uploaded, {failed} failed")
    print(f"Photos queued for cloud processing.")

if __name__ == "__main__":
    main()
