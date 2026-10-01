-- C26 (docs/ledger/theory/data-machine-cases.md §10): give the schema the words the LX450 question needed.
--
-- WHY: answering "to what condition must this LX450 be brought" took about 220k agent tokens. The agents
-- invented a condition vocabulary in JSON (rubric lx450_condition_v0), because Postgres had none for text
-- claims. The discovery the extraction rule requires (docs/ledger/theory/veins/lx450_claim_catalog.md: 25 full
-- descriptions read from extraction_metadata, 29 claim types) found:
--   - every claim type fits an existing observation_kind;
--   - condition_taxonomy already names 14 of them;
--   - 16 have no home;
--   - nothing keys a text claim to a descriptor (only image tables do);
--   - canonical_models has the model (Lexus LX, Toyota Land Cruiser) but no J80 generation row.
--
-- MEASURED before (2026-10-01):
--   - condition_taxonomy: 202 rows (v1_2026_03 48, v2_2026_03 132, v_auto_20260308_2249 22), about 110 of them
--     fragments parsed from service manuals.
--   - vehicle_observations: no descriptor column. The 71 lx450_condition_v0 rows hold their descriptor as JSON
--     inside structured_data.
--   - canonical_models: 'LX' (nhtsa_model_id 2212) and 'Land Cruiser' (1951-, alias fzj80), generation NULL on both.
--     vehicles.series = 'FZJ80L' on 96 of about 190 LX450 rows.
--
-- CHANGE:
--   1. condition_taxonomy: 16 descriptors from the catalog, taxonomy_version 'c26_2026_10'. The junk keys are
--      not touched here; deprecating them is a separate step once their references are counted.
--   2. vehicle_observations.descriptor_id: nullable column plus a NOT VALID foreign key to condition_taxonomy.
--      Adding a nullable column without a default is a catalog-only change. NOT VALID skips the scan of about
--      10M rows; the column is new and empty, so there is nothing to validate.
--   3. canonical_models: J80 generation rows for Lexus LX (LX450, 1996-1997) and Toyota Land Cruiser (FJ80/FZJ80,
--      1991-1997), with the spellings found in vehicles.model as aliases.
--   Companion change in the same commit: ingest-observation accepts descriptor_key (resolved here, unknown keys
--   refused) and agent_inferred (confidence capped at 0.6).
--
-- EXPECTED after: 218 condition_taxonomy rows; vehicle_observations.descriptor_id present and empty; two J80 rows.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

INSERT INTO public.condition_taxonomy (canonical_key, domain, descriptor_type, display_label, severity_scale, taxonomy_version)
SELECT x.k, x.domain, x.t, x.label, x.scale, 'c26_2026_10'
FROM (VALUES
  ('exterior.accessories.aftermarket_bumper', 'exterior',   'state',     'Aftermarket Bumper',                'binary'),
  ('exterior.accessories.rock_sliders',       'exterior',   'state',     'Rock Sliders',                      'binary'),
  ('exterior.tires.aged',                     'exterior',   'adjective', 'Tires Aged (date codes, dry rot)',  '0_to_1'),
  ('interior.function.inoperative',           'interior',   'adjective', 'Interior Item Inoperative',         '0_to_1'),
  ('mechanical.intake.snorkel',               'mechanical', 'state',     'Intake Snorkel',                    'binary'),
  ('mechanical.engine.oil_seepage',           'mechanical', 'adjective', 'Engine Oil Seepage or Leak',        '0_to_1'),
  ('mechanical.drivetrain.axle_seal_leak',    'mechanical', 'adjective', 'Axle or Hub Seal Leak',             '0_to_1'),
  ('mechanical.drivetrain.lockers_front_rear','mechanical', 'state',     'Front and Rear Locking Differentials','binary'),
  ('mechanical.emissions.catalytic_converter_absent', 'mechanical', 'state', 'Catalytic Converter Absent',   'binary'),
  ('mechanical.emissions.egr_bypassed',       'mechanical', 'state',     'EGR Bypassed',                      'binary'),
  ('provenance.documentation.inspection_report', 'provenance', 'state',  'Inspection Report Present',         'binary'),
  ('provenance.odometer.discrepancy',         'provenance', 'state',     'Odometer Discrepancy on Record',    'binary'),
  ('provenance.title.salvage_rebuilt',        'provenance', 'state',     'Title Branded Salvage or Rebuilt',  'binary'),
  ('provenance.title.not_actual_mileage',     'provenance', 'state',     'Title Branded Not Actual Mileage',  'binary'),
  ('provenance.usage.dormant',                'provenance', 'state',     'Long Dormancy on Record',           'binary'),
  ('provenance.history.theft_recovered',      'provenance', 'state',     'Stolen and Recovered on Record',    'binary')
) AS x(k, domain, t, label, scale)
WHERE NOT EXISTS (SELECT 1 FROM public.condition_taxonomy c WHERE c.canonical_key = x.k);

ALTER TABLE public.vehicle_observations ADD COLUMN IF NOT EXISTS descriptor_id uuid;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_observations_descriptor_id_fkey') THEN
    ALTER TABLE public.vehicle_observations
      ADD CONSTRAINT vehicle_observations_descriptor_id_fkey
      FOREIGN KEY (descriptor_id) REFERENCES public.condition_taxonomy (descriptor_id) NOT VALID;
  END IF;
END
$do$;
COMMENT ON COLUMN public.vehicle_observations.descriptor_id IS
  'The condition_taxonomy descriptor this observation is a claim about (kind condition or provenance). Set by ingest-observation from descriptor_key; NULL for observations that are not descriptor claims. The quoted words are in citation_excerpt, the document in raw_source_ref. C26.';

INSERT INTO public.canonical_models (make, canonical_model, canonical_series, year_start, year_end, body_styles, aliases, generation, notes)
SELECT x.make, x.model, x.series, x.y0, x.y1, ARRAY['suv', '4x4'], x.aliases, 'J80', x.notes
FROM (VALUES
  ('Lexus', 'LX', 'LX450', 1996, 1997,
   ARRAY['lx450', 'lx 450', 'lx-450', 'lx lx 450', 'lx 450 vx limited', 'lx450 4x4', 'lx450 4×4', 'fzj80l'],
   'J80 generation (FZJ80L). VIN prefix JT6HJ88J. Generation row under model LX (nhtsa_model_id 2212). C26.'),
  ('Toyota', 'Land Cruiser', 'Land Cruiser 80', 1991, 1997,
   ARRAY['fj80', 'fzj80', 'land cruiser fzj80', 'land cruiser 80', '80 series land cruiser'],
   'J80 generation (FJ80 1991-1992, FZJ80 1993-1997). Generation row under model Land Cruiser. C26.')
) AS x(make, model, series, y0, y1, aliases, notes)
WHERE NOT EXISTS (SELECT 1 FROM public.canonical_models c
                  WHERE c.make = x.make AND c.canonical_model = x.model AND c.generation = 'J80');
