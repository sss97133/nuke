#!/usr/bin/env python3
"""
Barrett-Jackson Archive Extractor

Target: 20,000+ auction lots
Source: https://azure.barrett-jackson.com/Archive/Home

Barrett-Jackson runs ~6 auctions per year with 1,500-2,000 lots each.
Since 2010 that's ~150,000+ potential records.
"""

import os
import sys
import json
import time
import requests
from pathlib import Path
from datetime import datetime
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlencode
import re

# Config
NUKE_DIR = Path("/Users/skylar/nuke")
OUTPUT_DIR = NUKE_DIR / "data" / "barrett_jackson"
BASE_URL = "https://azure.barrett-jackson.com"
ARCHIVE_URL = f"{BASE_URL}/Archive/Home"

# Load env
for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    key, _, val = line.partition("=")
    os.environ.setdefault(key.strip(), val.strip('"').strip("'"))


def get_session():
    """Create session with headers"""
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    })
    return session


def search_archive(session, params=None):
    """
    Search the Barrett-Jackson archive.

    Search parameters:
    - make: Vehicle make (e.g., "Chevrolet")
    - model: Vehicle model
    - yearFrom: Start year
    - yearTo: End year
    - lotNumber: Specific lot number
    """
    search_url = f"{BASE_URL}/Archive/Search"

    default_params = {
        'page': 1,
        'pageSize': 100,
    }

    if params:
        default_params.update(params)

    try:
        resp = session.get(search_url, params=default_params, timeout=30)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        print(f"Search error: {e}")
        return None


def parse_search_results(html):
    """Parse search results page"""
    if not html:
        return [], 0

    soup = BeautifulSoup(html, 'html.parser')
    lots = []

    # Find lot cards/items
    for item in soup.find_all(['div', 'article'], class_=re.compile(r'lot|item|result|card', re.I)):
        try:
            lot_data = {
                'source': 'barrett_jackson',
                'extracted_at': datetime.now().isoformat()
            }

            # Extract lot number
            lot_num = item.find(text=re.compile(r'Lot\s*#?\s*\d+', re.I))
            if lot_num:
                match = re.search(r'\d+', str(lot_num))
                if match:
                    lot_data['lot_number'] = match.group()

            # Extract title/vehicle info
            title = item.find(['h2', 'h3', 'h4', 'a'], class_=re.compile(r'title|name', re.I))
            if title:
                title_text = title.get_text(strip=True)
                lot_data['title'] = title_text

                # Parse year make model from title
                year_match = re.search(r'\b(19|20)\d{2}\b', title_text)
                if year_match:
                    lot_data['year'] = int(year_match.group())

                # Try to extract make/model
                parts = title_text.split()
                for i, part in enumerate(parts):
                    if part.isdigit() and 1900 <= int(part) <= 2030:
                        remaining = parts[i+1:]
                        if remaining:
                            lot_data['make'] = remaining[0] if remaining else None
                            lot_data['model'] = ' '.join(remaining[1:]) if len(remaining) > 1 else None
                        break

            # Extract price
            price_elem = item.find(text=re.compile(r'\$[\d,]+'))
            if price_elem:
                price_match = re.search(r'\$([\d,]+)', str(price_elem))
                if price_match:
                    price_str = price_match.group(1).replace(',', '')
                    if price_str.isdigit():
                        lot_data['sale_price'] = int(price_str)

            # Extract sold status
            status_elem = item.find(text=re.compile(r'(sold|not sold|bid to)', re.I))
            if status_elem:
                status_text = str(status_elem).lower()
                if 'not sold' in status_text:
                    lot_data['status'] = 'not_sold'
                elif 'sold' in status_text:
                    lot_data['status'] = 'sold'

            # Extract event/auction name
            event_elem = item.find(text=re.compile(r'(scottsdale|palm beach|las vegas|houston)', re.I))
            if event_elem:
                lot_data['event'] = str(event_elem).strip()

            # Extract link for more details
            link = item.find('a', href=True)
            if link:
                lot_data['detail_url'] = urljoin(BASE_URL, link['href'])

            # Only add if we have meaningful data
            if lot_data.get('title') or lot_data.get('lot_number'):
                lots.append(lot_data)

        except Exception as e:
            continue

    # Try to find total count
    total = 0
    count_elem = soup.find(text=re.compile(r'\d+\s*(results|lots|vehicles)', re.I))
    if count_elem:
        match = re.search(r'([\d,]+)', str(count_elem))
        if match:
            total = int(match.group(1).replace(',', ''))

    return lots, total


def get_lot_details(session, detail_url):
    """Get full details for a specific lot"""
    try:
        resp = session.get(detail_url, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        details = {}

        # Extract all available fields
        for row in soup.find_all(['tr', 'div'], class_=re.compile(r'detail|spec|info', re.I)):
            label = row.find(['th', 'dt', 'span'], class_=re.compile(r'label|key', re.I))
            value = row.find(['td', 'dd', 'span'], class_=re.compile(r'value|data', re.I))

            if label and value:
                key = label.get_text(strip=True).lower().replace(' ', '_')
                val = value.get_text(strip=True)
                details[key] = val

        # Extract VIN if present
        vin_match = soup.find(text=re.compile(r'VIN', re.I))
        if vin_match:
            parent = vin_match.parent
            if parent:
                vin_text = parent.get_text()
                vin_search = re.search(r'[A-HJ-NPR-Z0-9]{17}', vin_text)
                if vin_search:
                    details['vin'] = vin_search.group()

        # Extract mileage
        mileage_match = soup.find(text=re.compile(r'(miles|mileage|odometer)', re.I))
        if mileage_match:
            parent = mileage_match.parent
            if parent:
                miles_search = re.search(r'([\d,]+)\s*miles', parent.get_text(), re.I)
                if miles_search:
                    details['mileage'] = int(miles_search.group(1).replace(',', ''))

        return details
    except Exception as e:
        return {}


def extract_by_year_range(session, start_year, end_year, page_size=100):
    """Extract all lots within a year range"""
    all_lots = []

    for year in range(start_year, end_year + 1):
        print(f"  Extracting year {year}...")
        page = 1
        year_lots = []

        while True:
            params = {
                'yearFrom': year,
                'yearTo': year,
                'page': page,
                'pageSize': page_size
            }

            html = search_archive(session, params)
            lots, total = parse_search_results(html)

            if not lots:
                break

            year_lots.extend(lots)
            print(f"    Page {page}: {len(lots)} lots (total so far: {len(year_lots)})")

            if len(year_lots) >= total or len(lots) < page_size:
                break

            page += 1
            time.sleep(0.5)  # Rate limit

        all_lots.extend(year_lots)
        print(f"  → {year}: {len(year_lots)} lots")

    return all_lots


def extract_by_make(session, makes, page_size=100):
    """Extract all lots for specific makes"""
    all_lots = []

    for make in makes:
        print(f"  Extracting {make}...")
        page = 1
        make_lots = []

        while True:
            params = {
                'make': make,
                'page': page,
                'pageSize': page_size
            }

            html = search_archive(session, params)
            lots, total = parse_search_results(html)

            if not lots:
                break

            make_lots.extend(lots)

            if len(make_lots) >= total or len(lots) < page_size:
                break

            page += 1
            time.sleep(0.5)

        all_lots.extend(make_lots)
        print(f"  → {make}: {len(make_lots)} lots")

    return all_lots


def save_results(results, filename):
    """Save results to JSON"""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filepath = OUTPUT_DIR / filename

    with open(filepath, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"Saved {len(results)} records to {filepath}")
    return filepath


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=str, help="Year range (e.g., 2015-2025)")
    parser.add_argument("--makes", type=str, help="Comma-separated makes")
    parser.add_argument("--all", action="store_true", help="Extract everything")
    parser.add_argument("--details", action="store_true", help="Fetch full lot details")
    args = parser.parse_args()

    print("=" * 60)
    print("Barrett-Jackson Archive Extractor")
    print(f"Source: {ARCHIVE_URL}")
    print(f"Started: {datetime.now().isoformat()}")
    print("=" * 60)

    session = get_session()
    all_results = []

    if args.years:
        start, end = map(int, args.years.split('-'))
        print(f"\nExtracting years {start}-{end}...")
        results = extract_by_year_range(session, start, end)
        all_results.extend(results)

    if args.makes:
        makes = [m.strip() for m in args.makes.split(',')]
        print(f"\nExtracting makes: {makes}...")
        results = extract_by_make(session, makes)
        all_results.extend(results)

    if args.all:
        print("\nExtracting ALL data (this will take a while)...")
        # Extract by year from 2000 to present
        results = extract_by_year_range(session, 2000, 2026)
        all_results.extend(results)

    if args.details and all_results:
        print(f"\nFetching details for {len(all_results)} lots...")
        for i, lot in enumerate(all_results):
            if lot.get('detail_url'):
                if i % 100 == 0:
                    print(f"  [{i}/{len(all_results)}]...")
                details = get_lot_details(session, lot['detail_url'])
                lot.update(details)
                time.sleep(0.3)

    # Save results
    if all_results:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        save_results(all_results, f"barrett_jackson_{timestamp}.json")

    print("\n" + "=" * 60)
    print(f"EXTRACTION COMPLETE")
    print(f"Total lots: {len(all_results)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
