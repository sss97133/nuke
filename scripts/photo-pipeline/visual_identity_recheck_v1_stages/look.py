"""visual_identity_recheck_v1 first look: one claude -p call per contact sheet (owner's subscription, Read tool only).
No DB writes. Appends to looks.jsonl. Usage: look.py WORKER NWORKERS"""
import json,os,re,subprocess,sys,time
from pathlib import Path
PROMPT_ID='vir1-sheet-20261112a'
D=Path('/workspace/sortrun/recheck14k')
veh={v['id']:v for v in json.load(open(D/'vehicles.json'))}
def vdesc(v):
    x=veh.get(v,{})
    parts=[str(x.get(k)) for k in ('year','make','model','trim') if x.get(k)]
    col=x.get('color') or x.get('color_primary'); body=x.get('body_style')
    return ' '.join(parts)+(f', color {col}' if col else '')+(f', body {body}' if body else '')
P="""Open the image file {path} with the Read tool. It is a contact sheet from one owner's vehicle photo library. Every candidate tile (red numbers 1-{n}) is currently filed on ONE vehicle record:
  VEHICLE: {desc}
Blue tiles R1-R{nr} above the yellow line are reference photos of that vehicle ({refnote}).

The owner is a technician: the gallery legitimately includes engine bays, interiors, undercarriage, close-ups of parts and rust, removed parts on a bench, tools, shop scenes with this vehicle in it, and paperwork. Those all BELONG unless something in the frame proves otherwise. The same car can change over time (repaint, primer, parts removed, wheels changed).

Flag a candidate ONLY when there is a hard, visible clue that it does not belong to this vehicle:
- wrong_vehicle: the main subject is clearly a different vehicle — different make/model/body style/generation, different body lines or trim, different paint where a repaint is implausible, a different VIN/plate shown, a motorcycle/boat when the record is a car, etc. Name the clue.
- unrelated: no link to this vehicle at all — e.g. a phone/web screenshot of a different car or listing, a catalog page, retail packaging with no vehicle, a scene with no vehicle and no vehicle part (landscape, house, food, pets), a document naming a different vehicle.
- personal: people, faces, kids, home life as the main subject (log only).
If unsure, or the subject is a generic part/shop detail that could plausibly be this vehicle, do NOT flag it.

Answer with ONLY JSON: {{"sheet":"{sheet}","flags":[{{"tile":<int>,"verdict":"wrong_vehicle|unrelated|personal","clue":"<concrete, <=20 words>"}}],"unreadable":false}}
Use "flags":[] when every candidate plausibly belongs."""
def claude(prompt,timeout=300):
    env={k:v for k,v in os.environ.items() if k not in('ANTHROPIC_API_KEY','CLAUDECODE','CLAUDE_CODE_ENTRYPOINT','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','GITHUB_TOKEN_WORKFLOW')}
    env['CLAUDE_CODE_OAUTH_TOKEN']=(Path.home()/'.claude_oauth_token').read_text().strip()
    p=subprocess.run(['claude','-p','--output-format','text','--allowedTools','Read'],input=prompt,capture_output=True,text=True,env=env,timeout=timeout,cwd=str(D))
    return p.returncode,p.stdout or '',(p.stderr or '')[:300]
def parse(t,n):
    m=re.findall(r'\{[\s\S]*\}',t or '')
    d=json.loads(m[-1]); fl=d.get('flags')
    assert isinstance(fl,list)
    for f in fl: assert 1<=int(f['tile'])<=n and f['verdict'] in('wrong_vehicle','unrelated','personal') and f.get('clue')
    return d
def main():
    w,nw=int(sys.argv[1]),int(sys.argv[2]); only=sys.argv[3] if len(sys.argv)>3 else None
    plan=json.load(open(D/os.environ.get('VIR_PLAN','sheet_plan.json')))
    pref=os.environ.get('VIR_OUT','looks'); out=D/f'{pref}_w{w}.jsonl'
    done=set()
    for f in D.glob(f'{pref}_w*.jsonl'):
        for L in f.read_text().splitlines():
            try:
                d=json.loads(L)
                if d.get('ok'): done.add(d['sheet'])
            except Exception: pass
    todo=[p for k,p in enumerate(plan) if k%nw==w and p['sheet'] not in done and (not only or p['sheet'].startswith(only))]
    print('todo',len(todo),flush=True); fails=0
    with out.open('a') as log:
        for p in todo:
            n=len(p['ids']); t0=time.time()
            refnote='capture-set-linked frames of this vehicle' if p['ref_basis']=='capture_set_link' else 'the most typical exterior frames already in this gallery; probably this vehicle but not guaranteed'
            pr=P.format(path=p['path'],n=n,desc=vdesc(p['vehicle_id']),nr=len(p['ref_ids']),refnote=refnote,sheet=p['sheet'])
            try:
                rc,o,e=claude(pr); d=parse(o,n)
                rec={'sheet':p['sheet'],'ok':True,'prompt_id':PROMPT_ID,'secs':round(time.time()-t0),'flags':[{**f,'image_id':p['ids'][int(f['tile'])-1],'state':p['states'][int(f['tile'])-1]} for f in d['flags']]}
                fails=0
            except Exception as ex:
                rec={'sheet':p['sheet'],'ok':False,'err':type(ex).__name__,'rc':locals().get('rc'),'out':(locals().get('o') or '')[-200:],'stderr':(locals().get('e') or '')[-200:]}
                fails+=1
            log.write(json.dumps(rec)+'\n'); log.flush()
            print(p['sheet'],rec.get('ok'),len(rec.get('flags',[])),rec.get('secs'),flush=True)
            if fails>=5: print('5 consecutive fails, stopping',flush=True); break
            if fails: time.sleep(20*fails)
if __name__=='__main__': main()
