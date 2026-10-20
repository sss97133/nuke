"""Money and document sources, read only through the pinned source list.

Two kinds of access:
  metadata (passes)   line id, date, direction, card date, bank reference tokens: never an amount, never the free
                      text of a line (descriptions carry people's names and phone numbers).
  amounts (loader)    @amount:<source>:<ref> placeholders resolve to cents only at load time in db mode, and only in
                      memory. File mode checks that they resolve and never writes the value.

Sources are declared in the case's amount_sources:
  {"<name>": {"kind": "ledger_csv", "path": "...", "name": "reviewed-ledger"},
   "<name>": {"kind": "pnl_disposition_csv", "path": "..."},
   "<name>": {"kind": "pnl_ledger_csv", "path": "..."},
   "<name>": {"kind": "text_facts", "path": "...", "line_prefix": "...", "facts": {"<fact>": "<regex, one group>"}}}
"""
import csv
import datetime as dt
import io
import re

import common

CARD_DATE_RE = re.compile(r'\b(?:VISA|MC|DEBIT|CARD)\s*-\s*(\d{2})/(\d{2})\b')
REF_RE = re.compile(r';([0-9A-Z]{10,14});')
NUM = r'([0-9][0-9,]*(?:\.[0-9]{1,2})?)'
PLACEHOLDER_RE = re.compile(r'^@amount:([A-Za-z0-9_]+):(.+)$')


def _csv(pinned, path):
    return list(csv.DictReader(io.StringIO(pinned.read_text(path))))


def to_cents(s):
    return int(common.pg_round(float(str(s).replace(',', '').replace('$', '')) * 100))


class Sources:
    def __init__(self, ctx):
        self.ctx = ctx
        self.decl = ctx.case.get('amount_sources') or {}
        self._cache = {}

    def _src(self, name):
        if name not in self.decl:
            raise common.EvidenceError('amount source %r is not declared in the case' % name)
        return self.decl[name]

    def path(self, name):
        return str(self.ctx.path(self._src(name)['path']))

    def sha256(self, name):
        return self.ctx.pinned.sha256(self.path(name))

    def rows(self, name):
        if name not in self._cache:
            src = self._src(name)
            if src['kind'] == 'text_facts':
                self._cache[name] = self._fact_line(src)
            else:
                self._cache[name] = _csv(self.ctx.pinned, self.path(name))
        return self._cache[name]

    def _fact_line(self, src):
        for ln in self.ctx.pinned.read_text(str(self.ctx.path(src['path']))).splitlines():
            if ln.startswith(src['line_prefix']):
                return ln
        raise common.EvidenceError('document line not found for this case')

    # ------------------------------------------------------------------ metadata (no amounts, no free text)
    def ledger_lines(self, name, ids):
        """{line id: {date, direction, card_date, refs}} for the given line ids."""
        src = self._src(name)
        id_f, amt_f, desc_f = src.get('id_field', 'bank_line_id'), src.get('amount_field', 'amount'), \
            src.get('description_field', 'description')
        want, out = set(ids), {}
        for r in self.rows(name):
            lid = r[id_f]
            if lid not in want:
                continue
            date = r[src.get('date_field', 'date')]
            desc = r.get(desc_f) or ''
            card = None
            m = CARD_DATE_RE.search(desc)
            if m:
                y = int(date[:4])
                mm, dd = int(m.group(1)), int(m.group(2))
                if mm == 12 and date[5:7] == '01':
                    y -= 1
                try:
                    card = dt.date(y, mm, dd).isoformat()
                except ValueError:
                    card = None
            out[lid] = {'date': date, 'direction': 'out' if r[amt_f].strip().startswith('-') else 'in',
                        'card_date': card, 'refs': REF_RE.findall(desc)}
        missing = want - set(out)
        if missing:
            raise common.EvidenceError('ledger lines not found: %s' % sorted(missing))
        return out

    def newest_date(self, name):
        """The newest line date of a ledger source: its coverage when the case states none."""
        f = self._src(name).get('date_field', 'date')
        ds = [r[f] for r in self.rows(name) if r.get(f)]
        return max(ds) if ds else None

    def ledger_line_by_ref(self, name, ref):
        """The line id whose bank reference token is ref (a P&L row cites a payment by that token)."""
        src = self._src(name)
        hits = [r[src.get('id_field', 'bank_line_id')] for r in self.rows(name)
                if ref in REF_RE.findall(r.get(src.get('description_field', 'description')) or '')]
        return hits[0] if len(hits) == 1 else None

    def has_facts(self, name, facts):
        src = self._src(name)
        ln = self.rows(name)
        return {f: bool(src['facts'].get(f) and re.search(src['facts'][f], ln)) for f in facts}

    # ------------------------------------------------------------------ amounts (loader, db mode only)
    def cents(self, placeholder):
        m = PLACEHOLDER_RE.match(placeholder or '')
        if not m:
            raise common.EvidenceError('not an amount placeholder')
        name, ref = m.group(1), m.group(2)
        src = self._src(name)
        if src['kind'] == 'ledger_csv':
            for r in self.rows(name):
                if r[src.get('id_field', 'bank_line_id')] == ref:
                    return abs(to_cents(r[src.get('amount_field', 'amount')]))
        elif src['kind'] == 'pnl_disposition_csv':
            hits = [r for r in self.rows(name) if ref in (r.get('evidence') or '')]
            if len(hits) == 1:
                return abs(to_cents(hits[0]['amount']))
        elif src['kind'] == 'pnl_ledger_csv':
            for r in self.rows(name):
                if r.get('id') == ref:
                    return abs(to_cents(r['amount']))
        elif src['kind'] == 'text_facts':
            pat = src['facts'].get(ref)
            mm = re.search(pat, self.rows(name)) if pat else None
            if mm:
                return to_cents(mm.group(1))
        raise common.EvidenceError('amount %s does not resolve' % placeholder)

    def resolves(self, placeholder):
        try:
            self.cents(placeholder)
            return True
        except (common.EvidenceError, KeyError, ValueError):
            return False

    def money_tokens(self, placeholders):
        """Text forms of the amounts behind the given placeholders, for the privacy scan (in memory only)."""
        cents, text = set(), set()
        for p in placeholders:
            try:
                cents.add(self.cents(p))
            except (common.EvidenceError, KeyError, ValueError):
                continue
        for c in cents:
            d, m = divmod(c, 100)
            text.update({'%d.%02d' % (d, m), '{:,}.{:02d}'.format(d, m)})
            if d >= 1000:
                text.add('{:,}'.format(d))
                if m == 0:
                    text.add('%d' % d)
        return cents, text
