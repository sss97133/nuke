#!/usr/bin/env python3
"""
Export labeled photos to YOLOv8 classification format
Creates dataset structure for training YONO
"""

import os
import shutil
import requests
from pathlib import Path
from urllib.parse import urlparse

# Config
NUKE_DIR = Path("/Users/skylar/nuke")
YONO_DIR = NUKE_DIR / "yono"
DATASET_DIR = YONO_DIR / "dataset"

for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    key, _, val = line.partition("=")
    os.environ.setdefault(key.strip(), val.strip('"').strip("'"))

SUPABASE_URL = os.environ["VITE_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# Vehicle classes for YONO
CLASSES = {
    "a90c008a-3379-41d8-9eb2-b4eda365d74c": "c10_1983",
    "e08bf694-970f-4cbe-8a74-8715158a0f2e": "blazer_1977",
    "e1b9c9ba-94e9-4a45-85c0-30bac65a40f8": "k10_1979_dad",
    "pending_k10_yours": "k10_1979_daily",
    "pending_k20_cameron": "k20_1983_cameron",
}

def fetch_training_data():
    """Get labeled photos from DB"""
    # From explicit training data
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/photo_training_data",
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
        },
        params={"select": "image_url,correct_vehicle_id,correct_label"}
    )
    training = resp.json() if resp.status_code == 200 else []

    # From reviewed inbox photos
    resp2 = requests.get(
        f"{SUPABASE_URL}/rest/v1/photo_inbox",
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
        },
        params={
            "select": "image_data,vehicle_id",
            "vehicle_id": "not.is.null",
            "needs_review": "eq.false"
        }
    )
    reviewed = resp2.json() if resp2.status_code == 200 else []

    return training, reviewed

def download_image(url, dest_path):
    """Download image from URL or copy from local path"""
    if url.startswith("file://"):
        src = url.replace("file://", "")
        if os.path.exists(src):
            shutil.copy(src, dest_path)
            return True
        return False

    try:
        resp = requests.get(url, timeout=30)
        if resp.status_code == 200:
            with open(dest_path, "wb") as f:
                f.write(resp.content)
            return True
    except:
        pass
    return False

def main():
    print("Exporting training data for YONO...\n")

    # Setup dataset structure
    train_dir = DATASET_DIR / "train"
    val_dir = DATASET_DIR / "val"

    for class_name in CLASSES.values():
        (train_dir / class_name).mkdir(parents=True, exist_ok=True)
        (val_dir / class_name).mkdir(parents=True, exist_ok=True)

    # Also create "unknown" and "not_vehicle" classes
    for extra in ["unknown", "not_vehicle"]:
        (train_dir / extra).mkdir(parents=True, exist_ok=True)
        (val_dir / extra).mkdir(parents=True, exist_ok=True)

    training_data, reviewed_data = fetch_training_data()
    print(f"Found {len(training_data)} explicit labels, {len(reviewed_data)} reviewed photos\n")

    counts = {c: 0 for c in list(CLASSES.values()) + ["unknown", "not_vehicle"]}
    total = 0

    # Process training data
    for item in training_data:
        url = item.get("image_url", "")
        vehicle_id = item.get("correct_vehicle_id")
        label = item.get("correct_label", "").lower()

        class_name = CLASSES.get(vehicle_id, "unknown")
        if "not" in label or "skip" in label:
            class_name = "not_vehicle"

        # 80/20 train/val split
        split_dir = val_dir if total % 5 == 0 else train_dir
        filename = f"{total:05d}.jpg"
        dest = split_dir / class_name / filename

        if download_image(url, dest):
            counts[class_name] += 1
            total += 1
            print(f"  ✓ {class_name}: {filename}")

    # Process reviewed inbox photos
    for item in reviewed_data:
        url = item.get("image_data", "")
        vehicle_id = item.get("vehicle_id")

        if not vehicle_id or vehicle_id not in CLASSES:
            continue

        class_name = CLASSES[vehicle_id]
        split_dir = val_dir if total % 5 == 0 else train_dir
        filename = f"{total:05d}.jpg"
        dest = split_dir / class_name / filename

        if download_image(url, dest):
            counts[class_name] += 1
            total += 1
            print(f"  ✓ {class_name}: {filename}")

    print(f"\n{'='*40}")
    print("Dataset Summary:")
    print(f"{'='*40}")
    for class_name, count in counts.items():
        if count > 0:
            print(f"  {class_name}: {count} images")
    print(f"\nTotal: {total} images")
    print(f"Location: {DATASET_DIR}")

    # Create data.yaml
    yaml_content = f"""# YONO Dataset Config
path: {DATASET_DIR}
train: train
val: val

# Classes
names:
"""
    for i, class_name in enumerate(list(CLASSES.values()) + ["unknown", "not_vehicle"]):
        yaml_content += f"  {i}: {class_name}\n"

    (YONO_DIR / "data.yaml").write_text(yaml_content)
    print(f"\nConfig: {YONO_DIR / 'data.yaml'}")

if __name__ == "__main__":
    main()
