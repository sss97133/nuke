import json,re,html
S=json.load(open('sample50.json')); res=[]
for i,x in enumerate(S):
  t=open(f'pages/{i}.html',errors='ignore').read()
  t=html.unescape(re.sub(r'<[^>]+>',' ',re.sub(r'(?s)<(script|style)[^>]*>.*?</\1>',' ',t)))
  t=re.sub(r'\s+',' ',t)
  # also keep raw json in scripts
  raw=open(f'pages/{i}.html',errors='ignore').read()
  ok=None;ev=''
  if x['rule']=='tmu':
    g=re.search(r'.{0,60}(TMU|True Mileage Unknown|mileage unknown|exempt).{0,40}',t,re.I); ok=bool(g); ev=g.group(0) if g else ''
  else:
    o=x['orig']; forms={f'{o:,.0f}',f'{o:.0f}'}
    if o>=1000 and o%1000==0: forms.add(f'{o/1000:.0f}k')
    if o>=1000 and o%100==0: forms.add(f'{o/1000:.1f}k'.replace('.0k','k'))
    for f in forms:
      g=re.search(r'.{0,50}(?<![\d,.])'+re.escape(f)+r'(?![\d,])\S{0,1}\s*(?:-|\s)?(?:actual |original |indicated )?(miles?|kilomet|km|on the odo).{0,30}',t,re.I) or re.search(r'.{0,40}(odometer|mileage)\D{0,40}(?<![\d,.])'+re.escape(f)+r'(?![\d,]).{0,20}',t,re.I)
      if g: ok=True;ev=g.group(0);break
    if not ok:
      g=re.search(r'"(?:mileage|odometer)[^"]*"\s*:\s*"?([\d,]+)',raw,re.I); ev='json:'+(g.group(1) if g else '') ; ok=False
  res.append(dict(i=i,s=x['s'],rule=x['rule'],val=x['mi'],orig=x['orig'],ok=ok,claim=x['claim'][:90],page=ev[:140],u=x['u']))
json.dump(res,open('verify50.json','w'),indent=0)
for r in res: print(r['i'],r['s'],r['rule'],r['orig'],r['ok'],'|',r['claim'][:70],'||',r['page'][:110])
print('confirmed',sum(r['ok'] for r in res),'/',len(res))
