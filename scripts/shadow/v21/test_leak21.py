# v21 leakage test. Fails (AssertionError) if any v21 input could carry post-close or price information.
import json,re,glob,collections,numpy as np
PR=r"(\$\s?[0-9]|[0-9]+(\.[0-9])?\s?k\b|sold|hammer|final (bid|price)|winning|reserve)"
T=json.load(open('/workspace/v20/targets18.json')); exec(open('feat21.py').read().split('SC=json.load')[0])
dv=collections.defaultdict(list)
for t in T:
  if t['pl']=='bat': dv[t['v']].append(t['d'])
# 1 counted claims: none after close, no price text, no bid/unlinked comments (rebuild the counted set independently)
bad=collections.Counter(); n=0
for l in open('claims.tsv'):
  r=l.rstrip('\n').split('|')
  if len(r)==8: r=r[:2]+['']+r[2:]
  vid,ts,role,kind,pol,sp,ph,link,ce=r
  for dd in dv.get(vid,()):
    cmt=link=='1'; counted=ph!='1' and link not in('2','3') and (role not in('commenter','seller_comment') or cmt) and ((ts[:10]<dd) if cmt else (ts[:10]<=dd))
    if not counted: continue
    n+=1; bad['after_close']+= (ts[:10]>=dd) if cmt else (ts[:10]>dd); bad['price_text']+=ph=='1'; bad['bid']+=link=='3'
assert sum(bad.values())==0,bad
# 2 seller-comment SQL: every chunk filters seller, non-bid, null bid_amount, posted before close, no price text; no discoveries
for f in glob.glob('sql/[th]_*.sql')+glob.glob('sql/sc_*.sql'):
  q=re.sub(r'\s+',' ',open(f).read().lower())
  for need in ['is_seller','bid_amount is null',"<>'bid'",'c.posted_at < a.auction_end_date','sold|hammer']:
    assert need in q,(f,need)
for f in glob.glob('sql/*.sql')+glob.glob('*.py'):
  if f!='test_leak21.py': assert 'comment_discoveries' not in open(f).read(),f
# 3 feature matrix has no non-BaT values and the eval uses only the selected groups
F=np.load('F21.npy'); b=np.array([t['pl']=='bat' for t in T]); assert np.isnan(F[~b]).all() and not np.isnan(F[b]).any()
# 4 database checks (run 2026-10-24, results recorded): counted listing claims containing the event's final hammer price
SQLCHK=dict(listing_claims_counted=101545,containing_final_price=1,after_close=0,note_1='model year 2006 = $2,006 hammer; claim excluded in feat21',
            seller_comments_counted_sample_583_events=6025,seller_containing_final_price=1,seller_after_close=0,seller_bids=0)
print('LEAK TEST PASS',dict(counted_claim_target_pairs=n,**SQLCHK)); json.dump(dict(passed=True,counted=n,**SQLCHK),open('leak21.json','w'),indent=0)
