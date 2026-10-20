-- Public provider profiles for the sitemap: handles only, never names, contact fields or which signal a profile has.
-- A profile is listed when it is public, has a handle, and has a provider signal: a technician link backed by work
-- (approved work_evidence, co_sign or authenticated_sign actor claim), a stated service area or availability, or an
-- active shop membership or ownership. Read-only; callable by anon so the edge sitemap can use the publishable key.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.discovery_providers_read(p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH signals AS (
    SELECT c.user_id FROM public.account_link_claims c
      WHERE c.status = 'approved' AND c.verification_method IN ('work_evidence', 'co_sign', 'authenticated_sign') AND c.actor_id IS NOT NULL
    UNION SELECT sa.user_id FROM public.provider_service_area sa
    UNION SELECT pa.user_id FROM public.provider_availability pa
    UNION SELECT oc.user_id FROM public.organization_contributors oc WHERE oc.status = 'active'
    UNION SELECT bo.owner_id FROM public.business_ownership bo WHERE bo.status = 'active'
  ), listed AS (
    SELECT btrim(p.username) AS handle, p.updated_at
    FROM public.profiles p
    WHERE p.is_public IS TRUE AND NULLIF(btrim(p.username), '') IS NOT NULL AND p.id IN (SELECT user_id FROM signals)
    ORDER BY p.updated_at DESC NULLS LAST, btrim(p.username)
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 50000)
  )
  SELECT jsonb_build_object(
    'as_of', statement_timestamp(),
    'providers', COALESCE((SELECT jsonb_agg(jsonb_build_object('handle', l.handle, 'updated_at', l.updated_at)
      ORDER BY l.updated_at DESC NULLS LAST, l.handle) FROM listed l), '[]'::jsonb),
    'rule', 'public profiles with a handle and a provider signal: a technician link backed by work, a stated service area or availability, or an active shop membership or ownership',
    'never', jsonb_build_array('names', 'contact fields', 'which provider signal a profile has'));
$function$;

REVOKE ALL ON FUNCTION public.discovery_providers_read(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discovery_providers_read(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.discovery_providers_read(integer) IS
  'Sitemap reader: handles of public provider profiles (public profile + handle + provider signal). No names, contact fields or signal kinds.';
