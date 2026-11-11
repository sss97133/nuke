-- Codex analysis only: bounded run withdrawal without deleting testimony or filing images.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
CREATE OR REPLACE FUNCTION public.revert_codex_image_analysis_batch(p_run_id uuid, p_image_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '2s'
AS $$
DECLARE affected integer;
BEGIN
  IF p_run_id IS NULL OR p_image_ids IS NULL OR cardinality(p_image_ids) NOT BETWEEN 1 AND 50
     OR array_position(p_image_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Require a run UUID and 1..50 image IDs' USING ERRCODE = '22023';
  END IF;
  UPDATE public.image_observations
  SET is_active = false
  WHERE image_id = ANY(p_image_ids)
    AND observed_by = 'codex_image_analysis_v1'
    AND vehicle_id IS NULL AND role = 'incidental'
    AND is_active
    AND layer_version->>'run_id' = p_run_id::text
    AND confidence_basis->'codex_image_analysis_v1'->>'run_id' = p_run_id::text;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.revert_codex_image_analysis_batch(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_codex_image_analysis_batch(uuid,uuid[]) TO service_role;
COMMENT ON FUNCTION public.revert_codex_image_analysis_batch(uuid,uuid[]) IS
'Withdraw up to 50 Codex analysis-only image readings from one run. Retains content and provenance; never changes vehicle_images or vehicle attribution. Service-role only; repeated calls return zero.';
COMMIT;
