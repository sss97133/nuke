#!/usr/bin/env python3
"""
Watch folder for new photos, auto-send to DB
Usage: python watch_photos.py [folder]
Default: ~/Desktop/nuke-inbox
"""

import os
import sys
import time
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

EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".webp"}

def send_photo(path):
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
            "source": "watch_folder"
        },
        timeout=5
    )
    return resp.status_code in (200, 201)

def main():
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "~/Desktop/nuke-inbox").expanduser()
    folder.mkdir(exist_ok=True)

    print(f"Watching: {folder}")
    print("Drop photos here to auto-send. Ctrl+C to stop.\n")

    seen = set()
    # Init with existing files
    for f in folder.iterdir():
        if f.suffix.lower() in EXTENSIONS:
            seen.add(f.name)

    while True:
        try:
            for f in folder.iterdir():
                if f.suffix.lower() in EXTENSIONS and f.name not in seen:
                    seen.add(f.name)
                    if send_photo(f):
                        print(f"✓ {f.name}")
                        # Move to processed subfolder
                        done = folder / "sent"
                        done.mkdir(exist_ok=True)
                        f.rename(done / f.name)
                    else:
                        print(f"✗ {f.name}")
            time.sleep(1)
        except KeyboardInterrupt:
            print("\nStopped")
            break

if __name__ == "__main__":
    main()
