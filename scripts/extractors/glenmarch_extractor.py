#!/usr/bin/env python3
"""
Glenmarch Auction Database Extractor

Target: 50,000+ records from 80+ auction houses
Source: https://www.glenmarch.com/auctions/results

Glenmarch aggregates results from:
- Barrett-Jackson
- Mecum
- RM Sotheby's
- Bonhams
- Gooding & Company
- And 75+ more auction houses

Data since 2013. This is our best single source for comprehensive auction data.
"""

import os
import sys
import json
import time
import requests
from pathlib import Path
from datetime import datetime
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlencode, parse_qs, urlparse
import re
import concurrent.futures

# Config
NUKE_DIR = Path("/Users/skylar/nuke")
OUTPUT_DIR = NUKE_DIR / "data" / "glenmarch"
BASE_URL = "https://www.glenmarch.com"
RESULTS_URL = f"{BASE_URL}/auctions/results"

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


def get_auction_houses(session):
    """Get list of all auction houses on Glenmarch"""
    try:
        resp = session.get(RESULTS_URL, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        houses = []

        # Look for auction house links
        for link in soup.find_all('a', href=True):
            href = link['href']
            if '/auctions/results/house/' in href:
                house_id = href.split('/house/')[-1].split('?')[0].split('/')[0]
                house_name = link.get_text(strip=True)
                if house_id and house_name:
                    houses.append({
                        'id': house_id,
                        'name': house_name,
                        'url': urljoin(BASE_URL, href)
                    })

        # Deduplicate
        seen = set()
        unique_houses = []
        for h in houses:
            if h['id'] not in seen:
                seen.add(h['id'])
                unique_houses.append(h)

        return unique_houses
    except Exception as e:
        print(f"Error fetching auction houses: {e}")
        return []


def get_auctions_for_house(session, house_id, house_name):
    """Get all auction events for a specific house"""
    url = f"{BASE_URL}/auctions/results/house/{house_id}"

    try:
        resp = session.get(url, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        auctions = []

        # Find auction event links
        for link in soup.find_all('a', href=True):
            href = link['href']
            # Look for links to specific auctions
            if '/auctions/' in href and '/lots' not in href:
                text = link.get_text(strip=True)
                if text and len(text) > 3:
                    auctions.append({
                        'house_id': house_id,
                        'house_name': house_name,
                        'auction_name': text,
                        'url': urljoin(BASE_URL, href)
                    })

        return auctions
    except Exception as e:
        print(f"Error fetching auctions for {house_name}: {e}")
        return []


def get_auction_lots(session, auction_url, auction_info):
    """Get all lots from a specific auction"""
    lots = []
    page = 1

    while True:
        try:
            # Append page parameter
            if '?' in auction_url:
                url = f"{auction_url}&page={page}"
            else:
                url = f"{auction_url}?page={page}"

            resp = session.get(url, timeout=30)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, 'html.parser')

            page_lots = []

            # Find lot entries - look for common patterns
            for item in soup.find_all(['div', 'tr', 'article', 'li'], class_=re.compile(r'lot|item|result|vehicle', re.I)):
                try:
                    lot_data = {
                        'auction_house': auction_info.get('house_name'),
                        'auction_name': auction_info.get('auction_name'),
                        'source': 'glenmarch',
                        'source_url': auction_url,
                        'extracted_at': datetime.now().isoformat()
                    }

                    # Get all text content
                    text = item.get_text(' ', strip=True)

                    # Extract year
                    year_match = re.search(r'\b(19[0-9]{2}|20[0-2][0-9])\b', text)
                    if year_match:
                        lot_data['year'] = int(year_match.group())

                    # Extract price
                    price_match = re.search(r'[\$€£]([\d,]+)', text)
                    if price_match:
                        price_str = price_match.group(1).replace(',', '')
                        if price_str.isdigit():
                            lot_data['sale_price'] = int(price_str)

                    # Extract lot number
                    lot_match = re.search(r'[Ll]ot\s*#?\s*(\d+)', text)
                    if lot_match:
                        lot_data['lot_number'] = lot_match.group(1)

                    # Extract vehicle title/name (usually in a link or heading)
                    title_elem = item.find(['a', 'h2', 'h3', 'h4'])
                    if title_elem:
                        title = title_elem.get_text(strip=True)
                        lot_data['title'] = title

                        # Try to parse make/model from title
                        words = title.split()
                        for i, word in enumerate(words):
                            if word.isdigit() and 1900 <= int(word) <= 2030:
                                remaining = words[i+1:]
                                if remaining:
                                    lot_data['make'] = remaining[0]
                                    if len(remaining) > 1:
                                        lot_data['model'] = ' '.join(remaining[1:])
                                break

                    # Check sold status
                    if 'not sold' in text.lower() or 'unsold' in text.lower():
                        lot_data['status'] = 'not_sold'
                    elif 'sold' in text.lower() or lot_data.get('sale_price'):
                        lot_data['status'] = 'sold'

                    # Only add if we have meaningful data
                    if lot_data.get('year') or lot_data.get('title') or lot_data.get('sale_price'):
                        page_lots.append(lot_data)

                except Exception as e:
                    continue

            if not page_lots:
                break

            lots.extend(page_lots)

            # Check for next page
            next_link = soup.find('a', text=re.compile(r'next|›|»', re.I))
            if not next_link:
                break

            page += 1
            time.sleep(0.3)

        except Exception as e:
            print(f"Error on page {page}: {e}")
            break

    return lots


def extract_all_houses(session, house_ids=None, limit_auctions=None):
    """Extract from all or specified auction houses"""
    all_lots = []

    # Get all houses
    print("Fetching auction houses...")
    houses = get_auction_houses(session)
    print(f"Found {len(houses)} auction houses")

    if house_ids:
        houses = [h for h in houses if h['id'] in house_ids]

    for i, house in enumerate(houses):
        print(f"\n[{i+1}/{len(houses)}] {house['name']} (ID: {house['id']})")

        # Get auctions for this house
        auctions = get_auctions_for_house(session, house['id'], house['name'])
        print(f"  Found {len(auctions)} auctions")

        if limit_auctions:
            auctions = auctions[:limit_auctions]

        for j, auction in enumerate(auctions):
            print(f"  [{j+1}/{len(auctions)}] {auction['auction_name'][:50]}...")

            lots = get_auction_lots(session, auction['url'], auction)
            all_lots.extend(lots)
            print(f"    → {len(lots)} lots")

            time.sleep(0.5)

    return all_lots


def save_results(results, filename):
    """Save results to JSON"""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filepath = OUTPUT_DIR / filename

    with open(filepath, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"Saved {len(results)} records to {filepath}")

    # Also save summary
    summary = {
        'total_lots': len(results),
        'by_house': {},
        'by_year': {},
        'with_price': sum(1 for r in results if r.get('sale_price')),
        'extracted_at': datetime.now().isoformat()
    }

    for r in results:
        house = r.get('auction_house', 'Unknown')
        year = r.get('year', 'Unknown')
        summary['by_house'][house] = summary['by_house'].get(house, 0) + 1
        summary['by_year'][str(year)] = summary['by_year'].get(str(year), 0) + 1

    summary_path = OUTPUT_DIR / filename.replace('.json', '_summary.json')
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2)

    return filepath


# Key auction house IDs on Glenmarch
MAJOR_HOUSES = {
    '40': 'Barrett-Jackson',
    '49': 'Mecum',
    '1': 'RM Sothebys',
    '2': 'Bonhams',
    '4': 'Gooding & Company',
    '3': "Christie's",
    '5': 'Artcurial',
    '10': 'H&H Classics',
}


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--houses", type=str, help="Comma-separated house IDs (e.g., 40,49,1)")
    parser.add_argument("--major", action="store_true", help="Extract from major houses only")
    parser.add_argument("--all", action="store_true", help="Extract from all houses")
    parser.add_argument("--limit", type=int, default=0, help="Limit auctions per house")
    parser.add_argument("--list-houses", action="store_true", help="List all auction houses")
    args = parser.parse_args()

    print("=" * 60)
    print("Glenmarch Auction Database Extractor")
    print("Target: 50,000+ records from 80+ auction houses")
    print(f"Started: {datetime.now().isoformat()}")
    print("=" * 60)

    session = get_session()

    if args.list_houses:
        print("\nFetching auction houses...")
        houses = get_auction_houses(session)
        print(f"\nFound {len(houses)} auction houses:\n")
        for h in sorted(houses, key=lambda x: x['name']):
            print(f"  ID {h['id']:>3}: {h['name']}")
        return

    all_results = []
    house_ids = None

    if args.houses:
        house_ids = [h.strip() for h in args.houses.split(',')]
    elif args.major:
        house_ids = list(MAJOR_HOUSES.keys())
        print(f"Extracting from major houses: {list(MAJOR_HOUSES.values())}")

    results = extract_all_houses(
        session,
        house_ids=house_ids,
        limit_auctions=args.limit if args.limit else None
    )
    all_results.extend(results)

    # Save
    if all_results:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        save_results(all_results, f"glenmarch_{timestamp}.json")

    print("\n" + "=" * 60)
    print(f"EXTRACTION COMPLETE")
    print(f"Total lots: {len(all_results)}")

    # Summary by house
    by_house = {}
    for r in all_results:
        house = r.get('auction_house', 'Unknown')
        by_house[house] = by_house.get(house, 0) + 1

    print("\nBy Auction House:")
    for house, count in sorted(by_house.items(), key=lambda x: -x[1])[:10]:
        print(f"  {house}: {count:,}")

    print("=" * 60)


if __name__ == "__main__":
    main()
