#!/Users/skylar/nuke/yono/.venv/bin/python3
"""
Export labeled training data from Supabase for hierarchical retraining.

Streams vehicle_images records where:
- ai_processing_status IN ('completed', 'complete')
- vehicle.make IS NOT NULL
- image is downloadable

Uses ctid-based physical page range scanning (8000 blocks per batch) which
avoids the statement timeout that kills cursor+sort queries on the 28M-row table.

Output: training-data/images/ as JSONL batches
        .image_cache/ for downloaded images (shared with existing cache)

Usage:
  python scripts/export_supabase_training.py
  python scripts/export_supabase_training.py --resume   # resume from block_offset.txt
"""

import argparse
import asyncio
import json
import hashlib
import os
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

PG_CONN = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

YONO_DIR = Path(__file__).parent.parent
OUTPUT_DIR = NUKE_DIR / "training-data" / "images"
CACHE_DIR = YONO_DIR / ".image_cache"

# Each batch scans BLOCKS_PER_BATCH heap pages.
# With 28M rows across ~2.9M blocks, ~3% match → ~8000 * 9.5 * 0.03 ≈ 2280 rows/batch.
BLOCKS_PER_BATCH = 8000
DOWNLOAD_CONCURRENCY = 40


def cache_path(url: str) -> Path:
    h = hashlib.md5(url.encode()).hexdigest()
    ext = Path(url.split("?")[0]).suffix or ".jpg"
    return CACHE_DIR / f"{h}{ext}"


def _psql(sql: str, timeout: int = 30, statement_ms: int = 25000) -> list:
    """Run a psql COPY query and return rows as dicts."""
    import subprocess, csv, io
    env = os.environ.copy()
    env["PGOPTIONS"] = f"-c statement_timeout={statement_ms}"
    result = subprocess.run(
        ["psql", PG_CONN, "-t"],
        input=sql,
        capture_output=True, text=True, timeout=timeout, env=env,
    )
    if result.returncode != 0:
        err = result.stderr.strip()[:300]
        raise RuntimeError(f"psql error: {err}")
    rows = []
    reader = csv.DictReader(io.StringIO(result.stdout))
    for row in reader:
        rows.append(dict(row))
    return rows


def get_total_blocks() -> int:
    """Query the current heap page count for vehicle_images."""
    rows = _psql(
        "COPY (SELECT relpages FROM pg_class WHERE relname = 'vehicle_images' LIMIT 1) TO STDOUT WITH CSV HEADER;",
        timeout=10, statement_ms=8000,
    )
    return int(rows[0]["relpages"]) if rows else 3_000_000


def fetch_page_ctid(block_start: int, block_end: int) -> list:
    """
    Fetch vehicle_images rows in the physical page range [block_start, block_end).

    ctid-based scans avoid the planner's 28M-row PK index scan and the
    sort required for bitmap scans. Each 8000-page range completes in ~6s.

    Follows with a vehicle lookup to get make/model/year.
    """
    img_sql = f"""
    COPY (
        SELECT id, image_url, vehicle_id
        FROM vehicle_images
        WHERE ctid >= '({block_start},1)'::tid
          AND ctid < '({block_end},1)'::tid
          AND ai_processing_status IN ('completed', 'complete')
          AND vehicle_id IS NOT NULL
          AND image_url IS NOT NULL
    ) TO STDOUT WITH CSV HEADER;
    """
    img_rows = _psql(img_sql, timeout=60, statement_ms=55000)
    if not img_rows:
        return []

    # Batch-lookup vehicle makes, chunked to avoid huge IN clauses
    vehicle_ids = list({r["vehicle_id"] for r in img_rows})
    VEH_CHUNK = 500
    veh_rows_all = []
    for i in range(0, len(vehicle_ids), VEH_CHUNK):
        chunk = vehicle_ids[i:i + VEH_CHUNK]
        id_list = ", ".join(f"'{vid}'" for vid in chunk)
        veh_sql = f"""
    COPY (
        SELECT id, make, model, year
        FROM vehicles
        WHERE id IN ({id_list})
          AND make IS NOT NULL
    ) TO STDOUT WITH CSV HEADER;
        """
        for attempt in range(3):
            try:
                veh_rows_all.extend(_psql(veh_sql, timeout=60, statement_ms=55000))
                break
            except Exception as e:
                if attempt == 2:
                    raise
                import time as _time
                print(f"  Vehicle lookup attempt {attempt+1} failed: {e}, retrying...")
                _time.sleep(2)
    vehicle_map = {r["id"]: r for r in veh_rows_all}

    rows = []
    for img in img_rows:
        vid = img["vehicle_id"]
        veh = vehicle_map.get(vid)
        if not veh:
            continue
        rows.append({
            "id": img["id"],
            "image_url": img["image_url"],
            "vehicle_id": vid,
            "vehicles": {
                "make": veh["make"],
                "model": veh.get("model"),
                "year": int(veh["year"]) if veh.get("year") else None,
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


async def export(resume: bool = False, skip_download: bool = False):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(exist_ok=True)

    # Block-offset cursor for ctid pagination
    offset_file = OUTPUT_DIR / "block_offset.txt"
    existing_batches = sorted(OUTPUT_DIR.glob("batch_*.jsonl"))
    batch_num = len(existing_batches) + 1  # next batch number (1-indexed filenames)
    block_offset = 0

    if resume and offset_file.exists():
        block_offset = int(offset_file.read_text().strip())
        print(f"Resuming from block {block_offset:,} ({len(existing_batches)} batches done)")
    elif existing_batches:
        print(f"Fresh ctid export — {len(existing_batches)} existing batches kept, appending from batch {batch_num:04d}")

    total_blocks = get_total_blocks()
    print(f"vehicle_images: {total_blocks:,} heap blocks, scanning {BLOCKS_PER_BATCH:,} per batch")

    total_exported = 0
    total_downloaded = 0
    total_skipped = 0

    connector = aiohttp.TCPConnector(limit=50)
    async with aiohttp.ClientSession(connector=connector) as session:

        while block_offset < total_blocks:
            block_end = min(block_offset + BLOCKS_PER_BATCH, total_blocks)
            pct = block_offset / total_blocks * 100

            print(f"\nBatch {batch_num} | blocks {block_offset:,}–{block_end:,} ({pct:.1f}%)")
            rows = fetch_page_ctid(block_offset, block_end)

            if not rows:
                block_offset = block_end
                offset_file.write_text(str(block_offset))
                continue

            # Build records + collect download tasks
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

            # Download missing images concurrently (skip if --skip-download)
            if download_tasks and not skip_download:
                print(f"  Downloading {len(download_tasks)} images...")
                sem = asyncio.Semaphore(DOWNLOAD_CONCURRENCY)

                async def bounded_download(url, dest):
                    async with sem:
                        return await download_image(session, url, dest)

                results = await asyncio.gather(*[bounded_download(u, d) for u, d in download_tasks])
                batch_downloaded = sum(results)
                total_downloaded += batch_downloaded
                print(f"  Downloaded {batch_downloaded}/{len(download_tasks)}")
            elif download_tasks:
                total_skipped += len(download_tasks)

            # In metadata-only mode, write all records; otherwise only cached ones.
            if not skip_download:
                records = [r for r in records if Path(r["cache_path"]).exists()]

            # Write JSONL batch
            if records:
                batch_file = OUTPUT_DIR / f"batch_{batch_num:04d}.jsonl"
                async with aiofiles.open(batch_file, "w") as f:
                    for rec in records:
                        await f.write(json.dumps(rec) + "\n")
                print(f"  Wrote {len(records)} records → {batch_file.name}")
                batch_num += 1

            total_exported += len(records)

            # Advance block cursor
            block_offset = block_end
            offset_file.write_text(str(block_offset))

            print(f"  Total so far: {total_exported:,} records, {total_downloaded:,} downloaded")

            # Brief pause to avoid hammering Supabase
            await asyncio.sleep(0.1)

    print(f"\n{'='*50}")
    print(f"EXPORT COMPLETE")
    print(f"  Records: {total_exported:,}")
    print(f"  Downloaded: {total_downloaded:,} new images")
    print(f"  Batches written this run: {batch_num - (len(existing_batches) + 1)}")
    print(f"  Output: {OUTPUT_DIR}")
    print(f"\nNext: python scripts/train_hierarchical.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", action="store_true", help="Resume from block_offset.txt")
    parser.add_argument("--skip-download", action="store_true",
                        help="Write all JSONL metadata without downloading images (metadata-only mode)")
    args = parser.parse_args()

    asyncio.run(export(resume=args.resume, skip_download=args.skip_download))
