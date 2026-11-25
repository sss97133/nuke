-- Contract for 20261126063500_retained_projection_verdicts (empty disposable PG17).
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in an empty disposable PG17 database only (stub tables, not production).
-- The root matcher and the six retained_*_matches it calls are installed from their live definitions (2026-11-25); the
-- value tests they call are stubbed TRUE and retained_native_listing_source FALSE, so the root admits through its second
-- EXISTS and depends on the car's visibility, the source slug, the property row, p's supersession and content, and o.
-- The claim, checked after every step as anon, a signed-in stranger and the owner:
--   E. for every projection, coalesce(the stored verdict as read by retained_projection_verdicts_for, the live
--      matcher as owner) = the live matcher as owner. A counted verdict is never wrong; a stale one is no answer.
-- Steps: grade; drift each input (p superseded, o superseded, p content, o agent_cost_cents, the car hidden, a
-- vehicles URL, the source slug, the property deprecated, a closure body replaced, a function added to the closure);
-- regrade; the clock rule; the column-set check over every vehicles column; pauses; the revert.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_observations') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- pg_cron, as far as the migration and the tick use it
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE TABLE cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, status text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
  'INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) RETURNING jobid';
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS 'DELETE FROM cron.job WHERE jobname = n RETURNING true';

CREATE TABLE public.platform_config (id bigserial PRIMARY KEY, config_key text UNIQUE NOT NULL, config_value jsonb,
  description text, updated_at timestamptz DEFAULT now(), updated_by text);
CREATE TABLE public.monitored_auctions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_live boolean, auction_end_time timestamptz);
CREATE TABLE public.private_row_policy_copies (reader text, relation text, policy_filter text, recorded_hash text,
  owner_lane text, note text, recorded_at timestamptz DEFAULT now(), active boolean DEFAULT true,
  PRIMARY KEY (reader, relation, policy_filter));
CREATE FUNCTION public.private_row_policy_hash(p_relation text, p_policy_filter text)
  RETURNS TABLE (policy_hash text, policies int) LANGUAGE sql AS $f$ SELECT md5('fixture'), 0 $f$;

CREATE TYPE public.observation_kind AS ENUM ('listing','sale_result','comment','bid','sighting','work_record','ownership',
  'specification','provenance','valuation','condition','media','social_mention','expert_opinion','splice','activity','offer',
  'contributor_answer');
-- vehicles: the columns the closure reads, plus two it does not (title, updated_at)
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, listing_kind text,
  listing_url text, discovery_url text, year int, make text, model text, title text, updated_at timestamptz);
CREATE TABLE public.observation_sources (id uuid PRIMARY KEY, slug text UNIQUE, supported_observations public.observation_kind[],
  notes text);
CREATE TABLE public.schema_proposals (id uuid PRIMARY KEY, status text, promoted_to_id uuid);
CREATE TABLE public.observation_properties (id uuid PRIMARY KEY, property_key text, label text, data_type text, unit text,
  namespace text, applies_to_kinds public.observation_kind[], ratified_at timestamptz, deprecated_at timestamptz,
  cardinality text, verification_scope text, parent_property_id uuid, discriminator_key text, proposed_by_proposal_id uuid);
CREATE TABLE public.listing_page_snapshots (id uuid PRIMARY KEY, success boolean, http_status int, platform text,
  listing_url text, html_sha256 text, metadata jsonb, fetched_at timestamptz, created_at timestamptz, html text);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid, observed_at timestamptz, ingested_at timestamptz,
  source_id uuid, source_url text, source_identifier text, kind public.observation_kind, content_hash text, structured_data jsonb,
  content_text text, extraction_metadata jsonb, confidence_score numeric, is_superseded boolean DEFAULT false,
  superseded_by uuid, extraction_method text, raw_source_ref text, agent_cost_cents numeric, agent_model text,
  property_id uuid, subject_type text DEFAULT 'vehicle', subject_id uuid, source_observation_id uuid, is_processed boolean);
CREATE INDEX ON public.vehicle_observations (ingested_at DESC);
CREATE INDEX ON public.vehicle_observations (source_identifier, kind);
GRANT SELECT ON public.vehicles, public.observation_properties, public.vehicle_observations TO anon, authenticated;
ALTER TABLE public.observation_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated_read_observation_sources ON public.observation_sources FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.observation_sources TO anon, authenticated;

-- Stubs (header).
CREATE FUNCTION public.retained_native_listing_source(p public.vehicle_observations) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
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
$function$

;

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
END $function$

;

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
$function$

;

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
$function$

;

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
$function$

;

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
$function$

;

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
$function$

;

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
$function$

;

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
$function$

;


-- Fixtures. Cars: A public (projections 1-9), C public (10), B private (11). One BaT listing p per projection, each
-- projecting its exterior colour; projection 9's p is ingested an hour ahead (the clock rule).
INSERT INTO public.vehicles (id, is_public, listing_url, year, make, model, title) VALUES
  ('00000000-0000-0000-0000-0000000000a1', true, 'https://bringatrailer.com/listing/a/', 1973, 'Fixture', 'One', 't'),
  ('00000000-0000-0000-0000-0000000000c1', true, 'https://bringatrailer.com/listing/c/', 1970, 'Fixture', 'Two', 't'),
  ('00000000-0000-0000-0000-0000000000b1', false, NULL, 1980, 'Fixture', 'Three', 't');
INSERT INTO public.observation_sources VALUES
  ('00000000-0000-0000-0000-00000000b001', 'bat', '{listing,specification}', 'internal');
INSERT INTO public.schema_proposals VALUES ('00000000-0000-0000-0000-0000000005a1', 'approved', '00000000-0000-0000-0000-00000000c001');
INSERT INTO public.observation_properties (id, property_key, label, data_type, namespace, applies_to_kinds, ratified_at, proposed_by_proposal_id) VALUES
  ('00000000-0000-0000-0000-00000000c001', 'exterior_color', 'Exterior Color', 'string', 'core', '{specification}', now(), '00000000-0000-0000-0000-0000000005a1');
INSERT INTO public.listing_page_snapshots VALUES
  ('00000000-0000-0000-0000-0000000005b1', true, 200, 'bat', 'https://bringatrailer.com/listing/fixture-1/', repeat('a', 64), '{}', now(), now(), '<html>');
INSERT INTO public.vehicle_observations (id, vehicle_id, observed_at, ingested_at, source_id, source_url, kind, structured_data,
  confidence_score, extraction_method, extraction_metadata)
SELECT ('00000000-0000-0000-0000-00000000d' || lpad(n::text, 3, '0'))::uuid,
       CASE WHEN n = 10 THEN '00000000-0000-0000-0000-0000000000c1' WHEN n = 11 THEN '00000000-0000-0000-0000-0000000000b1'
            ELSE '00000000-0000-0000-0000-0000000000a1' END::uuid,
       NULL, CASE WHEN n = 9 THEN now() + interval '1 hour' ELSE '2026-01-01 12:00:00+00'::timestamptz + make_interval(mins => n) END,
       '00000000-0000-0000-0000-00000000b001', 'https://bringatrailer.com/listing/fixture-' || n || '/', 'listing',
       '{"color": "Red"}', 0.8, 'html_match',
       CASE WHEN n = 1 THEN '{"snapshot_id": "00000000-0000-0000-0000-0000000005b1"}'::jsonb END
FROM generate_series(1, 11) n;
INSERT INTO public.vehicle_observations (id, vehicle_id, observed_at, ingested_at, source_id, source_url, source_identifier, kind,
  content_hash, structured_data, confidence_score, extraction_method, raw_source_ref, agent_cost_cents, property_id,
  source_observation_id)
SELECT ('00000000-0000-0000-0000-00000000e' || lpad(n::text, 3, '0'))::uuid, p.vehicle_id, p.ingested_at, now() - interval '1 day',
       p.source_id, p.source_url, 'retained_listing_exterior_color_v1:' || p.id, 'specification', 'fixture',
       jsonb_build_object('source_observation_id', p.id, 'property_key', 'exterior_color', 'claim_role', 'listing_claim',
         'observed_at_basis', 'source_testimony_recorded_at', 'source_field', 'color', 'exterior_color', 'Red',
         'projection_version', 'retained_listing_exterior_color_v1', 'analysis_kind', 'retained_listing_property_projection',
         'source_recorded_at', p.ingested_at, 'source_observed_at', p.observed_at,
         'source_confidence_score', p.confidence_score, 'source_extraction_method', p.extraction_method,
         'factory_configuration_status', 'unknown', 'current_configuration_status', 'unknown', 'independent_source', false),
       0.5, 'retained_listing_property_projection_v1', 'vehicle_observations:' || p.id, 0,
       '00000000-0000-0000-0000-00000000c001', p.id
FROM generate_series(1, 11) n
JOIN public.vehicle_observations p ON p.id = ('00000000-0000-0000-0000-00000000d' || lpad(n::text, 3, '0'))::uuid;

\ir ../migrations/20261126063500_retained_projection_verdicts.sql
\ir ../migrations/20261126063500_retained_projection_verdicts.sql

-- E, as one caller: rows where a counted verdict differs from the live matcher (as owner, computed first).
CREATE FUNCTION pg_temp.check_e(p_step text, p_expect_counted int DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r text; bad int; counted int; ids uuid[]; ms boolean[];
BEGIN
  SELECT array_agg(o.id ORDER BY o.id),
         array_agg(coalesce(public.retained_listing_property_result_matches(o.source_observation_id, o.property_id, o.id), false) ORDER BY o.id)
    INTO ids, ms
    FROM public.vehicle_observations o WHERE o.extraction_method = 'retained_listing_property_projection_v1';
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'postgres'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    EXECUTE 'SELECT count(*) FILTER (WHERE v.admitted IS DISTINCT FROM t.m), count(*)
               FROM public.retained_projection_verdicts_for($1) v JOIN unnest($1, $2) t(id, m) ON t.id = v.projection_id'
      INTO bad, counted USING ids, ms;
    RESET ROLE;
    IF bad > 0 THEN RAISE EXCEPTION 'FAIL E at %: % counted verdicts differ from the matcher as %', p_step, bad, r; END IF;
    IF p_expect_counted IS NOT NULL AND counted <> p_expect_counted THEN
      RAISE EXCEPTION 'FAIL at %: % counted verdicts as %, want %', p_step, counted, r, p_expect_counted;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS E at %: counted % of %, admitted by matcher %', p_step, counted, cardinality(ids),
    (SELECT count(*) FROM unnest(ms) m WHERE m);
END $f$;
CREATE FUNCTION pg_temp.counted(p_id uuid) RETURNS boolean LANGUAGE sql AS
  $f$ SELECT EXISTS (SELECT 1 FROM public.retained_projection_verdicts_for(ARRAY[p_id])) $f$;

SELECT pg_temp.check_e('before any grading', 0);
DO $$ BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'retained-projection-grade') <> 1 THEN RAISE EXCEPTION 'FAIL job not scheduled once'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.private_row_policy_copies WHERE reader = 'retained_projection_verdicts_for(uuid[])') THEN
    RAISE EXCEPTION 'FAIL policy copy not registered'; END IF;
  IF has_function_privilege('anon', 'public.retained_projection_grade_ids(uuid[], text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.retained_projection_verdicts', 'SELECT')
     OR NOT has_function_privilege('anon', 'public.retained_projection_verdicts_for(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL grants'; END IF;
  RAISE NOTICE 'PASS job scheduled once, policy copy registered, grants (anon executes the read only)';
END $$;

-- Pauses: a live lot closing within 15 minutes, then a watched job whose last run failed.
INSERT INTO public.monitored_auctions (is_live, auction_end_time) VALUES (true, now() + interval '5 minutes');
CALL public.retained_projection_grade_tick();
DO $$ BEGIN
  IF (SELECT count(*) FROM public.retained_projection_verdicts) <> 0
     OR (SELECT last_run->>'paused' FROM public.retained_projection_grading_state) NOT LIKE 'lots closing%' THEN
    RAISE EXCEPTION 'FAIL pause on closing lots'; END IF;
  RAISE NOTICE 'PASS paused while a lot closes within 15 minutes';
END $$;
DELETE FROM public.monitored_auctions;
INSERT INTO cron.job (jobname) VALUES ('bat-live-pull');
INSERT INTO cron.job_run_details (jobid, status) SELECT jobid, 'failed' FROM cron.job WHERE jobname = 'bat-live-pull';
CALL public.retained_projection_grade_tick();
DO $$ BEGIN
  IF (SELECT count(*) FROM public.retained_projection_verdicts) <> 0
     OR (SELECT last_run->>'paused' FROM public.retained_projection_grading_state) NOT LIKE '%failed' THEN
    RAISE EXCEPTION 'FAIL pause on a failing watched job'; END IF;
  RAISE NOTICE 'PASS paused while bat-live-pull''s last run failed';
END $$;
INSERT INTO cron.job_run_details (jobid, status) SELECT jobid, 'succeeded' FROM cron.job WHERE jobname = 'bat-live-pull';

-- Grade: the tail sees nothing settled (projections were ingested a day ago, before the watermark), the backfill all 11.
CALL public.retained_projection_grade_tick();
DO $$ BEGIN
  IF (SELECT count(*) FROM public.retained_projection_verdicts) <> 11
     OR NOT (SELECT backfill_done FROM public.retained_projection_grading_state) THEN
    RAISE EXCEPTION 'FAIL backfill: % verdicts', (SELECT count(*) FROM public.retained_projection_verdicts); END IF;
  RAISE NOTICE 'PASS backfill graded 11, run %', (SELECT last_run FROM public.retained_projection_grading_state);
END $$;
DO $$ DECLARE g jsonb := public.retained_projection_verdict_gauge(); BEGIN
  IF (g->>'verdicts')::int <> 11 OR (g->>'backfill_done')::boolean IS NOT TRUE OR (g->>'body_key_live')::boolean IS NOT TRUE
     OR (g->>'closure_functions')::int < 16 THEN RAISE EXCEPTION 'FAIL gauge %', g; END IF;
  RAISE NOTICE 'PASS gauge: %', g;
END $$;
-- Counted: 1-8 and 10 (A and C public); not 9 (p ingested after graded_at: the clock rule), not 11 (car B private).
SELECT pg_temp.check_e('after grading', 9);
DO $$ BEGIN
  IF pg_temp.counted('00000000-0000-0000-0000-00000000e009') OR pg_temp.counted('00000000-0000-0000-0000-00000000e011') THEN
    RAISE EXCEPTION 'FAIL clock rule or private car'; END IF;
  IF (SELECT count(*) FROM public.retained_projection_verdicts WHERE admitted) < 8 THEN
    RAISE EXCEPTION 'FAIL fixture: the matcher should admit projections 1-8 and 10'; END IF;
  RAISE NOTICE 'PASS non-vacuous: % admitted verdicts; the future-ingested p and the private car are not counted',
    (SELECT count(*) FROM public.retained_projection_verdicts WHERE admitted);
END $$;

-- Drift, one input per projection. Each makes the matcher false (or changes a read column) without regrading.
UPDATE public.vehicle_observations SET is_superseded = true WHERE id = '00000000-0000-0000-0000-00000000d001';   -- p superseded
UPDATE public.vehicle_observations SET is_superseded = true WHERE id = '00000000-0000-0000-0000-00000000e002';   -- o superseded
UPDATE public.vehicle_observations SET confidence_score = 0.5 WHERE id = '00000000-0000-0000-0000-00000000d003'; -- p content
UPDATE public.vehicle_observations SET agent_cost_cents = 1 WHERE id = '00000000-0000-0000-0000-00000000e004';  -- o agent cost
UPDATE public.vehicle_observations SET is_processed = true WHERE id = '00000000-0000-0000-0000-00000000d005';   -- p, unread column
UPDATE public.vehicles SET is_public = false WHERE id = '00000000-0000-0000-0000-0000000000c1';                  -- car C hidden
SELECT pg_temp.check_e('after per-row drift', 3);
DO $$ BEGIN
  IF pg_temp.counted('00000000-0000-0000-0000-00000000e001') OR pg_temp.counted('00000000-0000-0000-0000-00000000e002')
     OR pg_temp.counted('00000000-0000-0000-0000-00000000e003') OR pg_temp.counted('00000000-0000-0000-0000-00000000e004')
     OR pg_temp.counted('00000000-0000-0000-0000-00000000e005') OR pg_temp.counted('00000000-0000-0000-0000-00000000e010') THEN
    RAISE EXCEPTION 'FAIL a drifted verdict still counts'; END IF;
  RAISE NOTICE 'PASS each drifted verdict stops counting (an unread p column too: false stale, never false fresh)';
END $$;
UPDATE public.vehicles SET listing_url = 'https://bringatrailer.com/listing/a2/' WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.check_e('after a vehicles URL change', 0);
UPDATE public.listing_page_snapshots SET http_status = 404;
DO $$ BEGIN
  IF (SELECT input_fp FROM public.retained_projection_input_fps(ARRAY['00000000-0000-0000-0000-00000000e001'::uuid]))
     = (SELECT input_fp FROM public.retained_projection_verdicts WHERE projection_id = '00000000-0000-0000-0000-00000000e001') THEN
    RAISE EXCEPTION 'FAIL a snapshot change left the fingerprint unchanged'; END IF;
  RAISE NOTICE 'PASS a snapshot change moves the fingerprint';
END $$;

-- Regrade: the sweep finds every stale verdict and the answers count again, equal to the matcher.
UPDATE public.vehicles SET is_public = true WHERE id = '00000000-0000-0000-0000-0000000000c1';
CALL public.retained_projection_grade_tick();
SELECT pg_temp.check_e('after regrading', 9);
DO $$ BEGIN
  IF (SELECT (last_run->>'stale')::int FROM public.retained_projection_grading_state) < 9 THEN
    RAISE EXCEPTION 'FAIL sweep stale count %', (SELECT last_run FROM public.retained_projection_grading_state); END IF;
  RAISE NOTICE 'PASS sweep regraded: %', (SELECT last_run FROM public.retained_projection_grading_state);
END $$;

-- Registry drift: the source slug, then the property deprecated (the registry row lost the property).
UPDATE public.observation_sources SET slug = 'bat_renamed';
SELECT pg_temp.check_e('after the source slug changed', 0);
CALL public.retained_projection_grade_tick();
SELECT pg_temp.check_e('after regrading the slug change', 9);
UPDATE public.observation_sources SET slug = 'bat';
CALL public.retained_projection_grade_tick();
UPDATE public.observation_properties SET deprecated_at = now();
SELECT pg_temp.check_e('after the property was deprecated', 0);
CALL public.retained_projection_grade_tick();
SELECT pg_temp.check_e('after regrading the deprecation', 9);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.retained_projection_verdicts WHERE admitted) THEN RAISE EXCEPTION 'FAIL deprecated property still admitted'; END IF;
  RAISE NOTICE 'PASS a deprecated property regrades every verdict to refused';
END $$;
UPDATE public.observation_properties SET deprecated_at = NULL;
CALL public.retained_projection_grade_tick();

-- Body drift: a closure function replaced, then a new function called from the closure and changed afterwards.
CREATE OR REPLACE FUNCTION public.retained_listing_identity_value_matches(p public.vehicle_observations, o public.vehicle_observations)
  RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true -- replaced';
SELECT pg_temp.check_e('after a closure body changed', 0);
CREATE FUNCTION public.retained_fixture_new_helper() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
CREATE OR REPLACE FUNCTION public.retained_listing_identity_value_matches(p public.vehicle_observations, o public.vehicle_observations)
  RETURNS boolean LANGUAGE sql STABLE AS 'SELECT public.retained_fixture_new_helper()';
CALL public.retained_projection_grade_tick();
SELECT pg_temp.check_e('after regrading the body change', 9);
CREATE OR REPLACE FUNCTION public.retained_fixture_new_helper() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true -- changed';
SELECT pg_temp.check_e('after a newly called function changed', 0);
CALL public.retained_projection_grade_tick();
SELECT pg_temp.check_e('after regrading it', 9);

-- Column set: every vehicles column, changed alone. When the matcher's answer moves, the fingerprint must move.
DO $$
DECLARE c record; before_fp text; after_fp text; before_m boolean; after_m boolean; checked int := 0; flips int := 0;
  e uuid := '00000000-0000-0000-0000-00000000e006';
BEGIN
  FOR c IN SELECT attname, format_type(atttypid, atttypmod) AS ty FROM pg_attribute
            WHERE attrelid = 'public.vehicles'::regclass AND attnum > 0 AND NOT attisdropped AND attname <> 'id' LOOP
    SELECT input_fp INTO before_fp FROM public.retained_projection_input_fps(ARRAY[e]);
    before_m := public.retained_listing_property_result_matches('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-00000000c001', e);
    EXECUTE format('UPDATE public.vehicles SET %I = %s WHERE id = %L', c.attname,
      CASE WHEN c.ty = 'boolean' THEN format('NOT coalesce(%I, false)', c.attname)
           WHEN c.ty = 'integer' THEN format('coalesce(%I, 0) + 1', c.attname)
           WHEN c.ty LIKE 'timestamp%' THEN 'now()'
           ELSE format('coalesce(%I, '''') || ''x''', c.attname) END,
      '00000000-0000-0000-0000-0000000000a1');
    SELECT input_fp INTO after_fp FROM public.retained_projection_input_fps(ARRAY[e]);
    after_m := public.retained_listing_property_result_matches('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-00000000c001', e);
    IF after_m IS DISTINCT FROM before_m THEN flips := flips + 1; END IF;
    IF after_m IS DISTINCT FROM before_m AND after_fp = before_fp THEN
      RAISE EXCEPTION 'FAIL column set: vehicles.% moves the matcher but not the fingerprint', c.attname; END IF;
    IF c.attname IN ('title', 'updated_at') AND after_fp <> before_fp THEN
      RAISE EXCEPTION 'FAIL column set: vehicles.% is not read by the closure but moves the fingerprint', c.attname; END IF;
    checked := checked + 1;
    ROLLBACK;
  END LOOP;
  IF flips = 0 THEN RAISE EXCEPTION 'FAIL column set is vacuous: no vehicles column moved the matcher'; END IF;
  RAISE NOTICE 'PASS column set: % vehicles columns changed alone, % moved the matcher, each of those moved the fingerprint', checked, flips;
END $$;

-- Mutants: the read without its fingerprint test, then without its body-key test. Each must break E after drift.
CREATE FUNCTION pg_temp.mutant(p_drop text, p_drift text, p_undo text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE d text := pg_get_functiondef('public.retained_projection_verdicts_for(uuid[])'::regprocedure); caught text;
BEGIN
  IF position(p_drop IN d) = 0 THEN RAISE EXCEPTION 'mutant anchor missing: %', p_drop; END IF;
  EXECUTE replace(d, p_drop, 'true');
  EXECUTE p_drift;
  BEGIN
    PERFORM pg_temp.check_e('mutant');
  EXCEPTION WHEN raise_exception THEN caught := SQLERRM;
  END;
  EXECUTE d;
  EXECUTE p_undo;
  IF caught IS NULL OR caught NOT LIKE 'FAIL E%' THEN RAISE EXCEPTION 'FAIL mutant survived: % (%)', p_drop, caught; END IF;
  RETURN caught;
END $f$;
DO $$ BEGIN
  RAISE NOTICE 'PASS mutant killed (no fingerprint test): %', pg_temp.mutant('d.input_fp = f.input_fp',
    $q$UPDATE public.observation_properties SET deprecated_at = now()$q$,
    $q$UPDATE public.observation_properties SET deprecated_at = NULL$q$);
  RAISE NOTICE 'PASS mutant killed (no body-key test): %', pg_temp.mutant('d.body_key = k.key',
    $q$CREATE OR REPLACE FUNCTION public.retained_listing_property_result_matches(p_source uuid, p_property uuid, p_result uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false'$q$,
    pg_get_functiondef('public.retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure));
END $$;
SELECT pg_temp.check_e('after the mutants', 9);

\ir revert_20261126063500_retained_projection_verdicts.sql
DO $$ BEGIN
  IF to_regclass('public.retained_projection_verdicts') IS NOT NULL OR to_regprocedure('public.retained_projection_verdicts_for(uuid[])') IS NOT NULL
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retained-projection-grade')
     OR EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'retained_projection_verdicts')
     OR EXISTS (SELECT 1 FROM public.private_row_policy_copies WHERE reader = 'retained_projection_verdicts_for(uuid[])') THEN
    RAISE EXCEPTION 'FAIL revert left something'; END IF;
  RAISE NOTICE 'PASS revert removes the table, functions, job, config row and policy copy';
END $$;
