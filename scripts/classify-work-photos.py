#!/usr/bin/env python3
"""
Classify work photos for a vehicle using local Ollama vision model.

Reads unclassified photos from vehicle_images (where work_session_id IS NOT NULL
and area IS NULL), classifies them via llama3.2-vision:11b, and writes back
area, operation, and caption.

Usage:
    cd /Users/skylar/nuke
    dotenvx run -- python3 scripts/classify-work-photos.py --vehicle-id a90c008a-3379-41d8-9eb2-b4eda365d74c
    dotenvx run -- python3 scripts/classify-work-photos.py --vehicle-id a90c008a --limit 10 --dry-run
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error
import re
import subprocess

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL = "llama3.2-vision:11b"

CLASSIFY_PROMPT = """You are classifying a work/build photo from an automotive restoration shop. This photo is from a 1983 GMC K2500 Sierra Classic build project.

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "area": "<one of: undercarriage, engine_bay, exhaust, interior, exterior, wheels_brakes, electrical, suspension, drivetrain, frame, cooling, fuel_system, steering, body, glass, trim, general>",
  "operation": "<one of: fabrication, welding, fitment, disassembly, assembly, painting, inspection, parts_staging, before, after, progress, measurement, cleaning, wiring, plumbing, grinding, cutting, test_fit, mockup>",
  "caption": "<one concise sentence describing what the photo shows, e.g. 'Welding exhaust collector flange to 2.5 inch SS pipe' or 'Rear drum brake hardware disassembled for rebuild'>"
}

RULES:
- area = the vehicle system/zone shown (exhaust, wheels_brakes, engine_bay, etc.)
- operation = what work activity is being documented
- caption = specific one-line description — include part names, sizes, materials when visible
- If you see welding/cutting/grinding/fabrication on metal pipes/tubes → area is likely "exhaust"
- If you see brake drums, wheel cylinders, brake shoes → area is "wheels_brakes"
- If you see shocks, springs, control arms → area is "suspension"
- If you see the truck from outside (full body visible) → area is "exterior"
- If you cannot determine specifics, use area="general" and operation="progress"
- Be specific in the caption — mention the part, the action, and any visible details"""


def get_supabase_config():
    """Get Supabase config from environment (expects dotenvx run --)."""
    url = os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if url and key:
        return {"url": url, "key": key}
    return None


def supabase_query(config, path, method="GET", body=None):
    """Make a Supabase REST API call."""
    headers = {
        "Authorization": f"Bearer {config['key']}",
        "apikey": config["key"],
        "Content-Type": "application/json",
        "Prefer": "return=minimal" if method == "PATCH" else "return=representation",
    }
    url = f"{config['url']}/rest/v1/{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    resp = urllib.request.urlopen(req, timeout=30)
    if method == "PATCH":
        return None
    return json.loads(resp.read().decode("utf-8"))


def fetch_unclassified_photos(config, vehicle_id, limit=500):
    """Fetch photos that need classification."""
    path = (
        f"vehicle_images?vehicle_id=eq.{vehicle_id}"
        f"&work_session_id=not.is.null"
        f"&area=is.null"
        f"&select=id,image_url,taken_at,work_session_id"
        f"&order=taken_at.asc"
        f"&limit={limit}"
    )
    return supabase_query(config, path)


def download_image(url, timeout=30):
    """Download image from URL, return base64."""
    tmp_path = f"/tmp/classify_work_{int(time.time() * 1000)}.jpg"
    try:
        urllib.request.urlretrieve(url, tmp_path)
        with open(tmp_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
        return b64
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


def classify_image(image_b64, timeout=90):
    """Call Ollama vision model to classify a work photo."""
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "You classify automotive work/build photos. Respond ONLY with valid JSON."},
            {
                "role": "user",
                "content": CLASSIFY_PROMPT,
                "images": [image_b64],
            },
        ],
        "stream": False,
        "format": "json",
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_URL, data=data,
        headers={"Content-Type": "application/json"},
    )

    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        result = json.loads(resp.read().decode("utf-8"))
        content = result.get("message", {}).get("content", "")
        parsed = json.loads(content)

        # Validate fields
        valid_areas = {
            "undercarriage", "engine_bay", "exhaust", "interior", "exterior",
            "wheels_brakes", "electrical", "suspension", "drivetrain", "frame",
            "cooling", "fuel_system", "steering", "body", "glass", "trim", "general"
        }
        valid_operations = {
            "fabrication", "welding", "fitment", "disassembly", "assembly",
            "painting", "inspection", "parts_staging", "before", "after",
            "progress", "measurement", "cleaning", "wiring", "plumbing",
            "grinding", "cutting", "test_fit", "mockup"
        }

        area = parsed.get("area", "general")
        if area not in valid_areas:
            area = "general"

        operation = parsed.get("operation", "progress")
        if operation not in valid_operations:
            operation = "progress"

        caption = parsed.get("caption", "")
        if not caption or len(caption) < 5:
            caption = f"{area} - {operation}"

        return {"area": area, "operation": operation, "caption": caption[:500]}

    except json.JSONDecodeError as e:
        return {"area": "general", "operation": "progress", "caption": f"Classification failed: JSON parse error", "error": str(e)}
    except urllib.error.URLError as e:
        return {"area": None, "operation": None, "caption": None, "error": f"Ollama not reachable: {e}"}
    except Exception as e:
        return {"area": None, "operation": None, "caption": None, "error": str(e)}


def update_photo(config, photo_id, classification):
    """Update vehicle_images with classification results."""
    if classification.get("error") and classification["area"] is None:
        return False

    body = {
        "area": classification["area"],
        "operation": classification["operation"],
        "caption": classification["caption"],
    }

    path = f"vehicle_images?id=eq.{photo_id}"
    try:
        supabase_query(config, path, method="PATCH", body=body)
        return True
    except Exception as e:
        print(f"  UPDATE FAILED for {photo_id}: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(description="Classify work photos via Ollama vision")
    parser.add_argument("--vehicle-id", required=True, help="Vehicle UUID (or prefix)")
    parser.add_argument("--limit", type=int, default=500, help="Max photos to process")
    parser.add_argument("--timeout", type=int, default=90, help="Timeout per image (seconds)")
    parser.add_argument("--dry-run", action="store_true", help="Classify but don't write to DB")
    parser.add_argument("--batch-size", type=int, default=10, help="Pause every N images for 1s")
    args = parser.parse_args()

    config = get_supabase_config()
    if not config:
        print("ERROR: Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    # Test Ollama connectivity
    try:
        req = urllib.request.Request("http://localhost:11434/api/tags")
        resp = urllib.request.urlopen(req, timeout=5)
        models = json.loads(resp.read().decode("utf-8"))
        model_names = [m["name"] for m in models.get("models", [])]
        if MODEL not in model_names:
            print(f"WARNING: {MODEL} not found in Ollama. Available: {model_names}", file=sys.stderr)
            # Try to pull it
            print(f"Attempting ollama pull {MODEL}...", file=sys.stderr)
    except Exception as e:
        print(f"ERROR: Ollama not reachable at localhost:11434: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Fetching unclassified photos for vehicle {args.vehicle_id}...")
    photos = fetch_unclassified_photos(config, args.vehicle_id, args.limit)
    print(f"Found {len(photos)} unclassified photos")

    if not photos:
        print("Nothing to classify!")
        return

    stats = {"classified": 0, "errors": 0, "skipped": 0}
    area_counts = {}
    operation_counts = {}

    for i, photo in enumerate(photos):
        photo_id = photo["id"]
        image_url = photo["image_url"]
        taken_at = photo.get("taken_at", "?")

        print(f"  [{i+1}/{len(photos)}] {photo_id[:8]}... taken={taken_at[:10] if taken_at else '?'}", end=" ", flush=True)

        start = time.time()
        try:
            b64 = download_image(image_url)
        except Exception as e:
            print(f"DOWNLOAD FAILED: {e}")
            stats["errors"] += 1
            continue

        result = classify_image(b64, timeout=args.timeout)
        elapsed = time.time() - start

        if result.get("error") and result["area"] is None:
            print(f"ERROR ({elapsed:.1f}s): {result['error']}")
            stats["errors"] += 1
            continue

        area = result["area"]
        operation = result["operation"]
        caption = result["caption"]

        print(f"-> {area}/{operation} ({elapsed:.1f}s) \"{caption[:60]}\"")

        area_counts[area] = area_counts.get(area, 0) + 1
        operation_counts[operation] = operation_counts.get(operation, 0) + 1

        if not args.dry_run:
            if update_photo(config, photo_id, result):
                stats["classified"] += 1
            else:
                stats["errors"] += 1
        else:
            stats["classified"] += 1

        # Throttle: pause every batch_size images
        if (i + 1) % args.batch_size == 0 and i + 1 < len(photos):
            time.sleep(0.5)

    print(f"\n{'='*60}")
    print(f"RESULTS: {stats['classified']} classified, {stats['errors']} errors, {stats['skipped']} skipped")
    print(f"\nArea distribution:")
    for area, count in sorted(area_counts.items(), key=lambda x: -x[1]):
        pct = count / max(1, sum(area_counts.values())) * 100
        print(f"  {area:20s}: {count:4d} ({pct:.0f}%)")
    print(f"\nOperation distribution:")
    for op, count in sorted(operation_counts.items(), key=lambda x: -x[1]):
        pct = count / max(1, sum(operation_counts.values())) * 100
        print(f"  {op:20s}: {count:4d} ({pct:.0f}%)")

    if args.dry_run:
        print("\n[DRY RUN — no database writes were made]")


if __name__ == "__main__":
    main()
