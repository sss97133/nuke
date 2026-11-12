"""visual_identity_recheck_v1 second look: each first-look flag re-asked alone at higher resolution, without the first clue.
No DB writes. Usage: second.py W NW"""
import json,os,re,sys,time,glob,urllib.request
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
sys.path.insert(0,'/workspace/sortrun/recheck14k')
from look import claude,vdesc
PROMPT_ID='vir1-single-20261112a'
D=Path('/workspace/sortrun/recheck14k'); B=D/'big'; B.mkdir(exist_ok=True); S2=D/'single'; S2.mkdir(exist_ok=True)
meta={o['id']:o for o in json.load(open(D/'meta.json'))+json.load(open(D/'pulled_meta.json'))}
F=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',24)
def big(i):
    p=B/f'{i}.jpg'
    if not p.exists():
        u=meta[i]['image_url'].replace('/object/public/','/render/image/public/')+'?width=900&quality=80&resize=contain'
        p.write_bytes(urllib.request.urlopen(u,timeout=90).read())
    return p
def compose(i,refs):
    c=Image.open(big(i)).convert('RGB'); c.thumbnail((900,900))
    W=900+2*260; H=max(900,3*240+40)
    can=Image.new('RGB',(W,H),(0,0,0)); can.paste(c,(0,40)); d=ImageDraw.Draw(can)
    d.text((6,6),'CANDIDATE (left)',fill='yellow',font=F); d.text((910,6),'REFERENCE R1-R6',fill='cyan',font=F)
    for k,r in enumerate(refs[:6]):
        t=Image.open(D/f'img/{r}.jpg').convert('RGB'); t.thumbnail((255,235)); can.paste(t,(905+(k%2)*260,40+(k//2)*240))
    p=S2/f'{i}.jpg'; can.save(p,quality=85); return p
P="""Open the image file {path} with the Read tool. Left: one CANDIDATE photo. Right: REFERENCE photos R1-R6 of a vehicle record ({refnote}).
The candidate is currently filed on: {desc}.
The owner is a technician; engine bays, interiors, undercarriage, parts, rust close-ups, shop scenes and paperwork of this vehicle all belong. The same car can be repainted or partly disassembled over time.

Does the candidate clearly NOT belong to this vehicle record? Answer "not_this_vehicle" only with a hard visible clue (different make/model/body/generation, different body lines or trim, implausible paint difference, different VIN/plate, screenshot/catalog/listing of another car, scene with no vehicle and no vehicle part). Answer "personal" if people/home life is the main subject. Otherwise answer "belongs_or_unsure".

Answer with ONLY JSON: {{"id":"{id}","verdict":"not_this_vehicle|personal|belongs_or_unsure","clue":"<concrete, <=25 words>"}}"""
def main():
    w,nw=int(sys.argv[1]),int(sys.argv[2])
    plan={}
    for pf in os.environ.get('VIR_PLAN','sheet_plan.json').split(','):
        plan.update({p['sheet']:p for p in json.load(open(D/pf))})
    fpref=os.environ.get('VIR_FIRST','looks'); spref=os.environ.get('VIR_OUT','second')
    flags=[]
    for f in sorted([g for fp in fpref.split(',') for g in glob.glob(str(D/f'{fp}_w*.jsonl'))]):
        for L in open(f):
            d=json.loads(L)
            if d.get('ok'):
                for x in d['flags']: flags.append((d['sheet'],x))
    done=set()
    for f in glob.glob(str(D/f'{spref}_w*.jsonl')):
        for L in open(f):
            d=json.loads(L)
            if d.get('ok'): done.add(d['image_id'])
    todo=[(s,x) for k,(s,x) in enumerate(flags) if k%nw==w and x['image_id'] not in done and x['verdict']!='personal']
    print('todo',len(todo),flush=True); fails=0
    with open(D/f'{spref}_w{w}.jsonl','a') as log:
        for s,x in todo:
            p=plan[s]; i=x['image_id']; t0=time.time()
            refnote='capture-set-linked frames' if p['ref_basis']=='capture_set_link' else 'typical exterior frames from this gallery; probably this vehicle'
            try:
                path=compose(i,p['ref_ids'])
                rc,o,e=claude(P.format(path=path,refnote=refnote,desc=vdesc(p['vehicle_id']),id=i))
                m=re.findall(r'\{[\s\S]*\}',o); dd=json.loads(m[-1]); assert dd['verdict'] in('not_this_vehicle','personal','belongs_or_unsure') and dd.get('clue')
                rec={'image_id':i,'ok':True,'sheet':s,'vehicle_id':p['vehicle_id'],'state':x['state'],'first':x,'second':dd,'prompt_id':PROMPT_ID,'secs':round(time.time()-t0)}; fails=0
            except Exception as ex:
                rec={'image_id':i,'ok':False,'err':type(ex).__name__+':'+str(ex)[:100]}; fails+=1
            log.write(json.dumps(rec)+'\n'); log.flush(); print(i[:8],rec.get('ok'),rec.get('second',{}).get('verdict'),flush=True)
            if fails>=5: print('stop'); break
            if fails: time.sleep(15*fails)
if __name__=='__main__': main()
