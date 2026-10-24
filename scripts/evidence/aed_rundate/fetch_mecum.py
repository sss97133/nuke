import json,re,sys,time,urllib.request,concurrent.futures as cf,os,datetime
rows=json.load(open(sys.argv[1])); out=sys.argv[2]
done=set()
if os.path.exists(out):
    for l in open(out): done.add(json.loads(l)['id'])
RX=re.compile(r"RunDate\\?\",\\?\"slug\\?\":\\?\"[^\"\\]*\\?\",\\?\"name\\?\":\\?\"([0-9-]{10})")
RXL=re.compile(r'\\?"lotNumber\\?":\\?"([^"\\]*)')
RXS=re.compile(r'\\?"saleResults\\?":\\?"([^"\\]*)')
def get(r):
    i,u=r[0],r[1]
    for a in range(3):
        try:
            req=urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0 (X11; Linux x86_64)'})
            h=urllib.request.urlopen(req,timeout=30).read().decode('utf8','ignore')
            m=RX.search(h); l=RXL.search(h); s=RXS.search(h)
            d=None
            if m:
                try: d=datetime.date.fromisoformat(m.group(1)).isoformat()
                except Exception: pass
            return dict(id=i,url=u,run_date_raw=m.group(1) if m else None,run_date=d,page_lot=l.group(1) if l else None,event_slug=s.group(1) if s else None,fetched_at=datetime.datetime.utcnow().isoformat()+'Z',status=200)
        except urllib.error.HTTPError as e:
            if e.code in (404,410): return dict(id=i,url=u,status=e.code)
            time.sleep(2*(a+1))
        except Exception as e: time.sleep(2*(a+1))
    return dict(id=i,url=u,status='err')
todo=[r for r in rows if r[0] not in done]
with open(out,'a') as f, cf.ThreadPoolExecutor(4) as ex:
    for n,res in enumerate(ex.map(get,todo)):
        f.write(json.dumps(res)+'\n'); f.flush()
        if n%250==0: print(n,len(todo),flush=True)
