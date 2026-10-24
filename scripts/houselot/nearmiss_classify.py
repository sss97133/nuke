import json,re,collections
rows=json.load(open('rows.json'))
def tok(x): return re.sub('[^a-z0-9]+',' ',x.lower()).split()
B=set("automatic automati manual speed ci hp cid cu in by coachwork convertible conver coupe coup cou sedan roadster hardtop hard top door two four 2d 4d fastback wagon station car the of".split())
def okw(w): return w in B or re.fullmatch(r'\d{3}',w) or re.fullmatch(r'\d+(\.\d)?l',w)
for r in rows:
    hu=set(tok(r['hu'])); tw=[w for w in tok(re.sub(r'^\d{4}\s*','',r['title'])) if len(w)>=2]
    r['miss']=[w for w in tw if w not in hu]
    r['bodyonly']=all(okw(w) for w in r['miss'])
json.dump(rows,open('rows.json','w'))
if __name__=='__main__':
    c=collections.Counter()
    for r in rows:
        c[(r['bodyonly'], bool(r['vin'] and len(r['vin'])==17), r['verification_status'], r['tvc'][:10]<'2026-10-24', r['profile_origin'])]+=1
    for k,v in sorted(c.items(),key=lambda x:-x[1]): print(v,k)
