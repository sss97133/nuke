#!/usr/bin/env python3
"""Where Bring a Trailer's live auctions should finish, written to the prediction ledger as model 33.

Model 33 is model 32's analog read moved by a residual learner. The analog read: the 50 finished BaT lots nearest in bid
and in the bid's position against the model page's usual finish (same no-reserve flag; same page, make and model year
preferred) and their weighted median rise from that hour to the close. The learner (boosted trees on ln(final / analog
estimate), one per horizon: 120, 72, 48, 24, 12, 6, 3, 1 h and 10 min; the nearest one reads each lot) moves it by five
factor families, every factor point-in-time and held by prod as well as the archive:
  trim      the variant and trim words of the title against the model page, mileage, transmission, title flags
  room      bids, bidders, comments, commenters, seller share, questions, words per comment up to the moment
  cultural  the model page's record (lots a year, trend, sell-through, comments, the analog read's past miss there),
            ownership words in the title, the photo count
  markets   other venues' sales of the same make and model words (Mecum, Bonhams, Gooding, PCarMarket, Collecting Cars)
  history   the same car (check-digit-valid VIN) at an earlier BaT close
The 80% range is the analog's 10-90 spread moved by the residual and widened by a conformal correction per horizon x
no-reserve flag x grade measured on archive lots the learner never saw. The estimate is never below the bid. Each row's
notes.factors splits the dollar step from the analog read (core.est32) to the estimate among the families, in whole
dollars that add up (log-mean split; "other" is the learner's move no family accounts for). The backtest block (the
measured miss and in-range share per horizon) rides on the first row of each run only; readers take the newest model 33
row that carries one.
Confidence: confidence_score is the lower of two measured in-range shares for the lot's horizon and grade, the archive
hold-out (car lots closed 2026-04..09, fit A) and the fresh window (2026-09-28..10-14, fit B, the fit that serves);
notes.coverage carries both with their n.
Measured offline (2026-10-15, the finish-model lane's logs): on 25,620-25,673 archive car lots per horizon closed
2026-04..09, median miss 16.6% three days out and 10.9% at ten minutes (model 32: 19.9%, 12.7%). On the 177 lots that
closed 2026-10-15, features built from prod rows and from the archive gave the same estimate at a median difference of
0.00% (90th percentile 3.4-5.2%), the parity gate this writer waited on.

One hourly run, after model 32 in ag.nuke.market-live-finish (a failure here never stops model 32):
  1. the public live board (market_pulse_live, anon key);
  2. lots prod lists as motorcycles (vehicles.canonical_vehicle_type, anon) are skipped; then the due list: each lot's
     latest row from live_finish_estimates() (anon); a lot is due at first sight on model 33,
     when its bid changed, or when it crossed a horizon (120, 72, 48, 24, 12, 6, 3, 1 h, 10 min); when nothing is due the
     lot closing soonest is written, so the reader's two-hour freshness check holds;
  3. the due lots' listing facts and bid and comment rows: live_finish_33_inputs() with the service key, 100 lots per
     call (no usernames, no comment text);
  4. the estimate;
  5. the write: hammer_predictions through PostgREST with the service key and X-Nuke-Writer live-finish-33.

Local only: the model artifacts (fitted learners, range corrections, measured coverage, page-miss table, other venues'
sales) live in LIVE_FINISH_33_DIR, default ~/Library/Caches/nuke-finish-33, and are never committed (the repo is
public). The archive-derived history (lots, pools) is rebuilt there by --build-cache after each daily archive append
(scripts/market/bat-archive-append.sh) from BAT_ARCHIVE, default scripts/data/bat-archive.duckdb.

Run: dotenvx run -- python3 scripts/market/live-finish-33.py [--dry-run] [--out rows.json]
     python3 scripts/market/live-finish-33.py --build-cache       (after the archive append; about a minute)
Needs: python3 with numpy, pandas and scikit-learn, the duckdb CLI; VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and
SUPABASE_SERVICE_ROLE_KEY (the service key only for the inputs read and the write).
"""
import argparse, json, math, os, pickle, re, subprocess, sys, time, urllib.error, urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from io import StringIO
import numpy as np
import pandas as pd

DAY = 86400.0
MODEL_VERSION = 33
H = {'120h': 120.0, '72h': 72.0, '48h': 48.0, '24h': 24.0, '12h': 12.0, '6h': 6.0, '3h': 3.0, '1h': 1.0, '10m': 1 / 6}
HORIZONS = sorted(H.values(), reverse=True)            # the write rule's horizon crossings
MAX_HOURS = 168.0
K = 50
CHUNK = 100                                            # lots per live_finish_33_inputs call (cold read ~1 s at 100)
WRITER = 'live-finish-33'
ART = os.path.expanduser(os.environ.get('LIVE_FINISH_33_DIR', '~/Library/Caches/nuke-finish-33'))
ARCHIVE = os.path.abspath(os.environ.get('BAT_ARCHIVE', 'scripts/data/bat-archive.duckdb'))
CACHE_VERSION = 'live_finish_33_v2.2'
OUTCOME = {'sold': 'sold', 'no_reserve': 'sold, no reserve', 'rnm': 'reserve not met'}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def epoch(s):
    if s is None or (isinstance(s, float) and math.isnan(s)):
        return np.nan
    t = pd.Timestamp(s)
    return (t.tz_convert('UTC') if t.tzinfo else t.tz_localize('UTC')).timestamp()


def iso_date(e):
    return pd.to_datetime(e, unit='s', utc=True).strftime('%Y-%m-%d')


def duckdb(sql, db):
    r = subprocess.run(['duckdb'] + ([] if db == ':memory:' else ['-readonly', db]), input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-2000:])
    return r.stdout


def tier(p):
    return 'a' if p < 25000 else 'b' if p < 50000 else 'c' if p < 100000 else 'd'


# ------------------------------------------------------------------- title words, the same way in the archive and prod
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
    """(make key, model words): the words after the model year; the first is the make (the archive's convention:
    "Land", "Alfa", "Aston"), a two-word make's second word is dropped. The archive's model field is cut to about three
    words and prod's is the whole remainder, so both stores read the title."""
    m = YEAR.search(norm(title))
    if m and toks(m.group(1)):
        t = toks(m.group(1)); mk = t[0]; rest = t[1:]
    else:
        mk = make_key(make); rest = toks(model)
        if rest and rest[0] == mk:
            rest = rest[1:]
    if rest and SECOND.get(mk) == rest[0]:
        rest = rest[1:]
    return mk, rest


FLAGS = [
    "regexp_matches(title, '(?i)\\b(one-owner|original-owner|\\d+-years?-owned|family-owned)\\b') AS t_owned",
    "regexp_matches(title, '(?i)\\b[\\d,.]+k?-mile\\b') AS t_miles",
    "regexp_matches(title, '(?i)-powered\\b') AS t_swap",
    "regexp_matches(title, '(?i)\\b(restomod|modified|custom|lifted|widebody)\\b') AS t_mod",
    "regexp_matches(title, '(?i)\\b(project|non-running|parts)\\b') AS t_project",
    "regexp_matches(title, '(?i)\\b(supercharged|turbocharged|twin-turbo)\\b') AS t_forced",
    "regexp_matches(title, '(?i)\\b[3-7]-speed\\b') AND NOT regexp_matches(title, '(?i)automatic|dual-clutch|pdk|dct|smg') AS t_manual"]

# ------------------------------------------------------------------------------------- lot features from the history
COMMON = {'coupe', 'convertible', 'roadster', 'sedan', 'wagon', 'hatchback', 'cabriolet', 'targa', 'spider', 'spyder', 'pickup', 'truck',
          '2-door', '4-door', '4x4', 'and', 'the', 'w/', 'with', 'project', 'manual', 'automatic'}
TRANSLIT = {**{str(i): i for i in range(10)}, **dict(zip('ABCDEFGH', range(1, 9))), **dict(zip('JKLMN', range(1, 6))), 'P': 7, 'R': 9,
            **dict(zip('STUVWXYZ', range(2, 10)))}
VIN_W = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]


def vin_ok(v):
    """17-character VIN with a valid check digit (position 9), as the archive's vin_checkdigit_ok."""
    if not isinstance(v, str):
        return False
    v = v.strip().upper()
    if len(v) != 17 or any(c not in TRANSLIT for c in v):
        return False
    s = sum(TRANSLIT[c] * w for c, w in zip(v, VIN_W)) % 11
    return v[8] == ('X' if s == 10 else str(s))


def index_by(keys, years, ends, vals):
    d = defaultdict(lambda: defaultdict(list))
    for k, y, e, v in zip(keys, years, ends, vals):
        if k is None or (isinstance(y, float) and math.isnan(y)):
            continue
        d[k][int(y)].append((e, v))
    return {k: {y: (np.array([e for e, _ in sorted(vs)]), np.array([v for _, v in sorted(vs)])) for y, vs in by.items()} for k, by in d.items()}


def level(idx, keys, years, tref, band, min_n, window=730):
    med = np.full(len(keys), np.nan); cnt = np.zeros(len(keys), dtype=int)
    for i, (k, y, t) in enumerate(zip(keys, years, tref)):
        d = idx.get(k)
        if d is None or (isinstance(y, float) and math.isnan(y)):
            continue
        parts = []
        yrs = d.keys() if band is None else range(int(y) - band, int(y) + band + 1)
        for yy in yrs:
            if yy in d:
                e, p = d[yy]
                a = np.searchsorted(e, t - window * DAY, 'left'); b = np.searchsorted(e, t, 'left')
                if b > a:
                    parts.append(p[a:b])
        if parts:
            v = np.concatenate(parts); cnt[i] = len(v)
            if len(v) >= min_n:
                med[i] = np.median(v)
    return med, cnt


class History:
    """Price levels, variant and trim-word premiums, other venues' levels, the same VIN's last close and the model page's
    record, all from lots that closed before each target's t72 (scheduled end minus 72 h, or the moment if earlier)."""
    def __init__(self, L, M):
        coh = L.cohort.where(L.cohort.notna(), None)
        self.pidx = index_by(coh, L.year, L.f_epoch, L.logp)
        self.midx = index_by(L.make_k, L.year, L.f_epoch, L.logp)
        self.vidx = {}
        for k in [1, 2, 3, 4]:
            key = [f'{c}|{" ".join(t[:k])}' if isinstance(c, str) and len(t) >= k else None for c, t in zip(L.cohort, L.mtok)]
            self.vidx[k] = index_by(key, L.year, L.f_epoch, L.logp)
        pairs = [(i, f'{c}|{w}') for i, (c, ts) in enumerate(zip(L.cohort, L.mtok)) if isinstance(c, str)
                 for w in set(ts[1:]) if w not in COMMON and not re.fullmatch(r'\d+-speed', w)]
        pi = np.array([p[0] for p in pairs])
        self.widx = index_by([p[1] for p in pairs], L.year.values[pi], L.f_epoch.values[pi], L.logp.values[pi])
        M = M.copy()
        M['make_k'] = [make_key(b) for b in M.brand]
        M['sale_epoch'] = (pd.to_datetime(M.sale_date, utc=True) - pd.Timestamp('1970-01-01', tz='UTC')) / pd.Timedelta(seconds=1)
        def mtoks(make, model):
            t = toks(model); mk = toks(make)
            while t and t[0] in mk:
                t = t[1:]
            return t
        M['mtok'] = [mtoks(b, m) for b, m in zip(M.brand, M.model)]
        M = M[(M.usd > 0) & M.year.notna()]
        M['logp'] = np.log(M.usd.astype(float))
        self.kidx = {}
        for k in [1, 2]:
            keyM = [f'{mk}|{" ".join(t[:k])}' if len(t) >= k else None for mk, t in zip(M.make_k, M.mtok)]
            self.kidx[k] = index_by(keyM, M.year.astype(float), M.sale_epoch, M.logp)
        self.vin = defaultdict(list)
        for v, f, lp, cls, s in zip(L.vin, L.f_epoch, L.logp, L.cls, L.slug):
            if isinstance(v, str) and len(v) == 17:
                self.vin[v].append((f, lp, cls, s))
        for v in self.vin:
            self.vin[v].sort()
        self.page = {}
        for c, g in L[L.cohort.notna()].groupby('cohort'):
            g = g.sort_values('f_epoch'); res = g.cls.values; is_res = res != 'no_reserve'; sold_res = (res == 'sold') & is_res
            com = np.log1p(g.ncom_final.values.astype(float))
            self.page[c] = (g.f_epoch.values, np.concatenate([[0], np.cumsum(is_res)]), np.concatenate([[0], np.cumsum(sold_res)]),
                            np.concatenate([[0], np.cumsum(com)]))

    def features(self, T):
        T = T.copy().reset_index(drop=True)
        coh = T.cohort.where(T.cohort.notna(), None)
        m1, n1 = level(self.pidx, coh, T.year, T.t72, 3, 5)
        m2, n2 = level(self.pidx, coh, T.year, T.t72, None, 5)
        m3, n3 = level(self.midx, T.make_k, T.year, T.t72, 5, 10)
        T['comp_ref'] = np.where(~np.isnan(m1), m1, np.where(~np.isnan(m2), m2, m3))
        T['comp_level'] = np.where(~np.isnan(m1), 1, np.where(~np.isnan(m2), 2, np.where(~np.isnan(m3), 3, 0)))
        T['comp_n'] = np.where(~np.isnan(m1), n1, np.where(~np.isnan(m2), n2, np.where(~np.isnan(m3), n3, 0)))
        vr = np.full(len(T), np.nan); vd = np.zeros(len(T), dtype=int); vn = np.zeros(len(T), dtype=int)
        for k in [1, 2, 3, 4]:
            key = [f'{c}|{" ".join(t[:k])}' if isinstance(c, str) and len(t) >= k else None for c, t in zip(T.cohort, T.mtok)]
            med, cnt = level(self.vidx[k], key, T.year, T.t72, 3, 5)
            ok = ~np.isnan(med); vr[ok] = med[ok]; vd[ok] = k; vn[ok] = cnt[ok]
        T['var_ref'], T['var_depth'], T['var_n'] = vr, vd, vn
        tmax = np.full(len(T), np.nan); tmin = np.full(len(T), np.nan); tw = np.zeros(len(T))
        for i, (c, ts, y, t, cr) in enumerate(zip(T.cohort, T.mtok, T.year, T.t72, T.comp_ref)):
            if not isinstance(c, str):
                continue
            ws = [w for w in set(ts[1:]) if w not in COMMON and not re.fullmatch(r'\d+-speed', w)]
            if not ws:
                continue
            wm, _ = level(self.widx, [f'{c}|{w}' for w in ws], [y] * len(ws), [t] * len(ws), 3, 5)
            p = wm - cr; p = p[~np.isnan(p)]
            if len(p):
                tmax[i], tmin[i], tw[i] = p.max(), p.min(), len(p)
        T['trim_max'], T['trim_min'], T['trim_words'] = tmax, tmin, tw
        for k, name in [(1, 'mkt1'), (2, 'mkt2')]:
            keyL = [f'{mk}|{" ".join(t[:k])}' if len(t) >= k else None for mk, t in zip(T.make_k, T.mtok)]
            med, cnt = level(self.kidx[k], keyL, T.year, T.t72, 2, 3 if k == 1 else 2, window=1095)
            T[name + '_ref'], T[name + '_n'] = med, cnt
        pl = np.full(len(T), np.nan); pdays = np.full(len(T), np.nan); ps = np.full(len(T), np.nan)
        for i, (v, t, s) in enumerate(zip(T.vin, T.t72, T.slug)):
            if not (isinstance(v, str) and len(v) == 17):
                continue
            prev = [x for x in self.vin.get(v, []) if x[3] != s and x[0] < t]
            if prev:
                f, lp, cls, _ = prev[-1]; pl[i] = lp; pdays[i] = (t - f) / DAY; ps[i] = float(cls != 'rnm')
        T['vin_prev_logp'], T['vin_prev_days'], T['vin_prev_sold'] = pl, pdays, ps
        n365 = np.zeros(len(T)); n730 = np.zeros(len(T)); sell = np.full(len(T), np.nan); pcom = np.full(len(T), np.nan)
        for i, (c, t) in enumerate(zip(T.cohort, T.t72)):
            if c not in self.page:
                continue
            e, cr, cs, cc = self.page[c]
            a365 = np.searchsorted(e, t - 365 * DAY, 'left'); a730 = np.searchsorted(e, t - 730 * DAY, 'left'); b = np.searchsorted(e, t, 'left')
            n365[i] = b - a365; n730[i] = a365 - a730
            nres = cr[b] - cr[a730]; sell[i] = (cs[b] - cs[a730]) / max(nres, 1) if nres >= 5 else np.nan
            ncl = b - a730; pcom[i] = (cc[b] - cc[a730]) / max(ncl, 1) if ncl >= 5 else np.nan
        T['page_n365'] = n365; T['page_trend'] = np.log((n365 + 1) / (n730 + 1)); T['page_sell'] = sell; T['page_com'] = pcom
        return T


def states(bids, coms, moments):
    """The archive build's running measures at each moment: only rows posted at or before t count."""
    out = []
    B = {k: g.sort_values('ts') for k, g in bids.groupby('key')}
    C = {k: g.sort_values('ts') for k, g in coms.groupby('key')}
    for k, t in zip(moments.key, moments.t):
        r = {'key': k}
        b = B.get(k); c = C.get(k)
        bt = b[b.ts <= t] if b is not None else None
        if bt is not None and len(bt):
            b24 = bt[bt.ts <= t - DAY]; b6 = bt[bt.ts <= t - 6 * 3600]
            r.update(bid_t=float(bt.amount.max()), nb_t=len(bt), bidders_t=bt.author.nunique(), since_s=t - bt.ts.max(),
                     nb24=len(bt) - len(b24), nb6=len(bt) - len(b6), new_bidders24=bt.author.nunique() - b24.author.nunique())
        else:
            r.update(bid_t=np.nan, nb_t=0, bidders_t=0, since_s=np.nan, nb24=0, nb6=0, new_bidders24=0)
        ct = c[c.ts <= t] if c is not None else None
        if ct is not None and len(ct):
            r.update(ncom_t=len(ct), commenters_t=ct.author.nunique(), seller_t=int(ct.is_seller.sum()), questions_t=int(ct.has_q.sum()),
                     words_t=int(ct.words.sum()), ncom24=len(ct) - int((ct.ts <= t - DAY).sum()))
        else:
            r.update(ncom_t=0, commenters_t=0, seller_t=0, questions_t=0, words_t=0, ncom24=0)
        r['first_comment_epoch'] = float(c.ts.min()) if c is not None and len(c) else np.nan
        out.append(r)
    return pd.DataFrame(out)


FAMILIES = {'trim': 'T_', 'room': 'R_', 'cultural': 'C_', 'markets': 'M_', 'history': 'H_'}


def add_features(D):
    D = D.copy()
    f = lambda c: D[c].astype(float)
    D['T_z_var'] = D.lb - D.var_ref; D['T_var_prem'] = D.var_ref - D.comp_ref; D['T_var_depth'] = D.var_depth; D['T_var_n'] = np.log1p(D.var_n)
    D['T_trim_max'] = D.trim_max; D['T_trim_min'] = D.trim_min; D['T_trim_words'] = D.trim_words
    D['T_miles'] = np.log1p(D.miles.clip(lower=0)); D['T_year'] = D.year
    for c in ['t_manual', 't_miles', 't_swap', 't_mod', 't_project', 't_forced']:
        D['T_' + c] = f(c)
    D['T_trans_manual'] = D.transmission.astype(str).str.contains('(?i)manual').astype(float)
    n = D.ncom_t.clip(lower=0); nn = n.clip(lower=1)
    live_h = ((D.t_epoch - D.first_comment_epoch) / 3600.0).where(D.first_comment_epoch <= D.t_epoch).clip(lower=1)
    D['R_comments'] = np.log1p(n); D['R_commenters'] = np.log1p(D.commenters_t); D['R_comments24'] = np.log1p(D.ncom24.clip(lower=0))
    D['R_comment_rate'] = np.log1p(n / live_h); D['R_seller_share'] = D.seller_t / nn; D['R_question_share'] = D.questions_t / nn
    D['R_avg_words'] = np.log1p(D.words_t / nn)
    D['R_bids'] = np.log1p(D.nb_t); D['R_bidders'] = np.log1p(D.bidders_t); D['R_bids24'] = np.log1p(D.nb24.clip(lower=0))
    D['R_bids6'] = np.log1p(D.nb6.clip(lower=0)); D['R_new_bidders24'] = np.log1p(D.new_bidders24.clip(lower=0))
    D['R_since_last_bid'] = np.log1p((D.since_s / 3600.0).clip(lower=0)); D['R_bids_per_bidder'] = D.nb_t / D.bidders_t.clip(lower=1)
    D['C_page_n365'] = np.log1p(D.page_n365); D['C_page_trend'] = D.page_trend; D['C_page_sell'] = D.page_sell; D['C_page_com'] = D.page_com
    D['C_t_owned'] = f('t_owned')
    D['C_photos'] = np.log1p(D.n_images)
    D['M_mkt1_vs_page'] = D.mkt1_ref - D.comp_ref; D['M_bid_vs_mkt1'] = D.lb - D.mkt1_ref; D['M_mkt1_n'] = np.log1p(D.mkt1_n)
    D['M_mkt2_vs_page'] = D.mkt2_ref - D.comp_ref; D['M_bid_vs_mkt2'] = D.lb - D.mkt2_ref; D['M_mkt2_n'] = np.log1p(D.mkt2_n)
    D['H_vin_prev_vs_page'] = D.vin_prev_logp - D.comp_ref; D['H_bid_vs_vin_prev'] = D.lb - D.vin_prev_logp
    D['H_vin_prev_days'] = np.log1p(D.vin_prev_days); D['H_vin_prev_sold'] = D.vin_prev_sold
    D['K_p50_32'] = D.p50_32; D['K_width32'] = D.q90_32 - D.q10_32; D['K_z'] = D.z; D['K_lb'] = D.lb; D['K_nr'] = D.nr
    D['K_comp_level'] = D.comp_level; D['K_n_same'] = D.n_same
    return D


# ------------------------------------------------------------------------------------------------ the analog core
KNN_FEATS = ['lb', 'z']


def wq_rows(Y, Wt, qs):
    o = np.argsort(Y, axis=1)
    Ys = np.take_along_axis(Y, o, 1); Ws = np.take_along_axis(Wt, o, 1)
    C = np.cumsum(Ws, 1) / Ws.sum(1, keepdims=True)
    return [Ys[np.arange(len(Y)), np.minimum((C < q).sum(1), Y.shape[1] - 1)] for q in qs]


def knn(pool, tgt, k=K, lam_cohort=1.0, lam_make=0.5, lam_year=0.5, chunk=400):
    """Model 32's price-only analog read: the k nearest pool lots (same no-reserve flag) by bid and page position, with
    page, make and model-year penalties; weighted 10/50/90% of their ln rise and the same-page count."""
    pool = pool.reset_index(drop=True); tgt_index = tgt.index; tgt = tgt.reset_index(drop=True)
    zfill = np.nanmedian(pool.z)
    Pf = pool[KNN_FEATS].copy(); Pf['z'] = pool.z.fillna(zfill)
    Tf = tgt[KNN_FEATS].copy(); Tf['z'] = tgt.z.fillna(zfill)
    mu = Pf.mean(); sd = Pf.std().replace(0, 1)
    P = ((Pf - mu) / sd).values.astype(np.float32); T = ((Tf - mu) / sd).values.astype(np.float32)
    pc = pd.Categorical(pool.cohort.fillna('?')); pcoh = pc.codes; tcoh = pc.categories.get_indexer(tgt.cohort.fillna('?'))      # -1: not in the pool
    pm = pd.Categorical(pool.make_k.fillna('?')); pmake = pm.codes; tmake = pm.categories.get_indexer(tgt.make_k.fillna('?'))
    pyear = pool.year.fillna(-100).values.astype(np.float32); tyear = tgt.year.fillna(-100).values.astype(np.float32)
    pnr = pool.nr.values; tnr = tgt.nr.values; py = pool.y.values.astype(np.float32)
    P2 = (P ** 2).sum(1); n = len(tgt); kk = min(k, len(pool))
    q10 = np.empty(n); p50 = np.empty(n); q90 = np.empty(n); nsame = np.empty(n)
    for s in range(0, n, chunk):
        e = min(n, s + chunk); Tc = T[s:e]
        D2 = (Tc ** 2).sum(1)[:, None] + P2[None, :] - 2 * Tc @ P.T
        np.maximum(D2, 0, out=D2)
        D2 += lam_cohort * (tcoh[s:e, None] != pcoh[None, :]) * (tcoh[s:e, None] >= 0)
        D2 += lam_make * (tmake[s:e, None] != pmake[None, :])
        D2 += lam_year * np.minimum(np.abs(tyear[s:e, None] - pyear[None, :]), 20) / 20.0
        D2 += 1e6 * (tnr[s:e, None] != pnr[None, :])
        ind = np.argpartition(D2, kk - 1, axis=1)[:, :kk]
        d = np.sqrt(np.take_along_axis(D2, ind, 1))
        a, b, c = wq_rows(py[ind], 1.0 / (1.0 + d), [0.1, 0.5, 0.9])
        q10[s:e], p50[s:e], q90[s:e] = a, b, c
        nsame[s:e] = (pcoh[ind] == tcoh[s:e, None]).sum(1)
    return pd.DataFrame({'q10': q10, 'p50': p50, 'q90': q90, 'n_same': nsame}, index=tgt_index)


def grade(comp_level, n_same):
    return np.where((comp_level == 1) & (n_same >= 5), 'A', np.where(comp_level == 1, 'B', 'C'))


def score_rows(X, models, cal):
    """The learner's move per horizon, the 80% ranges (model 33 and model 32's), and each family's contribution by
    baseline substitution; 'other' is the rest of the move, so the parts add up."""
    out = []
    for h, g in X.groupby('horizon'):
        m, feats = models[h]; base = cal['base'][h]
        g = g.copy(); full = m.predict(g[feats]); g['r_hat'] = full
        for fam, pre in FAMILIES.items():
            Xb = g[feats].copy()
            for c in feats:
                if c.startswith(pre):
                    Xb[c] = base[c]
            g['contrib_' + fam] = full - m.predict(Xb)
        g['contrib_other'] = full - g[['contrib_' + f for f in FAMILIES]].sum(axis=1)
        g['p50_33'] = g.p50_32 + g.r_hat
        lo = g.p50_33 + (g.q10_32 - g.p50_32); hi = g.p50_33 + (g.q90_32 - g.p50_32)
        Qg = np.array([cal['Q']['E33']['g'].get((h, nr, gr), cal['Q']['E33']['n'].get((h, nr))) for nr, gr in zip(g.nr, g.grade32)])
        g['L33'] = np.maximum(0, lo - Qg); g['H33'] = hi + Qg
        out.append(g)
    return pd.concat(out)


def lmdi(est32, est33, contrib):
    """Whole-dollar steps from est32 to est33, one per family, that add up exactly ('other' takes the rounding)."""
    d = math.log(est33 / est32) if est32 > 0 and est33 > 0 else 0.0
    lm = (est33 - est32) / d if abs(d) > 1e-12 else est32
    out = {f: int(round(lm * c)) for f, c in contrib.items() if f != 'other'}
    out['other'] = int(round(est33)) - int(round(est32)) - sum(out.values())
    return out


def named_analogs(row, F, k=3):
    """Three past lots for the card: nearest by the analog distance, the lot's own variant first (same page and leading
    title model words, 3 then 2), then the page, then the make."""
    P = F[(F.horizon == row.horizon) & (F.end_epoch < row.t_epoch - 3600) & (F.end_epoch >= row.t_epoch - 365 * DAY) & (F.nr == row.nr)]
    if not len(P):
        return []
    zf = P.z.median()
    d2 = ((P.lb - row.lb) / P.lb.std()) ** 2 + ((P.z.fillna(zf) - (row.z if row.z == row.z else zf)) / P.z.std()) ** 2 \
        + 0.5 * np.minimum(np.abs(P.year - row.year), 20) / 20
    out = []
    for depth in [3, 2]:
        if len(row.mtok) >= depth:
            pre = ' '.join(row.mtok[:depth])
            m = (P.cohort == row.cohort) & ((P.mtext == pre) | P.mtext.str.startswith(pre + ' '))
            for i in d2[m].sort_values().index[:k]:
                if len(out) < k and i not in [o[0] for o in out]:
                    out.append((i, 'same variant'))
        if len(out) >= k:
            break
    for label, m in [('same model page', P.cohort == row.cohort), ('same make', P.make_k == row.make_k)]:
        for i in d2[m].sort_values().index:
            if len(out) >= k:
                break
            if i not in [o[0] for o in out]:
                out.append((i, label))
    return [{'url': P.at[i, 'url'], 'title': P.at[i, 'title'], 'closed': iso_date(P.at[i, 'end_epoch']), 'bid': int(round(math.exp(P.at[i, 'lb']))),
             'final': int(P.at[i, 'final_bid']), 'outcome': OUTCOME.get(P.at[i, 'cls']), 'match': why} for i, why in out[:k]]


# ------------------------------------------------------------------------------------- title -> BaT model page
MAP_SQL = r"""
-- From scripts/market/live-bands.sql (model 31), as model 32 uses it: title -> BaT model page, learned from the archive.
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


class CohortMap:
    """Fallback page map: make key + leading title model words (at least one) + model year -> BaT model page, deepest
    word match first, narrowest year band first. Never maps on the make alone (that guessed a go-kart onto bmw/2002);
    the make's own year-band page only tells what kind of lot an unmapped one is. On 13,652 archive car lots closed
    2026-07..09 with the map learned before 07-01: 96.5% mapped, 95.2% of those exact (model 32's fix, #1737)."""
    def __init__(self, AK):
        idx = defaultdict(lambda: defaultdict(list))
        for ttl, mk, md, c, y in zip(AK.title, AK.make, AK.model, AK.cohort, AK.year):
            if not isinstance(c, str):
                continue
            k, t = title_parts(ttl, mk, md)
            for n in range(0, min(4, len(t)) + 1):
                idx[k][tuple(t[:n])].append((c, y))
        self.idx = {m: dict(v) for m, v in idx.items()}

    def _vote(self, cands, year, bands):
        for band in bands:
            sel = [c for c, y in cands if band is None or (y is not None and not math.isnan(y) and abs(y - year) <= band)]
            if len(sel) >= 3:
                c, sh = Counter(sel).most_common(1)[0]
                return c, sh / len(sel)
        return None, 0.0

    def map(self, mk, words, year):
        if mk not in self.idx:
            return None, 0.0
        has_year = year is not None and not (isinstance(year, float) and math.isnan(year))
        for n in range(min(4, len(words)), 0, -1):
            cands = self.idx[mk].get(tuple(words[:n]))
            if cands and len(cands) >= 3:
                c, sh = self._vote(cands, year, ([0, 1, 2, 4] if has_year else []) + [None])
                if c:
                    return c, sh
        return None, 0.0

    def make_page(self, mk, year):
        cands = self.idx.get(mk, {}).get(())
        if not cands or year is None or (isinstance(year, float) and math.isnan(year)):
            return None
        return self._vote(cands, year, [0, 1, 2, 4, 8])[0]


# ------------------------------------------------------------------------------------- the history cache (daily)
BUILD_SQL = """
SET threads = 8;
SET TimeZone = 'UTC';
CREATE TEMP TABLE lb AS
SELECT l.slug, s.url, l.title, l.year, l.make, l.model, l.cohort, s.no_reserve, s.sold,
       coalesce(ls.sold_after_reserve_not_met, false) AS sold_after, s.final_bid, s.end_ts AS f,
       CASE WHEN l.vin_checkdigit_ok THEN l.vin END AS vin
FROM lots l JOIN sales s USING (slug) LEFT JOIN lot_stats ls USING (slug)
WHERE l.kind = 'car' AND NOT coalesce(ls.withdrawn, false) AND s.final_bid > 0 AND s.end_ts >= TIMESTAMPTZ '2018-01-01';
CREATE TEMP TABLE bids AS
SELECT e.slug, e.posted_at, e.bid_amount FROM events e JOIN lb USING (slug)
WHERE e.kind = 'bid' AND e.bid_amount > 0 AND e.posted_at IS NOT NULL AND lb.f >= TIMESTAMPTZ '__POOL_FROM__';
CREATE TEMP TABLE anchor AS
WITH b AS (SELECT slug, posted_at t, lead(posted_at) OVER (PARTITION BY slug ORDER BY posted_at) nt
           FROM bids JOIN lb USING (slug) WHERE posted_at >= lb.f - INTERVAL '6 hours'),
lastb AS (SELECT slug, max(t) last_t FROM b GROUP BY 1),
brk AS (SELECT slug, max(t) FILTER (WHERE epoch(nt) - epoch(t) > 120) last_break FROM b GROUP BY 1),
cs AS (SELECT b.slug, min(b.t) run_start FROM b JOIN brk USING (slug) WHERE brk.last_break IS NULL OR b.t > brk.last_break GROUP BY 1)
SELECT l.slug, CASE WHEN x.last_t IS NOT NULL AND epoch(l.f) - epoch(x.last_t) <= 125 THEN cs.run_start ELSE l.f END AS anchor
FROM lb l LEFT JOIN lastb x USING (slug) LEFT JOIN cs USING (slug);
CREATE TEMP TABLE bid_run AS
SELECT slug, posted_at, max(run_max) run_max FROM (
  SELECT slug, posted_at, max(bid_amount) OVER (PARTITION BY slug ORDER BY posted_at, bid_amount ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) run_max
  FROM bids) GROUP BY 1, 2;
CREATE TEMP TABLE hz AS SELECT * FROM (VALUES __HZ__) v(horizon, hours);
CREATE TEMP TABLE q AS
SELECT an.slug, hz.horizon, an.anchor - to_microseconds(CAST(hz.hours * 3600e6 AS BIGINT)) AS t
FROM anchor an JOIN lb USING (slug) CROSS JOIN hz WHERE lb.f >= TIMESTAMPTZ '__POOL_FROM__';
COPY (SELECT q.slug, q.horizon, b.run_max bid_t FROM q ASOF LEFT JOIN bid_run b ON q.slug = b.slug AND q.t >= b.posted_at)
  TO '__DIR__/pool_states.csv' (HEADER);
COPY (SELECT l.slug, l.url, l.title, l.year, l.make, l.model, l.cohort, l.no_reserve, l.sold, l.sold_after, l.final_bid, l.vin,
             epoch(l.f) f_epoch, epoch(coalesce(an.anchor, l.f)) anchor_epoch,
             (SELECT count(*) FROM events c WHERE c.slug = l.slug AND c.kind = 'comment') ncom_final
      FROM lb l LEFT JOIN anchor an USING (slug)) TO '__DIR__/lots.csv' (HEADER);
COPY (SELECT slug, year, make, model, title, cohort, kind FROM lots) TO '__DIR__/all_kinds.csv' (HEADER);
"""


def build_cache(archive=ARCHIVE, art=ART):
    """The archive-derived history the scorer reads: every car lot since 2018 (price levels, variants, trim words, VIN
    history, page records) and the analog pools (lots closed in the last 400 days, bid at each horizon before the
    anchor). Writes <art>/history.pkl. About a minute; read-only on the archive."""
    t0 = time.time()
    last = float(duckdb("COPY (SELECT epoch(max(end_ts)) FROM sales) TO '/dev/stdout' (HEADER);", archive).strip().split('\n')[-1])
    pool_from = pd.to_datetime(last - 400 * DAY, unit='s', utc=True).strftime('%Y-%m-%d')
    hz = ', '.join(f"('{h}', {v!r})" for h, v in H.items())
    duckdb(BUILD_SQL.replace('__POOL_FROM__', pool_from).replace('__HZ__', hz).replace('__DIR__', art), archive)
    L = pd.read_csv(f'{art}/lots.csv', low_memory=False)
    L['cls'] = np.where(L.no_reserve, 'no_reserve', np.where(L.sold & ~L.sold_after, 'sold', 'rnm'))
    L['logp'] = np.log(L.final_bid.astype(float)); L['year'] = L.year.astype(float)
    L['make_k'] = L.make.fillna('?').str.strip().str.lower()
    L['mtok'] = [title_parts(t, mk, md)[1] for t, mk, md in zip(L.title, L.make, L.model)]
    L['mtext'] = L.mtok.map(' '.join)
    L['t72'] = L.anchor_epoch - 72 * 3600
    M = pd.read_csv(f'{art}/family_sales_non_bat.csv')
    hist = History(L, M)
    Lp = L[L.f_epoch >= last - 400 * DAY].copy()
    Lp = hist.features(Lp[['slug', 'cohort', 'make_k', 'year', 'mtok', 't72', 'vin']]).merge(
        Lp[['slug', 'url', 'title', 'mtext', 'no_reserve', 'cls', 'final_bid', 'logp', 'f_epoch']], on='slug')
    S = pd.read_csv(f'{art}/pool_states.csv')
    F = S[S.bid_t > 0].merge(Lp, on='slug')
    F['lb'] = np.log(F.bid_t); F['y'] = F.logp - F.lb; F['z'] = F.lb - F.comp_ref; F['nr'] = F.no_reserve.astype(int); F['end_epoch'] = F.f_epoch
    F = F[['slug', 'url', 'title', 'mtext', 'horizon', 'end_epoch', 'lb', 'z', 'y', 'cohort', 'make_k', 'year', 'nr', 'cls', 'final_bid']]
    AK = pd.read_csv(f'{art}/all_kinds.csv')
    kind_of = AK.dropna(subset=['cohort']).groupby('cohort').kind.agg(
        lambda s: 'car' if (s == 'car').mean() >= 0.5 else Counter(s).most_common(1)[0][0]).to_dict()
    h = {'version': CACHE_VERSION, 'built_at': time.time(), 'last_close': last, 'archive_mtime': os.path.getmtime(archive),
         'L': L[['slug', 'cohort', 'make_k', 'year', 'mtok', 'f_epoch', 'logp', 'vin', 'cls', 'ncom_final']], 'F': F.reset_index(drop=True),
         'AK': AK[['title', 'make', 'model', 'cohort', 'year']], 'kind_of': kind_of}
    with open(f'{art}/history.pkl', 'wb') as f:
        pickle.dump(h, f, protocol=pickle.HIGHEST_PROTOCOL)
    for fn in ('lots.csv', 'pool_states.csv', 'all_kinds.csv'):
        os.remove(f'{art}/{fn}')
    log(f'history: {len(L)} lots through {iso_date(last)}, {len(F)} pool rows, built in {time.time() - t0:.1f} s')
    return h


def load_artifacts(art=ART):
    """The fitted model (local, never committed): learners and range corrections per horizon, measured coverage, the
    backtest block, the page-miss table and other venues' sales; plus the archive history (rebuilt when stale)."""
    need = ['models.pkl', 'calib.pkl', 'coverage_archive.json', 'coverage_fresh.json', 'backtest.json', 'page_miss.pkl', 'family_sales_non_bat.csv']
    missing = [f for f in need if not os.path.exists(f'{art}/{f}')]
    if missing:
        raise SystemExit(f'model 33 artifacts missing in {art}: {", ".join(missing)}')
    hp = f'{art}/history.pkl'
    h = pickle.load(open(hp, 'rb')) if os.path.exists(hp) else None
    if h is None or h.get('version') != CACHE_VERSION or (os.path.exists(ARCHIVE) and h.get('archive_mtime', 0) < os.path.getmtime(ARCHIVE) - 600):
        log('history: missing, old or behind the archive; rebuilding')
        h = build_cache()
    a = {'models': pickle.load(open(f'{art}/models.pkl', 'rb')), 'calib': pickle.load(open(f'{art}/calib.pkl', 'rb')),
         'cov_archive': json.load(open(f'{art}/coverage_archive.json')), 'cov_fresh': json.load(open(f'{art}/coverage_fresh.json')),
         'backtest': json.load(open(f'{art}/backtest.json')), 'MF': pd.read_pickle(f'{art}/page_miss.pkl')}
    a.update(h)
    a['hist'] = History(h['L'], pd.read_csv(f'{art}/family_sales_non_bat.csv'))
    a['cohort_map'] = CohortMap(h['AK'])
    return a


# ------------------------------------------------------------------------------------------------- PostgREST
def rest(path, key, method='GET', body=None, prefer=None, timeout=60):
    url = os.environ['VITE_SUPABASE_URL']
    headers = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'X-Nuke-Writer': WRITER}
    if prefer:
        headers['Prefer'] = prefer
    req = urllib.request.Request(f'{url}/rest/v1/{path}', method=method, headers=headers,
                                 data=None if body is None else json.dumps(body, default=str).encode())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'{method} {path[:60]}: HTTP {e.code} {e.read()[:300]!r}')


def board(anon):
    d = rest('rpc/market_pulse_live', anon, 'POST', {})
    cols = d.get('columns') or []
    L = pd.DataFrame([dict(zip(cols, r)) for r in d.get('auctions', [])]).rename(columns={'id': 'vehicle_id'})
    return L


def latest_rows(anon, ids):
    """Each lot's latest finish row as the board reads it (live_finish_estimates: model 33 when its writer is fresh,
    else model 32). Only model 33 rows count for the write rule."""
    out = {}
    for s in range(0, len(ids), 500):
        d = rest('rpc/live_finish_estimates', anon, 'POST', {'p_vehicle_ids': ids[s:s + 500]})
        cols = d.get('columns') or []
        for r in d.get('rows') or []:
            x = dict(zip(cols, r))
            if x.get('model') == MODEL_VERSION:
                out[x['vehicle_id']] = x
    return out


def read_inputs(service, ids):
    lots, coms = {}, defaultdict(list)
    for s in range(0, len(ids), CHUNK):
        t = time.time()
        d = rest('rpc/live_finish_33_inputs', service, 'POST', {'p_vehicle_ids': ids[s:s + CHUNK]})
        lc, cc = d['lot_columns'], d['comment_columns']
        for r in d['lots']:
            x = dict(zip(lc, r)); lots[x['vehicle_id']] = x
        for r in d['comments']:
            x = dict(zip(cc, r)); coms[x['vehicle_id']].append(x)
        log(f'inputs: {len(ids[s:s + CHUNK])} lots, {len(d["comments"])} rows, {time.time() - t:.2f} s')
    return lots, coms


# ------------------------------------------------------------------------------------------------- the run
def nearest_h(hours):
    return min(H, key=lambda h: abs(math.log(max(hours, 1 / 60)) - math.log(H[h])))


def due(lots, prior):
    crossed = lambda before, after: any(before > h >= after for h in HORIZONS)
    out = []
    for r in lots.itertuples():
        p = prior.get(r.vehicle_id)
        if p is None:
            out.append(r.vehicle_id); continue
        bid = float(r.current_bid or 0)
        p_hours = (r.ends - epoch(p['estimated_at'])) / 3600.0 if p.get('estimated_at') else None
        if float(p.get('bid_at_estimate') or 0) != bid or (p_hours is not None and crossed(p_hours, r.hours_left)):
            out.append(r.vehicle_id)
    return out


def skip_row(v, why, h=None):
    return {'vehicle_id': v, 'reason': why, 'hours_remaining': None if h is None or h != h else round(float(h), 2)}


NOT_CARS = {'MOTORCYCLE'}     # vehicles.canonical_vehicle_type never priced as a car (TRAILER is not used: a Scout II carried it)


def read_kinds(anon, ids):
    """vehicles.canonical_vehicle_type for the board's lots (anon-readable), 200 ids a request."""
    out = {}
    for s in range(0, len(ids), 200):
        for v in rest(f"vehicles?select=id,canonical_vehicle_type&id=in.({','.join(ids[s:s + 200])})", anon) or []:
            if v.get('canonical_vehicle_type'):
                out[v['id']] = v['canonical_vehicle_type']
    return out


def prepare(lots, a, kinds=None):
    """Title words, model page (the model 31 title map, then the make-and-words fallback), page kind and the lots model 33
    can price, before any prod read. Returns the lots kept and the skips."""
    skipped = []
    T = lots.copy()
    P = [title_parts(t, mk, md) for t, mk, md in zip(T.title, T.make, T.model)]
    T['make_k'] = [p[0] for p in P]; T['mtok'] = [p[1] for p in P]
    Mp = map_titles(T, ARCHIVE, ART)
    T = T.merge(Mp[['vehicle_id', 'cohort', 'share']], on='vehicle_id', how='left')
    T['basis'] = np.where(T.share >= 0.6, 'title', None)
    for i, r in T[T.basis.isna()].iterrows():
        yr = float(r.year) if r.year is not None and not pd.isna(r.year) else np.nan
        c, sh = a['cohort_map'].map(r.make_k, r.mtok, yr)
        T.at[i, 'cohort'] = c; T.at[i, 'share'] = sh; T.at[i, 'basis'] = 'fallback' if c else 'none'
    T['year'] = pd.to_numeric(T.year, errors='coerce')
    T['kind'] = [('car' if b == 'title' else a['kind_of'].get(c)) if isinstance(c, str)
                 else a['kind_of'].get(a['cohort_map'].make_page(mk, float(y) if y is not None and not pd.isna(y) else np.nan))
                 for c, b, mk, y in zip(T.cohort, T.basis, T.make_k, T.year)]
    T['nr'] = T.no_reserve.fillna(False).astype(bool).astype(int)
    known = set(a['L'].make_k); keep = []
    for r in T.itertuples():
        if not (r.ends == r.ends):
            skipped.append(skip_row(r.vehicle_id, 'no close time'))
        elif r.hours_left <= 0:
            skipped.append(skip_row(r.vehicle_id, 'closed', r.hours_left))
        elif r.hours_left > MAX_HOURS:
            skipped.append(skip_row(r.vehicle_id, f'more than {MAX_HOURS:g} h to close', r.hours_left))
        elif not float(r.current_bid or 0) > 0:
            skipped.append(skip_row(r.vehicle_id, 'no bid yet', r.hours_left))
        elif (kinds or {}).get(r.vehicle_id) in NOT_CARS:
            skipped.append(skip_row(r.vehicle_id, f'not a car lot (listed as a {kinds[r.vehicle_id].lower()})', r.hours_left))
        elif isinstance(r.kind, str) and r.kind != 'car':
            skipped.append(skip_row(r.vehicle_id, 'not a car lot', r.hours_left))
        elif not isinstance(r.cohort, str) and r.make_k not in known:
            skipped.append(skip_row(r.vehicle_id, 'no model page and no archive car lots of its make', r.hours_left))
        else:
            keep.append(r.Index)
    return T.loc[keep].copy(), skipped


def score(T, facts, coms, a):
    """Model 33 rows for prepared lots (prepare()) from their facts and bid and comment rows; returns rows and skips."""
    skipped = {}
    def skip(v, why, h=None):
        skipped[v] = skip_row(v, why, h)
    for v, h in T[~T.vehicle_id.isin(facts)][['vehicle_id', 'hours_left']].values:
        skip(v, 'no inputs read', h)
    T = T[T.vehicle_id.isin(facts)].copy()
    if not len(T):
        return [], list(skipped.values())
    f = lambda v, k: facts.get(v, {}).get(k)
    T['miles'] = [float(f(v, 'mileage')) if f(v, 'mileage') is not None else np.nan for v in T.vehicle_id]
    T['transmission'] = [f(v, 'transmission') for v in T.vehicle_id]
    T['n_images'] = [float(f(v, 'image_count')) if f(v, 'image_count') is not None else np.nan for v in T.vehicle_id]
    T['vin'] = [str(f(v, 'vin')).strip().upper() if vin_ok(f(v, 'vin')) else None for v in T.vehicle_id]
    vals = ', '.join("('{}', '{}')".format(v, str(t or '').replace("'", "''")) for v, t in zip(T.vehicle_id, T.title))
    T = T.merge(pd.read_csv(StringIO(duckdb(f"COPY (SELECT vehicle_id, {', '.join(FLAGS)} FROM (VALUES {vals}) l(vehicle_id, title)) "
                                            "TO '/dev/stdout' (HEADER);", ':memory:'))), on='vehicle_id', how='left')
    B, C = [], []
    for v in T.vehicle_id:
        for r in coms.get(v, []):
            ts = epoch(r['posted_at']); amt = pd.to_numeric(r.get('bid_amount'), errors='coerce')
            if r.get('comment_type') == 'bid' and amt == amt and amt > 0:
                B.append((v, ts, float(amt), r.get('author_key')))
            elif r.get('comment_type') not in ('bid', 'sold'):
                C.append((v, ts, r.get('author_key'), bool(r.get('is_seller')), bool(r.get('has_question')), int(r.get('word_count') or 0)))
    B = pd.DataFrame(B, columns=['key', 'ts', 'amount', 'author']); C = pd.DataFrame(C, columns=['key', 'ts', 'author', 'is_seller', 'has_q', 'words'])
    S = states(B, C, pd.DataFrame({'key': T.vehicle_id, 't': T.moment}))
    T = T.merge(S.rename(columns={'key': 'vehicle_id'}), on='vehicle_id', how='left')
    T['bid'] = np.maximum(pd.to_numeric(T.current_bid, errors='coerce').fillna(0.0), T.bid_t.fillna(0.0))
    for v, h in T[T.bid <= 0][['vehicle_id', 'hours_left']].values:
        skip(v, 'no bid yet', h)
    T = T[T.bid > 0].copy()
    if not len(T):
        return [], list(skipped.values())
    T['slug'] = T.listing_url.astype(str).str.extract(r'/listing/([^/?#]+)', expand=False).str.lower()
    T['t72'] = np.minimum(T.ends - 72 * 3600, T.moment); T['t_epoch'] = T.moment
    T['horizon'] = [nearest_h(h) for h in T.hours_left]
    T = a['hist'].features(T)
    T['lb'] = np.log(T.bid); T['z'] = T.lb - T.comp_ref
    F = a['F']; parts = []
    for h, g in T.groupby('horizon'):
        cut = g.moment.min() - 3600
        r = knn(F[(F.horizon == h) & (F.end_epoch < cut) & (F.end_epoch >= cut - 365 * DAY)], g)
        g = g.copy(); g['q10_32'], g['p50_32'], g['q90_32'], g['n_same'] = r.q10.values, r.p50.values, r.q90.values, r.n_same.values
        parts.append(g)
    T = pd.concat(parts)
    T['grade32'] = grade(T.comp_level.values, T.n_same.values)
    T = add_features(T)
    MF = a['MF']; pm = []
    for c, h, t72 in zip(T.cohort, T.horizon, T.t72):
        g = MF[(MF.cohort == c) & (MF.horizon == h) & (MF.end_epoch < t72) & (MF.end_epoch >= t72 - 730 * DAY)] if isinstance(c, str) else MF.iloc[:0]
        pm.append((g.r.mean() if len(g) >= 3 else np.nan, np.log1p(len(g))))
    T['C_page_miss32'] = [p[0] for p in pm]; T['C_page_miss32_n'] = [p[1] for p in pm]
    T = score_rows(T, a['models'], a['calib'])
    rows = []
    for r in T.itertuples():
        p50 = max(float(r.p50_33), 0.0); p32 = max(float(r.p50_32), 0.0)
        est33 = r.bid * math.exp(p50); est32 = r.bid * math.exp(p32)
        lo = r.bid * math.exp(min(float(r.L33), p50)); hi = r.bid * math.exp(max(float(r.H33), p50))
        contrib = {fam: float(getattr(r, 'contrib_' + fam)) for fam in list(FAMILIES) + ['other']}
        contrib['other'] += (p50 - float(r.p50_33)) - (p32 - float(r.p50_32))
        cell = f'{r.horizon}|{r.grade32}'
        ca, cf = a['cov_archive']['cells'].get(cell), a['cov_fresh']['cells'].get(cell)
        low = min([x for x in (ca, cf) if x], key=lambda x: x['value']) if (ca or cf) else None
        coverage = None if low is None else {
            'value': low['value'], 'source': a['cov_archive']['source'] if low is ca else a['cov_fresh']['source'], 'n': low['n'],
            'archive': None if ca is None else {'value': ca['value'], 'n': ca['n'], 'source': a['cov_archive']['source']},
            'fresh': None if cf is None else {'value': cf['value'], 'n': cf['n'], 'source': a['cov_fresh']['source']}}
        try:
            analogs = named_analogs(r, a['F'])
        except Exception as e:                                # a card without analogs is still a card
            log(f'analogs: {r.vehicle_id}: {e}'); analogs = []
        notes = {'grade': r.grade32, 'coverage': coverage, 'comps_through': iso_date(a['last_close']),
                 'model_page': r.cohort if isinstance(r.cohort, str) else None,
                 'vote_share': None if pd.isna(r.share) else round(float(r.share), 3), 'same_page_analogs': int(r.n_same), 'n_analogs': K,
                 'horizon_model': r.horizon, 'method': 'model 33 v2: analog core (price-only) + residual learner (trim, room, cultural, markets, history)',
                 'factors': {'core': {'est32': int(round(est32))}, **lmdi(est32, est33, contrib)}, 'analogs': analogs}
        hammer = int(round(est33, -2))
        rows.append({'vehicle_id': r.vehicle_id, 'current_bid': int(round(r.bid)), 'hours_remaining': round(float(r.hours_left), 1),
                     'time_window': 'live', 'price_tier': tier(est33), 'model_version': MODEL_VERSION,
                     'comp_median': None if np.isnan(r.comp_ref) else int(round(math.exp(r.comp_ref))), 'comp_count': int(r.comp_n),
                     'predicted_hammer': hammer, 'predicted_low': min(int(round(lo, -2)), hammer), 'predicted_high': max(int(round(hi, -2)), hammer),
                     'confidence_score': None if coverage is None else coverage['value'],
                     'predicted_at': datetime.fromtimestamp(float(r.moment), timezone.utc).isoformat(timespec='milliseconds'),
                     'notes': json.dumps(notes, default=str)})
    return rows, list(skipped.values())


def run(args):
    t0 = time.time()
    anon = os.environ.get('VITE_SUPABASE_ANON_KEY'); service = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not os.environ.get('VITE_SUPABASE_URL') or not anon or not service:
        raise SystemExit('VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required (dotenvx run --)')
    a = load_artifacts()
    lots = board(anon)
    now = time.time()
    lots['moment'] = now
    lots['ends'] = [epoch(e) for e in lots.ends_at]
    lots['hours_left'] = (lots.ends - lots.moment) / 3600.0
    lots = lots[(lots.hours_left > 0) & (lots.hours_left <= MAX_HOURS)].copy()
    T, skipped = prepare(lots.reset_index(drop=True), a, read_kinds(anon, lots.vehicle_id.tolist()))
    prior = latest_rows(anon, T.vehicle_id.tolist())
    ids = due(T, prior)
    if not ids and len(T):
        ids = [T.sort_values('hours_left').vehicle_id.iloc[0]]             # keep the reader's freshness alive
    facts, coms = read_inputs(service, ids) if ids else ({}, {})
    rows, skipped2 = score(T[T.vehicle_id.isin(ids)].reset_index(drop=True), facts, coms, a)
    skipped += skipped2
    if args.out:
        json.dump({'rows': rows, 'skipped': skipped}, open(args.out, 'w'), indent=1, default=str)
    if args.dry_run:
        print(json.dumps({'dry_run': True, 'live': len(lots), 'due': len(ids), 'estimated': len(rows), 'skipped': len(skipped),
                          'skip_reasons': dict(Counter(s['reason'] for s in skipped)), 'seconds': round(time.time() - t0, 1)}))
        return
    if rows:                                              # the backtest block once per run, on the first row written:
        n0 = json.loads(rows[0]['notes']); n0['backtest'] = a['backtest']; rows[0]['notes'] = json.dumps(n0, default=str)
    for s in range(0, len(rows), 200):                    # about 2 KB a row with its notes: 0.4 MB a request
        rest('hammer_predictions', service, 'POST', rows[s:s + 200], prefer='return=minimal')
    print(json.dumps({'model': MODEL_VERSION, 'live': len(lots), 'due': len(ids), 'written': len(rows), 'skipped': len(skipped),
                      'skip_reasons': dict(Counter(s['reason'] for s in skipped)), 'seconds': round(time.time() - t0, 1)}))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dry-run', action='store_true', help='read and score; write nothing')
    ap.add_argument('--out', help='also save the rows and skips to this JSON file')
    ap.add_argument('--build-cache', action='store_true', help='rebuild the archive history (after the daily archive append) and exit')
    a = ap.parse_args()
    os.makedirs(ART, exist_ok=True)
    if a.build_cache:
        build_cache()
    else:
        run(a)
