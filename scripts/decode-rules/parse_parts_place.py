import re, json, sys
lines = open(sys.argv[1]).read().split('\n')
row = re.compile(r'^(?P<code>[0-9A-Z][0-9A-Z-]{0,3})\s+(?P<car>[A-Za-z][A-Za-z\- ]*?)?\s*(?P<yr>\d{2})\s+(?P<cid>\d{3})\s+(?P<hp>\d{2,3})\s+(?P<trans>Turbo \d{3}|\S+)\s+(?:(?P<rpo>L[SU]?-\d+|L\d+|\d{3}[A-Z]?)\s+)?(?:(?P<vin>[A-Za-z])\s+)?(?P<carb>\dx\d|FI)\s+(?P<cast>\(?\d{3,7}\)?\d*)\s+(?P<main>[24])\b\s*(?P<notes>.*)$')
out, miss = [], []
page_of = []
pg = 1
for l in lines:
    pg += l.count('\f'); page_of.append(pg)
lines = [l.replace('\f','') for l in lines]
for i, l in enumerate(lines):
    s = l.rstrip()
    if not re.match(r'^[0-9A-Z][0-9A-Z-]{0,3}\s+.*\d{2}\s+\d{3}\s', s): continue
    m = row.match(s)
    if not m: miss.append((i+1, s)); continue
    d = m.groupdict()
    car = (d['car'] or '').strip()
    prev = lines[i-1].strip() if i else ''
    nxt = lines[i+1].strip() if i+1 < len(lines) else ''
    pm = re.match(r'^([A-Z])-(?:\s+(.*))?$', prev)
    if re.fullmatch(r'[A-Z]', car) and re.fullmatch(r'\d{2}', d['code']):
        d['code'] = d['code'] + car; car = ''
    extra = []
    if not car and pm:
        car = pm.group(1) + '-body'
        if pm.group(2): extra.append(pm.group(2).strip())
    nm = re.match(r'^body(?:\s+(.*))?$', nxt)
    if nm and nm.group(1): extra.append(nm.group(1).strip())
    d['car'] = car or None
    d['page'] = page_of[i]
    if d.get('vin'): d['vin'] = d['vin'].upper()
    if re.fullmatch(r'[A-Z]-', car or ''): d['car'] = car + 'body'
    d['notes'] = ' '.join([x for x in [extra[0] if extra and pm and pm.group(2) else None, d['notes'].strip() or None] + ([extra[-1]] if nm and nm.group(1) else []) if x]) or None
    out.append(d)
json.dump(out, open(sys.argv[2], 'w'))
print('parsed', len(out), 'missed', len(miss))
for x in miss[:25]: print(x)
