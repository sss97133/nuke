#!/usr/bin/env python3
"""
BaT Archive Re-Parser — Extract fields from archived HTML in listing_page_snapshots.

Reads archived BaT HTML from the database, parses key fields using the same patterns
as extract-bat-core, and emits SQL UPDATE statements for sparse vehicles.

Usage:
  psql "$DB" -t -A -c "SELECT v.id, s.html FROM ..." | python3 reparse-bat-html.py | psql "$DB"

Or pipe JSON records via stdin.
"""
import sys
import re
import json
import html as html_module

def strip_tags(s):
    """Remove HTML tags and decode entities."""
    if not s:
        return ''
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html_module.unescape(s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def esc(s):
    """Escape single quotes for SQL."""
    return s.replace("'", "''") if s else ''

def parse_bat_html(h):
    """Parse a BaT listing HTML page and return extracted fields."""
    if not h or len(h) < 500:
        return None

    result = {}

    # Title from og:title or <title>
    og = re.search(r'<meta[^>]*property=["\']og:title["\'][^>]*content=["\']([^"\']+)["\']', h, re.I)
    title_tag = re.search(r'<title[^>]*>([^<]+)</title>', h, re.I)
    raw_title = (og.group(1) if og else (title_tag.group(1) if title_tag else '')).strip()

    # Clean BaT SEO chrome from title
    clean_title = re.sub(r'\s*\|\s*Bring a Trailer.*$', '', raw_title)
    clean_title = re.sub(r'\s+for sale on BaT Auctions.*$', '', clean_title, flags=re.I)
    result['title'] = clean_title.strip() if clean_title else None

    # Year from title
    ym = re.search(r'\b(19|20)\d{2}\b', clean_title)
    result['year'] = int(ym.group(0)) if ym else None

    # Description from post-excerpt or og:description
    desc_match = re.search(r'<div[^>]*class=["\'][^"\']*post-excerpt[^"\']*["\'][^>]*>([\s\S]*?)</div>', h, re.I)
    if not desc_match:
        desc_match = re.search(r'<div[^>]*class=["\'][^"\']*post-content[^"\']*["\'][^>]*>([\s\S]*?)</div>', h, re.I)
    if desc_match:
        desc = strip_tags(desc_match.group(1))
        if len(desc) > 40:
            result['description'] = desc[:2000]
    if 'description' not in result:
        meta_desc = re.search(r'<meta[^>]*property=["\']og:description["\'][^>]*content=["\']([^"\']+)["\']', h, re.I)
        if meta_desc:
            d = strip_tags(meta_desc.group(1))
            if len(d) > 40:
                result['description'] = d[:2000]

    # Essentials section
    ess_idx = h.find('<div class="essentials"')
    win = h[ess_idx:ess_idx+50000] if ess_idx >= 0 else h[:50000]
    win_text = strip_tags(win)

    # Seller
    seller_m = re.search(r'<strong>Seller</strong>:\s*<a[^>]*href=["\'][^"\']*\/member\/([^"\/]+)\/?["\'][^>]*>([^<]+)</a>', win, re.I)
    if seller_m:
        result['seller_username'] = strip_tags(seller_m.group(2))

    # Location
    loc_m = re.search(r'<strong>Location</strong>:\s*<a[^>]*>([^<]+)</a>', win, re.I)
    if loc_m:
        result['location'] = strip_tags(loc_m.group(1))

    # Lot number
    lot_m = re.search(r'<strong>Lot</strong>\s*#([0-9,]+)', win, re.I)
    if lot_m:
        result['lot_number'] = lot_m.group(1).replace(',', '').strip()

    # Reserve status
    title_scope = f"{win_text} {raw_title}"
    if 'no-reserve' in title_scope.lower() or re.search(r'\bNo Reserve\b', title_scope, re.I):
        result['reserve_status'] = 'no_reserve'
    elif re.search(r'\bReserve Not Met\b', title_scope, re.I):
        result['reserve_status'] = 'reserve_not_met'
    elif re.search(r'\bReserve Met\b', title_scope, re.I):
        result['reserve_status'] = 'reserve_met'

    # Auction end date
    ends_m = re.search(r'data-ends="(\d+)"', h, re.I)
    if ends_m:
        from datetime import datetime, timezone
        ts = int(ends_m.group(1))
        if ts > 0:
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            result['auction_end_date'] = dt.strftime('%Y-%m-%d')

    # Sale price from title ("sold for $185,000")
    sold_title = re.search(r'\bsold\s+for\s+\$?\s*([0-9,]+)', raw_title, re.I)
    if sold_title:
        price = int(sold_title.group(1).replace(',', ''))
        if 100 < price < 100_000_000:
            result['sale_price'] = price

    # Sale price from auction result table
    if 'sale_price' not in result:
        stats_table = re.search(r'<table[^>]*id=["\']listing-bid["\'][^>]*>[\s\S]*?</table>', h, re.I)
        if stats_table:
            sold_row = re.search(r'Sold.*?<strong>\s*(?:USD\s*)?\$?\s*([0-9,.]+)', stats_table.group(0), re.I)
            if sold_row and 'Reserve Not Met' not in stats_table.group(0):
                price = int(sold_row.group(1).replace(',', '').split('.')[0])
                if 100 < price < 100_000_000:
                    result['sale_price'] = price

    # High bid
    hb_m = re.search(r'High\s+Bid.*?<strong>\s*(?:USD\s*)?\$?\s*([0-9,.]+)', h, re.I)
    if hb_m:
        hb = int(hb_m.group(1).replace(',', '').split('.')[0])
        if 100 < hb < 100_000_000:
            result['high_bid'] = hb

    # Bid count
    bid_count = len(re.findall(r'"type":"bat-bid"', h))
    if bid_count > 0:
        result['bid_count'] = bid_count

    # Comment count
    cc_m = re.search(r'<span class="info-value">(\d+)</span>\s*<span class="info-label">Comments</span>', h, re.I)
    if cc_m:
        result['comment_count'] = int(cc_m.group(1))

    # View count
    vc_m = re.search(r'data-stats-item="views">([0-9,]+)', h, re.I)
    if vc_m:
        result['view_count'] = int(vc_m.group(1).replace(',', ''))

    # Watcher count
    wc_m = re.search(r'data-stats-item="watchers">([0-9,]+)', h, re.I)
    if wc_m:
        result['watcher_count'] = int(wc_m.group(1).replace(',', ''))

    # Listing Details (VIN, mileage, colors, transmission, engine, body)
    details_m = re.search(r'<strong>Listing Details</strong>[\s\S]*?<ul>([\s\S]*?)</ul>', win, re.I)
    if details_m:
        items = [strip_tags(m) for m in re.findall(r'<li[^>]*>([\s\S]*?)</li>', details_m.group(1), re.I)]

        for item in items:
            # VIN
            if 'vin' not in result:
                vin_m = re.match(r'^(?:VIN|Chassis)\s*:\s*([A-HJ-NPR-Z0-9]{4,17})\b', item, re.I)
                if vin_m:
                    result['vin'] = vin_m.group(1).upper().strip()

            # Mileage
            if 'mileage' not in result:
                miles_m = re.search(r'\b([0-9,]+)\s*Miles?\b', item, re.I)
                if miles_m:
                    n = int(miles_m.group(1).replace(',', ''))
                    if 0 < n < 10_000_000:
                        result['mileage'] = n
                else:
                    miles_k = re.search(r'\b(\d+(?:\.\d+)?)\s*k\s*Miles?\b', item, re.I)
                    if miles_k:
                        n = round(float(miles_k.group(1)) * 1000)
                        if 0 < n < 10_000_000:
                            result['mileage'] = n

            # Transmission
            if 'transmission' not in result:
                is_trans = (
                    len(item) <= 80 and
                    not re.search(r'(miles|paint|upholstery|chassis|vin|engine)\b', item, re.I) and
                    (re.search(r'\btransmission\b|\btransaxle\b|\bgearbox\b|\bcvt\b|\bdct\b|\bdual[-\s]?clutch\b', item, re.I) or
                     (re.search(r'\b(manual|automatic)\b', item, re.I) and
                      re.search(r'\b(\d{1,2}-speed|four-speed|five-speed|six-speed|seven-speed|eight-speed)\b', item, re.I)))
                )
                if is_trans:
                    result['transmission'] = item

            # Drivetrain
            if 'drivetrain' not in result:
                dt_m = re.search(r'\b(AWD|4WD|RWD|FWD|4x4)\b', item, re.I)
                if dt_m:
                    raw = dt_m.group(1).upper()
                    result['drivetrain'] = '4WD' if raw == '4X4' else raw
                else:
                    il = item.lower()
                    if 'rear-wheel drive' in il or 'rear wheel drive' in il:
                        result['drivetrain'] = 'RWD'
                    elif 'front-wheel drive' in il or 'front wheel drive' in il:
                        result['drivetrain'] = 'FWD'
                    elif 'all-wheel drive' in il or 'all wheel drive' in il:
                        result['drivetrain'] = 'AWD'
                    elif '4-wheel drive' in il or 'four-wheel drive' in il or '4x4' in il:
                        result['drivetrain'] = '4WD'

            # Engine
            if 'engine' not in result:
                is_engine = (
                    (re.search(r'\b\d+(?:\.\d+)?-?\s*Liter\b', item, re.I) or
                     re.search(r'\b\d+(?:\.\d+)?\s*L\b', item, re.I) or
                     re.search(r'\bV\d\b', item, re.I) or
                     re.search(r'\b[0-9,]{3,5}\s*cc\b', item, re.I) or
                     re.search(r'\b\d{2,3}\s*ci\b', item, re.I) or
                     re.search(r'\bcubic\s+inch\b', item, re.I) or
                     re.search(r'\bflat[-\s]?(four|six)\b', item, re.I) or
                     re.search(r'\binline[-\s]?\d\b', item, re.I)) and
                    not re.search(r'exhaust|wheels|brakes', item, re.I)
                )
                if is_engine:
                    result['engine'] = item

            # Exterior color
            if 'exterior_color' not in result:
                paint_m = re.match(r'^(.+?)\s+Paint\b', item, re.I)
                if paint_m:
                    result['exterior_color'] = paint_m.group(1).strip()
                if 'exterior_color' not in result:
                    fin_m = re.search(r'\b(?:Finished|Repainted|Painted)\s+in\s+(.+)', item, re.I)
                    if fin_m and len(fin_m.group(1).strip()) <= 60:
                        result['exterior_color'] = fin_m.group(1).strip()

            # Interior color
            if 'interior_color' not in result:
                up_m = re.match(r'^(.+?)\s+Upholstery\b', item, re.I)
                if up_m:
                    result['interior_color'] = up_m.group(1).strip()

    # Body style from title
    if 'body_style' not in result:
        t = clean_title.lower() if clean_title else ''
        body_map = [
            (r'\bcoupe\b|\bcoupé\b', 'Coupe'), (r'\bconvertible\b|\bcabriolet\b', 'Convertible'),
            (r'\broadster\b', 'Roadster'), (r'\bsedan\b', 'Sedan'), (r'\bwagon\b|\bestate\b', 'Wagon'),
            (r'\bhatchback\b', 'Hatchback'), (r'\bpickup\b|\btruck\b', 'Truck'),
            (r'\bfastback\b', 'Fastback'), (r'\bsuv\b', 'SUV'), (r'\bvan\b', 'Van'),
        ]
        for pat, val in body_map:
            if re.search(pat, t, re.I):
                result['body_style'] = val
                break

    # Images from gallery
    gallery_m = re.search(r'data-gallery-items=(?:"([^"]+)"|\'([^\']+)\')', h, re.I)
    if gallery_m:
        encoded = (gallery_m.group(1) or gallery_m.group(2) or '').strip()
        if encoded:
            json_text = encoded.replace('&quot;', '"').replace('&#038;', '&').replace('&amp;', '&')
            try:
                items = json.loads(json_text)
                urls = []
                for it in items:
                    u = (it.get('full', {}).get('url') or it.get('original', {}).get('url') or
                         it.get('large', {}).get('url') or '')
                    if u and 'bringatrailer.com/wp-content/uploads/' in u:
                        # Clean up URL
                        u = re.sub(r'[?&]w=\d+', '', u)
                        u = re.sub(r'[?&]h=\d+', '', u)
                        u = re.sub(r'[?&]fit=[^&]*', '', u)
                        u = re.sub(r'[?&]resize=[^&]*', '', u)
                        u = re.sub(r'-scaled\.(jpg|jpeg|png|webp)$', r'.\1', u, flags=re.I)
                        u = u.split('?')[0].split('#')[0]
                        urls.append(u)
                if urls:
                    result['image_urls'] = list(dict.fromkeys(urls))  # dedupe preserving order
                    result['primary_image'] = urls[0]
                    result['image_count'] = len(urls)
            except (json.JSONDecodeError, KeyError):
                pass

    # Infer colors from description if not found in essentials
    desc = result.get('description', '')
    if desc and 'exterior_color' not in result:
        for pat in [r'\bfinished\s+in\s+([A-Za-z][A-Za-z\s/-]{2,50}?)(?=\s+(?:over|with|and)\b|[.,;]|$)',
                    r'\brepainted\s+in\s+([A-Za-z][A-Za-z\s/-]{2,50}?)(?=\s+(?:over|with|and)\b|[.,;]|$)']:
            m = re.search(pat, desc, re.I)
            if m and 2 <= len(m.group(1).strip()) <= 60:
                result['exterior_color'] = m.group(1).strip()
                break

    if desc and 'interior_color' not in result:
        for pat in [r'\bover\s+(?:a\s+)?(?:refreshed\s+|retrimmed\s+)?([A-Za-z][A-Za-z\s/-]{2,40}?)\s+(?:leather|vinyl|cloth|interior)\b',
                    r'\b([A-Za-z][A-Za-z\s/-]{2,40}?)\s+(?:leather|vinyl|cloth)\s+interior\b']:
            m = re.search(pat, desc, re.I)
            if m and 2 <= len(m.group(1).strip()) <= 60:
                result['interior_color'] = m.group(1).strip()
                break

    return result

def emit_update(vehicle_id, fields):
    """Emit a SQL UPDATE statement that only fills empty fields (COALESCE pattern)."""
    sets = []

    field_map = {
        'description': ('description', 'text'),
        'vin': ('vin', 'text'),
        'mileage': ('mileage', 'int'),
        'exterior_color': ('color', 'text'),
        'interior_color': ('interior_color', 'text'),
        'transmission': ('transmission', 'text'),
        'drivetrain': ('drivetrain', 'text'),
        'engine': ('engine_size', 'text'),
        'body_style': ('body_style', 'text'),
        'sale_price': ('sale_price', 'int'),
        'high_bid': ('high_bid', 'int'),
        'location': ('location', 'text'),
        'seller_username': ('bat_seller', 'text'),
        'lot_number': ('bat_lot_number', 'text'),
        'reserve_status': ('reserve_status', 'text'),
        'auction_end_date': ('auction_end_date', 'text'),
        'bid_count': ('bat_bids', 'int'),
        'comment_count': ('bat_comments', 'int'),
        'view_count': ('bat_views', 'int'),
        'watcher_count': ('bat_watchers', 'int'),
        'title': ('listing_title', 'text'),
        'primary_image': ('primary_image_url', 'text'),
    }

    for src_field, (db_col, dtype) in field_map.items():
        val = fields.get(src_field)
        if val is None:
            continue
        if dtype == 'int':
            sets.append(f"{db_col} = COALESCE({db_col}, {int(val)})")
        else:
            sets.append(f"{db_col} = COALESCE(NULLIF({db_col}, ''), '{esc(str(val))}')")

    if not sets:
        return None

    return f"UPDATE vehicles SET {', '.join(sets)} WHERE id = '{vehicle_id}';"

# Read pipe: vehicle_id|html pairs (pipe-separated, since HTML can contain anything)
count = 0
skipped = 0
errors = 0

for line in sys.stdin:
    line = line.rstrip('\n')
    if not line:
        continue

    # Split on first pipe character
    pipe_idx = line.find('|')
    if pipe_idx < 0:
        skipped += 1
        continue

    vehicle_id = line[:pipe_idx].strip()
    html_content = line[pipe_idx+1:]

    if not vehicle_id or not html_content or len(html_content) < 500:
        skipped += 1
        continue

    try:
        fields = parse_bat_html(html_content)
        if fields:
            sql = emit_update(vehicle_id, fields)
            if sql:
                print(sql)
                count += 1
            else:
                skipped += 1
        else:
            skipped += 1
    except Exception as e:
        errors += 1
        print(f"-- Error parsing vehicle {vehicle_id}: {e}", file=sys.stderr)

print(f"-- Parsed {count} vehicles, skipped {skipped}, errors {errors}", file=sys.stderr)
