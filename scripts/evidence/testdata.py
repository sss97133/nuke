"""Synthetic pilot-shaped inputs for the runner's tests. Everything here is made up: uuids are uuid5 of labels, dates
are shifted to 2031-2032, ledger line ids, bank references, thread ids, message GUIDs, amounts, labels and place
coordinates are invented, and no real model, vendor or place name appears. The shape mirrors the first pilot vehicle
(133 own photos, 99 in the vehicle album and 12 album items with no image row, 1,006 listing urls over 4,534 listing
rows, 20 ledger lines on one covered account, a P&L allocation to a second vehicle, a job allocation to a truck with
no row, a contradicting message, orders joined to a payment with no total and orders with none, a deal jacket and its
claims) so the counts the file-mode lane recorded can be asserted without a real id in the repo.

make_case(dir) writes every input, the pinned list, the case and its exit fixture, and returns their paths.
"""
import csv
import datetime as dt
import hashlib
import json
import os
import sqlite3
import uuid

NS = uuid.UUID('5f0c1e1a-0000-4000-8000-00000000c0de')


def U(*parts):
    return str(uuid.uuid5(NS, '|'.join(str(p) for p in parts)))


OWNER = U('owner')
V = {'TRUCK': U('vehicle', 'truck'), 'TWIN': U('vehicle', 'twin'), 'TRADE': U('vehicle', 'trade'),
     'SUB': U('vehicle', 'second'), 'SWB': U('vehicle', 'swb')}
ALBUM = U('album', 'truck').upper()
SWB_ALBUM = U('album', 'swb').upper()
YARD_ALBUM = U('album', 'yard').upper()
PAINT_ALBUM = U('album', 'paint').upper()
ALBUM_TITLE = '2031 Synthetic Crew Cab'
SWB_TITLE = '2031 Synthetic Short Bed'
YARD_TITLE = 'synthetic yard'
PAINT_TITLE = 'P aint synthetic'
SELLER_DAY, YARD_DAY, ACQ_DAY, SWB_DAY, DOC_DAY = '2031-01-06', '2031-01-09', '2031-01-18', '2031-03-31', '2032-10-18'
ALBUM_DAYS = {'2031-01-18': 40, '2031-02-25': 1, '2031-02-28': 1, '2031-04-08': 2, '2031-04-17': 1, '2031-04-18': 7,
              '2031-04-20': 19, '2031-04-21': 4, '2031-04-22': 5, '2031-04-23': 4, '2031-04-25': 3, '2031-04-27': 1,
              '2031-04-29': 3, '2031-05-03': 1, '2031-05-11': 1, '2031-05-19': 4, '2031-05-31': 1}
CLUSTERS = [{'label': 'shop_a', 'lat': 10.0, 'lon': 20.0, 'radius_m': 150},
            {'label': 'shop_b', 'lat': 10.01, 'lon': 20.0, 'radius_m': 150},
            {'label': 'yard', 'lat': 11.0, 'lon': 21.0, 'radius_m': 400},
            {'label': 'salvage_lot', 'lat': 11.1, 'lon': 21.1, 'radius_m': 400}]
LEDGER_ACCOUNT = 'bank_account:synthetic_checking'
SHARE_ACCOUNT = 'bank_account:synthetic_share'
ORG = U('org')
LEDGER_EXT = 'ledger:SYNTH-LEDGER:'
JACKET_REF = 'file:SYNTH-JACKETS.txt:jacket3'
SHEET_REF = 'file:SYNTH-DEALS.txt:vin:SYNTHVIN0001'
LIST1 = 'example.test/listing/synthetic-pickup'
LIST2 = 'example.test/listing/synthetic-pickup-2'
JOB = 'JOB-SIDE'                                  # a job on a truck with no vehicle row (subject_key label:JOB-SIDE)
COVER_TO = '2032-12-31'
# (line id suffix, ledger date, card date or None, amount, category text, label, cost_category, payee, conf)
LINES = [
    ('00240', '2031-02-10', '02/08', '-120.10', 'parts', 'Glass Co', 'parts', 'third_party:glass_co', 0.25),
    ('00268', '2031-02-16', '02/14', '-230.20', 'parts', 'Tire Co', 'parts', 'third_party:tire_co', 0.15),
    ('00709', '2031-05-13', None, '-40.30', 'parts', 'Parts Store', 'parts', 'third_party:parts_store', 0.25),
    ('00737', '2031-05-20', None, '-777.00', 'paint', 'Transfer painter', 'paint', 'third_party:painter', 0.25),
    ('00770', '2031-05-30', '05/28', '-150.40', 'parts', 'Online Store', 'parts', 'third_party:online_store', 0.25),
    ('00132', '2032-01-21', '01/19', '-60.50', 'parts', 'Auction Site', 'parts', 'third_party:auction_site', 0.2),
    ('00145', '2032-01-22', None, '-300.60', 'labour', 'bank transfer', None, None, 0.2),
    ('00148', '2032-01-22', None, '-200.70', 'labour', 'Detail Co', None, 'third_party:detail_co', 0.25),
    ('00161', '2032-01-23', None, '-210.80', 'labour', 'Detail Co', None, 'third_party:detail_co', 0.25),
    ('00163', '2032-01-24', '01/22', '-90.90', 'parts', 'Truck Parts Co', 'parts', 'third_party:truck_parts_co', 0.25),
    ('00181', '2032-01-27', '01/25', '-45.11', 'parts', 'Online Store', 'parts', 'third_party:online_store', 0.25),
    ('00182', '2032-01-27', '01/25', '-33.12', 'parts', 'Auction Site', 'parts', 'third_party:auction_site', 0.2),
    ('00183', '2032-01-27', '01/25', '-34.13', 'parts', 'Auction Site', 'parts', 'third_party:auction_site', 0.2),
    ('00184', '2032-01-27', '01/25', '-35.14', 'parts', 'Auction Site', 'parts', 'third_party:auction_site', 0.2),
    ('00187', '2032-01-27', '01/24', '-150.15', 'labour', 'cash app', None, 'third_party:shop_helper', 0.2),
    ('00193', '2032-01-28', None, '-220.16', 'labour', 'Detail Co', None, 'third_party:detail_co', 0.25),
    ('00243', '2032-02-04', None, '-310.17', 'labour', 'bank transfer', None, None, 0.2),
    ('00206', '2032-01-29', None, '-1500.00', 'paint', 'Transfer painter', 'paint', 'third_party:painter', 0.5),
    ('00144', '2032-01-22', '01/20', '-640.18', 'parts', 'Speed Shop', 'parts', 'third_party:speed_shop', 0.05),
]
PROPOSED = ['00240', '00268', '00709', '00770', '00132', '00145', '00148', '00161', '00163', '00181', '00182', '00183',
            '00184', '00187', '00193', '00243']


def lid(sfx, year=None):
    year = year or ('2031' if sfx in ('00240', '00268', '00709', '00737', '00770') else '2032')
    return '%s-BANK-%s' % (year, sfx)


def lkey(src, veh):
    return 'link:%s@%s' % (src, veh[:8])


def ts(day, hh=18, mm=0, ss=0, ms=0):
    return dt.datetime.fromisoformat(day).replace(hour=hh, minute=mm, second=ss, microsecond=ms * 1000,
                                                  tzinfo=dt.timezone.utc)


def _images():
    """133 image rows with their Photos join record: (row, join, albums, day, lat, lon)."""
    out = []
    n = 0

    def add(day, source, albums, lat, lon, k):
        nonlocal n
        n += 1
        iid = U('image', n)
        true = ts(day, 18, k % 60, (k * 7) % 60, 100 + k % 800)
        off = 3 if source == 'user_upload' else 0
        stored = (true - dt.timedelta(hours=off)).replace(microsecond=0 if source == 'user_upload' else true.microsecond)
        stem = 'IMG_%04d' % (1000 + n)
        row = {'id': iid, 'source': source, 'his': None if source == 'ssd_blast' else True,
               'uid_null': source == 'ssd_blast', 'taken_at': stored.isoformat(), 'filename': stem + '.HEIC',
               'created_at': '2033-03-01 10:00:00+00', 'sup': False, 'dup': False,
               'gate': ['approved', 'rejected_personal', 'review_needed'][n % 3]}
        titles = [t for t, _u in albums]
        j = {'image_id': iid, 'source': source, 'filename_used': stem + '.HEIC',
             'taken_at_stored': stored.isoformat(), 'offset_hours_applied': str(-off) if off else '0',
             'capture_utc_true': true.isoformat(), 'photos_uuid': U('photos', n).upper(),
             'match_kind': 'stem_time_corrected' if off else 'stem_time', 'residual_seconds': '0.1',
             'albums': ';'.join(titles), 'album_uuids': ';'.join(u for _t, u in albums), 'photos_lat': lat,
             'photos_lon': lon, 'offset_rule': 'strict', 'time_candidates': '1', 'photos_date_local': day + 'T11:00:00-07:00',
             'photos_tz_offset_seconds': '-25200', 'created_at': '2033-03-01 10:00:00+00', 'flags': ''}
        out.append((row, j, day))

    for k in range(5):
        add(SELLER_DAY, 'user_upload', [], '', '', k)
    for k in range(2):
        add(YARD_DAY, 'user_upload', [], 11.0, 21.0, k)
    for k in range(26):
        add(ACQ_DAY, 'ssd_blast' if k < 26 else 'user_upload', [(YARD_TITLE, YARD_ALBUM)], 11.0, 21.0, k)
    k = 0
    for day, cnt in ALBUM_DAYS.items():
        for i in range(cnt):
            k += 1
            albums = [(ALBUM_TITLE, ALBUM)] + ([(PAINT_TITLE, PAINT_ALBUM)] if day == '2031-04-18' else [])
            lat, lon = ((11.0, 21.0) if i % 3 == 0 else (11.1, 21.1) if i % 3 == 1 else (12.0, 22.0)) \
                if day == ACQ_DAY else ((10.0, 20.0) if i % 2 == 0 else (10.01, 20.0)) \
                if day in ('2031-04-20', '2031-04-21') else (10.0, 20.0)
            add(day, 'iphoto' if k == 1 else 'user_upload', albums, lat, lon, k)
    add(DOC_DAY, 'user_upload', [(ALBUM_TITLE, ALBUM)], 10.0, 20.0, 0)
    add(SWB_DAY, 'user_upload', [(SWB_TITLE, SWB_ALBUM)], 10.0, 20.0, 0)
    return out


def _listing_rows():
    rows = []
    for u in range(502):
        rows.append({'id': U('listing', 'a', u), 'vehicle_id': V['TRUCK'], 'source': 'bat_import',
                     'image_url': 'https://example.test/gallery-a/%04d.jpg' % u, 'source_url': None,
                     'ex_src': 'https://' + LIST1, 'created_at': '2033-01-01 10:%02d:%02d+00' % (u // 60, u % 60),
                     'dup': False, 'sup': False, 'uid_null': True})
    for u in range(504):
        for c in range(8):
            rows.append({'id': U('listing', 'b', u, c), 'vehicle_id': V['TRUCK'], 'source': 'bat_import',
                         'image_url': 'https://example.test/gallery-b/%04d.jpg' % u, 'source_url': None,
                         'ex_src': None, 'created_at': '2033-02-%02d 10:%02d:%02d+00' % (1 + c, u // 60, u % 60),
                         'dup': False, 'sup': False, 'uid_null': True})
    return rows


def _chat_db(path):
    con = sqlite3.connect(path)
    con.executescript('create table chat (ROWID integer primary key); create table message (ROWID integer primary key, '
                      'guid text, is_from_me integer, date integer, text text); create table chat_message_join '
                      '(chat_id integer, message_id integer);')
    epoch = dt.datetime(2001, 1, 1, tzinfo=dt.timezone.utc)
    msgs = [(1, '2032-02-04 15:42:33', 1), (1, '2032-02-09 15:58:37', 0), (2, '2032-02-10 13:08:25', 0),
            (2, '2032-02-10 13:09:15', 1), (1, '2032-02-16 10:20:00', 1), (3, '2032-01-20 10:33:56', 1),
            (3, '2032-01-20 13:45:42', 0), (3, '2032-01-20 14:00:00', 1)]
    from zoneinfo import ZoneInfo
    tz = ZoneInfo('America/Los_Angeles')
    for rid in (1, 2, 3):
        con.execute('insert into chat values (?)', (rid,))
    for i, (chat, local, me) in enumerate(msgs, start=1):
        t = dt.datetime.strptime(local, '%Y-%m-%d %H:%M:%S').replace(tzinfo=tz).astimezone(dt.timezone.utc)
        con.execute('insert into message values (?,?,?,?,?)', (i, U('guid', i).upper(), me,
                                                              int((t - epoch).total_seconds() * 1e9) + 250000000,
                                                              'synthetic text that must never be read'))
        con.execute('insert into chat_message_join values (?,?)', (chat, i))
    con.commit()
    con.close()
    return {rid: 'chat-' + hashlib.sha1(str(rid).encode()).hexdigest()[:6] for rid in (1, 2, 3)}, msgs


def make_case(d):
    os.makedirs(d, exist_ok=True)
    p = lambda *x: os.path.join(d, *x)  # noqa: E731
    imgs = _images()
    with open(p('image_rows.json'), 'w') as f:
        json.dump({'sql': 'synthetic', 'result': [r for r, _j, _d in imgs]}, f)
    cols = list(imgs[0][1].keys())
    with open(p('photos_join.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(j for _r, j, _d in imgs)
    with open(p('photos_index.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['photos_uuid', 'original_filename', 'stem', 'date_local', 'date_utc', 'tz_offset_seconds',
                    'latitude', 'longitude', 'albums', 'album_uuids'])
        for _r, j, _d in imgs:
            w.writerow([j['photos_uuid'], j['filename_used'], j['filename_used'].split('.')[0], j['photos_date_local'],
                        j['capture_utc_true'], '-25200', j['photos_lat'], j['photos_lon'], j['albums'], j['album_uuids']])
    with open(p('album_items.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['uuid', 'date', 'lat', 'lon'])
        for _r, j, day in imgs:
            if ALBUM in j['album_uuids']:
                w.writerow([j['photos_uuid'], day + 'T11:00:00-07:00', j['photos_lat'], j['photos_lon']])
        for k in range(12):                                   # album items with no Nuke row
            w.writerow([U('missing', k).upper(), '2031-04-22T11:00:00-07:00', '' if k == 0 else 10.0, '' if k == 0 else 20.0])
    with open(p('listing_rows.json'), 'w') as f:
        json.dump(_listing_rows(), f)
    with open(p('sessions.json'), 'w') as f:
        json.dump({'result': [{'id': U('session', s), 'session_date': s, 'his': True, 'confirmed': False, 'title': 'x'}
                              for s in (YARD_DAY, ACQ_DAY, DOC_DAY)]}, f)
    with open(p('primary.json'), 'w') as f:
        json.dump({'result': []}, f)
    with open(p('dedupe_done.txt'), 'w') as f:
        f.write(U('vehicle', 'someone-else') + '\n')
    # ---------------------------------------------------------------- money and documents (synthetic)
    with open(p('ledger.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['year', 'bank_line_id', 'date', 'amount', 'description', 'original_category'])
        for sfx, date, card, amt, cat, label, *_ in LINES:
            desc = ('VISA - %s %s' % (card, label.upper())) if card else \
                ('XFER %s;R0000000%s;%s;DR' % (label.upper(), sfx, date) if label.startswith('Transfer') else label.upper())
            w.writerow([date[:4], lid(sfx), date, amt, desc, cat])
        w.writerow(['2032', lid('00306'), '2032-02-19', '9000.00', 'TRANSFER FROM SHARE ACCOUNT', 'money in'])
        w.writerow(['2032', lid('00999'), '2032-03-01', '-10.00', 'XFER OTHER;R0000000999X;2032-03-01;DR', 'paint'])
    with open(p('disposition.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['asset', 'year', 'component', 'amount', 'evidence'])
        w.writerow(['Synthetic second truck', '2032', 'January paint', '1500.00', 'Bank payment R000000000206'])
        w.writerow(['Synthetic second truck', '2032', 'March paint', '10.00', 'Bank payment R0000000999X'])
        w.writerow(['Synthetic second truck', '2032', 'purchase', '4000.00', 'deal sheet'])
    with open(p('pnl_ledger.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['year', 'date', 'id', 'section', 'category', 'amount', 'account', 'description', 'source',
                    'decision', 'bank_links', 'status'])
        w.writerow(['2031', '2031-05-20', JOB + '-' + lid('00737'), 'Expense', 'paint', '-777.00', 'x', 'x', 'x', 'x',
                    lid('00737'), 'Included'])
        w.writerow(['2032', '2032-03-01', JOB + '-' + lid('00999'), 'Expense', 'paint', '-10.00', 'x', 'x', 'x', 'x',
                    lid('00999'), 'Included'])
    jacket_prefix = '3. 2031 Synthetic Pickup (SYNTHVIN0001'
    with open(p('jackets.txt'), 'w') as f:
        f.write('1. other truck; nothing here\n')
        f.write(jacket_prefix + ', the truck): acquired Jan 24 2032 from a private seller; sold Feb 4 2032; buyer '
                'Synthetic Equipment LLC (Nowhere); 12,345; purchase 6,789 + travel 100; trade-in 2030 Synthetic C10, '
                'VIN SYNTHVIN0002, title clear ("Trade ACV 1000 / CTV 2000", cost line (3,000)); dry ice (1,111); '
                'Synthetic paint (2,222.22); "Labor 10 details 20 Lift 30" = (3,333.33) green; Corner Shop (444.44); '
                'total cost 1.00.\n')
    pinned = p('pinned_sources.txt')
    with open(pinned, 'w') as f:
        f.write('# synthetic pinned list\n')
        for name in ('ledger.csv', 'disposition.csv', 'pnl_ledger.csv', 'jackets.txt'):
            f.write(os.path.abspath(p(name)) + '\n')
    chats, _msgs = _chat_db(p('chat.db'))
    gm = {'threads': [
        {'thread_id': 'synththread0001', 'kind': 'order', 'date': '2031-02-15', 'vehicle': 'TRUCK', 'source_label': 'Tire Co',
         'payee_entity': 'third_party:tire_co', 'cost_category': 'parts', 'confidence': 0.15, 'summary': 'tires shipped',
         'payment_join': {'line_id': lid('00268'), 'confidence': 0.8, 'basis': 'order date = card date'}},
        {'thread_id': 'synththread0002', 'kind': 'order', 'date': '2032-01-24', 'vehicle': 'TRUCK',
         'source_label': 'Online Store', 'cost_category': 'parts', 'confidence': 0.25, 'summary': 'dash parts',
         'payment_join': {'line_id': lid('00181'), 'confidence': 0.95, 'basis': 'total = line amount'}},
        {'thread_id': 'synththread0003', 'kind': 'order', 'date': '2031-05-27', 'vehicle': 'TRUCK',
         'source_label': 'Online Store', 'cost_category': 'parts', 'confidence': 0.25, 'summary': 'carburetor shipment',
         'payment_join': {'line_id': lid('00770'), 'confidence': 0.8, 'no_total': True,
                          'basis': 'the line names the order number; the shipments do not sum to it'}},
        {'thread_id': 'synththread0004', 'kind': 'order', 'date': '2032-01-27', 'vehicle': 'TRUCK',
         'source_label': 'Truck Parts Co', 'cost_category': 'parts', 'confidence': 0.25, 'summary': 'backorder notice',
         'payment_join': {'line_id': lid('00163'), 'confidence': 0.8, 'no_total': True,
                          'basis': 'backorder notice with no total; the only line of that vendor near the date'}},
        {'thread_id': 'synththread0007', 'kind': 'order', 'date': '2032-01-28', 'vehicle': 'TRUCK',
         'source_label': 'Parts Store', 'cost_category': 'parts', 'confidence': 0.2, 'summary': 'order confirmation',
         'payment_join': None, 'why_unjoined': 'no ledger line of that vendor near the date'},
        {'thread_id': 'synththread0005', 'kind': 'listing_event', 'date': '2031-07-27', 'vehicle': 'TRUCK',
         'confidence': 0.95, 'summary': 'auction ended'},
        {'thread_id': 'synththread0006', 'kind': 'listing_event', 'date': '2031-12-22', 'vehicle': 'TRUCK',
         'confidence': 0.95, 'summary': 'relist ended'}],
        'listings': [
            {'ref': LIST1, 'date': '2031-07-20', 'vehicle': 'TRUCK', 'confidence': 0.95, 'summary': 'listing 1',
             'claim': {'key': 'claim:listing:%s:1' % V['TRUCK'][:8], 'from': '2031-07-20', 'to': '2031-07-27',
                       'confidence': 0.95, 'summary': 'auction 1', 'date_thread': 'synththread0005'}},
            {'ref': LIST2, 'date': '2031-12-15', 'vehicle': 'TRUCK', 'confidence': 0.9, 'summary': 'listing 2',
             'claim': {'key': 'claim:listing:%s:2' % V['TRUCK'][:8], 'from': '2031-12-15', 'to': '2031-12-22',
                       'confidence': 0.95, 'summary': 'auction 2', 'date_thread': 'synththread0006'}}]}
    with open(p('gmail.json'), 'w') as f:
        json.dump(gm, f)
    NUM = r'([0-9][0-9,]*(?:\.[0-9]{1,2})?)'
    jref = lambda a: JACKET_REF + '#' + a  # noqa: E731
    lines = [dict(line_id=lid(sfx), vehicle='TRUCK', source_label=label, cost_category=cc, payee_entity=pe,
                  counterparty_label=label, confidence=conf, join_key='vendor+date', summary=label)
             for sfx, _d, _c, _a, _cat, label, cc, pe, conf in LINES]
    lines.append(dict(line_id=lid('00306'), vehicle='TRUCK', source_label='transfer in', from_account_ref=SHARE_ACCOUNT,
                      confidence=0.5, join_key='date', summary='transfer in from the share account'))
    msg = lambda chat, local: [chats[chat], local]  # noqa: E731
    case = {
        'case': 'synthetic-pilot', 'vehicle': 'TRUCK', 'run_kind': 'pilot', 'vehicles': V,
        'base_scope': ['TRUCK', 'TWIN', 'SUB', 'SWB'], 'scope_vehicles': ['TRUCK', 'TWIN', 'TRADE', 'SUB'],
        'window': {'from': '2031-01-01', 'to': '2032-10-18'}, 'exit_fixture': 'exit-expected.json',
        'pinned_sources_file': pinned,
        'inputs': {'image_rows': 'image_rows.json', 'listing_rows': 'listing_rows.json', 'primary_rows': 'primary.json',
                   'work_sessions': 'sessions.json', 'photos_join': 'photos_join.csv', 'photos_index': ['photos_index.csv'],
                   'album_items': 'album_items.csv', 'dedupe_done': 'dedupe_done.txt', 'gmail_manifest': 'gmail.json',
                   'chat_db': 'chat.db'},
        'amount_sources': {
            'ledger': {'kind': 'ledger_csv', 'path': os.path.abspath(p('ledger.csv'))},
            'pnl_disposition': {'kind': 'pnl_disposition_csv', 'path': os.path.abspath(p('disposition.csv'))},
            'pnl_ledger': {'kind': 'pnl_ledger_csv', 'path': os.path.abspath(p('pnl_ledger.csv'))},
            'jacket3': {'kind': 'text_facts', 'path': os.path.abspath(p('jackets.txt')), 'line_prefix': jacket_prefix,
                        'facts': {'sale_price': r'buyer [^;]+; ' + NUM + ';', 'purchase': r'purchase ' + NUM,
                                  'trade_in_acv': r'Trade ACV ' + NUM, 'trade_in_ctv': r'CTV ' + NUM,
                                  'trade_in_cost_line': r'cost line \(' + NUM + r'\)',
                                  'line:dry_ice': r'dry ice \(' + NUM + r'\)', 'line:paint': r'paint \(' + NUM + r'\)',
                                  'line:labour': r'"Labor[^"]*" = \(' + NUM + r'\)',
                                  'line:corner': r'Corner Shop \(' + NUM + r'\)'}}},
        'place_clusters': CLUSTERS, 'place_cluster_default': 'en_route',
        'privacy': {'people_sha16': [hashlib.sha256(b'zorblat').hexdigest()[:16]]},   # a made-up name
        'vehicle_labels': {'TRUCK': '2031 synthetic pickup', 'TWIN': '2031 synthetic pickup (second profile)',
                           'TRADE': '2030 synthetic trade-in', 'SUB': 'synthetic second truck',
                           'SWB': '2031 synthetic short bed'},
        'review': {'questions': [
            {'text': 'OWNER-DECISIONS 1: may photos go to the vision vendor?', 'answer_hint': 'yes / no'},
            {'text': 'Which account paid for the truck when you bought it?', 'answer_hint': 'mine / <business>',
             'targets': [{'target_kind': 'change_claim', 'key': 'claim:acquisition:%s' % V['TRUCK'][:8]}]}]},
        'passes': {
            'photos_album': {'albums': [{'album_uuid': ALBUM, 'title': ALBUM_TITLE, 'vehicle': 'TRUCK',
                                         'candidate_set': ['TRUCK', 'TWIN'], 'confidence': 0.9, 'items_all_dates': 111,
                                         'photos_items': True, 'map': {'ref': 'album map', 'map_confidence': 0.6}}]},
            'listing_class': {'vehicle': 'TRUCK', 'listings': [
                {'match': {'ex_src': True}, 'ref': LIST1, 'confidence': 0.98, 'basis': 'exif source url'},
                {'match': {}, 'ref': LIST2, 'confidence': 0.9, 'basis': 'relist gallery'}]},
            'combined': {'vehicle': 'TRUCK', 'album': ALBUM, 'candidate_set_album': ['TRUCK', 'TWIN'], 'rules': [
                {'when': {'in_album': True, 'day': DOC_DAY}, 'verdict': 'is_vehicle', 'confidence': 0.6,
                 'image_class': 'document', 'flag': 'document_frame_after_sale',
                 'evidence': [{'kind': 'photos_album', 'ref': '@album'}, {'kind': 'work_session', 'ref': '@session'}]},
                {'when': {'in_album': True}, 'verdict': 'is_vehicle', 'confidence': 0.9,
                 'evidence': [{'kind': 'photos_album', 'ref': '@album'}, {'kind': 'place_cluster', 'ref': '@cluster'}]},
                {'when': {'day': SELLER_DAY}, 'verdict': 'is_vehicle', 'confidence': 0.7, 'image_class': 'third_party',
                 'flag': 'seller_camera_pre_acquisition'},
                {'when': {'day': YARD_DAY}, 'verdict': 'is_vehicle', 'confidence': 0.5,
                 'flag': 'pre_acquisition_yard_visit',
                 'evidence': [{'kind': 'place_cluster', 'ref': '@cluster'}, {'kind': 'work_session', 'ref': '@session'}]},
                {'when': {'album_title': YARD_TITLE}, 'verdict': 'ambiguous', 'confidence': 0.35, 'flag': 'yard_album_only'},
                {'when': {'album_title': SWB_TITLE}, 'verdict': 'ambiguous', 'confidence': 0.2,
                 'flag': 'probable_other_vehicle', 'evidence': [{'kind': 'photos_album', 'ref': SWB_ALBUM,
                                                                 'map_vehicle_id': '@vehicle:SWB'}]}]},
            'identity_compare': {'claims': [{
                'key': 'claim:same_vehicle_as:%s' % V['TWIN'][:8], 'vehicle': 'TWIN', 'related_vehicle': 'TRUCK',
                'survivor_vehicle': 'TRUCK', 'confidence': 0.6, 'summary': 'second profile of the truck',
                'support': [{'link': {'source_key': 'photos_album:' + ALBUM, 'vehicle': 'TRUCK'}, 'about': 'identity'}]}]},
            'ledger_vendor_date': {'source': 'ledger', 'ledger_name': 'SYNTH-LEDGER', 'account_ref': LEDGER_ACCOUNT,
                                   'coverage_to': COVER_TO, 'covers_accounts': [LEDGER_ACCOUNT], 'lines': lines},
            'pnl_allocation': {'sources': [
                {'name': 'pnl_disposition', 'kind': 'disposition', 'assets': {'Synthetic second truck': 'SUB'},
                 'confidence': 0.7, 'cost_category': {'paint': 'paint'}},
                {'name': 'pnl_ledger', 'kind': 'independent_ledger',
                 'jobs': {JOB: {'vehicle': None, 'source_label': 'side job', 'cost_category': 'paint'}}}]},
            'gmail_order': {'ledger_source': 'ledger', 'account_ref': LEDGER_ACCOUNT},
            'messages_mention': {'tz': 'America/Los_Angeles', 'counts_window': {'from': '2032-01-15', 'to': '2032-02-28'},
                                 'mentions': [
                {'refs': [msg(1, '2032-02-04 15:42:33')], 'vehicle': 'TRUCK', 'confidence': 0.9, 'summary': 'unsold'},
                {'refs': [msg(1, '2032-02-09 15:58:37')], 'vehicle': 'TRUCK', 'confidence': 0.9, 'summary': 'offer'},
                {'refs': [msg(2, '2032-02-10 13:08:25')], 'vehicle': 'TRUCK', 'confidence': 0.9, 'summary': 'asks'},
                {'refs': [msg(2, '2032-02-10 13:09:15')], 'vehicle': 'TRUCK', 'confidence': 0.9, 'summary': 'quote'},
                {'refs': [msg(1, '2032-02-16 10:20:00')], 'vehicle': 'TRUCK', 'confidence': 0.9, 'summary': 'sold'},
                {'refs': [msg(3, '2032-01-20 10:33:56'), msg(3, '2032-01-20 13:45:42')], 'vehicle': 'TRUCK',
                 'role': 'contradicts', 'payment_key': 'bank:' + lid('00144'), 'source_label': 'customer order',
                 'confidence': 0.8, 'summary': 'a customer order the same day'}]},
            'deal_document': {'documents': [
                {'external_ref': JACKET_REF, 'source': 'jacket3', 'vehicle': 'TRUCK', 'anchors': [
                    {'anchor': 'acquired_date', 'role': 'contradicts', 'occurred_on': '2032-01-24', 'confidence': 0.9},
                    {'anchor': 'purchase', 'role': 'assertion', 'direction': 'out', 'amount_fact': 'purchase',
                     'cost_category': 'purchase', 'source_label': 'purchase', 'occurred_on': '2032-01-24', 'confidence': 0.9},
                    {'anchor': 'sale', 'role': 'assertion', 'direction': 'in', 'amount_fact': 'sale_price',
                     'source_label': 'sold', 'occurred_on': '2032-02-04', 'confidence': 0.9},
                    {'anchor': 'line:labour', 'role': 'assertion', 'direction': 'out', 'amount_fact': 'line:labour',
                     'source_label': 'Labor', 'occurred_on': '2032-02-04', 'confidence': 0.9},
                    {'anchor': 'line:paint', 'role': 'assertion', 'direction': 'out', 'amount_fact': 'line:paint',
                     'cost_category': 'paint', 'source_label': 'paint', 'occurred_on': '2032-02-04', 'confidence': 0.9},
                    {'anchor': 'line:dry_ice', 'role': 'assertion', 'direction': 'out', 'amount_fact': 'line:dry_ice',
                     'cost_category': 'other', 'source_label': 'dry ice', 'occurred_on': '2032-02-04', 'confidence': 0.9},
                    {'anchor': 'line:corner', 'role': 'assertion', 'direction': 'out', 'amount_fact': 'line:corner',
                     'cost_category': 'other', 'source_label': 'Corner Shop', 'occurred_on': '2032-02-04',
                     'confidence': 0.9}]},
                {'external_ref': SHEET_REF, 'vehicle': 'TRUCK', 'anchors': [
                    {'anchor': 'received', 'role': 'supports', 'occurred_on': '2031-01-19', 'confidence': 0.9}]}],
                'claims': [
                    {'key': 'claim:acquisition:%s' % V['TRUCK'][:8], 'vehicle': 'TRUCK', 'domain': 'custody',
                     'kind': 'acquisition', 'from': ACQ_DAY, 'to': '2031-01-19', 'amount': ['jacket3', 'purchase'],
                     'confidence': 0.85, 'summary': 'bought and hauled', 'support': [
                         {'cand': {'pass': 'photos_album', 'day': ACQ_DAY, 'pick': 'first_middle_last'}, 'about': 'date'},
                         {'link': {'source_key': SHEET_REF + '#received', 'vehicle': 'TRUCK'}, 'about': 'date'},
                         {'link': {'source_key': jref('acquired_date'), 'vehicle': 'TRUCK'}, 'stance': 'contradicts',
                          'about': 'date'},
                         {'link': {'source_key': jref('purchase'), 'vehicle': 'TRUCK'}, 'about': 'amount'}]},
                    {'key': 'claim:sale:%s' % V['TRUCK'][:8], 'vehicle': 'TRUCK', 'domain': 'custody', 'kind': 'sale',
                     'from': '2032-02-10', 'to': '2032-02-16', 'amount': ['jacket3', 'sale_price'],
                     'trade_in': ['jacket3', 'trade_in_ctv'], 'related_vehicle': 'TRADE', 'confidence': 0.6,
                     'summary': 'sold with a trade-in', 'support': [
                         {'link': {'source_key': jref('sale'), 'vehicle': 'TRUCK'}, 'about': 'amount'},
                         {'link': {'source_key': jref('sale'), 'vehicle': 'TRUCK'}, 'stance': 'contradicts', 'about': 'date'},
                         {'link': {'source_key': 'messages:' + U('guid', 5).upper(), 'vehicle': 'TRUCK'}, 'about': 'date'}]},
                    {'key': 'claim:acquisition:%s' % V['TRADE'][:8], 'vehicle': 'TRADE', 'domain': 'custody',
                     'kind': 'acquisition', 'from': '2032-02-10', 'to': '2032-02-16', 'confidence': 0.6,
                     'summary': 'taken in trade', 'asserted_value': {
                         'trade_in_acv_cents': {'amount': ['jacket3', 'trade_in_acv']},
                         'trade_in_cost_line_cents': {'amount': ['jacket3', 'trade_in_cost_line']}},
                     'support': [{'claim': 'claim:sale:%s' % V['TRUCK'][:8], 'about': 'date'}]}]},
            'change_infer': {'claims': [
                {'key': 'claim:paint:%s' % V['TRUCK'][:8], 'vehicle': 'TRUCK', 'domain': 'physical', 'kind': 'paint',
                 'from': '2031-04-18', 'to': '2031-05-11', 'confidence': 0.5, 'summary': 'paint work', 'support': [
                     {'cand': {'pass': 'photos_album', 'album_title_prefix': 'P aint'}, 'about': 'date'},
                     {'cand': {'pass': 'photos_album', 'day': '2031-05-11'}, 'about': 'date'},
                     {'link': {'source_key': jref('line:paint'), 'vehicle': 'TRUCK'}, 'about': 'other'}]},
                {'key': 'claim:work_performed:%s' % V['TRUCK'][:8], 'vehicle': 'TRUCK', 'domain': 'physical',
                 'kind': 'work_performed', 'party_entity': 'third_party:painter', 'window_from_support': True,
                 'confidence': 0.5, 'summary': "the painter's work", 'support': [
                     {'cand': {'pass': 'photos_album', 'day': '2031-05-11'}, 'about': 'date'},
                     {'link': {'source_key': LEDGER_EXT + lid('00737'), 'vehicle': 'TRUCK'}, 'about': 'party'},
                     {'link': {'source_key': LEDGER_EXT + lid('00206'), 'vehicle': 'TRUCK'}, 'about': 'party'}]}]},
            'custody_bounds': {'vehicles': ['TRUCK']},
            'day_context': {'vehicle': 'TRUCK', 'extra': [
                {'day': YARD_DAY, 'place_cluster': 'yard', 'confidence': 0.4, 'basis': ['proposed_photo_that_day']},
                {'day': '2031-01-15', 'place_cluster': 'yard', 'confidence': 0.2, 'basis': ['gps_place_match']}]},
            'account_map': {'accounts': [
                {'account_ref': LEDGER_ACCOUNT, 'entity_key': 'owner', 'confidence': 0.5, 'evidence': [{'kind': 'ledger'}]},
                {'account_ref': SHARE_ACCOUNT, 'entity_key': 'third_party:share_holder', 'confidence': 0.5,
                 'evidence': [{'kind': 'ledger'}]},
                {'account_ref': 'nuke_org:' + ORG, 'entity_key': 'owner_business:synthetic', 'confidence': 0.5,
                 'evidence': [{'kind': 'nuke_org'}]}]},
        },
    }
    T = V['TRUCK']
    pk = lambda sfx: 'bank:' + lid(sfx)  # noqa: E731
    jacket_refs = [jref('line:labour'), jref('line:paint'), jref('line:dry_ice'), jref('line:corner'), jref('purchase')]
    fixture = {'vehicle_id': T, 'assertions': [
        {'id': 'identity', 'level': 'evidence', 'expect': {'identity_contains': [T], 'identity_excludes': [V['TWIN']]}},
        {'id': 'identity_pair_confirmed', 'level': 'confirmed',
         'decisions': [{'target': 'claim:same_vehicle_as:%s' % V['TWIN'][:8], 'decision': 'confirmed'}],
         'expect': {'identity_contains': [T, V['TWIN']]}},
        {'id': 'acquisition', 'level': 'evidence', 'expect': {'claim': {
            'key': 'claim:acquisition:%s' % T[:8], 'from': ACQ_DAY, 'to': '2031-01-19',
            'supports_kind_count': {'image_candidate': 3}, 'supports': [[lkey(SHEET_REF + '#received', T), 'date']],
            'contradicts': [[lkey(jref('acquired_date'), T), 'date']]},
            'open_question': {'q': 'who_paid', 'claim_key': 'claim:acquisition:%s' % T[:8]}}},
        {'id': 'custody', 'level': 'evidence', 'expect': {'custody': {'from': ACQ_DAY, 'to': '2032-02-16',
                                                                      'status': 'proposed', 'acquired_by': None}}},
        {'id': 'work_days', 'level': 'evidence', 'expect': {'work_days_exact': sorted(ALBUM_DAYS)}},
        {'id': 'third_party', 'level': 'evidence', 'expect': {'not_in_work_days': [SELLER_DAY],
                                                              'not_in_outside': [SELLER_DAY],
                                                              'image_class_count': {'third_party': 5}}},
        {'id': 'outside', 'level': 'evidence', 'expect': {'outside_contains': [[YARD_DAY, 'before', None, None],
                                                                               [DOC_DAY, 'after', None, 1]]}},
        {'id': 'payment_keys_once', 'level': 'evidence', 'expect': {'payment_keys_once': True}},
        {'id': 'tires_once', 'level': 'evidence', 'expect': {'payment_links_contain': {
            pk('00268'): [LEDGER_EXT + lid('00268'), 'gmail:thread:synththread0001']}}},
        {'id': 'painter_contested', 'level': 'evidence', 'expect': {'band_of': {pk('00206'): 'contested'}}},
        {'id': 'painter_answered', 'level': 'confirmed',
         'decisions': [{'target': lkey(LEDGER_EXT + lid('00206'), T), 'decision': 'rejected',
                        'reassign_to': lkey('pnl:disposition:R000000000206', V['SUB'])}],
         'expect': {'band_of': {pk('00206'): 'rejected'}}},
        {'id': 'job_contested', 'level': 'evidence', 'expect': {
            'band_of': {pk('00737'): 'contested'}, 'other_vehicles': {pk('00737'): ['label:' + JOB]},
            'open_question_values': {'payment_placement': {'payment_key': [pk('00206'), pk('00737')]}}}},
        {'id': 'disputed', 'level': 'evidence', 'expect': {'band_of': {pk('00144'): 'disputed'},
                                                           'not_summed': [pk('00144')]}},
        {'id': 'proposed_bands', 'level': 'evidence', 'expect': {'band_keys_exact': {
            'bands': ['confirmed', 'high', 'med', 'low'], 'keys': [pk(x) for x in PROPOSED]}}},
        {'id': 'joined_orders_in_their_payment', 'level': 'evidence', 'expect': {
            'payment_links_contain': {pk('00163'): [LEDGER_EXT + lid('00163'), 'gmail:thread:synththread0004'],
                                      pk('00770'): [LEDGER_EXT + lid('00770'), 'gmail:thread:synththread0003']},
            'unpaid_refs_exclude': ['gmail:thread:synththread0003', 'gmail:thread:synththread0004']}},
        {'id': 'asserted_unpaid', 'level': 'evidence', 'expect': {
            'unpaid_labels_contain': ['Labor', 'paint', 'dry ice', 'Corner Shop'],
            'unpaid_refs_exact': jacket_refs + ['gmail:thread:synththread0007'],
            'open_question_values': {'unpaid_assertion': {'ref': jacket_refs + ['gmail:thread:synththread0007']},
                                     'awaiting_statement': {'ref': []}}}},
        {'id': 'coverage', 'level': 'evidence', 'expect': {'read_equals': {
            'money_sources_cover_to': COVER_TO, 'money_sources_cover_to_by_account': {LEDGER_ACCOUNT: COVER_TO},
            'payments_outside_window': [], 'undated_own_photos': 0}}},
        {'id': 'photos_items', 'level': 'evidence', 'expect': {
            'photos_items_total': 12, 'read_contains': {'photos_items_not_in_nuke': [{'day': '2031-04-22', 'items': 12}]}}},
        {'id': 'no_characterisation_keys', 'level': 'evidence', 'expect': {'read_keys_absent': ['own_labour_asserted',
                                                                                                'labour_paid']}},
        {'id': 'work_performed', 'level': 'evidence', 'expect': {'work_performed_contains': [
            ['third_party:painter', '2031-05-11', '2031-05-11']]}},
        {'id': 'listings', 'level': 'evidence', 'expect': {'listings_exact': [['2031-07-20', '2031-07-27'],
                                                                              ['2031-12-15', '2031-12-22']]}},
        {'id': 'sale', 'level': 'evidence', 'expect': {'claim': {'key': 'claim:sale:%s' % T[:8], 'trade_in_set': True,
                                                                 'related_vehicle_id': V['TRADE']},
                                                       'sale_trade_in': [V['TRADE']]}},
        {'id': 'open_questions', 'level': 'evidence', 'expect': {
            'open_question': {'q': 'who_received', 'claim_key': 'claim:sale:%s' % T[:8]},
            'open_question_refs': {'q': 'account_entity_unknown', 'account_refs': [LEDGER_ACCOUNT, SHARE_ACCOUNT]},
            'contradictions': {'claim:acquisition:%s' % T[:8]: ['date'], 'claim:sale:%s' % T[:8]: ['date']}}},
        {'id': 'income', 'level': 'evidence', 'expect': {'income_contains': [
            [pk('00306'), 'med', SHARE_ACCOUNT, LEDGER_ACCOUNT, 'unknown', 'unknown']]}},
        {'id': 'image_side', 'level': 'evidence', 'expect': {'counts': {
            'time_claims.jsonl': 133, 'candidates.photos_album.jsonl': 99, 'candidates.combined.jsonl': 133,
            'candidates.listing_class.jsonl': 1006}}}]}
    with open(p('case.json'), 'w') as f:
        json.dump(case, f, indent=1)
    with open(p('exit-expected.json'), 'w') as f:
        json.dump(fixture, f, indent=1)
    return {'case': p('case.json'), 'fixture': p('exit-expected.json'), 'owner': OWNER, 'vehicles': V,
            'pinned': pinned, 'dir': d}
