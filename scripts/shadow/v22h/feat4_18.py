import pickle,numpy as np,re,datetime,bisect,resource,json,collections
G,V,LM,VS=pickle.load(open('comps_v18.pkl','rb'))
T=json.load(open('targets18.json')); lvv=np.load('fs/meta.npz')['lv']
tok=lambda s: set(t for t in re.split(r'[\s\-/,()]+',(s or '').lower()) if t)
BYMK=collections.defaultdict(list)
for (mk,md),L in G[0].items(): BYMK[mk].append((md,tok(md),L))
del G
od=lambda s: datetime.date.fromisoformat(s).toordinal()
fh=open('fs/C4.f32','wb'); ln=np.zeros(len(T),np.int32)
for i,o in enumerate(T):
  if lvv[i]<1: continue
  mk,md,yr,_=V[o['v']]; Tk=tok(md); d=od(o['d']); rows=[]
  for md2,T2,L in BYMK.get(mk,[]):
    if md2==md: continue
    j=len(Tk&T2)/max(1,len(Tk|T2))
    if j<=0: continue
    k=bisect.bisect_left(L,(d,))
    rows+=[(x[0]-d,x[1]-yr,x[3],x[5],j) for x in L[max(0,k-300):k] if abs(x[1]-yr)<=9]
  if rows:
    R=np.array(rows,np.float32); R=R[np.argsort(R[:,0])][-300:]; fh.write(R.tobytes()); ln[i]=len(R)
  if i%20000==0: print(i,'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024,flush=True)
fh.close(); np.save('fs/ln4.npy',ln); print('done',(ln>0).sum(),'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)
