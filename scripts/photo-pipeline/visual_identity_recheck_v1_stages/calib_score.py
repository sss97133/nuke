import json,glob,sys
pref=sys.argv[1] if len(sys.argv)>1 else 'callooks'
cal=json.load(open('calib_frozen.json')); cp=json.load(open(sys.argv[2] if len(sys.argv)>2 else 'calib_plan.json'))
truth={};kind={}
for c,p in zip(cal,cp):
    for (i,t,k) in c['items']: truth[(p['sheet'],i)]=t; kind[(p['sheet'],i)]=k
fl=set();per={}
for f in glob.glob(f'{pref}_w*.jsonl'):
    for L in open(f):
        d=json.loads(L)
        if d.get('ok'):
            for x in d['flags']:
                if x['verdict'] in('wrong_vehicle','unrelated'): fl.add((d['sheet'],x['image_id'])); per[(d['sheet'],x['image_id'])]=x
tp=sum(1 for k in fl if truth[k]=='not'); fp=[k for k in fl if truth[k]=='belongs']
P=sum(1 for v in truth.values() if v=='not')
print('flags',len(fl),'TP',tp,'FP',len(fp),'precision',round(tp/max(1,len(fl)),3),'recall',round(tp/P,3),'of',P)
for k in fp: print('FP',k,per[k])
miss=[k for k,v in truth.items() if v=='not' and k not in fl]
for k in miss: print('MISS',k,kind[k])
