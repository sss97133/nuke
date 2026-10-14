-- Live definitions of public.expand_search_query(text) and public.is_auto_vehicle(text,text), pg_get_functiondef on
-- 2026-10-14 23:20Z; neither reads a table. Loaded by test_search_deep_text_for_page_only.sql.
CREATE OR REPLACE FUNCTION public.expand_search_query(raw_query text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  expanded text;
  synonyms jsonb := '{
    "chevy": "chevrolet",
    "vette": "corvette",
    "stang": "mustang",
    "bimmer": "bmw",
    "merc": "mercedes",
    "benz": "mercedes",
    "jag": "jaguar",
    "vw": "volkswagen",
    "alfa": "alfa romeo",
    "poncho": "pontiac",
    "olds": "oldsmobile",
    "landy": "land rover",
    "lambo": "lamborghini",
    "sbc": "small block chevrolet",
    "bbc": "big block chevrolet",
    "restomod": "restoration modified",
    "4x4": "four wheel drive",
    "4wd": "four wheel drive",
    "vert": "convertible",
    "droptop": "convertible",
    "ragtop": "convertible",
    "squarebody": "square body chevrolet gmc",
    "camero": "camaro",
    "corvete": "corvette",
    "mustange": "mustang",
    "porche": "porsche",
    "chevorlet": "chevrolet",
    "firebird": "firebird pontiac",
    "z28": "z28 camaro",
    "ss": "super sport",
    "gt": "gran turismo",
    "ls1": "ls1 5.7 v8",
    "ls3": "ls3 6.2 v8",
    "cummins": "cummins diesel",
    "duramax": "duramax diesel",
    "powerstroke": "powerstroke diesel"
  }'::jsonb;
  words text[];
  i int;
  word text;
  replacement text;
BEGIN
  expanded := lower(trim(raw_query));
  words := string_to_array(expanded, ' ');
  
  FOR i IN 1..array_length(words, 1) LOOP
    word := words[i];
    replacement := synonyms ->> word;
    IF replacement IS NOT NULL THEN
      words[i] := replacement;
    END IF;
  END LOOP;
  
  RETURN array_to_string(words, ' ');
END;
$function$

;
CREATE OR REPLACE FUNCTION public.is_auto_vehicle(p_vehicle_type text, p_make text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN p_vehicle_type IN ('CAR', 'TRUCK', 'SUV', 'VAN', 'MINIVAN') THEN true
    WHEN p_vehicle_type IS NOT NULL THEN false
    ELSE upper(trim(coalesce(p_make, ''))) NOT IN (
      'HARLEY-DAVIDSON','HARLEY','HARLEYDAVIDSON','DUCATI','KTM','HUSQVARNA','APRILIA',
      'MOTO GUZZI','NORTON','BSA','BUELL','ROYAL ENFIELD',
      'VINCENT','VELOCETTE','AJS','MATCHLESS','EXCELSIOR',
      'HENDERSON','BIMOTA','BENELLI','CROCKER','LAVERDA',
      'MV AGUSTA','VESPA','PIAGGIO',
      'POLARIS','ARCTIC CAT','CAN-AM','SKI-DOO','SKIDOO',
      'SEA-DOO','SEADOO','SEA DOO','SEA RAY','SEARAY','SEA',
      'BAYLINER','BOSTON WHALER','GRUMMAN',
      'GLASTRON','SKEETER','TRACKER','MASTERCRAFT','MALIBU BOATS',
      'CORRECT CRAFT','RIVA','CHRIS-CRAFT','WELLCRAFT','RINKER',
      'CHAPARRAL','COBALT','LUND','CRESTLINER','BENNINGTON',
      'FLEETWOOD','WINNEBAGO','AIRSTREAM','COACHMEN','JAYCO',
      'KEYSTONE','FOREST RIVER','THOR','NEWMAR','TIFFIN',
      'HOLIDAY RAMBLER','MONACO','FLAGSTAFF','COLEMAN','STARCRAFT',
      'HEARTLAND','DUTCHMEN','GRAND DESIGN','ENTEGRA','GULF STREAM',
      'JOHN DEERE','KUBOTA','CATERPILLAR','BOBCAT','CASE IH',
      'NEW HOLLAND','MASSEY FERGUSON','FARMALL','ALLIS-CHALMERS',
      'OLIVER','AGCO',
      'FREIGHTLINER','PETERBILT','KENWORTH','MACK','HINO',
      'WESTERN STAR','AUTOCAR','NAVISTAR',
      'EZGO','CLUB CAR','CUSHMAN','GEM',
      'CESSNA','PIPER','BEECHCRAFT','MOONEY','CIRRUS',
      'FEATHERLITE','SUNDOWNER','BIG TEX','LOAD TRAIL','PJ TRAILERS',
      'ILLUMINATED','NEON','RICHFIELD-BRANDED','AMETHYST','SPEED',
      'PURE','PROMO','COLLECTION','AEROVAULT','DISPLAY','VINTAGE SIGN'
    )
  END;
$function$

;
