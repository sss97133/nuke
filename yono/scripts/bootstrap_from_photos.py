#!/usr/bin/env python3
"""
Bootstrap YONO Training Data from Photos Library

Uses Claude to classify a sample of photos, then exports as training data.
Run this once to generate initial labels, then train YONO to take over.

Usage:
  python bootstrap_from_photos.py --sample 200    # Classify 200 random photos
  python bootstrap_from_photos.py --date 2024-01  # Classify photos from Jan 2024
"""

import os
import sys
import sqlite3
import argparse
import subprocess
import tempfile
import json
import base64
import random
from pathlib import Path
from datetime import datetime

# Config
NUKE_DIR = Path("/Users/skylar/nuke")
YONO_DIR = NUKE_DIR / "yono"
PHOTOS_DB = Path.home() / "Pictures" / "Photos Library.photoslibrary" / "database" / "Photos.sqlite"
IMAGE_CACHE = YONO_DIR / ".image_cache"

for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    key, _, val = line.partition("=")
    os.environ.setdefault(key.strip(), val.strip('"').strip("'"))

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Vehicle hints to class mapping (expand as needed)
VEHICLE_HINTS = {
    "c10": "c10_1983",
    "silverado": "c10_1983",
    "cheyenne": "c10_1983",
    "1983 chevy": "c10_1983",
    "blue truck": "c10_1983",
    "blazer": "blazer_1977",
    "k5": "blazer_1977",
    "1977": "blazer_1977",
    "k10": "k10_1979_dad",  # Will need disambiguation
    "delorean": "delorean_dmc12",
    "dmc": "delorean_dmc12",
}


def get_photos_from_library(sample_size=100, date_filter=None):
    """Get photo paths from Apple Photos library"""
    conn = sqlite3.connect(str(PHOTOS_DB))
    cur = conn.cursor()

    # Query photos with file paths
    query = """
    SELECT
        ZASSET.Z_PK,
        datetime(ZDATECREATED + 978307200, 'unixepoch') as taken_at,
        ZASSET.ZFILENAME,
        ZASSET.ZDIRECTORY
    FROM ZASSET
    WHERE ZTRASHEDSTATE = 0
    AND ZKIND = 0  -- Photos only (not videos)
    AND ZFILENAME LIKE '%.heic' OR ZFILENAME LIKE '%.jpg' OR ZFILENAME LIKE '%.jpeg'
    """

    if date_filter:
        query += f" AND taken_at LIKE '{date_filter}%'"

    query += " ORDER BY RANDOM()"
    query += f" LIMIT {sample_size}"

    cur.execute(query)
    photos = cur.fetchall()
    conn.close()

    return photos


def convert_heic_to_jpeg(heic_path, output_path):
    """Convert HEIC to JPEG using sips"""
    try:
        subprocess.run([
            "sips", "-s", "format", "jpeg",
            str(heic_path), "--out", str(output_path)
        ], capture_output=True, check=True)
        return True
    except:
        return False


def get_photo_path(photo_row):
    """Get the full path to a photo file"""
    pk, taken_at, filename, directory = photo_row

    # Photos library structure
    photos_base = Path.home() / "Pictures" / "Photos Library.photoslibrary" / "originals"

    # Try different path patterns
    possible_paths = [
        photos_base / directory / filename,
        photos_base / filename,
    ]

    for path in possible_paths:
        if path.exists():
            return path

    # Search in originals
    for subdir in photos_base.iterdir():
        if subdir.is_dir():
            candidate = subdir / filename
            if candidate.exists():
                return candidate

    return None


def classify_with_claude(image_path):
    """Use Claude to classify a photo"""
    import anthropic

    client = anthropic.Anthropic()

    # Convert HEIC if needed
    if str(image_path).lower().endswith('.heic'):
        jpeg_path = IMAGE_CACHE / f"{image_path.stem}.jpg"
        jpeg_path.parent.mkdir(parents=True, exist_ok=True)

        if jpeg_path.exists():
            image_path = jpeg_path
        elif convert_heic_to_jpeg(image_path, jpeg_path):
            image_path = jpeg_path
        else:
            return None

    # Read and encode image
    with open(image_path, "rb") as f:
        image_data = f.read()

    # Resize if too large
    if len(image_data) > 4_000_000:  # 4MB limit
        import subprocess
        temp_path = IMAGE_CACHE / f"temp_{image_path.name}"
        subprocess.run([
            "sips", "-Z", "1024", str(image_path), "--out", str(temp_path)
        ], capture_output=True)
        if temp_path.exists():
            with open(temp_path, "rb") as f:
                image_data = f.read()
            temp_path.unlink()

    b64 = base64.standard_b64encode(image_data).decode("utf-8")
    media_type = "image/jpeg"

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=512,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": media_type, "data": b64}
                },
                {
                    "type": "text",
                    "text": """Classify this photo. Is it automotive-related?

Known vehicles to identify:
- 1983 Chevy C10 Silverado (blue, square body truck)
- 1977 K5 Blazer
- 1979 Chevy K10 (multiple)
- DeLorean DMC-12 (stainless steel)

Return JSON only:
{
  "is_automotive": true/false,
  "class": "c10_1983|blazer_1977|k10_1979_dad|delorean_dmc12|unknown_vehicle|not_vehicle",
  "confidence": 0.0-1.0,
  "vehicle_description": "brief description if automotive"
}"""
                }
            ]
        }]
    )

    text = response.content[0].text
    match = text[text.find("{"):text.rfind("}")+1]
    if match:
        return json.loads(match)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=50, help="Number of photos to classify")
    parser.add_argument("--date", type=str, help="Filter by date (e.g., 2024-01)")
    parser.add_argument("--dry-run", action="store_true", help="Show photos without classifying")
    args = parser.parse_args()

    print(f"Bootstrapping YONO from Photos library...")
    print(f"  Sample size: {args.sample}")
    print(f"  Date filter: {args.date or 'none'}")
    print()

    # Get photos
    photos = get_photos_from_library(args.sample * 3, args.date)  # Oversample to handle failures
    print(f"Found {len(photos)} candidate photos\n")

    if args.dry_run:
        for photo in photos[:10]:
            path = get_photo_path(photo)
            print(f"  {photo[2]}: {path}")
        return

    IMAGE_CACHE.mkdir(parents=True, exist_ok=True)

    # Classify photos
    results = {
        "c10_1983": [],
        "blazer_1977": [],
        "k10_1979_dad": [],
        "delorean_dmc12": [],
        "unknown_vehicle": [],
        "not_vehicle": []
    }

    classified = 0
    for i, photo in enumerate(photos):
        if classified >= args.sample:
            break

        path = get_photo_path(photo)
        if not path:
            continue

        print(f"[{classified+1}/{args.sample}] {photo[2][:40]}...", end=" ", flush=True)

        try:
            result = classify_with_claude(path)
            if result:
                cls = result.get("class", "not_vehicle")
                conf = result.get("confidence", 0)

                if cls in results:
                    results[cls].append({
                        "photo_id": photo[0],
                        "path": str(path),
                        "taken_at": photo[1],
                        "confidence": conf
                    })
                    classified += 1
                    print(f"→ {cls} ({conf:.0%})")
                else:
                    print(f"→ {cls} (unknown class)")
            else:
                print("→ failed")
        except Exception as e:
            print(f"→ error: {e}")

    # Summary
    print(f"\n{'='*50}")
    print("Classification Summary:")
    print(f"{'='*50}")

    automotive = 0
    for cls, items in results.items():
        count = len(items)
        if cls != "not_vehicle":
            automotive += count
        print(f"  {cls}: {count}")

    print(f"\nTotal automotive: {automotive}")
    print(f"Non-automotive: {len(results['not_vehicle'])}")

    # Save to training data
    output_file = YONO_DIR / "bootstrap_data.json"
    with open(output_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to: {output_file}")

    print("\nNext steps:")
    print("  1. Review bootstrap_data.json and correct any errors")
    print("  2. Run: python export_training_data.py")
    print("  3. Run: python train_yono.py")


if __name__ == "__main__":
    main()
