-- ============================================================
-- v_user_connections — the unified connections read model
-- ============================================================
-- CONNECTION_COCKPIT.md T1 item 7: ONE read model unioning every
-- identity/grant edge into (user_id, kind, counterparty_name,
-- counterparty_id, scope, status, granted_at, expires_at, health).
-- This is the literal cockpit screen; replaces the hardcoded
-- NOT-CONNECTED strip on the user profile.
--
-- STRICTLY ADDITIVE: 1 view + 2 NEW owner-read policies (below).
-- Nothing existing is altered or dropped.
--
-- SECURITY MODEL:
--   * security_invoker = true (PG 17): every branch is evaluated with the
--     caller's privileges, so each underlying table's RLS applies.
--   * Additionally every branch filters user_id = auth.uid(), because two
--     underlying tables (organization_contributors, vehicle_user_permissions)
--     are public-read by existing policy — without the filter a caller
--     would see other users' edges. The view is "MY connections" by
--     construction; service-role consumers should query base tables.
--
-- Two underlying tables have RLS ENABLED with ZERO SELECT policies in prod
-- (verified 2026-06-11): user_external_profiles and agent_registrations.
-- Owners cannot read their OWN rows, which blanks two cockpit kinds (and
-- already silently breaks the settings drawer's social connections read).
-- We add narrow owner-read SELECT policies — NEW policies only, granting
-- owners visibility of rows they already own. No existing policy is touched.
--
-- oauth_clients: NO user-linkage column exists (client_id/secret/name/uris
-- only — verified against prod information_schema), so registered OAuth
-- clients cannot be attributed to a user and are EXCLUDED from this view.
-- When client ownership lands (e.g. an owner_user_id column added by a
-- future migration), add an 'oauth_client' branch here.

-- ------------------------------------------------------------
-- 1) Owner-read policies for the two policy-less RLS tables
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='user_external_profiles' AND policyname='uep_select_own') THEN
    CREATE POLICY uep_select_own ON public.user_external_profiles
      FOR SELECT USING (user_id = (SELECT auth.uid()));
  END IF;
  -- agent_registrations has no user_id; ownership is via api_keys
  -- (api_keys.agent_registration_id -> agent_registrations.id, api_keys.user_id).
  -- user_external_profiles is also missing the table-level SELECT grant for
  -- authenticated (every sibling table has it — verified in prod
  -- information_schema.role_table_grants 2026-06-11). GRANT is additive;
  -- rows stay protected by RLS (owner-read policy above).
  GRANT SELECT ON public.user_external_profiles TO authenticated;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='agent_registrations' AND policyname='agent_registrations_select_own_via_key') THEN
    CREATE POLICY agent_registrations_select_own_via_key ON public.agent_registrations
      FOR SELECT USING (EXISTS (
        SELECT 1 FROM public.api_keys ak
        WHERE ak.agent_registration_id = agent_registrations.id
          AND ak.user_id = (SELECT auth.uid())
      ));
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2) The view
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_user_connections
WITH (security_invoker = true) AS

-- api_key: personal API keys (non-agent)
SELECT
  ak.user_id,
  'api_key'::text AS kind,
  ak.name AS counterparty_name,
  ak.id::text AS counterparty_id,
  array_to_string(ak.scopes, ' ') AS scope,
  CASE
    WHEN NOT ak.is_active THEN 'revoked'
    WHEN ak.expires_at IS NOT NULL AND ak.expires_at < NOW() THEN 'expired'
    ELSE 'active'
  END AS status,
  ak.created_at AS granted_at,
  ak.expires_at,
  CASE
    WHEN NOT ak.is_active THEN 'dead'
    WHEN ak.expires_at IS NOT NULL AND ak.expires_at < NOW() THEN 'dead'
    WHEN ak.expires_at IS NOT NULL AND ak.expires_at < NOW() + INTERVAL '7 days' THEN 'expiring'
    WHEN ak.last_used_at IS NULL THEN 'never_used'
    WHEN ak.last_used_at < NOW() - INTERVAL '30 days' THEN 'stale'
    ELSE 'ok'
  END AS health
FROM public.api_keys ak
WHERE ak.agent_registration_id IS NULL
  AND ak.user_id = (SELECT auth.uid())

UNION ALL

-- agent: registered agents reachable through the caller's API keys
SELECT
  ak.user_id,
  'agent'::text,
  COALESCE(ar.name, ak.name),
  COALESCE(ar.id, ak.agent_registration_id),
  array_to_string(ak.scopes, ' '),
  CASE
    WHEN NOT ak.is_active THEN 'revoked'
    WHEN ak.expires_at IS NOT NULL AND ak.expires_at < NOW() THEN 'expired'
    ELSE COALESCE(ar.status, 'active')
  END,
  ak.created_at,
  ak.expires_at,
  CASE
    WHEN NOT ak.is_active THEN 'dead'
    WHEN ak.expires_at IS NOT NULL AND ak.expires_at < NOW() THEN 'dead'
    WHEN ak.expires_at IS NOT NULL AND ak.expires_at < NOW() + INTERVAL '7 days' THEN 'expiring'
    WHEN COALESCE(ar.last_seen_at, ak.last_used_at) IS NULL THEN 'never_used'
    WHEN COALESCE(ar.last_seen_at, ak.last_used_at) < NOW() - INTERVAL '30 days' THEN 'stale'
    ELSE 'ok'
  END
FROM public.api_keys ak
LEFT JOIN public.agent_registrations ar ON ar.id = ak.agent_registration_id
WHERE ak.agent_registration_id IS NOT NULL
  AND ak.user_id = (SELECT auth.uid())

UNION ALL

-- external_account: linked platform identities (BaT, IG, ...)
SELECT
  uep.user_id,
  'external_account'::text,
  uep.platform || ':' || uep.username,
  uep.platform || ':' || uep.username,
  uep.platform,
  CASE WHEN uep.verified THEN 'verified' ELSE 'unverified' END,
  uep.created_at,
  NULL::timestamptz,
  CASE WHEN uep.verified THEN 'ok' ELSE 'unverified' END
FROM public.user_external_profiles uep
WHERE uep.user_id = (SELECT auth.uid())

UNION ALL

-- organization: org membership/contributor edges
SELECT
  oc.user_id,
  'organization'::text,
  COALESCE(o.business_name, o.name, 'organization ' || LEFT(oc.organization_id::text, 8)),
  oc.organization_id::text,
  oc.role,
  COALESCE(oc.status, 'active'),
  oc.created_at,
  NULL::timestamptz,
  CASE WHEN COALESCE(oc.status, 'active') = 'active' THEN 'ok' ELSE COALESCE(oc.status, 'ok') END
FROM public.organization_contributors oc
LEFT JOIN public.organizations o ON o.id = oc.organization_id
WHERE oc.user_id = (SELECT auth.uid())

UNION ALL

-- vehicle: per-vehicle permission grants
SELECT
  vup.user_id,
  'vehicle'::text,
  NULLIF(TRIM(CONCAT_WS(' ', v.year::text, v.make, v.model)), ''),
  vup.vehicle_id::text,
  vup.role,
  CASE
    WHEN vup.revoked_at IS NOT NULL THEN 'revoked'
    WHEN vup.expires_at IS NOT NULL AND vup.expires_at < NOW() THEN 'expired'
    WHEN COALESCE(vup.is_active, true) THEN 'active'
    ELSE 'inactive'
  END,
  COALESCE(vup.granted_at, vup.created_at),
  vup.expires_at,
  CASE
    WHEN vup.revoked_at IS NOT NULL THEN 'dead'
    WHEN vup.expires_at IS NOT NULL AND vup.expires_at < NOW() THEN 'dead'
    WHEN vup.expires_at IS NOT NULL AND vup.expires_at < NOW() + INTERVAL '7 days' THEN 'expiring'
    ELSE 'ok'
  END
FROM public.vehicle_user_permissions vup
LEFT JOIN public.vehicles v ON v.id = vup.vehicle_id
WHERE vup.user_id = (SELECT auth.uid())

UNION ALL

-- site: confirmed/suggested work sites (user_sites, T0 item 5)
SELECT
  us.user_id,
  'site'::text,
  us.name,
  us.id::text,
  ROUND(us.lat::numeric, 4) || ',' || ROUND(us.lon::numeric, 4) || ' r' || COALESCE(us.radius_m::text, '?') || 'm',
  CASE WHEN us.confirmed_at IS NOT NULL THEN 'confirmed' ELSE 'suggested' END,
  us.created_at,
  NULL::timestamptz,
  CASE WHEN us.confirmed_at IS NOT NULL THEN 'ok' ELSE 'pending_confirm' END
FROM public.user_sites us
WHERE us.user_id = (SELECT auth.uid())

UNION ALL

-- platform_login: stored platform credentials (BaT login etc.)
SELECT
  pc.user_id,
  'platform_login'::text,
  pc.platform,
  pc.id::text,
  NULL::text,
  COALESCE(pc.status, 'unknown'),
  pc.created_at,
  pc.session_expires_at,
  CASE
    WHEN COALESCE(pc.status, '') NOT IN ('', 'active', 'valid') THEN COALESCE(pc.status, 'unknown')
    WHEN pc.session_expires_at IS NOT NULL AND pc.session_expires_at < NOW() THEN 'session_expired'
    WHEN pc.validation_error IS NOT NULL THEN 'error'
    ELSE 'ok'
  END
FROM public.platform_credentials pc
WHERE pc.user_id = (SELECT auth.uid());

COMMENT ON VIEW public.v_user_connections IS
  'Unified per-user connections read model (CONNECTION_COCKPIT T1-7): api keys, agents, external accounts, orgs, vehicle grants, sites, platform logins. security_invoker; each branch additionally scoped to auth.uid().';

GRANT SELECT ON public.v_user_connections TO authenticated;
GRANT SELECT ON public.v_user_connections TO service_role;
