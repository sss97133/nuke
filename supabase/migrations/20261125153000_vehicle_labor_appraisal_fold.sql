-- labor_fold_v1: vehicle_labor_appraisal reads a stored fold; the computation moves to the fold.
--
-- WHY. Ruling 4 (lead, 2026-11-24): a cold read over 3 s gets a plan review before any further reader patch. Measured
-- 2026-11-24/25 (server time, q.sh, first call): proof car 4,007 ms, bench car a90c008a 5,394 ms, 043c6d8b 3,315 ms;
-- PostgREST rpc 1,380 calls, mean 1,297 ms, max 14,861 ms. The reader recomputes a whole-build fold from the log on
-- every anonymous call. Lead's ruling: state lives in the database and readers render it (the shape #3862 used for
-- facet grades), on the existing model fold queue.
--
-- ROWS.
--   vehicle_labor_appraisal_state  vehicle_id PK FK vehicles: read (the computed read minus as_of), read_hash,
--                       logic_version, folded_key, folded_at (start of the fold), evidence_changed_at (stamped by
--                       model_fold_signal_ids), ms, error. No client grant. Only vehicle_labor_appraisal_fold writes it.
--   vehicle_labor_appraisal_compute(uuid)  today's reader body, renamed; service role only. Holds the visibility test.
--   vehicle_labor_appraisal_logic_key()  md5 over the compute body and the labor rule tables (labor_stage_rules,
--                       labor_stage_rule_transitions, labor_stage_rule_operations, labor_operations,
--                       stage_transition_labor_map, labor_evidence_grade_policy, labor_hours_bases); 1.3 ms measured.
--                       A fold-local key like vehicle_facet_grades_logic_key: a labor rule edit re-folds labor only.
--   vehicle_labor_appraisal_in_scope(uuid)  public, not deleted, and holds a receipt, a receipt_vehicle_links row, an
--                       evidence_judgment_requests row or a current image_visible_paint_stage observation
--                       (live 2026-11-25: 25, 26, 20 and 27 cars).
--   vehicle_labor_appraisal_fold(uuid)  definer, the only writer. Refuses to store (error 'viewer_dependent_rule')
--                       while an active rule reads facets or statements (caller-dependent inputs; 0 active rules do).
--                       A failure lands in error and never aborts model_fold_one.
--   vehicle_labor_appraisal(uuid)  same signature and grants. A public car with a stored read returns it with
--                       as_of = folded_at and state {fresh, computed true, computed_at, evidence_changed_at,
--                       key_current, error}. fresh is false while evidence_changed_at > folded_at, the key moved or the
--                       last fold failed (the last good read stays and is served; lead ruling 2026-11-25: the renderer
--                       prints the hours "as of <computed_at>, recomputing" and never as current). An in-scope car
--                       never folded returns status 'not_yet_computed', no segments, state.computed false (blank, never
--                       a cold compute). Not public, out of scope, or a viewer_dependent_rule refusal: computed at read.
--   vehicle_labor_appraisal_fold_runs  one row per fold: started_at, stamped_at (the evidence stamp it answers),
--                       wait_ms, ms, error; 30 days kept. The gauge reads stale duration from it.
--   Signals (existing model_fold machinery): model_fold_rows_signal on INSERT/DELETE and model_fold_origin_update_signal
--                       on UPDATE of receipts, receipt_vehicle_links, evidence_judgment_requests;
--                       labor_fold_item_signal (statement level) on receipt_items and receipt_line_edges, item ->
--                       receipt -> vehicle and the receipt's active links. vehicle_observations, vehicle_images and
--                       vehicles already signal. model_fold_signal_ids stamps the state row and admits a car that has
--                       one (ta-facts' two lines). model_fold_one calls the fold after the facet grade fold.
--   Priority (ta-facts' proposal 2026-11-25, lead: labor re-fold above the bulk passes, which run at 5). A signal on a
--                       car that has a labor state row is admitted at coalesce(tier priority, 2): a smaller tier priority
--                       still wins. Cost at the measured rate: 511 vehicle_observations inserts + 24 vehicles updates a
--                       day on the 50 in-scope cars (live 24 h, 2026-11-25), at most 535 x (206 ms model fold + 1.5 s
--                       mean labor compute) = about 15 min of 30 s tick time a day, i.e. about 1% of the 40 s budget
--                       ticks. The queue dedups a car already pending, so bursts cost one fold.
--   Seed: vehicle_labor_appraisal_enqueue(500) every 5 minutes signals (model_fold_signal, reason labor_logic_key,
--                       priority 4, at most 500) in-scope cars whose row is missing, errored, stale or on an old key.
--                       Live 2026-11-25: 50 in-scope cars; a rule edit settles in about 50 x (206 ms model fold +
--                       the labor compute, 42-4,402 ms measured, 20.9 s over 14 cars): about 85 s of fold time,
--                       ahead of any bulk pass at 5 and behind the tiers at 2-3.
--   vehicle_labor_appraisal_gauge()  rows, off_key, stale_now, errored, newest_folded_at, folds_24h,
--                       stamps_answered_24h, errors_24h, stale_p50_s / stale_p90_s (stamp -> fold end, seconds, over
--                       the folds of the last 24 h that answered a stamp), key. Expected stale duration, to be
--                       replaced by the gauge's measure after deploy: p50 about 17 s (half a 30 s tick + 206 ms + 1.5 s
--                       mean compute), p90 about 35 s (a full tick + the 4.4 s slowest measured compute), with the queue
--                       empty above priority 2 (live model_fold_work 2026-11-25 08:35 UTC: 0 pending, 15,812 done).
--   The labor tables stay out of model_fold_logic_key (one edit, one re-fold).
-- Test: supabase/sql/test_vehicle_labor_appraisal_fold.sql (PG17).
--
-- REVERT. Unschedule vehicle-labor-appraisal-seed; drop the signal triggers and labor_fold_item_signal; remove the
-- labor_fold_v1 blocks from model_fold_one and model_fold_signal_ids by their markers; DROP FUNCTION
-- vehicle_labor_appraisal(uuid); ALTER FUNCTION vehicle_labor_appraisal_compute(uuid) RENAME TO
-- vehicle_labor_appraisal and restore its grants (EXECUTE to anon, authenticated, service_role); drop the state table.
SET lock_timeout = '5s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.vehicle_labor_appraisal_state (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  read jsonb,
  read_hash text,
  logic_version text,
  folded_key text,
  folded_at timestamptz,
  evidence_changed_at timestamptz,
  ms integer,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.vehicle_labor_appraisal_state IS
  'labor_fold_v1: the stored public read of vehicle_labor_appraisal per vehicle (grain: vehicle). Written only by vehicle_labor_appraisal_fold from model_fold_one; stale when evidence_changed_at > folded_at or folded_key differs from vehicle_labor_appraisal_logic_key().';
ALTER TABLE public.vehicle_labor_appraisal_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_labor_appraisal_state FROM anon, authenticated;
GRANT SELECT ON public.vehicle_labor_appraisal_state TO service_role;

-- One row per fold: how long a stamped car waited (stamp -> fold start) and what the fold cost. The gauge reads it.
CREATE TABLE IF NOT EXISTS public.vehicle_labor_appraisal_fold_runs (
  id bigserial PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  stamped_at timestamptz,
  wait_ms bigint,
  ms integer NOT NULL,
  error text
);
CREATE INDEX IF NOT EXISTS vehicle_labor_appraisal_fold_runs_started_idx ON public.vehicle_labor_appraisal_fold_runs (started_at);
COMMENT ON TABLE public.vehicle_labor_appraisal_fold_runs IS
  'labor_fold_v1: one row per vehicle_labor_appraisal_fold call (grain: fold). stamped_at = the evidence stamp the fold answers (NULL when none since the last fold), wait_ms = started_at - stamped_at. Kept 30 days (pruned by vehicle_labor_appraisal_enqueue).';
ALTER TABLE public.vehicle_labor_appraisal_fold_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_labor_appraisal_fold_runs FROM anon, authenticated;
GRANT SELECT ON public.vehicle_labor_appraisal_fold_runs TO service_role;

-- The present reader becomes the compute step (once; the guard refuses an unexpected body).
DO $rename$
DECLARE d text;
BEGIN
  IF to_regprocedure('public.vehicle_labor_appraisal_compute(uuid)') IS NULL THEN
    d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
    IF position('labor_names_v1' IN d) = 0 OR position('labor_fold_v1' IN d) > 0 THEN
      RAISE EXCEPTION 'labor_fold_v1: unexpected vehicle_labor_appraisal body (needs labor_names_v1, not yet folded)';
    END IF;
    IF (length(d) - length(replace(d, 'FUNCTION public.vehicle_labor_appraisal(', ''))) / length('FUNCTION public.vehicle_labor_appraisal(') <> 1 THEN
      RAISE EXCEPTION 'labor_fold_v1: function header anchor count <> 1';
    END IF;
    EXECUTE replace(d, 'FUNCTION public.vehicle_labor_appraisal(', 'FUNCTION public.vehicle_labor_appraisal_compute(');
  END IF;
END $rename$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_compute(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal_compute(uuid) TO service_role;
COMMENT ON FUNCTION public.vehicle_labor_appraisal_compute(uuid) IS
  'labor_fold_v1: the labor appraisal computed from the log (the former reader body). Called by vehicle_labor_appraisal_fold, and by the reader when no fresh stored row exists. Service role only.';

CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal_logic_key()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  SELECT md5(concat_ws('|', 'labor_fold_v1',
    (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.vehicle_labor_appraisal_compute(uuid)'::regprocedure),
    (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM public.labor_stage_rules t),
    (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM public.labor_stage_rule_transitions t),
    (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM public.labor_stage_rule_operations t),
    (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM public.labor_operations t),
    (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM public.stage_transition_labor_map t),
    (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM public.labor_evidence_grade_policy t),
    (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM public.labor_hours_bases t)))
$fn$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_logic_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal_logic_key() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal_in_scope(p_vehicle uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle AND v.is_public IS TRUE AND v.deleted_at IS NULL)
     AND (EXISTS (SELECT 1 FROM public.receipts r WHERE r.vehicle_id = p_vehicle)
       OR EXISTS (SELECT 1 FROM public.receipt_vehicle_links l WHERE l.vehicle_id = p_vehicle AND l.retired_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.evidence_judgment_requests j WHERE j.vehicle_id = p_vehicle)
       OR EXISTS (SELECT 1 FROM public.vehicle_observations o
                   WHERE o.vehicle_id = p_vehicle AND NOT o.is_superseded
                     AND o.property_id = (SELECT op.id FROM public.observation_properties op
                                           WHERE op.property_key = 'image_visible_paint_stage')))
$fn$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_in_scope(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal_in_scope(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal_fold(p_vehicle uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  t0 timestamptz := clock_timestamp();
  k text := public.vehicle_labor_appraisal_logic_key();
  r jsonb;
  ms int;
  prior public.vehicle_labor_appraisal_state%ROWTYPE;
  stamp timestamptz;
BEGIN
  SELECT * INTO prior FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = p_vehicle;
  stamp := CASE WHEN prior.evidence_changed_at > coalesce(prior.folded_at, '-infinity'::timestamptz)
                THEN prior.evidence_changed_at END;
  BEGIN
    IF EXISTS (SELECT 1 FROM public.labor_stage_rules ru,
                      jsonb_array_elements(coalesce(ru.evidence_requirements -> 'all', '[]'::jsonb)) c
                WHERE ru.active AND c ->> 'type' IN ('facet_truthy', 'statement_present')) THEN
      RAISE EXCEPTION 'viewer_dependent_rule';
    END IF;
    r := public.vehicle_labor_appraisal_compute(p_vehicle);
    IF r IS NULL OR r ? 'error' THEN
      RAISE EXCEPTION 'no_public_read: %', coalesce(r ->> 'error', 'not visible');
    END IF;
    r := r - 'as_of';
    ms := (extract(epoch FROM clock_timestamp() - t0) * 1000)::int;
    INSERT INTO public.vehicle_labor_appraisal_state AS s
           (vehicle_id, read, read_hash, logic_version, folded_key, folded_at, ms, error, updated_at)
    VALUES (p_vehicle, r, md5(r::text), r ->> 'logic_version', k, t0, ms, NULL, now())
    ON CONFLICT (vehicle_id) DO UPDATE SET
      read = CASE WHEN s.read_hash = excluded.read_hash THEN s.read ELSE excluded.read END,
      read_hash = excluded.read_hash, logic_version = excluded.logic_version, folded_key = excluded.folded_key,
      folded_at = excluded.folded_at, ms = excluded.ms, error = NULL, updated_at = now();
    INSERT INTO public.vehicle_labor_appraisal_fold_runs (vehicle_id, started_at, stamped_at, wait_ms, ms)
    VALUES (p_vehicle, t0, stamp, (extract(epoch FROM t0 - stamp) * 1000)::bigint, ms);
    RETURN jsonb_build_object('vehicle_id', p_vehicle, 'ms', ms, 'key', k);
  EXCEPTION WHEN OTHERS THEN
    ms := (extract(epoch FROM clock_timestamp() - t0) * 1000)::int;
    INSERT INTO public.vehicle_labor_appraisal_state AS s (vehicle_id, folded_key, ms, error, updated_at)
    VALUES (p_vehicle, k, ms, left(SQLERRM, 500), now())
    ON CONFLICT (vehicle_id) DO UPDATE SET ms = excluded.ms, error = excluded.error, updated_at = now();
    INSERT INTO public.vehicle_labor_appraisal_fold_runs (vehicle_id, started_at, stamped_at, wait_ms, ms, error)
    VALUES (p_vehicle, t0, stamp, (extract(epoch FROM t0 - stamp) * 1000)::bigint, ms, left(SQLERRM, 500));
    RETURN jsonb_build_object('vehicle_id', p_vehicle, 'ms', ms, 'error', left(SQLERRM, 500));
  END;
END $fn$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_fold(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal_fold(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
-- labor_fold_v1: a public car with a stored read returns it, flagged state.fresh false while a newer stamp, a moved key
-- or a failed fold waits (lead ruling 2026-11-25: never blank once computed, never computed cold for a folded car).
DECLARE
  v record;
  st public.vehicle_labor_appraisal_state%ROWTYPE;
  key_current boolean;
BEGIN
  SELECT id, is_public, deleted_at INTO v FROM public.vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND OR v.is_public IS NOT TRUE OR v.deleted_at IS NOT NULL THEN
    RETURN public.vehicle_labor_appraisal_compute(p_vehicle_id);  -- not folded: the compute keeps the visibility test
  END IF;
  SELECT * INTO st FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = p_vehicle_id;
  IF FOUND AND st.error = 'viewer_dependent_rule' THEN
    RETURN public.vehicle_labor_appraisal_compute(p_vehicle_id);  -- a rule reads caller-dependent inputs: no stored form
  END IF;
  IF NOT FOUND OR st.read IS NULL THEN
    IF NOT public.vehicle_labor_appraisal_in_scope(p_vehicle_id) THEN
      RETURN public.vehicle_labor_appraisal_compute(p_vehicle_id);  -- no labor inputs: 25-95 ms measured
    END IF;
    RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'status', 'not_yet_computed', 'segments', '[]'::jsonb,
                              'state', jsonb_build_object('fresh', false, 'computed', false, 'error', st.error));
  END IF;
  key_current := st.folded_key IS NOT DISTINCT FROM public.vehicle_labor_appraisal_logic_key();
  RETURN st.read || jsonb_build_object('as_of', st.folded_at,
    'state', jsonb_build_object(
      'fresh', key_current AND st.error IS NULL AND NOT coalesce(st.evidence_changed_at > st.folded_at, false),
      'computed', true, 'computed_at', st.folded_at, 'evidence_changed_at', st.evidence_changed_at,
      'key_current', key_current, 'error', st.error));
END
$function$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal(uuid) TO anon, authenticated, service_role;

-- Signals for the inputs that had none.
CREATE OR REPLACE FUNCTION public.labor_fold_item_signal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE ids uuid[]; v_ids uuid[];
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'receipt_items' THEN
      IF TG_OP = 'DELETE' THEN SELECT array_agg(DISTINCT o.receipt_id) INTO ids FROM old_rows o;
      ELSIF TG_OP = 'INSERT' THEN SELECT array_agg(DISTINCT n.receipt_id) INTO ids FROM new_rows n;
      ELSE  -- an update that changes nothing but a clock signals nothing
        SELECT array_agg(DISTINCT x) INTO ids FROM (
          SELECT unnest(ARRAY[o.receipt_id, n.receipt_id]) x FROM old_rows o JOIN new_rows n ON n.id = o.id
           WHERE (to_jsonb(o) - 'updated_at') IS DISTINCT FROM (to_jsonb(n) - 'updated_at')) z WHERE x IS NOT NULL;
      END IF;
    ELSE
      IF TG_OP = 'DELETE' THEN
        SELECT array_agg(DISTINCT i.receipt_id) INTO ids FROM old_rows o JOIN public.receipt_items i ON i.id = o.receipt_item_id;
      ELSIF TG_OP = 'INSERT' THEN
        SELECT array_agg(DISTINCT i.receipt_id) INTO ids FROM new_rows n JOIN public.receipt_items i ON i.id = n.receipt_item_id;
      ELSE
        -- the hourly re-verify restamps classified_at; only a changed edge signals
        SELECT array_agg(DISTINCT i.receipt_id) INTO ids
          FROM old_rows o JOIN new_rows n ON n.receipt_item_id = o.receipt_item_id AND n.classifier = o.classifier
          JOIN public.receipt_items i ON i.id = n.receipt_item_id
         WHERE (to_jsonb(o) - 'classified_at') IS DISTINCT FROM (to_jsonb(n) - 'classified_at');
      END IF;
    END IF;
    IF ids IS NULL THEN RETURN NULL; END IF;
    SELECT array_agg(DISTINCT x) INTO v_ids FROM (
      SELECT r.vehicle_id x FROM public.receipts r WHERE r.id = ANY (ids) AND r.vehicle_id IS NOT NULL
      UNION SELECT l.vehicle_id FROM public.receipt_vehicle_links l
             WHERE l.receipt_id = ANY (ids) AND l.retired_at IS NULL AND l.vehicle_id IS NOT NULL) z;
    PERFORM public.model_fold_signal_ids(v_ids, 'labor_' || TG_TABLE_NAME || '_' || lower(TG_OP));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'labor fold signal skipped (%): %', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.labor_fold_item_signal() FROM PUBLIC, anon, authenticated;

DO $trg$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['receipts', 'receipt_vehicle_links', 'evidence_judgment_requests'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS labor_fold_signal_ins ON public.%I', t);
    EXECUTE format('CREATE TRIGGER labor_fold_signal_ins AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.model_fold_rows_signal()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS labor_fold_signal_del ON public.%I', t);
    EXECUTE format('CREATE TRIGGER labor_fold_signal_del AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.model_fold_rows_signal()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS labor_fold_signal_upd ON public.%I', t);
    EXECUTE format('CREATE TRIGGER labor_fold_signal_upd AFTER UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.model_fold_origin_update_signal()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['receipt_items', 'receipt_line_edges'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS labor_fold_signal_ins ON public.%I', t);
    EXECUTE format('CREATE TRIGGER labor_fold_signal_ins AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.labor_fold_item_signal()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS labor_fold_signal_upd ON public.%I', t);
    EXECUTE format('CREATE TRIGGER labor_fold_signal_upd AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.labor_fold_item_signal()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS labor_fold_signal_del ON public.%I', t);
    EXECUTE format('CREATE TRIGGER labor_fold_signal_del AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.labor_fold_item_signal()', t);
  END LOOP;
END $trg$;

-- model_fold_signal_ids: stamp the labor row and admit a car that has one (ta-facts, 2026-11-25).
DO $patch$
DECLARE d text; a1 text; a2 text; a3 text;
BEGIN
  d := pg_get_functiondef('public.model_fold_signal_ids(uuid[], text)'::regprocedure);
  IF position('labor_fold_v1' IN d) > 0 THEN RETURN; END IF;
  a1 := '  update public.vehicle_facet_grade_folds set evidence_changed_at = clock_timestamp() where vehicle_id = any (p_ids);';
  a2 := 'exists (select 1 from public.vehicle_facet_grade_folds f where f.vehicle_id = v.id)));';
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 OR (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'labor_fold_v1: model_fold_signal_ids anchors do not match exactly once';
  END IF;
  d := replace(d, a1, a1 || E'\n  -- labor_fold_v1\n  update public.vehicle_labor_appraisal_state set evidence_changed_at = clock_timestamp() where vehicle_id = any (p_ids);\n  -- labor_fold_v1_end');
  a3 := 'select v.id, p_reason, coalesce(p.pr, 9) from public.vehicles v';
  IF (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1 THEN
    RAISE EXCEPTION 'labor_fold_v1: model_fold_signal_ids priority anchor does not match exactly once';
  END IF;
  d := replace(d, a3, 'select v.id, p_reason, coalesce(p.pr, case when exists (select 1 from public.vehicle_labor_appraisal_state s'
    || ' where s.vehicle_id = v.id) then 2 else 9 end) /* labor_fold_v1 */ from public.vehicles v');
  d := replace(d, a2, 'exists (select 1 from public.vehicle_facet_grade_folds f where f.vehicle_id = v.id))'
    || E'\n          or (v.id::text not like ''9cf5b7a4%'' and exists (select 1 from public.vehicle_labor_appraisal_state s where s.vehicle_id = v.id)) /* labor_fold_v1 */);');
  EXECUTE d;
END $patch$;

-- model_fold_one: fold labor after the facet grades, in scope only; a failure never aborts the model fold.
DO $patch$
DECLARE d text; a text := E'  -- facet_grades_fold_v1_end\n';
BEGIN
  d := pg_get_functiondef('public.model_fold_one(uuid, uuid, jsonb, uuid[])'::regprocedure);
  IF position('labor_fold_v1' IN d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION 'labor_fold_v1: model_fold_one anchor does not match exactly once';
  END IF;
  d := replace(d, a, a || E'  -- labor_fold_v1: the stored labor appraisal of a car in scope (a failure lands in its state row)\n'
    || E'  begin\n    if public.vehicle_labor_appraisal_in_scope(p_vehicle) then\n'
    || E'      perform public.vehicle_labor_appraisal_fold(p_vehicle);\n    end if;\n'
    || E'  exception when others then\n    raise warning ''labor fold skipped: %'', sqlerrm;\n  end;\n  -- labor_fold_v1_end\n');
  EXECUTE d;
END $patch$;

-- Seed: in-scope cars whose stored read is missing, errored, stale or on an old key.
CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal_enqueue(p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
-- One queue (ta-facts, 2026-11-25): signals with reason labor_logic_key at priority 9, at most p_limit per run, for
-- in-scope cars whose stored row is missing, errored, stale or on an old key. model_fold_absorb_signals moves them to
-- model_fold_work; each runs the full model_fold_one.
DECLARE k text := public.vehicle_labor_appraisal_logic_key(); n int := 0;
BEGIN
  DELETE FROM public.vehicle_labor_appraisal_fold_runs WHERE started_at < now() - interval '30 days';
  INSERT INTO public.model_fold_signal (vehicle_id, reason, priority)
  SELECT c.vehicle_id, 'labor_logic_key', 4
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
     AND NOT EXISTS (SELECT 1 FROM public.model_fold_signal g WHERE g.vehicle_id = c.vehicle_id AND g.reason = 'labor_logic_key')
   ORDER BY c.vehicle_id
   LIMIT greatest(0, least(coalesce(p_limit, 500), 500));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('queued', n, 'key', k);
END $fn$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_enqueue(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal_enqueue(integer) TO service_role;

-- Gauge (ta-facts condition 5): rows off the current key, stale, errored, and the newest fold. Off-key should reach 0
-- after a rule edit; flat above 0 is the defect.
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
      FROM public.vehicle_labor_appraisal_fold_runs r WHERE r.started_at > now() - interval '24 hours')
  SELECT jsonb_build_object('rows', st.n_rows, 'off_key', st.off_key, 'stale_now', st.stale_now, 'errored', st.errored,
    'newest_folded_at', st.newest_folded_at, 'folds_24h', runs.folds_24h, 'stamps_answered_24h', runs.stamps_answered_24h,
    'errors_24h', runs.errors_24h, 'stale_p50_s', runs.stale_p50_s, 'stale_p90_s', runs.stale_p90_s, 'key', (SELECT k FROM k))
  FROM st, runs
$fn$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_gauge() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal_gauge() TO service_role;

DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vehicle-labor-appraisal-seed') THEN
      PERFORM cron.unschedule('vehicle-labor-appraisal-seed');
    END IF;
    PERFORM cron.schedule('vehicle-labor-appraisal-seed', '1-56/5 * * * *',
      $c$SET client_min_messages = error; SET statement_timeout = '30s'; SET lock_timeout = '5s'; SELECT public.vehicle_labor_appraisal_enqueue(500);$c$);
  END IF;
END $cron$;
