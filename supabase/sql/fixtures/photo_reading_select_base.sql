-- Shared fixture for the photo-reading SELECT policy contracts (test_photo_reading_*_select_policies.sql,
-- test_vehicle_keyed_select_policies.sql). Included with \ir by those files; it is not a contract by itself.
-- It mirrors production as read on 2026-11-25 (pg_get_functiondef, pg_policy, column and table grants):
--   * anon holds column grants on vehicle_images (no exif_data, no location), authenticated holds table SELECT; both hold
--     column grants on vehicles; vehicle_images_public is security_invoker.
--   * the live SELECT policies of vehicles and vehicle_images.
--   * the live bodies of both vehicle_image_gallery_eligible overloads (with the image_privacy_rules test),
--     vehicle_image_privacy_withheld, image_stage_custody_external, vehicle_user_has_access and vehicle_viewer_tied; a
--     DO block checks each body's md5 against production's. The BaT listing lookups are stubbed false; no seed row
--     reaches them.
--   * image_privacy_rules with its live row (license_plate, 4, custody).
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
CREATE TABLE auth.users (id uuid PRIMARY KEY);
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
-- Signs in as a user id ('' = anon, 'service' = service_role), as PostgREST sets the claims.
CREATE FUNCTION public.t_claims(p_uid text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', CASE WHEN p_uid = '' THEN '{"role":"anon"}'
     WHEN p_uid = 'service' THEN '{"role":"service_role"}'
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
CREATE TABLE public.image_privacy_rules (field_name text NOT NULL, min_alnum integer NOT NULL, applies_to text NOT NULL,
  enabled boolean NOT NULL DEFAULT true, reason text NOT NULL, PRIMARY KEY (field_name, applies_to));
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

-- Live bodies, 2026-11-25 (pg_get_functiondef), in dependency order.
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
  end $function$;

CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- vehicle_viewer_tie_plpgsql_v1: the reviewed SQL body, unchanged.
  RETURN (
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
);
END
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- vehicle_viewer_tie_plpgsql_v1: the reviewed SQL body, unchanged.
  RETURN (
  SELECT CASE
           WHEN (SELECT auth.role()) = 'service_role' THEN true
           WHEN (SELECT auth.uid()) IS NULL THEN false
           ELSE coalesce((SELECT (SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by)
                            FROM public.vehicles v WHERE v.id = p_vehicle_id), false)
                OR coalesce(public.vehicle_user_has_access(p_vehicle_id, (SELECT auth.uid())), false)
         END
);
END
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_image_privacy_withheld(p_image_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER COST 50
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
    WHEN (SELECT auth.role()) = 'service_role' THEN false
    -- no viewer: a direct database session (cron, a job's trigger, a stored fold) carries no request claims and is not
    -- PostgREST's authenticator
    WHEN (SELECT auth.role()) IS NULL AND session_user <> 'authenticator' THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.photo_extracted_fields f
      JOIN public.image_privacy_rules r
        ON r.field_name = f.field_name AND r.enabled AND r.applies_to = 'custody'
      JOIN public.vehicle_images i ON i.id = f.image_id
      WHERE f.image_id = p_image_id
        AND length(regexp_replace(upper(f.value), '[^A-Z0-9]', '', 'g')) >= r.min_alnum
        AND NOT public.image_stage_custody_external(i.is_external, i.user_id, i.source, i.exif_data)
        AND i.user_id IS DISTINCT FROM (SELECT auth.uid())
        AND NOT public.vehicle_viewer_tied(i.vehicle_id))
  END
$function$;

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
    END
    -- privacy rule rows (image_privacy_rules): a custody photo with a keyed private reading, for a viewer who is
    -- neither its uploader nor tied to its vehicle
    AND NOT public.vehicle_image_privacy_withheld(($1).id);
$function$;

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
    END
    -- privacy rule rows (image_privacy_rules): a custody photo with a keyed private reading, for a viewer who is
    -- neither its uploader nor tied to its vehicle
    AND NOT public.vehicle_image_privacy_withheld(($1).id);
$function$;

DO $$ BEGIN
  IF (md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images)'::regprocedure)),
      md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images_public)'::regprocedure)),
      md5(pg_get_functiondef('public.vehicle_image_privacy_withheld(uuid)'::regprocedure)),
      md5(pg_get_functiondef('public.image_stage_custody_external(boolean,uuid,text,jsonb)'::regprocedure)),
      md5(pg_get_functiondef('public.vehicle_user_has_access(uuid,uuid)'::regprocedure)),
      md5(pg_get_functiondef('public.vehicle_viewer_tied(uuid)'::regprocedure)))
     IS DISTINCT FROM ('3a1a1a21648e022997d38138b44ceaea'::text, '7393cb61fab3ff10327e0c3fc7864551'::text,
      '8ccfb2ae77e3de2cf9c3153c05b761a1'::text, '7e85a71398da678a2d28ae90de3d4144'::text,
      'bbb8292084730a1a7d6c56a779769267'::text, '2b0a7483f924d32edb2799c15f81235c'::text) THEN
    RAISE EXCEPTION 'FAIL: fixture bodies do not hash to production''s 2026-11-25 text';
  END IF;
  RAISE NOTICE 'PASS: fixture bodies hash to production''s 2026-11-25 text';
END $$;

-- Live SELECT policies, 2026-11-25.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING ((is_public = true) OR (auth.role() = 'service_role'::text));
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT USING ((is_public = false) AND ((SELECT auth.uid()) IS NOT NULL)
  AND (((SELECT auth.uid()) = user_id) OR ((SELECT auth.uid()) = owner_id) OR ((SELECT auth.uid()) = uploaded_by)
    OR vehicle_user_has_access(id, (SELECT auth.uid()))));
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Organization members can view org vehicle images" ON public.vehicle_images FOR SELECT USING (EXISTS (SELECT 1
  FROM (organization_vehicles ov JOIN organization_contributors oc ON ((ov.organization_id = oc.organization_id)))
  WHERE ((ov.vehicle_id = vehicle_images.vehicle_id) AND (oc.user_id = (SELECT auth.uid())) AND (oc.status = 'active'::text))));
CREATE POLICY "Users can view images for public vehicles" ON public.vehicle_images FOR SELECT USING ((COALESCE(is_sensitive, false) = false)
  AND (COALESCE(is_superseded, false) = false) AND ((vision_gate_status IS NULL) OR (vision_gate_status <> ALL (ARRAY['rejected_personal'::vision_gate_status,
  'rejected_misattributed'::vision_gate_status, 'review_needed'::vision_gate_status])))
  AND (EXISTS (SELECT 1 FROM vehicles v WHERE ((v.id = vehicle_images.vehicle_id) AND (v.is_public = true)))));
CREATE POLICY "Users can view images for vehicles they own" ON public.vehicle_images FOR SELECT USING (EXISTS (SELECT 1 FROM vehicles
  WHERE ((vehicles.id = vehicle_images.vehicle_id) AND ((vehicles.user_id = auth.uid()) OR (vehicles.uploaded_by = auth.uid()) OR (vehicles.owner_id = auth.uid())))));
CREATE POLICY "Users can view their own images" ON public.vehicle_images FOR SELECT USING (((SELECT auth.uid()) = user_id));
CREATE POLICY users_can_view_own_unorganized_images ON public.vehicle_images FOR SELECT USING ((vehicle_id IS NULL)
  AND ((user_id = auth.uid()) OR (documented_by_user_id = auth.uid())));
ALTER TABLE public.photo_extracted_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY photo_extracted_fields_owner_read ON public.photo_extracted_fields FOR SELECT USING (user_id = auth.uid());
ALTER TABLE public.image_privacy_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY image_privacy_rules_read ON public.image_privacy_rules FOR SELECT TO anon, authenticated USING (true);

-- Live grants.
GRANT SELECT (id, is_public, deleted_at, user_id, owner_id, uploaded_by, created_by_user_id) ON public.vehicles TO anon, authenticated;
GRANT SELECT (id, vehicle_id, user_id, documented_by_user_id, image_url, source, is_document, is_duplicate, is_superseded, is_sensitive,
  image_vehicle_match_status, vision_gate_status, is_external, is_approved, approval_status, verification_status, redaction_level)
  ON public.vehicle_images TO anon;
GRANT SELECT ON public.vehicle_images TO authenticated;
GRANT SELECT ON public.vehicle_images_public, public.photo_extracted_fields, public.image_privacy_rules TO anon, authenticated;
GRANT SELECT (organization_id, vehicle_id) ON public.organization_vehicles TO anon, authenticated;
GRANT SELECT ON public.organization_contributors TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_claims(text) TO anon, authenticated, service_role;

-- People: u1 = ...0001 owns public car A, private car B (with u5 as B's recorded owner_id) and deleted car C; u2 is a
-- stranger; u3 uploaded one photo on B and is not tied to it; u4 is A's mechanic contributor (tied to A); u5 is B's
-- owner_id (tied to B, sees B's photos); u6 is B's mechanic contributor (tied to B, but vehicle_images RLS hides B's
-- photos from u6).
INSERT INTO auth.users (id) SELECT ('00000000-0000-0000-0000-00000000000' || n)::uuid FROM generate_series(1, 6) n;
INSERT INTO public.vehicles (id, is_public, deleted_at, user_id, owner_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', true,  NULL,         '00000000-0000-0000-0000-000000000001', NULL),
  ('b0000000-0000-0000-0000-00000000000b', false, NULL,         '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005'),
  ('c0000000-0000-0000-0000-00000000000c', true,  '2026-11-01', '00000000-0000-0000-0000-000000000001', NULL);
INSERT INTO public.vehicle_contributors VALUES
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'active', 'mechanic'),
  ('b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000006', 'active', 'mechanic');
INSERT INTO public.image_privacy_rules (field_name, min_alnum, applies_to, enabled, reason)
  VALUES ('license_plate', 4, 'custody', true, 'live row, 2026-11-25');
-- Photos (label = what it is; every reading row in the contracts is labelled with its photo's label):
--   shown_a     A, approved, u1 upload                          -> anon reads its readings
--   unfiled_u1  no vehicle, u1 upload (a paper, a person)       -> u1 only
--   private_b   B (private), approved, u1 upload               -> u1, u5 (owner_id, sees B's photos)
--   photog_b    B (private), approved, u3 upload               -> u3 (uploader), u1, u5
--   deleted_c   C (deleted), approved, u1 upload               -> u1 only
--   document_a  A, is_document (gallery-ineligible), u1 upload -> u1, u4 (tied to A)
--   plate_a     A, approved, u1 upload, a custody plate reading (privacy rule withholds it) -> u1, u4
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, is_document, is_external, vision_gate_status, exif_data, latitude) VALUES
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/1.jpg', 'user_upload', false, false, 'approved', '{"gps":1}', 36.1),
  ('10000000-0000-0000-0000-000000000002', NULL,                                   '00000000-0000-0000-0000-000000000001', 'https://x.invalid/2.jpg', 'user_upload', false, false, 'approved', '{"gps":1}', 36.1),
  ('10000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/3.jpg', 'user_upload', false, false, 'approved', NULL, NULL),
  ('10000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000003', 'https://x.invalid/4.jpg', 'user_upload', false, false, 'approved', NULL, NULL),
  ('10000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/5.jpg', 'user_upload', false, false, 'approved', NULL, NULL),
  ('10000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/6.jpg', 'user_upload', true,  false, 'approved', NULL, NULL),
  ('10000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/7.jpg', 'user_upload', false, false, 'approved', NULL, NULL);
INSERT INTO public.photo_extracted_fields (image_id, user_id, vehicle_id, field_name, value) VALUES
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'license_plate', 'TST0007');
-- The photo labels, for the contracts' readers: t_label(image_id).
CREATE FUNCTION public.t_label(p uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN '10000000-0000-0000-0000-000000000001' THEN 'shown_a' WHEN '10000000-0000-0000-0000-000000000002' THEN 'unfiled_u1'
    WHEN '10000000-0000-0000-0000-000000000003' THEN 'private_b' WHEN '10000000-0000-0000-0000-000000000004' THEN 'photog_b'
    WHEN '10000000-0000-0000-0000-000000000005' THEN 'deleted_c' WHEN '10000000-0000-0000-0000-000000000006' THEN 'document_a'
    WHEN '10000000-0000-0000-0000-000000000007' THEN 'plate_a' END $$;
GRANT EXECUTE ON FUNCTION public.t_label(uuid) TO anon, authenticated, service_role;
