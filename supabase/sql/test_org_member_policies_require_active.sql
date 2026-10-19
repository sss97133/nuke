-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_org_member_policies -f this-file.sql
-- Proves that after 20261020150000_org_member_policies_require_active.sql a signed-in stranger can no longer read an
-- organization's deal records (contacts, jackets, documents, reconditioning, vehicle details, behavior signals) or its
-- other member-only rows through a pending join request, a contractor work row, an approved ownership claim or an
-- inactive membership, while active staff keep every read, an active community member keeps the non-deal reads, and
-- the founder still takes the owner seat. Starts from the live policies and trigger as read on 2026-10-19
-- (helpers/org_member_policies_live_20261019.sql) and shows each route working there first.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.organization_contributors') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'org_member_owner') THEN CREATE ROLE org_member_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, org_member_owner;
GRANT CREATE ON SCHEMA public TO org_member_owner;

-- The tables with the columns, checks and keys the policies, the trigger and the writes touch, owned (like
-- production's postgres) by the role that owns the definer trigger, every privilege granted to the API roles.
SET ROLE org_member_owner;
CREATE TYPE public.intel_visibility AS ENUM ('public', 'org', 'deal', 'principals', 'privileged');
CREATE TABLE public.organization_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid,
  role text NOT NULL CHECK (role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee', 'technician',
    'contractor', 'moderator', 'contributor', 'photographer', 'historian')),
  start_date date DEFAULT CURRENT_DATE,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  contribution_count integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  verification_method text NOT NULL DEFAULT 'self_claimed',
  verified_by uuid,
  verified_at timestamptz,
  UNIQUE (organization_id, user_id)
);
CREATE TABLE public.business_ownership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, owner_id uuid NOT NULL,
  status text DEFAULT 'active');
CREATE TABLE public.organization_ownership_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, user_id uuid NOT NULL, status text);
CREATE TABLE public.contractor_work_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contractor_user_id uuid NOT NULL, organization_id uuid NOT NULL,
  work_description text NOT NULL, work_date date NOT NULL);
CREATE TABLE public.deal_jackets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, visibility public.intel_visibility, created_by uuid);
CREATE TABLE public.deal_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, full_name text);
CREATE TABLE public.deal_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deal_id uuid);
CREATE TABLE public.deal_reconditioning (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deal_id uuid);
CREATE TABLE public.deal_vehicle_details (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid);
CREATE TABLE public.organization_behavior_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, visibility public.intel_visibility, reported_by uuid);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text, entity_id uuid, uploaded_by uuid, is_public boolean);
CREATE TABLE public.organization_vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, organization_id uuid);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.image_work_extractions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, vehicle_id uuid);
CREATE TABLE public.location_collaborations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), location_address text, organization_id uuid);
CREATE TABLE public.organization_capabilities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid);
CREATE TABLE public.work_organization_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, matched_organization_id uuid);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['organization_contributors', 'business_ownership', 'organization_ownership_verifications',
      'contractor_work_contributions', 'deal_jackets', 'deal_contacts', 'deal_documents', 'deal_reconditioning',
      'deal_vehicle_details', 'organization_behavior_signals', 'documents', 'image_work_extractions',
      'location_collaborations', 'organization_capabilities', 'work_organization_matches'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
\ir helpers/org_member_policies_live_20261019.sql
-- The trigger as live (pg_get_functiondef, 2026-10-19).
CREATE OR REPLACE FUNCTION public.update_contractor_contribution_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Increment contribution count for the contractor
  INSERT INTO organization_contributors (
    organization_id,
    user_id,
    role,
    contribution_count,
    start_date
  )
  VALUES (
    NEW.organization_id,
    NEW.contractor_user_id,
    'technician', -- Default role for contractors
    1,
    NEW.work_date
  )
  ON CONFLICT (organization_id, user_id) 
  DO UPDATE SET
    contribution_count = organization_contributors.contribution_count + 1,
    updated_at = NOW();
  
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_update_contractor_count AFTER INSERT ON public.contractor_work_contributions
  FOR EACH ROW EXECUTE FUNCTION update_contractor_contribution_count();
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_is(p_got text, p_want text, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_got IS DISTINCT FROM p_want THEN RAISE EXCEPTION 'FAIL: % (got %, want %)', p_what, p_got, p_want; END IF; END $$;
-- true when the statement raised insufficient_privilege (a policy refused the row), false when it ran.
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
-- The rows of a table the caller reads, or 'recursion' when its policies recurse (live location_collaborations).
CREATE FUNCTION public.t_count(p_table text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN EXECUTE format('SELECT count(*) FROM public.%I', p_table) INTO n; RETURN n::text;
EXCEPTION WHEN invalid_object_definition THEN
  IF SQLERRM LIKE 'infinite recursion detected in policy%' THEN RETURN 'recursion'; END IF;
  RAISE;
END $$;
-- What the caller reads of the seeded organization, one count per table.
CREATE FUNCTION public.t_reads() RETURNS text LANGUAGE sql AS $$
  SELECT format('contacts=%s jackets=%s docs=%s recon=%s details=%s signals=%s | documents=%s extractions=%s locations=%s capabilities=%s matches=%s',
    public.t_count('deal_contacts'), public.t_count('deal_jackets'), public.t_count('deal_documents'),
    public.t_count('deal_reconditioning'), public.t_count('deal_vehicle_details'),
    public.t_count('organization_behavior_signals'), public.t_count('documents'), public.t_count('image_work_extractions'),
    public.t_count('location_collaborations'), public.t_count('organization_capabilities'),
    public.t_count('work_organization_matches')) $$;
-- The migration guard's hash over the 17 policies it changes.
CREATE FUNCTION public.t_policy_hash() RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT encode(sha256(convert_to(string_agg(
           c.relname || E'\t' || p.polname || E'\t' || p.polcmd::text || E'\t' || p.polpermissive::text || E'\t'
           || coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public')
           || E'\t' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || E'\t' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
           E'\n' ORDER BY c.relname, p.polname), 'UTF8')), 'base64')
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relnamespace = 'public'::regnamespace AND (c.relname, p.polname) IN (
    ('deal_contacts', 'deal_contacts_org'), ('deal_documents', 'deal_docs_org'), ('deal_jackets', 'deal_jackets_org'),
    ('deal_jackets', 'deal_jackets_principals'), ('deal_reconditioning', 'deal_recon_org'),
    ('deal_vehicle_details', 'deal_vehicle_details_org'), ('documents', 'documents_insert_policy'),
    ('documents', 'documents_view_policy'), ('image_work_extractions', 'View work extractions'),
    ('location_collaborations', 'Organizations can manage own location collaborations'),
    ('location_collaborations', 'Organizations can view location collaborations'),
    ('organization_behavior_signals', 'obs_deal'), ('organization_behavior_signals', 'obs_org'),
    ('organization_capabilities', 'Manage own capabilities'),
    ('organization_contributors', 'organization_contributors_insert'),
    ('work_organization_matches', 'Update own work matches'), ('work_organization_matches', 'View work matches')) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- 0. The fixture is the live state.
SELECT public.t_is(public.t_policy_hash(), 'kX06K1oOuKI+WcsbiyEKuqt1UOpAD1hVQNOWKa1oKjE=', 'fixture: the 17 policies as live');
SELECT public.t_is(encode(sha256(convert_to(prosrc, 'UTF8')), 'base64'), 'rgtwFqP2wymBua2yWWuC5Sn52BCmNur//kfHbyMlkr0=',
  'fixture: update_contractor_contribution_count as live')
FROM pg_proc WHERE oid = 'public.update_contractor_contribution_count()'::regprocedure;

-- Seeds. O1 has deal records and member-only rows. Active staff: board member B1, technician T1. Active community
-- member P1 (photographer). R1 a manager who left (inactive). F1 the founder (business_ownership, no member row yet).
-- C1 a claimant whose ownership claim was approved. Strangers X9 (join request) and K9 (contractor work row).
INSERT INTO public.deal_jackets (id, organization_id, visibility) VALUES
 ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'org'),
 ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'principals');
INSERT INTO public.deal_contacts (organization_id, full_name) SELECT '40000000-0000-0000-0000-000000000001', 'contact ' || g
  FROM generate_series(1, 3) g;
INSERT INTO public.deal_documents (deal_id) VALUES ('50000000-0000-0000-0000-000000000001'), ('50000000-0000-0000-0000-000000000001');
INSERT INTO public.deal_reconditioning (deal_id) VALUES ('50000000-0000-0000-0000-000000000001'), ('50000000-0000-0000-0000-000000000001');
INSERT INTO public.deal_vehicle_details (organization_id) VALUES ('40000000-0000-0000-0000-000000000001');
INSERT INTO public.organization_behavior_signals (organization_id, visibility) VALUES ('40000000-0000-0000-0000-000000000001', 'org');
INSERT INTO public.documents (entity_type, entity_id, is_public) VALUES ('organization', '40000000-0000-0000-0000-000000000001', false);
INSERT INTO public.organization_vehicles (vehicle_id, organization_id) VALUES ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001');
INSERT INTO public.image_work_extractions (vehicle_id) VALUES ('60000000-0000-0000-0000-000000000001');
INSERT INTO public.location_collaborations (location_address, organization_id) VALUES ('1 Shop Road', '40000000-0000-0000-0000-000000000001');
INSERT INTO public.organization_capabilities (organization_id) VALUES ('40000000-0000-0000-0000-000000000001');
INSERT INTO public.work_organization_matches (matched_organization_id) VALUES ('40000000-0000-0000-0000-000000000001');
INSERT INTO public.business_ownership (business_id, owner_id) VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000f1');
INSERT INTO public.organization_ownership_verifications (organization_id, user_id, status) VALUES
 ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', 'approved');
INSERT INTO public.organization_contributors (organization_id, user_id, role, status) VALUES
 ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', 'board_member', 'active'),
 ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000d1', 'technician', 'active'),
 ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1', 'photographer', 'active'),
 ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c2', 'manager', 'inactive');

\set none 'contacts=0 jackets=0 docs=0 recon=0 details=0 signals=0 | documents=0 extractions=0 locations=0 capabilities=0 matches=0'
\set member 'contacts=3 jackets=1 docs=2 recon=2 details=1 signals=1 | documents=1 extractions=1 locations=1 capabilities=0 matches=1'
\set manager 'contacts=3 jackets=1 docs=2 recon=2 details=1 signals=1 | documents=1 extractions=1 locations=1 capabilities=1 matches=1'
\set owner 'contacts=3 jackets=2 docs=2 recon=2 details=1 signals=1 | documents=1 extractions=1 locations=1 capabilities=1 matches=1'
\set community 'contacts=0 jackets=0 docs=0 recon=0 details=0 signals=0 | documents=1 extractions=1 locations=1 capabilities=0 matches=1'
-- Before, every signed-in read of location_collaborations fails: its view policy reads the table itself.
\set none_before 'contacts=0 jackets=0 docs=0 recon=0 details=0 signals=0 | documents=0 extractions=0 locations=recursion capabilities=0 matches=0'
\set member_before 'contacts=3 jackets=1 docs=2 recon=2 details=1 signals=1 | documents=1 extractions=1 locations=recursion capabilities=0 matches=1'
\set manager_before 'contacts=3 jackets=1 docs=2 recon=2 details=1 signals=1 | documents=1 extractions=1 locations=recursion capabilities=1 matches=1'
\set owner_before 'contacts=3 jackets=2 docs=2 recon=2 details=1 signals=1 | documents=1 extractions=1 locations=recursion capabilities=1 matches=1'

-- 1. Before: each route opens O1's deal records to someone who is not an active member.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
SELECT public.t_is(public.t_reads(), :'none_before', 'before: the stranger reads nothing');
BEGIN;
INSERT INTO public.organization_contributors (organization_id, user_id, role, status, verification_method)
  VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9', 'contributor', 'pending', 'self_claimed');
SELECT public.t_is(public.t_reads(), :'member_before', 'before: a pending join request reads the deal records');
ROLLBACK;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e8';
BEGIN;
INSERT INTO public.contractor_work_contributions (contractor_user_id, organization_id, work_description, work_date)
  VALUES ('20000000-0000-0000-0000-0000000000e8', '40000000-0000-0000-0000-000000000001', 'oil change', '2026-10-19');
SELECT public.t_is((SELECT status || '/' || role FROM public.organization_contributors WHERE user_id = '20000000-0000-0000-0000-0000000000e8'),
  'active/technician', 'before: a contractor work row seats an active technician');
SELECT public.t_is(public.t_reads(), :'member_before', 'before: and it reads the deal records');
ROLLBACK;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000c1';
BEGIN;
INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', 'owner', 'active');
SELECT public.t_is(public.t_reads(), :'owner_before', 'before: an approved claimant seats itself as owner and reads everything');
ROLLBACK;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000c2';
SELECT public.t_is(public.t_reads(), :'manager_before', 'before: a manager who left still reads everything');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_is(public.t_reads(), :'member_before', 'before: a photographer reads the deal contacts');
RESET ROLE;

-- 2. The migration, twice (the second run is a no-op past its guard).
SET test.auth_uid = '';
\ir ../migrations/20261020150000_org_member_policies_require_active.sql
\ir ../migrations/20261020150000_org_member_policies_require_active.sql
SELECT public.t_is(public.t_policy_hash(), 'nZRlpt0vTJqoOywE011A+bDUeU63Wul3vBcdAMWJrAo=', 'after: the policy set the guard accepts as done');
SELECT public.t_is(encode(sha256(convert_to(prosrc, 'UTF8')), 'base64'), '/STDsCeWEfsSzPZfI3Xg0bFxUQ/E7Eub8S85vwG6OOY=', 'after: the trigger body the guard accepts as done')
FROM pg_proc WHERE oid = 'public.update_contractor_contribution_count()'::regprocedure;

-- 3. After: no route reads O1's private rows; active members keep theirs.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
BEGIN;
INSERT INTO public.organization_contributors (organization_id, user_id, role, status, verification_method)
  VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9', 'contributor', 'pending', 'self_claimed');
SELECT public.t_is(public.t_reads(), :'none', 'after: a join request can still be filed and reads nothing');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.documents (entity_type, entity_id, uploaded_by)
  VALUES ('organization', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9')$q$),
  'after: a join request cannot file an organization document');
ROLLBACK;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e8';
BEGIN;
INSERT INTO public.contractor_work_contributions (contractor_user_id, organization_id, work_description, work_date)
  VALUES ('20000000-0000-0000-0000-0000000000e8', '40000000-0000-0000-0000-000000000001', 'oil change', '2026-10-19');
INSERT INTO public.contractor_work_contributions (contractor_user_id, organization_id, work_description, work_date)
  VALUES ('20000000-0000-0000-0000-0000000000e8', '40000000-0000-0000-0000-000000000001', 'brakes', '2026-10-19');
SELECT public.t_is((SELECT status || '/' || role || '/' || contribution_count FROM public.organization_contributors
  WHERE user_id = '20000000-0000-0000-0000-0000000000e8'), 'pending/technician/2', 'after: contractor work asks to join and still counts');
SELECT public.t_is(public.t_reads(), :'none', 'after: a contractor work row reads nothing');
ROLLBACK;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000c1';
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', 'owner', 'active')$q$),
  'after: an approved claim no longer seats an owner');
SELECT public.t_is(public.t_reads(), :'none', 'after: the claimant reads nothing');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000c2';
SELECT public.t_is(public.t_reads(), :'none', 'after: a manager who left reads nothing');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_is(public.t_reads(), :'community', 'after: an active photographer keeps the non-deal reads only');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b1';
SELECT public.t_is(public.t_reads(), :'manager', 'after: an active board member reads everything as before');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000d1';
SELECT public.t_is(public.t_reads(), :'member', 'after: an active technician reads the deal records as before');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000f1';
SELECT public.t_is(public.t_reads(), :'none', 'after: the founder without a member row reads nothing, as before');
BEGIN;
INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000f1', 'owner', 'active');
SELECT public.t_is(public.t_reads(), :'owner', 'after: the founder still takes the owner seat and reads everything');
INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9', 'manager', 'active');
ROLLBACK;
RESET ROLE;

SELECT 'org member policies require active: ok' AS result;
