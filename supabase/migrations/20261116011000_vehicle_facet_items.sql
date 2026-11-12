-- Header facet items: every header token is a defined set of line items (docs/market/VEHICLE_HEADER_FORM_RULES.md,
-- "Facet items", 2026-11-11). The item list is the same for every vehicle; a vehicle differs only in which items its
-- testimony establishes. Missing items come back with the evidence that would establish them.
--
-- 1. vehicle_decode_rules: one cited rule table (gear ratios by transmission model, axle codes, engine codes, casting
--    numbers, body-tag codes, VIN chart positions), keyed by rule_key + make/model/code + year range + qualifiers.
--    Empty here; cited rows land later. Reference data, not testimony.
-- 2. observation_source_label(uuid): the public slug and display name of an observation source. observation_sources has
--    a SELECT policy for authenticated only, so an invoker reader could not name a listing source for a logged-out viewer.
-- 3. vehicle_facet_norm(kind, value): the comparison key two testimonies must share to agree (displacement in liters,
--    transmission type, drive layout, engine configuration, ratio, tire diameter, year, number, text).
-- 4. vehicle_facet_items(vehicle, dimension): STABLE security invoker, so every source is bounded by the viewer's own
--    row policies, plus the vehicle visibility test stated here. Dimension NULL returns every token's items as one object.
--    Photo readings keyed by a closed claim role (cowl tag, transmission ID stamp and castings, engine block and code
--    stamp) land on their items with their image as witness and their uncertain characters as a limitation.
--    Location reads the photo GPS fold's admitted rows (admit_photo_gps_locations, 20261116001000) with the same row
--    filter and read-time photo recount as get_field_provenance('location') (20261116003000), at area grain only.
-- 5. vehicle_profile_read: the masthead carries `token_items`, every token's items, read once. It is the single home
--    for items; strip facets are unchanged. Patched at anchors; refuses drift; skipped when already present.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';

-- 1. Cited rule table -------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_decode_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL CHECK (rule_key ~ '^[a-z][a-z0-9_]*$'),
  make text,
  model text,
  code text,
  year_min integer,
  year_max integer,
  qualifiers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(qualifiers) = 'object'),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  citation_url text NOT NULL CHECK (citation_url ~ '^https?://'),
  citation_title text,
  citation_locator text,
  cited_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES public.vehicle_decode_rules (id),
  superseded_at timestamptz,
  CHECK (year_min IS NULL OR year_max IS NULL OR year_min <= year_max),
  CHECK ((superseded_by IS NULL) = (superseded_at IS NULL))
);
CREATE INDEX IF NOT EXISTS vehicle_decode_rules_lookup
  ON public.vehicle_decode_rules (rule_key, upper(code)) WHERE superseded_at IS NULL;
-- One current row per rule, scope and citation: a second reading of the same table supersedes, never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_decode_rules_current_unique
  ON public.vehicle_decode_rules (rule_key, coalesce(make, ''), coalesce(model, ''), coalesce(code, ''),
    coalesce(year_min, 0), coalesce(year_max, 0), citation_url) WHERE superseded_at IS NULL;
ALTER TABLE public.vehicle_decode_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_decode_rules_public_read ON public.vehicle_decode_rules;
CREATE POLICY vehicle_decode_rules_public_read ON public.vehicle_decode_rules FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.vehicle_decode_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_decode_rules TO anon, authenticated;
GRANT ALL ON public.vehicle_decode_rules TO service_role;
COMMENT ON TABLE public.vehicle_decode_rules IS
  'Cited decode rules (grain: one rule row for one key, optionally narrowed by make, model, year range and qualifiers). '
  'rule_key names the table: transmission_gear_ratios (code = the bare model code as stamped or cast, e.g. M20, TH400, '
  'with no maker prefix; value.gears = numeric array first..top, value.reverse), axle_code (value.ratio, value.limited_slip), engine_code (code = VIN engine character, '
  'value.displacement_ci, value.family), block_casting, body_tag_code, vin_chart (code = decode rule key, '
  'value.positions = {field: "position"}). qualifiers narrows a row further (unit year, ratio-set name). Every row '
  'carries citation_url; a newer row supersedes an older one (superseded_by, superseded_at), never an update in place. '
  'Gear ratios are looked up by code only: when several current rows for the identified model disagree, the reader '
  'reports the candidates and computes nothing. Read by vehicle_facet_items. Created empty by 20261116011000.';

-- 2. Public source label ----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.observation_source_label(p_source_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT jsonb_build_object('slug', s.slug, 'label', coalesce(nullif(btrim(s.display_name), ''), s.slug))
  FROM public.observation_sources s WHERE s.id = p_source_id
$$;
COMMENT ON FUNCTION public.observation_source_label(uuid) IS
  'Slug and display name of one observation source, nothing else. Lets invoker readers name a source for a logged-out viewer.';
REVOKE ALL ON FUNCTION public.observation_source_label(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.observation_source_label(uuid) TO anon, authenticated, service_role;

-- 3. Comparison keys --------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vehicle_facet_norm(p_kind text, p_value text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN s IS NULL OR s = '' THEN NULL
    WHEN p_kind = 'text' THEN s
    WHEN p_kind = 'year' THEN substring(s FROM '(?:^|[^0-9])((?:18|19|20)[0-9]{2})(?:$|[^0-9])')
    WHEN p_kind = 'number' THEN to_char(round(substring(s FROM '([0-9]+(?:\.[0-9]+)?)')::numeric, 2), 'FM9999990.00')
    WHEN p_kind = 'displacement' THEN (
      SELECT to_char(round(l, 1), 'FM990.0')
      FROM (SELECT CASE
        WHEN s ~ '[0-9](\.[0-9]+)?\s*(l|liters?|litres?)\y'
          THEN substring(s FROM '([0-9]+(?:\.[0-9]+)?)\s*(?:l|liters?|litres?)\y')::numeric
        WHEN s ~ '[0-9]{3,4}\s*cc\y' THEN substring(s FROM '([0-9]{3,4})\s*cc\y')::numeric / 1000
        WHEN s ~ '(^|[^0-9.])[1-9][0-9]{2}($|[^0-9])'
          THEN substring(s FROM '(?:^|[^0-9.])([1-9][0-9]{2})(?:$|[^0-9])')::numeric * 0.016387064
        WHEN s ~ '^[0-9]{1,2}(\.[0-9]+)?$' THEN s::numeric
      END AS l) x
      WHERE l BETWEEN 0.3 AND 15)
    WHEN p_kind = 'transmission_type' THEN CASE
      WHEN s ~ '(\ycvt\y|continuously variable)' THEN 'cvt'
      WHEN s ~ '(auto|turbo.?hydra|\yth.?[0-9]{3}|powerglide|torqueflite|cruise.?o|\y[0-9]l[0-9]{2}e?\y|\ya/?t\y)' THEN 'automatic'
      WHEN s ~ '(manual|stick|[0-9].?speed|(three|four|five|six).?speed|muncie|saginaw|\yt.?10\y|borg|tremec|getrag|\ym/?t\y)' THEN 'manual'
      END
    WHEN p_kind = 'layout' THEN CASE
      WHEN s ~ '(4wd|4x4|four.?wheel)' THEN '4WD'
      WHEN s ~ '(awd|all.?wheel)' THEN 'AWD'
      WHEN s ~ '(fwd|front.?wheel)' THEN 'FWD'
      WHEN s ~ '(rwd|rear.?wheel)' THEN 'RWD'
      WHEN s ~ '(2wd|4x2|two.?wheel)' THEN '2WD'
      END
    WHEN p_kind = 'configuration' THEN CASE
      WHEN s ~ 'rotary' THEN 'rotary'
      WHEN s ~ '\yv.?(4|6|8|10|12|16)\y' THEN 'V' || substring(s FROM '\yv.?(4|6|8|10|12|16)\y')
      WHEN s ~ '\y(flat|h|boxer).?(4|6|12)\y' THEN 'H' || substring(s FROM '\y(?:flat|h|boxer).?(4|6|12)\y')
      WHEN s ~ '\y(i|l|inline|straight).?(3|4|5|6|8)\y' THEN 'I' || substring(s FROM '\y(?:i|l|inline|straight).?(3|4|5|6|8)\y')
      END
    WHEN p_kind = 'ratio' THEN to_char(round(substring(s FROM '([0-9]+\.[0-9]+)')::numeric, 2), 'FM990.00')
    WHEN p_kind = 'tire_diameter_in' THEN CASE
      WHEN s ~ '[0-9]{3}/[0-9]{2}\s*z?r?\s*-?\s*[0-9]{2}' THEN to_char(round(
        substring(s FROM '[0-9]{3}/[0-9]{2}\s*z?r?\s*-?\s*([0-9]{2})')::numeric
        + 2 * substring(s FROM '([0-9]{3})/[0-9]{2}')::numeric * substring(s FROM '[0-9]{3}/([0-9]{2})')::numeric / 100 / 25.4, 1), 'FM990.0')
      WHEN s ~ '^\s*[0-9]{2}(\.[0-9])?\s*x' THEN to_char(substring(s FROM '^\s*([0-9]{2}(?:\.[0-9])?)\s*x')::numeric, 'FM990.0')
      END
    END
  FROM (SELECT lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g'))) AS t(s)
$$;
COMMENT ON FUNCTION public.vehicle_facet_norm(text, text) IS
  'Comparison key for header facet testimony: two sources agree when their keys are equal. Kinds: text, year, number '
  '(2 decimals), displacement (liters, 1 decimal, from L/cc/ci text), transmission_type, layout, configuration, ratio, '
  'tire_diameter_in. NULL when the value does not state the quantity.';
REVOKE ALL ON FUNCTION public.vehicle_facet_norm(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_facet_norm(text, text) TO anon, authenticated, service_role;

-- 4. The reader -------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vehicle_facet_items(p_vehicle_id uuid, p_dimension text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'UTC'
AS $function$
-- facet_items_v1
WITH who AS (SELECT (SELECT auth.uid()) AS uid),
v AS MATERIALIZED (
  SELECT v.id, v.vin, v.year, v.make, v.model, v.trim, v.is_replica, v.listing_title,
         v.canonical_body_style, v.body_style, v.engine_type, v.engine_size, v.engine_code, v.cam_type, v.intake_type,
         v.carburetor_type, v.transmission, v.transmission_model, v.transmission_code, v.drivetrain, v.rear_axle_ratio,
         v.rear_axle_type, v.tire_spec_rear, v.bore_mm, v.stroke_mm, v.city, v.state,
         (who.uid IS NOT NULL AND (who.uid IN (v.user_id, v.owner_id, v.uploaded_by)
           OR public.vehicle_user_has_access(v.id, who.uid))) AS party
  FROM public.vehicles v CROSS JOIN who
  WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
    AND (v.is_public IS TRUE OR (who.uid IS NOT NULL AND (who.uid IN (v.user_id, v.owner_id, v.uploaded_by)
         OR public.vehicle_user_has_access(v.id, who.uid))))
),
-- The definition of every token: the same list for every vehicle.
defs (dim, ord, key, facet, unit, needed) AS (VALUES
  ('year', 0, 'year.decode', 'decode', NULL, 'VIN read from the VIN plate, decoded under a cited chart for this make and year'),
  ('year', 1, 'year.recorded', 'current', NULL, 'a dated source for the year: listing, title, registration or VIN decode'),
  ('year', 2, 'year.title', 'current', NULL, 'photo of the title or registration'),
  ('make', 0, 'make.decode', 'decode', NULL, 'VIN read from the VIN plate, decoded under a cited chart for this make and year'),
  ('make', 1, 'make.recorded', 'current', NULL, 'a dated source for the make: listing, title, registration or VIN decode'),
  ('make', 2, 'make.title', 'current', NULL, 'photo of the title or registration'),
  ('model', 0, 'model.decode', 'decode', NULL, 'VIN read from the VIN plate, decoded under a cited chart for this make and year'),
  ('model', 1, 'model.recorded', 'current', NULL, 'a dated source for the model: listing, title, registration or VIN decode'),
  ('model', 2, 'model.title', 'current', NULL, 'photo of the title or registration'),
  ('body_style', 0, 'body_style.decode', 'decode', NULL, 'VIN body code decoded under a cited chart, or the body tag'),
  ('body_style', 1, 'body_style.recorded', 'current', NULL, 'a dated source for the body style: listing, body tag or photos of the roofline'),
  ('body_style', 2, 'body_style.title', 'current', NULL, 'photo of the title or registration'),
  ('body_style', 3, 'body_style.body_tag', 'as_built', NULL, 'photo of the body (cowl) tag showing the style number'),
  ('body_style', 4, 'body_style.body_number', 'as_built', NULL, 'photo of the body (cowl) tag showing the body number'),
  ('body_style', 5, 'body_style.build_date', 'as_built', NULL, 'photo of the body (cowl) tag showing the build date code'),
  ('trim', 0, 'trim.recorded', 'current', NULL, 'a dated source for the trim: listing, badge photos or build documents'),
  ('trim', 1, 'trim.tribute', 'current', NULL, 'build documents (PHS, build sheet, body tag) establishing factory trim or tribute'),
  ('trim', 2, 'trim.decode', 'decode', NULL, 'VIN series code decoded under a cited chart, or the trim tag'),
  ('trim', 3, 'trim.as_built.interior', 'as_built', NULL, 'photo of the body (cowl) tag trim code, decoded under a cited trim-code table'),
  ('engine', 0, 'engine.as_built.engine', 'as_built', 'L', 'VIN engine code decoded under a cited chart, or the build sheet'),
  ('engine', 1, 'engine.current.family', 'current', NULL, 'photo of the engine showing its configuration, or a receipt'),
  ('engine', 2, 'engine.current.displacement', 'current', 'L', 'photo of the block casting or a machine-shop work order stating displacement'),
  ('engine', 3, 'engine.current.bore', 'current', 'mm', 'machine-shop work order or measurement stating the bore'),
  ('engine', 4, 'engine.current.stroke', 'current', 'mm', 'crankshaft casting or forging number, or a work order stating the stroke'),
  ('engine', 5, 'engine.derived.displacement_ci', 'derived', 'ci', 'the current bore, stroke and cylinder count'),
  ('engine', 6, 'engine.current.block_casting', 'current', NULL, 'photo of the block casting number'),
  ('engine', 7, 'engine.current.block_date', 'current', NULL, 'photo of the block casting date code'),
  ('engine', 8, 'engine.current.engine_code_stamp', 'current', NULL, 'photo of the engine code stamp on the block pad'),
  ('engine', 9, 'engine.current.heads', 'current', NULL, 'photo of the cylinder-head casting numbers, or a receipt'),
  ('engine', 10, 'engine.current.induction', 'current', NULL, 'photo of the carburetor or intake ID tag, or a receipt'),
  ('engine', 11, 'engine.current.cam', 'current', NULL, 'cam card or receipt naming the camshaft'),
  ('engine', 12, 'engine.current.machine_work', 'current', NULL, 'machine-shop work order lines keyed to this engine'),
  ('engine', 13, 'engine.derived.changed', 'derived', NULL, 'the as-built engine (VIN engine code or build sheet) and the current displacement'),
  ('transmission', 0, 'transmission.as_built.type', 'as_built', NULL, 'body tag or SPID option code, build sheet, or owner statement'),
  ('transmission', 1, 'transmission.as_built.model', 'as_built', NULL, 'body tag or SPID option code, build sheet, or owner statement'),
  ('transmission', 2, 'transmission.current.type', 'current', NULL, 'photo of the shifter or transmission, or a receipt'),
  ('transmission', 3, 'transmission.current.model', 'current', NULL, 'photo of the transmission ID stamp or case casting, or a receipt'),
  ('transmission', 4, 'transmission.current.id_stamp', 'current', NULL, 'photo of the transmission ID stamp'),
  ('transmission', 5, 'transmission.current.date_code', 'current', NULL, 'photo of the transmission date code'),
  ('transmission', 6, 'transmission.current.case_casting', 'current', NULL, 'photo of the transmission case casting number'),
  ('transmission', 7, 'transmission.current.tailhousing_casting', 'current', NULL, 'photo of the tail housing casting number'),
  ('transmission', 8, 'transmission.current.side_cover_casting', 'current', NULL, 'photo of the side cover casting number'),
  ('transmission', 9, 'transmission.current.bellhousing_casting', 'current', NULL, 'photo of the bellhousing casting number'),
  ('transmission', 10, 'transmission.current.shifter', 'current', NULL, 'photo of the shifter assembly, or a receipt'),
  ('transmission', 11, 'transmission.current.gear_ratios', 'decode', NULL, 'transmission model identified by its ID stamp, and a cited ratio table for that model'),
  ('transmission', 12, 'transmission.axle.as_built.ratio', 'as_built', NULL, 'axle code from the body tag or SPID, decoded under a cited axle-code table'),
  ('transmission', 13, 'transmission.axle.current.ratio', 'current', NULL, 'axle tag or ring-gear stamp photo, or a receipt stating the ratio'),
  ('transmission', 14, 'transmission.current.tire_size', 'current', NULL, 'photo of a rear tire sidewall'),
  ('transmission', 15, 'transmission.derived.final_drive', 'derived', NULL, 'gear ratios and the current axle ratio'),
  ('transmission', 16, 'transmission.derived.rpm_at_60', 'derived', 'rpm', 'top-gear ratio, the current axle ratio and the rear tire size'),
  ('transmission', 17, 'transmission.derived.changed', 'derived', NULL, 'the as-built transmission (build sheet, PHS billing history or invoice) and the current one'),
  ('drivetrain', 0, 'drivetrain.as_built.layout', 'as_built', NULL, 'VIN chart or build documents stating the factory drive layout'),
  ('drivetrain', 1, 'drivetrain.current.layout', 'current', NULL, 'photo of the underside showing driveshafts and axles'),
  ('drivetrain', 2, 'drivetrain.axle.current.type', 'current', NULL, 'axle tag or limited-slip ID, or a receipt'),
  ('location', 0, 'location.current.area', 'current', NULL, 'photos with camera GPS, or a dated listing location'),
  ('location', 1, 'location.sources.photo_gps', 'current', NULL, 'photos with camera GPS'),
  ('location', 2, 'location.sources.listing', 'current', NULL, 'a dated listing location'),
  ('location', 3, 'location.map', 'current', NULL, 'an established area at ZCTA grain')
),
-- Photo readings keyed by a closed claim role: (role, field read, item, comparison kind, decoded detail carried along).
-- A field the role does not state is skipped; the image's reader is the reader family.
roles (role, field, key, nk, detail) AS (VALUES
  ('nominal_engine_displacement', 'engine_size', 'engine.current.displacement', 'displacement', NULL::text[]),
  ('identified_transmission_housing', 'transmission', 'transmission.current.type', 'transmission_type', NULL),
  ('visible_drivetrain_layout', 'drivetrain', 'drivetrain.current.layout', 'layout', NULL),
  ('cowl_tag_style', 'fisher_style_number', 'body_style.body_tag', 'text', ARRAY['body_style', 'tag_model_year']),
  ('cowl_tag_transcription', 'fisher_style_number', 'body_style.body_tag', 'text', ARRAY['body_style']),
  ('cowl_tag_body_number', 'fisher_body_number', 'body_style.body_number', 'text', ARRAY['assembly_plant', 'assembly_plant_code']),
  ('cowl_tag_transcription', 'fisher_body_number', 'body_style.body_number', 'text', NULL),
  ('cowl_tag_build_date', 'body_build_date_code', 'body_style.build_date', 'text', ARRAY['body_build_month', 'body_build_week_of_month']),
  ('cowl_tag_transcription', 'body_build_date_code', 'body_style.build_date', 'text', NULL),
  ('cowl_tag_trim', 'interior_trim_code', 'trim.as_built.interior', 'text', ARRAY['seat_code', 'factory_interior']),
  ('cowl_tag_transcription', 'interior_trim_code', 'trim.as_built.interior', 'text', ARRAY['seat_code']),
  ('original_transmission_evidence', 'original_transmission', 'transmission.as_built.type', 'transmission_type', NULL),
  ('transmission_id_stamp', 'transmission_code', 'transmission.current.id_stamp', 'text', ARRAY['vin_derivative_present']),
  ('transmission_id_stamp', 'transmission_assembly_date', 'transmission.current.date_code', 'text', NULL),
  ('transmission_id_stamp', 'transmission', 'transmission.current.type', 'transmission_type', NULL),
  ('transmission_case_model', 'case_casting', 'transmission.current.case_casting', 'text', NULL),
  ('transmission_case_model', 'transmission_model', 'transmission.current.model', 'text', ARRAY['transmission_speeds', 'excluded_models']),
  ('transmission_case_model', 'transmission', 'transmission.current.type', 'transmission_type', NULL),
  ('transmission_tailhousing', 'transmission_tailhousing', 'transmission.current.tailhousing_casting', 'text',
    ARRAY['output_spline_count', 'speedometer_output_side']),
  ('transmission_tailhousing', 'transmission', 'transmission.current.type', 'transmission_type', NULL),
  ('transmission_side_cover', 'transmission_side_cover_casting', 'transmission.current.side_cover_casting', 'text', NULL),
  ('transmission_bellhousing', 'bellhousing_casting', 'transmission.current.bellhousing_casting', 'text',
    ARRAY['bellhousing_material', 'clutch_actuation']),
  ('transmission_shifter', 'shifter_bracket_marking', 'transmission.current.shifter', 'text', ARRAY['shifter_linkage']),
  ('engine_block_casting', 'engine_block_casting', 'engine.current.block_casting', 'text', ARRAY['block_casting_year']),
  ('engine_block_casting', 'engine_size', 'engine.current.displacement', 'displacement', NULL),
  ('engine_block_casting', 'engine_type', 'engine.current.family', 'configuration', NULL),
  ('engine_block_casting_dossier_fields', 'engine_block_casting', 'engine.current.block_casting', 'text', NULL),
  ('engine_block_casting_dossier_fields', 'engine_displacement_l', 'engine.current.displacement', 'displacement', NULL),
  ('engine_block_casting_dossier_fields', 'engine_configuration', 'engine.current.family', 'configuration', NULL),
  ('engine_code_stamp', 'engine_code', 'engine.current.engine_code_stamp', 'text',
    ARRAY['engine_code_application', 'engine_production_number_partial']),
  ('engine_code_stamp', 'engine_size', 'engine.current.displacement', 'displacement', NULL)
),
-- Observations in the viewer's row policies that can speak to a token.
obs AS MATERIALIZED (
  SELECT o.id, o.kind::text AS kind, o.extraction_method AS method, o.source_url, o.observed_at, o.structured_data AS sd,
         o.source_observation_id, o.property_id, o.source_id, o.structured_data->>'claim_role' AS role,
         coalesce(p.property_key, o.structured_data->>'property_key') AS pk,
         CASE WHEN o.structured_data->>'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (o.structured_data->>'image_id')::uuid END AS image_id
  FROM v JOIN public.vehicle_observations o ON o.vehicle_id = v.id
  LEFT JOIN public.observation_properties p ON p.id = o.property_id
  WHERE o.is_superseded IS NOT TRUE
    AND (o.property_id IS NOT NULL OR o.structured_data ? 'property_key'
         -- Only the claim roles this reader maps; other roled readings (photo-map harvest notes) are never scanned.
         OR o.structured_data->>'claim_role' IN (SELECT role FROM roles UNION ALL SELECT 'cowl_tag_option_codes')
         OR (o.extraction_method LIKE 'vin\_decode\_%' AND o.structured_data ? 'decode_rule'))
),
-- An image witness only when the viewer can see the image; else the observation itself.
obs_w AS MATERIALIZED (
  SELECT o.*, CASE WHEN o.image_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.vehicle_images i WHERE i.id = o.image_id)
                   THEN jsonb_build_object('kind', 'image', 'id', o.image_id)
                   ELSE jsonb_build_object('kind', 'observation', 'id', o.id) END AS witness,
         nullif(concat_ws('; ', nullif(btrim(o.sd->>'limitation'), ''),
           'uncertain characters: ' || nullif(btrim(o.sd->>'uncertain_characters'), '')), '') AS limitation
  FROM obs o
),
-- A VIN decode of the vehicle's current VIN.
decode AS (
  SELECT o.*, src.label AS src_label
  FROM obs o CROSS JOIN v
  LEFT JOIN LATERAL (SELECT public.observation_source_label(o.source_id) AS label) src ON true
  WHERE o.method LIKE 'vin\_decode\_%' AND o.sd ? 'decode_rule'
    AND upper(btrim(o.sd->>'vin')) = upper(btrim(v.vin))
),
-- Every testimony row: item key, raw value, comparison kind, class, source key (one per independent source),
-- reader family (independence of readers), clock and the source as returned.
t AS (
  -- VIN decode (registry decode): established when it decodes the current VIN.
  SELECT m.key, m.val, m.nk, 'decode'::text AS cls, 'decode:' || d.method AS indep, 'decode'::text AS family,
         d.observed_at, 0 AS pref,
         jsonb_build_object('slug', d.src_label->>'slug', 'label', coalesce(d.src_label->>'label', 'VIN decode'),
           'kind', 'registry', 'url', d.source_url, 'method', d.method, 'observed_at', d.observed_at,
           'witness', jsonb_build_object('kind', 'observation', 'id', d.id), 'value', m.val, 'class', 'decode') AS src,
         jsonb_build_object('key', d.sd->>'decode_rule', 'citation_url', d.source_url, 'vin', d.sd->>'vin',
           'code', m.code, 'position', (SELECT r.value->'positions'->>m.field FROM public.vehicle_decode_rules r
             WHERE r.rule_key = 'vin_chart' AND r.code = d.sd->>'decode_rule' AND r.superseded_at IS NULL
             ORDER BY r.created_at DESC LIMIT 1)) AS rule
  FROM decode d CROSS JOIN LATERAL (VALUES
    ('year.decode', d.sd->>'year', 'year', NULL, 'year'),
    ('year.recorded', d.sd->>'year', 'year', NULL, 'year'),
    ('make.decode', d.sd->>'make', 'text', NULL, 'make'),
    ('make.recorded', d.sd->>'make', 'text', NULL, 'make'),
    ('model.decode', d.sd->>'model', 'text', d.sd->>'series_code', 'model'),
    ('model.recorded', d.sd->>'model', 'text', d.sd->>'series_code', 'model'),
    ('body_style.decode', d.sd->>'body_style', 'text', NULL, 'body_style'),
    ('body_style.recorded', d.sd->>'body_style', 'text', NULL, 'body_style'),
    ('trim.decode', d.sd->>'series', 'text', d.sd->>'series_code', 'series'),
    ('engine.as_built.engine', d.sd->>'factory_engine', 'displacement', d.sd->>'factory_engine_code', 'engine')
  ) m(key, val, nk, code, field)
  WHERE nullif(btrim(m.val), '') IS NOT NULL
  UNION ALL
  -- Registry-keyed observations (observation_properties). A retained listing projection must still match its parent,
  -- and a record-title label must still quote the vehicle's title, as vehicle_profile_read requires.
  SELECT m.key, o.sd->>o.pk, m.nk,
         CASE WHEN o.image_id IS NOT NULL THEN 'reading' ELSE 'claim' END,
         CASE WHEN o.image_id IS NOT NULL THEN 'img:' || o.image_id
              ELSE 'src:' || coalesce(sl.label->>'slug', o.method) END,
         CASE WHEN o.image_id IS NOT NULL THEN 'reader:' || o.method
              ELSE 'src:' || coalesce(sl.label->>'slug', o.method) END,
         o.observed_at, 1,
         jsonb_build_object('slug', sl.label->>'slug',
           'label', coalesce(sl.label->>'label', substring(o.source_url FROM '^https?://(?:www\.)?([^/]+)'), o.method),
           'kind', CASE WHEN o.image_id IS NOT NULL THEN 'image' WHEN o.role = 'record_label' THEN 'record_label'
                        WHEN o.kind = 'listing' OR o.role = 'listing_claim' THEN 'listing' ELSE o.kind END,
           'url', CASE WHEN o.image_id IS NULL THEN o.source_url END, 'method', o.method, 'observed_at', o.observed_at,
           'witness', o.witness, 'value', o.sd->>o.pk,
           'class', CASE WHEN o.image_id IS NOT NULL THEN 'reading' ELSE 'claim' END),
         NULL::jsonb
  FROM obs_w o CROSS JOIN v
  JOIN (VALUES
    ('year', 'year.recorded', 'year'), ('make', 'make.recorded', 'text'), ('model', 'model.recorded', 'text'),
    ('body_style', 'body_style.recorded', 'text'), ('trim', 'trim.recorded', 'text'),
    ('transmission_type', 'transmission.current.type', 'transmission_type'),
    ('engine_displacement_l', 'engine.current.displacement', 'displacement'),
    ('engine_configuration', 'engine.current.family', 'configuration'),
    ('engine_code', 'engine.current.engine_code_stamp', 'text'),
    ('drivetrain_layout', 'drivetrain.current.layout', 'layout')
  ) m(pk, key, nk) ON m.pk = o.pk
  LEFT JOIN LATERAL (SELECT public.observation_source_label(o.source_id) AS label) sl ON true
  WHERE NOT (o.method LIKE 'vin\_decode\_%' AND o.sd ? 'decode_rule')
    AND nullif(btrim(o.sd->>o.pk), '') IS NOT NULL
    AND (o.method IS DISTINCT FROM 'retained_listing_property_projection_v1'
         OR public.retained_listing_property_result_matches(o.source_observation_id, o.property_id, o.id))
    AND (o.method IS DISTINCT FROM 'vehicle_title_facet_projection_v1' OR o.sd->>'source_value' = v.listing_title)
  UNION ALL
  -- Photo readings keyed by a closed claim role. Never the observation's stored URLs: only fields named here.
  SELECT m.key, o.sd->>m.field, m.nk,
         CASE WHEN o.image_id IS NOT NULL THEN 'reading' ELSE 'claim' END,
         coalesce('img:' || o.image_id, 'obs:' || o.id), 'reader:' || o.method, o.observed_at, 1,
         jsonb_build_object('slug', NULL, 'label', 'photo reading', 'kind', 'image', 'url', NULL, 'method', o.method,
           'observed_at', o.observed_at, 'witness', o.witness, 'value', o.sd->>m.field,
           'class', CASE WHEN o.image_id IS NOT NULL THEN 'reading' ELSE 'claim' END,
           'limitation', o.limitation,
           'decoded', (SELECT jsonb_object_agg(k, o.sd->k) FROM unnest(m.detail) k
                       WHERE o.sd ? k AND jsonb_typeof(o.sd->k) <> 'null')),
         NULL::jsonb
  FROM obs_w o JOIN roles m ON m.role = o.role
  WHERE o.pk IS NULL AND nullif(btrim(o.sd->>m.field), '') IS NOT NULL
  UNION ALL
  -- field_evidence. A row the observation writer mirrored from a visible decode is that decode, counted once;
  -- system_update rows echo the vehicle record; receipts speak only to the vehicle's own parties.
  SELECT CASE WHEN f.source_type ~* '(title|registration)' AND m.title_key IS NOT NULL THEN m.title_key ELSE m.key END,
         f.proposed_value, m.nk, c.cls,
         CASE c.cls WHEN 'decode' THEN 'decode:' || f.mirror_method WHEN 'reading' THEN 'img:' || f.image_id
                    WHEN 'receipt' THEN 'doc:' || f.id ELSE 'src:' || f.source_type END,
         CASE c.cls WHEN 'decode' THEN 'decode' WHEN 'reading' THEN 'reader:' || coalesce(f.extractor, f.source_type)
                    WHEN 'receipt' THEN 'doc:' || f.id ELSE 'src:' || f.source_type END,
         f.extracted_at, 2,
         jsonb_build_object('slug', f.source_type, 'label', replace(f.source_type, '_', ' '),
           'kind', public.vehicle_profile_source_kind(f.source_type), 'url', NULL,
           'method', coalesce(nullif(f.mirror_method, ''), f.source_type), 'observed_at', f.extracted_at,
           'witness', CASE WHEN c.cls = 'reading' AND EXISTS (SELECT 1 FROM public.vehicle_images i WHERE i.id = f.image_id)
                           THEN jsonb_build_object('kind', 'image', 'id', f.image_id)
                           ELSE jsonb_build_object('kind', 'field_evidence', 'id', f.id) END,
           'value', f.proposed_value, 'class', c.cls, 'review_status', f.status),
         NULL::jsonb
  FROM (
    SELECT fe.*, CASE WHEN fe.extraction_context LIKE '% via observation-writer%'
                      THEN split_part(fe.extraction_context, ' via ', 1) END AS mirror_method,
           CASE WHEN fe.raw_extraction_data->>'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (fe.raw_extraction_data->>'image_id')::uuid END AS image_id,
           fe.raw_extraction_data->>'extractor' AS extractor
    FROM v JOIN public.field_evidence fe ON fe.vehicle_id = v.id
    WHERE fe.status IN ('accepted', 'conflicted', 'pending') AND nullif(btrim(fe.proposed_value), '') IS NOT NULL
      AND coalesce(fe.source_type, '') <> 'system_update'
  ) f
  CROSS JOIN v
  JOIN (VALUES
    ('year', 'year.recorded', 'year.title', 'year'), ('make', 'make.recorded', 'make.title', 'text'),
    ('model', 'model.recorded', 'model.title', 'text'), ('body_style', 'body_style.recorded', 'body_style.title', 'text'),
    ('trim', 'trim.recorded', NULL, 'text'),
    ('factory_engine', 'engine.as_built.engine', NULL, 'displacement'),
    ('engine_type', 'engine.current.displacement', NULL, 'displacement'),
    ('engine_size', 'engine.current.displacement', NULL, 'displacement'),
    ('engine_type', 'engine.current.family', NULL, 'configuration'),
    ('engine_code', 'engine.current.engine_code_stamp', NULL, 'text'),
    ('transmission', 'transmission.current.type', NULL, 'transmission_type'),
    ('transmission_model', 'transmission.current.model', NULL, 'text'),
    ('rear_axle_ratio', 'transmission.axle.current.ratio', NULL, 'ratio'),
    ('drivetrain', 'drivetrain.current.layout', NULL, 'layout')
  ) m(field, key, title_key, nk) ON m.field = f.field_name
  CROSS JOIN LATERAL (SELECT CASE
    WHEN f.mirror_method LIKE 'vin\_decode\_%' THEN 'decode'
    WHEN f.source_type IN ('quickbooks', 'invoice', 'email_receipt', 'receipt') THEN 'receipt'
    WHEN f.image_id IS NOT NULL THEN 'reading'
    ELSE 'claim' END AS cls) c
  WHERE (c.cls <> 'decode' OR NOT EXISTS (SELECT 1 FROM decode d WHERE d.method = f.mirror_method))
    AND (c.cls <> 'decode' OR m.key IN ('year.recorded', 'make.recorded', 'model.recorded', 'body_style.recorded', 'engine.as_built.engine'))
    AND (c.cls <> 'receipt' OR v.party)
    AND (m.key <> 'engine.as_built.engine' OR c.cls = 'decode')
  UNION ALL
  -- vehicle_field_evidence (row policies keep it to the vehicle's uploader).
  SELECT m.key, e.value_text, m.nk, 'claim', 'src:' || coalesce(e.source_type, e.extraction_method),
         'src:' || coalesce(e.source_type, e.extraction_method), e.extracted_at, 2,
         jsonb_build_object('slug', e.source_type, 'label', replace(coalesce(e.source_type, e.extraction_method), '_', ' '),
           'kind', public.vehicle_profile_source_kind(e.source_type), 'url', NULL, 'method', e.extraction_method,
           'observed_at', e.extracted_at, 'witness', jsonb_build_object('kind', 'vehicle_field_evidence', 'id', e.id),
           'value', e.value_text, 'class', 'claim'),
         NULL::jsonb
  FROM v JOIN public.vehicle_field_evidence e ON e.vehicle_id = v.id
  JOIN (VALUES
    ('year', 'year.recorded', 'year'), ('make', 'make.recorded', 'text'), ('model', 'model.recorded', 'text'),
    ('body_style', 'body_style.recorded', 'text'), ('trim', 'trim.recorded', 'text'),
    ('engine_type', 'engine.current.displacement', 'displacement'), ('engine_size', 'engine.current.displacement', 'displacement'),
    ('transmission', 'transmission.current.type', 'transmission_type'), ('drivetrain', 'drivetrain.current.layout', 'layout')
  ) m(field, key, nk) ON m.field = e.field_name
  WHERE e.flagged_as_incorrect IS NOT TRUE AND nullif(btrim(e.value_text), '') IS NOT NULL
  UNION ALL
  -- The vehicle record: what the record holds, attributed to nothing until a source agrees with it.
  SELECT m.key, m.val, m.nk, 'record', 'record', 'record', NULL::timestamptz, 3,
         jsonb_build_object('slug', NULL, 'label', 'vehicle record', 'kind', 'record', 'url', NULL,
           'method', 'vehicles.' || m.col, 'observed_at', NULL, 'witness', NULL, 'value', m.val, 'class', 'record'),
         NULL::jsonb
  FROM v CROSS JOIN LATERAL (VALUES
    ('year.recorded', v.year::text, 'year', 'year'), ('make.recorded', v.make, 'text', 'make'),
    ('model.recorded', v.model, 'text', 'model'),
    ('body_style.recorded', coalesce(nullif(btrim(v.canonical_body_style), ''), v.body_style), 'text',
      CASE WHEN nullif(btrim(v.canonical_body_style), '') IS NOT NULL THEN 'canonical_body_style' ELSE 'body_style' END),
    ('trim.recorded', v.trim, 'text', 'trim'),
    ('engine.current.displacement', coalesce(nullif(btrim(v.engine_size), ''), v.engine_type), 'displacement',
      CASE WHEN nullif(btrim(v.engine_size), '') IS NOT NULL THEN 'engine_size' ELSE 'engine_type' END),
    ('engine.current.family', concat_ws(' ', v.engine_type, v.engine_size), 'configuration', 'engine_type'),
    ('engine.current.bore', v.bore_mm::text, 'number', 'bore_mm'),
    ('engine.current.stroke', v.stroke_mm::text, 'number', 'stroke_mm'),
    ('engine.current.engine_code_stamp', v.engine_code, 'text', 'engine_code'),
    ('engine.current.cam', v.cam_type, 'text', 'cam_type'),
    ('engine.current.induction', coalesce(nullif(btrim(v.carburetor_type), ''), v.intake_type), 'text',
      CASE WHEN nullif(btrim(v.carburetor_type), '') IS NOT NULL THEN 'carburetor_type' ELSE 'intake_type' END),
    ('transmission.current.type', v.transmission, 'transmission_type', 'transmission'),
    ('transmission.current.model', coalesce(nullif(btrim(v.transmission_model), ''), v.transmission_code), 'text',
      CASE WHEN nullif(btrim(v.transmission_model), '') IS NOT NULL THEN 'transmission_model' ELSE 'transmission_code' END),
    ('transmission.axle.current.ratio', v.rear_axle_ratio::text, 'ratio', 'rear_axle_ratio'),
    ('transmission.current.tire_size', v.tire_spec_rear, 'text', 'tire_spec_rear'),
    ('drivetrain.current.layout', v.drivetrain, 'layout', 'drivetrain'),
    ('drivetrain.axle.current.type', v.rear_axle_type, 'text', 'rear_axle_type')
  ) m(key, val, nk, col)
  WHERE nullif(btrim(m.val), '') IS NOT NULL
),
-- One row per (item, independent source, stated value): the observation-writer mirror and its observation count once.
td AS (
  SELECT DISTINCT ON (key, indep, norm) *
  FROM (SELECT t.*, public.vehicle_facet_norm(t.nk, t.val) AS norm FROM t) x
  WHERE norm IS NOT NULL
  -- Ties (two roles read off one photo at one clock) keep the row that carries decoded detail, then a fixed order.
  ORDER BY key, indep, norm, pref, observed_at DESC NULLS LAST,
           coalesce(src->'decoded', 'null'::jsonb) <> 'null'::jsonb DESC, src::text
),
ranked AS (
  SELECT td.*, CASE cls WHEN 'decode' THEN 0 WHEN 'receipt' THEN 1 WHEN 'reading' THEN 2 WHEN 'claim' THEN 3 ELSE 4 END AS crank
  FROM td
),
sides AS (
  SELECT key, norm, min(crank) AS best,
         (array_agg(val ORDER BY crank, observed_at DESC NULLS LAST))[1] AS val,
         jsonb_agg(src ORDER BY crank, observed_at DESC NULLS LAST) AS sources
  FROM ranked GROUP BY key, norm
),
agg AS (
  SELECT r.key,
         count(DISTINCT r.norm) AS nvals,
         bool_or(r.cls IN ('decode', 'receipt')) AS strong,
         count(DISTINCT r.indep) FILTER (WHERE r.cls <> 'record') AS nind,
         count(DISTINCT r.family) FILTER (WHERE r.cls <> 'record') AS nfam,
         bool_or(r.cls = 'reading') AS has_reading,
         (array_agg(r.nk ORDER BY r.crank, r.observed_at DESC NULLS LAST))[1] AS lead_nk,
         (array_agg(r.val ORDER BY r.crank, r.observed_at DESC NULLS LAST))[1] AS lead_val,
         (array_agg(r.norm ORDER BY r.crank, r.observed_at DESC NULLS LAST))[1] AS lead_norm,
         (array_agg(r.rule ORDER BY r.crank, r.observed_at DESC NULLS LAST) FILTER (WHERE r.rule IS NOT NULL))[1] AS rule,
         jsonb_agg(r.src ORDER BY r.crank, r.observed_at DESC NULLS LAST) AS sources
  FROM ranked r GROUP BY r.key
),
-- Readings that looked for an as-built fact and found it not stated: shown as examined, with the proof they name.
examined AS (
  SELECT k.key,
         jsonb_agg(DISTINCT jsonb_build_object('label', 'photo reading', 'kind', 'image', 'method', o.method,
           'observed_at', o.observed_at, 'witness', o.witness,
           'result', coalesce('transmission on tag: ' || (o.sd->>'transmission_on_tag'),
                              'original transmission: ' || (o.sd->>'original_transmission')))) AS checked,
         string_agg(DISTINCT p.need, '; ' ORDER BY p.need) AS needed
  FROM obs_w o
  CROSS JOIN (VALUES ('transmission.as_built.type'), ('transmission.as_built.model')) k(key)
  LEFT JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.sd->'proof_needed') = 'array'
    THEN o.sd->'proof_needed' END) p(need) ON true
  WHERE (o.role = 'original_transmission_evidence'
         AND public.vehicle_facet_norm('transmission_type', o.sd->>'original_transmission') IS NULL)
     OR (o.role = 'cowl_tag_option_codes' AND nullif(btrim(o.sd->>'transmission_on_tag'), '') IS NOT NULL)
  GROUP BY k.key
),
base AS (
  SELECT d.dim, d.ord, d.key, d.facet, d.unit, coalesce(ex.needed, d.needed) AS needed, ex.checked,
         a.lead_val, a.lead_norm, a.lead_nk, a.rule, a.sources,
         CASE WHEN a.key IS NULL THEN 'missing'
              WHEN a.nvals > 1 THEN 'conflict'
              WHEN a.strong THEN 'established'
              WHEN a.nind >= 2 AND a.nfam >= 2 THEN 'established'
              WHEN a.has_reading THEN 'reading'
              ELSE 'claim' END AS status,
         CASE WHEN a.nvals > 1 THEN (SELECT jsonb_agg(jsonb_build_object('value', s.val, 'normalized', s.norm,
                'sources', s.sources) ORDER BY s.best, s.norm) FROM sides s WHERE s.key = d.key) END AS conflict_sides
  FROM defs d LEFT JOIN agg a ON a.key = d.key LEFT JOIN examined ex ON ex.key = d.key
  WHERE d.dim <> 'location' AND d.facet <> 'derived'
    AND d.key NOT IN ('transmission.current.gear_ratios', 'trim.tribute')
),
item AS (
  SELECT key, jsonb_build_object(
    'key', key, 'facet', facet,
    -- A quantity with a unit is shown in that unit; the stated words stay on each source and in `stated`.
    'value', CASE WHEN lead_nk IN ('displacement', 'number') THEN lead_norm ELSE lead_val END,
    'stated', CASE WHEN lead_nk IN ('displacement', 'number') THEN lead_val END,
    'normalized', lead_norm, 'unit', unit, 'status', status,
    'sources', coalesce(sources, '[]'::jsonb), 'rule', rule, 'equation', NULL,
    'needed', CASE WHEN status <> 'established' THEN needed END)
    || CASE WHEN conflict_sides IS NOT NULL THEN jsonb_build_object('sides', conflict_sides) ELSE '{}'::jsonb END
    || CASE WHEN checked IS NOT NULL AND status = 'missing' THEN jsonb_build_object('examined', checked) ELSE '{}'::jsonb END
    AS doc,
    status, lead_norm
  FROM base
),
-- Ratios for the identified transmission model, from the cited rule table, by code only (no year filter). A model
-- reading that names several codes ("M20 or M21") matches each; candidates that disagree are shown, never computed over.
gear_cand AS (
  SELECT r.id, r.code, r.value->'gears' AS gears, r.citation_url, r.citation_title, r.qualifiers, i.status
  FROM item i JOIN public.vehicle_decode_rules r ON r.rule_key = 'transmission_gear_ratios' AND r.superseded_at IS NULL
    AND jsonb_typeof(r.value->'gears') = 'array' AND nullif(btrim(r.code), '') IS NOT NULL
    AND (upper(regexp_replace(r.code, '\s+', '', 'g')) = upper(regexp_replace(i.doc->>'value', '\s+', '', 'g'))
         OR i.doc->>'value' ~* ('(^|[^A-Za-z0-9])' || regexp_replace(btrim(r.code), '([^A-Za-z0-9])', '\\\1', 'g')
                                || '($|[^A-Za-z0-9])'))
  WHERE i.key = 'transmission.current.model' AND i.status NOT IN ('missing', 'conflict')
),
gear_sum AS (
  SELECT count(DISTINCT gears) AS nsets, (array_agg(gears))[1] AS gears, min(status) AS status,
         jsonb_agg(jsonb_build_object('code', code, 'gears', gears, 'rule_id', id, 'citation_url', citation_url,
           'citation_title', citation_title, 'qualifiers', qualifiers) ORDER BY code, id) AS rules
  FROM gear_cand
),
gear_item AS (
  SELECT jsonb_build_object('key', 'transmission.current.gear_ratios', 'facet', 'decode',
    'value', CASE WHEN g.nsets = 1 THEN g.gears END, 'normalized', NULL, 'unit', NULL,
    'status', CASE WHEN g.nsets = 1 THEN g.status ELSE 'missing' END,
    'sources', '[]'::jsonb,
    'rule', CASE WHEN g.nsets = 1 THEN jsonb_build_object('key', 'transmission_gear_ratios',
      'applies_to', 'transmission.current.model', 'rows', g.rules) END,
    'equation', NULL,
    'needed', CASE WHEN g.nsets > 1 THEN 'unit year or ratio-set identification'
                   WHEN g.nsets = 1 AND g.status = 'established' THEN NULL
                   ELSE 'transmission model identified by its ID stamp, and a cited ratio table for that model' END)
    || CASE WHEN g.nsets > 1 THEN jsonb_build_object('candidates', g.rules) ELSE '{}'::jsonb END AS doc,
    CASE WHEN g.nsets = 1 THEN g.gears END AS gears,
    CASE WHEN g.nsets = 1 THEN g.status ELSE 'missing' END AS status
  FROM gear_sum g
),
-- Readers that state a unit is not the one the car was built with (engine block date, transmission case vintage).
not_original AS (
  SELECT CASE WHEN o.role LIKE 'engine%' THEN 'engine' ELSE 'transmission' END AS tok,
         jsonb_agg(jsonb_build_object('slug', NULL, 'label', 'photo reading', 'kind', 'image', 'url', NULL,
           'method', o.method, 'observed_at', o.observed_at, 'witness', o.witness,
           'value', o.sd->>'factory_configuration_status', 'class', 'reading', 'limitation', o.limitation)
           ORDER BY o.observed_at DESC, o.id) AS sources,
         count(DISTINCT o.image_id) AS images
  FROM (
    -- One witness per photo, however many roles read it.
    SELECT DISTINCT ON (CASE WHEN x.role LIKE 'engine%' THEN 'engine' ELSE 'transmission' END, x.image_id) x.*
    FROM obs_w x
    WHERE x.image_id IS NOT NULL AND (x.role LIKE 'engine%' OR x.role LIKE 'transmission%')
      AND x.sd->>'factory_configuration_status' IN ('not_original_engine', 'not_original_unit', 'not_original')
    ORDER BY CASE WHEN x.role LIKE 'engine%' THEN 'engine' ELSE 'transmission' END, x.image_id, x.observed_at DESC, x.id
  ) o
  GROUP BY 1
),
-- Derived numbers: computed here from the items they read, never landed.
deriv_in AS (
  SELECT (SELECT gears FROM gear_item) AS gears, (SELECT status FROM gear_item) AS gear_status,
         (SELECT lead_norm FROM item WHERE key = 'transmission.axle.current.ratio' AND status <> 'conflict')::numeric AS axle,
         (SELECT status FROM item WHERE key = 'transmission.axle.current.ratio') AS axle_status,
         public.vehicle_facet_norm('tire_diameter_in',
           (SELECT doc->>'value' FROM item WHERE key = 'transmission.current.tire_size' AND status <> 'conflict'))::numeric AS tire_in,
         (SELECT status FROM item WHERE key = 'transmission.current.tire_size') AS tire_status,
         (SELECT lead_norm FROM item WHERE key = 'engine.as_built.engine' AND status <> 'conflict') AS built_l,
         (SELECT status FROM item WHERE key = 'engine.as_built.engine') AS built_status,
         (SELECT lead_norm FROM item WHERE key = 'engine.current.displacement' AND status <> 'conflict') AS cur_l,
         (SELECT status FROM item WHERE key = 'engine.current.displacement') AS cur_status,
         (SELECT lead_norm FROM item WHERE key = 'engine.current.bore' AND status <> 'conflict')::numeric AS bore,
         (SELECT status FROM item WHERE key = 'engine.current.bore') AS bore_status,
         (SELECT lead_norm FROM item WHERE key = 'engine.current.stroke' AND status <> 'conflict')::numeric AS stroke,
         (SELECT status FROM item WHERE key = 'engine.current.stroke') AS stroke_status,
         (SELECT substring(lead_norm FROM '[0-9]+')::int FROM item
           WHERE key = 'engine.current.family' AND status <> 'conflict' AND lead_norm ~ '^[VHI][0-9]+$') AS cyl,
         (SELECT status FROM item WHERE key = 'engine.current.family') AS cyl_status,
         (SELECT lead_norm FROM item WHERE key = 'transmission.as_built.type' AND status <> 'conflict') AS tb_type,
         (SELECT status FROM item WHERE key = 'transmission.as_built.type') AS tb_type_status,
         (SELECT lead_norm FROM item WHERE key = 'transmission.current.type' AND status <> 'conflict') AS tc_type,
         (SELECT status FROM item WHERE key = 'transmission.current.type') AS tc_type_status,
         (SELECT sources FROM not_original WHERE tok = 'engine') AS eng_flags,
         (SELECT sources FROM not_original WHERE tok = 'transmission') AS trans_flags
),
-- The weakest input status: missing when any input is missing or in conflict.
weakest AS (
  SELECT x.*, s.* FROM deriv_in x CROSS JOIN LATERAL (SELECT
    (SELECT CASE WHEN bool_or(st IN ('missing', 'conflict')) OR x.gears IS NULL OR x.axle IS NULL THEN 'missing'
                 WHEN bool_and(st = 'established') THEN 'established' WHEN bool_or(st = 'claim') THEN 'claim' ELSE 'reading' END
       FROM unnest(ARRAY[x.gear_status, x.axle_status]) st) AS final_status,
    (SELECT CASE WHEN bool_or(st IN ('missing', 'conflict')) OR x.gears IS NULL OR x.axle IS NULL OR x.tire_in IS NULL THEN 'missing'
                 WHEN bool_and(st = 'established') THEN 'established' WHEN bool_or(st = 'claim') THEN 'claim' ELSE 'reading' END
       FROM unnest(ARRAY[x.gear_status, x.axle_status, x.tire_status]) st) AS rpm_status,
    (SELECT CASE WHEN bool_or(st IN ('missing', 'conflict')) OR x.built_l IS NULL OR x.cur_l IS NULL THEN 'missing'
                 WHEN bool_and(st = 'established') THEN 'established' WHEN bool_or(st = 'claim') THEN 'claim' ELSE 'reading' END
       FROM unnest(ARRAY[x.built_status, x.cur_status]) st) AS eng_cmp_status,
    (SELECT CASE WHEN bool_or(st IN ('missing', 'conflict')) OR x.tb_type IS NULL OR x.tc_type IS NULL THEN 'missing'
                 WHEN bool_and(st = 'established') THEN 'established' WHEN bool_or(st = 'claim') THEN 'claim' ELSE 'reading' END
       FROM unnest(ARRAY[x.tb_type_status, x.tc_type_status]) st) AS trans_cmp_status,
    (SELECT CASE WHEN bool_or(st IN ('missing', 'conflict')) OR x.bore IS NULL OR x.stroke IS NULL OR x.cyl IS NULL THEN 'missing'
                 WHEN bool_and(st = 'established') THEN 'established' WHEN bool_or(st = 'claim') THEN 'claim' ELSE 'reading' END
       FROM unnest(ARRAY[x.bore_status, x.stroke_status, x.cyl_status]) st) AS ci_status) s
),
-- A change: the as-built and current items compared when both are known; otherwise readers stating the unit is not
-- original are a reading of a change. A comparison that disagrees with those readers is a conflict.
changed AS (
  SELECT w.*,
    CASE WHEN w.eng_cmp_status <> 'missing' THEN
           CASE WHEN w.eng_flags IS NOT NULL AND w.built_l = w.cur_l THEN 'conflict' ELSE w.eng_cmp_status END
         WHEN w.eng_flags IS NOT NULL THEN 'reading' ELSE 'missing' END AS eng_status,
    CASE WHEN w.eng_cmp_status <> 'missing' THEN w.built_l IS DISTINCT FROM w.cur_l
         WHEN w.eng_flags IS NOT NULL THEN true END AS eng_value,
    CASE WHEN w.trans_cmp_status <> 'missing' THEN
           CASE WHEN w.trans_flags IS NOT NULL AND w.tb_type = w.tc_type THEN 'reading' ELSE w.trans_cmp_status END
         WHEN w.trans_flags IS NOT NULL THEN 'reading' ELSE 'missing' END AS trans_status,
    CASE WHEN w.trans_cmp_status <> 'missing' AND w.tb_type IS DISTINCT FROM w.tc_type THEN true
         WHEN w.trans_flags IS NOT NULL THEN true
         WHEN w.trans_cmp_status <> 'missing' THEN false END AS trans_value
  FROM weakest w
),
derived AS (
  SELECT 'transmission.derived.final_drive' AS key, jsonb_build_object('facet', 'derived',
    'value', CASE WHEN w.final_status <> 'missing' THEN (SELECT jsonb_agg(round(g::numeric * w.axle, 2) ORDER BY n)
      FROM jsonb_array_elements_text(w.gears) WITH ORDINALITY e(g, n)) END,
    'normalized', NULL, 'status', w.final_status, 'sources', '[]'::jsonb, 'rule', NULL,
    'equation', jsonb_build_object('expression', 'gear_ratio[n] * axle_ratio',
      'reads', jsonb_build_array('transmission.current.gear_ratios', 'transmission.axle.current.ratio'))) AS doc
  FROM changed w
  UNION ALL
  SELECT 'transmission.derived.rpm_at_60', jsonb_build_object('facet', 'derived',
    'value', CASE WHEN w.rpm_status <> 'missing' THEN round(60 * (w.gears->>(jsonb_array_length(w.gears) - 1))::numeric
      * w.axle * 336.13 / w.tire_in) END,
    'normalized', NULL, 'status', w.rpm_status, 'sources', '[]'::jsonb, 'rule', NULL,
    'equation', jsonb_build_object('expression', 'mph * top_gear_ratio * axle_ratio * 336.13 / tire_diameter_in, mph = 60',
      'reads', jsonb_build_array('transmission.current.gear_ratios', 'transmission.axle.current.ratio',
        'transmission.current.tire_size'), 'tire_diameter_in', w.tire_in))
  FROM changed w
  UNION ALL
  SELECT 'engine.derived.displacement_ci', jsonb_build_object('facet', 'derived',
    'value', CASE WHEN w.ci_status <> 'missing' THEN round(pi()::numeric / 4 * w.bore ^ 2 * w.stroke * w.cyl / 16387.064, 1) END,
    'normalized', NULL, 'status', w.ci_status, 'sources', '[]'::jsonb, 'rule', NULL,
    'equation', jsonb_build_object('expression', 'pi / 4 * bore_mm^2 * stroke_mm * cylinders / 16387.064',
      'reads', jsonb_build_array('engine.current.bore', 'engine.current.stroke', 'engine.current.family'),
      'cylinders', w.cyl))
  FROM changed w
  UNION ALL
  SELECT 'engine.derived.changed', jsonb_build_object('facet', 'derived',
    'value', w.eng_value, 'normalized', NULL, 'status', w.eng_status, 'sources', coalesce(w.eng_flags, '[]'::jsonb),
    'rule', NULL,
    'equation', jsonb_build_object('expression', 'as_built.engine liters <> current.displacement liters (1 decimal)',
      'reads', jsonb_build_array('engine.as_built.engine', 'engine.current.displacement'),
      'as_built_l', w.built_l, 'current_l', w.cur_l))
  FROM changed w
  UNION ALL
  SELECT 'transmission.derived.changed', jsonb_build_object('facet', 'derived',
    'value', w.trans_value, 'normalized', NULL, 'status', w.trans_status, 'sources', coalesce(w.trans_flags, '[]'::jsonb),
    'rule', NULL,
    'equation', jsonb_build_object('expression', 'as_built.type <> current.type, or readers stating the unit is not original',
      'reads', jsonb_build_array('transmission.as_built.type', 'transmission.current.type'),
      'as_built', w.tb_type, 'current', w.tc_type))
  FROM changed w
  UNION ALL
  SELECT 'transmission.current.gear_ratios', doc - 'key' FROM gear_item
  UNION ALL
  -- tribute_badge_rule_v1: a tribute (vehicles.is_replica) earns no factory series or trim badge.
  SELECT 'trim.tribute', jsonb_build_object('facet', 'current',
    'value', CASE WHEN v.is_replica THEN 'tribute' END, 'normalized', NULL,
    'status', CASE WHEN v.is_replica THEN 'claim' ELSE 'missing' END,
    'sources', CASE WHEN v.is_replica THEN jsonb_build_array(jsonb_build_object('slug', NULL, 'label', 'vehicle record',
      'kind', 'record', 'url', NULL, 'method', 'vehicles.is_replica', 'observed_at', NULL, 'witness', NULL,
      'value', 'true', 'class', 'record')) ELSE '[]'::jsonb END,
    'rule', jsonb_build_object('key', 'tribute_badge_rule_v1', 'citation_url', NULL,
      'migration', '20261110090000_tribute_badges_and_engine_correction.sql',
      'effect', 'a tribute earns no factory series or trim badge'),
    'equation', NULL)
  FROM v
),
derived_items AS (
  SELECT x.key, jsonb_build_object('key', x.key, 'unit', f.unit) || x.doc
    || jsonb_build_object('needed', CASE WHEN x.doc ? 'needed' THEN x.doc->'needed'
         WHEN x.doc->>'status' <> 'established' THEN to_jsonb(f.needed) END) AS doc
  FROM derived x JOIN defs f ON f.key = x.key
),
-- Location at public area grain only. Photo GPS is the fold's admitted rows (source_type exif, photo_gps_fold_v1,
-- confidence >= 0.5) recounted from the photos the viewer can still see, as get_field_provenance('location') does;
-- never a coordinate, a raw text or a photo. Listings are dated listing rows at area grain.
loc_rows AS MATERIALIZED (
  SELECT l.id, l.observed_at, l.confidence, l."precision" AS level, l.city, l.county_fips, l.county_name, l.region_code,
         l.country_code, l.zcta, l.location_text_clean AS label, l.metadata->'image_ids' AS image_ids
  FROM v JOIN public.vehicle_location_observations l ON l.vehicle_id = v.id
  WHERE l.source_type = 'exif' AND l.metadata->>'method' = 'photo_gps_fold_v1' AND l.confidence >= 0.5
  ORDER BY l.observed_at DESC, l.id
  LIMIT 1000
),
loc_ids AS MATERIALIZED (
  SELECT r.id AS row_id, x.image_id::uuid AS image_id
  FROM loc_rows r
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.image_ids) = 'array' THEN r.image_ids
    ELSE '[]'::jsonb END) x(image_id)
  WHERE x.image_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
),
loc_photo AS MATERIALIZED (
  SELECT li.row_id, count(*) AS photos, min(i.taken_at) AS first_taken_at, max(i.taken_at) AS last_taken_at
  FROM loc_ids li CROSS JOIN v
  JOIN public.vehicle_images i ON i.id = li.image_id AND i.vehicle_id = v.id
  WHERE nullif(btrim(i.image_url), '') IS NOT NULL
    AND i.is_sensitive IS NOT TRUE AND i.is_superseded IS NOT TRUE AND i.is_duplicate IS NOT TRUE
    AND (i.vision_gate_status IS NULL OR i.vision_gate_status::text = 'approved')
    AND coalesce(i.image_vehicle_match_status, '') NOT IN ('mismatch', 'unrelated')
  GROUP BY li.row_id
),
loc_areas AS (
  SELECT r.level, r.label, r.city, r.county_fips, r.county_name, r.region_code, r.country_code, r.zcta,
         sum(p.photos) AS photos, count(*) AS days, min(p.first_taken_at) AS first_taken_at,
         max(p.last_taken_at) AS last_taken_at, max(r.confidence) AS confidence,
         (array_agg(r.id ORDER BY r.observed_at DESC, r.id))[1] AS latest_observation_id,
         lower(concat_ws(',', nullif(btrim(r.city), ''), nullif(btrim(r.region_code), ''))) AS area_norm
  FROM loc_rows r JOIN loc_photo p ON p.row_id = r.id
  GROUP BY r.level, r.label, r.city, r.county_fips, r.county_name, r.region_code, r.country_code, r.zcta
),
loc_top AS (SELECT * FROM loc_areas ORDER BY photos DESC, last_taken_at DESC LIMIT 1),
loc_list AS (
  SELECT l.id, l.source_platform, l.observed_at, l.city, l.region_code, l.zcta, l.county_fips, l.county_name,
         l.country_code, lower(concat_ws(',', nullif(btrim(l.city), ''), nullif(btrim(l.region_code), ''))) AS area_norm
  FROM v JOIN public.vehicle_location_observations l ON l.vehicle_id = v.id
  WHERE l.source_type = 'listing' AND l.confidence >= 0.5
    AND nullif(btrim(coalesce(l.city, l.zcta, l.county_fips, l.region_code, '')), '') IS NOT NULL
),
loc_list_lead AS (SELECT * FROM loc_list WHERE area_norm <> '' ORDER BY observed_at DESC NULLS LAST, id LIMIT 1),
loc_record AS (
  SELECT nullif(concat_ws(', ', nullif(btrim(v.city), ''), nullif(btrim(v.state), '')), '') AS val,
         lower(concat_ws(',', nullif(btrim(v.city), ''), nullif(btrim(v.state), ''))) AS norm,
         nullif(btrim(v.city), '') AS city, nullif(btrim(v.state), '') AS state FROM v
),
-- The lead area: the photos' largest area, else the latest listing, else the record.
loc_lead AS (
  SELECT CASE WHEN t.area_norm IS NOT NULL THEN 'photo' WHEN l.area_norm IS NOT NULL THEN 'listing'
              WHEN r.val IS NOT NULL THEN 'record' END AS basis,
         coalesce(t.area_norm, l.area_norm, r.norm) AS area_norm,
         CASE WHEN t.area_norm IS NOT NULL THEN jsonb_build_object('label', t.label, 'level', t.level, 'city', t.city,
                'region', t.region_code, 'zcta', t.zcta, 'county_fips', t.county_fips, 'county', t.county_name,
                'country', t.country_code)
              WHEN l.area_norm IS NOT NULL THEN jsonb_build_object('label', concat_ws(', ', l.city, l.region_code),
                'level', CASE WHEN l.zcta IS NOT NULL THEN 'zcta' WHEN l.city IS NOT NULL THEN 'city' ELSE 'region' END,
                'city', l.city, 'region', l.region_code, 'zcta', l.zcta, 'county_fips', l.county_fips,
                'county', l.county_name, 'country', l.country_code)
              WHEN r.val IS NOT NULL THEN jsonb_build_object('label', r.val, 'level', 'city', 'city', r.city,
                'region', r.state, 'zcta', NULL, 'county_fips', NULL, 'county', NULL, 'country', NULL) END AS area
  FROM loc_record r LEFT JOIN loc_top t ON true LEFT JOIN loc_list_lead l ON true
),
loc_area_sources AS (
  SELECT 'photo_gps' AS fam, t.last_taken_at AS observed_at,
         jsonb_build_object('slug', 'photo_exif', 'label', 'photo GPS', 'kind', 'image', 'url', NULL,
           'method', 'photo_gps_fold_v1', 'observed_at', t.last_taken_at,
           'witness', jsonb_build_object('kind', 'location_observation', 'id', t.latest_observation_id),
           'value', t.label, 'class', 'reading', 'photos', t.photos, 'days', t.days,
           'first_taken_at', t.first_taken_at, 'last_taken_at', t.last_taken_at) AS src
  FROM loc_top t JOIN loc_lead ll ON ll.area_norm = t.area_norm
  UNION ALL
  -- The latest row per listing platform that agrees with the lead area.
  SELECT * FROM (
    SELECT DISTINCT ON (l.source_platform) 'listing:' || coalesce(l.source_platform, 'listing'), l.observed_at,
           jsonb_build_object('slug', l.source_platform, 'label', coalesce(l.source_platform, 'listing'), 'kind', 'listing',
             'url', NULL, 'method', 'vehicle_location_observations.listing', 'observed_at', l.observed_at,
             'witness', jsonb_build_object('kind', 'location_observation', 'id', l.id),
             'value', concat_ws(', ', l.city, l.region_code), 'class', 'claim')
    FROM loc_list l JOIN loc_lead ll ON ll.area_norm = l.area_norm
    ORDER BY l.source_platform, l.observed_at DESC NULLS LAST, l.id) s
),
loc_area AS (
  SELECT ll.area, ll.basis,
    CASE WHEN ll.basis IS NULL THEN 'missing'
         WHEN (SELECT count(*) FROM loc_area_sources) >= 2 THEN 'established'
         WHEN ll.basis = 'photo' THEN 'reading' ELSE 'claim' END AS status,
    (SELECT coalesce(jsonb_agg(src ORDER BY observed_at DESC NULLS LAST), '[]'::jsonb) FROM loc_area_sources)
      || CASE WHEN lr.val IS NOT NULL AND lr.norm = ll.area_norm
         THEN jsonb_build_array(jsonb_build_object('slug', NULL, 'label', 'vehicle record', 'kind', 'record', 'url', NULL,
           'method', 'vehicles.city,state', 'observed_at', NULL, 'witness', NULL, 'value', lr.val, 'class', 'record'))
         ELSE '[]'::jsonb END AS sources
  FROM loc_lead ll CROSS JOIN loc_record lr
),
loc_items AS (
  SELECT 'location.current.area' AS key, jsonb_build_object('value', a.area, 'status', a.status, 'sources', a.sources,
    'needed', CASE WHEN a.status <> 'established' THEN 'photos with camera GPS, or a dated listing location' END) AS doc
  FROM loc_area a
  UNION ALL
  SELECT 'location.sources.photo_gps', jsonb_build_object(
    'value', CASE WHEN count(*) > 0 THEN jsonb_build_object('photos', sum(photos), 'days', sum(days),
      'first_taken_at', min(first_taken_at), 'last_taken_at', max(last_taken_at),
      'areas', jsonb_agg(jsonb_build_object('label', label, 'level', level, 'county_fips', county_fips, 'zcta', zcta,
        'photos', photos, 'days', days, 'first_taken_at', first_taken_at, 'last_taken_at', last_taken_at,
        'confidence', confidence, 'latest_observation_id', latest_observation_id) ORDER BY photos DESC, last_taken_at DESC)) END,
    'status', CASE WHEN count(*) > 0 THEN 'reading' ELSE 'missing' END,
    'sources', CASE WHEN count(*) > 0 THEN jsonb_build_array(jsonb_build_object('slug', 'photo_exif', 'label', 'photo GPS',
      'kind', 'image', 'url', NULL, 'method', 'photo_gps_fold_v1', 'observed_at', max(last_taken_at),
      'witness', NULL, 'value', NULL, 'class', 'reading')) ELSE '[]'::jsonb END,
    'needed', CASE WHEN count(*) = 0 THEN 'photos with camera GPS' END)
  FROM loc_areas
  UNION ALL
  SELECT 'location.sources.listing', jsonb_build_object(
    'value', CASE WHEN count(*) > 0 THEN jsonb_build_object('observations', count(*), 'first_at', min(observed_at),
      'last_at', max(observed_at), 'platforms', count(DISTINCT coalesce(source_platform, 'listing'))) END,
    'status', CASE WHEN count(*) > 0 THEN 'claim' ELSE 'missing' END, 'sources', '[]'::jsonb,
    'needed', CASE WHEN count(*) = 0 THEN 'a dated listing location' END)
  FROM loc_list
  UNION ALL
  SELECT 'location.map', jsonb_build_object(
    'value', CASE WHEN a.area IS NOT NULL THEN jsonb_build_object('label', a.area->'label', 'level', a.area->'level',
      'county_fips', a.area->'county_fips', 'zcta', a.area->'zcta', 'bounds', NULL) END,
    'status', CASE WHEN a.area IS NULL THEN 'missing' ELSE a.status END, 'sources', '[]'::jsonb,
    'needed', CASE WHEN a.area IS NULL THEN 'an established area at ZCTA grain'
                   WHEN a.area->>'zcta' IS NULL THEN 'the ZCTA for this area (photo areas carry none until a ZIP keyer exists) and its boundary geometry (us_zctas holds codes only)'
                   ELSE 'ZCTA boundary geometry for bounds (us_zctas holds codes only)' END)
  FROM loc_area a
),
loc_docs AS (
  SELECT l.key, jsonb_build_object('key', l.key, 'facet', f.facet, 'normalized', NULL, 'unit', f.unit, 'rule', NULL,
    'equation', NULL) || l.doc AS doc
  FROM loc_items l JOIN defs f ON f.key = l.key
),
everything AS (
  SELECT d.dim, d.ord, e.doc
  FROM (SELECT key, doc FROM item UNION ALL SELECT key, doc FROM derived_items UNION ALL SELECT key, doc FROM loc_docs) e
  JOIN defs d ON d.key = e.key
),
-- Identity lead: VIN decode precedence when the decode is established, else the recorded item.
led AS (
  SELECT e.dim, e.ord, e.doc || CASE WHEN e.dim IN ('year', 'make', 'model', 'body_style')
      AND e.doc->>'key' IN (e.dim || '.decode', e.dim || '.recorded', e.dim || '.title') THEN
      jsonb_build_object('lead', e.doc->>'key' = CASE WHEN EXISTS (SELECT 1 FROM everything d
        WHERE d.doc->>'key' = e.dim || '.decode' AND d.doc->>'status' = 'established')
        THEN e.dim || '.decode' ELSE e.dim || '.recorded' END)
    ELSE '{}'::jsonb END AS doc
  FROM everything e
),
per_dim AS (
  SELECT dim, jsonb_agg(doc ORDER BY ord) AS items FROM led GROUP BY dim
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM v) THEN NULL
  WHEN p_dimension IS NULL THEN (SELECT jsonb_object_agg(dim, items) FROM per_dim)
  ELSE (SELECT items FROM per_dim WHERE dim = p_dimension) END
$function$;
COMMENT ON FUNCTION public.vehicle_facet_items(uuid, text) IS
  'Header facet items (facet_items_v1): for one vehicle and one token (year, make, model, body_style, trim, engine, '
  'transmission, drivetrain, location), the fixed item list with each item''s value, status (established, reading, '
  'claim, conflict, missing), deduplicated sources with witness and clock, rule, equation and needed evidence. '
  'Dimension NULL returns every token as one object. Security invoker: the viewer''s row policies bound every source; '
  'location is area grain only, from the photo GPS fold recounted at read time. '
  'Spec: docs/market/VEHICLE_HEADER_FORM_RULES.md "Facet items".';

DO $grants$
DECLARE a record;
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.vehicle_facet_items(uuid, text) FROM PUBLIC';
  -- The same execution boundary as the profile reader.
  FOR a IN SELECT x.grantee, x.is_grantable FROM pg_proc p,
    LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    WHERE p.oid = 'public.vehicle_profile_read(uuid)'::regprocedure
      AND x.privilege_type = 'EXECUTE' AND x.grantee <> p.proowner AND x.grantee <> 0
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.vehicle_facet_items(uuid, text) TO %I%s',
      pg_get_userbyid(a.grantee), CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END $grants$;

-- 5. Profile reader: every token's items on the masthead, read once ------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.patch_once(p_text text, p_anchor text, p_replacement text, p_what text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE n integer := (length(p_text) - length(replace(p_text, p_anchor, ''))) / greatest(length(p_anchor), 1);
BEGIN
  IF n <> 1 THEN RAISE EXCEPTION '% anchor drifted (found % times): %', p_what, n, p_anchor; END IF;
  RETURN replace(p_text, p_anchor, p_replacement);
END $f$;

DO $migration$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure);
  IF position('facet_items_v1' in d) = 0 THEN
    d := pg_temp.patch_once(d, E'\nstrip AS (',
      E'\n-- facet_items_v1: every token''s line items (vehicle_facet_items), read once.\n'
      || E'token_items AS (SELECT public.vehicle_facet_items(p_vehicle_id) AS doc),\nstrip AS (',
      'vehicle_profile_read strip CTE');
    d := pg_temp.patch_once(d,
      $a$'price', (SELECT claim FROM price_claim),$a$,
      $b$'token_items', (SELECT doc FROM token_items),
      'price', (SELECT claim FROM price_claim),$b$,
      'vehicle_profile_read masthead');
    EXECUTE d;
  END IF;
  IF position('facet_items_v1' in pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'vehicle_profile_read is not patched';
  END IF;
END $migration$;

DROP FUNCTION pg_temp.patch_once(text, text, text, text);
COMMIT;
