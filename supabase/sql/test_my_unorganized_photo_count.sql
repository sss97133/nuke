-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_unorganized_count -f this-file.sql
-- Proves my_unorganized_photo_count(): the Inbox badge's number, counted up to 1,000 under the caller's own row policies.
--   * it counts the caller's photos with no vehicle whose organization_status is unorganized or null, and no others:
--     not organized, not ignored, not on a vehicle, not another user's;
--   * it never exceeds 1,000 (the badge prints 999+ above 999) and equals the exact count below that;
--   * it is SECURITY INVOKER, so it counts only what the caller's row policies admit, and anon cannot execute it;
--   * the capped read stops fetching rows at the cap (the plan reads the index and limits before the aggregate).
-- The rows below are a disposable test database's rows, never production testimony.
-- ALLOW_RAW_TESTIMONY_WRITE: a disposable test database; the stub tables below carry production's names and none of its rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- Supabase's auth shims and roles, as the live policies use them.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.auth_role', true), ''), 'anon') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

-- vehicle_images with the columns the count reads, the live partial index, and the live SELECT policies that matter.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, user_id uuid, is_public boolean NOT NULL DEFAULT true);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, documented_by_user_id uuid, vehicle_id uuid,
  organization_status text, is_sensitive boolean, is_superseded boolean, vision_gate_status text, created_at timestamptz DEFAULT now());
CREATE INDEX idx_vehicle_images_unorganized ON public.vehicle_images (user_id, created_at DESC) WHERE vehicle_id IS NULL;
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own images" ON public.vehicle_images FOR SELECT USING ((SELECT auth.uid()) = user_id);
CREATE POLICY users_can_view_own_unorganized_images ON public.vehicle_images FOR SELECT
  USING (vehicle_id IS NULL AND (user_id = auth.uid() OR documented_by_user_id = auth.uid()));
CREATE POLICY "Users can view images for public vehicles" ON public.vehicle_images FOR SELECT
  USING (coalesce(is_sensitive, false) = false AND coalesce(is_superseded, false) = false
         AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_images.vehicle_id AND v.is_public = true));
GRANT SELECT ON public.vehicle_images, public.vehicles TO anon, authenticated, service_role;

-- A (1,200 unorganized: 1,000 with status unorganized + 200 with none), organized 30, ignored 25, on a vehicle 40.
-- B (7 unorganized, 3 ignored). C has photos on a public vehicle only.
INSERT INTO public.vehicles (id) VALUES ('10000000-0000-0000-0000-0000000000a1');
INSERT INTO public.vehicle_images (user_id, vehicle_id, organization_status)
SELECT 'a0000000-0000-0000-0000-00000000000a', NULL, 'unorganized' FROM generate_series(1, 1000);
INSERT INTO public.vehicle_images (user_id, vehicle_id, organization_status)
SELECT 'a0000000-0000-0000-0000-00000000000a', NULL, NULL FROM generate_series(1, 200);
INSERT INTO public.vehicle_images (user_id, vehicle_id, organization_status)
SELECT 'a0000000-0000-0000-0000-00000000000a', NULL, 'organized' FROM generate_series(1, 30);
INSERT INTO public.vehicle_images (user_id, vehicle_id, organization_status)
SELECT 'a0000000-0000-0000-0000-00000000000a', NULL, 'ignored' FROM generate_series(1, 25);
INSERT INTO public.vehicle_images (user_id, vehicle_id, organization_status)
SELECT 'a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000a1', 'unorganized' FROM generate_series(1, 40);
INSERT INTO public.vehicle_images (user_id, vehicle_id, organization_status)
SELECT 'b0000000-0000-0000-0000-00000000000b', NULL, 'unorganized' FROM generate_series(1, 7);
INSERT INTO public.vehicle_images (user_id, vehicle_id, organization_status)
SELECT 'b0000000-0000-0000-0000-00000000000b', NULL, 'ignored' FROM generate_series(1, 3);
INSERT INTO public.vehicle_images (user_id, vehicle_id, organization_status)
SELECT 'c0000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-0000000000a1', 'unorganized' FROM generate_series(1, 5);
-- A photo B took of A's: documented_by marks B, but it is A's row (user_id A); B's policy admits it, the function counts user_id only.
INSERT INTO public.vehicle_images (user_id, documented_by_user_id, vehicle_id, organization_status)
VALUES ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b', NULL, 'unorganized');
ANALYZE public.vehicle_images;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated, service_role;

-- 1. Before: the old read is an exact count of every row (what the badge computed and never showed).
SET ROLE authenticated; SET test.auth_uid = 'a0000000-0000-0000-0000-00000000000a'; SET test.auth_role = 'authenticated';
SELECT count(id) AS old_exact FROM public.vehicle_images
  WHERE user_id = 'a0000000-0000-0000-0000-00000000000a' AND vehicle_id IS NULL
    AND (organization_status = 'unorganized' OR organization_status IS NULL) \gset
RESET ROLE;
SELECT public.t_assert(:old_exact = 1201, format('before: the exact count is 1,201; got %s', :old_exact));

-- 2. The migration.
\ir ../migrations/20261014040300_my_unorganized_photo_count.sql

-- 3. A is capped at 1,000; B is exact; C has none; an anonymous caller cannot execute it.
SET ROLE authenticated; SET test.auth_uid = 'a0000000-0000-0000-0000-00000000000a'; SET test.auth_role = 'authenticated';
SELECT public.my_unorganized_photo_count() AS a_count \gset
SET test.auth_uid = 'b0000000-0000-0000-0000-00000000000b';
SELECT public.my_unorganized_photo_count() AS b_count \gset
SET test.auth_uid = 'c0000000-0000-0000-0000-00000000000c';
SELECT public.my_unorganized_photo_count() AS c_count \gset
SET test.auth_uid = '';
SELECT public.my_unorganized_photo_count() AS nobody_count \gset
RESET ROLE;
SELECT public.t_assert(:a_count = 1000, format('after: A has 1,201 and the count stops at 1,000; got %s', :a_count));
SELECT public.t_assert(:b_count = 7, format('after: B has 7 unorganized (3 ignored not counted); got %s', :b_count));
SELECT public.t_assert(:c_count = 0, format('after: C has photos only on a vehicle; got %s', :c_count));
SELECT public.t_assert(:nobody_count = 0, format('after: no signed-in user counts nothing; got %s', :nobody_count));
SELECT public.t_assert(NOT has_function_privilege('anon', 'public.my_unorganized_photo_count()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.my_unorganized_photo_count()', 'EXECUTE'), 'anon cannot execute it, authenticated can');
SELECT public.t_assert((SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.my_unorganized_photo_count()'::regprocedure),
  'it is SECURITY INVOKER and stable');

-- 4. Below the cap it equals the exact count: remove A's surplus to 600 and compare to the old read.
DELETE FROM public.vehicle_images WHERE id IN (
  SELECT id FROM public.vehicle_images WHERE user_id = 'a0000000-0000-0000-0000-00000000000a' AND vehicle_id IS NULL
    AND (organization_status = 'unorganized' OR organization_status IS NULL) ORDER BY id LIMIT 601);
SET ROLE authenticated; SET test.auth_uid = 'a0000000-0000-0000-0000-00000000000a'; SET test.auth_role = 'authenticated';
SELECT public.my_unorganized_photo_count() AS a_600 \gset
SELECT count(id) AS a_600_exact FROM public.vehicle_images
  WHERE user_id = 'a0000000-0000-0000-0000-00000000000a' AND vehicle_id IS NULL
    AND (organization_status = 'unorganized' OR organization_status IS NULL) \gset
RESET ROLE;
SELECT public.t_assert(:a_600 = 600 AND :a_600 = :a_600_exact, format('below the cap the count is the exact count; got %s and %s', :a_600, :a_600_exact));

-- 5. The plan: the user's index, with the limit inside the aggregate (not after counting every row).
SELECT 1500 AS regrow \gset
INSERT INTO public.vehicle_images (user_id, vehicle_id, organization_status)
SELECT 'a0000000-0000-0000-0000-00000000000a', NULL, 'unorganized' FROM generate_series(1, :regrow);
ANALYZE public.vehicle_images;
DO $$
DECLARE p jsonb; scanned bigint;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.auth_uid', 'a0000000-0000-0000-0000-00000000000a', true);
  PERFORM set_config('test.auth_role', 'authenticated', true);
  EXECUTE $q$EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF, COSTS OFF)
    SELECT count(*) FROM (SELECT 1 FROM public.vehicle_images vi WHERE vi.user_id = (SELECT auth.uid()) AND vi.vehicle_id IS NULL
      AND (vi.organization_status = 'unorganized' OR vi.organization_status IS NULL) LIMIT 1000) capped$q$ INTO p;
  RESET ROLE;
  SELECT max((n #>> '{Actual Rows}')::bigint) INTO scanned FROM jsonb_path_query(p, 'strict $.**') n
   WHERE jsonb_typeof(n) = 'object' AND n ->> 'Node Type' LIKE '%Scan%';
  PERFORM public.t_assert(scanned <= 1100, format('the scan stops near the cap; it produced %s rows', scanned));
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_path_query(p, 'strict $.**') n WHERE jsonb_typeof(n) = 'object'
      AND n ->> 'Index Name' = 'idx_vehicle_images_unorganized'), 'it reads the per-user partial index');
END $$;

-- 6. A second run of the migration changes nothing.
\ir ../migrations/20261014040300_my_unorganized_photo_count.sql
SELECT 'my_unorganized_photo_count contract: PASS' AS result;
