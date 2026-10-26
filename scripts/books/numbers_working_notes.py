#!/usr/bin/env python3
"""Owner working notes (Apple Numbers spreadsheets) as contextual evidence in the owner's private book.

Each original file (a .numbers workbook, a table Numbers exported to CSV, a companion PDF print) becomes one
financial document through public.ingest_financial_evidence, with cells only:
  working_notes_source         one per document: trust tier, artifact clocks, tables, period, key summary
  working_notes_table_<i>      one per sheet table: header, period, keys (vehicles, organizations, related parties,
                               deals, people) and compact rows {r, d, t, a, v, o}
  working_notes_table_<i>_rows_<k>  row continuations when a table does not fit one cell
No lines and no accounting records are written, so no books reader (records, close-out, tax workpapers, vehicle
costs) can count these amounts. public.owner_working_notes(...) reads them back.

Never opens an iCloud placeholder (a file flagged SF_DATALESS): reading one would force a download. Those are
listed in the plan as not_local, and a rerun after they are downloaded lands them (idempotent per sha256).
Never scripts the Numbers app. Never prints environment values.

Usage (run from the repo root so dotenvx finds the env):
  python3 scripts/books/numbers_working_notes.py plan --config <private config.json> --out <plan.json>
  dotenvx run -q -- python3 scripts/books/numbers_working_notes.py land --plan <plan.json> [--dry] [--only <sha8>]
The config names the owner, the roots to scan, earlier CSV export folders and the candidate key files
(vehicles, deal jackets, contacts, related parties, organizations), all read from the owner's database beforehand.
Requires numbers-parser (pip install numbers-parser) for .numbers files.
"""
import argparse, csv, datetime as dt, hashlib, io, json, os, re, stat, subprocess, sys, urllib.error, urllib.request, zipfile

SF_DATALESS = 0x40000000
TRUST = 'owner_working_notes_contextual'
METHOD, VERSION = 'owner-working-notes', 'numbers-context-v1'
CELL_MAX = 3800          # writer limit is 4000 bytes per value
FIELDS_MAX = 100         # writer limit per run
BODY_MAX = 240_000       # writer limit 250,000 for original + revision
ROW_TEXT_MAX = 160
MONTHS = {m: i + 1 for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}
MONTH_RE = r'(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
MAKES = {
    'chevrolet': ['chevrolet', 'chevy', 'chev'], 'gmc': ['gmc'], 'ford': ['ford'], 'dodge': ['dodge'], 'plymouth': ['plymouth'],
    'jeep': ['jeep'], 'porsche': ['porsche'], 'mercedes-benz': ['mercedes', 'benz', 'mb'], 'ferrari': ['ferrari'],
    'bentley': ['bentley'], 'volkswagen': ['vw', 'volkswagen'], 'toyota': ['toyota'], 'pontiac': ['pontiac'],
}
# model words that identify a vehicle family on their own (with a model year)
MODEL_WORDS = ['k5', 'k10', 'k15', 'k20', 'k25', 'k30', 'k35', 'k1500', 'k2500', 'k3500', 'c10', 'c15', 'c20', 'c30', 'c1500',
               'c2500', 'r3500', 'v1500', 'blazer', 'jimmy', 'suburban', 'burb', 'bronco', 'mustang', 'charger', 'roadster',
               'coupe', 'highboy', 'wrangler', 'yukon', 'corvette', 'camaro', 'chevelle', 'sierra', 'cheyenne', 'scottsdale',
               'touareg', 'continental', '240d', 's55', '911', 'road runner', 'cj7', 'f100', 'f250', 'pickup', 'pick up']
MODEL_ALIASES = {'burb': 'suburban', 'pick up': 'pickup', 'k5': 'blazer'}
COLORS = ['red', 'blue', 'white', 'black', 'green', 'ochre', 'orange', 'maroon', 'bronze', 'tan', 'silver', 'grey', 'gray',
          'yellow', 'brown', 'gold', 'camel', 'saddle', 'burgundy', 'teal', 'turquoise']
VIN17_RE = re.compile(r'\b[A-HJ-NPR-Z0-9]{17}\b')
IBAN_RE = re.compile(r'[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}')
SSN_RE = re.compile(r'\b\d{3}-\d{2}-\d{4}\b')
LONG_DIGITS_RE = re.compile(r'\b\d{9,}\b')
MONEY_HEAD_RE = re.compile(r'cost|price|amount|paid|total|due|sale|sold|invest|budget|rent|payment|profit|expense|owe|bid|msrp|wholesale|net|fee|value', re.I)


def iso(d):
    return d.isoformat() if d else None


def file_clock(path):
    st = os.lstat(path)
    mod = dt.datetime.fromtimestamp(st.st_mtime, dt.timezone.utc)
    born = dt.datetime.fromtimestamp(getattr(st, 'st_birthtime', st.st_mtime), dt.timezone.utc)
    return dict(file_modified_at=mod.isoformat(timespec='seconds'), file_created_at=born.isoformat(timespec='seconds'),
                dataless=bool(st.st_flags & SF_DATALESS), is_dir=stat.S_ISDIR(st.st_mode), size=st.st_size)


def location(path, roots):
    """A path without the home directory: '<root label>/<relative path>'."""
    for label, root in roots.items():
        root = os.path.expanduser(root)
        if path.startswith(root.rstrip('/') + '/'):
            return f'{label}/{os.path.relpath(path, root)}'
    return os.path.basename(path)


# ---------- values ----------

def fmt_num(x):
    if isinstance(x, bool):
        return str(x)
    if isinstance(x, float):
        r = round(x, 2)
        return str(int(r)) if r == int(r) else f'{r:.2f}'
    return str(x)


def cell_str(v):
    if v is None:
        return ''
    if isinstance(v, dt.datetime):
        return v.date().isoformat() if (v.hour, v.minute, v.second) == (0, 0, 0) else v.isoformat(timespec='minutes')
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, dt.timedelta):
        h = v.total_seconds() / 3600
        return f'{h:g}h'
    if isinstance(v, (int, float)):
        return fmt_num(v)
    s = str(v).replace('\t', ' ').replace('\n', ' ').strip()
    return re.sub(r'\s{2,}', ' ', s)


def parse_money(s):
    """'$ 17,500.00' / '(250)' / '-1,200' -> float; None when the text is not a plain amount."""
    if isinstance(s, (int, float)) and not isinstance(s, bool):
        return float(s)
    if not isinstance(s, str):
        return None
    t = s.replace('\t', '').replace(' ', '').replace(',', '')
    m = re.fullmatch(r'(\()?(-)?\$?(-)?(\d+(?:\.\d+)?)(\))?', t)
    if not m:
        return None
    v = float(m.group(4))
    return -v if (m.group(1) and m.group(5)) or m.group(2) or m.group(3) else v


def mask(s):
    s = SSN_RE.sub('[masked]', s)
    s = LONG_DIGITS_RE.sub(lambda m: '…' + m.group(0)[-4:], s)
    s = IBAN_RE.sub(lambda m: '…' + m.group(0)[-4:], s)
    return s


def year_of(tok):
    y = int(tok)
    if len(tok) == 2:
        y = 1900 + y if y > 30 else 2000 + y
    return y


def parse_date_text(s, ctx_year=None):
    s = s.strip().lower()
    for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%m/%d/%y', '%b %d, %Y', '%B %d, %Y', '%b %d %Y', '%B %d %Y', '%d %b %Y'):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    m = re.fullmatch(MONTH_RE + r'\.?\s*,?\s*(\d{4})', s)
    if m:
        return dt.date(int(m.group(2)), MONTHS[m.group(1)[:3]], 1)
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})', s)
    if m and ctx_year and 1 <= int(m.group(1)) <= 12 and 1 <= int(m.group(2)) <= 31:
        try:
            return dt.date(ctx_year, int(m.group(1)), int(m.group(2)))
        except ValueError:
            return None
    m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{2,4})\b', s)  # '1/4/24 6047' style: a date followed by a note
    if m:
        try:
            return dt.date(year_of(m.group(3)) if len(m.group(3)) == 2 else int(m.group(3)), int(m.group(1)), int(m.group(2)))
        except ValueError:
            return None
    return None


def title_period(text, fallback_year=None):
    """Explicit period phrases in a file/sheet/table name. A year that starts a vehicle title is a model year."""
    t = text.lower().replace('_', ' ')
    m = re.search(r'as of (\d{1,2})[ /.-](\d{1,2})[ /.-](\d{2,4})', t) or re.search(r'\b(\d{1,2}):(\d{1,2}):(\d{2})\b', t) \
        or re.search(r'(?<![\d-])(\d{1,2})-(\d{1,2})-(\d{2})(?![\d-])', t)
    if m:
        try:
            d = dt.date(year_of(m.group(3)) if len(m.group(3)) == 2 else int(m.group(3)), int(m.group(1)), int(m.group(2)))
            return d, d, 'title'
        except ValueError:
            pass
    years = []
    for m in re.finditer(r'(?<![\d$])(20[12]\d|1[89]\d\d)(?!\d)', t):
        y = int(m.group(1))
        after = t[m.end():m.end() + 24]
        if y < 2015:
            continue  # a model year, never a period
        if re.match(r'\s+(1[89]\d\d|20[0-2]\d)\b', after):
            years.append(y)  # 'C2022 1966 Dodge ...': the first year dates the notes
            continue
        if any(re.match(r'\s+' + re.escape(w) + r'\b', after) for ws in MAKES.values() for w in ws) or \
           any(re.match(r'\s+' + re.escape(w) + r'\b', after) for w in MODEL_WORDS):
            continue  # '2008 Bentley': a model year
        years.append(y)
    m2 = re.search(r'(\d{2})[-/ ](\d{2})\b', t)  # 'projection 24-25'
    if not years and m2 and 15 <= int(m2.group(1)) <= 35 and int(m2.group(2)) == int(m2.group(1)) + 1:
        years = [2000 + int(m2.group(1)), 2000 + int(m2.group(2))]
    months = [MONTHS[m.group(1)[:3]] for m in re.finditer(r'\b' + MONTH_RE + r'\b', t)]
    q = re.search(r'\bq([1-4])\b', t)
    year = years[0] if years else fallback_year if (months or q) else None
    if not year:
        return None, None, None
    if q:
        a = dt.date(year, 3 * int(q.group(1)) - 2, 1)
        b = dt.date(year + (1 if q.group(1) == '4' else 0), (3 * int(q.group(1))) % 12 + 1, 1) - dt.timedelta(days=1)
        return a, b, 'title'
    if months:
        a = dt.date(year, min(months), 1)
        last = max(months)
        b = dt.date(year + (last == 12), last % 12 + 1, 1) - dt.timedelta(days=1)
        return a, b, 'title'
    return dt.date(min(years), 1, 1), dt.date(max(years), 12, 31), 'title'


# ---------- keys ----------

class Keys:
    def __init__(self, cfg_dir, cfg):
        load = lambda k: json.load(open(os.path.join(cfg_dir, cfg['candidates'][k]))) if k in cfg['candidates'] else []
        self.vehicles = []
        by_id = {}
        for v in load('vehicles'):
            by_id[v['id']] = v
        for v in by_id.values():
            if v.get('deleted') or v.get('merged_into_vehicle_id'):
                continue
            words = ' '.join(str(v.get(k) or '') for k in ('make', 'model', 'trim')).lower()
            fam = {MODEL_ALIASES.get(w, w) for w in MODEL_WORDS if re.search(r'\b' + re.escape(w) + r'\b', words)}
            make = next((mk for mk, al in MAKES.items() if any(re.search(r'\b' + re.escape(a) + r'\b', words) for a in al)), None)
            self.vehicles.append(dict(id=v['id'], year=v.get('year'), make=make, fam=fam, vin=(v.get('vin') or '').upper(),
                                      color=(v.get('color') or '').lower(),
                                      label=' '.join(str(x) for x in (v.get('year'), v.get('make'), v.get('model')) if x),
                                      srcs=v.get('srcs') or []))
        self.deals = {}
        for d in load('deal_jackets'):
            if d.get('vehicle_id'):
                self.deals.setdefault(d['vehicle_id'], []).append(d)
        self.people = [p for p in load('contacts') if (p.get('full') or '').strip().count(' ') >= 1]
        self.related = load('related')
        self.orgs = cfg.get('organizations', [])

    def vehicles_in(self, text, window=None):
        """Vehicle keys named in text: VINs, or a model year next to a make/model word.
        Ties break on a colour word in the text, then on a deal jacket active during the notes' window."""
        out, low = [], text.lower()
        for m in VIN17_RE.finditer(text.upper()):
            hit = [v for v in self.vehicles if v['vin'] and v['vin'] == m.group(0)]
            if hit:
                out.append(dict(vehicle_id=hit[0]['id'], label=hit[0]['label'], match='vin'))
        for m in re.finditer(r"(?<![\d$.,])'?(19[2-9]\d|20[0-2]\d|[2-9]\d)(?![\d,.%:])", low):
            year = year_of(m.group(1))
            after = low[m.end(1):m.end(1) + 40]
            fam = {MODEL_ALIASES.get(w, w) for w in MODEL_WORDS if re.match(r'\s*(?:[a-z&.-]+\s+){0,3}?' + re.escape(w) + r'\b', after)}
            make = next((mk for mk, al in MAKES.items() if any(re.match(r'\s*' + re.escape(a) + r'\b', after) for a in al)), None)
            if not fam and not make:
                continue
            if len(m.group(1)) == 2 and not fam:
                continue  # '83 gmc' alone is too thin; '83 k2500' is enough
            cands = [v for v in self.vehicles if v['year'] == year and ((fam and v['fam'] & fam) or (not fam and make and v['make'] == make))]
            if make:
                cands = [v for v in cands if v['make'] in (None, make)] or cands
            if not cands:
                continue
            said = low[m.start():m.end(1) + 30]
            how = 'ymm_unique'
            if len(cands) > 1:
                colours = [c for c in COLORS if re.search(r'\b' + c + r'\b', after)]
                by_colour = [v for v in cands if colours and any(c in v['color'] for c in colours)]
                if len(by_colour) == 1:
                    cands, how = by_colour, 'ymm_colour'
                elif by_colour:
                    cands = by_colour
            if len(cands) > 1 and window:
                active = [v for v in cands if any(self._deal_active(d, window) for d in self.deals.get(v['id'], []))]
                if len(active) == 1:
                    alts = [dict(vehicle_id=v['id'], label=v['label']) for v in cands if v is not active[0]][:4]
                    out.append(dict(vehicle_id=active[0]['id'], label=active[0]['label'], match='ymm_deal_active', text=said.strip(), alternates=alts))
                    continue
            if len(cands) == 1:
                out.append(dict(vehicle_id=cands[0]['id'], label=cands[0]['label'], match=how, text=said.strip()))
            else:
                out.append(dict(vehicle_id=None, match='ymm_ambiguous', text=said.strip(),
                                candidates=[dict(vehicle_id=v['id'], label=v['label'], deal=bool(self.deals.get(v['id']))) for v in cands[:5]]))
        return out

    @staticmethod
    def _deal_active(d, window):
        a = d.get('acq') or '0000'
        b = d.get('sold') or '9999'
        return a <= window[1] and b >= window[0]

    def orgs_in(self, text):
        up = ' ' + re.sub(r'[^A-Z0-9&! ]+', ' ', text.upper()) + ' '
        orgs, rel = [], []
        for o in self.orgs:
            if any(re.search(r'(?<![A-Z0-9])' + re.escape(p) + r'(?![A-Z0-9])', up) for p in o['patterns']):
                orgs.append(dict(organization_id=o['id'], name=o['name']))
        for r in self.related:
            pats = [p for p in r.get('patterns') or [] if not re.search(r'\d', p)] + r.get('extra_patterns', [])
            hit = next((p for p in pats if re.search(r'(?<![A-Z0-9])' + re.escape(p.upper()) + r'(?![A-Z0-9])', up)), None)
            if hit:
                rel.append(dict(entity_id=r['id'], name=r['name'], pattern=hit))
        return orgs, rel

    def people_in(self, text):
        low = text.lower()
        return [dict(contact_id=p['id'], name=p['full'].strip()) for p in self.people
                if re.search(r'\b' + re.escape(p['full'].strip().lower()) + r'\b', low)]


# ---------- tables ----------

def header_index(rows):
    for i, r in enumerate(rows[:3]):
        vals = [v for v in r if v not in (None, '')]
        if len(vals) >= 2 and sum(1 for v in vals if isinstance(v, str) and parse_money(v) is None) >= 0.6 * len(vals):
            return i
    return None


def build_table(name_parts, rows, keys, file_year, period_floor, period_ceiling, window=None, people=None):
    """rows: list of lists of raw values (sheet order, 1-based row numbers = index + 1)."""
    rows = [list(r) for r in rows]
    width = max((len(r) for r in rows), default=0)
    hi = header_index([r for r in rows if any(v not in (None, '') for v in r)] or [[]])
    nonempty = [(i, r) for i, r in enumerate(rows) if any(cell_str(v) not in ('', '0') for v in r)]
    header = None
    if hi is not None and nonempty:
        hrow_i = nonempty[hi][0]
        header = [cell_str(v) for v in rows[hrow_i]]
        nonempty = [(i, r) for i, r in nonempty if i != hrow_i]
    else:
        hrow_i = None
    title = ' / '.join(p for p in name_parts if p)
    ctx_years = [int(h) for h in (header or []) if re.fullmatch(r'20[12]\d', h or '')]
    t_from, t_to, _ = title_period(title, file_year)
    if not ctx_years:  # a bare year cell above the month rows ('2024' / 'January' / 'February' ...)
        ctx_years = [int(c) for _, r in nonempty[:3] for c in (cell_str(v) for v in r) if re.fullmatch(r'20[12]\d', c)]
    ctx_year = ctx_years[0] if ctx_years else (t_from.year if t_from and t_from.year == t_to.year else None)
    title_vehicles = []
    for x in keys.vehicles_in(title, window):
        if not any((x.get('vehicle_id') or x.get('candidates')) == (y.get('vehicle_id') or y.get('candidates')) for y in title_vehicles):
            title_vehicles.append(x)
    t_orgs, t_rel = keys.orgs_in(title)
    vehicles, orgs, rels, people = list(title_vehicles), list(t_orgs), list(t_rel), keys.people_in(title) + list(people or [])

    def key_index(lst, item, k):
        ident = lambda x: x.get(k) or tuple(sorted(c['vehicle_id'] for c in x.get('candidates', []))) or x.get('text')
        for j, x in enumerate(lst):
            if ident(x) == ident(item):
                return j
        lst.append(item)
        return len(lst) - 1

    out_rows, dates = [], []
    for i, r in nonempty:
        cells = [cell_str(v) for v in r]
        parts = []
        for j, c in enumerate(cells):
            if c in ('', '0'):
                continue
            h = header[j] if header and j < len(header) and header[j] else ''
            parts.append(f'{h}={c}' if h else c)
        raw = mask('; '.join(parts))
        vins = []
        def vin_sub(m):
            vins.append(m.group(0))
            return 'VIN…' + m.group(0)[-6:]
        text = VIN17_RE.sub(vin_sub, raw)
        text = text if len(text) <= ROW_TEXT_MAX else text[:ROW_TEXT_MAX - 1] + '…'
        d = None
        for v in r:
            if isinstance(v, dt.datetime):
                d = v.date(); break
            if isinstance(v, dt.date):
                d = v; break
            if isinstance(v, str) and len(v) <= 40:
                d = parse_date_text(v, ctx_year)
                if d:
                    break
        if not d and ctx_year and cells and re.fullmatch(MONTH_RE, cells[0].strip().lower() or '-'):
            d = dt.date(ctx_year, MONTHS[cells[0].strip().lower()[:3]], 1)
        if d and not (period_floor <= d <= period_ceiling):
            d = None
        if d:
            dates.append(d)
        amount = None
        for j, v in enumerate(r):
            h = header[j] if header and j < len(header) else ''
            mv = parse_money(v) if (isinstance(v, str) and '$' in v) or (h and MONEY_HEAD_RE.search(h)) else None
            if mv is not None and not (isinstance(v, (int, float)) and float(v).is_integer() and 1900 <= v <= 2035 and not h):
                amount = fmt_num(mv)
                break
        vrefs = [key_index(vehicles, x, 'vehicle_id') for x in keys.vehicles_in(' '.join(cells) + ' ' + ' '.join(vins), window)]
        ro, rr = keys.orgs_in(' '.join(cells))
        orefs = [key_index(orgs, x, 'organization_id') for x in ro]
        for x in rr:
            key_index(rels, x, 'entity_id')
        for x in keys.people_in(' '.join(cells)):
            key_index(people, x, 'contact_id')
        row = dict(r=i + 1, d=iso(d), t=text, a=amount)
        if vrefs:
            row['v'] = sorted(set(vrefs))
        if orefs:
            row['o'] = sorted(set(orefs))
        out_rows.append(row)
    if dates:
        p = dict(**{'from': iso(min(dates)), 'to': iso(max(dates))}, basis='cell_dates', dated_rows=len(dates))
    elif t_from:
        p = dict(**{'from': iso(t_from), 'to': iso(t_to)}, basis='title')
    else:
        p = None
    deals = []
    for vk in vehicles:
        for dj in keys.deals.get(vk.get('vehicle_id') or '', []):
            deals.append(dict(deal_id=dj['id'], vehicle_id=dj['vehicle_id'], deal_type=dj.get('deal_type'),
                              acquired=dj.get('acq'), sold=dj.get('sold')))
    for vk in vehicles:
        vk['scope'] = 'table' if vk in title_vehicles else 'rows'
    return dict(title=title, header=[mask(h)[:40] for h in (header or []) if h][:24], header_row=(hrow_i + 1) if hrow_i is not None else None,
                rows_total=len(out_rows), columns=width, period=p,
                keys=dict(vehicles=vehicles, organizations=orgs, related_parties=rels, deals=deals, people=people),
                rows=out_rows)


def read_numbers(path):
    from numbers_parser import Document
    doc = Document(path)
    tables = []
    for s in doc.sheets:
        for t in s.tables:
            tables.append((s.name, t.name, t.rows(values_only=True)))
    return tables


def read_csv(path):
    raw = open(path, 'rb').read().decode('utf-8-sig', errors='replace')
    rows = list(csv.reader(io.StringIO(raw)))
    title = None
    if rows and len([c for c in rows[0] if c]) == 1 and ':' in rows[0][0] and len(rows) > 1:
        title = rows[0][0]  # Numbers' "include table names" export: 'Sheet: Table' on the first line
        rows = rows[1:]
    return title, rows


def zip_package(path):
    """Deterministic zip of a .numbers package directory (the original is a folder)."""
    buf = io.BytesIO()
    members = []
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_STORED) as z:
        for dp, dns, fns in os.walk(path):
            dns.sort()
            for fn in sorted(fns):
                fp = os.path.join(dp, fn)
                rel = os.path.relpath(fp, path)
                data = open(fp, 'rb').read()
                zi = zipfile.ZipInfo(rel, date_time=(1980, 1, 1, 0, 0, 0))
                z.writestr(zi, data)
                members.append(dict(path=rel, sha256=hashlib.sha256(data).hexdigest(), bytes=len(data)))
    return buf.getvalue(), members


# ---------- plan ----------

def plan(cfg_path, out_path):
    cfg = json.load(open(cfg_path))
    cfg_dir = os.path.dirname(os.path.abspath(cfg_path))
    keys = Keys(cfg_dir, cfg)
    roots = cfg['roots']
    exclude = [re.compile(x, re.I) for x in cfg.get('exclude', [])]
    blobs_dir = os.path.join(os.path.dirname(os.path.abspath(out_path)), 'blobs')
    os.makedirs(blobs_dir, exist_ok=True)
    inventory, artifacts = [], []
    workbook_index = {}

    for label, root in roots.items():
        root = os.path.expanduser(root)
        for dp, dns, fns in os.walk(root):
            for name in list(dns) + fns:
                p = os.path.join(dp, name)
                low = name.lower()
                if not low.endswith(('.numbers', '.csv', '.pdf')):
                    continue
                if name in dns:
                    dns.remove(name)  # never walk into a package
                if not low.endswith('.numbers') and os.path.isdir(p):
                    continue
                clock = file_clock(p)
                loc = location(p, roots)
                excluded = next((x.pattern for x in exclude if x.search(loc)), None)
                item = dict(location=loc, kind=low.rsplit('.', 1)[1], **clock, excluded=excluded)
                inventory.append(item)
                if low.endswith('.numbers'):
                    workbook_index.setdefault(name[:-len('.numbers')], []).append(dict(location=loc, path=p, **clock))
                if excluded:
                    continue
                if clock['dataless']:
                    item['status'] = 'not_local'
                    continue
                item['status'] = 'local'
                artifacts.append(dict(path=p, location=loc, form=('numbers_package_zip' if clock['is_dir'] else item['kind']), clock=clock))

    for exp in cfg.get('exports', []):
        base = os.path.expanduser(exp['dir'])
        for entry in sorted(os.listdir(base)):
            p = os.path.join(base, entry)
            stem = entry[:-4] if entry.endswith('.csv') else entry
            wb_name = exp.get('workbooks', {}).get(entry) or stem
            wbs = [w for k, w in workbook_index.items() if k.replace(':', '-').replace('/', '-') == wb_name]
            wbs = [w for ws in wbs for w in ws]
            files = [os.path.join(p, f) for f in sorted(os.listdir(p)) if f.endswith('.csv')] if os.path.isdir(p) else [p]
            for f in files:
                artifacts.append(dict(path=f, location=location(f, roots) if any(f.startswith(os.path.expanduser(r)) for r in roots.values()) else f'{exp["label"]}/{os.path.relpath(f, base)}',
                                      form='csv_export', clock=file_clock(f), export_made_at=exp.get('export_made_at'),
                                      workbook=[dict(name=wb_name, location=w['location'], file_modified_at=w['file_modified_at'],
                                                     file_created_at=w['file_created_at'], local=not w['dataless']) for w in wbs],
                                      export_table=os.path.basename(f)[:-4] if os.path.isdir(p) else None))

    by_sha, docs = {}, []
    for a in artifacts:
        if a['form'] == 'numbers_package_zip':
            data, members = zip_package(a['path'])
            ext = 'numbers'
        else:
            data, members = open(a['path'], 'rb').read(), None
            ext = 'numbers' if a['form'] == 'numbers' else a['form'] if a['form'] in ('csv', 'pdf') else 'csv'
        if len(data) > 10 * 1024 * 1024:
            a['status'] = 'too_large'
            continue
        h = hashlib.sha256(data).hexdigest()
        if h in by_sha:
            by_sha[h]['also_at'].append(a['location'] if a['form'] != 'csv_export' else a.get('export_table') or a['location'])
            continue
        blob = os.path.join(blobs_dir, f'{h}.{ext}')
        if not os.path.exists(blob):
            open(blob, 'wb').write(data)
        wb = (a.get('workbook') or [None])[0]
        clock_src = wb or a['clock']
        mod = dt.datetime.fromisoformat(clock_src['file_modified_at']).date()
        born = dt.datetime.fromisoformat(clock_src['file_created_at']).date()
        floor, ceiling = dt.date(2000, 1, 1), mod + dt.timedelta(days=400)
        window = (iso(min(born, mod) - dt.timedelta(days=30)), iso(mod + dt.timedelta(days=30)))
        people = [dict(name=name, resolved=False, basis='folder or file name') for prefix, name in cfg.get('people_locations', {}).items()
                  if a['location'].startswith(prefix) or (wb and wb['location'].startswith(prefix))]
        tables = []
        if a['form'] in ('numbers', 'numbers_package_zip'):
            src_path = a['path']
            for sheet, table, rows in read_numbers(src_path):
                tables.append(dict(sheet=sheet, table=table, **build_table([os.path.basename(a['path'])[:-8], sheet, table], rows, keys, mod.year, floor, ceiling, window, people)))
        elif a['form'] in ('csv', 'csv_export'):
            title, rows = read_csv(a['path'])
            wb_label = wb['name'] if wb else os.path.basename(a['path'])[:-4]
            tname = title or a.get('export_table') or os.path.basename(a['path'])[:-4]
            tables.append(dict(sheet=None, table=tname, **build_table([wb_label, tname], rows, keys, mod.year, floor, ceiling, window, people)))
        wb_period = title_period(os.path.basename(wb['location'] if wb else a['location']), None)
        periods = [t['period'] for t in tables if t['period']]
        if periods:
            pf, pt = min(p['from'] for p in periods), max(p['to'] for p in periods)
            basis = 'cell_dates' if any(p['basis'] == 'cell_dates' for p in periods) else 'title'
        elif wb_period[0]:
            pf, pt, basis = iso(wb_period[0]), iso(wb_period[1]), 'title'
        else:
            pf, pt, basis = iso(min(born, mod)), iso(mod), 'file_clock'
        for t in tables:
            if not t['period']:
                t['period'] = dict(**{'from': pf, 'to': pt}, basis=basis if basis != 'cell_dates' else 'workbook')
        doc = dict(sha256=h, blob=blob, ext=ext, byte_size=len(data), form=a['form'], location=a['location'],
                   filename=os.path.basename(a['path']) if a['form'] != 'numbers_package_zip' else os.path.basename(a['path']) + '.zip',
                   clock=a['clock'], workbook=a.get('workbook'), export_made_at=a.get('export_made_at'),
                   export_table=a.get('export_table'), members=members, also_at=[],
                   period={'from': pf, 'to': pt, 'basis': basis, 'file_modified_at': clock_src['file_modified_at'],
                           'file_created_at': clock_src['file_created_at']},
                   tables=tables)
        by_sha[h] = doc
        docs.append(doc)
    json.dump(dict(generated_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), owner_id=cfg['owner_id'],
                   inventory=inventory, documents=docs), open(out_path, 'w'), indent=1, default=str)
    return inventory, docs


# ---------- revision ----------

def pack_cells(doc):
    """Cells for one document, each value under CELL_MAX bytes and at most FIELDS_MAX cells."""
    cells, table_list = [], []
    nbytes = lambda o: len(json.dumps(o, ensure_ascii=False).encode())
    for i, t in enumerate(doc['tables'], 1):
        key = f'working_notes_table_{i}'
        head = dict(trust_tier=TRUST, sheet=t['sheet'], table=t['table'], header=t['header'], header_row=t['header_row'],
                    rows_total=t['rows_total'], period=t['period'], keys=t['keys'], rows=[], continued_in=[])
        while nbytes(head) > CELL_MAX and head['header']:
            head['header'] = head['header'][:-1]
        # Vehicle keys stay (rows point at them by index); slim them before anything else is cut.
        for slim in (lambda x: [c.pop('label', None) for c in x.get('candidates', [])],
                     lambda x: x.pop('text', None) if x.get('vehicle_id') else None,
                     lambda x: x.update(candidates=x['candidates'][:2]) if x.get('candidates') else None):
            if nbytes(head) <= CELL_MAX - 400:
                break
            for x in head['keys']['vehicles']:
                slim(x)
        for k in ('people', 'deals', 'related_parties', 'organizations'):
            while nbytes(head) > CELL_MAX - 400 and head['keys'][k]:
                head['keys'][k] = head['keys'][k][:-1]; head.setdefault('keys_truncated', []).append(k)
        rows = list(t['rows'])
        while rows and nbytes(head) + nbytes(rows[0]) + 120 < CELL_MAX:
            head['rows'].append(rows.pop(0))
        conts, k = [], 0
        while rows:
            k += 1
            chunk = dict(trust_tier=TRUST, table_index=i, rows=[])
            while rows and nbytes(chunk) + nbytes(rows[0]) + 4 < CELL_MAX:
                chunk['rows'].append(rows.pop(0))
            if not chunk['rows']:
                rows.pop(0)  # a single row larger than a cell cannot happen (text is capped); guard anyway
                continue
            conts.append((f'{key}_rows_{k}', chunk))
        head['continued_in'] = [c[0] for c in conts]
        cells.append((key, head, f"{t['title']}: {t['rows_total']} rows; period {t['period']['from']}..{t['period']['to']} ({t['period']['basis']}); owner working notes, context not books"))
        for ck, chunk in conts:
            cells.append((ck, chunk, f"{t['title']}: rows {chunk['rows'][0]['r']}-{chunk['rows'][-1]['r']} (continued)"))
        table_list.append(dict(i=i, sheet=t['sheet'], table=t['table'], rows=t['rows_total']))
    veh = {v['vehicle_id']: v['label'] for t in doc['tables'] for v in t['keys']['vehicles'] if v.get('vehicle_id')}
    orgs = {o['organization_id']: o['name'] for t in doc['tables'] for o in t['keys']['organizations']}
    rels = {r['entity_id']: r['name'] for t in doc['tables'] for r in t['keys']['related_parties']}
    source = dict(trust_tier=TRUST, not_books=True,
                  note='Owner working notes from the time: estimates, budgets and tallies. Context, not books; never summed.',
                  artifact=dict(form=doc['form'], filename=doc['filename'], location=doc['location'],
                                file_modified_at=doc['clock']['file_modified_at'], file_created_at=doc['clock']['file_created_at'],
                                export_made_at=doc['export_made_at'], export_table=doc['export_table'],
                                workbook=doc['workbook'], package_members=doc['members'], also_at=doc['also_at'][:20]),
                  period=doc['period'], tables=table_list,
                  keys_summary=dict(vehicles=[dict(vehicle_id=k, label=v) for k, v in veh.items()],
                                    organizations=[dict(organization_id=k, name=v) for k, v in orgs.items()],
                                    related_parties=[dict(entity_id=k, name=v) for k, v in rels.items()]),
                  parser=dict(name='numbers-parser' if doc['form'].startswith('numbers') else 'csv', script='scripts/books/numbers_working_notes.py', version=VERSION))
    while nbytes(source) > CELL_MAX and source['tables']:
        source['tables'] = source['tables'][:-1]; source['tables_truncated'] = True
    while nbytes(source) > CELL_MAX and source['artifact']['package_members']:
        source['artifact']['package_members'] = source['artifact']['package_members'][:-1]
    cells.insert(0, ('working_notes_source', source,
                     f"{doc['filename']}: {len(doc['tables'])} tables; period {doc['period']['from']}..{doc['period']['to']} ({doc['period']['basis']}); owner working notes, context not books"))
    if len(cells) > FIELDS_MAX:
        cells = cells[:FIELDS_MAX]
        cells[0][1]['cells_truncated'] = True
    for k, v, _ in cells:
        if nbytes(v) > 3990:
            raise ValueError(f"{doc['location']}: cell {k} is {nbytes(v)} bytes, over the writer limit")
    fields = [dict(field_key=k, value_raw=raw[:2000], value_type='text', value_normalized=v,
                   evidence=dict(stage='owner_working_notes', trust_tier=TRUST, original_sha256=doc['sha256'],
                                 location=doc['location'], method=METHOD, version=VERSION)) for k, v, raw in cells]
    return fields


def guard(obj):
    """The writer refuses these; check before sending (and never send a full-text dump)."""
    for s in iter_strings(obj):
        if len(s) > 2000 or IBAN_RE.search(s) or SSN_RE.search(s):
            raise ValueError('cell text breaks the writer rules: ' + s[:60])


def iter_strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for k, v in o.items():
            yield from iter_strings(k)
            yield from iter_strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from iter_strings(v)


# ---------- land ----------

def sql_quote(s):
    tag = 'W' + hashlib.md5(s.encode()).hexdigest()[:8]
    assert f'${tag}$' not in s
    return f'${tag}${s}${tag}$'


def upload(blob, key, ext):
    url = os.environ['SUPABASE_URL'].rstrip('/') + f'/storage/v1/object/user-documents/{key}'
    ctype = {'pdf': 'application/pdf', 'csv': 'text/csv', 'numbers': 'application/x-iwork-numbers-sffnumbers'}.get(ext, 'application/octet-stream')
    req = urllib.request.Request(url, data=open(blob, 'rb').read(), method='POST', headers={
        'Authorization': 'Bearer ' + os.environ['SUPABASE_SERVICE_ROLE_KEY'], 'apikey': os.environ['SUPABASE_SERVICE_ROLE_KEY'],
        'Content-Type': ctype, 'x-upsert': 'false'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        if e.code in (400, 409) and ('exists' in body.lower() or 'duplicate' in body.lower()):
            return 'exists'
        raise RuntimeError(f'upload failed {e.code}: {body}')


def psql(sql):
    cmd = ['bash', '-c', 'PGPASSWORD="$SUPABASE_DB_PASSWORD" PGOPTIONS="-c statement_timeout=60000 -c lock_timeout=5000" psql '
           '"host=aws-0-us-west-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.qkgaybvrernstplzjaam sslmode=require" '
           '-X -v ON_ERROR_STOP=1 -At -f -']
    out = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr[-1500:])
    return out.stdout


def land(plan_path, dry, only, log_path, exts=None):
    p = json.load(open(plan_path))
    owner = p['owner_id']
    for doc in p['documents']:
        if (only and not doc['sha256'].startswith(only)) or (exts and doc['ext'] not in exts):
            continue
        fields = pack_cells(doc)
        key = f"{owner}/financial/{doc['sha256']}.{doc['ext']}"
        original = dict(sha256=doc['sha256'], storage_path=key, source_filename=doc['filename'][:255], source_kind='upload',
                        byte_size=str(doc['byte_size']))
        revision = dict(idempotency_key=f"working-notes-{doc['sha256'][:8]}", method=METHOD, version=VERSION, fields=fields)
        guard(revision)
        body = json.dumps(original) + json.dumps(revision)
        if len(body.encode()) > BODY_MAX:
            raise ValueError(f"{doc['location']}: revision {len(body)} bytes over the writer limit")
        st = 'dry' if dry else upload(doc['blob'], key, doc['ext'])
        sql = ("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
               "select set_config('request.jwt.claim.role','service_role',true);\n"
               f"select public.ingest_financial_evidence('{owner}'::uuid, {sql_quote(json.dumps(original))}::jsonb, "
               f"{sql_quote(json.dumps(revision, ensure_ascii=False))}::jsonb, '{{\"kind\":\"user\"}}'::jsonb)::text;\n"
               f"{'rollback' if dry else 'commit'};\n")
        rec = json.loads([l for l in psql(sql).splitlines() if l.startswith('{')][-1])
        line = dict(sha256=doc['sha256'], location=doc['location'], upload=st, cells=len(fields), dry=dry,
                    document_id=rec.get('document_id'), run_id=rec.get('extraction_run_id'), duplicate=rec.get('duplicate'),
                    at=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'))
        print(json.dumps(line))
        if log_path and not dry:
            with open(log_path, 'a') as fh:
                fh.write(json.dumps(line) + '\n')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['plan', 'land'])
    ap.add_argument('--config'); ap.add_argument('--out'); ap.add_argument('--plan')
    ap.add_argument('--dry', action='store_true'); ap.add_argument('--only'); ap.add_argument('--log')
    ap.add_argument('--ext', help='comma-separated original extensions to land, e.g. csv,pdf')
    a = ap.parse_args()
    if a.cmd == 'plan':
        inv, docs = plan(a.config, a.out)
        print(json.dumps(dict(files=len(inv), local=sum(1 for i in inv if i.get('status') == 'local'),
                              not_local=sum(1 for i in inv if i.get('status') == 'not_local'), documents=len(docs),
                              tables=sum(len(d['tables']) for d in docs), rows=sum(t['rows_total'] for d in docs for t in d['tables']))))
    else:
        land(a.plan, a.dry, a.only, a.log, set(a.ext.split(',')) if a.ext else None)
