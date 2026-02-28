#!/Users/skylar/nuke/yono/.venv/bin/python3
"""
YONO Fabrication Stage Auto-Labeler — Label vehicle images with fabrication stage using Claude Haiku vision.

Queries vehicle_images from Supabase where vehicle_zone IS NOT NULL, downloads each,
sends to claude-haiku-4-5 vision API for fabrication stage classification.
Writes labels to yono/training_labels/stage_labels.jsonl.

10-Stage Taxonomy (visually distinct):
  raw → disassembled → stripped → fabricated → primed → blocked → basecoated → clearcoated → assembled → complete

These stages represent the physical progression of vehicle restoration/fabrication work.

Cost estimate: 5000 images × ~600 input tokens × $0.001/1K = ~$3.00 input
              + ~150 output tokens × $0.005/1K = ~$3.75 output = ~$6.75 total

Usage:
    python scripts/auto_label_stages.py
    python scripts/auto_label_stages.py --sample 500       # smaller test run
    python scripts/auto_label_stages.py --workers 5        # parallel workers (default 3)
    python scripts/auto_label_stages.py --dry-run           # query only, no API calls
    python scripts/auto_label_stages.py --from-cache        # use local .image_cache/ instead of Supabase
"""

import argparse
import base64
import json
import os
import random
import sys
import time
import threading
import tempfile
import urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Load env from .env
NUKE_DIR = Path(__file__).parent.parent.parent
for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    k = k.strip()
    v = v.strip().strip('"').strip("'")
    if k and v and k not in os.environ:
        os.environ[k] = v

YONO_DIR = Path(__file__).parent.parent
LABELS_DIR = YONO_DIR / "training_labels"
LABELS_FILE = LABELS_DIR / "stage_labels.jsonl"
ERRORS_FILE = LABELS_DIR / "stage_errors.jsonl"
CACHE_DIR = YONO_DIR / ".image_cache"

# ── Stage taxonomy ────────────────────────────────────────────────────────────
STAGE_CODES = [
    "raw",           # As-found condition, unmodified original state, barn find
    "disassembled",  # Components removed, engine/trans pulled, doors off
    "stripped",      # Body shell only, media blasted, paint removed, bare metal
    "fabricated",    # Metal work done — new panels, patch panels welded, rust repair
    "primed",        # Primer applied — epoxy, etch, or high-build primer visible
    "blocked",       # Body filler/block sanding — smooth but not painted
    "basecoated",    # Base color applied but not cleared — matte/flat appearance
    "clearcoated",   # Clear coat applied — glossy, wet-look finish
    "assembled",     # Components being reinstalled — trim, glass, wiring
    "complete",      # Finished vehicle, all systems operational, ready to drive
]
N_STAGES = len(STAGE_CODES)

# ── Prompts ───────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a vehicle restoration/fabrication expert who can identify the current fabrication stage of a vehicle from photos. You have deep knowledge of body work, paint, and assembly processes."""

LABEL_PROMPT = """Analyze this vehicle photo and determine what FABRICATION STAGE the vehicle (or visible component/area) is currently in.

Return ONLY a JSON object with these exact fields:

{
  "fabrication_stage": "<one of the allowed values>",
  "stage_confidence": <float 0.0-1.0>,
  "stage_reasoning": "<brief 1-sentence explanation>"
}

FABRICATION STAGES (in order of restoration progression):

1. "raw" — As-found/original condition, untouched, barn find, neglected
2. "disassembled" — Components being removed: engine pulled, doors off, interior gutted
3. "stripped" — Bare metal body shell, media blasted, all paint removed
4. "fabricated" — Metal work in progress: new panels welded, patch panels, rust cut out and replaced
5. "primed" — Primer coat applied (epoxy, etch, or high-build). Gray/dark primer visible
6. "blocked" — Body filler applied and block-sanded smooth. Matte, multi-color patches visible
7. "basecoated" — Base color paint applied but NOT yet clear-coated. Flat/matte colored appearance
8. "clearcoated" — Clear coat applied. Glossy, wet-look finish. Paint complete
9. "assembled" — Reassembly in progress: trim, glass, weatherstrip, wiring being installed
10. "complete" — Fully finished vehicle, all systems installed, ready to drive

RULES:
- Choose the stage that BEST describes what's visible in the image
- If the photo shows a specific component (not whole vehicle), classify by that component's state
- If you truly cannot determine the stage (e.g., photo is too dark, not automotive), use stage_confidence < 0.3
- A freshly painted panel is "clearcoated" even if the rest of the car isn't assembled yet
- "primed" includes ANY primer visible — gray, red oxide, or black epoxy
- "raw" means completely untouched original state, NOT a finished restored car

Return ONLY the JSON object, no explanation, no markdown code blocks."""


def get_api_key() -> str:
    """Get Anthropic API key from environment."""
    for key in ["NUKE_CLAUDE_API", "VITE_NUKE_CLAUDE_API", "ANTHROPIC_API_KEY"]:
        val = os.environ.get(key, "").strip()
        if val and val.startswith("sk-ant-"):
            return val
    raise ValueError(
        "No Anthropic API key found. Set NUKE_CLAUDE_API or ANTHROPIC_API_KEY in .env"
    )


def get_supabase_config() -> tuple[str, str]:
    """Get Supabase URL and service role key."""
    url = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SERVICE_ROLE_KEY")
    if not url or not key:
        raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
    return url, key


def fetch_images_from_supabase(limit: int = 5000) -> list[dict]:
    """
    Fetch vehicle_images that have zone classification but need stage labeling.
    Returns list of {id, image_url, vehicle_zone, vehicle_id}.
    Paginates in chunks of 500 to avoid PostgREST timeouts on large tables.
    """
    import urllib.request

    url, key = get_supabase_config()
    PAGE_SIZE = 500
    all_data = []

    while len(all_data) < limit:
        remaining = min(PAGE_SIZE, limit - len(all_data))
        query_url = (
            f"{url}/rest/v1/vehicle_images"
            f"?select=id,image_url,vehicle_zone,vehicle_id"
            f"&vehicle_zone=not.is.null"
            f"&image_url=not.is.null"
            f"&order=id"
            f"&limit={remaining}"
            f"&offset={len(all_data)}"
        )

        req = urllib.request.Request(query_url)
        req.add_header("apikey", key)
        req.add_header("Authorization", f"Bearer {key}")
        req.add_header("Content-Type", "application/json")

        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())

        if not data:
            break
        all_data.extend(data)
        print(f"  Fetched page: {len(data)} rows (total: {len(all_data)})")

    print(f"Fetched {len(all_data)} images from Supabase with zone classification")
    return all_data


def sample_from_cache(n: int = 5000) -> list[dict]:
    """
    Sample n images from local .image_cache/ directory.
    Returns list of {id: path, image_url: path, vehicle_zone: "unknown"}.
    """
    MIN_FILE_SIZE = 30_000
    MAX_FILE_SIZE = 20_000_000

    all_files = [
        f for f in CACHE_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp')
    ]

    valid = [f for f in all_files if MIN_FILE_SIZE <= f.stat().st_size <= MAX_FILE_SIZE]
    print(f"Cache: {len(all_files)} total, {len(valid)} valid size")

    sampled = random.sample(valid, min(n, len(valid)))
    return [
        {"id": str(f), "image_url": str(f), "vehicle_zone": "unknown", "vehicle_id": None}
        for f in sampled
    ]


def load_existing_labels() -> set[str]:
    """Load already-labeled image IDs for resumability."""
    labeled = set()
    if LABELS_FILE.exists():
        with open(LABELS_FILE) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    labeled.add(record.get("image_id", record.get("image_path", "")))
                except Exception:
                    pass
    return labeled


_write_lock = threading.Lock()


def write_label(record: dict):
    """Thread-safe append to stage_labels.jsonl."""
    with _write_lock:
        with open(LABELS_FILE, "a") as f:
            f.write(json.dumps(record) + "\n")


def write_error(record: dict):
    """Thread-safe append to stage_errors.jsonl."""
    with _write_lock:
        with open(ERRORS_FILE, "a") as f:
            f.write(json.dumps(record) + "\n")


def download_image(image_url: str) -> bytes | None:
    """Download image from URL, return bytes or None on failure."""
    try:
        if image_url.startswith("/") or image_url.startswith("."):
            # Local file path
            with open(image_url, "rb") as f:
                return f.read()

        req = urllib.request.Request(image_url)
        req.add_header("User-Agent", "YONO-Labeler/1.0")
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read()
    except Exception as e:
        return None


def label_image(client, image_data: bytes, media_type: str = "image/jpeg") -> dict | None:
    """
    Send image to Claude Haiku for fabrication stage labeling.
    Returns label dict or None on failure.
    """
    b64_data = base64.standard_b64encode(image_data).decode("utf-8")

    for attempt in range(3):
        try:
            message = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=200,
                system=SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": b64_data,
                                },
                            },
                            {
                                "type": "text",
                                "text": LABEL_PROMPT,
                            },
                        ],
                    }
                ],
            )

            response_text = message.content[0].text.strip()

            # Strip markdown code blocks if present
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                response_text = "\n".join(lines[1:-1])

            label = json.loads(response_text)

            # Validate stage
            stage = label.get("fabrication_stage", "").lower().strip()
            if stage not in STAGE_CODES:
                # Try fuzzy match
                for code in STAGE_CODES:
                    if code in stage or stage in code:
                        stage = code
                        break
                else:
                    stage = "raw"  # default fallback

            confidence = float(label.get("stage_confidence", 0.5))
            confidence = max(0.0, min(1.0, confidence))

            return {
                "fabrication_stage": stage,
                "stage_confidence": confidence,
                "stage_reasoning": label.get("stage_reasoning", ""),
                "input_tokens": message.usage.input_tokens,
                "output_tokens": message.usage.output_tokens,
            }

        except json.JSONDecodeError:
            if attempt == 2:
                return None
            time.sleep(1)
        except Exception as e:
            err_str = str(e)
            if "overloaded" in err_str.lower() or "rate_limit" in err_str.lower():
                wait = (attempt + 1) * 10
                print(f"  Rate limited, waiting {wait}s...")
                time.sleep(wait)
            elif attempt == 2:
                return None
            else:
                time.sleep(2 ** attempt)

    return None


def get_media_type(url: str) -> str:
    """Infer media type from URL."""
    url_lower = url.lower().split("?")[0]
    if url_lower.endswith(".png"):
        return "image/png"
    elif url_lower.endswith(".webp"):
        return "image/webp"
    elif url_lower.endswith(".gif"):
        return "image/gif"
    return "image/jpeg"


def main():
    parser = argparse.ArgumentParser(description="Auto-label vehicle images with fabrication stage via Claude Haiku")
    parser.add_argument("--sample", type=int, default=5000, help="Number of images to label (default: 5000)")
    parser.add_argument("--workers", type=int, default=3, help="Parallel API workers (default: 3)")
    parser.add_argument("--dry-run", action="store_true", help="Query only, no API calls")
    parser.add_argument("--from-cache", action="store_true", help="Use local .image_cache/ instead of Supabase")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    random.seed(args.seed)
    LABELS_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("YONO Fabrication Stage Auto-Labeler")
    print("=" * 60)
    print(f"Output:  {LABELS_FILE}")
    print(f"Target:  {args.sample} images")
    print(f"Workers: {args.workers}")
    print(f"Source:  {'local cache' if args.from_cache else 'Supabase'}")
    print()

    api_key = get_api_key()
    print(f"API key: {api_key[:20]}...")

    # Fetch image list
    if args.from_cache:
        images = sample_from_cache(args.sample)
    else:
        images = fetch_images_from_supabase(args.sample)

    if not images:
        print("No images found!")
        return

    # Random sample if we got more than requested
    if len(images) > args.sample:
        images = random.sample(images, args.sample)

    # Filter already-labeled
    already_labeled = load_existing_labels()
    if already_labeled:
        print(f"\nResuming: {len(already_labeled):,} already labeled, skipping...")

    to_label = [img for img in images if img["id"] not in already_labeled]
    print(f"\nTo label: {len(to_label):,} images")

    if args.dry_run:
        print("\nDRY RUN — no API calls")
        # Show zone distribution
        from collections import Counter
        zones = Counter(img.get("vehicle_zone", "unknown") for img in to_label)
        print("\nZone distribution:")
        for zone, count in zones.most_common(20):
            print(f"  {zone:30s} {count:4d}")
        return

    if not to_label:
        print("All images already labeled!")
        return

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)

    print(f"\nStarting labeling with {args.workers} workers...")
    est_cost = len(to_label) * 0.00135  # ~$0.00135/image for Haiku vision
    print(f"Estimated cost: ~${est_cost:.2f}")
    print()

    success_count = 0
    error_count = 0
    total_input_tokens = 0
    total_output_tokens = 0
    start_time = time.time()
    _counter_lock = threading.Lock()

    def process_image(img: dict) -> bool:
        nonlocal success_count, error_count, total_input_tokens, total_output_tokens

        try:
            image_data = download_image(img["image_url"])
            if not image_data or len(image_data) < 5000:
                write_error({"image_id": img["id"], "error": "download_failed_or_too_small"})
                with _counter_lock:
                    error_count += 1
                return False

            media_type = get_media_type(img["image_url"])
            result = label_image(client, image_data, media_type)

            if result:
                record = {
                    "image_id": img["id"],
                    "image_url": img["image_url"],
                    "vehicle_zone": img.get("vehicle_zone"),
                    "vehicle_id": img.get("vehicle_id"),
                    **result,
                }
                write_label(record)
                with _counter_lock:
                    success_count += 1
                    total_input_tokens += result.get("input_tokens", 0)
                    total_output_tokens += result.get("output_tokens", 0)
                return True
            else:
                write_error({"image_id": img["id"], "error": "label_failed"})
                with _counter_lock:
                    error_count += 1
                return False

        except Exception as e:
            write_error({"image_id": img["id"], "error": str(e)})
            with _counter_lock:
                error_count += 1
            return False

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(process_image, img): img for img in to_label}
        for i, future in enumerate(as_completed(futures), 1):
            future.result()

            if i % 50 == 0 or i == len(to_label):
                elapsed = time.time() - start_time
                rate = i / elapsed if elapsed > 0 else 0
                eta = (len(to_label) - i) / rate if rate > 0 else 0
                cost = (total_input_tokens * 0.001 + total_output_tokens * 0.005) / 1000
                print(
                    f"  [{i:4d}/{len(to_label)}] "
                    f"success={success_count} errors={error_count} "
                    f"rate={rate:.1f}/s ETA={eta/60:.1f}m "
                    f"cost=${cost:.3f}"
                )

    elapsed = time.time() - start_time
    cost = (total_input_tokens * 0.001 + total_output_tokens * 0.005) / 1000

    print()
    print("=" * 60)
    print("STAGE LABELING COMPLETE")
    print("=" * 60)
    print(f"  Labeled:  {success_count:,}")
    print(f"  Errors:   {error_count:,}")
    print(f"  Time:     {elapsed/60:.1f} minutes")
    print(f"  Rate:     {success_count/elapsed:.1f} images/second" if elapsed > 0 else "  Rate:     N/A")
    print(f"  Tokens:   {total_input_tokens+total_output_tokens:,} total")
    print(f"  Cost:     ${cost:.3f}")
    print(f"  Output:   {LABELS_FILE}")
    print()
    print("Next: python scripts/train_stage_classifier.py")


if __name__ == "__main__":
    main()
