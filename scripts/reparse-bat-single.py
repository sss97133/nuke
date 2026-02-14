#!/usr/bin/env python3
"""Parse a single BaT HTML page from stdin, emit SQL UPDATE for the given vehicle ID."""
import sys
import re
import json
import html as html_module

def strip_tags(s):
    if not s: return ''
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html_module.unescape(s)
    return re.sub(r'\s+', ' ', s).strip()

def esc(s):
    return s.replace("'", "''") if s else ''

def main():
    if len(sys.argv) < 2:
        print("--", end="")
        return
    vehicle_id = sys.argv[1]
    h = sys.stdin.read()
    if not h or len(h) < 500:
        print("--", end="")
        return

    fields = {}

    # Title
    og = re.search(r'<meta[^>]*property=["\']og:title["\'][^>]*content=["\']([^"\']+)["\']', h, re.I)
    title_tag = re.search(r'<title[^>]*>([^<]+)</title>', h, re.I)
    raw_title = (og.group(1) if og else (title_tag.group(1) if title_tag else '')).strip()
    clean_title = re.sub(r'\s*\|\s*Bring a Trailer.*$', '', raw_title)
    clean_title = re.sub(r'\s+for sale on BaT Auctions.*$', '', clean_title, flags=re.I)
    if clean_title.strip():
        fields['title'] = clean_title.strip()

    # Description
    desc_match = re.search(r'<div[^>]*class=["\'][^"\']*post-excerpt[^"\']*["\'][^>]*>([\s\S]*?)</div>', h, re.I)
    if not desc_match:
        desc_match = re.search(r'<div[^>]*class=["\'][^"\']*post-content[^"\']*["\'][^>]*>([\s\S]*?)</div>', h, re.I)
    if desc_match:
        desc = strip_tags(desc_match.group(1))
        if len(desc) > 40:
            fields['description'] = desc[:2000]
    if 'description' not in fields:
        meta_desc = re.search(r'<meta[^>]*property=["\']og:description["\'][^>]*content=["\']([^"\']+)["\']', h, re.I)
        if meta_desc:
            d = strip_tags(meta_desc.group(1))
            if len(d) > 40:
                fields['description'] = d[:2000]

    # Essentials
    ess_idx = h.find('<div class="essentials"')
    win = h[ess_idx:ess_idx+50000] if ess_idx >= 0 else h[:50000]

    # Seller
    m = re.search(r'<strong>Seller</strong>:\s*<a[^>]*>([^<]+)</a>', win, re.I)
    if m: fields['seller_username'] = strip_tags(m.group(1))

    # Location
    m = re.search(r'<strong>Location</strong>:\s*<a[^>]*>([^<]+)</a>', win, re.I)
    if m: fields['location'] = strip_tags(m.group(1))

    # Lot
    m = re.search(r'<strong>Lot</strong>\s*#([0-9,]+)', win, re.I)
    if m: fields['lot_number'] = m.group(1).replace(',', '')

    # Reserve
    scope = strip_tags(win) + ' ' + raw_title
    if 'no-reserve' in scope.lower() or re.search(r'\bNo Reserve\b', scope, re.I):
        fields['reserve_status'] = 'no_reserve'
    elif re.search(r'\bReserve Not Met\b', scope, re.I):
        fields['reserve_status'] = 'reserve_not_met'

    # Sale price from title
    m = re.search(r'\bsold\s+for\s+\$?\s*([0-9,]+)', raw_title, re.I)
    if m:
        p = int(m.group(1).replace(',', ''))
        if 100 < p < 100_000_000:
            fields['sale_price'] = p

    # Sale price from stats table
    if 'sale_price' not in fields:
        st = re.search(r'<table[^>]*id=["\']listing-bid["\'][^>]*>[\s\S]*?</table>', h, re.I)
        if st:
            sm = re.search(r'Sold.*?<strong>\s*(?:USD\s*)?\$?\s*([0-9,.]+)', st.group(0), re.I)
            if sm and 'Reserve Not Met' not in st.group(0):
                p = int(sm.group(1).replace(',', '').split('.')[0])
                if 100 < p < 100_000_000:
                    fields['sale_price'] = p

    # Bid/comment/view/watcher counts
    fields['bid_count'] = len(re.findall(r'"type":"bat-bid"', h))
    m = re.search(r'<span class="info-value">(\d+)</span>\s*<span class="info-label">Comments</span>', h, re.I)
    if m: fields['comment_count'] = int(m.group(1))
    m = re.search(r'data-stats-item="views">([0-9,]+)', h, re.I)
    if m: fields['view_count'] = int(m.group(1).replace(',', ''))
    m = re.search(r'data-stats-item="watchers">([0-9,]+)', h, re.I)
    if m: fields['watcher_count'] = int(m.group(1).replace(',', ''))

    # Listing Details
    details_m = re.search(r'<strong>Listing Details</strong>[\s\S]*?<ul>([\s\S]*?)</ul>', win, re.I)
    if details_m:
        items = [strip_tags(m) for m in re.findall(r'<li[^>]*>([\s\S]*?)</li>', details_m.group(1), re.I)]
        for item in items:
            if 'vin' not in fields:
                vm = re.match(r'^(?:VIN|Chassis)\s*:\s*([A-HJ-NPR-Z0-9]{4,17})\b', item, re.I)
                if vm: fields['vin'] = vm.group(1).upper()
            if 'mileage' not in fields:
                mm = re.search(r'\b([0-9,]+)\s*Miles?\b', item, re.I)
                if mm:
                    n = int(mm.group(1).replace(',', ''))
                    if 0 < n < 10_000_000: fields['mileage'] = n
                else:
                    mk = re.search(r'\b(\d+(?:\.\d+)?)\s*k\s*Miles?\b', item, re.I)
                    if mk:
                        n = round(float(mk.group(1)) * 1000)
                        if 0 < n < 10_000_000: fields['mileage'] = n
            if 'transmission' not in fields:
                if (len(item) <= 80 and
                    not re.search(r'(miles|paint|upholstery|chassis|vin|engine)\b', item, re.I) and
                    (re.search(r'\btransmission\b|\btransaxle\b|\bgearbox\b|\bcvt\b|\bdct\b', item, re.I) or
                     (re.search(r'\b(manual|automatic)\b', item, re.I) and
                      re.search(r'\b\d{1,2}-speed\b', item, re.I)))):
                    fields['transmission'] = item
            if 'drivetrain' not in fields:
                dm = re.search(r'\b(AWD|4WD|RWD|FWD|4x4)\b', item, re.I)
                if dm:
                    r_val = dm.group(1).upper()
                    fields['drivetrain'] = '4WD' if r_val == '4X4' else r_val
                else:
                    il = item.lower()
                    for pat, val in [('rear-wheel drive', 'RWD'), ('front-wheel drive', 'FWD'),
                                     ('all-wheel drive', 'AWD'), ('four-wheel drive', '4WD'), ('4x4', '4WD')]:
                        if pat in il:
                            fields['drivetrain'] = val
                            break
            if 'engine' not in fields:
                if ((re.search(r'\b\d+(?:\.\d+)?-?\s*Liter\b|\b\d+(?:\.\d+)?\s*L\b|\bV\d\b', item, re.I) or
                     re.search(r'\b[0-9,]{3,5}\s*cc\b|\bcubic\s+inch\b|\bflat[-\s]?(four|six)\b', item, re.I)) and
                    not re.search(r'exhaust|wheels|brakes', item, re.I)):
                    fields['engine'] = item
            if 'exterior_color' not in fields:
                pm = re.match(r'^(.+?)\s+Paint\b', item, re.I)
                if pm: fields['exterior_color'] = pm.group(1).strip()
                if 'exterior_color' not in fields:
                    fm = re.search(r'\b(?:Finished|Repainted)\s+in\s+(.{2,60})', item, re.I)
                    if fm: fields['exterior_color'] = fm.group(1).strip()
            if 'interior_color' not in fields:
                um = re.match(r'^(.+?)\s+Upholstery\b', item, re.I)
                if um: fields['interior_color'] = um.group(1).strip()

    # Body style from title
    if 'body_style' not in fields and clean_title:
        t = clean_title.lower()
        for pat, val in [(r'\bcoupe\b', 'Coupe'), (r'\bconvertible\b|\bcabriolet\b', 'Convertible'),
                         (r'\broadster\b', 'Roadster'), (r'\bsedan\b', 'Sedan'), (r'\bwagon\b', 'Wagon'),
                         (r'\bhatchback\b', 'Hatchback'), (r'\bpickup\b|\btruck\b', 'Truck'),
                         (r'\bfastback\b', 'Fastback'), (r'\bsuv\b', 'SUV'), (r'\bvan\b', 'Van')]:
            if re.search(pat, t, re.I):
                fields['body_style'] = val
                break

    # Primary image
    gm = re.search(r'data-gallery-items=(?:"([^"]+)"|\'([^\']+)\')', h, re.I)
    if gm:
        encoded = (gm.group(1) or gm.group(2) or '').strip()
        if encoded:
            jt = encoded.replace('&quot;', '"').replace('&#038;', '&').replace('&amp;', '&')
            try:
                items = json.loads(jt)
                for it in items:
                    u = it.get('full', {}).get('url') or it.get('original', {}).get('url') or ''
                    if u and 'bringatrailer.com/wp-content/uploads/' in u:
                        u = u.split('?')[0].split('#')[0]
                        fields['primary_image'] = u
                        break
            except: pass

    # Build UPDATE
    col_map = {
        'description': ('description', 'text'), 'vin': ('vin', 'text'),
        'mileage': ('mileage', 'int'), 'exterior_color': ('color', 'text'),
        'interior_color': ('interior_color', 'text'), 'transmission': ('transmission', 'text'),
        'drivetrain': ('drivetrain', 'text'), 'engine': ('engine_size', 'text'),
        'body_style': ('body_style', 'text'), 'sale_price': ('sale_price', 'int'),
        'location': ('location', 'text'), 'seller_username': ('bat_seller', 'text'),
        'lot_number': ('bat_lot_number', 'text'), 'reserve_status': ('reserve_status', 'text'),
        'title': ('listing_title', 'text'), 'primary_image': ('primary_image_url', 'text'),
        'bid_count': ('bat_bids', 'int'), 'comment_count': ('bat_comments', 'int'),
        'view_count': ('bat_views', 'int'), 'watcher_count': ('bat_watchers', 'int'),
    }

    sets = []
    for src, (col, dtype) in col_map.items():
        val = fields.get(src)
        if val is None or (isinstance(val, int) and val == 0 and src in ('bid_count',)):
            continue
        if dtype == 'int':
            sets.append(f"{col} = COALESCE({col}, {int(val)})")
        else:
            sets.append(f"{col} = COALESCE(NULLIF({col}, ''), '{esc(str(val))}')")

    if sets:
        print(f"UPDATE vehicles SET {', '.join(sets)} WHERE id = '{vehicle_id}';")
    else:
        print("--", end="")

if __name__ == '__main__':
    main()
