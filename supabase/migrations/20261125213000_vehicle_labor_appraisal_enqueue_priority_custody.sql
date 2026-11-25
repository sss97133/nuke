-- labor_fold_v1 seed, two gaps found at the 2026-11-25 deploy (ta-labor; custody gap from ta-skeptic, same day).
--
-- (1) A car waiting behind the sweep is blank. The reader returns not_yet_computed for an in-scope public car with no
--     stored read (lead ruling: never computed cold for a folded car), and the seed skipped any car already pending in
--     model_fold_work. At deploy the proof car was pending at priority 5 (reason sweep) behind 2,681 sweep items, so it
--     showed no labor line from 02:40 to 02:47 PT until its fold was run by hand. A car first entering scope while the
--     backlog is long lands at priority 9 (model_fold_signal_ids gives a car with no state row 9), the same gap.
--     Now: a pending model_fold_work row of an in-scope car whose stored read is missing, errored, stale or on an old
--     key is lowered to priority 4 (the seed's own) and gains reason labor_logic_key. dirty_at and next_attempt_at are
--     not touched, so settle is unchanged; a leased row is left alone.
-- (2) A stored read can keep a photo a visitor may no longer see. image_privacy_rules is in the logic key and a photo
--     reading signals its car, but a vehicle_images change (custody, uploader) has no signal. Now the seed also takes a
--     stored read that cites an image_id the gallery test refuses under logged-out claims (or that no longer exists).
--     Measured on production 2026-11-25 (EXPLAIN ANALYZE, anon claims): 50 stored reads, 46 distinct cited images,
--     283 ms, 0 rows. The scan takes at most 2,000 stored reads per run, a different sample each run.
-- Test: supabase/sql/test_vehicle_labor_appraisal_fold.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal_enqueue(p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
-- One queue (ta-facts, 2026-11-25): signals with reason labor_logic_key at priority 4, at most p_limit per run, for
-- in-scope cars whose stored row is missing, errored, stale, on an old key, or cites a photo a visitor may not see.
-- model_fold_absorb_signals moves them to model_fold_work; each runs the full model_fold_one. A car already pending or
-- leased is not re-signalled (that would push dirty_at forward and starve settle); a pending one is lowered to priority
-- 4 instead. A seed signal is stamped at = now() - settle_seconds so the tick may claim it at once (ta-skeptic).
DECLARE k text := public.vehicle_labor_appraisal_logic_key(); n int := 0; bumped int := 0; withheld int := 0;
  settle interval := make_interval(secs => coalesce((public.model_fold_config() ->> 'settle_seconds')::int, 300));
  c_claims text := current_setting('request.jwt.claims', true);
  c_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  DELETE FROM public.vehicle_labor_appraisal_fold_runs WHERE started_at < now() - interval '30 days';

  -- stored reads citing a photo the logged-out gallery test refuses (computed as the fold computes: anon claims)
  CREATE TEMP TABLE IF NOT EXISTS _labor_withheld (vehicle_id uuid PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _labor_withheld;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    PERFORM set_config('request.jwt.claim.role', 'anon', true);
    INSERT INTO _labor_withheld
    SELECT s.vehicle_id
      FROM (SELECT st.vehicle_id, st.read FROM public.vehicle_labor_appraisal_state st
             WHERE st.read IS NOT NULL ORDER BY random() LIMIT 2000) s
     WHERE EXISTS (SELECT 1 FROM jsonb_path_query(s.read, 'strict $.**.image_id') i
                     LEFT JOIN public.vehicle_images vi ON vi.id = (i #>> '{}')::uuid
                    WHERE jsonb_typeof(i) = 'string'
                      AND (vi.id IS NULL OR NOT public.vehicle_image_gallery_eligible(vi)));
    PERFORM set_config('request.jwt.claims', coalesce(c_claims, ''), true);
    PERFORM set_config('request.jwt.claim.role', coalesce(c_role, ''), true);
  EXCEPTION WHEN others THEN
    PERFORM set_config('request.jwt.claims', coalesce(c_claims, ''), true);
    PERFORM set_config('request.jwt.claim.role', coalesce(c_role, ''), true);
    RAISE;
  END;
  SELECT count(*) INTO withheld FROM _labor_withheld;

  CREATE TEMP TABLE IF NOT EXISTS _labor_need (vehicle_id uuid PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _labor_need;
  INSERT INTO _labor_need
  SELECT c.vehicle_id
    FROM (SELECT r.vehicle_id FROM public.receipts r WHERE r.vehicle_id IS NOT NULL
          UNION SELECT l.vehicle_id FROM public.receipt_vehicle_links l WHERE l.retired_at IS NULL AND l.vehicle_id IS NOT NULL
          UNION SELECT j.vehicle_id FROM public.evidence_judgment_requests j WHERE j.vehicle_id IS NOT NULL
          UNION SELECT o.vehicle_id FROM public.vehicle_observations o
                 WHERE o.property_id = (SELECT op.id FROM public.observation_properties op WHERE op.property_key = 'image_visible_paint_stage')
                   AND NOT o.is_superseded AND o.vehicle_id IS NOT NULL) c
    JOIN public.vehicles v ON v.id = c.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
   WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_labor_appraisal_state s
                      WHERE s.vehicle_id = c.vehicle_id AND s.folded_key = k AND s.error IS NULL AND s.read IS NOT NULL
                        AND (s.evidence_changed_at IS NULL OR s.evidence_changed_at <= s.folded_at))
      OR EXISTS (SELECT 1 FROM _labor_withheld w WHERE w.vehicle_id = c.vehicle_id);

  -- (1) a car already waiting: lower its priority, keep its clocks
  UPDATE public.model_fold_work w
     SET priority = 4,
         reasons = (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(coalesce(w.reasons, '{}') || '{labor_logic_key}'::text[]) x),
         updated_at = now()
   WHERE w.state = 'pending' AND w.priority > 4
     AND w.vehicle_id IN (SELECT nd.vehicle_id FROM _labor_need nd);
  GET DIAGNOSTICS bumped = ROW_COUNT;

  INSERT INTO public.model_fold_signal (vehicle_id, reason, priority, at)
  SELECT nd.vehicle_id, 'labor_logic_key', 4, now() - settle
    FROM _labor_need nd
   WHERE NOT EXISTS (SELECT 1 FROM public.model_fold_signal g WHERE g.vehicle_id = nd.vehicle_id)
     AND NOT EXISTS (SELECT 1 FROM public.model_fold_work w WHERE w.vehicle_id = nd.vehicle_id AND w.state IN ('pending', 'leased'))
   ORDER BY nd.vehicle_id
   LIMIT greatest(0, least(coalesce(p_limit, 500), 500));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('queued', n, 'raised', bumped, 'cites_withheld_photo', withheld, 'key', k);
END $fn$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_enqueue(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal_enqueue(integer) TO service_role;
