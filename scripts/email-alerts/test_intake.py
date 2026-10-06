"""Offline contracts for MIME, acquisition identity, provenance and durable acknowledgement."""
import importlib.util
import json
import base64
import urllib.parse
import zlib
import sqlite3
import tempfile
import unittest
import contextlib
import io
from types import SimpleNamespace
from email.message import EmailMessage
from pathlib import Path

spec = importlib.util.spec_from_file_location('intake', Path(__file__).parents[1] / 'ingest-mail-alerts.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
URL = 'https://www.beverlyhillscarclub.com/1968-ford-mustang-c-code-coupe-c-18808.htm'


def message(price_stock='PRICE: $29,950 | STOCK 19787', gallery=18808, subject=None):
    msg = EmailMessage()
    msg['From'] = 'Beverly Hills Car Club <sales@beverlyhillscarclub.com>'
    msg['To'] = 'private-recipient@example.test'
    msg['Subject'] = subject or '1968 Ford Mustang C-Code Coupe, Stock 19787'
    msg['Date'] = 'Fri, 1 May 2026 19:59:45 -0600'
    msg['Message-ID'] = '<synthetic-not-real@example.test>'
    msg.set_content('Plain text omits the car card.')
    msg.add_alternative(f'''<style>ignored tracker script</style><div>{price_stock}</div>
        <div>1968 Ford Mustang C-Code Coupe</div><p>Seller claims a V8 engine.</p>
        <img src="https://www.beverlyhillscarclub.com/galleria_images/{gallery}/{gallery}_main_l.jpg">
        <a href="https://go.pardot.com/e/893391/2026-05-01/opaque/private-token">SHOP NOW</a>
        <div>If you have any additional questions please call us.</div>
        <div>Cars Coming Soon 1970 Porsche 911</div><p>Sent to private-recipient@example.test</p>''', subtype='html')
    return msg


def parse(msg=None, index=None):
    msg = msg or message()
    return m.parse_alert(msg, msg.as_bytes(), 'bhcc', 1777687188, index if index is not None else {'18808': {URL}})


class ParserTests(unittest.TestCase):
    def test_decimal_engine_slug_is_a_valid_public_listing(self):
        url = 'https://www.beverlyhillscarclub.com/1958-jaguar-xk150s-3.4-roadster-c-15218.htm'
        self.assertEqual(m.canonical_listing(url, 'bhcc'), url)
        self.assertEqual(m.sitemap_index(f'<urlset><url><loc>{url}</loc></url></urlset>'.encode()), {'15218': {url}})

    def test_card_fields_and_separate_clocks(self):
        a = parse()
        self.assertIsNone(a['hold'])
        self.assertEqual(a['sent_at'], '2026-05-02T01:59:45+00:00')
        self.assertNotEqual(a['sent_at'], a['received_at'])
        self.assertEqual(a['listings'][0]['asking_price'], 29950)
        self.assertEqual(a['listings'][0]['stock_number'], '19787')
        self.assertEqual(a['listings'][0]['listing_id'], '18808')
        self.assertEqual(a['listings'][0]['url'], URL)
        copy = a['listings'][0]['publisher_copy']
        self.assertNotIn('Coming Soon', copy)
        self.assertNotIn('private-recipient', copy)
        self.assertNotIn('private-token', json.dumps(a))
        self.assertNotIn('ignored tracker', copy)

    def test_older_card_price_without_inline_stock(self):
        self.assertEqual(parse(message('PRICE: $29,950'))['listings'][0]['asking_price'], 29950)

    def test_observed_subject_variants(self):
        for title in ('Euro 1968 Ford Mustang', '31k-Mile - 1968 Ford Mustang',
                      'Rare 1968 Ford Mustang', 'Matching-Numbers 1968 Ford Mustang',
                      'One of 350: 1968 Ford Mustang'):
            with self.subTest(title=title):
                a = parse(message(subject=title + ', Stock#19787'))
                self.assertIsNone(a['hold'])
                self.assertEqual(a['listings'][0]['year'], 1968)

    def test_model_number_is_not_a_second_year(self):
        a = parse(message(subject='1973 Alfa Romeo 2000 Spider Veloce, Stock 19787'), index={})
        self.assertIsNone(a['hold'])
        self.assertEqual(a['listings'][0]['year'], 1973)

    def test_stock_conflict_holds(self):
        self.assertEqual(parse(message('PRICE: $29,950 | STOCK 99999'))['hold'], 'missing_or_conflicting_price_stock')

    def test_editorial_newsletter_is_not_a_listing(self):
        self.assertEqual(parse(message(subject='Car Tales: a great Mustang'))['hold'], 'not_single_vehicle_alert')

    def test_assayed_numbers_matching_subject(self):
        a = parse(message(subject='Numbers-Matching 1968 Ford Mustang C-Code Coupe, Stock 19787'))
        self.assertEqual(a['listings'][0]['year'], 1968)

    def test_expired_sitemap_retains_historical_testimony(self):
        a = parse(index={})
        self.assertIsNone(a['hold'])
        self.assertIsNone(a['listings'][0]['url'])
        self.assertEqual(a['listings'][0]['asking_price'], 29950)
        self.assertEqual(a['listings'][0]['resolution_hold'], 'listing_id_not_uniquely_resolved')

    def test_ambiguous_gallery_does_not_attach_images_or_queue(self):
        msg = message()
        body = msg.get_payload()[1]
        body.set_content(body.get_content().replace('<div>If you', '<img src="https://www.beverlyhillscarclub.com/galleria_images/777/777_p4_l.jpg"><div>If you'), subtype='html')
        listing = parse(msg)['listings'][0]
        self.assertIsNone(listing['url'])
        self.assertIsNone(listing['listing_id'])
        self.assertEqual(listing['image_urls'], [])
        self.assertEqual(len(listing['publisher_image_references']), 2)

    def test_mismatched_year_sitemap_held(self):
        a = parse(index={'18808': {URL.replace('1968', '1970')}})
        self.assertIsNone(a['listings'][0]['url'])
        self.assertEqual(a['listings'][0]['resolution_hold'], 'sitemap_year_conflicts_with_email')

    def test_untrusted_sender_rejected(self):
        msg = message()
        msg.replace_header('From', 'sales@beverlyhillscarclub.com.attacker.test')
        with self.assertRaisesRegex(ValueError, 'sender'):
            parse(msg)

    def test_no_timezone_uses_received_time_explicitly(self):
        msg = message()
        msg.replace_header('Date', 'Fri, 1 May 2026 19:59:45')
        a = parse(msg)
        self.assertIsNone(a['sent_at'])
        self.assertEqual(a['observed_at'], a['received_at'])
        self.assertEqual(a['time_basis'], 'mail_received')

    def test_sitemap_rejects_lookalike_hosts_and_ambiguous_keys(self):
        self.assertIsNone(m.canonical_listing(URL.replace('.com/', '.com.attacker.test/'), 'bhcc'))
        xml = f'<urlset><url><loc>{URL}</loc></url><url><loc>{URL.replace("mustang", "other")}</loc></url></urlset>'
        self.assertEqual(len(m.sitemap_index(xml.encode())['18808']), 2)
        self.assertIsNone(parse(index=m.sitemap_index(xml.encode()))['listings'][0]['url'])

    def test_ksl_mailgun_is_decoded_locally_including_double_encoding(self):
        url = 'https://cars.ksl.com/auto/listing/12345?utm_source=email'
        encoded = base64.urlsafe_b64encode(zlib.compress(
            urllib.parse.urlencode({'l': urllib.parse.quote(url, safe='')}).encode())).decode().rstrip('=')
        self.assertEqual(m.decode_mailgun_redirect(encoded), url)
        msg = EmailMessage()
        msg['From'] = 'cars@ksl.com'
        msg['Subject'] = 'KSL Cars - Saved Search Alert'
        msg.set_content('https://email.ksl.com/c/' + encoded)
        a = m.parse_alert(msg, msg.as_bytes(), 'ksl', 1777687188, {})
        self.assertEqual(a['listings'][0]['url'], 'https://cars.ksl.com/auto/listing/12345')
        self.assertEqual(a['listings'][0]['resolution_hold'], 'unrecognized_listing_card')

    def test_emlx_byte_count_excludes_plist_and_rejects_partial(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / '1.emlx'
            raw = message().as_bytes()
            p.write_bytes(str(len(raw)).encode() + b'\n' + raw + b'<?xml>Apple trailer')
            self.assertEqual(m.read_emlx(p)[1], raw)
            p.write_bytes(str(len(raw) + 100).encode() + b'\n' + raw)
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                m.read_emlx(p)

    def test_mail_query_is_readonly_recipient_scoped_and_read_independent(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'Envelope Index'
            c = sqlite3.connect(p)
            c.executescript('''CREATE TABLE messages(subject,sender,mailbox,date_received,deleted,read);
                CREATE TABLE subjects(subject); CREATE TABLE addresses(address);
                CREATE TABLE recipients(message,address); CREATE TABLE mailboxes(url);
                INSERT INTO subjects VALUES ('1968 Ford Mustang C-Code Coupe, Stock 19787');
                INSERT INTO addresses VALUES ('sales@beverlyhillscarclub.com'),('wanted@example.test'),('other@example.test');
                INSERT INTO mailboxes VALUES ('imap://ANY-ACCOUNT/All%20Mail');
                INSERT INTO messages VALUES (1,1,1,1777687188,0,1),(1,1,1,1777687188,0,0),(1,1,1,1777687188,1,0);
                INSERT INTO recipients VALUES (1,2),(1,2),(2,3),(3,2);''')
            c.commit()
            c.close()
            rows = m.find_alert_emails(p, target='wanted@example.test', source='bhcc')
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['msg_id'], 1)
            c = sqlite3.connect(p)
            self.assertEqual(c.execute('SELECT read FROM messages WHERE rowid=1').fetchone()[0], 1)
            c.close()


class ListingCardTests(unittest.TestCase):
    def ksl(self, html):
        msg = EmailMessage()
        msg['From'] = 'cars@ksl.com'
        msg['Subject'] = 'KSL Cars - Saved Search Alert'
        msg['Date'] = 'Sun, 4 Oct 2026 01:00:00 +0000'
        msg.set_content('An alert')
        msg.add_alternative(html, subtype='html')
        return m.parse_alert(msg, msg.as_bytes(), 'ksl', 1791075660, {})

    def test_multiple_ksl_matches_and_recommendations_keep_their_own_fields(self):
        html = '''<!-- a listing --><a href="https://cars.ksl.com/listing/111"><img src="https://image.ksldigital.com/one.jpg"></a>
            <div>2005 Land Rover LR3 HSE</div><div>$2,499.50</div><div>Vineyard, UT</div><!-- end listing -->
            <!-- a listing --><a href="https://cars.ksl.com/listing/222"><img src="https://img.ksl.com/two.jpg"></a>
            <div>1977 GMC K1500</div><div>$8,000.00</div><div>Boise, ID</div><!-- end listing -->
            <!-- Carousel --><div class="mj-column-per-50 mj-outlook-group-fix"><a href="https://cars.ksl.com/listing/333">
            <img src="https://image.ksldigital.com/three.jpg"></a><div>Land Rover Defender</div></div><!-- end Carousel listings -->
            <p>Sent to private@example.test</p><a href="https://email.ksl.com/u/private">unsubscribe</a>'''
        a = self.ksl(html)
        first, second, recommended = a['listings']
        self.assertEqual(first['title'], '2005 Land Rover LR3 HSE')
        self.assertEqual(first['asking_price'], 2499.50)
        self.assertEqual(first['location_text'], 'Vineyard, UT')
        self.assertEqual(second['asking_price'], 8000)
        self.assertEqual(second['image_urls'], ['https://img.ksl.com/two.jpg'])
        self.assertEqual(recommended['email_role'], 'recommendation')
        self.assertIsNone(recommended['asking_price'])
        self.assertIsNone(recommended['year'])
        self.assertNotIn('private@example', json.dumps(a))
        self.assertNotIn('unsubscribe', json.dumps(a))

    def test_ambiguous_card_keeps_urls_without_sharing_price(self):
        a = self.ksl('''<!-- a listing --><div>2005 Land Rover</div><div>$1000.00</div>
            <a href="https://cars.ksl.com/listing/1">one</a><a href="https://cars.ksl.com/listing/2">two</a><!-- end listing -->''')
        self.assertEqual(len(a['listings']), 2)
        self.assertTrue(all(c['resolution_hold'] == 'unrecognized_listing_card' for c in a['listings']))
        self.assertTrue(all('asking_price' not in c for c in a['listings']))

    def test_compressed_redirect_has_a_size_bound(self):
        bomb = base64.urlsafe_b64encode(zlib.compress(b'x' * 100000)).decode()
        self.assertIsNone(m.decode_mailgun_redirect(bomb))

    def test_auction_text_alternative_resolves_each_html_card(self):
        html = '''<table><tr><td><a href="https://url8376.carsandbids.com/ls/click?private"><img
            src="https://cdn.mcauto-images-production.sendgrid.net/a.jpg" alt="2001 Renault Clio V6"></a>
            <p>2001 Renault Clio V6</p><p>A manual with 19,000 miles and $5,000 in options.</p></td>
            <td><img src="https://cdn.mcauto-images-production.sendgrid.net/b.jpg" alt="1995 Porsche 911 Turbo Coupe">
            <p>1995 Porsche 911 Turbo Coupe</p><p>No reserve. Black over black.</p></td></tr></table>'''
        one = 'https://carsandbids.com/auctions/abcd/2001-renault-clio-v6'
        two = 'https://carsandbids.com/auctions/efgh/1995-porsche-911-turbo-coupe'
        plain = f'2001 Renault Clio V6 ( {one}?utm_source=email )\n1995 Porsche 911 Turbo Coupe ( {two} )'
        cards = m.parse_auction_cards(html, 'Two cars', 'carsandbids', {one, two}, plain)
        self.assertEqual(len(cards), 2)
        self.assertEqual([c['url'] for c in cards], [one, two])
        self.assertIn('19,000 miles', cards[0]['publisher_copy'])
        self.assertNotIn('Black over black', cards[0]['publisher_copy'])
        self.assertNotIn('asking_price', cards[0])  # Options cost is not an ask.
        self.assertNotIn('private', json.dumps(cards))

    def test_opaque_auction_links_preserve_unresolved_testimony(self):
        html = '<td><img src="https://cdn.mcauto-images-production.sendgrid.net/a.jpg" alt="2001 Renault Clio V6"><p>2001 Renault Clio V6</p><p>Manual.</p></td>'
        cards = m.parse_auction_cards(html, 'One car', 'carsandbids', set())
        self.assertEqual(len(cards), 1)
        self.assertIsNone(cards[0]['url'])
        self.assertEqual(cards[0]['resolution_hold'], 'opaque_tracking_link')
        self.assertIn('Manual.', cards[0]['publisher_copy'])

    def test_different_image_alt_and_link_title_do_not_capture_other_cards_or_footer(self):
        url = 'https://carsandbids.com/auctions/abc/2023-porsche-911-carrera-t-coupe'
        html = '''<table><tr><td><img src="https://cdn.mcauto-images-production.sendgrid.net/a.jpg"
            alt="2023 Porsche 911 Carrera T Coupe"><p><a href="https://tracker.test/private">2023 Porsche 911 Carrera T</a></p>
            <p>Seven-speed manual.</p></td></tr></table><p>Sent to private@example.test</p>'''
        cards = m.parse_auction_cards(html, 'A car', 'carsandbids', {url}, f'2023 Porsche 911 Carrera T ( {url} )')
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]['url'], url)
        self.assertIn('Seven-speed manual.', cards[0]['publisher_copy'])
        self.assertNotIn('private', json.dumps(cards))

    def test_manifest_uses_raw_message_and_receipt_clock_without_mail_db(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            eml = root / 'mail.eml'
            eml.write_bytes(message().as_bytes())
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps([{'path': str(eml), 'received_at': '2026-05-02T02:00:00Z'}]))
            state = root / 'state'
            state.mkdir()
            (state / 'sitemap.xml').write_text(f'<urlset><url><loc>{URL}</loc></url></urlset>')
            args = SimpleNamespace(state_dir=state, message_manifest=manifest, source='bhcc',
                                   target_email='private-recipient@example.test', days=None, limit=10,
                                   dry_run=True, refresh_sitemap=False, stale_hours=72)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(m.run(args), 0)
            report = json.loads(out.getvalue())
            self.assertEqual(report['selected'], 1)
            self.assertEqual(report['results'][0]['asking_price'], 29950)
            self.assertEqual(report['latest_email_received_at'], '2026-05-02T02:00:00+00:00')
            self.assertFalse((state / 'state.json').exists())
            args.target_email = 'different@example.test'
            with self.assertRaisesRegex(ValueError, 'recipient'):
                m.run(args)


class FakeSupabase(m.Supabase):
    def __init__(self):
        self.observation_source_id = 'source-id'
        self.observations = {}
        self.queue = {}
        self.posts = 0
        self.fail_observation = False
        self.bad_readback = False
        self._bhcc_listing_vehicles = {}
        self.links = 0

    def request(self, path, body=None, prefer=None):
        if path.startswith('/rest/v1/import_queue?'):
            row = body[0]
            if row['listing_url'] in self.queue:
                return []
            self.queue[row['listing_url']] = {'id': 'queue-1', 'status': 'complete', 'vehicle_id': 'vehicle-1'}
            return [self.queue[row['listing_url']]]
        if path == '/functions/v1/ingest-observation':
            if self.fail_observation:
                raise RuntimeError('Supabase HTTP 500')
            self.posts += 1
            obs = {**body, 'id': f'observation-{self.posts}', 'ingested_at': '2026-10-02T12:00:00Z'}
            self.observations[body['source_identifier']] = obs
            return {'success': True, 'observation_id': obs['id']}
        if path == '/rest/v1/rpc/attribute_testimony':
            for obs in self.observations.values():
                if obs['id'] == body['p_observation_id']:
                    obs['vehicle_id'] = body['p_target_vehicle_id']
                    self.links += 1
                    return {'success': True}
        raise AssertionError(path)

    def rows(self, table, **query):
        if table == 'import_queue':
            return [self.queue[query['listing_url'][3:]]]
        if table == 'vehicle_events':
            return [{'vehicle_id': 'vehicle-1'}]
        if table == 'vehicle_observations':
            if 'source_identifier' in query:
                obs = self.observations.get(query['source_identifier'][3:])
                return [obs] if obs else []
            obs = next(o for o in self.observations.values() if o['id'] == query['id'][3:])
            return [{**obs, 'source_url': 'wrong'}] if self.bad_readback else [obs]
        raise AssertionError(table)


class WriteTests(unittest.TestCase):
    def test_ksl_evidence_does_not_depend_on_blocked_scraper_queue(self):
        class KslDB(FakeSupabase):
            def rows(self, table, **query):
                if table in ('vehicles', 'vehicle_events'):
                    return []
                return super().rows(table, **query)
        client = KslDB()
        a = {'source': 'ksl', 'message_key': 'email-key', 'raw_sha256': 'raw',
             'subject': 'KSL Cars - Saved Search Alert', 'sent_at': '2026-10-01T01:00:00Z',
             'received_at': '2026-10-01T01:01:00Z', 'observed_at': '2026-10-01T01:00:00Z',
             'time_basis': 'email_date'}
        listing = {'url': 'https://cars.ksl.com/auto/listing/123', 'publisher_copy': '2005 Land Rover LR3 HSE',
                   'asking_price': 2499, 'email_role': 'saved_search_match'}
        result = client.ingest(a, listing, None, None)
        self.assertEqual(result['queue_status'], 'not_queued_email_evidence_only')
        self.assertEqual(client.queue, {})
        self.assertEqual(client.posts, 1)
        self.assertIsNone(result['vehicle_id'])
        self.assertTrue(next(iter(client.observations.values()))['defer_analysis'])
        replay = client.ingest(a, listing, None, None)
        self.assertEqual(replay['observation_id'], result['observation_id'])
        self.assertEqual(client.posts, 1)

    def test_exact_existing_listing_resolves_expired_sitemap_without_ai(self):
        client, a = FakeSupabase(), parse(index={})
        client._bhcc_listing_vehicles = {'18808': {'vehicle-1': (URL, 1968)}}
        result = client.ingest(a, a['listings'][0], 'scrape-source', 'sitemap')
        self.assertEqual(result['vehicle_id'], 'vehicle-1')
        self.assertEqual(result['url'], URL)
        self.assertEqual(client.posts, 1)

    def test_replay_links_original_row_once_preserving_claim_and_clocks(self):
        client, a = FakeSupabase(), parse(index={})
        first = client.ingest(a, a['listings'][0], 'scrape-source', 'old')
        original = dict(next(iter(client.observations.values())))
        client._bhcc_listing_vehicles = {'18808': {'vehicle-1': (URL, 1968)}}
        repaired = client.ingest(a, a['listings'][0], 'scrape-source', 'new')
        replay = client.ingest(a, a['listings'][0], 'scrape-source', 'new')
        self.assertTrue(repaired['attribution_repaired'])
        self.assertEqual(first['observation_id'], replay['observation_id'])
        self.assertEqual(client.posts, 1)
        self.assertEqual(client.links, 1)
        current = next(iter(client.observations.values()))
        for key in ('structured_data', 'observed_at', 'ingested_at', 'source_url'):
            self.assertEqual(original[key], current[key])

    def test_conflicting_existing_listing_ids_are_not_bound(self):
        client, a = FakeSupabase(), parse()
        client._bhcc_listing_vehicles = {'18808': {'vehicle-1': (URL, 1968), 'vehicle-2': (URL, 1968)}}
        self.assertIsNone(client.ingest(a, a['listings'][0], 'scrape-source', 'sitemap')['vehicle_id'])

    def test_existing_listing_year_conflict_is_not_bound(self):
        client, a = FakeSupabase(), parse()
        client._bhcc_listing_vehicles = {'18808': {'vehicle-1': (URL, 1970)}}
        self.assertIsNone(client.ingest(a, a['listings'][0], 'scrape-source', 'sitemap')['vehicle_id'])

    def test_replay_after_sitemap_change_does_not_duplicate_or_reset_queue(self):
        client, a = FakeSupabase(), parse()
        first = client.ingest(a, a['listings'][0], 'scrape-source', 'old-sitemap')
        replay = client.ingest(a, a['listings'][0], 'scrape-source', 'new-sitemap')
        self.assertEqual(first['observation_id'], replay['observation_id'])
        self.assertEqual(replay['queue_status'], 'complete')
        self.assertEqual(replay['queued'], 0)
        self.assertTrue(replay['duplicate'])
        self.assertEqual(client.posts, 1)

    def test_unresolved_email_lands_unbound_and_later_resolution_only_queues(self):
        client, msg = FakeSupabase(), message()
        a = parse(msg, index={})
        first = client.ingest(a, a['listings'][0], 'scrape-source', 'old-sitemap')
        self.assertEqual(len(client.queue), 0)
        self.assertIsNone(first['vehicle_id'])
        resolved = parse(msg)
        replay = client.ingest(resolved, resolved['listings'][0], 'scrape-source', 'new-sitemap')
        self.assertEqual(replay['queued'], 1)
        self.assertEqual(client.posts, 1)
        self.assertIsNone(next(iter(client.observations.values()))['source_url'])

    def test_server_failure_is_not_reported_as_duplicate(self):
        client, a = FakeSupabase(), parse()
        client.fail_observation = True
        with self.assertRaisesRegex(RuntimeError, '500'):
            client.ingest(a, a['listings'][0], 'scrape-source', 'sitemap')

    def test_success_requires_exact_testimony_readback(self):
        client, a = FakeSupabase(), parse()
        client.bad_readback = True
        with self.assertRaisesRegex(RuntimeError, 'readback'):
            client.ingest(a, a['listings'][0], 'scrape-source', 'sitemap')


if __name__ == '__main__':
    unittest.main()
