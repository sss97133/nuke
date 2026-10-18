-- 20261008013000_flag_fabricated_field_evidence.sql
--
-- A sanctioned writer that marks fabricated field evidence as incorrect, and its first use: the 193,752 rows of
-- vehicle_field_evidence with source_type 'hagerty_instant_quote'. Invariant 1 (AGENTS.md): facts are never invented; and
-- "never show a price you can't defend".
--
-- EVIDENCE (read-only, prod, 2026-10-07 13:58-14:02Z; found by the describe-batch6 lane, PR #809):
--   vehicle_field_evidence holds 193,752 rows with source_type = 'hagerty_instant_quote': four fields (insurance_value,
--   market_value_avg, market_value_high, market_value_low) on 48,438 vehicles, created 2025-12-04 .. 2026-02-18, all with
--   confidence_score 50 and flagged_as_incorrect false. No Hagerty API was ever called: supabase/functions/_shared/
--   serviceAdapters.ts returns "placeholder/mock data" when HAGERTY_API_KEY is unset (market_value_low = year * 100,
--   avg = year * 150, high = year * 200, insurance_value = year * 180, confidence 50), and the key was never configured:
--   service_executions shows 48,433 of 48,440 completed hagerty_instant_quote runs with exactly those values. On a
--   sample of 500 evidence rows per field, 496 equal the formula against the vehicle's current model year (the other 4
--   are vehicles whose year changed since). The worker that queued the runs (service-orchestrator) was deleted on
--   2026-03-07, so no new rows arrive. One function on prod reads vehicle_field_evidence and no reader honours
--   flagged_as_incorrect yet; no function on prod updates the table; it has no trigger and no index on source_type.
--
-- WHAT. 1. public.flag_fabricated_field_evidence(p_source_type, p_reason, p_batch): SECURITY DEFINER, EXECUTE for
--   service_role only, app.writer set with set_config and restored; one UPDATE of up to p_batch rows of the given
--   source_type that are not yet flagged (FOR UPDATE SKIP LOCKED): flagged_as_incorrect = true and
--   metadata.flagged_incorrect = {at, writer, reason, source_type}; the value columns are untouched (the row is kept, as
--   testimony about what the adapter wrote); one write_receipts row per call that wrote. Idempotent: flagged rows leave the
--   predicate. Returns {flagged, source_type, batch, ms}. 2. Comments on flagged_as_incorrect and the function; the registry
--   row's write_via extended. 3. Nothing is written here: the run is by hand after deploy, one call per batch through
--   scripts/data/q.sh, until flagged = 0 (about 39 calls at 5,000).
--
-- LIMITS. Readers do not exclude flagged rows yet; that is the follow-up (the one prod reader, and the frontend fold). The
--   48,439 vehicle_form_completions rows with provider Hagerty are completion records, not values, and are not touched.
--   Deleting the adapter's placeholder branch is a code change for the day shift.
--
-- CONTRACT. supabase/sql/test_flag_fabricated_field_evidence.sql (PostgreSQL 17, synthetic rows, CI job metric-fold-health-contract).
-- MEASURED BEFORE: flagged_as_incorrect true on 0 of 748,037 rows. EXPECTED AFTER THE RUN: 193,752 flagged, all with
--   source_type hagerty_instant_quote, receipts summing to 193,752, no value changed.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.flag_fabricated_field_evidence(p_source_type text, p_reason text, p_batch integer DEFAULT 5000)
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

  PERFORM set_config('app.writer', c_writer, true);

  WITH pick AS (
    SELECT e.id
    FROM public.vehicle_field_evidence e
    WHERE e.source_type = p_source_type AND NOT coalesce(e.flagged_as_incorrect, false)
    LIMIT p_batch
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.vehicle_field_evidence e
    SET flagged_as_incorrect = true,
        metadata = CASE WHEN e.metadata IS NULL OR jsonb_typeof(e.metadata) = 'object'
                        THEN coalesce(e.metadata, '{}'::jsonb)
                        ELSE jsonb_build_object('prior', e.metadata) END
                   || jsonb_build_object('flagged_incorrect', jsonb_build_object(
                        'at', now(), 'writer', c_writer, 'reason', p_reason, 'source_type', p_source_type))
    FROM pick p
    WHERE p.id = e.id
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM upd;

  -- vehicle_field_evidence has no write-receipt trigger; record this writer's statement the way record_write_receipt does.
  IF v_n > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('vehicle_field_evidence', 'UPDATE', v_n, c_writer, current_user, current_setting('application_name', true), txid_current());
  END IF;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object('flagged', v_n, 'source_type', p_source_type, 'batch', p_batch,
                            'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END
$$;
REVOKE ALL ON FUNCTION public.flag_fabricated_field_evidence(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_fabricated_field_evidence(text, text, integer) TO service_role;

COMMENT ON FUNCTION public.flag_fabricated_field_evidence(text, text, integer) IS
'Sanctioned correction writer for vehicle_field_evidence (migration 20261008013000): marks up to p_batch rows of one source_type as flagged_as_incorrect = true and records why in metadata.flagged_incorrect {at, writer, reason, source_type}; values are kept (the row stays testimony about what the writer wrote). FOR UPDATE SKIP LOCKED, idempotent (flagged rows leave the predicate), one write_receipts row per call that wrote, app.writer set and restored. SECURITY DEFINER, EXECUTE for service_role only. First use 2026-10-07: source_type hagerty_instant_quote, 193,752 rows of model-year-times-a-constant placeholders written by _shared/serviceAdapters.ts without a Hagerty API key. Run by hand through scripts/data/q.sh until flagged = 0.';
COMMENT ON COLUMN public.vehicle_field_evidence.flagged_as_incorrect IS
'True when a sanctioned correction marked the row as not a fact: flag_fabricated_field_evidence() sets it and writes metadata.flagged_incorrect {at, writer, reason, source_type}; the value columns stay as written. Readers must exclude flagged rows (on 2026-10-07 no reader did yet). First use: the hagerty_instant_quote placeholders (193,752 rows, model year times 100/150/180/200, confidence 50). Unit: none (boolean). Source: the correction writer. Grain: one evidence row. Clock: metadata.flagged_incorrect.at.';

UPDATE public.pipeline_registry
SET write_via = write_via || ' Corrections: flag_fabricated_field_evidence(source_type, reason, batch) sets flagged_as_incorrect with a metadata record and a receipt (20261008013000); values are never rewritten.',
    updated_at = now()
WHERE table_name = 'vehicle_field_evidence' AND column_name IS NULL
  AND write_via NOT LIKE '%flag_fabricated_field_evidence%';

COMMIT;
