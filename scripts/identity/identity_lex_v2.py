import re,json,collections
B=lambda s: re.compile(r'(?<![a-z0-9])(?:'+s+r')(?![a-z0-9])')
CARX=B(r'roadster|runabout|touring car|tonneau|phaeton|coupe|sedan|seater|spyder|spider|convertible|cabriolet|brougham|limousine|half[- ]scale|pedal|model car|die[- ]?cast|1/\d+|scale model|gt|gti|\d+\s?hp')
TRUCKMK={'chevrolet','gmc','dodge','ram','ford','toyota','nissan','jeep','international','international harvester','mercedes-benz','freightliner','peterbilt','kenworth','mack','am general','isuzu','mitsubishi','hino','western star','diamond t','studebaker','willys','datsun','mazda','volkswagen','land rover','hummer','sprinter'}
HEAVY={'freightliner','peterbilt','kenworth','mack','western star','diamond t','am general','hino','navistar','oshkosh','autocar','sterling','white'}
NUMCTX=B(r'(silverado|sierra|ram|c|k|r|v|d|w|cheyenne|scottsdale|suburban|tahoe|yukon|express|savana|sprinter|transit|chevy van|g|f|e|ranger|tundra|titan|power wagon|club cab|quad cab|crew cab|mega cab|heavy duty|hd|duramax|cummins)[- ]?(1500|2500|3500|4500|5500)|(1500|2500|3500|4500|5500)[- ]?(hd|heavy duty|4x4|4×4|crew|regular|extended|cab|pickup|van|cargo|express|duramax|cummins|diesel|dually|silverado|sierra|laramie|slt|lt|ltz|big horn|tradesman)')
EMBOK=B(r'[ckrv][1-3]0|[ckrv]15|[ckrv]1500|[ckrv]2500|[ckrv]3500|k5|f-?\d{2,3}|f-?[1-8]|e-?\d{3}|cj-?\d|fj-?\d{2}|d\d{3}|w\d{3}|g\d{2}|hj\d{2}|bj\d{2}|3100|3600|3800|t-?\d{3}|sprinter \d{4}')
TRUCKW=B(r'pickup|pick-up|truck|tow truck|wrecker|flatbed|stake bed|dump truck|fire truck|fire engine|crew cab|regular cab|extended cab|supercab|super cab|club cab|4x4|4×4')
PANEL=B(r'panel (van|delivery|wagon|truck|express|bus)|(\d{4}|chevrolet|chevy|gmc|ford|dodge|international|willys|c10|3100|f100|f-100|kb2|g10) panel( |$)')
SEMI=B(r'semi[- ]?(truck|tractor)')
DUMP=B(r'dump truck|dump body|dump bed|dually dump|\bdump\b(?!.*trailer)')
TRL=B(r'trailer|end dump|belly dump|side dump|hardee|featherlite|fruehauf|wabash|great dane')
MEMO={'M_neon':B(r'neon (sign|clock|light)|(sign|clock).{0,20}neon'),
      'M_display':B(r'display (case|stand|cabinet|board|rack|sign|model)|dealer display|showroom display'),
      'M_toy':B(r'(toy|pedal) (car|truck|tractor|train)|tin toy|buddy l|tonka|smith[- ]miller|structo|nylint'),
      'M_bench':B(r'(work|garage|mechanic).{0,6}bench|bench (seat )?from|bench grinder'),
      'M_cabinet':B(r'(parts|tool|display|oil|tire) cabinet'),'M_carousel':B(r'carousel (horse|display|rack)|(oil|tire|parts) carousel'),
      'M_cooler':B(r'(coca[- ]?cola|pepsi|soda|drink|beverage) cooler|cooler (sign|chest)'),
      'M_globe':B(r'gas pump globe|pump globe|globe (sign|light)|(gasoline|gas|oil) globe')}
def v2(o):
  i,cat,tok,g,emb,ctx,mt,title,vid,make,cls=o
  t=((mt or '')+' '+(title or '')).lower(); mk=(make or '').lower()
  if cat=='memorabilia':
    p=MEMO.get(cls); return ('V2_'+cls,'memorabilia') if p and p.search(t) else None
  if TRL.search(t) and cls in('T_word_dump','T_word_semi','T_word_panel'): return None
  if cls=='T_word_panel': return ('V2_panel','truck_utility') if PANEL.search(t) and not CARX.search(t) else None
  if cls=='T_word_semi': return ('V2_semi','truck_utility') if SEMI.search(t) else None
  if cls=='T_word_dump': return ('V2_dump','truck_utility') if DUMP.search(t) else None
  if CARX.search(t) and not TRUCKW.search(t): return None
  if cls=='T_num': return ('V2_num','truck_utility') if mk in TRUCKMK and NUMCTX.search(t) else None
  if cls=='T_emb': return ('V2_emb','truck_utility') if mk in TRUCKMK and (EMBOK.search(t) or TRUCKW.search(t)) else None
  if cls=='T_make':
    if mk in HEAVY and TRUCKW.search(t): return ('V2_make_word','truck_utility')
    if mk in HEAVY-{'autocar','sterling','white'} : return ('V2_make_heavy','truck_utility')
    if TRUCKW.search(t): return ('V2_make_word','truck_utility')
    return None
if __name__=='__main__':
  A=json.load(open('attr2.json')); R=set(i for i,_ in json.load(open('retire_ids.json')))
  out=[]
  for o in A:
    if o[0] in R:
      r=v2(o)
      if r: out.append(o+[r[0],r[1]])
  c=collections.Counter(o[11] for o in out); print(c,len(out))
  c2=collections.Counter(o[10] for o in A if o[0] in R); print(c2)
  json.dump(out,open('v2cand.json','w'))
