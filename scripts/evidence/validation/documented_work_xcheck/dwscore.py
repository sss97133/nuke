import json,re,collections,sys
sys.path.insert(0,'/workspace/nuke-strategy/graded')
from extract_v2 import CATR
d=json.load(open('/workspace/nuke-strategy/graded/extracted_v2.json'))
S=json.load(open('dw260.json'))
veh={x['id']:x['vehicle_id'] for x in json.load(open('dwlist.json'))}
scan=json.load(open('dw_scan.json'))
DT=['receipt_invoice','service_record','window_sticker','title_registration','history_report','manual_book']
docs=collections.defaultdict(list); recs=[]
for l in open('dw_ocr.jsonl'):
    x=json.loads(l)
    if not x['lines']: continue
    lines=[t for t,c in x['lines'] if c>=0.5]; txt=' '.join(lines)
    if len(txt.split())<20: continue
    cats=sorted({c for c,r in CATR if r.search(txt)})
    conf=sum(c for t,c in x['lines'] if c>=0.5)/max(1,len(lines))
    docs[veh[x['id']]].append((x['id'],cats))
    recs.append(dict(image_id=x['id'],vehicle_id=veh[x['id']],detector_score=scan[x['id']]['doc'],doc_type=DT[scan[x['id']]['dt']],ocr_text=txt[:8000],ocr_mean_conf=round(conf,4),work_categories=cats))
claims={(v,f['value_text']) for v in S for f in d[v] if f['field']=='documented_work'}
chk=[(v,c) for v,c in claims if docs.get(v)]
agree=[(v,c) for v,c in chk if any(c in cs for _,cs in docs[v])]
print('claims',len(claims),'cars w ocr docs',len(docs),'checkable',len(chk),'agree',len(agree), round(len(agree)/max(1,len(chk)),4))
bycat=collections.Counter(c for _,c in chk); ag=collections.Counter(c for _,c in agree)
for c in bycat: print(' ',c,ag[c],'/',bycat[c])
# base rate: category appears in docs of cars WITHOUT a claim for it
base=[(v,c) for v in docs for c in bycat if (v,c) not in claims]
print('base rate (category on docs w/o claim)', round(sum(any(c in cs for _,cs in docs[v]) for v,c in base)/max(1,len(base)),4), len(base))
json.dump(recs,open('dw_docs.json','w')); json.dump({'checkable':chk,'agree':agree},open('dw_result.json','w'))
