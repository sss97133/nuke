-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_organization_roles -f this-file.sql
-- Proves that after 20261014160000_organization_roles_not_self_granted.sql a signed-in stranger cannot make itself an
-- organization's owner or manager by any of the three live routes (a self-inserted business_ownership row, a claim
-- filed as already approved, a join request rewritten into a manager), while the founder of a new organization, a
-- claimant the reviewer approved and an owner adding people still seat them, and existing owners, managers and board
-- members keep caller_manages_organization(). Starts from the live policies, functions and trigger as read on
-- 2026-10-14 (helpers/org_role_policies_live_20261014.sql) and shows each route working there first.
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
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'org_table_owner') THEN CREATE ROLE org_table_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, org_table_owner;
GRANT CREATE ON SCHEMA public TO org_table_owner;

-- The four tables with the columns, checks and unique keys the policies and the web touch, owned like production's
-- by a role that is not a superuser, every privilege granted to the API roles (2026-10-14).
SET ROLE org_table_owner;
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text,
  discovered_by uuid,
  uploaded_by uuid,
  is_public boolean DEFAULT true,
  is_verified boolean DEFAULT false
);
CREATE TABLE public.business_ownership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  ownership_percentage numeric(5,2) NOT NULL CHECK (ownership_percentage > 0 AND ownership_percentage <= 100),
  ownership_type text CHECK (ownership_type IN ('founder', 'partner', 'investor', 'employee_equity', 'acquired')),
  ownership_title text,
  acquisition_date date NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active', 'pending', 'transferred', 'dissolved')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (business_id, owner_id)
);
CREATE TABLE public.organization_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid,
  role text NOT NULL CHECK (role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee', 'technician',
    'contractor', 'moderator', 'contributor', 'photographer', 'historian')),
  start_date date DEFAULT CURRENT_DATE,
  end_date date,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  contribution_count integer DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  agent_id text,
  actor_type text DEFAULT 'user' CHECK (actor_type IN ('user', 'agent')),
  verification_method text NOT NULL DEFAULT 'self_claimed'
    CHECK (verification_method IN ('self_claimed', 'owner_approval', 'proof_of_work', 'document')),
  verified_by uuid,
  verified_at timestamptz,
  claim_evidence jsonb,
  CHECK (user_id IS NOT NULL OR agent_id IS NOT NULL),
  UNIQUE (organization_id, user_id)
);
CREATE TABLE public.organization_ownership_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  verification_type text NOT NULL CHECK (verification_type IN ('business_license', 'tax_id', 'articles_incorporation',
    'dba_certificate', 'lease_agreement', 'utility_bill')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'documents_uploaded', 'ai_processing',
    'human_review', 'approved', 'rejected', 'expired')),
  document_url text NOT NULL,
  supporting_documents jsonb DEFAULT '[]'::jsonb,
  extracted_data jsonb DEFAULT '{}'::jsonb,
  ai_confidence_score numeric(4,2) CHECK (ai_confidence_score >= 0.00 AND ai_confidence_score <= 1.00),
  human_reviewer_id uuid,
  human_review_notes text,
  rejection_reason text,
  submitted_at timestamptz DEFAULT now(),
  ai_processed_at timestamptz,
  human_reviewed_at timestamptz,
  approved_at timestamptz,
  expires_at timestamptz DEFAULT (now() + '90 days'::interval),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX idx_org_ownership_unique_active ON public.organization_ownership_verifications
  (user_id, organization_id, status) WHERE status IN ('pending', 'approved');
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_ownership_verifications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.organizations, public.business_ownership, public.organization_contributors,
  public.organization_ownership_verifications TO anon, authenticated, service_role;
\ir helpers/org_role_policies_live_20261014.sql
GRANT EXECUTE ON FUNCTION public.caller_manages_organization(uuid) TO anon, authenticated, service_role;
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated, service_role;
-- Runs one statement as the current role; true when it raised insufficient_privilege (a revoked grant or a row a
-- policy refused), false when it ran.
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.t_refused(text) TO anon, authenticated, service_role;
CREATE FUNCTION public.t_rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.t_rows(text) TO anon, authenticated, service_role;
-- The migration guard's policy-set hash.
CREATE FUNCTION public.t_policy_hash(p_table regclass) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(string_agg(
           p.polname || E'\t' || p.polcmd::text || E'\t' || p.polpermissive::text || E'\t'
           || coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public')
           || E'\t' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || E'\t' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
           E'\n' ORDER BY p.polname), 'UTF8')), 'base64')
  FROM pg_policy p WHERE p.polrelid = p_table $$;

-- 0. The fixture is the live state: its policy sets hash to the values read from production.
SELECT public.t_assert(public.t_policy_hash('public.business_ownership') = '9fhZL8e9nL6s6VBtEHM+P25zAvyRbFQeOAO4YsmO1m4=', 'fixture: business_ownership policies as live');
SELECT public.t_assert(public.t_policy_hash('public.organization_contributors') = 'R4c0+Y0LvKtNABRvnhYLUgxKuxfHPyVTIj2uZJuUAm0=', 'fixture: organization_contributors policies as live');
SELECT public.t_assert(public.t_policy_hash('public.organization_ownership_verifications') = '+2+rWomj4YzHGuV0jNZNPef850xilx80m8RISvGnbBo=', 'fixture: organization_ownership_verifications policies as live');
SELECT public.t_assert(public.t_policy_hash('public.organizations') = 'lIyIhbGfqUJ7HclStWLHj51KicI1fky/ipAqH+UqH3I=', 'fixture: organizations policies as live');

-- Seeds. O1: founder F1 (business_ownership founder, owner row), manager M1. O2: discovered and uploaded by B1, an
-- active board member, no business_ownership row. O3: public, no members. Claimant C1, joiner J1, stranger X9.
SET test.auth_uid = '';
INSERT INTO public.organizations (id, business_name, discovered_by, uploaded_by) VALUES
 ('40000000-0000-0000-0000-000000000001', 'Shop One', '20000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1'),
 ('40000000-0000-0000-0000-000000000002', 'Shop Two', '20000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b1'),
 ('40000000-0000-0000-0000-000000000003', 'Shop Three', NULL, NULL);
INSERT INTO public.business_ownership (business_id, owner_id, ownership_percentage, ownership_type, ownership_title, acquisition_date) VALUES
 ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000f1', 100, 'founder', 'Founder/Owner', '2026-01-30');
INSERT INTO public.organization_contributors (organization_id, user_id, role, status) VALUES
 ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000f1', 'owner', 'active'),
 ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1', 'manager', 'active'),
 ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000b1', 'board_member', 'active');

-- 1. Before: each live route makes the stranger X9 a manager of O3, which it has no tie to.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
SELECT public.t_assert(NOT public.caller_manages_organization('40000000-0000-0000-0000-000000000003'), 'before: the stranger does not manage O3');
BEGIN;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.business_ownership (business_id, owner_id, ownership_percentage, acquisition_date)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 100, '2026-10-14')$q$) = 1, 'before: the stranger inserts its own business_ownership row');
SELECT public.t_assert(public.t_rows($q$UPDATE public.organizations SET discovered_by = '20000000-0000-0000-0000-0000000000e9'
  WHERE id = '40000000-0000-0000-0000-000000000003'$q$) = 1, 'before: that row lets it rewrite discovered_by');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'owner', 'active')$q$) = 1, 'before: a discoverer seats itself as owner');
SELECT public.t_assert(public.caller_manages_organization('40000000-0000-0000-0000-000000000003'), 'before: three writes make the stranger a manager');
ROLLBACK;
BEGIN;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_ownership_verifications (organization_id, user_id, verification_type, status, document_url)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'tax_id', 'approved', 'x')$q$) = 1, 'before: a claim can arrive approved');
SELECT public.t_assert(public.t_rows($q$UPDATE public.organizations SET discovered_by = '20000000-0000-0000-0000-0000000000e9'
  WHERE id = '40000000-0000-0000-0000-000000000003'$q$) = 1, 'before: the approved claim lets it rewrite discovered_by');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'owner', 'active')$q$) = 1, 'before: and seat itself as owner');
SELECT public.t_assert(public.caller_manages_organization('40000000-0000-0000-0000-000000000003'), 'before: a self-approved claim makes the stranger a manager');
ROLLBACK;
BEGIN;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'contributor', 'pending')$q$) = 1, 'before: anyone files a join request');
SELECT public.t_assert(public.t_rows($q$UPDATE public.organization_contributors SET role = 'manager', status = 'active'
  WHERE user_id = '20000000-0000-0000-0000-0000000000e9'$q$) = 1, 'before: and rewrites it into an active manager');
SELECT public.t_assert(public.caller_manages_organization('40000000-0000-0000-0000-000000000003'), 'before: two writes make the stranger a manager');
SELECT public.t_assert(public.t_rows($q$UPDATE public.organization_contributors SET organization_id = '40000000-0000-0000-0000-000000000001'
  WHERE user_id = '20000000-0000-0000-0000-0000000000e9'$q$) = 1, 'before: and moves the manager row to another organization');
SELECT public.t_assert(public.caller_manages_organization('40000000-0000-0000-0000-000000000001'), 'before: the moved row manages O1');
ROLLBACK;
RESET ROLE;

-- 2. Apply the migration as the table owner, twice (the second run is a no-op).
SET test.auth_uid = '';
SET test.auth_role = '';
SET ROLE org_table_owner;
\ir ../migrations/20261014160000_organization_roles_not_self_granted.sql
\ir ../migrations/20261014160000_organization_roles_not_self_granted.sql
RESET ROLE;
SELECT public.t_assert(public.t_policy_hash('public.organizations') = 'lIyIhbGfqUJ7HclStWLHj51KicI1fky/ipAqH+UqH3I=', 'after: organizations policies unchanged');
SELECT public.t_assert(NOT has_table_privilege('authenticated', 'public.business_ownership', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.business_ownership', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.business_ownership', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.business_ownership', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.business_ownership', 'TRUNCATE'), 'after: anon and authenticated write no business_ownership row');
SELECT public.t_assert(has_table_privilege('authenticated', 'public.business_ownership', 'SELECT')
  AND has_table_privilege('service_role', 'public.business_ownership', 'INSERT'), 'after: owners still read, the service role still writes');

-- 3. After: every route is closed for the stranger.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.business_ownership (business_id, owner_id, ownership_percentage, acquisition_date)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 100, '2026-10-14')$q$), 'stranger: business_ownership insert refused');
SELECT public.t_assert(public.t_rows($q$UPDATE public.organizations SET discovered_by = '20000000-0000-0000-0000-0000000000e9'
  WHERE id = '40000000-0000-0000-0000-000000000003'$q$) = 0, 'stranger: cannot rewrite discovered_by');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_ownership_verifications (organization_id, user_id, verification_type, status, document_url)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'tax_id', 'approved', 'x')$q$), 'stranger: a claim cannot arrive approved');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_ownership_verifications (organization_id, user_id, verification_type, status, document_url, human_reviewer_id)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'tax_id', 'pending', 'x', '20000000-0000-0000-0000-0000000000e9')$q$), 'stranger: a claim cannot name its reviewer');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'owner', 'active')$q$), 'stranger: owner seat refused');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'manager', 'active')$q$), 'stranger: manager seat refused');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'contributor', 'active')$q$), 'stranger: an active join refused');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status, verification_method)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'contributor', 'pending', 'owner_approval')$q$), 'stranger: a join request cannot claim to be approved');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000d1', 'manager', 'active')$q$), 'stranger: cannot seat someone else');
-- A pending claim and a join request are still filed; neither can be raised by the one who filed it.
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_ownership_verifications (organization_id, user_id, verification_type, status, document_url)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'tax_id', 'pending', 'x')$q$) = 1, 'stranger: a pending claim is filed');
SELECT public.t_assert(public.t_rows($q$UPDATE public.organization_ownership_verifications SET status = 'approved'
  WHERE user_id = '20000000-0000-0000-0000-0000000000e9'$q$) = 0, 'stranger: cannot approve its own claim');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'owner', 'active')$q$), 'stranger: a pending claim seats nobody');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'contributor', 'pending')$q$) = 1, 'stranger: a join request is filed');
SELECT public.t_assert(public.t_refused($q$UPDATE public.organization_contributors SET role = 'manager', status = 'active'
  WHERE user_id = '20000000-0000-0000-0000-0000000000e9'$q$), 'stranger: cannot rewrite the request into a manager');
SELECT public.t_assert(public.t_refused($q$UPDATE public.organization_contributors SET status = 'active'
  WHERE user_id = '20000000-0000-0000-0000-0000000000e9'$q$), 'stranger: cannot activate its own request');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'manager', 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status$q$), 'stranger: an upsert cannot rewrite the request either');
SELECT public.t_assert(public.t_refused($q$UPDATE public.organization_contributors SET role = 'employee'
  WHERE user_id = '20000000-0000-0000-0000-0000000000e9'$q$), 'stranger: cannot change its role');
SELECT public.t_assert(public.t_refused($q$UPDATE public.organization_contributors SET organization_id = '40000000-0000-0000-0000-000000000001'
  WHERE user_id = '20000000-0000-0000-0000-0000000000e9'$q$), 'stranger: cannot move the request to another organization');
SELECT public.t_assert(public.t_refused($q$UPDATE public.organization_contributors SET verification_method = 'owner_approval', verified_by = '20000000-0000-0000-0000-0000000000f1'
  WHERE user_id = '20000000-0000-0000-0000-0000000000e9'$q$), 'stranger: cannot mark its request verified');
SELECT public.t_assert(public.t_rows($q$UPDATE public.organization_contributors SET notes = 'shop photos', contribution_count = 3
  WHERE user_id = '20000000-0000-0000-0000-0000000000e9'$q$) = 1, 'stranger: edits its own request');
SELECT public.t_assert(public.t_rows($q$UPDATE public.organization_contributors SET status = 'inactive'
  WHERE user_id = '20000000-0000-0000-0000-0000000000e9'$q$) = 1, 'stranger: withdraws its own request');
SELECT public.t_assert(public.t_refused($q$UPDATE public.organization_contributors SET status = 'active'
  WHERE user_id = '20000000-0000-0000-0000-0000000000e9'$q$), 'stranger: cannot reactivate a withdrawn row');
SELECT public.t_assert(public.t_rows($q$UPDATE public.organization_contributors SET notes = 'tampered'
  WHERE user_id = '20000000-0000-0000-0000-0000000000a1'$q$) = 0, 'stranger: cannot touch another member''s row');
SELECT public.t_assert(NOT public.caller_manages_organization('40000000-0000-0000-0000-000000000003')
  AND NOT public.caller_manages_organization('40000000-0000-0000-0000-000000000001'), 'stranger: manages nothing');

-- 4. Existing members keep their access and edit their own rows, but cannot raise or move them.
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_assert(public.caller_manages_organization('40000000-0000-0000-0000-000000000001'), 'manager: still manages O1');
SELECT public.t_assert(public.t_rows($q$UPDATE public.organization_contributors SET notes = 'service writer'
  WHERE user_id = '20000000-0000-0000-0000-0000000000a1'$q$) = 1, 'manager: edits its own row');
SELECT public.t_assert(public.t_rows($q$UPDATE public.organization_contributors SET role = 'manager', status = 'active'
  WHERE user_id = '20000000-0000-0000-0000-0000000000a1'$q$) = 1, 'manager: an unchanged save passes');
SELECT public.t_assert(public.t_refused($q$UPDATE public.organization_contributors SET role = 'owner'
  WHERE user_id = '20000000-0000-0000-0000-0000000000a1'$q$), 'manager: cannot make itself owner');
SELECT public.t_assert(public.t_refused($q$UPDATE public.organization_contributors SET organization_id = '40000000-0000-0000-0000-000000000003'
  WHERE user_id = '20000000-0000-0000-0000-0000000000a1'$q$), 'manager: cannot move its seat to another organization');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000d1', 'manager', 'active')$q$), 'manager: cannot seat others (owners and co-founders do)');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b1';
SELECT public.t_assert(public.caller_manages_organization('40000000-0000-0000-0000-000000000002'), 'board member: still manages O2');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000f1';
SELECT public.t_assert(public.caller_manages_organization('40000000-0000-0000-0000-000000000001'), 'founder: still manages O1');
SELECT public.t_assert((SELECT count(*) FROM public.business_ownership) = 1, 'founder: reads its own business_ownership row');

-- 5. An owner adds people: F1 seats J1 as a manager of O1.
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status, verification_method, verified_by, verified_at)
  VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000d1', 'manager', 'active', 'owner_approval', '20000000-0000-0000-0000-0000000000f1', now())$q$) = 1, 'owner: seats a manager');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000d1';
SELECT public.t_assert(public.caller_manages_organization('40000000-0000-0000-0000-000000000001'), 'owner-seated manager: manages O1');

-- 6. The founder of a new organization takes its owner seat, as CreateOrganization does: the definer trigger records
--    the founder, then the founder inserts the owner row.
SET test.auth_uid = '20000000-0000-0000-0000-0000000000f1';
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organizations (id, business_name, discovered_by, uploaded_by)
  VALUES ('40000000-0000-0000-0000-000000000004', 'Shop Four', '20000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1')$q$) = 1, 'founder: creates O4');
SELECT public.t_assert((SELECT count(*) FROM public.business_ownership WHERE business_id = '40000000-0000-0000-0000-000000000004') = 1, 'founder: the trigger recorded it as founder');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, contribution_count, status)
  VALUES ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-0000000000f1', 'owner', 1, 'active')$q$) = 1, 'founder: takes the owner seat');
SELECT public.t_assert(public.caller_manages_organization('40000000-0000-0000-0000-000000000004'), 'founder: manages O4');
-- A discoverer with no founder record (O2's B1) can no longer seat itself owner by being the discoverer.
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b1';
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000b1', 'owner', 'active')$q$), 'discoverer elsewhere: no owner seat on O3');
RESET ROLE;

-- 7. A claimant the reviewer approved takes the owner seat.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000c1';
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_ownership_verifications (organization_id, user_id, verification_type, status, document_url)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000c1', 'business_license', 'pending', 'x')$q$) = 1, 'claimant: files a claim');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000c1', 'owner', 'active')$q$), 'claimant: no seat while pending');
RESET ROLE;
SET ROLE service_role;
SET test.auth_uid = '';
SET test.auth_role = 'service_role';
SELECT public.t_assert(public.t_rows($q$UPDATE public.organization_ownership_verifications SET status = 'approved', approved_at = now(),
  human_reviewer_id = '20000000-0000-0000-0000-0000000000f1', human_reviewed_at = now()
  WHERE user_id = '20000000-0000-0000-0000-0000000000c1'$q$) = 1, 'reviewer: approves the claim');
RESET ROLE;
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-0000000000c1';
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000c1', 'owner', 'active')$q$) = 1, 'claimant: takes the owner seat once approved');
SELECT public.t_assert(public.caller_manages_organization('40000000-0000-0000-0000-000000000003'), 'claimant: manages O3');

-- 8. A manager may step down, and cannot step back up.
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_assert(public.t_rows($q$UPDATE public.organization_contributors SET status = 'inactive', end_date = '2026-10-14'
  WHERE user_id = '20000000-0000-0000-0000-0000000000a1'$q$) = 1, 'manager: steps down');
SELECT public.t_assert(NOT public.caller_manages_organization('40000000-0000-0000-0000-000000000001'), 'manager: no longer manages after stepping down');
SELECT public.t_assert(public.t_refused($q$UPDATE public.organization_contributors SET status = 'active'
  WHERE user_id = '20000000-0000-0000-0000-0000000000a1'$q$), 'manager: cannot reactivate itself');
RESET ROLE;

-- 9. anon writes nothing and manages nothing.
SET ROLE anon;
SET test.auth_role = 'anon';
SET test.auth_uid = '';
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.business_ownership (business_id, owner_id, ownership_percentage, acquisition_date)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 100, '2026-10-14')$q$), 'anon: business_ownership insert refused');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_contributors (organization_id, user_id, role, status)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'contributor', 'pending')$q$), 'anon: join request refused');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_ownership_verifications (organization_id, user_id, verification_type, status, document_url)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000e9', 'tax_id', 'pending', 'x')$q$), 'anon: claim refused');
SELECT public.t_assert((SELECT count(*) FROM public.business_ownership) = 0, 'anon: reads no business_ownership row');
SELECT public.t_assert(NOT public.caller_manages_organization('40000000-0000-0000-0000-000000000001'), 'anon: manages nothing');
SELECT public.t_assert((SELECT count(*) FROM public.organization_contributors) = 7, 'anon: still reads the public member list');
RESET ROLE;

-- 10. The service role still writes ownership and seats.
SET ROLE service_role;
SET test.auth_role = 'service_role';
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.business_ownership (business_id, owner_id, ownership_percentage, ownership_type, acquisition_date)
  VALUES ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000b1', 100, 'founder', '2025-11-02')$q$) = 1, 'service role: records a founder');
SELECT public.t_assert(public.t_rows($q$UPDATE public.organization_contributors SET status = 'active'
  WHERE user_id = '20000000-0000-0000-0000-0000000000a1'$q$) = 1, 'service role: reactivates a member');
RESET ROLE;
SET test.auth_role = '';

-- 11. A drifted policy set stops the migration and leaves the policies as found.
SET ROLE org_table_owner;
CREATE POLICY drifted_extra ON public.business_ownership FOR SELECT USING (false);
\set ON_ERROR_STOP off
\ir ../migrations/20261014160000_organization_roles_not_self_granted.sql
\set ON_ERROR_STOP on
RESET ROLE;
SELECT public.t_assert((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.business_ownership'::regclass) = 3, 'drift: the migration changed nothing');
SELECT public.t_assert(EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.business_ownership'::regclass AND polname = 'drifted_extra'), 'drift: the extra policy is still there');

SELECT 'organization roles contract: all checks passed' AS result;
