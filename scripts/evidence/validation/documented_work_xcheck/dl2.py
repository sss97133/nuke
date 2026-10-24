import json,os,io,concurrent.futures as cf,urllib.request
from PIL import Image
rows=json.load(open('dwlist.json'))
def go(r):
    p=f"dw/{r['id']}.jpg"
    if os.path.exists(p): return 1
    u=r['image_url']; u=u+('&' if '?' in u else '?')+'w=640'
    try:
        b=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=30).read()
        im=Image.open(io.BytesIO(b)).convert('RGB'); im.thumbnail((448,448)); im.save(p,quality=88); return 1
    except Exception as e: return 0
with cf.ThreadPoolExecutor(24) as ex: ok=sum(ex.map(go,rows))
print('ok',ok,len(rows))
