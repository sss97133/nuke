import json,re,collections
o=json.load(open('fix.json'))
DB={'Avions Voisin':54,'Flying Merkel':42,'Detroit Electric':24,'Ed Roth':12,'Covered Wagon':8,'Thunder Mountain':5,'Wills Sainte Claire':5,'Red Bug':3,'All American Racers':3,'Du Pont':2,'F.B. Mondial':2,'Rauch & Lang':2,'Lone Star':2}
WEAK={'Briggs & Stratton','Sayers & Scovill','Paul Vallée','Elite Craft','Paul Sylva','De Tamble-Miller','U.S. Long Distance'}
NONVEH=['Poster','Prize Award','Gas Pump','by Peter Helck','by Alfredo De la']
P=[]
for r in o:
    t=r['title'] or ''; rest=re.sub(r'^\d{4}\s+','',t)
    d=dict(id=r['id'],old_make=r['make'],old_model=r['model'],title=t,new_make=None,new_model=None,ref=None,flag=None)
    if r['new_make']:
        if r['match'] and r['match'].lower()=='american':
            d['flag']="canonical alias 'American'->AMC is wrong for a pre-war marque (American Underslung / American LaFrance / American Eagle); not changed"
        elif r['match']=='Mercedes-AMG':
            d['flag']="Mercedes-AMG title: canonical maps to Mercedes-Benz but would drop AMG from model; not changed"
        elif r['match']=='Mercedes' and (r['year'] or 0)<1926:
            d['flag']="pre-1926 'Mercedes' (pre-merger marque); canonical alias maps to Mercedes-Benz; not changed"
        elif (r['new_make'],r['new_model'])!=(r['make'],r['model']):
            d.update(new_make=r['new_make'],new_model=r['new_model'],ref='canonical_makes:'+r['cm_id']+' (matched "'+r['match']+'")')
    else:
        hit=None
        for m in sorted(DB,key=len,reverse=True):
            if rest==m or rest.startswith(m+' '): hit=m;break
        if hit and hit!=r['make']:
            d.update(new_make=hit,new_model=rest[len(hit):].strip() or None,ref=f'vehicles.make="{hit}" on {DB[hit]} existing non-run vehicles')
        else:
            for m in WEAK:
                if rest.startswith(m): d['flag']=f'possible multi-word make "{m}" (only 0-1 existing DB rows, no canonical entry); not changed'
    if any(k in t for k in NONVEH) or r['make'] in ('Louis','Brooklands','Indianapolis','Santa','German','Fry'):
        d['flag']=((d['flag']+'; ') if d['flag'] else '')+'lot looks like memorabilia/art, not a vehicle'
    if r['make']=='Batman': d['flag']='make "Batman" is the film title, not a maker (Batmobile); not changed'
    if r['make'] is None: d['flag']=((d['flag']+'; ') if d['flag'] else '')+'make null; title has no maker ("Custom Hot Rod")'
    P.append(d)
json.dump(P,open('plan.json','w'),ensure_ascii=False,indent=0)
ch=[p for p in P if p['new_make']]; fl=[p for p in P if p['flag']]
print('changes',len(ch),'make changed',sum(p['new_make']!=p['old_make'] for p in ch),'flagged',len(fl))
print(collections.Counter(p['old_make']+'->'+p['new_make'] for p in ch))
for p in fl: print('FLAG',p['title'],'::',p['flag'])
