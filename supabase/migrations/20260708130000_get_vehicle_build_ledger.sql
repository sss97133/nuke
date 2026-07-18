-- Build Ledger owner-scoped read RPC
--
-- Surfaces the evidence-tiered financial audit draft (vehicle_observations rows
-- with kind='work_record' AND extraction_method='audit_draft_v0') for the Build
-- Ledger section on the vehicle profile.
--
-- WHY SECURITY DEFINER: vehicle_observations RLS (vo_authenticated_read) grants
-- read to ANY authenticated user when the vehicle is public (v.is_public = true).
-- The Mustang (83f6f033-…) is public, so a direct client SELECT would leak this
-- financial data to every logged-in visitor. This function bypasses that policy
-- and re-authorizes strictly against auth.uid() ownership, so the ledger is
-- readable only by the vehicle's owner / verified owner / contributor — mirroring
-- the WorkspaceContent mount gate (isRowOwner || isVerifiedOwner || hasContributorAccess).
-- Modeled on public.get_user_garage (the canonical owner-scoped SECURITY DEFINER RPC),
-- hardened to authorize on auth.uid() directly rather than a caller-supplied id.
--
-- Testimony is read-only here; nothing is written. is_superseded rows are excluded.

CREATE OR REPLACE FUNCTION public.get_vehicle_build_ledger(p_vehicle_id uuid)
RETURNS TABLE (
  observation_id  uuid,
  observed_at     timestamptz,
  content_text    text,
  structured_data jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT vo.id, vo.observed_at, vo.content_text, vo.structured_data
  FROM vehicle_observations vo
  WHERE vo.vehicle_id = p_vehicle_id
    AND vo.kind = 'work_record'
    AND vo.extraction_method = 'audit_draft_v0'
    AND vo.is_superseded = false
    AND EXISTS (
      SELECT 1 FROM vehicles v
        WHERE v.id = p_vehicle_id
          AND (v.owner_id = auth.uid() OR v.user_id = auth.uid() OR v.uploaded_by = auth.uid())
      UNION
      SELECT 1 FROM vehicle_ownerships o
        WHERE o.vehicle_id = p_vehicle_id AND o.owner_profile_id = auth.uid() AND o.is_current = true
      UNION
      SELECT 1 FROM ownership_verifications ov
        WHERE ov.vehicle_id = p_vehicle_id AND ov.user_id = auth.uid() AND ov.status = 'approved'
      UNION
      SELECT 1 FROM vehicle_contributors vc
        WHERE vc.vehicle_id = p_vehicle_id AND vc.user_id = auth.uid()
    )
  ORDER BY vo.observed_at;
$$;

-- Financial data: authenticated callers only. anon is explicitly excluded
-- (auth.uid() would be null and return nothing anyway, but be explicit).
REVOKE ALL ON FUNCTION public.get_vehicle_build_ledger(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_vehicle_build_ledger(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_vehicle_build_ledger(uuid) IS
  'Owner-scoped read of the evidence-tiered build-ledger audit draft (work_record / audit_draft_v0 observations). SECURITY DEFINER to bypass the public-vehicle RLS read branch and re-authorize on auth.uid() ownership. Read-only.';
