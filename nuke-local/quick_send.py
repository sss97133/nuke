#!/usr/bin/env python3
"""
Quick Send - Drop photos to DB instantly
Usage:
  python quick_send.py photo.jpg
  python quick_send.py *.jpg
  python quick_send.py /path/to/folder/
"""

import os
import sys
import json
import requests
from pathlib import Path
from datetime import datetime

# Load env
NUKE_DIR = Path("/Users/skylar/nuke")
for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    key, _, val = line.partition("=")
    os.environ.setdefault(key.strip(), val.strip('"').strip("'"))

SUPABASE_URL = os.environ["VITE_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
USER_ID = "13450c45-3e8b-4124-9f5b-5c512094ff04"

def send_photo(path):
    """Send single photo to inbox"""
    path = Path(path).resolve()
    if not path.exists():
        return False, "not found"

    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/photo_inbox",
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        json={
            "user_id": USER_ID,
            "image_data": f"file://{path}",
            "source": "quick_send"
        },
        timeout=5
    )

    if resp.status_code in (200, 201):
        return True, "ok"
    return False, resp.text[:50]

def main():
    if len(sys.argv) < 2:
        print("Usage: python quick_send.py <photo(s)>")
        sys.exit(1)

    files = []
    for arg in sys.argv[1:]:
        p = Path(arg)
        if p.is_dir():
            files.extend(p.glob("*.jpg"))
            files.extend(p.glob("*.jpeg"))
            files.extend(p.glob("*.png"))
            files.extend(p.glob("*.heic"))
        elif p.exists():
            files.append(p)

    if not files:
        print("No images found")
        sys.exit(1)

    print(f"Sending {len(files)} photos...")

    ok = 0
    for f in files:
        success, msg = send_photo(f)
        if success:
            ok += 1
            print(f"  ✓ {f.name}")
        else:
            print(f"  ✗ {f.name}: {msg}")

    print(f"\nDone: {ok}/{len(files)}")

if __name__ == "__main__":
    main()
