-- Owner-signed confirmation write path (Build Ledger "NEEDS CONFIRMATION" strip)
--
-- Two changes, one purpose: let the owner answer a pending ledger question in the
-- app and have the answer land as testimony without destroying the draft.
--
-- (1) supersede_observation() — the missing supersession primitive.
--     The trust invariants (.claude/rules/agent-trust-invariants.md rule 2) require
--     that a corrected fact SUPERSEDES its predecessor: flip is_superseded, point
--     superseded_by at the successor, keep both rows forever. We had relink_testimony
--     (move across vehicles), reattribute_observation, and demote_observation_to_user
--     — but no primitive for "this row has been replaced by that row."
--
--     This function writes NO testimony. It only flips supersession flags on a row
--     the caller owns. New rows are still created exclusively through
--     ingest-observation (.claude/rules/extraction.md, single write path).
--
--     Idempotent by design: agent-chat's answer_confirmation does two sequential
--     writes (ingest-observation, then this). If the second fails, a retry finishes
--     the job instead of double-booking an amount.
--
--     SECURITY: the actor is taken from auth.uid(), never from an argument. A
--     SECURITY DEFINER function that authorizes against a caller-supplied user id
--     authorizes nothing — any authenticated user could pass the owner's uuid.
--
-- (2) get_vehicle_build_ledger() reads only extraction_method='audit_draft_v0'.
--     An owner-confirmed successor carries 'owner_confirmed_v1', so confirming an
--     entry would have made it vanish from the ledger. Widened below.
--
--     A REJECTED entry ("that charge isn't this car's") gets an 'owner_rejected_v1'
--     successor, which is deliberately NOT in the read set: the ruling is preserved
--     as testimony, and the entry leaves the ledger instead of being deleted from it.

-- ─── (1) The supersession primitive ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.supersede_observation(
  p_original_id     uuid,
  p_successor_id    uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle_id   uuid;
  v_superseded   boolean;
  v_existing_by  uuid;
  v_actor        uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'supersede_observation: authentication required';
  END IF;

  IF p_original_id IS NULL OR p_successor_id IS NULL THEN
    RAISE EXCEPTION 'supersede_observation: original and successor are both required';
  END IF;

  IF p_original_id = p_successor_id THEN
    RAISE EXCEPTION 'supersede_observation: an observation cannot supersede itself';
  END IF;

  SELECT vehicle_id, is_superseded, superseded_by
    INTO v_vehicle_id, v_superseded, v_existing_by
    FROM vehicle_observations WHERE id = p_original_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'supersede_observation: original observation % not found', p_original_id;
  END IF;

  -- The successor must exist and sit on the same vehicle. Guards against an agent
  -- pointing a draft at an unrelated row.
  PERFORM 1 FROM vehicle_observations
    WHERE id = p_successor_id
      AND vehicle_id IS NOT DISTINCT FROM v_vehicle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supersede_observation: successor % missing, or not on the same vehicle', p_successor_id;
  END IF;

  -- Re-authorize on auth.uid(), mirroring get_vehicle_build_ledger's ownership union.
  -- SECURITY DEFINER bypasses RLS, so this check is the whole gate.
  IF v_vehicle_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM vehicles v
          WHERE v.id = v_vehicle_id
            AND (v.owner_id = v_actor OR v.user_id = v_actor OR v.uploaded_by = v_actor)
        UNION
        SELECT 1 FROM vehicle_ownerships o
          WHERE o.vehicle_id = v_vehicle_id AND o.owner_profile_id = v_actor AND o.is_current = true
        UNION
        SELECT 1 FROM ownership_verifications ov
          WHERE ov.vehicle_id = v_vehicle_id AND ov.user_id = v_actor AND ov.status = 'approved'
        UNION
        SELECT 1 FROM vehicle_contributors vc
          WHERE vc.vehicle_id = v_vehicle_id AND vc.user_id = v_actor
      ) THEN
    RAISE EXCEPTION 'supersede_observation: not authorized for observation %', p_original_id;
  END IF;

  -- Idempotent: a retry after a partial failure is a no-op, not a second write.
  IF v_superseded IS TRUE THEN
    RETURN jsonb_build_object(
      'superseded', true, 'already', true,
      'original_id', p_original_id, 'superseded_by', v_existing_by);
  END IF;

  UPDATE vehicle_observations
     SET is_superseded  = true,
         superseded_by  = p_successor_id,
         superseded_at  = now(),
         lineage_chain  = array_append(coalesce(lineage_chain, ARRAY[]::uuid[]), p_successor_id)
   WHERE id = p_original_id;

  RETURN jsonb_build_object(
    'superseded', true, 'already', false,
    'original_id', p_original_id, 'superseded_by', p_successor_id);
END;
$$;

REVOKE ALL ON FUNCTION public.supersede_observation(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.supersede_observation(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.supersede_observation(uuid, uuid) IS
  'Mark an observation superseded by a successor row. Owner-authorized, idempotent, non-destructive: flips is_superseded/superseded_by/superseded_at and appends to lineage_chain. Creates no testimony — successors are written through ingest-observation. Actor is auth.uid(), never an argument.';

-- ─── (2) Let the ledger keep reading a row after it is confirmed ─────────────

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
    -- audit_draft_v0 = the unconfirmed audit draft.
    -- owner_confirmed_v1 = its owner-signed successor. Both belong on the ledger;
    -- reading only the draft would erase an entry the moment the owner confirmed it.
    AND vo.extraction_method IN ('audit_draft_v0', 'owner_confirmed_v1')
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

REVOKE ALL ON FUNCTION public.get_vehicle_build_ledger(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_vehicle_build_ledger(uuid) TO authenticated;
