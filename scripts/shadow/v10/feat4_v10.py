import pickle,numpy as np,re,datetime,bisect,resource,json,collections
G,V,LM,VS=pickle.load(open('comps_v10.pkl','rb'))
F=pickle.load(open('feat_v10.pkl','rb'))
tok=lambda s: set(t for t in re.split(r'[\s\-/,()]+',(s or '').lower()) if t)
BYMK=collections.defaultdict(list)
for (mk,md),L in G[0].items(): BYMK[mk].append((md,tok(md),L))
del G
od=lambda s: datetime.date.fromisoformat(s).toordinal()
out={}
for i,o in enumerate(F):
  if o['lv']<1: continue
  mk,md,_,_=V[o['v']]; T=tok(md); d=od(o['d']); yr=o['yr']; rows=[]
  for md2,T2,L in BYMK.get(mk,[]):
    if md2==md: continue
    j=len(T&T2)/max(1,len(T|T2))
    if j<=0: continue
    k=bisect.bisect_left(L,(d,))
    rows+=[(x[0]-d,x[1]-yr,x[3],x[5],j) for x in L[max(0,k-300):k] if abs(x[1]-yr)<=9]
  if rows:
    R=np.array(rows,np.float32); R=R[np.argsort(R[:,0])][-300:]; out[i]=R
pickle.dump(out,open('feat4_v10.pkl','wb'))
print(len(out),'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)
