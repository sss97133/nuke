"""visual_identity_recheck_v1: build per-vehicle reference + candidate contact sheets (local, no DB writes)."""
import json,collections,numpy as np,datetime
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
VERSION='visual_identity_recheck_v1'
D=Path('.');S=D/'sheets';S.mkdir(exist_ok=True)
meta={o['id']:o for o in json.load(open('meta.json'))}
st={x['image_id']:x['state'] for x in json.load(open('ledger_start.json'))}
veh={v['id']:v for v in json.load(open('vehicles.json'))}
uni=[i for i in json.load(open('universe_ids.json')) if (D/f'img/{i}.jpg').exists()]
z=np.load('clip.npz'); cid=list(z['ids']); E=z['emb']; idx={k:n for n,k in enumerate(cid)}
rd=json.load(open('clip_read.json'))
links=collections.defaultdict(set)
for l in json.load(open('links.json')): links[l['vehicle_id']].add(l['image_id'])
EXT={'exterior_front','exterior_rear','exterior_side','exterior_three_quarter','exterior_front_three_quarter','exterior_rear_three_quarter'}
try: F=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',26)
except Exception: F=ImageFont.load_default()
def tile(iid,w,h,label,col):
    im=Image.open(D/f'img/{iid}.jpg').convert('RGB'); im.thumbnail((w,h-4))
    c=Image.new('RGB',(w,h),(30,30,30)); c.paste(im,((w-im.width)//2,(h-im.height)//2))
    d=ImageDraw.Draw(c); d.rectangle([0,0,48 if len(label)>2 else 40,32],fill=col); d.text((4,2),label,fill='white',font=F)
    return c
def refs_for(v,members):
    on=[m for m in members if st.get(m)=='on_vehicle']
    lk=[m for m in on if m in links[v] and m in idx]
    ext=lambda m: rd.get(m,{}).get('view','').startswith('exterior')
    pool=[m for m in lk if ext(m)] or lk
    basis='capture_set_link'
    if len(pool)<4:
        basis='clip_medoid_exterior'
        cand=[m for m in on if m in idx and ext(m)] or [m for m in on if m in idx]
        if not cand: return [],'none'
        X=E[[idx[m] for m in cand]]; cen=X.mean(0); cen/=np.linalg.norm(cen)
        sims=X@cen; order=np.argsort(-sims)
        pool=[cand[j] for j in order[:max(12,len(cand)//10)]]
    # spread across days
    pool=sorted(pool,key=lambda m: meta[m]['taken_at'] or '')
    step=max(1,len(pool)//6); return pool[::step][:6],basis
plan=[]
byv=collections.defaultdict(list)
for i in uni:
    if meta[i]['vehicle_id']: byv[meta[i]['vehicle_id']].append(i)
for v,members in byv.items():
    refs,basis=refs_for(v,members)
    for state in ('on_vehicle','unverified'):
        cands=sorted([m for m in members if st[m]==state],key=lambda m:(meta[m]['taken_at'] or meta[m]['created_at'] or ''))
        for n in range(0,len(cands),20):
            ch=cands[n:n+20]; key=f"{state[:2]}_{v[:8]}_{n//20:04d}"
            W,TW,TH=1500,300,260
            rows=1+(len(ch)+4)//5
            canvas=Image.new('RGB',(W,40+TH*rows+10),(0,0,0)); d=ImageDraw.Draw(canvas)
            d.text((6,6),'REFERENCE (R1-R6) above the line; CANDIDATES 1-20 below',fill='yellow',font=F)
            for k,r in enumerate(refs): canvas.paste(tile(r,250,TH,f'R{k+1}',(0,90,170)),(k*250,40))
            d.line([(0,40+TH+4),(W,40+TH+4)],fill='yellow',width=6)
            for k,c in enumerate(ch): canvas.paste(tile(c,TW,TH,str(k+1),(170,0,0)),((k%5)*TW,40+TH+10+(k//5)*TH))
            p=S/f'{key}.jpg'; canvas.save(p,quality=80)
            plan.append({'sheet':key,'path':str(p.resolve()),'vehicle_id':v,'ref_ids':refs,'ref_basis':basis,'ids':ch,'states':[st[c] for c in ch]})
json.dump(plan,open('sheet_plan.json','w'))
print(len(plan),'sheets',sum(len(p['ids']) for p in plan),'photos',collections.Counter(p['ref_basis'] for p in plan))
