-- Disposable PG17 contract for 20261126040500_vehicle_images_insert_tie. Synthetic rows only, in a throwaway database.
-- The INSERT, UPDATE and two SELECT policies, vehicle_images_default_attribution and user_can_edit_vehicle are copied
-- from live (pg_policies / pg_get_functiondef, 2026-11-26; the user_can_edit_vehicle copy is asserted to have the
-- md5 d7e90f2f that 20261126011500 guards on). Writes run under SET ROLE so RLS and the trigger really apply.
-- Run with -v with3961=<path to 20261126011500_user_can_edit_vehicle_tied_grantor.sql> to repeat every case on that
-- migration's body.
--   before: a stranger lands a photo on another owner's car, names another person as uploader, or PATCHes an unfiled
--           row onto any car;
--   after:  those are refused 42501, and so are a user_id filled from documented_by_user_id or submitted_by naming
--           someone else, no uploader at all, merged_from set at insert, and anon; own unfiled, owner and contributor
--           inserts land and RETURNING shows them; a PATCH may not change user_id, may not move a photo onto a car
--           the caller cannot edit, may return a photo to the car it was merged from, may set merged_from only to the
--           row's car; definer writers and the service role are untouched;
--           the gate starts at pending and ai_scan_metadata carries only the VehicleComments listing keys on a
--           signed-in insert (NULL or 'approved' gate, reader keys, a non-object refused); the iOS, web-pick and
--           VehicleComments row shapes land; a later server trigger may still add keys;
--   mutants: without the restrictive floor (with a permissive any-car policy), without either guard, the stranger
--           cases land again;
--   the migration applies twice; the revert restores the before state.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_images') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
ALTER ROLE service_role BYPASSRLS;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION public.assert(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', what; END IF; END $$;
-- true when the statement is refused with 42501 (RLS WITH CHECK or the guard), false when it runs
CREATE FUNCTION public.refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS
  $$ BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.assert(boolean, text), public.refused(text) TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, owner_id uuid, user_id uuid, uploaded_by uuid, created_by_user_id uuid,
  is_public boolean, deleted_at timestamptz);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid, status text, can_edit boolean);
CREATE TABLE public.vehicle_contributor_roles (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid, role text, end_date date,
  approved_by uuid, is_active boolean);
CREATE TABLE public.vehicle_user_permissions (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid, role text, is_active boolean);
CREATE TABLE public.organization_vehicles (vehicle_id uuid REFERENCES public.vehicles(id), organization_id uuid, linked_by_user_id uuid);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, status text, role text);
CREATE TABLE public.access_grants (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.access_grants g WHERE g.vehicle_id = p_vehicle AND g.user_id = p_user) $$;
GRANT SELECT ON public.vehicles, public.vehicle_contributors, public.vehicle_contributor_roles, public.vehicle_user_permissions
  TO anon, authenticated, service_role;

-- user_can_edit_vehicle as live (pg_get_functiondef 2026-11-26).
CREATE OR REPLACE FUNCTION public.user_can_edit_vehicle(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_can_edit BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.id = p_vehicle_id
      AND (
        v.uploaded_by = p_user_id
        OR v.user_id = p_user_id
        OR v.owner_id = p_user_id
        OR EXISTS (
          SELECT 1 FROM vehicle_contributors vc
          WHERE vc.vehicle_id = v.id
            AND vc.user_id = p_user_id
            AND vc.status = 'active'
            AND vc.can_edit = true
        )
        OR EXISTS (
          SELECT 1 FROM vehicle_contributor_roles vcr
          WHERE vcr.vehicle_id = v.id
            AND vcr.user_id = p_user_id
            AND vcr.role IN ('owner', 'restorer', 'contributor', 'moderator')
            AND (vcr.end_date IS NULL OR vcr.end_date > CURRENT_DATE)
        )
        OR EXISTS (
          SELECT 1 FROM organization_vehicles ov
          WHERE ov.vehicle_id = v.id
            AND EXISTS (
              SELECT 1 FROM organization_contributors oc
              WHERE oc.organization_id = ov.organization_id
                AND oc.user_id = p_user_id
                AND oc.status = 'active'
                AND oc.role IN ('owner', 'manager', 'employee')
            )
        )
      )
  ) INTO v_can_edit;
  
  RETURN COALESCE(v_can_edit, false);
END;
$function$;
SELECT public.assert(md5(pg_get_functiondef('public.user_can_edit_vehicle(uuid,uuid)'::regprocedure)) = 'd7e90f2f6a6f4c3375fb166f67505d5a', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'fixture user_can_edit_vehicle equals the live definition');
REVOKE ALL ON FUNCTION public.user_can_edit_vehicle(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_edit_vehicle(uuid, uuid) TO authenticated, service_role;
\if :{?with3961}
\echo running on the body of 20261126011500
\i :with3961
\endif

CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles(id),
  user_id uuid, documented_by_user_id uuid, submitted_by uuid, imported_by uuid, ghost_user_id uuid, is_external boolean,
  merged_from_vehicle_id uuid REFERENCES public.vehicles(id), image_url text, caption text, is_sensitive boolean,
  vision_gate_status public.vision_gate_status DEFAULT 'pending', ai_scan_metadata jsonb DEFAULT '{}'::jsonb, source text,
  storage_path text, file_hash text, ai_processing_status text, exif_data jsonb, taken_at timestamptz);
-- A later server-side BEFORE INSERT trigger that stamps a key (it sorts after a000_): the client guard must judge the
-- client's row, not the stamped one.
CREATE FUNCTION public.test_server_stamp() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN NEW.ai_scan_metadata := coalesce(NEW.ai_scan_metadata, '{}'::jsonb) || '{"pipeline": {"queued": true}}'::jsonb; RETURN NEW; END $$;
CREATE TRIGGER trg_test_server_stamp BEFORE INSERT ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION public.test_server_stamp();
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.vehicle_images TO anon, authenticated, service_role;

-- vehicle_images_default_attribution as live (invoker, BEFORE INSERT).
CREATE FUNCTION public.vehicle_images_default_attribution() RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  resolved uuid;
BEGIN
  resolved := COALESCE(NEW.user_id, NEW.documented_by_user_id, NEW.submitted_by, NEW.imported_by, NEW.ghost_user_id);
  IF resolved IS NOT NULL THEN
    NEW.user_id := COALESCE(NEW.user_id, resolved);
    IF NEW.documented_by_user_id IS NULL AND NOT COALESCE(NEW.is_external, false) THEN
      NEW.documented_by_user_id := resolved;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_vehicle_images_default_attribution BEFORE INSERT ON public.vehicle_images
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_images_default_attribution();

-- The live INSERT policies (7, permissive, TO public).
CREATE POLICY "Authenticated can upload vehicle images" ON public.vehicle_images FOR INSERT
  WITH CHECK ((( SELECT auth.uid() AS uid) = submitted_by) OR ((submitted_by IS NULL) AND (( SELECT auth.uid() AS uid) IS NOT NULL)));
CREATE POLICY "Authenticated users can upload images to any vehicle" ON public.vehicle_images FOR INSERT
  WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id) AND (vehicle_id IS NOT NULL));
CREATE POLICY "Logged in users can upload images" ON public.vehicle_images FOR INSERT
  WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can insert images for their own vehicles" ON public.vehicle_images FOR INSERT
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id) AND ((vehicle_id IS NULL) OR (EXISTS ( SELECT 1 FROM vehicles
    WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY service_role_can_insert_vehicle_images ON public.vehicle_images FOR INSERT WITH CHECK (auth.role() = 'service_role'::text);
CREATE POLICY users_can_insert_own_images ON public.vehicle_images FOR INSERT
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id) AND ((vehicle_id IS NULL) OR (EXISTS ( SELECT 1 FROM vehicles
    WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid)))))));
-- The live UPDATE policies (5, permissive, TO public, none with WITH CHECK).
CREATE POLICY "Allow vehicle owners to update images" ON public.vehicle_images FOR UPDATE
  USING ((( SELECT auth.uid() AS uid) IS NOT NULL) AND ((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1 FROM vehicles
    WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
    FROM vehicles WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.uploaded_by = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Owners and contributors can update images" ON public.vehicle_images FOR UPDATE
  USING ((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1 FROM vehicles v WHERE ((v.id = vehicle_images.vehicle_id)
    AND ((v.uploaded_by = ( SELECT auth.uid() AS uid)) OR (v.owner_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1
    FROM vehicle_contributor_roles vcr WHERE ((vcr.vehicle_id = vehicle_images.vehicle_id) AND (vcr.user_id = ( SELECT auth.uid() AS uid))
    AND (COALESCE(vcr.is_active, true) = true)))));
CREATE POLICY "Users can update images for their own vehicles" ON public.vehicle_images FOR UPDATE
  USING ((( SELECT auth.uid() AS uid) = user_id) AND ((vehicle_id IS NULL) OR (EXISTS ( SELECT 1 FROM vehicles
    WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Vehicle owners and contributors can update images" ON public.vehicle_images FOR UPDATE
  USING ((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1 FROM vehicles v WHERE ((v.id = vehicle_images.vehicle_id)
    AND ((v.owner_id = ( SELECT auth.uid() AS uid)) OR (v.user_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1
    FROM vehicle_user_permissions vup WHERE ((vup.vehicle_id = vehicle_images.vehicle_id) AND (vup.user_id = ( SELECT auth.uid() AS uid))
    AND (COALESCE(vup.is_active, true) = true) AND (vup.role = ANY (ARRAY['owner'::text, 'co_owner'::text, 'mechanic'::text,
    'appraiser'::text, 'moderator'::text, 'contributor'::text, 'photographer'::text, 'dealer_rep'::text, 'sales_agent'::text]))))));
CREATE POLICY users_can_update_own_images ON public.vehicle_images FOR UPDATE
  USING ((( SELECT auth.uid() AS uid) = user_id) OR ((vehicle_id IS NOT NULL) AND (EXISTS ( SELECT 1 FROM vehicles
    WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid)))))));
-- Two live SELECT policies, enough for RETURNING and the reads below.
CREATE POLICY "Users can view their own images" ON public.vehicle_images FOR SELECT USING (( SELECT auth.uid() AS uid) = user_id);
CREATE POLICY "Users can view images for vehicles they own" ON public.vehicle_images FOR SELECT
  USING (EXISTS ( SELECT 1 FROM vehicles WHERE ((vehicles.id = vehicle_images.vehicle_id) AND ((vehicles.user_id = auth.uid())
    OR (vehicles.uploaded_by = auth.uid()) OR (vehicles.owner_id = auth.uid())))));

-- Definer writers of the attribute_image_session shape: their own checks, then a write as the function owner.
CREATE FUNCTION public.test_definer_file(p_image uuid, p_vehicle uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$ BEGIN UPDATE public.vehicle_images SET vehicle_id = p_vehicle WHERE id = p_image; END $$;
CREATE FUNCTION public.test_definer_add(p_image uuid, p_vehicle uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$ BEGIN INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES (p_image, p_vehicle, auth.uid()); END $$;
GRANT EXECUTE ON FUNCTION public.test_definer_file(uuid, uuid), public.test_definer_add(uuid, uuid) TO authenticated;

-- a1 owned by f1 (owner_id), f4 a contributor with can_edit on it; a2 owned by f2 (user_id); a3 a listing car with no
-- owner. f3 is a signed-in stranger. b1 sits on a1, merged from a3.
INSERT INTO public.vehicles (id, owner_id, user_id, is_public) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', NULL, true),
  ('00000000-0000-0000-0000-0000000000a2', NULL, '00000000-0000-0000-0000-0000000000f2', true),
  ('00000000-0000-0000-0000-0000000000a3', NULL, NULL, true);
INSERT INTO public.vehicle_contributors VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f4', 'active', true);
INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f2');
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, merged_from_vehicle_id) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-0000000000a3');

\set stranger 'SET ROLE authenticated; SELECT set_config(''test.role'', ''authenticated'', false), set_config(''test.uid'', ''00000000-0000-0000-0000-0000000000f3'', false);'

-- Before: the exposure.
:stranger
SELECT public.assert(NOT public.refused($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f3')$q$), 'before: stranger lands a photo on another owner''s car');
SELECT public.assert(NOT public.refused($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f2')$q$), 'before: stranger names the owner as uploader');
SELECT public.assert(NOT public.refused($q$INSERT INTO public.vehicle_images (id, user_id) VALUES ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000f3')$q$), 'before: stranger lands an unfiled photo');
SELECT public.assert(NOT public.refused($q$UPDATE public.vehicle_images SET vehicle_id = '00000000-0000-0000-0000-0000000000a2' WHERE id = '00000000-0000-0000-0000-0000000000c3'$q$), 'before: stranger PATCHes it onto another owner''s car');
SELECT public.assert(NOT public.refused($q$INSERT INTO public.vehicle_images (id, user_id, vision_gate_status, ai_scan_metadata) VALUES ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000f3', NULL, '{"classification": {"image_type": "vehicle_exterior"}}')$q$), 'before: uploader skips the gate and writes reader keys');
RESET ROLE;
SELECT public.assert((SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a2' AND id::text LIKE '%c_') = 3, 'before: 3 stranger rows on a2');
DELETE FROM public.vehicle_images WHERE id::text LIKE '%c_';

\ir ../migrations/20261126040500_vehicle_images_insert_tie.sql
\ir ../migrations/20261126040500_vehicle_images_insert_tie.sql

-- INSERT as the stranger
:stranger
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f3')$q$), 'stranger onto another owner''s car: refused');
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000f3')$q$), 'stranger onto an ownerless listing car: refused');
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f2')$q$), 'forged user_id onto the owner''s car: refused');
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, user_id) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000f2')$q$), 'forged user_id unfiled: refused');
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, documented_by_user_id) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000f2')$q$), 'user_id filled from documented_by_user_id = someone else: refused');
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, submitted_by) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000f2')$q$), 'user_id filled from submitted_by = someone else: refused');
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, image_url) VALUES (gen_random_uuid(), 'x')$q$), 'no uploader at all: refused');
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, user_id, merged_from_vehicle_id) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a2')$q$), 'merged_from set at insert: refused');
WITH i AS (INSERT INTO public.vehicle_images (id, user_id, is_sensitive) VALUES ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000f3', false) RETURNING id) SELECT public.assert(count(*) = 1, 'own unfiled insert lands and RETURNING shows it') FROM i;
WITH i AS (INSERT INTO public.vehicle_images (id, submitted_by) VALUES ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000f3') RETURNING user_id) SELECT public.assert(user_id = '00000000-0000-0000-0000-0000000000f3', 'submitted_by = self fills user_id = self and lands') FROM i;
-- UPDATE as the stranger
SELECT public.assert(public.refused($q$UPDATE public.vehicle_images SET vehicle_id = '00000000-0000-0000-0000-0000000000a2' WHERE id = '00000000-0000-0000-0000-0000000000d3'$q$), 'PATCH own unfiled row onto another owner''s car: refused');
SELECT public.assert(public.refused($q$UPDATE public.vehicle_images SET merged_from_vehicle_id = '00000000-0000-0000-0000-0000000000a2' WHERE id = '00000000-0000-0000-0000-0000000000d3'$q$), 'merged_from set to a car the photo never sat on: refused');
SELECT public.assert(public.refused($q$UPDATE public.vehicle_images SET user_id = '00000000-0000-0000-0000-0000000000f2' WHERE id = '00000000-0000-0000-0000-0000000000d3'$q$), 'hand own photo to someone else: refused');
UPDATE public.vehicle_images SET caption = 'c', is_sensitive = true WHERE id = '00000000-0000-0000-0000-0000000000d3';
SELECT public.assert((SELECT caption FROM public.vehicle_images WHERE id = '00000000-0000-0000-0000-0000000000d3') = 'c', 'own row: caption and flags still editable');
-- definer writers called by the stranger: the function's own checks govern, the guard stays out
SELECT public.test_definer_file('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a3');
SELECT public.test_definer_add('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000a3');
RESET ROLE;
SELECT public.assert((SELECT count(*) FROM public.vehicle_images WHERE id IN ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d5') AND vehicle_id = '00000000-0000-0000-0000-0000000000a3') = 2, 'definer writers file as before');

-- The gate and the readers' keys (as the owner of a2)
SET ROLE authenticated; SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-0000-0000-0000000000f2', false);
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id, vision_gate_status) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f2', NULL)$q$), 'gate NULL at insert: refused');
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id, vision_gate_status) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f2', 'approved')$q$), 'gate approved at insert: refused');
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, user_id, ai_scan_metadata) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000f2', '{"classification": {"image_type": "engine_bay"}}')$q$), 'reader key classification at insert: refused');
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, user_id, ai_scan_metadata) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000f2', '{"source": "bat_scraper", "byok_deep_analysis": {"scene_type": "x"}}')$q$), 'a reader key beside listing keys: refused');
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, user_id, ai_scan_metadata) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000f2', '[1]')$q$), 'ai_scan_metadata not an object: refused');
-- the real row shapes: iOS capture (SupabaseService.VehicleImageRow), web pick (#3951), VehicleComments listing import
WITH i AS (INSERT INTO public.vehicle_images (id, image_url, storage_path, source, ai_processing_status, user_id, documented_by_user_id, file_hash, taken_at, exif_data, is_external) VALUES ('00000000-0000-0000-0000-0000000000e5', 'u', 'users/x/capture-relay/h/f.jpg', 'capture_relay_ios', 'pending', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2', 'h', now(), '{"synced_by": "capture-relay-ios"}', false) RETURNING vision_gate_status, ai_scan_metadata)
  SELECT public.assert(count(*) = 1 AND bool_and(vision_gate_status = 'pending' AND ai_scan_metadata ? 'pipeline'), 'iOS capture row lands unfiled, gate pending, server key stamped') FROM i;
WITH i AS (INSERT INTO public.vehicle_images (id, vehicle_id, image_url, source, user_id, documented_by_user_id, is_external, exif_data) VALUES ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000a2', 'u', 'web_upload', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2', false, '{"filing": {"basis": "uploader_pick_at_upload"}}') RETURNING id)
  SELECT public.assert(count(*) = 1, 'web upload onto a picked car the uploader edits lands') FROM i;
WITH i AS (INSERT INTO public.vehicle_images (id, vehicle_id, image_url, user_id, source, ai_scan_metadata) VALUES ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000a2', 'u', '00000000-0000-0000-0000-0000000000f2', 'bat_auction', jsonb_build_object('source', 'bat_scraper', 'bat_url', 'https://example.test/l', 'scraped_at', now(), 'vin_match', true, 'confidence_score', 0.9, 'original_listing', 'https://example.test/l', 'vehicle_expected', '1973 X Y')) RETURNING ai_scan_metadata)
  SELECT public.assert(count(*) = 1 AND bool_and(ai_scan_metadata ? 'bat_url'), 'VehicleComments listing row lands with its keys') FROM i;
RESET ROLE;
SET ROLE service_role; SELECT set_config('test.role', 'service_role', false), set_config('test.uid', '', false);
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, vision_gate_status, ai_scan_metadata) VALUES ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000a2', NULL, 'approved', '{"classification": {"image_type": "engine_bay"}}');
RESET ROLE;
SELECT public.assert((SELECT vision_gate_status FROM public.vehicle_images WHERE id = '00000000-0000-0000-0000-0000000000e8') = 'approved', 'service role sets the gate and reader keys, user_id NULL');

-- anon
SET ROLE anon; SELECT set_config('test.role', 'anon', false), set_config('test.uid', '', false);
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, image_url) VALUES (gen_random_uuid(), 'x')$q$), 'anon unfiled: refused');
SELECT public.assert(public.refused($q$INSERT INTO public.vehicle_images (id, vehicle_id) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2')$q$), 'anon onto a car: refused');
RESET ROLE;

-- Owners and contributors
SET ROLE authenticated; SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-0000-0000-0000000000f2', false);
WITH i AS (INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f2') RETURNING id) SELECT public.assert(count(*) = 1, 'owner (vehicles.user_id) inserts onto own car') FROM i;
SELECT public.assert(public.refused($q$UPDATE public.vehicle_images SET vehicle_id = '00000000-0000-0000-0000-0000000000a3' WHERE id = '00000000-0000-0000-0000-0000000000e2'$q$), 'owner moves a photo onto a car they cannot edit: refused');
SELECT public.assert(public.refused($q$UPDATE public.vehicle_images SET user_id = '00000000-0000-0000-0000-0000000000f3' WHERE id = '00000000-0000-0000-0000-0000000000b2'$q$), 'owner rewrites the uploader on own car: refused');
UPDATE public.vehicle_images SET merged_from_vehicle_id = vehicle_id WHERE id = '00000000-0000-0000-0000-0000000000e2';
SELECT public.assert((SELECT merged_from_vehicle_id FROM public.vehicle_images WHERE id = '00000000-0000-0000-0000-0000000000e2') = '00000000-0000-0000-0000-0000000000a2', 'merged_from may name the row''s current car (relink shape)');
UPDATE public.vehicle_images SET vehicle_id = NULL WHERE id = '00000000-0000-0000-0000-0000000000e2';
SELECT public.assert((SELECT vehicle_id FROM public.vehicle_images WHERE id = '00000000-0000-0000-0000-0000000000e2') IS NULL, 'owner unfiles own photo');
UPDATE public.vehicle_images SET vehicle_id = '00000000-0000-0000-0000-0000000000a2' WHERE id = '00000000-0000-0000-0000-0000000000e2';
SELECT public.assert((SELECT vehicle_id FROM public.vehicle_images WHERE id = '00000000-0000-0000-0000-0000000000e2') = '00000000-0000-0000-0000-0000000000a2', 'owner files own photo back onto own car');
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f4', false);
WITH i AS (INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f4') RETURNING id) SELECT public.assert(count(*) = 1, 'contributor with can_edit inserts onto that car') FROM i;
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f1', false);
WITH i AS (INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1') RETURNING id) SELECT public.assert(count(*) = 1, 'owner (vehicles.owner_id) inserts onto own car') FROM i;
-- unmerge_vehicle shape: an editor of the primary returns a photo to the car it was merged from
UPDATE public.vehicle_images SET vehicle_id = merged_from_vehicle_id, merged_from_vehicle_id = NULL WHERE id = '00000000-0000-0000-0000-0000000000b1';
RESET ROLE;
SELECT public.assert((SELECT vehicle_id FROM public.vehicle_images WHERE id = '00000000-0000-0000-0000-0000000000b1') = '00000000-0000-0000-0000-0000000000a3', 'unmerge returns a photo to its merged_from car');

-- service_role (BYPASSRLS; the guard acts only for anon and authenticated)
SET ROLE service_role; SELECT set_config('test.role', 'service_role', false), set_config('test.uid', '', false);
INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f3');
UPDATE public.vehicle_images SET user_id = '00000000-0000-0000-0000-0000000000f1', vehicle_id = '00000000-0000-0000-0000-0000000000a3' WHERE id = '00000000-0000-0000-0000-0000000000e9';
RESET ROLE;
SELECT public.assert((SELECT vehicle_id FROM public.vehicle_images WHERE id = '00000000-0000-0000-0000-0000000000e9') = '00000000-0000-0000-0000-0000000000a3', 'service role writes as before');
SELECT public.assert((SELECT string_agg(policyname || ':' || permissive, ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'vehicle_images' AND cmd = 'INSERT')
  = 'service_role_can_insert_vehicle_images:PERMISSIVE,vehicle_images_insert_uploader:PERMISSIVE,vehicle_images_insert_uploader_tied:RESTRICTIVE',
  'INSERT policies: service, the one end-user policy, the floor');
SELECT public.assert(NOT has_function_privilege('authenticated', 'public.vehicle_images_client_insert_guard()', 'EXECUTE'), 'insert guard not callable');
SELECT public.assert(NOT has_function_privilege('authenticated', 'public.vehicle_images_client_move_guard()', 'EXECUTE'), 'guard not callable');
DELETE FROM public.vehicle_images WHERE id::text ~ '[de][0-9]$';

-- Mutant 1: without the restrictive policy the stranger lands on a2 again, so the cases above kill it.
DROP POLICY vehicle_images_insert_uploader_tied ON public.vehicle_images;
CREATE POLICY mutant_any_car ON public.vehicle_images FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
:stranger
SELECT public.assert(NOT public.refused($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f3')$q$), 'mutant (no restrictive floor, a permissive any-car policy): stranger lands');
RESET ROLE;
DROP POLICY mutant_any_car ON public.vehicle_images;
DELETE FROM public.vehicle_images WHERE id::text LIKE '%c_';
\ir ../migrations/20261126040500_vehicle_images_insert_tie.sql
-- Mutant 2: without the guard the unfiled-then-PATCH path reopens.
DROP TRIGGER zz_vehicle_images_client_move_guard ON public.vehicle_images;
:stranger
SELECT public.assert(NOT public.refused($q$INSERT INTO public.vehicle_images (id, user_id) VALUES ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000f3')$q$), 'mutant setup: own unfiled row');
SELECT public.assert(NOT public.refused($q$UPDATE public.vehicle_images SET vehicle_id = '00000000-0000-0000-0000-0000000000a2' WHERE id = '00000000-0000-0000-0000-0000000000c3'$q$), 'mutant (no guard): PATCH lands');
RESET ROLE;
DELETE FROM public.vehicle_images WHERE id::text LIKE '%c_';
\ir ../migrations/20261126040500_vehicle_images_insert_tie.sql
-- Mutant 3: without the insert guard the uploader skips the gate again.
DROP TRIGGER a000_vehicle_images_client_insert_guard ON public.vehicle_images;
SET ROLE authenticated; SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-0000-0000-0000000000f2', false);
SELECT public.assert(NOT public.refused($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id, vision_gate_status) VALUES ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f2', NULL)$q$), 'mutant (no insert guard): gate NULL lands');
RESET ROLE;
DELETE FROM public.vehicle_images WHERE id::text LIKE '%c_';
\ir ../migrations/20261126040500_vehicle_images_insert_tie.sql

\ir revert_20261126040500_vehicle_images_insert_tie.sql
:stranger
SELECT public.assert(NOT public.refused($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f3')$q$), 'revert: before state restored');
RESET ROLE;
SELECT public.assert(to_regprocedure('public.vehicle_images_client_move_guard()') IS NULL
  AND to_regprocedure('public.vehicle_images_client_insert_guard()') IS NULL, 'revert: guards removed');
SELECT public.assert((SELECT count(*) FROM pg_policies WHERE tablename = 'vehicle_images' AND cmd = 'INSERT') = 6, 'revert: the six INSERT policies are back');
\echo vehicle_images_insert_tie: ok
