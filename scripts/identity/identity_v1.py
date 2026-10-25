"""Deterministic make/model identity + vehicle category, rule identity_lex_v1.
Inputs: saved make, model, title text only. Outputs canonical make, canonical base model, category, issues[]."""
import re,json,difflib,os
H=os.path.dirname(os.path.abspath(__file__))
CM=json.load(open(os.path.join(H,'canonical_makes_snapshot_20261025.json')))
ALIAS={}
for c in CM:
  for a in [c['n']]+(c['a'] or []): ALIAS[a.strip().lower()]=c['n'].lower()
EXTRA={'chevy':'chevrolet','vw':'volkswagen','mercedes':'mercedes-benz','mercedes benz':'mercedes-benz','benz':'mercedes-benz',
 'harley':'harley-davidson','harley davidson':'harley-davidson','rolls royce':'rolls-royce','austin healey':'austin-healey',
 'land-rover':'land rover','landrover':'land rover','international':'international harvester','ih':'international harvester',
 'mv':'mv agusta','moto-guzzi':'moto guzzi','guzzi':'moto guzzi','aston-martin':'aston martin','alfa':'alfa romeo',
 'alfa-romeo':'alfa romeo','de tomaso':'de tomaso','detomaso':'de tomaso','am general':'am general','mopar':'chrysler',
 'deere':'john deere','john-deere':'john deere','allis chalmers':'allis-chalmers','massey ferguson':'massey-ferguson',
 'minneapolis moline':'minneapolis-moline','club-car':'club car','ezgo':'e-z-go','ez-go':'e-z-go','e-z go':'e-z-go'}
for k,v in EXTRA.items(): ALIAS.setdefault(k,v)
# truncated two-word makes: make text = first word, model starts with second word
TRUNC={('alfa','romeo'):'alfa romeo',('land','rover'):'land rover',('aston','martin'):'aston martin',('rolls','royce'):'rolls-royce',
 ('austin','healey'):'austin-healey',('harley','davidson'):'harley-davidson',('mercedes','benz'):'mercedes-benz',('moto','guzzi'):'moto guzzi',
 ('mv','agusta'):'mv agusta',('international','harvester'):'international harvester',('john','deere'):'john deere',('de','tomaso'):'de tomaso',
 ('allis','chalmers'):'allis-chalmers',('massey','ferguson'):'massey-ferguson',('am','general'):'am general',('royal','enfield'):'royal enfield',
 ('club','car'):'club car',('minneapolis','moline'):'minneapolis-moline'}
COACH={'ghia','pininfarina','bertone','zagato','vignale','touring','fisher','brewster','derham','lebaron','le baron','hess & eisenhardt',
 'chapron','mulliner','park ward','h.j. mulliner','vanden plas','frua','michelotti','boano','allemano','scaglietti','saoutchik','figoni',
 'murphy','rollson','dietrich','judkins','willoughby','brunn','holbrook','fleetwood','carrozzeria','abarth','iso','asc','cars and concepts','coachcraft','moretti'}
MOTO_MAKES={'harley-davidson','yamaha','kawasaki','ducati','indian','bsa','norton','husqvarna','moto guzzi','bultaco','ariel','excelsior','matchless',
 'maico','ajs','mv agusta','vespa','hodaka','whizzer','ktm','aprilia','benelli','montesa','ossa','velocette','vincent','royal enfield','cz','jawa',
 'laverda','bimota','buell','triumph motorcycle','zundapp','puch','lambretta','henderson','crocker','cleveland','ace','pope','thor','flying merkel',
 'brough superior','sunbeam','greeves','dkw','nsu','victory','zero','can-am motorcycle','rokon','tohatsu','bridgestone','mustang motorcycle','simplex',
 'cushman','harley','gilera','parilla','rickman','husaberg','gas gas','beta','sherco','cagiva','mondial','moto morini','hercules','sachs','rupp','taco','powell'}
MOTO_SHARED={'honda','suzuki','bmw','triumph','kawasaki','yamaha','indian'}
CAR_MODELS={'honda':r'civic|accord|s2000|nsx|prelude|crx|cr-x|cr-v|crv|odyssey|element|fit|insight|s500|s600|s800|n600|n360|z600|az600|ridgeline|pilot|passport|del sol|beat|city|today|acty|t360|integra|legend|vigor|clarity',
 'suzuki':r'samurai|sidekick|x-90|vitara|jimny|cappuccino|carry|swift|esteem|aerio|forenza|reno|equator|grand vitara|lj|sj|every|alto|fronte|cultus|mighty boy|kei|wagon r',
 'bmw':r'^\d{3}[a-z]*|^m\d|^x\d|^z\d|^i\d|isetta|2002|1600|2800|3\.0|e\d\d|bavaria|alpina|600|700|503|507|327|328',
 'triumph':r'tr\d|tr-\d|spitfire|gt6|herald|stag|dolomite|vitesse|toledo|2000|2500|mayflower|renown|italia',
 'kawasaki':r'mule|teryx|brute force', 'yamaha':r'rhino|viking|golf', 'indian':r'^$'}
MOTO_WORDS=r'motorcycle|motorbike|minibike|mini bike|mini-bike|dirt bike|scooter|moped|trike|sidecar|chopper|bobber|cafe racer|enduro|motocross|scrambler|dual sport|sportster|electra glide|softail|dyna|gold wing|goldwing|shovelhead|panhead|knucklehead|flathead|ironhead|hydra-glide|duo-glide|road king|ultra classic|wide glide|v-rod|fat boy|heritage|chief|scout|elsinore|trail \d|cb\d|cr\d|cl\d|xr\d|z50|ct\d|sl\d|mt\d|qa50|xl\d|rd\d|yz\d|dt\d|xs\d|ds\d|tz\d|rz\d|fz\d|kz\d|kx\d|ke\d|zx\d|ninja|nighthawk|rebel \d|magna|interceptor|shadow|valkyrie|silver wing|cbr|vfr|vtx|vt\d|vf\d|nsr|rc\d|gs\d|rm\d|ts\d|gt\d{3}|tm\d|pe\d|dr\d|bonneville|thunderbird \d|tiger|trident|speed twin|daytona \d|r\d{2}|r ?\d{2,4}|k\d{2,4}|/\d'
TRACTOR=r'tractor|farmall|crawler tractor|\btd-\d|dozer|bulldozer|backhoe|combine|steam engine|traction engine|8n|9n|2n|naa|hit and miss|hit-and-miss'
TRACTOR_MAKES={'john deere','farmall','allis-chalmers','massey-ferguson','massey-harris','oliver','minneapolis-moline','case','ferguson','caterpillar','cockshutt','david brown','fordson','lanz','porsche-diesel','kubota','new holland','hart-parr','huber','rumely','advance-rumely','avery','twin city','cub cadet','wheel horse'}
CART=r'golf cart|golf car|utility cart|cart\b|club car|e-z-go|truckster|\bmule\b|\bgator\b|\batv\b|\butv\b|side by side|side-by-side|\bquad\b|go kart|go-kart|\bkart\b|snowmobile|ski-doo|arctic cat|cushman haulster|people mover'
CART_MAKES={'club car','e-z-go','polaris','arctic cat','ski-doo','can-am','argo','melex','columbia par car','taylor-dunn','gem','marketeer'}
MEMO=r'\bsign\b|neon|pedal car|pedal plane|gas pump|jukebox|juke box|clock|thermometer|oil can|globe|display|porcelain|mannequin|vending|slot machine|pinball|arcade|carousel|bumper car|fairground|toy\b|tin toy|diorama|scale model|die-?cast|memorabilia|\bwheels$|\bwheels and|\brims\b|\bseats$|parts lot|banner|poster|lighted|light-up|cabinet|engine stand|crate engine|\bengine$|motor only|transmission only|tool box|toolbox|cooler|air meter|\bbench\b|artwork|sculpture|replica sign|dealership sign'
BOAT=r'(?<!ski )\bboat\b(?! ?tail)|ski boat|speedboat|hydroplane|yacht|outboard|chris-craft|chris craft|riva\b'
AIR=r'airplane|aircraft|helicopter|gyrocopter'
TRAILER=r'trailer|teardrop|travel trailer|travel trailer|fifth wheel|motorhome|motor home|winnebago|\brv\b'
TRUCK=r'pickup|truck|panel|stake|flatbed|wrecker|tow truck|fire truck|fire engine|pumper|dump|tanker|tractor-trailer|semi|cab and chassis|c10|c-10|k10|k-10|c20|k20|f100|f-100|f150|f-150|f250|f-250|f350|1500|2500|3500|power wagon|suburban|carryall|travelall|bronco|blazer|scout|jimmy|ramcharger|wagoneer|land cruiser|fj\d|defender|unimog|hummer|humvee|m151|m38|m170|jeep|cj\d|military|ambulance|hearse|bus\b|van\b|step van|camper|motorhome|milk truck|delivery'
TRUCK_MAKES={'freightliner','international harvester','am general','mack','peterbilt','kenworth','diamond t','reo','white','autocar','studebaker truck','federal','dodge truck','freightliner','sterling','oshkosh','divco','hendrickson','fwd','brockway','corbitt'}
def rx(p,s): return re.search(p,s,re.I) is not None
def canon(make, model, title, allmakes=None):
  iss=[]; mk=(make or '').strip(); md=(model or '').strip(); t=(title or '').strip()
  ml=mk.lower(); mdl=md.lower()
  if not ml and t:
    w=re.sub(r'^\d{4}\s+','',t).split()
    if w: ml=w[0].lower(); iss.append('make_missing')
  c=ALIAS.get(ml,ml)
  if c!=ml: iss.append('alias' if ml.replace('-',' ').replace('.','')!=c.replace('-',' ') else 'case_punct')
  mw=mdl.split()
  for (a,b),full in TRUNC.items():
    if ml==a and mw and mw[0]==b: c=ALIAS.get(full,full); mdl=' '.join(mw[1:]); mw=mdl.split(); iss.append('truncated_make'); break
  coach=None
  if c in COACH and mw and ALIAS.get(mw[0],None):
    coach=c; c=ALIAS[mw[0]]; mdl=' '.join(mw[1:]); mw=mdl.split(); iss.append('coachbuilder_as_make')
  if allmakes and c and c not in ALIAS.values() and allmakes.get(c,0)<=3:
    big=[m for m,n in allmakes.items() if n>=200]
    g=[x for x in difflib.get_close_matches(c,big,1,0.86) if not c.startswith(x) and not x.startswith(c) and x[0]==c[0]]
    if g: c=g[0]; iss.append('misspelled_make')
  base=re.sub(r'[^a-z0-9]','',mw[0]) if mw else ''
  txt=' '.join([mdl,t.lower()])
  if rx(MEMO,txt) and not rx(r'\bcar\b.*(coupe|sedan)',txt): cat='memorabilia'
  elif rx(BOAT,txt): cat='boat'
  elif rx(AIR,txt): cat='aircraft'
  elif c in TRUCK_MAKES or c in ('freightliner',) or rx(r'semi|road tractor|c\.?o\.?e|tractor-trailer|tractor trailer|car hauler|diesel tractor',txt): cat='truck_utility'
  elif c in TRACTOR_MAKES or rx(TRACTOR,txt): cat='tractor'
  elif c in CART_MAKES or rx(CART,txt): cat='cart_utility'
  elif rx(TRAILER,txt): cat='trailer_rv'
  elif c in MOTO_MAKES and not rx(CAR_MODELS.get(c,r'^\b$'),mdl): cat='motorcycle'
  elif rx(MOTO_WORDS,txt) and (c in MOTO_SHARED or c in MOTO_MAKES or rx(r'motorcycle|scooter|moped|minibike|sidecar|trike',txt)) and not rx(CAR_MODELS.get(c,r'^\b$'),mdl): cat='motorcycle'
  elif c in MOTO_SHARED and re.match(r'^[a-z]{1,3}-?\d{2,4}[a-z]{0,2}$',base) and not rx(CAR_MODELS.get(c,r'^\b$'),mdl): cat='motorcycle'
  elif c in TRUCK_MAKES or rx(TRUCK,txt): cat='truck_utility'
  else: cat='car'
  if cat in ('memorabilia',): iss.append('non_vehicle_lot')
  return dict(make=c or None, model=base or None, model_text=mdl or None, category=cat, coachbuilder=coach, issues=iss)
