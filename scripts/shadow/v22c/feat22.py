# v22 condition-claim features split by SOURCE, point in time. Usage: feat22.py <targets.json> <F21.npy> <out.npy>
#  description: listing_description condition claims (claims.tsv), dated on/before the sale day, no price text.
#  seller_comment / commenter: condition claims from mine_bat_text_claims runs c2201 (training-era) and c2301 (fresh) only,
#   linked to a non-bid comment (bid_amount null) posted strictly before the sale day, no price text (filters in sqlx/x_*.sql).
#   Older pilot comment claims are dropped so training and fresh comment claims come from the same extractor pass.
# Columns 0-8: {desc,seller,commenter} x {pos,neg,hedge}; 9-14 = v21 F21 cols 3-8 unchanged (work,prov,own,seller_cmt,sc_ok,sc_ans).
import json,sys,numpy as np,collections
T=json.load(open(sys.argv[1])); F21=np.load(sys.argv[2]); assert len(F21)==len(T)
by=collections.defaultdict(list)
for l in open('/workspace/v23c/run/claims.tsv'):
  r=l.rstrip('\n').split('|')
  if len(r)==8: r=r[:2]+['']+r[2:]
  vid,ts,role,kind,pol,sp,ph,link,ce=r
  if role!='listing_description' or kind!='condition' or ph=='1': continue
  if vid=='1ea8c255-4ba3-437b-b6d8-4a10dd816aef': continue
  by[vid].append((ts[:10],0,pol,1))
for l in open('cmt_cond.tsv'):
  if not l.strip(): continue
  vid,ds,role,pol,n=l.rstrip('\n').split('|'); by[vid].append((ds,1 if role=='seller_comment' else 2,pol,int(n)))
PI={'1':0,'-1':1}
F=np.full((len(T),15),np.nan)
for i,t in enumerate(T):
  if t['pl']!='bat': continue
  c=np.zeros(9)
  for ds,src,pol,n in by.get(t['v'],()):
    if (ds>=t['d']) if src else (ds>t['d']): continue
    c[src*3+PI.get(pol,2)]+=n
  F[i,:9]=c; F[i,9:]=F21[i,3:9]
np.save(sys.argv[3],F)
b=np.array([t['pl']=='bat' for t in T]); print(sys.argv[1],{j:round(float((F[b,j]>0).mean()),3) for j in range(9)})
