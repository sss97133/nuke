-- Contract for 20261126064500_facet_items_read_projection_verdict (empty disposable PG17).
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in an empty disposable PG17 database only (stub tables, not production).
-- Fixtures and the matcher family as in test_retained_projection_verdicts.sql (20261126063500 applied and graded). A
-- minimal vehicle_facet_items holds both anchors verbatim as 20261126001500 leaves them. Claims:
--   1. the owner's reading is unchanged on every car; anon and a signed-in stranger read the owner's answer on public
--      cars (they gain the admitted projections); a private car's anon reading is unchanged;
--   2. with every verdict stale (property deprecated, a source row superseded, no regrade), each caller reads exactly
--      what the gated reader reads; after regrading, anon reads the owner's answer again;
--   3. the guard refuses a body it does not know; apply twice is idempotent; the revert restores the gated body byte
--      for byte.
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
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles (id), observed_at timestamptz, ingested_at timestamptz,
  source_id uuid REFERENCES public.observation_sources (id), source_url text, source_identifier text, kind public.observation_kind,
  content_hash text, structured_data jsonb, content_text text, extraction_metadata jsonb, confidence_score numeric, is_superseded boolean DEFAULT false,
  superseded_by uuid, extraction_method text, raw_source_ref text, agent_cost_cents numeric, agent_model text,
  property_id uuid REFERENCES public.observation_properties (id), subject_type text DEFAULT 'vehicle', subject_id uuid,
  source_observation_id uuid REFERENCES public.vehicle_observations (id), is_processed boolean);  -- the four foreign keys live has
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

-- A minimal reader holding both anchors verbatim as 20261126001500 leaves them; t returns the admitted observation ids.
CREATE FUNCTION public.vehicle_facet_items(p_vehicle_id uuid, p_dimension text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE AS $function$
WITH obs_w AS MATERIALIZED (
  SELECT o.id, o.extraction_method AS method, o.source_observation_id, o.property_id
    FROM public.vehicle_observations o WHERE o.vehicle_id = p_vehicle_id AND o.is_superseded IS NOT TRUE
),
x AS (SELECT 1
),

-- Every testimony row: item key, raw value, comparison kind, class, source key (one per independent source),
-- reader family (independence of readers), clock and the source as returned.
t AS (
  SELECT o.id FROM obs_w o
  WHERE (o.method IS DISTINCT FROM 'retained_listing_property_projection_v1'
         OR (EXISTS (SELECT 1 FROM public.vehicle_observations gp JOIN public.observation_sources gs ON gs.id = gp.source_id
                     WHERE gp.id = o.source_observation_id) -- retained_matcher_caller_gate_v1
             AND public.retained_listing_property_result_matches(o.source_observation_id, o.property_id, o.id)))
)
SELECT coalesce(jsonb_agg(t.id ORDER BY t.id), '[]'::jsonb) FROM t
$function$;
GRANT EXECUTE ON FUNCTION public.vehicle_facet_items(uuid, text) TO anon, authenticated;
-- the gated reader as it is today, kept for comparison
DO $$ BEGIN EXECUTE replace(pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure),
  'public.vehicle_facet_items(', 'public.vehicle_facet_items_gated('); END $$;
GRANT EXECUTE ON FUNCTION public.vehicle_facet_items_gated(uuid, text) TO anon, authenticated;
-- a non-projection row the reader keeps regardless
INSERT INTO public.vehicle_observations (id, vehicle_id, ingested_at, source_id, kind, structured_data, confidence_score, extraction_method)
VALUES ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', now(), '00000000-0000-0000-0000-00000000b001',
        'specification', '{}', 0.5, 'manual_entry');

INSERT INTO cron.job (jobname) VALUES ('bat-live-pull');
CALL public.retained_projection_grade_tick();

-- One reading per caller and car, by dynamic SQL (a fresh plan per role).
CREATE FUNCTION pg_temp.read(p_fn text, p_role text, p_car uuid) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE format('SELECT public.%I($1)', p_fn) INTO r USING p_car;
  RESET ROLE;
  RETURN r;
END $f$;
CREATE TABLE pg_temp.before_read AS
  SELECT r.role, c.car, pg_temp.read('vehicle_facet_items', r.role, c.car) AS out
    FROM unnest(ARRAY['anon', 'authenticated', 'postgres']) r(role),
         unnest(ARRAY['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1']::uuid[]) c(car);

-- The guard refuses the fixture body without the contract setting (its hash is not the live one).
\set ON_ERROR_STOP off
\ir ../migrations/20261126064500_facet_items_read_projection_verdict.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF position('retained_projection_verdict_v1' IN pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'FAIL guard: patched a body it does not know'; END IF;
  RAISE NOTICE 'PASS guard refuses a body whose hash is not the one 20261126001500 leaves';
END $$;
CREATE TABLE pg_temp.gated_def AS SELECT pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure) AS d;

SET nuke.facet_verdict_contract = 'on';
\ir ../migrations/20261126064500_facet_items_read_projection_verdict.sql
\ir ../migrations/20261126064500_facet_items_read_projection_verdict.sql
RESET nuke.facet_verdict_contract;

-- 1. The owner's reading is unchanged; anon and the stranger now read what the owner reads on public cars.
DO $$
DECLARE r record; owner_out jsonb; n_gain int := 0;
BEGIN
  FOR r IN SELECT * FROM pg_temp.before_read LOOP
    IF r.role = 'postgres' AND pg_temp.read('vehicle_facet_items', r.role, r.car) IS DISTINCT FROM r.out THEN
      RAISE EXCEPTION 'FAIL the owner''s reading changed on %', r.car; END IF;
    -- anon: the owner's answer, less projections with no counting verdict (they fall back to the gate, closed to anon;
    -- projection 9's p is ingested after its grading, so the clock rule keeps it from counting). The stranger passes
    -- the gate, so the fallback gives them the owner's whole answer.
    owner_out := CASE WHEN r.role = 'authenticated' THEN (SELECT b.out FROM pg_temp.before_read b WHERE b.role = 'postgres' AND b.car = r.car) ELSE (SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                    FROM jsonb_array_elements_text((SELECT b.out FROM pg_temp.before_read b WHERE b.role = 'postgres' AND b.car = r.car)) x
                   WHERE x::uuid NOT IN (SELECT o.id FROM public.vehicle_observations o
                                          WHERE o.extraction_method = 'retained_listing_property_projection_v1')
                      OR x::uuid IN (SELECT v.projection_id FROM public.retained_projection_verdicts_for(
                                       ARRAY(SELECT o.id FROM public.vehicle_observations o
                                              WHERE o.extraction_method = 'retained_listing_property_projection_v1')) v)) END;
    IF r.car <> '00000000-0000-0000-0000-0000000000b1' AND r.role <> 'postgres' AND pg_temp.read('vehicle_facet_items', r.role, r.car) IS DISTINCT FROM owner_out THEN
      RAISE EXCEPTION 'FAIL % does not read the owner''s answer on public car %: % vs %', r.role, r.car,
        pg_temp.read('vehicle_facet_items', r.role, r.car), owner_out; END IF;
    IF r.role <> 'postgres' AND pg_temp.read('vehicle_facet_items', r.role, r.car) IS DISTINCT FROM r.out THEN n_gain := n_gain + 1; END IF;
  END LOOP;
  IF n_gain = 0 THEN RAISE EXCEPTION 'FAIL vacuous: no caller gained anything'; END IF;
  IF pg_temp.read('vehicle_facet_items', 'anon', '00000000-0000-0000-0000-0000000000b1')
     IS DISTINCT FROM (SELECT b.out FROM pg_temp.before_read b WHERE b.role = 'anon' AND b.car = '00000000-0000-0000-0000-0000000000b1') THEN
    RAISE EXCEPTION 'FAIL the private car''s anon reading changed'; END IF;
  RAISE NOTICE 'PASS owner unchanged on 3 cars; anon and stranger read the owner''s answer on 2 public cars wherever a verdict counts (% readings gained); private car unchanged', n_gain;
END $$;

-- 2. Stale verdicts fall back: drift without regrading, and every caller reads exactly what the gated reader reads.
UPDATE public.observation_properties SET deprecated_at = now();
UPDATE public.vehicle_observations SET is_superseded = true WHERE id = '00000000-0000-0000-0000-00000000d006';
DO $$
DECLARE ro text; c uuid;
BEGIN
  FOREACH ro IN ARRAY ARRAY['anon', 'authenticated', 'postgres'] LOOP
    FOREACH c IN ARRAY ARRAY['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1']::uuid[] LOOP
      IF pg_temp.read('vehicle_facet_items', ro, c) IS DISTINCT FROM pg_temp.read('vehicle_facet_items_gated', ro, c) THEN
        RAISE EXCEPTION 'FAIL stale verdicts: % on % reads % but the gated reader reads %', ro, c,
          pg_temp.read('vehicle_facet_items', ro, c), pg_temp.read('vehicle_facet_items_gated', ro, c); END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'PASS with every verdict stale, all callers read exactly the gated reader';
END $$;
CALL public.retained_projection_grade_tick();
DO $$ BEGIN
  IF pg_temp.read('vehicle_facet_items', 'anon', '00000000-0000-0000-0000-0000000000a1')
     IS DISTINCT FROM pg_temp.read('vehicle_facet_items_gated', 'postgres', '00000000-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION 'FAIL after regrading anon does not read the owner''s gated answer'; END IF;
  RAISE NOTICE 'PASS after regrading anon reads the owner''s answer again: %', pg_temp.read('vehicle_facet_items', 'anon', '00000000-0000-0000-0000-0000000000a1');
END $$;

-- 3. Revert restores the gated body byte for byte, and is idempotent.
\ir revert_20261126064500_facet_items_read_projection_verdict.sql
\ir revert_20261126064500_facet_items_read_projection_verdict.sql
DO $$ BEGIN
  IF pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure) IS DISTINCT FROM (SELECT d FROM pg_temp.gated_def) THEN
    RAISE EXCEPTION 'FAIL revert did not restore the gated body'; END IF;
  RAISE NOTICE 'PASS revert restores the gated body byte for byte';
END $$;
