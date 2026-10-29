"""Deterministic cited trim/submodel extractor, rule trim_title_lex_v1.
Input: saved listing title (vehicles.title, cited by vehicles.listing_url) and saved description
(vehicle_listing_description, cited by snapshot_id/source_url). No network, no model.
trim     = longest-first whole-word matches from TRIM lexicon in the title text after year+make
submodel = first whole-word match from BODY lexicon in that text
confidence: 90 title match also present in description; 80 title-only; trims never taken from description alone."""
import re
TRIM = """super sport|ss|rs|z28|z/28|gt|gts|gt2|gt3|gt350|gt500|gto|gtx|r/t|rt|srt|srt8|srt-8|hemi|boss 302|boss 429|mach 1|cobra|shelby|
judge|ram air|ls6|ls7|l88|l79|yenko|copo|cs|sc|sport|deluxe|super deluxe|custom|special|super|standard|limited|ltd|xlt|xl|lariat|
king ranch|platinum|laredo|sahara|rubicon|overland|eddie bauer|cheyenne|silverado|scottsdale|sierra classic|sierra grande|high sierra|
sle|slt|denali|ls|lt|ltz|base|se|le|xle|sr5|trd|ex|lx|dx|si|type r|type s|gs|gsr|gli|gti|glx|vr6|tdi|turbo|turbo s|carrera|carrera s|
carrera 4|targa|speedster|rs america|clubsport|amg|brabus|m sport|competition|alpina|hse|se v8|autobiography|svr|vantage|
eldorado|biarritz|seville|fleetwood|de ville|deville|brougham|landau|signature|cartier|designer|royale|imperial|crown|newport|
new yorker|fury|sport fury|bel air|impala|biscayne|caprice|nomad|malibu|chevelle|el camino|monte carlo|nova|super bee|coronet|
road runner|satellite|charger|daytona|superbird|galaxie 500|xl|fairlane 500|500|starliner|sunliner|skyliner|crown victoria|
country squire|ranch wagon|marauder|cyclone|eliminator|cougar|xr-7|xr7|gran sport|gsx|skylark|riviera|wildcat|electra 225|
le sabre|lesabre|roadmaster|super 88|98|ninety-eight|starfire|cutlass|442|4-4-2|hurst|w-30|toronado|bonneville|catalina|
grand prix|le mans|lemans|firebird|trans am|formula|esprit|ram charger|power wagon|adventurer|sportsman|club cab|crew cab|
extended cab|regular cab|dually|4x4|awd|4wd|tsi|tsx|hardtop|veloce|ti|tii|cs|csi|csl|iroc-z|iroc|z/28|z71|zr1|zr-1|z06|grand sport|
indy pace car|pace car|anniversary|25th anniversary|30th anniversary|40th anniversary|50th anniversary|edition|launch edition""".replace('\n','')
BODY = """convertible|cabriolet|roadster|spider|spyder|coupe|fastback|hardtop|sedan|wagon|station wagon|estate|shooting brake|targa|
hatchback|liftback|pickup|truck|panel|panel truck|panel van|van|bus|suburban|limousine|cab and chassis|flatbed|stake bed|
sport utility|suv|speedster|barchetta|berlinetta|sidecar|trike|3-wheeler|dragster|race car|motorcycle|scooter|moped""".replace('\n','')
def _alts(s): return sorted({a.strip() for a in s.split('|') if a.strip()}, key=lambda a:(-len(a),a))
TR=_alts(TRIM); BD=_alts(BODY)
def _rx(a): return re.compile(r'(?<![\w/-])'+re.escape(a)+r'(?![\w/-])', re.I)
TRX=[(a,_rx(a)) for a in TR]; BDX=[(a,_rx(a)) for a in BD]
BODYSET=set(BD)
def tail(title, year, make):
    t=(title or '').strip()
    t=re.sub(r'^\s*(\d{4})\s+','',t)
    if make and t.lower().startswith(make.lower()+' '): t=t[len(make)+1:]
    return t
def extract(title, year, make, desc=None):
    t=tail(title,year,make)
    if not t: return None
    parts=t.split(None,1)
    rest=parts[1] if len(parts)>1 else ''   # first token = base model, never a trim
    used=[]; trims=[]
    for a,rx in TRX:
        if a in BODYSET: continue
        for m in rx.finditer(rest):
            if any(m.start()<e and s<m.end() for s,e in used): continue
            used.append((m.start(),m.end())); trims.append((m.start(),m.group(0)))
    sub=None
    for a,rx in BDX:
        m=rx.search(t)
        if m and not any(m.start()<e and s<m.end() for s,e in used): sub=m.group(0); break
    trim=' '.join(g for _,g in sorted(trims)) or None
    if not trim and not sub: return None
    dl=(desc or '').lower()
    conf = 90 if (trim and dl and trim.lower() in dl) else 80
    return dict(trim=trim, submodel=sub.lower() if sub else None, matched_text=t, confidence=conf,
                desc_corroborated=bool(trim and dl and trim.lower() in dl))
