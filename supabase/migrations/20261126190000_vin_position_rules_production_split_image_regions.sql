-- Reference structure that lets a pre-1981 VIN decode by join, production counts split by
-- trim and engine, and a keyed region inside a photo. Reference rows only; every row cites
-- the page it was read from. No vehicle-specific rows.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- 1. VIN position rules -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vin_position_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL,
  year_from int NOT NULL,
  year_to int NOT NULL,
  position_from int NOT NULL CHECK (position_from BETWEEN 1 AND 17),
  position_to int NOT NULL CHECK (position_to BETWEEN 1 AND 17),
  code text NOT NULL,
  meaning_key text NOT NULL,
  meaning_value text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url text NOT NULL,
  source_read_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (year_to >= year_from),
  CHECK (position_to >= position_from),
  CHECK (length(code) = position_to - position_from + 1),
  UNIQUE (make, year_from, year_to, position_from, position_to, code, meaning_key)
);
COMMENT ON TABLE public.vin_position_rules IS
  'One row per (make, model years, VIN position span, code) -> meaning, with the page it was read from. A VIN decodes by join (v_vin_position_decode); no row without a source.';
ALTER TABLE public.vin_position_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vin_position_rules_read ON public.vin_position_rules;
CREATE POLICY vin_position_rules_read ON public.vin_position_rules FOR SELECT USING (true);
REVOKE ALL ON public.vin_position_rules FROM anon, authenticated;
GRANT SELECT ON public.vin_position_rules TO anon, authenticated;

INSERT INTO public.vin_position_rules
  (make, year_from, year_to, position_from, position_to, code, meaning_key, meaning_value, detail, source_url, source_read_on)
SELECT 'Pontiac', 1973, 1973, 5, 5, x.code, 'factory_engine', x.val, x.detail,
       'https://tran-zam.com/fhistory/1973Engines.aspx', DATE '2026-11-25'
FROM (VALUES
  ('D', '250ci inline-six, 1 bbl',        '{"displacement_cid":250,"cylinders":6,"carb":"1 bbl","net_hp":"110@3800","engine_source":"Chevrolet","block_codes":["CCC","CCD"],"model_scope":"Firebird"}'::jsonb),
  ('M', '350ci V8, 2 bbl (L30)',          '{"displacement_cid":350,"cylinders":8,"carb":"2 bbl","net_hp":"150@4000","rpo":"L30","model_scope":"Firebird"}'::jsonb),
  ('R', '400ci V8, 2 bbl (L65)',          '{"displacement_cid":400,"cylinders":8,"carb":"2 bbl","net_hp":"170@3600","rpo":"L65","model_scope":"Firebird"}'::jsonb),
  ('T', '400ci V8, 4 bbl (L78)',          '{"displacement_cid":400,"cylinders":8,"carb":"4 bbl","net_hp":"230@4000","rpo":"L78","model_scope":"Firebird"}'::jsonb),
  ('Y', '455ci V8, 4 bbl (L75)',          '{"displacement_cid":455,"cylinders":8,"carb":"4 bbl","net_hp":"250@4000","rpo":"L75","model_scope":"Firebird"}'::jsonb),
  ('X', '455ci Super Duty V8, 4 bbl (LS2)','{"displacement_cid":455,"cylinders":8,"carb":"4 bbl","net_hp":"310@4000","rpo":"LS2","model_scope":"Firebird"}'::jsonb)
) AS x(code, val, detail)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW public.v_vin_position_decode
WITH (security_invoker = true) AS
SELECT v.id AS vehicle_id, v.vin, r.position_from, r.position_to, r.code,
       r.meaning_key, r.meaning_value, r.detail, r.source_url, r.source_read_on, r.id AS rule_id
FROM public.vehicles v
JOIN public.vin_position_rules r
  ON lower(r.make) = lower(v.make)
 AND v.year BETWEEN r.year_from AND r.year_to
 AND upper(substr(v.vin, r.position_from, r.position_to - r.position_from + 1)) = r.code
 AND (r.detail->>'model_scope' IS NULL OR v.model ILIKE '%' || (r.detail->>'model_scope') || '%')
WHERE v.vin IS NOT NULL AND length(v.vin) < 17;
COMMENT ON VIEW public.v_vin_position_decode IS
  'Pre-1981 VINs decoded by join to vin_position_rules: one row per matched position, carrying the rule and its source.';

-- 2. Production counts split by trim and engine -------------------------------------------
INSERT INTO public.vehicle_production_data
  (make, model, year, body_style, trim_level, engine_option, total_produced, rarity_reason,
   data_source, source_url, verified_by, verification_date)
SELECT 'Pontiac', 'Firebird', 1973, 'Coupe', x.trim, x.eng, x.n, x.note,
       'tran-zam.com 1973 Firebirds production tables',
       'https://tran-zam.com/fhistory/1973Home.aspx', 'source page read 2026-11-25', now()
FROM (VALUES
  ('Base',     'all engines',                     14096, 'scope: 1973 model year, base Firebird, all engines'),
  ('Base',     '250ci inline-six (VIN D)',         1370, 'scope: 1973 model year, base Firebird, six-cylinder'),
  ('Base',     'V8',                              12726, 'scope: 1973 model year, base Firebird, eight-cylinder'),
  ('Esprit',   'all engines',                     17249, 'scope: 1973 model year, Esprit; the page''s engine rows sum to 17,299, 50 over this total, as printed'),
  ('Esprit',   'L30 350ci 2 bbl',                 15550, 'scope: 1973 model year, Esprit, by engine'),
  ('Esprit',   'L65 400ci 2 bbl',                  1749, 'scope: 1973 model year, Esprit, by engine'),
  ('Formula',  'all engines',                     10166, 'scope: 1973 model year, Formula; the page''s engine rows sum to 10,168, 2 over this total, as printed'),
  ('Formula',  '350ci',                            4771, 'scope: 1973 model year, Formula, by engine'),
  ('Formula',  '400ci',                            4622, 'scope: 1973 model year, Formula, by engine'),
  ('Formula',  'L75 455ci',                         730, 'scope: 1973 model year, Formula, by engine'),
  ('Formula',  'LS2 455ci Super Duty',               43, 'scope: 1973 model year, Formula, by engine; 33 automatic and 10 manual, marked approximate on the page'),
  ('Trans Am', 'all engines',                      4802, 'scope: 1973 model year, Trans Am; 1,492 manual and 3,310 automatic'),
  ('Trans Am', 'L75 455ci',                        4550, 'scope: 1973 model year, Trans Am, by engine; 1,420 manual and 3,130 automatic'),
  ('Trans Am', 'LS2 455ci Super Duty',              252, 'scope: 1973 model year, Trans Am, by engine; 72 manual and 180 automatic')
) AS x(trim, eng, n, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.vehicle_production_data p
  WHERE p.make = 'Pontiac' AND p.model = 'Firebird' AND p.year = 1973
    AND p.body_style = 'Coupe' AND p.trim_level = x.trim AND p.engine_option = x.eng);

-- 3. A keyed region inside a photo --------------------------------------------------------
-- No foreign key to vehicle_images on purpose: adding one takes a lock on that table while
-- live writers hold it. image_id is checked by the writer.
CREATE TABLE IF NOT EXISTS public.image_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL,
  observation_id uuid,
  component_key text,
  label text NOT NULL,
  x numeric NOT NULL CHECK (x >= 0 AND x <= 1),
  y numeric NOT NULL CHECK (y >= 0 AND y <= 1),
  w numeric NOT NULL CHECK (w > 0 AND w <= 1),
  h numeric NOT NULL CHECK (h > 0 AND h <= 1),
  method text NOT NULL CHECK (method IN ('hand_placed','text_recognition','reader','subject_mask')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (x + w <= 1.0001 AND y + h <= 1.0001)
);
COMMENT ON TABLE public.image_regions IS
  'Where in a photo a reading or component sits: box as fractions of the frame, the observation it belongs to, and how the box was made. hand_placed rows are for display only and are never a witness.';
CREATE INDEX IF NOT EXISTS image_regions_image_idx ON public.image_regions (image_id);
CREATE INDEX IF NOT EXISTS image_regions_observation_idx ON public.image_regions (observation_id) WHERE observation_id IS NOT NULL;
ALTER TABLE public.image_regions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.image_regions FROM anon, authenticated;
