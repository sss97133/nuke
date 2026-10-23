-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_card_images -f this-file.sql
-- Proves vehicle_card_images(uuid[]): one thumbnail per listed vehicle, the primary image the caller can see, else the
-- earliest they can see, under the same visibility the vehicle_images row policies give.
--   * for four callers (anon, an owner, an organization member, a stranger) the reader returns, for every vehicle, the image
--     the old read would have put first for that vehicle under that caller's row policies (primary first, then earliest),
--     and nothing for a vehicle the old read returns nothing for;
--   * it never returns an image a caller's policies hide: private vehicles of others, sensitive, superseded or vision-gated
--     images of public vehicles; and, from 20261021030000, never a superseded or vision-gated image to anyone, owner and
--     organization members included (the policies show them those rows; a card does not use them);
--   * a vehicle whose primary image is hidden from the caller falls back to the earliest image they can see;
--   * it reads a vehicle with thousands of images through the indexes (one primary probe, one backward probe), not by sorting them;
--   * anon, authenticated and service_role execute it, PUBLIC does not; it is SECURITY DEFINER with a pinned search_path;
--   * at most 1,000 distinct ids are read; a second run of the migration is a no-op.
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

CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, user_id uuid, uploaded_by uuid, owner_id uuid, is_public boolean NOT NULL DEFAULT true);
CREATE TABLE public.organization_vehicles (organization_id uuid, vehicle_id uuid);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, status text);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, thumbnail_url text, medium_url text,
  image_url text NOT NULL, variants jsonb DEFAULT '{}', is_primary boolean DEFAULT false, is_sensitive boolean NOT NULL DEFAULT false,
  is_superseded boolean DEFAULT false, vision_gate_status public.vision_gate_status DEFAULT 'pending', created_at timestamptz DEFAULT now());
-- The live indexes the reader relies on.
CREATE INDEX vehicle_images_vehicle_id_idx ON public.vehicle_images (vehicle_id);
CREATE INDEX idx_vehicle_images_created_at ON public.vehicle_images (vehicle_id, created_at DESC);
CREATE INDEX idx_vehicle_images_vehicle_primary ON public.vehicle_images (vehicle_id, is_primary, created_at) WHERE is_primary = true;

-- The live SELECT policies (2026-10-14, after #1107) that apply to a row with a vehicle.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING (is_public = true OR auth.role() = 'service_role');
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT
  USING (is_public = false AND (SELECT auth.uid()) IS NOT NULL AND (
    (SELECT auth.uid()) = user_id OR (SELECT auth.uid()) = owner_id OR (SELECT auth.uid()) = uploaded_by));
ALTER TABLE public.organization_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_vehicles_select ON public.organization_vehicles FOR SELECT USING (true);
ALTER TABLE public.organization_contributors ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_contributors_select ON public.organization_contributors FOR SELECT USING (true);
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own images" ON public.vehicle_images FOR SELECT USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can view images for vehicles they own" ON public.vehicle_images FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.vehicles WHERE vehicles.id = vehicle_images.vehicle_id
                 AND (vehicles.user_id = auth.uid() OR vehicles.uploaded_by = auth.uid() OR vehicles.owner_id = auth.uid())));
CREATE POLICY "Organization members can view org vehicle images" ON public.vehicle_images FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.organization_vehicles ov JOIN public.organization_contributors oc ON ov.organization_id = oc.organization_id
                 WHERE ov.vehicle_id = vehicle_images.vehicle_id AND oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'));
CREATE POLICY "Users can view images for public vehicles" ON public.vehicle_images FOR SELECT
  USING (coalesce(is_sensitive, false) = false AND coalesce(is_superseded, false) = false
         AND (vision_gate_status IS NULL OR vision_gate_status <> ALL (ARRAY['rejected_personal', 'rejected_misattributed', 'review_needed']::public.vision_gate_status[]))
         AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_images.vehicle_id AND v.is_public = true));
GRANT SELECT ON public.vehicles, public.vehicle_images, public.organization_vehicles, public.organization_contributors TO anon, authenticated, service_role;

CREATE FUNCTION public.t_vid(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('80000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION public.t_uid(p_c text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT (p_c || '0000000-0000-0000-0000-00000000000' || p_c)::uuid $$;
CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_vid(integer), public.t_uid(text), public.t_assert(boolean, text) TO anon, authenticated, service_role;
-- Users: a = owner of V3, b = contributor of the organization that holds V4, c = a stranger who took one photo of V8.
-- Vehicles:  1 public, primary + 5 others        2 public, no primary, 3 images (earliest wins)
--            3 private, owned by a               4 private, in organization o1 (b is an active contributor)
--            5 public, primary held by the vision gate (review_needed), 2 clean others
--            6 public, primary sensitive, 1 clean other        7 public, primary superseded, 1 clean other
--            8 private, someone else's, one image uploaded by c        9 public, no images
--            10 public with 3,000 images (primary among them)    11 public, only gated images
INSERT INTO public.vehicles (id, user_id, is_public) VALUES
  (public.t_vid(1), NULL, true), (public.t_vid(2), NULL, true), (public.t_vid(5), NULL, true), (public.t_vid(6), NULL, true),
  (public.t_vid(7), NULL, true), (public.t_vid(9), NULL, true), (public.t_vid(10), NULL, true), (public.t_vid(11), NULL, true);
INSERT INTO public.vehicles (id, user_id, is_public) VALUES (public.t_vid(3), public.t_uid('a'), false), (public.t_vid(4), NULL, false), (public.t_vid(8), NULL, false);
INSERT INTO public.organization_vehicles VALUES ('c0000000-0000-0000-0000-0000000000c1', public.t_vid(4));
INSERT INTO public.organization_contributors VALUES ('c0000000-0000-0000-0000-0000000000c1', public.t_uid('b'), 'active'),
  ('c0000000-0000-0000-0000-0000000000c1', public.t_uid('c'), 'inactive');

CREATE FUNCTION public.t_img(p_vehicle integer, p_name text, p_primary boolean, p_age_minutes integer,
  p_sensitive boolean DEFAULT false, p_superseded boolean DEFAULT false, p_gate public.vision_gate_status DEFAULT 'approved', p_user uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images (vehicle_id, user_id, thumbnail_url, medium_url, image_url, variants, is_primary, is_sensitive, is_superseded, vision_gate_status, created_at)
  VALUES (public.t_vid(p_vehicle), p_user, 't-' || p_name, 'm-' || p_name, 'f-' || p_name, jsonb_build_object('thumbnail', 'v-' || p_name),
          p_primary, p_sensitive, p_superseded, p_gate, now() - make_interval(mins => p_age_minutes)) $$;
SELECT public.t_img(1, '1p', true, 10), public.t_img(1, '1a', false, 100), public.t_img(1, '1b', false, 90), public.t_img(1, '1c', false, 80), public.t_img(1, '1d', false, 70), public.t_img(1, '1e', false, 60);
SELECT public.t_img(2, '2a', false, 30), public.t_img(2, '2b', false, 50), public.t_img(2, '2c', false, 20);
SELECT public.t_img(3, '3p', true, 10), public.t_img(3, '3a', false, 20);
SELECT public.t_img(4, '4p', true, 10), public.t_img(4, '4a', false, 20);
SELECT public.t_img(5, '5p', true, 10, p_gate => 'review_needed'), public.t_img(5, '5a', false, 30), public.t_img(5, '5b', false, 20);
SELECT public.t_img(6, '6p', true, 10, p_sensitive => true), public.t_img(6, '6a', false, 20);
SELECT public.t_img(7, '7p', true, 10, p_superseded => true), public.t_img(7, '7a', false, 20);
SELECT public.t_img(8, '8a', false, 20, p_user => public.t_uid('c')), public.t_img(8, '8b', false, 10);
SELECT public.t_img(11, '11a', true, 10, p_gate => 'rejected_personal'), public.t_img(11, '11b', false, 20, p_gate => 'rejected_misattributed');
INSERT INTO public.vehicle_images (vehicle_id, thumbnail_url, medium_url, image_url, is_primary, created_at)
SELECT public.t_vid(10), 't-10-' || g, 'm-10-' || g, 'f-10-' || g, g = 2500, now() - make_interval(mins => 100000 - g) FROM generate_series(1, 3000) g;
ANALYZE public.vehicle_images;
ANALYZE public.vehicles;

-- 1. The old read, as each caller: the first image per vehicle under that caller's row policies.
CREATE FUNCTION public.t_old_first(p_ids uuid[]) RETURNS TABLE (vehicle_id uuid, image_url text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (i.vehicle_id) i.vehicle_id, i.image_url
  FROM public.vehicle_images i WHERE i.vehicle_id = ANY (p_ids)
  ORDER BY i.vehicle_id, i.is_primary DESC, i.created_at ASC $$;
GRANT EXECUTE ON FUNCTION public.t_old_first(uuid[]) TO anon, authenticated;
CREATE TEMP TABLE old_reads (who text, vehicle_id uuid, image_url text);
GRANT ALL ON old_reads TO anon, authenticated;
SET ROLE anon; SET test.auth_uid = ''; SET test.auth_role = 'anon';
INSERT INTO old_reads SELECT 'anon', * FROM public.t_old_first(ARRAY(SELECT public.t_vid(g) FROM generate_series(1, 12) g));
RESET ROLE;
SET ROLE authenticated; SET test.auth_role = 'authenticated';
SET test.auth_uid = 'a0000000-0000-0000-0000-00000000000a';
INSERT INTO old_reads SELECT 'a', * FROM public.t_old_first(ARRAY(SELECT public.t_vid(g) FROM generate_series(1, 12) g));
SET test.auth_uid = 'b0000000-0000-0000-0000-00000000000b';
INSERT INTO old_reads SELECT 'b', * FROM public.t_old_first(ARRAY(SELECT public.t_vid(g) FROM generate_series(1, 12) g));
SET test.auth_uid = 'c0000000-0000-0000-0000-00000000000c';
INSERT INTO old_reads SELECT 'c', * FROM public.t_old_first(ARRAY(SELECT public.t_vid(g) FROM generate_series(1, 12) g));
RESET ROLE;
-- The old read in the fixture, spot-checked so the comparison below is not vacuous.
SELECT public.t_assert((SELECT image_url FROM old_reads WHERE who = 'anon' AND vehicle_id = public.t_vid(1)) = 'f-1p'
  AND NOT EXISTS (SELECT FROM old_reads WHERE who = 'anon' AND vehicle_id IN (public.t_vid(3), public.t_vid(4), public.t_vid(8)))
  AND (SELECT image_url FROM old_reads WHERE who = 'anon' AND vehicle_id = public.t_vid(5)) = 'f-5a'
  AND (SELECT count(*) FROM old_reads WHERE who = 'anon') = 6, 'the fixture: what anon sees under the row policies');

-- 2. The migration.
\ir ../migrations/20261014040500_vehicle_card_images.sql
\ir ../migrations/20261021030500_vehicle_card_images_gate_for_everyone.sql

CREATE TEMP TABLE new_reads (who text, vehicle_id uuid, image_url text, thumbnail_url text, medium_url text, variants jsonb, is_primary boolean);
GRANT ALL ON new_reads TO anon, authenticated;
SET ROLE anon; SET test.auth_uid = ''; SET test.auth_role = 'anon';
INSERT INTO new_reads SELECT 'anon', vehicle_id, image_url, thumbnail_url, medium_url, variants, is_primary
  FROM public.vehicle_card_images(ARRAY(SELECT public.t_vid(g) FROM generate_series(1, 12) g));
RESET ROLE;
SET ROLE authenticated; SET test.auth_role = 'authenticated';
SET test.auth_uid = 'a0000000-0000-0000-0000-00000000000a';
INSERT INTO new_reads SELECT 'a', vehicle_id, image_url, thumbnail_url, medium_url, variants, is_primary
  FROM public.vehicle_card_images(ARRAY(SELECT public.t_vid(g) FROM generate_series(1, 12) g));
SET test.auth_uid = 'b0000000-0000-0000-0000-00000000000b';
INSERT INTO new_reads SELECT 'b', vehicle_id, image_url, thumbnail_url, medium_url, variants, is_primary
  FROM public.vehicle_card_images(ARRAY(SELECT public.t_vid(g) FROM generate_series(1, 12) g));
SET test.auth_uid = 'c0000000-0000-0000-0000-00000000000c';
INSERT INTO new_reads SELECT 'c', vehicle_id, image_url, thumbnail_url, medium_url, variants, is_primary
  FROM public.vehicle_card_images(ARRAY(SELECT public.t_vid(g) FROM generate_series(1, 12) g));
RESET ROLE;

-- 3. Same image per vehicle as the old read, for every caller, in both directions.
SELECT public.t_assert(NOT EXISTS (
    SELECT 1 FROM old_reads o FULL JOIN new_reads n ON n.who = o.who AND n.vehicle_id = o.vehicle_id
    WHERE o.image_url IS DISTINCT FROM n.image_url), 'for anon, owner, member and stranger: the same image per vehicle as the old read, none extra, none missing');
SELECT public.t_assert((SELECT count(*) FROM new_reads WHERE who = 'a') = 7 AND (SELECT count(*) FROM new_reads WHERE who = 'b') = 7
  AND (SELECT count(*) FROM new_reads WHERE who = 'c') = 7 AND (SELECT count(*) FROM new_reads WHERE who = 'anon') = 6, 'the counts per caller: anon 6 public vehicles, plus one private vehicle each for owner, member and stranger');

-- 3b. Owners and contributors: the row policies show them a gated photo of their own vehicle, a card never does.
--     13 private, owned by a: primary held (review_needed), a superseded newer one, one clean approved    14 private, in organization o1 (member b):
--     primary rejected_misattributed + one clean   15 private, owned by a: only gated photos (rejected_personal, review_needed)
INSERT INTO public.vehicles (id, user_id, is_public) VALUES (public.t_vid(13), public.t_uid('a'), false), (public.t_vid(14), NULL, false), (public.t_vid(15), public.t_uid('a'), false);
INSERT INTO public.organization_vehicles VALUES ('c0000000-0000-0000-0000-0000000000c1', public.t_vid(14));
SELECT public.t_img(13, '13p', true, 10, p_gate => 'review_needed'), public.t_img(13, '13s', false, 50, p_superseded => true), public.t_img(13, '13a', false, 30);
SELECT public.t_img(14, '14p', true, 10, p_gate => 'rejected_misattributed'), public.t_img(14, '14a', false, 20);
SELECT public.t_img(15, '15a', true, 10, p_gate => 'rejected_personal'), public.t_img(15, '15b', false, 20, p_gate => 'review_needed');
CREATE TEMP TABLE own_reads (who text, vehicle_id uuid, image_url text, policy_first text);
GRANT ALL ON own_reads TO authenticated;
SET ROLE authenticated; SET test.auth_role = 'authenticated';
SET test.auth_uid = 'a0000000-0000-0000-0000-00000000000a';
INSERT INTO own_reads SELECT 'a', c.vehicle_id, c.image_url, (SELECT o.image_url FROM public.t_old_first(ARRAY[c.vehicle_id]) o) FROM public.vehicle_card_images(ARRAY[public.t_vid(13), public.t_vid(15)]) c;
SET test.auth_uid = 'b0000000-0000-0000-0000-00000000000b';
INSERT INTO own_reads SELECT 'b', c.vehicle_id, c.image_url, (SELECT o.image_url FROM public.t_old_first(ARRAY[c.vehicle_id]) o) FROM public.vehicle_card_images(ARRAY[public.t_vid(14), public.t_vid(15)]) c;
RESET ROLE;
SELECT public.t_assert((SELECT image_url FROM own_reads WHERE who = 'a' AND vehicle_id = public.t_vid(13)) = 'f-13a'
  AND (SELECT policy_first FROM own_reads WHERE who = 'a' AND vehicle_id = public.t_vid(13)) = 'f-13p',
  'owner: the card skips the held primary and the superseded photo (the row policies would have returned the held primary)');
SELECT public.t_assert((SELECT image_url FROM own_reads WHERE who = 'b' AND vehicle_id = public.t_vid(14)) = 'f-14a'
  AND (SELECT policy_first FROM own_reads WHERE who = 'b' AND vehicle_id = public.t_vid(14)) = 'f-14p',
  'organization member: the card skips the rejected primary of the organization''s vehicle');
SELECT public.t_assert(NOT EXISTS (SELECT FROM own_reads WHERE vehicle_id = public.t_vid(15)),
  'a vehicle whose only photos are gated has no card photo, for its owner too, and nobody else sees the private vehicle');

-- 4. What each caller must and must not get.
SELECT public.t_assert((SELECT image_url FROM new_reads WHERE who = 'anon' AND vehicle_id = public.t_vid(1)) = 'f-1p'
  AND (SELECT image_url FROM new_reads WHERE who = 'anon' AND vehicle_id = public.t_vid(2)) = 'f-2b'
  AND (SELECT image_url FROM new_reads WHERE who = 'anon' AND vehicle_id = public.t_vid(5)) = 'f-5a'
  AND (SELECT image_url FROM new_reads WHERE who = 'anon' AND vehicle_id = public.t_vid(6)) = 'f-6a'
  AND (SELECT image_url FROM new_reads WHERE who = 'anon' AND vehicle_id = public.t_vid(7)) = 'f-7a'
  AND (SELECT image_url FROM new_reads WHERE who = 'anon' AND vehicle_id = public.t_vid(10)) = 'f-10-2500',
  'anon: the primary, else the earliest visible (gated, sensitive and superseded primaries skipped)');
SELECT public.t_assert(NOT EXISTS (SELECT FROM new_reads WHERE who = 'anon' AND vehicle_id IN (public.t_vid(3), public.t_vid(4), public.t_vid(8), public.t_vid(9), public.t_vid(11))),
  'anon: no private vehicle, no vehicle without images, no vehicle with only gated images');
SELECT public.t_assert((SELECT image_url FROM new_reads WHERE who = 'a' AND vehicle_id = public.t_vid(3)) = 'f-3p'
  AND NOT EXISTS (SELECT FROM new_reads WHERE who IN ('b', 'c') AND vehicle_id = public.t_vid(3)), 'the owner sees their private vehicle, nobody else does');
SELECT public.t_assert((SELECT image_url FROM new_reads WHERE who = 'b' AND vehicle_id = public.t_vid(4)) = 'f-4p'
  AND NOT EXISTS (SELECT FROM new_reads WHERE who IN ('a', 'c', 'anon') AND vehicle_id = public.t_vid(4)), 'the active organization member sees the organization''s private vehicle, an inactive one does not');
SELECT public.t_assert((SELECT image_url FROM new_reads WHERE who = 'c' AND vehicle_id = public.t_vid(8)) = 'f-8a'
  AND NOT EXISTS (SELECT FROM new_reads WHERE who IN ('a', 'b', 'anon') AND vehicle_id = public.t_vid(8)), 'a caller sees the image they uploaded to a private vehicle, and only that one');

-- 5. Shape, grants, definer, search_path.
SELECT public.t_assert((SELECT thumbnail_url = 't-1p' AND medium_url = 'm-1p' AND variants = '{"thumbnail": "v-1p"}' AND is_primary FROM new_reads WHERE who = 'anon' AND vehicle_id = public.t_vid(1)),
  'the row carries thumbnail_url, medium_url, image_url, variants and is_primary');
SELECT public.t_assert(has_function_privilege('anon', 'public.vehicle_card_images(uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.vehicle_card_images(uuid[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.vehicle_card_images(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.vehicle_card_images(uuid[])', 'EXECUTE'), 'anon, authenticated and service_role execute it, PUBLIC does not');
SELECT public.t_assert((SELECT prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public'] FROM pg_proc WHERE oid = 'public.vehicle_card_images(uuid[])'::regprocedure),
  'SECURITY DEFINER, stable, search_path pinned');
SELECT public.t_assert((SELECT count(*) FROM public.vehicle_card_images(NULL)) = 0 AND (SELECT count(*) FROM public.vehicle_card_images('{}')) = 0
  AND (SELECT count(*) FROM public.vehicle_card_images(ARRAY[NULL, public.t_vid(1), public.t_vid(1)]::uuid[])) = 1, 'null, empty and duplicate ids are harmless');

-- 6. A vehicle with 3,000 images is read through the indexes, not by sorting them: the lateral probes return one row each.
CREATE FUNCTION public.t_probe_rows() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE plan jsonb; n bigint;
BEGIN
  EXECUTE $q$EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF, COSTS OFF)
    SELECT best.* FROM (SELECT public.t_vid(10) AS id, true AS is_public, false AS mine, NULL::uuid AS uid) veh
    CROSS JOIN LATERAL (
      (SELECT i.vehicle_id, i.image_url FROM public.vehicle_images i WHERE i.vehicle_id = veh.id AND i.is_primary
         AND (veh.mine OR i.user_id = veh.uid OR (veh.is_public AND NOT i.is_sensitive AND i.is_superseded IS NOT TRUE)) ORDER BY i.created_at ASC LIMIT 1)
      UNION ALL
      (SELECT i.vehicle_id, i.image_url FROM public.vehicle_images i WHERE i.vehicle_id = veh.id
         AND (veh.mine OR i.user_id = veh.uid OR (veh.is_public AND NOT i.is_sensitive AND i.is_superseded IS NOT TRUE)) ORDER BY i.created_at ASC LIMIT 1)
      LIMIT 1) best$q$ INTO plan;
  SELECT coalesce(sum((x #>> '{Actual Rows}')::bigint * coalesce((x #>> '{Actual Loops}')::bigint, 1)), 0) INTO n
  FROM jsonb_path_query(plan, 'strict $.**') x WHERE jsonb_typeof(x) = 'object' AND x ->> 'Relation Name' = 'vehicle_images';
  RETURN n;
END $$;
SELECT public.t_assert(public.t_probe_rows() <= 2, format('the 3,000-image vehicle costs at most two image rows read; got %s', public.t_probe_rows()));

-- 7. At most 1,000 distinct ids are read.
INSERT INTO public.vehicles (id, is_public) SELECT public.t_vid(2000 + g), true FROM generate_series(1, 1200) g;
INSERT INTO public.vehicle_images (vehicle_id, image_url, is_primary) SELECT public.t_vid(2000 + g), 'f-bulk-' || g, true FROM generate_series(1, 1200) g;
SELECT public.t_assert((SELECT count(*) FROM public.vehicle_card_images(ARRAY(SELECT public.t_vid(2000 + g) FROM generate_series(1, 1200) g))) = 1000,
  'at most 1,000 distinct ids are read');

-- 8. A second run of the migrations is a no-op.
\ir ../migrations/20261014040500_vehicle_card_images.sql
\ir ../migrations/20261021030500_vehicle_card_images_gate_for_everyone.sql
SELECT 'vehicle_card_images contract: PASS' AS result;
