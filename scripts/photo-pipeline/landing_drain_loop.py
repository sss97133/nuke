#!/usr/bin/env python3
"""landing_drain_loop.py: bounded, resumable driver for the landing pipeline's own day queue (capture_sets_drain).

capture_set_rescore_queue is the cursor: each call scores up to 3 queued days into proposals and, for clear sets, a
pre_gate sample (capture_landing_finalize_plan). Nothing is filed here; filing waits for the visual gate. Exits when the
owner's queue is empty or after --hours. Safe beside the 5-minute cron (the drain claims rows FOR UPDATE SKIP LOCKED).

  SUPABASE_URL=... SUPABASE_SECRET_KEY=... python3 scripts/photo-pipeline/landing_drain_loop.py [--owner UUID] [--hours 40] [--delay 0]
"""
import os,json,urllib.request,urllib.error,time,datetime,argparse
ap=argparse.ArgumentParser(); ap.add_argument('--owner',default=os.environ.get('NUKE_OWNER_ID','0b9f107a-d124-49de-9ded-94698f63c1c4'))
ap.add_argument('--hours',type=float,default=40); ap.add_argument('--delay',type=int,default=0); ap.add_argument('--per-call',type=int,default=3)
a=ap.parse_args()
URL=os.environ['SUPABASE_URL'].rstrip('/'); K=os.environ.get('SUPABASE_SECRET_KEY') or os.environ['SUPABASE_SERVICE_ROLE_KEY']
H={'apikey':K,'Authorization':'Bearer '+K,'Content-Type':'application/json','Prefer':'count=exact'}
def rpc(fn,body):
    r=urllib.request.Request(f'{URL}/rest/v1/rpc/{fn}',data=json.dumps(body).encode(),headers=H,method='POST')
    try: return json.load(urllib.request.urlopen(r,timeout=320))
    except urllib.error.HTTPError as e: return {'error':e.code,'body':e.read().decode()[:300]}
    except Exception as e: return {'error':str(e)[:200]}
def pending():
    r=urllib.request.Request(f"{URL}/rest/v1/capture_set_rescore_queue?user_id=eq.{a.owner}&done_at=is.null&select=day",headers={**H,'Range':'0-0'})
    with urllib.request.urlopen(r,timeout=60) as x: return int(x.headers.get('Content-Range','*/0').split('/')[-1])
end=time.time()+a.hours*3600; time.sleep(a.delay)
while time.time()<end:
    n=pending()
    if n==0: print('queue empty',flush=True); break
    t=time.time(); r=rpc('capture_sets_drain',{'p_max':min(max(a.per_call,1),5)})
    print(json.dumps({'at':datetime.datetime.now().isoformat(timespec='seconds'),'pending':n,'secs':round(time.time()-t),'r':r})[:600],flush=True)
    time.sleep(20 if 'error' not in r else 120)
