-- tax_id and business_license are compliance identifiers that no public organization page shows. A
-- follow-up migration removes them from the anon/authenticated column grant on organizations; editors
-- read them back here first. The gate is the union of the organizations UPDATE policies, so whoever
-- may write these fields may read them, and nobody else.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.organization_private_fields_read(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF NOT (
    COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
    OR (v_uid IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = p_organization_id AND (o.discovered_by = v_uid OR o.uploaded_by = v_uid)
      )
      OR EXISTS (
        SELECT 1 FROM public.business_ownership bo
        WHERE bo.business_id = p_organization_id AND bo.owner_id = v_uid AND bo.status = 'active'
      )
      OR EXISTS (
        SELECT 1 FROM public.organization_contributors oc
        WHERE oc.organization_id = p_organization_id AND oc.user_id = v_uid AND oc.status = 'active'
          AND oc.role = ANY (ARRAY['owner', 'co_founder', 'board_member', 'manager'])
      )
      OR EXISTS (
        SELECT 1 FROM public.organization_ownership_verifications oov
        WHERE oov.organization_id = p_organization_id AND oov.user_id = v_uid AND oov.status = 'approved'
      )
    ))
  ) THEN
    RAISE EXCEPTION 'Private organization fields require an editor of the organization' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object('tax_id', o.tax_id, 'business_license', o.business_license)
  INTO v_result
  FROM public.organizations o
  WHERE o.id = p_organization_id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.organization_private_fields_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_private_fields_read(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.organization_private_fields_read(uuid) IS
  'Editor-only read of an organization''s private compliance fields (tax_id, business_license). Caller must pass an organizations UPDATE policy (discoverer/uploader, active business_ownership owner, active owner/co_founder/board_member/manager contributor, approved ownership verification) or carry the service role.';
NOTIFY pgrst, 'reload schema';
COMMIT;
