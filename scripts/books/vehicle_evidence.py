#!/usr/bin/env python3
"""Vehicle evidence: extract vehicle-transaction candidates from unstructured records, reconcile them per vehicle and event,
and land the result as cited facts the books linker carries onto the profile.

  extract    purchase agreements and bills of sale (PDF form fields, read by the printed label next to each box, so a template
             whose boxes are named Text74 and Text87 still reads), email bodies (a JSON export), the QuickBooks general-ledger
             rows (memos), the retained books records (descriptions and decisions), and receipts linked to a vehicle.
             Each candidate: vehicle (id, matched by VIN, id or year+model; unmatched stay unresolved), event
             (sale | purchase | deposit | balance | cost | unattributed_deposit), amount, date, counterparty, source ref, confidence.
  reconcile  per vehicle and event. An agreement price is a CLAIM; bank receipts are the PROOF. Receipts that name the vehicle
             are added; if they fall short of the claim, customer deposits in the window that nothing else explains (not an
             own-account transfer, not cash, not ruled out by a books decision) are added in date order until the claim is
             covered, each marked inferred. The result carries value, confidence, every source, and the conflicts. When claims
             disagree and no receipts settle it, the vehicle is left unresolved and the conflict is shown; no source is picked.
  land       one original per vehicle (financial_evidence_v1 via public.ingest_financial_evidence): its candidates as private
             cells and its reconciled sale/purchase as a vehicle_fact cell that public.link_books_to_vehicles applies through the
             cited writers. Names and amounts stay in those private cells; the profile gets ids and counts.

  dotenvx run -- .venv/bin/python scripts/books/vehicle_evidence.py run --owner <uuid> --owner-name "<name on agreements>" \
        --work <dir> [--emails emails.json] [--dry]

Needs pypdf (pip install pypdf) for PDF form fields; pdftotext (poppler) for label positions. Private data is read from local
files and the database and written only to the work dir and the database, never to this repo.
"""
import argparse, collections, datetime as dt, glob, hashlib, itertools, json, os, re, stat, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, q, uuid_ok, upload, current_run, clip  # noqa: E402

METHOD, VERSION = 'vehicle_evidence_reconciler', '2026-10-27'
MONTHS = {m: i for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], 1)}
VIN_RE = re.compile(r'(?<![A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])')
UUID_RE = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.I)
TOL = 0.02          # a price is covered when receipts reach (1 - TOL) of it
OWN_TRANSFER = re.compile(r'RTP FROM PAYPAL|TRANSFER|ACCTVERIFY|FROM ACCOUNT ENDING|ZELLE FROM|OWN CHECK|ONLINE BANKING|WITHDRAWAL', re.I)
CASH = re.compile(r'ATM CASH|CASH DEPOSIT', re.I)


# ---------------------------------------------------------------- helpers
def money(s):
    if s is None:
        return None
    s = str(s).replace(',', '').replace('$', '').strip()
    m = re.fullmatch(r'\(?(-?\d+(?:\.\d+)?)\)?', s)
    return round(float(m.group(1)), 2) if m else None


def parse_date(s):
    if not s:
        return None
    s = str(s).strip().lower()
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', s)
    if m:
        return f'{m[1]}-{m[2]}-{m[3]}'
    m = re.search(r'\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b', s)
    if m:
        y = int(m[3]) + (2000 if int(m[3]) < 100 else 0)
        return f'{y:04d}-{int(m[1]):02d}-{int(m[2]):02d}'
    m = re.search(r'\b([a-z]{3})[a-z]*\.? +(\d{1,2})(?:st|nd|rd|th)?,? +(\d{4})\b', s)
    if m and m[1] in MONTHS:
        return f'{int(m[3]):04d}-{MONTHS[m[1]]:02d}-{int(m[2]):02d}'
    return None


def cid(*parts):
    return hashlib.sha256('|'.join(str(p) for p in parts).encode()).hexdigest()[:20]


def cand(vehicle, event, amount, date, counterparty, kind, ref, confidence, role, note='', how=None, **extra):
    c = dict(vehicle_id=vehicle, event=event, amount=amount, date=date, counterparty=counterparty,
             source=dict(kind=kind, ref=ref), confidence=round(confidence, 2), role=role, note=note, match=how)
    c.update(extra)
    c['id'] = cid(kind, ref, event, amount, date, vehicle)
    return c


# ---------------------------------------------------------------- vehicle index
class Index:
    def __init__(self, owner):
        rows = psql(f"""select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select id, year, make, model, normalized_model, series, vin
          from vehicles where deleted_at is null and merged_into_vehicle_id is null
          and (owner_id='{owner}' or user_id='{owner}' or uploaded_by='{owner}')) t;""")
        self.v = json.loads(rows.strip())
        self.by_vin = collections.defaultdict(list)
        for x in self.v:
            if x['vin'] and len(x['vin']) >= 11:
                self.by_vin[x['vin'].upper()].append(x['id'])
            x['_tok'] = self._tokens(x)

    @staticmethod
    def _tokens(x):
        words = set()
        for f in ('model', 'normalized_model', 'series'):
            for w in re.findall(r'[a-z0-9]+', (x.get(f) or '').lower()):
                if len(w) >= 3 or re.search(r'\d', w):
                    words.add(w)
        words -= {'the', 'and', 'wagon', 'sedan', 'coupe', 'truck', 'pick', 'long', 'bed', 'base', 'series', 'classic', 'cruiser', 'land'}
        return words

    def match(self, text, year=None):
        """-> (vehicle_id | None, how, ambiguous ids). VIN or id outranks year+model; a model code alone (k10, fj80) is weaker."""
        up = text.upper()
        ids = {i.lower() for i in UUID_RE.findall(text)}
        hit = [x['id'] for x in self.v if x['id'] in ids]
        if len(hit) == 1:
            return hit[0], 'id', []
        vins = set(VIN_RE.findall(up)) | {w for w in re.findall(r'[A-Z0-9]{11,17}', up) if w in self.by_vin}   # pre-1981 VINs are shorter than 17
        hit = sorted({i for vin in vins for i in self.by_vin.get(vin, [])})
        if len(hit) == 1:
            return hit[0], 'vin', []
        low = text.lower()
        words = set(re.findall(r'[a-z0-9]+', low))
        years = {int(y) for y in re.findall(r'(?<!\d)(19[2-9]\d|20[0-2]\d)(?!\d)', text)}
        if year:
            years.add(int(year))
        strong, weak = [], []
        for x in self.v:
            hits = x['_tok'] & words
            if not hits:
                continue
            code = any(re.search(r'\d', w) and re.search(r'[a-z]', w) for w in hits)   # k10, fj80, lx450, 135i
            if x['year'] in years:
                strong.append(x['id'])
            elif code:
                weak.append(x['id'])
        if len(strong) > 1:   # the make named in the text breaks a tie between same-year, same-model vehicles
            by_make = [i for i in strong if (next(x for x in self.v if x['id'] == i)['make'] or '').lower() in words]
            if len(by_make) == 1:
                strong = by_make
        if len(strong) == 1:
            return strong[0], 'year+model', []
        if len(strong) > 1:
            return None, 'ambiguous', strong
        if len(weak) == 1:
            return weak[0], 'model-code', []
        return (None, 'ambiguous', weak) if weak else (None, 'none', [])


# ---------------------------------------------------------------- PDF forms
def _words(pdf):
    try:
        out = subprocess.run(['pdftotext', '-bbox', '-f', '1', '-l', '3', pdf, '-'], capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return {}
    pages, cur = {}, None
    for line in out.splitlines():
        m = re.match(r'\s*<page width="([\d.]+)" height="([\d.]+)"', line)
        if m:
            cur = len(pages) + 1
            pages[cur] = dict(w=float(m[1]), h=float(m[2]), words=[])
            continue
        m = re.match(r'\s*<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*)</word>', line)
        if m and cur:
            pages[cur]['words'].append((float(m[1]), float(m[2]), float(m[3]), float(m[4]), m[5]))
    return pages


def label_of(page, rect):
    """Printed label of a box: the contiguous run of words to its left on its line; else the words just above it."""
    x0, y0, x1, y1 = rect
    top, bot = page['h'] - y1, page['h'] - y0
    mid = (top + bot) / 2
    same = sorted([w for w in page['words'] if w[0] < x0 + 3 and w[1] - 2 <= mid <= w[3] + 2], key=lambda w: -w[2])
    chain, edge = [], x0
    for w in same:
        if edge - w[2] > 70 and chain:
            break
        if edge - w[2] > 200:
            break
        chain.append(w)
        edge = w[0]
    txt = ' '.join(w[4] for w in reversed(chain))
    if not re.search(r'[A-Za-z]{3}', txt):
        above = [w for w in page['words'] if w[3] <= top + 2 and top - w[3] < 14 and w[2] > x0 - 5 and w[0] < x1 + 5]
        txt = (txt + ' ' + ' '.join(w[4] for w in sorted(above, key=lambda w: w[0]))).strip()
    return txt


def pdf_fields(pdf):
    try:
        import pypdf
    except ImportError:
        raise SystemExit('pip install pypdf (PDF form fields)')
    r = pypdf.PdfReader(pdf)
    words = _words(pdf)
    out = []
    for pn, p in enumerate(r.pages[:3], 1):
        for a in p.get('/Annots') or []:
            a = a.get_object()
            if a.get('/Subtype') != '/Widget':
                continue
            par = a.get('/Parent').get_object() if a.get('/Parent') else {}
            v = a.get('/V', par.get('/V'))
            name = str(a.get('/T', par.get('/T', '')))
            if v in (None, '', '/Off') or str(v).startswith('/') or name == str(v):
                continue
            rect = [float(x) for x in a['/Rect']]
            out.append(dict(name=name, value=str(v).strip(), rect=rect, page=pn,
                            label=label_of(words[pn], rect) if pn in words else ''))
    return out


def read_agreement(fields, owner_name):
    """Map a filled purchase order / bill of sale to named values by label; -> dict or None when it is not one."""
    lab = lambda f: re.sub(r'[\$\d]+', ' ', f['label']).lower()
    g = {}
    for f in fields:
        l, val = lab(f), f['value']
        if re.search(r'vehicle sales price', l):
            g.setdefault('price', money(val))
        elif re.search(r'total (gross sales|purchase order)', l) and money(val) is not None:
            g.setdefault('total', money(val))
        elif re.search(r'partial payment', l):
            (g.__setitem__('deposit_date', parse_date(val)) if parse_date(val) and money(val) is None else g.setdefault('deposit', money(val)))
        elif re.search(r'balance due', l):
            (g.__setitem__('balance_date', parse_date(val)) if parse_date(val) and money(val) is None else g.setdefault('balance', money(val)))
        elif re.search(r'\bseller\b', l) and f['rect'][3] > 700:
            g.setdefault('seller', val)
        elif re.search(r'\bpurchaser\b', l) and f['rect'][3] > 700:
            g.setdefault('purchaser', val)
        elif re.search(r'\bvin\b', l) or VIN_RE.fullmatch(val.upper()):
            g.setdefault('vin', val.upper())
        elif re.search(r'\bdate\b', l) and parse_date(val) and f['rect'][3] > 650:
            g.setdefault('date', parse_date(val))
        elif re.fullmatch(r'(19|20)\d\d', val) and 'year' in l:
            g.setdefault('year', int(val))
    # an agreement names a price, a VIN or year/make/model, and a seller or purchaser
    if not (g.get('price') or g.get('total')) or not (g.get('seller') or g.get('purchaser')):
        return None
    mk = {f['name']: f['value'] for f in fields}
    g['ident_text'] = ' '.join(v for k, v in mk.items() if k in ('Text4', 'Text5', 'Text6', 'Text7')) or ''
    n = owner_name.lower()
    g['owner_role'] = ('seller' if n in (g.get('seller') or '').lower() else 'purchaser' if n in (g.get('purchaser') or '').lower() else None)
    return g


def dataless(path):
    try:
        return bool(os.stat(path).st_flags & 0x40000000)   # iCloud placeholder: never open
    except OSError:
        return True


def extract_pdfs(roots, idx, owner_name, skip=(), cache=None):
    """cache: {path|mtime|size: parsed agreement or None}; a PDF already read is not parsed again (the incremental cursor)."""
    cache = {} if cache is None else cache
    cands, seen, n_pdf, n_form, n_new = [], 0, 0, 0, 0
    for root in roots:
        for p in glob.glob(os.path.join(os.path.expanduser(root), '**', '*.pdf'), recursive=True):
            if any(s in p for s in skip) or dataless(p) or os.path.getsize(p) > 6_000_000:
                continue
            n_pdf += 1
            ck = f'{p}|{int(os.path.getmtime(p))}|{os.path.getsize(p)}|{owner_name}'
            if ck in cache:
                g = cache[ck]
            else:
                n_new += 1
                try:
                    fields = pdf_fields(p)
                    g = read_agreement(fields, owner_name) if len(fields) >= 5 else None
                except Exception:
                    g = None
                cache[ck] = g
            if not g:
                continue
            n_form += 1
            seen += 1
            vid, how, amb = idx.match(' '.join(filter(None, [g.get('vin'), g['ident_text']])))
            ref = f'pdf:{os.path.basename(p)}'
            price = g.get('price') or g.get('total')
            if price is None or price <= 0:
                continue     # a negative or empty price box is not a price (a payoff line, a template)
            role = g['owner_role']
            ev = 'sale' if role == 'seller' else 'purchase' if role == 'purchaser' else None
            cp = g.get('purchaser') if role == 'seller' else g.get('seller')
            if ev:
                cands.append(cand(vid, ev, price, g.get('date'), cp, 'pdf_form', ref, 0.8 if vid else 0.5, 'claim',
                                  'agreement price (unsigned copies carry the same box)', how, ambiguous=amb))
                if g.get('deposit') not in (None, 0):
                    cands.append(cand(vid, 'deposit', abs(g['deposit']), g.get('deposit_date'), cp, 'pdf_form', ref, 0.5, 'claim',
                                      'partial payment the agreement states (a claim, not a receipt)', how, ambiguous=amb))
                if g.get('balance') not in (None, 0):
                    cands.append(cand(vid, 'balance', abs(g['balance']), g.get('balance_date'), cp, 'pdf_form', ref, 0.5, 'claim',
                                      'balance due the agreement states', how, ambiguous=amb))
    return cands, dict(pdfs_seen=n_pdf, pdfs_parsed_new=n_new, agreement_forms=n_form)


# ---------------------------------------------------------------- email, ledger, books records, receipts
AMT = re.compile(r'\$\s?([\d,]+(?:\.\d{2})?)')


def extract_emails(path, idx, owner_name):
    """emails.json: [{id, date, from, to, subject, body, attachments:[name]}] exported from the mailbox connector."""
    cands = []
    if not path or not os.path.exists(path):
        return cands, dict(emails_read=0)
    msgs = json.load(open(path))
    for m in msgs:
        text = f"{m.get('subject', '')} {m.get('body', '')} {' '.join(m.get('attachments', []))}"
        vid, how, amb = idx.match(text)
        if not re.search(r'purchase agreement|bill of sale|deposit|wire|balance|paid|payment', text, re.I):
            continue
        dates = parse_date(m.get('date'))
        sent_by_owner = owner_name.split()[0].lower() in (m.get('from') or '').lower() or (m.get('from') or '').lower().startswith(m.get('owner_email', '~'))
        amts = [money(a) for a in AMT.findall(text)]
        if amts:
            for a in amts:
                cands.append(cand(vid, 'deposit' if re.search(r'deposit|paid|received|wire', text, re.I) else 'sale', a, dates,
                                  m.get('to', [''])[0] if isinstance(m.get('to'), list) else m.get('to'), 'email', f"gmail:{m['id']}", 0.4, 'claim',
                                  'amount quoted in the message body', how, ambiguous=amb))
        else:   # the message sent an agreement: it dates and names the counterparty, it does not price it
            cands.append(cand(vid, 'agreement_sent', None, dates, (m.get('to') or [''])[0] if isinstance(m.get('to'), list) else m.get('to'),
                              'email', f"gmail:{m['id']}", 0.6, 'context', 'agreement sent; the price is in the attachment', how, ambiguous=amb))
    return cands, dict(emails_read=len(msgs))


def extract_gl(globs, idx):
    """QuickBooks general-ledger rows [acct, date, type, num, name, memo, split, amount, balance]. Deposits become receipts when the
    memo names a vehicle, otherwise they join the pool of unattributed customer deposits the reconciler may infer from."""
    cands, n = [], 0
    for pat in globs:
        for f in glob.glob(os.path.expanduser(pat), recursive=True):
            rows = json.load(open(f))
            seen = set()
            sib = collections.defaultdict(set)    # QuickBooks splits one PayPal sale over several rows; the note sits on a sibling
            for r in rows:
                if r[3]:
                    sib[(r[1], r[3])].add(r[5])
            for acct, date, typ, num, name, memo, split, amt, bal in rows:
                a = money(amt)
                if a is None or a <= 0 or date is None:
                    continue
                is_receipt = typ == 'Sales Receipt' and acct == 'PayPal Sales'
                is_deposit = typ == 'Deposit' and split == 'Sales' and acct != 'Sales'
                if not (is_receipt or is_deposit):
                    continue
                key = (date, a, memo[:60], num)
                if key in seen:
                    continue
                seen.add(key)
                n += 1
                text = f"{' '.join(sorted(sib[(date, num)])) if num else memo} {memo} {name}"
                vid, how, amb = idx.match(text)
                ref = f'gl:{os.path.basename(f)}:{date}:{acct}:{a:.2f}'
                if vid and re.search(r'sale|sold|deposit|pick ?up|balance|payment|paid', text, re.I):
                    cands.append(cand(vid, 'deposit', a, date, name or None, 'gl', ref, 0.9 if how != 'model-code' else 0.75, 'proof',
                                      'bank/PayPal deposit whose memo names the vehicle', how, channel=acct, memo=clip(memo.replace('\n', ' '), 200)))
                elif not vid and amb and re.search(r'sale|sold|deposit on|pick ?up|balance', text, re.I):
                    cands.append(cand(None, 'deposit', a, date, name or None, 'gl', ref, 0.75, 'proof',
                                      'deposit whose memo fits several vehicles; assigned only by an agreement dated nearby', how,
                                      channel=acct, memo=clip(memo.replace('\n', ' '), 200), ambiguous=amb))
                elif not vid and is_deposit:     # a named customer's sales receipt is that customer's, never a pool member
                    cls = 'own_transfer' if OWN_TRANSFER.search(memo) else 'cash' if CASH.search(memo) else 'customer'
                    cands.append(cand(None, 'unattributed_deposit', a, date, name or None, 'gl', ref, 0.3, 'pool',
                                      'booked as Sales; memo names no vehicle', 'none', channel=acct, cls=cls, memo=clip(memo.replace('\n', ' '), 200)))
    return cands, dict(gl_deposit_rows=n)


def extract_books(owner, idx):
    """Retained books records: decisions that rule a deposit out as a sale (reverse a Revenue row), plus vehicle mentions."""
    rows = json.loads(psql(f"""select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select record_kind, record_date::text d, section, category, amount_value::float8 a,
        left(coalesce(description,''),400) descr, left(coalesce(decision,''),400) dec, left(source_key,16) sk, record::text ~ 'ruling' as has_ruling
        from v_financial_accounting_records where owner_id='{owner}' and record_kind in ('retained_ledger_decision','retained_bank_movement')) t;""").strip())
    cands, ruled = [], set()
    for r in rows:
        if r['record_kind'] == 'retained_ledger_decision' and r['section'] == 'Revenue' and (r['a'] or 0) < 0 and re.search(r'not (income|a sale|revenue)|own|transfer|pass-through|booked as', r['dec'] + r['descr'], re.I):
            ruled.add((r['d'], round(abs(r['a']), 2)))
        text = f"{r['descr']} {r['dec']} {r['category']}"
        vid, how, amb = idx.match(text)
        if not vid:
            continue
        m = re.search(r'\b(sale|sold|purchase[d]?|bought|bill of sale)\b[^0-9$]{0,30}\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d\d)?|\d{4,6}(?:\.\d\d)?)', text, re.I)
        if m and re.fullmatch(r'(19|20)\d\d', m[2]) and '$' not in m[0]:
            m = None    # "sale 1991 Toyota": a model year, not a price
        if m:   # an amount a books decision states next to the word sale or purchase: a secondary claim, never proof
            ev = 'sale' if m[1].lower() in ('sale', 'sold', 'bill of sale') else 'purchase'
            cands.append(cand(vid, ev, money(m[2]), r['d'], None, 'books_record', f"books:{r['sk']}", 0.5, 'claim', clip(r['descr'], 160), how))
        elif r['section'] == 'Expense' and r['a']:
            cands.append(cand(vid, 'cost', round(abs(r['a']), 2), r['d'], None, 'books_record', f"books:{r['sk']}", 0.6, 'claim', clip(r['descr'], 160), how))
    return cands, dict(books_records=len(rows), ruled_out_deposits=len(ruled)), ruled


def extract_receipts(owner):
    rows = json.loads(psql(f"""select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select l.vehicle_id, r.id, r.vendor_name, r.total_amount::float8 a,
        coalesce(r.receipt_date, r.transaction_date)::text d from receipt_vehicle_links l join receipts r on r.id=l.receipt_id
        where l.status='linked' and l.retired_at is null and r.user_id='{owner}' and r.is_superseded is not true) t;""").strip())
    return [cand(r['vehicle_id'], 'cost', r['a'], r['d'], r['vendor_name'], 'receipt', f"receipts:{r['id']}", 0.9, 'proof', 'linked receipt', 'link')
            for r in rows if r['a']], dict(receipts_linked=len(rows))


def anchor_ambiguous(cands):
    """A memo that fits several vehicles (two 1978 K10s) is assigned to the one whose agreement is dated within the window."""
    anchors = collections.defaultdict(list)
    for c in cands:
        if c['vehicle_id'] and c['source']['kind'] == 'pdf_form' and c['event'] in ('sale', 'purchase') and c['date']:
            anchors[c['vehicle_id']].append(c['date'])
    for c in cands:
        amb = c.get('ambiguous')
        if c['vehicle_id'] or not amb or not c['date']:
            continue
        near = [v for v in amb if any(-10 <= days(c['date'], d) <= 75 for d in anchors.get(v, []))]
        if len(near) == 1:
            c['vehicle_id'], c['match'] = near[0], 'agreement-anchor'
            c['confidence'] = round(c['confidence'] * 0.9, 2)
            c['id'] = cid(c['source']['kind'], c['source']['ref'], c['event'], c['amount'], c['date'], c['vehicle_id'])


# ---------------------------------------------------------------- reconcile
def days(a, b):
    return (dt.date.fromisoformat(a) - dt.date.fromisoformat(b)).days


def _name_tokens(name):
    return {w for w in re.findall(r'[a-z]+', (name or '').lower()) if len(w) >= 3} - {'llc', 'inc', 'the', 'and', 'paypal', 'sales', 'zelle', 'venmo'}


def find_voids(agreements, cs, facts):
    """-> {candidate id: reason}. An agreement is VOID, not a conflicting price, when
      - the owner states the deal failed (an owner_fact cell naming the counterparty), or
      - the vehicle has receipts that name a payer, none of those payers is the agreement's counterparty, and the receipts
        already reach half the agreement's price: the money came from somebody else, so the deal that closed is not this one.
    A void agreement stays in the dossier as context and never enters the claims, the conflicts or the receipt inference."""
    out = {}
    for a in agreements:
        cp = _name_tokens(a.get('counterparty'))
        for f in facts:
            if f.get('counterparty_tokens') and cp & f['counterparty_tokens']:
                out[a['id']] = f"owner states this agreement did not go through ({f.get('stated', 'dated')})"
    receipts = [c for c in cs if c['event'] == 'deposit' and c['role'] == 'proof']
    payers = set().union(*[_name_tokens(c.get('counterparty')) for c in receipts]) if receipts else set()
    got = sum(c['amount'] for c in receipts)
    for a in agreements:
        cp = _name_tokens(a.get('counterparty'))
        if a['id'] not in out and cp and payers and not (cp & payers) and got >= 0.5 * a['amount']:
            out[a['id']] = 'counterparty on the agreement is not a payer in the receipts; receipts name another payer'
    return out


def reconcile(cands, ruled, current, owner_facts=None):
    """-> list of results per (vehicle, kind). current: {vehicle_id: {sale_price, sale_date, purchase_price, purchase_date}}."""
    by = collections.defaultdict(list)
    for c in cands:
        if c['vehicle_id']:
            by[c['vehicle_id']].append(c)
    pool = [c for c in cands if c['event'] == 'unattributed_deposit' and c['cls'] == 'customer' and (c['date'], c['amount']) not in ruled]
    taken, results = set(), []
    order = sorted(by, key=lambda v: min([c['date'] for c in by[v] if c['date']] or ['9999']))
    for vid in order:
        cs, cur = by[vid], current.get(vid, {})
        for kind in ('sale', 'purchase'):
            claims = [c for c in cs if c['event'] == kind and c['amount']]
            if not claims:
                continue
            facts = [f for f in (owner_facts or []) if f['vehicle_id'] == vid and f['event'] == kind]
            voids = find_voids([c for c in claims if c['source']['kind'] == 'pdf_form'], cs, facts)
            for c in claims:
                if c['id'] in voids:
                    c['role'], c['note'] = 'void', 'void agreement: ' + voids[c['id']]
            voided = [c for c in claims if c['id'] in voids]
            claims = [c for c in claims if c['id'] not in voids]
            strong = [c for c in claims if c['source']['kind'] in ('pdf_form', 'email')]
            distinct = sorted({c['amount'] for c in strong}) if strong else []
            proof = [c for c in cs if c['event'] == 'deposit' and c['role'] == 'proof'] if kind == 'sale' else []
            res = dict(vehicle_id=vid, kind=kind, claims=[dict(amount=c['amount'], source=c['source']['kind'], id=c['id']) for c in claims],
                       conflicts=[], components=[], status='unresolved', value=None, date=None, confidence=0.0)
            seen_pr, receipts = set(), []
            for p in sorted(proof, key=lambda c: c['date']):
                if (p['date'], p['amount']) in seen_pr:
                    continue
                seen_pr.add((p['date'], p['amount']))
                receipts.append(dict(amount=p['amount'], date=p['date'], id=p['id'], basis='memo names the vehicle'))
            agreement = [c for c in claims if c['source']['kind'] == 'pdf_form']
            claim = (agreement[0]['amount'] if agreement else (distinct[0] if len(distinct) == 1 else None))
            if agreement:    # a books record that states another amount for the same event is a conflict to show, not a vote
                for c in claims:
                    if c['source']['kind'] == 'books_record' and abs(c['amount'] - claim) > 0.5 and 0.5 * claim <= c['amount'] <= 2 * claim:
                        res['conflicts'].append(f"a books record states {c['amount']:,.2f} for the {kind}")
            if not strong and voided and kind == 'sale' and receipts:
                got = sum(r['amount'] for r in receipts)
                res['components'] = receipts
                res.update(status='receipts_only', value=round(got, 2), confidence=0.7, n_sources=len(receipts) + len(voided),
                           date=max(r['date'] for r in receipts if r['amount'] == max(x['amount'] for x in receipts)))
                res['conflicts'] += [f"{len(voided)} agreement(s) void: {voids[voided[0]['id']]}",
                                     'the sale rests on receipts that name the vehicle; no agreement for the buyer who paid is in the dossier']
                res['voided'] = [c['id'] for c in voided]
                res['profile_before'] = dict(price=cur.get('sale_price'), date=cur.get('sale_date'))
                if cur.get('sale_price') is not None and abs(float(cur['sale_price']) - got) > 0.5:
                    res['conflicts'].append(f"profile holds {float(cur['sale_price']):,.2f}; reconciled value differs")
                results.append(res)
                continue
            if not strong:
                res.update(status='insufficient_evidence')
                res['conflicts'].append('only a books-record mention states a price; no agreement or receipt in the dossier')
                res['n_sources'] = len(claims)
                results.append(res)
                continue
            if len(distinct) > 1:
                res['conflicts'].append(f"claims disagree: {', '.join(f'{a:,.2f}' for a in distinct)}")
            if kind == 'sale' and claim:
                got = sum(r['amount'] for r in receipts)
                if got < claim * (1 - TOL):
                    anchor = [r['date'] for r in receipts] or [a['date'] for a in agreement if a['date']] or [c['date'] for c in claims if c['date']]
                    lo, hi = min(anchor), max(anchor)
                    gap = claim - got
                    near = [p for p in sorted(pool, key=lambda c: c['date'])
                            if id(p) not in taken and -3 <= days(p['date'], lo) and days(p['date'], hi) <= 45 and p['amount'] <= gap * 1.1][:12]
                    best = None     # the subset of unexplained customer deposits whose sum is nearest the gap; fewest items on a tie
                    for n in range(1, 5):
                        for combo in itertools.combinations(near, n):
                            d = abs(sum(p['amount'] for p in combo) - gap)
                            if best is None or d < best[0] - 0.005:
                                best = (d, combo)
                    if best and best[0] <= claim * 0.05:
                        for p in best[1]:
                            taken.add(id(p))
                            got += p['amount']
                            receipts.append(dict(amount=p['amount'], date=p['date'], id=p['id'], basis='inferred: booked as Sales in the window, memo names no vehicle'))
                res['components'] = receipts
                inferred = [r for r in receipts if r['basis'].startswith('inferred')]
                if receipts and got >= claim * (1 - TOL):
                    res.update(status='reconciled', value=round(got, 2), confidence=0.75 if inferred else 0.95)
                    top = max((r for r in receipts if not r['basis'].startswith('inferred')), key=lambda r: r['amount'], default=receipts[0])
                    res['date'] = top['date']
                    dates = sorted({d for a in agreement for d in [a['date']] + [x['date'] for x in a.get('copies', [])] if d})
                    if len(dates) > 1:
                        res['conflicts'].append(f"agreement copies carry different dates: {', '.join(dates)}")
                    if abs(got - claim) > 0.005:
                        res['conflicts'].append(f"agreement price {claim:,.2f} differs from receipts {got:,.2f} ({got - claim:+,.2f}, {100 * (got - claim) / claim:+.1f}%)")
                    if inferred:
                        res['conflicts'].append(f"{len(inferred)} of {len(receipts)} receipts attributed by window and amount, not by memo")
                elif receipts:      # proof falls short of the claim: show it, keep the claim, low confidence
                    res.update(status='claim_partly_proven', value=claim, confidence=0.5, date=[a['date'] for a in agreement if a['date']][:1] and [a['date'] for a in agreement if a['date']][0] or receipts[0]['date'])
                    res['conflicts'].append(f"receipts {got:,.2f} cover only part of the claimed {claim:,.2f}")
                else:
                    ad = sorted({d for a in agreement for d in [a['date']] + [x['date'] for x in a.get('copies', [])] if d})
                    res.update(status='claim_only', value=claim, confidence=0.5, date=ad[-1] if ad else None)
                    if len(ad) > 1:
                        res['conflicts'].append(f"agreement copies carry different dates: {', '.join(ad)}; the latest (a corrected copy) is used")
                    res['conflicts'].append('no receipt in the owner accounts supports the claim (proceeds may have gone elsewhere)')
                if len(distinct) > 1 and res['status'] == 'claim_only':
                    res.update(status='unresolved', value=None, confidence=0.0)
            elif kind == 'purchase' and claim and len(distinct) == 1:
                res.update(status='claim_only', value=claim, confidence=0.6 if len(claims) == 1 else 0.85,
                           date=next((c['date'] for c in claims if c['date']), None))
            res['n_sources'] = len({c['id'] for c in claims} | {r['id'] for r in res['components']})
            sp, sd = cur.get(f'{kind}_price'), cur.get(f'{kind}_date')
            if res['value'] is not None and sp is not None and abs(float(sp) - res['value']) > 0.5:
                res['conflicts'].append(f"profile holds {float(sp):,.2f}; reconciled value differs")
            res['profile_before'] = dict(price=sp, date=sd)
            results.append(res)
    return results


# ---------------------------------------------------------------- land
def dossier_original(owner, vid):
    body = f'Vehicle evidence dossier {vid}. Candidates and reconciled facts are revisions of this original in financial_evidence_v1.\n'.encode()
    sha = hashlib.sha256(body).hexdigest()
    return body, dict(sha256=sha, storage_path=f'{owner}/financial/{sha}.txt', source_filename='vehicle-evidence-dossier.txt',
                      source_kind='upload', byte_size=str(len(body)))


def build_cells(vid, cs, results):
    fields = []
    for r in results:
        if r['value'] is None or r['status'] == 'unresolved':
            continue
        cites = {'price': f"reconciled {r['status']}: " + '; '.join(r['conflicts'])[:600] if r['conflicts'] else f"reconciled {r['status']}"}
        if r['date']:
            cites['date'] = 'earliest anchoring record in the dossier'
        val = dict(kind=r['kind'], vehicle_id=vid, price=r['value'], date=r['date'], reconciled=True, overwrite=r['confidence'] >= 0.7,
                   confidence=r['confidence'], n_sources=r['n_sources'], n_conflicts=len(r['conflicts']),
                   reason=f"reconciled {r['kind']} from {r['n_sources']} records", cites=cites, status=r['status'])
        key = f"vehicle_fact_{cid(vid, r['kind'])}_{r['kind']}"[:60]
        fields.append(dict(field_key=key, value_raw=f"{r['kind']} {r['status']}", value_type='text', value_normalized=val,
                           evidence=dict(source=clip('; '.join(f'{k}: {v}' for k, v in cites.items()), 1800), method=METHOD,
                                         candidates=[x['id'] for x in r['claims']][:20], components=r['components'][:20])))
    keep = sorted(cs, key=lambda c: -c['confidence'])[: 99 - len(fields)]
    for c in keep:
        v = {k: c[k] for k in ('event', 'amount', 'date', 'counterparty', 'role', 'note', 'confidence', 'match') if k in c}
        v['source'] = c['source']
        v['memo'] = c.get('memo')
        fields.append(dict(field_key=f"vehicle_candidate_{c['id']}", value_raw=clip(f"{c['event']} {c['amount']} {c['date']}", 400), value_type='text',
                           value_normalized=v, evidence=dict(source=clip(json.dumps(c['source']), 900), method=METHOD)))
    return fields


def land(owner, per_vehicle, results, dry, sleep=0.0):
    out = []
    for vid, cs in per_vehicle.items():
        if out and sleep:
            time.sleep(sleep)
        fields = build_cells(vid, cs, [r for r in results if r['vehicle_id'] == vid])
        if not fields:
            continue
        digest = hashlib.sha256(json.dumps(fields, sort_keys=True, default=str).encode()).hexdigest()[:12]
        rev = dict(idempotency_key=f'vehicle-evidence-{vid[:8]}-{digest}', method=METHOD, version=VERSION, fields=fields)
        body, original = dossier_original(owner, vid)
        original = dict(original)
        # one original per vehicle: its body names the vehicle
        cur = current_run(owner, original['sha256'])
        if cur and cur['key'] == rev['idempotency_key']:
            out.append(dict(vehicle_id=vid, unchanged=True))
            continue
        if cur:
            rev['supersedes_run_id'] = cur['run_id']
            have = {f['field_key'] for f in fields}
            for k in cur['field_keys'] or []:
                if k not in have:   # a revision is complete: carry a retired candidate forward as a context cell
                    fields.append(dict(field_key=k, value_raw='carried forward', value_type='text', value_normalized=None,
                                       evidence=dict(source='carried from the previous revision', method=METHOD)))
        st = 'dry' if dry else upload(body, original['storage_path'])
        sql = ("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
               "select set_config('request.jwt.claim.role','service_role',true);\n"
               f"select public.ingest_financial_evidence('{owner}'::uuid, {q(json.dumps(original))}::jsonb, "
               f"{q(json.dumps(rev, ensure_ascii=False, default=str))}::jsonb, '{{\"kind\":\"user\"}}'::jsonb)::text;\n"
               f"{'rollback' if dry else 'commit'};\n")
        o = [l for l in psql(sql).splitlines() if l.strip()]
        rec = json.loads(next(l for l in o if l.startswith('{') and 'extraction_run_id' in l))
        out.append(dict(vehicle_id=vid, dry=dry, upload=st, run_id=rec.get('extraction_run_id'), cells=len(fields)))
    return out


def land_heartbeat(owner, stats, dry):
    """The job's DB-side pulse: one cell on a fixed original, each landing supersedes the last. check_vehicle_evidence_job() (cron
    watch-vehicle-evidence) fails, and so v_job_health shows it, when this goes stale."""
    body = b'Vehicle evidence job heartbeat. Each landing is a revision of this original in financial_evidence_v1.\n'
    sha = hashlib.sha256(body).hexdigest()
    original = dict(sha256=sha, storage_path=f'{owner}/financial/{sha}.txt', source_filename='vehicle-evidence-heartbeat.txt',
                    source_kind='upload', byte_size=str(len(body)))
    val = dict(job='vehicle-evidence', at=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
               **{k: v for k, v in stats.items() if isinstance(v, (int, str)) and k != 'landed'})
    val['reconciled'] = dict(stats.get('reconciled', {}))
    fields = [dict(field_key='job_heartbeat', value_raw='vehicle-evidence heartbeat', value_type='text', value_normalized=val,
                   evidence=dict(source='local launchd job ag.nuke.vehicle-evidence', method=METHOD))]
    rev = dict(idempotency_key=f"vehicle-evidence-heartbeat-{val['at']}", method=METHOD, version=VERSION, fields=fields)
    cur = current_run(owner, sha)
    if cur:
        rev['supersedes_run_id'] = cur['run_id']
    if not dry:
        upload(body, original['storage_path'])
    sql = ("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
           "select set_config('request.jwt.claim.role','service_role',true);\n"
           f"select public.ingest_financial_evidence('{owner}'::uuid, {q(json.dumps(original))}::jsonb, "
           f"{q(json.dumps(rev, default=str))}::jsonb, '{{\"kind\":\"user\"}}'::jsonb)::text;\n{'rollback' if dry else 'commit'};\n")
    psql(sql)
    return val['at']


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('cmd', choices=['run', 'extract', 'reconcile'])
    ap.add_argument('--owner', required=True)
    ap.add_argument('--owner-name', required=True, help='name as written on the owner side of agreements')
    ap.add_argument('--work', required=True)
    ap.add_argument('--pdf-root', action='append', default=['~/Documents', '~/Desktop'])
    ap.add_argument('--skip', action='append', default=['FOR-SIGNING', 'bank-statements', 'Library'])
    ap.add_argument('--gl', action='append', default=['~/nuke-logs/books-*/**/gl*_rows.json'])
    ap.add_argument('--emails')
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--facts', default='~/nuke-logs/vehicle-evidence/owner_facts.json',
                    help='owner statements (private, outside the repo): [{vehicle_id, event, counterparty_contains, stated}]')
    ap.add_argument('--cursor', help='cursor file: PDFs already parsed and the digest of the last landed candidate set')
    ap.add_argument('--max-land', type=int, default=60, help='load budget: dossiers written per run')
    ap.add_argument('--land-sleep', type=float, default=1.0, help='load budget: seconds between dossier writes')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--heartbeat-hours', type=float, default=0, help='land a job heartbeat cell at most this often (0 = never)')
    a = ap.parse_args()
    owner = uuid_ok(a.owner)
    os.makedirs(a.work, exist_ok=True)
    idx = Index(owner)
    cursor = json.load(open(os.path.expanduser(a.cursor))) if a.cursor and os.path.exists(os.path.expanduser(a.cursor)) else {}
    pdf_cache = cursor.get('pdf_cache', {})
    cands, stats = [], dict(vehicles_in_index=len(idx.v))
    for fn, args in ((extract_pdfs, (a.pdf_root, idx, a.owner_name, a.skip, pdf_cache)), (extract_emails, (a.emails, idx, a.owner_name)), (extract_gl, (a.gl, idx))):
        c, s = fn(*args)
        cands += c
        stats.update(s)
    owner_facts = []
    fp = os.path.expanduser(a.facts)
    for f in (json.load(open(fp)) if os.path.exists(fp) else []):
        f['counterparty_tokens'] = _name_tokens(f.get('counterparty_contains'))
        owner_facts.append(f)
        cands.append(cand(f['vehicle_id'], 'owner_fact', None, f.get('stated'), None, 'owner_statement', f"owner:{cid(f['vehicle_id'], f['event'], f.get('counterparty_contains'))}",
                          1.0, 'context', f"owner states the {f['event']} agreement with a named counterparty did not go through", 'id'))
    c, s, ruled = extract_books(owner, idx)
    cands += c
    stats.update(s)
    c, s = extract_receipts(owner)
    cands += c
    stats.update(s)
    uniq = {}
    for c in cands:     # copies of one agreement (a corrected PDF, a re-used template) are one claim; each copy's date is kept
        k = (c['vehicle_id'], c['event'], c['amount'], c['counterparty'], c['source']['kind']) if c['source']['kind'] == 'pdf_form' else c['id']
        if k in uniq:
            uniq[k].setdefault('copies', []).append(dict(ref=c['source']['ref'], date=c['date']))
        else:
            uniq[k] = c
    cands = list(uniq.values())
    anchor_ambiguous(cands)
    stats['candidates'] = len(cands)
    stats['candidates_unresolved_vehicle'] = sum(1 for c in cands if not c['vehicle_id'] and c['event'] != 'unattributed_deposit')
    json.dump(cands, open(os.path.join(a.work, 'candidates.json'), 'w'), indent=1, default=str)
    cur = json.loads(psql(f"""select coalesce(jsonb_object_agg(id, jsonb_build_object('sale_price', sale_price, 'sale_date', sale_date::text,
        'purchase_price', purchase_price, 'purchase_date', purchase_date::text)),'{{}}') from vehicles
        where owner_id='{owner}' or user_id='{owner}' or uploaded_by='{owner}';""").strip())
    results = reconcile(cands, ruled, cur, owner_facts)
    byid = {c['id']: c for c in cands}
    for r in results:      # a deposit the reconciler attributed by window joins that vehicle's dossier, marked inferred
        for comp in r['components']:
            c = byid.get(comp['id'])
            if c and not c['vehicle_id']:
                c['vehicle_id'], c['role'], c['match'] = r['vehicle_id'], 'inferred_proof', 'window+amount'
    json.dump(results, open(os.path.join(a.work, 'reconciled.json'), 'w'), indent=1, default=str)
    stats['vehicles_with_candidates'] = len({c['vehicle_id'] for c in cands if c['vehicle_id']})
    stats['reconciled'] = collections.Counter(r['status'] for r in results)
    if a.cmd == 'run':
        per = collections.defaultdict(list)
        have = {r['vehicle_id'] for r in results if r['value'] is not None}
        for c in cands:   # a dossier holds the transaction candidates; costs already live in receipts and the cost readers
            if c['vehicle_id'] in have and c['event'] != 'cost' and c['source']['kind'] != 'receipt':
                per[c['vehicle_id']].append(c)
        digest = hashlib.sha256(json.dumps([sorted(c['id'] + str(c.get('role')) for c in cands), cur, [f['vehicle_id'] for f in owner_facts]], sort_keys=True, default=str).encode()).hexdigest()
        if digest == cursor.get('digest') and not a.force and not a.dry:
            stats['landed'] = 'skipped: no new records since the last landed run'
        else:
            todo = dict(list(per.items())[: a.max_land]) if a.max_land else per
            stats['landed'] = land(owner, todo, results, a.dry, a.land_sleep)
            stats['deferred_to_next_run'] = len(per) - len(todo)
            if not a.dry and len(todo) == len(per):
                cursor['digest'] = digest
    if a.heartbeat_hours and not a.dry and a.cmd == 'run':
        last = cursor.get('last_heartbeat')
        if a.force or not last or dt.datetime.fromisoformat(last) < dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=a.heartbeat_hours) or stats.get('landed') not in (None, 'skipped: no new records since the last landed run'):
            cursor['last_heartbeat'] = land_heartbeat(owner, stats, a.dry)
            stats['heartbeat'] = cursor['last_heartbeat']
    if a.cursor and not a.dry:
        cursor.update(pdf_cache=pdf_cache, last_run=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'))
        tmp = os.path.expanduser(a.cursor) + '.tmp'
        json.dump(cursor, open(tmp, 'w'))
        os.replace(tmp, os.path.expanduser(a.cursor))
    print(json.dumps(stats, indent=1, default=str))


if __name__ == '__main__':
    main()
