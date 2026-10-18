-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_gallery_eligible -f this-file.sql
-- Proves, for 20261014050000_vehicle_image_gallery_eligible_inlinable.sql, that vehicle_image_gallery_eligible answers
-- exactly what the live function answered, for every row of a matrix that reaches every branch (as the table owner and as
-- anon under a row policy on vehicles), while the planner now inlines it: the live function takes the whole row and
-- carries a SET clause, so each row it tests is flattened (every external column detoasted) before the first test runs;
-- after the migration the filter names only the columns it reads. Grants, owner, volatility, signature and comment are
-- unchanged, a dependent view keeps working, a second run is a no-op, and a drifted function stops the migration.
-- The rows below are a disposable test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- The shapes the function reads (types as production has them, 2026-10-14).
CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TYPE public.content_approval_status AS ENUM ('pending', 'approved', 'auto_approved', 'rejected');
CREATE TYPE public.content_redaction_level AS ENUM ('none', 'partial', 'full');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean);
CREATE TABLE public.auction_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source text, source_url text);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, image_url text, source text,
  is_document boolean, is_duplicate boolean, is_superseded boolean, is_sensitive boolean, is_external boolean, is_approved boolean,
  approval_status public.content_approval_status, verification_status text, redaction_level public.content_redaction_level,
  vision_gate_status public.vision_gate_status, image_vehicle_match_status text, exif_data jsonb, ai_scan_metadata jsonb,
  is_primary boolean, "position" integer, created_at timestamptz DEFAULT now());
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT TO public USING (is_public = true);
GRANT SELECT ON public.vehicles, public.auction_events, public.vehicle_images TO anon, authenticated, service_role;

-- The live function, with the live grants and comment; then a renamed copy of it to compare against.
\ir helpers/vehicle_image_gallery_eligible_live_20261014.sql
SELECT md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(vehicle_images)'::regprocedure)) = '8e1b679106cda35298b92e827fb5e444' AS fixture_is_live \gset
SELECT obj_description('public.vehicle_image_gallery_eligible(vehicle_images)'::regprocedure, 'pg_proc') AS comment_before \gset
SELECT proacl::text AS acl_before FROM pg_proc WHERE oid = 'public.vehicle_image_gallery_eligible(vehicle_images)'::regprocedure \gset
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.vehicle_image_gallery_eligible(vehicle_images)'::regprocedure),
                  'public.vehicle_image_gallery_eligible', 'public.t_eligible_live');
END $$;
GRANT EXECUTE ON FUNCTION public.t_eligible_live(vehicle_images) TO anon, authenticated;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated;
-- The plan as text, and the buffers a statement touched.
CREATE FUNCTION public.t_plan_text(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text := ''; line text;
BEGIN FOR line IN EXECUTE 'EXPLAIN (VERBOSE, COSTS OFF) ' || p_sql LOOP r := r || line || E'\n'; END LOOP; RETURN r; END $$;
CREATE FUNCTION public.t_buffers(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE j text;
BEGIN
  EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || p_sql INTO j;
  RETURN ((j::jsonb -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint + (j::jsonb -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint);
END $$;
SELECT public.t_assert(:'fixture_is_live'::boolean, 'the fixture is the live function');

-- P is a public vehicle with one BaT event, Q a private vehicle with one BaT event of its own.
INSERT INTO public.vehicles VALUES ('40000000-0000-0000-0000-000000000001', true), ('40000000-0000-0000-0000-000000000002', false);
INSERT INTO public.auction_events (vehicle_id, source, source_url) VALUES
 ('40000000-0000-0000-0000-000000000001', 'bat', 'https://bringatrailer.com/listing/1977-chevrolet-k5-blazer/'),
 ('40000000-0000-0000-0000-000000000001', 'cars_and_bids', 'https://carsandbids.com/auctions/x'),
 ('40000000-0000-0000-0000-000000000002', 'bat', 'https://bringatrailer.com/listing/1966-ford-mustang/');

-- A deterministic matrix: each column takes a value chosen by a hash of (row number, column), so the rows reach every
-- branch of the function; the pending branch is over-sampled by pinning the gate to 'pending' on half of the rows.
CREATE FUNCTION public.t_pick(p_values anyarray, p_i integer, p_salt text) RETURNS anyelement LANGUAGE sql IMMUTABLE AS $$
  SELECT p_values[1 + (('x' || substr(md5(p_i::text || p_salt), 1, 7))::bit(28)::int % array_length(p_values, 1))] $$;
-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO public.vehicle_images (vehicle_id, image_url, source, is_document, is_duplicate, is_superseded, is_sensitive, is_external, is_approved,
  approval_status, verification_status, redaction_level, vision_gate_status, image_vehicle_match_status, exif_data)
SELECT public.t_pick(ARRAY['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', NULL]::uuid[], i, 'v'),
       public.t_pick(ARRAY[NULL, '', '   ', 'file://x.jpg', 'https://example.com/a.jpg', 'https://bringatrailer.com/wp-content/uploads/2026/01/a.jpg',
                           'https://www.bringatrailer.com/wp-content/uploads/b.jpg', 'https://bringatrailer.com/wp-content/uploads/c.jpg',
                           'https://bringatrailer.com/wp-content/uploads/d.jpg']::text[], i, 'u'),
       public.t_pick(ARRAY[NULL, 'e2e_test', 'bat_import', 'bat_import', 'bat_import', 'iphoto']::text[], i, 's'),
       public.t_pick(ARRAY[NULL, false, false, false, true]::boolean[], i, 'd'),
       public.t_pick(ARRAY[NULL, false, false, false, true]::boolean[], i, 'p'),
       public.t_pick(ARRAY[NULL, false, false, false, true]::boolean[], i, 'r'),
       public.t_pick(ARRAY[NULL, false, false, true]::boolean[], i, 'z'),
       public.t_pick(ARRAY[NULL, false, true, true, true]::boolean[], i, 'e'),
       public.t_pick(ARRAY[NULL, false, true, true, true]::boolean[], i, 'a'),
       public.t_pick(ARRAY[NULL, 'pending', 'approved', 'auto_approved', 'approved', 'rejected']::public.content_approval_status[], i, 'q'),
       public.t_pick(ARRAY[NULL, 'pending', 'approved', 'approved', 'approved']::text[], i, 'f'),
       public.t_pick(ARRAY[NULL, 'none', 'none', 'none', 'partial', 'full']::public.content_redaction_level[], i, 'x'),
       CASE WHEN i % 2 = 0 THEN 'pending'::public.vision_gate_status
            ELSE public.t_pick(ARRAY[NULL, 'approved', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed', 'pending']::public.vision_gate_status[], i, 'g') END,
       public.t_pick(ARRAY[NULL, NULL, 'match', 'mismatch', 'unrelated', 'ok']::text[], i, 'm'),
       public.t_pick(ARRAY[NULL, '{}', '{"listing_urls": ["https://bringatrailer.com/listing/1977-chevrolet-k5-blazer/"]}',
                           '{"listing_urls": "https://bringatrailer.com/listing/1977-chevrolet-k5-blazer/"}',
                           '{"discovery_url": "https://bringatrailer.com/listing/1977-chevrolet-k5-blazer"}',
                           '{"source_url": "https://bringatrailer.com/listing/1977-chevrolet-k5-blazer/"}',
                           '{"listing_urls": ["https://bringatrailer.com/listing/1966-ford-mustang/"]}',
                           '{"source_url": "https://bringatrailer.com/listing/other/"}']::jsonb[], i, 'j')
  FROM generate_series(1, 20000) i;

-- The pending branch needs a dozen things true at once, which random draws almost never give. So: a baseline frame that
-- passes every pending test, then (a) every combination of the cheap per-frame tests, (b) every combination of the URL,
-- vehicle and EXIF-provenance tests, and (c) each single flip of the remaining tests.
CREATE TEMP TABLE t_base AS SELECT jsonb_build_object(
  'vehicle_id', '40000000-0000-0000-0000-000000000001', 'image_url', 'https://bringatrailer.com/wp-content/uploads/a.jpg', 'source', 'bat_import',
  'is_document', false, 'is_duplicate', false, 'is_superseded', false, 'is_sensitive', false, 'is_external', true, 'is_approved', true,
  'approval_status', 'approved', 'verification_status', 'approved', 'redaction_level', 'none', 'vision_gate_status', 'pending',
  'image_vehicle_match_status', NULL,
  'exif_data', '{"listing_urls": ["https://bringatrailer.com/listing/1977-chevrolet-k5-blazer/"]}'::jsonb) AS j;
-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO public.vehicle_images
SELECT (jsonb_populate_record(NULL::public.vehicle_images, b.j || jsonb_build_object('id', gen_random_uuid()) || v.o)).*
  FROM t_base b,
  (SELECT jsonb_build_object('is_sensitive', s, 'approval_status', a, 'verification_status', f, 'redaction_level', r, 'is_external', e, 'is_approved', ap) AS o
     FROM unnest(ARRAY[NULL, false, true]::boolean[]) s, unnest(ARRAY[NULL, 'pending', 'approved', 'auto_approved', 'rejected']::text[]) a,
          unnest(ARRAY[NULL, 'pending', 'approved']::text[]) f, unnest(ARRAY[NULL, 'none', 'partial', 'full']::text[]) r,
          unnest(ARRAY[NULL, false, true]::boolean[]) e, unnest(ARRAY[NULL, false, true]::boolean[]) ap) v;
-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO public.vehicle_images
SELECT (jsonb_populate_record(NULL::public.vehicle_images, b.j || jsonb_build_object('id', gen_random_uuid()) || v.o)).*
  FROM t_base b,
  (SELECT jsonb_build_object('image_url', u, 'vehicle_id', veh, 'exif_data', x, 'source', src) AS o
     FROM unnest(ARRAY[NULL, '', 'file://x.jpg', 'https://example.com/a.jpg', 'https://bringatrailer.com/wp-content/uploads/a.jpg',
                       'https://www.bringatrailer.com/wp-content/uploads/b.jpg', 'http://bringatrailer.com/wp-content/uploads/c.jpg']::text[]) u,
          unnest(ARRAY['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', NULL]::uuid[]) veh,
          unnest(ARRAY[NULL, '{}', '{"listing_urls": ["https://bringatrailer.com/listing/1977-chevrolet-k5-blazer/"]}',
                       '{"listing_urls": "https://bringatrailer.com/listing/1977-chevrolet-k5-blazer/"}',
                       '{"listing_urls": ["https://bringatrailer.com/listing/1966-ford-mustang/"]}',
                       '{"discovery_url": "https://bringatrailer.com/listing/1977-chevrolet-k5-blazer"}',
                       '{"discovery_url": "https://carsandbids.com/auctions/x"}',
                       '{"source_url": "https://bringatrailer.com/listing/1977-chevrolet-k5-blazer/"}',
                       '{"source_url": "https://bringatrailer.com/listing/other/"}']::jsonb[]) x,
          unnest(ARRAY['bat_import', 'e2e_test', 'iphoto', NULL]::text[]) src) v;
-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO public.vehicle_images
SELECT (jsonb_populate_record(NULL::public.vehicle_images, b.j || jsonb_build_object('id', gen_random_uuid()) || v.o)).*
  FROM t_base b,
  (VALUES ('{"is_document": true}'::jsonb), ('{"is_document": null}'), ('{"is_duplicate": true}'), ('{"is_duplicate": null}'), ('{"is_superseded": true}'),
          ('{"is_superseded": null}'), ('{"image_vehicle_match_status": "mismatch"}'), ('{"image_vehicle_match_status": "unrelated"}'),
          ('{"image_vehicle_match_status": "match"}'), ('{"vision_gate_status": null}'), ('{"vision_gate_status": "approved"}'),
          ('{"vision_gate_status": "rejected_personal"}'), ('{"vision_gate_status": "rejected_misattributed"}'), ('{"vision_gate_status": "review_needed"}'),
          ('{"vision_gate_status": "approved", "is_sensitive": true, "image_url": "   "}')) v(o);
-- Some rows carry a metadata blob too big to stay in the heap tuple (it goes to TOAST), as analysed frames do.
UPDATE public.vehicle_images SET ai_scan_metadata = jsonb_build_object('blob', (SELECT string_agg(md5(id::text || g), '') FROM generate_series(1, 220) g))
 WHERE id IN (SELECT id FROM public.vehicle_images ORDER BY id LIMIT 3000);
VACUUM ANALYZE public.vehicle_images;

CREATE VIEW public.t_gallery_view AS SELECT id FROM public.vehicle_images WHERE public.vehicle_image_gallery_eligible(vehicle_images);
GRANT SELECT ON public.t_gallery_view TO anon, authenticated;
SELECT count(*) AS eligible_before FROM public.vehicle_images vi WHERE public.t_eligible_live(vi) \gset
SELECT (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.t_gallery_view) AS view_ids_before \gset
SELECT public.t_buffers('SELECT count(*) FROM public.vehicle_images vi WHERE vi.ai_scan_metadata IS NOT NULL AND public.vehicle_image_gallery_eligible(vi)') AS buffers_before \gset

-- 1. Before: the planner keeps the call, because a function with a SET clause is not inlined.
SELECT strpos(public.t_plan_text('SELECT vi.id FROM public.vehicle_images vi WHERE public.vehicle_image_gallery_eligible(vi)'), 'vehicle_image_gallery_eligible(vi.*)') > 0 AS call_kept_before \gset
SELECT public.t_assert(:'call_kept_before'::boolean, 'before: the plan calls the function on the whole row');

-- 2. The migration.
\ir ../migrations/20261014050000_vehicle_image_gallery_eligible_inlinable.sql

-- 3. After: not a call any more, the columns it reads; and the same tests, in the same pending-branch shape.
SELECT public.t_plan_text('SELECT vi.id FROM public.vehicle_images vi WHERE public.vehicle_image_gallery_eligible(vi)') AS plan_after \gset
SELECT public.t_assert(strpos(:'plan_after', 'vehicle_image_gallery_eligible') = 0, 'after: the plan no longer calls the function');
SELECT public.t_assert(strpos(:'plan_after', 'is_document') > 0 AND strpos(:'plan_after', 'image_vehicle_match_status') > 0
  AND strpos(:'plan_after', 'bat_pending_image_has_listing') > 0, 'after: the filter names the columns and the pending-frame helper');
SELECT public.t_buffers('SELECT count(*) FROM public.vehicle_images vi WHERE vi.ai_scan_metadata IS NOT NULL AND public.vehicle_image_gallery_eligible(vi)') AS buffers_after \gset
SELECT public.t_assert(:buffers_after * 4 < :buffers_before, format('after: far fewer buffers on frames with a TOASTed blob (%s before, %s after)', :buffers_before, :buffers_after));

-- 4. Same answers, row for row: as the table owner, then as anon (vehicles is behind a row policy).
SELECT count(*) AS mismatches_owner FROM public.vehicle_images vi
 WHERE public.t_eligible_live(vi) IS DISTINCT FROM public.vehicle_image_gallery_eligible(vi) \gset
SELECT count(*) FILTER (WHERE public.vehicle_image_gallery_eligible(vi)) AS n_true,
       count(*) FILTER (WHERE NOT public.vehicle_image_gallery_eligible(vi)) AS n_false,
       count(*) FILTER (WHERE public.vehicle_image_gallery_eligible(vi) IS NULL) AS n_null,
       count(*) FILTER (WHERE vi.vision_gate_status = 'pending' AND public.vehicle_image_gallery_eligible(vi)) AS n_pending_true,
       count(*) FILTER (WHERE vi.vision_gate_status = 'pending' AND vi.vehicle_id = '40000000-0000-0000-0000-000000000002' AND vi.is_external AND vi.is_approved
                          AND NOT public.vehicle_image_gallery_eligible(vi)) AS n_private_pending_refused
  FROM public.vehicle_images vi \gset
SELECT public.t_assert(:mismatches_owner = 0, format('owner: %s rows answer differently', :mismatches_owner));
SELECT public.t_assert(:n_true > 500 AND :n_false > 1000 AND :n_pending_true > 10 AND :n_private_pending_refused > 0,
  format('the matrix reaches every branch (true %s, false %s, null %s, pending true %s, private pending refused %s)', :n_true, :n_false, :n_null, :n_pending_true, :n_private_pending_refused));
SELECT public.t_assert(:n_true = :eligible_before, 'the number of eligible frames is unchanged');
SET ROLE anon;
SELECT count(*) AS mismatches_anon FROM public.vehicle_images vi
 WHERE public.t_eligible_live(vi) IS DISTINCT FROM public.vehicle_image_gallery_eligible(vi) \gset
SELECT count(*) AS anon_eligible FROM public.vehicle_images vi WHERE public.vehicle_image_gallery_eligible(vi) \gset
SELECT count(*) AS anon_pending_eligible FROM public.vehicle_images vi WHERE vi.vision_gate_status = 'pending' AND public.vehicle_image_gallery_eligible(vi) \gset
SELECT (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.t_gallery_view) AS view_ids_anon \gset
RESET ROLE;
SELECT public.t_assert(:mismatches_anon = 0, format('anon: %s rows answer differently', :mismatches_anon));
-- the pending branch asks the vehicle itself to be public, so anon and the table owner agree on every frame
SELECT count(*) AS owner_pending_eligible FROM public.vehicle_images vi WHERE vi.vision_gate_status = 'pending' AND public.vehicle_image_gallery_eligible(vi) \gset
SELECT public.t_assert(:anon_pending_eligible > 0 AND :anon_pending_eligible = :owner_pending_eligible AND :anon_eligible = :n_true,
  'anon and the owner see the same eligible frames, pending ones of the public vehicle included');
-- a view written against the function before the migration still answers, with the same frames
SELECT (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.t_gallery_view) AS view_ids_after \gset
SELECT public.t_assert(:'view_ids_after' = :'view_ids_before', 'the dependent view returns the same frames');

-- 5. What did not change.
SELECT public.t_assert((SELECT proconfig IS NULL AND NOT prosecdef AND NOT proisstrict AND provolatile = 's' AND prorettype = 'boolean'::regtype
                          AND pg_get_userbyid(proowner) = current_user
                          AND pg_get_function_identity_arguments(oid) = 'vehicle_images'
                          FROM pg_proc WHERE oid = 'public.vehicle_image_gallery_eligible(vehicle_images)'::regprocedure),
  'volatility, return type, owner and signature are the same; no SET clause, not security definer, not strict');
SELECT public.t_assert((SELECT proacl::text FROM pg_proc WHERE oid = 'public.vehicle_image_gallery_eligible(vehicle_images)'::regprocedure) = :'acl_before',
  'EXECUTE grants on the function are unchanged');
SELECT public.t_assert(obj_description('public.vehicle_image_gallery_eligible(vehicle_images)'::regprocedure, 'pg_proc') = :'comment_before', 'the comment is unchanged');
SELECT public.t_assert(has_function_privilege('anon', 'public.bat_pending_image_has_listing(uuid, jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.bat_pending_image_has_listing(uuid, jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.bat_pending_image_has_listing(uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.bat_pending_image_has_listing(uuid, jsonb)', 'EXECUTE')
  AND (SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.bat_pending_image_has_listing(uuid, jsonb)'::regprocedure),
  'the helper is executable by the same roles, not by PUBLIC, and runs as the caller');

-- 6. A second run is a no-op.
SELECT pg_get_functiondef('public.vehicle_image_gallery_eligible(vehicle_images)'::regprocedure) AS def_after \gset
\ir ../migrations/20261014050000_vehicle_image_gallery_eligible_inlinable.sql
SELECT public.t_assert(pg_get_functiondef('public.vehicle_image_gallery_eligible(vehicle_images)'::regprocedure) = :'def_after', 'a second run leaves the function as it was');

-- 7. A drifted function stops the migration and is left as found.
CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
\set ON_ERROR_STOP off
\echo 'Expected: the drift guard ERROR below, then the aborted transaction ignoring the rest of the file.'
\ir ../migrations/20261014050000_vehicle_image_gallery_eligible_inlinable.sql
\set ON_ERROR_STOP on
ROLLBACK;
SELECT public.t_assert(pg_get_functiondef('public.vehicle_image_gallery_eligible(vehicle_images)'::regprocedure) LIKE '%SELECT true%', 'a drifted function is not replaced');

SELECT 'vehicle_image_gallery_eligible inline contract: PASS' AS result;
