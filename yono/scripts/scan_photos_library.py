#!/usr/bin/env python3
"""
Scan entire Photos library for automotive content using YONO.

Processes ALL photos and video clips:
- Photos: Direct classification
- Videos: Extract keyframes, classify each

Outputs structured data for import into Nuke.
"""

import os
import sys
import sqlite3
import subprocess
import tempfile
import json
from pathlib import Path
from datetime import datetime
from collections import defaultdict
import concurrent.futures

# Config
NUKE_DIR = Path("/Users/skylar/nuke")
YONO_DIR = NUKE_DIR / "yono"
PHOTOS_DB = Path.home() / "Pictures" / "Photos Library.photoslibrary" / "database" / "Photos.sqlite"
PHOTOS_ORIGINALS = Path.home() / "Pictures" / "Photos Library.photoslibrary" / "originals"
MODEL_PATH = YONO_DIR / "outputs" / "phase5_final_20260204_231224" / "best_model.pt"
LABELS_PATH = YONO_DIR / "outputs" / "phase5_final_20260204_231224" / "labels.json"
OUTPUT_DIR = YONO_DIR / "library_scan"
CACHE_DIR = YONO_DIR / ".scan_cache"

# Thresholds
CONFIDENCE_THRESHOLD = 0.3  # Low threshold to catch all automotive
AUTOMOTIVE_MAKES = None  # Will be loaded from labels

def load_model():
    """Load YONO model and labels"""
    global AUTOMOTIVE_MAKES

    import torch
    import timm

    with open(LABELS_PATH) as f:
        labels = json.load(f)

    # All labels except obvious non-automotive
    non_automotive = {'.5', '1/2', '42k-Mile', 'AC', 'and', 'No', 'Unknown', 'Custom',
                      'Factory', 'Local', 'Electric', 'Classic', 'Vintage', 'Century'}
    AUTOMOTIVE_MAKES = {v: int(k) for k, v in labels.items() if v not in non_automotive}

    # Load model
    device = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")

    num_classes = len(labels)
    model = timm.create_model("efficientnet_b0", pretrained=False, num_classes=num_classes)
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
    model = model.to(device)
    model.eval()

    return model, labels, device


def get_all_photos():
    """Get all photos and videos from Photos library"""
    conn = sqlite3.connect(str(PHOTOS_DB))
    cur = conn.cursor()

    # Get photos
    cur.execute("""
        SELECT
            Z_PK,
            ZFILENAME,
            ZDIRECTORY,
            datetime(ZDATECREATED + 978307200, 'unixepoch') as taken_at,
            ZKIND,
            ZDURATION
        FROM ZASSET
        WHERE ZTRASHEDSTATE = 0
        ORDER BY ZDATECREATED DESC
    """)

    results = cur.fetchall()
    conn.close()

    photos = []
    videos = []

    for row in results:
        pk, filename, directory, taken_at, kind, duration = row

        # Find file path
        path = find_photo_path(filename, directory)
        if not path:
            continue

        item = {
            'pk': pk,
            'filename': filename,
            'path': str(path),
            'taken_at': taken_at,
            'kind': kind,
            'duration': duration
        }

        if kind == 0:  # Photo
            photos.append(item)
        elif kind == 1:  # Video
            videos.append(item)

    return photos, videos


def find_photo_path(filename, directory):
    """Find actual file path for a photo"""
    if not filename:
        return None

    # Try direct path
    if directory:
        path = PHOTOS_ORIGINALS / directory / filename
        if path.exists():
            return path

    # Search in subdirectories
    for subdir in PHOTOS_ORIGINALS.iterdir():
        if subdir.is_dir():
            path = subdir / filename
            if path.exists():
                return path

    return None


def convert_to_jpeg(input_path, output_path):
    """Convert HEIC/other formats to JPEG"""
    try:
        subprocess.run([
            "sips", "-s", "format", "jpeg",
            "-Z", "512",  # Resize to 512 max dimension for speed
            str(input_path), "--out", str(output_path)
        ], capture_output=True, check=True, timeout=30)
        return True
    except:
        return False


def extract_video_keyframes(video_path, output_dir, max_frames=5):
    """Extract keyframes from video"""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Get video duration
        result = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)
        ], capture_output=True, text=True, timeout=30)

        duration = float(result.stdout.strip() or 0)
        if duration <= 0:
            return []

        # Calculate frame times (evenly spaced)
        frame_times = [duration * i / (max_frames + 1) for i in range(1, max_frames + 1)]

        frames = []
        for i, t in enumerate(frame_times):
            output_path = output_dir / f"frame_{i:02d}.jpg"
            subprocess.run([
                "ffmpeg", "-y", "-ss", str(t), "-i", str(video_path),
                "-vframes", "1", "-q:v", "2", "-vf", "scale=512:-1",
                str(output_path)
            ], capture_output=True, timeout=30)

            if output_path.exists():
                frames.append(str(output_path))

        return frames
    except Exception as e:
        print(f"  Error extracting frames: {e}")
        return []


def classify_image(model, device, image_path, labels):
    """Classify single image"""
    import torch
    from PIL import Image
    from torchvision import transforms

    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    try:
        # Convert if HEIC
        if str(image_path).lower().endswith('.heic'):
            cache_path = CACHE_DIR / f"{Path(image_path).stem}.jpg"
            cache_path.parent.mkdir(parents=True, exist_ok=True)

            if not cache_path.exists():
                if not convert_to_jpeg(image_path, cache_path):
                    return None, 0
            image_path = cache_path

        img = Image.open(image_path).convert('RGB')
        img_tensor = transform(img).unsqueeze(0).to(device)

        with torch.no_grad():
            outputs = model(img_tensor)
            probs = torch.softmax(outputs, dim=1)
            confidence, predicted = torch.max(probs, 1)

        predicted_label = labels[str(predicted.item())]
        return predicted_label, float(confidence.item())

    except Exception as e:
        return None, 0


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, help="Limit number of items to process")
    parser.add_argument("--photos-only", action="store_true", help="Skip videos")
    parser.add_argument("--videos-only", action="store_true", help="Skip photos")
    parser.add_argument("--resume", action="store_true", help="Resume from previous scan")
    args = parser.parse_args()

    print("=" * 60)
    print("YONO Photo Library Scanner")
    print(f"Started: {datetime.now().isoformat()}")
    print("=" * 60)

    # Load model
    print("\nLoading YONO model...")
    model, labels, device = load_model()
    print(f"Model loaded: {len(labels)} classes")

    # Get all photos/videos
    print("\nScanning Photos library...")
    photos, videos = get_all_photos()
    print(f"Found: {len(photos):,} photos, {len(videos):,} videos")

    # Apply limits
    if args.limit:
        photos = photos[:args.limit]
        videos = videos[:args.limit]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Load previous results if resuming
    results_file = OUTPUT_DIR / "scan_results.json"
    if args.resume and results_file.exists():
        with open(results_file) as f:
            results = json.load(f)
        processed_pks = {r['pk'] for r in results.get('photos', []) + results.get('videos', [])}
        photos = [p for p in photos if p['pk'] not in processed_pks]
        videos = [v for v in videos if v['pk'] not in processed_pks]
        print(f"Resuming: {len(processed_pks)} already processed")
    else:
        results = {'photos': [], 'videos': [], 'automotive_count': 0}

    # Process photos
    if not args.videos_only:
        print(f"\nProcessing {len(photos):,} photos...")

        for i, photo in enumerate(photos):
            if i % 100 == 0:
                print(f"  [{i:,}/{len(photos):,}] {results['automotive_count']} automotive found")
                # Save progress
                with open(results_file, 'w') as f:
                    json.dump(results, f)

            make, conf = classify_image(model, device, photo['path'], labels)

            if make and conf >= CONFIDENCE_THRESHOLD and make in AUTOMOTIVE_MAKES:
                results['photos'].append({
                    'pk': photo['pk'],
                    'filename': photo['filename'],
                    'path': photo['path'],
                    'taken_at': photo['taken_at'],
                    'make': make,
                    'confidence': conf
                })
                results['automotive_count'] += 1

    # Process videos
    if not args.photos_only:
        print(f"\nProcessing {len(videos):,} videos...")

        for i, video in enumerate(videos):
            if i % 10 == 0:
                print(f"  [{i:,}/{len(videos):,}]")

            # Extract keyframes
            frames_dir = CACHE_DIR / f"video_{video['pk']}"
            frames = extract_video_keyframes(video['path'], frames_dir)

            if not frames:
                continue

            # Classify each frame, take best
            best_make = None
            best_conf = 0

            for frame in frames:
                make, conf = classify_image(model, device, frame, labels)
                if make and conf > best_conf:
                    best_make = make
                    best_conf = conf

            if best_make and best_conf >= CONFIDENCE_THRESHOLD and best_make in AUTOMOTIVE_MAKES:
                results['videos'].append({
                    'pk': video['pk'],
                    'filename': video['filename'],
                    'path': video['path'],
                    'taken_at': video['taken_at'],
                    'duration': video['duration'],
                    'make': best_make,
                    'confidence': best_conf,
                    'frame_count': len(frames)
                })
                results['automotive_count'] += 1

    # Final save
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2)

    # Summary
    print("\n" + "=" * 60)
    print("SCAN COMPLETE")
    print("=" * 60)
    print(f"Total automotive content: {results['automotive_count']:,}")
    print(f"  Photos: {len(results['photos']):,}")
    print(f"  Videos: {len(results['videos']):,}")

    # Make distribution
    make_counts = defaultdict(int)
    for item in results['photos'] + results['videos']:
        make_counts[item['make']] += 1

    print("\nTop makes detected:")
    for make, count in sorted(make_counts.items(), key=lambda x: -x[1])[:15]:
        print(f"  {make}: {count:,}")

    print(f"\nResults saved to: {results_file}")
    print("\nNext: Run import_to_nuke.py to create vehicle records")


if __name__ == "__main__":
    main()
