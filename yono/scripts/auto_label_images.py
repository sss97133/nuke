#!/Users/skylar/nuke/yono/.venv/bin/python3
"""
YONO Phase 1: Auto-label vehicle images using Claude Haiku vision.

Samples 3000 images from .image_cache/ (stratified by file size to ensure quality),
sends each to claude-haiku-4-5 vision API with structured prompt, writes labels to
yono/training_labels/labels.jsonl.

Resumable: already-labeled image paths are skipped on restart.

Cost estimate: 3000 images × ~600 tokens avg × $0.0001/1K input = ~$0.18 total.
Haiku output at $0.0004/1K output × ~150 tokens = ~$0.18 output = ~$0.36 total.

Usage:
    python scripts/auto_label_images.py
    python scripts/auto_label_images.py --sample 500     # smaller test run
    python scripts/auto_label_images.py --workers 5      # parallel workers (default 3)
    python scripts/auto_label_images.py --dry-run        # sample selection only, no API calls
"""

import argparse
import base64
import json
import os
import random
import sys
import time
import threading
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
CACHE_DIR = YONO_DIR / ".image_cache"
LABELS_DIR = YONO_DIR / "training_labels"
LABELS_FILE = LABELS_DIR / "labels.jsonl"
ERRORS_FILE = LABELS_DIR / "errors.jsonl"

# Minimum file size (bytes) — filters out tiny thumbnails and corrupt files
MIN_FILE_SIZE = 30_000   # 30KB
MAX_FILE_SIZE = 20_000_000  # 20MB — skip huge RAW files

# Label schema: condition_score, damage_flags, modification_flags, interior_quality, photo_quality, photo_type
SYSTEM_PROMPT = """You are a vehicle condition assessment AI. Analyze vehicle photos and output structured JSON assessments.
Be precise and consistent. Base scores only on what is VISIBLE in the image."""

LABEL_PROMPT = """Analyze this vehicle photo and return ONLY a JSON object with these exact fields:

{
  "condition_score": <integer 1-5>,
  "damage_flags": [<list of strings from allowed values>],
  "modification_flags": [<list of strings from allowed values>],
  "interior_quality": <integer 1-5 or null>,
  "photo_quality": <integer 1-5>,
  "photo_type": "<string from allowed values>"
}

SCORING RULES:
- condition_score: Overall exterior condition (1=junk/parts car, 2=poor/needs major work, 3=fair/driver quality, 4=good/nice driver, 5=excellent/show quality)
- damage_flags (use ONLY these values): rust, dent, crack, paint_fade, broken_glass, missing_parts, accident_damage
- modification_flags (use ONLY these values): lift_kit, lowered, aftermarket_wheels, roll_cage, engine_swap, body_kit, exhaust_mod, suspension_mod
- interior_quality: Visible interior condition (same 1-5 scale, null if no interior visible)
- photo_quality: Is this a useful vehicle photo? (1=unusable/blurry/wrong subject, 2=poor/partial, 3=adequate, 4=good, 5=excellent clarity + good angle)
- photo_type (use ONLY one): exterior_front, exterior_rear, exterior_side, interior, engine, wheel, detail, undercarriage, other

IMPORTANT:
- Only include damage_flags you can CLEARLY see, not speculate about
- modification_flags: only include obvious modifications (factory options don't count)
- If photo is not of a vehicle at all: photo_quality=1, photo_type=other, condition_score=1
- Return ONLY the JSON object, no explanation, no markdown code blocks"""


def get_api_key() -> str:
    """Get Anthropic API key from environment."""
    for key in ["NUKE_CLAUDE_API", "VITE_NUKE_CLAUDE_API", "ANTHROPIC_API_KEY"]:
        val = os.environ.get(key, "").strip()
        if val and val.startswith("sk-ant-"):
            return val
    raise ValueError(
        "No Anthropic API key found. Set NUKE_CLAUDE_API or ANTHROPIC_API_KEY in .env"
    )


def sample_images(n: int = 3000) -> list[Path]:
    """
    Sample n images from .image_cache/ with stratified selection.

    Strategy:
    1. Filter out tiny (<30KB) and huge (>20MB) files
    2. Sort by size buckets to get diverse coverage
    3. Random sample within each bucket

    Returns list of file paths.
    """
    print(f"Scanning {CACHE_DIR}...")
    all_files = [f for f in CACHE_DIR.iterdir() if f.is_file() and f.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp')]

    print(f"Total files in cache: {len(all_files):,}")

    # Filter by size
    valid_files = []
    for f in all_files:
        size = f.stat().st_size
        if MIN_FILE_SIZE <= size <= MAX_FILE_SIZE:
            valid_files.append((f, size))

    print(f"Valid files (30KB-20MB): {len(valid_files):,}")

    # Stratify into size buckets for diversity
    # Small: 30KB-200KB, Medium: 200KB-2MB, Large: 2MB-20MB
    small = [(f, s) for f, s in valid_files if s < 200_000]
    medium = [(f, s) for f, s in valid_files if 200_000 <= s < 2_000_000]
    large = [(f, s) for f, s in valid_files if s >= 2_000_000]

    print(f"Buckets — small: {len(small):,}, medium: {len(medium):,}, large: {len(large):,}")

    # Proportion: mostly medium (most useful), some small, some large
    n_small = min(int(n * 0.15), len(small))
    n_large = min(int(n * 0.15), len(large))
    n_medium = min(n - n_small - n_large, len(medium))

    sampled = (
        [f for f, _ in random.sample(small, n_small)] +
        [f for f, _ in random.sample(medium, n_medium)] +
        [f for f, _ in random.sample(large, n_large)]
    )
    random.shuffle(sampled)
    print(f"Sampled: {len(sampled):,} images (small={n_small}, medium={n_medium}, large={n_large})")
    return sampled


def load_existing_labels() -> set[str]:
    """Load already-labeled image paths for resumability."""
    labeled = set()
    if LABELS_FILE.exists():
        with open(LABELS_FILE) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    labeled.add(record["image_path"])
                except Exception:
                    pass
    return labeled


_write_lock = threading.Lock()


def write_label(record: dict):
    """Thread-safe append to labels.jsonl."""
    with _write_lock:
        with open(LABELS_FILE, "a") as f:
            f.write(json.dumps(record) + "\n")


def write_error(record: dict):
    """Thread-safe append to errors.jsonl."""
    with _write_lock:
        with open(ERRORS_FILE, "a") as f:
            f.write(json.dumps(record) + "\n")


def label_image(client, image_path: Path, api_key: str) -> dict | None:
    """
    Send image to Claude Haiku for condition labeling.

    Returns label dict or None on failure.
    """
    # Read and encode image
    with open(image_path, "rb") as f:
        image_data = base64.standard_b64encode(f.read()).decode("utf-8")

    # Determine media type
    suffix = image_path.suffix.lower()
    media_type_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    media_type = media_type_map.get(suffix, "image/jpeg")

    for attempt in range(3):
        try:
            message = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=300,
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
                                    "data": image_data,
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

            # Parse JSON response
            # Strip markdown code blocks if present
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                response_text = "\n".join(lines[1:-1])

            label = json.loads(response_text)

            # Validate and normalize
            result = {
                "image_path": str(image_path),
                "condition_score": int(label.get("condition_score", 3)),
                "damage_flags": label.get("damage_flags", []),
                "modification_flags": label.get("modification_flags", []),
                "interior_quality": label.get("interior_quality"),
                "photo_quality": int(label.get("photo_quality", 3)),
                "photo_type": label.get("photo_type", "other"),
                "input_tokens": message.usage.input_tokens,
                "output_tokens": message.usage.output_tokens,
            }

            # Clamp scores to valid range
            result["condition_score"] = max(1, min(5, result["condition_score"]))
            result["photo_quality"] = max(1, min(5, result["photo_quality"]))
            if result["interior_quality"] is not None:
                result["interior_quality"] = max(1, min(5, int(result["interior_quality"])))

            # Validate flags against allowed values
            allowed_damage = {"rust", "dent", "crack", "paint_fade", "broken_glass", "missing_parts", "accident_damage"}
            allowed_mods = {"lift_kit", "lowered", "aftermarket_wheels", "roll_cage", "engine_swap", "body_kit", "exhaust_mod", "suspension_mod"}
            result["damage_flags"] = [f for f in result["damage_flags"] if f in allowed_damage]
            result["modification_flags"] = [f for f in result["modification_flags"] if f in allowed_mods]

            allowed_types = {"exterior_front", "exterior_rear", "exterior_side", "interior", "engine", "wheel", "detail", "undercarriage", "other"}
            if result["photo_type"] not in allowed_types:
                result["photo_type"] = "other"

            return result

        except json.JSONDecodeError as e:
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


def main():
    parser = argparse.ArgumentParser(description="Auto-label vehicle images with Claude Haiku vision")
    parser.add_argument("--sample", type=int, default=3000, help="Number of images to label (default: 3000)")
    parser.add_argument("--workers", type=int, default=3, help="Parallel API workers (default: 3)")
    parser.add_argument("--dry-run", action="store_true", help="Sample selection only, no API calls")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    args = parser.parse_args()

    random.seed(args.seed)

    LABELS_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("YONO Phase 1: Auto-Label Vehicle Images")
    print("=" * 60)
    print(f"Cache dir: {CACHE_DIR}")
    print(f"Output:    {LABELS_FILE}")
    print(f"Target:    {args.sample} images")
    print(f"Workers:   {args.workers}")
    print()

    # Load API key
    api_key = get_api_key()
    print(f"API key: {api_key[:20]}...")

    # Sample images
    sampled = sample_images(args.sample)

    # Load already-labeled
    already_labeled = load_existing_labels()
    if already_labeled:
        print(f"\nResuming: {len(already_labeled):,} already labeled, skipping...")

    # Filter to unlabeled
    to_label = [p for p in sampled if str(p) not in already_labeled]
    print(f"\nTo label: {len(to_label):,} images")

    if args.dry_run:
        print("\nDRY RUN — no API calls made")
        print("Sample paths:")
        for p in to_label[:5]:
            print(f"  {p}")
        return

    if not to_label:
        print("All sampled images already labeled!")
        return

    # Import anthropic
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)

    # Run labeling with thread pool
    print(f"\nStarting labeling with {args.workers} workers...")
    print(f"Estimated cost: ~${len(to_label) * 0.00012:.2f} (claude-haiku-4-5)")
    print()

    success_count = 0
    error_count = 0
    total_input_tokens = 0
    total_output_tokens = 0
    start_time = time.time()

    _counter_lock = threading.Lock()

    def process_image(image_path: Path) -> bool:
        nonlocal success_count, error_count, total_input_tokens, total_output_tokens
        try:
            result = label_image(client, image_path, api_key)
            if result:
                write_label(result)
                with _counter_lock:
                    success_count += 1
                    total_input_tokens += result.get("input_tokens", 0)
                    total_output_tokens += result.get("output_tokens", 0)
                return True
            else:
                write_error({"image_path": str(image_path), "error": "label_failed"})
                with _counter_lock:
                    error_count += 1
                return False
        except Exception as e:
            write_error({"image_path": str(image_path), "error": str(e)})
            with _counter_lock:
                error_count += 1
            return False

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(process_image, p): p for p in to_label}
        for i, future in enumerate(as_completed(futures), 1):
            future.result()  # propagate exceptions if any

            if i % 50 == 0 or i == len(to_label):
                elapsed = time.time() - start_time
                rate = i / elapsed if elapsed > 0 else 0
                eta = (len(to_label) - i) / rate if rate > 0 else 0
                cost = (total_input_tokens / 1000 * 0.00025) + (total_output_tokens / 1000 * 0.00125)
                print(
                    f"  [{i:4d}/{len(to_label)}] "
                    f"success={success_count} errors={error_count} "
                    f"rate={rate:.1f}/s ETA={eta/60:.1f}m "
                    f"cost=${cost:.3f} tokens={total_input_tokens+total_output_tokens:,}"
                )

    elapsed = time.time() - start_time
    cost = (total_input_tokens / 1000 * 0.00025) + (total_output_tokens / 1000 * 0.00125)

    print()
    print("=" * 60)
    print("LABELING COMPLETE")
    print("=" * 60)
    print(f"  Labeled:  {success_count:,}")
    print(f"  Errors:   {error_count:,}")
    print(f"  Time:     {elapsed/60:.1f} minutes")
    print(f"  Rate:     {success_count/elapsed:.1f} images/second")
    print(f"  Tokens:   {total_input_tokens+total_output_tokens:,} total")
    print(f"  Cost:     ${cost:.3f}")
    print(f"  Output:   {LABELS_FILE}")
    print()
    print("Next: python scripts/train_florence2.py")


if __name__ == "__main__":
    main()
