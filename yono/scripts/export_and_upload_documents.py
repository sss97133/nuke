#!/usr/bin/env python3
"""
Export document photos from Apple Photos → Supabase Storage → document_ocr_queue.

Identifies document-like photos (paper scans, deal jackets, receipts, titles)
from the Photos library, exports full-resolution originals, converts HEIC → JPEG
(preserving full resolution for OCR), uploads to Supabase Storage, and enqueues
for OCR processing.

Usage:
    python3 export_and_upload_documents.py                # Full scan
    python3 export_and_upload_documents.py --limit 50     # Test with 50
    python3 export_and_upload_documents.py --resume       # Resume from cache
    python3 export_and_upload_documents.py --date-range 2026-02-07 2026-02-11  # Specific dates
    python3 export_and_upload_documents.py --dry-run      # Preview without uploading
"""

import os
import sys
import sqlite3
import subprocess
import json
import hashlib
import tempfile
import argparse
import time
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# ─── Config ─────────────────────────────────────────────────────────────────

NUKE_DIR = Path("/Users/skylar/nuke")
PHOTOS_DB = Path.home() / "Pictures" / "Photos Library.photoslibrary" / "database" / "Photos.sqlite"
PHOTOS_ORIGINALS = Path.home() / "Pictures" / "Photos Library.photoslibrary" / "originals"
CACHE_DIR = NUKE_DIR / "yono" / ".document_export_cache"
CACHE_DB = CACHE_DIR / "uploaded.sqlite"

# Supabase config (loaded from .env via dotenvx at runtime)
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
STORAGE_BUCKET = "deal-documents"

# Detection thresholds
MIN_WHITE_PIXEL_RATIO = 0.40  # At least 40% bright pixels for documents
DOC_ASPECT_RATIOS = [(3, 4), (4, 3), (2, 3), (3, 2), (8.5, 11), (11, 8.5)]  # Paper proportions
ASPECT_RATIO_TOLERANCE = 0.15


# ─── Photos Library Access ──────────────────────────────────────────────────

def get_all_photos(date_start=None, date_end=None):
    """Get all photos from Photos library, optionally filtered by date range.

    Returns photos even if originals are in iCloud (path will be None).
    """
    conn = sqlite3.connect(str(PHOTOS_DB))
    cur = conn.cursor()

    query = """
        SELECT
            a.Z_PK,
            a.ZUUID,
            a.ZFILENAME,
            a.ZDIRECTORY,
            datetime(a.ZDATECREATED + 978307200, 'unixepoch') as taken_at,
            a.ZKIND,
            a.ZWIDTH,
            a.ZHEIGHT,
            b.ZORIGINALFILENAME
        FROM ZASSET a
        LEFT JOIN ZADDITIONALASSETATTRIBUTES b ON b.ZASSET = a.Z_PK
        WHERE a.ZTRASHEDSTATE = 0
          AND a.ZKIND = 0
    """
    params = []

    if date_start:
        # CoreData epoch: seconds from 2001-01-01
        ts = (datetime.strptime(date_start, "%Y-%m-%d") - datetime(2001, 1, 1)).total_seconds()
        query += " AND a.ZDATECREATED >= ?"
        params.append(ts)

    if date_end:
        ts = (datetime.strptime(date_end, "%Y-%m-%d") - datetime(2001, 1, 1)).total_seconds()
        query += " AND a.ZDATECREATED <= ?"
        params.append(ts + 86400)  # Include full day

    query += " ORDER BY a.ZDATECREATED DESC"

    cur.execute(query, params)
    results = cur.fetchall()
    conn.close()

    photos = []
    for row in results:
        pk, uuid, filename, directory, taken_at, kind, width, height, orig_filename = row
        if not filename:
            continue

        # Try local path but don't skip if not found (may be in iCloud)
        path = find_photo_path(filename, directory)

        # Original filename from camera (e.g., IMG_7537.HEIC) — used to map AppleScript exports
        orig_stem = orig_filename.rsplit('.', 1)[0] if orig_filename else None

        photos.append({
            'pk': pk,
            'uuid': uuid,
            'filename': filename,
            'orig_stem': orig_stem,
            'path': str(path) if path else None,
            'taken_at': taken_at,
            'width': width or 0,
            'height': height or 0,
        })

    return photos


def find_photo_path(filename, directory):
    """Resolve Photos PK → filesystem path."""
    if not filename:
        return None

    if directory:
        path = PHOTOS_ORIGINALS / directory / filename
        if path.exists():
            return path

    # Search in subdirectories
    for subdir in PHOTOS_ORIGINALS.iterdir():
        if subdir.is_dir():
            path = subdir / filename
            if path.exists():
                return path

    return None


# ─── Document Detection Heuristics ──────────────────────────────────────────

def is_likely_document(photo):
    """Heuristic detection of document-like photos."""
    w = photo['width']
    h = photo['height']

    if w == 0 or h == 0:
        return False, "no_dimensions"

    aspect = max(w, h) / min(w, h)

    # Check aspect ratio against paper proportions
    is_paper_ratio = False
    for pw, ph in DOC_ASPECT_RATIOS:
        target = max(pw, ph) / min(pw, ph)
        if abs(aspect - target) < ASPECT_RATIO_TOLERANCE:
            is_paper_ratio = True
            break

    if not is_paper_ratio:
        return False, "wrong_aspect_ratio"

    # High resolution check (OCR needs good resolution)
    if max(w, h) < 2000:
        return False, "too_low_res"

    return True, "geometry_pass"


def check_brightness(jpeg_path):
    """Check if image has high white pixel ratio (document-like)."""
    try:
        result = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(jpeg_path)],
            capture_output=True, text=True, timeout=10
        )
        # Use ImageMagick if available, otherwise skip brightness check
        result = subprocess.run(
            ["python3", "-c", f"""
from PIL import Image
import numpy as np
img = np.array(Image.open("{jpeg_path}").convert("L"))
bright = (img > 200).mean()
print(f"{{bright:.3f}}")
"""],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            ratio = float(result.stdout.strip())
            return ratio >= MIN_WHITE_PIXEL_RATIO
    except Exception:
        pass

    # If we can't check, assume it passes (false positive is OK)
    return True



# ─── HEIC Conversion ────────────────────────────────────────────────────────

def convert_to_jpeg_fullres(input_path, output_path):
    """Convert HEIC to JPEG preserving full resolution (NO resize for OCR quality)."""
    try:
        subprocess.run([
            "sips", "-s", "format", "jpeg",
            "-s", "formatOptions", "90",
            str(input_path), "--out", str(output_path)
        ], capture_output=True, check=True, timeout=60)
        return True
    except Exception as e:
        print(f"  Conversion failed: {e}")
        return False


# ─── Cache Management ────────────────────────────────────────────────────────

def init_cache():
    """Initialize local SQLite cache for tracking uploaded photos."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(CACHE_DB))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS uploaded (
            pk INTEGER PRIMARY KEY,
            filename TEXT,
            storage_path TEXT,
            deal_document_id TEXT,
            queue_id TEXT,
            uploaded_at TEXT,
            file_hash TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS skipped (
            pk INTEGER PRIMARY KEY,
            filename TEXT,
            reason TEXT,
            checked_at TEXT
        )
    """)
    conn.commit()
    return conn


def get_processed_pks(cache_conn):
    """Get set of already-processed photo PKs."""
    uploaded = set(r[0] for r in cache_conn.execute("SELECT pk FROM uploaded").fetchall())
    skipped = set(r[0] for r in cache_conn.execute("SELECT pk FROM skipped").fetchall())
    return uploaded | skipped


# ─── Supabase Operations ────────────────────────────────────────────────────

def upload_to_storage(file_path, storage_path):
    """Upload file to Supabase Storage."""
    import urllib.request

    with open(file_path, 'rb') as f:
        data = f.read()

    url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{storage_path}"
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
    req.add_header('Content-Type', 'image/jpeg')
    req.add_header('x-upsert', 'true')

    try:
        resp = urllib.request.urlopen(req, timeout=60)
        result = json.loads(resp.read())
        return True, result
    except Exception as e:
        return False, str(e)


def insert_deal_document(storage_path, document_type='unclassified', vehicle_id=None, taken_at=None):
    """Insert record into deal_documents table."""
    import urllib.request

    row = {
        'document_type': document_type,
        'storage_path': storage_path,
        'photo_path': f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/{storage_path}",
        'ocr_data': json.dumps({'status': 'pending', 'queued_at': datetime.utcnow().isoformat()}),
    }
    if vehicle_id:
        row['vehicle_id'] = vehicle_id
    if taken_at:
        row['issue_date'] = taken_at[:10]  # YYYY-MM-DD

    url = f"{SUPABASE_URL}/rest/v1/deal_documents"
    data = json.dumps(row).encode()
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
    req.add_header('apikey', SUPABASE_KEY)
    req.add_header('Content-Type', 'application/json')
    req.add_header('Prefer', 'return=representation')

    try:
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())
        return result[0] if isinstance(result, list) else result
    except Exception as e:
        print(f"  Insert deal_document failed: {e}")
        return None


def enqueue_for_ocr(deal_document_id, storage_path):
    """Insert into document_ocr_queue."""
    import urllib.request

    row = {
        'deal_document_id': deal_document_id,
        'storage_path': storage_path,
        'status': 'pending',
        'priority': 0,
    }

    url = f"{SUPABASE_URL}/rest/v1/document_ocr_queue"
    data = json.dumps(row).encode()
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
    req.add_header('apikey', SUPABASE_KEY)
    req.add_header('Content-Type', 'application/json')
    req.add_header('Prefer', 'return=representation')

    try:
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())
        return result[0] if isinstance(result, list) else result
    except Exception as e:
        print(f"  Enqueue failed: {e}")
        return None


# ─── Main Pipeline ──────────────────────────────────────────────────────────

def process_photo(photo, cache_conn, dry_run=False, tmp_dir=None, exported_files=None):
    """Process a single photo: detect → convert → upload → enqueue.

    Args:
        exported_files: dict mapping UUID → exported file path (from AppleScript batch export)
    """

    # Step 1: Geometry-based document detection
    is_doc, reason = is_likely_document(photo)
    if not is_doc:
        cache_conn.execute(
            "INSERT OR REPLACE INTO skipped VALUES (?, ?, ?, ?)",
            (photo['pk'], photo['filename'], reason, datetime.utcnow().isoformat())
        )
        return None, reason

    if dry_run:
        return {'pk': photo['pk'], 'filename': photo['filename'], 'dry_run': True}, "would_upload"

    # Step 2: Find the source file (local path or AppleScript export)
    src_path = None
    if photo['path']:
        src_path = Path(photo['path'])
    elif exported_files:
        # Photos exports with original camera filename (e.g., IMG_7537), not UUID
        orig_stem = photo.get('orig_stem')
        if orig_stem and orig_stem in exported_files:
            src_path = Path(exported_files[orig_stem])
        elif photo['uuid'] in exported_files:
            src_path = Path(exported_files[photo['uuid']])

    if not src_path or not src_path.exists():
        cache_conn.execute(
            "INSERT OR REPLACE INTO skipped VALUES (?, ?, ?, ?)",
            (photo['pk'], photo['filename'], 'no_local_file', datetime.utcnow().isoformat())
        )
        return None, "no_local_file"

    # Step 3: Convert non-JPEG → JPEG (full resolution)
    needs_conversion = src_path.suffix.lower() in ('.heic', '.heif', '.webp', '.avif', '.tiff', '.tif', '.dng', '.png')

    if needs_conversion:
        jpeg_path = Path(tmp_dir) / f"{photo['pk']}.jpg"
        if not convert_to_jpeg_fullres(src_path, jpeg_path):
            cache_conn.execute(
                "INSERT OR REPLACE INTO skipped VALUES (?, ?, ?, ?)",
                (photo['pk'], photo['filename'], 'conversion_failed', datetime.utcnow().isoformat())
            )
            return None, "conversion_failed"
    elif src_path.suffix.lower() in ('.jpg', '.jpeg'):
        jpeg_path = src_path
    else:
        cache_conn.execute(
            "INSERT OR REPLACE INTO skipped VALUES (?, ?, ?, ?)",
            (photo['pk'], photo['filename'], 'unsupported_format', datetime.utcnow().isoformat())
        )
        return None, "unsupported_format"

    # Step 4: Compute file hash for dedup
    with open(jpeg_path, 'rb') as f:
        file_hash = hashlib.sha256(f.read()).hexdigest()

    # Step 5: Upload to Supabase Storage
    date_prefix = (photo['taken_at'] or 'unknown')[:10].replace('-', '/')
    storage_path = f"documents/{date_prefix}/{photo['pk']}_{photo['filename'].rsplit('.', 1)[0]}.jpg"

    ok, result = upload_to_storage(jpeg_path, storage_path)
    if not ok:
        print(f"  Upload failed for {photo['filename']}: {result}")
        return None, "upload_failed"

    # Step 6: Insert deal_document record
    doc = insert_deal_document(
        storage_path=storage_path,
        taken_at=photo['taken_at']
    )
    deal_doc_id = doc['id'] if doc else None

    # Step 7: Enqueue for OCR
    queue_entry = None
    if deal_doc_id:
        queue_entry = enqueue_for_ocr(deal_doc_id, storage_path)

    # Step 8: Cache the result
    cache_conn.execute(
        "INSERT OR REPLACE INTO uploaded VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            photo['pk'],
            photo['filename'],
            storage_path,
            deal_doc_id,
            queue_entry['id'] if queue_entry else None,
            datetime.utcnow().isoformat(),
            file_hash,
        )
    )

    # Clean up temp file
    if needs_conversion and jpeg_path.exists() and str(jpeg_path).startswith(str(tmp_dir)):
        jpeg_path.unlink()

    return {
        'pk': photo['pk'],
        'filename': photo['filename'],
        'storage_path': storage_path,
        'deal_document_id': deal_doc_id,
        'queue_id': queue_entry['id'] if queue_entry else None,
    }, "uploaded"


def batch_export_icloud_photos(photos_needing_export, export_dir, batch_size=20):
    """Export photos from iCloud via Photos.app AppleScript.

    Args:
        photos_needing_export: list of photo dicts with 'uuid' key
        export_dir: directory to export files to
        batch_size: photos per AppleScript batch

    Returns:
        dict mapping filename_stem → exported file path
    """
    export_dir = Path(export_dir)
    export_dir.mkdir(parents=True, exist_ok=True)

    uuids = [p['uuid'] for p in photos_needing_export if p.get('uuid')]
    if not uuids:
        return {}

    total_batches = (len(uuids) + batch_size - 1) // batch_size
    print(f"\n  Exporting {len(uuids)} photos from iCloud via Photos.app ({total_batches} batches)...")

    for i in range(0, len(uuids), batch_size):
        batch = uuids[i:i + batch_size]
        batch_num = i // batch_size + 1

        # Build AppleScript ID list (Photos uses UUID/L0/001 format)
        id_list = ', '.join(f'"{u}/L0/001"' for u in batch)

        script = f'''
set exportFolder to POSIX file "{export_dir}" as alias
set targetIDs to {{{id_list}}}

tell application "Photos"
    set exported to 0
    repeat with targetID in targetIDs
        try
            set matchingItems to (every media item whose id is targetID)
            if (count of matchingItems) > 0 then
                export matchingItems to exportFolder with using originals
                set exported to exported + 1
            end if
        end try
    end repeat
    return exported
end tell
'''
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=600  # 10 min per batch
            )
            if result.returncode == 0:
                count = result.stdout.strip()
                print(f"    Batch {batch_num}/{total_batches}: exported {count}/{len(batch)}")
            else:
                print(f"    Batch {batch_num}/{total_batches}: AppleScript error: {result.stderr[:200]}")
        except subprocess.TimeoutExpired:
            print(f"    Batch {batch_num}/{total_batches}: timed out (5min)")
        except Exception as e:
            print(f"    Batch {batch_num}/{total_batches}: error: {e}")

    # Build map of filename stem → path for all exported files
    exported_files = {}
    for f in export_dir.iterdir():
        if f.is_file() and f.suffix.lower() in ('.heic', '.heif', '.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff', '.tif', '.dng'):
            # The filename IS the UUID for Photos-managed images
            exported_files[f.stem] = str(f)

    print(f"  Export complete: {len(exported_files)} files available")
    return exported_files


def main():
    parser = argparse.ArgumentParser(description="Export document photos to Supabase")
    parser.add_argument("--limit", type=int, help="Max photos to process")
    parser.add_argument("--resume", action="store_true", help="Skip already-processed photos")
    parser.add_argument("--dry-run", action="store_true", help="Preview without uploading")
    parser.add_argument("--date-range", nargs=2, metavar=("START", "END"),
                        help="Date range YYYY-MM-DD YYYY-MM-DD")
    parser.add_argument("--save-interval", type=int, default=25,
                        help="Save cache every N photos (default: 25)")
    parser.add_argument("--export-batch-size", type=int, default=20,
                        help="Photos per AppleScript export batch (default: 20)")
    args = parser.parse_args()

    # Validate environment
    if not args.dry_run:
        if not SUPABASE_URL or not SUPABASE_KEY:
            print("ERROR: Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
            print("Run with: dotenvx run -- python3 export_and_upload_documents.py")
            sys.exit(1)

    print("=" * 60)
    print("Document Photo Export Pipeline")
    print(f"Started: {datetime.now().isoformat()}")
    if args.dry_run:
        print("MODE: DRY RUN (no uploads)")
    print("=" * 60)

    # Get photos
    date_start = args.date_range[0] if args.date_range else None
    date_end = args.date_range[1] if args.date_range else None

    print(f"\nScanning Photos library...")
    if date_start:
        print(f"  Date filter: {date_start} to {date_end}")

    photos = get_all_photos(date_start, date_end)
    print(f"  Found {len(photos):,} photos total")

    # Initialize cache
    cache_conn = init_cache()

    # Filter already-processed
    if args.resume:
        processed = get_processed_pks(cache_conn)
        before = len(photos)
        photos = [p for p in photos if p['pk'] not in processed]
        print(f"  Skipping {before - len(photos):,} already processed, {len(photos):,} remaining")

    # Apply limit
    if args.limit:
        photos = photos[:args.limit]
        print(f"  Limited to {len(photos):,} photos")

    # Pre-filter by geometry to avoid exporting non-documents from iCloud
    doc_photos = []
    non_doc_count = 0
    for photo in photos:
        is_doc, reason = is_likely_document(photo)
        if is_doc:
            doc_photos.append(photo)
        else:
            non_doc_count += 1
            cache_conn.execute(
                "INSERT OR REPLACE INTO skipped VALUES (?, ?, ?, ?)",
                (photo['pk'], photo['filename'], reason, datetime.utcnow().isoformat())
            )

    print(f"  Document candidates: {len(doc_photos):,} (skipped {non_doc_count:,} non-documents)")
    cache_conn.commit()

    if not doc_photos:
        print("No document photos to process.")
        cache_conn.close()
        return

    # Separate local vs iCloud photos
    local_photos = [p for p in doc_photos if p['path'] is not None]
    icloud_photos = [p for p in doc_photos if p['path'] is None]
    print(f"  Local: {len(local_photos):,} | iCloud: {len(icloud_photos):,}")

    # Process
    stats = defaultdict(int)
    start_time = time.time()
    total_to_process = len(doc_photos)
    processed_count = 0

    with tempfile.TemporaryDirectory(prefix="doc_export_") as tmp_dir:
        # Phase 1: Process locally available photos first (fast)
        if local_photos:
            print(f"\n--- Phase 1: Processing {len(local_photos)} local photos ---")
            for i, photo in enumerate(local_photos):
                result, reason = process_photo(photo, cache_conn, args.dry_run, tmp_dir, {})
                stats[reason] += 1
                processed_count += 1

                if result:
                    stats['success'] += 1
                    if not args.dry_run:
                        print(f"  [{processed_count}/{total_to_process}] {photo['filename']} -> {result.get('storage_path', 'dry_run')}")

                if (i + 1) % args.save_interval == 0:
                    cache_conn.commit()

            cache_conn.commit()
            print(f"  Local phase done: {stats.get('uploaded', 0)} uploaded")

        # Phase 2: Export + process iCloud photos in chunks
        if icloud_photos and not args.dry_run:
            chunk_size = args.export_batch_size
            total_chunks = (len(icloud_photos) + chunk_size - 1) // chunk_size
            print(f"\n--- Phase 2: Processing {len(icloud_photos)} iCloud photos in {total_chunks} chunks of {chunk_size} ---")

            for chunk_idx in range(0, len(icloud_photos), chunk_size):
                chunk = icloud_photos[chunk_idx:chunk_idx + chunk_size]
                chunk_num = chunk_idx // chunk_size + 1

                # Export this chunk from iCloud
                export_dir = Path(tmp_dir) / f"photos_export_{chunk_num}"
                exported_files = batch_export_icloud_photos(
                    chunk, export_dir, batch_size=chunk_size
                )

                # Process the exported chunk
                for photo in chunk:
                    result, reason = process_photo(photo, cache_conn, args.dry_run, tmp_dir, exported_files)
                    stats[reason] += 1
                    processed_count += 1

                    if result:
                        stats['success'] += 1
                        print(f"  [{processed_count}/{total_to_process}] {photo['filename']} -> {result.get('storage_path', 'dry_run')}")

                cache_conn.commit()

                # Clean up exported files to save disk space
                import shutil
                if export_dir.exists():
                    shutil.rmtree(export_dir)

                elapsed = time.time() - start_time
                rate = processed_count / elapsed if elapsed > 0 else 0
                remaining = total_to_process - processed_count
                eta_mins = remaining / rate / 60 if rate > 0 else 0
                print(f"  Chunk {chunk_num}/{total_chunks} done | "
                      f"total uploaded: {stats.get('uploaded', 0)} | "
                      f"elapsed: {elapsed/60:.0f}min | ETA: {eta_mins:.0f}min")
        elif icloud_photos and args.dry_run:
            for photo in icloud_photos:
                stats['would_upload'] += 1
                processed_count += 1

    cache_conn.commit()
    cache_conn.close()

    # Summary
    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print("EXPORT COMPLETE")
    print("=" * 60)
    print(f"Time: {elapsed:.0f}s ({elapsed/60:.1f}min)")
    print(f"Total photos scanned: {len(photos):,}")
    print(f"Document candidates: {len(doc_photos):,}")
    print(f"Uploaded: {stats.get('uploaded', 0):,}")
    if args.dry_run:
        print(f"Would upload: {stats.get('would_upload', 0):,}")
    print(f"\nBreakdown:")
    for reason, count in sorted(stats.items()):
        if reason != 'success':
            print(f"  {reason}: {count:,}")


if __name__ == "__main__":
    main()
