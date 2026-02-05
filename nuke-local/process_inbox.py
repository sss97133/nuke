#!/usr/bin/env python3
"""
Process photo inbox with Ollama
Auto-assigns high confidence, flags low for review
Notifies user when review needed

Run: python process_inbox.py
Cron: */15 * * * * cd /Users/skylar/nuke && python nuke-local/process_inbox.py
"""

import os
import json
import base64
import requests
from pathlib import Path
from datetime import datetime

# Config
NUKE_DIR = Path("/Users/skylar/nuke")
for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    key, _, val = line.partition("=")
    os.environ.setdefault(key.strip(), val.strip('"').strip("'"))

SUPABASE_URL = os.environ["VITE_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llava:7b")
TWILIO_SID = os.environ.get("TWILIO_ACCOUNT_SID")
TWILIO_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")
TWILIO_FROM = os.environ.get("TWILIO_PHONE_NUMBER")
USER_PHONE = "+17026246793"

CONFIDENCE_THRESHOLD = 0.7  # Below this = needs review

# Known vehicles
VEHICLES = [
    {"id": "a90c008a-3379-41d8-9eb2-b4eda365d74c", "name": "1983 GMC C10", "vin": "1GTDC14H6DF714653", "keywords": ["c10", "1983", "gmc c10", "red", "stepside"]},
    {"id": "e08bf694-970f-4cbe-8a74-8715158a0f2e", "name": "1977 Chevy Blazer", "vin": "CKR187F127263", "keywords": ["blazer", "k5", "1977", "77"]},
    {"id": "e1b9c9ba-94e9-4a45-85c0-30bac65a40f8", "name": "1979 GMC K10 (dad)", "vin": "TKL149J507665", "keywords": ["k10", "1979", "79", "gmc", "shortbed", "dad"]},
    {"id": "pending_k10_yours", "name": "1979 Chevy K10 (daily)", "vin": "pending", "keywords": ["k10", "daily", "driver", "chevy"]},
    {"id": "pending_k20_cameron", "name": "1983 GMC K20 (Cameron)", "vin": "pending", "keywords": ["k20", "cameron", "1983"]},
]

def get_pending_photos():
    """Fetch unprocessed photos from inbox"""
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/photo_inbox",
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
        },
        params={"processed": "eq.false", "limit": "20"}
    )
    return resp.json() if resp.status_code == 200 else []

def analyze_photo(image_path):
    """Run Ollama analysis, return match and confidence"""
    path = image_path.replace("file://", "")
    if not os.path.exists(path):
        return None, 0, "file not found"

    try:
        with open(path, "rb") as f:
            img_data = base64.b64encode(f.read()).decode()
    except:
        return None, 0, "read error"

    vehicle_list = "\n".join([f"- {v['name']} (VIN: {v['vin']})" for v in VEHICLES])

    prompt = f"""Identify the vehicle in this photo.

Known vehicles:
{vehicle_list}

Reply with ONLY:
MATCH: [vehicle name from list, or "unknown"]
CONFIDENCE: [0.0-1.0 how certain]
TYPE: [engine/interior/exterior/vin_plate/work_detail/sighting/other]"""

    try:
        resp = requests.post(f"{OLLAMA_URL}/api/generate", json={
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "images": [img_data],
            "stream": False
        }, timeout=120)

        result = resp.json().get("response", "")

        # Parse response
        match = "unknown"
        confidence = 0.0
        photo_type = "other"

        for line in result.strip().split("\n"):
            if ":" in line:
                key, val = line.split(":", 1)
                key = key.strip().upper()
                val = val.strip()
                if key == "MATCH":
                    match = val
                elif key == "CONFIDENCE":
                    try:
                        confidence = float(val.replace("%", "").strip())
                        if confidence > 1:
                            confidence /= 100
                    except:
                        confidence = 0.5
                elif key == "TYPE":
                    photo_type = val.lower()

        # Match to vehicle ID
        vehicle_id = None
        for v in VEHICLES:
            if v["name"].lower() in match.lower():
                vehicle_id = v["id"] if not v["id"].startswith("pending") else None
                break
            for kw in v["keywords"]:
                if kw in match.lower():
                    vehicle_id = v["id"] if not v["id"].startswith("pending") else None
                    break

        return vehicle_id, confidence, match

    except Exception as e:
        return None, 0, str(e)

def update_photo(photo_id, vehicle_id, confidence, ai_match, needs_review):
    """Update photo record"""
    data = {
        "processed": True,
        "confidence": confidence,
        "ai_match": ai_match,
        "needs_review": needs_review,
    }
    if vehicle_id and not needs_review:
        data["vehicle_id"] = vehicle_id

    requests.patch(
        f"{SUPABASE_URL}/rest/v1/photo_inbox",
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        params={"id": f"eq.{photo_id}"},
        json=data
    )

def get_review_count():
    """Count photos needing review"""
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/photo_inbox",
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
            "Prefer": "count=exact"
        },
        params={"needs_review": "eq.true", "select": "id"}
    )
    # Get count from header
    count = resp.headers.get("content-range", "0-0/0").split("/")[-1]
    return int(count) if count.isdigit() else len(resp.json())

def send_notification(count):
    """Send SMS when review needed"""
    if not all([TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM]):
        print(f"[!] Would notify: {count} photos need review (Twilio not configured)")
        return

    try:
        requests.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
            auth=(TWILIO_SID, TWILIO_TOKEN),
            data={
                "From": TWILIO_FROM,
                "To": USER_PHONE,
                "Body": f"Nuke: {count} photos need vehicle assignment. Reply REVIEW to see them."
            }
        )
        print(f"[+] Notified user: {count} photos need review")
    except Exception as e:
        print(f"[!] Notification failed: {e}")

def main():
    # Check Ollama
    try:
        requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
    except:
        print("[!] Ollama not running")
        return

    photos = get_pending_photos()
    if not photos:
        print("[.] No pending photos")
        return

    print(f"[*] Processing {len(photos)} photos...")

    auto_assigned = 0
    flagged = 0

    for photo in photos:
        image_path = photo.get("image_data", "")
        filename = image_path.split("/")[-1][:30]

        vehicle_id, confidence, ai_match = analyze_photo(image_path)
        needs_review = confidence < CONFIDENCE_THRESHOLD or vehicle_id is None

        update_photo(photo["id"], vehicle_id, confidence, ai_match, needs_review)

        if needs_review:
            flagged += 1
            print(f"  ? {filename} → {ai_match} ({confidence:.0%}) [REVIEW]")
        else:
            auto_assigned += 1
            print(f"  ✓ {filename} → {ai_match} ({confidence:.0%})")

    print(f"\n[*] Auto-assigned: {auto_assigned}, Flagged: {flagged}")

    # Check if notification needed
    review_count = get_review_count()
    if review_count >= 5:  # Notify when 5+ pending
        send_notification(review_count)

if __name__ == "__main__":
    main()
