#!/usr/bin/env python3
"""Which other houses' live lots model 32 may estimate, measured on each house's own closed lots.

Model 32 (live-finish.py) reads a live lot against finished Bring a Trailer lots at the same hours to close. On another
house the same read is only shown once it has been replayed on that house's closed lots, read at the calibration
horizons with the bid as it stood then, and found to hold. This script does that replay and writes the result into
live-finish-coverage.json under "houses"; live-finish.py reads a house's lots only when its block says show.

Per house, with its data in Nuke (2026-11-08):
  pcarmarket       its results pages, kept in listing_page_snapshots by the results walk, carry the lot's whole bid list
                   (amount and time of every bid; listed == totalBids), its close and its reserve outcome. Replayed.
  collecting-cars  no bid path: Nuke keeps each lot's latest bid only (vehicles.high_bid, monitored_auctions), no bid
                   rows, no stored lot pages with bids. Nothing to replay; not shown.
  ebay-motors      no final: the Browse API does not report an ended auction's price or whether it sold, so the 3,755
                   eBay lots ended since 2026-10-20 have no outcome in Nuke. Nothing to score; not shown.

The replay (pcarmarket): every closed USD lot with a model year (vehicle lots; memorabilia have none) closed in the window,
read at 120, 72, 48, 24, 12, 6, 3, 1 h and 10 min before its scheduled close (when the last bid came within 140 s of the
close the lot was extended, and the scheduled close is the first bid of its final run of bids spaced <= 140 s), with its
latest bid at or before that moment; a moment before the first bid is no read, as on the live board. live-finish.py runs
unchanged on those reads, a week of moments per run, so each read's analogs and comparables closed before it. The final is
the high bid at the close, sold or not, as model 32's BaT finals.

The calibration: per horizon, the shift is the median ln(final / model 32 estimate) and the widen is the conformal
correction that brings 80% of finals inside the shifted range (house_adjust in live-finish.py). Fitted on the lots that
closed first (60%), measured on the rest (the numbers shown and stored: coverage, median miss, n per horizon), then refitted
on all lots for use. The bar, per horizon on the held-out lots (at least 150): 75-85% of finals inside the range and a
median miss of 20% or less. A house's lots are estimated up to the longest horizon below which every horizon meets it
(max_hours); the in-range share and miss each row carries are the held-out ones for its horizon and grade.

Run: dotenvx run -- python3 scripts/market/live-finish-houses.py pull --out ~/Library/Caches/nuke-finish-houses/pcarmarket.jsonl
     python3 scripts/market/live-finish-houses.py replay --pages '<jsonl glob>' --work <dir>      (needs the BaT archive)
     python3 scripts/market/live-finish-houses.py fit --work <dir> [--write]                       (writes the coverage file)
"""
import argparse, glob, importlib.util, json, math, os, re, sys, time, urllib.request
from argparse import Namespace
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
H = [120, 72, 48, 24, 12, 6, 3, 1, 1 / 6]
EXTENDED_S = 140          # PCarMarket closes 2:15 after the last bid of an extended lot
NOT_SHOWN = {
    'collecting-cars': 'no bid path in Nuke for closed Collecting Cars lots (latest bid only), so the read cannot be replayed',
    'ebay-motors': 'no final price in Nuke for ended eBay auctions (the Browse API does not report it), so nothing can be scored',
}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def load_lf():
    spec = importlib.util.spec_from_file_location('live_finish', os.path.join(HERE, 'live-finish.py'))
    lf = importlib.util.module_from_spec(spec); spec.loader.exec_module(lf)
    import __main__
    __main__.CohortMap = lf.CohortMap          # the model 32 cache pickles CohortMap from live-finish.py run as __main__
    return lf


# ------------------------------------------------------------------------------------------------------------- pull
def field(seg, k):
    found = list(re.finditer(r'[,{]' + k + r':("(?:[^"\\]|\\.)*"|-?[\d.]+|!0|!1|null)', seg))
    if not found:
        return None
    v = found[-1].group(1)
    return True if v == '!0' else False if v == '!1' else None if v == 'null' else json.loads(v) if v.startswith('"') else float(v)


def parse_pcar(html):
    """A PCarMarket results page: its lot's bids (time, amount) and fields, from the page's serialized query state."""
    s = re.search(r'[,{]bids:\$R\[\d+\]=\[', html)
    if not s:
        return None
    s = s.start()
    body = html[s:s + 400_000]
    k = body.index('=[') + 2
    close = re.search(r'(?<!\$R\[)(?<!\$R\[\d)(?<!\$R\[\d\d)(?<!\$R\[\d\d\d)(?<!\$R\[\d\d\d\d)\](?!=)', body[k:])
    seg = body[:k + close.start() + 1] if close else body
    bids, seen = [], set()
    for m in re.finditer(r'\{id:"([0-9a-f-]{36})",amount:(\d+),date:"([^"]+)"', seg):
        if m.group(1) not in seen:
            seen.add(m.group(1)); bids.append([m.group(3), int(m.group(2)) / 100])
    f = html.rfind('slugFullPath:', 0, s)
    pre = html[f if f >= 0 else max(0, s - 60_000):s]
    rec = {k: field(pre, k) for k in ('status', 'title', 'currency', 'currentBid', 'totalBids', 'closingStart', 'closingEnd',
                                      'reserveStatus', 'year', 'make', 'model')}
    rec['bids'] = bids
    return rec


def pull(a):
    url, key = os.environ['VITE_SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY']
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    after, n = None, 0
    with open(a.out, 'w') as out:
        while True:
            q = (f"{url}/rest/v1/listing_page_snapshots?select=id,listing_url,fetched_at,html&platform=eq.pcarmarket&success=eq.true"
                 f"&listing_url=like.*%2Fresults%2F*&order=id&limit=25" + (f"&id=gt.{after}" if after else ''))
            for attempt in range(5):
                try:
                    req = urllib.request.Request(q, headers={'apikey': key, 'Authorization': f'Bearer {key}'})
                    rows = json.load(urllib.request.urlopen(req, timeout=120)); break
                except Exception as e:
                    if attempt == 4:
                        raise
                    time.sleep(3 * (attempt + 1))
            if not rows:
                break
            for r in rows:
                rec = parse_pcar(r['html'] or '') or {'bids': None}
                out.write(json.dumps({'url': r['listing_url'], 'fetched_at': r['fetched_at'], **rec}) + '\n'); n += 1
            after = rows[-1]['id']
            if a.limit and n >= a.limit:
                break
    log(f'pull: {n} pages -> {a.out}')


# ----------------------------------------------------------------------------------------------------------- replay
def reads(pages, frm, to):
    recs = {}
    for f in glob.glob(pages):
        for line in open(f):
            d = json.loads(line)
            if d['url'] not in recs or d['fetched_at'] > recs[d['url']]['fetched_at']:
                recs[d['url']] = d
    out, why = [], {}
    def no(k):
        why[k] = why.get(k, 0) + 1
    t0, t1 = pd.Timestamp(frm, tz='UTC').timestamp(), pd.Timestamp(to, tz='UTC').timestamp()
    for url, d in recs.items():
        b = d.get('bids')
        if d.get('status') != 'ITEM_CLOSED': no('not closed'); continue
        if not d.get('year'): no('no model year (not a vehicle lot)'); continue
        if (d.get('currency') or 'USD') != 'USD': no('not USD'); continue
        if not b: no('no bid'); continue
        if d.get('totalBids') is not None and len(b) != int(d['totalBids']): no('bid list incomplete'); continue
        if not d.get('closingEnd'): no('no close time'); continue
        close = pd.Timestamp(d['closingEnd']).timestamp()
        if not (t0 <= close < t1): no('closed outside the window'); continue
        B = sorted((pd.Timestamp(x[0]).timestamp(), float(x[1])) for x in b)
        if B[-1][0] > close + 5: no('a bid after the close'); continue
        anchor = close
        if close - B[-1][0] <= EXTENDED_S:
            i = len(B) - 1
            while i > 0 and B[i][0] - B[i - 1][0] <= EXTENDED_S and B[i - 1][0] >= close - 6 * 3600:
                i -= 1
            anchor = B[i][0]
        final = max(x for _, x in B)
        title = d.get('title') or f"{int(d['year'])} {d.get('make') or ''} {d.get('model') or ''}"
        for h in H:
            m = anchor - h * 3600
            prior = [x for t, x in B if t <= m]
            if prior:
                out.append({'id': f'{url}|{h:g}', 'url': url, 'h': h, 'current_bid': max(prior), 'final': final, 'close': close,
                            'ends_at': pd.Timestamp(anchor, unit='s', tz='UTC').isoformat(),
                            'as_of': pd.Timestamp(m, unit='s', tz='UTC').isoformat(), 'no_reserve': d.get('reserveStatus') == 'NO_RESERVE',
                            'reserve': d.get('reserveStatus'), 'title': title, 'year': d.get('year'), 'make': d.get('make'), 'model': d.get('model')})
    return pd.DataFrame(out), {'pages': len(recs), 'excluded': why}


def replay(a):
    lf = load_lf()
    os.makedirs(a.work, exist_ok=True)
    L, info = reads(a.pages, a.frm, a.to)
    info.update(reads=len(L), lots=int(L.url.nunique()), window=f'{a.frm}..{a.to}')
    log(json.dumps(info))
    L['week'] = pd.to_datetime(L.as_of).dt.strftime('%G-%V')
    got = []
    for wk, g in L.groupby('week'):
        lp, op = f'{a.work}/lots-{wk}.json', f'{a.work}/rows-{wk}.json'
        g[['id', 'current_bid', 'ends_at', 'as_of', 'no_reserve', 'title', 'year', 'make', 'model']].to_json(lp, orient='records')
        lf.run(Namespace(lots=lp, kinds=None, engagement=None, coverage=a.coverage, archive=a.archive, cache=a.cache, now=None,
                         out=op, format='bundle', rebuild=False, build_cache=False))
        R = json.load(open(op))
        got += [{'id': r['vehicle_id'], 'est': r['predicted_hammer'], 'low': r['predicted_low'], 'high': r['predicted_high'],
                 'grade': r['notes']['grade'], 'hours': r['hours_remaining']} for r in R['rows']]
        got += [{'id': s['vehicle_id'], 'skip': s['reason']} for s in R['skipped']]
    O = L.drop(columns=['week']).merge(pd.DataFrame(got), on='id', how='left')
    O.to_csv(f'{a.work}/replay.csv', index=False)
    json.dump(info, open(f'{a.work}/replay-info.json', 'w'), indent=1)
    log(f'replay: {len(O)} reads -> {a.work}/replay.csv')


# -------------------------------------------------------------------------------------------------------------- fit
def calibrate(F):
    """Per horizon: shift = median ln(final / estimate); widen = the conformal 80% correction of the shifted range."""
    by = {}
    for h, g in F.groupby('h'):
        s = float(np.median(np.log(g.final) - np.log(g.est)))
        y = np.log(g.final.values)
        need = np.maximum(np.log(g.low.values) + s - y, y - np.log(g.high.values) - s)
        w = float(np.quantile(need, min(1.0, 0.8 * (1 + 1 / len(need)))))
        by[f'{h:g}'] = {'shift': round(s, 4), 'widen': round(w, 4), 'fit_n': int(len(g))}
    return by


def score(T, by, lf):
    hc = {'by_h': by}
    res = [lf.house_adjust(b, e, lo, hi, h, hc) for b, e, lo, hi, h in zip(T.current_bid, T.est, T.low, T.high, T.h)]
    T = T.assign(e2=[r[0] for r in res], l2=[r[1] for r in res], u2=[r[2] for r in res])
    T['inr'] = (T.final >= T.l2 - 0.5) & (T.final <= T.u2 + 0.5)
    T['miss'] = (T.e2 - T.final).abs() / T.final
    T['inr0'] = (T.final >= T.low - 0.5) & (T.final <= T.high + 0.5)
    T['miss0'] = (T.est - T.final).abs() / T.final
    return T


def fit(a):
    lf = load_lf()
    O = pd.read_csv(f'{a.work}/replay.csv')
    info = json.load(open(f'{a.work}/replay-info.json'))
    E = O[O.est.notna()].copy()
    skips = O[O.est.isna()].skip.str.replace(r'\(.*', '', regex=True).value_counts().to_dict()
    lots = E.groupby('url').close.first().sort_values()
    cut = lots.iloc[int(len(lots) * 0.6)]
    F, T = E[E.close < cut], E[E.close >= cut]
    by = calibrate(F)
    S = score(T, by, lf)
    day = lambda t: pd.Timestamp(t, unit='s', tz='UTC').strftime('%Y-%m-%d')
    test_window = f'pcarmarket lots closed {day(cut)}..{day(lots.iloc[-1])} (held out; calibration fitted on {day(lots.iloc[0])}..{day(cut)})'
    m3 = lambda g: {'coverage': round(float(g.inr.mean()), 3), 'median_miss': round(float(g.miss.median()), 3), 'n': int(len(g))}
    per = {}
    for h, g in S.groupby('h'):
        per[f'{h:g}'] = {**m3(g), 'raw_coverage': round(float(g.inr0.mean()), 3), 'raw_median_miss': round(float(g.miss0.median()), 3),
                         'by_grade': {gr: m3(x) for gr, x in g.groupby('grade')}}
    pooled = {**m3(S), 'lots': int(S.url.nunique()), 'raw_coverage': round(float(S.inr0.mean()), 3),
              'raw_median_miss': round(float(S.miss0.median()), 3)}
    # the bar, per horizon on the held-out lots: 75-85% inside the range and a median miss of 20% or less. Estimates are
    # shown up to the longest horizon below which every horizon meets it.
    passes = lambda m: 0.75 <= m['coverage'] <= 0.85 and m['median_miss'] <= 0.20
    max_hours = None
    for h in sorted(per, key=float):
        if not passes(per[h]):
            break
        max_hours = float(h)
    show = pooled['lots'] >= 150 and max_hours is not None
    final_by = calibrate(E)                                  # refit on every lot for use; the measurement stays the held-out one
    for h, m in final_by.items():
        m.update(per.get(h, {}))
    block = {'show': bool(show), 'currency': 'USD', 'max_hours': max_hours, 'window': test_window,
             'fitted': f'{day(lots.iloc[0])}..{day(lots.iloc[-1])}, {len(lots)} lots', 'pooled': pooled, 'by_h': final_by,
             'replay': info, 'skipped_reads': skips, 'scored': time.strftime('%Y-%m-%d'),
             'rule': 'per horizon on the held-out lots (>= 150): 75-85% inside the range and a median miss <= 20%; shown up to '
                     'the longest horizon below which every horizon passes'}
    if not show:
        block['reason'] = (f"held-out backtest: {pooled['coverage']:.0%} inside the range, median miss {pooled['median_miss']:.0%} "
                           f"on {pooled['lots']} lots, no horizon meets the bar ({test_window})")
    print(json.dumps({'pcarmarket': block}, indent=1))
    if a.write:
        cov = json.load(open(a.coverage))
        cov['houses'] = {'pcarmarket': block, **{h: {'show': False, 'reason': r} for h, r in NOT_SHOWN.items()}}
        json.dump(cov, open(a.coverage, 'w'), indent=1)
        log(f'fit: wrote houses to {a.coverage}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('pull'); p.add_argument('--out', required=True); p.add_argument('--limit', type=int, default=0)
    r = sub.add_parser('replay'); r.add_argument('--pages', required=True); r.add_argument('--work', required=True)
    r.add_argument('--from', dest='frm', default='2025-07-01'); r.add_argument('--to', default=time.strftime('%Y-%m-%d'))
    r.add_argument('--archive', default=os.path.join(HERE, '..', 'data', 'bat-archive.duckdb'))
    r.add_argument('--cache', default=os.path.expanduser('~/Library/Caches/nuke-finish-houses/cache32'))
    for q in (r, sub.add_parser('fit')):
        q.add_argument('--coverage', default=os.path.join(HERE, 'live-finish-coverage.json'))
    sub.choices['fit'].add_argument('--work', required=True); sub.choices['fit'].add_argument('--write', action='store_true')
    a = ap.parse_args()
    {'pull': pull, 'replay': replay, 'fit': fit}[a.cmd](a)
