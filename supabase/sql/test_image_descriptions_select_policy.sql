-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_image_descriptions_select_policy -f this-file.sql
-- Proves 20261125094500_image_descriptions_select_policy.sql: a photo's description is readable by anon only when the
-- photo is gallery-eligible on a public, undeleted vehicle; never for an unfiled photo, a private car's photo or a
-- deleted car's photo; the uploader reads their own unfiled photo's description; a vehicle_viewer_tied caller reads the
-- descriptions of that vehicle's photos it can see; another signed-in user reads only what anon reads; service_role reads
-- every row; and anon reads through PostgREST's shapes (select=*, filters, count) without 42501.
-- The fixture mirrors production as read on 2026-11-24: anon holds column grants on vehicle_images (no exif_data or
-- location), neither role holds table SELECT on vehicles (column grants), vehicle_images_public is security_invoker, the
-- live SELECT policies of vehicles and vehicle_images, and the live bodies of vehicle_image_gallery_eligible
-- (vehicle_images_public), vehicle_viewer_tied and vehicle_user_has_access (pg_get_functiondef). The BaT listing lookup
-- of a pending bat_import photo is stubbed false; no seed row reaches it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.image_descriptions') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- auth.uid() and auth.role() read the request's claims, as production's do.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Signs in as a user id ('' = anon), as PostgREST sets the claims, and takes that request role.
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
-- guardrail-allow(center-key-fk): image_descriptions.vehicle_id: mirrors production, which holds no foreign key on it (a lagging
-- stamp; this policy reads the photo's vehicle instead). Keying it is the photo-reading family's debt, not this fixture's.
CREATE TABLE public.image_descriptions (id uuid PRIMARY KEY, image_id uuid NOT NULL REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  vehicle_id uuid, description text NOT NULL, description_type text NOT NULL DEFAULT 'classifier_v2', source text NOT NULL DEFAULT 'test');
CREATE INDEX idx_image_descriptions_image ON public.image_descriptions (image_id);
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

-- Live bodies, 2026-11-24.
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
$function$;

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
$function$;

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
$function$;

-- Live SELECT policies, 2026-11-24.
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
-- image_descriptions as production held it before the migration.
ALTER TABLE public.image_descriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY image_descriptions_insert ON public.image_descriptions FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY image_descriptions_select ON public.image_descriptions FOR SELECT USING (true);

-- Live grants: column grants on vehicles for both roles; on vehicle_images for anon (no exif_data, no location).
GRANT SELECT (id, is_public, deleted_at, user_id, owner_id, uploaded_by, created_by_user_id) ON public.vehicles TO anon, authenticated;
GRANT SELECT (id, vehicle_id, user_id, documented_by_user_id, image_url, source, is_document, is_duplicate, is_superseded, is_sensitive,
  image_vehicle_match_status, vision_gate_status, is_external, is_approved, approval_status, verification_status, redaction_level)
  ON public.vehicle_images TO anon;
GRANT SELECT ON public.vehicle_images TO authenticated;
GRANT SELECT ON public.vehicle_images_public, public.image_descriptions TO anon, authenticated;
GRANT SELECT (organization_id, vehicle_id) ON public.organization_vehicles TO anon, authenticated;
GRANT SELECT ON public.organization_contributors TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
-- The descriptions the current role and claims can read, as a sorted label list.
CREATE FUNCTION public.t_seen() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(description, ',' ORDER BY description), '') FROM public.image_descriptions $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_seen(), public.t_claims(text) TO anon, authenticated, service_role;

-- Users: u1 owns the public car A and the private car B; u2 is a stranger; u3 photographs on B; u4 is a mechanic
-- contributor on A.
-- Cars: A public, B private, C public but deleted.
-- u1 = ...0001, u2 = ...0002, u3 = ...0003, u4 = ...0004.
INSERT INTO public.vehicles (id, is_public, deleted_at, user_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', true,  NULL,        '00000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000b', false, NULL,        '00000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-00000000000c', true,  '2026-11-01', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.vehicle_contributors VALUES
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'active', 'mechanic');
-- Photos (description label = what it is):
--   shown_a     A, approved, uploaded by u1                      -> anon reads it
--   lagging_a   A, approved, description.vehicle_id NULL (lags)  -> anon reads it (the photo's vehicle decides)
--   unfiled_u1  no vehicle, uploaded by u1 (a paper, a person)   -> u1 only
--   private_b   B, approved, uploaded by u1                      -> u1 only
--   photog_b    B, approved, uploaded by u3                      -> u3 (uploader) and u1 (tied: B's owner)
--   deleted_c   C (deleted), approved, uploaded by u1            -> u1 only
--   document_a  A, is_document, uploaded by u1                   -> u1 (uploader), u4 (tied: A's mechanic)
--   rejected_a  A, vision gate rejected_personal, uploaded by u1 -> u1 only
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, is_document, vision_gate_status, exif_data, latitude) VALUES
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/1.jpg', false, 'approved', '{"gps":1}', 36.1),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/2.jpg', false, NULL, NULL, NULL),
  ('10000000-0000-0000-0000-000000000003', NULL,                                   '00000000-0000-0000-0000-000000000001', 'https://x.invalid/3.jpg', false, 'approved', '{"gps":1}', 36.1),
  ('10000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/4.jpg', false, 'approved', NULL, NULL),
  ('10000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000003', 'https://x.invalid/5.jpg', false, 'approved', NULL, NULL),
  ('10000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/6.jpg', false, 'approved', NULL, NULL),
  ('10000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/7.jpg', true,  'approved', NULL, NULL),
  ('10000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/8.jpg', false, 'rejected_personal', NULL, NULL);
INSERT INTO public.image_descriptions (id, image_id, vehicle_id, description) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'shown_a'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', NULL,                                   'lagging_a'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', NULL,                                   'unfiled_u1'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'private_b'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'photog_b'),
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-00000000000c', 'deleted_c'),
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', 'document_a'),
  ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-00000000000a', 'rejected_a');

-- Before: the defect. Anon reads every description, the unfiled photo's included.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_seen() = 'deleted_c,document_a,lagging_a,photog_b,private_b,rejected_a,shown_a,unfiled_u1',
  'before: anon reads all 8 descriptions, unfiled_u1 among them (USING (true))');
RESET ROLE;

\ir ../migrations/20261125094500_image_descriptions_select_policy.sql
\ir ../migrations/20261125094500_image_descriptions_select_policy.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert((SELECT count(*) FROM pg_policies WHERE tablename = 'image_descriptions') = 2
  AND (SELECT qual FROM pg_policies WHERE tablename = 'image_descriptions' AND policyname = 'image_descriptions_select') <> 'true'
  AND (SELECT roles::text FROM pg_policies WHERE tablename = 'image_descriptions' AND policyname = 'image_descriptions_insert') = '{service_role}',
  'policies: select replaced in place (applied twice), insert unchanged');

-- Anon.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_seen() = 'lagging_a,shown_a',
  'anon: reads the gallery photos of the public car only (not unfiled, private, deleted, document or gate-rejected)');
SELECT t_assert((SELECT count(*) FROM public.image_descriptions WHERE vehicle_id IS NULL AND image_id = '10000000-0000-0000-0000-000000000003') = 0
  AND (SELECT count(*) FROM public.image_descriptions WHERE description = 'unfiled_u1') = 0,
  'anon: the unfiled photo''s description is not readable (vehicle_id=is.null shape)');
SELECT t_assert((SELECT count(*) FROM public.image_descriptions WHERE vehicle_id = 'b0000000-0000-0000-0000-00000000000b') = 0
  AND (SELECT count(*) FROM public.image_descriptions WHERE vehicle_id = 'c0000000-0000-0000-0000-00000000000c') = 0,
  'anon: no description of a private car''s or a deleted car''s photo');
SELECT t_assert((SELECT count(*) FROM (SELECT * FROM public.image_descriptions WHERE image_id = '10000000-0000-0000-0000-000000000001') s) = 1,
  'anon: select=* by image_id runs (no 42501 from the whole-row gallery test) and returns the shown photo');
RESET ROLE;

-- u1: the uploader and owner.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000001');
SELECT t_assert(t_seen() = 'deleted_c,document_a,lagging_a,photog_b,private_b,rejected_a,shown_a,unfiled_u1',
  'u1 (uploader, owner): reads its own unfiled photo''s description and every description of its cars');
RESET ROLE;

-- u2: another signed-in user reads only what anon reads.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000002');
SELECT t_assert(t_seen() = 'lagging_a,shown_a', 'u2 (stranger): reads what anon reads, not unfiled_u1, private_b or deleted_c');
RESET ROLE;

-- u3: uploaded photog_b on u1's private car; not tied to B.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000003');
SELECT t_assert(t_seen() = 'lagging_a,photog_b,shown_a', 'u3 (uploader of photog_b): reads its own photo on a private car, not private_b');
RESET ROLE;

-- u4: mechanic contributor on A (vehicle_viewer_tied through vehicle_user_has_access).
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000004');
SELECT t_assert(t_seen() = 'document_a,lagging_a,shown_a',
  'u4 (tied to A): reads A''s document photo description, not the gate-rejected one (its image row is hidden) nor other cars''');
RESET ROLE;

-- service_role keeps every row.
SET ROLE service_role; SELECT t_claims('service');
SELECT t_assert((SELECT count(*) FROM public.image_descriptions) = 8, 'service_role: reads all 8 descriptions');
RESET ROLE;

SELECT t_assert((SELECT count(*) FROM public.image_descriptions) = 8 AND (SELECT count(*) FROM public.vehicle_images) = 8, 'no row changed');
