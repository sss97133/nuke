-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_plates_<n> -f supabase/sql/test_gallery_plate_privacy_rule.sql
-- Proves 20261125135000_gallery_plate_privacy_rule.sql: a custody photo with a keyed license_plate reading (>= 4 letters
-- or digits) leaves the gallery for anon and for a signed-in user who is neither its uploader nor tied to its vehicle;
-- a listing-sourced photo with a plate reading stays; the uploader and a vehicle_viewer_tied viewer keep it; a 3-character
-- reading changes nothing; a session with no viewer (cron, job triggers) keeps every photo while PostgREST's authenticator
-- without claims does not; disabling the rule row restores eligibility; anon cannot write the rule table; both overloads
-- stay inlinable; and the revert restores both bodies byte for byte (md5 guards before and after).
-- The fixture mirrors production as read on 2026-11-24: anon column grants on vehicle_images (no exif_data), table SELECT
-- for authenticated, vehicle_images_public security_invoker without exif_data, photo_extracted_fields readable only by its
-- own user under RLS, the live SELECT policies of vehicles and vehicle_images, and the live bodies (pg_get_functiondef) of
-- both vehicle_image_gallery_eligible overloads, image_stage_custody_external, vehicle_viewer_tied and
-- vehicle_user_has_access. The BaT listing lookups are stubbed false; no seed row reaches them.
-- Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
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
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator NOINHERIT LOGIN; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Signs in as a user id ('' = anon, 'service', 'none' = no request claims), as PostgREST sets the claims.
CREATE FUNCTION public.t_claims(p_uid text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', CASE WHEN p_uid = '' THEN '{"role":"anon"}'
     WHEN p_uid = 'service' THEN '{"role":"service_role"}' WHEN p_uid = 'none' THEN ''
     ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, false) $$;

CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TYPE public.content_approval_status AS ENUM ('pending', 'approved', 'auto_approved', 'rejected');
CREATE TYPE public.content_redaction_level AS ENUM ('none', 'partial', 'full');

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean DEFAULT true, deleted_at timestamptz,
  user_id uuid, owner_id uuid, uploaded_by uuid, created_by_user_id uuid);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid, documented_by_user_id uuid,
  image_url text, source text, is_document boolean, is_duplicate boolean, is_superseded boolean, is_sensitive boolean,
  image_vehicle_match_status text, vision_gate_status public.vision_gate_status, is_external boolean, is_approved boolean,
  approval_status public.content_approval_status, verification_status text, redaction_level public.content_redaction_level,
  exif_data jsonb, latitude double precision);
CREATE TABLE public.photo_extracted_fields (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid REFERENCES public.vehicle_images(id), user_id uuid, vehicle_id uuid REFERENCES public.vehicles(id),
  field_name text NOT NULL, value text, source text NOT NULL DEFAULT 'test', UNIQUE (image_id, field_name, source));
CREATE TABLE public.admin_users (user_id uuid, is_active boolean);
CREATE TABLE public.ownership_verifications (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid, status text);
CREATE TABLE public.vehicle_user_permissions (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid, is_active boolean, role text, granted_by uuid);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid, status text, role text);
CREATE TABLE public.organization_vehicles (organization_id uuid, vehicle_id uuid REFERENCES public.vehicles(id), relationship_type text, status text, linked_by_user_id uuid);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, status text, role text);

CREATE VIEW public.vehicle_images_public WITH (security_invoker = true) AS
  SELECT id, vehicle_id, user_id, image_url, source, is_document, is_duplicate, is_superseded, is_sensitive,
         image_vehicle_match_status, vision_gate_status, is_external, is_approved, approval_status, verification_status,
         redaction_level
  FROM public.vehicle_images;

CREATE FUNCTION public.bat_pending_image_listing_by_id(p_image_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO '' AS $$ SELECT false $$;
CREATE FUNCTION public.bat_pending_image_has_listing(p_vehicle_id uuid, p_exif jsonb) RETURNS boolean LANGUAGE sql STABLE
  SET search_path TO '' AS $$ SELECT false $$;

-- Live bodies, 2026-11-24 (pg_get_functiondef).
CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    coalesce(($1).is_document,false)=false
    AND coalesce(($1).is_duplicate,false)=false
    AND coalesce(($1).is_superseded,false)=false
    AND nullif(btrim(($1).image_url),'') IS NOT NULL
    AND ($1).image_url NOT LIKE 'file://%'
    AND (($1).source IS NULL OR ($1).source <> 'e2e_test')
    AND coalesce(($1).image_vehicle_match_status,'') NOT IN ('mismatch','unrelated')
    AND CASE
      WHEN ($1).vision_gate_status IS NULL OR ($1).vision_gate_status::text='approved' THEN true
      WHEN ($1).vision_gate_status::text='pending' THEN
        coalesce(($1).is_sensitive,false)=false
        AND (
          (
            coalesce(($1).source='bat_import',false)
            AND ($1).is_external IS TRUE
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
            AND public.bat_pending_image_has_listing(($1).vehicle_id, ($1).exif_data)
          )
          OR (
            -- listing capture: a photo taken from a public web listing by an extractor, never an upload
            coalesce(($1).source='bat_import',false)=false
            AND ($1).is_external IS TRUE
            AND ($1).user_id IS NULL
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text,'') <> 'rejected'
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://'
          )
        )
      ELSE false
    END;
$function$
;

CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images_public)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    coalesce(($1).is_document,false)=false
    AND coalesce(($1).is_duplicate,false)=false
    AND coalesce(($1).is_superseded,false)=false
    AND nullif(btrim(($1).image_url),'') IS NOT NULL
    AND ($1).image_url NOT LIKE 'file://%'
    AND (($1).source IS NULL OR ($1).source <> 'e2e_test')
    AND coalesce(($1).image_vehicle_match_status,'') NOT IN ('mismatch','unrelated')
    AND CASE
      WHEN ($1).vision_gate_status IS NULL OR ($1).vision_gate_status::text='approved' THEN true
      WHEN ($1).vision_gate_status::text='pending' THEN
        coalesce(($1).is_sensitive,false)=false
        AND (
          (
            coalesce(($1).source='bat_import',false)
            AND ($1).is_external IS TRUE
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
            AND public.bat_pending_image_listing_by_id(($1).id)
          )
          OR (
            -- listing capture: a photo taken from a public web listing by an extractor, never an upload
            coalesce(($1).source='bat_import',false)=false
            AND ($1).is_external IS TRUE
            AND ($1).user_id IS NULL
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text,'') <> 'rejected'
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://'
          )
        )
      ELSE false
    END;
$function$
;

CREATE OR REPLACE FUNCTION public.image_stage_custody_external(p_is_external boolean, p_user_id uuid, p_source text, p_exif jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select case
    when p_is_external is not true then false
    -- the owner's own cached Photos preview (20261115182056): is_external records that the original is not held, not
    -- that the photo is someone else's
    when p_user_id is not null and p_source = 'iphoto'
         and p_exif -> 'source_rendition' ->> 'contract' = 'photos_cached_preview_v1' then false
    else true
  end $function$
;

CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_user_id IS NOT NULL AND p_vehicle_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vehicles v
      WHERE v.id = p_vehicle_id AND p_user_id IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = p_user_id AND au.is_active)
    OR EXISTS (SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = p_vehicle_id AND ov.user_id = p_user_id AND ov.status = 'approved')
    OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup JOIN public.vehicles v ON v.id = vup.vehicle_id
      WHERE vup.vehicle_id = p_vehicle_id AND vup.user_id = p_user_id AND coalesce(vup.is_active, true)
        AND vup.role = ANY (ARRAY['owner', 'co_owner', 'mechanic', 'appraiser', 'moderator', 'contributor', 'photographer',
          'dealer_rep', 'sales_agent', 'restorer', 'consigner', 'board_member'])
        AND vup.granted_by <> vup.user_id AND vup.granted_by IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc
      WHERE vc.vehicle_id = p_vehicle_id AND vc.user_id = p_user_id AND coalesce(vc.status, 'active') = 'active'
        AND vc.role = ANY (ARRAY['owner', 'co_owner', 'restorer', 'moderator', 'consigner', 'mechanic', 'appraiser',
          'photographer', 'sales_agent']))
    OR EXISTS (SELECT 1 FROM public.organization_vehicles ov JOIN public.vehicles v ON v.id = ov.vehicle_id
      JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
      WHERE ov.vehicle_id = p_vehicle_id AND ov.relationship_type IN ('owner', 'consigner') AND ov.status = 'active'
        AND (ov.linked_by_user_id IS NULL OR ov.linked_by_user_id IN (v.user_id, v.owner_id))
        AND oc.user_id = p_user_id AND oc.status = 'active'
        AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee')))
$function$
;

CREATE OR REPLACE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
           WHEN (SELECT auth.role()) = 'service_role' THEN true
           WHEN (SELECT auth.uid()) IS NULL THEN false
           ELSE coalesce((SELECT (SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by)
                            FROM public.vehicles v WHERE v.id = p_vehicle_id), false)
                OR coalesce(public.vehicle_user_has_access(p_vehicle_id, (SELECT auth.uid())), false)
         END
$function$
;


DO $$ BEGIN
  IF (md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images)'::regprocedure)),
      md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images_public)'::regprocedure)),
      md5(pg_get_functiondef('public.image_stage_custody_external(boolean,uuid,text,jsonb)'::regprocedure)),
      md5(pg_get_functiondef('public.vehicle_viewer_tied(uuid)'::regprocedure)))
     IS DISTINCT FROM ('4761d9c78c54d78f09dc3235f691124c'::text, 'b41688a52b368750a330ba8980737e4a'::text,
      '7e85a71398da678a2d28ae90de3d4144'::text, 'dc1f087594754e863b22248d9dd85f72'::text) THEN
    RAISE EXCEPTION 'FAIL: fixture bodies do not hash to production''s 2026-11-24 text';
  END IF;
  RAISE NOTICE 'PASS: fixture bodies hash to production''s 2026-11-24 text';
END $$;

-- Live SELECT policies, 2026-11-24.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING ((is_public = true) OR (auth.role() = 'service_role'::text));
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT USING ((is_public = false) AND ((SELECT auth.uid()) IS NOT NULL)
  AND (((SELECT auth.uid()) = user_id) OR ((SELECT auth.uid()) = owner_id) OR ((SELECT auth.uid()) = uploaded_by)
    OR vehicle_user_has_access(id, (SELECT auth.uid()))));
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view images for public vehicles" ON public.vehicle_images FOR SELECT USING ((COALESCE(is_sensitive, false) = false)
  AND (COALESCE(is_superseded, false) = false) AND ((vision_gate_status IS NULL) OR (vision_gate_status <> ALL (ARRAY['rejected_personal'::vision_gate_status,
  'rejected_misattributed'::vision_gate_status, 'review_needed'::vision_gate_status])))
  AND (EXISTS (SELECT 1 FROM vehicles v WHERE ((v.id = vehicle_images.vehicle_id) AND (v.is_public = true)))));
CREATE POLICY "Users can view their own images" ON public.vehicle_images FOR SELECT USING (((SELECT auth.uid()) = user_id));
ALTER TABLE public.photo_extracted_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY photo_extracted_fields_owner_read ON public.photo_extracted_fields FOR SELECT USING (user_id = auth.uid());

-- Live grants: column grants on vehicles; on vehicle_images for anon (no exif_data, no location); table SELECT for
-- authenticated; photo_extracted_fields table SELECT for both (RLS hides other users' rows).
GRANT SELECT (id, is_public, deleted_at, user_id, owner_id, uploaded_by, created_by_user_id) ON public.vehicles TO anon, authenticated;
GRANT SELECT (id, vehicle_id, user_id, documented_by_user_id, image_url, source, is_document, is_duplicate, is_superseded, is_sensitive,
  image_vehicle_match_status, vision_gate_status, is_external, is_approved, approval_status, verification_status, redaction_level)
  ON public.vehicle_images TO anon;
GRANT SELECT ON public.vehicle_images TO authenticated;
GRANT SELECT ON public.vehicle_images_public, public.photo_extracted_fields TO anon, authenticated;
GRANT SELECT ON public.vehicle_contributors, public.vehicle_user_permissions, public.organization_vehicles,
  public.organization_contributors TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
-- The gallery the current role and claims are served, as sorted labels, through vehicle_images_public (the anon read)
-- and through vehicle_images (the signed-in read). Each runs the overload of its row type.
CREATE FUNCTION public.t_pub() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(substring(image_url from 'x.invalid/(.*)\.jpg'), ',' ORDER BY image_url), '')
   FROM public.vehicle_images_public p WHERE p.vehicle_image_gallery_eligible IS TRUE $$;
CREATE FUNCTION public.t_tbl() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(substring(image_url from 'x.invalid/(.*)\.jpg'), ',' ORDER BY image_url), '')
   FROM public.vehicle_images t WHERE t.vehicle_image_gallery_eligible IS TRUE $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_pub(), public.t_tbl(), public.t_claims(text)
  TO anon, authenticated, service_role;

-- Users: u1 owns public car A; u2 is a stranger; u3 uploaded one photo on A and is not tied to it; u4 is A's mechanic
-- contributor (tied through vehicle_user_has_access).
INSERT INTO public.vehicles (id, is_public, user_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', true, '00000000-0000-0000-0000-000000000001');
INSERT INTO public.vehicle_contributors VALUES
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'active', 'mechanic');
-- Photos on A, all vision-gate approved (label = what it is):
--   p1_custody   u1 upload, plate reading of 7 characters               -> withheld from anon, u2, u3
--   p2_listing   listing capture (external, no user), plate reading     -> served to all
--   p3_short     u1 upload, plate reading of 3 letters or digits        -> served to all
--   p4_noplate   u1 upload, no plate reading (a paint_code reading)     -> served to all
--   p5_u3        u3 upload, plate reading                               -> withheld from anon, u2; u3 (uploader) keeps it
--   p6_cached    u1 Photos cached preview (is_external with contract photos_cached_preview_v1: custody), plate reading
--                                                                       -> withheld from anon, u2, u3 (exif read by id)
--   p7_extiphoto u1 iphoto, is_external without the contract (external), plate reading -> served to all
-- Plate values are made up.
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, is_external, vision_gate_status, exif_data) VALUES
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/p1_custody.jpg', 'user_upload', false, 'approved', NULL),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', NULL,                                   'https://x.invalid/p2_listing.jpg', 'listing_capture', true, 'approved', NULL),
  ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/p3_short.jpg', 'user_upload', false, 'approved', NULL),
  ('10000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/p4_noplate.jpg', 'user_upload', false, 'approved', NULL),
  ('10000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'https://x.invalid/p5_u3.jpg', 'user_upload', false, 'approved', NULL),
  ('10000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/p6_cached.jpg', 'iphoto', true, 'approved',
     '{"source_rendition":{"contract":"photos_cached_preview_v1"}}'),
  ('10000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/p7_extiphoto.jpg', 'iphoto', true, 'approved', NULL);
INSERT INTO public.photo_extracted_fields (image_id, user_id, vehicle_id, field_name, value) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'license_plate', 'TST-0001'),
  ('10000000-0000-0000-0000-000000000002', NULL,                                   'a0000000-0000-0000-0000-00000000000a', 'license_plate', 'TST 002'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'license_plate', 'T-3 .'),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'license_plate', 'TST0005'),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'license_plate', 'TST0006'),
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'license_plate', 'TST0007'),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'paint_code', 'TST0004');

\set ALL '''p1_custody,p2_listing,p3_short,p4_noplate,p5_u3,p6_cached,p7_extiphoto'''
\set PUBLIC '''p2_listing,p3_short,p4_noplate,p7_extiphoto'''
\set U3 '''p2_listing,p3_short,p4_noplate,p5_u3,p7_extiphoto'''

-- Before: anon is served every photo, plates included.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_pub() = :ALL, 'before: anon is served all 7 photos');
RESET ROLE;

-- Supabase's default privileges: new tables are granted to anon and authenticated; new functions are not executable by
-- PUBLIC here, so the migration's own revokes and grants are what is proven.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

\ir ../migrations/20261125135000_gallery_plate_privacy_rule.sql
\ir ../migrations/20261125135000_gallery_plate_privacy_rule.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert((SELECT count(*) FROM public.image_privacy_rules) = 1
  AND (SELECT count(*) FROM public.image_privacy_rules WHERE field_name = 'license_plate' AND min_alnum = 4 AND applies_to = 'custody' AND enabled) = 1,
  'rule table: exactly one row (license_plate, 4, custody), migration applied twice');

-- anon, through vehicle_images_public (what the signed-out gallery reads).
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_pub() = :PUBLIC, 'anon: custody photos with a plate reading are withheld; listing, 3-character and external photos stay');
SELECT t_assert((SELECT count(*) FROM (SELECT * FROM public.vehicle_images_public p WHERE p.vehicle_image_gallery_eligible IS TRUE) s) = 4,
  'anon: select=* with the gate filter runs (no 42501) and counts 4');
SELECT t_assert((SELECT count(*) FROM public.image_privacy_rules) = 1, 'anon: reads the rule row');
DO $$ BEGIN
  UPDATE public.image_privacy_rules SET enabled = false;
  RAISE EXCEPTION 'FAIL: anon updated image_privacy_rules';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon cannot update image_privacy_rules';
END $$;
DO $$ BEGIN
  INSERT INTO public.image_privacy_rules (field_name, min_alnum, applies_to, reason) VALUES ('x', 1, 'custody', 'x');
  RAISE EXCEPTION 'FAIL: anon inserted into image_privacy_rules';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon cannot insert into image_privacy_rules';
END $$;
RESET ROLE;

-- u2: a signed-in stranger is served what anon is, through both overloads.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000002');
SELECT t_assert(t_pub() = :PUBLIC AND t_tbl() = :PUBLIC, 'u2 (untied): withheld through both overloads');
DO $$ BEGIN
  UPDATE public.image_privacy_rules SET enabled = false;
  RAISE EXCEPTION 'FAIL: authenticated updated image_privacy_rules';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: authenticated cannot update image_privacy_rules';
END $$;
RESET ROLE;

-- u3: uploaded p5 on A, not tied to A: keeps its own photo, not u1's.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000003');
SELECT t_assert(t_pub() = :U3 AND t_tbl() = :U3, 'u3 (uploader of p5, untied): sees p5, not p1 or p6');
RESET ROLE;

-- u1: owner and uploader; u4: tied (mechanic contributor).
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000001');
SELECT t_assert(t_pub() = :ALL AND t_tbl() = :ALL, 'u1 (owner, uploader): sees all 7');
SELECT t_claims('00000000-0000-0000-0000-000000000004');
SELECT t_assert(t_pub() = :ALL AND t_tbl() = :ALL, 'u4 (vehicle_viewer_tied): sees all 7');
RESET ROLE;

SET ROLE service_role; SELECT t_claims('service');
SELECT t_assert(t_pub() = :ALL AND t_tbl() = :ALL, 'service_role: sees all 7');
RESET ROLE;

-- No viewer: a direct session without request claims (cron, a job's trigger, a stored fold) keeps every photo.
SELECT t_claims('none');
SELECT t_assert(t_tbl() = :ALL AND t_pub() = :ALL, 'no viewer (no claims, not authenticator): all 7, so stored counts do not depend on the writer');
-- PostgREST's authenticator without claims still has the rule applied (fails closed).
SET SESSION AUTHORIZATION authenticator; SET ROLE anon; SELECT t_claims('none');
SELECT t_assert(t_pub() = :PUBLIC, 'authenticator without claims, as anon: withheld');
RESET ROLE; RESET SESSION AUTHORIZATION;

-- Both overloads stay inlined: the plan names the helper, not the gate function.
SET ROLE anon; SELECT t_claims('');
DO $$
DECLARE l text; plan text := '';
BEGIN
  FOR l IN EXPLAIN (VERBOSE, COSTS OFF) SELECT id FROM public.vehicle_images_public p
    WHERE p.vehicle_id = 'a0000000-0000-0000-0000-00000000000a' AND p.vehicle_image_gallery_eligible IS TRUE LOOP
    plan := plan || l || E'\n';
  END LOOP;
  PERFORM t_assert(plan LIKE '%vehicle_image_privacy_withheld%' AND plan NOT LIKE '%vehicle_image_gallery_eligible%',
    'vehicle_images_public overload is inlined into the anon gallery plan');
END $$;
RESET ROLE;
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000002');
DO $$
DECLARE l text; plan text := '';
BEGIN
  FOR l IN EXPLAIN (VERBOSE, COSTS OFF) SELECT id FROM public.vehicle_images t
    WHERE t.vehicle_id = 'a0000000-0000-0000-0000-00000000000a' AND t.vehicle_image_gallery_eligible IS TRUE LOOP
    plan := plan || l || E'\n';
  END LOOP;
  PERFORM t_assert(plan LIKE '%vehicle_image_privacy_withheld%' AND plan NOT LIKE '%vehicle_image_gallery_eligible%',
    'vehicle_images overload is inlined into the signed-in gallery plan');
END $$;
RESET ROLE;

-- Disabling the rule row restores eligibility; enabling it withholds again.
UPDATE public.image_privacy_rules SET enabled = false WHERE field_name = 'license_plate';
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_pub() = :ALL, 'rule disabled: anon is served all 7 again');
RESET ROLE;
UPDATE public.image_privacy_rules SET enabled = true WHERE field_name = 'license_plate';
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_pub() = :PUBLIC, 'rule re-enabled: withheld again');
RESET ROLE;

SELECT t_assert((SELECT count(*) FROM public.vehicle_images) = 7 AND (SELECT count(*) FROM public.photo_extracted_fields) = 7,
  'no image or reading row changed');

-- Revert: both bodies back byte for byte, helper and rule table gone, anon served all 7.
\ir revert_20261125135000_gallery_plate_privacy_rule.sql
SELECT t_assert(md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images)'::regprocedure)) = '4761d9c78c54d78f09dc3235f691124c'
  AND md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images_public)'::regprocedure)) = 'b41688a52b368750a330ba8980737e4a'
  AND to_regprocedure('public.vehicle_image_privacy_withheld(uuid)') IS NULL AND to_regclass('public.image_privacy_rules') IS NULL,
  'revert: both bodies hash to the 2026-11-24 text; helper and rule table dropped');
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_pub() = :ALL, 'revert: anon is served all 7');
RESET ROLE;
