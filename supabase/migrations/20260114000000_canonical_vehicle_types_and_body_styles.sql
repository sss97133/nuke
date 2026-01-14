-- Canonical Vehicle Types + Body Styles
-- Purpose:
-- - Provide a stable taxonomy for organization + search (avoid polluted free-text `vehicles.body_style`)
-- - Map VIN-decoded `body_type`/`vehicle_type` and listing-derived `body_style` into canonical buckets
-- - Keep `vehicles` denormalized with canonical fields for fast filtering
--
-- Notes:
-- - This is an additive migration with IF NOT EXISTS / shims to keep `supabase db reset` clean.
-- - We intentionally keep canonical keys as TEXT (human-readable + stable).

-- =========================
-- 1) Canonical vehicle types
-- =========================
CREATE TABLE IF NOT EXISTS public.canonical_vehicle_types (
  canonical_name TEXT PRIMARY KEY, -- e.g., CAR, TRUCK, SUV
  display_name TEXT NOT NULL,       -- e.g., "Car"
  aliases TEXT[] DEFAULT ARRAY[]::TEXT[],
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed core types (extend over time)
INSERT INTO public.canonical_vehicle_types (canonical_name, display_name, aliases, description) VALUES
  ('CAR', 'Car', ARRAY['car', 'passenger car', 'passenger', 'sedan', 'coupe', 'convertible', 'wagon', 'hatchback'], 'Passenger vehicle'),
  ('TRUCK', 'Truck', ARRAY['truck', 'pickup', 'pickup truck', 'light truck', 'heavy truck'], 'Truck (pickup/medium/heavy)'),
  ('SUV', 'SUV', ARRAY['suv', 'sport utility', 'sport utility vehicle', 'mpv', 'multi-purpose vehicle', 'multipurpose passenger vehicle'], 'Sport utility / multi-purpose'),
  ('VAN', 'Van', ARRAY['van', 'cargo van', 'passenger van'], 'Van'),
  ('MINIVAN', 'Minivan', ARRAY['minivan'], 'Minivan'),
  ('MOTORCYCLE', 'Motorcycle', ARRAY['motorcycle', 'motor bike', 'bike'], 'Motorcycle'),
  ('RV', 'RV', ARRAY['rv', 'motorhome', 'camper', 'recreational vehicle'], 'Recreational vehicle'),
  ('TRAILER', 'Trailer', ARRAY['trailer'], 'Trailer'),
  ('BOAT', 'Boat', ARRAY['boat'], 'Boat'),
  ('ATV', 'ATV', ARRAY['atv', 'quad'], 'All-terrain vehicle'),
  ('UTV', 'UTV', ARRAY['utv', 'side by side', 'side-by-side'], 'Utility terrain vehicle'),
  ('SNOWMOBILE', 'Snowmobile', ARRAY['snowmobile'], 'Snowmobile'),
  ('BUS', 'Bus', ARRAY['bus'], 'Bus'),
  ('HEAVY_EQUIPMENT', 'Heavy equipment', ARRAY['heavy equipment', 'construction', 'tractor'], 'Heavy equipment'),
  ('OTHER', 'Other', ARRAY['other', 'unknown'], 'Unclassified / other')
ON CONFLICT (canonical_name) DO NOTHING;

-- =========================
-- 2) Canonical body styles
-- =========================
CREATE TABLE IF NOT EXISTS public.canonical_body_styles (
  canonical_name TEXT PRIMARY KEY, -- e.g., COUPE, PICKUP
  display_name TEXT NOT NULL,       -- e.g., "Coupe"
  vehicle_type TEXT NOT NULL REFERENCES public.canonical_vehicle_types(canonical_name) ON DELETE RESTRICT,
  aliases TEXT[] DEFAULT ARRAY[]::TEXT[],
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed common body styles (extend over time)
INSERT INTO public.canonical_body_styles (canonical_name, display_name, vehicle_type, aliases, description) VALUES
  ('COUPE', 'Coupe', 'CAR', ARRAY['coupe', '2dr', 'two door', 'two-door'], 'Two-door car'),
  ('SEDAN', 'Sedan', 'CAR', ARRAY['sedan', '4dr', 'four door', 'four-door'], 'Four-door car'),
  ('CONVERTIBLE', 'Convertible', 'CAR', ARRAY['convertible', 'cabriolet', 'drop top', 'droptop'], 'Convertible'),
  ('WAGON', 'Wagon', 'CAR', ARRAY['wagon', 'estate'], 'Wagon / estate'),
  ('HATCHBACK', 'Hatchback', 'CAR', ARRAY['hatchback', 'hatch'], 'Hatchback'),
  ('LIFTBACK', 'Liftback', 'CAR', ARRAY['liftback'], 'Liftback'),
  ('FASTBACK', 'Fastback', 'CAR', ARRAY['fastback'], 'Fastback'),
  ('ROADSTER', 'Roadster', 'CAR', ARRAY['roadster', 'spyder', 'spider'], 'Roadster'),
  ('TARGA', 'Targa', 'CAR', ARRAY['targa'], 'Targa top'),

  -- Trucks / utility
  ('PICKUP', 'Pickup', 'TRUCK', ARRAY['pickup', 'truck', 'crew cab', 'extended cab', 'regular cab', 'single cab', 'double cab'], 'Pickup truck'),

  -- Utility classes
  ('SUV', 'SUV', 'SUV', ARRAY['suv', 'sport utility', 'sport utility vehicle', 'mpv', 'multi-purpose vehicle', 'multipurpose passenger vehicle'], 'Sport utility'),
  ('VAN', 'Van', 'VAN', ARRAY['van', 'cargo van', 'passenger van'], 'Van'),
  ('MINIVAN', 'Minivan', 'MINIVAN', ARRAY['minivan'], 'Minivan'),

  -- Non-car
  ('MOTORCYCLE', 'Motorcycle', 'MOTORCYCLE', ARRAY['motorcycle', 'motor bike', 'bike'], 'Motorcycle'),
  ('RV', 'RV', 'RV', ARRAY['rv', 'motorhome', 'camper', 'recreational vehicle'], 'Recreational vehicle'),
  ('TRAILER', 'Trailer', 'TRAILER', ARRAY['trailer'], 'Trailer'),
  ('BOAT', 'Boat', 'BOAT', ARRAY['boat'], 'Boat'),
  ('ATV', 'ATV', 'ATV', ARRAY['atv', 'quad'], 'All-terrain vehicle'),
  ('UTV', 'UTV', 'UTV', ARRAY['utv', 'side by side', 'side-by-side'], 'Utility terrain vehicle'),
  ('SNOWMOBILE', 'Snowmobile', 'SNOWMOBILE', ARRAY['snowmobile'], 'Snowmobile')
ON CONFLICT (canonical_name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_canonical_body_styles_vehicle_type ON public.canonical_body_styles(vehicle_type);

-- =========================
-- 3) RLS (public read; service role writes)
-- =========================
ALTER TABLE public.canonical_vehicle_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_body_styles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read canonical vehicle types" ON public.canonical_vehicle_types;
CREATE POLICY "Public read canonical vehicle types"
  ON public.canonical_vehicle_types
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Public read canonical body styles" ON public.canonical_body_styles;
CREATE POLICY "Public read canonical body styles"
  ON public.canonical_body_styles
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Service role write canonical vehicle types" ON public.canonical_vehicle_types;
CREATE POLICY "Service role write canonical vehicle types"
  ON public.canonical_vehicle_types
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role write canonical body styles" ON public.canonical_body_styles;
CREATE POLICY "Service role write canonical body styles"
  ON public.canonical_body_styles
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =========================
-- 4) Vehicles: add canonical columns + indexes
-- =========================
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS canonical_vehicle_type TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS canonical_body_style TEXT;

CREATE INDEX IF NOT EXISTS idx_vehicles_canonical_vehicle_type ON public.vehicles(canonical_vehicle_type);
CREATE INDEX IF NOT EXISTS idx_vehicles_canonical_body_style ON public.vehicles(canonical_body_style);

-- =========================
-- 5) Normalization helpers
-- =========================
CREATE OR REPLACE FUNCTION public.normalize_vehicle_type(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  raw TEXT := LOWER(COALESCE(p_raw, ''));
  hit TEXT;
BEGIN
  IF raw = '' THEN
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
  IF raw ~ 'motorcycle' THEN RETURN 'MOTORCYCLE'; END IF;
  IF raw ~ 'trailer' THEN RETURN 'TRAILER'; END IF;
  IF raw ~ 'bus' THEN RETURN 'BUS'; END IF;
  IF raw ~ 'boat' THEN RETURN 'BOAT'; END IF;
  IF raw ~ 'snowmobile' THEN RETURN 'SNOWMOBILE'; END IF;
  IF raw ~ 'atv|quad' THEN RETURN 'ATV'; END IF;
  IF raw ~ 'utv|side' THEN RETURN 'UTV'; END IF;
  IF raw ~ 'motorhome|rv|recreational' THEN RETURN 'RV'; END IF;
  IF raw ~ 'van' THEN RETURN 'VAN'; END IF;
  IF raw ~ 'sport utility|suv|mpv|multi' THEN RETURN 'SUV'; END IF;
  IF raw ~ 'pickup|truck' THEN RETURN 'TRUCK'; END IF;
  IF raw ~ 'passenger' THEN RETURN 'CAR'; END IF;

  RETURN 'OTHER';
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_body_style(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
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
$$;

-- =========================
-- 6) Trigger: keep vehicles canonical fields updated
-- =========================
CREATE OR REPLACE FUNCTION public.set_vehicle_canonical_taxonomy()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_set_vehicle_canonical_taxonomy ON public.vehicles;
CREATE TRIGGER trg_set_vehicle_canonical_taxonomy
  BEFORE INSERT OR UPDATE OF vin, body_style
  ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_vehicle_canonical_taxonomy();

