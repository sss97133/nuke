import json,re,sys,html,urllib.request,concurrent.futures as cf,time
sys.path.insert(0,'..'); from extract_v2 import RX_ODO,num
rows=[r for r in json.load(open('cross_rows_extra.json')) if r[1] in('mecum','pcarmarket')]
def get(r):
    for a in range(3):
        try:
            h=urllib.request.urlopen(urllib.request.Request(r[2],headers={'User-Agent':'Mozilla/5.0'}),timeout=30).read().decode('utf8','ignore'); break
        except urllib.error.HTTPError as e:
            if e.code in(404,410): return dict(row=r,status=e.code)
            time.sleep(3)
        except Exception: time.sleep(3)
    else: return dict(row=r,status='err')
    mi=None;how=None
    if r[1]=='mecum':
        m=re.search(r'\\?"odometer\\?":\\?"(\d+)',h); u=re.search(r'\\?"odometerUnits\\?":\\?"([^"\\]*)',h)
        if m: mi=float(m.group(1)); how='mecum.odometer'+(':'+u.group(1) if u and u.group(1) else '')
    else:
        t=html.unescape(re.sub(r'<[^>]+>',' ',h))
        m=RX_ODO.search(t) or re.search(r'(?:showing|shows|with|has)\s+(?:approximately\s+|just\s+|only\s+|under\s+|~)?'+r'(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?\s*(?:actual\s+)?(miles)',t,re.I)
        if m:
            g=[x for x in m.groups() if x is not None]
            nums=[x for x in m.groups()]
            for i,x in enumerate(nums):
                if x and re.fullmatch(r'\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?',x):
                    k=nums[i+1] if i+1<len(nums) else None; mi=num(x,k if k and k.lower()=='k' else None); break
            how='pcarmarket.text'; 
            if re.search(r'kilomet|\bkm\b',m.group(0),re.I): mi=mi*0.621 if mi else mi; how+=':km'
    return dict(row=r,status=200,mi=mi,how=how)
with cf.ThreadPoolExecutor(3) as ex: res=list(ex.map(get,rows))
json.dump(res,open('cross_mi_extra.json','w')); print(len(res),sum(1 for x in res if x.get('mi')))
