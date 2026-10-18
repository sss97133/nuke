-- Live existing normalizer/trigger definitions, inspected2026-10-07. Disposable fixtures only.
CREATE OR REPLACE FUNCTION public.normalize_body_style(p_raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  raw TEXT := LOWER(COALESCE(p_raw, ''));
  hit TEXT;
BEGIN
  IF raw = '' THEN
    RETURN NULL;
  END IF;

  -- First: alias match from canonical table.
  SELECT canonical_name INTO hit
  FROM public.canonical_body_styles
  WHERE raw = ANY(aliases)
     OR raw = LOWER(canonical_name)
     OR raw = LOWER(display_name)
  LIMIT 1;

  IF hit IS NOT NULL THEN
    RETURN hit;
  END IF;

  -- Second: pattern mapping for common NHTSA / scraped values.
  IF raw ~ 'pickup|truck|crew cab|extended cab|regular cab|single cab|double cab' THEN RETURN 'PICKUP'; END IF;
  IF raw ~ 'sport utility|suv|mpv|multi' THEN RETURN 'SUV'; END IF;
  IF raw ~ 'minivan' THEN RETURN 'MINIVAN'; END IF;
  IF raw ~ 'van' THEN RETURN 'VAN'; END IF;
  IF raw ~ 'convertible|cabriolet|drop' THEN RETURN 'CONVERTIBLE'; END IF;
  IF raw ~ 'roadster|spyder|spider' THEN RETURN 'ROADSTER'; END IF;
  IF raw ~ 'targa' THEN RETURN 'TARGA'; END IF;
  IF raw ~ 'fastback' THEN RETURN 'FASTBACK'; END IF;
  IF raw ~ 'liftback' THEN RETURN 'LIFTBACK'; END IF;
  IF raw ~ 'hatch' THEN RETURN 'HATCHBACK'; END IF;
  IF raw ~ 'wagon|estate' THEN RETURN 'WAGON'; END IF;
  IF raw ~ 'sedan' THEN RETURN 'SEDAN'; END IF;
  IF raw ~ 'coupe|2dr|two door' THEN RETURN 'COUPE'; END IF;
  IF raw ~ 'motorcycle' THEN RETURN 'MOTORCYCLE'; END IF;
  IF raw ~ 'motorhome|rv|recreational|camper' THEN RETURN 'RV'; END IF;
  IF raw ~ 'trailer' THEN RETURN 'TRAILER'; END IF;
  IF raw ~ 'boat' THEN RETURN 'BOAT'; END IF;

  RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.normalize_vehicle_type(p_raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  raw TEXT := LOWER(COALESCE(p_raw, ''));
  hit TEXT;
BEGIN
  IF raw = '' OR raw = 'n/a' OR raw = 'na' OR raw = 'none' OR raw = 'other' OR raw = 'unknown' THEN
    RETURN NULL;
  END IF;

  -- First: explicit alias match from canonical table (fast, stable).
  SELECT canonical_name INTO hit
  FROM public.canonical_vehicle_types
  WHERE raw = ANY(aliases)
     OR raw = LOWER(canonical_name)
  LIMIT 1;

  IF hit IS NOT NULL THEN
    RETURN hit;
  END IF;

  -- Second: pattern mapping for common NHTSA / scraped values.
  IF raw ~ 'motorcycle|motorbike|dirt bike|sportster|softail|dyna|road king|road glide|street glide|electra glide|fat boy|chopper|bobber' THEN RETURN 'MOTORCYCLE'; END IF;
  IF raw ~ 'trailer|flatbed' THEN RETURN 'TRAILER'; END IF;
  IF raw ~ '\ybus\y' THEN RETURN 'BUS'; END IF;
  IF raw ~ 'boat|marine|pontoon|sailboat|watercraft|outboard' THEN RETURN 'BOAT'; END IF;
  IF raw ~ 'snowmobile' THEN RETURN 'SNOWMOBILE'; END IF;
  IF raw ~ '\batv\b|quad' THEN RETURN 'ATV'; END IF;
  IF raw ~ '\butv\b|side.by.side' THEN RETURN 'UTV'; END IF;
  IF raw ~ 'motorhome|\brv\b|recreational|camper|winnebago|airstream' THEN RETURN 'RV'; END IF;
  IF raw ~ 'tractor|forklift|excavator|backhoe|skid steer|loader|combine|bulldozer|crane' THEN RETURN 'HEAVY_EQUIPMENT'; END IF;
  IF raw ~ 'minivan' THEN RETURN 'VAN'; END IF;
  IF raw ~ '\bvan\b' THEN RETURN 'VAN'; END IF;
  IF raw ~ 'sport utility|\bsuv\b|mpv|multi.purpose' THEN RETURN 'SUV'; END IF;
  IF raw ~ 'pickup|truck' THEN RETURN 'TRUCK'; END IF;
  IF raw ~ 'passenger' THEN RETURN 'CAR'; END IF;

  -- Extended patterns for collector car body styles that imply CAR
  IF raw ~ 'hardtop|coupe|sedan|convertible|cabriolet|roadster|spyder|spider|targa|fastback|liftback|hatchback|wagon|estate|resto.mod|street.rod|hot.rod|custom|phaeton|landau|limousine|touring|berlinetta|gt\y|gran turismo' THEN RETURN 'CAR'; END IF;

  -- Custom Pickup variants
  IF raw ~ 'custom pickup|custom truck' THEN RETURN 'TRUCK'; END IF;

  RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_vehicle_canonical_taxonomy()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  n_body_type TEXT;
  n_vehicle_type TEXT;
  raw_body TEXT;
BEGIN
  -- Pull VIN-derived types if available (best source), but don't require VIN.
  IF NEW.vin IS NOT NULL AND LENGTH(NEW.vin) >= 11 THEN
    SELECT body_type, vehicle_type INTO n_body_type, n_vehicle_type
    FROM public.vin_decoded_data
    WHERE vin = UPPER(NEW.vin)
    LIMIT 1;
  END IF;

  raw_body := COALESCE(NEW.body_style, n_body_type, n_vehicle_type);
  NEW.canonical_body_style := public.normalize_body_style(raw_body);
  NEW.canonical_vehicle_type := public.normalize_vehicle_type(COALESCE(n_vehicle_type, raw_body, NEW.body_style));

  -- If we got a canonical body style, prefer its vehicle_type mapping.
  IF NEW.canonical_body_style IS NOT NULL THEN
    SELECT vehicle_type INTO NEW.canonical_vehicle_type
    FROM public.canonical_body_styles
    WHERE canonical_name = NEW.canonical_body_style
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$function$
;