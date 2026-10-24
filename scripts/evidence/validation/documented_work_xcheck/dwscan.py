import os,json,torch,numpy as np
torch.set_num_threads(4)
from transformers import CLIPModel,CLIPProcessor
from PIL import Image
m=CLIPModel.from_pretrained('openai/clip-vit-base-patch32').eval();pr=CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32')
P=json.load(open('prompts.json'));scene=P['scene']
dt=["a photo of a shop receipt or repair invoice","a photo of a handwritten or printed service record log","a photo of a car window sticker","a photo of a vehicle title or registration certificate","a screenshot of a Carfax vehicle history report","a photo of an owner's manual or book"]
texts=scene+dt
with torch.no_grad():
    te=m.get_text_features(**pr(text=texts,return_tensors='pt',padding=True)); te=getattr(te,'pooler_output',te)
te=torch.nn.functional.normalize(te,dim=-1)
out={}
ids=[f[:-4] for f in os.listdir('dw') if f.endswith('.jpg')]
for k in range(0,len(ids),64):
    b=ids[k:k+64]; ims=[]
    for i in b:
        try: ims.append(Image.open(f'dw/{i}.jpg').convert('RGB'))
        except Exception: ims.append(Image.new('RGB',(224,224)))
    with torch.no_grad():
        f=m.get_image_features(**pr(images=ims,return_tensors='pt')); f=getattr(f,'pooler_output',f)
    s=(100*torch.nn.functional.normalize(f,dim=-1)@te.T).numpy()
    for i,r in zip(b,s):
        a=r[:6];a=np.exp(a-a.max());a/=a.sum(); c=r[6:];c=np.exp(c-c.max());c/=c.sum()
        out[i]={'doc':round(float(a[4]),4),'dt':int(np.argmax(c)),'dtp':round(float(c.max()),4)}
json.dump(out,open('dw_scan.json','w'));print(len(out),sum(v['doc']>=0.85 for v in out.values()))
