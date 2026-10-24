import pickle,json,numpy as np,hashlib,collections
out=pickle.load(open('out_v8.pkl','rb'))
h=lambda v:int(hashlib.md5(v.encode()).hexdigest()[:8],16)
v=[o[0] for o in out]; p=np.array([o[1] for o in out],float); e=np.array([o[2] for o in out]); lo=np.array([o[3] for o in out]); hi=np.array([o[4] for o in out])
lv=np.array([o[5] for o in out]); b0=np.array([o[6] for o in out]); nc=np.array([o[7] for o in out])
f5=np.array([h(x)%5 for x in v]); f4=np.array([(h(x)//5)%4 for x in v]); te=f5==0
db=np.digitize(nc,[6,15,40])  # 0:3-5 1:6-14 2:15-39 3:40
W=np.array([1.0])
ok=(e>0)&(p>0)
def fit(tr):
  """per level: comp intercept a; per (level,depth) blend weight w on log(comp*e^a) vs log(live), chosen by train MdAPE"""
  M={}
  for L in range(3):
    m=tr&(lv==L)&ok; y=np.log(p/b0); a=float(np.median(y[m&(np.abs(y)<np.log(5))]))
    M[L]={'a':a,'w':{}}
    for d in range(4):
      mm=m&(db==d)
      if mm.sum()<30: mm=m
      lc=np.log(b0[mm])+a; le=np.log(e[mm])
      errs=[np.median(np.abs(np.exp(w*lc+(1-w)*le)-p[mm])/p[mm]) for w in W]
      M[L]['w'][d]=float(W[int(np.argmin(errs))])
  return M
def pred(M,idx):
  s=np.full(len(p),np.nan)
  for L in range(3):
    for d in range(4):
      m=idx&(lv==L)&(db==d)&ok; w=M[L]['w'][d]
      s[m]=np.exp(w*(np.log(b0[m])+M[L]['a'])+(1-w)*np.log(e[m]))
  return s
# OOF on training folds for interval calibration
oof=np.full(len(p),np.nan)
for k in range(4):
  Mk=fit(~te&(f4!=k)); s=pred(Mk,~te&(f4==k)); oof[~te&(f4==k)]=s[~te&(f4==k)]
M=fit(~te); s=pred(M,np.ones(len(p),bool))
Q={}
for L in range(3):
  m=~te&(lv==L)&ok&~np.isnan(oof); r=np.log(p[m]/oof[m]); Q[L]=[float(x) for x in np.quantile(r,[.1,.9])]
slo=np.full(len(p),np.nan); shi=slo.copy()
for L in range(3):
  m=lv==L; slo[m]=s[m]*np.exp(Q[L][0]); shi[m]=s[m]*np.exp(Q[L][1])
# v7 for comparison
s7=np.full(len(p),np.nan); l7=s7.copy(); h7=s7.copy(); V7=json.load(open('../v7/model_v7_hier.json'))['levels']
for L in range(3):
  m=lv==L; a=V7[str(L)]['intercept']; q=V7[str(L)]['q']; s7[m]=b0[m]*np.exp(a); l7[m]=s7[m]*np.exp(q[0]); h7[m]=s7[m]*np.exp(q[1])
A=lambda z,m: np.median(np.abs(z[m]-p[m])/p[m]); C=lambda l,u,m: ((p[m]>=l[m])&(p[m]<=u[m])).mean()
print('routing weights on comps (1=comps,0=live) by level x depth[3-5,6-14,15-39,40]:',{L:M[L]['w'] for L in M})
for L in [0,1,2,'all']:
  m=te&ok&((lv<3) if L=='all' else (lv==L))
  print(f"L{L} n={m.sum()} MdAPE v8={A(s,m):.4f} v7={A(s7,m):.4f} live={A(e,m):.4f} | cov80 v8={C(slo,shi,m):.3f} v7={C(l7,h7,m):.3f} live={C(lo,hi,m):.3f} | width v8={np.median((shi[m]-slo[m])/s[m]):.2f} v7={np.median((h7[m]-l7[m])/s7[m]):.2f}")
print('excluded (live<=0) held covered', (te&(lv<3)&~ok).sum())
json.dump({'levels':{L:dict(intercept=M[L]['a'],w_comps_by_depth=M[L]['w'],q=Q[L]) for L in M},'depth_bins':[3,6,15,40]},open('model_v8_componly.json','w'))
json.dump([dict(v=v[i],lv=int(lv[i]),nc=int(nc[i]),base=float(b0[i]),w=M[int(lv[i])]["w"][int(db[i])],a=M[int(lv[i])]["a"],d=out[i][8],s=float(s[i]),lo=float(slo[i]),hi=float(shi[i])) for i in range(len(p)) if lv[i]<3 and s[i]==s[i]],open('rows_v8_componly.json','w'))
