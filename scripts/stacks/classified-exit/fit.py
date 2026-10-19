"""Fit P(gone within 7 days | features) on Facebook listings with a known fate; train before CUT, evaluate after.
Feature names are the ones classified_ask_board computes (20261015150000), so the coefficients transfer as written."""
import csv, math, sys, json
import numpy as np
rows = list(csv.DictReader(open(sys.argv[1])))
CUT = sys.argv[2]
def g(r, k):
    v = r.get(k); return None if v in (None, '', 'NULL') else float(v)
def feats(r):
    ask, n, off, p50, below = g(r,'ask'), g(r,'n'), g(r,'offered'), g(r,'p50'), g(r,'at_or_below')
    an, ap50, ab = g(r,'an'), g(r,'ap50'), g(r,'a_below')
    sold_ok = ask and n and n >= 10 and p50 and below is not None
    ask_ok = ask and an and an >= 10 and ap50
    return {
      'log_ask': math.log(ask) if ask else None,
      'log_sold_p50_over_ask': math.log(p50/ask) if sold_ok else None,
      'share_sold_at_or_below': below/n if sold_ok else None,
      'log_sold_n': math.log(n) if sold_ok else None,
      'sell_through': (n/off if off else None) if sold_ok else None,
      'log_asked_p50_over_ask': math.log(ap50/ask) if ask_ok else None,
      'share_asked_at_or_below': ab/an if ask_ok else None,
      'log_asked_n': math.log(an) if ask_ok else None,
    }
def auc(s, y):
    o = np.argsort(s, kind='mergesort'); r = np.empty(len(s)); r[o] = np.arange(1, len(s) + 1)
    pos = y == 1; P, N = pos.sum(), (~pos).sum()
    a = (r[pos].sum() - P * (P + 1) / 2) / (P * N)
    q1, q2 = a / (2 - a), 2 * a * a / (1 + a)
    se = math.sqrt((a * (1 - a) + (P - 1) * (q1 - a * a) + (N - 1) * (q2 - a * a)) / (P * N))
    return round(float(a), 3), round(se, 3)
def fit(Z, y, l2=1e-3, it=4000, lr=0.5):
    w = np.zeros(Z.shape[1] + 1); A = np.c_[np.ones(len(Z)), Z]
    for _ in range(it):
        p = 1 / (1 + np.exp(-A @ w)); w -= lr * (A.T @ (p - y) / len(y) + l2 * np.r_[0, w[1:]])
    return w
F = [(feats(r), int(r['exit7']), r['fs'][:10]) for r in rows]
out = {'rows': len(F), 'exits': sum(e for _, e, _ in F), 'cut': CUT}
variants = {
  'price_only': ['log_ask'],
  'sold': ['log_sold_p50_over_ask', 'share_sold_at_or_below', 'log_sold_n', 'sell_through', 'log_ask'],
  'asked': ['log_asked_p50_over_ask', 'share_asked_at_or_below', 'log_asked_n', 'log_ask'],
  'both': ['log_sold_p50_over_ask', 'share_sold_at_or_below', 'log_sold_n', 'sell_through',
           'log_asked_p50_over_ask', 'share_asked_at_or_below', 'log_asked_n', 'log_ask'],
}
for vn, names in variants.items():
    sel = [(np.array([f[n] for n in names]), e, d) for f, e, d in F if all(f[n] is not None for n in names)]
    if len(sel) < 200: out[vn] = {'n': len(sel)}; continue
    X = np.array([s[0] for s in sel]); y = np.array([s[1] for s in sel]); d = np.array([s[2] for s in sel])
    tr, te = d < CUT, d >= CUT
    if y[tr].sum() < 20 or y[te].sum() < 10: out[vn] = {'n': len(sel), 'train_exits': int(y[tr].sum()), 'test_exits': int(y[te].sum())}; continue
    mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-9
    w = fit((X[tr] - mu) / sd, y[tr])
    s = np.c_[np.ones(te.sum()), (X[te] - mu) / sd] @ w
    p = 1 / (1 + np.exp(-s)); qs = np.quantile(p, np.linspace(0, 1, 6))
    single = {n: auc(X[te][:, i] * (-1 if n.startswith('share') else 1), y[te]) for i, n in enumerate(names)}
    out[vn] = {'n': len(sel), 'train': int(tr.sum()), 'train_exits': int(y[tr].sum()), 'test': int(te.sum()), 'test_exits': int(y[te].sum()),
      'train_from': min(d[tr].tolist()), 'train_to': max(d[tr].tolist()), 'test_from': min(d[te].tolist()), 'test_to': max(d[te].tolist()),
      'base_rate': round(float(y[tr].mean()), 4), 'auc_test': auc(s, y[te]), 'auc_single_test': single,
      'intercept': round(float(w[0]), 4),
      'features': [{'name': n, 'mean': round(float(m), 5), 'sd': round(float(v), 5), 'coef': round(float(c), 4)} for n, m, v, c in zip(names, mu, sd, w[1:])],
      'calibration_test_quintiles': [{'pred': round(float(p[(p >= a) & (p <= b)].mean()), 3), 'obs': round(float(y[te][(p >= a) & (p <= b)].mean()), 3), 'n': int(((p >= a) & (p <= b)).sum())} for a, b in zip(qs[:-1], qs[1:])]}
print(json.dumps(out, indent=1))
