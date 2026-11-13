"""Frozen calibration set for visual_identity_recheck_v1 (built before any first-look verdicts are read).
Negatives (belong): unreverted capture-set-linked frames of the sheet's vehicle (not used as refs).
Positives (do not belong): (a) pulled rows still carrying this vehicle_id whose prior reasoning names a different vehicle;
(b) capture-set-linked frames of a different vehicle (look-alikes included). No owner labels used anywhere."""
import json,random,collections,urllib.request
from pathlib import Path
random.seed(20261112)
plan=json.load(open('sheet_plan.json'))
meta={o['id']:o for o in json.load(open('meta.json'))}
priv=set(open('/workspace/sortrun/garage/gross_mismatch_v1/privacy_local_union.txt').read().split())
pulled=[o for o in json.load(open('pulled_meta.json')) if o['vehicle_id'] and not o['is_sensitive'] and o['id'] not in priv and o['image_url'] and 'supabase.co/storage' in o['image_url']
        and any(k in (o['vision_gate_agent_reasoning'] or '') for k in ('Different vehicle','not ','decoy','belongs','Belongs','does not match'))]
links=collections.defaultdict(list)
for l in json.load(open('links.json')):
    m=meta.get(l['image_id'])
    if m and m['vehicle_id']==l['vehicle_id'] and Path(f"img/{l['image_id']}.jpg").exists(): links[l['vehicle_id']].append(l['image_id'])
VE={x['id']:x for x in json.load(open('vehicles.json'))}
refs={}
for p in plan: refs.setdefault(p['vehicle_id'],(p['ref_ids'],p['ref_basis']))
vs=[v for v in links if len(links[v])>=20 and refs.get(v,(0,''))[1]=='capture_set_link']
pul=collections.defaultdict(list)
for o in pulled: pul[o['vehicle_id']].append(o['id'])
D=Path('img')
for o in pulled:
    p=D/f"{o['id']}.jpg"
    if not p.exists():
        u=o['image_url'].replace('/object/public/','/render/image/public/')+'?width=360&quality=70&resize=contain'
        try: p.write_bytes(urllib.request.urlopen(u,timeout=60).read())
        except Exception: pass
cal=[]
for v in vs:
    pool=[i for i in links[v] if i not in refs[v][0]]
    for rep in range(2):
        neg=random.sample(pool,min(16,len(pool)))
        pos=[('pulled_reasoned',i) for i in random.sample(pul[v],min(2,len(pul[v]))) if (D/f'{i}.jpg').exists()]
        vk=lambda x:(str(VE.get(x,{}).get('year')),str(VE.get(x,{}).get('make')),str(VE.get(x,{}).get('model')))
        others=[w for w in links if w!=v and len(links[w])>=5 and vk(w)!=vk(v)]
        while len(pos)<4:
            w=random.choice(others); pos.append(('other_vehicle_link:'+w,random.choice(links[w])))
        items=[(i,'belongs','link') for i in neg]+[(i,'not',k) for k,i in pos]
        random.shuffle(items)
        cal.append({'vehicle_id':v,'ref_ids':refs[v][0],'ref_basis':refs[v][1],'items':items})
json.dump(cal,open('calib_frozen.json','w'))
from sheets_lib import render
cp=[]
for k,c in enumerate(cal):
    key=f'cal_{k:03d}'; ids=[x[0] for x in c['items']]
    cp.append({'sheet':key,'path':render(key,c['ref_ids'],ids,'calsheets'),'vehicle_id':c['vehicle_id'],'ref_ids':c['ref_ids'],'ref_basis':c['ref_basis'],'ids':ids,'states':['cal']*len(ids)})
json.dump(cp,open('calib_plan.json','w'))
print(len(cal),'sheets',sum(len(c['items']) for c in cal),'items', sum(1 for c in cal for x in c['items'] if x[1]=='not'),'positives', collections.Counter(x[2].split(':')[0] for c in cal for x in c['items']))
