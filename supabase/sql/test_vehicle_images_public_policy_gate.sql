-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_image_gate -f this-file.sql
-- Proves the vision-gate hole in the public read policy and its fix. With the five read policies production has
-- on vehicle_images (2026-10-14), a stranger reads every frame of a public vehicle that is neither sensitive nor
-- superseded, including frames the gate rejected as personal or misattributed and frames it holds for review.
-- After the migration the stranger reads only null, approved and pending frames, while the owner still reads every
-- frame of their vehicle. A second run is a no-op, and a drifted policy stops the migration unchanged.
-- vehicles carries no row security here; on production its own policies only narrow the subquery further.
-- The rows below are a disposable test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;

-- The shapes the policies touch.
CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, user_id uuid, uploaded_by uuid, owner_id uuid);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid, user_id uuid, documented_by_user_id uuid,
  image_url text, is_sensitive boolean, is_superseded boolean, vision_gate_status public.vision_gate_status);
CREATE TABLE public.organization_vehicles (organization_id uuid, vehicle_id uuid);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, status text);

-- The five read policies as production has them on 2026-10-14 (pg_policies), all permissive and for public.
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Organization members can view org vehicle images" ON public.vehicle_images FOR SELECT
  USING (EXISTS (SELECT 1 FROM organization_vehicles ov JOIN organization_contributors oc ON ov.organization_id = oc.organization_id
                 WHERE ov.vehicle_id = vehicle_images.vehicle_id AND oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'));
CREATE POLICY "Users can view images for public vehicles" ON public.vehicle_images FOR SELECT
  USING ((COALESCE(is_sensitive, false) = false) AND (COALESCE(is_superseded, false) = false)
         AND (EXISTS (SELECT 1 FROM vehicles WHERE vehicles.id = vehicle_images.vehicle_id AND vehicles.is_public = true)));
CREATE POLICY "Users can view images for vehicles they own" ON public.vehicle_images FOR SELECT
  USING (EXISTS (SELECT 1 FROM vehicles WHERE vehicles.id = vehicle_images.vehicle_id
                 AND (vehicles.user_id = auth.uid() OR vehicles.uploaded_by = auth.uid() OR vehicles.owner_id = auth.uid())));
CREATE POLICY "Users can view their own images" ON public.vehicle_images FOR SELECT
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY users_can_view_own_unorganized_images ON public.vehicle_images FOR SELECT
  USING (vehicle_id IS NULL AND (user_id = auth.uid() OR documented_by_user_id = auth.uid()));
GRANT SELECT ON public.vehicle_images, public.vehicles, public.organization_vehicles, public.organization_contributors TO anon, authenticated;

-- O owns the public vehicle P and the private vehicle Q. S is a signed-in stranger.
--   P: one frame per gate status (null, pending, approved, review_needed, rejected_personal, rejected_misattributed),
--      a rejected_personal frame someone else uploaded, and a sensitive and a superseded approved frame.
--   Q: one approved frame.
INSERT INTO public.vehicles (id, is_public, user_id, uploaded_by, owner_id) VALUES
 ('40000000-0000-0000-0000-000000000001', true,  '30000000-0000-0000-0000-00000000000a', NULL, NULL),
 ('40000000-0000-0000-0000-000000000002', false, '30000000-0000-0000-0000-00000000000a', NULL, NULL);
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, is_sensitive, is_superseded, vision_gate_status) VALUES
 ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/null.jpg',     NULL,  NULL,  NULL),
 ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/pending.jpg',  NULL,  NULL,  'pending'),
 ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/approved.jpg', false, false, 'approved'),
 ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/review.jpg',   NULL,  NULL,  'review_needed'),
 ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/personal.jpg', NULL,  NULL,  'rejected_personal'),
 ('50000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/other-car.jpg', NULL, NULL,  'rejected_misattributed'),
 ('50000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000001', NULL,                                   'https://x/personal-2.jpg', NULL, NULL, 'rejected_personal'),
 ('50000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/sensitive.jpg', true,  NULL,  'approved'),
 ('50000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/old.jpg',      NULL,  true,  'approved'),
 ('50000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-00000000000a', 'https://x/private.jpg',  NULL,  NULL,  'approved');

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated;
-- The frames a role sees, as a sorted list of file names.
CREATE FUNCTION public.t_seen() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(regexp_replace(image_url, '^https://x/', ''), ',' ORDER BY image_url), '') FROM public.vehicle_images $$;
GRANT EXECUTE ON FUNCTION public.t_seen() TO anon, authenticated;

-- 1. Before the fix: a stranger reads the rejected and held frames.
SET ROLE anon;
SET test.auth_uid = '';
SELECT public.t_assert(public.t_seen() = 'approved.jpg,null.jpg,other-car.jpg,pending.jpg,personal-2.jpg,personal.jpg,review.jpg',
  format('before the fix anon reads gated frames; got %s', public.t_seen()));
RESET ROLE;

-- 2. The fix.
\ir ../migrations/20261014021500_vehicle_images_public_policy_gate.sql

-- 3. After the fix: anon and a signed-in stranger read null, pending and approved frames only.
SET ROLE anon;
SET test.auth_uid = '';
SELECT public.t_assert(public.t_seen() = 'approved.jpg,null.jpg,pending.jpg',
  format('after the fix anon reads only null, pending and approved frames; got %s', public.t_seen()));
RESET ROLE;
SET ROLE authenticated;
SET test.auth_uid = '30000000-0000-0000-0000-00000000000b';
SELECT public.t_assert(public.t_seen() = 'approved.jpg,null.jpg,pending.jpg',
  format('a signed-in stranger reads the same; got %s', public.t_seen()));
-- 4. The owner still reads every frame of both vehicles, the one someone else uploaded included.
SET test.auth_uid = '30000000-0000-0000-0000-00000000000a';
SELECT public.t_assert(public.t_seen() = 'approved.jpg,null.jpg,old.jpg,other-car.jpg,pending.jpg,personal-2.jpg,personal.jpg,private.jpg,review.jpg,sensitive.jpg',
  format('the owner reads every frame; got %s', public.t_seen()));
RESET ROLE;
SET test.auth_uid = '';

-- 5. A second run is a no-op.
\ir ../migrations/20261014021500_vehicle_images_public_policy_gate.sql
SELECT public.t_assert((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.vehicle_images'::regclass) = 5, 'still five read policies');

-- 6. A drifted policy stops the migration and is left as found.
ALTER POLICY "Users can view images for public vehicles" ON public.vehicle_images
  USING ((COALESCE(is_sensitive, false) = false) AND image_url IS NOT NULL);
\echo 'Expected: one ERROR from the drift guard below.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014021500_vehicle_images_public_policy_gate.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(
  (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.vehicle_images'::regclass
     AND polname = 'Users can view images for public vehicles') NOT LIKE '%review_needed%',
  'a drifted policy is not overwritten');
SELECT 'vehicle_images public policy gate contract: PASS' AS result;
