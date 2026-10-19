-- The live definition of public.viewer_identity_bridge(uuid) as read from production on 2026-10-19
-- (pg_get_functiondef text plus a semicolon; md5 prefix 0316fb06). Owned by the backend lane; for contract tests only.
CREATE OR REPLACE FUNCTION public.viewer_identity_bridge(p_user uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'state', CASE WHEN bool_or(c.status = 'approved' AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign')) THEN 'evidenced'
      WHEN bool_or(c.status = 'pending') THEN 'claimed' ELSE 'none' END,
    'evidenced_actor_ids', COALESCE(to_jsonb(array_agg(DISTINCT c.actor_id) FILTER (WHERE c.status = 'approved'
      AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign'))), '[]'::jsonb))
  FROM public.account_link_claims c
  WHERE c.user_id = p_user AND c.actor_id IS NOT NULL
$function$;
