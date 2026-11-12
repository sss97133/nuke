-- Header facet items: every header token is a defined set of line items (docs/market/VEHICLE_HEADER_FORM_RULES.md,
-- "Facet items", 2026-11-11). The item list is the same for every vehicle; a vehicle differs only in which items its
-- testimony establishes. Missing items come back with the evidence that would establish them.
--
-- 1. vehicle_decode_rules: one cited rule table (gear ratios by transmission model, axle codes, engine codes, casting
--    numbers, body-tag codes, VIN chart positions), keyed by rule_key + make/model/code + year range. Empty here; cited
--    rows land later. Reference data, not testimony.
-- 2. observation_source_label(uuid): the public slug and display name of an observation source. observation_sources has
--    a SELECT policy for authenticated only, so an invoker reader could not name a listing source for a logged-out viewer.
-- 3. vehicle_facet_norm(kind, value): the comparison key two testimonies must share to agree (displacement in liters,
--    transmission type, drive layout, engine configuration, ratio, tire diameter, year, text).
-- 4. vehicle_facet_items(vehicle, dimension): STABLE security invoker, so every source is bounded by the viewer's own
--    row policies, plus the vehicle visibility test stated here. Dimension NULL returns every token's items as one object.
-- 5. vehicle_profile_read: each strip facet carries `items`, and the masthead carries `token_items` for every token
--    (the strip omits a facet with no recorded value and is absent when nothing is shown, so its items live there too).
--    Patched at anchors; refuses drift; skipped when already present.
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
ALTER TABLE public.vehicle_decode_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_decode_rules_public_read ON public.vehicle_decode_rules;
CREATE POLICY vehicle_decode_rules_public_read ON public.vehicle_decode_rules FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.vehicle_decode_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_decode_rules TO anon, authenticated;
GRANT ALL ON public.vehicle_decode_rules TO service_role;
COMMENT ON TABLE public.vehicle_decode_rules IS
  'Cited decode rules (grain: one rule row for one key, optionally narrowed by make, model and year range). rule_key names '
  'the table: transmission_gear_ratios (code = transmission model, value.gears = numeric array first..top, value.reverse), '
  'axle_code (value.ratio, value.limited_slip), engine_code (code = VIN engine character, value.displacement_ci, value.family), '
  'block_casting, body_tag_code, vin_chart (code = decode rule key, value.positions = {field: "position"}). Every row carries '
  'citation_url; a newer row supersedes an older one (superseded_by, superseded_at), never an update in place. Read by '
  'vehicle_facet_items. Created empty by 20261116100000.';

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
  'Comparison key for header facet testimony: two sources agree when their keys are equal. Kinds: text, year, displacement '
  '(liters, 1 decimal, from L/cc/ci text), transmission_type, layout, configuration, ratio, tire_diameter_in. NULL when '
  'the value does not state the quantity.';
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
         v.rear_axle_type, v.tire_spec_rear, v.city, v.state,
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
  ('trim', 0, 'trim.recorded', 'current', NULL, 'a dated source for the trim: listing, badge photos or build documents'),
  ('trim', 1, 'trim.tribute', 'current', NULL, 'build documents (PHS, build sheet, body tag) establishing factory trim or tribute'),
  ('trim', 2, 'trim.decode', 'decode', NULL, 'VIN series code decoded under a cited chart, or the trim tag'),
  ('engine', 0, 'engine.as_built.engine', 'as_built', NULL, 'VIN engine code decoded under a cited chart, or the build sheet'),
  ('engine', 1, 'engine.current.family', 'current', NULL, 'photo of the engine showing its configuration, or a receipt'),
  ('engine', 2, 'engine.current.displacement', 'current', 'L', 'photo of the block casting or a machine-shop work order stating displacement'),
  ('engine', 3, 'engine.current.block_casting', 'current', NULL, 'photo of the block casting number'),
  ('engine', 4, 'engine.current.block_date', 'current', NULL, 'photo of the block casting date code'),
  ('engine', 5, 'engine.current.engine_code_stamp', 'current', NULL, 'photo of the engine code stamp on the block pad'),
  ('engine', 6, 'engine.current.heads', 'current', NULL, 'photo of the cylinder-head casting numbers, or a receipt'),
  ('engine', 7, 'engine.current.induction', 'current', NULL, 'photo of the carburetor or intake ID tag, or a receipt'),
  ('engine', 8, 'engine.current.cam', 'current', NULL, 'cam card or receipt naming the camshaft'),
  ('engine', 9, 'engine.current.machine_work', 'current', NULL, 'machine-shop work order lines keyed to this engine'),
  ('engine', 10, 'engine.derived.changed', 'derived', NULL, 'the as-built engine and the current displacement, and a dated change claim citing the swap'),
  ('transmission', 0, 'transmission.as_built.type', 'as_built', NULL, 'body tag or SPID option code, build sheet, or owner statement'),
  ('transmission', 1, 'transmission.as_built.model', 'as_built', NULL, 'body tag or SPID option code, build sheet, or owner statement'),
  ('transmission', 2, 'transmission.current.type', 'current', NULL, 'photo of the shifter or transmission, or a receipt'),
  ('transmission', 3, 'transmission.current.model', 'current', NULL, 'photo of the transmission ID stamp or case casting, or a receipt'),
  ('transmission', 4, 'transmission.current.id_stamp', 'current', NULL, 'photo of the transmission ID stamp'),
  ('transmission', 5, 'transmission.current.date_code', 'current', NULL, 'photo of the transmission date code'),
  ('transmission', 6, 'transmission.current.gear_ratios', 'decode', NULL, 'transmission model identified by its ID stamp, and a cited ratio table for that model'),
  ('transmission', 7, 'transmission.current.shifter', 'current', NULL, 'photo of the shifter assembly, or a receipt'),
  ('transmission', 8, 'transmission.axle.as_built.ratio', 'as_built', NULL, 'axle code from the body tag or SPID, decoded under a cited axle-code table'),
  ('transmission', 9, 'transmission.axle.current.ratio', 'current', NULL, 'axle tag or ring-gear stamp photo, or a receipt stating the ratio'),
  ('transmission', 10, 'transmission.current.tire_size', 'current', NULL, 'photo of a rear tire sidewall'),
  ('transmission', 11, 'transmission.derived.final_drive', 'derived', NULL, 'gear ratios and the current axle ratio'),
  ('transmission', 12, 'transmission.derived.rpm_at_60', 'derived', 'rpm', 'top-gear ratio, the current axle ratio and the rear tire size'),
  ('drivetrain', 0, 'drivetrain.as_built.layout', 'as_built', NULL, 'VIN chart or build documents stating the factory drive layout'),
  ('drivetrain', 1, 'drivetrain.current.layout', 'current', NULL, 'photo of the underside showing driveshafts and axles'),
  ('drivetrain', 2, 'drivetrain.axle.current.type', 'current', NULL, 'axle tag or limited-slip ID, or a receipt'),
  ('location', 0, 'location.current.area', 'current', NULL, 'photos with camera GPS, or a dated listing location'),
  ('location', 1, 'location.sources.photo_gps', 'current', NULL, 'photos with camera GPS'),
  ('location', 2, 'location.sources.listing', 'current', NULL, 'a dated listing location'),
  ('location', 3, 'location.map', 'current', NULL, 'an established area at ZCTA grain')
),
-- Observations in the viewer's row policies that can speak to a token.
obs AS MATERIALIZED (
  SELECT o.id, o.kind::text AS kind, o.extraction_method AS method, o.source_url, o.observed_at, o.structured_data AS sd,
         o.source_observation_id, o.property_id, o.source_id,
         coalesce(p.property_key, o.structured_data->>'property_key') AS pk,
         CASE WHEN o.structured_data->>'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (o.structured_data->>'image_id')::uuid END AS image_id
  FROM v JOIN public.vehicle_observations o ON o.vehicle_id = v.id
  LEFT JOIN public.observation_properties p ON p.id = o.property_id
  WHERE o.is_superseded IS NOT TRUE
    AND (o.property_id IS NOT NULL OR o.structured_data ? 'property_key' OR o.structured_data ? 'claim_role'
         OR (o.extraction_method LIKE 'vin\_decode\_%' AND o.structured_data ? 'decode_rule'))
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
           'kind', CASE WHEN o.image_id IS NOT NULL THEN 'image' WHEN o.sd->>'claim_role' = 'record_label' THEN 'record_label'
                        WHEN o.kind = 'listing' OR o.sd->>'claim_role' = 'listing_claim' THEN 'listing' ELSE o.kind END,
           'url', CASE WHEN o.image_id IS NULL THEN o.source_url END, 'method', o.method, 'observed_at', o.observed_at,
           'witness', CASE WHEN o.image_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.vehicle_images i WHERE i.id = o.image_id)
                           THEN jsonb_build_object('kind', 'image', 'id', o.image_id)
                           ELSE jsonb_build_object('kind', 'observation', 'id', o.id) END,
           'value', o.sd->>o.pk, 'class', CASE WHEN o.image_id IS NOT NULL THEN 'reading' ELSE 'claim' END),
         NULL::jsonb
  FROM obs o CROSS JOIN v
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
  -- Photo readings keyed by a closed claim role.
  SELECT m.key, o.sd->>m.field, m.nk,
         CASE WHEN o.image_id IS NOT NULL THEN 'reading' ELSE 'claim' END,
         coalesce('img:' || o.image_id, 'obs:' || o.id), 'reader:' || o.method, o.observed_at, 1,
         jsonb_build_object('slug', NULL, 'label', 'photo reading', 'kind', 'image', 'url', NULL, 'method', o.method,
           'observed_at', o.observed_at,
           'witness', CASE WHEN o.image_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.vehicle_images i WHERE i.id = o.image_id)
                           THEN jsonb_build_object('kind', 'image', 'id', o.image_id)
                           ELSE jsonb_build_object('kind', 'observation', 'id', o.id) END,
           'value', o.sd->>m.field, 'class', CASE WHEN o.image_id IS NOT NULL THEN 'reading' ELSE 'claim' END,
           'limitation', o.sd->>'limitation'),
         NULL::jsonb
  FROM obs o
  JOIN (VALUES
    ('nominal_engine_displacement', 'engine_size', 'engine.current.displacement', 'displacement'),
    ('identified_transmission_housing', 'transmission', 'transmission.current.model', 'text'),
    ('identified_transmission_housing', 'transmission', 'transmission.current.type', 'transmission_type'),
    ('visible_drivetrain_layout', 'drivetrain', 'drivetrain.current.layout', 'layout')
  ) m(role, field, key, nk) ON m.role = o.sd->>'claim_role'
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
  ORDER BY key, indep, norm, pref, observed_at DESC NULLS LAST
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
         (array_agg(r.val ORDER BY r.crank, r.observed_at DESC NULLS LAST))[1] AS lead_val,
         (array_agg(r.norm ORDER BY r.crank, r.observed_at DESC NULLS LAST))[1] AS lead_norm,
         (array_agg(r.rule ORDER BY r.crank, r.observed_at DESC NULLS LAST) FILTER (WHERE r.rule IS NOT NULL))[1] AS rule,
         jsonb_agg(r.src ORDER BY r.crank, r.observed_at DESC NULLS LAST) AS sources
  FROM ranked r GROUP BY r.key
),
base AS (
  SELECT d.dim, d.ord, d.key, d.facet, d.unit, d.needed, a.lead_val, a.lead_norm, a.rule, a.sources,
         CASE WHEN a.key IS NULL THEN 'missing'
              WHEN a.nvals > 1 THEN 'conflict'
              WHEN a.strong THEN 'established'
              WHEN a.nind >= 2 AND a.nfam >= 2 THEN 'established'
              WHEN a.has_reading THEN 'reading'
              ELSE 'claim' END AS status,
         CASE WHEN a.nvals > 1 THEN (SELECT jsonb_agg(jsonb_build_object('value', s.val, 'normalized', s.norm,
                'sources', s.sources) ORDER BY s.best, s.norm) FROM sides s WHERE s.key = d.key) END AS conflict_sides
  FROM defs d LEFT JOIN agg a ON a.key = d.key
  WHERE d.dim NOT IN ('location')
    AND d.key NOT IN ('transmission.current.gear_ratios', 'transmission.derived.final_drive',
                      'transmission.derived.rpm_at_60', 'engine.derived.changed', 'trim.tribute')
),
item AS (
  SELECT dim, ord, key, jsonb_build_object(
    'key', key, 'facet', facet, 'value', lead_val, 'normalized', lead_norm, 'unit', unit, 'status', status,
    'sources', coalesce(sources, '[]'::jsonb), 'rule', rule, 'equation', NULL,
    'needed', CASE WHEN status <> 'established' THEN needed END)
    || CASE WHEN conflict_sides IS NOT NULL THEN jsonb_build_object('sides', conflict_sides) ELSE '{}'::jsonb END AS doc,
    status, lead_norm
  FROM base
),
-- Ratios for the identified transmission model, from the cited rule table.
gear AS (
  SELECT r.id, r.value, r.citation_url, r.citation_title, i.status
  FROM item i CROSS JOIN v
  JOIN public.vehicle_decode_rules r ON r.rule_key = 'transmission_gear_ratios' AND r.superseded_at IS NULL
    AND upper(regexp_replace(r.code, '\s+', '', 'g')) = upper(regexp_replace(i.doc->>'value', '\s+', '', 'g'))
    AND (r.make IS NULL OR lower(r.make) = lower(v.make))
    AND (r.year_min IS NULL OR v.year >= r.year_min) AND (r.year_max IS NULL OR v.year <= r.year_max)
  WHERE i.key = 'transmission.current.model' AND i.status NOT IN ('missing', 'conflict')
    AND jsonb_typeof(r.value->'gears') = 'array'
  ORDER BY r.created_at DESC LIMIT 1
),
gear_item AS (
  SELECT jsonb_build_object('key', 'transmission.current.gear_ratios', 'facet', 'decode',
    'value', g.value->'gears', 'normalized', NULL, 'unit', NULL,
    'status', coalesce(g.status, 'missing'),
    'sources', '[]'::jsonb,
    'rule', CASE WHEN g.id IS NOT NULL THEN jsonb_build_object('key', 'transmission_gear_ratios', 'id', g.id,
      'citation_url', g.citation_url, 'citation_title', g.citation_title,
      'applies_to', 'transmission.current.model') END,
    'equation', NULL,
    'needed', CASE WHEN g.status IS DISTINCT FROM 'established' THEN
      'transmission model identified by its ID stamp, and a cited ratio table for that model' END) AS doc,
    g.value->'gears' AS gears, coalesce(g.status, 'missing') AS status
  FROM (SELECT 1) one LEFT JOIN gear g ON true
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
         (SELECT status FROM item WHERE key = 'engine.current.displacement') AS cur_status
),
weakest AS (
  SELECT x.*, s.final_status, s.rpm_status, s.changed_status FROM deriv_in x CROSS JOIN LATERAL (SELECT
    (SELECT CASE WHEN bool_or(st IN ('missing', 'conflict')) OR x.gears IS NULL OR x.axle IS NULL THEN 'missing'
                 WHEN bool_and(st = 'established') THEN 'established' WHEN bool_or(st = 'claim') THEN 'claim' ELSE 'reading' END
       FROM unnest(ARRAY[x.gear_status, x.axle_status]) st) AS final_status,
    (SELECT CASE WHEN bool_or(st IN ('missing', 'conflict')) OR x.gears IS NULL OR x.axle IS NULL OR x.tire_in IS NULL THEN 'missing'
                 WHEN bool_and(st = 'established') THEN 'established' WHEN bool_or(st = 'claim') THEN 'claim' ELSE 'reading' END
       FROM unnest(ARRAY[x.gear_status, x.axle_status, x.tire_status]) st) AS rpm_status,
    (SELECT CASE WHEN bool_or(st IN ('missing', 'conflict')) OR x.built_l IS NULL OR x.cur_l IS NULL THEN 'missing'
                 WHEN bool_and(st = 'established') THEN 'established' WHEN bool_or(st = 'claim') THEN 'claim' ELSE 'reading' END
       FROM unnest(ARRAY[x.built_status, x.cur_status]) st) AS changed_status) s
),
derived AS (
  SELECT 'transmission' AS dim, 11 AS ord, jsonb_build_object('key', 'transmission.derived.final_drive', 'facet', 'derived',
    'value', CASE WHEN w.final_status <> 'missing' THEN (SELECT jsonb_agg(round(g::numeric * w.axle, 2) ORDER BY n)
      FROM jsonb_array_elements_text(w.gears) WITH ORDINALITY e(g, n)) END,
    'normalized', NULL, 'unit', NULL, 'status', w.final_status, 'sources', '[]'::jsonb, 'rule', NULL,
    'equation', jsonb_build_object('expression', 'gear_ratio[n] * axle_ratio',
      'reads', jsonb_build_array('transmission.current.gear_ratios', 'transmission.axle.current.ratio')),
    'needed', CASE WHEN w.final_status <> 'established' THEN 'gear ratios and the current axle ratio' END) AS doc
  FROM weakest w
  UNION ALL
  SELECT 'transmission', 12, jsonb_build_object('key', 'transmission.derived.rpm_at_60', 'facet', 'derived',
    'value', CASE WHEN w.rpm_status <> 'missing' THEN round(60 * (w.gears->>(jsonb_array_length(w.gears) - 1))::numeric
      * w.axle * 336.13 / w.tire_in) END,
    'normalized', NULL, 'unit', 'rpm', 'status', w.rpm_status, 'sources', '[]'::jsonb, 'rule', NULL,
    'equation', jsonb_build_object('expression', 'mph * top_gear_ratio * axle_ratio * 336.13 / tire_diameter_in, mph = 60',
      'reads', jsonb_build_array('transmission.current.gear_ratios', 'transmission.axle.current.ratio',
        'transmission.current.tire_size'), 'tire_diameter_in', w.tire_in),
    'needed', CASE WHEN w.rpm_status <> 'established' THEN 'top-gear ratio, the current axle ratio and the rear tire size' END)
  FROM weakest w
  UNION ALL
  SELECT 'engine', 10, jsonb_build_object('key', 'engine.derived.changed', 'facet', 'derived',
    'value', CASE WHEN w.changed_status <> 'missing' THEN w.built_l IS DISTINCT FROM w.cur_l END,
    'normalized', NULL, 'unit', NULL, 'status', w.changed_status, 'sources', '[]'::jsonb, 'rule', NULL,
    'equation', jsonb_build_object('expression', 'as_built.engine liters <> current.displacement liters (1 decimal)',
      'reads', jsonb_build_array('engine.as_built.engine', 'engine.current.displacement'),
      'as_built_l', w.built_l, 'current_l', w.cur_l, 'change_claim', NULL),
    'needed', 'a dated change claim citing the engine swap (receipt or work order)'
      || CASE WHEN w.changed_status = 'missing' THEN '; the as-built engine and the current displacement' ELSE '' END)
  FROM weakest w
  UNION ALL
  SELECT 'transmission', 6, doc FROM gear_item
  UNION ALL
  -- tribute_badge_rule_v1: a tribute (vehicles.is_replica) earns no factory series or trim badge.
  SELECT 'trim', 1, jsonb_build_object('key', 'trim.tribute', 'facet', 'current',
    'value', CASE WHEN v.is_replica THEN 'tribute' END, 'normalized', NULL, 'unit', NULL,
    'status', CASE WHEN v.is_replica THEN 'claim' ELSE 'missing' END,
    'sources', CASE WHEN v.is_replica THEN jsonb_build_array(jsonb_build_object('slug', NULL, 'label', 'vehicle record',
      'kind', 'record', 'url', NULL, 'method', 'vehicles.is_replica', 'observed_at', NULL, 'witness', NULL,
      'value', 'true', 'class', 'record')) ELSE '[]'::jsonb END,
    'rule', jsonb_build_object('key', 'tribute_badge_rule_v1', 'citation_url', NULL,
      'migration', '20261110090000_tribute_badges_and_engine_correction.sql',
      'effect', 'a tribute earns no factory series or trim badge'),
    'equation', NULL,
    'needed', 'build documents (PHS, build sheet, body tag) establishing factory trim or tribute')
  FROM v
),
-- Location at public area grain only: city, region, ZCTA, county. Never a coordinate, a raw text or a photo.
loc AS (
  SELECT l.id, l.source_type, l.source_platform, l.observed_at, l.precision, l.city, l.region_code, l.zcta,
         l.county_fips, l.county_name, l.country_code,
         (l.source_type IN ('photo', 'photo_gps', 'photo_exif', 'image_gps', 'exif')
           OR coalesce(l.source_platform, '') IN ('photo_gps', 'photo_exif', 'vehicle_images', 'exif')) AS is_photo,
         lower(concat_ws(',', nullif(btrim(l.city), ''), nullif(btrim(l.region_code), ''))) AS area_norm
  FROM v JOIN public.vehicle_location_observations l ON l.vehicle_id = v.id
  WHERE nullif(btrim(coalesce(l.city, l.zcta, l.county_fips, l.region_code, '')), '') IS NOT NULL
),
loc_lead AS (
  SELECT * FROM loc WHERE area_norm <> '' ORDER BY observed_at DESC NULLS LAST, id LIMIT 1
),
loc_area_sources AS (
  SELECT DISTINCT ON (fam) fam, src, observed_at, is_photo FROM (
    SELECT CASE WHEN l.is_photo THEN 'photo_gps' ELSE 'listing:' || coalesce(l.source_platform, l.source_type) END AS fam,
           l.is_photo, l.observed_at,
           jsonb_build_object('slug', l.source_platform, 'label', CASE WHEN l.is_photo THEN 'photo GPS'
               ELSE coalesce(l.source_platform, l.source_type) END,
             'kind', CASE WHEN l.is_photo THEN 'image' ELSE 'listing' END, 'url', NULL,
             'method', 'vehicle_location_observations.' || l.source_type, 'observed_at', l.observed_at,
             'witness', jsonb_build_object('kind', 'location_observation', 'id', l.id),
             'value', concat_ws(', ', l.city, l.region_code), 'class', CASE WHEN l.is_photo THEN 'reading' ELSE 'claim' END) AS src
    FROM loc l JOIN loc_lead ll ON ll.area_norm = l.area_norm) s
  ORDER BY fam, observed_at DESC NULLS LAST
),
loc_record AS (
  SELECT nullif(concat_ws(', ', nullif(btrim(v.city), ''), nullif(btrim(v.state), '')), '') AS val,
         lower(concat_ws(',', nullif(btrim(v.city), ''), nullif(btrim(v.state), ''))) AS norm FROM v
),
loc_area AS (
  SELECT ll.id IS NOT NULL AS observed,
    CASE WHEN ll.id IS NULL AND lr.val IS NULL THEN 'missing'
         WHEN ll.id IS NULL THEN 'claim'
         WHEN (SELECT count(*) FROM loc_area_sources) >= 2 THEN 'established'
         WHEN ll.is_photo THEN 'reading' ELSE 'claim' END AS status,
    CASE WHEN ll.id IS NOT NULL THEN jsonb_build_object('city', ll.city, 'region', ll.region_code, 'zcta', ll.zcta,
           'county_fips', ll.county_fips, 'county', ll.county_name, 'country', ll.country_code,
           'grain', CASE WHEN ll.zcta IS NOT NULL THEN 'zcta' WHEN ll.city IS NOT NULL THEN 'city' ELSE 'region' END)
         WHEN lr.val IS NOT NULL THEN jsonb_build_object('city', (SELECT nullif(btrim(city), '') FROM v),
           'region', (SELECT nullif(btrim(state), '') FROM v), 'zcta', NULL, 'county_fips', NULL, 'county', NULL,
           'country', NULL, 'grain', 'city') END AS area,
    (SELECT coalesce(jsonb_agg(src ORDER BY observed_at DESC NULLS LAST), '[]'::jsonb) FROM loc_area_sources)
      || CASE WHEN lr.val IS NOT NULL AND (ll.id IS NULL OR lr.norm = ll.area_norm)
         THEN jsonb_build_array(jsonb_build_object('slug', NULL, 'label', 'vehicle record', 'kind', 'record', 'url', NULL,
           'method', 'vehicles.city,state', 'observed_at', NULL, 'witness', NULL, 'value', lr.val, 'class', 'record'))
         ELSE '[]'::jsonb END AS sources
  FROM loc_record lr LEFT JOIN loc_lead ll ON true
),
loc_items AS (
  SELECT 0 AS ord, jsonb_build_object('key', 'location.current.area', 'facet', 'current', 'value', a.area,
    'normalized', NULL, 'unit', NULL, 'status', a.status, 'sources', a.sources, 'rule', NULL, 'equation', NULL,
    'needed', CASE WHEN a.status <> 'established' THEN 'photos with camera GPS, or a dated listing location' END) AS doc
  FROM loc_area a
  UNION ALL
  SELECT 1, jsonb_build_object('key', 'location.sources.photo_gps', 'facet', 'current',
    'value', CASE WHEN count(*) > 0 THEN jsonb_build_object('photos', count(*), 'first_at', min(observed_at),
      'last_at', max(observed_at), 'areas', count(DISTINCT coalesce(zcta, area_norm))) END,
    'normalized', NULL, 'unit', NULL, 'status', CASE WHEN count(*) > 0 THEN 'reading' ELSE 'missing' END,
    'sources', '[]'::jsonb, 'rule', NULL, 'equation', NULL,
    'needed', CASE WHEN count(*) = 0 THEN 'photos with camera GPS' END)
  FROM loc WHERE is_photo
  UNION ALL
  SELECT 2, jsonb_build_object('key', 'location.sources.listing', 'facet', 'current',
    'value', CASE WHEN count(*) > 0 THEN jsonb_build_object('observations', count(*), 'first_at', min(observed_at),
      'last_at', max(observed_at), 'platforms', count(DISTINCT coalesce(source_platform, source_type))) END,
    'normalized', NULL, 'unit', NULL, 'status', CASE WHEN count(*) > 0 THEN 'claim' ELSE 'missing' END,
    'sources', '[]'::jsonb, 'rule', NULL, 'equation', NULL,
    'needed', CASE WHEN count(*) = 0 THEN 'a dated listing location' END)
  FROM loc WHERE NOT is_photo
  UNION ALL
  SELECT 3, jsonb_build_object('key', 'location.map', 'facet', 'current',
    'value', CASE WHEN a.area IS NOT NULL THEN a.area || jsonb_build_object('bounds', NULL) END,
    'normalized', NULL, 'unit', NULL,
    'status', CASE WHEN a.area->>'zcta' IS NULL THEN 'missing' ELSE a.status END,
    'sources', '[]'::jsonb, 'rule', NULL, 'equation', NULL,
    'needed', CASE WHEN a.area->>'zcta' IS NULL THEN 'an established area at ZCTA grain' ELSE
      'ZCTA boundary geometry for bounds (us_zctas holds codes only)' END)
  FROM loc_area a
),
everything AS (
  SELECT dim, ord, doc FROM item
  UNION ALL SELECT dim, ord, doc FROM derived
  UNION ALL SELECT 'location', ord, doc FROM loc_items
),
-- Identity lead: VIN decode precedence when the decode is established, else the recorded item.
led AS (
  SELECT e.dim, e.ord, e.doc || CASE WHEN e.dim IN ('year', 'make', 'model', 'body_style') THEN
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
  'location is area grain only. Spec: docs/market/VEHICLE_HEADER_FORM_RULES.md "Facet items".';

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

-- 5. Profile reader: items on each strip facet and every token's items on the masthead ------------------------------
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
      $a$jsonb_build_object('dimension', dimension, 'label', label, 'member', member)$a$,
      $b$jsonb_build_object('dimension', dimension, 'label', label, 'member', member,
            'items', (SELECT ti.doc->dimension FROM token_items ti))$b$,
      'vehicle_profile_read strip facets');
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
