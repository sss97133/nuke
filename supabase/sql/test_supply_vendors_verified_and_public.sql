-- Disposable PG17 only. Proves 20261020060000_supply_vendors_verified_and_public.sql (on 20261020050000 and the
-- owner_delegated_signs register): the organizations created from receipts become public through an owner-delegated,
-- audited, registered writer that only flips private -> public; vendors get a domain only from a recorded verifying fetch,
-- are created through create_organization_batch with the verified source, and their records join the supply projection;
-- vendors whose fetch failed stay counted gaps.
-- Fixture and prior state: the organization supply contract (AutoZone and O'Reilly created privately from receipts).
\set ON_ERROR_STOP on
\ir test_organization_supply_from_receipts.sql

CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
CREATE TABLE public.admin_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, is_active boolean);
CREATE TABLE public.profiles(id uuid PRIMARY KEY, username text, is_public boolean);
CREATE FUNCTION public.platform_person_label(p_user uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('kind', 'user') $$;
INSERT INTO auth.users VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4');
INSERT INTO admin_users(user_id, is_active) VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4', true);
\ir ../migrations/20261020002000_owner_delegated_signs.sql

-- Records for a vendor about to be verified (Summit Racing) and one whose fetch failed (Offroad Design).
INSERT INTO receipts(id, user_id, vendor_name, receipt_date, total_amount) VALUES
 ('a1000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000aa', 'Summit Racing', '2023-07-07', 210.00),
 ('a1000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000aa', 'Offroad Design', '2023-08-08', 95.00);
CREATE TABLE public.organization_inventory_sync_queue(organization_id uuid, run_mode text, status text, attempts integer,
  created_at timestamptz, updated_at timestamptz, UNIQUE (organization_id, run_mode));
SELECT array_agg(id ORDER BY id) AS s2 FROM organizations WHERE discovered_via = 'declared-source:nuke-retained-receipts' \gset

\ir ../migrations/20261020060000_supply_vendors_verified_and_public.sql

SELECT t_assert(NOT has_function_privilege('authenticated', 'public.set_organizations_public_owner_delegated(uuid[],text,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.set_organizations_public_owner_delegated(uuid[],text,text,text)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.organization_visibility_changes', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.supply_vendor_domain_verifications', 'SELECT'), 'visibility writer service-only; audit and verifications private');

-- 1. Receipt-created organizations are public, audited and registered.
SELECT t_assert((SELECT bool_and(is_public) AND count(*) = 2 FROM organizations WHERE id = ANY (:'s2'::uuid[])), 'the two receipt-created organizations are public');
SELECT t_assert((SELECT count(*) FROM organization_visibility_changes c JOIN owner_delegated_signs d ON d.id = c.owner_delegated_sign_id
  WHERE c.organization_id = ANY (:'s2'::uuid[]) AND c.from_public IS FALSE AND c.to_public AND d.rpc = 'set_organizations_public_owner_delegated'
  AND d.result_ref = 'organizations:2') = 2, 'each change cites one registered owner-delegated sign');

-- 2. Verified vendors are created through the sanctioned creator and resolve; failed fetches stay gaps.
SELECT t_assert((SELECT count(*) FROM supply_vendor_domain_verifications) = 13
  AND (SELECT count(*) FROM supply_vendor_domain_verifications WHERE verdict = 'verified') = 9, 'every fetch recorded, nine verified');
SELECT t_assert(EXISTS (SELECT 1 FROM organizations WHERE website = 'https://summitracing.com' AND business_name = 'Summit Racing'
  AND discovered_via = 'declared-source:domain-verified-by-fetch-owner-delegated' AND is_public IS FALSE), 'Summit Racing created privately with the verified source');
SELECT t_assert((SELECT decision || '/' || domain FROM supply_vendors WHERE vendor_slug = 'summit_racing') = 'create_by_domain/summitracing.com'
  AND (SELECT basis FROM supply_vendors WHERE vendor_slug = 'summit_racing') LIKE '%domain verified by fetch, owner-delegated (Summit Racing |%2026-10-19T20:34Z)',
  'the vendor row cites the fetched title and clock');
SELECT t_assert(EXISTS (SELECT 1 FROM organization_supply_evidence e JOIN organizations o ON o.id = e.organization_id
  WHERE o.website = 'https://summitracing.com' AND e.basis_id = 'a1000000-0000-0000-0000-0000000000f1' AND e.supply_kind = 'performance_parts'),
  'Summit''s receipt joins the supply projection');
SELECT t_assert((SELECT decision FROM supply_vendors WHERE vendor_slug = 'offroad_design') = 'gap_no_stable_identifier'
  AND NOT EXISTS (SELECT 1 FROM organizations WHERE website ~ 'offroaddesign|georgesbudgettire|lesaslab')
  AND NOT EXISTS (SELECT 1 FROM organization_supply_evidence WHERE basis_id = 'a1000000-0000-0000-0000-0000000000f2'),
  'unverified vendors stay gaps with no organization and no evidence');

-- 3. The writer only flips private -> public, only for the service role, and its audit is append-only.
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-d124-49de-9ded-94698f63c1c4"}', false);
SELECT t_assert(t_refused(format('SELECT set_organizations_public_owner_delegated(%L, %L, %L)',
  ARRAY[(SELECT id FROM organizations WHERE website = 'https://summitracing.com')], 'r', 'q')), 'a non-service JWT is refused');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT t_assert(t_refused(format('SELECT set_organizations_public_owner_delegated(%L, %L, %L)', :'s2'::uuid[], 'r', 'q')), 'already-public organizations are refused');
SELECT t_assert(t_refused($q$SELECT set_organizations_public_owner_delegated(ARRAY['0f000000-0000-0000-0000-0000000000ff']::uuid[], 'r', 'q')$q$),
  'an unknown organization is refused');
SELECT t_assert(t_refused(format('SELECT set_organizations_public_owner_delegated(%L, %L, %L)',
  ARRAY[(SELECT id FROM organizations WHERE website = 'https://summitracing.com')], ' ', 'q')), 'a reason is required');
RESET ROLE;
SELECT t_assert(t_refused($q$UPDATE organization_visibility_changes SET reason = 'x'$q$) AND t_refused($q$DELETE FROM organization_visibility_changes$q$),
  'the visibility audit is append-only');
