# cart_utility / trailer_rv rule v2 (negatives for "w/Trailer" packages, Quad Cab / Dual-Quad / Quad-Motor, 3-wheel cars)
import re
def rx(p,s): return re.search(p,s) is not None
CART_POS=r'golf ?-?cart|golf car|golf\b|go ?-?kart|\bkart\b|\batv\b|\butv\b|side ?-?by ?-?side|snowmobile|truckster|haulster|\bmule\b|\bgator\b|club ?car|e-?z-?go|ezgo|king ?quad|\bquad\b(?! ?(cab|motor|carb|cam|4|headlight|-motor|dump))|sportsman|scrambler|ranger|rzr|maverick|outlander|teryx|8x8|6x6|amphibious atv|indy|predator|trail boss|xplorer|magnum|ski-?doo|arctic ?cat|melex|par car|taylor-dunn|marketeer|\bgem\b|\b\d{2,3}v\b|cart'
CART_NEG=r'brough|explorer xlt|us mule|push cart|^polaris \| \d{3} \||gator top|test mule|the mule|\u201cthe mule|trials|\bmx\b|\btrike\b|\brd ?\d{3}|trailer|dakota quad|dogcart|dog ?cart|jet ?ski|jetski|\bjet\b|virage|genesis|\bslt?x?\b|\bsl ?\d{3}|\bslh\b|\bmsx\b|octane|watercraft|wave|corvette kart|quad[ -]?(cab|motor|carb|cam|4|headlight)|dual[ -]?quad|slingshot|corvette(?!.*kart)|\bram\b|pickup|dump|semi|\bcab\b|w/ ?trailer|with trailer|race car'
CART_MAKES={'club car','e-z-go','ezgo','ez-go','arctic cat','ski-doo','can-am','argo','melex','columbia par car','taylor-dunn','gem','marketeer','yamaha','cushman','polaris','icon','evolution'}
TR_POS=r'trailer|teardrop|fifth wheel|5th wheel|motorhome|motor ?home|camper|winnebago|travco|airstream|\brv\b|toy hauler|horse trailer|cargo|stacker'
TR_NEG=r'smith miller|/trailer|&(amp;)? trailer|trailering|fifth wheel find|serena|chris-craft|runabout|\bw trailer|and \d+.? trailer|hardtop and|roadster pick ?up|\bw/ ?[^|]*(trailer|camper)|trailer special|teardrop coup|conversion candidate|school bus|\bbus\b(?!.*(motorhome|conversion\b(?! candidate)))|w/ ?(enclosed |custom |m-?100 |open |matching )?trailer|with (an? )?(enclosed |custom |matching )?trailer|includes trailer|trailer included|and trailer|& (custom )?trailer|plus trailer|tracker rv|sea-?doo|jet ?ski|boat|race car|& \d{4}|and \d{4}'
def cart(make,txt): 
  if rx(CART_NEG,txt): return False
  return (make in CART_MAKES and not rx(r'slingshot',txt)) or rx(CART_POS,txt)
def trailer(make,txt):
  if rx(TR_NEG,txt): return False
  return rx(TR_POS,txt)
