# graded-extractor v1: deterministic regex extractor over BaT listing descriptions.
import re
VER='graded-v2'
NUM=r'(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?'
Q=r'(?:(?:approximately|roughly|about|nearly|just over|just under|under|over|fewer than|less than|~)\s*)?'
RX_ODO=re.compile(r'(odometer|odo|speedometer|instrument cluster|\bit\b|now|currently)[^.]{0,60}?\b(?:shows|showing|showed|indicates|indicating|reads|reading|displays|displaying|registers|has)\s+'+Q+NUM+r'\s*(miles|mi\b|kilometers|km\b)|^()\s*'+Q+NUM+r'\s*(miles|kilometers|km\b) (?:are|is) shown|\b()Showing\s+'+Q+NUM+r'\s*(miles|kilometers|km\b)',re.I|re.M)
RX_TMU=re.compile(r'(true|total|actual) mileage is unknown|TMU\b',re.I)
RX_AGO=re.compile(r'\b(?:acquired|purchased|bought)\b[^.]{0,30}?\b(\d{1,2}|one|two|three|four|five|ten|twenty|thirty|forty)\s+years ago\b',re.I)
RX_ACQ=re.compile(r'\b(?:acquired|purchased|bought)\b[^.]{0,80}?\b(?:by the (?:seller|current owner|selling dealer)|by the seller’s)?[^.]{0,40}?\bin\s+((?:19|20)\d\d)\b',re.I)
SELLER=r"(?:the )?(?:seller|current owner|selling dealer)(?![’']s)"
MON=r"(?:(?:early|late|mid|spring|summer|fall|autumn|winter|january|february|march|april|may|june|july|august|september|october|november|december)\s+)?"
RX_SELLER_ACQ=[re.compile(p,re.I) for p in [
 r"\b(?:acquired|purchased|bought)\b(?: it| the (?:car|truck|vehicle|bike|motorcycle))?\s+(?:new\s+)?by\s+"+SELLER+r"[^.,;:]{0,60}?\bin\s+"+MON+r"(?P<y>(?:19|20)\d\d)\b",
 r"\b"+SELLER+r"\s+(?:\w+\s+)?(?:acquired|purchased|bought)\b[^.,;:]{0,60}?\bin\s+"+MON+r"(?P<y>(?:19|20)\d\d)\b",
 r"\buntil\s+"+MON+r"(?P<y>(?:19|20)\d\d),?\s+when\s+it\s+was\s+(?:acquired|purchased|bought)\s+by\s+"+SELLER,
 r"\b(?:seller|current owner)[’']s\s+(?:acquisition|purchase)\b[^.,;:]{0,20}?\bin\s+"+MON+r"(?P<y>(?:19|20)\d\d)\b",
 r"\bin\s+"+MON+r"(?P<y>(?:19|20)\d\d),?\s+(?:it\s+was\s+)?(?:acquired|purchased|bought)\s+by\s+"+SELLER,
 r"\bin\s+"+MON+r"(?P<y>(?:19|20)\d\d),?\s+"+SELLER+r"\s+(?:acquired|purchased|bought)\b"]]
RX_AGO_S=re.compile(r"\b(?:acquired|purchased|bought)\b(?: it| the car)?\s+by\s+"+SELLER+r"[^.,;:]{0,30}?\b(\d{1,2}|one|two|three|four|five|ten|twenty|thirty|forty)\s+years ago\b|\b"+SELLER+r"\s+(?:acquired|purchased|bought)\b[^.,;:]{0,30}?\b(\d{1,2}|one|two|three|four|five|ten|twenty|thirty|forty)\s+years ago\b",re.I)
RX_ONE=re.compile(r'\b(one|single)[- ]owner\b|\boriginal owner\b|\bfirst owner\b|\bsince new\b',re.I)
RX_NOWN=re.compile(r'\b(two|three|four|five|2|3|4|5)[- ]owner\b|\b(second|third|fourth|fifth) owner\b',re.I)
WN={'one':1,'single':1,'two':2,'three':3,'four':4,'five':5,'second':2,'third':3,'fourth':4,'fifth':5,'2':2,'3':3,'4':4,'5':5}
RX_NM=re.compile(r'\b(numbers[- ]matching|matching[- ]numbers|original (?:engine|motor|block))\b',re.I)
ENG=r"(?:engine|motor|block|powerplant|v8|v6|v12|v10|inline-\w+|flat-\w+|straight-\w+|\d\.\dl?\b[^.]{0,20}?(?:engine|v8|v6|inline-\w+|flat-\w+)|\d{3,4}(?:ci|cc)\b[^.]{0,15}?(?:engine|v8|v6|inline-\w+|flat-\w+))"
NOTENG=r"(?!\s*(?:control|computer|management|ecu|wiring|harness|decals?|cooling|fan|mounts?|and transmission mounts|seals?|gaskets?|covers?|sensors?|bay|hoods?|lid|oil|fluid|filter|grille|badges?|emblems?|parts|components|shroud|tin|blocks? heater|heater|stand|cradle))"
RX_NM_FALSE=re.compile(r"\b(?:replacement|non[- ]original|later[- ]model|later|swapped|crate|transplanted|period[- ]correct)\s+(?:[\w.,-]+\s+){0,3}?"+ENG+r"\b"+NOTENG+r"(?![^.]{0,60}\b(?:is included|are included|accompan|will accompany))(?<!disassembled replacement engine)"
 r"|\boriginal (?:engine|motor|block)\b[^.]{0,40}?\b(?:was|has been|had been|were)\s+(?:\w+\s+)?replaced\b"
 r"|(?<!window )(?<!wiper )(?<!blower )(?<!starter )(?<!fan )(?<!sunroof )(?<!seat )\b(?:engine|motor)\s+(?:was |has been )?(?:\w+\s+)?(?:swapped|replaced)\b(?! (?:mounts?|seals?|gaskets?))"
 r"|\b(?:engine|motor) swap\b|\bnot (?:the )?(?:numbers[- ]matching|original)\b[^.]{0,20}(?:engine|motor|block)"
 r"|\bremoved[, ]+(?:and )?(?:rebuilt )?numbers[- ]matching\s+(?:[\w.,-]+\s+){0,3}?"+ENG+
 r"|\bnumbers[- ]matching\s+(?:[\w.,-]+\s+){0,3}?"+ENG+r"[^.]{0,40}\b(?:accompan|included in the sale|is included|are included)"
 r"|\bequipped with a replacement engine\b",re.I)
RX_NONORIG_ENG=re.compile(r'\b(replacement|non[- ]original|later|swapped|crate)\s+(engine|motor|block|v8|v6|inline-\w+|transmission|gearbox)\b(?!\s+(?:mounts?|seals?|shaft|cover|gaskets?|harness|wiring|torque|fluid|oil|filter|cooler|lines?|mount))|\b(engine|transmission) (?:was )?(?:swap|replaced with)\b',re.I)
RX_REPAINT=re.compile(r'\b(repaint(?:ed)?|refinish(?:ed)?|resprayed|respray|color change|repainted)\b',re.I)
RX_ORIGPAINT=re.compile(r'\b(original paint|factory paint|retains (?:its )?(?:original|factory) (?:paint|finish))\b',re.I)
RX_PAINTPCT=re.compile(r'(\d{1,3})\s*%\s*(?:of\s+)?(?:its\s+)?original paint',re.I)
RX_AFTER=re.compile(r'\baftermarket\b',re.I)
# condition cues (disclosed flaws vs. positive markers), rubric in evidence_grade_rubrics
FLAW=re.compile(r'\b(rust(?! repairs?| ?proof| inhibitor| ?prevent| treatment| encapsul)|corrosion(?! protection| repair)|scratch(?:es)?|(?-i:(?<!ecu )(?<!performance )(?<!computer )chips?)(?! ?tuned)|dents?|dings?|cracks?|cracked|tears?|torn|scuffs?|blemish(?:es)?|faded|fading|clear ?coat failure|bubbling|peeling|(?:shows?|showing|exhibits?|visible|evident|signs of|general|cosmetic|heavy|some) wear|worn|stain(?:s|ed)?|leaks?|leaking|inoperable|does not (?:function|work)|do not (?:function|work)|not functional|intermittent(?:ly)?(?! wipers?)|stuck|missing|damage[d]?|curb rash|pitting|seep(?:age|ing)?)\b',re.I)
SEVERE=re.compile(r'\b(does not run|non[- ]running|not running|(?-i:project)(?! (?:was |that was )?completed)|rust[- ]through|rust holes?|holes? in the (?:floor|body|frame|panel)|(?<![-–])(?-i:rot)(?:ted)?|salvage|flood|frame damage|seized|needs (?:an )?engine)\b',re.I)
PAST=re.compile(r'\b(acquired|purchased|bought|completed|subsequently|during the project|previous owner|prior owner|under prior|was refurbished|following a|rebuild|rebuilt|repaired|repairing|replaced|replacement|refinished|restored|modifications? include)\b',re.I)
NOTFLAW=re.compile(r'(\*\*|equipment|carfax|autocheck|history report|no visible|observed no|not (?:observed|noted)|free of|no (?:known |visible )?(?:rust|leaks|damage|scratches|dents)|rust-free|without)',re.I)
CONC=re.compile(r'\b(concours|best in class|first in class|award[- ]winning|pebble beach|amelia island|NCRS (?:top flight|duntov)|PCA (?:concours|zone))\b',re.I)
RESTO=re.compile(r'\b(restored|restoration|refurbished|rebuilt)\b',re.I)
# documented work
WORK=re.compile(r'\b(replaced|rebuilt|overhauled|refreshed|resealed|reupholstered|serviced|installed|restored|refurbished|rebuilt|new)\b',re.I)
CAT=[('electrical',r'sunroof motor|window motor|wiper motor|blower motor|window regulator'),('engine',r'engine|(?<!sunroof )(?<!window )motor|head gasket|timing|cam|valve|piston|carb|intake|exhaust'),('transmission',r'transmission|gearbox|clutch|differential|driveshaft|axle'),('brakes',r'brake|caliper|rotor|master cylinder'),('suspension',r'suspension|shock|strut|spring|bushing|steering|tie rod'),('cooling',r'radiator|water pump|coolant|thermostat|hose'),('fuel',r'fuel|injector'),('electrical',r'battery|alternator|starter|wiring|electrical'),('body_paint',r'paint|body|panel|bodywork'),('interior',r'interior|upholster|seat|carpet|headliner|dash'),('tires_wheels',r'tires?|wheels?'),('service',r'oil|fluids?|service|tune[- ]up|filter|belt')]
CATR=[(c,re.compile(r'\b(?:'+p+r')',re.I)) for c,p in CAT]
COST=re.compile(r'(?:(US)?\$|USD\s?|€|£)\s?(\d{1,3}(?:,\d{3})+|\d+)(k)?',re.I)
WDATE=re.compile(r'\b(?:in|during)\s+(?:(?:early|late|mid|spring|summer|fall|autumn|winter|january|february|march|april|may|june|july|august|september|october|november|december)\s+)?((?:19|20)\d\d)\b',re.I)
RECEIPT=re.compile(r'\b(receipts?|invoices?|records?|documentation)\b',re.I)
SPLIT=re.compile(r'(?<=[.!?])\s+|\n+')

def num(s,k): 
    x=float(s.replace(',','')); return x*1000 if k else x
def sents(t):
    pos=0
    for s in SPLIT.split(t):
        i=t.find(s,pos); pos=i+len(s); yield i,s
def extract(t,sale_year=None):
    out=[]
    def add(field,span,**kw): out.append(dict(field=field,span_start=span[0],span_end=span[1],quote=t[span[0]:span[1]][:400],extractor_version=VER,**kw))
    ss=list(sents(t))
    # mileage
    m=RX_ODO.search(t)
    if m:
        g=[x for x in m.groups()]
        b=0 if g[0] is not None else (4 if g[4] is not None else 8)
        v=num(g[b+1],g[b+2]); unit='km' if g[b+3].lower().startswith('k') else 'mi'
        tmu=bool(RX_TMU.search(t))
        add('mileage_claimed',m.span(),value_num=v,unit=unit,value_bool=tmu,confidence=0.6 if (tmu or 'replacement odometer' in t[max(0,m.start()-40):m.end()].lower()) else 0.95)
    # ownership (v2: seller-subject acquisition clauses only)
    for i,s in ss:
        if re.search(r'\b(two|three|all three|both) of\b|\bthe (?:first|second|third) in\b',s,re.I): continue
        ag=RX_AGO_S.search(s)
        if ag and sale_year:
            w=(ag.group(1) or ag.group(2)).lower(); n={'one':1,'two':2,'three':3,'four':4,'five':5,'ten':10,'twenty':20,'thirty':30,'forty':40}.get(w) or int(w)
            add('ownership_duration',(i,i+len(s)),value_num=n,unit='years',value_date=f'{sale_year-n}-01-01',confidence=0.75); break
        ys=[int(m.group('y')) for r in RX_SELLER_ACQ for m in r.finditer(s)]
        if len(set(ys))==1 and sale_year and 1950<=ys[0]<=sale_year:
            y=ys[0]; add('ownership_duration',(i,i+len(s)),value_num=sale_year-y,unit='years',value_date=f'{y}-01-01',confidence=0.85); break
    for i,s in ss:
        o=RX_ONE.search(s); n=RX_NOWN.search(s)
        if n: add('ownership_count',(i,i+len(s)),value_num=WN[(n.group(1) or n.group(2)).lower()],unit='owners',confidence=0.8); break
        if o and 'prior to' not in s.lower(): add('ownership_count',(i,i+len(s)),value_num=1,unit='owners',confidence=0.8); break
    # originality (v2: engine-specific; transmission-only replacements ignored; removed NM engine => False)
    for i,s in ss:
        if RX_NM_FALSE.search(s): add('numbers_matching',(i,i+len(s)),value_bool=False,confidence=0.85); break
        if RX_NM.search(s) and not re.search(r'\bnot\b|non-|\bremoved\b|accompan|\bspare\b',s,re.I): add('numbers_matching',(i,i+len(s)),value_bool=True,confidence=0.85); break
    for i,s in ss:
        p=RX_PAINTPCT.search(s)
        if p: add('original_paint_pct',(i,i+len(s)),value_num=min(100,int(p.group(1))),unit='pct',confidence=0.9); break
    for i,s in ss:
        if RX_REPAINT.search(s) and not re.search(r'\b(wheels?|calipers?|engine bay|valve covers?|bumpers?|trim|frame|chassis|underside|rims?)\b',s,re.I) and not re.search(r'\b(paint correction|touch[- ]up)',s,re.I):
            part=bool(re.search(r'\b(hood|fenders?|roof|doors?|panels?|quarter|decklid|trunk lid|areas|portions|spots|rockers?)\b',s,re.I)) and not re.search(r'\b(body|bare[- ]metal|entire|full|exterior color change|color change)\b',s,re.I)
            add('repaint',(i,i+len(s)),value_bool=True,value_text='partial' if part else 'full',confidence=0.8); break
        if RX_ORIGPAINT.search(s) and not RX_REPAINT.search(s): add('repaint',(i,i+len(s)),value_bool=False,confidence=0.8); break
    na=len(RX_AFTER.findall(t))
    # condition grade (ordinal 1..4, rubric condition_v1)
    flaws=[(i,s) for i,s in ss if FLAW.search(s) and not NOTFLAW.search(s) and not re.search(r'\b(replaced|replacement|new|rebuilt|repaired|repairing|repairs?|addressed|installed|refinished|repainted|repaint|refurbished|required|under (?:prior|previous) ownership)\b',s,re.I)]
    sev=[(i,s) for i,s in ss if SEVERE.search(s) and not PAST.search(s) and not NOTFLAW.search(s)]
    conc=[(i,s) for i,s in ss if CONC.search(s)]
    if sev: g,src=4,sev[0]
    elif len(flaws)>=3: g,src=4 if len(flaws)>=5 else 3,flaws[0]
    elif flaws: g,src=3,flaws[0]
    elif conc: g,src=1,conc[0]
    else: g,src=2,None
    sp=(src[0],src[0]+len(src[1])) if src else (0,0)
    add('condition_grade',sp,value_num=g,value_text=f'flaws={len(flaws)};severe={len(sev)};concours={len(conc)};aftermarket={na}',rubric_code=f'condition_v1:{g}',confidence=0.6 if src is None else 0.75)
    # documented work
    rec_any=bool(re.search(r'\b(receipts?|invoices?|service records|maintenance records)\b',t,re.I))
    for i,s in ss:
        if not WORK.search(s) or re.search(r'\bfactory[- ]rated\b|\bwhen new\b|\b(could|would|should|may|might) (?:also )?(?:benefit|need|require|use)\b|\brecommend',s,re.I): continue
        if re.search(r'\b(said to|reportedly|seller states|according to|under (?:current|previous) ownership|in (?:19|20)\d\d|recently|records|receipts|invoices)\b',s,re.I) is None: continue
        cats=[c for c,r in CATR if r.search(s)]
        if not cats: continue
        c=COST.search(s); d=WDATE.search(s)
        add('documented_work',(i,i+len(s)),value_text=cats[0],value_num=(num(c.group(2),c.group(3)) if c else None),currency=('USD' if c and (c.group(0).startswith('$') or 'USD' in c.group(0).upper()) else ('EUR' if c and '€' in c.group(0) else ('GBP' if c else None))),value_date=(f'{d.group(1)}-01-01' if d else None),value_bool=bool(RECEIPT.search(s)) or rec_any,confidence=0.8)
    return out
