#!/usr/bin/env python3
"""
YONO Inference - Classify vehicle photos

Usage:
  python inference_yono.py image.jpg
  python inference_yono.py /path/to/folder/
  python inference_yono.py --batch  # Process inbox queue
"""

import os
import sys
import argparse
import requests
from pathlib import Path

try:
    from ultralytics import YOLO
except ImportError:
    print("Install ultralytics: pip install ultralytics")
    exit(1)

NUKE_DIR = Path("/Users/skylar/nuke")
YONO_DIR = NUKE_DIR / "yono"
MODEL_PATH = YONO_DIR / "models" / "yono.pt"

# Load env
for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    key, _, val = line.partition("=")
    os.environ.setdefault(key.strip(), val.strip('"').strip("'"))

SUPABASE_URL = os.environ["VITE_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# Class ID to vehicle UUID mapping
CLASS_TO_VEHICLE = {
    "c10_1983": "a90c008a-3379-41d8-9eb2-b4eda365d74c",
    "blazer_1977": "e08bf694-970f-4cbe-8a74-8715158a0f2e",
    "k10_1979_dad": "e1b9c9ba-94e9-4a45-85c0-30bac65a40f8",
    "k10_1979_daily": None,  # Pending vehicle
    "k20_1983_cameron": None,  # Pending vehicle
    "unknown": None,
    "not_vehicle": None,
}

CONFIDENCE_THRESHOLD = 0.7

def load_model():
    """Load YONO model"""
    if not MODEL_PATH.exists():
        print(f"Model not found: {MODEL_PATH}")
        print("Train first: python train_yono.py")
        sys.exit(1)
    return YOLO(str(MODEL_PATH))

def predict(model, image_path):
    """Run inference on single image"""
    results = model(image_path, verbose=False)

    if not results or not results[0].probs:
        return None, 0.0, "error"

    probs = results[0].probs
    top_class_idx = probs.top1
    confidence = float(probs.top1conf)
    class_name = results[0].names[top_class_idx]

    vehicle_id = CLASS_TO_VEHICLE.get(class_name)

    return vehicle_id, confidence, class_name

def process_single(model, image_path):
    """Process and display single image result"""
    vehicle_id, confidence, class_name = predict(model, image_path)

    status = "✓" if confidence >= CONFIDENCE_THRESHOLD else "?"
    print(f"{status} {Path(image_path).name}: {class_name} ({confidence:.0%})")

    return vehicle_id, confidence, class_name

def process_inbox(model):
    """Process pending photos from inbox"""
    # Fetch unprocessed
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/photo_inbox",
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
        },
        params={"processed": "eq.false", "limit": "50"}
    )

    photos = resp.json() if resp.status_code == 200 else []
    if not photos:
        print("No pending photos in inbox")
        return

    print(f"Processing {len(photos)} photos...\n")

    auto_assigned = 0
    needs_review = 0

    for photo in photos:
        image_url = photo.get("image_data", "")
        photo_id = photo["id"]

        # Handle local files vs URLs
        if image_url.startswith("file://"):
            image_path = image_url.replace("file://", "")
        else:
            # Download from URL
            import tempfile
            try:
                img_resp = requests.get(image_url, timeout=30)
                if img_resp.status_code != 200:
                    continue
                with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
                    f.write(img_resp.content)
                    image_path = f.name
            except:
                continue

        # Run inference
        vehicle_id, confidence, class_name = predict(model, image_path)

        # Determine if review needed
        review_needed = confidence < CONFIDENCE_THRESHOLD or vehicle_id is None

        # Update record
        update_data = {
            "processed": True,
            "confidence": confidence,
            "ai_match": class_name,
            "needs_review": review_needed,
        }

        if vehicle_id and not review_needed:
            update_data["vehicle_id"] = vehicle_id
            auto_assigned += 1
            print(f"  ✓ {class_name} ({confidence:.0%})")
        else:
            needs_review += 1
            print(f"  ? {class_name} ({confidence:.0%}) [REVIEW]")

        requests.patch(
            f"{SUPABASE_URL}/rest/v1/photo_inbox",
            headers={
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "apikey": SUPABASE_KEY,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            },
            params={"id": f"eq.{photo_id}"},
            json=update_data
        )

    print(f"\nDone: {auto_assigned} auto-assigned, {needs_review} need review")

    # Notify if reviews pending
    if needs_review > 0:
        print(f"\n{needs_review} photos need tech review via SMS")

def main():
    parser = argparse.ArgumentParser(description="YONO Inference")
    parser.add_argument("images", nargs="*", help="Image files or folders")
    parser.add_argument("--batch", action="store_true", help="Process inbox queue")
    args = parser.parse_args()

    model = load_model()
    print(f"YONO loaded from {MODEL_PATH}\n")

    if args.batch:
        process_inbox(model)
        return

    if not args.images:
        print("Usage: python inference_yono.py image.jpg")
        print("       python inference_yono.py --batch")
        return

    # Process specified images
    for path in args.images:
        p = Path(path)
        if p.is_dir():
            for img in p.glob("*.jpg"):
                process_single(model, str(img))
            for img in p.glob("*.jpeg"):
                process_single(model, str(img))
            for img in p.glob("*.png"):
                process_single(model, str(img))
        elif p.exists():
            process_single(model, str(p))
        else:
            print(f"Not found: {path}")

if __name__ == "__main__":
    main()
