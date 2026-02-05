#!/usr/bin/env python3
"""
Download images from training data for local training.

This pre-downloads images so training doesn't need network access.

Usage:
    python download_images.py --data-dir ../training-data/images --output-dir .image_cache
    python download_images.py --limit 10000  # Download first 10K only
"""

import argparse
import asyncio
import aiohttp
import aiofiles
import hashlib
from pathlib import Path
from typing import Optional
import json

from tqdm.asyncio import tqdm_asyncio


async def download_image(
    session: aiohttp.ClientSession,
    url: str,
    output_dir: Path,
    semaphore: asyncio.Semaphore,
) -> Optional[str]:
    """Download a single image"""
    url_hash = hashlib.md5(url.encode()).hexdigest()
    ext = Path(url.split('?')[0]).suffix or '.jpg'
    output_path = output_dir / f"{url_hash}{ext}"

    # Skip if already exists
    if output_path.exists():
        return str(output_path)

    async with semaphore:
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status == 200:
                    data = await resp.read()
                    async with aiofiles.open(output_path, 'wb') as f:
                        await f.write(data)
                    return str(output_path)
        except Exception as e:
            pass  # Silent fail for individual images

    return None


async def download_all(
    data_dir: Path,
    output_dir: Path,
    limit: Optional[int] = None,
    concurrency: int = 50,
):
    """Download all images from JSONL files"""
    output_dir.mkdir(parents=True, exist_ok=True)

    # Collect all URLs
    urls = []
    for jsonl_file in sorted(data_dir.glob("*.jsonl")):
        with open(jsonl_file) as f:
            for line in f:
                if line.strip():
                    record = json.loads(line)
                    url = record.get('image_url')
                    if url:
                        urls.append(url)

        if limit and len(urls) >= limit:
            urls = urls[:limit]
            break

    print(f"Downloading {len(urls)} images to {output_dir}")

    # Download with concurrency limit
    semaphore = asyncio.Semaphore(concurrency)
    connector = aiohttp.TCPConnector(limit=concurrency)

    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [
            download_image(session, url, output_dir, semaphore)
            for url in urls
        ]

        results = await tqdm_asyncio.gather(*tasks, desc="Downloading")

    # Count successes
    success = sum(1 for r in results if r is not None)
    print(f"\nDownloaded: {success}/{len(urls)} ({success/len(urls)*100:.1f}%)")

    # Report size
    total_size = sum(f.stat().st_size for f in output_dir.glob("*") if f.is_file())
    print(f"Total size: {total_size / 1024 / 1024 / 1024:.2f} GB")


def main():
    parser = argparse.ArgumentParser(description="Download training images")
    parser.add_argument("--data-dir", type=Path, default=Path("/Users/skylar/nuke/training-data/images"))
    parser.add_argument("--output-dir", type=Path, default=Path("/Users/skylar/nuke/yono/.image_cache"))
    parser.add_argument("--limit", type=int, help="Limit number of images to download")
    parser.add_argument("--concurrency", type=int, default=50, help="Number of concurrent downloads")
    args = parser.parse_args()

    asyncio.run(download_all(
        data_dir=args.data_dir,
        output_dir=args.output_dir,
        limit=args.limit,
        concurrency=args.concurrency,
    ))


if __name__ == "__main__":
    main()
