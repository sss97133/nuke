-- Live definition of get_pending_vehicle_assignments(uuid) on 2026-10-14 (pg_get_functiondef),
-- md5(pg_get_functiondef) 130a2f1e650d66a22a9fa5532de6ed65, the migration guard's expected source. Test fixture only.
CREATE OR REPLACE FUNCTION public.get_pending_vehicle_assignments(p_user_id uuid)
 RETURNS TABLE(id uuid, vehicle_name text, organization_name text, relationship_type text, confidence numeric, evidence_sources text[], created_at timestamp with time zone, vehicle_id uuid, organization_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    pva.id,
    v.year || ' ' || v.make || ' ' || v.model,
    b.business_name,
    pva.suggested_relationship_type,
    pva.overall_confidence,
    pva.evidence_sources,
    pva.created_at,
    pva.vehicle_id,
    pva.organization_id
  FROM pending_vehicle_assignments pva
  JOIN vehicles v ON v.id = pva.vehicle_id
  JOIN businesses b ON b.id = pva.organization_id
  WHERE pva.status = 'pending'
    AND (
      EXISTS (
        SELECT 1 FROM vehicles v2
        WHERE v2.id = pva.vehicle_id
          AND (v2.uploaded_by = p_user_id OR v2.user_id = p_user_id)
      )
      OR EXISTS (
        SELECT 1 FROM organization_contributors oc
        WHERE oc.organization_id = pva.organization_id
          AND oc.user_id = p_user_id
          AND oc.status = 'active'
      )
    )
  ORDER BY pva.overall_confidence DESC, pva.created_at DESC;
END;
$function$;
