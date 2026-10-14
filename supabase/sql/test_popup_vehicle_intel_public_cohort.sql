-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_popup_cohort -f this-file.sql
-- Proves the popup_vehicle_intel cohort change (migration 20261014052500) leaves every document as it was.
-- The live reader found a vehicle's comparable sales by listing its cohort under the caller's row policies, where no
-- make or model qual can use an index. The migration reads the cohort through definer readers that state "public,
-- undeleted" themselves, and tests the viewed vehicle against the scope's rule directly. The documents must be identical
-- for anon, an authenticated stranger, an authenticated owner of a PRIVATE vehicle in a registered scope, and the
-- service role, across: a registered generation scope, a second overlapping supported scope, no scope (exact model),
-- an ambiguous canonical model, a missing year or model, and a private, deleted or part vehicle as the viewed one.
-- A private, deleted, part or other-scope vehicle must never be a comparable; the new readers must never return one; the
-- popup stays SECURITY INVOKER. A re-run is a no-op, and a drifted function is left as found.
-- The rows below are a disposable test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET TimeZone = 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
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

-- The shapes the reader touches.
CREATE TABLE public.canonical_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text, canonical_model text, aliases text[], year_start integer, year_end integer);
CREATE TABLE public.make_model_profiles (
  subject_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_make text, canonical_model text, grain text, year integer,
  year_start integer, year_end integer, canonical_model_id uuid REFERENCES public.canonical_models(id),
  comparison_scope_status text, comparison_scope_basis text);
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, is_public boolean DEFAULT true,
  deleted_at timestamptz, listing_kind text, primary_image_url text, mileage integer, owner_id uuid,
  sale_status text DEFAULT 'available', auction_outcome text, reserve_status text,
  sale_price numeric, bat_sold_price numeric, sold_price numeric, winning_bid numeric, high_bid numeric,
  asking_price numeric, sale_date date, bat_sale_date date, listing_updated_at timestamptz,
  listing_posted_at timestamptz, nuke_estimate numeric, nuke_estimate_confidence integer,
  valuation_calculated_at timestamptz, canonical_outcome text, canonical_platform text DEFAULT 'bat',
  listing_url text, bat_auction_url text, platform_url text, discovery_url text,
  notes text, import_metadata jsonb, created_at timestamptz DEFAULT '2026-10-03',
  auction_end_date text, heat_score numeric, deal_score numeric);
CREATE INDEX idx_vehicles_lower_make_model ON public.vehicles(lower(make), lower(model));
CREATE INDEX idx_vehicles_year ON public.vehicles(year);
CREATE TABLE public.auction_comments (
  id uuid PRIMARY KEY, auction_event_id uuid, vehicle_id uuid, posted_at timestamptz, is_seller boolean, comment_type text,
  external_identity_id uuid, source_url text, comment_text text, bid_amount numeric);
CREATE TABLE public.auction_events (id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY, source_comment_id uuid, content_text text, structured_data jsonb, confidence_score numeric,
  observed_at timestamptz, ingested_at timestamptz, agent_model text, extraction_method text, vehicle_id uuid, kind text,
  is_superseded boolean);
CREATE TABLE public.comment_claims_progress (comment_id uuid PRIMARY KEY, llm_processed boolean, extraction_version text, processed_at timestamptz);
CREATE TABLE public.comment_discoveries (vehicle_id uuid, raw_extraction jsonb, overall_sentiment text, sentiment_score numeric, comment_count integer, discovered_at timestamptz);
CREATE TABLE public.description_discoveries (vehicle_id uuid, raw_extraction jsonb, discovered_at timestamptz);
CREATE TABLE public.vehicle_events (
  vehicle_id uuid, source_platform text, source_url text, event_type text, sold_at timestamptz, ended_at timestamptz,
  started_at timestamptz, final_price numeric, current_price numeric);

-- Row policies as production has them, in the shape that matters: strangers read public vehicles, owners read their own.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING (is_public = true OR auth.role() = 'service_role');
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT
  USING (is_public = false AND (SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = owner_id);
ALTER TABLE public.canonical_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view canonical models" ON public.canonical_models FOR SELECT USING (true);
ALTER TABLE public.make_model_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY mmp_public_read ON public.make_model_profiles FOR SELECT USING (true);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- The functions as production has them on 2026-10-14.
\ir helpers/popup_vehicle_intel_live_20261014.sql
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated, service_role;
SELECT public.t_assert(
  md5(pg_get_functiondef('public.popup_vehicle_intel(uuid)'::regprocedure)) = 'c1c623526bae4cd96ebb0bba86b7e277'  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  AND md5(pg_get_functiondef('public.cohort_members(uuid)'::regprocedure)) = 'a2550afffab3f758943cbea0c188235f'  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  AND md5(pg_get_functiondef('public.vehicle_price_facts(uuid[])'::regprocedure)) = '32bef56e17986c4de7942d948ebde45f'  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  AND md5(pg_get_functiondef('public.vehicle_sale_basis(text,text,text,text,text,numeric,text,jsonb,timestamptz)'::regprocedure)) = '4a648fbaef6ff2f41fb44226a8a68b08',  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  'the fixture is the live source');

-- Registry: a supported K5 generation scope 1976-1980 (aliases include a hyphenated one that needs regex escaping),
-- a second supported scope that overlaps it (used later), and a canonical model that is ambiguous with the first.
INSERT INTO public.canonical_models VALUES
 ('00000000-0000-0000-0000-000000000001', 'Chevrolet', 'K5 Blazer', ARRAY['k5', 'blazer', 'k5 blazer', 'k-5', 'k 5 blazer', 'full size blazer'], 1969, 1991);
INSERT INTO public.make_model_profiles (subject_id, canonical_make, canonical_model, grain, year_start, year_end, canonical_model_id, comparison_scope_status, comparison_scope_basis) VALUES
 ('f5586ac1-dc51-4d4b-bd26-abb1b207f872', 'CHEVROLET', 'K5 Blazer', 'generation', 1976, 1980, '00000000-0000-0000-0000-000000000001', 'supported', 'Synthetic owner testimony, first scope'),
 ('feb225e6-3a73-425d-ba12-143680e8b9ca', 'CHEVROLET', 'K5 Blazer', 'generation', 1973, 1991, '00000000-0000-0000-0000-000000000001', 'context_only', NULL);

-- ALLOW_RAW_TESTIMONY_WRITE (disposable test database)
-- The viewed vehicles: a public 1977 Blazer; a PRIVATE 1977 Blazer owned by U1 (in the scope, visible only to U1); a deleted one; a part.
INSERT INTO public.vehicles (id, year, make, model, listing_url, is_public, deleted_at, listing_kind, owner_id) VALUES
 ('10000000-0000-0000-0000-000000000001', 1977, 'Chevrolet', 'Blazer', 'https://example.test/subject', true, NULL, NULL, NULL),
 ('10000000-0000-0000-0000-000000000002', 1978, 'Chevrolet', 'K5 Blazer Cheyenne', 'https://example.test/private-subject', false, NULL, NULL, '90000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000003', 1977, 'Chevrolet', 'Blazer', 'https://example.test/deleted-subject', true, now(), NULL, NULL),
 ('10000000-0000-0000-0000-000000000004', 1977, 'Chevrolet', 'Blazer', 'https://example.test/part-subject', true, NULL, 'non_vehicle_item', NULL);
-- Six sales that qualify, covering both endpoints and every alias form (hyphen, extra words, other case).
INSERT INTO public.vehicles (id, year, make, model, sale_status, sale_price, sale_date, listing_url)
SELECT ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       CASE n WHEN 1 THEN 1976 WHEN 2 THEN 1980 ELSE 1977 END,
       CASE n WHEN 2 THEN 'CHEVROLET' ELSE 'Chevrolet' END,
       CASE n WHEN 3 THEN 'K5 Blazer Cheyenne 4x4' WHEN 4 THEN 'k-5' WHEN 5 THEN 'Full Size Blazer' ELSE 'Blazer' END,
       'sold', 1000 + n, date '2026-01-01' + n, 'https://example.test/sale/' || n
FROM generate_series(1, 6) n;
-- Rows that must never be comparables.
INSERT INTO public.vehicles (id, year, make, model, sale_status, auction_outcome, sale_price, sale_date, is_public, deleted_at, listing_kind, listing_url, owner_id) VALUES
 ('30000000-0000-0000-0000-000000000001', 1975, 'Chevrolet', 'Blazer', 'sold', NULL, 9999, '2026-09-01', true,  NULL, NULL, 'https://example.test/wrong-era', NULL),
 ('30000000-0000-0000-0000-000000000002', 1981, 'Chevrolet', 'Blazer', 'sold', NULL, 9999, '2026-09-01', true,  NULL, NULL, 'https://example.test/after-scope', NULL),
 ('30000000-0000-0000-0000-000000000003', 1977, 'Chevrolet', 'Trailblazer', 'sold', NULL, 9999, '2026-09-01', true, NULL, NULL, 'https://example.test/substring', NULL),
 ('30000000-0000-0000-0000-000000000004', 1977, 'Chevrolet', 'Blazer', 'sold', NULL, 9999, '2026-09-01', false, NULL, NULL, 'https://example.test/private', '90000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000005', 1977, 'Chevrolet', 'Blazer', 'sold', NULL, 9999, '2026-09-01', true,  now(), NULL, 'https://example.test/deleted', NULL),
 ('30000000-0000-0000-0000-000000000006', 1977, 'Chevrolet', 'Blazer', 'sold', NULL, 9999, '2026-09-01', true,  NULL, 'non_vehicle_item', 'https://example.test/part', NULL),
 ('30000000-0000-0000-0000-000000000007', 1977, 'Chevrolet', 'Blazer', 'for_sale', NULL, 9999, '2026-09-01', true, NULL, NULL, 'https://example.test/ask', NULL),
 ('30000000-0000-0000-0000-000000000008', 1977, 'Chevrolet', 'Blazer', 'sold', 'no_sale', 9999, '2026-09-01', true, NULL, NULL, 'https://example.test/contradiction', NULL),
 ('30000000-0000-0000-0000-000000000009', 1977, 'Chevrolet', 'Blazer', 'sold', NULL, 9999, NULL, true, NULL, NULL, 'https://example.test/unclocked', NULL),
 ('30000000-0000-0000-0000-00000000000a', 1977, 'Ford',      'Blazer', 'sold', NULL, 9999, '2026-09-01', true, NULL, NULL, 'https://example.test/other-make', NULL);
-- No registered scope: a 1966 Ford Mustang with sold Mustangs (exact model, aliases not involved), one private, one deleted.
INSERT INTO public.vehicles (id, year, make, model, sale_status, sale_price, sale_date, is_public, deleted_at, listing_url, owner_id) VALUES
 ('40000000-0000-0000-0000-000000000001', 1966, 'Ford', 'Mustang', 'available', NULL, NULL, true, NULL, 'https://example.test/mustang-subject', NULL),
 ('40000000-0000-0000-0000-000000000002', 1966, 'ford', 'MUSTANG', 'sold', 31000, '2026-02-01', true, NULL, 'https://example.test/mustang/2', NULL),
 ('40000000-0000-0000-0000-000000000003', 1966, 'Ford', 'Mustang', 'sold', 29000, '2026-03-01', true, NULL, 'https://example.test/mustang/3', NULL),
 ('40000000-0000-0000-0000-000000000004', 1966, 'Ford', 'Mustang', 'sold', 99000, '2026-04-01', false, NULL, 'https://example.test/mustang/private', '90000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000005', 1966, 'Ford', 'Mustang', 'sold', 99000, '2026-05-01', true, now(), 'https://example.test/mustang/deleted', NULL),
 ('40000000-0000-0000-0000-000000000006', 1967, 'Ford', 'Mustang', 'sold', 99000, '2026-06-01', true, NULL, 'https://example.test/mustang/other-year', NULL),
 -- missing year, missing model, an unknown model
 ('50000000-0000-0000-0000-000000000001', NULL, 'Chevrolet', 'Blazer', 'available', NULL, NULL, true, NULL, 'https://example.test/no-year', NULL),
 ('50000000-0000-0000-0000-000000000002', 1977, 'Chevrolet', NULL, 'available', NULL, NULL, true, NULL, 'https://example.test/no-model', NULL),
 ('50000000-0000-0000-0000-000000000003', 1977, 'Unknown Make', 'Unknown Model', 'available', NULL, NULL, true, NULL, 'https://example.test/unknown', NULL),
 ('50000000-0000-0000-0000-000000000004', 1977, 'unknown make', 'unknown model', 'sold', 2000, '2026-05-01', true, NULL, 'https://example.test/unknown/2', NULL);
INSERT INTO public.vehicle_events (vehicle_id, event_type, final_price) SELECT '20000000-0000-0000-0000-000000000001', 'sale', 8000 FROM generate_series(1, 3);

-- Capture the live reader's documents: four roles x every viewed vehicle, before the migration.
CREATE TABLE public.t_docs (phase text, who text, vid uuid, doc jsonb);
GRANT INSERT, SELECT ON public.t_docs TO anon, authenticated, service_role;
CREATE TABLE public.t_vids (vid uuid PRIMARY KEY);
INSERT INTO public.t_vids SELECT id FROM public.vehicles;
GRANT SELECT ON public.t_vids TO anon, authenticated, service_role;
CREATE PROCEDURE public.t_capture(p_phase text) LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL ROLE anon; SET LOCAL request.jwt.claim.role = 'anon'; SET LOCAL request.jwt.claim.sub = '';
  INSERT INTO public.t_docs SELECT p_phase, 'anon', vid, public.popup_vehicle_intel(vid) FROM public.t_vids;
  RESET ROLE;
  SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '70000000-0000-0000-0000-000000000009';
  INSERT INTO public.t_docs SELECT p_phase, 'stranger', vid, public.popup_vehicle_intel(vid) FROM public.t_vids;
  RESET ROLE;
  SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '90000000-0000-0000-0000-000000000001';
  INSERT INTO public.t_docs SELECT p_phase, 'owner', vid, public.popup_vehicle_intel(vid) FROM public.t_vids;
  RESET ROLE;
  SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role = 'service_role'; SET LOCAL request.jwt.claim.sub = '';
  INSERT INTO public.t_docs SELECT p_phase, 'service', vid, public.popup_vehicle_intel(vid) FROM public.t_vids;
  RESET ROLE;
END $$;
BEGIN; CALL public.t_capture('before'); COMMIT;

-- Sanity of the capture (so "old == new" is not two empty answers): the public Blazer sees the six sales in the supported scope.
SELECT public.t_assert(
  (SELECT doc->'recent_comps_scope'->>'method' FROM public.t_docs WHERE phase = 'before' AND who = 'anon' AND vid = '10000000-0000-0000-0000-000000000001') = 'supported_registered_cohort'
  AND (SELECT jsonb_array_length(doc->'recent_comps') FROM public.t_docs WHERE phase = 'before' AND who = 'anon' AND vid = '10000000-0000-0000-0000-000000000001') = 6,
  'before: the public Blazer has a supported scope and six comps');
SELECT public.t_assert(
  (SELECT doc IS NULL FROM public.t_docs WHERE phase = 'before' AND who = 'anon' AND vid = '10000000-0000-0000-0000-000000000002')
  AND (SELECT doc->'recent_comps_scope'->>'method' FROM public.t_docs WHERE phase = 'before' AND who = 'owner' AND vid = '10000000-0000-0000-0000-000000000002') = 'supported_registered_cohort',
  'before: the private Blazer is invisible to anon and, for its owner, still belongs to the supported scope');

-- The members the live resolver lists (visible rows, as the deploy role sees them) for later comparison.
CREATE TABLE public.t_members_before AS SELECT vehicle_id FROM public.cohort_members('f5586ac1-dc51-4d4b-bd26-abb1b207f872');

-- 1. The migration.
\ir ../migrations/20261014052500_popup_vehicle_intel_public_cohort.sql

-- 2. After: identical documents for every role and every viewed vehicle.
BEGIN; CALL public.t_capture('after'); COMMIT;
SELECT public.t_assert(NOT EXISTS (
    SELECT * FROM (SELECT who, vid, doc FROM public.t_docs WHERE phase = 'before' EXCEPT SELECT who, vid, doc FROM public.t_docs WHERE phase = 'after') a)
  AND NOT EXISTS (
    SELECT * FROM (SELECT who, vid, doc FROM public.t_docs WHERE phase = 'after' EXCEPT SELECT who, vid, doc FROM public.t_docs WHERE phase = 'before') b)
  AND (SELECT count(*) FROM public.t_docs WHERE phase = 'before') = (SELECT count(*) FROM public.t_docs WHERE phase = 'after')
  AND (SELECT count(*) FROM public.t_docs WHERE phase = 'after') = 4 * (SELECT count(*) FROM public.t_vids),
  'after: identical documents for anon, a stranger, the owner of a private vehicle and the service role');

-- 3. And what they say is right: the six sales, in order, never a private, deleted, part, unsold, other-year or other-make row.
SELECT public.t_assert(
  (SELECT array_agg(c->>'id' ORDER BY c->>'id') FROM public.t_docs t, jsonb_array_elements(t.doc->'recent_comps') c
    WHERE t.phase = 'after' AND t.who = 'anon' AND t.vid = '10000000-0000-0000-0000-000000000001')
  = ARRAY['20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003',
          '20000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006'],
  'after: exactly the six qualifying sales');
SELECT public.t_assert(NOT EXISTS (
    SELECT 1 FROM public.t_docs t, jsonb_array_elements(t.doc->'recent_comps') c
    WHERE t.phase = 'after' AND ((c->>'id') LIKE '30000000%' OR (c->>'id') LIKE '40000000-0000-0000-0000-00000000000_' AND (c->>'id') NOT IN
      ('40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003'))),
  'after: no private, deleted, part, unsold, unclocked, other-era or other-make vehicle is a comparable, for any role');
SELECT public.t_assert(
  (SELECT array_agg(c->>'id' ORDER BY c->>'id') FROM public.t_docs t, jsonb_array_elements(t.doc->'recent_comps') c
    WHERE t.phase = 'after' AND t.who = 'anon' AND t.vid = '40000000-0000-0000-0000-000000000001')
  = ARRAY['40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003']
  AND (SELECT doc->'recent_comps_scope'->>'method' FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = '40000000-0000-0000-0000-000000000001') = 'same_year_exact_model',
  'after: with no scope, the two public sold Mustangs of the same year and no others');
SELECT public.t_assert(
  (SELECT doc->'recent_comps_scope'->>'method' FROM public.t_docs WHERE phase = 'after' AND who = 'owner' AND vid = '10000000-0000-0000-0000-000000000002') = 'supported_registered_cohort'
  AND (SELECT doc IS NULL FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = '10000000-0000-0000-0000-000000000002')
  AND (SELECT doc IS NULL FROM public.t_docs WHERE phase = 'after' AND who = 'stranger' AND vid = '10000000-0000-0000-0000-000000000002'),
  'after: the owner''s private Blazer is still in the supported scope for them, and invisible to everyone else');
SELECT public.t_assert((SELECT bool_and(doc IS NULL) FROM public.t_docs WHERE phase = 'after' AND vid IN
    ('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004')),
  'after: a deleted or part vehicle as the viewed one is still suppressed for everyone');

-- 4. The new readers.
SELECT public.t_assert((SELECT array_agg(vehicle_id ORDER BY vehicle_id) FROM public.cohort_members_public('f5586ac1-dc51-4d4b-bd26-abb1b207f872'))
  = (SELECT array_agg(vehicle_id ORDER BY vehicle_id) FROM public.t_members_before m
       JOIN public.vehicles v ON v.id = m.vehicle_id WHERE v.is_public AND v.deleted_at IS NULL),
  'cohort_members_public is cohort_members restricted to public, undeleted vehicles (and the part is already out)');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.cohort_members_public('f5586ac1-dc51-4d4b-bd26-abb1b207f872') m
    JOIN public.vehicles v ON v.id = m.vehicle_id WHERE NOT v.is_public OR v.deleted_at IS NOT NULL OR v.listing_kind = 'non_vehicle_item'),
  'cohort_members_public never returns a private, deleted or part vehicle');
SELECT public.t_assert((SELECT count(*) FROM public.cohort_members_public('00000000-0000-0000-0000-00000000ffff')) = 0
  AND (SELECT count(*) FROM public.cohort_members_public(NULL)) = 0, 'an unknown subject has no members');
SELECT public.t_assert((SELECT array_agg(id ORDER BY id) FROM public.public_vehicles_by_model_year('FORD', 1966, ARRAY['mustang']))
  = ARRAY['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003']::uuid[],
  'public_vehicles_by_model_year: case-insensitive make and model, one year, public and undeleted only');
SELECT public.t_assert((SELECT left(pattern, 3) = '\y(' AND right(pattern, 3) = ')\y' AND strpos(pattern, 'k\-5') > 0 AND strpos(pattern, 'full size blazer') > 0
    FROM public.cohort_scope_rule('f5586ac1-dc51-4d4b-bd26-abb1b207f872'))
  AND (SELECT canonical_make || year_start || year_end FROM public.cohort_scope_rule('f5586ac1-dc51-4d4b-bd26-abb1b207f872')) = 'CHEVROLET19761980',
  'cohort_scope_rule: the K5 rule, word-bounded, hyphen escaped');
SET ROLE anon;
SELECT public.t_assert((SELECT count(*) FROM public.cohort_members_public('f5586ac1-dc51-4d4b-bd26-abb1b207f872')) = 10
  AND NOT EXISTS (SELECT 1 FROM public.cohort_members_public('f5586ac1-dc51-4d4b-bd26-abb1b207f872') WHERE vehicle_id = '30000000-0000-0000-0000-000000000004'),
  'anon can execute the readers and gets only public vehicles');
RESET ROLE;

-- 5. Shape and rights.
SELECT public.t_assert((SELECT NOT prosecdef AND provolatile = 's' AND proconfig::text LIKE '%statement_timeout=10s%' FROM pg_proc WHERE oid = 'public.popup_vehicle_intel(uuid)'::regprocedure),
  'the popup stays SECURITY INVOKER, stable, with its 10 s statement_timeout');
SELECT public.t_assert((SELECT prosecdef AND proconfig::text LIKE '%search_path=public, pg_temp%' FROM pg_proc WHERE oid = 'public.cohort_members_public(uuid)'::regprocedure)
  AND (SELECT prosecdef AND proconfig::text LIKE '%search_path=public, pg_temp%' FROM pg_proc WHERE oid = 'public.public_vehicles_by_model_year(text,integer,text[])'::regprocedure)
  AND (SELECT NOT prosecdef FROM pg_proc WHERE oid = 'public.cohort_scope_rule(uuid)'::regprocedure),
  'the two readers are definer with a pinned search_path, the rule is invoker');
SELECT public.t_assert(NOT has_function_privilege('public', 'public.cohort_members_public(uuid)', 'execute')
  AND has_function_privilege('anon', 'public.cohort_members_public(uuid)', 'execute')
  AND has_function_privilege('authenticated', 'public.public_vehicles_by_model_year(text,integer,text[])', 'execute'),
  'EXECUTE: not PUBLIC, but anon, authenticated and service_role');
SELECT public.t_assert(pg_get_functiondef('public.popup_vehicle_intel(uuid)'::regprocedure) NOT LIKE '%public.cohort_members(%'
  AND pg_get_functiondef('public.popup_vehicle_intel(uuid)'::regprocedure) LIKE '%cohort_members_public%', 'the popup reads the cohort through the public reader');

-- 6. Overlapping supported scopes still fall back to the exact model year, as before.
UPDATE public.make_model_profiles SET comparison_scope_status = 'supported', comparison_scope_basis = 'Synthetic second supported scope'
  WHERE subject_id = 'feb225e6-3a73-425d-ba12-143680e8b9ca';
SELECT public.t_assert(
  (SELECT doc->'recent_comps_scope'->>'fallback_reason' FROM (SELECT public.popup_vehicle_intel('10000000-0000-0000-0000-000000000001') doc) d) = 'overlapping_supported_scopes',
  'after: two supported scopes are disclosed and not resolved by guessing');
UPDATE public.make_model_profiles SET comparison_scope_status = 'context_only' WHERE subject_id = 'feb225e6-3a73-425d-ba12-143680e8b9ca';

-- 7. A second run is a no-op that passes the guard.
\ir ../migrations/20261014052500_popup_vehicle_intel_public_cohort.sql
SELECT public.t_assert((SELECT jsonb_array_length(public.popup_vehicle_intel('10000000-0000-0000-0000-000000000001')->'recent_comps')) = 6, 'a re-run leaves the answer alone');

-- 8. A drifted source stops the migration and is left as found.
CREATE OR REPLACE FUNCTION public.popup_vehicle_intel(p_vehicle_id uuid) RETURNS jsonb LANGUAGE sql STABLE
  AS $f$ SELECT '{"drifted": true}'::jsonb WHERE p_vehicle_id IS NOT NULL $f$;
\echo 'Expected: the source guard ERROR below, then the aborted transaction ignoring the rest of the file.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014052500_popup_vehicle_intel_public_cohort.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(public.popup_vehicle_intel('10000000-0000-0000-0000-000000000001') = '{"drifted": true}'::jsonb, 'a drifted function is not replaced');
SELECT 'popup_vehicle_intel public-cohort contract: PASS' AS result;
