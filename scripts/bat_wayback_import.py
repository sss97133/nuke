#!/usr/bin/env python3
"""
BaT Wayback Machine Import Script v2
Uses proper deduplication against existing queue.
"""

import json
import os
import sys
import urllib.request
from datetime import datetime
import time

# Load env vars
from pathlib import Path
env_file = Path(__file__).parent.parent / '.env'
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ[key] = value.strip('"').strip("'")

SUPABASE_URL = os.environ.get('VITE_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

def fetch_all_existing_bat_urls():
    """Get ALL existing BaT URLs from both vehicles and import_queue."""
    print("Fetching ALL existing BaT URLs...")
    existing = set()

    # 1. Get from vehicles table (paginated - Supabase default limit is 1000)
    print("  Checking vehicles...")
    offset = 0
    page_size = 1000
    while True:
        url = f"{SUPABASE_URL}/rest/v1/vehicles?select=bat_auction_url,discovery_url&or=(bat_auction_url.not.is.null,discovery_url.ilike.%25bringatrailer%25)&limit={page_size}&offset={offset}"
        req = urllib.request.Request(url, headers={
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'apikey': SUPABASE_KEY,
        })
        with urllib.request.urlopen(req, timeout=60) as response:
            vehicles = json.loads(response.read().decode())
            if not vehicles:
                break
            for v in vehicles:
                if v.get('bat_auction_url'):
                    existing.add(v['bat_auction_url'].rstrip('/') + '/')
                if v.get('discovery_url') and 'bringatrailer' in v['discovery_url']:
                    existing.add(v['discovery_url'].rstrip('/') + '/')
            offset += len(vehicles)
            if offset % 3000 == 0:
                print(f"    {offset} vehicles checked...")
            if len(vehicles) < page_size:
                break
    print(f"    {offset} vehicles checked (complete)")

    # 2. Get from import_queue (paginated - Supabase default limit is 1000)
    print("  Checking import_queue...")
    offset = 0
    page_size = 1000  # Supabase default max
    while True:
        url = f"{SUPABASE_URL}/rest/v1/import_queue?select=listing_url&listing_url=ilike.%25bringatrailer%25&limit={page_size}&offset={offset}"
        req = urllib.request.Request(url, headers={
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'apikey': SUPABASE_KEY,
        })
        with urllib.request.urlopen(req, timeout=60) as response:
            rows = json.loads(response.read().decode())
            if not rows:
                break
            for r in rows:
                if r.get('listing_url'):
                    existing.add(r['listing_url'].rstrip('/') + '/')
            offset += len(rows)
            if offset % 5000 == 0:
                print(f"    {offset} queue items checked...")
            if len(rows) < page_size:
                break
    print(f"    {offset} queue items checked (complete)")

    print(f"  Found {len(existing)} existing BaT URLs")
    return existing

def fetch_wayback_urls():
    """Fetch all BaT listing URLs from Wayback CDX API."""
    print("\nFetching from Wayback CDX API (this may take a few minutes)...")

    cdx_url = (
        "https://web.archive.org/cdx/search/cdx"
        "?url=bringatrailer.com/listing/"
        "&matchType=prefix"
        "&output=json"
        "&fl=original"
        "&filter=statuscode:200"
        "&collapse=urlkey"
        "&limit=200000"
    )

    req = urllib.request.Request(cdx_url, headers={
        'User-Agent': 'NukeVehicleExtractor/1.0'
    })

    with urllib.request.urlopen(req, timeout=300) as response:
        data = json.loads(response.read().decode())

    if len(data) <= 1:
        print("No data returned")
        return set()

    # Extract unique listing URLs
    urls = set()
    for row in data[1:]:
        url = row[0]
        if '/listing/' in url:
            parts = url.split('/listing/')
            if len(parts) > 1:
                slug = parts[1].split('/')[0].split('?')[0]
                if slug and '-' in slug and slug not in ['feed', 'page', '']:
                    # Normalize URL
                    clean = f'https://bringatrailer.com/listing/{slug}/'
                    urls.add(clean)

    print(f"Found {len(urls)} unique listing URLs from Wayback")
    return urls

def queue_urls_batch(urls, batch_num, total_batches):
    """Insert a batch of URLs into import_queue."""
    records = [{
        'listing_url': url,
        'status': 'pending',
        'priority': 2,
        'raw_data': {
            'source': 'bat_wayback_import_v2',
            'discovered_via': 'wayback_machine',
            'discovered_at': datetime.now().isoformat()
        }
    } for url in urls]

    api_url = f"{SUPABASE_URL}/rest/v1/import_queue"
    data = json.dumps(records).encode()

    req = urllib.request.Request(api_url, data=data, method='POST', headers={
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    })

    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return len(urls), 0
    except urllib.error.HTTPError as e:
        if e.code == 409:
            # Some duplicates - expected
            return len(urls) // 2, len(urls) // 2  # Rough estimate
        else:
            error_body = e.read().decode()
            print(f"    Batch {batch_num}: HTTP {e.code}")
            return 0, len(urls)
    except Exception as e:
        print(f"    Batch {batch_num}: {str(e)[:50]}")
        return 0, len(urls)

def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required")
        sys.exit(1)

    # Get existing URLs FIRST
    existing = fetch_all_existing_bat_urls()

    # Fetch Wayback URLs
    wayback_urls = fetch_wayback_urls()

    if not wayback_urls:
        print("No URLs found")
        sys.exit(1)

    # Filter to new URLs only
    new_urls = wayback_urls - existing
    print(f"\n{len(new_urls)} new URLs to queue ({len(wayback_urls) - len(new_urls)} already exist)")

    if not new_urls:
        print("Nothing new to queue!")
        return

    # Queue in batches
    url_list = list(new_urls)
    batch_size = 500
    total_batches = (len(url_list) + batch_size - 1) // batch_size

    total_queued = 0
    total_errors = 0

    print(f"\nQueueing {len(url_list)} URLs in {total_batches} batches...")

    for i in range(0, len(url_list), batch_size):
        batch = url_list[i:i+batch_size]
        batch_num = i // batch_size + 1

        queued, errors = queue_urls_batch(batch, batch_num, total_batches)
        total_queued += queued
        total_errors += errors

        if batch_num % 20 == 0 or batch_num == total_batches:
            print(f"  Progress: {total_queued}/{len(url_list)} queued, {total_errors} errors")

        # Small delay to avoid rate limiting
        if batch_num % 50 == 0:
            time.sleep(1)

    print(f"\n=== COMPLETE ===")
    print(f"Total queued: {total_queued}")
    print(f"Total errors: {total_errors}")

if __name__ == '__main__':
    main()
