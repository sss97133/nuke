# targets: (a) v13b's 50,156 BaT targets (meta_v11 order) matched to a surviving fresh bat event on (vehicle, date);
# (b) Mecum run mecum_px_v1_20261024 events that survived the filters. p = gross USD of that event.
import pickle,numpy as np,json,collections
SH='/workspace/nuke-strategy/shadow'
EV=pickle.load(open('ev_v18.pkl','rb')); G,V,LM,VS=pickle.load(open('comps_v18.pkl','rb'))
M=np.load(f'{SH}/v17/meta_v11.npz'); R={(r['v'],r['d']):r for r in json.load(open(f'{SH}/rows.json'))}
S13=np.load(f'{SH}/v17/sets_v11.npz'); lv9=np.load(f'{SH}/v9/sets_v9.npz')['lv']
bat={}
for eid,(v,d,pl,g,src) in EV.items():
  if pl=='bat': bat.setdefault((v,d),(eid,g))
T=[]
for i,(v,d) in enumerate(zip(M['v'],M['d'])):
  k=(str(v),str(d))
  if k not in bat or k[0] not in V: continue
  r=R[k]; T.append(dict(v=k[0],d=k[1],eid=bat[k][0],pl='bat',p=bat[k][1],ph=float(S13['p'][i]),e=float(r['e']),lo=float(r['lo'] or 0),hi=float(r['hi'] or 0),c=r['c'],old=i,lv9=int(lv9[i])))
nold=len(T)
for eid,(v,d,pl,g,src) in EV.items():
  if src=='ve' and v in V: T.append(dict(v=v,d=d,eid=eid,pl='mecum',p=g,ph=g/1.10,e=0.,lo=0.,hi=0.,c='',old=-1,lv9=-1))
json.dump(T,open('targets18.json','w'))
print('old matched',nold,'of',len(M['v']),'mecum',len(T)-nold,'total',len(T))
