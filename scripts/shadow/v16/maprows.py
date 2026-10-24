# rows.json -> rows_v16.json with 'a' = the auction_event the row's sale came from (pre-set rule, see notes).
import json,collections,datetime
od=lambda s: datetime.date.fromisoformat(s).toordinal()
E=json.load(open('events.json')); BV=collections.defaultdict(list)
for v,a,d,p,mi,t in E: BV[v].append((od(d),a,float(p) if p else None,mi,t))
R=json.load(open('/workspace/nuke-strategy/shadow/rows.json')); C=collections.Counter(); out=[]
for r in R:
    r=dict(r); r['a']=None; r['am']=None
    if r['d']:
        d=od(r['d']); P=float(r['p']); L=BV.get(r['v'],[])
        x=[e for e in L if e[0]==d]
        if x: x.sort(key=lambda e:abs((e[2] or 0)-P)); r['a'],r['am']=x[0][1],'day'
        else:
            x=[e for e in L if abs(e[0]-d)<=14 and e[2] and abs(e[2]-P)<=0.01*P]
            if x: x.sort(key=lambda e:abs(e[0]-d)); r['a'],r['am']=x[0][1],'price14'
            else:
                x=[e for e in L if abs(e[0]-d)<=3]
                if x: x.sort(key=lambda e:abs(e[0]-d)); r['a'],r['am']=x[0][1],'near3'
    C[r['am']]+=1; out.append(r)
json.dump(out,open('rows_v16.json','w'))
EM={e[1]:e for e in E}
print(len(out),dict(C),'targets w/ own-event mileage',sum(1 for r in out if r['a'] and EM[r['a']][4]))
