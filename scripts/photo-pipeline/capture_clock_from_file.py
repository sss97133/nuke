#!/usr/bin/env python3
"""capture_clock_from_file.py: recover the camera clock from the stored file for unfiled photos whose row has none.

Why: some ingest paths stored the image but not its EXIF (image_intake saved exif_data = {}; part of the user_upload bulk
web upload kept only partial metadata), so the planner (capture_set_photo_admits) cannot see a camera clock, and for some
rows taken_at is the upload time. The file in storage often still carries DateTimeOriginal.

Read order (first hit wins), all from the stored bytes, never from the filename or upload time:
  1. EXIF DateTimeOriginal (+ OffsetTimeOriginal when present)       -> capture_clock_source 'file_exif'
  2. (replay only, never written) XMP photoshop:DateCreated / exif:DateTimeOriginal (with or without offset) -> 'file_xmp'
Local times without an offset are read as America/Los_Angeles, the convention the existing ingest used (checked: rows whose
taken_at already came from EXIF match this conversion).

Writes (live mode only, <= --limit rows per run, each row signed with this run id and commit):
  exif_data  += {DateTimeOriginal, OffsetTimeOriginal?, capture_clock: {source, run_id, producer, prior_taken_at}}
  taken_at    = the recovered instant, only when it differs from the stored taken_at by more than 120 s.
Before writing, the rows' prior (id, taken_at, exif_data) go to capture_clock_backfill_log (one row per image per run).
Revert a run: select capture_clock_backfill_revert('<run_id>') (migration 20261113121000).

  python3 capture_clock_from_file.py --owner UUID --out replay.jsonl [--live --run-id UUID --limit 50 --ids-file f]
"""
import os,re,sys,json,uuid,argparse,datetime,subprocess,urllib.request
from zoneinfo import ZoneInfo

LA=ZoneInfo('America/Los_Angeles')
SOURCES=('user_upload','owner_upload','drop-folder','image_intake')
XMP_RE=re.compile(rb'(?:photoshop:DateCreated|exif:DateTimeOriginal|xmp:CreateDate)\s*(?:=\s*"|>)\s*(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:\.\d+)?)([+-]\d\d:\d\d|Z)?')

def parse_exif_clock(dto, off=None):
    """'YYYY:MM:DD HH:MM:SS' (+ '+HH:MM') -> aware datetime, or None for blank / zero / implausible values."""
    if not dto or not isinstance(dto,str): return None
    m=re.match(r'^\s*(\d{4}):(\d\d):(\d\d)[ T](\d\d):(\d\d):(\d\d)',dto)
    if not m: return None
    y,mo,d,h,mi,s=map(int,m.groups())
    if y<1990 or y>2100 or mo==0 or d==0: return None
    try: naive=datetime.datetime(y,mo,d,h,mi,s)
    except ValueError: return None
    if off and re.match(r'^[+-]\d\d:\d\d$',off.strip()):
        sg=1 if off.strip()[0]=='+' else -1; hh,mm=map(int,off.strip()[1:].split(':'))
        return naive.replace(tzinfo=datetime.timezone(sg*datetime.timedelta(hours=hh,minutes=mm)))
    return naive.replace(tzinfo=LA)

def parse_xmp_clock(raw):
    m=XMP_RE.search(raw or b'')
    if not m: return None
    t=m.group(1).decode(); off=(m.group(2) or b'').decode()
    t=t.split('.')[0]
    if len(t)==16: t+=':00'
    if off=='Z': off='+00:00'
    return parse_exif_clock(t.replace('-',':',2).replace('T',' '), off or None)

def read_clock(raw):
    """bytes -> (aware datetime, source, exif_keys) from the file itself, or (None, None, {})."""
    from io import BytesIO
    from PIL import Image
    try:
        import pillow_heif; pillow_heif.register_heif_opener()
    except Exception: pass
    try:
        im=Image.open(BytesIO(raw)); ex=im.getexif(); ifd=ex.get_ifd(0x8769)
        dto=ifd.get(36867); off=ifd.get(36881)
        t=parse_exif_clock(dto, off)
        cam={k:str(v).strip('\x00 ') for k,v in (('Make',ex.get(271)),('Model',ex.get(272))) if v}
        if t: return t,'file_exif',{'DateTimeOriginal':dto, **({'OffsetTimeOriginal':off} if off else {}), **cam}
    except Exception: pass
    t=parse_xmp_clock(raw[:400000])
    if t: return t,'file_xmp',{'DateTimeOriginal':t.astimezone(LA).strftime('%Y:%m:%d %H:%M:%S')}
    return None,None,{}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--owner',required=True); ap.add_argument('--out',required=True)
    ap.add_argument('--live',action='store_true'); ap.add_argument('--run-id'); ap.add_argument('--limit',type=int,default=50); ap.add_argument('--ids-file')
    a=ap.parse_args()
    U=os.environ['SUPABASE_URL'].rstrip('/'); K=os.environ.get('SUPABASE_SECRET_KEY') or os.environ['SUPABASE_SERVICE_ROLE_KEY']
    H={'apikey':K,'Authorization':'Bearer '+K,'Content-Type':'application/json'}
    SHA=subprocess.run(['git','-C',os.path.dirname(os.path.abspath(__file__)),'rev-parse','--short=12','HEAD'],capture_output=True,text=True).stdout.strip() or 'unknown'
    PRODUCER=f'{SHA}:scripts/photo-pipeline/capture_clock_from_file.py'
    def req(m,p,b=None,extra=None):
        r=urllib.request.Request(U+p,data=None if b is None else json.dumps(b).encode(),headers={**H,**(extra or {})},method=m)
        with urllib.request.urlopen(r,timeout=120) as x: t=x.read(); return json.loads(t) if t else None
    if a.live and not a.run_id: sys.exit('--live needs --run-id')
    # pool: unfiled, not duplicate/superseded/sensitive/personal, upload-class source, no camera clock on the row
    rows=[]; off=0
    sel='id,source,image_url,taken_at,created_at,exif_data,is_sensitive,vision_gate_status'
    while True:
        page=req('GET',f"/rest/v1/vehicle_images?user_id=eq.{a.owner}&vehicle_id=is.null&is_duplicate=not.is.true&is_superseded=not.is.true"
                       f"&source=in.({','.join(SOURCES)})&select={sel}&order=id&limit=1000&offset={off}")
        rows+=page; off+=1000
        if len(page)<1000: break
    rows=[r for r in rows if not (r.get('exif_data') or {}).get('DateTimeOriginal') and not r.get('is_sensitive')
          and (r.get('vision_gate_status') or '')!='rejected_personal' and (r.get('image_url') or '')]
    if a.ids_file: keep=set(json.load(open(a.ids_file))); rows=[r for r in rows if r['id'] in keep]
    out=open(a.out,'w'); n_live=0; summary={'pool':len(rows),'file_exif':0,'file_xmp':0,'none':0,'fetch_error':0,'taken_at_changes':0,'writable':0,'writable_changes':0,'written':0}
    for r in rows:
        if a.live and n_live>=a.limit: break
        try: raw=urllib.request.urlopen(r['image_url'],timeout=60).read()
        except Exception as e:
            summary['fetch_error']+=1; out.write(json.dumps({'id':r['id'],'error':str(e)[:80]})+'\n'); continue
        t,src,keys=read_clock(raw)
        prior=r.get('taken_at')
        rec={'id':r['id'],'source':r['source'],'prior_taken_at':prior,'created_at':r['created_at'],'clock':t.isoformat() if t else None,'clock_source':src,'keys':keys}
        if not t: summary['none']+=1; out.write(json.dumps(rec)+'\n'); continue
        summary[src]+=1
        p=datetime.datetime.fromisoformat(prior.replace('Z','+00:00')) if prior else None
        change=p is None or abs((t-p).total_seconds())>120
        # only a camera original is written: file EXIF clock + camera Make. XMP dates (screenshots, edited graphics) are
        # reported in the replay but never written.
        rec['writable']=src=='file_exif' and bool(keys.get('Make'))
        rec['taken_at_change']=change; summary['taken_at_changes']+=change; summary['writable']+=rec['writable']
        summary['writable_changes']+=rec['writable'] and change
        out.write(json.dumps(rec)+'\n')
        if not a.live or not rec['writable']: continue
        res=req('POST','/rest/v1/rpc/capture_clock_backfill_apply',{'p_run':a.run_id,'p_image':r['id'],'p_clock':t.isoformat(),
                 'p_keys':{**keys,'capture_clock':{'source':src,'run_id':a.run_id,'producer':PRODUCER,'prior_taken_at':prior}},'p_set_taken_at':change})
        summary['written']+= 1 if res else 0; n_live+=1
    summary.update({'live':a.live,'run_id':a.run_id,'producer':PRODUCER}); print(json.dumps(summary))

if __name__=='__main__':
    main()
