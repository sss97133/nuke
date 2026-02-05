#!/usr/bin/env python3
"""
Work Session - Local image intake with Ollama

Run: python work_session.py

Flow:
1. Asks which vehicle
2. You confirm
3. Drag/drop or paste image paths
4. Ollama analyzes locally
5. Uploads to Supabase
"""

import os
import sys
import json
import base64
import requests
from pathlib import Path
from datetime import datetime

# Load env
NUKE_DIR = Path("/Users/skylar/nuke")
env_file = NUKE_DIR / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip('"').strip("'"))

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llava:7b")

# Your tech link ID (from DB)
TECH_LINK_ID = "8cd1740d-e806-45f8-b303-863336e81668"
USER_ID = "13450c45-3e8b-4124-9f5b-5c512094ff04"


def supabase_query(table, method="GET", data=None, params=None):
    """Simple Supabase REST API call"""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    if method == "GET":
        resp = requests.get(url, headers=headers)
    elif method == "POST":
        resp = requests.post(url, headers=headers, json=data)
    elif method == "PATCH":
        resp = requests.patch(url, headers=headers, json=data)

    return resp.json() if resp.text else None


def get_my_vehicles():
    """Get vehicles I'm assigned to or have worked on"""
    # Get from assignments
    assigned = supabase_query("vehicle_tech_assignments", params={
        "technician_phone_link_id": f"eq.{TECH_LINK_ID}",
        "status": "eq.active",
        "select": "vehicle_id,vehicles(id,year,make,model,vin)"
    })

    # Get from recent work
    recent = supabase_query("sms_work_submissions", params={
        "technician_phone_link_id": f"eq.{TECH_LINK_ID}",
        "order": "created_at.desc",
        "limit": "10",
        "select": "detected_vehicle_id,vehicles(id,year,make,model,vin)"
    })

    # Combine
    vehicles = {}
    for item in (assigned or []):
        v = item.get("vehicles")
        if v and v.get("id"):
            vehicles[v["id"]] = v

    for item in (recent or []):
        v = item.get("vehicles")
        if v and v.get("id"):
            vehicles[v["id"]] = v

    return list(vehicles.values())


def search_vehicle(query):
    """Search for vehicle by year/make/model or VIN"""
    # Try VIN first
    if len(query) >= 6:
        results = supabase_query("vehicles", params={
            "vin": f"ilike.*{query}*",
            "select": "id,year,make,model,vin",
            "limit": "5"
        })
        if results:
            return results

    # Parse year/make/model
    words = query.lower().split()
    params = {"select": "id,year,make,model,vin", "limit": "10"}

    # Look for year
    for w in words:
        if w.isdigit() and len(w) == 4:
            params["year"] = f"eq.{w}"
            break

    # Look for make
    makes = {"gmc": "gmc", "chevy": "chevrolet", "chevrolet": "chevrolet",
             "ford": "ford", "dodge": "dodge", "toyota": "toyota"}
    for w in words:
        if w in makes:
            params["make"] = f"ilike.%{makes[w]}%"
            break

    return supabase_query("vehicles", params=params)


def analyze_image_ollama(image_path, vehicle_name, context=""):
    """Analyze image using Ollama locally"""
    try:
        # Read and encode image
        with open(image_path, "rb") as f:
            img_data = base64.b64encode(f.read()).decode()

        prompt = f"""Analyzing work photo for: {vehicle_name}
{context}

Describe:
1. What part/area of vehicle is shown
2. What condition or work is documented
3. Any issues visible (rust, damage, wear)

Be brief and factual."""

        resp = requests.post(f"{OLLAMA_URL}/api/generate", json={
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "images": [img_data],
            "stream": False
        }, timeout=60)

        result = resp.json()
        return result.get("response", "Analysis unavailable")

    except Exception as e:
        return f"Analysis failed: {e}"


def upload_image_to_supabase(image_path, vehicle_id, analysis):
    """Upload image record to Supabase"""
    # For now just store the local path - actual file upload would need storage API
    image_url = f"file://{image_path}"

    record = {
        "vehicle_id": vehicle_id,
        "image_url": image_url,
        "category": "work",
        "caption": analysis[:200] if analysis else None,
        "metadata": {
            "source": "local_session",
            "local_path": str(image_path),
            "analyzed_at": datetime.now().isoformat(),
            "analysis": analysis
        }
    }

    result = supabase_query("vehicle_images", method="POST", data=record)
    return result


def main():
    print("\n" + "="*50)
    print("WORK SESSION - Image Upload")
    print("="*50 + "\n")

    # Check Ollama
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        models = [m["name"] for m in resp.json().get("models", [])]
        if OLLAMA_MODEL.split(":")[0] not in [m.split(":")[0] for m in models]:
            print(f"⚠ Model {OLLAMA_MODEL} not found. Available: {models}")
            print(f"  Run: ollama pull {OLLAMA_MODEL}")
    except:
        print("⚠ Ollama not running. Start with: ollama serve")
        print("  Analysis will be skipped.\n")

    # Step 1: Which vehicle?
    print("Which vehicle are you working on?\n")

    vehicles = get_my_vehicles()
    if vehicles:
        print("Your vehicles:")
        for i, v in enumerate(vehicles[:10], 1):
            vin_short = f" ({v['vin'][-6:]})" if v.get('vin') else ""
            print(f"  {i}. {v['year']} {v['make']} {v['model']}{vin_short}")
        print("\nEnter number, or type year/make/model:")
    else:
        print("No assigned vehicles found.")
        print("Enter year/make/model or VIN:")

    # Step 2: Get selection
    selection = input("\n> ").strip()

    vehicle = None

    # Check if number
    if selection.isdigit():
        idx = int(selection) - 1
        if 0 <= idx < len(vehicles):
            vehicle = vehicles[idx]

    # Search if not found
    if not vehicle:
        results = search_vehicle(selection)
        if results and len(results) == 1:
            vehicle = results[0]
        elif results and len(results) > 1:
            print("\nMultiple matches:")
            for i, v in enumerate(results[:5], 1):
                vin_short = f" ({v['vin'][-6:]})" if v.get('vin') else ""
                print(f"  {i}. {v['year']} {v['make']} {v['model']}{vin_short}")
            sel2 = input("\nWhich one? > ").strip()
            if sel2.isdigit():
                idx = int(sel2) - 1
                if 0 <= idx < len(results):
                    vehicle = results[idx]

    if not vehicle:
        print("❌ Vehicle not found. Try again with VIN or exact year/make/model.")
        return

    vehicle_name = f"{vehicle['year']} {vehicle['make']} {vehicle['model']}"
    print(f"\n✓ Working on: {vehicle_name}")
    if vehicle.get('vin'):
        print(f"  VIN: {vehicle['vin']}")

    # Step 3: Get images
    print("\n" + "-"*50)
    print("Paste image paths (one per line), or drag files here.")
    print("Enter blank line when done.")
    print("-"*50 + "\n")

    image_paths = []
    while True:
        line = input().strip()
        if not line:
            break
        # Handle drag-drop escaping
        path = line.replace("\\ ", " ").strip("'\"")
        if os.path.exists(path):
            image_paths.append(path)
            print(f"  + {os.path.basename(path)}")
        else:
            print(f"  ✗ Not found: {path}")

    if not image_paths:
        print("No images added.")
        return

    print(f"\n{len(image_paths)} images to process...")

    # Step 4: Analyze and upload
    results = []
    for i, img_path in enumerate(image_paths, 1):
        print(f"\n[{i}/{len(image_paths)}] {os.path.basename(img_path)}")

        # Analyze with Ollama
        print("  Analyzing...", end=" ", flush=True)
        analysis = analyze_image_ollama(img_path, vehicle_name)
        print("done")

        # Show brief analysis
        brief = analysis[:100] + "..." if len(analysis) > 100 else analysis
        print(f"  → {brief}")

        # Upload record
        upload_image_to_supabase(img_path, vehicle['id'], analysis)
        results.append({"path": img_path, "analysis": analysis})

    # Step 5: Recap
    print("\n" + "="*50)
    print("SESSION COMPLETE")
    print("="*50)
    print(f"\nVehicle: {vehicle_name}")
    print(f"Images: {len(results)}")

    # Create timeline event
    timeline_event = {
        "vehicle_id": vehicle['id'],
        "event_type": "work_documented",
        "event_title": f"{len(results)} photos logged",
        "event_date": datetime.now().isoformat(),
        "source_type": "local_session",
        "metadata": {
            "image_count": len(results),
            "session_date": datetime.now().isoformat()
        }
    }
    supabase_query("vehicle_timeline", method="POST", data=timeline_event)

    print("\n✓ Saved to database")


if __name__ == "__main__":
    main()
