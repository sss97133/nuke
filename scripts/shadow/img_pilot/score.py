import json,glob,time,resource,collections,numpy as np,torch,open_clip
from PIL import Image
torch.set_num_threads(2)
R=json.load(open('rubric_v1.json'))
import glob as _g
from safetensors.torch import load_file
m=open_clip.create_model('ViT-B-32'); pre=open_clip.image_transform(224,is_train=False)
CK=_g.glob('/home/box/.cache/huggingface/hub/models--laion--CLIP-ViT-B-32-laion2B-s34B-b79K/snapshots/*/open_clip_model.safetensors')[0]
m.load_state_dict(load_file(CK),assign=True); m.eval(); tok=open_clip.get_tokenizer('ViT-B-32')
with torch.no_grad():
  def te(d): t=m.encode_text(tok(list(d.values()))); return t/t.norm(dim=-1,keepdim=True)
  TC,TO=te(R['condition']),te(R['originality'])
files=collections.defaultdict(list)
for f in sorted(glob.glob('im/*.jpg')): files[f.split('/')[1].rsplit('_',1)[0]].append(f)
out={}; T0=time.time()
for v,fs in files.items():
  t0=time.time(); ims=[]
  for f in fs:
    try: ims.append(pre(Image.open(f).convert('RGB')))
    except Exception: pass
  if not ims: continue
  with torch.no_grad():
    e=m.encode_image(torch.stack(ims)); e=e/e.norm(dim=-1,keepdim=True)
    pc=(100*e@TC.T).softmax(-1).numpy(); po=(100*e@TO.T).softmax(-1).numpy()
  mc=pc.mean(0); er=pc@np.arange(1,5); H=-(mc*np.log(mc+1e-12)).sum()/np.log(4)
  out[v]=dict(cond=float(mc@np.arange(1,5)),cond_dist=mc.round(4).tolist(),orig=float(po[:,0].mean()),n_img=len(ims),
              conf=float(np.clip((1-H)*(1-er.std()/1.5),0,1)),sec=time.time()-t0)
rss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024
json.dump(dict(scores=out,total_sec=time.time()-T0,peak_rss_mb=rss),open('scores_v1.json','w'))
print(len(out),'cars',round(time.time()-T0,1),'s',round(rss),'MB')
