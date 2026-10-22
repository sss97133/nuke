import json,math,sqlite3,collections,numpy as np
b=json.load(open('engine_out_bf.json'));a=json.load(open('engine_out_before.json'));m=json.load(open('macro_out.json'))
pc=lambda x:round((math.exp(x)-1)*100,1)
def H(dim,lv,seg='all cars',o=b):
  for h in o['hyps_all']:
    if h['dim']==dim and h['level']==lv and h['segment']==seg: return dict(pct=pc(h['effect']),lo=pc(h['lo']),hi=pc(h['hi']),n=h['n'],hold=None if h['hold_effect'] is None else pc(h['hold_effect']),q=h['q'],status=h['status'])
ven={v:H('auction venue',v) for v in ['Mecum Kissimmee','Scottsdale (AZ)','Las Vegas','Monterey (CA)','Amelia Island (FL)','B-J Palm Beach','Mecum Indy','Mecum Kansas City','Mecum Harrisburg','Houston','Mecum Dallas','Mecum Glendale']}
kis={s:H('auction venue','Mecum Kissimmee',s) for s in ['all cars','era 1960-79','era pre-1960','chevrolet','ford','price over ~$40k','price middle']}
reg={r:H('auction region',r) for r in ['West','East','Central','Europe']}
dow={d:H('day of week',d) for d in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']}
hour={d:H('end hour (Pacific)',d) for d in ['before 10am','10am-noon','noon-2pm','2pm-5pm','after 5pm']}
mon={d:H('month',d) for d in ['January','February','March','April','May','June','July','August','September','October','November','December']}
misc={k:H(*k.split('|')) for k in ['tax-refund season (Feb-Apr)|yes','holiday week|yes','dividend/bonus month (Mar/Jun/Sep/Dec)|yes','market regime (12-mo index change)|hot','market regime (12-mo index change)|cold','seller region (online)|West','prior public sales of same car|1','prior public sales of same car|2+']}
top=[h for h in b['top'] if h['dim']!='bid count band'][:20]
# budget: make x era cells
con=sqlite3.connect('/workspace/nuke-strategy/bt4/ev.db')
cells=collections.defaultdict(list)
for mk,yr,p,day in con.execute("select make,yr,p,day from ev where day>=20089"): # last ~1y (since 2025-01)
  e='pre-1960' if yr<1960 else '1960-79' if yr<1980 else '1980-99' if yr<2000 else '2000+'
  cells[(mk,e)].append(p)
seg=b['index_seg']
def chg(s,y=3):
  ks=sorted(s); last=ks[-1]; prev=f"{int(last[:4])-y}{last[4:]}"; 
  v=[s[k] for k in ks if k<=prev][-1:] 
  return None if not v else round((s[last]/v[0]-1)*100,1)
def vol(s):
  ks=sorted(s); x=[math.log(s[ks[i]]/s[ks[i-12]]) for i in range(12,len(ks))]; return round(float(np.std(x))*100,1)
ST={'bat':0.70,'mecum':0.78}
budget={}
for X in (25000,75000,200000,500000):
  opts=[]
  for (mk,e),ps in cells.items():
    if len(ps)<60: continue
    med=float(np.median(ps)); allin=med*1.05+min(med*0.05,7500)*0+1800+600  # online: 5% premium capped $7,500, enclosed transport ~$1,800 (RoadRunner 2026 avg), paperwork ~$600 est.
    allin=med+min(med*0.05,7500)+1800+600
    if not (0.45*X<=allin<=X): continue
    ms=seg.get('make: '+mk); es=seg.get('era: '+e)
    app=chg(ms) if ms else None; eapp=chg(es)
    opts.append(dict(segment=f"{mk.title()} {e}",n=len(ps),median=round(med),allin=round(allin),make_3y=app,era_3y=eapp,era_vol=vol(es),p25=round(float(np.percentile(ps,25))),p75=round(float(np.percentile(ps,75)))))
  for o in opts: o['score']=(o['era_3y'] or 0)+(o['make_3y'] if o['make_3y'] is not None else (o['era_3y'] or 0))-0.5*o['era_vol']+3*math.log10(o['n'])
  budget[X]=sorted(opts,key=lambda o:-o['score'])[:6]
cov={r['dim']:r['coverage'] for r in b['readiness']}
out=dict(counts=b['hyp_counts'],counts_before=a['hyp_counts'],n=b['n_sales'],index=m['index_s'],seg={k:{kk:v[kk] for kk in sorted(v) if kk>='2015'} for k,v in b['index_seg'].items()},
 factors={n:m['factor_yoy'][n] for n in ['M2 money supply','Fed funds rate','Real 10-year yield (TIPS)','CPI used cars & trucks','Manheim wholesale used-car index','Top 1% net worth (Fed DFA)','Nasdaq Composite','Personal savings rate']},
 lead=m['lead'],oos={k:{x:v[x] for x in v} for k,v in m['oos'].items()},train_corr=m['train_corr'],current=m['current'],forecast=m['forecast'],
 ven=ven,kis=kis,reg=reg,dow=dow,hour=hour,mon=mon,misc=misc,top=top,budget=budget,sellthrough=b['sellthrough'],cov=cov,platfe=b['platfe'],
 vol={k:v for k,v in b['sold_by_channel_month'].items() if k>='2015'})
json.dump(out,open('page_data.json','w'),default=float)
print(json.dumps({k:out[k] for k in ['kis','reg','dow','misc']},default=float)[:3000]); print(json.dumps(budget,default=float)[:2500])
