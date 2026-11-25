-- guardrail-allow(center-key-fk): vehicle_images.vehicle_id: synthetic fixture table in a throwaway contract database, never deployed
-- guardrail-allow(center-key-fk): organization_vehicles.vehicle_id: synthetic fixture table in a throwaway contract database, never deployed
-- guardrail-allow(center-key-fk): image_work_extractions.vehicle_id: synthetic fixture table in a throwaway contract database, never deployed
-- guardrail-allow(center-key-fk): work_organization_matches.vehicle_id: synthetic fixture table in a throwaway contract database, never deployed
-- Isolated PostgreSQL 17 contract: the self-made organization chain against the read policies that trust any organization
-- link. Live policy text (read 2026-11-25), verbatim, run as a real authenticated role. Synthetic rows only.
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in a throwaway contract database
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
SET client_min_messages = notice;
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$a$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $a$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$a$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') $a$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;

CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, uploaded_by uuid, user_id uuid, owner_id uuid, created_by_user_id uuid,
  is_public boolean DEFAULT false);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  documented_by_user_id uuid, is_sensitive boolean, is_superseded boolean, vision_gate_status public.vision_gate_status);
CREATE TABLE public.organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_name text, discovered_by uuid, uploaded_by uuid);
CREATE TABLE public.business_ownership(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, owner_id uuid,
  ownership_percentage numeric, ownership_type text, ownership_title text, acquisition_date date, status text DEFAULT 'active',
  UNIQUE (business_id, owner_id));
CREATE TABLE public.organization_contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid,
  role text, status text DEFAULT 'active', verification_method text NOT NULL DEFAULT 'self_claimed', verified_by uuid,
  verified_at timestamptz, UNIQUE (organization_id, user_id));
CREATE TABLE public.organization_vehicles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, vehicle_id uuid,
  relationship_type text, status text, linked_by_user_id uuid);
CREATE TABLE public.image_work_extractions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid NOT NULL, vehicle_id uuid NOT NULL);
CREATE TABLE public.vehicle_relationship_verifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_vehicle_id uuid NOT NULL, requested_by_user_id uuid NOT NULL, verification_type text NOT NULL, status text DEFAULT 'pending');
CREATE TABLE public.work_organization_matches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  matched_organization_id uuid NOT NULL, match_probability numeric NOT NULL);
CREATE TABLE public.admin_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, is_active boolean);
CREATE TABLE public.ownership_verifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid, status text);
CREATE TABLE public.vehicle_user_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  role text, is_active boolean, granted_by uuid);
CREATE TABLE public.vehicle_contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  role text, status text, can_edit boolean, organization_id uuid);

-- Live trigger bodies, verbatim.
CREATE FUNCTION public.create_initial_business_ownership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        INSERT INTO public.business_ownership (business_id, owner_id, ownership_percentage, ownership_type, ownership_title, acquisition_date)
        VALUES (NEW.id, auth.uid(), 100.00, 'founder', 'Founder/Owner', CURRENT_DATE)
        ON CONFLICT (business_id, owner_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$function$;
CREATE TRIGGER trigger_create_initial_business_ownership AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.create_initial_business_ownership();
CREATE OR REPLACE FUNCTION public.stamp_organization_vehicle_linker()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.linked_by_user_id := auth.uid();
  ELSIF (NEW.vehicle_id, NEW.organization_id, NEW.relationship_type, NEW.status, NEW.linked_by_user_id)
        IS DISTINCT FROM (OLD.vehicle_id, OLD.organization_id, OLD.relationship_type, OLD.status, OLD.linked_by_user_id) THEN
    NEW.linked_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_stamp_organization_vehicle_linker BEFORE INSERT OR UPDATE ON public.organization_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_organization_vehicle_linker();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['vehicles','vehicle_images','organizations','business_ownership','organization_contributors',
    'organization_vehicles','image_work_extractions','vehicle_relationship_verifications','work_organization_matches'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, anon', t);
  END LOOP;
END $$;
GRANT INSERT ON public.organizations, public.organization_contributors, public.organization_vehicles,
  public.vehicle_relationship_verifications TO authenticated;
GRANT UPDATE, DELETE ON public.vehicle_relationship_verifications TO authenticated;
CREATE POLICY read_fx ON public.vehicles FOR SELECT USING (true);
CREATE POLICY read_fx ON public.organizations FOR SELECT USING (true);
CREATE POLICY "Owners read own ownership" ON public.business_ownership FOR SELECT USING ((owner_id = ( SELECT auth.uid() AS uid)));

-- Live policies, verbatim (2026-11-25).
CREATE POLICY "Users create orgs" ON public.organizations FOR INSERT WITH CHECK (((( SELECT auth.uid() AS uid) = discovered_by) OR (( SELECT auth.uid() AS uid) = uploaded_by)));
CREATE POLICY organization_contributors_select ON public.organization_contributors FOR SELECT USING (true);
CREATE POLICY organization_contributors_insert ON public.organization_contributors FOR INSERT WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (((user_id = ( SELECT auth.uid() AS uid)) AND (role = ANY (ARRAY['contributor'::text, 'photographer'::text])) AND (status = 'pending'::text) AND (verification_method = 'self_claimed'::text) AND (verified_by IS NULL) AND (verified_at IS NULL)) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (role = 'owner'::text) AND (verification_method = 'self_claimed'::text) AND (verified_by IS NULL) AND (verified_at IS NULL) AND (EXISTS ( SELECT 1
   FROM business_ownership bo
  WHERE ((bo.business_id = organization_contributors.organization_id) AND (bo.owner_id = ( SELECT auth.uid() AS uid)) AND (bo.status = 'active'::text))))) OR (EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = organization_contributors.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'co_founder'::text])) AND (oc.status = 'active'::text)))))));
CREATE POLICY "Anyone views org-vehicle links" ON public.organization_vehicles FOR SELECT USING (true);
CREATE POLICY organization_vehicles_select ON public.organization_vehicles FOR SELECT USING (true);
CREATE POLICY "Users/owners manage links" ON public.organization_vehicles FOR ALL USING (((linked_by_user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM vehicles v
  WHERE ((v.id = organization_vehicles.vehicle_id) AND (v.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = organization_vehicles.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'manager'::text, 'board_member'::text])) AND (oc.status = 'active'::text))))));

CREATE POLICY "Users can view images for public vehicles" ON public.vehicle_images FOR SELECT USING (((COALESCE(is_sensitive, false) = false) AND (COALESCE(is_superseded, false) = false) AND ((vision_gate_status IS NULL) OR (vision_gate_status <> ALL (ARRAY['rejected_personal'::vision_gate_status, 'rejected_misattributed'::vision_gate_status, 'review_needed'::vision_gate_status]))) AND (EXISTS ( SELECT 1
   FROM vehicles v
  WHERE ((v.id = vehicle_images.vehicle_id) AND (v.is_public = true))))));
CREATE POLICY "Users can view images for vehicles they own" ON public.vehicle_images FOR SELECT USING ((EXISTS ( SELECT 1
   FROM vehicles
  WHERE ((vehicles.id = vehicle_images.vehicle_id) AND ((vehicles.user_id = auth.uid()) OR (vehicles.uploaded_by = auth.uid()) OR (vehicles.owner_id = auth.uid()))))));
CREATE POLICY "Users can view their own images" ON public.vehicle_images FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY users_can_view_own_unorganized_images ON public.vehicle_images FOR SELECT USING (((vehicle_id IS NULL) AND ((user_id = auth.uid()) OR (documented_by_user_id = auth.uid()))));
CREATE POLICY "Organization members can view org vehicle images" ON public.vehicle_images FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((ov.organization_id = oc.organization_id)))
  WHERE ((ov.vehicle_id = vehicle_images.vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text)))));
CREATE POLICY "View work extractions" ON public.image_work_extractions FOR SELECT USING (((EXISTS ( SELECT 1
   FROM organization_vehicles ov
  WHERE ((ov.vehicle_id = image_work_extractions.vehicle_id) AND (EXISTS ( SELECT 1
           FROM organization_contributors oc
          WHERE ((oc.organization_id = ov.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text))))))) OR (EXISTS ( SELECT 1
   FROM vehicle_images vi
  WHERE ((vi.id = image_work_extractions.image_id) AND (vi.user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Org members can create verifications" ON public.vehicle_relationship_verifications FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((oc.organization_id = ov.organization_id)))
  WHERE ((ov.id = vehicle_relationship_verifications.organization_vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text)))) AND (requested_by_user_id = ( SELECT auth.uid() AS uid))));
CREATE POLICY "Org members can view verifications" ON public.vehicle_relationship_verifications FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((oc.organization_id = ov.organization_id)))
  WHERE ((ov.id = vehicle_relationship_verifications.organization_vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text)))));
CREATE POLICY "Org owners can manage verifications" ON public.vehicle_relationship_verifications FOR ALL USING ((EXISTS ( SELECT 1
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((oc.organization_id = ov.organization_id)))
  WHERE ((ov.id = vehicle_relationship_verifications.organization_vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text) AND (oc.role = ANY (ARRAY['owner'::text, 'co_founder'::text, 'manager'::text, 'board_member'::text]))))));
CREATE POLICY "View work matches" ON public.work_organization_matches FOR SELECT USING (((EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = work_organization_matches.matched_organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text)))) OR (EXISTS ( SELECT 1
   FROM organization_vehicles ov
  WHERE ((ov.vehicle_id = work_organization_matches.vehicle_id) AND (EXISTS ( SELECT 1
           FROM organization_contributors oc2
          WHERE ((oc2.organization_id = ov.organization_id) AND (oc2.user_id = ( SELECT auth.uid() AS uid)) AND (oc2.status = 'active'::text)))))))));

SELECT t_assert((SELECT md5(string_agg(c.relname || '.' || p.polname || ':' || p.polcmd::text || ':' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
    || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), '|' ORDER BY c.relname, p.polname))
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relname IN ('vehicle_images', 'image_work_extractions', 'vehicle_relationship_verifications', 'work_organization_matches')
    AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'organization_vehicles')
  = 'dde57bb446994ca0f6340a406e466910', 'the fixture reproduces the six live organization-link policies'); -- gitleaks:allow (policy fingerprint, not a secret)

-- O owns private car P. O's photo on P, a work extraction from it, a work match for it, and a verification on O's own
-- organization link (L_O) for P.
\set O  '''0a000000-0000-0000-0000-0000000000a0'''
\set Z  '''0c100000-0000-0000-0000-0000000000c1'''
\set P  '''e0000000-0000-0000-0000-00000000000e'''
\set OG '''93000000-0000-0000-0000-000000000039'''
\set ZG '''92000000-0000-0000-0000-000000000029'''
\set I  '''30000000-0000-0000-0000-000000000003'''
INSERT INTO vehicles(id, user_id, owner_id, is_public) VALUES (:P, :O, :O, false);
INSERT INTO vehicle_images(id, vehicle_id, user_id) VALUES (:I, :P, :O);
INSERT INTO image_work_extractions(image_id, vehicle_id) VALUES (:I, :P);
INSERT INTO organizations(id, business_name, discovered_by) VALUES (:OG, 'owner shop', :O);
INSERT INTO organization_contributors(organization_id, user_id, role, status) VALUES (:OG, :O, 'owner', 'active');
INSERT INTO organization_vehicles(id, organization_id, vehicle_id, relationship_type, status, linked_by_user_id)
VALUES ('40000000-0000-0000-0000-000000000004', :OG, :P, 'owner', 'active', :O);
INSERT INTO vehicle_relationship_verifications(organization_vehicle_id, requested_by_user_id, verification_type)
VALUES ('40000000-0000-0000-0000-000000000004', :O, 'title');
INSERT INTO work_organization_matches(vehicle_id, matched_organization_id, match_probability) VALUES (:P, :OG, 0.9);

CREATE FUNCTION public.reads_as(p_user uuid, p_vehicle uuid, OUT images int, OUT extractions int, OUT verifications int, OUT matches int)
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO images FROM public.vehicle_images WHERE vehicle_id = p_vehicle;
  SELECT count(*) INTO extractions FROM public.image_work_extractions WHERE vehicle_id = p_vehicle;
  SELECT count(*) INTO verifications FROM public.vehicle_relationship_verifications vrv
    JOIN public.organization_vehicles ov ON ov.id = vrv.organization_vehicle_id WHERE ov.vehicle_id = p_vehicle;
  SELECT count(*) INTO matches FROM public.work_organization_matches WHERE vehicle_id = p_vehicle;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
END $f$;

SELECT t_assert((SELECT images = 0 AND extractions = 0 AND verifications = 0 AND matches = 0 FROM reads_as(:Z, :P)),
  'a stranger with no organization reads nothing of the private car');

-- The chain, as Z through the client policies.
SELECT set_config('request.jwt.claims', json_build_object('sub', :Z, 'role', 'authenticated')::text, false);
SET ROLE authenticated;
INSERT INTO organizations(id, business_name, discovered_by) VALUES (:ZG, 'self-made', auth.uid());
INSERT INTO organization_contributors(organization_id, user_id, role, verification_method) VALUES (:ZG, auth.uid(), 'owner', 'self_claimed');
INSERT INTO organization_vehicles(id, organization_id, vehicle_id, relationship_type, status)
VALUES ('50000000-0000-0000-0000-000000000005', :ZG, :P, 'service_provider', 'active');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT t_assert((SELECT linked_by_user_id FROM organization_vehicles WHERE id = '50000000-0000-0000-0000-000000000005') = :Z::uuid,
  'the stamp recorded Z as the linker');

SELECT t_assert((SELECT images = 1 AND extractions = 1 AND verifications = 0 AND matches = 1 FROM reads_as(:Z, :P)),
  'before: the self-made organization owner reads the private car''s photos, extractions and matches (not other links'' verifications)');
SELECT set_config('request.jwt.claims', json_build_object('sub', :Z, 'role', 'authenticated')::text, false);
SET ROLE authenticated;
INSERT INTO vehicle_relationship_verifications(organization_vehicle_id, requested_by_user_id, verification_type, status)
VALUES ('50000000-0000-0000-0000-000000000005', auth.uid(), 'sale', 'approved');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT t_assert((SELECT count(*) FROM vehicle_relationship_verifications WHERE status = 'approved') = 1,
  'before: on its own untied link, it inserts a verification already marked approved');

-- Stand-ins for the three definer readers: the live organization-member anchors, verbatim, inside minimal bodies
-- (the live bodies are larger; the migration refuses unless each live anchor occurs exactly once).
CREATE FUNCTION public.work_order_evidence_image_visible(p_image_id uuid, p_viewer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_images vi JOIN public.vehicles v ON v.id = vi.vehicle_id WHERE vi.id = p_image_id AND (
    (p_viewer IS NOT NULL AND (vi.user_id = p_viewer OR v.user_id = p_viewer OR v.uploaded_by = p_viewer OR v.owner_id = p_viewer
      OR EXISTS (SELECT 1 FROM public.organization_vehicles ov JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
        WHERE ov.vehicle_id = vi.vehicle_id AND oc.user_id = p_viewer AND oc.status = 'active')))))
$function$;
CREATE FUNCTION public.vehicle_card_images(p_ids uuid[]) RETURNS TABLE(id uuid, mine boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH ids AS (SELECT unnest(p_ids) AS id), me AS (SELECT auth.uid() AS uid)
  SELECT v.id,
           (me.uid IS NOT NULL AND (
              v.user_id = me.uid OR v.uploaded_by = me.uid OR v.owner_id = me.uid
              OR EXISTS (SELECT 1
                         FROM organization_vehicles ov
                         JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
                         WHERE ov.vehicle_id = v.id AND oc.user_id = me.uid AND oc.status = 'active')
           )) AS mine
    FROM ids
    JOIN vehicles v ON v.id = ids.id
    CROSS JOIN me
$function$;
CREATE FUNCTION public.get_vehicle_profile_data(p_vehicle_id uuid) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_org_member boolean;
BEGIN
  v_org_member := v_uid IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.organization_vehicles ov
    JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
    WHERE ov.vehicle_id = p_vehicle_id
      AND oc.user_id = v_uid
      AND oc.status = 'active'
  );
  RETURN json_build_object('org_member', v_org_member);
END $function$;

CREATE FUNCTION public.readers_as(p_user uuid, OUT wo boolean, OUT card boolean, OUT profile boolean) LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  wo := public.work_order_evidence_image_visible('30000000-0000-0000-0000-000000000003', p_user);
  card := coalesce((SELECT c.mine FROM public.vehicle_card_images(ARRAY['e0000000-0000-0000-0000-00000000000e'::uuid]) c), false);
  profile := (public.get_vehicle_profile_data('e0000000-0000-0000-0000-00000000000e') ->> 'org_member')::boolean;
  PERFORM set_config('request.jwt.claims', '', true);
END $f$;
SELECT t_assert((SELECT wo AND card AND profile FROM readers_as(:Z)), 'before: all three definer readers count Z as an organization member of the car');

-- The policy-copy registry (20261125204500), table and hash function verbatim.
CREATE TABLE public.private_row_policy_copies (
  reader        text NOT NULL CHECK (reader ~ '^[a-z_][a-z0-9_]*\(([a-z_][a-z0-9_ ]*(\[\])?(, *[a-z_][a-z0-9_ ]*(\[\])?)*)?\)$'),
  relation      text NOT NULL CHECK (relation ~ '^[a-z_][a-z0-9_]*$'),
  policy_filter text NOT NULL CHECK (policy_filter <> '' AND position(';' IN policy_filter) = 0),
  recorded_hash text NOT NULL CHECK (recorded_hash ~ '^[0-9a-f]{32}$'),
  owner_lane    text NOT NULL,
  note          text NOT NULL CHECK (note <> ''),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  active        boolean NOT NULL DEFAULT true,
  PRIMARY KEY (reader, relation, policy_filter)
);
CREATE OR REPLACE FUNCTION public.private_row_policy_hash(p_relation text, p_policy_filter text)
RETURNS TABLE (policy_hash text, policies int) LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $f$
BEGIN
  IF p_relation !~ '^[a-z_][a-z0-9_]*$' OR position(';' IN p_policy_filter) > 0 THEN
    RAISE EXCEPTION 'private_row_policy_hash: bad relation or filter';
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT md5(string_agg(p.policyname || '':'' || p.permissive || '':'' || p.cmd || '':'' || p.roles::text || '':'' || coalesce(p.qual, ''''),
                           ''|'' ORDER BY p.policyname)), count(*)::int
       FROM pg_catalog.pg_policies p WHERE p.schemaname = ''public'' AND p.tablename = %L AND (%s)', p_relation, p_policy_filter);
END $f$;
INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
SELECT r, 'vehicle_images', 'p.cmd IN (''SELECT'', ''ALL'')', h.policy_hash, 'ta-pipeline', 'fixture copy'
FROM unnest(ARRAY['get_image_deep_analysis(uuid)', 'intake_live_state(integer,integer)']) r,
     public.private_row_policy_hash('vehicle_images', 'p.cmd IN (''SELECT'', ''ALL'')') h;
SELECT policy_hash AS vi_hash_before FROM public.private_row_policy_hash('vehicle_images', 'p.cmd IN (''SELECT'', ''ALL'')') \gset

CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  -- fixture stand-in for the reviewed tie rule: the car's own people or an active admin
  SELECT p_user_id IS NOT NULL AND (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id
           AND p_user_id IN (v.user_id, v.owner_id, v.uploaded_by))
         OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = p_user_id AND au.is_active))
$f$;

-- organization_vehicle_link_grants, as 20261126031500 creates it.
CREATE OR REPLACE FUNCTION public.organization_vehicle_link_grants(p_vehicle_id uuid, p_linker uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE t.tgrelid = 'public.organization_vehicles'::regclass
             AND t.tgname = 'trg_stamp_organization_vehicle_linker'
             AND t.tgenabled IN ('O', 'A') AND (t.tgtype & 23) = 23
             AND p.pronamespace = 'public'::regnamespace AND p.proname = 'stamp_organization_vehicle_linker'
             AND md5(p.prosrc) = '9e8299a8e5024d4404e03d55ced96413') -- gitleaks:allow (function-body fingerprint, not a secret)
     AND (p_linker IS NULL
          OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id
                       AND p_linker IN (v.uploaded_by, v.user_id, v.owner_id, v.created_by_user_id))
          OR public.vehicle_user_has_access(p_vehicle_id, p_linker))
$function$;
REVOKE ALL ON FUNCTION public.organization_vehicle_link_grants(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_vehicle_link_grants(uuid, uuid) TO authenticated, service_role;
-- The migration.
\ir ../migrations/20261126034500_org_link_reads_tied_linker.sql

SELECT t_assert((SELECT images = 0 AND extractions = 0 AND verifications = 0 AND matches = 0 FROM reads_as(:Z, :P)),
  'after: the untied link reads none of the car''s photos, extractions, verifications or matches');
SELECT t_assert((SELECT NOT wo AND NOT card AND NOT profile FROM readers_as(:Z)),
  'after: none of the three definer readers counts Z as an organization member of the car');
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '0c100000-0000-0000-0000-0000000000c1', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.vehicle_relationship_verifications(organization_vehicle_id, requested_by_user_id, verification_type, status)
    VALUES ('50000000-0000-0000-0000-000000000005', '0c100000-0000-0000-0000-0000000000c1', 'sale', 'approved');
    RAISE EXCEPTION 'FAIL: a verification on an untied link was accepted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: after: a verification on an untied link is refused';
  END;
  RESET ROLE;
END $$;

-- O, the owner, links P to its own shop with a member M: the tied link still grants reads and the readers.
\set M '''0d000000-0000-0000-0000-0000000000d0'''
INSERT INTO organization_contributors(organization_id, user_id, role, status) VALUES (:OG, :M, 'employee', 'active');
SELECT t_assert((SELECT images = 1 AND extractions = 1 AND verifications = 1 AND matches = 1 FROM reads_as(:M, :P)),
  'after: a member of the organization the owner linked still reads photos, extractions, verifications and matches');
SELECT t_assert((SELECT wo AND card AND profile FROM readers_as(:M)), 'after: the three readers still count that member');
SELECT t_assert((SELECT images = 1 FROM reads_as(:O, :P)), 'after: the owner still reads the car''s photos');

-- Fail closed with the rule: no stamp trigger, no organization grant anywhere.
DROP TRIGGER trg_stamp_organization_vehicle_linker ON public.organization_vehicles;
SELECT t_assert((SELECT images = 0 AND extractions = 0 AND verifications = 0 FROM reads_as(:M, :P)) AND (SELECT NOT wo FROM readers_as(:M)),
  'trigger dropped: the tied link grants no photo, extraction or verification read either (the match row names the shop itself)');
CREATE TRIGGER trg_stamp_organization_vehicle_linker BEFORE INSERT OR UPDATE ON public.organization_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_organization_vehicle_linker();

-- Catalog shape.
SELECT t_assert((SELECT bool_and(p.polroles = ARRAY['authenticated'::regrole::oid]) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relname IN ('vehicle_images', 'image_work_extractions', 'vehicle_relationship_verifications', 'work_organization_matches')
    AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'organization_vehicles'
    AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'organization_vehicle_link_grants'),
  'all six organization-link policies call the rule and apply to authenticated only');
SELECT t_assert((SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relname IN ('vehicle_images', 'image_work_extractions', 'vehicle_relationship_verifications', 'work_organization_matches')
    AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'organization_vehicle_link_grants') = 6,
  'six policies changed');
SET ROLE anon;
SELECT t_assert((SELECT count(*) FROM public.vehicle_images) = 0, 'anon reads vehicle_images without touching the rule (no permission error)');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM public.private_row_policy_copies WHERE relation = 'vehicle_images'
    AND policy_filter = 'p.policyname = ''Organization members can view org vehicle images''') = 3
  AND (SELECT bool_and(recorded_hash = (SELECT policy_hash FROM public.private_row_policy_hash(relation, policy_filter)))
       FROM public.private_row_policy_copies),
  'the three readers are registered as copies, and every recorded hash equals the live one');
SELECT t_assert(:'vi_hash_before' <> (SELECT recorded_hash FROM public.private_row_policy_copies WHERE reader = 'get_image_deep_analysis(uuid)'),
  'the existing vehicle_images copies moved to the new hash');

-- Re-apply.
SELECT md5(string_agg(pg_get_functiondef(oid), '|' ORDER BY proname)) AS readers_after FROM pg_proc
WHERE proname IN ('work_order_evidence_image_visible', 'vehicle_card_images', 'get_vehicle_profile_data') \gset
\ir ../migrations/20261126034500_org_link_reads_tied_linker.sql
SELECT t_assert((SELECT md5(string_agg(pg_get_functiondef(oid), '|' ORDER BY proname)) FROM pg_proc
  WHERE proname IN ('work_order_evidence_image_visible', 'vehicle_card_images', 'get_vehicle_profile_data')) = :'readers_after',
  're-applying the migration changes nothing');
