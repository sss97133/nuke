import sys,json,numpy as np
sys.path.insert(0,"/workspace/wt-imganalysis/scripts/photo-pipeline")
import local_image_analysis_model as M
from PIL import Image
from pathlib import Path
ids=json.load(open('universe_ids.json'))
R=M.Reader(threads=8,label_model="b32")
out={};E=[];keep=[]
B=32
for i in range(0,len(ids),B):
    chunk=[x for x in ids[i:i+B] if Path(f'img/{x}.jpg').exists()]
    ims=[];ok=[]
    for x in chunk:
        try: ims.append(Image.open(f'img/{x}.jpg').convert('RGB')); ok.append(x)
        except Exception: pass
    if not ims: continue
    for x,r in zip(ok,R.read(ims)):
        E.append(np.array(r.pop('embedding'),dtype=np.float32)); keep.append(x); out[x]=r
    if i%1600==0: print(i,len(keep),flush=True)
np.savez('clip.npz',ids=np.array(keep),emb=np.stack(E))
json.dump(out,open('clip_read.json','w'))
print('done',len(keep))
