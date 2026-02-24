#!/usr/bin/env python3
"""
Ingest KSL (and other) listing alert emails from Apple Mail into Nuke import_queue.

Reads the local Apple Mail SQLite database, finds alert emails sent to
toymachine91@gmail.com, decodes Mailgun tracking redirects to extract
actual listing URLs, and inserts them into import_queue via Supabase.

Usage:
    # Dry run (show what would be ingested)
    python3 scripts/ingest-mail-alerts.py --dry-run

    # Ingest all unprocessed alerts
    python3 scripts/ingest-mail-alerts.py

    # Ingest only last N days
    python3 scripts/ingest-mail-alerts.py --days 7
"""

import base64
import email
import email.policy
import json
import os
import re
import sqlite3
import subprocess
import sys
import urllib.parse
import zlib
from datetime import datetime, timedelta
from pathlib import Path

# ─── Config ──────────────────────────────────────────────────────────

MAIL_DB = Path.home() / "Library/Mail/V10/MailData/Envelope Index"
MAIL_DIR = Path.home() / "Library/Mail/V10"
TARGET_EMAIL = "toymachine91@gmail.com"

# Alert subjects/senders we care about
ALERT_FILTERS = [
    {"subject": "KSL Cars - Saved Search Alert", "sender": "cars@ksl.com", "source": "ksl"},
]

# ─── URL Extraction ──────────────────────────────────────────────────

def decode_mailgun_redirect(encoded_path: str) -> str | None:
    """Decode a Mailgun tracking redirect URL to extract the real destination."""
    try:
        # Strip the /c/ prefix if present
        encoded = encoded_path.split("/c/")[-1] if "/c/" in encoded_path else encoded_path
        # Pad base64
        padding = 4 - len(encoded) % 4
        if padding < 4:
            encoded += "=" * padding
        decoded = base64.urlsafe_b64decode(encoded)
        decompressed = zlib.decompress(decoded).decode("utf-8")
        params = urllib.parse.parse_qs(decompressed)
        if "l" in params:
            url = urllib.parse.unquote(params["l"][0])
            return url.split("?")[0]  # Strip UTM params
    except Exception:
        pass
    return None


def extract_listing_urls_from_emlx(emlx_path: Path, source: str) -> list[dict]:
    """Read an .emlx file and extract listing URLs from its content."""
    try:
        raw = emlx_path.read_bytes()
    except FileNotFoundError:
        return []

    # Skip Apple Mail byte-count header line
    raw = raw.split(b"\n", 1)[1] if b"\n" in raw else raw
    # Remove Apple Mail plist trailer
    end = raw.rfind(b"<?xml")
    if end > 0:
        raw = raw[:end]

    try:
        msg = email.message_from_bytes(raw, policy=email.policy.default)
    except Exception:
        return []

    results = []
    subject = str(msg.get("Subject", ""))

    # Get all text parts
    bodies = []
    for part in msg.walk():
        ct = part.get_content_type()
        if ct in ("text/plain", "text/html"):
            try:
                bodies.append(part.get_content())
            except Exception:
                pass

    full_text = "\n".join(bodies)

    # Strategy 1: Decode Mailgun redirect URLs (email.ksl.com/c/...)
    redirect_pattern = re.compile(r"http://email\.ksl\.com/c/([A-Za-z0-9_\-]+)")
    for match in redirect_pattern.finditer(full_text):
        url = decode_mailgun_redirect(match.group(1))
        if url and is_listing_url(url, source):
            results.append(parse_listing_info(url, subject, source))

    # Strategy 2: Direct listing URLs (fallback)
    if not results:
        direct_patterns = [
            re.compile(r"https?://(?:www\.)?(?:cars\.)?ksl\.com/(?:auto/)?listing/\d+"),
            re.compile(r"https?://(?:www\.)?bringatrailer\.com/(?:listing|auction)/[\w-]+"),
            re.compile(r"https?://(?:www\.)?craigslist\.org/[^\s\"<>]+\.html"),
            re.compile(r"https?://(?:www\.)?ebay\.com/itm/\d+"),
            re.compile(r"https?://(?:www\.)?carsandbids\.com/auctions/[\w-]+"),
        ]
        for pattern in direct_patterns:
            for match in pattern.finditer(full_text):
                url = match.group(0)
                results.append(parse_listing_info(url, subject, source))

    # Deduplicate by URL
    seen = set()
    unique = []
    for r in results:
        if r["url"] not in seen:
            seen.add(r["url"])
            unique.append(r)

    return unique


def is_listing_url(url: str, source: str) -> bool:
    """Check if a URL is actually a vehicle listing (not logo, unsubscribe, etc.)."""
    if source == "ksl":
        return bool(re.search(r"ksl\.com/(?:auto/)?listing/\d+", url))
    return "listing" in url or "auction" in url or "itm" in url


def parse_listing_info(url: str, subject: str, source: str) -> dict:
    """Extract hints (year/make/model) from the email subject."""
    info = {"url": url, "source": source, "subject": subject}

    # Try to parse year/make/model from subject
    # KSL subjects: "KSL Cars - Saved Search Alert" (not useful)
    # The vehicle info is in the email body, we capture what we can
    year_match = re.search(r"\b(19[5-9]\d|20[0-2]\d)\b", subject)
    if year_match:
        info["year"] = int(year_match.group(1))

    return info


# ─── Email body vehicle info extraction ──────────────────────────────

def extract_vehicle_hints_from_emlx(emlx_path: Path) -> list[dict]:
    """Extract vehicle title/price info from email body text."""
    try:
        raw = emlx_path.read_bytes()
    except FileNotFoundError:
        return []

    raw = raw.split(b"\n", 1)[1] if b"\n" in raw else raw
    end = raw.rfind(b"<?xml")
    if end > 0:
        raw = raw[:end]

    try:
        msg = email.message_from_bytes(raw, policy=email.policy.default)
    except Exception:
        return []

    for part in msg.walk():
        if part.get_content_type() == "text/plain":
            try:
                text = part.get_content()
            except Exception:
                continue

            hints = []
            # KSL plain text format:
            # <year> <make> <model> <trim>
            # $X,XXX.XX
            # <city>, <state>
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            for i, line in enumerate(lines):
                # Look for vehicle title lines (start with a year)
                ym = re.match(r"^((?:19|20)\d{2})\s+(.+)$", line)
                if ym:
                    year = int(ym.group(1))
                    title = line
                    price = None
                    # Next non-empty line might be price
                    if i + 1 < len(lines):
                        pm = re.match(r"^\$?([\d,]+(?:\.\d{2})?)", lines[i + 1])
                        if pm:
                            price = float(pm.group(1).replace(",", ""))
                    hints.append({"year": year, "title": title, "price": price})
            return hints
    return []


# ─── Apple Mail Database ─────────────────────────────────────────────

def find_alert_emails(db_path: Path, days: int | None = None) -> list[dict]:
    """Query Apple Mail SQLite DB for alert emails."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    where_clauses = [
        "a.address = ?",
        "s.subject = ?",
    ]
    params: list = [TARGET_EMAIL, ALERT_FILTERS[0]["subject"]]

    if days:
        where_clauses.append(f"m.date_received > unixepoch('now', '-{days} days')")

    query = f"""
        SELECT m.ROWID as msg_id,
               s.subject,
               datetime(m.date_received, 'unixepoch') as received,
               m.date_received as received_ts,
               m.mailbox,
               (SELECT a2.address FROM addresses a2 WHERE a2.ROWID = m.sender) as from_addr
        FROM messages m
        JOIN subjects s ON s.ROWID = m.subject
        JOIN recipients r ON r.message = m.ROWID
        JOIN addresses a ON a.ROWID = r.address
        WHERE {' AND '.join(where_clauses)}
        ORDER BY m.date_received DESC
    """

    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def find_emlx_path(msg_id: int) -> Path | None:
    """Find the .emlx file for a given message ROWID."""
    # Apple Mail stores files in Data/<digit>/<digit>/Messages/<id>.emlx
    # or <id>.partial.emlx
    base = MAIL_DIR
    for account_dir in base.iterdir():
        if not account_dir.is_dir():
            continue
        for emlx in account_dir.rglob(f"{msg_id}.emlx"):
            return emlx
        for emlx in account_dir.rglob(f"{msg_id}.partial.emlx"):
            return emlx
    return None


# ─── Supabase Ingestion ─────────────────────────────────────────────

def get_supabase_config() -> tuple[str, str]:
    """Get Supabase URL and service role key from dotenvx."""
    result = subprocess.run(
        ["dotenvx", "run", "--", "bash", "-c", 'echo "$VITE_SUPABASE_URL|||$SUPABASE_SERVICE_ROLE_KEY"'],
        capture_output=True, text=True,
        cwd=str(Path.home() / "nuke"),
    )
    parts = result.stdout.strip().split("|||")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise RuntimeError("Failed to get Supabase config from dotenvx")
    return parts[0], parts[1]


def check_existing_urls(supabase_url: str, key: str, urls: list[str]) -> set[str]:
    """Check which URLs already exist in import_queue."""
    if not urls:
        return set()

    # Query in batches of 100
    existing = set()
    for i in range(0, len(urls), 100):
        batch = urls[i:i + 100]
        url_filter = ",".join(f'"{u}"' for u in batch)
        resp = subprocess.run(
            ["curl", "-s",
             f"{supabase_url}/rest/v1/import_queue?listing_url=in.({url_filter})&select=listing_url",
             "-H", f"Authorization: Bearer {key}",
             "-H", f"apikey: {key}"],
            capture_output=True, text=True,
        )
        try:
            rows = json.loads(resp.stdout)
            for row in rows:
                existing.add(row["listing_url"])
        except Exception:
            pass

    return existing


def insert_to_queue(supabase_url: str, key: str, items: list[dict]) -> int:
    """Insert items into import_queue, skipping duplicates."""
    if not items:
        return 0

    rows = []
    for item in items:
        row = {
            "listing_url": item["url"],
            "status": "pending",
            "priority": 5,
            "attempts": 0,
            "raw_data": {
                "alert_source": item.get("source", "unknown"),
                "alert_subject": item.get("subject", ""),
                "ingested_via": "email_alert",
                "ingested_at": datetime.now(tz=None).isoformat() + "Z",
                "ingested_by": "ingest-mail-alerts.py",
            },
        }
        if item.get("title"):
            row["listing_title"] = item["title"]
        if item.get("year"):
            row["listing_year"] = item["year"]
        if item.get("price"):
            row["listing_price"] = item["price"]
        rows.append(row)

    # Upsert in batches of 50 (ignore duplicates via on_conflict)
    inserted = 0
    for i in range(0, len(rows), 50):
        batch = rows[i:i + 50]
        payload = json.dumps(batch)
        resp = subprocess.run(
            ["curl", "-s",
             f"{supabase_url}/rest/v1/import_queue?on_conflict=listing_url",
             "-H", f"Authorization: Bearer {key}",
             "-H", f"apikey: {key}",
             "-H", "Content-Type: application/json",
             "-H", "Prefer: resolution=ignore-duplicates,return=minimal",
             "-X", "POST",
             "-d", payload],
            capture_output=True, text=True,
        )
        # 201 = inserted, 200 = some ignored as dupes - both OK
        if not resp.stdout.strip() or resp.stdout.strip() == "":
            inserted += len(batch)
        else:
            # Check if it's an error
            try:
                err = json.loads(resp.stdout)
                if "code" in err:
                    print(f"  Warning: batch {i//50+1} error: {err.get('message', resp.stdout[:100])}", file=sys.stderr)
                    continue
            except json.JSONDecodeError:
                pass
            inserted += len(batch)

    return inserted


# ─── Main ────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Ingest listing alert emails into Nuke")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be ingested")
    parser.add_argument("--days", type=int, default=None, help="Only process last N days")
    parser.add_argument("--limit", type=int, default=None, help="Max emails to process")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    if not MAIL_DB.exists():
        print(f"Apple Mail database not found: {MAIL_DB}", file=sys.stderr)
        sys.exit(1)

    # Find alert emails
    print(f"Scanning Apple Mail for alerts to {TARGET_EMAIL}...")
    emails = find_alert_emails(MAIL_DB, days=args.days)
    print(f"Found {len(emails)} alert emails")

    if args.limit:
        emails = emails[:args.limit]
        print(f"Processing first {args.limit}")

    # Extract URLs from each email
    all_listings = []
    processed = 0
    skipped_no_file = 0
    skipped_no_urls = 0

    for i, em in enumerate(emails):
        if args.verbose and i % 100 == 0:
            print(f"  Processing email {i+1}/{len(emails)}...")

        emlx_path = find_emlx_path(em["msg_id"])
        if not emlx_path:
            skipped_no_file += 1
            continue

        source = "ksl"  # For now, only KSL
        listings = extract_listing_urls_from_emlx(emlx_path, source)
        if not listings:
            skipped_no_urls += 1
            continue

        # Enrich with body hints
        hints = extract_vehicle_hints_from_emlx(emlx_path)
        hint_map = {}
        # Try to match hints to URLs by position
        for h in hints:
            if h.get("title"):
                hint_map[h["title"]] = h

        for listing in listings:
            listing["received"] = em["received"]
            # Try to find matching hint by title proximity
            for h in hints:
                if h.get("year") and h["year"] == listing.get("year"):
                    listing.update({k: v for k, v in h.items() if v is not None})
                    break

        all_listings.extend(listings)
        processed += 1

    # Deduplicate
    seen = set()
    unique_listings = []
    for l in all_listings:
        if l["url"] not in seen:
            seen.add(l["url"])
            unique_listings.append(l)

    print(f"\nResults:")
    print(f"  Emails processed: {processed}")
    print(f"  Emails skipped (no file): {skipped_no_file}")
    print(f"  Emails skipped (no URLs): {skipped_no_urls}")
    print(f"  Total listing URLs found: {len(all_listings)}")
    print(f"  Unique listing URLs: {len(unique_listings)}")

    if args.dry_run:
        print(f"\n[DRY RUN] Would insert {len(unique_listings)} URLs into import_queue")
        if args.verbose:
            for l in unique_listings[:20]:
                print(f"  {l['url']} ({l.get('title', 'no title')})")
            if len(unique_listings) > 20:
                print(f"  ... and {len(unique_listings) - 20} more")
        return

    if not unique_listings:
        print("No new listings to ingest.")
        return

    # Get Supabase config
    print("\nConnecting to Supabase...")
    supabase_url, key = get_supabase_config()

    # Check existing
    all_urls = [l["url"] for l in unique_listings]
    print(f"Checking for existing URLs...")
    existing = check_existing_urls(supabase_url, key, all_urls)
    new_listings = [l for l in unique_listings if l["url"] not in existing]
    print(f"  Already in queue: {len(existing)}")
    print(f"  New to insert: {len(new_listings)}")

    if not new_listings:
        print("All URLs already in queue. Nothing to do.")
        return

    # Insert
    print(f"Inserting {len(new_listings)} listings into import_queue...")
    inserted = insert_to_queue(supabase_url, key, new_listings)
    print(f"Done! Inserted {inserted} listings.")


if __name__ == "__main__":
    main()
