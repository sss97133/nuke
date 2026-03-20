"""
Phase 0: Metadata harvest via osxphotos subprocess.

Calls system Python 3.13 (which has osxphotos 0.75.1) via subprocess.
Outputs NDJSON to stdout, parsed line-by-line into SQLite photos table.
After this phase, system Python is never called again.
"""

import json
import subprocess
import sys
import time
from pathlib import Path

from .db import get_db, upsert_photos_batch, count, log_run

SYSTEM_PYTHON = "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"

# Inline script executed by system Python — extracts photo metadata as NDJSON
HARVEST_SCRIPT = '''
import json, sys
try:
    import osxphotos
except ImportError:
    print("ERROR: osxphotos not installed in system Python", file=sys.stderr)
    sys.exit(1)

library_path = sys.argv[1] if len(sys.argv) > 1 else None
db = osxphotos.PhotosDB(dbfile=library_path) if library_path else osxphotos.PhotosDB()

for p in db.photos():
    # Skip videos
    if p.ismovie:
        continue

    # Extract place info
    place = None
    if p.place:
        pi = p.place
        place = {
            "name": getattr(pi, "name", None),
            "address_str": str(pi.address) if hasattr(pi, "address") else None,
        }

    # Extract score
    score_overall = None
    if hasattr(p, "score") and p.score:
        score_overall = p.score.overall

    row = {
        "uuid": p.uuid,
        "filename": p.filename,
        "original_filename": p.original_filename,
        "date": p.date.isoformat() if p.date else None,
        "latitude": p.latitude,
        "longitude": p.longitude,
        "labels": p.labels if p.labels else [],
        "ai_caption": None,
        "score_overall": score_overall,
        "albums": [a.title for a in p.album_info] if p.album_info else [],
        "path": str(p.path) if p.path else None,
        "ismissing": 1 if p.ismissing else 0,
        "height": p.height,
        "width": p.width,
        "place": place,
    }
    print(json.dumps(row), flush=True)
'''


def harvest(library_path: str = None, fresh: bool = False, on_progress=None) -> int:
    """
    Run osxphotos harvest via subprocess.

    Args:
        library_path: Override Photos library path (auto-detected if None)
        fresh: If True, clear existing photos table first
        on_progress: Callback(count, total_estimate) for progress updates

    Returns:
        Number of photos harvested
    """
    db = get_db()
    t0 = time.time()

    if fresh:
        db.execute("DELETE FROM photos")
        db.commit()

    existing = count(db, "photos")
    if existing > 0 and not fresh:
        if on_progress:
            on_progress(existing, existing)
        print(f"  Harvest: {existing} photos already cached (use --fresh to re-harvest)")
        return existing

    # Build subprocess command
    cmd = [SYSTEM_PYTHON, "-c", HARVEST_SCRIPT]
    if library_path:
        cmd.append(library_path)

    print(f"  Harvesting photos via osxphotos (system Python 3.13)...")
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    harvested = 0
    batch = []
    BATCH_SIZE = 500

    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue

        # Serialize complex fields to JSON strings for SQLite
        photo_row = {
            "uuid": row["uuid"],
            "filename": row.get("filename"),
            "original_filename": row.get("original_filename"),
            "date": row.get("date"),
            "latitude": row.get("latitude"),
            "longitude": row.get("longitude"),
            "labels": json.dumps(row.get("labels", [])),
            "ai_caption": row.get("ai_caption"),
            "score_overall": row.get("score_overall"),
            "albums": json.dumps(row.get("albums", [])),
            "path": row.get("path"),
            "ismissing": row.get("ismissing", 0),
            "height": row.get("height"),
            "width": row.get("width"),
            "place": json.dumps(row.get("place")) if row.get("place") else None,
        }

        batch.append(photo_row)
        harvested += 1

        if len(batch) >= BATCH_SIZE:
            upsert_photos_batch(db, batch)
            batch = []
            if on_progress:
                on_progress(harvested, 90000)  # estimate
            if harvested % 5000 == 0:
                print(f"    {harvested} photos...", flush=True)

    # Flush remaining
    if batch:
        upsert_photos_batch(db, batch)

    proc.wait()
    stderr = proc.stderr.read()
    if proc.returncode != 0 and harvested == 0:
        print(f"  osxphotos error: {stderr[:500]}", file=sys.stderr)

    duration = time.time() - t0
    log_run(db, "harvest", 0, harvested, duration)
    if on_progress:
        on_progress(harvested, harvested)
    print(f"  Harvest complete: {harvested} photos in {duration:.1f}s")
    db.close()
    return harvested
