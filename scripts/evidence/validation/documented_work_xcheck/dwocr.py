import json,os,io,sys,urllib.request
from multiprocessing import Pool
rows={r['id']:r for r in json.load(open('dwlist.json'))}
scan=json.load(open('dw_scan.json'))
todo=[i for i,v in scan.items() if v['doc']>=0.85 and v['dt'] in (0,1)]
done=set()
if os.path.exists('dw_ocr.jsonl'):
    for l in open('dw_ocr.jsonl'): done.add(json.loads(l)['id'])
todo=[i for i in todo if i not in done]
def init():
    global ocr
    from rapidocr_onnxruntime import RapidOCR
    ocr=RapidOCR(intra_op_num_threads=1)
def run(i):
    u=rows[i]['image_url']; u=u+('&' if '?' in u else '?')+'w=1600'
    try:
        b=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=40).read()
        res,_=ocr(b); return i,[[r[1],round(float(r[2]),3)] for r in (res or [])]
    except Exception as e: return i,None
print(len(todo),flush=True)
with Pool(int(sys.argv[1]),initializer=init) as p, open('dw_ocr.jsonl','a') as out:
    for n,(i,lines) in enumerate(p.imap_unordered(run,todo,chunksize=2)):
        out.write(json.dumps({'id':i,'lines':lines})+'\n'); out.flush()
        if n%200==0: print(n,flush=True)
print('done')
