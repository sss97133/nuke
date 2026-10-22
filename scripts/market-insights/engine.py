"""Nuke market hypothesis engine. Re-runnable: python3 engine.py  (inputs: bt4/ev.db sold sales, venue/all.psv event fields, macro/*.csv)"""
import sqlite3,math,json,re,collections,datetime as dt,csv,statistics as st
import numpy as np
R='/workspace/nuke-strategy/'; RUN=dt.datetime.now().strftime('%Y%m%d%H%M')
D0=dt.date(1970,1,1)
def mon(day): d=D0+dt.timedelta(days=int(day)); return d.year*12+d.month-1
def mlab(m): return f'{m//12}-{m%12+1:02d}'
# ---- load sales
con=sqlite3.connect(R+'bt4/ev.db')
rows=con.execute("select vid,make,k,yr,day,p,plat,odo,vmi from ev where p>=1000").fetchall()
plat_norm=lambda p:'barrettjackson' if p.startswith('barrett') else p
vid=[r[0] for r in rows]; make=np.array([r[1] for r in rows]); yr=np.array([r[3] for r in rows]); day=np.array([r[4] for r in rows])
lp=np.log(np.array([r[5] for r in rows])); plat=np.array([plat_norm(r[6]) for r in rows])
def mi(o,v):
  for x in (o,v):
    try:
      x=float(x)
      if 0<=x<2e6: return x
    except: pass
  return np.nan
miles=np.array([mi(r[7],r[8]) for r in rows])
M=np.array([mon(d) for d in day]); M0=2010*12
keep=M>=M0
mb=np.select([np.isnan(miles),miles<1e4,miles<5e4,miles<1e5],['na','<10k','10-50k','50-100k'],'100k+')
coh=np.array([f'{r[1]}|{r[2]}|{r[3]}' for r in rows])
def fe(ids):
  u,inv=np.unique(ids,return_inverse=True); return inv,len(u)
def fit(mask, extra=True):
  """log p = cohort + month (+ channel); alternating projections. Returns month effects."""
  idx=np.where(mask)[0]; y=lp[idx]
  ci,nc=fe(coh[idx]); mi_,nm=fe(M[idx]); pi,npf=fe(plat[idx]); ki,nk=fe(mb[idx])
  a=np.zeros(nc);b=np.zeros(nm);g=np.zeros(npf);h=np.zeros(nk)
  for it in range(40):
    r=y-b[mi_]-g[pi]-h[ki]; a=np.bincount(ci,r,nc)/np.bincount(ci,None,nc)
    r=y-a[ci]-g[pi]-h[ki]; b=np.bincount(mi_,r,nm)/np.bincount(mi_,None,nm)
    r=y-a[ci]-b[mi_]-h[ki]; g=np.bincount(pi,r,npf)/np.bincount(pi,None,npf)
    r=y-a[ci]-b[mi_]-g[pi]; h=np.bincount(ki,r,nk)/np.bincount(ki,None,nk)
  months=np.unique(M[idx]); n=np.bincount(mi_,None,nm)
  # only cohorts with >=2 sales identify the time effect; report
  multi=np.bincount(ci,None,nc)[ci]>=2
  res=np.full(len(lp),np.nan); res[idx]=y-a[ci]-b[mi_]-g[pi]-h[ki]
  res[idx[~multi]]=np.nan
  return dict(zip(months.tolist(),b.tolist())),dict(zip(months.tolist(),n.tolist())),res,a[ci],idx,dict(zip(np.unique(plat[idx]).tolist(),g.tolist()))
idxW,nW,RES,COH,IDX,PLATFE=fit(keep)
cohlvl=np.full(len(lp),np.nan); cohlvl[IDX]=COH
def series(e,n,minn):
  ms=sorted(m for m in e if n[m]>=minn); base=np.mean([e[m] for m in ms if 2019*12<=m<2020*12]) if any(2019*12<=m<2020*12 for m in ms) else e[ms[0]]
  return {mlab(m):round(100*math.exp(e[m]-base),1) for m in ms}
out={'run':RUN,'n_sales':int(keep.sum())}
out['index_all']=series(idxW,nW,100)
# smoothing: 3-month centered median for display only
era=np.select([yr<1960,yr<1980,yr<2000],['pre-1960','1960-79','1980-99'],'2000+')
tier=np.full(len(lp),'',dtype=object)
q=np.nanquantile(cohlvl[keep],[1/3,2/3]); tier[keep]=np.where(cohlvl[keep]<q[0],'under ~$%dk'%round(math.exp(q[0])/1000),np.where(cohlvl[keep]<q[1],'middle','over ~$%dk'%round(math.exp(q[1])/1000)))
seg={}
for e in np.unique(era): x=fit(keep&(era==e)); seg['era: '+e]=series(x[0],x[1],30)
for t in [t for t in np.unique(tier[keep]) if t]: x=fit(keep&(tier==t)); seg['tier: '+t]=series(x[0],x[1],30)
topm=[m for m,_ in collections.Counter(make[keep]).most_common(8)]
for mk in topm: x=fit(keep&(make==mk)); seg['make: '+mk]=series(x[0],x[1],20)
out['index_seg']=seg
# volume by channel (sold, from ev) + listings/sell-through + bids from venue export
vol=collections.defaultdict(lambda: collections.Counter())
for m,p in zip(M[keep],plat[keep]): vol[mlab(m)][p]+=1
out['sold_by_channel_month']={k:dict(v) for k,v in sorted(vol.items())}
# ---- venue/timing fields
VEN=[('kissimmee','Mecum Kissimmee','FL','East'),('scottsdale','Scottsdale (AZ)','AZ','West'),('palm beach','B-J Palm Beach','FL','East'),('palm-beach','B-J Palm Beach','FL','East'),('las vegas','Las Vegas','NV','West'),('las-vegas','Las Vegas','NV','West'),('indy','Mecum Indy','IN','Central'),('kansas city','Mecum Kansas City','MO','Central'),('harrisburg','Mecum Harrisburg','PA','East'),('houston','Houston','TX','Central'),('dallas','Mecum Dallas','TX','Central'),('glendale','Mecum Glendale','AZ','West'),('nashville','Nashville','TN','East'),('monterey','Monterey (CA)','CA','West'),('pebble','Monterey (CA)','CA','West'),('seattle','Mecum Seattle','WA','West'),('amelia','Amelia Island (FL)','FL','East'),('northeast','B-J Northeast (CT)','CT','East'),('tulsa','Mecum Tulsa','OK','Central'),('orange county','B-J Orange County','CA','West'),('reno','B-J Reno','NV','West'),('arizona','Scottsdale (AZ)','AZ','West'),('chicago','Mecum Chicago','IL','Central'),('new orleans','B-J New Orleans','LA','East'),('anaheim','Mecum Anaheim','CA','West'),('santa monica','Mecum Santa Monica','CA','West'),('florida summer','Mecum FL Summer','FL','East'),('chattanooga','Mecum Chattanooga','TN','East'),('miami','Miami','FL','East'),('paris','Paris','FR','Europe'),('london','London','UK','Europe'),('goodwood','Goodwood (UK)','UK','Europe')]
WEST={'WA','OR','CA','NV','AZ','UT','ID','MT','WY','CO','NM','AK','HI'}
ST={'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA','colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS','kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK','oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT','virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY'}
def venue(v):
  v=v.lower()
  if 'motorcycle' in v: return None
  for k,n,s,rg in VEN:
    if k in v: return n,s,rg
  return None
def sellerstate(loc):
  l=loc.lower()
  m=re.search(r',\s*([A-Z]{2})\b',loc)
  if m and m.group(1) in set(ST.values()): return m.group(1)
  for k,s in ST.items():
    if k in l: return s
  return None
import os
BF=os.environ.get('BACKFILL')=='1'
if BF:
  import mecum_venue_backfill as mvb
  _r=[]
  for line in open(R+'venue/all.psv'):
    f=line.rstrip('\n').split('|')
    if len(f)>=11 and f[1]=='mecum' and f[3]: _r.append((int(f[3])//86400,f[6]))
  NAMED=mvb.build(_r)
evt=collections.defaultdict(list); allev=[]
for line in open(R+'venue/all.psv'):
  f=line.rstrip('\n').split('|')
  if len(f)<11 or not f[3]: continue
  ts=int(f[3]); d=ts//86400; p=f[1]; status=f[2]
  if BF and p=='mecum' and not f[6]: f[6]=mvb.infer(NAMED,d) or ''
  ven=venue(f[6]) if f[6] else None
  if not ven and p in('bonhams','rm-sothebys') and f[7]: ven=venue(f[7])
  ss=sellerstate(f[7]) if p in('cars_and_bids','pcarmarket') and f[7] else None
  hour=None
  if p in('bat','cars_and_bids','pcarmarket') and ts%86400: hour=(dt.datetime.utcfromtimestamp(ts)-dt.timedelta(hours=7 if 3<=dt.datetime.utcfromtimestamp(ts).month<=10 else 8)).hour
  bids=int(f[5]) if f[5].isdigit() else None
  rec=dict(p=p,s=status,d=d,ven=ven,ss=ss,hour=hour,bids=bids,lot=f[8])
  allev.append(rec); evt[(f[0],d)].append(rec)
# join to sales
J=[None]*len(lp)
for i in IDX:
  for dd in (0,-1,1):
    c=evt.get((vid[i],int(day[i])+dd))
    if c: J[i]=c[0];break
out['join_rate']=round(sum(j is not None for j in J)/len(IDX),3)
# prior sales count per vehicle
order=np.argsort(day,kind='stable'); seen=collections.Counter(); prior=np.zeros(len(lp),int)
for i in order: prior[i]=seen[vid[i]]; seen[vid[i]]+=1
# ---- dimensions (hypothesis generators)
def ld(i): return D0+dt.timedelta(days=int(day[i]))
idxs={}
def holiday(d):
  y=d.year; th=max(dt.date(y,11,22+k) for k in range(7) if dt.date(y,11,22+k).weekday()==3)
  return (abs((d-dt.date(y,12,25)).days)<=4 or abs((d-dt.date(y,1,1)).days)<=3 or 0<=(d-th).days<=3 or (d.month==7 and 2<=d.day<=6))
regime={}
ms=sorted(idxW); 
for m in ms:
  if m-12 in idxW: regime[m]=idxW[m]-idxW[m-12]
rq=np.quantile(list(regime.values()),[1/3,2/3])
DIM={
 'channel':lambda i:plat[i],
 'day of week':lambda i:ld(i).strftime('%A') if J[i] and J[i]['p'] in('bat','cars_and_bids','pcarmarket') else None,
 'month':lambda i:ld(i).strftime('%B'),
 'end hour (Pacific)':lambda i:(None if not J[i] or J[i]['hour'] is None else ('before 10am' if J[i]['hour']<10 else '10am-noon' if J[i]['hour']<12 else 'noon-2pm' if J[i]['hour']<14 else '2pm-5pm' if J[i]['hour']<17 else 'after 5pm')),
 'tax-refund season (Feb-Apr)':lambda i:'yes' if ld(i).month in(2,3,4) else 'no',
 'dividend/bonus month (Mar/Jun/Sep/Dec)':lambda i:'yes' if ld(i).month in(3,6,9,12) else 'no',
 'holiday week':lambda i:'yes' if holiday(ld(i)) else 'no',
 'market regime (12-mo index change)':lambda i:(None if M[i] not in regime else 'hot' if regime[M[i]]>rq[1] else 'cold' if regime[M[i]]<rq[0] else 'normal'),
 #'mileage band' is now a control
 'mileage band':lambda i:(None if math.isnan(miles[i]) else 'under 10k mi' if miles[i]<1e4 else '10-50k mi' if miles[i]<5e4 else '50-100k mi' if miles[i]<1e5 else 'over 100k mi'),
 'prior public sales of same car':lambda i:'0' if prior[i]==0 else '1' if prior[i]==1 else '2+',
 'auction venue':lambda i:J[i]['ven'][0] if J[i] and J[i]['ven'] else None,
 'auction region':lambda i:J[i]['ven'][2] if J[i] and J[i]['ven'] else None,
 'seller region (online)':lambda i:(None if not J[i] or not J[i]['ss'] else 'West' if J[i]['ss'] in WEST else 'East/Central'),
 'bid count band':lambda i:(None if not J[i] or J[i]['bids'] is None or J[i]['p']!='bat' else 'under 20' if J[i]['bids']<20 else '20-40' if J[i]['bids']<40 else '40+'),
}
# fields that we know exist in the world but are not structured -> readiness
NEEDS={'color':('vehicles.color (exterior)','not in export / sparse'),'body style':('canonical body style','mismatched canonical body style (known comp blocker)'),'numbers-matching state':('numbers_state','not structured'),'no-reserve':('vehicle_events.metadata.no_reserve','only C&B; BaT title text only'),'seller type (dealer/private)':('seller_identifier -> seller type','no dealer flag'),'lot position / time slot (live auctions)':('lot_number + session start','lot number text; no session time'),'BaT seller location':('BaT listing "Location:" line','in snapshot HTML only, 0% structured')}
segs={'all cars':np.ones(len(lp),bool)}
for e in np.unique(era): segs['era '+e]=era==e
for t in [t for t in set(tier[keep]) if t]: segs['price '+t]=tier==t
for mk in topm[:6]: segs[mk]=make==mk
TEST0=2024*12  # holdout: sales from Jan 2024 on (last ~2.8 years, ~45% of data); hypotheses scored on earlier data only
ok=~np.isnan(RES)
vals={}
for dn,fn in DIM.items():
  v=np.array([fn(i) if ok[i] else None for i in range(len(lp))],dtype=object); vals[dn]=v
from math import erf,sqrt
def pval(z): return 2*(1-0.5*(1+erf(abs(z)/sqrt(2))))
def cmp(mask):
  a=RES[mask]; return a.mean(),a.std(ddof=1)/sqrt(len(a)),len(a)
H=[]
for dn,v in vals.items():
  have=np.array([x is not None for x in v])
  cov=have[IDX].mean()
  for sn,sm in segs.items():
    base=sm&have&ok
    if base.sum()<200: continue
    levels=collections.Counter(v[base])
    for lv,nlv in levels.items():
      if nlv<50 or len(levels)<2: continue
      ins=base&(v==lv)
      tr=M<TEST0
      a=ins&tr; b=base&~(v==lv)&tr
      if a.sum()<30 or b.sum()<30: continue
      ma,sa,na=cmp(a); mb,sb,nb=cmp(b); eff=ma-mb; se=sqrt(sa**2+sb**2); p=pval(eff/se)
      a2=ins&~tr; b2=base&~(v==lv)&~tr
      if a2.sum()>=30 and b2.sum()>=30:
        m2,s2,n2=cmp(a2); m3,s3,n3=cmp(b2); e2=m2-m3; se2=sqrt(s2**2+s3**2); p2=pval(e2/se2)
      else: e2=se2=p2=None; n2=int(a2.sum())
      H.append(dict(dim=dn,level=str(lv),segment=sn,effect=eff,lo=eff-1.96*se,hi=eff+1.96*se,n=int(na),n_rest=int(nb),p=p,hold_effect=e2,hold_lo=None if e2 is None else e2-1.96*se2,hold_hi=None if e2 is None else e2+1.96*se2,hold_n=int(a2.sum()),hold_p=p2,coverage=round(float(cov),3)))
# BH on training p
H.sort(key=lambda h:h['p']); m=len(H)
for k,h in enumerate(H): h['q']=h['p']*m/(k+1)
for k in range(m-2,-1,-1): H[k]['q']=min(H[k]['q'],H[k+1]['q'])
for h in H:
  h['replicated']=bool(h['hold_effect'] is not None and h['hold_p']<0.05 and np.sign(h['hold_effect'])==np.sign(h['effect']))
  h['status']='candidate' if (h['q']<0.05 and h['replicated']) else ('not_replicated' if h['q']<0.05 else 'no_effect')
INTEREST={'auction venue':1.0,'auction region':1.0,'seller region (online)':0.9,'day of week':0.9,'month':0.8,'end hour (Pacific)':0.8,'tax-refund season (Feb-Apr)':0.7,'holiday week':0.7,'dividend/bonus month (Mar/Jun/Sep/Dec)':0.6,'mileage band':0.6,'channel':0.8,'market regime (12-mo index change)':0.5,'prior public sales of same car':0.7,'bid count band':0.3}
ACTION={'channel':0.6,'bid count band':0.2,'market regime (12-mo index change)':0.4,'mileage band':0.3,'prior public sales of same car':0.4}
for h in H:
  pct=math.exp(h['effect'])-1; h['pct']=pct
  h['score']=(-math.log10(max(h['q'],1e-300)))**0.5*abs(pct)*INTEREST.get(h['dim'],0.5)*ACTION.get(h['dim'],1.0)*(1 if h['replicated'] else 0.2)*min(1,h['n']/1000)**0.5
cand=sorted([h for h in H if h['status']=='candidate'],key=lambda h:-h['score'])
def headline(h):
  pct=h['pct']*100; hp=(math.exp(h['hold_effect'])-1)*100
  seg='' if h['segment']=='all cars' else f" for {h['segment']} cars"
  d=h['dim']; lv=h['level']
  w={'auction venue':f"Cars sold at {lv}",'auction region':f"Cars sold at {lv}-region live auctions",'seller region (online)':f"Online listings from {lv} sellers",'day of week':f"Online auctions ending on {lv}",'month':f"Cars sold in {lv}",'end hour (Pacific)':f"Online auctions ending {lv} Pacific",'channel':f"Cars sold on {lv}",'tax-refund season (Feb-Apr)':("Cars sold in tax-refund season (Feb-Apr)" if lv=='yes' else "Cars sold outside tax-refund season"),'holiday week':("Cars sold in holiday weeks" if lv=='yes' else 'Cars sold outside holiday weeks'),'dividend/bonus month (Mar/Jun/Sep/Dec)':('Cars sold in quarter-end months' if lv=='yes' else 'Cars sold outside quarter-end months'),'mileage band':f"Cars with {lv}",'prior public sales of same car':f"Cars with {lv} earlier public sales",'market regime (12-mo index change)':f"Cars sold in a {lv} market",'bid count band':f"BaT auctions with {lv} bids"}.get(d,f"{d}={lv}")
  return f"{w}{seg} brought {abs(pct):.0f}% {'more' if pct>0 else 'less'} than comparable cars (held up at {hp:+.0f}% in 2024-26 sales)."
for h in cand: h['headline']=headline(h)
out['hyp_counts']=dict(total=len(H),bh_sig=sum(h['q']<0.05 for h in H),candidates=len(cand),replication_rate=round(len(cand)/max(1,sum(h['q']<0.05 for h in H)),3))
out['top']=[{k:(round(v,4) if isinstance(v,float) else v) for k,v in h.items()} for h in cand[:40]]
out['hyps_all']=H
# ---- sell-through by venue and online day (all statuses)
st_=collections.defaultdict(lambda:[0,0])
for r in allev:
  if r['s'] in('upcoming','active','listed'): continue
  sold=r['s']=='sold'
  if r['ven']: st_[('venue',r['ven'][0])][0]+=sold; st_[('venue',r['ven'][0])][1]+=1
  if r['p'] in('bat','cars_and_bids','pcarmarket') and r['hour'] is not None:
    k=('online end day',(D0+dt.timedelta(days=r['d'])).strftime('%A')); st_[k][0]+=sold; st_[k][1]+=1
out['sellthrough']={f'{a}|{b}':(s,n,round(s/n,3)) for (a,b),(s,n) in st_.items() if n>=200}
# ---- readiness
rd=[]
for dn,v in vals.items():
  rd.append(dict(dim=dn,coverage=round(float(np.mean([x is not None for x in v[IDX]])),3)))
out['readiness']=rd; out['needs']=NEEDS
out['platfe']=PLATFE
json.dump(out,open('engine_out_bf.json' if BF else 'engine_out.json','w'),default=float)
print(json.dumps(out['hyp_counts']),out['join_rate']); [print(round(h['score'],3),h['headline'],h['n'],round(h['q'],6)) for h in cand[:25]]
