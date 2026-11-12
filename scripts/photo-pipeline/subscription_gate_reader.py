#!/usr/bin/env python3
"""subscription_gate_reader.py: the owner's Claude subscription views the landing pipeline's visual-gate samples.

Contract (docs/photo-landing-v3.md): capture_landing_finalize_plan enqueues a stratified pre_gate sample in
auto_filing_audit_queue; a viewer marks each sample correct / wrong / unclear; capture_landing_gate_check passes the chunk
when >= min(10, n) were viewed and <= 5% are wrong; capture_landing_apply_chunk files it through capture_sets_apply.
This script is that viewer, run as `claude -p` under the owner's Claude Code login (OAuth token file; ANTHROPIC_API_KEY
is stripped). It never writes vehicle_images: it records verdicts on pending audit rows and calls the pipeline's own RPCs.

Self-agreement gate (calibration, once per state dir): before any live write the reader re-reads sheets a person viewed
by hand (hand verdicts in <state>/verdicts.json, sheets in <state>/sheets/cNN.jpg) and must agree on >= 85% of samples
while accepting <= 2% of the samples the person marked wrong. A failed calibration halts the reader with no live writes.

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
    agree=sum(h==r for h,r in pairs)
    hand_wrong=sum(h=='wrong' for h,_ in pairs)
    fa=sum(h=='wrong' and r=='correct' for h,r in pairs)
    far=fa/hand_wrong if hand_wrong else 0.0
    res={'n':n,'agreement':agree/n,'false_accept_rate':far,'hand_wrong':hand_wrong,'false_accepts':fa}
    res['passed']=hand_wrong>0 and res['agreement']>=AGREEMENT_MIN and far<=FALSE_ACCEPT_MAX
    return res

def parse_verdicts(text,n):
    """The reader's answer -> exactly n statuses; anything missing or malformed is 'unclear' (never 'correct')."""
    out=[{'status':'unclear','why':'not answered'} for _ in range(n)]
    m=re.search(r'\{[\s\S]*\}',text or '')
    if not m: return out
    try: v=json.loads(m.group(0)).get('verdicts',[])
    except Exception: return out
    for x in v if isinstance(v,list) else []:
        try: j=int(x.get('s'))
        except Exception: continue
        if 0<=j<n:
            s=x.get('status'); out[j]={'status':s if s in ('correct','wrong','unclear') else 'unclear','why':str(x.get('why',''))[:160]}
    return out

def main():
    from PIL import Image,ImageDraw,ImageFont
    import pillow_heif; pillow_heif.register_heif_opener()
    ap=argparse.ArgumentParser(); ap.add_argument('--state-dir',required=True); ap.add_argument('--owner',default=os.environ.get('NUKE_OWNER_ID','0b9f107a-d124-49de-9ded-94698f63c1c4'))
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
    PROMPT="""You are the visual gate auditor for a vehicle photo library. Open the image file {path} with the Read tool.
    Top row (green, REFn) = approved reference photos of the target vehicle: {name}. The reference row can itself contain a
    mistaken frame; trust the majority. Below (orange, Sn) = sample photos the system wants to file on that vehicle.
    For EACH sample Sn decide: "correct" (clearly this same vehicle, or a closeup clearly from this same vehicle/session with matching
    paint/interior), "wrong" (a different vehicle, a non-vehicle subject, a person, a document, a screenshot of another car), or
    "unclear" (nothing identifies which vehicle). Be strict: a different color, body style or make is wrong.
    Answer with ONLY JSON: {{"verdicts":[{{"s":0,"status":"correct|wrong|unclear","why":"<12 words"}}, ...]}} covering S0..S{last}."""
    F=ImageFont.load_default(size=22)
    def fetch(u):
        p='img/'+hashlib.md5(u.encode()).hexdigest()
        if not os.path.exists(p): open(p,'wb').write(urllib.request.urlopen(u,timeout=60).read())
        return p
    def tile(u,label,sz,col):
        c=Image.new('RGB',(sz,sz+28),col)
        try: im=Image.open(fetch(u)).convert('RGB'); im.thumbnail((sz,sz)); c.paste(im,(0,28))
        except Exception: pass
        ImageDraw.Draw(c).text((4,2),label,fill='black',font=F); return c
    def sheet(out,title,refs,samples):
        sz,cols=300,6; t=[tile(u,f'REF{i}',sz,'#9f9') for i,u in enumerate(refs[:6])]
        while len(t)%cols or not t: t.append(Image.new('RGB',(sz,sz+28),'white'))
        t+= [tile(u,f'S{j}',sz,'#fd8') for j,u in enumerate(samples)]
        M=Image.new('RGB',(cols*sz,((len(t)+cols-1)//cols)*(sz+28)+34),'white'); ImageDraw.Draw(M).text((4,4),title,fill='black',font=F)
        for i,x in enumerate(t): M.paste(x,((i%cols)*sz,34+(i//cols)*(sz+28)))
        M.save(out,quality=72)
    def read_sheet(path,name,n):
        txt=claude(PROMPT.format(path=path,name=name,last=n-1))
        return parse_verdicts(txt,n)
    def calibrate():
        S=json.load(open('gate_samples.json')); I=json.load(open('sheet_index.json')); hand={v['qid']:v['status'] for v in json.load(open('verdicts.json'))}
        R={r['veh']:r['name'] for r in json.load(open('refs.json'))}
        pairs=[]
        for ci,ch in enumerate(I['chunks']):
            xs=[x for x in S if x['chunk']==ch]
            got=read_sheet(f'{D}/sheets/c{ci:02d}.jpg',R[xs[0]['veh']],len(xs))
            pairs+=[(hand[x['qid']],g['status']) for x,g in zip(xs,got)]
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
            name=' '.join(str(v[k]) for k in ('year','make','model','color') if v.get(k))
            refs=[r['thumbnail_url'] or r['image_url'] for r in get(f"vehicle_images?vehicle_id=eq.{vid}&vision_gate_status=eq.approved&is_sensitive=is.false&ai_scan_metadata->classification->>image_type=eq.vehicle_exterior&select=image_url,thumbnail_url&order=taken_at.desc.nullslast&limit=6")]
            path=f"{D}/sheets/live_{c['id'][:8]}.jpg"; sheet(path,f"{c['t_from'][:10]} target: {name}",refs,[im[x['image_id']]['thumbnail_url'] or im[x['image_id']]['image_url'] for x in q])
            got=read_sheet(path,name,len(q))
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
            if not st['calibration']['passed']: log(ev='halt',why='calibration failed; no live writes'); break
            n=live_once(); log(ev='tick',chunks=n); time.sleep(600)
        except Exception as e:
            log(ev='error',why=str(e)[:300]); time.sleep(300)


if __name__=='__main__':
    main()
