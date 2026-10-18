-- ============================================================================
-- VEHICLE CLASSIFICATION SCHEMA
-- ============================================================================
-- Enables natural language queries like:
--   "What did clean 964s sell for last quarter?"
--   "Show me JDM cars under $50k"
--   "Average price of air-cooled Porsches by year"
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1) ADD BRAND_TIER TO EXISTING CANONICAL_MAKES TABLE
-- ============================================================================

ALTER TABLE canonical_makes
  ADD COLUMN IF NOT EXISTS brand_tier TEXT CHECK (brand_tier IN ('exotic', 'luxury', 'premium', 'mainstream', 'budget'));

-- Update brand tiers for existing makes
UPDATE canonical_makes SET brand_tier = 'premium' WHERE canonical_name = 'BMW' AND brand_tier IS NULL;
UPDATE canonical_makes SET brand_tier = 'luxury' WHERE canonical_name = 'Mercedes-Benz' AND brand_tier IS NULL;
UPDATE canonical_makes SET brand_tier = 'luxury' WHERE canonical_name = 'Porsche' AND brand_tier IS NULL;
UPDATE canonical_makes SET brand_tier = 'exotic' WHERE canonical_name = 'Ferrari' AND brand_tier IS NULL;
UPDATE canonical_makes SET brand_tier = 'exotic' WHERE canonical_name = 'Lamborghini' AND brand_tier IS NULL;
UPDATE canonical_makes SET brand_tier = 'mainstream' WHERE canonical_name IN ('Toyota', 'Honda', 'Nissan', 'Mazda', 'Ford', 'Chevrolet', 'Dodge') AND brand_tier IS NULL;
UPDATE canonical_makes SET brand_tier = 'luxury' WHERE canonical_name IN ('Lexus', 'Jaguar', 'Land Rover', 'Cadillac') AND brand_tier IS NULL;
UPDATE canonical_makes SET brand_tier = 'exotic' WHERE canonical_name IN ('Aston Martin', 'Bentley', 'Rolls-Royce', 'McLaren', 'Maserati') AND brand_tier IS NULL;
UPDATE canonical_makes SET brand_tier = 'premium' WHERE canonical_name IN ('Audi', 'Alfa Romeo', 'Volvo', 'Acura', 'Infiniti') AND brand_tier IS NULL;

-- Seed any missing canonical makes
INSERT INTO canonical_makes (canonical_name, display_name, country_of_origin, brand_tier, aliases) VALUES
  ('Subaru', 'Subaru', 'Japan', 'mainstream', ARRAY['subaru', 'SUBARU']),
  ('Mitsubishi', 'Mitsubishi', 'Japan', 'mainstream', ARRAY['mitsubishi', 'MITSUBISHI']),
  ('Jeep', 'Jeep', 'USA', 'mainstream', ARRAY['jeep', 'JEEP']),
  ('GMC', 'GMC', 'USA', 'mainstream', ARRAY['gmc', 'Gmc']),
  ('Lincoln', 'Lincoln', 'USA', 'luxury', ARRAY['lincoln', 'LINCOLN']),
  ('Pontiac', 'Pontiac', 'USA', 'mainstream', ARRAY['pontiac', 'PONTIAC']),
  ('Buick', 'Buick', 'USA', 'premium', ARRAY['buick', 'BUICK']),
  ('Oldsmobile', 'Oldsmobile', 'USA', 'mainstream', ARRAY['oldsmobile', 'Olds']),
  ('Plymouth', 'Plymouth', 'USA', 'mainstream', ARRAY['plymouth', 'PLYMOUTH']),
  ('AMC', 'AMC', 'USA', 'mainstream', ARRAY['amc', 'American Motors']),
  ('Lotus', 'Lotus', 'UK', 'luxury', ARRAY['lotus', 'LOTUS']),
  ('MG', 'MG', 'UK', 'mainstream', ARRAY['mg', 'Morris Garages']),
  ('Triumph', 'Triumph', 'UK', 'mainstream', ARRAY['triumph', 'TRIUMPH']),
  ('Austin-Healey', 'Austin-Healey', 'UK', 'mainstream', ARRAY['Austin Healey', 'austin-healey']),
  ('Fiat', 'Fiat', 'Italy', 'mainstream', ARRAY['fiat', 'FIAT']),
  ('Lancia', 'Lancia', 'Italy', 'premium', ARRAY['lancia', 'LANCIA']),
  ('De Tomaso', 'De Tomaso', 'Italy', 'exotic', ARRAY['DeTomaso', 'de tomaso']),
  ('Saab', 'Saab', 'Sweden', 'premium', ARRAY['saab', 'SAAB']),
  ('Datsun', 'Datsun', 'Japan', 'mainstream', ARRAY['datsun', 'DATSUN']),
  ('Chrysler', 'Chrysler', 'USA', 'mainstream', ARRAY['chrysler', 'CHRYSLER'])
ON CONFLICT (canonical_name) DO NOTHING;

-- Update aliases for common makes that may already exist
UPDATE canonical_makes SET aliases = ARRAY['Bmw', 'bmw', 'B.M.W.'] WHERE canonical_name = 'BMW' AND (aliases IS NULL OR array_length(aliases, 1) IS NULL);
UPDATE canonical_makes SET aliases = ARRAY['Mercedes', 'mercedes-benz', 'Merc', 'MB'] WHERE canonical_name = 'Mercedes-Benz' AND (aliases IS NULL OR array_length(aliases, 1) IS NULL);
UPDATE canonical_makes SET aliases = ARRAY['porsche', 'PORSCHE'] WHERE canonical_name = 'Porsche' AND (aliases IS NULL OR array_length(aliases, 1) IS NULL);
UPDATE canonical_makes SET aliases = ARRAY['Chevy', 'chevy', 'CHEVROLET'] WHERE canonical_name = 'Chevrolet' AND (aliases IS NULL OR array_length(aliases, 1) IS NULL);
UPDATE canonical_makes SET aliases = ARRAY['ford', 'FORD'] WHERE canonical_name = 'Ford' AND (aliases IS NULL OR array_length(aliases, 1) IS NULL);
UPDATE canonical_makes SET aliases = ARRAY['toyota', 'TOYOTA'] WHERE canonical_name = 'Toyota' AND (aliases IS NULL OR array_length(aliases, 1) IS NULL);
UPDATE canonical_makes SET aliases = ARRAY['honda', 'HONDA'] WHERE canonical_name = 'Honda' AND (aliases IS NULL OR array_length(aliases, 1) IS NULL);
UPDATE canonical_makes SET aliases = ARRAY['nissan', 'NISSAN'] WHERE canonical_name = 'Nissan' AND (aliases IS NULL OR array_length(aliases, 1) IS NULL);
UPDATE canonical_makes SET aliases = ARRAY['VW', 'vw', 'volkswagen'] WHERE canonical_name = 'Volkswagen' AND (aliases IS NULL OR array_length(aliases, 1) IS NULL);
UPDATE canonical_makes SET aliases = ARRAY['Land-Rover', 'Landrover', 'land rover'] WHERE canonical_name = 'Land Rover' AND (aliases IS NULL OR array_length(aliases, 1) IS NULL);

-- ============================================================================
-- 2) VEHICLE SEGMENTS - Market categorization
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,            -- e.g., 'jdm', 'muscle', 'air-cooled-porsche'
  display_name TEXT NOT NULL,           -- e.g., 'JDM', 'Muscle Car', 'Air-Cooled Porsche'
  description TEXT,
  parent_segment_id UUID REFERENCES vehicle_segments(id),
  keywords TEXT[],                      -- Search keywords for NL matching
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed segments
INSERT INTO vehicle_segments (slug, display_name, description, keywords) VALUES
  ('sports-car', 'Sports Car', 'Two-seat performance vehicles', ARRAY['sports', 'sporty', '2-seater', 'roadster']),
  ('muscle-car', 'Muscle Car', 'American high-performance vehicles, typically V8', ARRAY['muscle', 'pony', 'american muscle']),
  ('jdm', 'JDM', 'Japanese Domestic Market - Japanese performance cars', ARRAY['jdm', 'japanese', 'import', 'ricer']),
  ('euro', 'European', 'European sports and luxury vehicles', ARRAY['euro', 'european', 'german', 'italian']),
  ('classic', 'Classic', 'Vehicles 25+ years old', ARRAY['classic', 'vintage', 'antique', 'collector']),
  ('modern-classic', 'Modern Classic', 'Collectible vehicles from 1980s-2000s', ARRAY['modern classic', 'youngtimer', 'future classic']),
  ('supercar', 'Supercar', 'Exotic high-performance vehicles', ARRAY['supercar', 'exotic', 'hypercar']),
  ('off-road', 'Off-Road', '4x4 and off-road vehicles', ARRAY['4x4', 'offroad', 'off-road', 'suv', 'overlander']),
  ('truck', 'Truck', 'Pickup trucks and commercial vehicles', ARRAY['truck', 'pickup', 'hauler']),
  ('luxury', 'Luxury', 'High-end luxury vehicles', ARRAY['luxury', 'lux', 'premium']),
  ('air-cooled-porsche', 'Air-Cooled Porsche', 'Pre-1998 Porsche 911s', ARRAY['air-cooled', 'aircooled', '964', '993', '930', '911sc', '911s']),
  ('water-cooled-porsche', 'Water-Cooled Porsche', '996+ Porsche 911s', ARRAY['water-cooled', 'watercooled', '996', '997', '991', '992']),
  ('e30', 'BMW E30', 'BMW 3-series 1982-1994', ARRAY['e30', 'e30 m3', 'e30 325']),
  ('e36', 'BMW E36', 'BMW 3-series 1990-2000', ARRAY['e36', 'e36 m3']),
  ('e46', 'BMW E46', 'BMW 3-series 1997-2006', ARRAY['e46', 'e46 m3']),
  ('w123', 'Mercedes W123', 'Mercedes E-Class 1976-1985', ARRAY['w123', '300d', '240d']),
  ('w124', 'Mercedes W124', 'Mercedes E-Class 1984-1997', ARRAY['w124', '500e', '300e']),
  ('supra', 'Toyota Supra', 'All generations of Toyota Supra', ARRAY['supra', 'mk4', 'mk3', 'a80', 'a70', '2jz']),
  ('nsx', 'Acura NSX', 'Honda/Acura NSX', ARRAY['nsx', 'na1', 'na2']),
  ('skyline', 'Nissan Skyline', 'Nissan Skyline/GT-R', ARRAY['skyline', 'gtr', 'gt-r', 'r32', 'r33', 'r34', 'hakosuka', 'kenmeri']),
  ('rx7', 'Mazda RX-7', 'Mazda RX-7 rotary sports car', ARRAY['rx7', 'rx-7', 'fd', 'fc', 'fb', 'sa22c', 'rotary']),
  ('miata', 'Mazda Miata', 'Mazda MX-5/Miata', ARRAY['miata', 'mx-5', 'mx5', 'na miata', 'nb miata', 'nc miata', 'nd miata']),
  ('corvette', 'Chevrolet Corvette', 'All Corvette generations', ARRAY['corvette', 'vette', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'stingray']),
  ('mustang', 'Ford Mustang', 'All Ford Mustang generations', ARRAY['mustang', 'stang', 'gt350', 'gt500', 'mach 1', 'boss']),
  ('camaro', 'Chevrolet Camaro', 'All Camaro generations', ARRAY['camaro', 'z28', 'ss', 'iroc', 'zl1']),
  ('bronco', 'Ford Bronco', 'Ford Bronco all generations', ARRAY['bronco', 'early bronco', 'full-size bronco']),
  ('defender', 'Land Rover Defender', 'Land Rover Defender/Series', ARRAY['defender', 'd90', 'd110', 'series land rover', 'series iii']),
  ('g-wagon', 'Mercedes G-Wagon', 'Mercedes G-Class', ARRAY['g-wagon', 'g-wagen', 'g-class', 'gelandewagen', 'g500', 'g550', 'g63', 'g55'])
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- 3) ADD CLASSIFICATION COLUMNS TO VEHICLES
-- ============================================================================

-- Add segment and era columns
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES vehicle_segments(id),
  ADD COLUMN IF NOT EXISTS era TEXT CHECK (era IN ('pre-war', 'post-war', 'classic', 'malaise', 'modern-classic', 'modern', 'contemporary')),
  ADD COLUMN IF NOT EXISTS canonical_make_id UUID REFERENCES canonical_makes(id);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_vehicles_segment ON vehicles(segment_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_era ON vehicles(era);
CREATE INDEX IF NOT EXISTS idx_vehicles_canonical_make ON vehicles(canonical_make_id);

-- ============================================================================
-- 4) AUTO-CLASSIFICATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_classify_vehicle()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Set era based on year
  IF NEW.year IS NOT NULL AND NEW.era IS NULL THEN
    NEW.era := CASE
      WHEN NEW.year < 1946 THEN 'pre-war'
      WHEN NEW.year < 1960 THEN 'post-war'
      WHEN NEW.year < 1973 THEN 'classic'
      WHEN NEW.year < 1985 THEN 'malaise'
      WHEN NEW.year < 2000 THEN 'modern-classic'
      WHEN NEW.year < 2015 THEN 'modern'
      ELSE 'contemporary'
    END;
  END IF;

  -- Link to canonical make (using aliases array in canonical_makes)
  IF NEW.make IS NOT NULL AND NEW.canonical_make_id IS NULL THEN
    SELECT cm.id INTO NEW.canonical_make_id
    FROM canonical_makes cm
    WHERE cm.canonical_name = NEW.make
       OR cm.display_name = NEW.make
       OR NEW.make = ANY(cm.aliases)
    LIMIT 1;
  END IF;

  -- Auto-assign segment based on make/model patterns
  IF NEW.segment_id IS NULL AND NEW.make IS NOT NULL THEN
    SELECT vs.id INTO NEW.segment_id
    FROM vehicle_segments vs
    WHERE
      -- JDM detection
      (vs.slug = 'jdm' AND NEW.make IN ('Toyota', 'Honda', 'Nissan', 'Mazda', 'Subaru', 'Mitsubishi', 'Datsun', 'Lexus', 'Acura', 'Infiniti'))
      -- Air-cooled Porsche detection
      OR (vs.slug = 'air-cooled-porsche' AND NEW.make = 'Porsche' AND NEW.year < 1999 AND NEW.model ~* '911|930|964|993')
      -- Water-cooled Porsche detection
      OR (vs.slug = 'water-cooled-porsche' AND NEW.make = 'Porsche' AND NEW.year >= 1999 AND NEW.model ~* '911|996|997|991|992')
      -- Muscle car detection
      OR (vs.slug = 'muscle-car' AND NEW.make IN ('Chevrolet', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'AMC', 'Oldsmobile', 'Buick')
          AND NEW.model ~* 'Camaro|Mustang|Challenger|Charger|Cuda|GTO|Firebird|Chevelle|Nova|Corvette')
      -- Specific model segments
      OR (vs.slug = 'miata' AND NEW.make = 'Mazda' AND NEW.model ~* 'MX-5|Miata')
      OR (vs.slug = 'supra' AND NEW.make = 'Toyota' AND NEW.model ~* 'Supra')
      OR (vs.slug = 'rx7' AND NEW.make = 'Mazda' AND NEW.model ~* 'RX-7|RX7')
      OR (vs.slug = 'corvette' AND NEW.make = 'Chevrolet' AND NEW.model ~* 'Corvette')
      OR (vs.slug = 'mustang' AND NEW.make = 'Ford' AND NEW.model ~* 'Mustang')
      OR (vs.slug = 'camaro' AND NEW.make = 'Chevrolet' AND NEW.model ~* 'Camaro')
      OR (vs.slug = 'bronco' AND NEW.make = 'Ford' AND NEW.model ~* 'Bronco')
      OR (vs.slug = 'defender' AND NEW.make = 'Land Rover' AND NEW.model ~* 'Defender|Series')
      OR (vs.slug = 'g-wagon' AND NEW.make IN ('Mercedes-Benz', 'Mercedes') AND NEW.model ~* 'G-Class|G-Wagon|G500|G550|G63|G55')
      OR (vs.slug = 'e30' AND NEW.make = 'BMW' AND NEW.model ~* 'E30|325i|325is|318i|M3' AND NEW.year BETWEEN 1982 AND 1994)
      OR (vs.slug = 'skyline' AND NEW.make = 'Nissan' AND NEW.model ~* 'Skyline|GT-R|GTR')
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_classify_vehicle ON public.vehicles;
CREATE TRIGGER trigger_auto_classify_vehicle
  BEFORE INSERT OR UPDATE OF make, model, year
  ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_classify_vehicle();

-- ============================================================================
-- 5) NORMALIZE EXISTING MAKES
-- ============================================================================

-- Fix BMW
UPDATE vehicles SET make = 'BMW' WHERE make IN ('Bmw', 'bmw');

-- Fix Mercedes
UPDATE vehicles SET make = 'Mercedes-Benz' WHERE make IN ('Mercedes', 'mercedes-benz', 'mercedes benz');

-- ============================================================================
-- 6) BACKFILL ERA ON EXISTING VEHICLES
-- ============================================================================

UPDATE vehicles
SET era = CASE
  WHEN year < 1946 THEN 'pre-war'
  WHEN year < 1960 THEN 'post-war'
  WHEN year < 1973 THEN 'classic'
  WHEN year < 1985 THEN 'malaise'
  WHEN year < 2000 THEN 'modern-classic'
  WHEN year < 2015 THEN 'modern'
  ELSE 'contemporary'
END
WHERE year IS NOT NULL AND era IS NULL;

-- ============================================================================
-- 7) CREATE SEARCH VIEW FOR NL QUERIES
-- ============================================================================

CREATE OR REPLACE VIEW vehicle_search AS
SELECT
  v.id,
  v.year,
  v.make,
  v.model,
  v.trim,
  v.generation,
  v.body_style,
  v.era,
  vs.display_name as segment,
  vs.slug as segment_slug,
  cm.country_of_origin,
  cm.brand_tier,
  v.auction_source,
  v.sale_price,
  v.winning_bid,
  v.high_bid,
  v.asking_price,
  COALESCE(v.sale_price, v.winning_bid, v.high_bid, v.asking_price) as best_price,
  v.auction_outcome,
  v.mileage,
  v.color as exterior_color,
  v.interior_color,
  v.transmission,
  v.engine_type as engine,
  v.vin,
  v.created_at,
  v.updated_at
FROM vehicles v
LEFT JOIN vehicle_segments vs ON v.segment_id = vs.id
LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
WHERE v.listing_kind = 'vehicle' OR v.listing_kind IS NULL;

COMMENT ON VIEW vehicle_search IS
  'Denormalized view for natural language queries with segment, era, and make metadata.';

COMMIT;
