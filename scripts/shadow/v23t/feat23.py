# v23 point-in-time market-trend + wide same-model comp features. Usage: feat23.py <targets.json> <out.npy>
# Every input sale is strictly before the target's sale date (ordinal < target ordinal).
# Residual per sale c: e_c = lp_c - median(lp of up to 60 most recent earlier sales of the same model (make, model), |year diff|<=5,
#   within 3 years before c, scanning at most the 400 most recent earlier same-model sales); needs >=3, else c is not used. e_c is clipped to +-1. Uses only data before c, so it is before every target too.
# Index_W(group,t) = mean e_c over group sales with t-W <= date < t. Segment: VS segment (all decades). Family: (make, canonical family).
# Family index shrunk toward segment: (n*fam + K*seg)/(n+K), K=20. Segment index needs n>=3 else NaN.
# Wide comps: same (make, model), |year diff|<=15, any time before t, other vehicles, last 40: median lp, log1p n, mean |dy|, mean age (yrs).
# Cols: 0 seg90 1 seg365 2 log1p(nseg90) | 3 fam90s 4 fam365s 5 log1p(nfam365) | 6 wide_med 7 log1p(nwide) 8 wide_dy 9 wide_age
import pickle,json,sys,bisect,collections,datetime,numpy as np,resource
G,V,LM,VS=pickle.load(open('comps_v18.pkl','rb')); del LM
od=lambda s: datetime.date.fromisoformat(s).toordinal()
E={}
for key,L in G[0].items():
  for j,(o,yr,vid,lp,pl,mi) in enumerate(L):
    lo=bisect.bisect_left(L,(o-3*365,)); hi=bisect.bisect_left(L,(o,))
    pr=[x[3] for x in L[max(lo,hi-400):hi] if abs(x[1]-yr)<=5 and x[2]!=vid][-60:]
    if len(pr)>=3: E[(vid,o)]=float(np.clip(lp-np.median(pr),-1,1))
print('residuals',len(E),'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024,flush=True)
def build(lists):
  o=[];e=[]
  for L in lists:
    for x in L:
      r=E.get((x[2],x[0]))
      if r is not None: o.append(x[0]); e.append(r)
  ix=np.argsort(o,kind='stable'); o=np.array(o)[ix]; e=np.array(e)[ix]
  return o,np.concatenate([[0],np.cumsum(e)])
SEG=collections.defaultdict(list)
for (sg,dec),L in G[3].items(): SEG[sg].append(L)
SEGI={sg:build(Ls) for sg,Ls in SEG.items() if sg}; FAMI={k:build([L]) for k,L in G[1].items()}; del SEG
def win(I,t,W):
  o,c=I; a=np.searchsorted(o,t-W); b=np.searchsorted(o,t); n=b-a
  return (c[b]-c[a])/n if n else 0.,n
T=json.load(open(sys.argv[1])); K=20.; F=np.full((len(T),10),np.nan)
for i,r in enumerate(T):
  v=r['v']; t=od(r['d']); mk,md,yr,cf=V[v]; sg=VS.get(v,'')
  s={}
  if sg in SEGI:
    for W in (90,365):
      m,n=win(SEGI[sg],t,W); s[W]=(m,n)
    F[i,0]=s[90][0] if s[90][1]>=3 else np.nan; F[i,1]=s[365][0] if s[365][1]>=3 else np.nan; F[i,2]=np.log1p(s[90][1])
  if (mk,cf) in FAMI:
    for j,W in ((3,90),(4,365)):
      m,n=win(FAMI[(mk,cf)],t,W); sv=F[i,j-3] if np.isfinite(F[i,j-3]) else 0.
      F[i,j]=(n*m+K*sv)/(n+K)
      if W==365: F[i,5]=np.log1p(n)
  L=G[0].get((mk,md),[]); hi=bisect.bisect_left(L,(t,))
  c=[x for x in L[max(0,hi-3000):hi] if abs(x[1]-yr)<=15 and x[2]!=v][-40:]
  if c:
    F[i,6]=np.median([x[3] for x in c]); F[i,7]=np.log1p(len(c)); F[i,8]=np.mean([abs(x[1]-yr) for x in c]); F[i,9]=np.mean([(t-x[0])/365.25 for x in c])
  if i%30000==0: print(i,'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024,flush=True)
np.save(sys.argv[2],F); print('cov',{j:round(float(np.isfinite(F[:,j]).mean()),3) for j in range(10)})
