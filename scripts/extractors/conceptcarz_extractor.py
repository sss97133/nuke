#!/usr/bin/env python3
"""
Conceptcarz Auction Data Extractor

Target: 538,800+ auction values
Source: https://www.conceptcarz.com/auction/data.aspx

This is our biggest potential data source for collector car auction results.
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
import concurrent.futures

# Config
NUKE_DIR = Path("/Users/skylar/nuke")
OUTPUT_DIR = NUKE_DIR / "data" / "conceptcarz"
BASE_URL = "https://www.conceptcarz.com"

# Load env for Supabase
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
    })
    return session


def get_auction_events(session):
    """Get list of all auction events"""
    url = f"{BASE_URL}/events/auctionResults/"

    try:
        resp = session.get(url, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        events = []
        # Look for links to auction result pages
        for link in soup.find_all('a', href=True):
            href = link['href']
            if 'auctionResults.aspx?eventID=' in href:
                event_id = href.split('eventID=')[1].split('&')[0]
                event_name = link.get_text(strip=True)
                events.append({
                    'event_id': event_id,
                    'name': event_name,
                    'url': urljoin(BASE_URL, href)
                })

        return events
    except Exception as e:
        print(f"Error fetching events: {e}")
        return []


def get_event_lots(session, event_url, event_name):
    """Extract all lots from an auction event"""
    try:
        resp = session.get(event_url, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        lots = []

        # Find the results table
        tables = soup.find_all('table')
        for table in tables:
            rows = table.find_all('tr')
            for row in rows[1:]:  # Skip header
                cells = row.find_all(['td', 'th'])
                if len(cells) >= 4:
                    try:
                        lot_data = {
                            'event': event_name,
                            'lot_number': cells[0].get_text(strip=True) if len(cells) > 0 else None,
                            'year': None,
                            'make': None,
                            'model': None,
                            'sale_price': None,
                            'status': None,
                            'source': 'conceptcarz',
                            'source_url': event_url,
                            'extracted_at': datetime.now().isoformat()
                        }

                        # Parse vehicle info (usually in format "YEAR MAKE MODEL")
                        vehicle_cell = cells[1].get_text(strip=True) if len(cells) > 1 else ''
                        parts = vehicle_cell.split()
                        if parts:
                            # Try to extract year
                            for i, part in enumerate(parts):
                                if part.isdigit() and 1900 <= int(part) <= 2030:
                                    lot_data['year'] = int(part)
                                    # Remaining parts are make/model
                                    remaining = ' '.join(parts[i+1:])
                                    if remaining:
                                        make_model = remaining.split(None, 1)
                                        lot_data['make'] = make_model[0] if make_model else None
                                        lot_data['model'] = make_model[1] if len(make_model) > 1 else None
                                    break

                        # Parse price
                        price_cell = cells[-1].get_text(strip=True) if cells else ''
                        price_clean = price_cell.replace('$', '').replace(',', '').strip()
                        if price_clean.isdigit():
                            lot_data['sale_price'] = int(price_clean)
                        elif 'not sold' in price_cell.lower() or 'n/s' in price_cell.lower():
                            lot_data['status'] = 'not_sold'
                        elif 'sold' in price_cell.lower():
                            lot_data['status'] = 'sold'

                        if lot_data['year'] or lot_data['make']:
                            lots.append(lot_data)

                    except Exception as e:
                        continue

        return lots
    except Exception as e:
        print(f"Error extracting {event_url}: {e}")
        return []


def get_make_auction_data(session, make):
    """Get auction data for a specific make from the data page"""
    url = f"{BASE_URL}/auction/data.aspx?make={make}"

    try:
        resp = session.get(url, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        results = []
        # Parse the data table
        tables = soup.find_all('table')
        for table in tables:
            rows = table.find_all('tr')
            for row in rows[1:]:
                cells = row.find_all('td')
                if len(cells) >= 3:
                    try:
                        result = {
                            'make': make,
                            'model': cells[0].get_text(strip=True) if len(cells) > 0 else None,
                            'year': None,
                            'avg_price': None,
                            'high_price': None,
                            'low_price': None,
                            'num_sales': None,
                            'source': 'conceptcarz',
                            'extracted_at': datetime.now().isoformat()
                        }

                        # Parse numeric values
                        for i, cell in enumerate(cells):
                            text = cell.get_text(strip=True).replace('$', '').replace(',', '')
                            if text.isdigit():
                                if i == 1:
                                    result['year'] = int(text) if 1900 <= int(text) <= 2030 else None
                                elif result['avg_price'] is None:
                                    result['avg_price'] = int(text)

                        if result['model']:
                            results.append(result)
                    except:
                        continue

        return results
    except Exception as e:
        print(f"Error fetching {make}: {e}")
        return []


def get_all_makes(session):
    """Get list of all vehicle makes from conceptcarz"""
    url = f"{BASE_URL}/auction/data.aspx"

    try:
        resp = session.get(url, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        makes = []
        # Look for make links or dropdown
        for link in soup.find_all('a', href=True):
            href = link['href']
            if 'make=' in href.lower():
                make = href.split('make=')[1].split('&')[0]
                makes.append(make)

        # Also check select dropdowns
        for select in soup.find_all('select'):
            for option in select.find_all('option'):
                value = option.get('value', '')
                if value and value not in makes:
                    makes.append(value)

        return list(set(makes))
    except Exception as e:
        print(f"Error fetching makes: {e}")
        return []


def save_results(results, filename):
    """Save results to JSON file"""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filepath = OUTPUT_DIR / filename

    with open(filepath, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"Saved {len(results)} records to {filepath}")
    return filepath


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--events", action="store_true", help="Extract from auction events")
    parser.add_argument("--makes", action="store_true", help="Extract by make from data page")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of items")
    parser.add_argument("--make", type=str, help="Extract specific make only")
    args = parser.parse_args()

    print("=" * 60)
    print("Conceptcarz Auction Data Extractor")
    print(f"Target: 538,800+ auction values")
    print(f"Started: {datetime.now().isoformat()}")
    print("=" * 60)

    session = get_session()
    all_results = []

    if args.events:
        print("\nFetching auction events...")
        events = get_auction_events(session)
        print(f"Found {len(events)} events")

        if args.limit:
            events = events[:args.limit]

        for i, event in enumerate(events):
            print(f"[{i+1}/{len(events)}] {event['name']}...")
            lots = get_event_lots(session, event['url'], event['name'])
            all_results.extend(lots)
            print(f"  → {len(lots)} lots")
            time.sleep(0.5)  # Rate limit

    if args.makes or args.make:
        if args.make:
            makes = [args.make]
        else:
            print("\nFetching all makes...")
            makes = get_all_makes(session)
            print(f"Found {len(makes)} makes")

        if args.limit and not args.make:
            makes = makes[:args.limit]

        for i, make in enumerate(makes):
            print(f"[{i+1}/{len(makes)}] {make}...")
            data = get_make_auction_data(session, make)
            all_results.extend(data)
            print(f"  → {len(data)} records")
            time.sleep(0.3)  # Rate limit

    # Save results
    if all_results:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        save_results(all_results, f"conceptcarz_{timestamp}.json")

    print("\n" + "=" * 60)
    print(f"EXTRACTION COMPLETE")
    print(f"Total records: {len(all_results)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
