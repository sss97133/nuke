import json,glob,time,resource,collections,sys,numpy as np,torch
from PIL import Image
from transformers import AutoProcessor, AutoModelForImageTextToText
torch.set_num_threads(int(sys.argv[2]) if len(sys.argv)>2 else 3)
R=json.load(open('vlm_rubric_v2.json')); MID='HuggingFaceTB/SmolVLM-256M-Instruct'
proc=AutoProcessor.from_pretrained(MID); proc.image_processor.do_image_splitting=False; proc.image_processor.size={'longest_edge':512}
m=AutoModelForImageTextToText.from_pretrained(MID,dtype=torch.bfloat16,low_cpu_mem_usage=True).eval()
tok=proc.tokenizer; D=[tok.encode(str(k),add_special_tokens=False)[-1] for k in range(1,5)]
O=[tok.encode(' original',add_special_tokens=False)[0],tok.encode(' modified',add_special_tokens=False)[0]]
files=collections.defaultdict(list)
for f in sorted(glob.glob('im/*.jpg'),key=lambda x:int(x.rsplit('_',1)[1][:-4])): files[f.split('/')[1].rsplit('_',1)[0]].append(f)
def grid(fs):
  ims=[]
  for f in fs:
    try: ims.append(Image.open(f).convert('RGB').resize((256,192)))
    except Exception: pass
    if len(ims)==4: break
  g=Image.new('RGB',(512,384)); [g.paste(im,((k%2)*256,(k//2)*192)) for k,im in enumerate(ims)]; return g,len(ims)
def ids(img,prefix):
  msg=[{'role':'user','content':[{'type':'image'},{'type':'text','text':R['prompt']}]}]
  t=proc.apply_chat_template(msg,add_generation_prompt=True)+prefix
  return proc(text=t,images=[img],return_tensors='pt')
out={}; lim=int(sys.argv[1]) if len(sys.argv)>1 else 10**9; T0=time.time()
for v,fs in list(files.items())[:lim]:
  t0=time.time(); img,n=grid(fs)
  with torch.no_grad():
    x=ids(img,'Condition: #'); lg=m(**x).logits[0,-1].float(); pc=lg[D].softmax(-1).numpy(); c=int(pc.argmax())+1
    x=ids(img,f'Condition: #{c}\nOriginality:'); lo=m(**x).logits[0,-1].float(); po=lo[O].softmax(-1).numpy(); od=float(lo[O[0]]-lo[O[1]])
    oo='original' if po[0]>=.5 else 'modified'
    x=ids(img,f'Condition: #{c}\nOriginality: {oo}\nReason: The car'); g=m.generate(**x,max_new_tokens=40,do_sample=False,repetition_penalty=1.2)
    reason='The car '+tok.decode(g[0,x['input_ids'].shape[1]:],skip_special_tokens=True).strip().split('\n')[0]
  out[v]=dict(cond=float(pc@np.arange(1,5)),cond_dist=pc.round(4).tolist(),orig=float(po[0]),orig_logit=od,conf=float(pc.max()),reason=reason,n_img=n,sec=time.time()-t0)
  if len(out)%25==0: print(len(out),round(time.time()-T0),'s rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024,flush=True)
json.dump(dict(scores=out,total_sec=time.time()-T0,peak_rss_mb=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,model=MID),open('scores_vlm_v2.json' if lim>1000 else 'scores_vlm_test.json','w'))
print('done',len(out),round(time.time()-T0),'s')
