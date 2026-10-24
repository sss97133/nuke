# learned model-family grouping within make: name similarity (char-trigram Jaccard / prefix) + price co-movement of half-year series; union-find
import pickle,numpy as np,collections,json,datetime
G,V,LM,VS=pickle.load(open('../v14/comps_v11.pkl','rb')); G1=G[1]; del G
def tri(s): s=f'  {s} '; return {s[i:i+3] for i in range(len(s)-2)}
def namesim(a,b):
  if not a or not b: return 0.
  if a.split()[0]==b.split()[0] and (a.startswith(b) or b.startswith(a)): return 1.
  A,B=tri(a),tri(b); return len(A&B)/len(A|B)
def clusters(cut_ord,excl,s_min,c_min,lvl):
  bym=collections.defaultdict(list); ST={}
  for (mk,cf),L in G1.items():
    x=[(o,lp) for o,yr,vid,lp,pl,mi in L if o<cut_ord and vid not in excl]
    if len(x)<3: ST[(mk,cf)]=None; bym[mk].append(cf); continue
    o=np.array([a for a,_ in x]); lp=np.array([b for _,b in x]); h=(o-730000)//182
    med=np.median(lp); ser={k:float(np.median(lp[h==k])-med) for k in np.unique(h) if (h==k).sum()>=2}
    ST[(mk,cf)]=(med,ser,len(x)); bym[mk].append(cf)
  par={}
  def f(k):
    while par.get(k,k)!=k: k=par[k]
    return k
  ed=0
  for mk,cfs in bym.items():
    for i in range(len(cfs)):
      for j in range(i+1,len(cfs)):
        a,b=cfs[i],cfs[j]; ns=namesim(a,b)
        if ns<s_min: continue
        sa,sb=ST[(mk,a)],ST[(mk,b)]
        if sa and sb:
          if abs(sa[0]-sb[0])>lvl: continue
          if c_min>-1:
            ks=sorted(set(sa[1])&set(sb[1]))
            if len(ks)>=4:
              r=np.corrcoef([sa[1][k] for k in ks],[sb[1][k] for k in ks])[0,1]
              if not (r>=c_min): continue
        ra,rb=f((mk,a)),f((mk,b))
        if ra!=rb: par[ra]=rb; ed+=1
  return {k:f(k) for k in ST},ed
def feats(CL,vids,dord,excl_self=True,K=40,wy=5,wd=5*365):
  fam=collections.defaultdict(list)
  for k,r in CL.items(): fam[r].append(k)
  arr={}
  out=np.full((len(vids),4),np.nan)
  for i,v in enumerate(vids):
    mk,md,yr,cf=V[v]; r=CL.get((mk,cf))
    if r is None: continue
    if r not in arr:
      L=[c for k in fam[r] for c in G1[k]]; L.sort()
      arr[r]=(np.array([c[0] for c in L]),np.array([c[1] for c in L]),np.array([c[3] for c in L]),np.array([c[2] for c in L]),len(fam[r]))
    o,y,lp,vv,nf=arr[r]; m=(o<dord[i])&(o>=dord[i]-wd)&(np.abs(y-yr)<=wy)&(vv!=v)
    if m.sum()<3: out[i,3]=nf; continue
    dy=np.abs(y[m]-yr); idx=np.argsort(dy,kind='stable')[:K]
    out[i]=[np.median(lp[m][idx]),np.log1p(m.sum()),dy[idx].mean(),nf]
  return out
