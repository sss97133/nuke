#!/usr/bin/env python3
"""Nightly like-for-like price index for every eligible model family (method hedonic_v1).

The market page's family chart drew a rolling median, and a median of a family moves when the mix of what sold moves,
not when prices move (owner, 2026-10-15; study 2026-10-16, ~/nuke-logs/price-index-20261016). This job fits, per family,
log(price) on period dummies plus what separates one car from another, and writes through record_family_price_index():

  family_price_change  the 12-month change for the same cars (last 365 days against the 365 before, the windows
                       mv_family_market uses) with a 95% range, a verdict, the repeat-sale check, the reference car
                       described and the segment chips;
  family_price_index   the price of one reference car per calendar month or quarter with its 95% range, the sales in the
                       period and their plain median.

Rows: mv_family_sales (every venue, priced 500+, 2016 to today) with the vehicle's mileage, transmission and listing title,
through family_price_index_inputs(); the repeat sales through family_price_index_pairs() (auction_events: mv_family_sales
holds one sale per vehicle). The reference car is the last 12 months' mix.

The rules (each one measured in the study; see the PR):
  hedonic spec   variant (model 33's title words after the year and make, deepest of 1..3 leading words that at least minv
                 sales share, the generation in front; plain cars and rare trims have a bucket each), gearbox (manual / auto /
                 unknown, from the transmission field then the title), log miles (a missing mileage takes its generation's
                 median plus a flag; a slope per generation where a generation has 80+ sales), model year (a thin year joins
                 the nearest richer one), model 33's five title flags, venue (BaT, Mecum, Barrett-Jackson, houses, online,
                 other; a venue under 10 sales joins other)
  floor          30 sales in the last 365 days, 30 in the 365 before, 150 since 2016; a family under it is skipped and logged
  trim           one pass: rows beyond 4 robust sigmas (MAD) of the fit are dropped (price and mileage entry errors)
  verdict        up when the 95% range is above zero, down when below, flat when it holds zero and sits within +-5 points,
                 otherwise too few to tell; read off the rounded numbers the writer checks
  periods        calendar months where the median 95% half-width of the reference car's price over the last 12 complete
                 months is within +-10%, else calendar quarters where the last 8 are, else no series (a previous kind keeps
                 its place 1 point past the line, so a family on the edge does not flap)
  chips          generation (Corvette, Mustang, C10, K5), body by gearbox (F430), else model-year decades, else variants;
                 a chip under 15 sales in either year is too few to tell
  repeat sales   the same car sold twice at the same venue 180+ days apart (ratio within 4x), Bailey-Muth-Nourse with
                 Case-Shiller interval weights, a bootstrap range; shown from 10 pairs with 5 touching the last year

A failure on a family leaves its previous rows in place (the writer replaces only on success). Logged per family: fitted,
skipped and why, seconds; at the end one JSON summary, also saved under ~/nuke-logs/family-price-index/. After the writes it
reads a sample back through the anon reader: success is rows landed, not exit 0.

Run: dotenvx run -q -- python3 scripts/market/family-price-index.py [--dry-run] [--out DIR] [--family 'Brand|family_key' ...]
     [--limit N] [--inputs rpc|sql] [--self-test]
Needs: python3 with numpy and pandas; VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (the service key
only for the inputs reads and the write). --inputs sql reads through scripts/data/q.sh (Management API) with the same predicates
as the functions: for checking a fit before the migration is live.
"""
import argparse, json, math, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request
from collections import Counter
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

WRITER = 'family-price-index'
METHOD = 'hedonic_v1'
FLOOR_YEAR, FLOOR_TOTAL = 30, 150          # sales in each of the two 12-month windows, and since 2016
FLAT_WITHIN = 0.05                          # a range that holds zero is flat inside +-5 points
CHIP_YEAR = 15                              # a chip needs this many sales in each year to carry a verdict
SUPPORT, HYSTERESIS = 0.10, 0.01            # a period kind is supported when the median 95% half-width is within +-10%
TRIM_SIGMA = 4.0
MIN_GAP_DAYS, MAX_RATIO = 180, 4.0          # repeat sales: the same car at the same venue this far apart, at most this ratio
RS_MIN_PAIRS, RS_MIN_LAST = 10, 5
PARTIAL_MIN = 8                             # an unfinished period is written once it has this many sales
QD = 365.0 / 4                              # one quarterly block of age: four of them are the page's 365-day window
NQ = 20                                     # quarterly blocks kept apart in the headline fit; older sales share one dummy a year
NSHOW = {'quarter': 20, 'month': 60}        # periods written: five years
STALE_HOURS = 72
FEATURE_CHUNK = 1000                        # vehicle ids a call (the function takes 2,000)
FEATURE_REFRESH_DAYS = 30                   # a cached vehicle that sold in the last year is read again after this long
FEATURE_BUDGET = 60000                      # vehicle rows read from prod in one run: the first run after a lost cache fills it over a few nights
Z975 = 1.959964

# ------------------------------------------------------------------------------------------------- title words (model 33)
# parse33.py of the finish model: the make is the first word after the model year, the model words are the rest.
SECOND = {'land': 'rover', 'alfa': 'romeo', 'aston': 'martin', 'am': 'general', 'rolls': 'royce', 'de': 'tomaso',
          'range': 'rover', 'mercedes': 'benz', 'austin': 'healey'}
YEAR = re.compile(r'\b(?:19|20)\d{2}\b\s+(.*)$')


def norm(s):
    s = s if isinstance(s, str) else ''
    for a, b in (('&#8217;', "'"), ('’', "'"), ('&#215;', 'x'), ('×', 'x'), ('–', '-'), ('—', '-'), ('&amp;', '&')):
        s = s.replace(a, b)
    return s.lower()


def toks(s):
    return [t for t in re.split(r'[^a-z0-9./\-]+', norm(s)) if t]


def make_key(make):
    t = toks(make)
    return t[0] if t else '?'


def title_parts(title, make=None, model=None):
    m = YEAR.search(norm(title))
    if m and toks(m.group(1)):
        t = toks(m.group(1)); mk = t[0]; rest = t[1:]
    else:
        mk = make_key(make); rest = toks(model)
        if rest and rest[0] == mk: rest = rest[1:]
    if rest and SECOND.get(mk) == rest[0]:
        rest = rest[1:]
    return mk, rest


# ------------------------------------------------------------------------------------------------- features
AUTO = re.compile(r'automat|\bf1\b|sequential|tiptronic|dual[- ]clutch|\bdsg\b|\bpdk\b|powerglide|hydra-?matic|torque-?flite|'
                  r'cruise-?o-?matic|select-?shift|\bcvt\b|paddle|semi-auto|\bsmg\b|\bdct\b|\baod\b|turbo[- ]?hydra|e-?gear|selespeed', re.I)
MAN = re.compile(r'manual|\bstick\b|\bgated\b|toploader|\bt-?5\b|\bt-?10\b|muncie|tremec|borg-?warner|\bzf\b|getrag|overdrive|\bh-?pattern', re.I)


def gearbox(trans, title):
    """manual / auto / unk: the transmission field first ('Six-Speed F1 Automated Manual' is auto), then the title words."""
    t = trans if isinstance(trans, str) else ''
    if t:
        if AUTO.search(t): return 'auto'
        if MAN.search(t): return 'manual'
    s = title if isinstance(title, str) else ''
    if s:
        if re.search(r'automat|\bf1\b|\bdct\b|\bpdk\b|dual-clutch|tiptronic', s, re.I): return 'auto'
        if re.search(r'\bmanual\b|\b[3-7]-speed\b|\bstick\b', s, re.I): return 'manual'
    return 'unk'


def conv_flag(trans, title):
    s = ' '.join(x for x in (trans, title) if isinstance(x, str))
    return int(bool(re.search(r'conversion|swap', s, re.I)))


FLAG_PATS = {'f_swap': r'-powered\b', 'f_mod': r'\b(restomod|modified|custom|lifted|widebody)\b', 'f_project': r'\b(project|non-running|parts)\b',
             'f_forced': r'\b(supercharged|turbocharged|twin-turbo)\b', 'f_owned': r'\b(one-owner|original-owner|\d+-years?-owned|family-owned)\b'}
STRUCT = {'and', 'the', 'w/', 'with', 'project', 'manual', 'automatic', 'auto', 'f1', 'conversion', 'sequential', '4x4', '4x2',
          '2-door', '4-door', 'stick', 'dct', 'dsg', 'pdk', 'tiptronic', 'no-reserve', 'two-owner', 'one-owner'}
SYN = {'spyder': 'spider', '430': 'f430', 'berlinetta': 'coupe'}


def model_tokens(title, make, model):
    """Model words after the make with gearbox and structure words taken out (the gearbox has its own control)."""
    _, rest = title_parts(title, make, model)
    out = []
    for t in rest:
        t = SYN.get(t, t)
        if re.fullmatch(r'\d{1,2}-speed|\d-spd', t) or t in STRUCT: continue
        out.append(t)
    return out


def pick_variants(tok_lists, gens, minv, maxk=3):
    """Variant key per sale: the generation, then the deepest run (1..maxk) of leading model words that at least minv sales of the
    family share (model 33's backoff). A plain car (no words left) is the generation's base; a sale whose words are all too rare is
    its '+' bucket; one that backed off from deeper words is that key with a '+', so a rare trim never moves the common one."""
    counts = [Counter() for _ in range(maxk + 1)]
    for g, tk in zip(gens, tok_lists):
        for k in range(1, min(maxk, len(tk)) + 1):
            counts[k][(g, ' '.join(tk[:k]))] += 1
    out = []
    for g, tk in zip(gens, tok_lists):
        if not tk:
            out.append(f'{g}|base'); continue
        pick = None
        for k in range(min(maxk, len(tk)), 0, -1):
            if counts[k][(g, ' '.join(tk[:k]))] >= minv:
                pick = k; break
        if pick is None:
            out.append(f'{g}|+'); continue
        out.append(f'{g}|{" ".join(tk[:pick])}' + (' +' if len(tk) > pick and pick < maxk else ''))
    return out


def pool_years(years, miny):
    """Model-year level: a year with at least miny sales is its own; a thinner one joins the nearest richer year."""
    ys = pd.Series(years)
    c = ys.value_counts()
    rich = sorted(int(y) for y, n in c.items() if n >= miny)
    if not rich: return np.zeros(len(ys), dtype=int)
    return ys.map(lambda y: min(rich, key=lambda r: (abs(r - y), r))).values.astype(int)


# generation bands: (first year, last year, key, label). The family key does not split generations (canonical_models holds whole-model
# year ranges), so the five families the study measured carry their own; every other family gets model-year decades.
BANDS = {
    ('Ford', '8a8271f8-d299-4b55-837a-35ca919f8937'): [
        (1964, 1966, 'g1-64-66', '1964½–66'), (1967, 1968, 'g1-67-68', '1967–68'), (1969, 1973, 'g1-69-73', '1969–73'),
        (1974, 1978, 'mustang-ii', 'Mustang II 1974–78'), (1979, 1993, 'fox', 'Fox 1979–93'), (1994, 2004, 'sn95', 'SN95 1994–2004'),
        (2005, 2014, 's197', 'S197 2005–14'), (2015, 2023, 's550', 'S550 2015–23'), (2024, 2030, 's650', 'S650 2024+')],
    ('Chevrolet', '3f3e7278-f47c-412f-b6fc-0ab5d8485924'): [
        (1953, 1962, 'c1', 'C1 1953–62'), (1963, 1967, 'c2', 'C2 1963–67'), (1968, 1982, 'c3', 'C3 1968–82'), (1983, 1996, 'c4', 'C4 1984–96'),
        (1997, 2004, 'c5', 'C5 1997–2004'), (2005, 2013, 'c6', 'C6 2005–13'), (2014, 2019, 'c7', 'C7 2014–19'), (2020, 2030, 'c8', 'C8 2020+')],
    ('Chevrolet', '022cef91-1b4b-406d-9f39-d08072175cbd'): [
        (1960, 1966, 'ck-60-66', '1960–66'), (1967, 1972, 'ck-67-72', '1967–72'), (1973, 1991, 'ck-73-91', '1973–91')],
    ('Chevrolet', '2fb29b44-c07a-4802-b3eb-3e093ada1f27'): [
        (1969, 1972, 'k5-69-72', '1969–72'), (1973, 1991, 'k5-73-91', '1973–91')],
}
F430_KEY = ('Ferrari', 'ec22b618-7511-4cc5-ab1a-684c210f7b1c')
VENUE_OF = {'Bring a Trailer': 'bat', 'Mecum': 'mecum', 'Barrett-Jackson': 'bj', "RM Sotheby's": 'house', 'Gooding & Co': 'house',
            'Bonhams': 'house', 'Broad Arrow': 'house', 'Cars & Bids': 'online', 'PCarMarket': 'online', 'Collecting Cars': 'online',
            'SBX Cars': 'online', 'Classic.com': 'online'}      # the page's venue groups (FamilySalesChart.tsx)


def gen_of(year, bands):
    if bands:
        for lo, hi, key, label in bands:
            if lo <= year <= hi: return key, label
        return 'other-years', 'other years'
    dec = int(year // 10) * 10
    return f'{dec}s', f'{dec}s'


def tcrit(dof):
    """Student t, 97.5th percentile, Cornish-Fisher in the degrees of freedom (error under 0.1% from 10)."""
    z = Z975; v = float(max(dof, 3))
    return z + (z ** 3 + z) / (4 * v) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * v ** 2) + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * v ** 3)


# ------------------------------------------------------------------------------------------------- the frame
SALE_COLS = ['vehicle_id', 'model', 'year', 'source', 'usd', 'sale_date']          # family_price_index_inputs: the matview alone
COLS = SALE_COLS + ['mileage', 'transmission', 'title']                            # what the fit takes: the sale and its vehicle's fields


def build_frame(columns, rows, brand, key, today):
    """Sale frame with every feature: age in days (today = 0), venue, gearbox, flags, miles, generation, variant, year level."""
    d = pd.DataFrame(rows, columns=columns)
    n_in = len(d)
    d['usd'] = pd.to_numeric(d.usd, errors='coerce').astype(float)
    d['year'] = pd.to_numeric(d.year, errors='coerce')
    d['sale_day'] = pd.to_datetime(d.sale_date, errors='coerce')
    d = d[(d.usd >= 500) & d.sale_day.notna() & d.year.between(1886, 2100)].copy()
    d['age'] = (pd.Timestamp(today) - d.sale_day).dt.days.astype(int)
    d = d[d.age >= 0].copy()
    d['year'] = d.year.astype(int)
    d['title'] = [t if isinstance(t, str) and t.strip() else f'{y} {brand} {m or ""}' for t, y, m in zip(d.title, d.year, d.model)]
    d['venue'] = d.source.map(lambda s: VENUE_OF.get(s, 'other')) if len(d) else d.source
    vc = d.venue.value_counts()
    thin = set(vc[vc < 10].index) - {'bat'}
    d['venue'] = d.venue.map(lambda v: 'other' if v in thin else v)
    d['gear'] = [gearbox(t, ti) for t, ti in zip(d.transmission, d.title)]
    d['conv'] = [conv_flag(t, ti) for t, ti in zip(d.transmission, d.title)]
    for k, p in FLAG_PATS.items():
        d[k] = [int(bool(re.search(p, t, re.I))) for t in d.title]
    m = pd.to_numeric(d.mileage, errors='coerce')
    d['miles'] = m.where((m >= 0) & (m <= 600000))
    d['mi_missing'] = d.miles.isna().astype(int)
    d['logmi'] = np.log1p(d.miles)
    bands = BANDS.get((brand, key))
    gl = [gen_of(y, bands) for y in d.year]
    d['gen'] = [g[0] for g in gl]; d['gen_label'] = [g[1] for g in gl]
    tk = [model_tokens(t, brand, md) for t, md in zip(d.title, d.model)]
    # the family word is the first model word of nearly every sale: it is dropped (it never discriminates) unless the words differ
    first = Counter(t[0] for t in tk if t)
    if first and first.most_common(1)[0][1] >= 0.8 * len(tk):
        fw = first.most_common(1)[0][0]
        tk = [t[1:] if t and t[0] == fw else t for t in tk]
    if (brand, key) == F430_KEY:
        tk = [[w for w in t if w != 'coupe'] for t in tk]        # the coupe is the default body (berlinetta, coupe, plain)
    d['tokens'] = tk
    n = len(d)
    minv = 5 if n < 400 else 15
    d['variant'] = pick_variants(tk, d.gen.tolist(), minv)
    d['yearlvl'] = pool_years(d.year.values, 20 if n < 1000 else 10) if n else []
    d['lp'] = np.log(d.usd)
    return d.reset_index(drop=True), n_in


# ------------------------------------------------------------------------------------------------- design and OLS
def dummy_block(values, prefix, ref=None):
    s = pd.Series(values).astype(str).reset_index(drop=True)
    vc = s.value_counts()
    ref = ref if ref in vc.index else vc.index[0]
    names, cols = [], []
    for lvl in vc.index:
        if lvl == ref: continue
        names.append(f'{prefix}={lvl}'); cols.append((s.values == lvl).astype(float))
    return (np.column_stack(cols) if cols else np.zeros((len(s), 0))), names


def controls(d, spec, mi_by_gen):
    """Control columns: variant, gearbox (+ conversion flag), log miles (a slope per generation with 80+ sales), model year, flags, venue."""
    blocks, names = [], []

    def add(m, nm):
        if m.shape[1]:
            blocks.append(m); names.extend(nm)
    n = len(d)
    if 'variant' in spec: add(*dummy_block(d.variant.values, 'var'))
    if 'gear' in spec:
        add(*dummy_block(d.gear.values, 'gear', ref='auto'))
        if d.conv.sum() >= 5: add(d.conv.values.astype(float)[:, None], ['conv'])
    if 'miles' in spec:
        lm = d.logmi.copy()
        lm = lm.fillna(d.groupby('gen').logmi.transform('median')).fillna(d.logmi.median()).fillna(0.0)
        lmc = (lm - lm.mean()).values
        big = [g for g, c in d.gen.value_counts().items() if c >= 80]
        if mi_by_gen and len(big) >= 2:
            for g in big:
                add(np.where(d.gen.values == g, lmc, 0.0)[:, None], [f'mi:{g}'])
            rest = ~d.gen.isin(big).values
            if rest.sum() >= 30: add(np.where(rest, lmc, 0.0)[:, None], ['mi:rest'])
        else:
            add(lmc[:, None], ['logmi'])
        if 3 <= d.mi_missing.sum() <= n - 3: add(d.mi_missing.values.astype(float)[:, None], ['mi_missing'])
    if 'flags' in spec:
        for k in FLAG_PATS:
            if 3 <= d[k].sum() <= n - 3: add(d[k].values.astype(float)[:, None], [k])
    if 'year' in spec and len(set(d.yearlvl)) > 1: add(*dummy_block(d.yearlvl.values, 'yr'))
    if 'venue' in spec and d.venue.nunique() > 1: add(*dummy_block(d.venue.values, 'venue', ref='bat'))
    return (np.hstack(blocks) if blocks else np.zeros((n, 0))), names


def ols(X, y):
    """Classical OLS by pseudo-inverse: beta, covariance sigma^2 (X'X)^+, residuals, degrees of freedom."""
    XtX = X.T @ X
    XtXi = np.linalg.pinv(XtX, hermitian=True)
    beta = XtXi @ (X.T @ y)
    e = y - X @ beta
    rank = int(np.linalg.matrix_rank(XtX, hermitian=True))
    dof = max(len(y) - rank, 1)
    return beta, (float(e @ e) / dof) * XtXi, e, dof


def window_time(age, groups=None, min_each=5):
    """Time columns of the headline fit: one dummy for the last 365 days (the prior 365 is the baseline), and a dummy for each older
    quarterly block (a year each past 20). With groups, the last-year dummy is split by group (groups under min_each in either year are not
    estimated; their last-year sales take a dummy of their own so they do not move the rest)."""
    b = np.floor(age / QD).astype(int)
    last = b < 4
    prior = (b >= 4) & (b < 8)
    older = np.where(b < 8, -1, np.where(b < NQ, b, NQ + (b - NQ) // 4))
    cols, names, est = [], [], []
    if groups is None:
        cols.append(last.astype(float)); names.append('W_last')
    else:
        g = np.asarray(groups).astype(str)
        for lab in sorted(set(g)):
            nl = int(((g == lab) & last).sum()); npr = int(((g == lab) & prior).sum())
            if nl >= min_each and npr >= min_each:
                cols.append(((g == lab) & last).astype(float)); names.append(f'W={lab}'); est.append(lab)
        thin_last = last & ~np.isin(g, est)
        if thin_last.any():
            cols.append(thin_last.astype(float)); names.append('W=thin')
    for lv in sorted(set(older) - {-1}):
        cols.append((older == lv).astype(float)); names.append(f'old={lv}')
    return np.column_stack(cols), names, est, last, prior


def fit_window(F, groups=None, min_each=5):
    """The 12-month change: coefficient on the last-365-day dummy (or one per group) with the controls, one constant."""
    d = F['d']
    T, tn, est, last, prior = window_time(d.age.values, groups, min_each)
    X = np.hstack([np.ones((len(d), 1)), T, F['C']])
    beta, V, e, dof = ols(X, F['y'])
    out = dict(beta=beta, V=V, e=e, dof=dof, names=['const'] + tn + F['cnames'], est=est, last=last, prior=prior, sigma=math.sqrt(float(e @ e) / dof))
    return out


def change_of(est, se, dof):
    t = tcrit(dof)
    return dict(est=est, se=se, change=math.expm1(est), lo=math.expm1(est - t * se), hi=math.expm1(est + t * se))


def trim_rows(F):
    """One pass: the quarterly-block fit; sales beyond TRIM_SIGMA robust sigmas (MAD) of its residuals are dropped."""
    d = F['d']
    b = np.floor(d.age.values / QD).astype(int)
    blk = np.where(b < NQ, b, NQ + (b - NQ) // 4)
    T = np.column_stack([(blk == lv).astype(float) for lv in sorted(set(blk))])
    _, _, e, _ = ols(np.hstack([T, F['C']]), F['y'])
    med = float(np.median(e)); mad = 1.4826 * float(np.median(np.abs(e - med)))
    return np.abs(e - med) <= TRIM_SIGMA * max(mad, 1e-9), mad


def subset(F, keep):
    d = F['d'][keep].reset_index(drop=True)
    return dict(d=d, C=F['C'][keep], cnames=F['cnames'], y=F['y'][keep])


# ------------------------------------------------------------------------------------------------- the series (calendar periods)
def period_of(ts, kind):
    return ts.year * 4 + (ts.month - 1) // 3 if kind == 'quarter' else ts.year * 12 + ts.month - 1


def period_start(pid, kind):
    if kind == 'quarter': return date(pid // 4, (pid % 4) * 3 + 1, 1)
    return date(pid // 12, pid % 12 + 1, 1)


def series_fit(F, raw, today, kind):
    """Level of the reference car per calendar period: log price on period dummies (the last 5 years apart, older sales one dummy a
    calendar year) with the controls, no constant. Level = period effect + the controls at the last 12 months' mean. 95% range from the
    covariance of that combination. Returns rows oldest first with their relative half-width, and the complete-period ones for support."""
    d = F['d']
    pid = np.array([period_of(t, kind) for t in d.sale_day])
    cur = period_of(pd.Timestamp(today), kind)
    first = cur - NSHOW[kind] + 1
    shown = pid >= first
    cols, names, meta = [], [], []
    for p in sorted(set(pid[shown])):
        cols.append((pid == p).astype(float)); names.append(f'p={p}'); meta.append(p)
    yr = d.sale_day.dt.year.values
    for y in sorted(set(yr[~shown])):
        cols.append(((yr == y) & ~shown).astype(float)); names.append(f'old={y}')
    T = np.column_stack(cols)
    X = np.hstack([T, F['C']])
    beta, V, e, dof = ols(X, F['y'])
    nT = T.shape[1]
    xbar = F['C'][d.age.values < 365].mean(axis=0) if F['C'].shape[1] else np.zeros(0)
    t = tcrit(dof)
    raw_pid = np.array([period_of(x, kind) for x in raw.sale_day])
    rows = []
    for j, p in enumerate(meta):
        c = np.zeros(X.shape[1]); c[j] = 1.0; c[nT:] = xbar
        lvl = float(c @ beta); se = math.sqrt(max(float(c @ V @ c), 0.0))
        n = int((pid == p).sum())
        rm = raw.usd.values[raw_pid == p]
        rows.append(dict(pid=p, period_start=period_start(p, kind), n=n, level=math.exp(lvl), lo=math.exp(lvl - t * se), hi=math.exp(lvl + t * se),
                         hw=math.expm1(t * se), raw_median=float(np.median(rm)) if len(rm) else None, partial=bool(p >= cur)))
    return rows, cur, dof


def supported(rows, kind, cur, prior_kind):
    done = [r for r in rows if r['pid'] < cur][-(12 if kind == 'month' else 8):]
    need = 8 if kind == 'month' else 6
    if len(done) < need: return False, None
    med = float(np.median([r['hw'] for r in done]))
    return med <= SUPPORT + (HYSTERESIS if prior_kind == kind else 0.0), med


# ------------------------------------------------------------------------------------------------- chips
BODY = {'f430': None}


def f430_body(tokens):
    tk = set(tokens)
    if tk & {'challenge', 'race', 'gtc', 'gt3'}: return None
    if 'scuderia' in tk and 'spider' in tk: return ('scuderia-spider', '16M Spider')
    if 'scuderia' in tk: return ('scuderia', 'Scuderia')
    if 'spider' in tk: return ('spider', 'Spider')
    return ('coupe', 'Coupe')


def chip_scheme(d, brand, key):
    """(kind, group keys per sale, label per group key) or None."""
    if (brand, key) == F430_KEY:
        keys, labels = [], {}
        for tk, g in zip(d.tokens, d.gear):
            b = f430_body(tk)
            if b is None or g == 'unk':
                keys.append(None); continue
            gl = 'F1' if g == 'auto' else 'manual'
            k = f'{b[0]}|{g}'; keys.append(k); labels[k] = f'{b[1]} · {gl}'
        return 'body_gearbox', keys, labels
    if (brand, key) in BANDS:
        return 'generation', d.gen.tolist(), dict(zip(d.gen, d.gen_label))
    last = d.age.values < 365; prior = (d.age.values >= 365) & (d.age.values < 730)
    dec = d.gen.values
    ok = [g for g in sorted(set(dec)) if int((dec == g).sum()) and int(((dec == g) & (last | prior)).sum()) >= 10]
    if len(ok) >= 2: return 'decade', dec.tolist(), {g: g for g in set(dec)}
    var = d.variant.values
    okv = [g for g in sorted(set(var)) if int(((var == g) & (last | prior)).sum()) >= 10]
    if len(okv) >= 2:
        gl = dict(zip(d.gen, d.gen_label)); multi = d.gen.nunique() > 1
        return 'variant', var.tolist(), {g: variant_label(g, gl, multi, 'Base') for g in set(var)}
    return None


def verdict_of(lo, hi):
    if lo is None or hi is None: return 'too few to tell'
    if lo > 0: return 'up'
    if hi < 0: return 'down'
    return 'flat' if (hi - lo) / 2 <= FLAT_WITHIN else 'too few to tell'


def r4(x):
    return None if x is None or not np.isfinite(x) else round(float(x), 4)


def chips_of(Fs, brand, key):
    sch = chip_scheme(Fs['d'], brand, key)
    if sch is None: return []
    kind, gk, labels = sch
    d = Fs['d']
    g = np.array(['' if k is None else k for k in gk])
    use = g != ''
    est = {}
    if use.sum() >= 40:
        sub = subset(Fs, use)
        W = fit_window(sub, groups=g[use])
        for lab in W['est']:
            j = W['names'].index(f'W={lab}')
            est[lab] = change_of(float(W['beta'][j]), math.sqrt(max(float(W['V'][j, j]), 0.0)), W['dof'])
    last = d.age.values < 365; prior = (d.age.values >= 365) & (d.age.values < 730)
    chips = []
    for lab in sorted(set(g) - {''}):
        nl = int(((g == lab) & last).sum()); npr = int(((g == lab) & prior).sum())
        if nl + npr < 10: continue
        c = est.get(lab)
        ch, lo, hi = (r4(c['change']), r4(c['lo']), r4(c['hi'])) if c else (None, None, None)
        v = 'too few to tell' if (c is None or nl < CHIP_YEAR or npr < CHIP_YEAR) else verdict_of(lo, hi)
        chips.append(dict(kind=kind, key=lab, label=labels.get(lab, lab), change=ch, lo=lo, hi=hi, n_last12=nl, n_prior12=npr, verdict=v))
    chips.sort(key=lambda c: (-c['n_last12'], c['key']))
    return chips[:12]


# ------------------------------------------------------------------------------------------------- repeat sales
def build_pairs(rows, columns):
    """Consecutive sold events of one car at one venue, 180+ days apart, ratio within 4x. rows: [vehicle_id, sale_date, usd, source]."""
    P = pd.DataFrame(rows, columns=columns)
    if P.empty: return []
    P['sale_date'] = pd.to_datetime(P.sale_date); P['usd'] = P.usd.astype(float)
    P = P.drop_duplicates(['vehicle_id', 'sale_date', 'usd', 'source']).sort_values(['vehicle_id', 'sale_date'])
    out = []
    for _, g in P.groupby('vehicle_id', sort=False):
        r = g.to_dict('records')
        for a, b in zip(r[:-1], r[1:]):
            gap = (b['sale_date'] - a['sale_date']).days
            y = math.log(b['usd'] / a['usd'])
            if a['source'] == b['source'] and gap >= MIN_GAP_DAYS and abs(y) <= math.log(MAX_RATIO):
                out.append((a['sale_date'], b['sale_date'], y, gap))
    return out


def rs_fit(pairs, today, boot=0, seed=3):
    """Bailey-Muth-Nourse on the last 365 days against the 365 before (older blocks nuisance), Case-Shiller weights. pairs: (date1, date2, y, gap)."""
    if len(pairs) < 4: return None
    t = pd.Timestamp(today)
    a1 = np.array([(t - p[0]).days for p in pairs]); a2 = np.array([(t - p[1]).days for p in pairs])
    y = np.array([p[2] for p in pairs]); gap = np.array([p[3] for p in pairs], float) / 365.25

    def grp(a):
        b = np.floor(a / QD).astype(int)
        return np.where(b < 4, 0, np.where(b < 8, -1, np.where(b < NQ, b, NQ + (b - NQ) // 4)))

    def one(a1, a2, y, gap):
        g1, g2 = grp(a1), grp(a2)
        levels = sorted((set(g1) | set(g2)) - {-1})
        if 0 not in levels: return None
        ix = {b: i for i, b in enumerate(levels)}
        X = np.zeros((len(y), len(levels)))
        for r, (u, w) in enumerate(zip(g1, g2)):
            if w != -1: X[r, ix[w]] += 1
            if u != -1: X[r, ix[u]] -= 1
        beta = np.linalg.pinv(X.T @ X, hermitian=True) @ (X.T @ y)
        e2 = (y - X @ beta) ** 2
        Z = np.column_stack([np.ones(len(y)), gap])
        gam = np.linalg.pinv(Z.T @ Z, hermitian=True) @ (Z.T @ e2)
        w = 1.0 / np.sqrt(np.maximum(Z @ gam, 1e-4))
        Xw = X * w[:, None]; yw = y * w
        XtXi = np.linalg.pinv(Xw.T @ Xw, hermitian=True)
        b2 = XtXi @ (Xw.T @ yw)
        res = yw - Xw @ b2
        dof = max(len(y) - int(np.linalg.matrix_rank(Xw.T @ Xw, hermitian=True)), 1)
        j = ix[0]
        return float(b2[j]), math.sqrt(max(float(res @ res) / dof * XtXi[j, j], 0.0)), dof, int(((g1 == 0) | (g2 == 0)).sum())
    r = one(a1, a2, y, gap)
    if r is None: return None
    est, se, dof, n_last = r
    out = dict(est=est, se=se, n_pairs=len(pairs), n_last=n_last, change=math.expm1(est))
    if boot:
        rng = np.random.default_rng(seed); ests = []
        for _ in range(boot):
            ix = rng.integers(0, len(y), len(y))
            rr = one(a1[ix], a2[ix], y[ix], gap[ix])
            if rr is not None: ests.append(rr[0])
        if len(ests) >= 20:
            out['lo'] = math.expm1(float(np.percentile(ests, 2.5))); out['hi'] = math.expm1(float(np.percentile(ests, 97.5)))
    return out


# ------------------------------------------------------------------------------------------------- one family
class Skip(Exception):
    pass


class BudgetSkip(Skip):
    pass


def variant_label(v, gen_labels, multi_gen, base_word):
    gen, words = v.split('|', 1)
    w = words.replace(' +', '').strip()
    if w == 'base': text = base_word
    elif w in ('+', ''): text = 'other trims'
    else: text = ' '.join(x.capitalize() if not any(ch.isdigit() for ch in x) else x.upper() for x in w.split())
    return f'{gen_labels.get(gen, gen)} · {text}' if multi_gen else text


def ref_car_of(d, spec_text, sigma, params, trimmed, mad, base_word='Base'):
    """The reference car described: the last 12 months' mix (sales, median year and miles, manual share, venues, top variants) and the fit."""
    last = d[d.age < 365]
    gen_labels = dict(zip(d.gen, d.gen_label))
    multi = d.gen.nunique() > 1
    share = Counter()
    for v, c in last.variant.value_counts(normalize=True).items():
        share[variant_label(v, gen_labels, multi, base_word)] += float(c)
    return dict(basis='sales in the last 12 months', n=int(len(last)),
                year_median=int(last.year.median()) if len(last) else None,
                miles_median=int(last.miles.median()) if last.miles.notna().any() else None,
                manual_share=r4((last.gear == 'manual').mean()) if len(last) else None,
                venues={k: r4(v) for k, v in last.venue.value_counts(normalize=True).items()},
                top=[dict(label=k, share=r4(v)) for k, v in share.most_common(6)], spec=spec_text,
                fit=dict(sigma=r4(sigma), params=int(params), dropped=int(trimmed), robust_sigma=r4(mad)))


def fit_family(columns, rows, brand, key, today, prior_kind=None, pair_rows=None, pair_columns=None, seed=7):
    """Rows in, payload out (or Skip with the reason). Pure: no I/O."""
    t0 = time.time()
    d0, n_in = build_frame(columns, rows, brand, key, today)
    n_last = int((d0.age < 365).sum()); n_prior = int(((d0.age >= 365) & (d0.age < 730)).sum())
    if n_last < FLOOR_YEAR or n_prior < FLOOR_YEAR or len(d0) < FLOOR_TOTAL:
        raise Skip(f'below the floor after cleaning: last 12 months {n_last}, prior 12 months {n_prior}, total {len(d0)}')
    spec = ('variant', 'gear', 'miles', 'year', 'flags', 'venue')
    gens_big = [g for g, c in d0.gen.value_counts().items() if c >= 80]
    mi_by_gen = len(gens_big) >= 2
    # the number of parameters must stay a small share of the sales: coarsen the variant depth, then drop model years
    d = d0
    for attempt in range(3):
        C, cn = controls(d, spec, mi_by_gen)
        if C.shape[1] <= len(d) / 4: break
        if attempt == 0:
            d = d.copy(); d['variant'] = pick_variants(d.tokens.tolist(), d.gen.tolist(), max(15, int(len(d) / 40)))
        elif attempt == 1:
            spec = tuple(s for s in spec if s != 'year')
    if C.shape[1] > len(d) / 3:
        raise Skip(f'{C.shape[1]} controls for {len(d)} sales: too many to fit')
    F0 = dict(d=d, C=C, cnames=cn, y=d.lp.values)
    keep, mad = trim_rows(F0)
    F = subset(F0, keep)
    d = F['d']
    dropped = int((~keep).sum())
    n_last_f = int((d.age < 365).sum()); n_prior_f = int(((d.age >= 365) & (d.age < 730)).sum())
    W = fit_window(F)
    j = W['names'].index('W_last')
    ch = change_of(float(W['beta'][j]), math.sqrt(max(float(W['V'][j, j]), 0.0)), W['dof'])
    change, lo, hi = r4(ch['change']), r4(ch['lo']), r4(ch['hi'])
    verdict = verdict_of(lo, hi)
    chips = chips_of(F, brand, key)
    # the series: month where the 95% range holds within +-10%, else quarter, else none
    raw = d0[['sale_day', 'usd']]
    series, kind = [], None
    q_rows, cur_q, _ = series_fit(F, raw, today, 'quarter')
    ok_q, med_q = supported(q_rows, 'quarter', cur_q, prior_kind)
    m_rows = None; med_m = None
    if len(d) >= 200 or (med_q is not None and med_q <= 0.07):
        m_rows, cur_m, _ = series_fit(F, raw, today, 'month')
        ok_m, med_m = supported(m_rows, 'month', cur_m, prior_kind)
        if ok_m: kind, srows = 'month', m_rows
    if kind is None and ok_q: kind, srows = 'quarter', q_rows
    if kind:
        for r in srows:
            if r['partial'] and r['n'] < PARTIAL_MIN: continue
            lo_u, mid_u, hi_u = int(round(r['lo'])), int(round(r['level'])), int(round(r['hi']))
            if lo_u < 1: lo_u = 1
            series.append(dict(period_start=r['period_start'].isoformat(), index_usd=max(mid_u, lo_u), lo_usd=lo_u, hi_usd=max(hi_u, mid_u, lo_u), n=r['n'],
                               raw_median_usd=int(round(r['raw_median'])) if r['raw_median'] else None))
    # repeat sales: the check, never the headline
    pairs_n = rs_change = rs_lo = rs_hi = None
    if pair_rows is not None:
        pl = build_pairs(pair_rows, pair_columns)
        pairs_n = len(pl)
        rs = rs_fit(pl, today, boot=300, seed=seed) if len(pl) >= RS_MIN_PAIRS else None
        if rs and rs['n_last'] >= RS_MIN_LAST and rs.get('lo') is not None:
            rs_change, rs_lo, rs_hi = r4(rs['change']), r4(min(rs['lo'], rs['change'])), r4(max(rs['hi'], rs['change']))
    spec_text = ('variant, gearbox, log miles, model year, title flags and venue; log price on ' + (f'calendar {kind}' if kind else 'quarterly') +
                 f' dummies; sales beyond {TRIM_SIGMA:g} robust sigmas dropped')
    ref = ref_car_of(d, spec_text, W['sigma'], len(W['names']), dropped, mad, base_word='Coupe' if (brand, key) == F430_KEY else 'Base')
    change_obj = dict(change_12m=change, lo=lo, hi=hi, n_last12=n_last_f, n_prior12=n_prior_f, verdict=verdict, method=METHOD, ref_car=ref,
                      pairs=pairs_n, rs_change=rs_change, rs_lo=rs_lo, rs_hi=rs_hi, chips=chips)
    payload = dict(brand=brand, family_key=key, change=change_obj, period_kind=kind, series=series)
    info = dict(n=len(d0), n_last12=n_last_f, n_prior12=n_prior_f, dropped=dropped, verdict=verdict, change=change, lo=lo, hi=hi, kind=kind, periods=len(series),
                chips=len(chips), pairs=pairs_n, rs_change=rs_change, sigma=r4(W['sigma']), params=len(W['names']), support_q=r4(med_q), support_m=r4(med_m), seconds=round(time.time() - t0, 2))
    return payload, info


VERDICTS = ('up', 'down', 'flat', 'too few to tell')


def check_payload(p):
    """The writer's refusals, mirrored (record_family_price_index): a payload this lets through the writer accepts, and one it stops never
    reaches the database, so a bad night leaves a clear line in the log instead of a refused call."""
    bad = []
    c = p.get('change') or {}
    lo, mid, hi = c.get('lo'), c.get('change_12m'), c.get('hi')
    if (lo is None) != (mid is None) or (hi is None) != (mid is None): bad.append('change_12m, lo and hi must be all numbers or all null')
    if mid is not None:
        if not lo <= mid <= hi: bad.append('the range does not hold the estimate')
        v = c.get('verdict')
        if v == 'up' and not lo > 0: bad.append('verdict up with a range that holds zero')
        if v == 'down' and not hi < 0: bad.append('verdict down with a range that holds zero')
        if v == 'flat' and not (lo <= 0 <= hi and (hi - lo) / 2 <= FLAT_WITHIN): bad.append('verdict flat outside +-5 points or off zero')
        if v == 'too few to tell' and ((lo > 0 or hi < 0) or (hi - lo) / 2 <= FLAT_WITHIN): bad.append('verdict too few to tell with a readable range')
    elif c.get('verdict') != 'too few to tell': bad.append('a verdict other than too few to tell needs an estimate')
    if c.get('verdict') not in VERDICTS: bad.append('unknown verdict')
    if c.get('rs_change') is not None and not (c['rs_lo'] <= c['rs_change'] <= c['rs_hi']): bad.append('the repeat-sale range does not hold its estimate')
    for k in c.get('chips') or []:
        if k['verdict'] not in VERDICTS or (k['change'] is None) != (k['lo'] is None) or (k['change'] is not None and not k['lo'] <= k['change'] <= k['hi']):
            bad.append(f"chip {k.get('key')}")
    if len(c.get('chips') or []) > 30: bad.append('more than 30 chips')
    ser = p.get('series') or []
    if ser:
        kind = p.get('period_kind')
        if kind not in ('month', 'quarter'): bad.append('a series needs period_kind month or quarter')
        seen = set()
        for r in ser:
            d = date.fromisoformat(r['period_start'])
            first = d.day == 1 and (kind == 'month' or d.month in (1, 4, 7, 10))
            if not first or d in seen or d > date.today() + timedelta(days=1): bad.append(f"period {r['period_start']}")
            seen.add(d)
            if not (0 < r['lo_usd'] <= r['index_usd'] <= r['hi_usd']) or r['n'] < 0 or (r['raw_median_usd'] is not None and r['raw_median_usd'] <= 0): bad.append(f"period {r['period_start']} values")
        if len(ser) > 130: bad.append('more than 130 periods')
    return bad


# ------------------------------------------------------------------------------------------------- the vehicle features, kept locally
class FeatureCache:
    """What the job has read of each vehicle (mileage, transmission, title), in a local sqlite file. A vehicle's fields rarely change once
    its sale is a few weeks old, and vehicles is 11 GB: the job asks prod only for ids it has not seen, and for the last year's sales
    again once a month. Public listing facts only; losing the file costs one slow night (FEATURE_BUDGET spreads it)."""
    def __init__(self, path):
        if path != ':memory:': os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path, timeout=30)
        self.db.execute('create table if not exists features (vehicle_id text primary key, mileage integer, transmission text, title text, fetched_at text)')
        self.db.commit()

    def get_many(self, ids):
        out = {}
        ids = list(dict.fromkeys(ids))
        for i in range(0, len(ids), 900):
            part = ids[i:i + 900]
            q = f"select vehicle_id, mileage, transmission, title, fetched_at from features where vehicle_id in ({','.join('?' * len(part))})"
            for r in self.db.execute(q, part): out[r[0]] = r[1:]
        return out

    def put_many(self, rows, fetched_at):
        self.db.executemany('insert or replace into features values (?, ?, ?, ?, ?)', [(r[0], r[1], r[2], r[3], fetched_at) for r in rows])
        self.db.commit()


def ensure_features(reader, cache, rows, today, state, now=None, chunk=FEATURE_CHUNK, pace=0.3):
    """Every sale's vehicle fields, from the cache, reading prod only for what is missing or (sold within the last year) a month old. rows are
    the inputs' sale rows. A family whose missing vehicles do not fit what is left of the run's budget waits (Skip) rather than half-load."""
    now = now or datetime.now(timezone.utc)
    ids = [r[0] for r in rows]
    known = cache.get_many(ids)
    recent_from = (date.fromisoformat(today) - timedelta(days=365)).isoformat()
    refresh_before = (now - timedelta(days=FEATURE_REFRESH_DAYS)).isoformat(timespec='seconds')
    need = list(dict.fromkeys(r[0] for r in rows if r[0] not in known or (r[5] > recent_from and known[r[0]][3] < refresh_before)))
    if len(need) > state['budget']:
        raise BudgetSkip(f"{len(need)} vehicles to read and {state['budget']} left in this run's budget of {FEATURE_BUDGET}: the family waits for the next run")
    stamp = now.isoformat(timespec='seconds')
    for i in range(0, len(need), chunk):
        part = need[i:i + chunk]
        got = reader.features(part)
        cols = got['columns']
        found = {x[0]: x for x in got['rows']}
        cache.put_many([found.get(v, [v, None, None, None]) for v in part], stamp)   # an id with no vehicle is remembered as empty
        state['budget'] -= len(part); state['read'] += len(part)
        time.sleep(pace)
    state['cached'] += len(ids) - len(need)
    return cache.get_many(ids)


def with_features(rows, feats):
    return [list(r) + list(feats.get(r[0], (None, None, None, None))[:3]) for r in rows]


# ------------------------------------------------------------------------------------------------- reads and the write
def rest(path, key, method='GET', body=None, timeout=120):
    url = os.environ['VITE_SUPABASE_URL']
    headers = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'X-Nuke-Writer': WRITER}
    req = urllib.request.Request(f'{url}/rest/v1/{path}', method=method, headers=headers, data=None if body is None else json.dumps(body, default=str).encode())
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            msg = e.read()[:400]
            if e.code in (429, 503) and attempt < 2:      # throttled: back off; a timeout or a refusal is never resent
                time.sleep(10 * (attempt + 1)); continue
            raise RuntimeError(f'{method} {path[:60]}: HTTP {e.code} {msg!r}')
    raise RuntimeError(f'{method} {path[:60]}: throttled')


class RpcReader:
    def __init__(self, service):
        self.k = service

    def candidates(self):
        return rest('rpc/family_price_index_candidates', self.k, 'POST', {})

    def inputs(self, brand, key):
        return rest('rpc/family_price_index_inputs', self.k, 'POST', {'p_brand': brand, 'p_family_key': key})

    def features(self, ids):
        return rest('rpc/family_price_index_features', self.k, 'POST', {'p_ids': ids})

    def pairs(self, brand, key):
        return rest('rpc/family_price_index_pairs', self.k, 'POST', {'p_brand': brand, 'p_family_key': key})


class SqlReader:
    """The functions' own SELECT bodies, taken from the migration file and run with the parameters as literals through scripts/data/q.sh
    (Management API, postgres role, 10 s, read-only): for checking a fit before the migration is live, and it runs the migration's SQL on the
    live tables as it does. One call a family, the same jsonb the function returns."""
    MIGRATION = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'supabase', 'migrations', '20261018050000_family_price_index.sql')

    def __init__(self, qsh=None):
        self.qsh = qsh or os.environ.get('Q_SH') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'q.sh')
        self.last = 0.0
        self.text = open(self.MIGRATION).read()

    def body(self, name):
        m = re.search(r'CREATE OR REPLACE FUNCTION public\.' + name + r'\(.*?AS \$\$\n(.*?)\n\$\$;', self.text, re.S)
        if not m: raise RuntimeError(f'{name} is not in the migration')
        return m.group(1)

    @staticmethod
    def lit(s):
        return "'" + str(s).replace("'", "''") + "'"

    def q(self, sql):
        wait = self.last + 2.0 - time.time()
        if wait > 0: time.sleep(wait)
        self.last = time.time()
        out = subprocess.run([self.qsh, "set statement_timeout = '9s'; " + sql], capture_output=True, text=True, timeout=180).stdout
        d = json.loads(out)
        if not isinstance(d, list): raise RuntimeError(str(d)[:300])
        v = list(d[0].values())[0]
        return json.loads(v) if isinstance(v, str) else v

    def run(self, name, brand=None, key=None, limit=None):
        sql = self.body(name)
        if key is not None: sql = sql.replace('p_family_key', self.lit(key))
        if brand is not None: sql = sql.replace('p_brand', self.lit(brand))
        if limit is not None: sql = sql.replace('least(greatest(p_limit, 1), 20000)', str(int(limit)))
        return self.q(sql.rstrip().rstrip(';'))

    def candidates(self):
        return self.run('family_price_index_candidates')

    def inputs(self, brand, key):
        try:
            return self.run('family_price_index_inputs', brand, key, 15000)
        except RuntimeError as e:
            if 'statement timeout' not in str(e): raise
        # the postgres role's 10 s is shorter than the function's service_role 60 s on a cold big family: the same body, a sale year at a time
        out = None
        for yr in range(2016, date.today().year + 1):
            sql = self.body('family_price_index_inputs').replace("date '2016-01-01'", f"date '{yr}-01-01'").replace(
                's.sale_date <= current_date', f"s.sale_date < date '{yr + 1}-01-01' AND s.sale_date <= current_date")
            sql = sql.replace('p_family_key', self.lit(key)).replace('p_brand', self.lit(brand)).replace('least(greatest(p_limit, 1), 20000)', '15000')
            part = self.q(sql.rstrip().rstrip(';'))
            if out is None: out = part
            else:
                out['rows'] += part['rows']; out['n'] += part['n']; out['returned'] += part['returned']
        return out

    def features(self, ids):
        sql = self.body('family_price_index_features').replace('p_ids', "ARRAY[" + ','.join(self.lit(i) for i in ids) + "]::uuid[]")
        return self.q(sql.rstrip().rstrip(';'))

    def pairs(self, brand, key):
        return self.run('family_price_index_pairs', brand, key, 20000)


def clean(o):
    """JSON has no NaN or infinity: they become null; numpy numbers become plain ones."""
    if isinstance(o, dict): return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)): return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.integer): return int(o)
    if isinstance(o, np.bool_): return bool(o)
    return o


def log(*a):
    print(datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), *a, flush=True)


# ------------------------------------------------------------------------------------------------- the run
def run(args):
    t0 = time.time()
    url = os.environ.get('VITE_SUPABASE_URL'); anon = os.environ.get('VITE_SUPABASE_ANON_KEY'); service = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if args.inputs == 'rpc' and (not url or not anon or not service):
        raise SystemExit('VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required (dotenvx run --)')
    if not args.dry_run and (not url or not service):
        raise SystemExit('a write needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (dotenvx run --)')
    reader = RpcReader(service) if args.inputs == 'rpc' else SqlReader()
    try:
        cands = reader.candidates()
    except RuntimeError as e:
        log(f"cannot read the candidate families: {str(e)[:300]}")
        if 'HTTP 404' in str(e): log('the family_price_index functions are not live: apply supabase/migrations/20261018050000_family_price_index.sql first')
        return 1
    today = cands['today']
    cols = cands['columns']
    allrows = [dict(zip(cols, r)) for r in cands['rows']]
    want = {tuple(f.split('|', 1)) for f in args.family} if args.family else None
    eligible, floor = [], []
    for r in allrows:
        if want is not None and (r['brand'], r['family_key']) not in want: continue
        ok = r['n_last12'] >= FLOOR_YEAR and r['n_prior12'] >= FLOOR_YEAR and r['n_total'] >= FLOOR_TOTAL
        (eligible if ok else floor).append(r)
    if args.limit: eligible = eligible[:args.limit]
    if want:
        for w in sorted(want - {(r['brand'], r['family_key']) for r in allrows}):
            log(f"{w[0]}|{w[1]} is not among the candidates (under 50 priced sales since 2016, or not a named family)")
    log(f"today {today}: {len(allrows)} named families with 50+ priced sales since 2016; eligible {len(eligible)} (30 / 30 / 150); below the floor {len(floor)}")
    os.makedirs(args.out, exist_ok=True) if args.out else None
    if args.cache: os.makedirs(args.cache, exist_ok=True)

    def cached(kind, brand, key, fn):
        """Reads kept on disk (a dev aid for trying rules offline): the file when it is there, else the read, saved."""
        if not args.cache: return fn()
        path = os.path.join(args.cache, f"{kind}__{brand.replace('/', '_')}__{key}.json")
        if os.path.exists(path):
            with open(path) as f: return json.load(f)
        v = fn()
        with open(path, 'w') as f: json.dump(v, f)
        return v
    fcache = FeatureCache(os.path.expanduser(args.feature_cache))
    fstate = dict(budget=args.max_feature_rows, read=0, cached=0)
    fitted, skipped, failed, notreached = [], [], [], []
    written = 0
    stamp = datetime.now(timezone.utc)
    for i, r in enumerate(eligible):
        brand, key = r['brand'], r['family_key']
        name = f"{brand}/{r.get('family') or key[:8]}"
        if args.max_seconds and time.time() - t0 > args.max_seconds:
            notreached = [f"{x['brand']}|{x['family_key']}" for x in eligible[i:]]
            log(f"time budget {args.max_seconds}s spent: {len(notreached)} families not reached"); break
        t1 = time.time()
        try:
            inp = cached('inputs', brand, key, lambda: reader.inputs(brand, key))
            if inp.get('truncated'): log(f"{name}: inputs truncated at {inp.get('returned')} of {inp.get('n')} (newest kept)")
            feats = ensure_features(reader, fcache, inp['rows'], today, fstate, chunk=args.feature_chunk, pace=args.pace + 0.05)
            rows9 = with_features(inp['rows'], feats)
            t_read = time.time() - t1
            try:
                pr = cached('pairs', brand, key, lambda: reader.pairs(brand, key))
            except Exception as e:
                pr = None; log(f"{name}: pairs not read ({str(e)[:120]}); the repeat-sale check is left null")
            prior_kind = None
            if args.inputs == 'rpc' and not args.dry_run_no_prior:
                try:
                    prior_kind = (rest('rpc/family_price_index_read', anon, 'POST', {'p_brand': brand, 'p_family_key': key}) or {}).get('period_kind')
                except Exception:
                    prior_kind = None
            payload, info = fit_family(COLS, rows9, brand, key, today, prior_kind=prior_kind,
                                       pair_rows=None if pr is None else pr['rows'], pair_columns=None if pr is None else pr['columns'])
            payload['fitted_at'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
            payload = clean(payload)
            problems = check_payload(payload)
            if problems: raise RuntimeError('payload refused before the write: ' + '; '.join(problems[:5]))
            if args.out:
                with open(os.path.join(args.out, f"{brand.replace('/', '_')}__{key}.json"), 'w') as f: json.dump(payload, f, indent=1)
            if not args.dry_run:
                rest('rpc/record_family_price_index', service, 'POST', {'p_payload': payload}); written += 1
            info.update(read_s=round(t_read, 2), total_s=round(time.time() - t1, 2), name=name, brand=brand, family_key=key)
            fitted.append(info)
            log(f"fitted {name}: n {info['n']} (last 12 months {info['n_last12']}, prior {info['n_prior12']}, dropped {info['dropped']}) "
                f"{info['verdict']} {info['change']} [{info['lo']}, {info['hi']}] periods {info['periods']} {info['kind']} chips {info['chips']} pairs {info['pairs']} "
                f"rs {info['rs_change']} read {info['read_s']}s fit {info['seconds']}s total {info['total_s']}s{'' if not args.dry_run else ' (dry run)'}")
        except Skip as e:
            skipped.append(dict(name=name, brand=brand, family_key=key, reason=str(e))); log(f"skipped {name}: {e}")
        except Exception as e:
            failed.append(dict(name=name, brand=brand, family_key=key, error=str(e)[:300])); log(f"FAILED {name}: {str(e)[:300]} (its previous rows stay)")
        time.sleep(args.pace)
    # success is rows landed: read a sample back through the anon reader
    landed = dict(checked=0, ok=0, bad=[])
    if not args.dry_run and fitted and anon:
        known = [f for f in fitted if (f['brand'], f['family_key']) in BANDS or (f['brand'], f['family_key']) == F430_KEY]
        rest_ = [f for f in fitted if f not in known]
        sample = known + rest_[:: max(1, len(rest_) // 20)][:20]
        for f in sample:
            try:
                got = rest('rpc/family_price_index_read', anon, 'POST', {'p_brand': f['brand'], 'p_family_key': f['family_key']})
                landed['checked'] += 1
                ok = got and got.get('change') and got['change'].get('verdict') == f['verdict'] and got.get('fitted_at') \
                    and (stamp - datetime.fromisoformat(got['fitted_at'])).total_seconds() < 7200 and len(got.get('series') or []) == f['periods']
                if ok: landed['ok'] += 1
                else: landed['bad'].append(f['name'])
            except Exception as e:
                landed['bad'].append(f"{f['name']}: {str(e)[:80]}")
    verdicts = Counter(f['verdict'] for f in fitted)
    summary = dict(started=stamp.isoformat(timespec='seconds'), today=today, inputs=args.inputs, dry_run=bool(args.dry_run), candidates=len(allrows), eligible=len(eligible),
                   below_floor=len(floor), fitted=len(fitted), written=written, skipped=len(skipped), failed=len(failed), not_reached=len(notreached),
                   verdicts=dict(verdicts), kinds=dict(Counter(f['kind'] or 'none' for f in fitted)), landed=landed, seconds=round(time.time() - t0, 1),
                   features_read=fstate['read'], features_from_cache=fstate['cached'], read_seconds=round(sum(f['read_s'] for f in fitted), 1), fit_seconds=round(sum(f['seconds'] for f in fitted), 1), skipped_why=skipped[:50], failed_why=failed[:50], not_reached_list=notreached[:50])
    print(json.dumps(summary), flush=True)
    if args.out:
        with open(os.path.join(args.out, '_run.json'), 'w') as f: json.dump(dict(summary=summary, families=fitted, skipped=skipped, failed=failed), f, indent=1, default=str)
    if not args.dry_run and not args.no_receipt:
        d = os.path.expanduser('~/nuke-logs/family-price-index'); os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"run-{stamp.strftime('%Y%m%dT%H%MZ')}.json"), 'w') as f: json.dump(dict(summary=summary, families=fitted), f, indent=1, default=str)
    waiting = sum(1 for x in skipped if 'in this run' in x['reason'])
    bad = len(failed) or len(notreached) or waiting or landed['bad'] or (not args.dry_run and len(eligible) and not written)
    return 1 if bad else 0


# ------------------------------------------------------------------------------------------------- self-test
def _synthetic(n_years=6, per_year=420, drift=0.20, seed=1):
    """A family with a known story: three variants whose mix drifts toward the dear one, a miles effect, a gearbox premium, two venues,
    and a true price drift of `drift` a year (log) applied to every car. The plain median is fooled by the mix; the fit is not."""
    rng = np.random.default_rng(seed)
    today = date(2026, 10, 15)
    rows = []
    for k in range(n_years * per_year):
        age = int(rng.integers(0, 365 * n_years))
        t = (365 * n_years - age) / (365 * n_years)                      # 0 oldest .. 1 newest
        p_dear = 0.15 + 0.45 * t                                         # the dear variant's share rises with time
        v = rng.choice(['Base', 'Sport', 'Turbo'], p=[0.55 - 0.3 * t, 0.30 - 0.15 * t, 0.15 + 0.45 * t])
        miles = float(np.exp(rng.normal(9.6, 0.8)))
        manual = rng.random() < 0.3
        venue = 'Bring a Trailer' if rng.random() < 0.8 else 'Mecum'
        year = int(rng.integers(2005, 2012))
        lp = (10.5 + {'Base': 0.0, 'Sport': 0.35, 'Turbo': 0.9}[v] - 0.12 * (math.log1p(miles) - 9.6) + (0.15 if manual else 0.0) + (0.08 if venue == 'Mecum' else 0.0)
              + 0.03 * (year - 2008) - drift * age / 365.0 + rng.normal(0, 0.18))
        sd = today - timedelta(days=age)
        rows.append([f'v{k}', f'Zed {v}', year, venue, math.exp(lp), sd.isoformat(), int(miles),
                     '6-Speed Manual Transmission' if manual else '6-Speed Automatic Transmission', f'{year} Brand Zed {v}' + (' 6-Speed' if manual else '')])
    return rows, today


def self_test():
    ok = True

    def check(label, cond):
        nonlocal ok
        print(('PASS ' if cond else 'FAIL ') + label); ok = ok and bool(cond)
    # title words
    check('title words: 8k-Mile 2007 Ferrari F430 Spider 6-Speed -> f430 spider', model_tokens('8k-Mile 2007 Ferrari F430 Spider 6-Speed', 'Ferrari', 'F430 Spider') == ['f430', 'spider'])
    check('title words: 430 Scuderia Spider 16M -> f430 scuderia spider 16m', model_tokens('3,800-Mile 2009 Ferrari 430 Scuderia Spider 16M', 'Ferrari', '') == ['f430', 'scuderia', 'spider', '16m'])
    check('gearbox: F1 automated manual is auto, six-speed manual is manual, silent is unk',
          (gearbox('Six-Speed F1 Automated Manual Gearbox', ''), gearbox('Six-Speed Manual Transaxle', ''), gearbox(None, '2006 Ferrari F430')) == ('auto', 'manual', 'unk'))
    check('gearbox: a 6-Speed title with no field is manual', gearbox(None, '12k-Mile 2006 Ferrari F430 Spider 6-Speed') == 'manual')
    check('variants: plain is base, rare trims are +', pick_variants([[], ['gt'], ['gt'], ['gt'], ['zz', 'extra']], ['g'] * 5, minv=3) == ['g|base', 'g|gt', 'g|gt', 'g|gt', 'g|+'])
    check('variants: a rare third word backs off to the shared key with a plus',
          pick_variants([['a', 'b', 'c']] * 3 + [['a', 'b', 'q']], ['g'] * 4, minv=3)[3] == 'g|a b c' or pick_variants([['a', 'b', 'c']] * 3 + [['a', 'b', 'q']], ['g'] * 4, minv=3)[3].endswith('+'))
    check('years: a thin year joins the nearest richer one', list(pool_years([2000] * 5 + [2001] * 1 + [2003] * 5, 4)) == [2000] * 5 + [2000] + [2003] * 5)
    check('verdict rule', (verdict_of(0.01, 0.2), verdict_of(-0.2, -0.01), verdict_of(-0.02, 0.03), verdict_of(-0.09, 0.09), verdict_of(None, None)) == ('up', 'down', 'flat', 'too few to tell', 'too few to tell'))
    check('t quantile', abs(tcrit(30) - 2.042) < 0.003 and abs(tcrit(300) - 1.968) < 0.002)
    check('generation bands: a 1969 Mustang is g1-69-73, a 2021 Corvette c8, a 1955 Ford F-100 in no band is a decade',
          gen_of(1969, BANDS[('Ford', '8a8271f8-d299-4b55-837a-35ca919f8937')])[0] == 'g1-69-73'
          and gen_of(2021, BANDS[('Chevrolet', '3f3e7278-f47c-412f-b6fc-0ab5d8485924')])[0] == 'c8' and gen_of(1955, None)[0] == '1950s')
    # the fit recovers a known drift that the plain median misreads
    rows, today = _synthetic()
    payload, info = fit_family(COLS, rows, 'Brand', 'zed-key', today.isoformat(), seed=2)
    ch = payload['change']
    truth = math.expm1(0.20)
    d0 = pd.DataFrame(rows, columns=COLS); d0['age'] = [(pd.Timestamp(today) - pd.Timestamp(s)).days for s in d0.sale_date]
    last, prior = d0[d0.age < 365].usd, d0[(d0.age >= 365) & (d0.age < 730)].usd
    raw = float(last.median() / prior.median() - 1)
    check(f"fit: the 12-month change {ch['change_12m']:+.3f} holds the true +{truth:.3f} in its range [{ch['lo']}, {ch['hi']}]", ch['lo'] <= truth <= ch['hi'])
    check(f"fit: within 4 points of the truth ({abs(ch['change_12m'] - truth):.3f}) and closer than the plain median ({raw:+.3f}, off by {abs(raw - truth):.3f})",
          abs(ch['change_12m'] - truth) < 0.04 and abs(ch['change_12m'] - truth) < abs(raw - truth))
    check('fit: verdict up', ch['verdict'] == 'up')
    check('fit: calendar months with 95% ranges and positive medians', payload['period_kind'] in ('month', 'quarter') and len(payload['series']) >= 8
          and all(0 < s['lo_usd'] <= s['index_usd'] <= s['hi_usd'] and s['raw_median_usd'] for s in payload['series']))
    check('fit: every period starts on the first of its month or quarter',
          all(date.fromisoformat(s['period_start']).day == 1 and (payload['period_kind'] == 'month' or date.fromisoformat(s['period_start']).month in (1, 4, 7, 10)) for s in payload['series']))
    # the series falls with age at the true drift: the newest complete period against one a year earlier
    ser = {s['period_start']: s['index_usd'] for s in payload['series']}
    if payload['period_kind'] == 'month':
        a = ser.get('2026-09-01'); b = ser.get('2025-09-01')
        check(f"fit: the reference car's price rose {a / b - 1:+.3f} over a year (true +{truth:.3f})" if a and b else 'fit: months present', bool(a and b) and abs(a / b - 1 - truth) < 0.08)
    check('fit: the ref car names its mix and fit', ch['ref_car']['n'] > 200 and ch['ref_car']['top'] and ch['ref_car']['fit']['params'] > 5)
    check('fit: the payload is plain JSON (no NaN)', 'NaN' not in json.dumps(clean(payload)))
    cp = dict(clean(payload), fitted_at='2026-10-15T00:00:00+00:00')
    check('payload check: the fit passes the writer\'s rules', check_payload(cp) == [])
    bad1 = json.loads(json.dumps(cp)); bad1['change']['verdict'] = 'flat'
    bad2 = json.loads(json.dumps(cp)); bad2['series'][0]['lo_usd'] = bad2['series'][0]['index_usd'] + 1
    bad3 = json.loads(json.dumps(cp)); bad3['series'][0]['period_start'] = '2026-09-15'
    check('payload check: a verdict its range contradicts, an inverted range and a mid-month period are stopped', all(check_payload(b) for b in (bad1, bad2, bad3)))
    # a flat world reads flat or too few, never a direction
    rows0, _ = _synthetic(drift=0.0, seed=5)
    p0, _ = fit_family(COLS, rows0, 'Brand', 'zed-key', today.isoformat(), seed=2)
    check(f"flat world: change {p0['change']['change_12m']:+.3f}, verdict {p0['change']['verdict']} (the plain median here is mix-driven)", p0['change']['verdict'] in ('flat', 'too few to tell') and abs(p0['change']['change_12m']) < 0.04)
    # the floor
    try:
        fit_family(COLS, rows[:100], 'Brand', 'zed-key', today.isoformat()); check('floor: 100 sales are refused', False)
    except Skip:
        check('floor: 100 sales are refused', True)
    # repeat sales: cars that sold twice a year or two apart, with the market drifting
    rng = np.random.default_rng(9)
    ev = []
    for k in range(260):
        a = int(rng.integers(400, 1700)); g = int(rng.integers(200, 700)); b = max(a - g, 1)
        pa = 80000 * math.exp(-0.2 * a / 365 + rng.normal(0, 0.1)); pb = 80000 * math.exp(-0.2 * b / 365 + rng.normal(0, 0.1))
        ev += [[f'c{k}', (today - timedelta(days=a)).isoformat(), pa, 'bat'], [f'c{k}', (today - timedelta(days=b)).isoformat(), pb, 'bat']]
    pl = build_pairs(ev, ['vehicle_id', 'sale_date', 'usd', 'source'])
    rs = rs_fit(pl, today.isoformat(), boot=60)
    check(f"repeat sales: {len(pl)} pairs read a 12-month change of {rs['change']:+.3f} (true +{truth:.3f}) with a range" if rs else 'repeat sales: estimable',
          rs is not None and abs(rs['change'] - truth) < 0.10 and rs.get('lo') is not None)
    # the vehicle cache: ask prod only for what is missing, and for the last year's sales once a month
    class FakeReader:
        def __init__(self): self.calls = []

        def features(self, ids):
            self.calls.append(list(ids))
            return dict(columns=['vehicle_id', 'mileage', 'transmission', 'title'], rows=[[i, 1000, '6-Speed Manual', f'title {i}'] for i in ids if not i.startswith('gone')])
    fc = FeatureCache(':memory:'); fr = FakeReader()
    rows6 = [['a1', 'm', 2020, 'bat', 50000, '2026-09-01'], ['a2', 'm', 2005, 'bat', 40000, '2019-05-01'], ['a3', 'm', 2006, 'bat', 41000, '2026-01-01'],
             ['a4', 'm', 2007, 'bat', 42000, '2021-01-01'], ['gone1', 'm', 2008, 'bat', 43000, '2026-02-01']]
    st = dict(budget=100, read=0, cached=0)
    f1 = ensure_features(fr, fc, rows6, '2026-10-15', st, chunk=2, pace=0)
    check('cache: first pass reads all five vehicles in chunks of two and returns their fields', st['read'] == 5 and len(fr.calls) == 3 and f1['a1'][2] == 'title a1' and f1['a1'][0] == 1000)
    fr.calls.clear(); st2 = dict(budget=100, read=0, cached=0)
    ensure_features(fr, fc, rows6, '2026-10-15', st2, chunk=2, pace=0)
    check('cache: second pass reads nothing (the vehicle with no row is remembered as empty)', fr.calls == [] and st2['read'] == 0 and st2['cached'] == 5)
    fc.db.execute("update features set fetched_at = '2026-08-01T00:00:00' where vehicle_id in ('a1', 'a2')"); fc.db.commit()
    ensure_features(fr, fc, rows6, '2026-10-15', dict(budget=100, read=0, cached=0), chunk=5, pace=0)
    check('cache: a month-old vehicle that sold this year is read again; an old sale is not', fr.calls == [['a1']])
    try:
        ensure_features(FakeReader(), FeatureCache(':memory:'), rows6, '2026-10-15', dict(budget=3, read=0, cached=0), chunk=2, pace=0)
        check('cache: a family that does not fit the budget waits', False)
    except Skip:
        check('cache: a family that does not fit the budget waits', True)
    print('self-test', 'passed' if ok else 'FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dry-run', action='store_true', help='read and fit; write nothing')
    ap.add_argument('--out', help='save each family\'s payload as JSON in this folder')
    ap.add_argument('--family', action='append', help="only this family: 'Brand|family_key' (repeatable)")
    ap.add_argument('--limit', type=int, help='at most this many eligible families (the biggest first)')
    ap.add_argument('--inputs', choices=['rpc', 'sql'], default='rpc', help='read through the service-role functions (default) or scripts/data/q.sh')
    ap.add_argument('--max-seconds', type=int, default=2400, help='stop starting families after this long (default 40 minutes)')
    ap.add_argument('--pace', type=float, default=0.25, help='seconds between families')
    ap.add_argument('--feature-cache', default='~/Library/Caches/nuke-family-price-index/features.sqlite3', help='where the vehicles\' mileage, transmission and title are kept between runs')
    ap.add_argument('--feature-chunk', type=int, default=FEATURE_CHUNK, help='vehicle ids a call (the function takes 2,000)')
    ap.add_argument('--max-feature-rows', type=int, default=FEATURE_BUDGET, help='vehicle rows to read from prod in this run')
    ap.add_argument('--cache', help='keep each family\'s reads in this folder and use them when present (dev: try rules offline)')
    ap.add_argument('--no-receipt', action='store_true', help='do not save the run receipt under ~/nuke-logs/family-price-index/')
    ap.add_argument('--dry-run-no-prior', action='store_true', help='do not read the stored period kind first')
    ap.add_argument('--self-test', action='store_true', help='check the estimator on a synthetic family with a known drift and exit')
    a = ap.parse_args()
    sys.exit(self_test() if a.self_test else run(a))
