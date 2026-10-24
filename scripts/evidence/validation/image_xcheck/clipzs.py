import os,json,torch,numpy as np
torch.set_num_threads(4)
from transformers import CLIPModel,CLIPProcessor
from PIL import Image
m=CLIPModel.from_pretrained('openai/clip-vit-base-patch32').eval();pr=CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32')
P=json.load(open('prompts.json'))
texts=[t for k,v in P.items() for t in v]
with torch.no_grad():
    te=m.get_text_features(**pr(text=texts,return_tensors='pt',padding=True)); te=getattr(te,'pooler_output',te)
te=torch.nn.functional.normalize(te,dim=-1)
rows=json.load(open('imglist.json')); out={}
ids=[r['id'] for r in rows if os.path.exists(f"im/{r['id']}.jpg")]
for k in range(0,len(ids),32):
    b=ids[k:k+32]; ims=[Image.open(f'im/{i}.jpg').convert('RGB') for i in b]
    with torch.no_grad():
        f=m.get_image_features(**pr(images=ims,return_tensors='pt')); f=getattr(f,'pooler_output',f)
    f=torch.nn.functional.normalize(f,dim=-1); s=(100*f@te.T).numpy()
    for i,row in zip(b,s):
        o={};j=0
        for key,v in P.items():
            seg=row[j:j+len(v)]; e=np.exp(seg-seg.max()); p=e/e.sum(); j+=len(v)
            o[key]=[round(float(x),4) for x in p]
        out[i]=o
json.dump(out,open('clip_scores.json','w'));print(len(out))
