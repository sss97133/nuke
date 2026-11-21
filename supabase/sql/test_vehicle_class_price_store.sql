-- Disposable synthetic contract; never production. Every id, name and amount below is invented.
-- vehicle_class_price_v1 (20261121073000): the build class is classified once by the definer (every receipt counts,
-- whoever filed it) into vehicle_build_class; refresh_vehicle_class_price prices a vehicle from that store, reporting
-- "cohort not yet classified (k of n)" until every member is classified; get_vehicle_class_prices returns a row only to
-- the accounts get_user_garage ties to the vehicle with money, or to the service role; get_user_garage.current_value is
-- the stored price; nuke_build_class gives the same answers as before; get_platform_stratified_price keeps its curated pool.
-- class_price_v2 (20261121110000): cohort resolution (exact, else the canonical name as a whole word) with its refusals,
-- registration through register_make_model_subject, never blanking a stored price, and the refresh queue (enqueue from
-- receipts and work sessions, drain, incomplete stays queued, errors retried, daily top-up, the controller's fifth row).
-- class price queue own cron (20261121170000): the controller restored byte for byte to its four slices; the job's command
-- run as pg_cron sends it (one query string): a cancelled refresh keeps its committed claim mark (attempt, error, back of
-- the line), leaves the stored price and the other queue rows intact, is not re-claimed within 5 minutes, waits a day after 3.
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
 ('built 302, with edelbrock heads', 'modified', 'a built engine before a comma'),
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
 ('ford built 607,568 mustangs for 1966', 'unknown', 'a production count'),
 ('chevy built 221,000 camaros', 'unknown', 'a production count'),
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


-- class_price_v2 (20261121110000): cohort resolution and registration for owned cars, never blank, and the refresh queue --
-- Fixture columns and objects the new migration reads, as live (2026-11-20).
SELECT set_config('fixture.role', '', false), set_config('fixture.uid', '', false);
ALTER TABLE public.canonical_models ADD COLUMN year_start int, ADD COLUMN year_end int;
ALTER TABLE public.make_model_profiles ALTER COLUMN subject_id SET DEFAULT gen_random_uuid(),
  ADD COLUMN cohort_label text, ADD COLUMN basis text,
  ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE UNIQUE INDEX make_model_profiles_cohort_key ON public.make_model_profiles
  (canonical_make, canonical_model, year, grain, year_start, year_end) NULLS NOT DISTINCT;
-- Signed-in writers file their own receipts (receipts_own already reads them).
CREATE POLICY receipts_insert_own ON public.receipts FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY receipts_update_own ON public.receipts FOR UPDATE USING (user_id = auth.uid());
-- The four existing derived queues, as stubs that record their calls.
CREATE TABLE public.fixture_drain_calls(id bigserial PRIMARY KEY, fn text);
GRANT USAGE ON SEQUENCE public.fixture_drain_calls_id_seq TO service_role;
CREATE FUNCTION public.drain_vehicle_metric_queue(integer) RETURNS TABLE(processed integer, errored integer) LANGUAGE plpgsql AS
  $$ BEGIN INSERT INTO public.fixture_drain_calls(fn) VALUES ('metric'); RETURN QUERY SELECT 0, 0; END $$;
CREATE FUNCTION public.drain_vehicle_stats_queue(integer) RETURNS TABLE(processed integer, errored integer) LANGUAGE plpgsql AS
  $$ BEGIN INSERT INTO public.fixture_drain_calls(fn) VALUES ('stats'); RETURN QUERY SELECT 0, 0; END $$;
CREATE FUNCTION public.drain_vehicle_value_queue(integer) RETURNS TABLE(processed integer, errored integer) LANGUAGE plpgsql AS
  $$ BEGIN INSERT INTO public.fixture_drain_calls(fn) VALUES ('value'); RETURN QUERY SELECT 0, 0; END $$;
CREATE FUNCTION public.drain_vehicle_completion_queue(integer) RETURNS TABLE(processed integer, errored integer) LANGUAGE plpgsql AS
  $$ BEGIN INSERT INTO public.fixture_drain_calls(fn) VALUES ('completion'); RETURN QUERY SELECT 0, 0; END $$;
-- Live drain_vehicle_derived_queues, verbatim (pg_get_functiondef 2026-11-20).
CREATE OR REPLACE FUNCTION public.drain_vehicle_derived_queues(p_include_value boolean DEFAULT false, p_budget_seconds integer DEFAULT 45)
 RETURNS TABLE(queue text, processed integer, errored integer, skipped boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  -- A NULL or absurd budget cannot switch the time stop off.
  v_budget integer := least(greatest(coalesce(p_budget_seconds, 45), 5), 60);
  v_t0     timestamptz := clock_timestamp();
  v_until  timestamptz;
  v_p      integer;
  v_e      integer;
  v_chunk  integer;
  v_cap    integer;
  v_failed_chunks integer;
  v_name   text;
BEGIN
  -- The drains' writebacks must not re-enqueue completion recomputes (update_vehicle_completion reads this).
  PERFORM set_config('app.skip_completion_enqueue', '1', true);
  -- Transaction-local (set_config(..., true)): it reverts when the calling transaction, the cron job's own, ends.
  -- A vehicles row held by another writer fails that one vehicle after 2 s; the drain re-queues it.
  PERFORM set_config('lock_timeout', '2s', true);

  -- Metric starts chunks in the first half; siblings stop starting chunks at two thirds of the budget.
  -- The reserved sixth lets stats and completion progress after a metric burst; the final third is headroom.
  FOREACH v_name IN ARRAY ARRAY['metric', 'stats', 'value', 'completion'] LOOP
    queue := v_name; processed := 0; errored := 0; skipped := false; v_failed_chunks := 0;
    v_until := v_t0 + make_interval(secs => v_budget / CASE WHEN v_name = 'metric' THEN 2.0 ELSE 1.5 END);

    IF v_name = 'value' AND NOT p_include_value THEN
      skipped := true;                       -- off until the sale data is clean
    ELSIF clock_timestamp() >= v_until THEN
      skipped := true;                       -- this queue's slice is spent; the next run continues
    ELSE
      -- chunk = rows per inner call; cap = rows per run. Stats and value make one call.
      v_chunk := CASE v_name WHEN 'metric' THEN 10 WHEN 'completion' THEN 25 WHEN 'stats' THEN 50 ELSE 100 END;
      v_cap   := CASE v_name WHEN 'metric' THEN 500 WHEN 'completion' THEN 1000 ELSE v_chunk END;
      LOOP
        BEGIN
          v_p := NULL; v_e := NULL;
          CASE v_name
            WHEN 'metric'     THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_metric_queue(v_chunk) d;
            WHEN 'completion' THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_completion_queue(v_chunk) d;
            WHEN 'stats'      THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_stats_queue(v_chunk) d;
            WHEN 'value'      THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_value_queue(v_chunk) d;
          END CASE;
        EXCEPTION
          WHEN query_canceled THEN
            RAISE;                           -- the job's own budget fired; fail loudly, do not swallow
          WHEN OTHERS THEN
            errored := -1;                   -- whole-call failure; earlier chunks of this run stay done
            RAISE WARNING 'drain_vehicle_%_queue failed: %', v_name, SQLERRM;
        END;
        EXIT WHEN errored = -1;
        processed := processed + coalesce(v_p, 0);
        errored   := errored + coalesce(v_e, 0);
        IF coalesce(v_e, 0) > 0 THEN v_failed_chunks := v_failed_chunks + 1; END IF;
        IF v_failed_chunks >= 3 OR errored > 0.2 * (processed + errored) THEN
          RAISE WARNING 'drain_vehicle_%_queue stopped for this run: % failed rows in % chunks', v_name, errored, v_failed_chunks;
          EXIT;
        END IF;
        -- Stop when the queue ran short, the cap is reached, or this queue's slice has no time for another chunk.
        EXIT WHEN coalesce(v_p, 0) + coalesce(v_e, 0) < v_chunk
               OR processed + errored >= v_cap
               OR clock_timestamp() >= v_until;
      END LOOP;
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$function$;
-- Live register_make_model_subject, verbatim (pg_get_functiondef 2026-11-20).
CREATE OR REPLACE FUNCTION public.register_make_model_subject(p_make text, p_model text, p_year integer DEFAULT NULL::integer, p_grain text DEFAULT 'year'::text, p_year_start integer DEFAULT NULL::integer, p_year_end integer DEFAULT NULL::integer, p_label text DEFAULT NULL::text, p_basis text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_cm public.canonical_models%rowtype;
  v_ys integer;
  v_ye integer;
  v_swap integer;
  v_max_year integer := extract(year from now())::int + 1;
begin
  if p_make is null or length(trim(p_make)) < 1 or p_model is null or length(trim(p_model)) < 1 then
    return null;
  end if;
  if p_grain not in ('year','generation','model') then return null; end if;
  if p_grain = 'year' and (p_year is null or p_year < 1885 or p_year > v_max_year) then return null; end if;

  select * into v_cm from public.canonical_models cm
   where lower(cm.make) = lower(p_make)
     and (lower(cm.canonical_model) = lower(p_model)
          or lower(p_model) = any (select lower(a) from unnest(cm.aliases) a))
   limit 1;

  if p_grain <> 'year' then
    v_ys := coalesce(p_year_start, v_cm.year_start, 1885);
    v_ye := coalesce(p_year_end, v_cm.year_end, v_max_year);
    if v_ys > v_ye then
      v_swap := v_ys; v_ys := v_ye; v_ye := v_swap;
    end if;
    if v_ye > v_max_year then v_ye := v_max_year; end if;
    if v_ys < 1885 then v_ys := 1885; end if;
  end if;

  insert into public.make_model_profiles
    (canonical_make, canonical_model, grain, year, year_start, year_end, canonical_model_id, cohort_label, basis)
  values (
    upper(coalesce(v_cm.make, p_make)),
    coalesce(v_cm.canonical_model, p_model),
    p_grain,
    case when p_grain = 'year' then p_year end,
    case when p_grain <> 'year' then v_ys end,
    case when p_grain <> 'year' then v_ye end,
    v_cm.id, p_label, p_basis
  )
  on conflict (canonical_make, canonical_model, year, grain, year_start, year_end) do update
    set updated_at = now(),
        canonical_model_id = coalesce(excluded.canonical_model_id, public.make_model_profiles.canonical_model_id),
        cohort_label = coalesce(excluded.cohort_label, public.make_model_profiles.cohort_label),
        basis = coalesce(excluded.basis, public.make_model_profiles.basis)
  returning subject_id into v_id;
  return v_id;
end;
$function$
;
SELECT public.assert(md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure))
  = 'f2e15e76d18ecfdd966451635b0fa677', 'fixture drain controller is the live body'); -- gitleaks:allow (function fingerprint, not a secret)
SELECT public.assert(md5(pg_get_functiondef('public.register_make_model_subject(text,text,integer,text,integer,integer,text,text)'::regprocedure))
  = 'd32567070a7695b3aa77d82d9014d540', 'fixture register_make_model_subject is the live body'); -- gitleaks:allow (function fingerprint, not a secret)
SELECT public.assert(md5(pg_get_functiondef('public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure))
  = '90041fe7e3651974716ed3ac40a78bfd', 'refresh is the 20261121090000 body, as live'); -- gitleaks:allow (function fingerprint, not a secret)
CREATE TEMP TABLE drain_pre AS SELECT pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure) AS d;

-- A make with the shapes the live table has: duplicate-looking aliases across models, numeric aliases, junk aliases,
-- recorded and unrecorded years, a name that is another model's alias.
INSERT INTO public.canonical_models(id, make, canonical_model, aliases, year_start, year_end) VALUES
 ('c1000000-0000-4000-8000-000000000001', 'Truckco', 'K10', ARRAY['k10', 'k-10', 'cheyenne'], 1960, 1987),
 ('c1000000-0000-4000-8000-000000000002', 'Truckco', 'K20', ARRAY['k20'], 1960, 1987),
 ('c1000000-0000-4000-8000-000000000003', 'Truckco', 'C2500', ARRAY['c2500', '2500'], NULL, NULL),
 ('c1000000-0000-4000-8000-000000000004', 'Truckco', 'Suburban', ARRAY['suburban', 'sub', 'jimmy'], 1935, NULL),
 ('c1000000-0000-4000-8000-000000000005', 'Truckco', 'Jimmy', ARRAY['jimmy'], 1970, 1991),
 ('c1000000-0000-4000-8000-000000000006', 'Truckco', 'Silverado', ARRAY['silverado', 'silverado 1500'], NULL, NULL),
 ('c1000000-0000-4000-8000-000000000007', 'Truckco', 'Deluxe', ARRAY['deluxe', 'hot rod', 'f'], NULL, NULL),
 ('c1000000-0000-4000-8000-000000000008', 'Truckco', 'K1500', ARRAY['k1500', 'k2500'], 1960, NULL),
 ('c1000000-0000-4000-8000-000000000009', 'Truckco', 'Pickup', ARRAY['pickup', 'custom', 'k2500'], NULL, NULL),
 ('c1000000-0000-4000-8000-000000000010', 'Truckco', 'Blazer', ARRAY['blazer'], 1965, NULL),
 ('c1000000-0000-4000-8000-000000000011', 'Truckco', 'K5 Blazer', ARRAY['k5', 'blazer'], 1969, 1991),
 ('c1000000-0000-4000-8000-000000000012', 'Truckco', 'Coupe', ARRAY['3-window', 'coupe'], 1908, NULL);
INSERT INTO public.make_model_profiles(subject_id, canonical_make, canonical_model, canonical_model_id, grain, year) VALUES
 ('51000000-0000-4000-8000-000000000001', 'TRUCKCO', 'Jimmy', 'c1000000-0000-4000-8000-000000000005', 'year', 1977),
 ('51000000-0000-4000-8000-000000000002', 'TRUCKCO', 'Rat Rod', NULL, 'year', 1950),
 ('51000000-0000-4000-8000-000000000003', 'TRUCKCO', 'K20', 'c1000000-0000-4000-8000-000000000002', 'year', 1975);

\ir ../migrations/20261121110000_class_price_cohorts_and_queue.sql
-- Idempotent: a second apply passes the guard on this migration's own bodies and changes nothing.
CREATE TEMP TABLE bodies_after AS SELECT p.oid::regprocedure::text AS fn, pg_get_functiondef(p.oid) AS d FROM pg_proc p
  WHERE p.oid IN ('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure,
                  'public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure);
\ir ../migrations/20261121110000_class_price_cohorts_and_queue.sql
SELECT public.assert(NOT EXISTS (SELECT 1 FROM bodies_after b WHERE b.d IS DISTINCT FROM pg_get_functiondef(b.fn::regprocedure)),
  're-apply leaves the bodies as they were');

-- The four existing slices are byte-identical: the new controller is the live body through its FOREACH loop.
SELECT public.assert((SELECT left(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure),
    length(d) - length(E'END;\n$function$\n'))
  = left(d, length(d) - length(E'END;\n$function$\n')) FROM drain_pre), 'controller unchanged through its four slices');

-- Resolution: the cases, with the refusals --------------------------------------------------------------------------------
CREATE TEMP TABLE resolve_cases(make text, model text, year int, tier text, canon text, register boolean, subject uuid, refusal text, why text);
INSERT INTO resolve_cases VALUES
 ('Truckco', 'K10 SWB', 1972, 'word', 'K10', true, NULL, NULL, 'the name K10 is a whole word of the model'),
 ('Truckco', 'Suburban 2500', 1995, 'word', 'Suburban', true, NULL, NULL, '"2500" is an alias of C2500, and aliases are not word-matched'),
 ('Truckco', 'K10', 1972, 'exact', 'K10', true, NULL, NULL, 'exact name'),
 ('Truckco', 'Silverado 1500', 2004, 'exact', 'Silverado', true, NULL, NULL, 'exact alias; the name is a whole word, so it may be registered'),
 ('Truckco', 'Coupe', 1932, 'exact', 'Coupe', true, NULL, NULL, 'exact name inside its years'),
 ('Truckco', 'Hot Rod', 1932, 'exact', 'Deluxe', false, NULL, 'Deluxe is matched only through an alias%', 'a junk alias resolves but never registers'),
 ('Truckco', 'K2500', 1983, 'none', NULL, false, NULL, 'the model matches 2 canonical models exactly (k1500, pickup)', 'exact tie, no profile: refused'),
 ('Truckco', 'Jimmy', 1977, 'exact', 'Jimmy', false, '51000000-0000-4000-8000-000000000001', NULL, 'exact tie broken by the existing year profile'),
 ('Truckco', 'Jimmy', 1978, 'none', NULL, false, NULL, 'the model matches 2 canonical models exactly (jimmy, suburban)', 'exact tie, no profile: refused'),
 ('Truckco', 'Silverado K10', 1980, 'none', NULL, false, NULL, 'the model names 2 canonical models (k10, silverado)', 'two names: refused'),
 ('Truckco', 'Blazer Chalet', 1975, 'word', 'Blazer', false, NULL, 'another canonical model of the make lists Blazer as an alias%', 'register would re-resolve the name with LIMIT 1'),
 ('Truckco', '3-Window Coupe (kit)', 1932, 'none', NULL, false, NULL, 'the model names a kit or replica%', 'kit'),
 ('Truckco', 'Coupe Replica', 1932, 'none', NULL, false, NULL, 'the model names a kit or replica%', 'replica'),
 ('Truckco', 'K20 LWB', 1995, 'none', NULL, false, NULL, NULL, 'outside the recorded years of K20'),
 ('Truckco', 'Custom 10', 1972, 'none', NULL, false, NULL, NULL, 'an alias ("custom") is not word-matched'),
 ('Truckco', 'K100', 1972, 'none', NULL, false, NULL, NULL, 'no substring: K10 is not a word of K100'),
 ('Truckco', 'Subway', 1972, 'none', NULL, false, NULL, NULL, 'no substring: sub is an alias, not a word here'),
 ('Truckco', 'Rat Rod', 1950, 'raw', NULL, false, '51000000-0000-4000-8000-000000000002', NULL, 'a profile under the raw string is still read'),
 ('Truckco', '', 1972, 'none', NULL, false, NULL, 'vehicle missing year, make or model', 'no model');
GRANT SELECT ON resolve_cases TO service_role;
SET ROLE service_role;
SELECT set_config('fixture.role', 'service_role', false);
SELECT public.assert(NOT EXISTS (SELECT 1 FROM resolve_cases c, LATERAL (SELECT public.resolve_class_price_cohort(c.make, c.model, c.year) j) r
  WHERE r.j->>'tier' IS DISTINCT FROM c.tier OR r.j->>'canonical_model' IS DISTINCT FROM c.canon
     OR (r.j->>'register')::boolean IS DISTINCT FROM c.register OR (r.j->>'subject_id')::uuid IS DISTINCT FROM c.subject
     OR NOT (coalesce(r.j->>'refusal', r.j->>'register_refusal', '') LIKE coalesce(c.refusal, ''))),
  'resolution cases: ' || coalesce((SELECT string_agg(format('%s [%s %s] got %s', c.why, c.model, c.year,
      public.resolve_class_price_cohort(c.make, c.model, c.year)), '; ')
    FROM resolve_cases c, LATERAL (SELECT public.resolve_class_price_cohort(c.make, c.model, c.year) j) r
    WHERE r.j->>'tier' IS DISTINCT FROM c.tier OR r.j->>'canonical_model' IS DISTINCT FROM c.canon
       OR (r.j->>'register')::boolean IS DISTINCT FROM c.register OR (r.j->>'subject_id')::uuid IS DISTINCT FROM c.subject
       OR NOT (coalesce(r.j->>'refusal', r.j->>'register_refusal', '') LIKE coalesce(c.refusal, ''))), ''));
-- The existing fixture cohort resolves as before.
SELECT public.assert(public.resolve_class_price_cohort('Fixture', 'Coupe GT', 1973)->>'subject_id' = '50000000-0000-4000-8000-000000000001',
  'an exact alias still finds its registered cohort');
RESET ROLE;

-- Registration through the refresh ---------------------------------------------------------------------------------------
-- R0 is O's 1972 "K10 SWB" (a build); R1-R5 sold K10 builds, R6 a sold build named by an alias; H0 a "Hot Rod", G0 a kit.
INSERT INTO public.vehicles(id, year, make, model, description, user_id) VALUES
 ('d0000000-0000-4000-8000-000000000000', 1972, 'Truckco', 'K10 SWB', 'lifted', '10000000-0000-4000-8000-000000000001'),
 ('d0000000-0000-4000-8000-000000000001', 1972, 'Truckco', 'K10', 'lifted', NULL),
 ('d0000000-0000-4000-8000-000000000002', 1972, 'Truckco', 'K10', 'lifted', NULL),
 ('d0000000-0000-4000-8000-000000000003', 1972, 'Truckco', 'K10', 'lifted', NULL),
 ('d0000000-0000-4000-8000-000000000004', 1972, 'Truckco', 'K10', 'lifted', NULL),
 ('d0000000-0000-4000-8000-000000000005', 1972, 'Truckco', 'K10', 'lifted', NULL),
 ('d0000000-0000-4000-8000-000000000006', 1972, 'Truckco', 'Cheyenne', 'lifted', NULL),
 ('d0000000-0000-4000-8000-000000000007', 1932, 'Truckco', 'Hot Rod', 'lifted', NULL),
 ('d0000000-0000-4000-8000-000000000008', 1932, 'Truckco', '3-Window Coupe (kit)', 'lifted', NULL);
INSERT INTO public.vehicle_events(vehicle_id, final_price) VALUES
 ('d0000000-0000-4000-8000-000000000001', 10000), ('d0000000-0000-4000-8000-000000000002', 20000),
 ('d0000000-0000-4000-8000-000000000003', 30000), ('d0000000-0000-4000-8000-000000000004', 40000),
 ('d0000000-0000-4000-8000-000000000005', 50000), ('d0000000-0000-4000-8000-000000000006', 60000);
SET ROLE service_role;
DO $$ DECLARE r jsonb; v_subject uuid;
BEGIN
  r := public.refresh_vehicle_class_price('d0000000-0000-4000-8000-000000000000', 5000);
  PERFORM public.assert(r->>'status' = 'priced' AND (r->>'registered')::boolean AND r->>'resolution' = 'word'
    AND r->>'value' = '35000' AND r->>'n' = '6' AND r->>'cohort' = '1972 Truckco K10', 'K10 SWB registers 1972 K10 and prices: ' || r::text);
  SELECT subject_id INTO v_subject FROM public.make_model_profiles WHERE canonical_model = 'K10' AND year = 1972;
  PERFORM public.assert((SELECT count(*) = 1 AND bool_and(canonical_make = 'TRUCKCO' AND grain = 'year'
      AND canonical_model_id = 'c1000000-0000-4000-8000-000000000001')
    FROM public.make_model_profiles WHERE lower(canonical_model) = 'k10' AND year = 1972), 'one year profile, under the canonical name and row');
  PERFORM public.assert(EXISTS (SELECT 1 FROM public.cohort_members(v_subject) WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000000'),
    'the subject is a member of the cohort it resolved to');
  PERFORM public.assert((SELECT cohort_subject_id = v_subject AND method_version = 'class_price_v2'
    FROM public.vehicle_class_price WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000000'), 'stored against the registered cohort');
  -- A second refresh finds the profile and registers nothing.
  r := public.refresh_vehicle_class_price('d0000000-0000-4000-8000-000000000000', 5000);
  PERFORM public.assert(r->>'status' = 'priced' AND NOT (r->>'registered')::boolean, 'second refresh reuses the profile: ' || r::text);
  PERFORM public.assert((SELECT count(*) FROM public.make_model_profiles WHERE lower(canonical_model) = 'k10') = 1, 'no duplicate profile');

  -- Refused registrations write a definitive blocked reason and no profile; never the raw string.
  r := public.refresh_vehicle_class_price('d0000000-0000-4000-8000-000000000007', 5000);
  PERFORM public.assert(r->>'status' = 'blocked' AND r->>'reason' LIKE 'no registered cohort for this year-make-model: Deluxe is matched only through an alias%',
    'Hot Rod is not registered as Deluxe: ' || r::text);
  r := public.refresh_vehicle_class_price('d0000000-0000-4000-8000-000000000008', 5000);
  PERFORM public.assert(r->>'status' = 'blocked' AND r->>'reason' LIKE 'no registered cohort for this year-make-model: the model names a kit or replica%',
    'the kit is refused: ' || r::text);
  PERFORM public.assert(NOT EXISTS (SELECT 1 FROM public.make_model_profiles WHERE canonical_make = 'TRUCKCO'
    AND lower(canonical_model) IN ('deluxe', 'hot rod', '3-window coupe (kit)', 'coupe')), 'nothing registered for them');
  -- A vehicle with no canonical model at all keeps the plain reason.
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000033', 5000);
  PERFORM public.assert(r->>'reason' = 'no registered cohort for this year-make-model', 'T unchanged: ' || r::text);
END $$;
RESET ROLE;

-- Never blank -----------------------------------------------------------------------------------------------------------
-- A fixture switch makes each classification statement take 1.1 s, so a 1 s budget cannot finish a cohort.
CREATE FUNCTION public.fixture_slow_classify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('fixture.slow_classify', true) = 'on' THEN PERFORM pg_sleep(1.1); END IF; RETURN NULL; END $$;
CREATE TRIGGER fixture_slow_classify AFTER INSERT ON public.vehicle_build_class FOR EACH STATEMENT EXECUTE FUNCTION public.fixture_slow_classify();
-- A new, unclassified member of S's cohort.
INSERT INTO public.vehicles(id, year, make, model, description) VALUES
 ('a0000000-0000-4000-8000-000000000008', 1973, 'Fixture', 'Coupe', 'lifted, unsold');
CREATE TEMP TABLE s_before AS SELECT * FROM public.vehicle_class_price WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000';
GRANT SELECT ON s_before TO service_role;
SELECT public.assert((SELECT status = 'priced' AND value = 35000 FROM s_before), 'S starts priced');
SET ROLE service_role;
SELECT set_config('fixture.slow_classify', 'on', false);
DO $$ DECLARE r jsonb;
BEGIN
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000000', 1000);
  PERFORM public.assert(r->>'status' = 'pending' AND NOT (r->>'complete')::boolean AND (r->>'kept_prior_price')::boolean
    AND r->>'reason' = 'cohort not yet classified (15 of 16)', 'an unfinished cohort keeps the price: ' || r::text);
  PERFORM public.assert((SELECT (c.*)::text = (b.*)::text FROM public.vehicle_class_price c, s_before b
    WHERE c.vehicle_id = 'a0000000-0000-4000-8000-000000000000'), 'the stored priced row is untouched, computed_at included');
END $$;
SELECT set_config('fixture.slow_classify', 'off', false);
DO $$ DECLARE r jsonb;
BEGIN
  -- Finished: replaced by the completed computation.
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000000', 5000);
  PERFORM public.assert(r->>'status' = 'priced' AND (r->>'complete')::boolean AND r->>'value' = '35000', 'completed: ' || r::text);
  PERFORM public.assert((SELECT cohort_members = 16 AND cohort_classified = 16 AND computed_at > (SELECT computed_at FROM s_before)
    FROM public.vehicle_class_price WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000'), 'the completed row replaces it');
END $$;
RESET ROLE;
-- A definitive blocked reason does replace a priced row: P loses its only build signal.
UPDATE public.vehicles SET description = NULL WHERE id = 'a0000000-0000-4000-8000-000000000031';
SET ROLE service_role;
DO $$ DECLARE r jsonb;
BEGIN
  PERFORM public.assert((SELECT status = 'priced' FROM public.vehicle_class_price WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000031'), 'P was priced');
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000031', 0);
  PERFORM public.assert(r->>'status' = 'blocked' AND (r->>'complete')::boolean AND r->>'reason' LIKE 'subject build class unknown%', 'P: ' || r::text);
  PERFORM public.assert((SELECT status = 'blocked' AND value IS NULL FROM public.vehicle_class_price
    WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000031'), 'a definitive reason replaces the price');
END $$;
-- First computation of a vehicle never priced: the unfinished cohort is written as blocked, k of n (as before).
INSERT INTO public.vehicles(id, year, make, model, description) VALUES
 ('a0000000-0000-4000-8000-000000000009', 1973, 'Fixture', 'Coupe', 'lifted, unsold too');
SELECT set_config('fixture.slow_classify', 'on', false);
DO $$ DECLARE r jsonb;
BEGIN
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000012', 1000);
  PERFORM public.assert(r->>'status' = 'blocked' AND NOT (r->>'complete')::boolean AND r->>'reason' = 'cohort not yet classified (16 of 17)',
    'K2 first computation: ' || r::text);
  PERFORM public.assert((SELECT status = 'blocked' AND blocked_reason = 'cohort not yet classified (16 of 17)'
    FROM public.vehicle_class_price WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000012'), 'stored as blocked');
END $$;
SELECT set_config('fixture.slow_classify', 'off', false);
RESET ROLE;

-- The queue: enqueue from paper -------------------------------------------------------------------------------------------
DELETE FROM public.vehicle_class_price_recompute_queue;
-- O files a receipt and logs a work session as a signed-in user: both writes succeed and enqueue, without a queue grant.
SET ROLE authenticated;
SELECT set_config('fixture.role', 'authenticated', false), set_config('fixture.uid', '10000000-0000-4000-8000-000000000001', false);
INSERT INTO public.receipts(id, vehicle_id, user_id, total_amount)
  VALUES ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 120);
INSERT INTO public.work_sessions(vehicle_id, user_id, session_date, session_type)
  VALUES ('d0000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', current_date, 'manual');
SELECT public.refuses('SELECT * FROM public.vehicle_class_price_recompute_queue', '42501');
SELECT public.refuses('SELECT * FROM public.drain_vehicle_class_price_queue(1, 5000)', '42501');
SELECT public.refuses($$SELECT public.resolve_class_price_cohort('Truckco', 'K10', 1972)$$, '42501');
SELECT public.refuses($$INSERT INTO public.vehicle_class_price_recompute_queue(vehicle_id) VALUES (gen_random_uuid())$$, '42501');
RESET ROLE;
SELECT set_config('fixture.role', '', false), set_config('fixture.uid', '', false);
SELECT public.assert((SELECT array_agg(vehicle_id::text || ':' || reason ORDER BY reason) FROM public.vehicle_class_price_recompute_queue)
  = ARRAY['d0000000-0000-4000-8000-000000000006:receipt', 'd0000000-0000-4000-8000-000000000005:work_session'],
  'a receipt and a work session enqueue their vehicles');
-- Only the columns the classifier reads enqueue: a change of filer does not, a supersession does, a move enqueues both
-- vehicles, a deletion the old one.
DELETE FROM public.vehicle_class_price_recompute_queue;
UPDATE public.receipts SET user_id = '10000000-0000-4000-8000-000000000002' WHERE id = 'e0000000-0000-4000-8000-000000000001';
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_class_price_recompute_queue), 'a filer change does not enqueue');
UPDATE public.receipts SET superseded_at = now() WHERE id = 'e0000000-0000-4000-8000-000000000001';
SELECT public.assert((SELECT array_agg(vehicle_id) FROM public.vehicle_class_price_recompute_queue)
  = ARRAY['d0000000-0000-4000-8000-000000000006'::uuid], 'a supersession enqueues');
DELETE FROM public.vehicle_class_price_recompute_queue;
UPDATE public.receipts SET vehicle_id = 'd0000000-0000-4000-8000-000000000004' WHERE id = 'e0000000-0000-4000-8000-000000000001';
SELECT public.assert((SELECT array_agg(vehicle_id ORDER BY vehicle_id) FROM public.vehicle_class_price_recompute_queue)
  = ARRAY['d0000000-0000-4000-8000-000000000004'::uuid, 'd0000000-0000-4000-8000-000000000006'::uuid], 'a move enqueues both vehicles');
DELETE FROM public.vehicle_class_price_recompute_queue;
DELETE FROM public.receipts WHERE id = 'e0000000-0000-4000-8000-000000000001';
SELECT public.assert((SELECT array_agg(vehicle_id) FROM public.vehicle_class_price_recompute_queue)
  = ARRAY['d0000000-0000-4000-8000-000000000004'::uuid], 'a deletion enqueues the old vehicle');
-- An enqueue that fails never fails the paper.
CREATE FUNCTION public.fixture_fail_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('fixture.fail_enqueue', true) = 'on' THEN RAISE EXCEPTION 'synthetic enqueue failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER fixture_fail_enqueue BEFORE INSERT ON public.vehicle_class_price_recompute_queue
  FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_enqueue();
DELETE FROM public.vehicle_class_price_recompute_queue;
SELECT set_config('fixture.fail_enqueue', 'on', false);
SET ROLE authenticated;
SELECT set_config('fixture.role', 'authenticated', false), set_config('fixture.uid', '10000000-0000-4000-8000-000000000001', false);
INSERT INTO public.receipts(id, vehicle_id, user_id, total_amount)
  VALUES ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 80);
RESET ROLE;
SELECT set_config('fixture.fail_enqueue', 'off', false), set_config('fixture.role', '', false), set_config('fixture.uid', '', false);
SELECT public.assert(EXISTS (SELECT 1 FROM public.receipts WHERE id = 'e0000000-0000-4000-8000-000000000002')
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_class_price_recompute_queue), 'the receipt landed; the failed enqueue only warned');

-- The queue: drain --------------------------------------------------------------------------------------------------------
-- Every stored row is fresh, so the daily top-up adds nothing; R0 and R5 are queued and both complete.
INSERT INTO public.vehicle_class_price_recompute_queue(vehicle_id, reason) VALUES
 ('d0000000-0000-4000-8000-000000000000', 'receipt'), ('d0000000-0000-4000-8000-000000000005', 'work_session');
SET ROLE service_role;
SELECT set_config('fixture.role', 'service_role', false);
SELECT public.assert((SELECT processed = 2 AND errored = 0 FROM public.drain_vehicle_class_price_queue(5, 5000)), 'two refreshed');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_class_price_recompute_queue), 'completed ids leave the queue');
SELECT public.assert((SELECT status = 'priced' AND value = 30000 AND n = 5 FROM public.vehicle_class_price
  WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000005'), 'R5 priced by the drain against the other builds');
-- Too little budget: nothing claimed. Just enough to claim but not to refresh: put back as not_reached.
RESET ROLE;
INSERT INTO public.vehicle_class_price_recompute_queue(vehicle_id, reason) VALUES ('d0000000-0000-4000-8000-000000000001', 'receipt');
SET ROLE service_role;
SELECT public.assert((SELECT processed = 0 AND errored = 0 FROM public.drain_vehicle_class_price_queue(5, 999)), 'under 1 s: nothing');
SELECT public.assert((SELECT reason = 'receipt' FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000001'), 'still queued as it was');
RESET ROLE;
-- A claim that takes 20 ms leaves under 1 s of a 1 s budget.
CREATE FUNCTION public.fixture_slow_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('fixture.slow_claim', true) = 'on' THEN PERFORM pg_sleep(0.02); END IF; RETURN OLD; END $$;
CREATE TRIGGER fixture_slow_claim BEFORE DELETE ON public.vehicle_class_price_recompute_queue
  FOR EACH ROW EXECUTE FUNCTION public.fixture_slow_claim();
SET ROLE service_role;
SELECT set_config('fixture.slow_claim', 'on', false);
SELECT public.assert((SELECT processed = 0 FROM public.drain_vehicle_class_price_queue(5, 1000)), 'claimed, not reached');
SELECT set_config('fixture.slow_claim', 'off', false);
SELECT public.assert((SELECT reason = 'not_reached' FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000001'), 'not reached: back in the queue');
RESET ROLE;
DELETE FROM public.vehicle_class_price_recompute_queue;

-- Incomplete stays queued; the stored price stays. The 1975 K20 cohort: Z0 and 5 sold builds; then one new member.
INSERT INTO public.vehicles(id, year, make, model, description) VALUES
 ('f0000000-0000-4000-8000-000000000000', 1975, 'Truckco', 'K20', 'lifted'),
 ('f0000000-0000-4000-8000-000000000001', 1975, 'Truckco', 'K20', 'lifted'),
 ('f0000000-0000-4000-8000-000000000002', 1975, 'Truckco', 'K20', 'lifted'),
 ('f0000000-0000-4000-8000-000000000003', 1975, 'Truckco', 'K20', 'lifted'),
 ('f0000000-0000-4000-8000-000000000004', 1975, 'Truckco', 'K20', 'lifted'),
 ('f0000000-0000-4000-8000-000000000005', 1975, 'Truckco', 'K20', 'lifted');
INSERT INTO public.vehicle_events(vehicle_id, final_price) VALUES
 ('f0000000-0000-4000-8000-000000000001', 11000), ('f0000000-0000-4000-8000-000000000002', 12000),
 ('f0000000-0000-4000-8000-000000000003', 13000), ('f0000000-0000-4000-8000-000000000004', 14000),
 ('f0000000-0000-4000-8000-000000000005', 15000);
INSERT INTO public.vehicle_class_price_recompute_queue(vehicle_id, reason) VALUES ('f0000000-0000-4000-8000-000000000000', 'receipt');
SET ROLE service_role;
SELECT set_config('fixture.slow_classify', 'on', false);
-- First pass, never priced: incomplete, written as blocked k of n, kept in the queue.
SELECT public.assert((SELECT processed = 1 FROM public.drain_vehicle_class_price_queue(1, 1100)), 'one refresh ran');
SELECT public.assert((SELECT reason = 'incomplete' FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'f0000000-0000-4000-8000-000000000000'), 'incomplete stays queued');
SELECT public.assert((SELECT status = 'blocked' AND blocked_reason = 'cohort not yet classified (1 of 6)'
  FROM public.vehicle_class_price WHERE vehicle_id = 'f0000000-0000-4000-8000-000000000000'), 'first pass writes k of n');
SELECT set_config('fixture.slow_classify', 'off', false);
SELECT public.assert((SELECT processed = 1 FROM public.drain_vehicle_class_price_queue(1, 5000)), 'second pass ran');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_class_price_recompute_queue), 'complete: dequeued');
SELECT public.assert((SELECT status = 'priced' AND value = 13000 AND n = 5 FROM public.vehicle_class_price
  WHERE vehicle_id = 'f0000000-0000-4000-8000-000000000000'), 'priced from the profile that already existed');
RESET ROLE;
INSERT INTO public.vehicles(id, year, make, model, description) VALUES ('f0000000-0000-4000-8000-000000000006', 1975, 'Truckco', 'K20', 'lifted');
CREATE TEMP TABLE z_before AS SELECT * FROM public.vehicle_class_price WHERE vehicle_id = 'f0000000-0000-4000-8000-000000000000';
GRANT SELECT ON z_before TO service_role;
INSERT INTO public.vehicle_class_price_recompute_queue(vehicle_id, reason) VALUES ('f0000000-0000-4000-8000-000000000000', 'work_session');
SET ROLE service_role;
SELECT set_config('fixture.slow_classify', 'on', false);
SELECT public.assert((SELECT processed = 1 FROM public.drain_vehicle_class_price_queue(1, 1100)), 'a refresh ran');
SELECT set_config('fixture.slow_classify', 'off', false);
SELECT public.assert((SELECT reason = 'incomplete' FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'f0000000-0000-4000-8000-000000000000'), 'a priced vehicle with an unfinished cohort stays queued');
SELECT public.assert((SELECT (c.*)::text = (b.*)::text FROM public.vehicle_class_price c, z_before b
  WHERE c.vehicle_id = 'f0000000-0000-4000-8000-000000000000'), 'and its stored price is untouched');
SELECT public.assert((SELECT processed = 1 FROM public.drain_vehicle_class_price_queue(1, 5000)), 'then completes');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_class_price_recompute_queue)
  AND (SELECT status = 'priced' AND cohort_members = 7 FROM public.vehicle_class_price WHERE vehicle_id = 'f0000000-0000-4000-8000-000000000000'),
  'dequeued with the new member counted');
RESET ROLE;

-- An error is retried up to 3 times, then dropped until the daily top-up.
CREATE FUNCTION public.fixture_fail_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.vehicle_id::text = current_setting('fixture.fail_vehicle', true) THEN RAISE EXCEPTION 'synthetic price failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER fixture_fail_price BEFORE INSERT ON public.vehicle_class_price FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_price();
SELECT set_config('fixture.fail_vehicle', 'd0000000-0000-4000-8000-000000000002', false);
INSERT INTO public.vehicle_class_price_recompute_queue(vehicle_id, reason) VALUES ('d0000000-0000-4000-8000-000000000002', 'receipt');
SET ROLE service_role;
SELECT public.assert((SELECT processed = 0 AND errored = 1 FROM public.drain_vehicle_class_price_queue(1, 5000)), 'error counted');
SELECT public.assert((SELECT attempts = 1 AND reason = 'error' AND last_error = 'synthetic price failure'
  FROM public.vehicle_class_price_recompute_queue WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000002'), 'retried, with the error');
SELECT public.drain_vehicle_class_price_queue(1, 5000);
SELECT public.assert((SELECT attempts = 2 FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000002'), 'second attempt');
SELECT public.drain_vehicle_class_price_queue(1, 5000);
SELECT public.assert((SELECT attempts = 3 AND last_error = 'synthetic price failure' FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000002'), 'kept with its error after the third');
SELECT public.assert((SELECT processed = 0 AND errored = 0 FROM public.drain_vehicle_class_price_queue(1, 5000)),
  'a thrice-failed id is not claimed again within the day');
RESET ROLE;
UPDATE public.vehicle_class_price_recompute_queue SET queued_at = now() - interval '25 hours'
 WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000002';
SET ROLE service_role;
SELECT public.assert((SELECT errored = 1 FROM public.drain_vehicle_class_price_queue(1, 5000)), 'a day later it is tried again');
SELECT public.assert((SELECT attempts = 4 FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000002'), 'and waits another day');
RESET ROLE;
-- New paper resets the count: the receipt trigger requeues it at attempts 0, and the fixed refresh then completes.
SELECT set_config('fixture.fail_vehicle', '', false);
INSERT INTO public.receipts(vehicle_id, user_id, total_amount) VALUES ('d0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 10);
SELECT public.assert((SELECT attempts = 0 AND reason = 'receipt' FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000002'), 'new paper resets attempts');
SET ROLE service_role;
SELECT public.assert((SELECT processed = 1 AND errored = 0 FROM public.drain_vehicle_class_price_queue(1, 5000)), 'refreshed');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_class_price_recompute_queue), 'and dequeued');
RESET ROLE;

-- The daily top-up: a stored row older than 24 h is refreshed; a row whose vehicle is gone is not queued.
UPDATE public.vehicle_class_price SET computed_at = now() - interval '25 hours' WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000003';
INSERT INTO public.vehicle_class_price(vehicle_id, status, blocked_reason, method_version, computed_at)
  VALUES ('d0000000-0000-4000-8000-0000000000ff', 'blocked', 'vehicle missing year/make', 'class_price_v1', now() - interval '30 hours');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_class_price WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000003'),
  'R3 has no stored row yet');
INSERT INTO public.vehicle_class_price(vehicle_id, status, blocked_reason, method_version, computed_at)
  VALUES ('d0000000-0000-4000-8000-000000000003', 'blocked', 'old', 'class_price_v1', now() - interval '25 hours');
SET ROLE service_role;
SELECT public.assert((SELECT processed = 1 FROM public.drain_vehicle_class_price_queue(5, 5000)), 'the stale row was refreshed');
SELECT public.assert((SELECT status = 'priced' AND computed_at > now() - interval '1 minute' FROM public.vehicle_class_price
  WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000003'), 'R3 is current');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_class_price_recompute_queue), 'the orphan row is not queued');
RESET ROLE;

-- The controller: four rows as before, then class_price.
INSERT INTO public.vehicle_class_price_recompute_queue(vehicle_id, reason) VALUES ('d0000000-0000-4000-8000-000000000000', 'receipt');
DELETE FROM public.fixture_drain_calls;
SET ROLE service_role;
CREATE TEMP TABLE ctl AS SELECT * FROM public.drain_vehicle_derived_queues(false, 30);
RESET ROLE;
SELECT public.assert((SELECT array_agg(queue || ':' || processed || ':' || errored || ':' || skipped) FROM ctl)
  = ARRAY['metric:0:0:false', 'stats:0:0:false', 'value:0:0:true', 'completion:0:0:false', 'class_price:1:0:false'],
  'controller rows: ' || (SELECT string_agg(queue || ':' || processed || ':' || errored || ':' || skipped, ', ') FROM ctl));
SELECT public.assert((SELECT array_agg(fn ORDER BY id) FROM public.fixture_drain_calls) = ARRAY['metric', 'stats', 'completion'],
  'the existing slices are called as before');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_class_price_recompute_queue), 'the controller drained the class price queue');
SELECT public.assert(NOT has_function_privilege('authenticated', 'public.drain_vehicle_derived_queues(boolean,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.drain_vehicle_class_price_queue(integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.resolve_class_price_cohort(text,text,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.enqueue_vehicle_class_price_on_paper()', 'EXECUTE'), 'grants');

-- The guard: a controller body that drifted is not replaced (the migration rolls back).
CREATE OR REPLACE FUNCTION public.drain_vehicle_derived_queues(p_include_value boolean DEFAULT false, p_budget_seconds integer DEFAULT 45)
 RETURNS TABLE(queue text, processed integer, errored integer, skipped boolean) LANGUAGE plpgsql
AS $function$ BEGIN queue := 'drifted'; RETURN NEXT; END; $function$;
\set ON_ERROR_STOP off
\ir ../migrations/20261121110000_class_price_cohorts_and_queue.sql
\set ON_ERROR_STOP on
SELECT public.assert((SELECT array_agg(queue) FROM public.drain_vehicle_derived_queues()) = ARRAY['drifted'],
  'a drifted controller is refused, not overwritten');

-- build_class_v5 (20261121160000): seven terms that matched the wrong thing, and the class version bump --------------
SELECT set_config('fixture.role', '', false), set_config('fixture.uid', '', false);
-- Before: S is priced from a fully classified v4 cohort.
SET ROLE service_role;
SELECT set_config('fixture.role', 'service_role', false);
SELECT public.assert((public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000000', 5000))->>'status' = 'priced',
  'before v5: S is priced');
RESET ROLE;
CREATE TEMP TABLE v5_price_before AS SELECT * FROM public.vehicle_class_price WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000';
GRANT SELECT ON v5_price_before TO service_role;
CREATE TEMP TABLE v5_src_before AS SELECT oid, prosrc, proconfig, prosecdef, provolatile, proacl FROM pg_proc
  WHERE oid IN ('public.classify_vehicle_build_class(uuid[])'::regprocedure,
                'public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure);
SELECT public.assert((SELECT count(*) FROM public.vehicle_build_class WHERE method_version = 'v4_store_word_terms') > 0,
  'before v5: the store holds v4 rows');

\ir ../migrations/20261121160000_build_class_term_context.sql
-- Idempotent: a second apply (as the deploy does on merge) changes nothing.
\ir ../migrations/20261121160000_build_class_term_context.sql

-- The bump changed one literal in each body and nothing else (settings, definer, volatility and grants too).
SELECT public.assert((SELECT bool_and(replace(p.prosrc, '''v5_store_term_context''', '''v4_store_word_terms''') = b.prosrc
    AND p.prosrc <> b.prosrc AND p.proconfig IS NOT DISTINCT FROM b.proconfig AND p.prosecdef = b.prosecdef
    AND p.provolatile = b.provolatile AND p.proacl IS NOT DISTINCT FROM b.proacl) = true
    AND count(*) = 2 FROM v5_src_before b JOIN pg_proc p ON p.oid = b.oid),
  'classify and refresh differ from their v4 bodies only by the version literal');
SELECT public.assert((SELECT substring(prosrc FROM 'c_class\s+constant text := ''([^'']+)''') FROM pg_proc
    WHERE oid = 'public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure) = 'v5_store_term_context',
  'refresh c_class is the version the classifier writes');
SELECT public.assert(has_function_privilege('anon', 'public.nuke_build_class_rule(numeric,integer,text)', 'EXECUTE'), 'anon runs the rule');

-- Every earlier rule case answers as before.
SELECT public.assert(NOT EXISTS (SELECT 1 FROM rule_cases c
  WHERE public.nuke_build_class_rule(0, 0, c.txt)->>'build_class' IS DISTINCT FROM c.expected),
  'v4 rule cases under v5: ' || coalesce((SELECT string_agg(format('%s [%s] got %s want %s', c.why, c.txt,
      public.nuke_build_class_rule(0, 0, c.txt)->>'build_class', c.expected), '; ')
    FROM rule_cases c WHERE public.nuke_build_class_rule(0, 0, c.txt)->>'build_class' IS DISTINCT FROM c.expected), ''));
-- Each fixed term (no receipts, no sessions, text only).
CREATE TEMP TABLE rule_cases_v5(txt text, expected text, why text);
INSERT INTO rule_cases_v5 VALUES
 -- Weld: the wheels count, welding does not
 ('15-inch weld racing wheels', 'modified', 'Weld Racing wheels'),
 ('rides on weld wheels', 'modified', 'Weld wheels'),
 ('polished two-piece 15″ weld wheels', 'modified', 'Weld wheels after a size'),
 ('weld draglites 15x6 front', 'modified', 'a Weld wheel line'),
 ('weld-style aluminum wheels', 'modified', 'Weld-style wheels'),
 ('floor pans welded in, needs welding', 'unknown', 'welding'),
 ('previous weld repair on the case', 'unknown', 'a weld repair'),
 ('weld in new metal. it will be a big job', 'unknown', 'weld in metal'),
 ('all wheel welds are rust free', 'unknown', 'wheel welds'),
 ('seller: weldingpro99', 'unknown', 'a word containing weld'),
 -- Restored: "unrestored" and "needs restoration" are not restored
 ('unrestored survivor', 'stock', '"unrestored" is a stock word only (two stock terms, no build)'),
 ('an unrestored time capsule', 'stock', 'unrestored'),
 ('an un-restored example', 'unknown', 'un-restored is not restored'),
 ('this car needs total restoration', 'unknown', 'needs restoration'),
 ('needing a full restoration', 'unknown', 'needing a full restoration'),
 ('an excellent restoration candidate', 'unknown', 'restoration candidate'),
 ('it has never been restored', 'unknown', 'never restored'),
 ('frame-off restoration completed 2019', 'modified', 'a restoration still counts'),
 ('restored in 2010', 'modified', 'restored still counts'),
 -- Original owner: the manual is not the owner
 ('includes original owner''s manual', 'unknown', 'original owner''s manual'),
 ('original owners manual and jack', 'unknown', 'original owners manual'),
 ('original owner’s handbook', 'unknown', 'curly apostrophe, handbook'),
 ('bought from the original owner', 'stock', 'original owner still counts'),
 ('original owner, with original owner''s manual', 'stock', 'the owner with the manual still counts'),
 -- Numbers matching: the negation is not a stock signal
 ('it is a not numbers-matching car', 'unknown', 'not numbers-matching'),
 ('non-numbers matching 289', 'unknown', 'non-numbers matching'),
 ('non-matching numbers engine', 'unknown', 'non-matching numbers'),
 ('the seller admits the car isn’t numbers-matching', 'unknown', 'isn''t numbers-matching'),
 ('non-original engine', 'unknown', 'non-original engine'),
 ('numbers matching 327', 'stock', 'numbers matching still counts'),
 -- Bagged, Rally wheels, Coys
 ('when dismantled the car is bagged and tagged', 'unknown', 'bagged and tagged'),
 ('bagged all around', 'modified', 'bagged (air bags)'),
 ('rally wheels and redline tires', 'unknown', 'factory Rally wheels'),
 ('event_name: coys auction - brands hatch', 'unknown', 'the Coys auction house'),
 ('20 inch coys custom color-matched wheels', 'modified', 'Coys wheels'),
 ('coys wheels with redline tires', 'modified', 'Coys wheels');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM rule_cases_v5 c
  WHERE public.nuke_build_class_rule(0, 0, c.txt)->>'build_class' IS DISTINCT FROM c.expected),
  'v5 rule cases: ' || coalesce((SELECT string_agg(format('%s [%s] got %s want %s', c.why, c.txt,
      public.nuke_build_class_rule(0, 0, c.txt)->>'build_class', c.expected), '; ')
    FROM rule_cases_v5 c WHERE public.nuke_build_class_rule(0, 0, c.txt)->>'build_class' IS DISTINCT FROM c.expected), ''));
SELECT public.assert(public.nuke_build_class_rule(5000, 0, 'unrestored survivor')->>'build_class' = 'documented_build', 'paper first');

-- Reclassification after the bump: every v4 member is out of date. Never blank: a refresh with no budget keeps the stored
-- price and answers incomplete; a full one reclassifies the cohort; a third finds nothing out of date.
SET ROLE service_role;
SELECT set_config('fixture.role', 'service_role', false);
DO $$ DECLARE r jsonb; n_members int;
BEGIN
  SELECT count(*) - 1 INTO n_members FROM public.cohort_members('50000000-0000-4000-8000-000000000001');
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000000', 0);
  PERFORM public.assert(r->>'status' = 'pending' AND NOT (r->>'complete')::boolean AND (r->>'kept_prior_price')::boolean
    AND (r->>'classified_this_call')::int = 0, 'no budget: the stored price is kept: ' || r::text);
  PERFORM public.assert((SELECT p.status = 'priced' AND p.value = b.value AND p.n = b.n AND p.computed_at = b.computed_at
    FROM public.vehicle_class_price p, v5_price_before b WHERE p.vehicle_id = b.vehicle_id), 'the priced row is untouched');
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000000', 5000);
  PERFORM public.assert(r->>'status' = 'priced' AND (r->>'complete')::boolean AND (r->>'classified_this_call')::int = n_members,
    'the bump reclassifies the whole cohort: ' || r::text);
  PERFORM public.assert(NOT EXISTS (SELECT 1 FROM public.cohort_members('50000000-0000-4000-8000-000000000001') m
    JOIN public.vehicle_build_class b ON b.vehicle_id = m.vehicle_id WHERE b.method_version <> 'v5_store_term_context'),
    'every cohort member is on v5');
  r := public.refresh_vehicle_class_price('a0000000-0000-4000-8000-000000000000');
  PERFORM public.assert((r->>'classified_this_call')::int = 0 AND r->>'status' = 'priced', 'v5 rows are current');
END $$;
RESET ROLE;
SELECT set_config('fixture.role', '', false);

-- class price queue on its own cron statement (20261121170000) -------------------------------------------------------
-- The controller as 20261121110000 left it (the guard test above swapped in a drifted body on purpose).
DO $$ BEGIN EXECUTE (SELECT d FROM bodies_after WHERE fn LIKE 'drain_vehicle_derived_queues(%'); END $$;
SELECT public.assert(md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure))
  = '2bf3f88d02acaa3244e4312893d18fd9', 'before: the five-slice controller, as live'); -- gitleaks:allow (function fingerprint, not a secret)
-- pg_cron's job table and schedule(), reduced: schedule upserts by name as pg_cron 1.6 does.
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;

\ir ../migrations/20261121170000_class_price_queue_own_cron.sql
CREATE TEMP TABLE own_job_bodies AS SELECT p.oid, pg_get_functiondef(p.oid) AS d FROM pg_proc p
  WHERE p.proname IN ('drain_vehicle_derived_queues', 'drain_vehicle_class_price_queue', 'top_up_vehicle_class_price_queue',
                      'claim_vehicle_class_price_queue_id', 'refresh_claimed_vehicle_class_price', 'refresh_vehicle_class_price');
-- Idempotent: a second apply (as the deploy does on merge) passes its guard and changes nothing.
\ir ../migrations/20261121170000_class_price_queue_own_cron.sql
SELECT public.assert((SELECT count(*) = 6 AND bool_and(b.d = pg_get_functiondef(b.oid)) FROM own_job_bodies b),
  're-apply leaves the bodies as they were');

-- The controller is byte-identical to its body before 20261121110000.
SELECT public.assert((SELECT pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure) = d FROM drain_pre),
  'controller restored byte for byte');
SELECT public.assert(md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure))
  = 'f2e15e76d18ecfdd966451635b0fa677', 'controller md5 is the pre-20261121110000 body'); -- gitleaks:allow (function fingerprint, not a secret)
SELECT public.assert(md5(pg_get_functiondef('public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure))
  = '3bb0a0f6c048f71bb4deda69adcdd993', 'refresh_vehicle_class_price untouched'); -- gitleaks:allow (function fingerprint, not a secret)

-- The job: one row, odd minutes, both statements with their own timeouts, the claim committed before the refresh.
SELECT public.assert((SELECT count(*) FROM cron.job WHERE jobname = 'drain-class-price-queue') = 1, 'one job, after two applies');
SELECT public.assert((SELECT schedule = '1-59/2 * * * *'
    AND command ~ $re$^SELECT set_config\('app\.writer', 'drain-class-price-queue', false\); SET statement_timeout = '15s'; $re$
    AND command ~ $re$claim_vehicle_class_price_queue_id\(\)::text, ''\), false\); COMMIT; SET statement_timeout = '55s'; SELECT public\.refresh_claimed_vehicle_class_price\($re$
  FROM cron.job WHERE jobname = 'drain-class-price-queue'), 'job schedule and command');

-- The controller no longer touches the class price queue: four rows, the existing slices called, the queued id stays.
DELETE FROM public.vehicle_class_price_recompute_queue;
INSERT INTO public.vehicle_class_price_recompute_queue(vehicle_id, reason) VALUES ('a0000000-0000-4000-8000-000000000000', 'receipt');
DELETE FROM public.fixture_drain_calls;
SET ROLE service_role;
CREATE TEMP TABLE ctl4 AS SELECT * FROM public.drain_vehicle_derived_queues(false, 30);
RESET ROLE;
SELECT public.assert((SELECT array_agg(queue || ':' || skipped) FROM ctl4)
  = ARRAY['metric:false', 'stats:false', 'value:true', 'completion:false'], 'controller: the four slices only');
SELECT public.assert((SELECT array_agg(fn ORDER BY id) FROM public.fixture_drain_calls) = ARRAY['metric', 'stats', 'completion'],
  'the existing slices are called as before');
SELECT public.assert((SELECT reason = 'receipt' AND attempts = 0 FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000'), 'the class price queue is left to its own job');

-- A slow refresh. S is priced; its refresh sleeps 3 s before writing the price. The job's command runs as cron sends it
-- (one query string, \gexec), with the refresh statement's 55 s timeout lowered to 1 s so the cancel happens here.
CREATE FUNCTION public.fixture_sleep_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.vehicle_id::text = current_setting('fixture.sleep_vehicle', true) THEN PERFORM pg_sleep(3); END IF; RETURN NEW; END $$;
CREATE TRIGGER fixture_sleep_price BEFORE INSERT ON public.vehicle_class_price FOR EACH ROW EXECUTE FUNCTION public.fixture_sleep_price();
CREATE TEMP TABLE s_price_before AS SELECT * FROM public.vehicle_class_price WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000';
SELECT public.assert((SELECT count(*) = 1 AND bool_and(status = 'priced') FROM s_price_before), 'S starts priced');
CREATE TEMP TABLE others_price_before AS SELECT * FROM public.vehicle_class_price
  WHERE vehicle_id IN ('d0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000000');
DELETE FROM public.vehicle_class_price_recompute_queue;
INSERT INTO public.vehicle_class_price_recompute_queue(vehicle_id, queued_at, reason) VALUES
 ('a0000000-0000-4000-8000-000000000000', now() - interval '3 minutes', 'receipt'),
 ('d0000000-0000-4000-8000-000000000005', now() - interval '2 minutes', 'work_session'),
 ('f0000000-0000-4000-8000-000000000000', now() - interval '1 minute', 'receipt');
SELECT set_config('fixture.sleep_vehicle', 'a0000000-0000-4000-8000-000000000000', false);
\set ON_ERROR_STOP off
SELECT replace(command, $q$statement_timeout = '55s'$q$, $q$statement_timeout = '1s'$q$) FROM cron.job WHERE jobname = 'drain-class-price-queue' \gexec
\set ON_ERROR_STOP on
RESET statement_timeout; RESET lock_timeout;
-- Cancelled: the mark is the attempt, with its error, at the back of the line; nothing else moved.
SELECT public.assert((SELECT attempts = 1 AND reason = 'running' AND last_error LIKE 'refresh started % (queued as receipt) and did not finish%'
    AND queued_at > now() - interval '1 minute'
  FROM public.vehicle_class_price_recompute_queue WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000'),
  'cancelled: attempt and error recorded: ' || (SELECT row_to_json(q)::text FROM public.vehicle_class_price_recompute_queue q
    WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000'));
SELECT public.assert((SELECT (c.*)::text = (b.*)::text FROM public.vehicle_class_price c, s_price_before b
  WHERE c.vehicle_id = b.vehicle_id), 'cancelled: S''s stored price is untouched');
SELECT public.assert((SELECT array_agg(vehicle_id::text || ':' || reason || ':' || attempts ORDER BY queued_at)
    FROM public.vehicle_class_price_recompute_queue WHERE vehicle_id <> 'a0000000-0000-4000-8000-000000000000')
  = ARRAY['d0000000-0000-4000-8000-000000000005:work_session:0', 'f0000000-0000-4000-8000-000000000000:receipt:0'],
  'cancelled: the other queue rows are intact');
-- The next runs (real command, 55 s) take the others first; S's mark is under 5 minutes old, so it is not claimed again.
SELECT command FROM cron.job WHERE jobname = 'drain-class-price-queue' \gexec
RESET statement_timeout; RESET lock_timeout;
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000005'), 'the job drained the next vehicle');
SELECT public.assert((SELECT c.status = 'priced' AND c.computed_at > b.computed_at FROM public.vehicle_class_price c, others_price_before b
  WHERE c.vehicle_id = b.vehicle_id AND c.vehicle_id = 'd0000000-0000-4000-8000-000000000005'), 'and refreshed its price');
SELECT command FROM cron.job WHERE jobname = 'drain-class-price-queue' \gexec
RESET statement_timeout; RESET lock_timeout;
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'f0000000-0000-4000-8000-000000000000'), 'and the one after');
CREATE TEMP TABLE s_mark AS SELECT * FROM public.vehicle_class_price_recompute_queue WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000';
SELECT command FROM cron.job WHERE jobname = 'drain-class-price-queue' \gexec
RESET statement_timeout; RESET lock_timeout;
SELECT public.assert((SELECT (q.*)::text = (m.*)::text FROM public.vehicle_class_price_recompute_queue q, s_mark m
  WHERE q.vehicle_id = m.vehicle_id), 'a running mark under 5 minutes old is not claimed (overlap guard)');
-- Backed off: two more cancelled tries (each after 5 minutes), then it waits a day; nothing loops.
UPDATE public.vehicle_class_price_recompute_queue SET queued_at = now() - interval '6 minutes'
 WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000';
\set ON_ERROR_STOP off
SELECT replace(command, $q$statement_timeout = '55s'$q$, $q$statement_timeout = '1s'$q$) FROM cron.job WHERE jobname = 'drain-class-price-queue' \gexec
\set ON_ERROR_STOP on
RESET statement_timeout; RESET lock_timeout;
UPDATE public.vehicle_class_price_recompute_queue SET queued_at = now() - interval '6 minutes'
 WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000';
\set ON_ERROR_STOP off
SELECT replace(command, $q$statement_timeout = '55s'$q$, $q$statement_timeout = '1s'$q$) FROM cron.job WHERE jobname = 'drain-class-price-queue' \gexec
\set ON_ERROR_STOP on
RESET statement_timeout; RESET lock_timeout;
SELECT public.assert((SELECT attempts = 3 AND reason = 'running' FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000'), 'three cancelled attempts recorded');
UPDATE public.vehicle_class_price_recompute_queue SET queued_at = now() - interval '23 hours'
 WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000';
SELECT public.assert(public.claim_vehicle_class_price_queue_id() IS NULL, 'after three, not claimed within the day');
SELECT public.assert((SELECT (c.*)::text = (b.*)::text FROM public.vehicle_class_price c, s_price_before b
  WHERE c.vehicle_id = b.vehicle_id), 'S''s stored price is still untouched');
-- A day later it is tried again; fast now, it completes and leaves the queue.
SELECT set_config('fixture.sleep_vehicle', '', false);
UPDATE public.vehicle_class_price_recompute_queue SET queued_at = now() - interval '25 hours'
 WHERE vehicle_id = 'a0000000-0000-4000-8000-000000000000';
SELECT command FROM cron.job WHERE jobname = 'drain-class-price-queue' \gexec
RESET statement_timeout; RESET lock_timeout;
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_class_price_recompute_queue), 'S refreshed a day later: queue empty');
SELECT public.assert((SELECT c.status = 'priced' AND c.value = b.value AND c.computed_at > b.computed_at
  FROM public.vehicle_class_price c, s_price_before b WHERE c.vehicle_id = b.vehicle_id), 'S priced again, same value');

-- An error in the refresh: kept with its message and the attempt; the run itself succeeds.
SELECT set_config('fixture.fail_vehicle', 'd0000000-0000-4000-8000-000000000005', false);
INSERT INTO public.vehicle_class_price_recompute_queue(vehicle_id, reason) VALUES ('d0000000-0000-4000-8000-000000000005', 'receipt');
SELECT command FROM cron.job WHERE jobname = 'drain-class-price-queue' \gexec
RESET statement_timeout; RESET lock_timeout;
SELECT set_config('fixture.fail_vehicle', '', false);
SELECT public.assert((SELECT attempts = 1 AND reason = 'error' AND last_error = 'synthetic price failure'
  FROM public.vehicle_class_price_recompute_queue WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000005'), 'error kept with its attempt');
DELETE FROM public.vehicle_class_price_recompute_queue;

-- Incomplete is progress: back in line, the attempt taken back, the stored price kept.
INSERT INTO public.vehicles(id, year, make, model, description) VALUES ('f0000000-0000-4000-8000-000000000007', 1975, 'Truckco', 'K20', 'lifted');
CREATE TEMP TABLE z_price_before AS SELECT * FROM public.vehicle_class_price WHERE vehicle_id = 'f0000000-0000-4000-8000-000000000000';
INSERT INTO public.vehicle_class_price_recompute_queue(vehicle_id, reason) VALUES ('f0000000-0000-4000-8000-000000000000', 'receipt');
SELECT public.assert(public.claim_vehicle_class_price_queue_id() = 'f0000000-0000-4000-8000-000000000000', 'claimed');
SELECT set_config('fixture.slow_classify', 'on', false);
SELECT public.assert(public.refresh_claimed_vehicle_class_price('f0000000-0000-4000-8000-000000000000', 1000)->>'outcome' = 'incomplete',
  'a 1 s budget leaves the new member unclassified');
SELECT set_config('fixture.slow_classify', 'off', false);
SELECT public.assert((SELECT attempts = 0 AND reason = 'incomplete' AND last_error IS NULL FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'f0000000-0000-4000-8000-000000000000'), 'incomplete: queued, attempt taken back');
SELECT public.assert((SELECT (c.*)::text = (b.*)::text FROM public.vehicle_class_price c, z_price_before b
  WHERE c.vehicle_id = b.vehicle_id), 'incomplete: the stored price is kept (never blank)');
-- Paper during a refresh: the trigger re-queues the id, so the finished refresh does not dequeue it.
SELECT public.assert(public.claim_vehicle_class_price_queue_id() = 'f0000000-0000-4000-8000-000000000000', 'claimed again');
INSERT INTO public.work_sessions(vehicle_id, session_type) VALUES ('f0000000-0000-4000-8000-000000000000', 'repair');
SELECT public.assert((public.refresh_claimed_vehicle_class_price('f0000000-0000-4000-8000-000000000000'))->>'dequeued' = 'false',
  'complete, but new paper keeps it queued');
SELECT public.assert((SELECT reason = 'work_session' AND attempts = 0 FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'f0000000-0000-4000-8000-000000000000'), 'the paper''s enqueue survives');
-- The by-hand drain goes through the same claim and refresh.
SET ROLE service_role;
SELECT public.assert((SELECT processed = 1 AND errored = 0 FROM public.drain_vehicle_class_price_queue(5, 5000)), 'by-hand drain');
RESET ROLE;
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_class_price_recompute_queue), 'by-hand drain dequeued it');
-- The daily top-up runs from the claim.
UPDATE public.vehicle_class_price SET computed_at = now() - interval '25 hours' WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000005';
SELECT public.assert(public.claim_vehicle_class_price_queue_id() = 'd0000000-0000-4000-8000-000000000005', 'the claim tops up stale rows');
SELECT public.assert((SELECT last_error LIKE '%(queued as stale)%' FROM public.vehicle_class_price_recompute_queue
  WHERE vehicle_id = 'd0000000-0000-4000-8000-000000000005'), 'queued as stale');
DELETE FROM public.vehicle_class_price_recompute_queue;
SELECT public.assert(NOT has_function_privilege('anon', 'public.claim_vehicle_class_price_queue_id(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.refresh_claimed_vehicle_class_price(uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.top_up_vehicle_class_price_queue(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.refresh_claimed_vehicle_class_price(uuid,integer)', 'EXECUTE'), 'own job grants');

-- The guard: a controller that drifted again is not replaced (the migration rolls back).
CREATE OR REPLACE FUNCTION public.drain_vehicle_derived_queues(p_include_value boolean DEFAULT false, p_budget_seconds integer DEFAULT 45)
 RETURNS TABLE(queue text, processed integer, errored integer, skipped boolean) LANGUAGE plpgsql
AS $function$ BEGIN queue := 'drifted'; RETURN NEXT; END; $function$;
\set ON_ERROR_STOP off
\ir ../migrations/20261121170000_class_price_queue_own_cron.sql
\set ON_ERROR_STOP on
SELECT public.assert((SELECT array_agg(queue) FROM public.drain_vehicle_derived_queues()) = ARRAY['drifted'],
  'own job: a drifted controller is refused, not overwritten');

-- The guard: a rule body that drifted is not replaced (the migration rolls back).
CREATE OR REPLACE FUNCTION public.nuke_build_class_rule(p_receipts numeric, p_sessions integer, p_text text)
 RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO pg_catalog, pg_temp
AS $function$ SELECT '{"build_class": "drifted"}'::jsonb $function$;
\set ON_ERROR_STOP off
\ir ../migrations/20261121160000_build_class_term_context.sql
\set ON_ERROR_STOP on
SELECT public.assert(public.nuke_build_class_rule(0, 0, 'lifted')->>'build_class' = 'drifted',
  'a drifted rule is refused, not overwritten');

SELECT 'vehicle_class_price store, refresh, tied reader, garage value, classifier parity, cohort resolution and registration, never blank, refresh queue, v5 terms and version bump, own cron job: PASS' AS result;
