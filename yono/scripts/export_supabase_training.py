#!/usr/bin/env python3
"""
Export labeled training data from Supabase for hierarchical retraining.

Streams vehicle_images records where:
- ai_processing_status IN ('completed', 'complete')
- vehicle.make IS NOT NULL
- image is downloadable

Output: training-data/supabase_images/ as JSONL batches
        .image_cache/ for downloaded images (shared with existing cache)

Usage:
  python scripts/export_supabase_training.py
  python scripts/export_supabase_training.py --limit 50000
  python scripts/export_supabase_training.py --resume   # skip already-exported
"""

import argparse
import asyncio
import json
import hashlib
import os
import sys
import time
from pathlib import Path

import aiohttp
import aiofiles

# Load env
NUKE_DIR = Path(__file__).parent.parent.parent
for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

SUPABASE_URL = os.environ["VITE_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
PG_CONN = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"

YONO_DIR = Path(__file__).parent.parent
OUTPUT_DIR = NUKE_DIR / "training-data" / "images"
CACHE_DIR = YONO_DIR / ".image_cache"
BATCH_SIZE = 2000
DOWNLOAD_CONCURRENCY = 40


def cache_path(url: str) -> Path:
    h = hashlib.md5(url.encode()).hexdigest()
    ext = Path(url.split("?")[0]).suffix or ".jpg"
    return CACHE_DIR / f"{h}{ext}"


def fetch_page_psql(after_id: str, limit: int) -> list:
    """
    Fetch page via cursor-based pagination (after_id) instead of OFFSET.
    Uses WHERE vi.id > after_id so the query hits the primary key index —
    no full-table scans, no statement timeouts regardless of position.
    Pass after_id='' to start from the beginning.
    """
    import subprocess, csv, io
    id_clause = f"AND vi.id > '{after_id}'" if after_id else ""
    sql = f"""
    COPY (
        SELECT vi.id, vi.image_url, vi.vehicle_id, v.make, v.model, v.year
        FROM vehicle_images vi
        JOIN vehicles v ON v.id = vi.vehicle_id
        WHERE vi.ai_processing_status IN ('completed', 'complete')
          AND vi.vehicle_id IS NOT NULL
          AND vi.image_url IS NOT NULL
          AND v.make IS NOT NULL
          {id_clause}
        ORDER BY vi.id
        LIMIT {limit}
    ) TO STDOUT WITH CSV HEADER;
    """
    result = subprocess.run(
        ["psql", PG_CONN, "-t", "-c", sql],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:200]}")
        return []
    rows = []
    reader = csv.DictReader(io.StringIO(result.stdout))
    for row in reader:
        rows.append({
            "id": row["id"],
            "image_url": row["image_url"],
            "vehicle_id": row["vehicle_id"],
            "vehicles": {
                "make": row["make"],
                "model": row.get("model"),
                "year": int(row["year"]) if row.get("year") else None,
            },
        })
    return rows


async def download_image(session: aiohttp.ClientSession, url: str, dest: Path) -> bool:
    """Download image to cache if not already cached."""
    if dest.exists():
        return True
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as r:
            if r.status != 200:
                return False
            async with aiofiles.open(dest, "wb") as f:
                await f.write(await r.read())
        return True
    except Exception:
        return False


async def export(limit: int = None, resume: bool = False):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(exist_ok=True)

    # Cursor-based resume: read last_id from a cursor file instead of counting batches
    cursor_file = OUTPUT_DIR / "last_id.txt"
    existing_batches = sorted(OUTPUT_DIR.glob("batch_*.jsonl"))
    batch_num = len(existing_batches) if resume else 0
    last_id = ""

    if resume and cursor_file.exists():
        last_id = cursor_file.read_text().strip()
        print(f"Resuming from last_id={last_id!r} ({batch_num} batches done)")
    elif resume and existing_batches:
        # Legacy: no cursor file, read last id from last batch
        with open(existing_batches[-1]) as f:
            lines = [l for l in f if l.strip()]
            if lines:
                import json as _json
                last_id = _json.loads(lines[-1]).get("id", "")
        print(f"Resuming (legacy) from last_id={last_id!r} ({batch_num} batches done)")

    total_exported = batch_num * BATCH_SIZE
    total_downloaded = 0
    total_skipped = 0

    connector = aiohttp.TCPConnector(limit=50)
    async with aiohttp.ClientSession(connector=connector) as session:
        fetched_so_far = 0

        while True:
            fetch_limit = min(BATCH_SIZE, (limit - fetched_so_far) if limit else BATCH_SIZE)
            if fetch_limit <= 0:
                break

            print(f"\nFetching batch {batch_num+1} (after_id={last_id!r})...")
            rows = fetch_page_psql(last_id, fetch_limit)

            if not rows:
                print("No more rows.")
                break

            # Build records + download images
            records = []
            download_tasks = []

            for row in rows:
                vehicle = row.get("vehicles") or {}
                make = vehicle.get("make")
                if not make:
                    continue

                url = row.get("image_url", "")
                if not url:
                    continue

                dest = cache_path(url)
                record = {
                    "id": row["id"],
                    "image_url": url,
                    "cache_path": str(dest),
                    "vehicle_id": row.get("vehicle_id"),
                    "make": make,
                    "model": vehicle.get("model"),
                    "year": vehicle.get("year"),
                }
                records.append(record)
                if not dest.exists():
                    download_tasks.append((url, dest))

            # Download missing images concurrently
            if download_tasks:
                print(f"  Downloading {len(download_tasks)} images...")
                sem = asyncio.Semaphore(DOWNLOAD_CONCURRENCY)

                async def bounded_download(url, dest):
                    async with sem:
                        return await download_image(session, url, dest)

                results = await asyncio.gather(*[bounded_download(u, d) for u, d in download_tasks])
                batch_downloaded = sum(results)
                total_downloaded += batch_downloaded
                print(f"  Downloaded {batch_downloaded}/{len(download_tasks)}")
            else:
                total_skipped += len(records)

            # Filter to only records with cached images
            records = [r for r in records if Path(r["cache_path"]).exists()]

            # Write JSONL batch
            if records:
                batch_file = OUTPUT_DIR / f"batch_{batch_num:04d}.jsonl"
                async with aiofiles.open(batch_file, "w") as f:
                    for rec in records:
                        await f.write(json.dumps(rec) + "\n")
                print(f"  Wrote {len(records)} records → {batch_file.name}")

            total_exported += len(records)
            fetched_so_far += len(rows)
            batch_num += 1

            # Advance cursor to last row's id
            if rows:
                last_id = rows[-1]["id"]
                cursor_file.write_text(last_id)

            print(f"  Total so far: {total_exported:,} records, {total_downloaded:,} downloaded")

            if len(rows) < BATCH_SIZE:
                break

            # Brief pause to avoid hammering Supabase
            await asyncio.sleep(0.2)

    print(f"\n{'='*50}")
    print(f"EXPORT COMPLETE")
    print(f"  Records: {total_exported:,}")
    print(f"  Downloaded: {total_downloaded:,} new images")
    print(f"  Batches: {batch_num}")
    print(f"  Output: {OUTPUT_DIR}")
    print(f"\nNext: python scripts/train_hierarchical.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, help="Max records to export")
    parser.add_argument("--resume", action="store_true", help="Resume from last batch")
    args = parser.parse_args()

    asyncio.run(export(limit=args.limit, resume=args.resume))
