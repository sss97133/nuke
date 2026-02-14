#!/usr/bin/env python3
"""
Ollama Photo Classifier — Local AI classification for the photo pipeline.

Replaces the cloud API calls (Anthropic/OpenAI/xAI) with free local inference
using Ollama + llama3.2-vision:11b.

Usage:
    # Classify a single image
    python3 ollama-classify-photo.py --image /path/to/photo.jpg

    # Classify and update Supabase
    python3 ollama-classify-photo.py --image-id <uuid> --update

    # Process all unclassified photos from photo_sync_items
    python3 ollama-classify-photo.py --process-pending --limit 20

    # Classify from URL
    python3 ollama-classify-photo.py --url https://example.com/photo.jpg
"""

import argparse
import base64
import json
import os
import sys
import time
import subprocess
import urllib.request
import urllib.error

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL = "llama3.2-vision:11b"

CLASSIFY_PROMPT = """Analyze this photo for an automotive inventory management system. Respond ONLY with JSON:
{
  "is_automotive": true/false,
  "category": "vehicle_exterior|vehicle_interior|engine_bay|undercarriage|detail_shot|parts|receipt|documentation|shop_environment|progress_shot|not_automotive",
  "confidence": 0.0-1.0,
  "vehicle_hints": {
    "make": "string or null",
    "model": "string or null",
    "year_range": "e.g. 1983 or 1980-1985 or null",
    "color": "string or null",
    "body_style": "truck/sedan/coupe/suv/van/convertible or null"
  },
  "vin_detected": "17-char VIN if visible, else null",
  "text_detected": ["any visible text like part numbers, badges, stock numbers"]
}

RULES:
- Deal jackets, invoices, receipts, repair orders = documentation, is_automotive=true
- Vehicle interiors, parts, shop tools = is_automotive=true
- ONLY is_automotive=false for photos with ZERO vehicle connection"""

ALWAYS_AUTOMOTIVE = {
    "vehicle_exterior", "vehicle_interior", "engine_bay", "undercarriage",
    "detail_shot", "parts", "receipt", "documentation", "shop_environment", "progress_shot",
}


def get_supabase_config():
    """Read Supabase config from .env via dotenvx."""
    import re as _re
    try:
        result = subprocess.run(
            ["dotenvx", "run", "--quiet", "--", "bash", "-c",
             'echo "$VITE_SUPABASE_URL|$SUPABASE_SERVICE_ROLE_KEY"'],
            capture_output=True, text=True, cwd="/Users/skylar/nuke"
        )
        # Strip ANSI escape codes from dotenvx output
        clean = _re.sub(r'\x1b\[[0-9;]*m', '', result.stdout).strip()
        # Find the line with the URL|KEY pattern
        for line in clean.split('\n'):
            line = line.strip()
            if '|' in line and 'supabase' in line.lower():
                parts = line.split("|")
                if len(parts) == 2 and parts[0].startswith('http') and len(parts[1]) > 20:
                    return {"url": parts[0], "key": parts[1]}
    except Exception:
        pass
    return None


def encode_image(path: str) -> str:
    """Read and base64-encode an image file."""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def download_image(url: str) -> str:
    """Download image from URL, save to temp, return path."""
    tmp_path = f"/tmp/ollama_classify_{int(time.time())}.jpg"
    urllib.request.urlretrieve(url, tmp_path)
    return tmp_path


def classify_image(image_b64: str, timeout: int = 60) -> dict:
    """Call Ollama vision model to classify an image."""
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "You classify vehicle photos. Respond ONLY with JSON."},
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
        OLLAMA_URL,
        data=data,
        headers={"Content-Type": "application/json"},
    )

    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        result = json.loads(resp.read().decode("utf-8"))
        content = result.get("message", {}).get("content", "")
        parsed = json.loads(content)

        # Safety net: override is_automotive for known categories
        category = parsed.get("category", "not_automotive")
        if category in ALWAYS_AUTOMOTIVE:
            parsed["is_automotive"] = True

        parsed["_provider"] = "ollama"
        parsed["_model"] = MODEL
        parsed["_classified_at"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        return parsed
    except urllib.error.URLError as e:
        return {"error": f"Ollama not reachable: {e}", "is_automotive": False, "category": "classification_error"}
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON from Ollama: {e}", "is_automotive": False, "category": "classification_error"}
    except Exception as e:
        return {"error": str(e), "is_automotive": False, "category": "classification_error"}


def update_supabase(image_id: str, classification: dict, config: dict):
    """Update photo_sync_items and vehicle_images with classification result."""
    headers = {
        "Authorization": f"Bearer {config['key']}",
        "apikey": config["key"],
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    # Update photo_sync_items
    sync_data = {
        "sync_status": "pending_clarification" if classification.get("is_automotive") else "ignored",
        "is_automotive": classification.get("is_automotive", False),
        "classification_category": classification.get("category"),
        "classification_confidence": classification.get("confidence"),
        "vehicle_hints": classification.get("vehicle_hints"),
        "classified_at": classification.get("_classified_at"),
    }

    url = f"{config['url']}/rest/v1/photo_sync_items?vehicle_image_id=eq.{image_id}"
    data = json.dumps(sync_data).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="PATCH")
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"  WARNING: Failed to update photo_sync_items: {e}", file=sys.stderr)

    # Update vehicle_images
    img_data = {
        "category": classification.get("category"),
        "ai_processing_status": "completed",
        "organization_status": "organized" if classification.get("is_automotive") else "ignored",
    }
    if classification.get("vehicle_hints", {}).get("make"):
        hints = classification["vehicle_hints"]
        img_data["ai_detected_vehicle"] = json.dumps(
            f"{hints.get('year_range', '')} {hints.get('make', '')} {hints.get('model', '')}".strip()
        )

    url = f"{config['url']}/rest/v1/vehicle_images?id=eq.{image_id}"
    data = json.dumps(img_data).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="PATCH")
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"  WARNING: Failed to update vehicle_images: {e}", file=sys.stderr)


def get_pending_items(config: dict, limit: int = 20) -> list:
    """Fetch unclassified items from photo_sync_items."""
    headers = {
        "Authorization": f"Bearer {config['key']}",
        "apikey": config["key"],
    }
    url = (
        f"{config['url']}/rest/v1/photo_sync_items"
        f"?sync_status=eq.uploaded&order=detected_at.desc&limit={limit}"
        f"&select=id,vehicle_image_id,storage_url"
    )
    req = urllib.request.Request(url, headers=headers)
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="Ollama Photo Classifier")
    parser.add_argument("--image", help="Path to local image file")
    parser.add_argument("--url", help="URL to image")
    parser.add_argument("--image-id", help="vehicle_images UUID")
    parser.add_argument("--update", action="store_true", help="Update Supabase with results")
    parser.add_argument("--process-pending", action="store_true", help="Process all pending uploads")
    parser.add_argument("--limit", type=int, default=20, help="Max items to process")
    parser.add_argument("--timeout", type=int, default=60, help="Timeout per image in seconds")
    args = parser.parse_args()

    config = None
    if args.update or args.process_pending:
        config = get_supabase_config()
        if not config:
            print("ERROR: Could not read Supabase config from .env", file=sys.stderr)
            sys.exit(1)

    if args.process_pending:
        items = get_pending_items(config, args.limit)
        if not items:
            print("No pending items to process.")
            return

        print(f"Processing {len(items)} pending items...")
        results = {"classified": 0, "automotive": 0, "ignored": 0, "errors": 0}

        for item in items:
            image_id = item["vehicle_image_id"]
            storage_url = item.get("storage_url")
            if not storage_url:
                print(f"  SKIP {image_id}: no storage_url")
                continue

            print(f"  Classifying {image_id}...", end=" ", flush=True)
            start = time.time()

            try:
                tmp_path = download_image(storage_url)
                b64 = encode_image(tmp_path)
                result = classify_image(b64, timeout=args.timeout)
                elapsed = time.time() - start

                if "error" in result:
                    print(f"ERROR ({elapsed:.1f}s): {result['error']}")
                    results["errors"] += 1
                    continue

                category = result.get("category", "?")
                is_auto = result.get("is_automotive", False)
                conf = result.get("confidence", 0)
                print(f"{category} ({conf:.0%}) {'✓' if is_auto else '✗'} [{elapsed:.1f}s]")

                results["classified"] += 1
                if is_auto:
                    results["automotive"] += 1
                else:
                    results["ignored"] += 1

                if args.update or args.process_pending:
                    update_supabase(image_id, result, config)

                # Clean up temp file
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

            except Exception as e:
                print(f"ERROR: {e}")
                results["errors"] += 1

        print(f"\nDone: {results['classified']} classified, {results['automotive']} automotive, "
              f"{results['ignored']} ignored, {results['errors']} errors")
        return

    # Single image mode
    if args.image:
        b64 = encode_image(args.image)
    elif args.url:
        tmp = download_image(args.url)
        b64 = encode_image(tmp)
    else:
        parser.print_help()
        return

    start = time.time()
    result = classify_image(b64, timeout=args.timeout)
    elapsed = time.time() - start

    print(json.dumps(result, indent=2))
    print(f"\n[{elapsed:.1f}s, provider: {result.get('_provider', '?')}]", file=sys.stderr)

    if args.update and args.image_id and config:
        update_supabase(args.image_id, result, config)
        print(f"Updated Supabase for {args.image_id}", file=sys.stderr)


if __name__ == "__main__":
    main()
