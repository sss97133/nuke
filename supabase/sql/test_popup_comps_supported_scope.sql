-- Disposable PG17 integration test of the real registry, sale rule, price facts and popup migration.
-- Run: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_popup_comps -f supabase/sql/test_popup_comps_supported_scope.sql
-- Synthetic IDs/prices/testimony only. Never run against the project DB.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user)
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE public.canonical_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text, canonical_model text,
  aliases text[], year_start integer, year_end integer
);
CREATE TABLE public.make_model_profiles (
  subject_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_make text, canonical_model text,
  grain text, year integer, year_start integer, year_end integer,
  canonical_model_id uuid REFERENCES public.canonical_models(id), updated_at timestamptz DEFAULT now(),
  CONSTRAINT make_model_profiles_make_model_year_grain_key
    UNIQUE NULLS NOT DISTINCT (canonical_make, canonical_model, year, grain)
);
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, is_public boolean DEFAULT true,
  deleted_at timestamptz, listing_kind text, primary_image_url text, mileage integer,
  owner_id uuid, description text,
  sale_status text DEFAULT 'available', auction_outcome text, reserve_status text,
  sale_price numeric, bat_sold_price numeric, sold_price numeric, winning_bid numeric, high_bid numeric,
  asking_price numeric, sale_date date, bat_sale_date date, listing_updated_at timestamptz,
  listing_posted_at timestamptz, nuke_estimate numeric, nuke_estimate_confidence integer,
  valuation_calculated_at timestamptz, canonical_outcome text, canonical_platform text DEFAULT 'bat',
  listing_url text, bat_auction_url text, platform_url text, discovery_url text,
  notes text, import_metadata jsonb, created_at timestamptz DEFAULT '2026-10-03',
  auction_end_date text, heat_score numeric, deal_score numeric
);
CREATE INDEX idx_vehicles_lower_make_model ON public.vehicles(lower(make), lower(model));
CREATE INDEX idx_vehicles_year ON public.vehicles(year);
CREATE TABLE public.auction_comments (
  id uuid PRIMARY KEY, auction_event_id uuid, vehicle_id uuid, posted_at timestamptz,
  is_seller boolean, comment_type text, external_identity_id uuid, source_url text,
  comment_text text, bid_amount numeric
);
CREATE TABLE public.auction_events (id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY, source_comment_id uuid, content_text text, structured_data jsonb,
  confidence_score numeric, observed_at timestamptz, ingested_at timestamptz, agent_model text,
  extraction_method text, vehicle_id uuid, kind text, is_superseded boolean
);
CREATE TABLE public.comment_claims_progress (
  comment_id uuid PRIMARY KEY, llm_processed boolean, extraction_version text, processed_at timestamptz
);
CREATE TABLE public.comment_discoveries (
  vehicle_id uuid, raw_extraction jsonb, overall_sentiment text, sentiment_score numeric,
  comment_count integer, discovered_at timestamptz
);
CREATE TABLE public.description_discoveries (
  vehicle_id uuid, raw_extraction jsonb, discovered_at timestamptz
);
CREATE TABLE public.vehicle_events (
  vehicle_id uuid, source_platform text, source_url text, event_type text, sold_at timestamptz,
  ended_at timestamptz, started_at timestamptz, final_price numeric, current_price numeric
);
CREATE MATERIALIZED VIEW public.clean_vehicle_prices AS SELECT 1 AS fixture;

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_vehicle_read ON public.vehicles FOR SELECT USING (is_public);
CREATE POLICY private_owner_read ON public.vehicles FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
ALTER TABLE public.canonical_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view canonical models" ON public.canonical_models FOR SELECT USING (true);
-- Reproduce the live overbroad input policy; the migration must narrow it.
CREATE POLICY "Service role manages canonical models" ON public.canonical_models FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE public.make_model_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY mmp_public_read ON public.make_model_profiles FOR SELECT USING (true);
CREATE POLICY mmp_service_write ON public.make_model_profiles FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

INSERT INTO public.canonical_models VALUES
 ('00000000-0000-0000-0000-000000000001','Chevrolet','K5 Blazer',
  ARRAY['k5','blazer','k5 blazer','k-5','k 5 blazer','full size blazer'],1969,1991);
INSERT INTO public.make_model_profiles
 (subject_id,canonical_make,canonical_model,grain,year_start,year_end,canonical_model_id)
VALUES ('f5586ac1-dc51-4d4b-bd26-abb1b207f872','CHEVROLET','K5 Blazer','generation',1976,1980,
  '00000000-0000-0000-0000-000000000001');
CREATE FUNCTION public.register_make_model_subject(
  text,text,integer DEFAULT NULL,text DEFAULT 'year',integer DEFAULT NULL,integer DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
\ir ../migrations/20261004010000_cohort_generations_allow_ranges_and_register_k5.sql

-- Current production cohort resolver, unchanged from migration 20260928183000.
CREATE OR REPLACE FUNCTION public.cohort_members(p_subject_id uuid)
 RETURNS TABLE(vehicle_id uuid)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE p record; alts text; pattern text;
BEGIN
  SELECT * INTO p FROM public.make_model_profiles WHERE subject_id = p_subject_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT string_agg(
           regexp_replace(lower(t), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), '|')
    INTO alts
  FROM (
    SELECT lower(p.canonical_model) AS t
    UNION
    SELECT lower(a) FROM public.canonical_models cm, unnest(cm.aliases) a
     WHERE cm.id = p.canonical_model_id
  ) s
  WHERE t IS NOT NULL AND length(trim(t)) > 0;

  IF alts IS NULL OR alts = '' THEN RETURN; END IF;
  pattern := '\y(' || alts || ')\y';

  IF p.grain = 'year' THEN
    RETURN QUERY EXECUTE format(
      'SELECT v.id FROM public.vehicles v
        WHERE lower(v.make) = lower(%L) AND v.year = %s AND lower(v.model) ~ %L
          AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item''',
      p.canonical_make, p.year, pattern);
  ELSE
    RETURN QUERY EXECUTE format(
      'SELECT v.id FROM public.vehicles v
        WHERE lower(v.make) = lower(%L) AND v.year BETWEEN %s AND %s AND lower(v.model) ~ %L
          AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item''',
      p.canonical_make, p.year_start, p.year_end, pattern);
  END IF;
END;
$function$;

\ir ../migrations/20260927180000_sale_basis_conflicts_not_proven.sql
\ir ../migrations/20260928224500_vehicle_price_facts_live_outcome.sql
\ir ../migrations/20261004031539_popup_comps_supported_scope.sql

CREATE FUNCTION public.assert_comps(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'Assertion failed: %',message; END IF; END
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- Subject is a recorded alias; condition/build fields intentionally absent/unknown.
INSERT INTO public.vehicles (id,year,make,model,listing_url)
VALUES ('10000000-0000-0000-0000-000000000001',1977,'Chevrolet','Blazer','https://example.test/subject');
-- Six admissible sales covering both endpoints, case/alias/trim decoration.
INSERT INTO public.vehicles (id,year,make,model,sale_status,sale_price,sale_date,listing_url)
SELECT ('20000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
       CASE n WHEN 1 THEN 1976 WHEN 2 THEN 1980 ELSE 1977 END,
       CASE n WHEN 2 THEN 'CHEVROLET' ELSE 'Chevrolet' END,
       CASE n WHEN 3 THEN 'K5 Blazer Cheyenne 4x4' WHEN 4 THEN 'k-5' ELSE 'Blazer' END,
       'sold',1000+n, date '2026-01-01'+n, 'https://example.test/sale/' || n
FROM generate_series(1,6) n;
-- Excluded inputs: wrong ranges, substring collision, privacy/deletion/part, unsold and contradiction.
INSERT INTO public.vehicles
 (id,year,make,model,sale_status,auction_outcome,sale_price,sale_date,is_public,deleted_at,listing_kind,listing_url)
VALUES
 ('30000000-0000-0000-0000-000000000001',1975,'Chevrolet','Blazer','sold',NULL,9999,'2026-09-01',true,NULL,NULL,'https://example.test/wrong-era'),
 ('30000000-0000-0000-0000-000000000002',1981,'Chevrolet','Blazer','sold',NULL,9999,'2026-09-01',true,NULL,NULL,'https://example.test/unproven-boundary'),
 ('30000000-0000-0000-0000-000000000003',1977,'Chevrolet','Trailblazer','sold',NULL,9999,'2026-09-01',true,NULL,NULL,'https://example.test/substring'),
 ('30000000-0000-0000-0000-000000000004',1977,'Chevrolet','Blazer','sold',NULL,9999,'2026-09-01',false,NULL,NULL,'https://example.test/private'),
 ('30000000-0000-0000-0000-000000000005',1977,'Chevrolet','Blazer','sold',NULL,9999,'2026-09-01',true,now(),NULL,'https://example.test/deleted'),
 ('30000000-0000-0000-0000-000000000006',1977,'Chevrolet','Blazer','sold',NULL,9999,'2026-09-01',true,NULL,'non_vehicle_item','https://example.test/part'),
 ('30000000-0000-0000-0000-000000000007',1977,'Chevrolet','Blazer','for_sale',NULL,9999,'2026-09-01',true,NULL,NULL,'https://example.test/ask'),
 ('30000000-0000-0000-0000-000000000008',1977,'Chevrolet','Blazer','sold','no_sale',9999,'2026-09-01',true,NULL,NULL,'https://example.test/contradiction'),
 ('30000000-0000-0000-0000-000000000009',1977,'Chevrolet','Blazer','sold',NULL,9999,NULL,true,NULL,NULL,'https://example.test/unclocked');

-- Context superset is deliberately registered, but never activated for comparisons.
INSERT INTO public.make_model_profiles
 (subject_id,canonical_make,canonical_model,grain,year_start,year_end,canonical_model_id,cohort_label,basis)
VALUES ('feb225e6-3a73-425d-ba12-143680e8b9ca','CHEVROLET','K5 Blazer','generation',1973,1991,
 '00000000-0000-0000-0000-000000000001','context superset','Synthetic context-only range');
-- Repeated event rows must not multiply a current vehicle sale.
INSERT INTO public.vehicle_events(vehicle_id,event_type,final_price)
SELECT '20000000-0000-0000-0000-000000000001','sale',8000 FROM generate_series(1,3);

SET ROLE anon;
SET request.jwt.claim.role='anon';
DO $$
DECLARE j jsonb := public.popup_vehicle_intel('10000000-0000-0000-0000-000000000001');
BEGIN
  PERFORM assert_comps(j->'recent_comps_scope'->>'method'='supported_registered_cohort','supported scope chosen');
  PERFORM assert_comps(j->'recent_comps_scope'->>'subject_id'='f5586ac1-dc51-4d4b-bd26-abb1b207f872','registered key carried');
  PERFORM assert_comps(jsonb_array_length(j->'recent_comps')=6,'six admissible sales, no excluded rows');
  PERFORM assert_comps((SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(j->'recent_comps') x)=6,'one row per vehicle');
  PERFORM assert_comps((SELECT bool_and((x->>'year')::int BETWEEN 1976 AND 1980)
    FROM jsonb_array_elements(j->'recent_comps') x),'both supported endpoints, no superset extension');
  PERFORM assert_comps((SELECT bool_and(x->>'sold_basis'='status' AND x->>'sold_amount_from'='sale_price'
    AND x->>'source_url' LIKE 'https://example.test/sale/%')
    FROM jsonb_array_elements(j->'recent_comps') x),'canonical sale provenance carried');
  PERFORM assert_comps(j->'recent_comps_scope'->'condition_matched'='false'::jsonb AND
    (SELECT bool_and(x->'condition_matched'='false'::jsonb) FROM jsonb_array_elements(j->'recent_comps') x),
    'unknown condition never becomes equivalent');
  PERFORM assert_comps(j->'comment_evidence' IS NOT NULL AND j ? 'comment_intel'
    AND j ? 'description_intel' AND j ? 'scores' AND j ? 'apparitions','existing intel contract preserved');
  PERFORM assert_comps(public.popup_vehicle_intel('30000000-0000-0000-0000-000000000004') IS NULL,'private parent invisible to anon');
  PERFORM assert_comps(public.popup_vehicle_intel('30000000-0000-0000-0000-000000000005') IS NULL,'deleted parent suppressed');
  PERFORM assert_comps(public.popup_vehicle_intel('30000000-0000-0000-0000-000000000006') IS NULL,'nonvehicle parent suppressed');

  -- Public self-registration cannot mint/alter supported policy evidence.
  PERFORM public.register_make_model_subject('CHEVROLET','K5 Blazer',NULL,'generation',1976,1980,
    'untrusted presentation label','untrusted basis overwrite attempt');
  PERFORM assert_comps((SELECT comparison_scope_status='supported' AND comparison_scope_basis LIKE 'Owner testimony,%'
    FROM make_model_profiles WHERE subject_id='f5586ac1-dc51-4d4b-bd26-abb1b207f872'),'supported policy evidence immutable to register caller');
  PERFORM assert_comps(popup_vehicle_intel('10000000-0000-0000-0000-000000000001')->'recent_comps_scope'->>'label'
    ='1976-1980 K5 Blazer','untrusted presentation label cannot alter supported disclosure');
  PERFORM assert_comps(NOT has_table_privilege('anon','canonical_models','UPDATE')
    AND NOT has_table_privilege('anon','canonical_models','TRUNCATE')
    AND NOT has_table_privilege('anon','make_model_profiles','TRUNCATE')
    AND NOT has_table_privilege('authenticated','make_model_profiles','UPDATE'),'registry direct writes revoked');
  BEGIN
    UPDATE make_model_profiles SET comparison_scope_status='context_only'
    WHERE subject_id='f5586ac1-dc51-4d4b-bd26-abb1b207f872';
    RAISE EXCEPTION 'Anon unexpectedly updated comparison policy';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE canonical_models SET aliases=ARRAY['trailblazer'];
    RAISE EXCEPTION 'Anon unexpectedly altered canonical aliases';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    TRUNCATE make_model_profiles;
    RAISE EXCEPTION 'Anon unexpectedly truncated registry';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
RESET request.jwt.claim.role;

-- Existing authenticated owner access remains; private candidates still cannot leak into sold context.
UPDATE vehicles SET owner_id='90000000-0000-0000-0000-000000000001'
WHERE id='30000000-0000-0000-0000-000000000004';
SET ROLE authenticated;
SET request.jwt.claim.role='authenticated';
SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  PERFORM assert_comps(popup_vehicle_intel('30000000-0000-0000-0000-000000000004') IS NOT NULL,
    'authorized private parent remains visible');
  PERFORM assert_comps(NOT EXISTS (SELECT FROM jsonb_array_elements(
    popup_vehicle_intel('10000000-0000-0000-0000-000000000001')->'recent_comps') c
    WHERE c->>'id'='30000000-0000-0000-0000-000000000004'),
    'private candidate excluded even when owner can read it');
END $$;
RESET ROLE;
RESET request.jwt.claim.role;
RESET request.jwt.claim.sub;

-- Legitimate service registry maintenance still works under the narrowed policy.
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
UPDATE canonical_models SET aliases=aliases WHERE id='00000000-0000-0000-0000-000000000001';
UPDATE make_model_profiles SET updated_at=updated_at WHERE subject_id='f5586ac1-dc51-4d4b-bd26-abb1b207f872';
RESET ROLE;
RESET request.jwt.claim.role;

-- Backstop constraints reject ambiguous status vocabularies / unsupported activation.
DO $$ BEGIN
  BEGIN
    UPDATE make_model_profiles SET comparison_scope_status='factory_generation'
    WHERE subject_id='f5586ac1-dc51-4d4b-bd26-abb1b207f872';
    RAISE EXCEPTION 'Invalid scope vocabulary accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE make_model_profiles SET comparison_scope_status='supported',comparison_scope_basis=NULL
    WHERE subject_id='feb225e6-3a73-425d-ba12-143680e8b9ca';
    RAISE EXCEPTION 'Unsupported basis accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- Create a second SUPPORTED overlap. No arbitrary narrowest selector.
UPDATE make_model_profiles SET comparison_scope_status='supported',comparison_scope_basis='Synthetic second supported scope'
WHERE subject_id='feb225e6-3a73-425d-ba12-143680e8b9ca';
DO $$
DECLARE j jsonb := popup_vehicle_intel('10000000-0000-0000-0000-000000000001');
BEGIN
  PERFORM assert_comps(j->'recent_comps_scope'->>'method'='same_year_canonical_model'
    AND j->'recent_comps_scope'->>'fallback_reason'='overlapping_supported_scopes'
    AND j->'recent_comps_scope'->>'supported_scope_count'='2'
    AND j->'recent_comps_scope'->'subject_id'='null'::jsonb,'overlap disclosed and conservative fallback');
  PERFORM assert_comps((SELECT bool_and((x->>'year')::int=1977)
    FROM jsonb_array_elements(j->'recent_comps') x),'ambiguous range never crosses model year');
END $$;
UPDATE make_model_profiles SET comparison_scope_status='context_only' WHERE subject_id='feb225e6-3a73-425d-ba12-143680e8b9ca';

-- No supported evidence for the admitted unproven 1981 boundary: same year, not factory generation.
DO $$
DECLARE j jsonb := popup_vehicle_intel('30000000-0000-0000-0000-000000000002');
BEGIN
  PERFORM assert_comps(j->'recent_comps_scope'->>'method'='same_year_canonical_model'
    AND j->'recent_comps_scope'->>'fallback_reason'='no_supported_registered_scope','unproven boundary remains descriptive');
END $$;

-- Unknown and ambiguous model vocabulary, absent year/model do not broaden comparables.
INSERT INTO vehicles(id,year,make,model,sale_status,sale_price,sale_date)
VALUES ('40000000-0000-0000-0000-000000000001',1977,'Unknown Make','Unknown Model','available',NULL,NULL),
 ('40000000-0000-0000-0000-000000000002',1977,'unknown make','unknown model','sold',2000,'2026-05-01'),
 ('40000000-0000-0000-0000-000000000003',NULL,'Chevrolet','Blazer','available',NULL,NULL),
 ('40000000-0000-0000-0000-000000000004',1977,'Chevrolet',NULL,'available',NULL,NULL);
DO $$
DECLARE j jsonb;
BEGIN
  j:=popup_vehicle_intel('40000000-0000-0000-0000-000000000001');
  PERFORM assert_comps(j->'recent_comps_scope'->>'method'='same_year_exact_model'
    AND jsonb_array_length(j->'recent_comps')=1,'unknown model only exact same year/model');
  j:=popup_vehicle_intel('40000000-0000-0000-0000-000000000003');
  PERFORM assert_comps(j->'recent_comps_scope'->>'method'='blocked'
    AND jsonb_array_length(j->'recent_comps')=0,'missing year cannot expand to all years');
  j:=popup_vehicle_intel('40000000-0000-0000-0000-000000000004');
  PERFORM assert_comps(j->'recent_comps_scope'->>'method'='blocked'
    AND jsonb_array_length(j->'recent_comps')=0,'missing model blocked');
END $$;

-- Use the actual sale reader ranking/fallback: amount/date may come from winning_bid/auction clock.
INSERT INTO vehicles(id,year,make,model,sale_status,winning_bid,auction_end_date,listing_url)
VALUES ('50000000-0000-0000-0000-000000000001',1977,'Chevrolet','K5 Blazer','sold',3210,
 '2026-09-12T20:00:00Z','https://example.test/fallback');
DO $$
DECLARE j jsonb:=popup_vehicle_intel('10000000-0000-0000-0000-000000000001'); c jsonb;
BEGIN
  c:=j->'recent_comps'->0;
  PERFORM assert_comps(c->>'id'='50000000-0000-0000-0000-000000000001'
    AND c->>'sold_amount_from'='winning_bid' AND c->>'sale_price'='3210'
    AND c->>'sale_date'='2026-09-12','sale reader amount/date fallback preserved');
  PERFORM assert_comps(jsonb_array_length(j->'recent_comps')=6,'hard cap six');
  PERFORM assert_comps((SELECT NOT prosecdef FROM pg_proc WHERE oid='popup_vehicle_intel(uuid)'::regprocedure),
    'reader remains SECURITY INVOKER');
END $$;

-- Canonical ambiguity must not be resolved arbitrarily.
UPDATE make_model_profiles SET comparison_scope_status='context_only' WHERE subject_id='f5586ac1-dc51-4d4b-bd26-abb1b207f872';
INSERT INTO canonical_models VALUES
 ('00000000-0000-0000-0000-000000000002','Chevrolet','Other Model',ARRAY['blazer'],1969,1991);
DO $$
DECLARE j jsonb:=popup_vehicle_intel('10000000-0000-0000-0000-000000000001');
BEGIN
  PERFORM assert_comps(j->'recent_comps_scope'->>'method'='same_year_exact_model'
    AND j->'recent_comps_scope'->>'fallback_reason'='ambiguous_canonical_model','ambiguous canonical model exact fallback');
  PERFORM assert_comps((SELECT bool_and(lower(x->>'model')='blazer')
    FROM jsonb_array_elements(j->'recent_comps') x),'no guessed aliases when canonical match ambiguous');
END $$;

-- Project/restored text is not a trusted condition key. A sold record remains context, not valuation evidence.
INSERT INTO vehicles(id,year,make,model,description,sale_status,sale_price,sale_date)
VALUES ('60000000-0000-0000-0000-000000000001',1969,'Plymouth','Road Runner','Project car','available',NULL,NULL),
 ('60000000-0000-0000-0000-000000000002',1969,'Plymouth','Road Runner','Restored car','sold',2500,'2026-08-01');
DO $$
DECLARE j jsonb:=popup_vehicle_intel('60000000-0000-0000-0000-000000000001');
BEGIN
  PERFORM assert_comps(jsonb_array_length(j->'recent_comps')=1
    AND j->'recent_comps_scope'->'condition_matched'='false'::jsonb,
    'project versus restored remains an explicit condition hold');
END $$;

SELECT 'PASS: supported scope, overlap fallback, eligibility, sale provenance, condition hold and registry security' AS result;
