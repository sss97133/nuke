# body_subtype_v1: rule classifier for identity evidence subtypes (run bodysub_v1_20261025). Inputs are local snapshots (ev.json, v39 rows2.json); see body_subtype_v1_judgments.json for per-class validation.
import json,re,sys,collections,random
sys.path.insert(0,'/workspace/v37'); sys.path.insert(0,'/workspace/v39')
from vmap import make_ok
from parse import nb
ev=json.load(open('ev.json'))
R2={}
for r in json.load(open('/workspace/v39/rows2.json')):
  vid,vin,b,vt,y,dm,dmod,vy,vm,vmod,vc,e,cd=r
  if not b or not make_ok(dm,vm): continue
  try:
    if abs(int(y)-int(vy))>1: continue
  except: continue
  R2[vid]=(vin,b,f'{y} {dm} {dmod}',cd)
def dsub(b):
  b=nb(b) if b else b
  if not b: return None
  if b.startswith('Sport Utility Vehicle'): return 'suv'
  if b.startswith('Crossover'): return 'crossover'
  if b=='Pickup' or b.startswith('Sport Utility Truck'): return 'pickup'
  if b=='Cargo Van': return 'cargo_van'
  if b=='Van': return 'van'
  if b=='Minivan': return 'minivan'
  if re.match(r'Incomplete - (Chassis Cab|Cutaway|Commercial Chassis|Stripped Chassis)',b): return 'chassis_cab'
  if b=='Truck': return 'medium_heavy_truck'
  if b=='Truck-Tractor': return 'semi_tractor'
  if b.startswith('Step Van'): return 'step_van'
  if b=='Trailer': return 'trailer'
  if b in ('Motorhome','Incomplete - Motor Home Chassis'): return 'motorhome'
  return None
CAMPER=re.compile(r"(?i)\b(westfalia|westy|camper(?!\s*shell)|campervan|motor ?home|rv conversion|class [abc]\b|winnebago|roadtrek|pleasure.way|sportsmobile|airstream interstate|rialta|revel|travato|minnie winnie|itasca|coachmen|thor motor|leisure travel|rv\b)")
TRAILER=re.compile(r"(?i)\btrailer\b")
TITLE=[
 ('T_panel', r"\b(panel|sedan delivery|canopy express)\b",'panel_delivery'),
 ('T_pickupword', r"\b(pickup|pick-up|pick up|crew ?cab|club ?cab|regular cab|extended cab|ext cab|quad cab|king ?cab|xtracab|super ?cab|single cab|double cab|half[- ]cab|stepside|fleetside|short ?bed|long ?bed)\b",'pickup'),
 ('M_suv', r"\b(bronco(?! sport)|wrangler|land cruiser|fj-?4[03]|fj-?55|fj cruiser|defender|range rover(?! (evoque|velar))|discovery|suburban|k5|blazer|scout|cherokee|jimmy|wagoneer|cj-?[2-7]a?\b|ramcharger|tahoe|yukon|4runner|trailduster|travelall|commando|g-?wagen|g-?class|g ?[0-9]{3}\b|g[0-9]{2} amg|expedition|excursion|navigator|escalade|durango|trooper|pathfinder|montero|pajero|xterra|sequoia|samurai|sidekick|vitara|jeepster|hummer h[12]\b|^h[12]\b|toyota fj|grand wagoneer|land rover series|series (i|ii|iia|iii)\b)",'suv'),
 ('M_van', r"\b(econoline|e-?[1-4]50\b|express [1-4]500|express van|savana|sprinter|vanagon|transporter|type 2|microbus|kombi|ram van|b[1-3]50\b|g-?[1-3]0\b|chevy van|chevyvan|transit(?! connect)|promaster|a100 van|van)\b",'van'),
 ('M_minivan', r"\b(astro|safari|caravan|voyager|odyssey|sienna|previa|windstar|aerostar|lumina apv|quest|villager|town & country|town and country|pacifica)\b",'minivan'),
 ('M_pickup', r"\b(pickup|pick-up|crew ?cab|club ?cab|regular cab|extended cab|ext cab|quad cab|king ?cab|xtracab|super ?cab|stepside|fleetside|short ?bed|long ?bed|c-?10|k-?10|c-?20|k-?20|c-?30|k-?30|[ck]-?[1-3]500|f-?100|f-?150|f-?250|f-?350|f-?1\b|f-?2\b|f-?3\b|f-?450|silverado|sierra|ram [1-3]500|ram \d+ ?(hd)?$|d-?[1-3]00|w-?[1-3]00|d-?[1-3]50|w-?[1-3]50|apache|cheyenne|cameo|3100|3600|3800|tacoma|tundra|ranger|s-?10|s-?15|dakota|comanche|ranchero|el camino|ssr|j-?10|j-?20|gladiator|hilux|t100|frontier|hardbody|titan|colorado|canyon|ridgeline|avalanche|sport trac|ute|power wagon|lil red express|warlock|scrambler|cj-?8|fj-?45|courier|luv|b2000|b2200|b2600|mighty max|d50|ram 50|brat|baja|rampage|flatbed)\b",'pickup'),
 ('M_heavy', r"\b(semi|tractor truck|sleeper|day cab|379|389|359|w900|t800|t680|9900|cabover|coe|kenworth|peterbilt|freightliner|mack|western star)\b",'medium_heavy_truck'),
 ('T_chassis', r"\b(cab (and|&) chassis|chassis cab|cutaway)\b",'chassis_cab'),
]
TITLE=[(a,re.compile('(?i)'+b),c) for a,b,c in TITLE]
CROSST=re.compile(r"(?i)\b(rav4|rav-4|cr-v|hr-v|macan|cayenne|urus|bentayga|levante|stelvio|q[3578]|sq[578]|x[1-7] ?(m|xdrive|sdrive)?[0-9]{0,2}[id]?|gl[abce] ?[0-9]{2,3}|glk|f-pace|e-pace|velar|evoque|model [xy]|cx-[3-9]0?|tiguan|murano|rogue|i-pace|e-tron|id\.?4|mach-e)\b")
CROSS=re.compile(r"(?i)\b(rav4|rav-4|cr-v|crv|hr-v|rogue|murano|highlander|pilot|equinox|edge|escape|cx-[3-9]0?|forester|tiguan|x[1-7]\b|q[3578]\b|sq[578]\b|macan|cayenne|rx ?[0-9]{3}|nx ?[0-9]{3}|mdx|rdx|xc[469]0|gla|glb|glc|gle|glk|ml ?[0-9]{3}|santa fe|tucson|sportage|compass|venza|f-pace|e-pace|velar|evoque|urus|bentayga|levante|stelvio|xt[456]|srx|envision|enclave|encore|terrain|acadia|traverse|outlander|eclipse cross|kona|niro|telluride|palisade|ascent|crosstrek|journey|patriot|flex|mkx|nautilus|aviator|bronco sport|ecosport|q50|qx[0-9]{2}|fx[0-9]{2}|ex[0-9]{2}|cx-?50|cx-?90|model [xy]\b|id\.?4|mach-e|ioniq 5|ev6|e-tron|i-pace|lyriq|xc40|ux ?[0-9]{3})\b")
out=[]
for r in ev:
  id_,vid,ext,cat,st,conf,cw,mt=r
  parts=st.split(' | ')
  if ext.startswith('vin_'):
    m=re.search(r'body_class=(.*?)(?: vehicle_type=| \|)',st); b=m.group(1) if m else None
    mm=re.search(r'\| decode (\d{4} [^|]+)',st); title=mm.group(1).strip() if mm else (mt or '')
    dsrc=('own',b,None)
  else:
    title=' '.join(p for p in parts[1:] if p)
    d=R2.get(vid); b=d[1] if d else None
    dsrc=('vdd',b,d)
  ds=dsub(b)
  if ds=='crossover' and re.search(r'(?i)allroad',title): ds=None
  if ds=='medium_heavy_truck' and re.search(r'(?i)hummer|\bh1\b',title): ds=None
  t=title.lower()
  rule=sub=cite=None
  # camper / rv first
  if CAMPER.search(t) and not re.search(r'(?i)\btrailer\b|camper shell|camper top|w/ ?camper|with camper|bed camper|truck camper|slide-in',t):
    if ds in ('van','cargo_van') or (ds is None and re.search(r'(?i)\b(van|vanagon|westfalia|westy|eurovan|sprinter|transporter|bus|type 2|class b|revel|travato|era\b|roadtrek|pleasure.way|rialta)\b',t)):
      rule='C_campervan'; sub='camper_van'
    elif re.search(r'(?i)roadtrek|airstream interstate|pleasure.way|\bera\b|class b|sprinter|eurovan|\bvan\b|econoline|e-?[123]50|ram b|tradesman',t) and not re.search(r'(?i)class [ac]\b|minnie|cutaway|e-?450',t):
      rule='C_classb'; sub=None
    elif ds in ('chassis_cab','motorhome','medium_heavy_truck') or re.search(r'(?i)motor ?home|class [ac]\b|minnie winnie|itasca',t):
      rule='C_motorhome'; sub='motorhome'
    if rule:
      cite=f"title words: {re.findall(CAMPER,t)[:3]}"
  if not rule and cat=='trailer_rv':
    if ds=='trailer': rule,sub='D_trailer','trailer'
    elif TRAILER.search(t) and not re.search(r'(?i)on a trailer|trade for|with (a )?trailer|w/ ?trailer|and trailer|& trailer|\+ ?trailer',t): rule,sub='T_trailer','trailer'
    if rule: cite='decode/title trailer'
  if not rule and cat=='truck_utility':
    if ds:
      if ds=='suv' and CROSS.search(t): rule,sub='D_suv_crossmodel','crossover'
      elif ds=='cargo_van': rule,sub='D_cargo_van_as_van','van'
      elif ds=='chassis_cab':
        if re.match(r'Incomplete - Chassis Cab',nb(b)) and not re.search(r'(?i)hearse|coach|\bvan\b|bus|passenger|sprinter|express|savana|econoline|e-?[34]50|motor ?home|\brv\b|camper|limo|\bpick-?up\b|dakota|ram [12]500|gladiator|silverado|sierra|ram 3500|c/k|r conventional|v conventional|gmt',t): rule,sub='D_chassis_cab3','chassis_cab'
      else: rule,sub='D_'+ds,ds
      cite='decode body_class'
    else:
      for nm,rx,s in TITLE:
        if rx.search(t):
          rule,sub=nm,s
          if s=='suv' and CROSST.search(t): rule,sub='M_crossover','crossover'
          break
      pass
      if rule: cite='title words'
  out.append([id_,vid,ext,cat,rule,sub,b,title[:120],dsrc[2][0] if dsrc[2] else (re.search(r'vin (\w{17})',st).group(1) if 'vin ' in st[:5] else None),conf])
c=collections.Counter((o[3],o[4]) for o in out)
for k,v in sorted(c.items(),key=lambda x:-x[1]): print(v,k)
json.dump(out,open('sub.json','w'))
