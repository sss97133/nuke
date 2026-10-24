import json,re,sys,collections
sys.path.insert(0,'/workspace/v15'); 
E=[]
for f in open('ev_files.txt').read().split():
    t=open(f).read()
    try: t=json.loads(t)['result']
    except Exception: pass
    m=re.search(r'\n(\[.*\])\n',t,re.S); s=json.loads(m.group(1))[0]['s'] or ''
    for l in s.split('\n'):
        p=l.split('|')
        if len(p)==6: E.append(p)
print('events',len(E),'with mileage',sum(1 for p in E if p[4]),'tmu',sum(1 for p in E if p[5]=='t'),'distinct',len({p[1] for p in E}))
json.dump(E,open('events.json','w'))
