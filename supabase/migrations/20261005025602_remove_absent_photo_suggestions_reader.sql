-- Live verification of PR612 exposed a second old reference: the legacy
-- vehicle_suggestions table is absent. The atlas retains only parts suggestions,
-- a different grain. Preserve that absence as unknown, without minting a table.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='2s';
DO $repair$
DECLARE
  definition text:=pg_get_functiondef('public.get_photo_library_stats(uuid)'::regprocedure);
  old_fragment text:=$old$    'ai_suggestions_count', (
      SELECT COUNT(*)::INTEGER
      FROM public.vehicle_suggestions
      WHERE user_id = p_user_id
        AND status = 'pending'
    ),$old$;
BEGIN
  IF strpos(definition,old_fragment)=0 THEN
    RAISE EXCEPTION 'Photo reader changed; expected legacy suggestions fragment absent';
  END IF;
  EXECUTE replace(definition,old_fragment,
    $new$    'ai_suggestions_count', NULL::INTEGER,
    'ai_suggestions_state', 'unavailable',$new$);
END $repair$;
COMMENT ON FUNCTION public.get_photo_library_stats(uuid) IS
 'Owner-only live photo-library reader. Legacy inbox counts retain their existing scope. source_analysis measures all owner image rows, grouped retained outputs and bounded recent failures. Suggestions are unavailable because their legacy table is absent, not zero. Device completeness and calibrated accuracy remain unknown. No processing or evidence-row writes.';
NOTIFY pgrst,'reload schema';
COMMIT;
