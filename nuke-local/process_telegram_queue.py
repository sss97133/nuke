#!/usr/bin/env python3
"""
Process Telegram Webhook Queue

Picks up raw webhooks from telegram_raw_webhooks table,
downloads photos, uploads to storage, queues for processing.

Run: python process_telegram_queue.py
Cron: * * * * * cd /Users/skylar/nuke && python nuke-local/process_telegram_queue.py
"""

import os
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
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN") or os.environ.get("NUKE_TELEGRAM_BOT_TOKEN")
BUCKET = "vehicle-photos"
DEFAULT_USER_ID = "13450c45-3e8b-4124-9f5b-5c512094ff04"

headers = {
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "apikey": SUPABASE_KEY,
    "Content-Type": "application/json",
}

def get_pending_webhooks():
    """Fetch unprocessed webhooks"""
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/telegram_raw_webhooks",
        headers=headers,
        params={"processed": "eq.false", "limit": "50", "order": "received_at.asc"}
    )
    return resp.json() if resp.status_code == 200 else []

def mark_processed(webhook_id, error=None):
    """Mark webhook as processed"""
    data = {"processed": True}
    if error:
        data["error"] = str(error)[:500]

    requests.patch(
        f"{SUPABASE_URL}/rest/v1/telegram_raw_webhooks",
        headers=headers,
        params={"id": f"eq.{webhook_id}"},
        json=data
    )

def download_telegram_photo(file_id):
    """Download photo from Telegram"""
    # Get file path
    resp = requests.get(f"https://api.telegram.org/bot{BOT_TOKEN}/getFile?file_id={file_id}")
    data = resp.json()

    if not data.get("ok") or not data.get("result", {}).get("file_path"):
        return None, "getFile failed"

    file_path = data["result"]["file_path"]

    # Download file
    file_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}"
    resp = requests.get(file_url)

    if resp.status_code != 200:
        return None, f"download failed: {resp.status_code}"

    return resp.content, file_path

def upload_to_storage(data, filename):
    """Upload to Supabase storage"""
    date_prefix = datetime.now().strftime("%Y-%m")
    storage_path = f"{DEFAULT_USER_ID}/{date_prefix}/{int(datetime.now().timestamp())}_{filename}"

    resp = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{storage_path}",
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
            "Content-Type": "image/jpeg",
            "x-upsert": "true"
        },
        data=data,
        timeout=60
    )

    if resp.status_code not in (200, 201):
        return None, f"upload failed: {resp.status_code}"

    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{storage_path}", None

def queue_photo(image_url, source="telegram", notes=None):
    """Add to photo_inbox"""
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/photo_inbox",
        headers=headers,
        json={
            "user_id": DEFAULT_USER_ID,
            "image_data": image_url,
            "source": source,
            "notes": notes,
            "processed": False
        }
    )
    return resp.status_code in (200, 201)

def send_telegram_message(chat_id, text):
    """Send message to user"""
    requests.post(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        json={"chat_id": chat_id, "text": text}
    )

def process_webhook(webhook):
    """Process single webhook"""
    payload = webhook.get("payload", {})
    message = payload.get("message", {})

    if not message:
        return None  # Not a message, skip

    chat_id = message.get("chat", {}).get("id")
    photos = message.get("photo", [])
    caption = message.get("caption", "")

    if not photos:
        return None  # No photo, skip

    # Get highest resolution
    photo = photos[-1]
    file_id = photo.get("file_id")

    if not file_id:
        return "no file_id"

    # Download from Telegram
    data, err = download_telegram_photo(file_id)
    if err:
        if chat_id:
            send_telegram_message(chat_id, f"DL fail: {err}")
        return err

    # Upload to storage
    filename = f"{file_id[-10:]}.jpg"
    url, err = upload_to_storage(data, filename)
    if err:
        if chat_id:
            send_telegram_message(chat_id, f"UP fail: {err}")
        return err

    # Queue for processing
    if queue_photo(url, "telegram", caption or None):
        if chat_id:
            send_telegram_message(chat_id, "✓")
        return None
    else:
        if chat_id:
            send_telegram_message(chat_id, "Q fail")
        return "queue failed"

def main():
    if not BOT_TOKEN:
        print("No TELEGRAM_BOT_TOKEN set")
        return

    webhooks = get_pending_webhooks()
    if not webhooks:
        print("No pending webhooks")
        return

    print(f"Processing {len(webhooks)} webhooks...")

    success = 0
    errors = 0
    skipped = 0

    for wh in webhooks:
        wh_id = wh["id"]
        err = process_webhook(wh)

        if err is None:
            # Check if it was a photo or just skipped
            if wh.get("payload", {}).get("message", {}).get("photo"):
                success += 1
            else:
                skipped += 1
            mark_processed(wh_id)
        else:
            errors += 1
            mark_processed(wh_id, err)

    print(f"Done: {success} photos, {skipped} skipped, {errors} errors")

if __name__ == "__main__":
    main()
