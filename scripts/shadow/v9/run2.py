exec(open('run1.py').read().split('t=time.time()')[0])
G2=[dict(k=k,w=0,ta=1e9,ty=1e9,tm=1e9,yw=yw) for k in (20,40,80,120) for yw in (3,6)]
G2+=[dict(k=k,w=1,ta=ta,ty=ty,tm=tm,yw=6) for k in (40,120) for ta in (2,5) for ty in (1,3) for tm in (0.5,1e9)]
res={}
for L in range(3):
  for c in G2:
    if L==2: c=dict(c,yw=9 if c['yw']==6 else c['yw'])
    s=evalcfg(L,c,1); res.setdefault(L,[]).append((s,c))
  res[L].sort(key=lambda x:x[0]); print('L',L,[(round(s,4),c) for s,c in res[L][:3]],flush=True)
json.dump({L:res[L][0][1] for L in res},open('best_cfg.json','w'))
