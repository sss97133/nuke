import json,re,collections,random
exec(open('cont3.py').read().split('out=[]')[0].replace("L=json.load(open('lex.json'))",""))
def cat2(make,model):
  t=ftok(model); c=C.get((mk(make),t))
  if not c: return None,t,0
  k,n=c.most_common(1)[0]; tot=sum(c.values())
  return (k if tot>=10 and n/tot>=0.95 else None),t,round(n/tot,3)
nm=lambda x:re.sub(r'[^a-z0-9]','',(x or '').lower())
VP=json.load(open('vp.json'))
def vt2(x):
  x=(x or '').upper()
  return 'car' if x=='PASSENGER CAR' else ('truck_utility' if x in('TRUCK','MULTIPURPOSE PASSENGER VEHICLE (MPV)','BUS','INCOMPLETE VEHICLE') else None)
out=[]
def chk(src,vid,vin,body,dmk,dmo,dyr,y,vmk,vmo,dc):
  if not dc or not dmo or re.search(r'(?i)incomplete|chassis',str(body)): return
  if re.search(r'(?i)allroad|countryman',dmo): return
  if re.search(r'(?i)\b(pickup|truck|suv|wagon|limo|limousine|popemobile|hearse|6x6)\b',vmo or ''): return
  dcat,_,_=cat2(dmk,dmo)
  if dcat!=dc: return
  if mk(dmk)[:4] and mk(vmk)[:4] and mk(dmk)[:4]!=mk(vmk)[:4] and not ({mk(dmk)[:4],mk(vmk)[:4]}&{'chev','gmc','gene'}=={'chev','gmc'}): pass
  tc,tt,p=cat2(vmk,vmo)
  if not tc or tc==dc or tt in ('alpina','saleen','ss','srt','srt10','cooper','romeo'): return
  dt=ftok(dmo)
  if dt and tt and (dt==tt or dt in nm(vmo) or tt in nm(dmo)): return
  out.append(dict(src=src,vid=vid,vin=vin,decode_cite=f"{src}: {dyr} {dmk} {dmo} body={body}",title_cite=f"vehicles: {y} {vmk} {vmo}",decoded_category=dc,title_category=tc,confidence=p))
for r in R: chk('vin_decoded_data',r[0],r[1],r[2] or r[3],r[5],r[6],r[4],r[7],r[8],r[9],bodycat(r[2]) or vt2(r[3]))
for r in VP:
  if r[10] and str(r[10]).split(',')[0] not in ('0',): pass
  chk('vin_vpic_decode',r[0],r[1],r[2],r[5],r[6],r[4],r[7],r[8],r[9],bodycat(r[2]))
print(len(out),len({o['vid'] for o in out}),collections.Counter(o['src'] for o in out),collections.Counter((o['decoded_category'],o['title_category']) for o in out))
json.dump(out,open('mm2.json','w'))
