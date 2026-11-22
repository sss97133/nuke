-- Fact-doubt loop: a cap on re-asking, and an alarm when it answers nothing.
-- The scheduled loop (#3715) claims doubts and answers them on the owner's subscription. A claim that dies (an answer
-- refused locally, a crash) is re-claimed after 30 minutes with no limit, one subscription call each time; and the first
-- scheduled fire (2026-11-22 19:05 UTC) took up one doubt, failed it, and still left the watch green.
-- fact_doubt_ineligibility: the 20261120070000 body plus claimed_6_times (a doubt claimed six times is no longer offered
-- or accepted). assay_subscription_readers: the 20261122190000 body plus a failure when the loop's heartbeat carries a
-- zero-answer run of three or more fires begun over two hours ago (reader-heartbeat.mjs keeps the run, as it does for
-- the frame reader). Contracts: supabase/sql/test_fact_doubt_questions.sql (cap), test_fact_doubt_cycle_heartbeat.sql (alarm).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.fact_doubt_ineligibility(p_id uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE j evidence_judgment_requests; probs text[]; pid uuid; cid text; x vehicle_images; imgs uuid[]; items uuid[]; db jsonb;
BEGIN
  SELECT * INTO j FROM evidence_judgment_requests WHERE id = p_id;
  IF NOT FOUND THEN RETURN ARRAY['no_request']; END IF;
  probs := fact_doubt_params_problems(j.params);
  IF cardinality(probs) > 0 THEN RETURN ARRAY(SELECT 'params:' || p FROM unnest(probs) p); END IF;
  SELECT p.id INTO pid FROM observation_properties p
   WHERE p.property_key = j.params ->> 'property_key' AND p.ratified_at IS NOT NULL AND p.deprecated_at IS NULL LIMIT 1;
  IF pid IS NULL THEN probs := array_append(probs, 'key_not_registered');
  ELSIF j.subject_table IS DISTINCT FROM 'observation_properties' OR j.subject_id IS DISTINCT FROM pid THEN
    probs := array_append(probs, 'subject_is_not_the_key');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = j.vehicle_id AND v.deleted_at IS NULL) THEN probs := array_append(probs, 'vehicle_gone'); END IF;
  -- A doubt the reader has taken up six times without an answer is no longer offered or accepted: each claim is one
  -- subscription call, and a claim that dies is re-claimed every 30 minutes, without end until this cap (2026-11-22).
  IF (SELECT count(*) FROM jsonb_array_elements(coalesce(j.lifecycle, '[]'::jsonb)) e WHERE e ->> 'kind' = 'claim') >= 6 THEN
    probs := array_append(probs, 'claimed_6_times');
  END IF;
  imgs := ARRAY(SELECT jsonb_array_elements_text(j.params -> 'cited_image_ids')::uuid);
  items := ARRAY(SELECT jsonb_array_elements_text(j.params -> 'cited_receipt_item_ids')::uuid);
  FOREACH cid IN ARRAY ARRAY(SELECT unnest(imgs)::text) LOOP
    SELECT * INTO x FROM vehicle_images WHERE id = cid::uuid;
    IF NOT FOUND OR x.vehicle_id IS DISTINCT FROM j.vehicle_id OR NOT receipt_work_frame_eligible(x) THEN
      probs := array_append(probs, 'frame_ineligible:' || cid);
    END IF;
  END LOOP;
  FOREACH cid IN ARRAY ARRAY(SELECT unnest(items)::text) LOOP
    IF NOT EXISTS (SELECT 1 FROM receipt_items it JOIN receipts r ON r.id = it.receipt_id
                    JOIN receipt_vehicle_links l ON l.receipt_id = r.id AND l.vehicle_id = j.vehicle_id AND l.status = 'linked' AND l.retired_at IS NULL
                   WHERE it.id = cid::uuid AND NOT coalesce(r.is_superseded, false) AND r.duplicate_of IS NULL) THEN
      probs := array_append(probs, 'line_ineligible:' || cid);
    END IF;
  END LOOP;
  db := fact_doubt_evidence_state(j.vehicle_id, j.params ->> 'property_key', imgs, items);
  IF db IS DISTINCT FROM j.params #> '{evidence_state,db}' THEN probs := array_append(probs, 'evidence_changed'); END IF;
  IF j.trigger_evidence_dedupe_key IS DISTINCT FROM fact_doubt_trigger_key(j.params -> 'evidence_state') THEN
    probs := array_append(probs, 'trigger_key_mismatch');
  END IF;
  RETURN probs;
END
$fn$;
REVOKE ALL ON FUNCTION public.fact_doubt_ineligibility(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fact_doubt_ineligibility(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.assay_subscription_readers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_out jsonb := '{}'::jsonb;
  v_stale text[] := '{}';
  v_dry jsonb;
BEGIN
  FOR r IN SELECT n AS jobname, a.assayed_at, a.reading
           FROM unnest(ARRAY['subscription-document-reader', 'subscription-frame-classifier', 'fact-doubt-cycle']) AS n
           LEFT JOIN job_assay_readings a ON a.jobname = n LOOP
    v_out := v_out || jsonb_build_object(r.jobname, jsonb_build_object('assayed_at', r.assayed_at, 'reading', r.reading));
    IF r.assayed_at IS NULL OR r.assayed_at < now() - interval '40 minutes' THEN
      v_stale := v_stale || r.jobname;
    END IF;
  END LOOP;
  IF cardinality(v_stale) > 0 THEN
    RAISE EXCEPTION 'subscription reader silent: % (no heartbeat within 40 minutes; is com.nuke.subscription-reader loaded and the Mac awake?)', array_to_string(v_stale, ', ');
  END IF;
  -- The loop reports in but answers nothing: reader-heartbeat.mjs carries zero_read_since / zero_read_fires across fires
  -- in which it took up doubts (frames) and answered none (read). Three such fires over two hours fail the watch.
  SELECT a.reading INTO v_dry FROM job_assay_readings a
   WHERE a.jobname = 'fact-doubt-cycle'
     AND jsonb_typeof(a.reading -> 'zero_read_fires') = 'number' AND (a.reading ->> 'zero_read_fires')::numeric >= 3
     AND (a.reading ->> 'zero_read_since') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
     AND (a.reading ->> 'zero_read_since')::timestamptz < now() - interval '2 hours';
  IF v_dry IS NOT NULL THEN
    RAISE EXCEPTION 'fact-doubt-cycle has taken up doubts and answered none since % (% runs); failures by type: %',
      v_dry ->> 'zero_read_since', v_dry ->> 'zero_read_fires', coalesce(v_dry -> 'error_classes', '{}'::jsonb);
  END IF;
  RETURN v_out || jsonb_build_object('status', 'passed', 'checked_at', now());
END $fn$;
REVOKE ALL ON FUNCTION public.assay_subscription_readers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assay_subscription_readers() TO service_role;
