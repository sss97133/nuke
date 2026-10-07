-- 20261008015000_flag_fabricated_field_evidence_value_predicate.sql
--
-- Second use of the correction writer from 20261008013000, which needs one more predicate. The describe-batch8 lane
-- (PR #826) found a second placeholder set in vehicle_field_evidence: 238,223 rows of source_type 'nhtsa_vin_decode' whose
-- value_text is the literal string 'undefined' (verified 2026-10-07 15:17Z: displacement 42,484, plant_state 42,484,
-- fuel_type 42,484, drivetrain 31,526, series 28,264, trim 22,194, engine_type 17,173, body_style 3,676, model 3,586,
-- plant_city 2,585 ...; 0 flagged; none carries a value_number). The adapter read fields the NHTSA response did not have and
-- stored JavaScript's undefined as text. A missing value is not a fact (invariant 1). The other 314,069 nhtsa_vin_decode
-- rows hold real decode values and must not be flagged, so flagging by source_type alone (the writer's only predicate until
-- now) is wrong here.
--
-- WHAT. flag_fabricated_field_evidence gains an optional fourth argument p_value_text: when given, only rows whose
-- value_text equals it are flagged, and the metadata record carries value_text. The three-argument form is replaced by
-- the four-argument one with a default (callers of the old form are unaffected: same name, same leading arguments).
-- Everything else is unchanged: SECURITY DEFINER, EXECUTE for service_role only, FOR UPDATE SKIP LOCKED, batched,
-- idempotent, one write_receipts row per writing call, app.writer set and restored, values kept. Nothing is written here;
-- the run is by hand after deploy: flag_fabricated_field_evidence('nhtsa_vin_decode', <reason>, 5000, 'undefined') until 0.
--
-- CONTRACT. supabase/sql/test_flag_fabricated_field_evidence_value_predicate.sql (PostgreSQL 17; replays 20261008013000
-- then this file). EXPECTED AFTER THE RUN: 238,223 more rows flagged (431,975 in all), all nhtsa_vin_decode rows with real
-- values untouched.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.flag_fabricated_field_evidence(text, text, integer);

CREATE OR REPLACE FUNCTION public.flag_fabricated_field_evidence(p_source_type text, p_reason text, p_batch integer DEFAULT 5000, p_value_text text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_writer      constant text := 'flag_fabricated_field_evidence';
  v_prev_writer text := current_setting('app.writer', true);
  v_started     timestamptz := clock_timestamp();
  v_n           integer := 0;
BEGIN
  IF coalesce(btrim(p_source_type), '') = '' OR coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'flag_fabricated_field_evidence: p_source_type and p_reason must be given' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 20000 THEN
    RAISE EXCEPTION 'flag_fabricated_field_evidence: p_batch must be between 1 and 20000, got %', p_batch USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_value_text IS NOT NULL AND btrim(p_value_text) = '' THEN
    RAISE EXCEPTION 'flag_fabricated_field_evidence: p_value_text must be NULL or a non-empty text' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('app.writer', c_writer, true);

  WITH pick AS (
    SELECT e.id
    FROM public.vehicle_field_evidence e
    WHERE e.source_type = p_source_type
      AND NOT coalesce(e.flagged_as_incorrect, false)
      AND (p_value_text IS NULL OR e.value_text = p_value_text)
    LIMIT p_batch
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.vehicle_field_evidence e
    SET flagged_as_incorrect = true,
        metadata = CASE WHEN e.metadata IS NULL OR jsonb_typeof(e.metadata) = 'object'
                        THEN coalesce(e.metadata, '{}'::jsonb)
                        ELSE jsonb_build_object('prior', e.metadata) END
                   || jsonb_build_object('flagged_incorrect', jsonb_strip_nulls(jsonb_build_object(
                        'at', now(), 'writer', c_writer, 'reason', p_reason, 'source_type', p_source_type, 'value_text', p_value_text)))
    FROM pick p
    WHERE p.id = e.id
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM upd;

  IF v_n > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('vehicle_field_evidence', 'UPDATE', v_n, c_writer, current_user, current_setting('application_name', true), txid_current());
  END IF;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object('flagged', v_n, 'source_type', p_source_type, 'value_text', p_value_text, 'batch', p_batch,
                            'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END
$$;
REVOKE ALL ON FUNCTION public.flag_fabricated_field_evidence(text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_fabricated_field_evidence(text, text, integer, text) TO service_role;

COMMENT ON FUNCTION public.flag_fabricated_field_evidence(text, text, integer, text) IS
'Sanctioned correction writer for vehicle_field_evidence (20261008013000, predicate added 20261008015000): marks up to p_batch rows of one source_type, and when p_value_text is given only rows whose value_text equals it, as flagged_as_incorrect = true, recording metadata.flagged_incorrect {at, writer, reason, source_type, value_text}; values are kept. FOR UPDATE SKIP LOCKED, idempotent, one write_receipts row per call that wrote, app.writer set and restored. SECURITY DEFINER, EXECUTE for service_role only. Uses: hagerty_instant_quote placeholders (193,752 rows, 2026-10-07 14:17Z); nhtsa_vin_decode rows holding the literal text undefined (238,223 rows, 2026-10-07). Run by hand through scripts/data/q.sh until flagged = 0.';

COMMIT;
