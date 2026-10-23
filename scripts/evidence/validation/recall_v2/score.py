import json
D=json.load(open('draw.json'))['ids']; L=json.load(open('labels.json')); E=json.load(open('../extracted_v2.json'))
res={}; det=[]
def f(o,k): return [x for x in o if x['field']==k]
agg={k:dict(applicable=0,found=0,correct=0,ext_emitted=0,ext_correct=0) for k in ['condition_grade','repaint','ownership_duration','documented_work','numbers_matching','mileage']}
for i,v in enumerate(D):
    l=L[str(i)]; o=E[v]
    # condition: applicable = label>=3 ; found = ext>=3 ; correct = exact (lenient 3/4)
    g=f(o,'condition_grade')[0]['value_num']; a=agg['condition_grade']
    if l['cond']>=3:
        a['applicable']+=1; a['found']+=g>=3; a['correct']+=g>=3
    if g>=3: a['ext_emitted']+=1; a['ext_correct']+=l['cond']>=3
    det.append((i,'cond',l['cond'],g))
    r=f(o,'repaint'); a=agg['repaint']; ev=(r[0]['value_text'] if r and r[0]['value_bool'] else ('false' if r else 'none'))
    if l['repaint']!='none':
        a['applicable']+=1; a['found']+=ev!='none'; a['correct']+=(ev==l['repaint']) or (ev in('full','partial') and l['repaint'] in('full','partial') and False)
    if ev!='none': a['ext_emitted']+=1; a['ext_correct']+=(l['repaint']==ev) or (l['repaint']!='none' and ev!='false' and l['repaint']!='false')
    det.append((i,'repaint',l['repaint'],ev))
    r=f(o,'ownership_duration'); a=agg['ownership_duration']
    ev=None
    if r: ev=int(r[0]['value_date'][:4]); n=r[0]['value_num']
    lo=l['own']
    def ok():
        if ev is None: return False
        if lo.startswith('rel:'): return abs(n-int(lo[4:]))<=1
        return ev==int(lo)
    if lo!='none': a['applicable']+=1; a['found']+=ev is not None; a['correct']+=ok()
    if ev is not None: a['ext_emitted']+=1; a['ext_correct']+=(lo!='none' and ok())
    det.append((i,'own',lo,ev))
    r=f(o,'documented_work'); a=agg['documented_work']
    if l['work']=='yes': a['applicable']+=1; a['found']+=bool(r); a['correct']+=bool(r)
    if r: a['ext_emitted']+=1; a['ext_correct']+=l['work']=='yes'
    det.append((i,'work',l['work'],len(r)))
    r=f(o,'numbers_matching'); a=agg['numbers_matching']; ev=(str(r[0]['value_bool']).lower() if r else 'none')
    if l['nm']!='none': a['applicable']+=1; a['found']+=ev!='none'; a['correct']+=ev==l['nm']
    if ev!='none': a['ext_emitted']+=1; a['ext_correct']+=ev==l['nm']
    det.append((i,'nm',l['nm'],ev))
    r=f(o,'mileage_claimed'); a=agg['mileage']; ev=r[0]['value_num'] if r else None
    if ev and r[0]['unit']=='km': ev=ev*0.621
    okm=lambda: ev is not None and abs(ev-float(l['mi']))<=0.03*float(l['mi'])+100
    if l['mi']!='none': a['applicable']+=1; a['found']+=ev is not None; a['correct']+=okm()
    if ev is not None: a['ext_emitted']+=1; a['ext_correct']+=(l['mi']!='none' and okm())
    det.append((i,'mi',l['mi'],ev))
for k,a in agg.items():
    a['recall_found']=round(a['found']/a['applicable'],3) if a['applicable'] else None
    a['recall_correct']=round(a['correct']/a['applicable'],3) if a['applicable'] else None
    a['precision_in_sample']=round(a['ext_correct']/a['ext_emitted'],3) if a['ext_emitted'] else None
json.dump(dict(agg=agg,detail=det),open('scores.json','w'),indent=1)
for k,a in agg.items(): print(k,a)
for d in det:
    if str(d[2])!=str(d[3]) and not (d[1]=='cond' and (d[2]>=3)==(d[3]>=3)) and not (d[1]=='work' and (d[2]=='yes')==(d[3]>0)) and not(d[1]=='mi' and d[3] and d[2]!='none' and abs(d[3]-float(d[2]))<0.03*float(d[2])+100): print(d)
