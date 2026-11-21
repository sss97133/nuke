-- Disposable synthetic contract; never production. Every id, name and amount below is invented.
-- vehicle_class_price_v1 (20261121073000): the build class is classified once by the definer (every receipt counts,
-- whoever filed it) into vehicle_build_class; refresh_vehicle_class_price prices a vehicle from that store, reporting
-- "cohort not yet classified (k of n)" until every member is classified; get_vehicle_class_prices returns a row only to
-- the accounts get_user_garage ties to the vehicle with money, or to the service role; get_user_garage.current_value is
-- the stored price; nuke_build_class gives the same answers as before; get_platform_stratified_price keeps its curated pool.
\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
-- Supabase's defaults: whatever postgres creates is open to every API role until a migration revokes it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- Live shapes (2026-11-20), reduced to the columns the functions read.
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, year int, make text, model text, trim text, user_id uuid,
  primary_image_url text, purchase_price numeric, image_count bigint, merged_into_vehicle_id uuid, deleted_at timestamptz,
  is_public boolean DEFAULT true, listing_kind text, is_modified boolean DEFAULT false, description text,
  bat_listing_title text, listing_title text, modifications text, modification_details text, trim_details text,
  notes text, maintenance_notes text);
CREATE TABLE public.receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  total_amount numeric, total numeric, superseded_at timestamptz);
-- Receipts are private to their filer, as in production.
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY receipts_own ON public.receipts FOR SELECT USING (user_id = auth.uid());
CREATE TABLE public.work_sessions(vehicle_id uuid, user_id uuid, session_date date, session_type text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  image_url text, created_at timestamptz DEFAULT now(), is_superseded boolean);
CREATE TABLE public.ownership_verifications(vehicle_id uuid, user_id uuid, status text);
CREATE TABLE public.vehicle_user_permissions(vehicle_id uuid, user_id uuid, role text, revoked_at timestamptz, is_active boolean);
CREATE TABLE public.vehicle_ownerships(vehicle_id uuid, owner_profile_id uuid, is_current boolean);
CREATE TABLE public.discovered_vehicles(vehicle_id uuid, user_id uuid, is_active boolean, relationship_type text);
CREATE TABLE public.vehicle_contributors(vehicle_id uuid, user_id uuid);
CREATE TABLE public.nuke_estimates(vehicle_id uuid, comp_method text, estimated_value numeric, calculated_at timestamptz);
CREATE TABLE public.vehicle_activity(vehicle_id uuid, last_activity_at timestamptz);
CREATE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE TABLE public.canonical_models(id uuid PRIMARY KEY, make text, canonical_model text, aliases text[]);
CREATE TABLE public.make_model_profiles(subject_id uuid PRIMARY KEY, canonical_make text, canonical_model text,
  canonical_model_id uuid, grain text, year int, year_start int, year_end int);
CREATE TABLE public.vehicle_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, final_price numeric);
CREATE VIEW public.comp_eligible_vehicle_events AS SELECT id, vehicle_id, final_price FROM public.vehicle_events;
-- cohort_members(uuid) as live.
CREATE FUNCTION public.cohort_members(p_subject_id uuid) RETURNS TABLE(vehicle_id uuid) LANGUAGE plpgsql STABLE AS $function$
DECLARE p record; alts text; pattern text;
BEGIN
  SELECT * INTO p FROM public.make_model_profiles WHERE subject_id = p_subject_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT string_agg(regexp_replace(lower(t), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), '|') INTO alts
  FROM (SELECT lower(p.canonical_model) AS t UNION
        SELECT lower(a) FROM public.canonical_models cm, unnest(cm.aliases) a WHERE cm.id = p.canonical_model_id) s
  WHERE t IS NOT NULL AND length(trim(t)) > 0;
  IF alts IS NULL OR alts = '' THEN RETURN; END IF;
  pattern := '\y(' || alts || ')\y';
  RETURN QUERY EXECUTE format(
    'SELECT v.id FROM public.vehicles v WHERE lower(v.make) = lower(%L) AND v.year = %s AND lower(v.model) ~ %L
       AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item''', p.canonical_make, p.year, pattern);
END;
$function$;
-- The objects the migration replaces or extends, as their migrations created them.
\ir ../migrations/20260623100000_nuke_build_class_v2_scored_text.sql
\ir ../migrations/20260623110000_curated_platform_class_stratified_price.sql
\ir ../migrations/20261116061500_garage_consigned_display_order.sql

CREATE FUNCTION public.assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', message; END IF; END $$;
CREATE FUNCTION public.refuses(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE = expected THEN RETURN; END IF;
      RAISE EXCEPTION 'FAIL: % refused with % (%), expected %', statement, SQLSTATE, SQLERRM, expected;
    END;
    RAISE EXCEPTION 'FAIL: unexpectedly admitted %', statement;
  END $$;
GRANT EXECUTE ON FUNCTION public.assert(boolean, text), public.refuses(text, text) TO anon, authenticated, service_role;

-- Accounts: O owns cars, X is a stranger, F filed a receipt on O's subject car.
-- Cohort: 1973 Fixture Coupe (alias "Coupe GT"). S is the subject (no text; F's $6,000 receipt makes it a documented build).
-- B1-B6 are builds ("lifted") sold at 10k-60k, B7 a build never sold, K1-K3 stock ("numbers matching") sold at 5-7k,
-- N1-N2 have no text (unknown), P is a build O only created (profile_record), Q has no text (unknown subject),
-- T has no registered cohort, M has no make. W1-W5 are curated K5 Blazers (builds) for the platform reader, and
-- J is a 1979 Chevrolet Blazer build subject for it.
INSERT INTO public.canonical_models VALUES ('c0000000-0000-4000-8000-000000000001', 'Fixture', 'Coupe', ARRAY['Coupe GT']);
INSERT INTO public.make_model_profiles(subject_id, canonical_make, canonical_model, canonical_model_id, grain, year) VALUES
 ('50000000-0000-4000-8000-000000000001', 'FIXTURE', 'Coupe', 'c0000000-0000-4000-8000-000000000001', 'year', 1973);
INSERT INTO public.vehicles(id, year, make, model, description) VALUES
 ('a0000000-0000-4000-8000-000000000000', 1973, 'Fixture', 'Coupe', NULL),                                 -- S
 ('a0000000-0000-4000-8000-000000000001', 1973, 'Fixture', 'Coupe', 'Lifted and loud'),                    -- B1
 ('a0000000-0000-4000-8000-000000000002', 1973, 'Fixture', 'Coupe GT', 'lifted truck stance'),             -- B2 (alias)
 ('a0000000-0000-4000-8000-000000000003', 1973, 'Fixture', 'Coupe', 'lifted'),                             -- B3
 ('a0000000-0000-4000-8000-000000000004', 1973, 'Fixture', 'Coupe', 'lifted'),                             -- B4
 ('a0000000-0000-4000-8000-000000000005', 1973, 'Fixture', 'Coupe', 'crate engine swap'),                  -- B5
 ('a0000000-0000-4000-8000-000000000006', 1973, 'Fixture', 'Coupe', 'lifted'),                             -- B6
 ('a0000000-0000-4000-8000-000000000007', 1973, 'Fixture', 'Coupe', 'lifted, never sold'),                 -- B7
 ('a0000000-0000-4000-8000-000000000011', 1973, 'Fixture', 'Coupe', 'numbers matching original paint'),    -- K1
 ('a0000000-0000-4000-8000-000000000012', 1973, 'Fixture', 'Coupe', 'numbers matching'),                   -- K2
 ('a0000000-0000-4000-8000-000000000013', 1973, 'Fixture', 'Coupe', 'survivor'),                           -- K3
 ('a0000000-0000-4000-8000-000000000021', 1973, 'Fixture', 'Coupe', NULL),                                 -- N1
 ('a0000000-0000-4000-8000-000000000022', 1973, 'Fixture', 'Coupe', ''),                                   -- N2
 ('a0000000-0000-4000-8000-000000000031', 1973, 'Fixture', 'Coupe', 'lowered on air ride'),                -- P
 ('a0000000-0000-4000-8000-000000000032', 1973, 'Fixture', 'Coupe', NULL),                                 -- Q
 ('a0000000-0000-4000-8000-000000000033', 1990, 'Fixture', 'Wagon', 'lifted'),                             -- T
 ('a0000000-0000-4000-8000-000000000034', 1973, NULL, 'Coupe', 'lifted'),                                  -- M
 ('a0000000-0000-4000-8000-000000000041', 1977, 'Chevrolet', 'K5 Blazer', 'lifted'),                       -- W1
 ('a0000000-0000-4000-8000-000000000042', 1978, 'Chevrolet', 'K5 Blazer', 'lifted'),                       -- W2
 ('a0000000-0000-4000-8000-000000000043', 1979, 'GMC', 'Jimmy', 'lifted'),                                 -- W3
 ('a0000000-0000-4000-8000-000000000044', 1980, 'Chevrolet', 'Blazer', 'lifted'),                          -- W4
 ('a0000000-0000-4000-8000-000000000045', 1981, 'Chevrolet', 'K5 Blazer', 'lifted'),                       -- W5
 ('a0000000-0000-4000-8000-000000000046', 1979, 'Chevrolet', 'Blazer', 'lifted');                          -- J
UPDATE public.vehicles SET user_id = '10000000-0000-4000-8000-00000000000f' WHERE user_id IS NULL;
UPDATE public.vehicles SET user_id = '10000000-0000-4000-8000-000000000001' WHERE id = 'a0000000-0000-4000-8000-000000000031';
INSERT INTO public.receipts(vehicle_id, user_id, total_amount) VALUES
 ('a0000000-0000-4000-8000-000000000000', '10000000-0000-4000-8000-00000000000f', 6000);
INSERT INTO public.vehicle_events(vehicle_id, final_price) VALUES
 ('a0000000-0000-4000-8000-000000000001', 10000), ('a0000000-0000-4000-8000-000000000001', 9000),
 ('a0000000-0000-4000-8000-000000000002', 20000), ('a0000000-0000-4000-8000-000000000003', 30000),
 ('a0000000-0000-4000-8000-000000000004', 40000), ('a0000000-0000-4000-8000-000000000005', 50000),
 ('a0000000-0000-4000-8000-000000000006', 60000), ('a0000000-0000-4000-8000-000000000007', 0),
 ('a0000000-0000-4000-8000-000000000011', 5000), ('a0000000-0000-4000-8000-000000000012', 6000),
 ('a0000000-0000-4000-8000-000000000013', 7000), ('a0000000-0000-4000-8000-000000000021', 99000),
 ('a0000000-0000-4000-8000-000000000041', 1000), ('a0000000-0000-4000-8000-000000000042', 2000),
 ('a0000000-0000-4000-8000-000000000043', 3000), ('a0000000-0000-4000-8000-000000000044', 4000),
 ('a0000000-0000-4000-8000-000000000045', 5000);
-- O's ties: owner of S, Q, T, M; previous owner of B1; created P only. An old v1 class row on S and B1.
INSERT INTO public.vehicle_user_permissions(vehicle_id, user_id, role, is_active) VALUES
 ('a0000000-0000-4000-8000-000000000000', '10000000-0000-4000-8000-000000000001', 'owner', true),
 ('a0000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000001', 'owner', true),
 ('a0000000-0000-4000-8000-000000000033', '10000000-0000-4000-8000-000000000001', 'owner', true),
 ('a0000000-0000-4000-8000-000000000034', '10000000-0000-4000-8000-000000000001', 'owner', true),
 ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'previously_owned', true);
INSERT INTO public.nuke_estimates VALUES
 ('a0000000-0000-4000-8000-000000000000', 'class_stratified', 112200, '2026-06-17T00:00:00Z'),
 ('a0000000-0000-4000-8000-000000000001', 'class_stratified', 99000, '2026-06-17T00:00:00Z');
-- The June backfill wrote an old-method row; a stale class must not survive a refresh.
INSERT INTO public.vehicle_build_class(vehicle_id, build_class, coarse_class, confidence, method_version, classified_at) VALUES
 ('a0000000-0000-4000-8000-000000000003', 'stock', 'stock', 'medium', 'v2_scored_text_unwired', '2026-06-23T22:11:33Z'),
 ('a0000000-0000-4000-8000-000000000041', 'modified', 'build', 'high', 'v2_scored_text_unwired', '2026-06-23T22:11:33Z'),
 ('a0000000-0000-4000-8000-000000000042', 'modified', 'build', 'high', 'v2_scored_text_unwired', '2026-06-23T22:11:33Z'),
 ('a0000000-0000-4000-8000-000000000043', 'modified', 'build', 'high', 'v2_scored_text_unwired', '2026-06-23T22:11:33Z'),
 ('a0000000-0000-4000-8000-000000000044', 'modified', 'build', 'high', 'v2_scored_text_unwired', '2026-06-23T22:11:33Z'),
 ('a0000000-0000-4000-8000-000000000045', 'modified', 'build', 'high', 'v2_scored_text_unwired', '2026-06-23T22:11:33Z');

-- Before: the classifier's answers, the garage as O sees it, and the garage reader's execution properties.
CREATE TABLE class_before AS SELECT id, public.nuke_build_class(id) AS j FROM public.vehicles;
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000001', false), set_config('fixture.role', 'authenticated', false);
CREATE TABLE garage_before AS SELECT * FROM public.get_user_garage('10000000-0000-4000-8000-000000000001');
SELECT public.assert((SELECT current_value = 112200 FROM garage_before WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000'),
  'before: the garage serves the old v1 class row');
CREATE TABLE garage_acl_before AS
  SELECT proacl, proowner, proconfig, prosecdef, provolatile, prorettype FROM pg_proc WHERE oid = 'public.get_user_garage(uuid)'::regprocedure;

\ir ../migrations/20261121073000_vehicle_class_price_store.sql
-- Idempotent: a second apply (as the deploy does on merge) changes nothing.
\ir ../migrations/20261121073000_vehicle_class_price_store.sql

-- The rule is granted, not inherited: with every grant on it removed, a re-apply restores what anon needs to run the
-- invoker nuke_build_class (which get_class_stratified_price calls for anon).
REVOKE ALL ON FUNCTION public.nuke_build_class_rule(numeric, integer, text) FROM PUBLIC, anon, authenticated;
\ir ../migrations/20261121073000_vehicle_class_price_store.sql
SET ROLE anon;
SELECT set_config('fixture.role', 'anon', false), set_config('fixture.uid', '', false);
SELECT public.assert(public.nuke_build_class('a0000000-0000-4000-8000-000000000001')->>'build_class' = 'modified',
  'anon still runs nuke_build_class through the granted rule');
RESET ROLE;
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000001', false);

-- nuke_build_class answers exactly as before (same reads, the rule now in nuke_build_class_rule).
SELECT public.assert(NOT EXISTS (SELECT 1 FROM class_before b WHERE b.j IS DISTINCT FROM public.nuke_build_class(b.id)),
  'nuke_build_class output unchanged for every vehicle');
SELECT public.assert((SELECT (p.proacl, p.proowner, p.proconfig, p.prosecdef, p.provolatile, p.prorettype)
    IS NOT DISTINCT FROM (b.proacl, b.proowner, b.proconfig, b.prosecdef, b.provolatile, b.prorettype)
  FROM pg_proc p CROSS JOIN garage_acl_before b WHERE p.oid = 'public.get_user_garage(uuid)'::regprocedure),
  'get_user_garage signature, ACL and execution properties preserved');

-- Nobody but the service role reaches the store or the writers; anon reaches none of it.
SELECT set_config('fixture.role', 'authenticated', false);
SET ROLE authenticated;
SELECT public.refuses('SELECT * FROM public.vehicle_class_price', '42501');
SELECT public.refuses('SELECT * FROM public.vehicle_build_class', '42501');
SELECT public.refuses($$SELECT public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000000')$$, '42501');
SELECT public.refuses($$SELECT * FROM public.refresh_vehicle_class_prices(ARRAY['a0000000-0000-4000-8000-000000000000']::uuid[])$$, '42501');
SELECT public.refuses($$SELECT public.classify_vehicle_build_class(ARRAY['a0000000-0000-4000-8000-000000000000']::uuid[])$$, '42501');
SELECT public.refuses($$INSERT INTO public.vehicle_class_price(vehicle_id, status, blocked_reason, method_version) VALUES (gen_random_uuid(), 'blocked', 'x', 'x')$$, '42501');
-- The caller's own view of the subject: F's receipt is hidden, so the invoker classifier says unknown.
SELECT public.assert(public.nuke_build_class('a0000000-0000-4000-8000-000000000000')->>'build_class' = 'unknown',
  'the invoker classifier depends on the caller (the reason for the store)');
RESET ROLE;
SET ROLE anon;
SELECT set_config('fixture.role', 'anon', false), set_config('fixture.uid', '', false);
SELECT public.refuses($$SELECT * FROM public.get_vehicle_class_prices(ARRAY['a0000000-0000-4000-8000-000000000000']::uuid[])$$, '42501');
SELECT public.refuses('SELECT * FROM public.vehicle_class_price', '42501');
RESET ROLE;

-- The service role refreshes. A zero budget classifies no member and says how far the cohort is.
SET ROLE service_role;
SELECT set_config('fixture.role', 'service_role', false);
DO $$ DECLARE r jsonb;
BEGIN
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000000', 0);
  PERFORM public.assert(r->>'status' = 'blocked' AND (r->>'complete')::boolean = false, 'zero budget leaves the cohort pending');
  -- 15 cohort members (S, B1-B7, K1-K3, N1-N2, P, Q); S is classified, B3 holds an old-method row, so 1 of 15.
  PERFORM public.assert(r->>'reason' = 'cohort not yet classified (1 of 15)', 'pending reason counts k of n: ' || (r->>'reason'));
  PERFORM public.assert((SELECT status = 'blocked' AND value IS NULL AND blocked_reason = 'cohort not yet classified (1 of 15)'
    AND cohort_members = 15 AND cohort_classified = 1 FROM public.vehicle_class_price WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000'),
    'the store says blocked, not yet classified, until done');
  -- Classified as the definer: F's receipt counts although the caller did not file it.
  PERFORM public.assert((SELECT build_class = 'documented_build' AND coarse_class = 'build' AND method_version = 'v3_store_text_paper'
    AND NOT source_dna ? 'photos' FROM public.vehicle_build_class WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000'),
    'subject classified by the definer, without the photo count');

  -- Chunks of 4 under a real budget finish the cohort and price it.
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000000', 5000, 4);
  PERFORM public.assert(r->>'status' = 'priced' AND (r->>'complete')::boolean AND (r->>'classified_this_call')::int = 14,
    'second call classifies the 14 remaining members and prices: ' || r::text);
  -- Builds sold: B1 (max of 10,000 and 9,000), B2 20,000 ... B6 60,000; B7 never sold; stock and unknown comps excluded.
  PERFORM public.assert((SELECT status = 'priced' AND value = 35000 AND value_low = 22500 AND value_high = 47500 AND n = 6
      AND subject_coarse_class = 'build' AND cohort_members = 15 AND cohort_classified = 15 AND blocked_reason IS NULL
      AND basis = 'median of 6 sold comps of the same build class (build) in the 1973 Fixture Coupe cohort'
    FROM public.vehicle_class_price WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000'),
    'median, p25, p75 and n of the same-class sold comps');
  PERFORM public.assert((SELECT method_version = 'v3_store_text_paper' AND coarse_class = 'build'
    FROM public.vehicle_build_class WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000003'),
    'an old-method member row is reclassified, not trusted');
  -- A re-run classifies nothing new: the version refresh looks for is the one the classifier writes.
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000000');
  PERFORM public.assert((r->>'classified_this_call')::int = 0 AND r->>'status' = 'priced', 'second refresh reuses the store');
END $$;

-- Every blocked reason is an answer; the batch runner covers a list and reports each.
DO $$ DECLARE rows jsonb;
BEGIN
  SELECT jsonb_object_agg(vehicle_id, result) INTO rows FROM public.refresh_vehicle_class_prices(ARRAY[
    'a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000033',
    'a0000000-0000-4000-8000-000000000034', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000011',
    'a0000000-0000-4000-8000-000000000031', 'b0000000-0000-4000-8000-000000000099']::uuid[]);
  PERFORM public.assert(rows->'a0000000-0000-4000-8000-000000000031'->>'status' = 'priced', 'P priced');
  PERFORM public.assert(rows->'a0000000-0000-4000-8000-000000000032'->>'reason' LIKE 'subject build class unknown%', 'Q unknown class');
  PERFORM public.assert(rows->'a0000000-0000-4000-8000-000000000033'->>'reason' = 'no registered cohort for this year-make-model', 'T no cohort');
  PERFORM public.assert(rows->'a0000000-0000-4000-8000-000000000034'->>'reason' = 'vehicle missing year/make', 'M no make');
  -- B1 is a build: the other five sold builds (B2-B6) plus nothing else.
  PERFORM public.assert(rows->'a0000000-0000-4000-8000-000000000001'->>'value' = '40000'
    AND rows->'a0000000-0000-4000-8000-000000000001'->>'n' = '5', 'B1 priced against the other builds');
  PERFORM public.assert(rows->'a0000000-0000-4000-8000-000000000011'->>'reason' = 'only 2 sold comps of the same build class (need 5)',
    'K1 has too few stock comps');
  PERFORM public.assert(rows->'b0000000-0000-4000-8000-000000000099'->>'status' = 'not_found', 'unknown id writes nothing');
  PERFORM public.assert((SELECT count(*) = 7 FROM public.vehicle_class_price), 'one row per refreshed vehicle, duplicates folded');
END $$;
SELECT public.refuses($$SELECT * FROM public.refresh_vehicle_class_prices(array_fill('a0000000-0000-4000-8000-000000000000'::uuid, ARRAY[501]))$$, '22023');

-- The service role reads any requested vehicle.
SELECT public.assert((SELECT count(*) = 2 FROM public.get_vehicle_class_prices(ARRAY[
  'a0000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000032']::uuid[])), 'service role reads any vehicle');
-- The platform reader prices J against the curated K5/Jimmy pool only (W1-W5), not the coupe builds now in the store.
SELECT public.assert((SELECT j->>'n_class_matched_priced' = '5' AND j->>'value' = '3000'
  FROM (SELECT public.get_platform_stratified_price('a0000000-0000-4000-8000-000000000046') j) s),
  'platform pool stays the curated platform');
RESET ROLE;

-- O reads the cars get_user_garage ties to O with money; not the profile-only car, not a stranger's.
SET ROLE authenticated;
SELECT set_config('fixture.role', 'authenticated', false), set_config('fixture.uid', '10000000-0000-4000-8000-000000000001', false);
DO $$ DECLARE rows jsonb;
BEGIN
  SELECT jsonb_object_agg(vehicle_id, to_jsonb(r) - 'vehicle_id') INTO rows FROM public.get_vehicle_class_prices(ARRAY[
    'a0000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000031',
    'a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000011']::uuid[]) r;
  PERFORM public.assert(rows->'a0000000-0000-4000-8000-000000000000'->>'value' = '35000'
    AND rows->'a0000000-0000-4000-8000-000000000000'->>'value_low' = '22500'
    AND rows->'a0000000-0000-4000-8000-000000000000'->>'value_high' = '47500'
    AND rows->'a0000000-0000-4000-8000-000000000000'->>'n' = '6'
    AND rows->'a0000000-0000-4000-8000-000000000000'->>'subject_class' = 'build'
    AND rows->'a0000000-0000-4000-8000-000000000000'->>'computed_at' IS NOT NULL, 'owner reads the stored price');
  PERFORM public.assert(rows->'a0000000-0000-4000-8000-000000000001'->>'status' = 'priced', 'previous owner reads it');
  PERFORM public.assert(rows->'a0000000-0000-4000-8000-000000000032'->>'status' = 'blocked'
    AND rows->'a0000000-0000-4000-8000-000000000032'->>'blocked_reason' LIKE 'subject build class unknown%', 'blocked is an answer');
  PERFORM public.assert(NOT rows ? 'a0000000-0000-4000-8000-000000000031', 'profile_record carries no money, as in get_user_garage');
  PERFORM public.assert(NOT rows ? 'a0000000-0000-4000-8000-000000000011', 'an untied car is not returned');
  PERFORM public.assert(NOT (rows->'a0000000-0000-4000-8000-000000000000') ? 'source_dna', 'no receipts or source_dna leave the store');
END $$;
SELECT public.refuses($$SELECT * FROM public.get_vehicle_class_prices(NULL)$$, '22023');
-- get_user_garage: current_value is the stored price; every other column as before; no v1 row survives.
SELECT public.assert((SELECT current_value = 35000 FROM public.get_user_garage(auth.uid()) WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000'),
  'garage current_value is the stored class price');
SELECT public.assert((SELECT current_value = 40000 FROM public.get_user_garage(auth.uid()) WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000001'),
  'the old v1 class row is no longer served');
SELECT public.assert(NOT EXISTS (
  (SELECT vehicle_id, year, make, model, trim_name, image_url, purchase_price, image_count, relationship, last_activity_at FROM garage_before
   EXCEPT SELECT vehicle_id, year, make, model, trim_name, image_url, purchase_price, image_count, relationship, last_activity_at
     FROM public.get_user_garage(auth.uid()))
  UNION ALL
  (SELECT vehicle_id, year, make, model, trim_name, image_url, purchase_price, image_count, relationship, last_activity_at
     FROM public.get_user_garage(auth.uid())
   EXCEPT SELECT vehicle_id, year, make, model, trim_name, image_url, purchase_price, image_count, relationship, last_activity_at FROM garage_before)),
  'every other garage column unchanged');
-- A stranger is tied to nothing.
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000002', false);
SELECT public.assert((SELECT count(*) = 0 FROM public.get_vehicle_class_prices(ARRAY['a0000000-0000-4000-8000-000000000000']::uuid[])),
  'a stranger gets no row');
SELECT public.assert((SELECT bool_and(current_value IS NULL) FROM public.get_user_garage('10000000-0000-4000-8000-000000000001')),
  'a stranger sees no class price in another account''s garage');
SELECT set_config('fixture.uid', '', false);
SELECT public.assert((SELECT count(*) = 0 FROM public.get_vehicle_class_prices(ARRAY['a0000000-0000-4000-8000-000000000000']::uuid[])),
  'a signed-in role without a user id gets no row');
RESET ROLE;

-- build_class_v4 (20261121090000): word boundaries in the rule, and a class version bump the refresh acts on ----------
SELECT set_config('fixture.role', '', false), set_config('fixture.uid', '', false);
\ir ../migrations/20261121090000_build_class_word_boundaries.sql
-- Idempotent.
\ir ../migrations/20261121090000_build_class_word_boundaries.sql

-- The bug: '\b' is a backspace in a PostgreSQL regular expression, '\y' the word boundary.
SELECT public.assert(NOT ('it is built' ~* '\b(built)\b') AND ('it is built' ~* '\y(built)\y'), '\b is not a word boundary, \y is');

-- Each fixed term, and the ambiguous phrases that must not decide a class (no receipts, no sessions, text only).
CREATE TEMP TABLE rule_cases(txt text, expected text, why text);
INSERT INTO rule_cases VALUES
 -- build words, now matched
 ('this car has been modified with a cam', 'modified', 'modified'),
 ('engine upgraded to a 302', 'modified', 'upgraded'),
 ('the 4-bolt wheels were swapped for 5-bolt', 'modified', 'swapped'),
 ('built 289 with aluminum heads', 'modified', 'a built engine by displacement'),
 ('built 289ci v8', 'modified', 'a built engine, displacement run into ci'),
 ('a built motor and 4 speed', 'modified', 'built motor'),
 ('built small block ford', 'modified', 'built small block'),
 ('professionally built by a shop', 'modified', 'professionally built'),
 ('fully built c4 automatic', 'modified', 'fully built'),
 ('kit-built 1932 ford coupe', 'modified', 'kit-built'),
 ('a custom build with a shaved dash', 'modified', 'custom build'),
 -- stock words, now matched
 ('same owner since 1984. completely stock', 'stock', 'completely stock'),
 ('said to remain totally stock', 'stock', 'totally stock'),
 ('100% stock or oem parts', 'stock', '100% stock'),
 ('numbers matching, upgraded brakes', 'stock', 'one stock and one build signal: the tie stays stock'),
 -- ambiguous: never a class on their own
 ('mustang stock #: 20231', 'unknown', 'a dealer stock number'),
 ('stock number 10716', 'unknown', 'a stock number'),
 ('inventory id: inv_026. status: in stock', 'unknown', 'in stock'),
 ('bought with money from the stock market', 'unknown', 'the stock market'),
 ('the stock air cleaner', 'unknown', 'a stock part'),
 ('was built in 1973', 'unknown', 'built in a year'),
 ('built at the san jose plant', 'unknown', 'built at a plant'),
 ('one of 500 built', 'unknown', 'production count'),
 ('built 1965 mustang', 'unknown', 'a year after built is not a displacement'),
 ('factory built', 'unknown', 'factory built'),
 ('factory air and power steering', 'unknown', 'a factory option'),
 ('factory a/c', 'unknown', 'a factory option'),
 ('it has a factory warranty', 'unknown', 'factory alone'),
 ('1971 chevrolet c10 custom deluxe', 'unknown', 'Custom as a trim name'),
 ('mustang custom fastback', 'unknown', 'Custom as a trim name'),
 ('has never been modified', 'unknown', 'negated modified'),
 ('it was not modified', 'unknown', 'negated modified'),
 ('an un-modified example', 'unknown', 'un-modified'),
 ('a non-modified car', 'unknown', 'non-modified'),
 ('powered by a modified version of the 289', 'unknown', 'a modified version of (history)'),
 ('shelby began manufacturing modified mustangs', 'unknown', 'manufacturing modified (history)'),
 (E'\bstock\b', 'unknown', 'a literal backspace no longer counts as a stock signal'),
 (E'\bmodified\b', 'modified', 'still a word');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM rule_cases c
  WHERE public.nuke_build_class_rule(0, 0, c.txt)->>'build_class' IS DISTINCT FROM c.expected),
  'rule cases: ' || coalesce((SELECT string_agg(format('%s [%s] got %s want %s', c.why, c.txt,
      public.nuke_build_class_rule(0, 0, c.txt)->>'build_class', c.expected), '; ')
    FROM rule_cases c WHERE public.nuke_build_class_rule(0, 0, c.txt)->>'build_class' IS DISTINCT FROM c.expected), ''));
-- Paper still wins over words: $5,000 of receipts is a documented build whatever the text says.
SELECT public.assert(public.nuke_build_class_rule(5000, 0, 'completely stock')->>'build_class' = 'documented_build', 'paper first');
-- Every pre-existing fixture keeps its class (none of their texts uses a fixed word).
SELECT public.assert(NOT EXISTS (SELECT 1 FROM class_before b
  WHERE b.j->>'build_class' IS DISTINCT FROM public.nuke_build_class(b.id)->>'build_class'), 'fixture classes unchanged');

-- Grants as 20261121073000 set them.
SELECT public.assert(has_function_privilege('anon', 'public.nuke_build_class_rule(numeric,integer,text)', 'EXECUTE'), 'anon runs the rule');
SELECT public.assert(NOT has_function_privilege('authenticated', 'public.classify_vehicle_build_class(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.refresh_vehicle_class_price(uuid,integer,integer,interval)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.refresh_vehicle_class_price(uuid,integer,integer,interval)', 'EXECUTE'),
  'writers stay service role only');

-- The bump: the version the refresh treats as current is the version the writer writes.
SELECT public.assert((SELECT substring(prosrc FROM 'c_class\s+constant text := ''([^'']+)''') FROM pg_proc
    WHERE oid = 'public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure) = 'v4_store_word_terms'
  AND (SELECT prosrc LIKE '%''v4_store_word_terms''%' AND prosrc NOT LIKE '%v3_store_text_paper%' FROM pg_proc
    WHERE oid = 'public.classify_vehicle_build_class(uuid[])'::regprocedure),
  'refresh c_class and the classifier''s method literal are the same new version');
SET ROLE service_role;
SELECT set_config('fixture.role', 'service_role', false);
DO $$ DECLARE r jsonb;
BEGIN
  PERFORM public.assert((SELECT count(*) FROM public.vehicle_build_class WHERE method_version = 'v3_store_text_paper') >= 14,
    'before: the cohort holds v3 rows');
  -- Every v3 member is out of date: the refresh reclassifies all 14 (the subject is always reclassified) and reprices.
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000000', 5000);
  PERFORM public.assert(r->>'status' = 'priced' AND (r->>'complete')::boolean AND (r->>'classified_this_call')::int = 14
    AND r->>'value' = '35000' AND r->>'n' = '6', 'the bump reclassifies the whole cohort: ' || r::text);
  PERFORM public.assert(NOT EXISTS (SELECT 1 FROM public.cohort_members('50000000-0000-4000-8000-000000000001') m
    JOIN public.vehicle_build_class b ON b.vehicle_id = m.vehicle_id WHERE b.method_version <> 'v4_store_word_terms'),
    'every cohort member is on v4');
  -- And a second refresh finds nothing out of date.
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000000');
  PERFORM public.assert((r->>'classified_this_call')::int = 0 AND r->>'status' = 'priced', 'v4 rows are current');
END $$;
RESET ROLE;

SELECT 'vehicle_class_price store, refresh, tied reader, garage value and classifier parity: PASS' AS result;
