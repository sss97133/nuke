"""Photos album -> vehicle map for the album pass (port of the join-index albums.py, 2026-10-20).

An album is a vehicle album when its title has a model year and a known make, stated or implied by a model word.
Candidates are the owner's live vehicles (not deleted, not merged) with that year, a compatible make and positive
model evidence: an equal GM truck series (chassis + tonnage, from the VIN where it decodes, else from the text) or a
shared model word. A stated attribute that contradicts the album (chassis, tonnage, body, wheelbase, colour family)
excludes a vehicle. map_confidence: 1.0 for one candidate, 0.6 for two or more, 0.0 for none.

Album titles that name a person or an address are redacted before they reach this module (the redaction list is
local: case inputs.album_title_redactions, never in the repo).
"""
import re

MAKES = {
    'chevrolet': 'chevrolet', 'chevy': 'chevrolet', 'chev': 'chevrolet', 'gmc': 'gmc', 'ford': 'ford', 'dodge': 'dodge',
    'jeep': 'jeep', 'porsche': 'porsche', 'mercedes': 'mercedes-benz', 'benz': 'mercedes-benz',
    'mercedes-benz': 'mercedes-benz', 'nissan': 'nissan', 'lexus': 'lexus', 'toyota': 'toyota', 'citroen': 'citroen',
    'jaguar': 'jaguar', 'bmw': 'bmw', 'bentley': 'bentley', 'ferrari': 'ferrari', 'pontiac': 'pontiac',
    'plymouth': 'plymouth', 'dmc': 'delorean', 'delorean': 'delorean', 'harley': 'harley-davidson',
    'harley-davidson': 'harley-davidson', 'vw': 'volkswagen', 'volkswagen': 'volkswagen', 'volkwagon': 'volkswagen',
    'mazda': 'mazda', 'infiniti': 'infiniti', 'austin': 'austin', 'nash': 'nash', 'buick': 'buick',
    'cadillac': 'cadillac', 'oldsmobile': 'oldsmobile', 'lincoln': 'lincoln', 'mercury': 'mercury',
    'chrysler': 'chrysler', 'international': 'international', 'land rover': 'land rover', 'speed': 'speed',
}
MODEL_MAKE = {
    'jimmy': 'gmc', 'blazer': 'chevrolet', 'k5': 'chevrolet', 'bronco': 'ford', 'mustang': 'ford', 'expedition': 'ford',
    'f350': 'ford', 'f250': 'ford', 'thunderbird': 'ford', 'charger': 'dodge', 'gto': 'pontiac', 'firebird': 'pontiac',
    'roadrunner': 'plymouth', 'corvette': 'chevrolet', 'camaro': 'chevrolet', 'impala': 'chevrolet',
    'suburban': 'chevrolet', 'burb': 'chevrolet', '911': 'porsche', '912': 'porsche', 'xke': 'jaguar',
    'maxima': 'nissan', 'lx450': 'lexus', '280sl': 'mercedes-benz', 'shovelhead': 'harley-davidson',
    'karmann': 'volkswagen', 'ghia': 'volkswagen', 'fj40': 'toyota', 'metro': 'nash',
}
COLORS = {'black': 'black', 'blk': 'black', 'white': 'white', 'blue': 'blue', 'navy': 'blue', 'brown': 'brown',
          'tan': 'tan', 'doeskin': 'tan', 'yellow': 'yellow', 'canary': 'yellow', 'red': 'red', 'maroon': 'red',
          'burgundy': 'red', 'green': 'green', 'grey': 'grey', 'gray': 'grey', 'silver': 'grey', 'pewter': 'grey',
          'gold': 'gold', 'orange': 'orange', 'ochre': 'ochre', 'bronze': 'bronze', 'turquoise': 'turquoise'}
BODY_WORDS = {'suburban': 'suburban', 'burb': 'suburban', 'blazer': 'utility', 'jimmy': 'utility', 'k5': 'utility',
              'lwb': 'pickup', 'swb': 'pickup', 'longhorn': 'pickup', 'dually': 'pickup', 'pickup': 'pickup',
              'cpe': 'coupe', 'coupe': 'coupe', 'convertible': 'convertible', 'roadster': 'convertible',
              'spider': 'convertible', 'cabriolet': 'convertible', 'fb': 'fastback', 'fastback': 'fastback',
              'sedan': 'sedan'}
NOISE = {'cab', 'crew', '4sale', 'the', 'and', 'with', 'w', 'owner', 'first', 'name', 'lwb', 'swb', 'cpe', 'fb',
         'pickup', 'truck', 'convertible', 'coupe', 'dually'} | set(COLORS)
SERIES_RX = re.compile(r'(?<![a-z0-9])([ckrv])-?(5|10|15|20|25|30|35|1500|2500|3500)(?![0-9])')
TON = {'5': '1', '10': '1', '15': '1', '1500': '1', '20': '2', '25': '2', '2500': '2', '30': '3', '35': '3', '3500': '3'}
CHASSIS = {'c': 'C', 'r': 'C', 'k': 'K', 'v': 'K'}
VIN_BODY = {'2': 'pickup', '3': 'pickup', '4': 'pickup', '9': 'pickup', '6': 'suburban', '8': 'utility'}


def words(s):
    s = (s or '').lower().replace('shovel head', 'shovelhead').replace('big 10', 'big10').replace('big ten', 'big10')
    out = set(t.strip('.') for t in re.findall(r'[a-z0-9.]+', s) if t.strip('.'))
    joined = re.sub(r'[^a-z0-9]', '', s)
    for m in re.findall(r'(?<![a-z])[a-z]{1,3}-\d+[a-z]*', s):
        out.add(re.sub(r'[^a-z0-9]', '', m))
    for m in re.findall(r'\d+\s?[a-z]{1,2}\b', s):
        out.add(re.sub(r'[^a-z0-9]', '', m))
    for t in list(out):
        m = re.match(r'^(\d{3})[a-z]$', t)
        if m:
            out.add(m.group(1))
    return out, joined


def series_of_text(s):
    s = (s or '').lower().replace('big 10', 'big10').replace('big ten', 'big10')
    res = {(CHASSIS[c], TON[n]) for c, n in SERIES_RX.findall(s)}
    if 'big10' in s:
        res.add(('C', '1'))
    for n in re.findall(r'(?<![a-z0-9])(1500|2500|3500)(?![0-9])', s):
        res.add((None, TON[n]))
    for tn, t in (('1/2 ton', '1'), ('3/4 ton', '2'), ('1 ton', '3')):
        if tn in s:
            res.add((None, t))
    return res


def decode_gm_truck_vin(vin):
    v = re.sub(r'[^A-Z0-9]', '', (vin or '').upper())
    if len(v) == 17 and v[0] in '123' and v[1] == 'G' and v[4] in 'CKRVG':
        return dict(chassis=CHASSIS.get(v[4].lower()), ton=v[5] if v[5] in '123' else None, body=VIN_BODY.get(v[6]))
    if len(v) == 13 and v[0] in 'CT' and v[1] in 'CK':
        return dict(chassis=v[1], ton=v[3] if v[3] in '123' else None, body=VIN_BODY.get(v[4]), year_digit=v[5])
    if len(v) == 12 and v[0] in 'CK' and v[1].isalpha():
        return dict(chassis=v[0], ton=v[2] if v[2] in '123' else None, body=VIN_BODY.get(v[3]), year_digit=v[4])
    if len(v) == 12 and v[0] in 'CK' and v[1].isdigit():
        return dict(chassis=v[0], ton=v[1] if v[1] in '123' else None, body=None, year_digit=v[4])
    return None


def color_fams(s):
    return {COLORS[t] for t in re.findall(r'[a-z]+', (s or '').lower()) if t in COLORS}


def body_of_text(s):
    s = (s or '').lower()
    for k, b in [('crew cab', 'pickup'), ('lwb', 'pickup'), ('swb', 'pickup'), ('long ?bed', 'pickup'),
                 ('short ?bed', 'pickup'), ('longhorn', 'pickup'), ('dually', 'pickup'), ('suburban', 'suburban'),
                 ('blazer', 'utility'), ('jimmy', 'utility'), ('k5', 'utility'), ('fastback', 'fastback'),
                 ('convertible', 'convertible'), ('roadster', 'convertible'), ('spider', 'convertible'),
                 ('coupe', 'coupe'), ('sedan', 'sedan'), ('wagon', 'suburban'), ('pickup', 'pickup'),
                 ('truck', 'pickup'), ('suv', 'suv')]:
        if re.search(r'(?<![a-z])' + k + r'(?![a-z])', s):
            return b
    return None


def wb_of_text(s):
    s = (s or '').lower()
    if re.search(r'\bswb\b|short ?bed', s):
        return 'swb'
    if re.search(r'\blwb\b|long ?bed|longhorn', s):
        return 'lwb'
    return None


def body_compatible(a, b):
    if not a or not b or a == b:
        return True
    pair = {a, b}
    return ('suv' in pair and bool(pair & {'suburban', 'utility'})) or pair == {'coupe', 'fastback'}


def norm_make(m):
    m = (m or '').strip().lower()
    if not m:
        return None
    if m in MAKES:
        return MAKES[m]
    for t in re.findall(r'[a-z\-]+', m):
        if t in MAKES:
            return MAKES[t]
    return m


def describe_vehicle(v):
    """v: {id, year, make, model, trim, series, color, vin, body_style, deleted_at, merged_into_vehicle_id}."""
    make = norm_make(v.get('make'))
    text = ' '.join(x for x in [v.get('model'), v.get('trim'), v.get('series')] if x)
    mt = ' '.join(x for x in [v.get('model'), v.get('trim')] if x)
    w, joined = words(mt)
    gm = decode_gm_truck_vin(v.get('vin')) if make in ('chevrolet', 'gmc', None) else None
    ser = series_of_text(text)
    if gm:
        tons = {gm['ton']} if gm['ton'] else {t for _, t in ser}
        series = {(gm['chassis'], t) for t in tons} if tons else {(gm['chassis'], None)}
        series_src = 'vin' if gm['ton'] else 'vin chassis+text tonnage'
    else:
        series, series_src = ser, 'text' if ser else ''
    return dict(id=v['id'], year=int(v['year']) if v.get('year') else None, make=make, words=w, joined=joined,
                series=series, series_src=series_src,
                body=(gm or {}).get('body') or body_of_text(mt) or body_of_text(v.get('body_style')),
                wb=wb_of_text(mt), colors=color_fams(v.get('color')),
                live=not v.get('deleted_at') and not v.get('merged_into_vehicle_id'),
                merged_into=v.get('merged_into_vehicle_id'))


def parse_album(title):
    t = re.sub(r'\[[^\]]*\]', ' ', title or '').strip()
    low = t.lower().replace('shovel head', 'shovelhead')
    ym = re.search(r'(?<!\d)(19\d{2}|20[0-2]\d)(?!\d)', low)
    w, _ = words(low)
    make = None
    for k, m in MAKES.items():
        if re.search(r'(?<![a-z])' + re.escape(k) + r'(?![a-z])', low):
            make = m
            break
    implied = None
    if not make:
        for k, m in MODEL_MAKE.items():
            if k in w:
                implied = m
                break
    ser = series_of_text(low)
    body = None
    for k, b in BODY_WORDS.items():
        if k in w:
            body = b if body is None or body == b else ('pickup' if 'pickup' in (body, b) else body)
    if 'crew' in w and 'cab' in w:
        body = body or 'pickup'
    wb = 'swb' if 'swb' in w else ('lwb' if ('lwb' in w or 'longhorn' in w) else None)
    make_words = {k for k in MAKES if ' ' not in k} | {'big10'}
    model_words = {x for x in w if x not in NOISE and x not in make_words and not re.fullmatch(r'(19|20)\d{2}', x)
                   and not SERIES_RX.fullmatch(x)}
    return dict(year=int(ym.group(1)) if ym else None, make=make or implied, make_implied=bool(implied and not make),
                series=ser, body=body, wb=wb, colors={COLORS[x] for x in w if x in COLORS}, model_words=model_words)


def series_compatible(a_ser, v_ser):
    if not a_ser or not v_ser:
        return True, False
    for ac, at in a_ser:
        for vc, vt in v_ser:
            if (ac is None or vc is None or ac == vc) and (at is None or vt is None or at == vt):
                return True, (at is not None and vt is not None) or (ac is not None and vc is not None and at == vt)
    return False, False


def evaluate(a, v):
    """-> (is_candidate, evidence or exclusion reason)."""
    if v['year'] != a['year']:
        return False, 'year'
    if v['make'] and v['make'] != a['make']:
        return False, 'make'
    why = []
    ok, pos = series_compatible(a['series'], v['series'])
    if not ok:
        return False, 'series'
    if pos:
        why.append('series_' + v['series_src'])
    if not body_compatible(a['body'], v['body']):
        return False, 'body'
    if a['wb'] and v['wb'] and a['wb'] != v['wb']:
        return False, 'wheelbase'
    if a['colors'] and v['colors'] and not (a['colors'] & v['colors']):
        return False, 'colour'
    shared = {x for x in a['model_words'] if x in v['words'] or (len(x) >= 4 and x in v['joined'])}
    if shared:
        why.append('words:' + '+'.join(sorted(shared)))
    if not a['series'] and not a['model_words']:
        why.append('year_make_only')
    if not why:
        return False, 'no_model_evidence'
    return True, ';'.join(why)


def map_albums(albums, vehicles):
    """albums: [{album_uuid, title}]; vehicles: the owner's vehicle rows -> [{album_uuid, title, candidates,
    map_confidence, match_basis}] for vehicle albums (year and make found)."""
    desc = [describe_vehicle(v) for v in vehicles]
    by_id = {d['id']: d for d in desc}
    out = []
    for al in albums:
        a = parse_album(al['title'])
        if not a['year'] or not a['make']:
            continue
        cands = [d['id'] for d in desc if d['live'] and evaluate(a, d)[0]]
        for d in desc:                       # a merged match whose live survivor is not already a candidate
            s = by_id.get(d['merged_into']) if d['merged_into'] else None
            if s and s['live'] and s['id'] not in cands and evaluate(a, d)[0]:
                cands.append(s['id'])
        out.append(dict(album_uuid=al['album_uuid'], title=al['title'], candidates=cands,
                        map_confidence=1.0 if len(cands) == 1 else (0.6 if cands else 0.0),
                        match_basis='year_make_only' if (not a['series'] and not a['model_words'])
                        else ('series' if a['series'] else 'model_words')))
    return out
