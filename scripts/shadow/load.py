import json,re,glob,csv
rows=[]
for f in ["85ee759c-4ed1-4cc9-8e3c-bd2f0de0cd58","c4089ed5-76ed-45c8-9bfc-64d1ac806eb0","393b862e-8d5b-4b90-b06e-e054020c4068","e7cbd14a-8818-42e0-9a2c-4e7078173710","4a802a3b-0d73-47c0-8448-22c293b27b79","416e9368-2184-4e6c-8bf4-e61f2ccbc982"]:
    t=open(f"/workspace/agent-tools/{f}.txt").read()
    try: t=json.loads(t)["result"]
    except Exception: pass
    m=re.search(r'>\s*(\[.*\])\s*</untrusted',t,re.S); rows+=json.loads(m.group(1))
ids=set(); out=[]
for r in rows:
    if r['v'] in ids: continue
    ids.add(r['v']); out.append(r)
json.dump(out,open('rows.json','w')); print(len(rows),len(out))
