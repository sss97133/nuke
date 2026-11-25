-- labor_fold_v1 reader and seed, gaps found at the 2026-11-25 deploy (ta-labor; custody gap from ta-skeptic, same day).
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
-- (3) the reader and the gauge: see below.
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

-- (3) Lead ruling 2026-11-25 (TransAm war board): the reader never goes blank for a car in scope. The stored row is a cache of the
--     compute, never a gate on it. Fresh stored row: served (state.basis stored). Missing, off key, stale or queued:
--     the live compute, as before #3898 (state.basis computed_now); the seed folds it within one 5-minute run at
--     priority 4. A car whose compute cannot finish inside a visitor's statement_timeout is served its last stored read
--     with its as-of time, or the not-yet-computed status, and the gauge names it (too_slow_to_compute_at_read): its
--     last fold (vehicle_labor_appraisal_state.ms, written on success and on failure) took at least half of anon's
--     statement_timeout (read from pg_db_role_setting; 15 s on 2026-11-25), or its fold failed on a timeout. A car
--     never folded has no measure: it is computed live, and its first fold names it if it is slow. Basis: 51 folds
--     on production 2026-11-25, p50 309 ms, p90 2,054 ms, max 2,983 ms.
--     A fold that failed otherwise serves the last good read with the error beside it (a live compute would fail too).
--     state.label carries the words a renderer prints (ta-packet #3946): null when fresh or computed now,
--     'recomputing' for a stored read served while a newer one is due, 'not yet computed' when there is none.
CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal_too_slow_to_read(p_vehicle uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  WITH lim AS (
    SELECT coalesce((SELECT CASE WHEN v ~ '^[0-9]+$' THEN v::bigint
                                 WHEN v ~ '^[0-9]+ms$' THEN left(v, -2)::bigint
                                 WHEN v ~ '^[0-9]+s$' THEN left(v, -1)::bigint * 1000
                                 WHEN v ~ '^[0-9]+min$' THEN left(v, -3)::bigint * 60000 END
                       FROM pg_db_role_setting d, unnest(d.setconfig) c,
                            LATERAL (SELECT split_part(c, '=', 2) AS v) x
                      WHERE d.setrole = 'anon'::regrole AND d.setdatabase = 0 AND split_part(c, '=', 1) = 'statement_timeout'
                      LIMIT 1), 15000) / 2 AS half_ms)
  SELECT EXISTS (SELECT 1 FROM public.vehicle_labor_appraisal_state s
                  WHERE s.vehicle_id = p_vehicle
                    AND (s.ms >= (SELECT half_ms FROM lim) OR s.error ~* 'statement timeout|canceling statement'))
$fn$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_too_slow_to_read(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal_too_slow_to_read(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
-- labor_fold_v1 (20261125213000): the stored read when fresh; otherwise the live compute, unless the compute is too slow
-- for a visitor's read, when the last stored read (or the not-yet-computed status) is served. Never blank by the cache.
DECLARE
  v record;
  st public.vehicle_labor_appraisal_state%ROWTYPE;
  key_current boolean;
  queued boolean;
  fresh boolean;
  has_row boolean;
BEGIN
  SELECT id, is_public, deleted_at INTO v FROM public.vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND OR v.is_public IS NOT TRUE OR v.deleted_at IS NOT NULL THEN
    RETURN public.vehicle_labor_appraisal_compute(p_vehicle_id);  -- not folded: the compute keeps the visibility test
  END IF;
  SELECT * INTO st FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = p_vehicle_id;
  has_row := FOUND AND st.read IS NOT NULL;
  IF FOUND AND st.error = 'viewer_dependent_rule' THEN
    RETURN public.vehicle_labor_appraisal_compute(p_vehicle_id);  -- a rule reads caller-dependent inputs: no stored form
  END IF;
  IF NOT has_row AND st.error IS NULL AND NOT public.vehicle_labor_appraisal_in_scope(p_vehicle_id) THEN
    RETURN public.vehicle_labor_appraisal_compute(p_vehicle_id);  -- no labor inputs: 25-95 ms measured
  END IF;
  key_current := has_row AND st.folded_key IS NOT DISTINCT FROM public.vehicle_labor_appraisal_logic_key();
  -- A stamp committed after the fold began can carry an earlier clock than folded_at (ta-skeptic's two-session race):
  -- a signal or queued work for the car means a fold has not yet answered it.
  queued := EXISTS (SELECT 1 FROM public.model_fold_signal g WHERE g.vehicle_id = p_vehicle_id)
         OR EXISTS (SELECT 1 FROM public.model_fold_work w WHERE w.vehicle_id = p_vehicle_id AND w.state IN ('pending', 'leased'));
  fresh := has_row AND key_current AND st.error IS NULL AND NOT queued
           AND NOT coalesce(st.evidence_changed_at > st.folded_at, false);
  IF fresh THEN
    RETURN st.read || jsonb_build_object('as_of', st.folded_at, 'state', jsonb_build_object(
      'fresh', true, 'basis', 'stored', 'label', NULL, 'queued', false, 'computed', true, 'computed_at', st.folded_at,
      'evidence_changed_at', st.evidence_changed_at, 'key_current', true, 'error', NULL));
  END IF;
  IF (st.error IS NOT NULL AND st.error <> 'viewer_dependent_rule') OR public.vehicle_labor_appraisal_too_slow_to_read(p_vehicle_id) THEN
    IF has_row THEN
      RETURN st.read || jsonb_build_object('as_of', st.folded_at, 'state', jsonb_build_object(
        'fresh', false, 'basis', 'stored', 'label', 'recomputing', 'queued', queued, 'computed', true,
        'computed_at', st.folded_at, 'evidence_changed_at', st.evidence_changed_at, 'key_current', key_current,
        'error', st.error));
    END IF;
    RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'status', 'not_yet_computed', 'segments', '[]'::jsonb,
      'state', jsonb_build_object('fresh', false, 'basis', NULL, 'label', 'not yet computed', 'queued', queued,
                                  'computed', false, 'error', st.error));
  END IF;
  RETURN public.vehicle_labor_appraisal_compute(p_vehicle_id) || jsonb_build_object('as_of', now(), 'state', jsonb_build_object(
    'fresh', true, 'basis', 'computed_now', 'label', NULL, 'queued', queued, 'computed', true, 'computed_at', now(),
    'stored_at', CASE WHEN has_row THEN st.folded_at END, 'evidence_changed_at', st.evidence_changed_at,
    'key_current', key_current, 'error', NULL));
END
$function$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal_gauge()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  WITH k AS (SELECT public.vehicle_labor_appraisal_logic_key() AS k),
  st AS (
    SELECT count(*) AS n_rows,
           count(*) FILTER (WHERE s.folded_key IS DISTINCT FROM (SELECT k FROM k)) AS off_key,
           count(*) FILTER (WHERE s.evidence_changed_at > s.folded_at) AS stale_now,
           count(*) FILTER (WHERE s.error IS NOT NULL) AS errored,
           max(s.folded_at) AS newest_folded_at
      FROM public.vehicle_labor_appraisal_state s),
  runs AS (
    SELECT count(*) AS folds_24h,
           count(*) FILTER (WHERE r.stamped_at IS NOT NULL AND r.error IS NULL) AS stamps_answered_24h,
           count(*) FILTER (WHERE r.error IS NOT NULL) AS errors_24h,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY (r.wait_ms + r.ms)) FILTER (WHERE r.stamped_at IS NOT NULL AND r.error IS NULL) / 1000.0)::numeric, 1) AS stale_p50_s,
           round((percentile_cont(0.9) WITHIN GROUP (ORDER BY (r.wait_ms + r.ms)) FILTER (WHERE r.stamped_at IS NOT NULL AND r.error IS NULL) / 1000.0)::numeric, 1) AS stale_p90_s
      FROM public.vehicle_labor_appraisal_fold_runs r WHERE r.started_at > now() - interval '24 hours'),
  slow AS (SELECT coalesce(jsonb_agg(s.vehicle_id ORDER BY s.vehicle_id), '[]'::jsonb) AS ids
             FROM public.vehicle_labor_appraisal_state s WHERE public.vehicle_labor_appraisal_too_slow_to_read(s.vehicle_id))
  SELECT jsonb_build_object('rows', st.n_rows, 'off_key', st.off_key, 'stale_now', st.stale_now, 'errored', st.errored,
    'newest_folded_at', st.newest_folded_at, 'folds_24h', runs.folds_24h, 'stamps_answered_24h', runs.stamps_answered_24h,
    'errors_24h', runs.errors_24h, 'stale_p50_s', runs.stale_p50_s, 'stale_p90_s', runs.stale_p90_s, 'key', (SELECT k FROM k),
    'unlisted_callees', public.labor_fold_logic_unlisted(), 'too_slow_to_compute_at_read', slow.ids)
  FROM st, runs, slow
$fn$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_gauge() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal_gauge() TO service_role;
