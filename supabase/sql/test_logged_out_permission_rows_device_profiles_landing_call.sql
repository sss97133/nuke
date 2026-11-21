-- Disposable PG17 only. Random ids, synthetic rows; exercises the actual migration on live's policy, view, grant and
-- function shapes (pg_policies, pg_get_viewdef, relacl, proacl and pg_get_functiondef, 2026-11-21).
-- Contract for 20261121194730_logged_out_permission_rows_device_profiles_landing_call.sql. Proves:
--   * before: a logged-out caller reads every permission row with its note; reads, through the roles view, the VIN of
--     a vehicle that is not public and of a deleted one; rewrites an unclaimed device profile; and runs the landing
--     wrapper for an image;
--   * after: a logged-out caller, a signed-in stranger and an admin read only the public-garage rows (owner or
--     co-owner, not revoked, on a public vehicle that is not deleted) and, through the view, only a row whose vehicle
--     they can read; the row's account, the account in the vehicle's user_id and the service role read what they
--     read before, and an account a vehicle names only as its uploader reads the vehicle and its own rows; a policy
--     on another table that reads the caller's own permission rows answers as before; the image-set insert policy,
--     which reads the view, still admits an account whose row reaches a vehicle it can read and no longer admits
--     one whose row is on a vehicle it cannot read; the upload-approval trigger, which reads the uploader's rows as
--     the inserter, approves as before; a logged-out caller cannot insert, update or delete a device profile, a
--     signed-in caller still updates an unclaimed one; no API caller executes the landing wrapper, the service role
--     does, and a signed-in update that fires the landing trigger still lands;
--   * the other five permission policies, the table's grants, the view's definition, the device profiles' read
--     policy and the wrapper's body, settings and SECURITY DEFINER are what they were; the migration applies twice.
-- Not in this contract: the permission table's triggers (no statement here reaches one) and its write policies'
-- behavior for a signed-in caller, which this migration leaves as they are.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR to_regclass('public.vehicle_user_permissions') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
-- auth.uid(), auth.jwt() and auth.role() as live defines them.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- vehicles: the columns the policies, the view and the helper name; column grants as live (no table-level SELECT).
CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer, make text, model text,
  vin text, user_id uuid, owner_id uuid, uploaded_by uuid, is_public boolean, deleted_at timestamptz,
  purchase_price numeric);
GRANT SELECT (id, uploaded_by, make, model, year, vin, is_public, deleted_at, user_id, owner_id)
  ON public.vehicles TO anon, authenticated;
GRANT ALL ON public.vehicles TO service_role;

-- The tables vehicle_user_has_access reads, with the columns it names.
CREATE TABLE public.admin_users (user_id uuid, is_active boolean);
CREATE TABLE public.ownership_verifications (vehicle_id uuid, user_id uuid, status text);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid, status text, role text);
CREATE TABLE public.organization_vehicles (vehicle_id uuid, organization_id uuid, relationship_type text, status text,
  linked_by_user_id uuid);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, status text, role text);

-- vehicle_user_permissions: live's columns and grants.
CREATE TABLE public.vehicle_user_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  user_id uuid NOT NULL, role text NOT NULL, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(),
  granted_by uuid, permissions text[], context text, granted_at timestamptz DEFAULT now(), expires_at timestamptz,
  revoked_at timestamptz, revoked_by uuid);
GRANT ALL ON public.vehicle_user_permissions TO anon, authenticated, service_role;

-- Live, verbatim (pg_get_functiondef and proacl, 2026-11-21).
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
REVOKE ALL ON FUNCTION public.vehicle_user_has_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_user_has_access(uuid, uuid) TO anon, authenticated, service_role;

-- vehicles' two read policies, live, verbatim.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT TO public
  USING (((is_public = false) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND ((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = uploaded_by) OR vehicle_user_has_access(id, ( SELECT auth.uid() AS uid)))));
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT TO public
  USING (((is_public = true) OR (auth.role() = 'service_role'::text)));

-- vehicle_user_permissions' six policies before the migration, live, verbatim.
ALTER TABLE public.vehicle_user_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vehicle owners can manage permissions" ON public.vehicle_user_permissions FOR ALL TO public
  USING (((EXISTS ( SELECT 1
   FROM vehicles v
  WHERE ((v.id = vehicle_user_permissions.vehicle_id) AND (v.user_id = ( SELECT auth.uid() AS uid))))) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY vup_delete_own ON public.vehicle_user_permissions FOR DELETE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY vup_insert_own ON public.vehicle_user_permissions FOR INSERT TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Public read access to vehicle permissions" ON public.vehicle_user_permissions FOR SELECT TO public
  USING (true);
CREATE POLICY vup_select_own ON public.vehicle_user_permissions FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY vup_update_own ON public.vehicle_user_permissions FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

-- The roles view, live, verbatim: no options, so it runs as its owner; every API role holds every privilege on it.
CREATE VIEW public.user_vehicle_roles AS
 SELECT vup.user_id,
    vup.vehicle_id,
    vup.role,
    vup.is_active,
    vup.granted_at,
    v.make,
    v.model,
    v.year,
    v.vin
   FROM vehicle_user_permissions vup
     JOIN vehicles v ON v.id = vup.vehicle_id
  WHERE vup.is_active = true;
GRANT ALL ON public.user_vehicle_roles TO anon, authenticated, service_role;

-- A policy of the shape six live tables use (timeline_events, vehicle_builds, vehicle_field_sources, vehicle_images,
-- vehicle_price_history, work_sessions): it reads the caller's own permission rows.
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, title text);
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.timeline_events TO anon, authenticated;
GRANT ALL ON public.timeline_events TO service_role;
CREATE POLICY "Timeline events are viewable by everyone" ON public.timeline_events FOR SELECT TO public
  USING (EXISTS ( SELECT 1 FROM vehicles
    WHERE vehicles.id = timeline_events.vehicle_id AND (vehicles.is_public = true OR vehicles.id IN (
      SELECT vup.vehicle_id FROM vehicle_user_permissions vup
       WHERE vup.user_id = ( SELECT auth.uid() AS uid) AND vup.is_active = true))));

-- ghost_users: the columns the statements below name; live's grants and its two policies, verbatim.
CREATE TABLE public.ghost_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_fingerprint text,
  camera_model text, display_name text, claimed_by_user_id uuid, claimed_at timestamptz,
  total_contributions integer DEFAULT 0, last_seen_at timestamptz);
ALTER TABLE public.ghost_users ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ghost_users TO anon, authenticated, service_role;
CREATE POLICY ghost_users_authenticated_claim ON public.ghost_users FOR UPDATE TO public
  USING (((claimed_by_user_id IS NULL) OR (claimed_by_user_id = ( SELECT auth.uid() AS uid))));
CREATE POLICY ghost_users_public_read ON public.ghost_users FOR SELECT TO public USING (true);

-- The landing path. The two-argument writer is a stand-in with live's signature, settings and grants: it records
-- one row per call instead of landing a reading. The wrapper is live's, verbatim, with the default EXECUTE for
-- PUBLIC it has live. The trigger function is live's first statement and its exception handler (the enqueue step
-- between them calls a function this fixture does not hold); the trigger is live's a06, verbatim.
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid,
  ai_processing_status text, ai_scan_metadata jsonb, vision_gate_status text, is_approved boolean);
GRANT SELECT, INSERT, UPDATE ON public.vehicle_images TO authenticated;
GRANT ALL ON public.vehicle_images TO service_role;
CREATE TABLE public.photo_land_progress (image_id uuid, include_classifier boolean, landed_at timestamptz DEFAULT now());
CREATE FUNCTION public.photo_land_classification(p_image_id uuid, p_include_classifier boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.photo_land_progress (image_id, include_classifier) values (p_image_id, p_include_classifier);
  return jsonb_build_object('landed', true);
end;
$function$;
REVOKE ALL ON FUNCTION public.photo_land_classification(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.photo_land_classification(uuid, boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.photo_land_classification(p_image_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT public.photo_land_classification(p_image_id, true) $function$;
GRANT EXECUTE ON FUNCTION public.photo_land_classification(uuid) TO service_role;
CREATE FUNCTION public.photo_land_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.photo_land_classification(NEW.id,
    OLD.ai_processing_status IS DISTINCT FROM 'completed'
    OR OLD.ai_scan_metadata->'classification' IS DISTINCT FROM NEW.ai_scan_metadata->'classification'
    OR OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id
    OR OLD.vision_gate_status IS DISTINCT FROM NEW.vision_gate_status);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'photo_land_trigger failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER a06_trg_land_classification AFTER UPDATE OF ai_processing_status, ai_scan_metadata ON public.vehicle_images FOR EACH ROW WHEN (((new.ai_processing_status = 'completed'::text) AND (new.ai_scan_metadata ? 'classification'::text) AND ((old.ai_processing_status IS DISTINCT FROM 'completed'::text) OR ((old.ai_scan_metadata -> 'classification'::text) IS DISTINCT FROM (new.ai_scan_metadata -> 'classification'::text)) OR ((old.ai_scan_metadata -> 'byok_deep_analysis'::text) IS DISTINCT FROM (new.ai_scan_metadata -> 'byok_deep_analysis'::text))))) EXECUTE FUNCTION photo_land_trigger();

-- The upload-approval trigger: live's body, verbatim (prosrc), running as its caller as live's does (prosecdef
-- false), on live's trigger. vehicle_contributor_roles is a stand-in with the three columns the body names.
CREATE TABLE public.vehicle_contributor_roles (vehicle_id uuid, user_id uuid, is_active boolean);
GRANT SELECT ON public.vehicle_contributor_roles TO anon, authenticated;
GRANT ALL ON public.vehicle_contributor_roles TO service_role;
CREATE FUNCTION public.set_vehicle_image_approval()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  uploader uuid := NEW.user_id;
  is_collab boolean := false;
begin
  if NEW.is_approved is not null then
    return NEW;
  end if;

  if NEW.vehicle_id is null then
    NEW.is_approved := true;
    return NEW;
  end if;

  is_collab := exists (
                 select 1 from public.vehicles v
                 where v.id = NEW.vehicle_id and v.user_id = uploader
               )
               or exists (
                 select 1 from public.vehicle_user_permissions vup
                 where vup.vehicle_id = NEW.vehicle_id
                   and vup.user_id = uploader
                   and coalesce(vup.is_active, true)
               )
               or exists (
                 select 1 from public.vehicle_contributor_roles vcr
                 where vcr.vehicle_id = NEW.vehicle_id
                   and vcr.user_id = uploader
                   and coalesce(vcr.is_active, true)
               );

  if is_collab then
    NEW.is_approved := true;
  else
    NEW.is_approved := false;
  end if;

  return NEW;
end $function$;
CREATE TRIGGER trg_set_vehicle_image_approval BEFORE INSERT ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION set_vehicle_image_approval();

-- image_sets: the columns its insert policy names, and that policy, live, verbatim. It reads the roles view.
CREATE TABLE public.image_sets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  created_by uuid, is_personal boolean DEFAULT false, name text);
ALTER TABLE public.image_sets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.image_sets TO anon, authenticated;
GRANT ALL ON public.image_sets TO service_role;
CREATE POLICY image_sets_insert_policy ON public.image_sets FOR INSERT TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (((is_personal = true) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((vehicle_id IS NOT NULL) AND ((vehicle_id IN ( SELECT user_vehicle_roles.vehicle_id
   FROM user_vehicle_roles
  WHERE (user_vehicle_roles.user_id = ( SELECT auth.uid() AS uid)))) OR (vehicle_id IN ( SELECT vehicles.id
   FROM vehicles
  WHERE (image_sets.created_by = ( SELECT auth.uid() AS uid)))))))));

-- Helpers. t_run runs a statement as the current role and returns the rows it returned or changed, or the SQLSTATE
-- it was refused with.
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_run(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT; RETURN n::text; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_run(text) TO authenticated, anon, service_role;

SELECT gen_random_uuid() AS owner, gen_random_uuid() AS third, gen_random_uuid() AS stranger,
       gen_random_uuid() AS admin, gen_random_uuid() AS fourth,
       gen_random_uuid() AS ghost_open, gen_random_uuid() AS ghost_claimed,
       gen_random_uuid() AS img_before, gen_random_uuid() AS img_after, gen_random_uuid() AS img_call,
       gen_random_uuid() AS img_ok_before, gen_random_uuid() AS img_no_before,
       gen_random_uuid() AS img_ok_after, gen_random_uuid() AS img_no_after \gset
SELECT json_build_object('sub', :'owner', 'role', 'authenticated') AS owner_jwt,
       json_build_object('sub', :'third', 'role', 'authenticated') AS third_jwt,
       json_build_object('sub', :'stranger', 'role', 'authenticated') AS stranger_jwt,
       json_build_object('sub', :'admin', 'role', 'authenticated') AS admin_jwt,
       json_build_object('sub', :'fourth', 'role', 'authenticated') AS fourth_jwt \gset
INSERT INTO public.admin_users (user_id, is_active) VALUES (:'admin', true);

-- Six vehicles. The owner's account is the user_id of four: one public, one not public, one deleted (its public flag
-- still set, so only the deleted test keeps its row out of the garage) and a second public one. The third account
-- is the user_id of the fifth. The sixth is not public and names the owner only as its uploader.
INSERT INTO public.vehicles (id, year, make, model, vin, user_id, uploaded_by, is_public, deleted_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 1973, 'Test', 'Public', 'VINPUB', :'owner', NULL, true, NULL),
  ('a0000000-0000-4000-8000-000000000002', 1974, 'Test', 'Private', 'VINPRIV', :'owner', NULL, false, NULL),
  ('a0000000-0000-4000-8000-000000000003', 1975, 'Test', 'Deleted', 'VINDEL', :'owner', NULL, true, now()),
  ('a0000000-0000-4000-8000-000000000004', 1976, 'Test', 'Public2', 'VINPUB2', :'owner', NULL, true, NULL),
  ('a0000000-0000-4000-8000-000000000005', 1977, 'Test', 'Thirds', 'VINTHIRD', :'third', NULL, true, NULL),
  ('a0000000-0000-4000-8000-000000000006', 1978, 'Test', 'Uploaded', 'VINUP', NULL, :'owner', false, NULL);
-- Ten permission rows. The first eight take one garage rule each:
--   1 owner on the public vehicle                      -> the garage shows it
--   2 contributor on the public vehicle                -> role keeps it out
--   3 owner on the vehicle that is not public          -> the vehicle keeps it out
--   4 owner on the deleted vehicle                     -> the deleted test keeps it out
--   5 co-owner on the second public vehicle, revoked   -> revoked keeps it out
--   6 consigned on the second public vehicle           -> role keeps it out
--   7 the third account, contributor on the vehicle that is not public, granted by the account in its user_id
--   8 co-owner on the third account's public vehicle, not active -> the garage shows it (the reader asks for
--     not-revoked rows; is_active is not part of what it asks)
--   9 the third account, contributor on the sixth vehicle, granted by its uploader
--  10 a fourth account, contributor on the vehicle that is not public, granted by nobody the vehicle names: the
--     access helper does not count such a row, so this account cannot read the vehicle
INSERT INTO public.vehicle_user_permissions (id, vehicle_id, user_id, role, is_active, granted_by, context, revoked_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', :'owner', 'owner', true, NULL, 'note 1 owner public', NULL),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', :'owner', 'contributor', true, NULL, 'note 2 contributor', NULL),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', :'owner', 'owner', true, NULL, 'note 3 not public', NULL),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000003', :'owner', 'owner', true, NULL, 'note 4 deleted', NULL),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000004', :'owner', 'co_owner', true, NULL, 'note 5 revoked', now()),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000004', :'owner', 'consigned', true, NULL, 'note 6 consigned', NULL),
  ('b0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000002', :'third', 'contributor', true, :'owner', 'note 7 third', NULL),
  ('b0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000005', :'owner', 'co_owner', false, NULL, 'note 8 inactive', NULL),
  ('b0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000006', :'third', 'contributor', true, :'owner', 'note 9 uploaded', NULL),
  ('b0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000002', :'fourth', 'contributor', true, :'fourth', 'note 10 fourth', NULL);
INSERT INTO public.timeline_events (vehicle_id, title) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'public work'), ('a0000000-0000-4000-8000-000000000002', 'private work');
INSERT INTO public.ghost_users (id, device_fingerprint, camera_model, display_name, claimed_by_user_id) VALUES
  (:'ghost_open', 'fp-open', 'Camera A', 'Camera A User', NULL),
  (:'ghost_claimed', 'fp-claimed', 'Camera B', 'Camera B User', :'owner');
INSERT INTO public.vehicle_images (id, user_id, vehicle_id, ai_processing_status, ai_scan_metadata) VALUES
  (:'img_before', :'third', 'a0000000-0000-4000-8000-000000000001', 'pending', '{"classification": {"image_type": "exterior"}}'),
  (:'img_after', :'third', 'a0000000-0000-4000-8000-000000000001', 'pending', '{"classification": {"image_type": "exterior"}}'),
  (:'img_call', :'third', 'a0000000-0000-4000-8000-000000000001', 'completed', '{"classification": {"image_type": "exterior"}}');

SELECT format('SELECT 1 FROM public.vehicle_user_permissions') AS vup_q,
       format('SELECT 1 FROM public.user_vehicle_roles') AS view_q,
       format('SELECT 1 FROM public.timeline_events') AS events_q,
       format('UPDATE public.vehicle_user_permissions SET context = %L WHERE id = %L', 'rewritten', 'b0000000-0000-4000-8000-000000000001') AS vup_update_q,
       format('UPDATE public.ghost_users SET display_name = NULL WHERE id = %L', :'ghost_open') AS ghost_null_q,
       format('UPDATE public.ghost_users SET last_seen_at = now() WHERE id = %L', :'ghost_open') AS ghost_bump_q,
       format('UPDATE public.ghost_users SET last_seen_at = now() WHERE id = %L', :'ghost_claimed') AS ghost_claimed_q,
       format('INSERT INTO public.ghost_users (device_fingerprint, display_name) VALUES (%L, %L)', 'fp-new', 'New User') AS ghost_insert_q,
       format('DELETE FROM public.ghost_users WHERE id = %L', :'ghost_open') AS ghost_delete_q,
       format('SELECT 1 FROM public.ghost_users') AS ghost_read_q,
       format('SELECT public.photo_land_classification(%L::uuid)', :'img_call') AS land_q,
       format('INSERT INTO public.image_sets (vehicle_id, name) VALUES (%L, %L)', 'a0000000-0000-4000-8000-000000000002', 'set') AS set_q,
       format('INSERT INTO public.vehicle_images (id, user_id, vehicle_id) VALUES (%L, %L, %L)', :'img_ok_before', :'third', 'a0000000-0000-4000-8000-000000000002') AS img_ok_before_q,
       format('INSERT INTO public.vehicle_images (id, user_id, vehicle_id) VALUES (%L, %L, %L)', :'img_no_before', :'stranger', 'a0000000-0000-4000-8000-000000000002') AS img_no_before_q,
       format('INSERT INTO public.vehicle_images (id, user_id, vehicle_id) VALUES (%L, %L, %L)', :'img_ok_after', :'third', 'a0000000-0000-4000-8000-000000000002') AS img_ok_after_q,
       format('INSERT INTO public.vehicle_images (id, user_id, vehicle_id) VALUES (%L, %L, %L)', :'img_no_after', :'stranger', 'a0000000-0000-4000-8000-000000000002') AS img_no_after_q,
       format('UPDATE public.vehicle_images SET ai_processing_status = %L WHERE id = %L', 'completed', :'img_before') AS fire_before_q,
       format('UPDATE public.vehicle_images SET ai_processing_status = %L WHERE id = %L', 'completed', :'img_after') AS fire_after_q \gset

-- What must not change, recorded before the migration.
CREATE TABLE public.t_before_policies AS
  SELECT tablename, policyname, cmd, permissive, roles::text AS roles, qual, with_check
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('vehicle_user_permissions', 'ghost_users');
CREATE TABLE public.t_before_catalog AS
  SELECT pg_get_viewdef('public.user_vehicle_roles'::regclass, true) AS view_def,
         (SELECT relacl::text FROM pg_class WHERE oid = 'public.vehicle_user_permissions'::regclass) AS vup_acl,
         (SELECT relacl::text FROM pg_class WHERE oid = 'public.user_vehicle_roles'::regclass) AS view_acl,
         (SELECT prosrc FROM pg_proc WHERE oid = 'public.photo_land_classification(uuid)'::regprocedure) AS wrapper_src,
         (SELECT prosecdef FROM pg_proc WHERE oid = 'public.photo_land_classification(uuid)'::regprocedure) AS wrapper_definer,
         (SELECT proconfig::text FROM pg_proc WHERE oid = 'public.photo_land_classification(uuid)'::regprocedure) AS wrapper_config,
         (SELECT proacl::text FROM pg_proc WHERE oid = 'public.photo_land_classification(uuid, boolean)'::regprocedure) AS writer_acl;

-- 1. Before. A logged-out caller reads every permission row and its note, and the view's VINs.
SET ROLE anon; SET request.jwt.claims = '{"role": "anon"}';
SELECT (SELECT count(*) FROM public.vehicle_user_permissions) AS before_anon_rows,
       (SELECT count(*) FROM public.vehicle_user_permissions WHERE context IS NOT NULL) AS before_anon_notes,
       (SELECT count(*) FROM public.user_vehicle_roles) AS before_anon_view,
       (SELECT coalesce(string_agg(DISTINCT vin, ',' ORDER BY vin), '') FROM public.user_vehicle_roles) AS before_anon_vins,
       (SELECT count(*) FROM public.timeline_events) AS before_anon_events,
       t_run(:'vup_update_q') AS before_anon_vup_update,
       t_run(:'ghost_null_q') AS before_anon_ghost_update,
       t_run(:'land_q') AS before_anon_land \gset
RESET ROLE;
SELECT t_assert(:before_anon_rows = 10 AND :before_anon_notes = 10,
  'before: a logged-out caller reads all ten permission rows, each with its note');
SELECT t_assert(:before_anon_view = 9 AND :'before_anon_vins' = 'VINDEL,VINPRIV,VINPUB,VINPUB2,VINUP',
  'before: through the view a logged-out caller reads the VIN of the two vehicles that are not public and of the deleted one');
SELECT t_assert(:'before_anon_vup_update' = '0'
  AND (SELECT context FROM public.vehicle_user_permissions WHERE id = 'b0000000-0000-4000-8000-000000000001') = 'note 1 owner public',
  'before: a logged-out UPDATE of a permission row changes no row');
SELECT t_assert(:'before_anon_ghost_update' = '1'
  AND (SELECT display_name IS NULL FROM public.ghost_users WHERE id = :'ghost_open'),
  'before: a logged-out caller rewrites an unclaimed device profile');
UPDATE public.ghost_users SET display_name = 'Camera A User' WHERE id = :'ghost_open';
SELECT t_assert(:'before_anon_land' = '1'
  AND (SELECT count(*) = 1 FROM public.photo_land_progress WHERE image_id = :'img_call'),
  'before: a logged-out caller runs the landing wrapper and a landing row is written');
SELECT t_assert(has_function_privilege('anon', 'public.photo_land_classification(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.photo_land_classification(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.photo_land_classification(uuid, boolean)', 'EXECUTE'),
  'before: anon and authenticated execute the wrapper through PUBLIC and not the two-argument writer, as live');
--    The stranger, the fourth account, the admin, the third account and the owner, for the comparison after.
SET ROLE authenticated; SET request.jwt.claims = :'stranger_jwt';
SELECT (SELECT count(*) FROM public.vehicle_user_permissions) AS before_stranger_rows,
       (SELECT count(*) FROM public.timeline_events) AS before_stranger_events,
       t_run(:'set_q') AS before_stranger_set,
       t_run(:'img_no_before_q') AS before_stranger_img \gset
SET request.jwt.claims = :'fourth_jwt';
SELECT (SELECT count(*) FROM public.vehicle_user_permissions) AS before_fourth_rows,
       (SELECT count(*) FROM public.vehicles) AS before_fourth_vehicles,
       t_run(:'set_q') AS before_fourth_set \gset
SET request.jwt.claims = :'admin_jwt';
SELECT (SELECT count(*) FROM public.vehicle_user_permissions) AS before_admin_rows,
       (SELECT count(*) FROM public.vehicles) AS before_admin_vehicles \gset
SET request.jwt.claims = :'third_jwt';
SELECT (SELECT count(*) FROM public.timeline_events) AS before_third_events,
       (SELECT count(*) FROM public.vehicles) AS before_third_vehicles,
       t_run(:'fire_before_q') AS before_third_fire,
       t_run(:'set_q') AS before_third_set,
       t_run(:'img_ok_before_q') AS before_third_img \gset
SET request.jwt.claims = :'owner_jwt';
SELECT (SELECT count(*) FROM public.vehicle_user_permissions) AS before_owner_rows,
       (SELECT count(*) FROM public.vehicles) AS before_owner_vehicles \gset
RESET ROLE;
SELECT t_assert(:before_stranger_rows = 10 AND :before_fourth_rows = 10 AND :before_admin_rows = 10,
  'before: a signed-in stranger, the fourth account and an admin each read all ten permission rows');
SELECT t_assert(:before_third_events = 2 AND :before_stranger_events = 1 AND :before_anon_events = 1,
  'before: the third account reads the event on the vehicle its own permission row reaches; a stranger and a logged-out caller read only the public vehicle''s');
SELECT t_assert(:before_owner_rows = 10 AND :before_owner_vehicles = 6 AND :before_third_vehicles = 6
  AND :before_admin_vehicles = 6 AND :before_fourth_vehicles = 4,
  'before: the owner reads all ten rows and all six vehicles; the third account reads the two that are not public through its granted rows; an admin reads all six; the fourth account reads the four with the public flag');
SELECT t_assert(:'before_third_set' = '1' AND :'before_fourth_set' = '1' AND :'before_stranger_set' = '42501',
  'before: the image-set insert policy admits the third and the fourth account on the vehicle that is not public and refuses a stranger');
SELECT t_assert(:'before_third_img' = '1' AND :'before_stranger_img' = '1'
  AND (SELECT is_approved FROM public.vehicle_images WHERE id = :'img_ok_before')
  AND NOT (SELECT is_approved FROM public.vehicle_images WHERE id = :'img_no_before'),
  'before: an upload by an account with a permission row on the vehicle is approved; a stranger''s is not');
SELECT t_assert(:'before_third_fire' = '1'
  AND (SELECT count(*) = 1 AND bool_and(include_classifier) FROM public.photo_land_progress WHERE image_id = :'img_before'),
  'before: a signed-in update that completes an image fires the trigger and a landing row is written');

-- 2. The migration, twice.
\ir ../migrations/20261121194730_logged_out_permission_rows_device_profiles_landing_call.sql
\ir ../migrations/20261121194730_logged_out_permission_rows_device_profiles_landing_call.sql

-- 3. After. A logged-out caller reads the two garage rows, and through the view only the row whose vehicle it can read.
SET ROLE anon; SET request.jwt.claims = '{"role": "anon"}';
SELECT (SELECT count(*) FROM public.vehicle_user_permissions) AS anon_rows,
       (SELECT coalesce(string_agg(context, ',' ORDER BY id), '') FROM public.vehicle_user_permissions) AS anon_notes,
       (SELECT count(*) FROM public.user_vehicle_roles) AS anon_view,
       (SELECT coalesce(string_agg(DISTINCT vin, ',' ORDER BY vin), '') FROM public.user_vehicle_roles) AS anon_vins,
       (SELECT count(*) FROM public.timeline_events) AS anon_events,
       t_run(:'vup_update_q') AS anon_vup_update,
       t_run(:'ghost_null_q') AS anon_ghost_update,
       t_run(:'ghost_insert_q') AS anon_ghost_insert,
       t_run(:'ghost_delete_q') AS anon_ghost_delete,
       t_run(:'ghost_read_q') AS anon_ghost_read,
       t_run(:'land_q') AS anon_land \gset
RESET ROLE;
SELECT t_assert(:anon_rows = 2 AND :'anon_notes' = 'note 1 owner public,note 8 inactive',
  'after: a logged-out caller reads the two garage rows and no other (role, vehicle not public, deleted and revoked each keep a row out)');
SELECT t_assert(:anon_view = 1 AND :'anon_vins' = 'VINPUB',
  'after: through the view a logged-out caller reads one row, on the public vehicle, and no other VIN');
SELECT t_assert(:'anon_vup_update' = '0'
  AND (SELECT context FROM public.vehicle_user_permissions WHERE id = 'b0000000-0000-4000-8000-000000000001') = 'note 1 owner public',
  'after: a logged-out UPDATE of a permission row still changes no row');
SELECT t_assert(:'anon_ghost_update' = '42501' AND :'anon_ghost_insert' = '42501' AND :'anon_ghost_delete' = '42501'
  AND (SELECT count(*) = 2 AND bool_and(display_name IS NOT NULL) FROM public.ghost_users),
  'after: a logged-out caller is refused 42501 on update, insert and delete of a device profile, and both profiles are untouched');
SELECT t_assert(:'anon_ghost_read' = '2', 'after: a logged-out caller still reads device profiles');
SELECT t_assert(:'anon_land' = '42501'
  AND (SELECT count(*) = 1 FROM public.photo_land_progress WHERE image_id = :'img_call'),
  'after: a logged-out caller is refused 42501 by the landing wrapper and no landing row is written');
SELECT t_assert(:anon_events = :before_anon_events, 'after: a logged-out caller reads the events it read before');

--    A signed-in stranger reads what a logged-out caller reads, can still update an unclaimed profile and cannot
--    run the wrapper.
SET ROLE authenticated; SET request.jwt.claims = :'stranger_jwt';
SELECT (SELECT count(*) FROM public.vehicle_user_permissions) AS stranger_rows,
       (SELECT coalesce(string_agg(context, ',' ORDER BY id), '') FROM public.vehicle_user_permissions) AS stranger_notes,
       (SELECT count(*) FROM public.user_vehicle_roles) AS stranger_view,
       (SELECT coalesce(string_agg(DISTINCT vin, ',' ORDER BY vin), '') FROM public.user_vehicle_roles) AS stranger_vins,
       (SELECT count(*) FROM public.timeline_events) AS stranger_events,
       t_run(:'ghost_bump_q') AS stranger_ghost_open,
       t_run(:'ghost_claimed_q') AS stranger_ghost_claimed,
       t_run(:'land_q') AS stranger_land,
       t_run(:'set_q') AS stranger_set,
       t_run(:'img_no_after_q') AS stranger_img \gset
RESET ROLE;
SELECT t_assert(:stranger_rows = 2 AND :'stranger_notes' = 'note 1 owner public,note 8 inactive'
  AND :stranger_view = 1 AND :'stranger_vins' = 'VINPUB',
  'after: a signed-in stranger reads the two garage rows and, through the view, the one row on the public vehicle');
SELECT t_assert(:'stranger_ghost_open' = '1' AND :'stranger_ghost_claimed' = '0',
  'after: a signed-in caller still updates an unclaimed device profile and not one another account claimed');
SELECT t_assert(:'stranger_land' = '42501', 'after: a signed-in caller is refused 42501 by the landing wrapper');
SELECT t_assert(:stranger_events = :before_stranger_events, 'after: a stranger reads the events it read before');
SELECT t_assert(:'stranger_set' = '42501' AND :'stranger_img' = '1'
  AND NOT (SELECT is_approved FROM public.vehicle_images WHERE id = :'img_no_after'),
  'after: a stranger is still refused by the image-set insert policy, and its upload is still not approved');

--    The fourth account: its own row and the garage rows. Its row is on a vehicle it cannot read, so the view no
--    longer shows it and the image-set insert policy no longer admits it.
SET ROLE authenticated; SET request.jwt.claims = :'fourth_jwt';
SELECT (SELECT count(*) FROM public.vehicle_user_permissions) AS fourth_rows,
       (SELECT coalesce(string_agg(context, ',' ORDER BY id), '') FROM public.vehicle_user_permissions) AS fourth_notes,
       (SELECT count(*) FROM public.user_vehicle_roles) AS fourth_view,
       (SELECT coalesce(string_agg(DISTINCT vin, ',' ORDER BY vin), '') FROM public.user_vehicle_roles) AS fourth_vins,
       (SELECT count(*) FROM public.vehicles) AS fourth_vehicles,
       t_run(:'set_q') AS fourth_set \gset
RESET ROLE;
SELECT t_assert(:fourth_rows = 3 AND :'fourth_notes' = 'note 1 owner public,note 8 inactive,note 10 fourth'
  AND :fourth_vehicles = :before_fourth_vehicles,
  'after: the fourth account reads its own row and the garage rows, and the vehicles it read before');
SELECT t_assert(:fourth_view = 1 AND :'fourth_vins' = 'VINPUB' AND :'fourth_set' = '42501',
  'after: a row on a vehicle its account cannot read no longer shows through the view, and the image-set insert policy no longer admits that account');

--    An admin reads permission rows as any signed-in account does; the access helper still shows it every vehicle.
SET ROLE authenticated; SET request.jwt.claims = :'admin_jwt';
SELECT (SELECT count(*) FROM public.vehicle_user_permissions) AS admin_rows,
       (SELECT count(*) FROM public.user_vehicle_roles) AS admin_view,
       (SELECT coalesce(string_agg(DISTINCT vin, ',' ORDER BY vin), '') FROM public.user_vehicle_roles) AS admin_vins,
       (SELECT count(*) FROM public.vehicles) AS admin_vehicles \gset
RESET ROLE;
SELECT t_assert(:admin_rows = 2 AND :admin_view = 1 AND :'admin_vins' = 'VINPUB' AND :admin_vehicles = :before_admin_vehicles,
  'after: an admin reads the two garage rows and, through the view, the one row on the public vehicle; it still reads every vehicle');

--    The third account: its own two rows and the garage rows (one of them on the vehicle whose user_id it is); the
--    two vehicles that are not public through its granted rows; the event its own row reaches; its update still
--    lands; the image-set insert policy still admits it and its upload is still approved.
SET ROLE authenticated; SET request.jwt.claims = :'third_jwt';
SELECT (SELECT count(*) FROM public.vehicle_user_permissions) AS third_rows,
       (SELECT coalesce(string_agg(context, ',' ORDER BY id), '') FROM public.vehicle_user_permissions) AS third_notes,
       (SELECT count(*) FROM public.user_vehicle_roles) AS third_view,
       (SELECT coalesce(string_agg(DISTINCT vin, ',' ORDER BY vin), '') FROM public.user_vehicle_roles) AS third_vins,
       (SELECT count(*) FROM public.timeline_events) AS third_events,
       (SELECT count(*) FROM public.vehicles) AS third_vehicles,
       t_run(:'fire_after_q') AS third_fire,
       t_run(:'set_q') AS third_set,
       t_run(:'img_ok_after_q') AS third_img \gset
RESET ROLE;
SELECT t_assert(:third_rows = 4 AND :'third_notes' = 'note 1 owner public,note 7 third,note 8 inactive,note 9 uploaded',
  'after: the third account reads its own two rows and the garage rows');
SELECT t_assert(:third_view = 3 AND :'third_vins' = 'VINPRIV,VINPUB,VINUP',
  'after: through the view the third account reads its own rows on the two vehicles that are not public and the garage row');
SELECT t_assert(:'third_set' = '1' AND :'third_img' = '1'
  AND (SELECT is_approved FROM public.vehicle_images WHERE id = :'img_ok_after'),
  'after: the image-set insert policy still admits an account whose row reaches a vehicle it can read, and its upload is still approved');
SELECT t_assert(:third_events = :before_third_events AND :third_vehicles = :before_third_vehicles,
  'after: the policy that reads the caller''s own permission rows and the vehicles'' access helper answer the third account as before');
SELECT t_assert(:'third_fire' = '1'
  AND (SELECT count(*) = 1 AND bool_and(include_classifier) FROM public.photo_land_progress WHERE image_id = :'img_after'),
  'after: a signed-in update that completes an image still fires the trigger and a landing row is written');

--    The owner: its own seven rows and the two other accounts' rows on the vehicle whose user_id it is. The sixth
--    vehicle names it only as uploader: it reads that vehicle, and not the third account's row on it. Through the
--    view, the eight of those rows that are active.
SET ROLE authenticated; SET request.jwt.claims = :'owner_jwt';
SELECT (SELECT count(*) FROM public.vehicle_user_permissions) AS owner_rows,
       (SELECT count(*) FROM public.vehicle_user_permissions WHERE context IS NOT NULL) AS owner_notes,
       (SELECT count(*) FROM public.vehicle_user_permissions WHERE id = 'b0000000-0000-4000-8000-000000000009') AS owner_row9,
       (SELECT count(*) FROM public.user_vehicle_roles) AS owner_view,
       (SELECT coalesce(string_agg(DISTINCT vin, ',' ORDER BY vin), '') FROM public.user_vehicle_roles) AS owner_vins,
       (SELECT count(*) FROM public.vehicles) AS owner_vehicles \gset
RESET ROLE;
SELECT t_assert(:owner_rows = 9 AND :owner_notes = 9 AND :owner_vehicles = :before_owner_vehicles,
  'after: the owner reads its own seven rows and the two on the vehicle whose user_id it is, with their notes, and the vehicles it read before');
SELECT t_assert(:owner_row9 = 0,
  'after: an account a vehicle names only as its uploader does not read another account''s row on that vehicle');
SELECT t_assert(:owner_view = 8 AND :'owner_vins' = 'VINDEL,VINPRIV,VINPUB,VINPUB2',
  'after: through the view the owner reads the eight active rows among them, the vehicle that is not public included');

--    The service role reads everything and runs the wrapper.
SET ROLE service_role; SET request.jwt.claims = '{"role": "service_role"}';
SELECT (SELECT count(*) FROM public.vehicle_user_permissions) AS service_rows,
       (SELECT count(*) FROM public.user_vehicle_roles) AS service_view,
       t_run(:'ghost_bump_q') AS service_ghost,
       t_run(:'land_q') AS service_land \gset
RESET ROLE;
SELECT t_assert(:service_rows = 10 AND :service_view = 9 AND :'service_ghost' = '1',
  'after: the service role reads all ten rows, the view''s nine and updates a device profile');
SELECT t_assert(:'service_land' = '1'
  AND (SELECT count(*) = 2 FROM public.photo_land_progress WHERE image_id = :'img_call'),
  'after: the service role runs the landing wrapper and a landing row is written');

-- 4. The catalog. What the migration changed, and that nothing else did.
SELECT t_assert(NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vehicle_user_permissions' AND cmd IN ('SELECT', 'ALL')
      AND regexp_replace(coalesce(qual, ''), '[\s()]', '', 'g') = 'true'),
  'no read policy on the permission table admits every row');
SELECT t_assert((SELECT roles::text = '{anon,authenticated}' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_user_permissions'
      AND policyname = 'vup_select_public_garage'),
  'vup_select_public_garage is a permissive SELECT policy for anon and authenticated');
SELECT t_assert((SELECT count(*) = 5 AND bool_and(p.cmd = b.cmd AND p.permissive = b.permissive AND p.roles::text = b.roles
      AND p.qual IS NOT DISTINCT FROM b.qual AND p.with_check IS NOT DISTINCT FROM b.with_check)
    FROM pg_policies p JOIN public.t_before_policies b USING (tablename, policyname)
   WHERE p.schemaname = 'public' AND p.tablename = 'vehicle_user_permissions')
  AND (SELECT count(*) = 6 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_user_permissions'),
  'the other five permission policies are what they were, and the table has six');
SELECT t_assert((SELECT relacl::text FROM pg_class WHERE oid = 'public.vehicle_user_permissions'::regclass)
    = (SELECT vup_acl FROM public.t_before_catalog),
  'the permission table''s grants are what they were');
SELECT t_assert((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = 'public.user_vehicle_roles'::regclass)
  AND pg_get_viewdef('public.user_vehicle_roles'::regclass, true) = (SELECT view_def FROM public.t_before_catalog)
  AND (SELECT relacl::text FROM pg_class WHERE oid = 'public.user_vehicle_roles'::regclass) = (SELECT view_acl FROM public.t_before_catalog),
  'the roles view runs as its caller; its definition and grants are what they were');
SELECT t_assert(NOT has_table_privilege('anon', 'public.ghost_users', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.ghost_users', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.ghost_users', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.ghost_users', 'TRUNCATE')
  AND has_table_privilege('anon', 'public.ghost_users', 'SELECT')
  AND has_table_privilege('authenticated', 'public.ghost_users', 'UPDATE')
  AND has_table_privilege('service_role', 'public.ghost_users', 'UPDATE'),
  'anon keeps SELECT alone on device profiles; authenticated and the service role keep UPDATE');
SELECT t_assert((SELECT p.roles::text = '{authenticated}' AND p.cmd = b.cmd AND p.qual IS NOT DISTINCT FROM b.qual
      AND p.with_check IS NOT DISTINCT FROM b.with_check
    FROM pg_policies p JOIN public.t_before_policies b USING (tablename, policyname)
   WHERE p.schemaname = 'public' AND p.tablename = 'ghost_users' AND p.policyname = 'ghost_users_authenticated_claim')
  AND (SELECT p.roles::text = b.roles AND p.qual IS NOT DISTINCT FROM b.qual
    FROM pg_policies p JOIN public.t_before_policies b USING (tablename, policyname)
   WHERE p.schemaname = 'public' AND p.tablename = 'ghost_users' AND p.policyname = 'ghost_users_public_read')
  AND (SELECT count(*) = 2 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ghost_users'),
  'the device-profile update policy applies to authenticated with the test it had; the read policy is what it was');
SELECT t_assert(NOT has_function_privilege('anon', 'public.photo_land_classification(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.photo_land_classification(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.photo_land_classification(uuid)', 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                   WHERE p.oid = 'public.photo_land_classification(uuid)'::regprocedure AND a.grantee = 0),
  'no EXECUTE for PUBLIC, anon or authenticated on the landing wrapper; the service role keeps it');
SELECT t_assert((SELECT p.prosrc = b.wrapper_src AND p.prosecdef = b.wrapper_definer AND p.proconfig::text IS NOT DISTINCT FROM b.wrapper_config
    FROM pg_proc p, public.t_before_catalog b WHERE p.oid = 'public.photo_land_classification(uuid)'::regprocedure)
  AND (SELECT proacl::text FROM pg_proc WHERE oid = 'public.photo_land_classification(uuid, boolean)'::regprocedure)
    = (SELECT writer_acl FROM public.t_before_catalog),
  'the wrapper''s body, SECURITY DEFINER and settings and the two-argument writer''s grants are what they were');
SELECT 'logged-out permission rows, device profiles and landing call contract: PASS' AS result;
