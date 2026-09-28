-- correct_field_evidence: the sanctioned path to retire field_evidence rows that cite the wrong source.
--
-- WHY: field_evidence had no writer for its status, so every retirement so far was a hand UPDATE
-- (June's 21 'superseded' rows). The 2025-12-03 Viva member-page scrape filed a different car's lot
-- as the source of the owner's 1966 Mustang (83f6f033, VIN 6F07C219593): year, make, model and
-- drivetrain cite lot 1966-ford-mustang-fastback-gt350r-gt350r2-tribute (VIN 6T09A151904), and the
-- vehicle page shows that lot under each field. The values happen to be right; the source is not.
--
-- Supersession-safe: the row stays, only its status moves, and the old status plus the citation are
-- appended to contradicting_signals. Citation required. Service role only (no anon/authenticated
-- execute, per the P0.4 writer lockdown). At most 1,000 ids per call; an id already in the target
-- status is counted, not rewritten.

CREATE OR REPLACE FUNCTION public.correct_field_evidence(
  p_ids         uuid[],
  p_status      text,                 -- 'superseded' | 'rejected'
  p_source      jsonb,                -- REQUIRED: {type, ref, reason, ...}
  p_asserted_by text DEFAULT 'agent'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_requested int := coalesce(array_length(p_ids, 1), 0);
  v_already   int := 0;
  v_changed   int := 0;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('superseded', 'rejected') THEN
    RAISE EXCEPTION 'correct_field_evidence: status % not allowed (superseded | rejected)', p_status;
  END IF;
  IF p_source IS NULL OR p_source = '{}'::jsonb OR coalesce(p_source->>'ref', p_source->>'reason', '') = '' THEN
    RAISE EXCEPTION 'correct_field_evidence: a cited source (p_source with ref or reason) is required';
  END IF;
  IF v_requested > 1000 THEN
    RAISE EXCEPTION 'correct_field_evidence: at most 1000 ids per call (got %)', v_requested;
  END IF;

  SELECT count(*) INTO v_already FROM field_evidence WHERE id = ANY(p_ids) AND status = p_status;

  -- SET expressions read the row as it was, so from_status is the status being retired
  UPDATE field_evidence fe SET
    status = p_status,
    contradicting_signals = coalesce(fe.contradicting_signals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'correction', jsonb_build_object('from_status', fe.status, 'to_status', p_status),
      'source', p_source,
      'asserted_by', p_asserted_by,
      'asserted_at', now()))
  WHERE fe.id = ANY(p_ids)
    AND fe.status IS DISTINCT FROM p_status;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'requested', v_requested,
    'changed', v_changed, 'already', v_already, 'asserted_by', p_asserted_by);
END;
$fn$;

REVOKE ALL ON FUNCTION public.correct_field_evidence(uuid[], text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correct_field_evidence(uuid[], text, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_field_evidence(uuid[], text, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.correct_field_evidence(uuid[], text, jsonb, text) IS
  'Sanctioned field_evidence retirement chokepoint: moves rows to superseded | rejected from a REQUIRED citation, keeps the row, appends {correction: {from_status, to_status}, source, asserted_by, asserted_at} to contradicting_signals. Service role only; <= 1000 ids per call. Every agent retires evidence through THIS, never a raw UPDATE.';
