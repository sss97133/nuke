import json,re,os,collections
ev=json.load(open('rm_events.json'));plan=json.load(open('plan.json'))
FX={'USD':1,'GBP':1.3,'EUR':1.15,'CHF':1.05,'CAD':0.75,'AUD':0.7}
def tok(s): return [w for w in re.sub(r'[^a-z0-9 ]',' ',s.lower().replace('-',' ')).split() if w]
def val(v):
    m=re.search(r'([\d,]+)\s*([A-Z]{3})',v or '');
    return (int(m.group(1).replace(',','')),m.group(2)) if m else (None,None)
lots={}
for c in set(c for p in plan.values() for c in p['codes']):
    f=f'lots/{c}.json'
    if os.path.exists(f): lots[c]=json.load(open(f))
res=[];stat=collections.Counter()
for e in ev:
    p=plan.get(e['ce'])
    if not p or not p['codes']: stat['no_plan']+=1;continue
    if any(c not in lots for c in p['codes']): stat['not_fetched']+=1;continue
    tt=tok(e['t']);ys=str(e['y']);body=[w for w in tt if w!=ys]
    if not body: stat['no_tokens']+=1;continue
    cands=[]
    for c in p['codes']:
        for l in lots[c]:
            if not l.get('sold') or l.get('valueType')!='Sold': continue
            lt=tok(l['publicName'])
            if not lt or lt[0]!=ys: continue
            if body[0] not in lt: continue
            cov=sum(w in lt for w in body)/len(body)
            if cov<0.6: continue
            a,cur=val(l['value'])
            if not a or cur not in FX: continue
            r=a*FX[cur]/e['p'] if e['p'] else None
            cands.append((cov,c,l,a,cur,r))
    if not cands: stat['no_lot']+=1;continue
    top=max(x[0] for x in cands);best=[x for x in cands if x[0]==top]
    if len(best)>1:
        bp=[x for x in best if x[5] and 0.8<=x[5]<=1.25]
        if len(bp)==1: best=bp
        else: stat['ambiguous']+=1;continue
    cov,c,l,a,cur,r=best[0]
    if cov<1 and not(r and 0.8<=r<=1.25): stat['partial_title_price_off']+=1;continue
    stat['confirmed']+=1
    if not(r and 0.8<=r<=1.25): stat['confirmed_price_differs']+=1
    res.append(dict(e=e['e'],v=e['v'],t=e['t'],code=c,lot=l['lot'],name=l['publicName'],price=a,cur=cur,link=l['link'],ref=l['referenceId'],header=l['header'],loc=l.get('location'),bid=l.get('biddingType'),coll=l.get('collection') or None,ratio=round(r,3) if r else None))
json.dump(res,open('confirmed.json','w'),indent=0)
print(dict(stat));print(collections.Counter(r['code'] for r in res).most_common(15))
