# moto_v2: motorcycle rule v2. Reference (cited): make lists per
# Make/model lists are hand-written rules (moto_v2); no external source was fetched or verified.
# Make/model lists are hand-written rules (moto_v2); no external source was fetched or verified.
# List_of_Yamaha_motorcycles, List_of_Kawasaki_motorcycles, List_of_Suzuki_motorcycles,
# List_of_BMW_motorcycles, List_of_Triumph_motorcycles (Triumph Engineering/Motorcycles vs Triumph Motor Company cars),
# Make/model lists are hand-written rules (moto_v2); no external source was fetched or verified.
import re
REF='wikipedia:List_of_motorcycle_manufacturers+per-brand model lists (moto_v2)'
def rx(p,s): return re.search(p,s) is not None
W=lambda p: r'(?<![a-z0-9])(?:'+p+r')(?![a-z])'
NEG_ALL=W(r'atv|quad|quads|four ?wheeler|4 ?wheeler|utv|side ?by ?side|go ?-?kart|kart|snowmobile|sled|jet ?ski|jetski|wave ?runner|waverunner|watercraft|pwc|golf|boat|outboard|trailer|camper|motorhome|motor ?coach|rv|bicycle|pedal|sign|poster|neon|toy|model kit|diecast|die-cast|pedal car|tractor|mower|generator|engine only|crate engine|sedan|coupe|convertible|roadster car|station wagon|pickup|truck|van|atc ?\d*|3 ?wheeler atv')
STRONG={'harley-davidson','harley','ducati','ktm','norton','bsa','vincent','bultaco','moto guzzi','husqvarna','mv agusta','maico','matchless',
 'royal enfield','buell','hodaka','cz','aprilia','velocette','ajs','greeves','gilera','benelli','laverda','ossa','bimota','montesa','jawa','rickman',
 'lambretta','brough superior','rokon','mondial','cagiva','flying merkel','bridgestone','victory','henderson','excelsior','whizzer','honda motorcycles',
 'indian','cleveland','husaberg','gas gas','beta','sherco','moto morini','parilla','crocker','ariel','vespa','zundapp'}
STRONG_NEG={'ariel':W('atom|nomad'),'vespa':W('400|ape|car'),'zundapp':W('janus'),'excelsior':W('auto|autobyk')+'|^$','indian':'^$',
 'husqvarna':W('chainsaw|mower|sewing'),'brough superior':W('car|saloon|drophead'),'victory':W('polaris ranger'),'ktm':W('x-?bow|xbow')}
WEAK={ # make: positive model-token regex (on model text + title)
 'sunbeam':W(r's7|s8|\d{3} ?cc|model \d{1,2}|lion|little sunbeam|motorcycle'),
 'thor':W(r'single|twin|\d{2} ?ci|motorcycle|board track'),
 'nsu':W(r'quickly|max|supermax|sportmax|prima|251|501|601|motorcycle|moped|\d{2,3} ?cc|osl|konsul|lux|fox'),
 'dkw':W(r'hummel|rt ?\d*|sb ?\d+|nz ?\d*|motorcycle|moped|\d{3} ?cc|kr\d+'),
 'puch':W(r'maxi|magnum|newport|sabre|moped|allstate|sgs|sg|m ?\d{2,3}|x ?\d{2}|ms ?\d{2}|mv ?\d{2}|e ?50|\d{2,3} ?cc|motorcycle|ds\d+|sr'),
 'simplex':W(r'servicycle|automatic|sportsman|motorcycle|scooter'),
 'powell':W(r'p ?81|p ?48|streamliner|challenger|scooter|motorcycle'),
 'cushman':W(r'eagle|silver eagle|pacemaker|highlander|autoglide|scooter|husky|road king|step ?through|allstate|super eagle|airborne|model 32|model 53'),
 'rupp':W(r'roadster|enduro|tt ?500|hustler|scrambler|minibike|mini ?bike|chaparral|black widow|mag ?\d|dart|bandit|ruppster|goat'),
 'honda':W(r'cb ?\d+[a-z]*|cl ?\d+[a-z]*|cr ?\d+[a-z]*|crf ?\d*[a-z]*|ct ?\d+[a-z]*|cx ?\d+[a-z]*|xr ?\d+[a-z]*|xl ?\d+[a-z]*|sl ?\d+[a-z]*|mr ?\d+|qa ?\d+|st ?\d+|gl ?\d+|vt ?\d+[a-z]*|vf ?\d+[a-z]*|vfr|cbr ?\d*[a-z]*|cbx|nc ?\d+|nt ?\d+|ns ?\d+[a-z]*|nsr|rc ?\d+|gb ?\d+|ft ?\d+|ascot|pc ?\d+|nx ?\d+|ss ?\d+|s ?65|s ?90|c ?70|c ?100|c ?110|ca ?\d+|ch ?\d+|z ?50[a-z]*|elite|spree|express|ruckus|helix|dream|benly|superhawk|super hawk|hawk|shadow|gold ?wing|goldwing|magna|sabre|nighthawk|interceptor|valkyrie|vtx|rebel|trail ?\d*|super ?cub|cub|grom|monkey|africa twin|transalp|nr|pacific coast|rune|fury|scrambler|elsinore|motorcycle|mini ?trail|passport|aero|metropolitan|silver ?wing|hurricane|blackbird|st ?1300|deauville|nm4|navi|xr|cbf|cmx|cm ?\d+|gl'),
 'yamaha':W(r'yz ?\d*[a-z]*|yzf ?-?r?\d*|wr ?\d+[a-z]*|tt ?-?r? ?\d*|xt ?\d+|dt ?\d+[a-z]*|rd ?\d+|rz ?\d+|xs ?\d+[a-z]*|xj ?\d+[a-z]*|xv ?\d+|fj ?\d+|fzr? ?\d+|fz ?-?\d+[a-z]*|fz1|fzs|sr ?\d+|tx ?\d+|ds ?\d+|td ?\d+|tz ?\d+|at ?1|ct ?1|ycs ?\d*|yds ?\d*|yr ?\d*|xvs|v ?-?max|vmax|virago|royal star|road star|v ?-?star|vstar|roadliner|stratoliner|seca|maxim|radian|xsr|mt ?-?\d+|r ?1|r ?6|r ?3|zuma|riva|vino|bws|pw ?\d+|qt ?\d+|chappy|enduro|big wheel|bw ?\d+|tw ?\d+|it ?\d+|mx ?\d+|sc ?500|bolt|raider|warrior xv|motorcycle|scooter|moped|xt|tdm|tdr|fazer|super tenere|tenere|majesty|morphous|stryker|ty ?\d+|sx ?\d+'),
 'kawasaki':W(r'kz ?\d*[a-z]*|kx ?\d*[a-z]*|kdx ?\d*|klx ?\d*|klr ?\d*|kl ?\d+|ke ?\d+|kh ?\d+|h ?1[a-z]?|h ?2[a-z]?|s ?1|s ?2|s ?3|z ?1[a-z]?|z ?\d{3,4}[a-z]*|z1r|zx ?-?\d+[a-z]*|zzr ?\d*|zrx ?\d*|gpz ?\d*|ninja|vulcan|concours|eliminator|ltd|w ?650|w ?800|versys|er ?-?\d+|ex ?\d+|en ?\d+|kd ?\d+|g ?\d{1,2}|f ?\d{1,2}|a ?1|a ?7|mach|avenger|samurai|motorcycle|z ?900|z ?650|voyager|nomad|drifter|mean streak|gtr|zl|zg|kr ?\d+|kmx|kx|klx'),
 'suzuki':W(r'rm ?-?z? ?\d*|rmx ?\d*|sv ?\d+|gsx ?-?r? ?\d*[a-z]*|gs ?\d+[a-z]*|gt ?\d+|t ?\d{3}|ts ?\d+[a-z]*|tm ?\d+|tc ?\d+|tl ?\d+|rg ?\d+|jr ?\d+|rv ?\d+|ds ?\d+|dr ?-?z? ?\d+|drz ?\d*|vz ?\d+|vs ?\d+|vx ?\d+|vl ?\d+|gz ?\d+|intruder|boulevard|savage|hayabusa|katana|bandit|gn ?\d+|fa ?50|ax ?\d+|an ?\d+|burgman|x ?-?6|tu ?\d+|gr ?\d+|rl ?\d+|pe ?\d+|re ?-?5|rf ?\d+|sp ?\d+|tr ?\d+|b ?120|k ?10|k ?11|m ?\d{2,3}|c ?\d{2,3}|motorcycle|madura|cavalcade|marauder|stratosphere|gsf|v-?strom|tl'),
 'bmw':W(r'r ?\d{2,4}[a-z/]*|r ?nine ?t|k ?\d{1,4}[a-z]*|f ?\d{3}[a-z]*|g ?\d{3}[a-z]*|s ?1000[a-z]*|hp ?\d|c ?1|c ?\d{3}|motorcycle|motorrad|/\d'),
 'triumph':W(r't ?\d{2,3}[a-z]*|bonneville|tiger|trident|thunderbird|daytona|speed ?twin|speed ?triple|thruxton|scrambler|rocket|sprint|trophy|x ?-?75|hurricane|[3-6]t[a-z]?|3ta|3hw|tsx|tsr|tss|street triple|america|speedmaster|adventurer|cub|terrier|tina|tigress|tr ?5t|motorcycle|blazer|t ?-?\d+'),
}
SHARED_NEG={
 'honda':W(r'trx ?\d*[a-z]*|atc ?\d*[a-z]*|four ?trax|fourtrax|rancher|foreman|rubicon|recon|pioneer|big red|aquatrax|odyssey|fl ?250|pilot|civic|accord|s ?600|s ?800|n ?600|crx|prelude|del sol|s2000|nsx|element|fit|insight|ridgeline'),
 'yamaha':W(r'raptor|banshee|warrior(?! xv)|blaster|grizzly|kodiak|wolverine|bruin|big bear|bear|timberwolf|moto ?-?4|moto|yfz ?\d*[a-z]*|yfm ?\d*|yfs ?\d*|yfb ?\d*|yfa|badger|breeze|champ|rhino|viking|wave|golf|g ?\d+[a-z]*|exciter|enticer|phazer|srx|sx ?viper|vx|fx ?\d*|gp ?\d+|xlt|superjet|super jet|snoscoot|apex|nytro|venture|rx ?-?1|vk ?\d*|bravo|ovation|xl ?\d{3,4}'),
 'kawasaki':W(r'bayou|prairie|kfx ?\d*|klf ?\d*|mojave|lakota|brute|teryx|mule|jet ?ski|js ?\d*|jsx|stx|sx ?-?r|\d{3}sx|zxi|ultra|tecate|kef ?\d*|klt ?\d*|kvf ?\d*|tsr|xi|sts|sxi|x2'),
 'suzuki':W(r'lt ?-?[a-z]? ?\d*|ltz ?\d*|ltr ?\d*|ltf ?\d*|quad ?runner|quadrunner|quad ?sport|quadsport|king ?quad|eiger|ozark|vinson|samurai|sidekick|x-?90|vitara|xl ?-?7|carry|jimny|swift|esteem|aerio|forenza|reno|equator|cappuccino|every|alto|lj ?\d*|sj ?\d*|cultus|mighty boy'),
 'bmw':W(r'm ?\d|m|[efg] ?\d{2}|e ?\d{2}|x ?\d|z ?\d|i ?\d|isetta|2002|1600|2800|3\.0 ?cs[il]?|bavaria|alpina|\d{3}[a-z]{1,3}|600|700|503|507|327|328|335|m3|m5|series|sedan|coupe|cabrio|touring|csl'),
 'triumph':W(r'tr ?-?\d[a-z]?(?! ?trophy)|spitfire|gt ?6|herald|stag|dolomite|vitesse|toledo|1800|2000|2500|mayflower|renown|italia|acclaim|roadster|saloon|tr'),
 'sunbeam':W(r'tiger|alpine|rapier|imp|talbot|venezia|harrington|stiletto|minx|sedan|coupe|\d{1,2} ?hp|litre|liter'),
 'thor':W(r'motor|coach|wanderer|tahoe|chateau|windsport|citation|dutchmen|mandalay|vortex|four winds|ace|hurricane|axis|vegas|outlaw|aria|tuscany|palazzo|challenger|miramar'),
 'puch':W(r'\d{3} ?g[de]?|g ?\d{3}|ge ?\d*|gd|pinzgauer|haflinger|g-?wagen|500|steyr'),
 'cushman':W(r'truckster|haulster|mailster|trackster|utility|pickup|van|turf|titan|golf'),
 'nsu':W(r'prinz|ro ?80|ro|wankel|spider|spyder|kettenkrad|tt|1200|sport ?prinz|1000'),
 'dkw':W(r'f ?\d+|schnell+aster|munga|junior|universal|kombi|sonderklasse|reichsklasse|meisterklasse|1000|auto ?union|3=6|van|kavalier|f1000'),
 'simplex':W(r'crane|lafrance|\d+ ?hp|model 38|model 50|touring|speed car'),
 'powell':W(r'pickup|wagon|station|sport wagon|truck'),
 'rupp':W(r'sno|nitro|centaur|gojoe|go joe|yankee|american|sprint kart|kart|chevy'),
}
def judge(make,mt,title):
  """returns (is_motorcycle, reason)"""
  m=(make or '').lower(); txt=' '.join([(mt or '').lower(),(title or '').lower()])
  if rx(NEG_ALL,txt) and not rx(W('motorcycle|sidecar|trike'),txt): return False,'neg_all'
  if m in STRONG:
    if m in STRONG_NEG and rx(STRONG_NEG[m],txt): return False,'strong_neg'
    return True,'strong_make'
  if m in WEAK:
    if m in SHARED_NEG and rx(SHARED_NEG[m],(mt or '').lower()): return False,'make_neg'
    if m in SHARED_NEG and rx(SHARED_NEG[m],(title or '').lower()) and not rx(WEAK[m],(mt or '').lower()): return False,'make_neg_title'
    if rx(WEAK[m],txt): return True,'make_model_token'
    return False,'no_token'
  return False,'not_moto_make'
