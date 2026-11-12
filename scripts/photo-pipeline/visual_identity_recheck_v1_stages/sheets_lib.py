from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
try: F=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',26)
except Exception: F=ImageFont.load_default()
def tile(iid,w,h,label,col):
    im=Image.open(f'img/{iid}.jpg').convert('RGB'); im.thumbnail((w,h-4))
    c=Image.new('RGB',(w,h),(30,30,30)); c.paste(im,((w-im.width)//2,(h-im.height)//2))
    d=ImageDraw.Draw(c); d.rectangle([0,0,48 if len(label)>2 else 40,32],fill=col); d.text((4,2),label,fill='white',font=F)
    return c
def render(key,refs,ch,outdir):
    S=Path(outdir); S.mkdir(exist_ok=True)
    W,TW,TH=1500,300,260; rows=1+(len(ch)+4)//5
    canvas=Image.new('RGB',(W,40+TH*rows+10),(0,0,0)); d=ImageDraw.Draw(canvas)
    d.text((6,6),'REFERENCE (R1-R6) above the line; CANDIDATES 1-20 below',fill='yellow',font=F)
    for k,r in enumerate(refs): canvas.paste(tile(r,250,TH,f'R{k+1}',(0,90,170)),(k*250,40))
    d.line([(0,40+TH+4),(W,40+TH+4)],fill='yellow',width=6)
    for k,c in enumerate(ch): canvas.paste(tile(c,TW,TH,str(k+1),(170,0,0)),((k%5)*TW,40+TH+10+(k//5)*TH))
    p=S/f'{key}.jpg'; canvas.save(p,quality=80); return str(p.resolve())
