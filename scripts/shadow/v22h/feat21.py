# v21 comment/listing-claim features per target (point in time). Sources:
#  evidence_claims (BaT): listing_description claims dated on/before the sale day; seller/commenter claims only if linked to a
#  non-bid comment posted strictly before the sale day; any claim whose quote mentions a price/sale/reserve is dropped.
#  auction_comments: seller comments (non-bid, bid_amount null) posted before auction_events.auction_end_date, whose text
#  has no price/sale/reserve mention (SQL in sql/t_*.sql); 'answers' = those addressing a user (@...).
import json,numpy as np,collections
T=json.load(open('targets18.json'))
byv=collections.defaultdict(list); drop=collections.Counter()
for l in open('claims.tsv'):
  r=l.rstrip('\n').split('|')
  if len(r)==8: r=r[:2]+['']+r[2:]
  vid,ts,role,kind,pol,sp,ph,link,ce=r
  if ph=='1': drop['price_text']+=1; continue
  if vid=='1ea8c255-4ba3-437b-b6d8-4a10dd816aef' and kind=='condition': drop['final_price_digits']+=1; continue
  if link in ('2','3'): drop['bid_or_missing_comment']+=1; continue
  if role in ('commenter','seller_comment') and link!='1': drop['comment_unlinked']+=1; continue
  byv[vid].append((ts[:10],role,kind,pol,link=='1'))
SC=json.load(open('seller_counts.json'))
COLS=['cl_cond_pos','cl_cond_neg','cl_cond_hedge','cl_work','cl_prov','cl_own','cl_seller_cmt_claims','sc_seller_ok','sc_seller_ans']
F=np.full((len(T),len(COLS)),np.nan); used=0; viol=0
for i,t in enumerate(T):
  if t['pl']!='bat': continue
  c=collections.Counter()
  for ds,role,kind,pol,iscmt in byv.get(t['v'],()):
    if (ds>=t['d']) if iscmt else (ds>t['d']): continue
    used+=1
    if kind=='condition': c['cl_cond_pos' if pol=='1' else 'cl_cond_neg' if pol=='-1' else 'cl_cond_hedge']+=1
    elif kind=='work_record': c['cl_work']+=1
    elif kind=='provenance': c['cl_prov']+=1
    elif kind=='ownership': c['cl_own']+=1
    if role=='seller_comment': c['cl_seller_cmt_claims']+=1
  s=SC.get(t['eid'],(0,0,0)); c['sc_seller_ok']=s[0]; c['sc_seller_ans']=s[2]
  F[i]=[c[k] for k in COLS]
np.save('F21.npy',F); json.dump(dict(cols=COLS,drop=drop,claims_used=used),open('feat21.json','w'),indent=0)
b=np.array([t['pl']=='bat' for t in T]); print(dict(drop=drop,used=used,bat=int(b.sum()),cov={k:round(float((F[b,j]>0).mean()),3) for j,k in enumerate(COLS)}))
