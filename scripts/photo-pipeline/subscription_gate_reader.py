#!/usr/bin/env python3
"""subscription_gate_reader.py: the owner's Claude subscription views the landing pipeline's visual-gate samples.

Contract (docs/photo-landing-v3.md): capture_landing_finalize_plan enqueues a stratified pre_gate sample in
auto_filing_audit_queue; a viewer marks each sample correct / wrong / unclear; capture_landing_gate_check passes the chunk
when >= min(10, n) were viewed and <= 5% are wrong; capture_landing_apply_chunk files it through capture_sets_apply.
This script is that viewer, run as `claude -p` under the owner's Claude Code login (OAuth token file; ANTHROPIC_API_KEY
is stripped). It never writes vehicle_images: it records verdicts on pending audit rows and calls the pipeline's own RPCs.

Self-agreement gate (calibration, once per state dir): before any live write the reader re-reads samples a person viewed
by hand (hand verdicts in <state>/verdicts.json; sheets re-rendered by this code into <state>/sheets/cal_cNN.jpg) and must
agree on >= 85% of samples on the decision that matters (accept = "correct" vs not-accept = "wrong"/"unclear") while
accepting <= 2% of the samples the person marked wrong. A failed calibration halts the reader with no live writes. The hand
verdicts are only ever compared against; they are never shown to the reader. --calibrate-only runs the gate and exits.

Tuning (feat/gate-reader-tuning, 2026-11-09, after the first calibration failed at 73.5% / 4 of 56 false accepts):
  * tiles are EXIF-rotated (reference JPEGs carried orientation 3/6 and were drawn upside down / sideways);
  * the vehicle name shown is year/make/model only: the record's colour text is not shown, and the references outrank the name;
  * "correct" needs a named distinguishing mark the sample shares with the references that competing owned vehicles of
    the same generation and colour lack (same generation / body / colour / make is not enough). An answer of correct
    without a vehicle-specific mark is read as unclear. When such look-alikes exist they are shown on the sheet (red,
    LOOKALIKE) and checked against the named mark;
  * dark, night, blurred or tiny samples are unclear.

Live: every 10 min, the newest awaiting_gate chunk per day for the owner; a chunk with any sensitive or personal sample is
skipped untouched. Every verdict's reason carries this reader's run id and the commit sha.
Revert: select capture_sets_revert('<chunk run_id>', null) per chunk logged in <state>/gate_reader.jsonl.

  SUPABASE_URL=... SUPABASE_SECRET_KEY=... python3 scripts/photo-pipeline/subscription_gate_reader.py --state-dir DIR [--owner UUID]
State (cursor) lives in DIR/gate_reader_state.json, so a restart resumes where it stopped.
"""
import os,json,time,hashlib,subprocess,urllib.request,datetime,uuid,re,sys,argparse

AGREEMENT_MIN=0.85
FALSE_ACCEPT_MAX=0.02

def calibration_verdict(pairs):
    """pairs: [(hand_status, reader_status)]. The self-agreement gate; pure so it can be tested."""
    valid={'correct','wrong','unclear'}
    pairs=[(h, r if r in valid else 'unclear') for h,r in pairs if h in valid]
    n=len(pairs)
    if n==0: return {'n':0,'agreement':0.0,'false_accept_rate':1.0,'hand_wrong':0,'false_accepts':0,'passed':False}
    agree=sum((h=='correct')==(r=='correct') for h,r in pairs)  # binary: accept vs not-accept (wrong/unclear alike)
    hand_wrong=sum(h=='wrong' for h,_ in pairs)
    fa=sum(h=='wrong' and r=='correct' for h,r in pairs)
    far=fa/hand_wrong if hand_wrong else 0.0
    res={'n':n,'agreement':agree/n,'false_accept_rate':far,'hand_wrong':hand_wrong,'false_accepts':fa}
    res['passed']=hand_wrong>0 and res['agreement']>=AGREEMENT_MIN and far<=FALSE_ACCEPT_MAX
    return res


GENERIC_MARK_STOP = {
    'a','an','the','and','or','of','on','in','at','to','as','with','from','for','its','it','this','that','these','those',
    'same','matching','matches','like','similar','also','very','just','also','ref','refs','reference','references',
    'vehicle','car','truck','pickup','pick-up','body','paint','painted','colour','color','scheme','trim','lower',
    'upper','faded','worn','wear','profile','front','rear','side','view','cab','crew','regular','extended','long',
    'short','bed','square','square-body','squarebody','crew-cab','crewcab','long-bed','short-bed','two-tone','twotone',
    'dark','light','bright','standard','stock','oem','generation','gen','model','make','year','style','body-style',
    'chevrolet','chevy','gmc','ford','dodge','ram','toyota','honda','jeep','cadillac','buick','oldsmobile',
    'silverado','sierra','cheyenne','scottsdale','wideside','fleetside','c10','k10','c20','k20','k1500','k2500',
    'c1500','c2500','r3500','v3500','squarebody',
    'red','blue','white','black','green','silver','gray','grey','tan','beige','brown','gold','yellow','orange','maroon','burgundy','navy',
}

GENERIC_MARK_PHRASES = (
    'crew cab', 'crew-cab', 'square body', 'square-body', 'long bed', 'long-bed', 'short bed', 'short-bed',
    'regular cab', 'extended cab', 'dark lower', 'lower body', 'faded paint', 'faded red', 'same generation',
    'same body', 'same make', 'same colour', 'same color', 'same truck', 'same car',
)

def _norm_tokens(s):
    s = (s or '').lower()
    for ph in GENERIC_MARK_PHRASES:
        s = s.replace(ph, ' ')
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    s = re.sub(r'\bref\d+\b', ' ', s)
    return [w for w in s.split() if w and w not in GENERIC_MARK_STOP and not w.isdigit()]

def mark_is_vehicle_specific(mark, vehicle=None, competitors=None):
    """True when the named mark still has a concrete leftover after stripping generation/colour/body/make terms.
    A leftover is required so "red crew-cab square-body Chevrolet" cannot pass as a distinguishing mark."""
    tokens = _norm_tokens(mark)
    if vehicle:
        for k in ('make', 'model', 'color', 'colour', 'year'):
            for w in _norm_tokens(str(vehicle.get(k) or '')):
                tokens = [t for t in tokens if t != w]
    if competitors:
        for c in competitors:
            for k in ('make', 'model', 'color', 'colour'):
                for w in _norm_tokens(str(c.get(k) or '') + ' ' + str(c.get('name') or '')):
                    tokens = [t for t in tokens if t != w]
    return len(tokens) >= 1 and len(' '.join(tokens)) >= 4

def parse_verdicts(text, n, vehicle=None, competitors=None):
    """The reader's answer -> exactly n statuses; anything missing or malformed is 'unclear' (never 'correct').
    A 'correct' with no vehicle-specific mark (or only a generation/colour/body/make description) is read as unclear."""
    out=[{'status':'unclear','why':'not answered'} for _ in range(n)]
    m=re.search(r'\{[\s\S]*\}',text or '')
    if not m: return out
    try: v=json.loads(m.group(0)).get('verdicts',[])
    except Exception: return out
    for x in v if isinstance(v,list) else []:
        try: j=int(x.get('s'))
        except Exception: continue
        if 0<=j<n:
            s=x.get('status'); s=s if s in ('correct','wrong','unclear') else 'unclear'
            mark=str(x.get('mark') or '').strip()
            if s=='correct' and (len(mark)<3 or not mark_is_vehicle_specific(mark, vehicle, competitors)):
                s='unclear'  # accept must name a mark competing same-generation look-alikes lack
            out[j]={'status':s,'why':str(x.get('why',''))[:160],'mark':mark[:120]}
    return out

def vehicle_name(v):
    """Year / make / model only. The record's colour text is not shown: the reference photos define the vehicle."""
    return ' '.join(str(v[k]) for k in ('year','make','model') if v.get(k))

def _norm_color(c):
    c = re.sub(r'[^a-z]+', '', (c or '').lower())
    aliases = {'red':'red','maroon':'red','burgundy':'red','cardinal':'red','white':'white','black':'black',
               'blue':'blue','navy':'blue','green':'green','silver':'silver','grey':'gray','gray':'gray',
               'tan':'tan','beige':'tan','brown':'brown','gold':'gold','yellow':'yellow','orange':'orange'}
    for k,v in aliases.items():
        if k in c: return v
    return c or None

def same_generation(a, b):
    """Same make (Chevrolet/GMC are one family) and a close model year, or the same model family name."""
    def make(v):
        m = (v.get('make') or '').lower()
        if m in ('chevrolet','chevy','gmc'): return 'gm'
        if m in ('ford',): return 'ford'
        if m in ('dodge','ram'): return 'ram'
        return m
    def year(v):
        try: return int(v.get('year'))
        except (TypeError, ValueError): return None
    if not a or not b or make(a) != make(b) or not make(a): return False
    ya, yb = year(a), year(b)
    if ya and yb and abs(ya - yb) > 12: return False
    return True

def same_color(a, b):
    ca, cb = _norm_color(a.get('color') or a.get('colour')), _norm_color(b.get('color') or b.get('colour'))
    if not ca or not cb: return True  # record colour often missing; do not drop a look-alike for that
    return ca == cb

def competing_owned(vehicles, target):
    """Other owned vehicles of the same generation and colour as the target (look-alikes the mark must beat)."""
    tid = target.get('id') or target.get('vehicle_id')
    out=[]
    for v in vehicles or []:
        vid = v.get('id') or v.get('vehicle_id')
        if tid and vid == tid: continue
        if same_generation(v, target) and same_color(v, target):
            out.append(v)
    return out


PROMPT="""You are the visual gate auditor for a vehicle photo library. Open the image file {path} with the Read tool.
Top row (green, REFn) = reference photos of the target vehicle ({name}). The reference photos define the vehicle; the name is
only a hint. A reference can itself be a mistaken frame; trust the majority of the references.
A red row (LOOKALIKE / NOT these), when present, shows other vehicles the owner also has of the same generation and colour.
Those are competing look-alikes: a mark that also appears on them is not distinguishing.
Below (orange, Sn) = sample photos the system wants to file on that vehicle. For EACH sample Sn decide:
- "correct" ONLY if you can name at least one vehicle-specific distinguishing mark the sample shares with the references that
  the competing same-generation-and-colour vehicles lack: a unique paint scheme or two-tone layout, a stripe or decal, specific
  wheels, a dent, rust or primer patch, an aftermarket part, a plate, a distinctive interior. Same generation, same body style,
  same colour or same make is NOT enough — including "red crew cab", "square-body", or "faded paint with a dark lower body".
  A closeup counts only when its paint, interior or part visibly matches the references and is absent from the look-alikes.
- "wrong" if it is clearly a different vehicle (a different colour scheme, body style, make or generation than the references),
  or it matches a LOOKALIKE / NOT-these vehicle better than the references, or a non-vehicle subject, a person, a document, or a
  screenshot of another car.
- "unclear" otherwise, including: too dark (night, low light), blurred, or too small to see colour and marks; a closeup with no
  matching mark; a mark you also see on a look-alike; anything you are not sure about.
Answer with ONLY JSON: {{"verdicts":[{{"s":0,"status":"correct|wrong|unclear","mark":"<the vehicle-specific mark the look-alikes lack; required for correct>","why":"<12 words"}}, ...]}} covering S0..S{last}."""

def main():
    from PIL import Image,ImageDraw,ImageFont,ImageOps
    import pillow_heif; pillow_heif.register_heif_opener()
    ap=argparse.ArgumentParser(); ap.add_argument('--state-dir',required=True); ap.add_argument('--owner',default=os.environ.get('NUKE_OWNER_ID','0b9f107a-d124-49de-9ded-94698f63c1c4')); ap.add_argument('--calibrate-only',action='store_true')
    args=ap.parse_args(); D=os.path.abspath(args.state_dir); os.makedirs(D+'/img',exist_ok=True); os.makedirs(D+'/sheets',exist_ok=True); os.chdir(D)
    URL=os.environ['SUPABASE_URL'].rstrip('/'); K=os.environ.get('SUPABASE_SECRET_KEY') or os.environ['SUPABASE_SERVICE_ROLE_KEY']; USER=args.owner
    H={'apikey':K,'Authorization':'Bearer '+K,'Content-Type':'application/json'}
    SHA=os.environ.get('NUKE_GATE_READER_SHA') or subprocess.run(['git','-C',os.path.dirname(os.path.abspath(__file__)),'rev-parse','--short','HEAD'],capture_output=True,text=True).stdout.strip() or 'unknown'; STATE=f'{D}/gate_reader_state.json'
    st=json.load(open(STATE)) if os.path.exists(STATE) else {'run':str(uuid.uuid4()),'calibration':None,'done_chunks':[]}
    def save(): json.dump(st,open(STATE,'w'),indent=1)
    save()
    LOG=open(f'{D}/gate_reader.jsonl','a')
    def log(**k): k['at']=datetime.datetime.now().isoformat(timespec='seconds'); LOG.write(json.dumps(k)+'\n'); LOG.flush(); print(json.dumps(k)[:300],flush=True)
    def req(method,path,body=None,extra=None):
        r=urllib.request.Request(URL+path,data=None if body is None else json.dumps(body).encode(),headers={**H,**(extra or {})},method=method)
        with urllib.request.urlopen(r,timeout=240) as x: t=x.read(); return json.loads(t) if t else None
    def get(p): return req('GET','/rest/v1/'+p)
    def rpc(fn,b): return req('POST','/rest/v1/rpc/'+fn,b)
    OAUTH=open(os.path.expanduser(os.environ.get('CLAUDE_OAUTH_TOKEN_FILE','~/.claude_oauth_token'))).read().strip()
    def claude(prompt):
        env={k:v for k,v in os.environ.items() if k not in ('ANTHROPIC_API_KEY','CLAUDECODE','CLAUDE_CODE_ENTRYPOINT','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY')}
        env['CLAUDE_CODE_OAUTH_TOKEN']=OAUTH
        p=subprocess.run(['claude','-p','--output-format','json','--model','sonnet','--allowedTools','Read'],input=prompt,capture_output=True,text=True,env=env,timeout=400,cwd=D)
        o=json.loads(p.stdout or '{}')
        if o.get('is_error'): raise RuntimeError(str(o.get('result'))[:200])
        return o.get('result','')
    def available():
        try: claude('Reply with the word ok'); return True
        except Exception as e: log(ev='subscription_unavailable',why=str(e)[:160]); return False
    F=ImageFont.load_default(size=22)
    def fetch(u):
        p='img/'+hashlib.md5(u.encode()).hexdigest()
        if not os.path.exists(p): open(p,'wb').write(urllib.request.urlopen(u,timeout=60).read())
        return p
    def tile(u,label,sz,col):
        c=Image.new('RGB',(sz,sz+28),col)
        try: im=ImageOps.exif_transpose(Image.open(fetch(u))).convert('RGB'); im.thumbnail((sz,sz)); c.paste(im,(0,28))
        except Exception: pass
        ImageDraw.Draw(c).text((4,2),label,fill='black',font=F); return c
    def sheet(out,title,refs,samples,lookalikes=None):
        sz,cols=300,6; t=[tile(u,f'REF{i}',sz,'#9f9') for i,u in enumerate(refs[:6])]
        while len(t)%cols or not t: t.append(Image.new('RGB',(sz,sz+28),'white'))
        if lookalikes:
            t+= [tile(u,f'LOOKALIKE{i}',sz,'#f99') for i,u in enumerate(lookalikes[:6])]
            while len(t)%cols: t.append(Image.new('RGB',(sz,sz+28),'white'))
        t+= [tile(u,f'S{j}',sz,'#fd8') for j,u in enumerate(samples)]
        M=Image.new('RGB',(cols*sz,((len(t)+cols-1)//cols)*(sz+28)+34),'white'); ImageDraw.Draw(M).text((4,4),title,fill='black',font=F)
        for i,x in enumerate(t): M.paste(x,((i%cols)*sz,34+(i//cols)*(sz+28)))
        M.save(out,quality=72)
    def read_sheet(path,name,n,vehicle=None,competitors=None):
        txt=claude(PROMPT.format(path=path,name=name,last=n-1))
        return parse_verdicts(txt,n,vehicle=vehicle,competitors=competitors)
    def load_owned():
        try:
            return get(f'vehicles?user_id=eq.{USER}&select=id,year,make,model,color&limit=500') or []
        except Exception:
            return []
    def lookalike_urls(comps):
        urls=[]
        for v in comps[:4]:
            vid=v.get('id')
            if not vid: continue
            try:
                refs=get(f"vehicle_images?vehicle_id=eq.{vid}&vision_gate_status=eq.approved&is_sensitive=is.false&ai_scan_metadata->classification->>image_type=eq.vehicle_exterior&select=image_url,thumbnail_url&order=taken_at.desc.nullslast&limit=2") or []
            except Exception:
                refs=[]
            urls += [r['thumbnail_url'] or r['image_url'] for r in refs if r.get('thumbnail_url') or r.get('image_url')]
        return urls[:6]
    def calibrate():
        S=json.load(open('gate_samples.json')); I=json.load(open('sheet_index.json')); hand={v['qid']:v['status'] for v in json.load(open('verdicts.json'))}
        R={r['veh']:r for r in json.load(open('refs.json'))}
        pairs=[]
        for ci,ch in enumerate(I['chunks']):
            xs=[x for x in S if x['chunk']==ch]; r=R[xs[0]['veh']]
            name=vehicle_name(r['vehicle']) if r.get('vehicle') else r['name']
            path=f'{D}/sheets/cal_c{ci:02d}.jpg'
            veh=r.get('vehicle') or {}
            comps=competing_owned(load_owned(), {**veh, 'id': xs[0].get('veh') or veh.get('id')})
            look=lookalike_urls(comps)
            title=f"{xs[0].get('day','')} target: {name}" + (f"  LOOKALIKES: {len(comps)}" if comps else "")
            sheet(path,title,list(r['refs'])[:6],[x['url'] for x in xs],lookalikes=look)
            got=read_sheet(path,name,len(xs),vehicle=veh,competitors=comps)
            pairs+=[(hand[x['qid']],g['status']) for x,g in zip(xs,got)]
            for x,g in zip(xs,got): log(ev='calibration_sample',sheet=ci,qid=x['qid'],hand=hand[x['qid']],read=g['status'],mark=g.get('mark',''),why=g.get('why',''))
            log(ev='calibration_sheet',sheet=ci,**calibration_verdict(pairs))
        return calibration_verdict(pairs)
    def live_once():
        ch=get(f'capture_landing_chunks?user_id=eq.{USER}&state=eq.awaiting_gate&dry=is.false&select=id,run_id,t_from,created_at&order=created_at.desc')
        seen=set(); n=0
        for c in ch:
            if c['t_from'] in seen: continue
            seen.add(c['t_from'])
            if c['id'] in st['done_chunks']: continue
            q=get(f"auto_filing_audit_queue?run_id=eq.{c['run_id']}&source=eq.pre_gate&status=eq.pending&select=id,image_id,vehicle_id&order=id")
            if not q: continue
            ids=','.join(x['image_id'] for x in q)
            im={r['id']:r for r in get(f'vehicle_images?id=in.({ids})&select=id,image_url,thumbnail_url,is_sensitive,vision_gate_status')}
            if any(im[x['image_id']].get('is_sensitive') or im[x['image_id']].get('vision_gate_status')=='rejected_personal' for x in q):
                log(ev='skip_sensitive',chunk=c['id']); st['done_chunks'].append(c['id']); save(); continue
            vid=q[0]['vehicle_id']; v=get(f'vehicles?id=eq.{vid}&select=year,make,model,color')[0]
            name=vehicle_name(v)
            refs=[r['thumbnail_url'] or r['image_url'] for r in get(f"vehicle_images?vehicle_id=eq.{vid}&vision_gate_status=eq.approved&is_sensitive=is.false&ai_scan_metadata->classification->>image_type=eq.vehicle_exterior&select=image_url,thumbnail_url&order=taken_at.desc.nullslast&limit=6")]
            comps=competing_owned(load_owned(), {**v, 'id': vid})
            look=lookalike_urls(comps)
            path=f"{D}/sheets/live_{c['id'][:8]}.jpg"
            title=f"{c['t_from'][:10]} target: {name}" + (f"  LOOKALIKES: {len(comps)}" if comps else "")
            sheet(path,title,refs,[im[x['image_id']]['thumbnail_url'] or im[x['image_id']]['image_url'] for x in q],lookalikes=look)
            got=read_sheet(path,name,len(q),vehicle=v,competitors=comps)
            for x,g in zip(q,got):
                s=g['status'] if g['status'] in ('correct','wrong','unclear') else 'unclear'
                req('PATCH',f"/rest/v1/auto_filing_audit_queue?id=eq.{x['id']}&status=eq.pending",{'status':s,'verified_at':datetime.datetime.utcnow().isoformat()+'Z',
                    'reason':f"viewed (claude-cli sonnet subscription gate reader run {st['run']}, main@{SHA}): {str(g.get('why',''))[:160]}"})
            g=rpc('capture_landing_gate_check',{'p_chunk':c['id']}); applied=None
            cur=get(f"capture_landing_chunks?id=eq.{c['id']}&select=state")[0]['state']
            for _ in range(6):
                if cur!='applying': break
                applied=rpc('capture_landing_apply_chunk',{'p_chunk':c['id'],'p_budget_s':40}); cur=get(f"capture_landing_chunks?id=eq.{c['id']}&select=state")[0]['state']
            log(ev='chunk',chunk=c['id'],chunk_run=c['run_id'],day=c['t_from'][:10],vehicle=name,verdicts=[x['status'] for x in got],gate=g,apply=applied,state=cur)
            st['done_chunks'].append(c['id']); save(); n+=1
        return n
    while True:
        try:
            if not available(): time.sleep(900); continue
            if st['calibration'] is None:
                st['calibration']=calibrate(); save(); log(ev='calibration',**st['calibration'])
            if args.calibrate_only: log(ev='calibrate_only_done',passed=st['calibration']['passed']); break
            if not st['calibration']['passed']: log(ev='halt',why='calibration failed; no live writes'); break
            n=live_once(); log(ev='tick',chunks=n); time.sleep(600)
        except Exception as e:
            log(ev='error',why=str(e)[:300]); time.sleep(300)


if __name__=='__main__':
    main()
