#!/Users/skylar/nuke/yono/.venv/bin/python3
"""
YONO Zone Labeling Pass — adds vehicle_zone to existing labels.

Reads yono/training_labels/labels.jsonl, for each record that has no
vehicle_zone field, sends the image to claude-haiku vision asking for
the zone from the full taxonomy defined in VISION_ARCHITECTURE.md.

Updates the JSONL in place (writes to a temp file, then atomically replaces).
Fully resumable: skips records that already have vehicle_zone.

Zone taxonomy (41 zones total):
  Exterior (whole-vehicle): ext_front, ext_front_driver, ext_front_passenger,
    ext_driver_side, ext_passenger_side, ext_rear, ext_rear_driver,
    ext_rear_passenger, ext_roof, ext_undercarriage
  Panels: panel_hood, panel_trunk, panel_door_fl, panel_door_fr,
    panel_door_rl, panel_door_rr, panel_fender_fl, panel_fender_fr,
    panel_fender_rl, panel_fender_rr
  Wheels: wheel_fl, wheel_fr, wheel_rl, wheel_rr
  Interior: int_dashboard, int_front_seats, int_rear_seats, int_cargo,
    int_headliner, int_door_panel_fl, int_door_panel_fr, int_door_panel_rl,
    int_door_panel_rr
  Mechanical: mech_engine_bay, mech_transmission, mech_suspension
  Detail/Other: detail_vin, detail_badge, detail_damage, detail_odometer, other

Usage:
    python scripts/add_zone_labels.py
    python scripts/add_zone_labels.py --workers 5
    python scripts/add_zone_labels.py --dry-run     # preview only, no API calls
    python scripts/add_zone_labels.py --limit 100   # process only first 100
"""

import argparse
import base64
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Load .env
NUKE_DIR = Path(__file__).parent.parent.parent
for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    k, v = k.strip(), v.strip().strip('"').strip("'")
    if k and v and k not in os.environ:
        os.environ[k] = v

YONO_DIR = Path(__file__).parent.parent
LABELS_FILE = YONO_DIR / "training_labels" / "labels.jsonl"

# ── Zone taxonomy ──────────────────────────────────────────────────────────────
ZONE_CODES = [
    # Exterior whole-vehicle shots
    "ext_front",            # Straight-on front — bumper, grille, headlights
    "ext_front_driver",     # Front 3/4 angle, driver (left) side
    "ext_front_passenger",  # Front 3/4 angle, passenger (right) side
    "ext_driver_side",      # Flat profile, driver side
    "ext_passenger_side",   # Flat profile, passenger side
    "ext_rear",             # Straight-on rear
    "ext_rear_driver",      # Rear 3/4 angle, driver side
    "ext_rear_passenger",   # Rear 3/4 angle, passenger side
    "ext_roof",             # Top-down or roof clearly visible
    "ext_undercarriage",    # Shot from underneath
    # Panels (specific panel is the focus)
    "panel_hood",           # Hood open or hood detail shot
    "panel_trunk",          # Trunk/tailgate open
    "panel_door_fl",        # Front-left (driver) door
    "panel_door_fr",        # Front-right (passenger) door
    "panel_door_rl",        # Rear-left door
    "panel_door_rr",        # Rear-right door
    "panel_fender_fl",      # Front-left fender/quarter panel
    "panel_fender_fr",      # Front-right fender/quarter panel
    "panel_fender_rl",      # Rear-left quarter panel
    "panel_fender_rr",      # Rear-right quarter panel
    # Wheels
    "wheel_fl",             # Front-left wheel/tire
    "wheel_fr",             # Front-right wheel/tire
    "wheel_rl",             # Rear-left wheel/tire
    "wheel_rr",             # Rear-right wheel/tire
    # Interior
    "int_dashboard",        # Dash, steering wheel, gauges, infotainment
    "int_front_seats",      # Front seating area
    "int_rear_seats",       # Rear seating
    "int_cargo",            # Trunk/cargo area interior
    "int_headliner",        # Ceiling/headliner
    "int_door_panel_fl",    # Driver front door panel interior
    "int_door_panel_fr",    # Passenger front door panel interior
    "int_door_panel_rl",    # Driver rear door panel interior
    "int_door_panel_rr",    # Passenger rear door panel interior
    # Mechanical
    "mech_engine_bay",      # Engine compartment
    "mech_transmission",    # Trans tunnel or exposed transmission
    "mech_suspension",      # Suspension components
    # Detail / Other
    "detail_vin",           # VIN plate close-up
    "detail_badge",         # Brand/trim/series badge
    "detail_damage",        # Tight shot focused on specific damage
    "detail_odometer",      # Instrument cluster / mileage reading
    "other",                # Doesn't fit above (crowd, transport, environment)
]

ZONE_SET = set(ZONE_CODES)
ZONE_LIST_TEXT = "\n".join(f"  {z}" for z in ZONE_CODES)

ZONE_PROMPT = f"""Look at this vehicle image. Classify the viewpoint using EXACTLY one of these zone codes:

{ZONE_LIST_TEXT}

Zone code definitions:
- ext_front / ext_rear: straight-on front or rear shot of whole vehicle
- ext_front_driver / ext_front_passenger: front 3/4 angle, left or right side
- ext_driver_side / ext_passenger_side: flat side profile
- ext_rear_driver / ext_rear_passenger: rear 3/4 angle
- ext_roof: aerial/top-down view
- ext_undercarriage: shot from below the vehicle
- panel_hood: hood open (engine not main subject) or hood surface detail
- panel_trunk: trunk/tailgate open or trunk surface detail
- panel_door_fl/fr/rl/rr: specific door is the main subject (fl=front-left=driver)
- panel_fender_fl/fr/rl/rr: fender or quarter panel is main subject
- wheel_fl/fr/rl/rr: wheel+tire is main subject
- int_dashboard: interior shot showing dash, steering wheel, center console
- int_front_seats: interior shot focused on front seats
- int_rear_seats: interior shot focused on back seats
- int_cargo: trunk/cargo area from inside
- int_headliner: ceiling/roof liner interior
- int_door_panel_fl/fr/rl/rr: interior door card/panel
- mech_engine_bay: engine compartment is primary subject
- mech_transmission: transmission or drivetrain components
- mech_suspension: suspension, axles, differential
- detail_vin: VIN plate, data plate close-up
- detail_badge: manufacturer/model/trim badge close-up
- detail_damage: tight crop of specific damage (rust, dent, etc.)
- detail_odometer: odometer/mileage reading
- other: crowd, trailer, environment, parts, non-vehicle

Return ONLY a JSON object:
{{"vehicle_zone": "<exact_zone_code>", "confidence": <0.0-1.0>}}

Do not include any explanation. Use only codes from the list above."""


def get_api_key() -> str:
    for key in ["NUKE_CLAUDE_API", "VITE_NUKE_CLAUDE_API", "ANTHROPIC_API_KEY"]:
        val = os.environ.get(key, "").strip()
        if val and val.startswith("sk-ant-"):
            return val
    raise ValueError("No Anthropic API key found in environment")


def load_labels() -> list[dict]:
    """Load all labels from JSONL."""
    if not LABELS_FILE.exists():
        raise FileNotFoundError(f"Labels file not found: {LABELS_FILE}")
    records = []
    with open(LABELS_FILE) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except Exception:
                    pass
    return records


def save_labels(records: list[dict]):
    """Atomically write all records back to labels.jsonl."""
    tmp_path = LABELS_FILE.with_suffix(".jsonl.tmp")
    with open(tmp_path, "w") as f:
        for rec in records:
            f.write(json.dumps(rec) + "\n")
    shutil.move(str(tmp_path), str(LABELS_FILE))


_write_lock = threading.Lock()
_records_ref: list[dict] = []  # shared mutable list (modified in place)
_save_counter = 0
SAVE_EVERY = 50  # save to disk every N successful labels


def classify_zone(client, record: dict) -> dict | None:
    """
    Send image to Claude Haiku and get vehicle_zone.
    Returns updated record dict with vehicle_zone + zone_confidence, or None on failure.
    """
    img_path = Path(record["image_path"])
    if not img_path.exists():
        return None

    suffix = img_path.suffix.lower()
    media_type_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                      ".png": "image/png", ".webp": "image/webp"}
    media_type = media_type_map.get(suffix, "image/jpeg")

    with open(img_path, "rb") as f:
        image_data = base64.standard_b64encode(f.read()).decode("utf-8")

    for attempt in range(3):
        try:
            message = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=80,
                messages=[{
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
                        {"type": "text", "text": ZONE_PROMPT},
                    ],
                }],
            )

            text = message.content[0].text.strip()
            # Strip markdown if present
            if text.startswith("```"):
                lines = text.split("\n")
                text = "\n".join(lines[1:-1])

            parsed = json.loads(text)
            zone = parsed.get("vehicle_zone", "other").strip()
            confidence = float(parsed.get("confidence", 0.5))

            # Validate zone code
            if zone not in ZONE_SET:
                # Try to find closest match by prefix
                for valid_zone in ZONE_CODES:
                    if zone.startswith(valid_zone[:4]):
                        zone = valid_zone
                        break
                else:
                    zone = "other"

            updated = dict(record)
            updated["vehicle_zone"] = zone
            updated["zone_confidence"] = round(confidence, 3)
            return updated

        except json.JSONDecodeError:
            if attempt == 2:
                return None
            time.sleep(1)
        except Exception as e:
            err = str(e).lower()
            if "overloaded" in err or "rate_limit" in err:
                wait = (attempt + 1) * 10
                time.sleep(wait)
            elif attempt == 2:
                return None
            else:
                time.sleep(2 ** attempt)

    return None


def main():
    parser = argparse.ArgumentParser(description="Add vehicle_zone to existing labels")
    parser.add_argument("--workers", type=int, default=4, help="Parallel API workers")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no API calls")
    parser.add_argument("--limit", type=int, default=0, help="Process at most N records (0=all)")
    args = parser.parse_args()

    print("=" * 60)
    print("YONO Zone Labeling Pass")
    print("=" * 60)
    print(f"Labels file: {LABELS_FILE}")
    print(f"Zone taxonomy: {len(ZONE_CODES)} zones")
    print()

    api_key = get_api_key()
    print(f"API key: {api_key[:20]}...")

    # Load all labels
    records = load_labels()
    print(f"Loaded {len(records):,} total labels")

    # Find which need zone classification
    needs_zone_idx = [
        i for i, r in enumerate(records)
        if not r.get("vehicle_zone") and Path(r.get("image_path", "")).exists()
    ]
    already_done = sum(1 for r in records if r.get("vehicle_zone"))
    skipped_missing = len(records) - already_done - len(needs_zone_idx)

    print(f"Already have vehicle_zone: {already_done:,}")
    print(f"Need zone classification: {len(needs_zone_idx):,}")
    print(f"Skipped (missing image file): {skipped_missing:,}")

    if args.limit and args.limit > 0:
        needs_zone_idx = needs_zone_idx[:args.limit]
        print(f"Limited to: {len(needs_zone_idx):,} records")

    if args.dry_run:
        print("\nDRY RUN — no API calls")
        print("Sample records that would be labeled:")
        for idx in needs_zone_idx[:5]:
            r = records[idx]
            print(f"  {Path(r['image_path']).name} | photo_type={r.get('photo_type','?')}")
        print(f"\nEstimated cost: ~${len(needs_zone_idx) * 0.000035:.2f} (haiku, ~70 tokens each)")
        return

    if not needs_zone_idx:
        print("All records already have vehicle_zone — nothing to do.")
        return

    print(f"\nEstimated cost: ~${len(needs_zone_idx) * 0.000035:.2f}")
    print(f"Starting with {args.workers} workers...\n")

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)

    # Use the mutable records list — update in place by index
    global _records_ref, _save_counter
    _records_ref = records

    counts = {"success": 0, "error": 0, "saves": 0}
    start_time = time.time()
    counter_lock = threading.Lock()
    save_lock = threading.Lock()

    def process_one(idx: int) -> bool:
        record = _records_ref[idx]
        updated = classify_zone(client, record)
        if updated:
            with counter_lock:
                _records_ref[idx] = updated
                counts["success"] += 1
                counts["saves"] += 1
                # Periodic save to disk
                if counts["saves"] % SAVE_EVERY == 0:
                    with save_lock:
                        save_labels(_records_ref)
            return True
        else:
            with counter_lock:
                counts["error"] += 1
            return False

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(process_one, idx): idx for idx in needs_zone_idx}
        for i, future in enumerate(as_completed(futures), 1):
            future.result()
            if i % 100 == 0 or i == len(needs_zone_idx):
                elapsed = time.time() - start_time
                rate = i / elapsed if elapsed > 0 else 0
                eta = (len(needs_zone_idx) - i) / rate if rate > 0 else 0
                cost = counts["success"] * 0.000035
                print(
                    f"  [{i:4d}/{len(needs_zone_idx)}] "
                    f"ok={counts['success']} err={counts['error']} "
                    f"rate={rate:.1f}/s ETA={eta/60:.1f}m "
                    f"cost=${cost:.3f}"
                )

    # Final save
    with save_lock:
        save_labels(_records_ref)

    elapsed = time.time() - start_time

    print()
    print("=" * 60)
    print("ZONE LABELING COMPLETE")
    print("=" * 60)
    print(f"  Labeled:  {counts['success']:,}")
    print(f"  Errors:   {counts['error']:,}")
    print(f"  Time:     {elapsed/60:.1f} minutes")
    print(f"  Rate:     {counts['success']/elapsed:.1f} images/second")
    print(f"  Cost:     ~${counts['success'] * 0.000035:.3f}")
    print(f"  Output:   {LABELS_FILE}")

    # Print zone distribution
    updated_records = load_labels()
    from collections import Counter
    zone_counts = Counter(r.get("vehicle_zone") for r in updated_records if r.get("vehicle_zone"))
    print("\nZone distribution:")
    for zone, count in sorted(zone_counts.items(), key=lambda x: -x[1])[:15]:
        print(f"  {zone:30s} {count:5d}")
    if len(zone_counts) > 15:
        print(f"  ... and {len(zone_counts)-15} more zones")

    print("\nNext: python scripts/train_zone_classifier.py")


if __name__ == "__main__":
    main()
