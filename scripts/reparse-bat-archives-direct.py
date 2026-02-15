#!/usr/bin/env python3
"""
BaT Archive Re-Parser — Direct database approach.

Connects to Supabase Postgres directly, reads archived HTML from
listing_page_snapshots, parses each page, and updates sparse vehicles.

No re-crawling. No edge function calls. Pure local processing.

Usage:
  python3 scripts/reparse-bat-archives-direct.py [--limit 1000] [--dry-run]
"""
import sys
import re
import json
import time
import html as html_module
import argparse

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Installing psycopg2-binary...", file=sys.stderr)
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'psycopg2-binary', '-q'])
    import psycopg2
    import psycopg2.extras

DB_URL = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"

def strip_tags(s):
    if not s: return ''
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html_module.unescape(s)
    return re.sub(r'\s+', ' ', s).strip()

def parse_bat_html(h):
    """Parse BaT listing HTML, return dict of extracted fields."""
    if not h or len(h) < 500:
        return {}

    f = {}

    # Title
    og = re.search(r'<meta[^>]*property=["\']og:title["\'][^>]*content=["\']([^"\']+)["\']', h, re.I)
    tt = re.search(r'<title[^>]*>([^<]+)</title>', h, re.I)
    raw = (og.group(1) if og else (tt.group(1) if tt else '')).strip()
    clean = re.sub(r'\s*\|\s*Bring a Trailer.*$', '', raw)
    clean = re.sub(r'\s+for sale on BaT Auctions.*$', '', clean, flags=re.I)
    if clean.strip():
        f['listing_title'] = clean.strip()[:500]

    # Description
    dm = re.search(r'<div[^>]*class=["\'][^"\']*post-excerpt[^"\']*["\'][^>]*>([\s\S]*?)</div>', h, re.I)
    if not dm:
        dm = re.search(r'<div[^>]*class=["\'][^"\']*post-content[^"\']*["\'][^>]*>([\s\S]*?)</div>', h, re.I)
    if dm:
        d = strip_tags(dm.group(1))
        if len(d) > 40: f['description'] = d[:2000]
    if 'description' not in f:
        md = re.search(r'<meta[^>]*property=["\']og:description["\'][^>]*content=["\']([^"\']+)["\']', h, re.I)
        if md and len(strip_tags(md.group(1))) > 40:
            f['description'] = strip_tags(md.group(1))[:2000]

    # Essentials window
    ei = h.find('<div class="essentials"')
    win = h[ei:ei+50000] if ei >= 0 else h[:50000]

    # Seller
    m = re.search(r'<strong>Seller</strong>:\s*<a[^>]*>([^<]+)</a>', win, re.I)
    if m: f['bat_seller'] = strip_tags(m.group(1))

    # Location
    m = re.search(r'<strong>Location</strong>:\s*<a[^>]*>([^<]+)</a>', win, re.I)
    if m: f['location'] = strip_tags(m.group(1))

    # Lot
    m = re.search(r'<strong>Lot</strong>\s*#([0-9,]+)', win, re.I)
    if m: f['bat_lot_number'] = m.group(1).replace(',', '')

    # Reserve
    scope = strip_tags(win) + ' ' + raw
    if 'no-reserve' in scope.lower() or re.search(r'\bNo Reserve\b', scope, re.I):
        f['reserve_status'] = 'no_reserve'
    elif re.search(r'\bReserve Not Met\b', scope, re.I):
        f['reserve_status'] = 'reserve_not_met'

    # Auction end
    m = re.search(r'data-ends="(\d+)"', h, re.I)
    if m:
        ts = int(m.group(1))
        if ts > 0:
            from datetime import datetime, timezone
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            f['auction_end_date'] = dt.strftime('%Y-%m-%d')
            f['sale_date'] = dt.strftime('%Y-%m-%d')

    # Sale price from title
    m = re.search(r'\bsold\s+for\s+\$?\s*([0-9,]+)', raw, re.I)
    if m:
        p = int(m.group(1).replace(',', ''))
        if 100 < p < 100_000_000: f['sale_price'] = p

    # Sale price from stats table
    if 'sale_price' not in f:
        st = re.search(r'<table[^>]*id=["\']listing-bid["\'][^>]*>[\s\S]*?</table>', h, re.I)
        if st:
            rnm = 'Reserve Not Met' in st.group(0)
            sm = re.search(r'Sold.*?<strong>\s*(?:USD\s*)?\$?\s*([0-9,.]+)', st.group(0), re.I)
            if sm and not rnm:
                p = int(sm.group(1).replace(',', '').split('.')[0])
                if 100 < p < 100_000_000: f['sale_price'] = p

    # Counts
    f['bat_bids'] = len(re.findall(r'"type":"bat-bid"', h))
    m = re.search(r'<span class="info-value">(\d+)</span>\s*<span class="info-label">Comments</span>', h, re.I)
    if m: f['bat_comments'] = int(m.group(1))
    m = re.search(r'data-stats-item="views">([0-9,]+)', h, re.I)
    if m: f['bat_views'] = int(m.group(1).replace(',', ''))
    m = re.search(r'data-stats-item="watchers">([0-9,]+)', h, re.I)
    if m: f['bat_watchers'] = int(m.group(1).replace(',', ''))

    # Listing Details
    dlm = re.search(r'<strong>Listing Details</strong>[\s\S]*?<ul>([\s\S]*?)</ul>', win, re.I)
    if dlm:
        items = [strip_tags(x) for x in re.findall(r'<li[^>]*>([\s\S]*?)</li>', dlm.group(1), re.I)]
        for item in items:
            if 'vin' not in f:
                vm = re.match(r'^(?:VIN|Chassis)\s*:\s*([A-HJ-NPR-Z0-9]{4,17})\b', item, re.I)
                if vm: f['vin'] = vm.group(1).upper()
            if 'mileage' not in f:
                mm = re.search(r'\b([0-9,]+)\s*Miles?\b', item, re.I)
                if mm:
                    n = int(mm.group(1).replace(',', ''))
                    if 0 < n < 10_000_000: f['mileage'] = n
                else:
                    mk = re.search(r'\b(\d+(?:\.\d+)?)\s*k\s*Miles?\b', item, re.I)
                    if mk:
                        n = round(float(mk.group(1)) * 1000)
                        if 0 < n < 10_000_000: f['mileage'] = n
            if 'transmission' not in f:
                if (len(item) <= 80 and
                    not re.search(r'miles|paint|upholstery|chassis|vin|engine', item, re.I) and
                    (re.search(r'transmission|transaxle|gearbox|cvt|dct', item, re.I) or
                     (re.search(r'\b(manual|automatic)\b', item, re.I) and re.search(r'\d{1,2}-speed', item, re.I)))):
                    f['transmission'] = item
            if 'drivetrain' not in f:
                dm = re.search(r'\b(AWD|4WD|RWD|FWD|4x4)\b', item, re.I)
                if dm:
                    r_val = dm.group(1).upper()
                    f['drivetrain'] = '4WD' if r_val == '4X4' else r_val
                else:
                    il = item.lower()
                    for pat, val in [('rear-wheel drive', 'RWD'), ('front-wheel drive', 'FWD'),
                                     ('all-wheel drive', 'AWD'), ('four-wheel drive', '4WD')]:
                        if pat in il: f['drivetrain'] = val; break
            if 'engine_size' not in f:
                if ((re.search(r'\d+(?:\.\d+)?-?\s*Liter|\d+(?:\.\d+)?\s*L\b|V\d\b', item, re.I) or
                     re.search(r'[0-9,]{3,5}\s*cc|cubic\s+inch|flat[-\s]?(four|six)', item, re.I)) and
                    not re.search(r'exhaust|wheels|brakes', item, re.I)):
                    f['engine_size'] = item
            if 'color' not in f:
                pm = re.match(r'^(.+?)\s+Paint\b', item, re.I)
                if pm: f['color'] = pm.group(1).strip()
                if 'color' not in f:
                    fm = re.search(r'\b(?:Finished|Repainted)\s+in\s+(.{2,60})', item, re.I)
                    if fm: f['color'] = fm.group(1).strip()
            if 'interior_color' not in f:
                um = re.match(r'^(.+?)\s+Upholstery\b', item, re.I)
                if um: f['interior_color'] = um.group(1).strip()

    # Body style from title
    if 'body_style' not in f and f.get('listing_title'):
        t = f['listing_title'].lower()
        for pat, val in [(r'\bcoupe\b', 'Coupe'), (r'\bconvertible\b|\bcabriolet\b', 'Convertible'),
                         (r'\broadster\b', 'Roadster'), (r'\bsedan\b', 'Sedan'), (r'\bwagon\b', 'Wagon'),
                         (r'\bhatchback\b', 'Hatchback'), (r'\bpickup\b|\btruck\b', 'Truck'),
                         (r'\bfastback\b', 'Fastback'), (r'\bsuv\b', 'SUV'), (r'\bvan\b', 'Van')]:
            if re.search(pat, t, re.I): f['body_style'] = val; break

    # Primary image
    gm = re.search(r'data-gallery-items=(?:"([^"]+)"|\'([^\']+)\')', h, re.I)
    if gm:
        enc = (gm.group(1) or gm.group(2) or '').strip()
        if enc:
            jt = enc.replace('&quot;', '"').replace('&#038;', '&').replace('&amp;', '&')
            try:
                items = json.loads(jt)
                for it in items:
                    u = it.get('full', {}).get('url') or it.get('original', {}).get('url') or ''
                    if u and 'bringatrailer.com/wp-content/uploads/' in u:
                        f['primary_image_url'] = u.split('?')[0].split('#')[0]
                        break
            except: pass

    # Colors from description
    desc = f.get('description', '')
    if desc and 'color' not in f:
        for pat in [r'\bfinished\s+in\s+([A-Za-z][A-Za-z\s/-]{2,50}?)(?=\s+(?:over|with|and)\b|[.,;]|$)',
                    r'\brepainted\s+in\s+([A-Za-z][A-Za-z\s/-]{2,50}?)(?=\s+(?:over|with|and)\b|[.,;]|$)']:
            m = re.search(pat, desc, re.I)
            if m and 2 <= len(m.group(1).strip()) <= 60:
                f['color'] = m.group(1).strip(); break
    if desc and 'interior_color' not in f:
        for pat in [r'\bover\s+(?:a\s+)?([A-Za-z][A-Za-z\s/-]{2,40}?)\s+(?:leather|vinyl|cloth|interior)\b',
                    r'\b([A-Za-z][A-Za-z\s/-]{2,40}?)\s+(?:leather|vinyl|cloth)\s+interior\b']:
            m = re.search(pat, desc, re.I)
            if m and 2 <= len(m.group(1).strip()) <= 60:
                f['interior_color'] = m.group(1).strip(); break

    return f

def build_update(fields, vehicle_id, text_cols, date_cols, coalesce_cols, exclude_vin=False):
    """Build UPDATE SQL + values from parsed fields. Returns (sql, values) or (None, None)."""
    set_parts = []
    values = []
    for col in text_cols:
        if exclude_vin and col == 'vin':
            continue
        if col in fields and fields[col]:
            set_parts.append(f"{col} = COALESCE(NULLIF({col}, ''), %s)")
            values.append(str(fields[col]))
    for col in date_cols:
        if col in fields and fields[col]:
            set_parts.append(f"{col} = COALESCE({col}, %s)")
            values.append(str(fields[col]))
    for col in coalesce_cols:
        if col in fields and fields[col]:
            v = fields[col]
            if isinstance(v, int) and v > 0:
                set_parts.append(f"{col} = COALESCE({col}, %s)")
                values.append(v)
    if not set_parts:
        return None, None
    values.append(vehicle_id)
    return f"UPDATE vehicles SET {', '.join(set_parts)} WHERE id = %s", values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=200000)
    parser.add_argument('--batch-size', type=int, default=20)
    parser.add_argument('--page-size', type=int, default=5000)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True

    text_cols = {'listing_title', 'description', 'bat_seller', 'location', 'bat_lot_number',
                 'reserve_status', 'vin', 'transmission',
                 'drivetrain', 'engine_size', 'color', 'interior_color', 'body_style',
                 'primary_image_url'}
    coalesce_cols = {'mileage', 'sale_price', 'bat_bids', 'bat_comments', 'bat_views', 'bat_watchers'}
    date_cols = {'auction_end_date', 'sale_date'}

    total = 0
    updated = 0
    skipped = 0
    errors = 0
    vin_dupes = 0
    no_html = 0
    start = time.time()
    cur = conn.cursor()

    # Step 1: Load vehicle IDs + listing URLs (paginated to avoid timeout)
    print(f"[{time.strftime('%H:%M:%S')}] Finding sparse BaT vehicles (paginated)...", file=sys.stderr)
    vehicles = []
    offset = 0
    while len(vehicles) < args.limit:
        cur.execute("""
            SELECT v.id, v.listing_url
            FROM vehicles v
            WHERE COALESCE(v.listing_source, v.platform_source, v.source) IN ('bringatrailer', 'bat_simple_extract', 'bat')
              AND v.listing_url IS NOT NULL
              AND v.listing_url LIKE '%%bringatrailer.com/listing/%%'
              AND (v.description IS NULL OR v.mileage IS NULL OR v.vin IS NULL
                   OR v.color IS NULL OR v.sale_price IS NULL OR v.transmission IS NULL)
            ORDER BY v.id
            LIMIT %s OFFSET %s
        """, (args.page_size, offset))
        page = cur.fetchall()
        if not page:
            break
        vehicles.extend(page)
        offset += args.page_size
        print(f"  ... loaded {len(vehicles)} vehicles (page {offset // args.page_size})", file=sys.stderr)

    vehicles = vehicles[:args.limit]
    print(f"[{time.strftime('%H:%M:%S')}] Found {len(vehicles)} sparse vehicles", file=sys.stderr)

    # Step 2: Process in batches — batch-read HTML, parse locally, batch-write updates
    bs = args.batch_size
    for batch_start in range(0, len(vehicles), bs):
        batch = vehicles[batch_start:batch_start + bs]

        # Build URL lookup: url -> vehicle_id (include trailing-slash variants)
        url_to_vid = {}
        all_urls = []
        for vid, url in batch:
            vid_str = str(vid)
            url_to_vid[url] = vid_str
            url_to_vid[url + '/'] = vid_str
            all_urls.append(url)
            all_urls.append(url + '/')

        # Batch-fetch HTML from listing_page_snapshots using DISTINCT ON
        try:
            cur.execute("""
                SELECT DISTINCT ON (listing_url) listing_url, html
                FROM listing_page_snapshots
                WHERE platform = 'bat' AND success = true AND html IS NOT NULL
                  AND listing_url = ANY(%s)
                ORDER BY listing_url, fetched_at DESC
            """, (all_urls,))
            html_rows = cur.fetchall()
        except Exception as e:
            print(f"  Batch HTML fetch error at {batch_start}: {e}", file=sys.stderr)
            errors += len(batch)
            total += len(batch)
            continue

        # Map URL -> HTML (prefer exact match, fallback to slash variant)
        url_html = {}
        for row_url, row_html in html_rows:
            if row_html:
                url_html[row_url] = row_html

        # Parse each vehicle in this batch
        for vid, listing_url in batch:
            vehicle_id = str(vid)
            total += 1

            html_content = url_html.get(listing_url) or url_html.get(listing_url + '/')
            if not html_content:
                skipped += 1
                no_html += 1
                continue

            fields = parse_bat_html(html_content)
            if not fields:
                skipped += 1
                continue

            sql, values = build_update(fields, vehicle_id, text_cols, date_cols, coalesce_cols)
            if not sql:
                skipped += 1
                continue

            if args.dry_run:
                field_names = [k for k in list(text_cols) + list(date_cols) + list(coalesce_cols) if k in fields and fields[k]]
                print(f"DRY RUN: {vehicle_id} -> {field_names}", file=sys.stderr)
                updated += 1
                continue

            try:
                cur.execute(sql, values)
                updated += 1
            except Exception as e:
                err_str = str(e)
                if 'vehicles_vin_unique_index' in err_str or 'duplicate key value' in err_str:
                    vin_dupes += 1
                    try:
                        sql2, values2 = build_update(fields, vehicle_id, text_cols, date_cols, coalesce_cols, exclude_vin=True)
                        if sql2:
                            cur.execute(sql2, values2)
                            updated += 1
                        else:
                            skipped += 1
                    except Exception as e2:
                        errors += 1
                        if errors <= 10:
                            print(f"Error (vin retry) {vehicle_id}: {e2}", file=sys.stderr)
                else:
                    errors += 1
                    if errors <= 10:
                        print(f"Error {vehicle_id}: {e}", file=sys.stderr)

        if total % 500 < bs:
            elapsed = time.time() - start
            rate = total / max(elapsed, 1)
            remaining = (len(vehicles) - total) / max(rate, 0.01)
            print(f"[{time.strftime('%H:%M:%S')}] {total}/{len(vehicles)} | Updated: {updated} | Skipped: {skipped} (no_html:{no_html}) | VIN dupes: {vin_dupes} | Errors: {errors} | {rate:.1f}/sec | ~{int(remaining//60)}m left", file=sys.stderr)

    cur.close()

    elapsed = time.time() - start
    print(f"\n[{time.strftime('%H:%M:%S')}] ===== COMPLETE =====", file=sys.stderr)
    print(f"Total: {total} | Updated: {updated} | Skipped: {skipped} (no_html:{no_html}) | VIN dupes: {vin_dupes} | Errors: {errors}", file=sys.stderr)
    print(f"Duration: {int(elapsed//60)}m {int(elapsed%60)}s | Rate: {total/max(elapsed,1):.1f}/sec", file=sys.stderr)

    conn.close()

if __name__ == '__main__':
    main()
