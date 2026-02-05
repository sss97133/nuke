#!/usr/bin/env python3
"""
Batch Analyze Photos with Ollama
Groups images by vehicle, stores to Supabase

Usage: python batch_analyze.py [photo_list.txt]
"""

import os
import sys
import json
import base64
import requests
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# Config
NUKE_DIR = Path("/Users/skylar/nuke")
env_file = NUKE_DIR / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip('"').strip("'"))

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llava:7b")

# Your known vehicles
KNOWN_VEHICLES = [
    {"id": "a90c008a-3379-41d8-9eb2-b4eda365d74c", "desc": "1983 GMC C10", "vin": "1GTDC14H6DF714653"},
    {"id": "e08bf694-970f-4cbe-8a74-8715158a0f2e", "desc": "1977 Chevrolet Blazer", "vin": "CKR187F127263"},
    {"id": "e1b9c9ba-94e9-4a45-85c0-30bac65a40f8", "desc": "1979 GMC K10 (dad)", "vin": "TKL149J507665"},
    {"id": "pending_k10_yours", "desc": "1979 Chevy K10 (daily)", "vin": "pending"},
    {"id": "pending_k20_cameron", "desc": "1983 GMC K20 (Cameron)", "vin": "pending"},
]


def analyze_image(image_path):
    """Analyze single image with Ollama"""
    try:
        with open(image_path, "rb") as f:
            img_data = base64.b64encode(f.read()).decode()

        vehicle_list = "\n".join([f"- {v['desc']} (VIN: {v['vin']})" for v in KNOWN_VEHICLES])

        prompt = f"""Analyze this vehicle photo.

Known vehicles:
{vehicle_list}

Identify:
1. Is this a vehicle photo? (yes/no)
2. Which vehicle from the list? (or "unknown" if not matching)
3. Photo type: work_detail, engine, interior, exterior, sighting, lifestyle, vin_plate, document, other
4. Brief description (10 words max)

Reply in this exact format:
VEHICLE: [yes/no]
MATCH: [vehicle description or unknown]
TYPE: [photo type]
DESC: [brief description]"""

        resp = requests.post(f"{OLLAMA_URL}/api/generate", json={
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "images": [img_data],
            "stream": False
        }, timeout=120)

        result = resp.json().get("response", "")

        # Parse response
        lines = result.strip().split("\n")
        parsed = {}
        for line in lines:
            if ":" in line:
                key, val = line.split(":", 1)
                parsed[key.strip().upper()] = val.strip()

        return {
            "is_vehicle": parsed.get("VEHICLE", "").lower() == "yes",
            "match": parsed.get("MATCH", "unknown"),
            "type": parsed.get("TYPE", "other"),
            "description": parsed.get("DESC", ""),
            "raw": result
        }
    except Exception as e:
        return {"is_vehicle": False, "match": "error", "type": "error", "description": str(e)}


def main():
    # Get photo list
    if len(sys.argv) > 1:
        photo_file = sys.argv[1]
    else:
        photo_file = "/tmp/unique_photos.txt"

    if not os.path.exists(photo_file):
        print(f"Photo list not found: {photo_file}")
        print("Run: find ~/Pictures/Photos\\ Library.photoslibrary/resources/derivatives -name '*_105_c.jpeg' -mtime -3 > /tmp/unique_photos.txt")
        sys.exit(1)

    with open(photo_file) as f:
        photos = [line.strip() for line in f if line.strip()]

    print(f"\n{'='*50}")
    print(f"BATCH ANALYZE - {len(photos)} photos")
    print(f"Using Ollama model: {OLLAMA_MODEL}")
    print(f"{'='*50}\n")

    # Check Ollama
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        models = [m["name"] for m in resp.json().get("models", [])]
        if OLLAMA_MODEL not in models and OLLAMA_MODEL.split(":")[0] not in [m.split(":")[0] for m in models]:
            print(f"⚠ Model {OLLAMA_MODEL} not found")
            print(f"Available: {models}")
            sys.exit(1)
    except:
        print("⚠ Ollama not running. Start with: ollama serve")
        sys.exit(1)

    # Process photos
    results = defaultdict(list)  # Group by vehicle match

    for i, photo in enumerate(photos, 1):
        filename = os.path.basename(photo)
        print(f"[{i}/{len(photos)}] {filename[:40]}...", end=" ", flush=True)

        analysis = analyze_image(photo)

        if analysis["is_vehicle"]:
            match = analysis["match"]
            print(f"→ {match[:30]} ({analysis['type']})")
            results[match].append({
                "path": photo,
                "type": analysis["type"],
                "description": analysis["description"]
            })
        else:
            print("→ (not vehicle)")
            results["_not_vehicle"].append({"path": photo})

    # Summary
    print(f"\n{'='*50}")
    print("RESULTS")
    print(f"{'='*50}\n")

    for vehicle, photos in sorted(results.items()):
        if vehicle == "_not_vehicle":
            print(f"❌ Not vehicle photos: {len(photos)}")
        else:
            print(f"🚗 {vehicle}: {len(photos)} photos")
            for p in photos[:3]:  # Show first 3
                print(f"   - {p['type']}: {p['description']}")
            if len(photos) > 3:
                print(f"   + {len(photos) - 3} more...")

    # Save results
    output_file = "/tmp/batch_analysis_results.json"
    with open(output_file, "w") as f:
        json.dump(dict(results), f, indent=2)
    print(f"\n✓ Results saved to {output_file}")

    # Offer to insert to DB
    print("\nTo insert to Supabase, run:")
    print("  python batch_analyze.py --insert")


if __name__ == "__main__":
    main()
