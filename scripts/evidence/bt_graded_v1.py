import json,hashlib,numpy as np,math,re,resource
A=json.load(open('extracted.json')); B={b['v']:b for b in json.load(open('../shadow/bases.json'))}
R={r['v']:r for r in json.load(open('../shadow/rows.json'))}
Y=json.load(open('years.json'))
def h5(v): return int(hashlib.md5(v.encode()).hexdigest()[:8],16)%5
names=['icpt','g1','g3','g4','logflaws','mi_known','log_mi','mi_per_yr','tmu','rep_full','rep_part','orig_paint','nm_true','nm_false','own_known','log_own_yrs','n_work','work_cost','receipts','log_after']
X=[];y=[];te=[];p=[];base=[];live=[];nc=[]
for v,b in B.items():
    r=R[v]; o=A.get(v,[]); f=dict.fromkeys(names,0.0); f['icpt']=1
    sy=int(r['d'][:4])
    for x in o:
        F=x['field']
        if F=='condition_grade':
            g=int(x['value_num']); 
            if g!=2: f[f'g{g}']=1
            m=re.match(r'flaws=(\d+);severe=\d+;concours=\d+;aftermarket=(\d+)',x['value_text']); f['logflaws']=math.log1p(int(m.group(1))); f['log_after']=math.log1p(int(m.group(2)))
        elif F=='mileage_claimed':
            mi=x['value_num']*(0.621 if x['unit']=='km' else 1)
            # vehicle year from desc? use comps-free proxy: year unknown here -> use per-year by sale_year-? (age from rows if present)
            f['mi_known']=1; f['log_mi']=math.log1p(mi)-10; f['tmu']=float(bool(x.get('value_bool')))
            yr=Y.get(v); f['mi_per_yr']=(math.log1p(mi/max(1,sy-yr))-8) if yr else 0
        elif F=='repaint':
            if x['value_bool']: f['rep_part' if x.get('value_text')=='partial' else 'rep_full']=1
            else: f['orig_paint']=1
        elif F=='numbers_matching': f['nm_true' if x['value_bool'] else 'nm_false']=1
        elif F=='ownership_duration': f['own_known']=1; f['log_own_yrs']=math.log1p(x['value_num'])-2
        elif F=='documented_work':
            f['n_work']+=1; f['work_cost']=max(f['work_cost'],1.0 if x.get('value_num') else 0); f['receipts']=max(f['receipts'],float(bool(x.get('value_bool'))))
    f['n_work']=math.log1p(f['n_work'])
    X.append([f[n] for n in names]); y.append(math.log(r['p']/b['base'])); te.append(h5(v)==0); p.append(r['p']); base.append(b['base']); live.append(float(r['e'])); nc.append(b['nc'])
X=np.array(X);y=np.array(y);te=np.array(te);p=np.array(p);base=np.array(base);live=np.array(live);nc=np.array(nc)
tr=~te&(np.abs(y)<math.log(5))
A_=lambda pred,m: float(np.median(np.abs(pred[m]-p[m])/p[m]))
a0=np.median(y[tr]); comps=base*math.exp(a0)
print('n train',tr.sum(),'test',te.sum(),'| held-out MdAPE live',round(A_(live,te),4),'comps-only',round(A_(comps,te),4))
res={}
for lam in [1,10,100,1000]:
    L=lam*np.eye(len(names)); L[0,0]=0
    for loss in ['l2','huber']:
        b=np.linalg.solve(X[tr].T@X[tr]+L,X[tr].T@y[tr])
        if loss=='huber':
            for _ in range(20):
                rr=y[tr]-X[tr]@b; w=np.minimum(1,0.3/np.maximum(np.abs(rr),1e-9))
                b=np.linalg.solve((X[tr]*w[:,None]).T@X[tr]+L,(X[tr]*w[:,None]).T@y[tr])
        pr=base*np.exp(X@b); res[(lam,loss)]=(A_(pr,te),b)
        print(f'lam={lam} {loss}: graded held-out MdAPE {A_(pr,te):.4f}')
best=min(res,key=lambda k:res[k][0]); b=res[best][1]
print('best',best,dict(zip(names,np.round(b,3))))
pr=base*np.exp(X@b)
# 5-fold CV on train folds only (folds 1-4) to check stability
for k in range(1,5):
    trk=tr&np.array([True]*len(y)); 
import hashlib as H
fold=np.array([h5(v) for v in B])
cv=[]
for k in range(1,5):
    t2=tr&(fold!=k); s2=(fold==k)
    L=best[0]*np.eye(len(names));L[0,0]=0
    bb=np.linalg.solve(X[t2].T@X[t2]+L,X[t2].T@y[t2]); a2=np.median(y[t2])
    cv.append((A_(base*np.exp(a2),s2),A_(base*np.exp(X@bb),s2)))
print('CV folds (comps, graded):',[tuple(round(c,4) for c in z) for z in cv])
# subgroup: vehicles with any graded signal beyond default
sig=(X[:,1:4].sum(1)>0)|(X[:,5]>0)
print('held-out with mileage known',A_(comps,te&(X[:,5]>0)),A_(pr,te&(X[:,5]>0)),(te&(X[:,5]>0)).sum())
for g,c in [('g3',2),('g4',3)]:
    m=te&(X[:,c]>0); print('held-out',g,m.sum(),round(A_(comps,m),4),round(A_(pr,m),4))
# bootstrap CI on delta
rng=np.random.default_rng(0); idx=np.where(te)[0]; e1=np.abs(comps-p)/p; e2=np.abs(pr-p)/p
ds=[np.median(e2[s])-np.median(e1[s]) for s in (rng.choice(idx,len(idx)) for _ in range(500))]
print('delta MdAPE graded-comps 95% CI',np.round(np.quantile(ds,[.025,.5,.975]),4))
json.dump({'names':names,'coef':list(map(float,b)),'best':list(map(str,best)),'heldout_comps':A_(comps,te),'heldout_graded':A_(pr,te)},open('model_graded_v1.json','w'))
print('rss MB',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)
