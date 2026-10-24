import json,time,urllib.request,sys,os
codes=sys.argv[1:] or sorted({x for v in json.load(open('plan.json')).values() for x in v['codes']})
def post(code,page):
    req=urllib.request.Request(f'https://rmsothebys.com/api/search/SearchLots?page={page}&pageSize=200',data=json.dumps({'SearchTerm':'','Auction':code.upper()}).encode(),headers={'Content-Type':'application/json','Accept':'application/json','User-Agent':'Mozilla/5.0 (research; polite)'})
    return json.load(urllib.request.urlopen(req,timeout=60))
for c in codes:
    f=f'lots/{c}.json'
    if os.path.exists(f): continue
    items=[];p=1
    while True:
        d=post(c,p);items+=d['items'];time.sleep(3)
        if p>=d['pager']['totalPages']: break
        p+=1
    json.dump(items,open(f,'w'));print(c,len(items),flush=True)
