#!/usr/bin/env python3
"""Finish-price estimates for Bring a Trailer's live auctions (model 32), in the shape of scripts/market/live-bands.mjs.

For each live lot on the board, find the 50 finished BaT lots that looked most like it at the same hours to close.
"Looked like it" means: the same no-reserve flag; a near bid; a near position of the bid against where cars of its model
page usually finish; near counts of bidders, comments, bids in the last 24 h and hours since the last bid. Lots on the
same model page, of the same make and of a near model year are preferred. The estimate is the bid times those lots'
weighted median rise from that hour to their close. The 80% range is their 10th to 90th percentile rise, widened by a
correction measured on the archive's last 90 days per hours to close x no-reserve flag x grade. It is never below the bid.

Grade A: the lot's model page has comparables within 3 model years, and at least 5 of the 50 analogs are on that page.
Grade B: the page has comparables, fewer same-page analogs. Grade C: no comparables on the page; priced from the make.

Point in time. Each lot is read at one moment: --now (default: the clock), or a per-lot "as_of" in replay mode. Only
its bid rows posted at or before that moment count. Analogs and comparables are archive lots that closed before it.

Inputs
  --lots     the market_pulse_live payload (jsonb with "columns" and "auctions"), or a JSON list of lot objects with
             id, current_bid, ends_at, no_reserve, title, year, make, model, listing_url and optionally as_of.
  --bids / --engagement  optional, per lot: its own bid and comment rows ({"<vehicle id>": [{"posted_at", "bid_amount",
             "author_username", "comment_type"}, ...]}) or counts ({"<vehicle id>": {"bids", "bidders", "comments",
             "bids_last_24h", "last_bid_at"}}). Without it (v1) the match is price-only: the bid and where it sits against
             the model page's usual finish, plus the page, make and model-year preferences, with price-only range corrections.
  --archive  scripts/data/bat-archive.duckdb (read-only). A cache of derived tables is built in --cache once per archive
             file (about 3-4 minutes; --build-cache does only that), then reused.
  --coverage prod_coverage.json beside this script: the latest prod measurement of the ranges per match mode and grade.
             The viewer's sentence never claims more than it ("8 in 10" for A and B only at 78% or above).
Output: --out rows.json = the list of hammer_predictions model 32 rows; rows.skipped.json = [{"vehicle_id", "reason"}]
  (--format bundle writes one file {"rows", "skipped", ...} instead).
  A row: vehicle_id, current_bid, hours_remaining, time_window 'live', price_tier, model_version 32, comp_median,
  comp_count, predicted_hammer, predicted_low, predicted_high, confidence_score (the measured coverage), predicted_at
  (the read moment) and notes {grade, sentence, coverage_n, coverage_window, comps_through, model_page, vote_share,
  same_page_analogs, n_analogs, method, coverage_archive, coverage_prod, coverage_prod_n, window,
  analogs: [{url, title, closed, bid, final, outcome}] x 3}. confidence_score = min(archive, prod) coverage.

Run: python3 live_finish.py --lots pulse.json --archive <duckdb> --cache <dir> --now <iso> --out rows.json
Method and backtest: REPORT.md in this folder (archive car lots closed 2026-04..09 and prod lots closed 09-28..10-14).
"""
import argparse, json, math, os, pickle, re, subprocess, sys, time
from collections import Counter, defaultdict
import numpy as np
import pandas as pd

DAY = 86400.0
GRID = [168, 144, 120, 96, 84, 72, 60, 48, 40, 32, 24, 20, 16, 12, 10, 8, 6, 5, 4, 3, 2.5, 2, 1.5, 1.25, 1,
        0.75, 0.5, 1 / 3, 1 / 6]
BASE = [120, 72, 48, 24, 12, 6, 3, 1, 1 / 6]          # calibration horizons; corrections are interpolated in ln h
FEATS = ['lb', 'z', 'lbidders', 'lcom', 'l24', 'lsince']
WEIGHTS = {'lb': 1.0, 'z': 1.0, 'lbidders': 0.7, 'lcom': 0.5, 'l24': 0.5, 'lsince': 0.3}
PRICE_WEIGHTS = {'lb': 1.0, 'z': 1.0}                # v1 runs with no engagement reads: bid and price level only
LAM_PAGE, LAM_MAKE, LAM_YEAR = 1.0, 0.5, 0.5          # squared-distance penalties: another page, another make, year gap
K = 50
CACHE_VERSION = 'live_finish_v4'



def strict(x):
    """JSON has no NaN: pandas' missing values (a lot with no model page, an analog without a final) become null."""
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    if isinstance(x, dict):
        return {k: strict(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [strict(v) for v in x]
    return x

def log(*a):
    print(*a, file=sys.stderr, flush=True)


def epoch(s):
    if s is None or (isinstance(s, float) and math.isnan(s)):
        return np.nan
    return pd.Timestamp(s).tz_convert('UTC').timestamp() if pd.Timestamp(s).tzinfo else pd.Timestamp(s, tz='UTC').timestamp()


def iso_date(e):
    return pd.to_datetime(e, unit='s', utc=True).strftime('%Y-%m-%d')


def duckdb(sql, db):
    r = subprocess.run(['duckdb', '-readonly', db], input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-2000:])
    return r.stdout


# ---------------------------------------------------------------------------------------------------- the archive cache
def cache_sql(cache, lots_from, states_from):
    grid = ', '.join(f"({i}, {h!r})" for i, h in enumerate(GRID))
    return f"""
SET threads = 8;
CREATE TEMP TABLE c_lots AS
  SELECT l.slug, s.url, l.title, l.year, l.make, l.model, l.cohort, s.no_reserve, s.sold,
         coalesce(ls.sold_after_reserve_not_met, false) AS sold_after, s.final_bid, s.end_ts AS f
  FROM lots l JOIN sales s USING (slug) LEFT JOIN lot_stats ls USING (slug)
  WHERE l.kind = 'car' AND NOT coalesce(ls.withdrawn, false) AND s.final_bid > 0 AND s.end_ts >= TIMESTAMPTZ '{lots_from}';
CREATE TEMP TABLE c_bids AS
  SELECT e.slug, e.posted_at, e.bid_amount, e.author FROM events e JOIN c_lots USING (slug)
  WHERE e.kind = 'bid' AND e.bid_amount > 0 AND e.posted_at IS NOT NULL;
CREATE TEMP TABLE c_coms AS
  SELECT e.slug, e.posted_at FROM events e JOIN c_lots USING (slug) WHERE e.kind = 'comment' AND e.posted_at IS NOT NULL;
-- the clock: the stored close is the FINAL close; when the last bid is within 125 s of it the lot was extended, and the
-- anchor is the first bid of the final run of bids spaced <= 120 s (a lower bound on the scheduled close)
CREATE TEMP TABLE c_anchor AS
WITH b AS (SELECT slug, posted_at t, lead(posted_at) OVER (PARTITION BY slug ORDER BY posted_at) nt
           FROM c_bids JOIN c_lots USING (slug) WHERE posted_at >= c_lots.f - INTERVAL '6 hours'),
lastb AS (SELECT slug, max(t) last_t FROM b GROUP BY 1),
brk AS (SELECT slug, max(t) FILTER (WHERE epoch(nt) - epoch(t) > 120) last_break FROM b GROUP BY 1),
cs AS (SELECT b.slug, min(b.t) run_start FROM b JOIN brk USING (slug) WHERE brk.last_break IS NULL OR b.t > brk.last_break GROUP BY 1)
SELECT l.slug, CASE WHEN x.last_t IS NOT NULL AND epoch(l.f) - epoch(x.last_t) <= 125 THEN cs.run_start ELSE l.f END AS anchor
FROM c_lots l LEFT JOIN lastb x USING (slug) LEFT JOIN cs USING (slug);
CREATE TEMP TABLE c_bid_run AS
SELECT slug, posted_at, max(run_max) run_max, max(run_n) run_n, max(run_bidders) run_bidders FROM (
  SELECT slug, posted_at,
         max(bid_amount) OVER w run_max, count(*) OVER w run_n,
         sum(CASE WHEN rn = 1 THEN 1 ELSE 0 END) OVER w run_bidders
  FROM (SELECT *, row_number() OVER (PARTITION BY slug, author ORDER BY posted_at, bid_amount) rn FROM c_bids)
  WINDOW w AS (PARTITION BY slug ORDER BY posted_at, bid_amount ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
) GROUP BY 1, 2;
CREATE TEMP TABLE c_com_run AS
SELECT slug, posted_at, max(rn) run_n FROM (SELECT slug, posted_at, row_number() OVER (PARTITION BY slug ORDER BY posted_at) rn FROM c_coms) GROUP BY 1, 2;
CREATE TEMP TABLE hz AS SELECT * FROM (VALUES {grid}) v(g, hours);
CREATE TEMP TABLE q AS
  SELECT a.slug, hz.g, a.anchor - to_microseconds(CAST(hz.hours * 3600e6 AS BIGINT)) AS t
  FROM c_anchor a JOIN c_lots l USING (slug) CROSS JOIN hz WHERE l.f >= TIMESTAMPTZ '{states_from}';
COPY (
  SELECT q.slug, q.g, b.run_max AS bid_t, coalesce(b.run_n, 0) AS nb_t, coalesce(b.run_bidders, 0) AS bidders_t,
         epoch(q.t) - epoch(b.posted_at) AS since_s, coalesce(b.run_n, 0) - coalesce(b24.run_n, 0) AS nb24, coalesce(c.run_n, 0) AS ncom_t
  FROM q
  ASOF LEFT JOIN c_bid_run b ON q.slug = b.slug AND q.t >= b.posted_at
  ASOF LEFT JOIN (SELECT slug, posted_at + INTERVAL '24 hours' AS p24, run_n FROM c_bid_run) b24 ON q.slug = b24.slug AND q.t >= b24.p24
  ASOF LEFT JOIN c_com_run c ON q.slug = c.slug AND q.t >= c.posted_at
) TO '{cache}/states.csv' (HEADER);
COPY (SELECT l.slug, l.url, l.title, l.year, l.make, l.model, l.cohort, l.no_reserve, l.sold, l.sold_after, l.final_bid,
             epoch(l.f) AS f_epoch, epoch(a.anchor) AS anchor_epoch
      FROM c_lots l JOIN c_anchor a USING (slug)) TO '{cache}/lots.csv' (HEADER);
COPY (SELECT l.slug, l.year, l.make, l.model, l.cohort, l.kind FROM lots l) TO '{cache}/all_kinds.csv' (HEADER);
COPY (SELECT epoch(max(end_ts)) AS last_close FROM sales) TO '{cache}/meta.csv' (HEADER);
"""


def norm_make(m):
    m = (m if isinstance(m, str) else '').strip().lower()
    return {'mercedes': 'mercedes-benz', 'vw': 'volkswagen', 'chevy': 'chevrolet'}.get(m, m)


def toks(s):
    s = (s if isinstance(s, str) else '').lower().replace('&#8217;', "'").replace('×', 'x')
    return [t for t in re.split(r'[^a-z0-9.\-/]+', s) if t]


class CohortMap:
    """Fallback title map: make + leading model words + model year -> BaT model page, narrowest year band first.
    92.7% exact on 12,942 archive lots closed 2026-07..09 with the map learned before 07-01."""
    def __init__(self, A):
        idx = defaultdict(lambda: defaultdict(list))
        for mk, md, c, y in zip(A.make, A.model, A.cohort, A.year):
            if not isinstance(c, str):
                continue
            t = toks(md)
            for n in range(0, min(4, len(t)) + 1):
                idx[norm_make(mk)][tuple(t[:n])].append((c, y))
        self.idx = {m: dict(v) for m, v in idx.items()}

    def map(self, make, model, year):
        m = norm_make(make); t = toks(model)
        if m not in self.idx:
            return None, 0.0
        has_year = year is not None and not (isinstance(year, float) and math.isnan(year))
        for n in range(min(4, len(t)), -1, -1):
            cands = self.idx[m].get(tuple(t[:n]))
            if not cands or len(cands) < 3:
                continue
            for band in ([0, 1, 2, 4] if has_year else []) + [None]:
                sel = [c for c, y in cands if band is None or (y is not None and not math.isnan(y) and abs(y - year) <= band)]
                if len(sel) >= 3:
                    c, s = Counter(sel).most_common(1)[0]
                    return c, s / len(sel)
        return None, 0.0


def comps_index(L):
    page = defaultdict(dict); make = defaultdict(dict)
    for (k, y), g in L.groupby(['cohort', 'year']):
        o = np.argsort(g.f_epoch.values); page[k][int(y)] = (g.f_epoch.values[o], g.logp.values[o])
    for (k, y), g in L.groupby(['make_k', 'year']):
        o = np.argsort(g.f_epoch.values); make[k][int(y)] = (g.f_epoch.values[o], g.logp.values[o])
    return dict(page), dict(make)


def build_levels(T, L=None, index=None):
    """Price level for targets T (columns cohort, make_k, year, t_ref) from archive lots closed before each t_ref."""
    page, make = index if index is not None else comps_index(L)

    def lvl(by, keys, band, min_n):
        med = np.full(len(T), np.nan); cnt = np.zeros(len(T), dtype=int)
        for i, (k, y, t) in enumerate(zip(keys, T.year.values, T.t_ref.values)):
            d = by.get(k)
            if d is None or y is None or np.isnan(y):
                continue
            parts = []
            years = d.keys() if band is None else range(int(y) - band, int(y) + band + 1)
            for yy in years:
                if yy in d:
                    e, p = d[yy]
                    a = np.searchsorted(e, t - 730 * DAY, 'left'); b = np.searchsorted(e, t, 'left')
                    if b > a:
                        parts.append(p[a:b])
            if parts:
                v = np.concatenate(parts); cnt[i] = len(v)
                if len(v) >= min_n:
                    med[i] = np.median(v)
        return med, cnt
    m1, n1 = lvl(page, T.cohort.values, 3, 5)
    m2, n2 = lvl(page, T.cohort.values, None, 5)
    m3, n3 = lvl(make, T.make_k.values, 5, 10)
    level = np.where(~np.isnan(m1), 1, np.where(~np.isnan(m2), 2, np.where(~np.isnan(m3), 3, 0)))
    ref = np.where(level == 1, m1, np.where(level == 2, m2, m3))
    n = np.where(level == 1, n1, np.where(level == 2, n2, np.where(level == 3, n3, 0)))
    return ref, level, n


def features(df):
    df['lbidders'] = np.log1p(df.bidders_t)
    df['lcom'] = np.log1p(df.ncom_t)
    df['l24'] = np.log1p(df.nb24.clip(lower=0))
    df['lsince'] = np.log1p((df.since_s / 3600.0).clip(lower=0).fillna(999))
    return df


def wq_rows(Y, Wt, qs):
    o = np.argsort(Y, axis=1)
    Ys = np.take_along_axis(Y, o, 1); Ws = np.take_along_axis(Wt, o, 1)
    C = np.cumsum(Ws, 1) / Ws.sum(1, keepdims=True)
    return [Ys[np.arange(len(Y)), np.minimum((C < q).sum(1), Y.shape[1] - 1)] for q in qs]


def analog_search(pool, tgt, weights, n_named=3, chunk=400):
    """K nearest pool lots per target (same no-reserve flag), weighted 10/50/90% of their ln rise, the number on the
    target's page, and the n_named nearest on the same page (then the same make) for display."""
    zfill = np.nanmedian(pool.z.values) if np.isfinite(pool.z.values).any() else 0.0
    Pf = pool[FEATS].copy(); Pf['z'] = Pf.z.fillna(zfill)
    Tf = tgt[FEATS].copy(); Tf['z'] = Tf.z.fillna(zfill)
    mu = Pf.mean(); sd = Pf.std().replace(0, 1).fillna(1)
    w = np.array([weights.get(f, 0.0) for f in FEATS])
    P = (((Pf - mu) / sd).values * w).astype(np.float32)
    T = (((Tf - mu) / sd).values * w).astype(np.float32)
    def codes(pool_col, tgt_col):   # a value missing from the pool, or no value, is -1 and never matches
        cat = {v: i for i, v in enumerate(pd.unique(pool_col.dropna()))}
        return (pool_col.map(cat).fillna(-1).astype(int).values, tgt_col.map(cat).fillna(-1).astype(int).values)
    pc, tc = codes(pool.cohort, tgt.cohort)
    pm, tm = codes(pool.make_k, tgt.make_k)
    py_ = pool.year.fillna(-100).values.astype(np.float32); ty = tgt.year.fillna(-100).values.astype(np.float32)
    pnr = pool.nr.values; tnr = tgt.nr.values
    y = pool.y.values.astype(np.float32)
    P2 = (P ** 2).sum(1)
    n = len(tgt); k = min(K, len(pool))
    out = {'q10': np.empty(n), 'p50': np.empty(n), 'q90': np.empty(n), 'n_same': np.empty(n, dtype=int)}
    named = [None] * n
    for s in range(0, n, chunk):
        e = min(n, s + chunk)
        D2 = (T[s:e] ** 2).sum(1)[:, None] + P2[None, :] - 2 * T[s:e] @ P.T
        np.maximum(D2, 0, out=D2)
        same_page = (tc[s:e, None] == pc[None, :]) & (tc[s:e, None] >= 0) & (pc[None, :] >= 0)
        same_make = (tm[s:e, None] == pm[None, :]) & (tm[s:e, None] >= 0)
        D2 += LAM_PAGE * (~same_page & (tc[s:e, None] >= 0)) + LAM_MAKE * ~same_make
        D2 += LAM_YEAR * np.minimum(np.abs(ty[s:e, None] - py_[None, :]), 20) / 20.0
        D2 += 1e6 * (tnr[s:e, None] != pnr[None, :])
        ind = np.argpartition(D2, k - 1, axis=1)[:, :k]
        d = np.sqrt(np.take_along_axis(D2, ind, 1))
        a, b, c = wq_rows(y[ind], 1.0 / (1.0 + d), [0.1, 0.5, 0.9])
        out['q10'][s:e], out['p50'][s:e], out['q90'][s:e] = a, b, c
        out['n_same'][s:e] = np.take_along_axis(same_page, ind, 1).sum(1)
        if n_named:
            ok_nr = (tnr[s:e, None] == pnr[None, :])
            for r in range(e - s):
                picks = []
                for mask in (same_page[r] & ok_nr[r], same_make[r] & ~same_page[r] & ok_nr[r]):
                    idx = np.where(mask)[0]
                    if len(idx) and len(picks) < n_named:
                        o = idx[np.argsort(D2[r, idx])[:n_named - len(picks)]]
                        picks += [(int(i), 'same model page' if same_page[r, i] else 'same make') for i in o]
                named[s + r] = picks
    res = pd.DataFrame(out, index=tgt.index)
    return res, named


def grade_of(level, n_same):
    return np.where((level == 1) & (n_same >= 5), 'A', np.where(level == 1, 'B', 'C'))


def calibrate(S, weights, last_close, t0, mode):
    """Range corrections from the archive's last 90 days: fit on its first 45 days and measure on the last 45 (the
    measured in-range share and median miss per horizon x grade), then refit on all 90 days for use."""
    cal0 = last_close - 90 * DAY; mid = last_close - 45 * DAY
    parts = []
    for b in BASE:
        Sg = S[S.g == GRID.index(b)]
        pool = Sg[(Sg.f_epoch < cal0 - 4 * DAY) & (Sg.f_epoch >= cal0 - 4 * DAY - 365 * DAY)].reset_index(drop=True)
        tg = Sg[Sg.f_epoch >= cal0].reset_index(drop=True)
        res, _ = analog_search(pool, tg, weights, n_named=0)
        tg = tg.join(res)
        tg['grade'] = grade_of(tg.comp_level.values, tg.n_same.values)
        tg['E'] = np.maximum(tg.q10 - tg.y, tg.y - tg.q90)
        tg['ape'] = np.abs(np.exp(tg.p50) - np.exp(tg.y)) / np.exp(tg.y)
        tg['half'] = np.where(tg.f_epoch < mid, 'fit', 'test')
        tg['base'] = b
        parts.append(tg[['base', 'nr', 'grade', 'E', 'ape', 'half', 'y', 'q10', 'q90']])
        log(f'cache: {mode} calibration at {b:g} h on {len(tg)} lots ({time.time() - t0:.1f} s)')
    C = pd.concat(parts, ignore_index=True)
    qf = lambda e: float(np.quantile(e, min(1.0, 0.8 * (1 + 1 / len(e)))))
    def table(D):
        Q = {}
        for (b, nr, gr), e in D.groupby(['base', 'nr', 'grade']).E:
            Q[(b, nr, gr)] = (qf(e.values), len(e))
        for (b, nr), e in D.groupby(['base', 'nr']).E:
            Q[(b, nr, '*')] = (qf(e.values), len(e))
        return Q
    Qfit = table(C[C.half == 'fit'])
    T = C[C.half == 'test'].copy()
    T['Q'] = [Qfit[(b, nr, g)][0] if Qfit.get((b, nr, g), (0, 0))[1] >= 50 else Qfit[(b, nr, '*')][0]
              for b, nr, g in zip(T.base, T.nr, T.grade)]
    T['inr'] = (T.y >= np.maximum(0, T.q10 - T.Q) - 1e-9) & (T.y <= T.q90 + T.Q + 1e-9)
    measured = {(b, g): (float(x.inr.mean()), float(x.ape.median()), int(len(x))) for (b, g), x in T.groupby(['base', 'grade'])}
    for g, x in T.groupby('grade'):
        measured[('*', g)] = (float(x.inr.mean()), float(x.ape.median()), int(len(x)))
    return {'Q': table(C), 'measured': measured,
            'window': f"archive lots closed {iso_date(mid)}..{iso_date(last_close)}, ranges fitted on the 45 days before"}


def build_cache(archive, cache_dir):
    t0 = time.time()
    os.makedirs(cache_dir, exist_ok=True)
    meta_out = duckdb(f"COPY (SELECT epoch(max(end_ts)) AS last_close FROM sales) TO '/dev/stdout' (HEADER);", archive)
    last_close = float(meta_out.strip().split('\n')[-1])
    lots_from = pd.to_datetime(last_close - 1300 * DAY, unit='s', utc=True).strftime('%Y-%m-%d')
    states_from = pd.to_datetime(last_close - 520 * DAY, unit='s', utc=True).strftime('%Y-%m-%d')
    duckdb(cache_sql(cache_dir, lots_from, states_from), archive)
    log(f'cache: archive tables exported in {time.time() - t0:.1f} s (lots closed since {lots_from}, states since {states_from})')
    L = pd.read_csv(f'{cache_dir}/lots.csv')
    L['make_k'] = [norm_make(m) for m in L.make]
    L['logp'] = np.log(L.final_bid.astype(float))
    L['year'] = L.year.astype(float)
    L['nr'] = L.no_reserve.astype(int)
    L['cls'] = np.where(L.no_reserve, 'no_reserve', np.where(L.sold & ~L.sold_after, 'sold', 'reserve_not_met'))
    L['t_ref'] = L.anchor_epoch - 72 * 3600
    cidx = comps_index(L)
    ref, level, n = build_levels(L, index=cidx)
    L['comp_ref'], L['comp_level'], L['comp_n'] = ref, level, n
    S = pd.read_csv(f'{cache_dir}/states.csv')
    S = S[S.bid_t > 0].merge(L[['slug', 'cohort', 'make_k', 'year', 'nr', 'cls', 'final_bid', 'f_epoch', 'comp_ref', 'comp_level']], on='slug')
    S['lb'] = np.log(S.bid_t); S['y'] = np.log(S.final_bid) - S.lb; S['z'] = S.lb - S.comp_ref
    S = features(S)
    log(f'cache: price levels and states ready in {time.time() - t0:.1f} s ({len(L)} lots, {len(S)} lot-horizon rows)')
    calib = {mode: calibrate(S, w, last_close, t0, mode) for mode, w in (('price', PRICE_WEIGHTS), ('full', WEIGHTS))}
    cm = CohortMap(pd.read_csv(f'{cache_dir}/all_kinds.csv'))
    AK = pd.read_csv(f'{cache_dir}/all_kinds.csv')
    # a page counts as a car page when at least half its lots are cars (some car pages also hold parts and models)
    kind_of = AK.dropna(subset=['cohort']).groupby('cohort').kind.agg(
        lambda s: 'car' if (s == 'car').mean() >= 0.5 else Counter(s).most_common(1)[0][0]).to_dict()
    cache = {'version': CACHE_VERSION, 'archive': os.path.abspath(archive), 'archive_mtime': os.path.getmtime(archive),
             'archive_size': os.path.getsize(archive), 'last_close': last_close, 'lots': L,
             'states': {g: S[S.g == g].reset_index(drop=True) for g in range(len(GRID))},
             'calib': calib, 'cohort_map': cm, 'kind_of': kind_of, 'comps_index': cidx,
             'built_at': time.time(), 'build_seconds': time.time() - t0}
    with open(f'{cache_dir}/cache.pkl', 'wb') as f:
        pickle.dump(cache, f, protocol=pickle.HIGHEST_PROTOCOL)
    log(f'cache: built in {time.time() - t0:.1f} s')
    return cache


def load_cache(archive, cache_dir, rebuild=False):
    fn = f'{cache_dir}/cache.pkl'
    if not rebuild and os.path.exists(fn):
        with open(fn, 'rb') as f:
            c = pickle.load(f)
        if (c.get('version') == CACHE_VERSION and c['archive_mtime'] == os.path.getmtime(archive)
                and c['archive_size'] == os.path.getsize(archive)):
            return c
        log('cache: archive changed or cache version differs; rebuilding')
    return build_cache(archive, cache_dir)


# ------------------------------------------------------------------------------------------- title -> BaT model page
MAP_SQL = r"""
-- From scripts/market/live-bands.sql (model 31), unchanged: title -> BaT model page, learned from the archive.
CREATE OR REPLACE TEMP MACRO title_year(t) AS try_cast(regexp_extract(t, '\b((?:19|20)\d{2})\b', 1) AS INTEGER);
CREATE OR REPLACE TEMP MACRO after_year(t) AS trim(regexp_extract(t, '\b(?:19|20)\d{2}\b\s+(.*)$', 1));
CREATE OR REPLACE TEMP TABLE known_makes AS
  SELECT make, lower(make) AS lmake, length(make) AS len FROM (SELECT DISTINCT make FROM lots WHERE make IS NOT NULL AND length(make) > 1);
CREATE OR REPLACE TEMP TABLE pool AS
  SELECT slug, year, lower(make) AS lmake, lower(model) AS lmodel, cohort, end_ts
  FROM lots JOIN sales USING (slug) WHERE kind = 'car' AND cohort IS NOT NULL AND make IS NOT NULL AND model IS NOT NULL;
CREATE OR REPLACE TEMP MACRO map_cohorts(targets) AS TABLE
WITH t AS (SELECT *, title_year(title) AS ty, lower(after_year(title)) AS rest FROM query_table(targets)),
m AS (SELECT t.*, k.lmake, row_number() OVER (PARTITION BY t.key ORDER BY k.len DESC) AS rn
      FROM t JOIN known_makes k ON starts_with(t.rest, k.lmake || ' ')),
tm AS (SELECT key, ty, lmake, trim(substr(rest, length(lmake) + 2)) AS lmodel_t FROM m WHERE rn = 1),
cand AS (
  SELECT tm.key, p.cohort, p.year, tm.ty,
         (SELECT count(*) FROM (SELECT unnest(string_split(tm.lmodel_t, ' ')) w, generate_subscripts(string_split(tm.lmodel_t, ' '), 1) i) a
            JOIN (SELECT unnest(string_split(p.lmodel, ' ')) w, generate_subscripts(string_split(p.lmodel, ' '), 1) i) b USING (i, w)) AS lead_words
  FROM tm JOIN pool p ON p.lmake = tm.lmake AND abs(p.year - tm.ty) <= 3
   AND split_part(p.lmodel, ' ', 1) = split_part(tm.lmodel_t, ' ', 1) AND (p.slug <> tm.key)),
best AS (SELECT key, max(lead_words) AS bw FROM cand GROUP BY key),
votes AS (SELECT c.key, c.cohort, count(*) AS n, sum(CASE WHEN c.year = c.ty THEN 1 ELSE 0 END) AS same_year
          FROM cand c JOIN best b ON b.key = c.key AND c.lead_words = b.bw GROUP BY ALL),
ranked AS (SELECT *, n::DOUBLE / sum(n) OVER (PARTITION BY key) AS share,
                  row_number() OVER (PARTITION BY key ORDER BY same_year DESC, n DESC, cohort) AS r FROM votes)
SELECT key, cohort, n AS votes, round(share, 3) AS share FROM ranked WHERE r = 1;
CREATE OR REPLACE TEMP TABLE live AS
  SELECT key, title FROM read_csv('__TSV__', delim = '\t', header = false, quote = '', columns = {'key': 'VARCHAR', 'title': 'VARCHAR'});
COPY (SELECT * FROM map_cohorts('live')) TO '__OUT__' (HEADER);
"""


def map_titles(lots, archive, work):
    tsv = f'{work}/titles.tsv'; out = f'{work}/map.csv'
    with open(tsv, 'w') as f:
        for vid, title in zip(lots.vehicle_id, lots.title):
            f.write(f"{vid}\t{re.sub(r'[\t\r\n]', ' ', str(title or ''))}\n")
    duckdb(MAP_SQL.replace('__TSV__', tsv).replace('__OUT__', out), archive)
    M = pd.read_csv(out) if os.path.getsize(out) > 0 else pd.DataFrame(columns=['key', 'cohort', 'votes', 'share'])
    return M.rename(columns={'key': 'vehicle_id'})


# --------------------------------------------------------------------------------------------------------- the inputs
def load_lots(path):
    d = json.load(open(path))
    if isinstance(d, dict) and 'auctions' in d:
        cols = d.get('columns') or ['id', 'year', 'make', 'model', 'current_bid', 'ends_at', 'updated_at', 'listed_at',
                                    'image_url', 'no_reserve', 'listing_url', 'title', 'band_p10', 'band_p50', 'band_p90',
                                    'band_tier', 'band_comps', 'heat']
        rows = [dict(zip(cols, r)) for r in d['auctions']]
    else:
        rows = d
    L = pd.DataFrame(rows)
    L = L.rename(columns={'id': 'vehicle_id'})
    for c in ['year', 'make', 'model', 'title', 'listing_url', 'as_of', 'no_reserve', 'current_bid']:
        if c not in L.columns:
            L[c] = None
    return L


def load_engagement(path):
    """Per lot, either its own bid and comment rows or counts. Accepted shapes:
       {"<vehicle id>": [rows]}                                  rows: posted_at, bid_amount, author_username, comment_type
       {"<vehicle id>": {"rows": [rows]}}
       {"<vehicle id>": {"bids": n, "bidders": n, "comments": n, "bids_last_24h": n, "last_bid_at": iso, "read_at": iso}}
       [rows carrying vehicle_id]
    Returns {vehicle id: ("rows", DataFrame) or ("counts", dict)}."""
    if not path:
        return {}
    d = json.load(open(path))
    if isinstance(d, list):
        d = {vid: g.to_dict('records') for vid, g in pd.DataFrame(d).groupby('vehicle_id')}
    out = {}
    for vid, v in d.items():
        if isinstance(v, dict) and 'rows' not in v:
            out[vid] = ('counts', v); continue
        rs = v['rows'] if isinstance(v, dict) else v
        B = pd.DataFrame(rs)
        if B.empty:
            continue
        if 'comment_type' not in B.columns:
            B['comment_type'] = np.where(B.bid_amount.notna(), 'bid', 'observation')
        if 'author_username' not in B.columns:
            B['author_username'] = B.get('bidder', B.get('author'))
        B['ts'] = (pd.to_datetime(B.posted_at, utc=True, format='mixed') - pd.Timestamp('1970-01-01', tz='UTC')) / pd.Timedelta(seconds=1)
        out[vid] = ('rows', B)
    return out


def lot_engagement(kind_val, moment):
    """The lot's measures at its moment, and which of them are known."""
    kind, v = kind_val
    f = {'nb_t': np.nan, 'bidders_t': np.nan, 'ncom_t': np.nan, 'nb24': np.nan, 'since_s': np.nan, 'rows_bid': 0.0, 'last_bid_row_at': None}
    if kind == 'rows':
        g = v[v.ts <= moment]                                  # nothing posted after the moment is read
        b = g[(g.comment_type == 'bid') & (g.bid_amount.fillna(0) > 0)].sort_values('ts')
        b = b.drop_duplicates(subset=['author_username', 'bid_amount'], keep='first')   # a re-landed bid counts once
        f.update(nb_t=len(b), bidders_t=b.author_username.nunique(), nb24=int((b.ts > moment - DAY).sum()),
                 rows_bid=float(b.bid_amount.max()) if len(b) else 0.0)
        if len(b):
            f['since_s'] = moment - b.ts.max(); f['last_bid_row_at'] = pd.to_datetime(b.ts.max(), unit='s', utc=True).isoformat()
        else:
            f['since_s'] = np.nan
        if (v.comment_type != 'bid').any():
            f['ncom_t'] = int((g.comment_type != 'bid').sum())
    else:
        for src, dst in [('bids', 'nb_t'), ('bidders', 'bidders_t'), ('comments', 'ncom_t'), ('bids_last_24h', 'nb24')]:
            if v.get(src) is not None:
                f[dst] = float(v[src])
        if v.get('last_bid_at'):
            f['since_s'] = moment - epoch(v['last_bid_at']); f['last_bid_row_at'] = v['last_bid_at']
        if v.get('max_bid') is not None:
            f['rows_bid'] = float(v['max_bid'])
    return f


# ------------------------------------------------------------------------------------------------------------ the run
def interp_q(Q, h, nr, gr):
    """Conformal correction at h hours, interpolated in ln h between the calibration horizons."""
    def at(b):
        v = Q.get((b, nr, gr))
        return v[0] if v and v[1] >= 50 else Q[(b, nr, '*')][0]
    hs = sorted(BASE)
    if h <= hs[0]:
        return at(hs[0])
    if h >= hs[-1]:
        return at(hs[-1])
    for a, b in zip(hs[:-1], hs[1:]):
        if a <= h <= b:
            w = (math.log(h) - math.log(a)) / (math.log(b) - math.log(a))
            return at(a) + (at(b) - at(a)) * w


def nearest_base(h):
    return min(BASE, key=lambda b: abs(math.log(h) - math.log(b)))


def sentence(cover, half, grade):
    """The viewer's sentence, never stronger than the weaker of the archive and prod measurements: A and B say "8 in 10"
    only at 77.5% or above; under that, and for grade C, "About 3 in 4" (72-77.5%) or "About N in 10" (rounded down)."""
    if cover is None:
        return None
    if cover >= 0.775:
        lead = '8 in 10' if grade in ('A', 'B') else 'About 8 in 10'
    elif cover >= 0.72:
        lead = 'About 3 in 4'
    else:
        lead = f'About {int(cover * 10)} in 10'
    s = f"{lead} cars like this finished inside this range."
    if half is not None:
        s += f" Half finished within {round(half * 100)}% of the estimate."
    if grade == 'B':
        s += ' Few close matches, so the range is wider.'
    if grade == 'C':
        s += ' Few past sales of this model, so treat it as rough.'
    return s


def load_coverage(path):
    """The latest prod measurement of the ranges (prod_coverage.json, written by the replay that scores this script on prod
    lots): {"price"|"full": {"A"|"B"|"C": {"coverage", "n", "lots", "window"}}}."""
    try:
        return json.load(open(path))
    except Exception:
        return {}


def tier(p):
    return 'a' if p < 25000 else 'b' if p < 50000 else 'c' if p < 100000 else 'd'


KNOWN_FROM = {'lbidders': 'bidders_t', 'lcom': 'ncom_t', 'l24': 'nb24', 'lsince': 'since_s'}


def run(args):
    t0 = time.time()
    cache = load_cache(args.archive, args.cache, args.rebuild)
    t_cache = time.time() - t0
    lots = load_lots(args.lots)
    eng = load_engagement(args.engagement)
    now = epoch(args.now) if args.now else time.time()
    lots['moment'] = [epoch(a) if isinstance(a, str) and a else now for a in lots.as_of]
    lots['ends'] = [epoch(e) for e in lots.ends_at]
    lots['hours_left'] = (lots.ends - lots.moment) / 3600.0
    early = int((lots.moment < cache['last_close']).sum())
    if early:
        log(f'warning: {early} lots are read before the archive\'s last close ({iso_date(cache["last_close"])}): their analogs and '
            'comparables still closed before their moment, but the range corrections were measured on later lots')
    L = cache['lots']; LS = L.set_index('slug')
    rows_out, skipped = {}, {}
    def skip(vid, why, **extra):
        skipped[vid] = dict({'vehicle_id': vid, 'status': why}, **extra)
    # the lot's measures at its moment (event clock), from its rows or its counts
    feats = []
    for r in lots.itertuples():
        e = eng.get(r.vehicle_id)
        f = lot_engagement(e if e else ('counts', {}), r.moment)
        board = float(r.current_bid) if r.current_bid is not None and not pd.isna(r.current_bid) else 0.0
        f.update(vehicle_id=r.vehicle_id, bid=max(board, f['rows_bid']), bid_source='board' if board >= f['rows_bid'] else 'bid rows',
                 engagement=e[0] if e else 'none')
        feats.append(f)
    lots = lots.merge(pd.DataFrame(feats).drop(columns=['rows_bid']), on='vehicle_id', how='left')
    t_eng = time.time() - t0
    M = map_titles(lots, args.archive, args.cache)
    lots = lots.merge(M[['vehicle_id', 'cohort', 'share']], on='vehicle_id', how='left')
    lots['map_basis'] = np.where(lots.share >= 0.6, 'title -> model page (live-bands.sql map)', None)
    cm = cache['cohort_map']
    for i, r in lots[lots.map_basis.isna()].iterrows():
        c, sh = cm.map(r.make, r.model, float(r.year) if r.year is not None and not pd.isna(r.year) else np.nan)
        lots.at[i, 'cohort'] = c; lots.at[i, 'share'] = sh
        lots.at[i, 'map_basis'] = 'make, model words and year -> model page (fallback)' if c else 'no model page'
    # the live-bands map votes among car lots only, so its pages are car pages; a fallback page carries its own kind
    lots['kind'] = [('car' if basis.startswith('title') else cache['kind_of'].get(c)) if isinstance(c, str) else None
                    for c, basis in zip(lots.cohort, lots.map_basis)]
    lots['make_k'] = [norm_make(m) for m in lots.make]
    lots['year'] = pd.to_numeric(lots.year, errors='coerce')
    lots['nr'] = lots.no_reserve.fillna(False).astype(bool).astype(int)
    t_map = time.time() - t0
    keep = []
    for r in lots.itertuples():
        if not (r.ends == r.ends) or not (r.moment == r.moment):
            skip(r.vehicle_id, 'no close time'); continue
        if r.hours_left <= 0:
            skip(r.vehicle_id, 'closed'); continue
        if r.hours_left > GRID[0]:
            skip(r.vehicle_id, f'more than {GRID[0]} h to close', hours_left=round(r.hours_left, 2)); continue
        if not r.bid or r.bid <= 0:
            skip(r.vehicle_id, 'no bid yet', hours_left=round(r.hours_left, 2)); continue
        if isinstance(r.kind, str) and r.kind != 'car':
            skip(r.vehicle_id, f'not a car lot (its model page {r.cohort} holds {r.kind} lots)', hours_left=round(r.hours_left, 2)); continue
        if not isinstance(r.cohort, str) and r.make_k not in cache['comps_index'][1]:
            skip(r.vehicle_id, 'no model page and no archive car lots of its make', hours_left=round(r.hours_left, 2)); continue
        keep.append(r.Index)
    T = lots.loc[keep].copy()
    if len(T):
        T['t_ref'] = T.moment                                  # comparables closed in [moment - 730 d, moment) of each lot
        T['cohort'] = T.cohort.where(T.cohort.notna(), None)
        ref, level, n = build_levels(T, index=cache['comps_index'])
        T['comp_ref'], T['comp_level'], T['comp_n'] = ref, level, n
        T['lb'] = np.log(T.bid); T['z'] = T.lb - T.comp_ref
        T['lbidders'] = np.log1p(T.bidders_t); T['lcom'] = np.log1p(T.ncom_t); T['l24'] = np.log1p(T.nb24.clip(lower=0))
        T['lsince'] = np.log1p((T.since_s / 3600.0).clip(lower=0))
        T['pattern'] = [tuple(k for k, src in KNOWN_FROM.items() if pd.notna(getattr(r, src))) for r in T.itertuples()]
        T['g'] = [min(range(len(GRID)), key=lambda i: abs(math.log(GRID[i]) - math.log(h))) for h in T.hours_left]
    t_level = time.time() - t0
    cov = load_coverage(args.coverage)
    for (g, nr, pattern), Tg in (T.groupby(['g', 'nr', 'pattern']) if len(T) else []):
        Sg = cache['states'][g]
        pool = Sg[(Sg.nr == nr) & (Sg.f_epoch < Tg.moment.min() - 3600) & (Sg.f_epoch >= Tg.moment.max() - 365 * DAY)].reset_index(drop=True)
        if len(pool) < K:
            for vid in Tg.vehicle_id:
                skip(vid, 'too few finished lots at this hour')
            continue
        mode = 'price' if not pattern else 'full'
        weights = {k: (WEIGHTS[k] if k in ('lb', 'z') or k in pattern else 0.0) for k in FEATS}
        Tf = Tg.copy()
        for k in FEATS:                                        # a measure the lot does not have is left out of the match
            if weights[k] == 0.0:
                Tf[k] = float(pool[k].mean())
        res, named = analog_search(pool, Tf, weights)
        cal = cache['calib'][mode]
        for (_, r), (_, x), picks in zip(Tg.iterrows(), res.iterrows(), named):
            gr = str(grade_of(np.array([r.comp_level]), np.array([int(x.n_same)]))[0])
            Qh = interp_q(cal['Q'], r.hours_left, int(nr), gr)
            est = r.bid * math.exp(x.p50)
            lo = r.bid * math.exp(max(0.0, x.q10 - Qh)); hi = r.bid * math.exp(x.q90 + Qh)
            arch_cover, half, arch_n = cal['measured'].get((nearest_base(r.hours_left), gr), (None, None, 0))
            pc = cov.get(mode, {}).get(gr)                      # the prod replay of this script, same grade and match pattern
            prod_cover, prod_n, prod_window = (pc['coverage'], pc['n'], pc['window']) if pc else (None, 0, None)
            measures = [(c, n_, w) for c, n_, w in ((arch_cover, arch_n, cal['window']), (prod_cover, prod_n, prod_window)) if c is not None]
            cover, cover_n, window = min(measures, key=lambda m: m[0]) if measures else (None, 0, None)
            analogs = []
            for i, why in picks:
                p = pool.iloc[i]; lot = LS.loc[p.slug]
                analogs.append({'url': lot.url, 'title': lot.title, 'closed': iso_date(lot.f_epoch), 'bid': int(round(p.bid_t)),
                                'final': int(lot.final_bid),
                                'outcome': {'sold': 'sold', 'no_reserve': 'sold, no reserve', 'reserve_not_met': 'reserve not met'}[lot.cls]})
            notes = {'grade': gr, 'sentence': sentence(cover, half, gr), 'coverage_n': cover_n, 'coverage_window': window,
                     'coverage_archive': None if arch_cover is None else round(float(arch_cover), 3), 'coverage_archive_n': arch_n,
                     'coverage_prod': None if prod_cover is None else round(float(prod_cover), 3), 'coverage_prod_n': prod_n,
                     'window': {'archive': cal['window'] + f' (horizon {nearest_base(r.hours_left):g} h, grade {gr})', 'prod': prod_window},
                     'comps_through': iso_date(cache['last_close']), 'model_page': r.cohort,
                     'vote_share': None if pd.isna(r.share) else round(float(r.share), 3), 'same_page_analogs': int(x.n_same),
                     'n_analogs': int(min(K, len(pool))),
                     'method': 'analog v1 price-only' if mode == 'price' else 'analog v1 with engagement (' + ', '.join(pattern) + ')',
                     'analogs': analogs}
            rows_out[r.vehicle_id] = {
                'vehicle_id': r.vehicle_id, 'current_bid': int(round(r.bid)), 'hours_remaining': round(r.hours_left, 1),
                'time_window': 'live', 'price_tier': tier(est), 'model_version': 32,
                'comp_median': None if np.isnan(r.comp_ref) else int(round(math.exp(r.comp_ref))), 'comp_count': int(r.comp_n),
                'predicted_hammer': int(round(est, -2)), 'predicted_low': int(round(lo, -2)), 'predicted_high': int(round(hi, -2)),
                'confidence_score': None if cover is None else round(float(cover), 3),
                'predicted_at': pd.to_datetime(r.moment, unit='s', utc=True).isoformat(), 'notes': notes}
    t_end = time.time() - t0
    rows = [rows_out[v] for v in lots.vehicle_id if v in rows_out]
    skipped_list = [{'vehicle_id': v, 'reason': skipped[v]['status'], 'hours_remaining': skipped[v].get('hours_left')}
                    for v in lots.vehicle_id if v in skipped]
    if args.format == 'bundle':
        json.dump(strict({'rows': rows, 'skipped': skipped_list, 'model_version': 32, 'as_of': pd.to_datetime(now, unit='s', utc=True).isoformat(),
                   'comps_through': iso_date(cache['last_close'])}), open(args.out, 'w'), indent=1, allow_nan=False)
    else:
        json.dump(strict(rows), open(args.out, 'w'), indent=1, allow_nan=False)
        json.dump(strict(skipped_list), open(re.sub(r'\.json$', '', args.out) + '.skipped.json', 'w'), indent=1, allow_nan=False)
    log(json.dumps({'lots': len(lots), 'estimated': len(rows), 'skipped': len(skipped_list),
                    'skip_reasons': dict(Counter(x['reason'] if not x['reason'].startswith('not a car') else 'not a car lot' for x in skipped_list)),
                    'seconds': {'cache_load_or_build': round(t_cache, 1), 'engagement': round(t_eng - t_cache, 1), 'title_map': round(t_map - t_eng, 1),
                                'price_levels': round(t_level - t_map, 1), 'analogs': round(t_end - t_level, 1), 'total': round(t_end, 1)}}))
    return rows


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--lots', help='the market_pulse_live payload (required unless --build-cache)')
    ap.add_argument('--engagement', '--bids', dest='engagement', help='optional: bid and comment rows, or counts, per lot (see load_engagement); without it the match is price-only')
    ap.add_argument('--coverage', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prod_coverage.json'), help='the latest prod measurement of the ranges, per mode and grade')
    ap.add_argument('--archive', default=os.path.expanduser('~/nuke/scripts/data/bat-archive.duckdb'))
    ap.add_argument('--cache', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache'))
    ap.add_argument('--now', help='the moment the lots were read (ISO 8601); default: the clock')
    ap.add_argument('--out', default='live_finish_rows.json', help='the list of hammer_predictions model 32 rows; skipped lots go to <out without .json>.skipped.json')
    ap.add_argument('--format', choices=['list', 'bundle'], default='list', help='bundle: one file {rows, skipped, ...} instead')
    ap.add_argument('--rebuild', action='store_true', help='rebuild the cache even if the archive is unchanged')
    ap.add_argument('--build-cache', action='store_true', help='only (re)build the cache, e.g. right after the daily archive append')
    a = ap.parse_args()
    if a.build_cache:
        load_cache(a.archive, a.cache, rebuild=a.rebuild)
    elif not a.lots:
        ap.error('--lots is required')
    else:
        run(a)
