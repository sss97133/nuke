#!/usr/bin/env python3
"""Read listing alerts from Apple Mail without changing mail or following tracking links.

The email is historical testimony; import_queue is only the page-enrichment task.
BHCC gallery IDs resolve against an archived public sitemap, never Pardot links.
Run with dotenvx for writes. --dry-run is offline unless --refresh-sitemap is set.
"""
import argparse
import base64
import email
import email.policy
import fcntl
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from contextlib import closing
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime, parseaddr, getaddresses
from html.parser import HTMLParser
from pathlib import Path

MAIL_DIR = Path.home() / 'Library/Mail/V10'
MAIL_DB = MAIL_DIR / 'MailData/Envelope Index'
STATE_DIR = Path.home() / 'nuke-private-data/email-alerts'
TARGET_EMAIL = os.environ.get('ALERTS_EMAIL', '')
BHCC_HOST = 'www.beverlyhillscarclub.com'
SITEMAP_URL = f'https://{BHCC_HOST}/sitemap.xml'
SOURCE_SLUG = 'beverlyhillscarclub'
VERSION = 'mail-alerts-v3'
SOURCE_SLUGS = {'bhcc': SOURCE_SLUG, 'ksl': 'ksl', 'bat': 'bat', 'carsandbids': 'cars-and-bids'}
SENDERS = {'bhcc': {'sales@beverlyhillscarclub.com'}, 'ksl': {'cars@ksl.com'},
           'bat': {'updates@bringatrailer.com', 'mail@bringatrailer.com'},
           'carsandbids': {'cab@carsandbids.com'}}


def utc(ts=None):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat() if ts is not None else datetime.now(timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix('.tmp')
    with tmp.open('w') as out:
        os.chmod(tmp, 0o600)
        json.dump(value, out, indent=2)
    tmp.replace(path)


class MailHTML(HTMLParser):
    """Extract visible publisher copy and image references; never load resources."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text, self.images, self.links = [], [], []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('style', 'script'):
            self.hidden += 1
        if tag == 'img' and attrs.get('src'):
            self.images.append(attrs['src'])
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])
        if tag in ('br', 'div', 'p', 'td', 'li') and not self.hidden:
            self.text.append('\n')

    def handle_endtag(self, tag):
        if tag in ('style', 'script') and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden:
            self.text.append(data)


def read_emlx(path):
    data = path.read_bytes()
    count, raw = data.split(b'\n', 1)
    n = int(count)
    if n <= 0 or len(raw) < n:
        raise ValueError('incomplete emlx body')
    raw = raw[:n]  # Apple plist is outside the byte-counted RFC message.
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    if msg.defects:
        raise ValueError('malformed MIME message')
    return msg, raw


def canonical_listing(url, source):
    try:
        u = urllib.parse.urlsplit(url)
        if u.scheme not in ('https', 'http') or u.username or u.password or u.port not in (None, 80, 443):
            return None
        host = (u.hostname or '').lower().removeprefix('www.')
        if source == 'bhcc' and host == 'beverlyhillscarclub.com' and re.fullmatch(r'/[\w.-]+-c-\d+\.htm', u.path):
            return f'https://{BHCC_HOST}{u.path}'
        if source == 'ksl' and host in ('ksl.com', 'cars.ksl.com') and re.fullmatch(r'/(?:auto/)?listing/\d+/?', u.path):
            return f'https://cars.ksl.com/auto/listing/{u.path.rstrip("/").split("/")[-1]}'
        if source == 'bat' and host == 'bringatrailer.com' and re.fullmatch(r'/listing/[\w-]+/?', u.path):
            return f'https://bringatrailer.com{u.path.rstrip("/")}/'
        if source == 'carsandbids' and host == 'carsandbids.com' and re.fullmatch(r'/auctions/[\w-]+/[\w-]+/?', u.path):
            return f'https://carsandbids.com{u.path.rstrip("/")}'
    except ValueError:
        pass
    return None


def decode_mailgun_redirect(encoded):
    try:
        encoded = encoded.split('/c/')[-1]
        if len(encoded) > 32768:
            return None
        stream = zlib.decompressobj()
        decoded = stream.decompress(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)), 65537)
        if len(decoded) > 65536 or not stream.eof:
            return None
        decoded = decoded.decode()
        destination = urllib.parse.parse_qs(decoded).get('l', [None])[0]
        return urllib.parse.unquote(destination) if destination else None
    except (ValueError, zlib.error):
        return None


def publisher_fragment(fragment):
    parsed = MailHTML()
    parsed.feed(fragment)
    return parsed, [line.strip() for line in ''.join(parsed.text).splitlines() if line.strip()]


def listing_links(parsed, source):
    urls = set()
    for href in parsed.links:
        if source == 'ksl' and re.fullmatch(r'https?://email\.ksl\.com/c/[\w-]+', href):
            href = decode_mailgun_redirect(href) or ''
        url = canonical_listing(href, source)
        if url:
            urls.add(url)
    return urls


def parse_ksl_cards(html, urls):
    """Each card owns its price/photo; recommendations are separate sightings."""
    cards = []
    fragments = [(part, 'saved_search_match') for part in re.findall(
        r'<!--\s*a listing\s*-->(.*?)<!--\s*end listing\s*-->', html, re.S | re.I)]
    carousel = re.search(r'<!--\s*Carousel\s*-->(.*?)<!--\s*end Carousel listings\s*-->', html, re.S | re.I)
    if carousel:
        fragments += [(part, 'recommendation') for part in re.findall(
            r'<div\b[^>]*class=["\'][^"\']*mj-column-per-50[^"\']*["\'][^>]*>(.*?)</div>',
            carousel[1], re.S | re.I)]
    for fragment, role in fragments:
        parsed, lines = publisher_fragment(fragment)
        links = listing_links(parsed, 'ksl')
        if len(links) != 1 or not lines:
            continue
        url = next(iter(links))
        title = lines[0]
        price_text = next((v for v in lines if re.fullmatch(r'\$[\d,]+(?:\.\d{2})?', v)), None)
        price = float(price_text.replace('$', '').replace(',', '')) if price_text else None
        location = next((v for v in lines if re.fullmatch(r'.+,\s*[A-Z]{2}(?:\s+\d{5})?', v)), None)
        images = sorted({u for u in parsed.images if urllib.parse.urlsplit(u).hostname in ('image.ksldigital.com', 'img.ksl.com')})
        year = re.match(r'((?:18|19|20)\d{2})\s+', title)
        cards.append({'url': url, 'listing_id': url.rsplit('/', 1)[-1], 'title': title,
                      'year': int(year[1]) if year else None, 'asking_price': price,
                      'advertised_price_text': price_text, 'currency': 'USD' if price_text else None,
                      'location_text': location, 'image_urls': images, 'email_role': role,
                      'publisher_copy': '\n'.join(v for v in lines if v != 'View Listing'),
                      'resolution_hold': None, 'resolution_method': 'email_listing_id'})
    # Template drift must not silently lose URLs or invent fields from another card.
    known = {c['url'] for c in cards}
    cards += [{'url': u, 'listing_id': u.rsplit('/', 1)[-1], 'email_role': 'unclassified',
               'publisher_copy': '', 'resolution_hold': 'unrecognized_listing_card'} for u in sorted(urls - known)]
    return cards


class AuctionCards(HTMLParser):
    """Retain auction card copy even when its opaque click link cannot be resolved."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {'tag': 'root', 'attrs': {}, 'children': [], 'parent': None}
        self.stack = [self.root]
        self.images = []

    def handle_starttag(self, tag, attrs):
        node = {'tag': tag, 'attrs': dict(attrs), 'children': [], 'parent': self.stack[-1]}
        self.stack[-1]['children'].append(node)
        if tag == 'img':
            self.images.append(node)
        if tag not in ('img', 'br', 'hr', 'meta', 'link', 'input', 'wbr', 'source'):
            self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i]['tag'] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1]['children'].append(data)

    @staticmethod
    def descendants(node):
        yield node
        for child in node['children']:
            if isinstance(child, dict):
                yield from AuctionCards.descendants(child)

    @staticmethod
    def visible(node):
        if node['tag'] in ('style', 'script'):
            return ''
        return ' '.join(' '.join(c.split()) if isinstance(c, str) else AuctionCards.visible(c)
                        for c in node['children']).strip()


def parse_auction_cards(html, subject, source, urls, plain=''):
    tree = AuctionCards()
    tree.feed(html)
    cards = []
    for img in tree.images:
        title = img['attrs'].get('alt', '').strip()
        src = img['attrs'].get('src', '')
        host = urllib.parse.urlsplit(src).hostname or ''
        if source == 'bat':
            if host != 'bringatrailer.com' or '/wp-content/uploads/' not in src:
                continue
            match = re.fullmatch(r'(.+) now live on BaT', subject)
            if not match:
                continue
            title = match[1]
        elif not re.match(r'(?:18|19|20)\d{2}\s+', title) or host not in (
                'cdn.mcauto-images-production.sendgrid.net', 'media.carsandbids.com', 'carsandbids.com'):
            continue
        node = img['parent']
        card = None
        while node['parent'] is not None:
            text = tree.visible(node)
            titled_images = [n for n in tree.descendants(node) if n['tag'] == 'img'
                            and re.match(r'(?:18|19|20)\d{2}\s+', n['attrs'].get('alt', ''))]
            if node['tag'] in ('td', 'div') and re.search(r'\b(?:18|19|20)\d{2}\s+', text) and len(titled_images) == 1:
                card = node
                break
            node = node['parent']
        node = card or img['parent']
        # The single BaT alert subject is authoritative copy; exclude its personalized greeting/footer.
        copy = tree.visible(card) if card is not None and source != 'bat' else title
        links = {u for n in tree.descendants(node) if n['tag'] == 'a'
                 if (u := canonical_listing(n['attrs'].get('href', ''), source))}
        # The text MIME alternative often exposes canonical links beside the
        # exact card title even though the HTML wraps every link in a tracker.
        labels = {title} | {tree.visible(n) for n in tree.descendants(node) if n['tag'] == 'a'
                            and re.search(r'\b(?:18|19|20)\d{2}\s+', tree.visible(n))}
        for label in labels:
            for match in re.finditer(re.escape(label).replace(r'\ ', r'\s+') + r'\s*\(\s*(https?://[^\s)]+)\s*\)', plain):
                direct = canonical_listing(match[1], source)
                if direct:
                    links.add(direct)
        url = next(iter(links)) if len(links) == 1 else (next(iter(urls)) if source == 'bat' and len(urls) == 1 else None)
        year = re.search(r'\b((?:18|19|20)\d{2})\s+', title)
        cards.append({'url': url, 'title': title, 'year': int(year[1]) if year else None,
                      'publisher_copy': copy, 'image_urls': [src], 'email_role': 'auction_announcement',
                      'resolution_hold': None if url else 'opaque_tracking_link',
                      'resolution_method': 'email_direct_listing_url' if url else None})
    known = {c['url'] for c in cards}
    for match in re.finditer(r'(?m)^([^\r\n()]{1,180}?)\s*\(\s*(https?://[^\s)]+)\s*\)', plain):
        url = canonical_listing(match[2], source)
        title = match[1].strip(' *·-\t')
        if not url or url in known or not title:
            continue
        year = re.search(r'\b((?:18|19|20)\d{2})\s+', title)
        cards.append({'url': url, 'title': title, 'year': int(year[1]) if year else None,
                      'publisher_copy': title, 'image_urls': [], 'email_role': 'linked_listing',
                      'resolution_hold': None, 'resolution_method': 'email_text_listing_link',
                      'extraction_hold': 'text_link_only_no_bound_html_card'})
        known.add(url)
    cards += [{'url': u, 'publisher_copy': '', 'resolution_hold': 'unrecognized_listing_card'} for u in sorted(urls - known)]
    return cards


def sitemap_index(raw):
    index = {}
    for node in ET.fromstring(raw).findall('.//{*}loc'):
        url = canonical_listing(node.text or '', 'bhcc')
        if url:
            listing_id = re.search(r'-c-(\d+)\.htm$', url)[1]
            index.setdefault(listing_id, set()).add(url)
    return index


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def load_sitemap(state_dir, refresh=False):
    cache = state_dir / 'sitemap.xml'
    if refresh and (not cache.exists() or time.time() - cache.stat().st_mtime > 3600):
        # This is the only external acquisition URL. No user/email tokens, pixels,
        # click links or resources from the MIME body ever reach the network.
        req = urllib.request.Request(SITEMAP_URL, headers={'User-Agent': 'Nuke-email-intake/2'})
        with urllib.request.build_opener(NoRedirect).open(req, timeout=25) as resp:
            raw = resp.read(8_000_001)
        if len(raw) > 8_000_000:
            raise ValueError('sitemap exceeded size limit')
        index = sitemap_index(raw)  # validate before replacing the cache
        if not index:
            raise ValueError('public sitemap contains no BHCC listings')
        state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        snapshots = state_dir / 'public-sitemaps'
        snapshots.mkdir(exist_ok=True, mode=0o700)
        (snapshots / f'{digest(raw)}.xml').write_bytes(raw)
        tmp = cache.with_suffix('.tmp')
        tmp.write_bytes(raw)
        tmp.replace(cache)
    if not cache.exists():
        return {}, None
    raw = cache.read_bytes()
    return sitemap_index(raw), digest(raw)


def parse_alert(msg, raw, source, received_ts, index):
    sender = parseaddr(str(msg.get('From', '')))[1].lower()
    if sender not in SENDERS[source]:
        raise ValueError('sender differs from indexed allowlist')
    subject = str(msg.get('Subject', ''))
    bodies, html_bodies, html = [], [], MailHTML()
    for part in msg.walk():
        if part.get_content_disposition() == 'attachment':
            continue
        if part.get_content_type() in ('text/plain', 'text/html'):
            body = part.get_content()
            bodies.append(body)
            if part.get_content_type() == 'text/html':
                html_bodies.append(body)
                html.feed(body)
    try:
        sent = parsedate_to_datetime(str(msg.get('Date', '')))
        if sent.tzinfo is None:
            raise ValueError('Date has no timezone')
        sent_at = sent.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError):
        sent_at = None
    received_at = utc(received_ts)
    message_key = digest(str(msg.get('Message-ID', '')).strip().encode() or raw)
    alert = {'message_key': message_key, 'raw_sha256': digest(raw), 'source': source,
             'subject': subject, 'sender': sender, 'sent_at': sent_at,
             'received_at': received_at, 'observed_at': sent_at or received_at,
             'time_basis': 'email_date' if sent_at else 'mail_received', 'listings': [], 'hold': None}
    text = '\n'.join(bodies)
    urls = set()
    for candidate in html.links + re.findall(r'https?://[^\s"<>]+', text):
        url = canonical_listing(candidate.rstrip(').,'), source)
        if url:
            urls.add(url)
    if source == 'ksl':
        for encoded in re.findall(r'https?://email\.ksl\.com/c/([A-Za-z0-9_-]+)', text):
            url = canonical_listing(decode_mailgun_redirect(encoded) or '', source)
            if url:
                urls.add(url)
        alert['listings'] = parse_ksl_cards('\n'.join(html_bodies), urls)
        if not urls:
            alert['hold'] = 'no_listing_urls'
        return alert
    if source in ('bat', 'carsandbids'):
        plain = '\n'.join(p.get_content() for p in msg.walk()
                          if p.get_content_type() == 'text/plain' and p.get_content_disposition() != 'attachment')
        alert['listings'] = parse_auction_cards('\n'.join(html_bodies), subject, source, urls, plain)
        if not alert['listings']:
            alert['hold'] = 'unrecognized_listing_template'
        return alert
    # One advertised car, not the "Cars Coming Soon" or footer. The gallery ID
    # is a listing identity, distinct from the dealer stock number and any VIN.
    sm = re.fullmatch(r'(.+?),\s*Stock\s*#?\s*(\d+)', subject, re.I)
    if not sm:
        alert['hold'] = 'not_single_vehicle_alert'
        return alert
    year_match = re.search(r'\b((?:18|19|20)\d{2})(?:\.5)?\s+(?=[A-Za-z])', sm[1])
    if not year_match:
        alert['hold'] = 'missing_year_before_make'
        return alert
    year = int(year_match[1])
    stock = sm[2]
    visible = ' '.join(''.join(html.text).split())
    pm = re.search(r'PRICE:\s*\$([\d,]+)\b', visible, re.I)
    inline_stock = re.search(r'PRICE:\s*\$[\d,]+\s*\|\s*STOCK\s*#?\s*(\d+)\b', visible, re.I)
    if not pm or inline_stock and inline_stock[1] != stock:
        alert['hold'] = 'missing_or_conflicting_price_stock'
        return alert
    gallery_ids = set()
    images = []
    for img in html.images:
        u = urllib.parse.urlsplit(img)
        if (u.hostname or '').lower() != BHCC_HOST:
            continue
        im = re.fullmatch(r'/galleria_images/(\d+)/\1_(?:main|p\d+)_l\.jpg', u.path)
        if im:
            gallery_ids.add(im[1])
            images.append(f'https://{BHCC_HOST}{u.path}')
    listing_id = next(iter(gallery_ids)) if len(gallery_ids) == 1 else None
    mapped = index.get(listing_id, set()) if listing_id else set()
    direct = {u for u in urls if listing_id and re.search(rf'-c-{listing_id}\.htm$', u)}
    candidates = mapped | direct
    resolution_hold = None
    url = next(iter(candidates)) if len(candidates) == 1 else None
    if not listing_id:
        resolution_hold = 'missing_or_ambiguous_gallery_identity'
    elif len(candidates) != 1:
        resolution_hold = 'listing_id_not_uniquely_resolved'
    elif urls - {url}:
        resolution_hold, url = 'conflicting_direct_listing', None
    elif not urllib.parse.urlsplit(url).path.startswith(f'/{year}-'):
        resolution_hold, url = 'sitemap_year_conflicts_with_email', None
    title = sm[1]
    # Only retain the publisher's car section, excluding footer/recipient copy.
    start = visible.find('PRICE:')
    stop = visible.find('If you have any additional questions', start)
    if stop == -1:
        stop = visible.find('Cars Coming Soon', start)
    if stop == -1:
        alert['hold'] = 'unrecognized_vehicle_copy_boundary'
        return alert
    alert['listings'] = [{'url': url, 'title': title, 'year': year,
                           'asking_price': int(pm[1].replace(',', '')), 'currency': 'USD',
                           'stock_number': stock, 'listing_id': listing_id,
                           'image_urls': sorted(set(images)) if listing_id else [],
                           'publisher_image_references': sorted(set(images)), 'gallery_ids': sorted(gallery_ids),
                           'resolution_hold': resolution_hold, 'publisher_copy': visible[start:stop].strip(),
                           'resolution_method': ('email_gallery_id_public_sitemap' if mapped else 'email_direct_listing_url') if url else None}]
    return alert


def find_alert_emails(db_path, target=TARGET_EMAIL, source='all', days=None, limit=1000):
    senders = sorted({sender for key, values in SENDERS.items() if source in ('all', key) for sender in values})
    with closing(sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10)) as conn:
        conn.row_factory = sqlite3.Row
        sql = f'''SELECT m.ROWID msg_id,s.subject,m.date_received received_ts,b.url mailbox_url,
                         lower(a.address) sender
                  FROM messages m JOIN subjects s ON s.ROWID=m.subject
                  JOIN addresses a ON a.ROWID=m.sender JOIN mailboxes b ON b.ROWID=m.mailbox
                  WHERE m.deleted=0 AND lower(a.address) IN ({','.join('?' for _ in senders)})
                  AND EXISTS(SELECT 1 FROM recipients r JOIN addresses ra ON ra.ROWID=r.address
                             WHERE r.message=m.ROWID AND lower(ra.address)=?)'''
        params = [*senders, target.lower()]
        if days is not None:
            sql += ' AND m.date_received >= ?'
            params.append(time.time() - days * 86400)
        sql += ' ORDER BY m.date_received DESC LIMIT ?'
        params.append(limit)
        return [dict(r) for r in conn.execute(sql, params)]


def emlx_index(mail_dir, emails):
    accounts = {urllib.parse.urlsplit(e['mailbox_url']).hostname for e in emails}
    index = {}
    for account in accounts:
        if not account or not re.fullmatch(r'[\w-]+', account):
            continue
        # urlsplit lowercases UUID hosts; the on-disk account name may be uppercase.
        root = next((p for p in mail_dir.iterdir() if p.name.lower() == account.lower()), None)
        if root is None:
            continue
        for path in root.rglob('*.emlx'):
            msg_id = path.name.split('.')[0]
            if msg_id not in index or '.partial.' not in path.name:
                index[msg_id] = path
    return index


class Supabase:
    def __init__(self):
        self.url = (os.environ.get('VITE_SUPABASE_URL') or os.environ.get('SUPABASE_URL') or '').rstrip('/')
        self.key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
        if not self.url or not self.key:
            raise ValueError('Run under dotenvx: Supabase URL and service role key are required')

    def request(self, path, body=None, prefer=None):
        headers = {'apikey': self.key, 'Authorization': f'Bearer {self.key}', 'Content-Type': 'application/json'}
        if prefer:
            headers['Prefer'] = prefer
        req = urllib.request.Request(self.url + path, headers=headers,
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=40) as resp:
                data = resp.read()
                return json.loads(data) if data else None
        except urllib.error.HTTPError as err:
            raise RuntimeError(f'Supabase HTTP {err.code}: {err.read().decode()[:250]}') from None

    def rows(self, table, **query):
        return self.request(f'/rest/v1/{table}?' + urllib.parse.urlencode(query))

    def source_config(self, source='bhcc'):
        slug = SOURCE_SLUGS[source]
        rows = self.rows('observation_sources', slug=f'eq.{slug}', select='id,supported_observations')
        if not rows or 'listing' not in (rows[0].get('supported_observations') or []):
            raise ValueError(f'Register {slug} with listing support before ingestion')
        self.observation_source_id = rows[0]['id']
        if source != 'bhcc':
            return None
        scrape = self.rows('scrape_sources', url=f'eq.https://{BHCC_HOST}/inventory.htm', select='id')
        if len(scrape) != 1:
            raise ValueError('BHCC inventory.htm scrape source must resolve uniquely')
        self.observation_source_id = rows[0]['id']
        return scrape[0]['id']

    def bhcc_vehicle_matches(self, listing):
        """Index dealer-linked canonical URLs once per batch; never use image metadata."""
        if not hasattr(self, '_bhcc_listing_vehicles'):
            orgs = self.rows('organizations', slug='eq.beverly-hills-car-club', select='id', limit=2)
            if len(orgs) != 1:
                raise RuntimeError('BHCC organization must resolve uniquely')
            index = {}
            # Keep pages below the deployed REST row cap; a capped page must not
            # silently turn the second half of a dealer's inventory into unknowns.
            page_size = 200
            for offset in range(0, 5000, page_size):
                rows = self.rows('organization_vehicles', organization_id=f'eq.{orgs[0]["id"]}',
                                 select='vehicle_id,vehicles(id,year,discovery_url,listing_url,platform_url)',
                                 order='vehicle_id.asc', offset=offset, limit=page_size)
                for row in rows:
                    vehicle = row.get('vehicles') or {}
                    for field in ('discovery_url', 'listing_url', 'platform_url'):
                        url = canonical_listing(vehicle.get(field) or '', 'bhcc')
                        if url:
                            key = re.search(r'-c-(\d+)\.htm$', url)[1]
                            index.setdefault(key, {})[vehicle['id']] = (url, vehicle.get('year'))
                if len(rows) < page_size:
                    break
            else:
                raise RuntimeError('BHCC identity index exceeded bounded inventory limit')
            self._bhcc_listing_vehicles = index
        candidates = self._bhcc_listing_vehicles.get(listing.get('listing_id'), {})
        # A reused identifier or conflicting year is a hold, not permission to guess.
        if len(candidates) == 1:
            vehicle_id, (url, year) = next(iter(candidates.items()))
            if year == listing['year']:
                return {vehicle_id}, url
        return set(candidates), None

    def ingest(self, alert, listing, source_id, sitemap_sha):
        inventory_ids, inventory_url = self.bhcc_vehicle_matches(listing) if alert['source'] == 'bhcc' else (set(), None)
        if inventory_url and not listing['url']:
            listing = {**listing, 'url': inventory_url, 'resolution_hold': None,
                       'resolution_method': 'existing_dealer_listing_id'}
        queue_payload = {'listing_url': listing['url'], 'status': 'pending', 'priority': 5,
                         'raw_data': {'alert_source': alert['source'], 'alert_message_key': alert['message_key'],
                                      'alert_subject': alert['subject'], 'email_sent_at': alert['sent_at'],
                                      'email_received_at': alert['received_at'], 'raw_sha256': alert['raw_sha256'],
                                      'ingested_via': 'email_alert', 'method': VERSION}}
        if alert['source'] == 'bhcc':
            queue_payload.update(source_id=source_id, listing_title=listing['title'],
                                 listing_year=listing['year'], listing_price=listing['asking_price'])
        result = {'url': listing['url'], 'queue_id': None, 'queue_status': 'not_queued_unresolved_identity',
                  'queued': 0, 'vehicle_id': None, 'resolution_hold': listing.get('resolution_hold')}
        queue = []
        if listing['url'] and alert['source'] != 'ksl':
            # Queue work once; never reset status, vehicle binding or metadata on replay.
            inserted = self.request('/rest/v1/import_queue?on_conflict=listing_url', [queue_payload],
                                    'resolution=ignore-duplicates,return=representation')
            queue = self.rows('import_queue', listing_url=f'eq.{listing["url"]}', select='id,status,vehicle_id')
            if len(queue) != 1:
                raise RuntimeError('queue readback did not return exactly one row')
            result.update(queue_id=queue[0]['id'], queue_status=queue[0]['status'],
                          queued=len(inserted or []), vehicle_id=queue[0].get('vehicle_id'))
        if alert['source'] in SOURCE_SLUGS:
            identifier = f'email:{alert["message_key"]}'
            if alert['source'] != 'bhcc':
                # One message can contain several cars. A repeated listing in a later
                # email is new dated testimony, never a replacement of its older price.
                card_key = listing['url'] if alert['source'] == 'ksl' else json.dumps(
                    [listing.get('title'), listing.get('image_urls'), listing.get('url') if not listing.get('title') else None], sort_keys=True)
                identifier += ':' + digest(card_key.encode())[:24]
            existing = self.rows('vehicle_observations', source_id=f'eq.{self.observation_source_id}',
                                 source_identifier=f'eq.{identifier}',
                                 select='id,source_url,observed_at,ingested_at,vehicle_id,structured_data', limit=2)
            if existing:
                if (len(existing) != 1 or existing[0]['source_url'] and existing[0]['source_url'] != listing['url']
                        or existing[0]['structured_data'].get('raw_sha256') != alert['raw_sha256']):
                    raise RuntimeError('message identity conflicts with existing testimony')
                if not existing[0].get('vehicle_id') and len(inventory_ids) == 1 and inventory_url:
                    vehicle_id = next(iter(inventory_ids))
                    linked = self.request('/rest/v1/rpc/attribute_testimony', {
                        'p_observation_type': 'observation', 'p_observation_id': existing[0]['id'],
                        'p_target_vehicle_id': vehicle_id,
                        'p_reason': f'{VERSION}: exact BHCC dealer-linked listing ID {listing["listing_id"]}; {inventory_url}',
                        'p_signal': 'bhcc_listing_id_exact'})
                    if not linked or not linked.get('success'):
                        raise RuntimeError('sanctioned attribution writer did not confirm linking')
                    verified = self.rows('vehicle_observations', id=f'eq.{existing[0]["id"]}',
                                         select='id,vehicle_id,source_url,observed_at,ingested_at,structured_data')
                    if (len(verified) != 1 or verified[0]['vehicle_id'] != vehicle_id
                            or any(verified[0][key] != existing[0][key] for key in
                                   ('source_url', 'observed_at', 'ingested_at', 'structured_data'))):
                        raise RuntimeError('attribution readback changed original testimony')
                    existing = verified
                    result['attribution_repaired'] = True
                result.update(observation_id=existing[0]['id'], duplicate=True,
                              vehicle_id=existing[0].get('vehicle_id'), ingested_at=existing[0]['ingested_at'])
                return result
            # Match only exact listing testimony, never Y/M/M or a dealer stock number.
            events = self.rows('vehicle_events', source_url=f'eq.{listing["url"]}', select='vehicle_id', limit=5) if listing['url'] else []
            vehicle_ids = {r['vehicle_id'] for r in events if r.get('vehicle_id')} | inventory_ids
            if queue and queue[0].get('vehicle_id'):
                vehicle_ids.add(queue[0]['vehicle_id'])
            vehicle_id = next(iter(vehicle_ids)) if len(vehicle_ids) == 1 and (not inventory_ids or inventory_url) else None
            if alert['source'] == 'ksl':
                result['queue_status'] = 'not_queued_email_evidence_only'
                aliases = [listing['url'], listing['url'].replace('/auto/listing/', '/listing/')]
                matched = self.rows('vehicles', listing_url='in.(' + ','.join(aliases) + ')',
                                    select='id', deleted_at='is.null', limit=3)
                vehicle_ids |= {r['id'] for r in matched}
                vehicle_id = next(iter(vehicle_ids)) if len(vehicle_ids) == 1 else None
            payload = {'source_slug': SOURCE_SLUGS[alert['source']], 'kind': 'listing',
                       'source_url': listing['url'], 'source_identifier': identifier,
                       'observed_at': alert['observed_at'], 'content_text': listing.get('publisher_copy', ''),
                       'structured_data': {**listing, 'kind_detail': 'dealer_email_listing' if alert['source'] == 'bhcc' else 'publisher_email_listing',
                                           'email_sent_at': alert['sent_at'], 'email_received_at': alert['received_at'],
                                           'time_basis': alert['time_basis'], 'raw_sha256': alert['raw_sha256'],
                                           'claim_scope': 'publisher_advertised_at_email_time',
                                           'availability_rule': 'retrospective import; use database ingested_at for machine as-of'},
                       'extraction_method': VERSION, 'agent_tier': 'deterministic', 'defer_analysis': True,
                       'extraction_metadata': {'public_sitemap_sha256': sitemap_sha, 'writer': VERSION},
                       'raw_source_ref': f'sha256:{alert["raw_sha256"]}'}
            # No fuzzy hints: ambiguous/unseen identity stays unbound for later linking.
            if vehicle_id:
                payload['vehicle_id'] = vehicle_id
            observation = self.request('/functions/v1/ingest-observation', payload)
            if not observation or not observation.get('success') or not observation.get('observation_id'):
                raise RuntimeError('observation ingest did not return a durable ID')
            obs_id = observation['observation_id']
            rows = self.rows('vehicle_observations', id=f'eq.{obs_id}',
                             select='id,source_identifier,source_url,observed_at,ingested_at,vehicle_id,structured_data')
            if (len(rows) != 1 or rows[0]['source_identifier'] != payload['source_identifier']
                    or rows[0]['source_url'] != listing['url'] or rows[0]['structured_data'] != payload['structured_data']
                    or datetime.fromisoformat(rows[0]['observed_at']) != datetime.fromisoformat(alert['observed_at'])):
                raise RuntimeError('observation readback differs from email testimony')
            result.update(observation_id=obs_id, duplicate=bool(observation.get('duplicate')),
                          vehicle_id=rows[0].get('vehicle_id'), ingested_at=rows[0]['ingested_at'])
        return result


def run(args):
    state_dir = args.state_dir
    state = json.loads((state_dir / 'state.json').read_text()) if (state_dir / 'state.json').exists() else {'completed': {}}
    if args.message_manifest:
        manifest = json.loads(args.message_manifest.read_text())
        if not isinstance(manifest, list) or len(manifest) > 10000:
            raise ValueError('message manifest must contain at most 10000 raw email references')
        emails, files = [], {}
        for item in manifest:
            path = Path(item['path']).expanduser()
            raw = path.read_bytes()
            msg = email.message_from_bytes(raw, policy=email.policy.default)
            if msg.defects:
                raise ValueError('malformed MIME message')
            sender = parseaddr(str(msg.get('From', '')))[1].lower()
            source = next((k for k, v in SENDERS.items() if sender in v), None)
            recipients = {address.lower() for _, address in getaddresses(
                [str(v) for key in ('To', 'Cc', 'Delivered-To') for v in msg.get_all(key, [])])}
            if args.target_email.lower() not in recipients:
                raise ValueError('manifest message recipient differs from selected mailbox')
            if source is None or args.source not in ('all', source):
                continue
            received = datetime.fromisoformat(item['received_at'])
            if received.tzinfo is None:
                raise ValueError('manifest receipt timestamp requires a timezone')
            if args.days and received.timestamp() < time.time() - args.days * 86400:
                continue
            key = digest(raw)
            emails.append({'msg_id': key, 'sender': sender, 'received_ts': received.timestamp()})
            files[key] = path
        emails = sorted(emails, key=lambda e: e['received_ts'], reverse=True)[:args.limit]
    else:
        emails = find_alert_emails(args.mail_db, args.target_email, args.source, args.days, args.limit)
        files = emlx_index(args.mail_dir, emails)
    has_bhcc = any(e['sender'] == 'sales@beverlyhillscarclub.com' for e in emails)
    index, sitemap_sha = load_sitemap(state_dir, args.refresh_sitemap or not args.dry_run) if has_bhcc else ({}, None)
    report = {'method': VERSION, 'started_at': utc(), 'dry_run': args.dry_run, 'selected': len(emails),
              'cached': 0, 'already_completed': 0, 'holds': {}, 'errors': [], 'results': [],
              'sitemap_sha256': sitemap_sha, 'latest_email_received_at': utc(emails[0]['received_ts']) if emails else None}
    client = None
    attempted = 0
    for em in emails:
        path = files.get(str(em['msg_id']))
        if path is None:
            report['holds']['body_not_cached'] = report['holds'].get('body_not_cached', 0) + 1
            continue
        report['cached'] += 1
        try:
            if args.message_manifest:
                raw = path.read_bytes()
                msg = email.message_from_bytes(raw, policy=email.policy.default)
            else:
                msg, raw = read_emlx(path)
            source = next(key for key, values in SENDERS.items() if em['sender'] in values)
            alert = parse_alert(msg, raw, source, em['received_ts'], index)
            key = alert['message_key']
            if key in state['completed']:
                if state['completed'][key]['raw_sha256'] != alert['raw_sha256']:
                    raise ValueError('same Message-ID has different raw evidence; held for review')
                completed = state['completed'][key]
                needs_resolution = completed.get('resolution_pending') and completed.get('sitemap_sha256') != sitemap_sha
                needs_reparse = completed.get('method') != VERSION and source != 'bhcc'
                if not args.dry_run and not args.replay and not needs_resolution and not needs_reparse:
                    report['already_completed'] += 1
                    continue
            if not args.dry_run:
                if attempted >= args.batch_size:
                    break
                archive = state_dir / 'raw'
                archive.mkdir(parents=True, exist_ok=True, mode=0o700)
                archive_path = archive / f'{alert["raw_sha256"]}.eml'
                if not archive_path.exists():
                    archive_path.write_bytes(raw)
                    archive_path.chmod(0o600)
            if alert['hold']:
                hold = alert['hold']
                report['holds'][hold] = report['holds'].get(hold, 0) + 1
                continue
            if not args.dry_run:
                attempted += 1
            for listing in alert['listings']:
                if args.dry_run:
                    report['results'].append({**listing, 'message_key': key, 'source': source,
                                              'observed_at': alert['observed_at']})
                else:
                    client = client or Supabase()
                    source_id = client.source_config(source)
                    report['results'].append(client.ingest(alert, listing, source_id, sitemap_sha))
            if not args.dry_run:
                state['completed'][key] = {'raw_sha256': alert['raw_sha256'], 'completed_at': utc(),
                                           'resolution_pending': any(not x['url'] for x in alert['listings']),
                                           'sitemap_sha256': sitemap_sha, 'method': VERSION}
                atomic_json(state_dir / 'state.json', state)
        except Exception as err:
            # Never print bodies, tracking links, credentials, or recipient identifiers.
            report['errors'].append({'mail_row': em['msg_id'], 'error': str(err)[:300]})
            if len(report['errors']) >= 3:
                break  # A broken transport isn't hundreds of independent message failures.
    report['finished_at'] = utc()
    report['queue_inserted'] = sum(r.get('queued', 0) for r in report['results'])
    report['observations_verified'] = sum(bool(r.get('observation_id')) for r in report['results'])
    report['source_stale'] = not emails or time.time() - emails[0]['received_ts'] > args.stale_hours * 3600
    report['source_freshness'] = {}
    for source in SOURCE_SLUGS if args.source == 'all' else (args.source,):
        latest = max((e['received_ts'] for e in emails if e['sender'] in SENDERS[source]), default=None)
        report['source_freshness'][source] = {'latest_email_received_at': utc(latest) if latest else None,
                                            'stale': latest is None or time.time() - latest > args.stale_hours * 3600}
    report['source_stale'] = any(v['stale'] for v in report['source_freshness'].values())
    if not args.dry_run:
        atomic_json(state_dir / 'last-run.json', report)
    print(json.dumps(report, indent=2))
    return 1 if report['errors'] else 0


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--refresh-sitemap', action='store_true', help='Fetch only the public BHCC sitemap (no tracking URLs)')
    p.add_argument('--replay', action='store_true', help='Replay completed messages to assay DB idempotency')
    p.add_argument('--source', choices=('all', *SOURCE_SLUGS), default='all')
    p.add_argument('--target-email', default=os.environ.get('MAIL_ALERT_TARGET', TARGET_EMAIL))
    p.add_argument('--days', type=int)
    p.add_argument('--limit', type=int, default=1000)
    p.add_argument('--batch-size', type=int, default=10, help='Maximum unprocessed messages attempted per cycle')
    p.add_argument('--mail-db', type=Path, default=MAIL_DB)
    p.add_argument('--mail-dir', type=Path, default=MAIL_DIR)
    p.add_argument('--message-manifest', type=Path, help='Private JSON array of raw .eml paths and timezone-aware received_at values')
    p.add_argument('--state-dir', type=Path, default=STATE_DIR)
    p.add_argument('--stale-hours', type=int, default=72)
    p.add_argument('--check', action='store_true', help='Fail if last writer failed or alert source is stale')
    args = p.parse_args()
    if not args.target_email and not args.check:
        p.error('set ALERTS_EMAIL/MAIL_ALERT_TARGET or pass --target-email')
    if args.check:
        path = args.state_dir / 'last-run.json'
        report = json.loads(path.read_text()) if path.exists() else {}
        healthy = bool(report) and not report.get('errors') and not report.get('source_stale', True)
        if report:
            healthy = healthy and time.time() - datetime.fromisoformat(report['finished_at']).timestamp() < 900
        print(json.dumps({'healthy': healthy, 'last_run': report.get('finished_at'),
                          'latest_email_received_at': report.get('latest_email_received_at'),
                          'errors': report.get('errors', []), 'holds': report.get('holds', {})}))
        return 0 if healthy else 1
    if args.limit < 1 or args.limit > 10000 or not 1 <= args.batch_size <= 100 or args.days is not None and args.days < 1:
        p.error('limit must be 1..10000; batch-size 1..100; days must be positive')
    args.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (args.state_dir / 'intake.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('email intake already running', file=sys.stderr)
            return 1
        try:
            return run(args)
        except Exception as err:
            report = {'method': VERSION, 'finished_at': utc(), 'source_stale': True,
                      'errors': [{'error': str(err)[:300]}]}
            if not args.dry_run:
                atomic_json(args.state_dir / 'last-run.json', report)
            print(json.dumps(report))
            return 1


if __name__ == '__main__':
    sys.exit(main())
