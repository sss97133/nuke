-- Contract for 20261126001500_facet_retained_matcher_caller_gate (empty disposable PG17).
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in an empty disposable PG17 database only (stub tables, not production).
-- The matcher family is installed from its live definitions read 2026-11-25 (retained_listing_property_result_matches
-- and the six retained_*_matches it calls, plus observation_is_public and retained_powertrain_value), so the migration's
-- premise guard passes on the same hashes it pins. The value tests they call (retained_*_value_matches) and
-- retained_native_listing_source are stubbed to TRUE: each appears only as a conjunct (or inside the
-- observation_sources join), so TRUE admits every row the live tests could admit and more, which makes
-- "gate false => matcher false" the strongest form of the claim. vehicle_facet_items is a minimal reader holding the
-- live anchor verbatim. For anon reading the registry none, all and only 'bat', and for authenticated and the owner:
--   1. NOT gate AND matcher holds on no projection row (the gate never hides a row the matcher admits);
--   2. the reader's output is md5-identical before and after the migration;
--   3. the gate is not vacuous: anon admits rows when it can read the registry, and none when it cannot;
--   4. two mutants fail check 2 under the fixtures where anon can read the registry: the gate replaced by false, and
--      by a role-name test;
--   5. the migration refuses a body it does not know, refuses when a matcher becomes SECURITY DEFINER, is idempotent,
--      and the revert restores the body byte for byte;
--   6. a matcher whose own observation_sources join is dropped is caught twice: the truth table finds rows the gate
--      would hide, and the migration's premise guard refuses.
-- 'authenticated' below has no subject: a signed-in stranger. 'postgres' owns the tables: the owner's full view.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_observations') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

CREATE TYPE public.observation_kind AS ENUM ('listing','sale_result','comment','bid','sighting','work_record','ownership',
  'specification','provenance','valuation','condition','media','social_mention','expert_opinion','splice','activity','offer',
  'contributor_answer');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, listing_kind text);
CREATE TABLE public.observation_sources (id uuid PRIMARY KEY, slug text UNIQUE, supported_observations public.observation_kind[]);
CREATE TABLE public.observation_properties (id uuid PRIMARY KEY, property_key text, label text, data_type text, unit text,
  namespace text, applies_to_kinds public.observation_kind[], ratified_at timestamptz, deprecated_at timestamptz);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles (id), observed_at timestamptz, ingested_at timestamptz,
  source_id uuid REFERENCES public.observation_sources (id), source_url text, source_identifier text, kind public.observation_kind, content_hash text, structured_data jsonb,
  confidence_score numeric, is_superseded boolean DEFAULT false, extraction_method text, raw_source_ref text,
  agent_cost_cents numeric, property_id uuid REFERENCES public.observation_properties (id), subject_type text DEFAULT 'vehicle', subject_id uuid,
  source_observation_id uuid REFERENCES public.vehicle_observations (id));  -- the four foreign keys live has
GRANT SELECT ON public.vehicles, public.observation_sources, public.observation_properties, public.vehicle_observations
  TO anon, authenticated;
ALTER TABLE public.observation_sources ENABLE ROW LEVEL SECURITY;
-- As live: one read policy, authenticated only (20261007233000). Anon's policy is set per state below.
CREATE POLICY allow_authenticated_read_observation_sources ON public.observation_sources FOR SELECT TO authenticated USING (true);

-- Permissive stubs (see the header).
CREATE FUNCTION public.retained_native_listing_source(p public.vehicle_observations) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
CREATE FUNCTION public.retained_craigslist_odometer_value_matches(p public.vehicle_observations, o public.vehicle_observations) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
CREATE FUNCTION public.retained_craigslist_year_value_matches(p public.vehicle_observations, o public.vehicle_observations) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
CREATE FUNCTION public.retained_description_identity_value_matches(p public.vehicle_observations, o public.vehicle_observations) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
CREATE FUNCTION public.retained_description_property_value_matches(p public.vehicle_observations, o public.vehicle_observations) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
CREATE FUNCTION public.retained_description_year_value_matches(p public.vehicle_observations, o public.vehicle_observations) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
CREATE FUNCTION public.retained_listing_identity_value_matches(p public.vehicle_observations, o public.vehicle_observations) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';

-- Live definitions, verbatim (pg_get_functiondef, 2026-11-25).
CREATE OR REPLACE FUNCTION public.observation_is_public(p_kind observation_kind, p_data jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_kind IN ('listing', 'sale_result', 'comment', 'bid', 'specification', 'condition', 'media', 'splice')
     AND COALESCE(p_data::text, '') !~* ('"(invoice_number|line_items|subtotal|tax|total_amount|receipt_id|file_url'
                                         '|receipt_type|vendor_address|client_billing|billing|billed_usd|paid_usd|cost_usd'
                                         '|price_usd|amount_usd|payment_method|payment|payments|amount_paid|balance_due'
                                         '|order_number|order_contents|order|client|correct_owner|prior_owner_id'
                                         '|correct_owner_discovered_person_id|customer_name|client_name|email|phone'
                                         '|total_?paid|balance_?remaining|full_?name|first_?name|last_?name'
                                         '|given_?name|family_?name|legal_?name|buyer_?name|seller_?name'
                                         '|owner_?name|person_?name|technician_?name|participant_?name|contact_?name)"\s*:')
     AND NOT (p_kind IN ('condition', 'media') AND COALESCE(p_data::text, '') ~* '(invoice|receipt|\$\s?[0-9])');
$function$;

CREATE OR REPLACE FUNCTION public.retained_powertrain_value(p_key text, p_raw jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE t text; m text[]; v text; vals text[]:=ARRAY[]::text[]; n numeric; unit text;
BEGIN
 IF jsonb_typeof(p_raw) IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
 t:=btrim(p_raw#>>'{}');
 IF t='' OR length(t)>500 OR t ~* '\m(unknown|unspecified|not|no|without|or)\M' THEN RETURN NULL; END IF;
 IF p_key='drivetrain_layout' THEN
  RETURN CASE WHEN t ~* '^(FWD|RWD|AWD|4WD)$' THEN to_jsonb(upper(t)) END;
 ELSIF p_key='transmission_type' THEN
  FOR m IN SELECT regexp_matches(lower(t),'\m(manual|automatic|cvt|semi)\M','g') LOOP
   IF NOT m[1]=ANY(vals) THEN vals:=array_append(vals,m[1]); END IF;
  END LOOP;
 ELSIF p_key='engine_configuration' THEN
  FOR m IN SELECT regexp_matches(lower(t),'\m(v|i|inline|flat)[-\s]?(2|3|4|5|6|8|10|12|16|two|three|four|five|six|eight|ten|twelve|sixteen)\M','g') LOOP
   v:=(CASE m[1] WHEN 'flat' THEN 'flat-' WHEN 'v' THEN 'V' ELSE 'I' END)||
    (CASE m[2] WHEN 'two' THEN '2' WHEN 'three' THEN '3' WHEN 'four' THEN '4' WHEN 'five' THEN '5'
     WHEN 'six' THEN '6' WHEN 'eight' THEN '8' WHEN 'ten' THEN '10' WHEN 'twelve' THEN '12' WHEN 'sixteen' THEN '16' ELSE m[2] END);
   IF NOT v=ANY(vals) THEN vals:=array_append(vals,v); END IF;
  END LOOP;
 ELSIF p_key='engine_displacement_l' THEN
  FOR m IN SELECT regexp_matches(lower(t),'(?<![-+.,\d])\m(\d+(?:,\d{3})*(?:\.\d+)?)\s*-?\s*(liter|litre|l|cc|ci)\M','g') LOOP
   vals:=array_append(vals,m[1]); unit:=m[2];
  END LOOP;
  IF cardinality(vals)<>1 THEN RETURN NULL; END IF;
  n:=replace(vals[1],',','')::numeric * CASE unit WHEN 'cc' THEN .001 WHEN 'ci' THEN .016387064 ELSE 1 END;
  RETURN CASE WHEN n>0 AND n<=30 THEN to_jsonb(round(n,6)) END;
 ELSE RETURN NULL;
 END IF;
 RETURN CASE WHEN cardinality(vals)=1 THEN to_jsonb(vals[1]) END;
END $function$;

CREATE OR REPLACE FUNCTION public.retained_description_property_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(public.retained_description_property_value_matches(p,o)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat' AND o.kind::text=ANY(s.supported_observations::text[]))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key=o.structured_data->>'property_key' AND r.namespace='core' AND r.deprecated_at IS NULL AND o.kind::text=ANY(r.applies_to_kinds::text[])),false);
$function$;

CREATE OR REPLACE FUNCTION public.retained_listing_identity_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(public.retained_listing_identity_value_matches(p,o)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND ((s.slug='bat' OR (s.slug='mecum' AND p.extraction_method='public_lot_index' AND o.structured_data->>'property_key' IN('year','make','model'))) OR public.retained_native_listing_source(p)) AND 'specification'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key=o.structured_data->>'property_key' AND r.namespace='core'
   AND r.deprecated_at IS NULL AND r.ratified_at IS NOT NULL AND r.unit IS NULL
   AND r.data_type=CASE WHEN o.structured_data->>'property_key'='year' THEN 'integer' ELSE 'string' END
   AND r.label=CASE o.structured_data->>'property_key' WHEN 'year' THEN 'Model Year' WHEN 'make' THEN 'Make' WHEN 'model' THEN 'Model' ELSE 'VIN' END
   AND 'specification'=ANY(r.applies_to_kinds)),false);
$function$;

CREATE OR REPLACE FUNCTION public.retained_craigslist_odometer_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(public.retained_craigslist_odometer_value_matches(p,o)
  AND public.observation_is_public(p.kind,p.structured_data)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='craigslist' AND 'listing'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key='mileage_miles' AND r.namespace='core' AND r.label='Odometer Reading (mi)' AND r.data_type='integer'
    AND r.unit='miles' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'listing'=ANY(r.applies_to_kinds)),false);
$function$;

CREATE OR REPLACE FUNCTION public.retained_craigslist_year_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(public.retained_craigslist_year_value_matches(p,o)
  AND public.observation_is_public(p.kind,p.structured_data)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='craigslist' AND 'listing'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key='year' AND r.namespace='core' AND r.label='Model Year' AND r.data_type='integer'
    AND r.unit IS NULL AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'listing'=ANY(r.applies_to_kinds)),false);
$function$;

CREATE OR REPLACE FUNCTION public.retained_description_year_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(public.retained_description_year_value_matches(p,o) AND public.observation_is_public(p.kind,p.structured_data)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key='year' AND r.namespace='core' AND r.label='Model Year' AND r.data_type='integer'
    AND r.unit IS NULL AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)),false);
$function$;

CREATE OR REPLACE FUNCTION public.retained_description_identity_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(public.retained_description_identity_value_matches(p,o) AND public.observation_is_public(p.kind,p.structured_data)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key=o.structured_data->>'property_key' AND r.property_key IN('make','model') AND r.namespace='core' AND r.label=CASE r.property_key WHEN 'make' THEN 'Make' ELSE 'Model' END AND r.data_type='string'
    AND r.unit IS NULL AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)),false);
$function$;

CREATE OR REPLACE FUNCTION public.retained_listing_property_result_matches(p_source uuid, p_property uuid, p_result uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '3s'
AS $function$
-- retained_bat_sale_properties_v1
 SELECT EXISTS(SELECT FROM public.vehicle_observations p JOIN public.vehicle_observations o ON o.id=p_result
  WHERE p.id=p_source AND o.property_id=p_property AND (public.retained_description_property_matches(p,o) OR public.retained_listing_identity_matches(p,o) OR public.retained_craigslist_odometer_matches(p,o) OR public.retained_craigslist_year_matches(p,o) OR public.retained_description_year_matches(p,o) OR public.retained_description_identity_matches(p,o))) OR EXISTS(SELECT 1 FROM public.vehicle_observations o
 JOIN public.vehicle_observations p ON p.id=p_source
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
  AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND (s.slug='bat' OR public.retained_native_listing_source(p))
 JOIN public.observation_properties r ON r.id=p_property AND r.namespace='core' AND r.deprecated_at IS NULL
 WHERE o.id=p_result AND o.id<>p.id AND o.source_observation_id=p.id AND o.property_id=r.id
 AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
 AND (((p.kind='listing' OR (p.kind='sale_result' AND p.source_id='4cdc735c-f117-42f2-889f-ba33805639a5'::uuid AND public.observation_is_public(p.kind,p.structured_data))) AND p.extraction_method='html_match') OR public.retained_native_listing_source(p)) AND p.is_superseded IS FALSE
 AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
 AND (p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$' OR public.retained_native_listing_source(p))
 AND p.confidence_score BETWEEN 0.6 AND 1 AND isfinite(p.ingested_at)
 AND (p.observed_at IS NULL OR isfinite(p.observed_at))
 AND o.kind='specification' AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
 AND o.extraction_method='retained_listing_property_projection_v1' AND o.observed_at=p.ingested_at
 AND o.raw_source_ref='vehicle_observations:'||p.id::text AND o.confidence_score BETWEEN 0 AND 0.6
 AND o.agent_cost_cents=0 AND o.content_hash IS NOT NULL
 AND r.property_key IN('interior_color','exterior_color','engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout') AND 'specification'=ANY(r.applies_to_kinds)
 AND o.source_identifier='retained_listing_'||r.property_key||'_v1:'||p.id::text
 AND o.structured_data->>'source_observation_id'=p.id::text
 AND o.structured_data->>'property_key'=r.property_key AND o.structured_data->>'claim_role'='listing_claim'
 AND o.structured_data->>'observed_at_basis'='source_testimony_recorded_at'
 AND o.structured_data->>'source_field'=CASE r.property_key WHEN 'exterior_color' THEN 'color' WHEN 'interior_color' THEN 'interior_color'
  WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END
 AND ((r.property_key IN('interior_color','exterior_color') AND o.structured_data->r.property_key=p.structured_data->(CASE r.property_key WHEN 'exterior_color' THEN 'color' WHEN 'interior_color' THEN 'interior_color'
  WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END)) OR
  (r.property_key IN('engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout')
   AND o.structured_data->r.property_key=public.retained_powertrain_value(r.property_key,p.structured_data->(CASE r.property_key WHEN 'exterior_color' THEN 'color' WHEN 'interior_color' THEN 'interior_color'
  WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END))
   AND o.structured_data->'source_value'=p.structured_data->(CASE r.property_key WHEN 'exterior_color' THEN 'color' WHEN 'interior_color' THEN 'interior_color'
  WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END)
   AND o.structured_data->>'normalization_version'='retained_powertrain_v1'))
 AND o.structured_data->>'projection_version'='retained_listing_'||r.property_key||'_v1'
 AND o.structured_data->>'analysis_kind'='retained_listing_property_projection'
 AND (o.structured_data->>'source_recorded_at')::timestamptz=p.ingested_at
 AND (o.structured_data->>'source_observed_at')::timestamptz IS NOT DISTINCT FROM p.observed_at
 AND o.structured_data->'source_confidence_score'=to_jsonb(p.confidence_score)
 AND o.structured_data->>'source_extraction_method'=p.extraction_method
 AND o.structured_data->>'factory_configuration_status'='unknown'
 AND o.structured_data->>'current_configuration_status'='unknown'
 AND o.structured_data->'independent_source'='false'::jsonb);
$function$;

-- Minimal reader holding the live anchor verbatim (the line the migration replaces, with its context).
CREATE FUNCTION public.vehicle_facet_items(p_vehicle_id uuid, p_dimension text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE AS $function$
-- facet_items_v1
WITH o AS (
  SELECT ob.id, ob.extraction_method AS method, ob.source_observation_id, ob.property_id
  FROM public.vehicle_observations ob WHERE ob.vehicle_id = p_vehicle_id AND ob.property_id IS NOT NULL
)
SELECT coalesce(jsonb_agg(o.id ORDER BY o.id), '[]'::jsonb)
  FROM o
  WHERE true
    AND (o.method IS DISTINCT FROM 'retained_listing_property_projection_v1'
         OR public.retained_listing_property_result_matches(o.source_observation_id, o.property_id, o.id))
    AND (o.method IS DISTINCT FROM 'vehicle_title_facet_projection_v1' OR true)
$function$;

-- Fixture rows. One public car; three registry rows; one listing per source; for each a well-formed projection of its
-- exterior colour (admitted by the matcher's second EXISTS), on 'other_house' also a malformed one the matcher refuses,
-- and one row of another method that the reader keeps regardless.
INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-0000000000a1', true, NULL, NULL);
INSERT INTO public.observation_sources VALUES
  ('00000000-0000-0000-0000-00000000b001', 'bat', '{listing,specification}'),
  ('00000000-0000-0000-0000-00000000b002', 'craigslist', '{listing}'),
  ('00000000-0000-0000-0000-00000000b003', 'other_house', '{listing}');
INSERT INTO public.observation_properties VALUES
  ('00000000-0000-0000-0000-00000000c001', 'exterior_color', 'Exterior Color', 'string', NULL, 'core', '{specification}', now(), NULL),
  ('00000000-0000-0000-0000-00000000c002', 'year', 'Model Year', 'integer', NULL, 'core', '{listing,specification}', now(), NULL);
INSERT INTO public.vehicle_observations (id, vehicle_id, observed_at, ingested_at, source_id, source_url, kind, structured_data,
  confidence_score, extraction_method, property_id, source_observation_id)
SELECT ('00000000-0000-0000-0000-00000000d00' || n)::uuid, '00000000-0000-0000-0000-0000000000a1', NULL,
       ('2026-01-0' || n || ' 12:00:00+00')::timestamptz, ('00000000-0000-0000-0000-00000000b00' || n)::uuid,
       'https://bringatrailer.com/listing/fixture-' || n || '/', 'listing', '{"color": "Red"}', 0.8, 'html_match', NULL, NULL
FROM generate_series(1, 3) n;
INSERT INTO public.vehicle_observations (id, vehicle_id, observed_at, ingested_at, source_id, source_url, source_identifier, kind,
  content_hash, structured_data, confidence_score, extraction_method, raw_source_ref, agent_cost_cents, property_id,
  source_observation_id)
SELECT ('00000000-0000-0000-0000-00000000e' || lpad(n::text, 3, '0'))::uuid, p.vehicle_id, p.ingested_at, now(), p.source_id,
       p.source_url, 'retained_listing_exterior_color_v1:' || p.id, 'specification', 'fixture',
       jsonb_build_object('source_observation_id', p.id, 'property_key', 'exterior_color', 'claim_role', 'listing_claim',
         'observed_at_basis', 'source_testimony_recorded_at', 'source_field', 'color', 'exterior_color', 'Red',
         'projection_version', 'retained_listing_exterior_color_v1', 'analysis_kind', 'retained_listing_property_projection',
         'source_recorded_at', p.ingested_at, 'source_observed_at', p.observed_at,
         'source_confidence_score', p.confidence_score, 'source_extraction_method', p.extraction_method,
         'factory_configuration_status', 'unknown', 'current_configuration_status', 'unknown', 'independent_source', false),
       0.5, 'retained_listing_property_projection_v1',
       CASE WHEN n = 4 THEN 'vehicle_observations:malformed' ELSE 'vehicle_observations:' || p.id END, 0,
       '00000000-0000-0000-0000-00000000c001', p.id
FROM generate_series(1, 4) n
JOIN public.vehicle_observations p ON p.id = ('00000000-0000-0000-0000-00000000d00' || least(n, 3))::uuid;
INSERT INTO public.vehicle_observations (id, vehicle_id, observed_at, ingested_at, source_id, kind, structured_data,
  confidence_score, extraction_method, property_id)
VALUES ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', now(), now(),
        '00000000-0000-0000-0000-00000000b003', 'specification', '{}', 0.5, 'manual_entry', '00000000-0000-0000-0000-00000000c002');

-- Readings: the reader's output and the per-row gate/matcher truth table, for one state and caller.
CREATE TEMP TABLE reading (phase text, state text, who text, out jsonb, hidden int, admitted int);
CREATE FUNCTION pg_temp.set_state(p_state text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  DROP POLICY IF EXISTS fixture_anon_read ON public.observation_sources;
  IF p_state = 'all' THEN
    CREATE POLICY fixture_anon_read ON public.observation_sources FOR SELECT TO anon USING (true);
  ELSIF p_state = 'some' THEN
    CREATE POLICY fixture_anon_read ON public.observation_sources FOR SELECT TO anon USING (slug = 'bat');
  END IF;
END $f$;
CREATE FUNCTION pg_temp.read_all(p_phase text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE st text; r text; o jsonb; hid int; adm int;
BEGIN
  FOREACH st IN ARRAY ARRAY['none', 'all', 'some'] LOOP
    PERFORM pg_temp.set_state(st);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'postgres'] LOOP
      EXECUTE format('SET ROLE %I', r);
      -- Dynamic SQL: a fresh plan per caller, as each API request gets (a plpgsql simple expression would keep the SQL
      -- function's plan, with the first caller's row policies planned in, across SET ROLE).
      EXECUTE 'SELECT public.vehicle_facet_items(''00000000-0000-0000-0000-0000000000a1'')' INTO o;
      -- The gate exactly as the migration writes it, against the matcher, row by row.
      EXECUTE $q$SELECT count(*) FILTER (WHERE NOT g AND m), count(*) FILTER (WHERE m)
      FROM (SELECT EXISTS (SELECT 1 FROM public.vehicle_observations gp JOIN public.observation_sources gs ON gs.id = gp.source_id
                           WHERE gp.id = x.source_observation_id) AS g,
                   public.retained_listing_property_result_matches(x.source_observation_id, x.property_id, x.id) AS m
            FROM public.vehicle_observations x WHERE x.extraction_method = 'retained_listing_property_projection_v1') z$q$
        INTO hid, adm;
      RESET ROLE;
      INSERT INTO reading VALUES (p_phase, st, r, o, hid, adm);
    END LOOP;
  END LOOP;
  PERFORM pg_temp.set_state('none');
END $f$;

SELECT pg_temp.read_all('before');
CREATE TEMP TABLE body_before AS SELECT prosrc FROM pg_proc WHERE oid = 'public.vehicle_facet_items(uuid,text)'::regprocedure;

-- The guard refuses a body it does not know (no contract setting): the reader stays unpatched.
\set ON_ERROR_STOP off
\ir ../migrations/20261126001500_facet_retained_matcher_caller_gate.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.vehicle_facet_items(uuid,text)'::regprocedure) <> (SELECT prosrc FROM body_before) THEN
    RAISE EXCEPTION 'FAIL guard: the migration patched an unknown body';
  END IF;
  RAISE NOTICE 'PASS guard refuses an unknown vehicle_facet_items body';
END $$;

-- The premise guard refuses when a matcher becomes SECURITY DEFINER.
SET nuke.facet_gate_contract = 'on';
ALTER FUNCTION public.retained_craigslist_year_matches(public.vehicle_observations, public.vehicle_observations) SECURITY DEFINER;
\set ON_ERROR_STOP off
\ir ../migrations/20261126001500_facet_retained_matcher_caller_gate.sql
\set ON_ERROR_STOP on
ALTER FUNCTION public.retained_craigslist_year_matches(public.vehicle_observations, public.vehicle_observations) SECURITY INVOKER;
DO $$ BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.vehicle_facet_items(uuid,text)'::regprocedure) <> (SELECT prosrc FROM body_before) THEN
    RAISE EXCEPTION 'FAIL premise guard: patched while a matcher was SECURITY DEFINER';
  END IF;
  RAISE NOTICE 'PASS premise guard refuses a SECURITY DEFINER matcher';
END $$;

-- Apply (twice: idempotent).
\ir ../migrations/20261126001500_facet_retained_matcher_caller_gate.sql
\ir ../migrations/20261126001500_facet_retained_matcher_caller_gate.sql
RESET nuke.facet_gate_contract;
SELECT pg_temp.read_all('after');

DO $$
DECLARE n int; r record;
BEGIN
  IF position('retained_matcher_caller_gate_v1' IN pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL apply: marker missing';
  END IF;
  IF (SELECT count(*) FROM reading WHERE phase = 'after') <> 9 THEN RAISE EXCEPTION 'FAIL: expected 9 readings'; END IF;
  -- 1. The gate never hides a row the matcher admits.
  SELECT count(*) INTO n FROM reading WHERE hidden <> 0;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL implication: NOT gate AND matcher on % readings', n; END IF;
  RAISE NOTICE 'PASS NOT gate => NOT matcher on every projection row, 3 registry states x 3 callers';
  -- 2. Output identical.
  SELECT count(*) INTO n FROM reading a JOIN reading b USING (state, who)
   WHERE a.phase = 'before' AND b.phase = 'after' AND md5(a.out::text) IS DISTINCT FROM md5(b.out::text);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL md5: % of 9 readings differ before/after', n; END IF;
  RAISE NOTICE 'PASS reader output md5-identical before/after, 9 of 9';
  -- 3. Not vacuous: what each caller admits, by state.
  FOR r IN SELECT state, who, admitted, jsonb_array_length(out) AS kept FROM reading WHERE phase = 'after' LOOP
    IF r.admitted <> (CASE WHEN r.who <> 'anon' OR r.state = 'all' THEN 3 WHEN r.state = 'some' THEN 1 ELSE 0 END)
       OR r.kept <> r.admitted + 1 THEN
      RAISE EXCEPTION 'FAIL fixture: % as % admitted % kept %', r.state, r.who, r.admitted, r.kept;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS anon admits 0 / 3 / 1 projections (registry none / all / bat only); signed-in and owner 3 in every state';
END $$;

-- 4. Mutants: each must change the output where anon can read the registry.
CREATE FUNCTION pg_temp.mutate(p_gate text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE d text := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  g constant text := 'EXISTS (SELECT 1 FROM public.vehicle_observations gp JOIN public.observation_sources gs ON gs.id = gp.source_id
                     WHERE gp.id = o.source_observation_id)';
BEGIN
  IF position(g IN d) = 0 THEN RAISE EXCEPTION 'mutant: gate text not found'; END IF;
  EXECUTE replace(d, g, p_gate);
END $f$;
CREATE TEMP TABLE body_after AS SELECT pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure) AS d;
SELECT pg_temp.mutate('false');
SELECT pg_temp.read_all('mutant_false');
DO $$ BEGIN EXECUTE (SELECT d FROM body_after); END $$;
SELECT pg_temp.mutate('current_user <> ''anon''');
SELECT pg_temp.read_all('mutant_role');
DO $$ BEGIN EXECUTE (SELECT d FROM body_after); END $$;
DO $$
DECLARE a int; b int;
BEGIN
  SELECT count(*) INTO a FROM reading x JOIN reading y USING (state, who)
   WHERE x.phase = 'before' AND y.phase = 'mutant_false' AND x.out <> y.out;
  SELECT count(*) INTO b FROM reading x JOIN reading y USING (state, who)
   WHERE x.phase = 'before' AND y.phase = 'mutant_role' AND x.out <> y.out AND x.state IN ('all', 'some') AND x.who = 'anon';
  IF a = 0 OR b <> 2 THEN RAISE EXCEPTION 'FAIL mutants survived: false % differ, role-name % of 2 differ', a, b; END IF;
  RAISE NOTICE 'PASS mutants killed: gate=false changes % readings; a role-name gate changes anon''s output under registry all and bat', a;
END $$;

-- 5. Revert restores the body byte for byte (and is idempotent).
\ir revert_20261126001500_facet_retained_matcher_caller_gate.sql
\ir revert_20261126001500_facet_retained_matcher_caller_gate.sql
DO $$ BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.vehicle_facet_items(uuid,text)'::regprocedure) <> (SELECT prosrc FROM body_before) THEN
    RAISE EXCEPTION 'FAIL revert: body differs from before';
  END IF;
  RAISE NOTICE 'PASS revert restores the body';
END $$;

-- 6. A matcher that no longer depends on the registry (its own observation_sources join replaced by a constant row)
--    breaks the premise: the per-row truth table must then find rows the gate would hide (anon, registry none and
--    bat only), and the migration's premise guard must refuse to gate it (the matcher's hash changed).
CREATE TEMP TABLE matcher_live AS
  SELECT pg_get_functiondef('public.retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure) AS d;
DO $$
DECLARE d text := (SELECT d FROM matcher_live);
  a constant text := $a$JOIN public.observation_sources s ON s.id=p.source_id AND (s.slug='bat' OR public.retained_native_listing_source(p))$a$;
BEGIN
  IF position(a IN d) = 0 THEN RAISE EXCEPTION 'matcher mutant: registry join not found'; END IF;
  EXECUTE replace(d, a, $m$JOIN LATERAL (SELECT p.source_id AS id, 'bat'::text AS slug) s ON s.id=p.source_id AND (s.slug='bat' OR public.retained_native_listing_source(p))$m$);
END $$;
SELECT pg_temp.read_all('matcher_without_registry');
SET nuke.facet_gate_contract = 'on';
\set ON_ERROR_STOP off
\ir ../migrations/20261126001500_facet_retained_matcher_caller_gate.sql
\set ON_ERROR_STOP on
RESET nuke.facet_gate_contract;
DO $$
DECLARE h_none int; h_some int;
BEGIN
  SELECT hidden INTO h_none FROM reading WHERE phase = 'matcher_without_registry' AND state = 'none' AND who = 'anon';
  SELECT hidden INTO h_some FROM reading WHERE phase = 'matcher_without_registry' AND state = 'some' AND who = 'anon';
  IF h_none <> 3 OR h_some <> 2 THEN
    RAISE EXCEPTION 'FAIL matcher mutant not detected: hidden rows anon none % (want 3), bat only % (want 2)', h_none, h_some;
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.vehicle_facet_items(uuid,text)'::regprocedure) <> (SELECT prosrc FROM body_before) THEN
    RAISE EXCEPTION 'FAIL premise guard: gated a matcher that does not read the registry';
  END IF;
  RAISE NOTICE 'PASS a matcher without its registry join is caught: gate would hide 3 / 2 anon rows, and the migration refuses';
END $$;
DO $$ BEGIN EXECUTE (SELECT d FROM matcher_live); END $$;
