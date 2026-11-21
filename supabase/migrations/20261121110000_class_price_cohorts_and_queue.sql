-- class_price_v2: cohorts for owned cars, and a refresh queue that keeps the stored class price current.
--
-- Why. vehicle_class_price (20261121073000, 20261121090000) was filled once by hand for the owner's garage (138 cars,
-- 2026-11-20): 13 priced, 91 subject build class unknown, 28 "no registered cohort", 6 missing year/make. All 28 have a
-- known build class, so the cohort is the only thing between them and a price. Two causes, read 2026-11-20:
--   1. The refresh resolves the model by exact string or exact alias only, stricter than cohort_members, which matches
--      members with '\y' word patterns: "Bronco 351w", "K10 SWB", "Charger 318", "Suburban 2500" resolve to nothing,
--      although "Bronco 351w" is a member of the registered 1974 Ford Bronco cohort (677 members).
--   2. make_model_profiles holds 91 year rows, written only by register_make_model_subject when someone opens a cohort page
--      or universal search. Most of the 28 resolve to a canonical model whose year was never opened (1971 C10, 1979 K10,
--      2004 Silverado ...).
-- And nothing re-runs the refresh: a new receipt or work session, or an edited description, never reaches the price.
--
-- What this adds or changes:
--   1. resolve_class_price_cohort(make, model, year): the cohort resolver, one function. Exact name or alias first (as
--      before; when several canonical models match exactly, the one with a year profile wins, else it refuses). Otherwise
--      the canonical model whose own NAME is a whole word ('\y') of the vehicle's model, unique within the make and not
--      outside its recorded years. Narrower than cohort_members on purpose: aliases are not word-matched ("2500",
--      "custom", "4x4", "cheyenne" are aliases), and a name that is a whole word of the model is always in the
--      cohort_members pattern, so the subject is a member of the cohort it resolves to. A model naming a kit or replica
--      is refused (its year-make-model cohort is of the original). No loose substring anywhere.
--   2. Registration: when the resolved canonical model has no year profile, refresh_vehicle_class_price registers one
--      through the existing register_make_model_subject (definer; one insert ... on conflict into make_model_profiles,
--      idempotent under its NULLS NOT DISTINCT cohort key; the same call the cohort page and universal search make with a
--      year-make-model). Only with the canonical model's name, and only when the model names it as a whole word, its
--      recorded years do not exclude the year, and no other canonical model of the make lists that name as an alias
--      (register resolves the name again with LIMIT 1). The raw model string is never registered.
--   3. Never blank: a refresh that runs out of budget before the cohort is classified leaves a stored priced row as it
--      is and answers complete = false; a priced row is replaced only by a finished computation or a definitive blocked
--      reason. The subject must be a member of its resolved cohort, or the row says so.
--   4. vehicle_class_price_recompute_queue (the vehicle_*_recompute_queue shape) and drain_vehicle_class_price_queue:
--      claims by DELETE ... RETURNING (as the siblings do), refreshes one vehicle at a time under a clock budget, puts back
--      ids that come back incomplete or not reached, retries an error up to 3 times. Each call first tops the queue up
--      with up to 50 stored rows older than 24 hours (the daily sweep, which also catches description, year, make and
--      model edits: no trigger on vehicles).
--   5. Enqueue: enqueue_vehicle_class_price_on_paper(), a definer trigger function on receipts (insert, delete, update of
--      vehicle_id, total_amount, total, superseded_at) and work_sessions (insert, delete, update of vehicle_id,
--      session_type), keyed on NEW and OLD vehicle_id, the columns nuke_build_class_rule reads. New triggers rather than
--      the existing recompute_value_from_receipts: that function enqueues only scope_type 'vehicle' rows with status
--      validated or saved (no row carried either on 2026-10-09), while 74 of the 407 receipts with a vehicle_id have no
--      vehicle scope; and it is security invoker, so a signed-in writer's insert into a locked queue would fail the
--      receipt. The definer trigger function cannot be called as an RPC, and an enqueue failure only warns.
--   6. drain_vehicle_derived_queues (job 500, every 2 min, 30 s budget): the four existing slices are byte-identical
--      (the FOREACH loop is untouched); a fifth row, class_price, runs after them and starts refreshes only before two
--      thirds of the budget, at most 20 a run. Refused below unless the live body is the one this was written against
--      (md5 f2e15e76..., read 2026-11-20) or this migration's own.
--
-- No DDL on vehicles and no trigger on it. Locks: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on receipts and work_sessions
-- (1 and 0 rows written in the last 7 days, 2026-11-20) under the 5 s lock timeout.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 0. Refuse to replace bodies that changed since they were read --------------------------------------------------------
DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure));
  IF f NOT IN ('f2e15e76d18ecfdd966451635b0fa677', -- gitleaks:allow (function-definition fingerprint read 2026-11-20, not a secret)
               '2bf3f88d02acaa3244e4312893d18fd9') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'drain_vehicle_derived_queues changed since 2026-11-20 (md5 %); review before replacement', f;
  END IF;
  f := md5(pg_get_functiondef('public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure));
  IF f NOT IN ('90041fe7e3651974716ed3ac40a78bfd', -- gitleaks:allow (function-definition fingerprint read 2026-11-20, not a secret)
               'ed5bd27f0943561fc64a315db2f0a759') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'refresh_vehicle_class_price changed since 20261121090000 (md5 %); review before replacement', f;
  END IF;
  -- Registration calls this body; it must be the one read (insert ... on conflict, canonical lookup by name or alias).
  f := md5(pg_get_functiondef('public.register_make_model_subject(text,text,integer,text,integer,integer,text,text)'::regprocedure));
  IF f <> 'd32567070a7695b3aa77d82d9014d540' THEN -- gitleaks:allow (function-definition fingerprint read 2026-11-20, not a secret)
    RAISE EXCEPTION 'register_make_model_subject changed since 2026-11-20 (md5 %); review before calling it from the refresh', f;
  END IF;
END
$guard$;

-- 1. The resolver -------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_class_price_cohort(p_make text, p_model text, p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_model    text := lower(btrim(coalesce(p_model, '')));
  v_exact    text[]; v_named text[]; v_prof text[];
  v_canon    text; v_name text; v_tier text := 'none'; v_subject uuid;
  v_refusal  text; v_reg_refusal text; v_register boolean := false;
BEGIN
  IF p_make IS NULL OR p_year IS NULL OR v_model = '' THEN
    RETURN jsonb_build_object('tier', 'none', 'register', false, 'refusal', 'vehicle missing year, make or model');
  END IF;

  IF v_model ~ '\y(kit|replica)\y' THEN
    v_refusal := 'the model names a kit or replica, and the year-make-model cohort is of the original';
  ELSE
    -- Per canonical model of the make (case variants of one name are one model): matched exactly (name or alias),
    -- named (its name is a whole word of the model), outside its recorded years (every row that records years excludes
    -- this one), and whether a year profile exists.
    WITH cm AS (
      SELECT lower(c.canonical_model) AS canon, c.year_start, c.year_end, c.aliases
        FROM canonical_models c
       WHERE lower(c.make) = lower(p_make) AND length(btrim(coalesce(c.canonical_model, ''))) > 0),
    per AS (
      SELECT cm.canon,
             bool_or(cm.canon = v_model OR v_model = ANY (SELECT lower(a) FROM unnest(cm.aliases) a)) AS exact,
             bool_or(v_model ~ ('\y' || regexp_replace(cm.canon, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\y')) AS named,
             bool_and(cm.year_start IS NOT NULL OR cm.year_end IS NOT NULL)
               AND bool_and(p_year NOT BETWEEN coalesce(cm.year_start, -1) AND coalesce(cm.year_end, 100000)) AS excluded
        FROM cm GROUP BY cm.canon)
    SELECT array_agg(per.canon ORDER BY per.canon) FILTER (WHERE per.exact),
           array_agg(per.canon ORDER BY per.canon) FILTER (WHERE per.named AND NOT per.excluded),
           array_agg(per.canon ORDER BY per.canon) FILTER (WHERE per.exact AND EXISTS (
             SELECT 1 FROM make_model_profiles p
              WHERE lower(p.canonical_make) = lower(p_make) AND lower(p.canonical_model) = per.canon
                AND p.grain = 'year' AND p.year = p_year))
      INTO v_exact, v_named, v_prof
      FROM per;

    IF cardinality(v_exact) = 1 THEN
      v_canon := v_exact[1]; v_tier := 'exact';
    ELSIF cardinality(v_exact) > 1 THEN
      IF cardinality(v_prof) = 1 THEN
        v_canon := v_prof[1]; v_tier := 'exact';
      ELSE
        v_refusal := format('the model matches %s canonical models exactly (%s)', cardinality(v_exact), array_to_string(v_exact, ', '));
      END IF;
    ELSIF cardinality(v_named) = 1 THEN
      v_canon := v_named[1]; v_tier := 'word';
    ELSIF cardinality(v_named) > 1 THEN
      v_refusal := format('the model names %s canonical models (%s)', cardinality(v_named), array_to_string(v_named, ', '));
    END IF;
  END IF;

  IF v_canon IS NOT NULL THEN
    SELECT c.canonical_model INTO v_name FROM canonical_models c
     WHERE lower(c.make) = lower(p_make) AND lower(c.canonical_model) = v_canon
     ORDER BY c.canonical_model LIMIT 1;
    SELECT p.subject_id INTO v_subject FROM make_model_profiles p
     WHERE lower(p.canonical_make) = lower(p_make) AND lower(p.canonical_model) = v_canon
       AND p.grain = 'year' AND p.year = p_year
     LIMIT 1;
    IF v_subject IS NULL THEN
      IF NOT (v_canon = ANY (coalesce(v_named, '{}'))) THEN
        v_reg_refusal := format('%s is matched only through an alias or outside its recorded years, so it is not registered', v_name);
      ELSIF EXISTS (SELECT 1 FROM canonical_models c
                     WHERE lower(c.make) = lower(p_make) AND lower(c.canonical_model) <> v_canon
                       AND v_canon = ANY (SELECT lower(a) FROM unnest(c.aliases) a)) THEN
        v_reg_refusal := format('another canonical model of the make lists %s as an alias, so it is not registered', v_name);
      ELSE
        v_register := true;
      END IF;
    END IF;
  ELSE
    -- No canonical model: a year profile registered under the raw model string, as the refresh read it before.
    SELECT p.subject_id INTO v_subject FROM make_model_profiles p
     WHERE lower(p.canonical_make) = lower(p_make) AND lower(p.canonical_model) = v_model
       AND p.grain = 'year' AND p.year = p_year
     LIMIT 1;
    IF v_subject IS NOT NULL THEN v_tier := 'raw'; END IF;
  END IF;

  RETURN jsonb_build_object('tier', v_tier, 'canonical_model', v_name, 'subject_id', v_subject, 'register', v_register,
    'refusal', v_refusal, 'register_refusal', v_reg_refusal);
END;
$function$;
COMMENT ON FUNCTION public.resolve_class_price_cohort(text, text, integer) IS
  'The class price cohort for a year, make and model: the canonical model matched exactly (name or alias; a year profile '
  'breaks a tie, else refused), else the canonical model whose name is a whole word of the model (unique in the make, not '
  'outside its recorded years); kit or replica models refused. Returns tier, canonical_model, subject_id (the year '
  'profile), register (true when refresh_vehicle_class_price may register the year profile) and the refusal. Read only.';
REVOKE ALL ON FUNCTION public.resolve_class_price_cohort(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_class_price_cohort(text, text, integer) TO service_role;

-- 2. Refresh: resolver, registration, membership, never blank (body otherwise 20261121090000) ---------------------------
CREATE OR REPLACE FUNCTION public.refresh_vehicle_class_price(
  p_vehicle_id uuid, p_budget_ms integer DEFAULT 8000, p_chunk integer DEFAULT 500,
  p_max_age interval DEFAULT interval '30 days')
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO public, pg_temp
 SET statement_timeout TO '58s'
AS $function$
DECLARE
  c_method  constant text := 'class_price_v2';
  c_class   constant text := 'v4_store_word_terms';   -- the version classify_vehicle_build_class writes
  c_min     constant integer := 5;
  v_t0      timestamptz := clock_timestamp();
  -- 0 classifies no member and reports progress. The bound is this clock budget, checked before each chunk: a statement_timeout set inside a running statement does
  -- not re-arm its timer. One chunk is about 1.3 ms a member (6,281 members in 7.8 s, measured 2026-11-20).
  v_budget  interval := make_interval(secs => least(greatest(coalesce(p_budget_ms, 8000), 0), 50000) / 1000.0);
  v_chunk   integer := least(greatest(coalesce(p_chunk, 500), 1), 2000);
  v_age     interval := coalesce(p_max_age, interval '30 days');
  v_found   boolean; v_year integer; v_make text; v_model text;
  v_build   text; v_coarse text; v_canon text; v_subject uuid; v_label text;
  v_res     jsonb := '{}'; v_registered boolean := false;
  v_ids     uuid[]; v_members integer; v_todo uuid[] := '{}'; v_offset integer := 0; v_left integer := 0;
  v_n       integer; v_median numeric; v_p25 numeric; v_p75 numeric;
  v_reason  text; v_basis text; v_status text;
BEGIN
  IF p_vehicle_id IS NULL THEN RAISE EXCEPTION 'p_vehicle_id is required' USING ERRCODE = '22023'; END IF;
  -- Writes touch only vehicle_build_class, vehicle_class_price and (registration) make_model_profiles; never wait long.
  PERFORM set_config('lock_timeout', '2s', true);

  SELECT true, v.year, v.make, v.model INTO v_found, v_year, v_make, v_model FROM vehicles v WHERE v.id = p_vehicle_id;
  IF v_found IS NULL THEN
    RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'status', 'not_found', 'complete', true);
  END IF;

  IF v_year IS NULL OR v_make IS NULL THEN
    v_reason := 'vehicle missing year/make';
  ELSE
    -- The subject is always classified afresh: it is one row and its paper may be new.
    PERFORM public.classify_vehicle_build_class(ARRAY[p_vehicle_id]);
    SELECT b.build_class, b.coarse_class INTO v_build, v_coarse FROM vehicle_build_class b WHERE b.vehicle_id = p_vehicle_id;
    IF v_coarse IS DISTINCT FROM 'build' AND v_coarse IS DISTINCT FROM 'stock' THEN
      v_reason := 'subject build class unknown: no text or paper signal yet (needs vision); not a stock verdict';
    ELSE
      -- The cohort (resolve_class_price_cohort); a missing year profile of a canonical model the model names is
      -- registered through register_make_model_subject with the canonical name, never the raw model string.
      v_res := public.resolve_class_price_cohort(v_make, v_model, v_year);
      v_canon := coalesce(v_res->>'canonical_model', v_model);
      v_subject := (v_res->>'subject_id')::uuid;
      IF v_subject IS NULL AND (v_res->>'register')::boolean THEN
        v_subject := public.register_make_model_subject(v_make, v_res->>'canonical_model', v_year, 'year');
        -- register resolves the name again: keep the subject only if it is this canonical model's year profile.
        IF v_subject IS NOT NULL AND NOT EXISTS (SELECT 1 FROM make_model_profiles p
             WHERE p.subject_id = v_subject AND lower(p.canonical_model) = lower(v_canon)
               AND p.grain = 'year' AND p.year = v_year) THEN
          v_subject := NULL;
          v_res := v_res || jsonb_build_object('register_refusal', 'registration resolved to another canonical model');
        END IF;
        v_registered := v_subject IS NOT NULL;
      END IF;
      v_label := format('%s %s %s', v_year, v_make, v_canon);
      IF v_subject IS NULL THEN
        v_reason := 'no registered cohort for this year-make-model'
                    || coalesce(': ' || coalesce(v_res->>'refusal', v_res->>'register_refusal'), '');
      ELSE
        SELECT coalesce(array_agg(c.vehicle_id), '{}') INTO v_ids FROM cohort_members(v_subject) c;
        v_members := cardinality(v_ids);
        IF NOT (p_vehicle_id = ANY (v_ids)) THEN
          v_reason := format('the vehicle is not a member of its resolved cohort (%s)', v_label);
        ELSE
          -- Members with no current class row: none, an older method, or older than p_max_age.
          SELECT coalesce(array_agg(m ORDER BY m), '{}') INTO v_todo
            FROM unnest(v_ids) m LEFT JOIN vehicle_build_class b ON b.vehicle_id = m
           WHERE m <> p_vehicle_id
             AND (b.vehicle_id IS NULL OR b.method_version IS DISTINCT FROM c_class OR b.classified_at < now() - v_age);
          WHILE v_offset < cardinality(v_todo) AND clock_timestamp() - v_t0 < v_budget LOOP
            PERFORM public.classify_vehicle_build_class(v_todo[v_offset + 1 : v_offset + v_chunk]);
            v_offset := v_offset + v_chunk;
          END LOOP;
          v_left := greatest(cardinality(v_todo) - v_offset, 0);
          IF v_left > 0 THEN
            v_reason := format('cohort not yet classified (%s of %s)', v_members - v_left, v_members);
          ELSE
            -- Same coarse class as the subject, the subject excluded; one sale price per comp (its highest eligible).
            SELECT count(c.px), percentile_cont(0.5) WITHIN GROUP (ORDER BY c.px),
                   percentile_cont(0.25) WITHIN GROUP (ORDER BY c.px), percentile_cont(0.75) WITHIN GROUP (ORDER BY c.px)
              INTO v_n, v_median, v_p25, v_p75
              FROM (SELECT (SELECT max(e.final_price) FROM comp_eligible_vehicle_events e
                             WHERE e.vehicle_id = b.vehicle_id AND e.final_price > 0) AS px
                      FROM vehicle_build_class b
                     WHERE b.vehicle_id = ANY (v_ids) AND b.vehicle_id <> p_vehicle_id AND b.coarse_class = v_coarse) c
             WHERE c.px IS NOT NULL;
            v_n := coalesce(v_n, 0);
            IF v_n < c_min THEN
              v_reason := format('only %s sold comps of the same build class (need %s)', v_n, c_min);
            ELSE
              v_basis := format('median of %s sold comps of the same build class (%s) in the %s cohort', v_n, v_coarse, v_label);
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Never blank: an unfinished cohort does not overwrite a stored price; the caller re-runs until complete.
  IF v_left > 0 AND EXISTS (SELECT 1 FROM vehicle_class_price c WHERE c.vehicle_id = p_vehicle_id AND c.status = 'priced') THEN
    RETURN jsonb_build_object(
      'vehicle_id', p_vehicle_id, 'status', 'pending', 'complete', false, 'kept_prior_price', true,
      'reason', v_reason, 'subject_coarse_class', v_coarse, 'cohort', v_label, 'cohort_members', v_members,
      'resolution', v_res->>'tier', 'registered', v_registered,
      'classified_this_call', least(v_offset, cardinality(v_todo)),
      'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000));
  END IF;

  v_status := CASE WHEN v_reason IS NULL THEN 'priced' ELSE 'blocked' END;
  INSERT INTO vehicle_class_price AS t (vehicle_id, status, value, value_low, value_high, n, blocked_reason,
      subject_build_class, subject_coarse_class, cohort_subject_id, cohort_label, cohort_members, cohort_classified,
      basis, method_version, computed_at)
  VALUES (p_vehicle_id, v_status,
      CASE WHEN v_status = 'priced' THEN round(v_median) END,
      CASE WHEN v_status = 'priced' THEN round(v_p25) END,
      CASE WHEN v_status = 'priced' THEN round(v_p75) END,
      v_n, v_reason, v_build, v_coarse, v_subject, CASE WHEN v_subject IS NOT NULL THEN v_label END,
      v_members, CASE WHEN v_members IS NOT NULL THEN v_members - v_left END,
      v_basis, c_method, clock_timestamp())
  ON CONFLICT (vehicle_id) DO UPDATE SET
    status = EXCLUDED.status, value = EXCLUDED.value, value_low = EXCLUDED.value_low, value_high = EXCLUDED.value_high,
    n = EXCLUDED.n, blocked_reason = EXCLUDED.blocked_reason, subject_build_class = EXCLUDED.subject_build_class,
    subject_coarse_class = EXCLUDED.subject_coarse_class, cohort_subject_id = EXCLUDED.cohort_subject_id,
    cohort_label = EXCLUDED.cohort_label, cohort_members = EXCLUDED.cohort_members,
    cohort_classified = EXCLUDED.cohort_classified, basis = EXCLUDED.basis, method_version = EXCLUDED.method_version,
    computed_at = EXCLUDED.computed_at;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id, 'status', v_status, 'complete', v_left = 0,
    'value', CASE WHEN v_status = 'priced' THEN round(v_median) END,
    'value_low', CASE WHEN v_status = 'priced' THEN round(v_p25) END,
    'value_high', CASE WHEN v_status = 'priced' THEN round(v_p75) END,
    'n', v_n, 'reason', v_reason, 'subject_coarse_class', v_coarse, 'cohort', CASE WHEN v_subject IS NOT NULL THEN v_label END,
    'cohort_members', v_members, 'resolution', v_res->>'tier', 'registered', v_registered,
    'classified_this_call', least(v_offset, cardinality(v_todo)),
    'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000));
END;
$function$;
COMMENT ON FUNCTION public.refresh_vehicle_class_price(uuid, integer, integer, interval) IS
  'Recomputes one vehicle''s class price into vehicle_class_price (method class_price_v2): subject classified afresh, '
  'cohort from resolve_class_price_cohort (its year profile registered through register_make_model_subject when the '
  'model names the canonical model), members classified in chunks under a clock budget (p_budget_ms), price from the '
  'store once every member is classified. An unfinished cohort never overwrites a stored price (status pending, '
  'complete false). Re-run until complete. Service role and the class price queue only.';
REVOKE ALL ON FUNCTION public.refresh_vehicle_class_price(uuid, integer, integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_vehicle_class_price(uuid, integer, integer, interval) TO service_role;

-- 3. The queue ----------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_class_price_recompute_queue (
  vehicle_id uuid PRIMARY KEY,
  queued_at  timestamptz NOT NULL DEFAULT now(),
  attempts   smallint NOT NULL DEFAULT 0,
  last_error text,
  reason     text
);
CREATE INDEX IF NOT EXISTS vehicle_class_price_recompute_queue_queued_at ON public.vehicle_class_price_recompute_queue (queued_at);
ALTER TABLE public.vehicle_class_price_recompute_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vehicle_class_price_recompute_queue FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.vehicle_class_price_recompute_queue TO service_role;
COMMENT ON TABLE public.vehicle_class_price_recompute_queue IS
  'Vehicles whose stored class price (vehicle_class_price) is due a refresh: enqueued by enqueue_vehicle_class_price_on_paper '
  '(receipts, work_sessions), by drain_vehicle_class_price_queue''s daily top-up (stored rows older than 24 h) and by '
  'refreshes that came back incomplete. reason: receipt | work_session | stale | incomplete | not_reached | error. '
  'Drained by drain_vehicle_class_price_queue from drain_vehicle_derived_queues (job 500). Written only by definers.';
-- The daily top-up reads the store by age.
CREATE INDEX IF NOT EXISTS vehicle_class_price_computed_at ON public.vehicle_class_price (computed_at);

-- 4. Enqueue from paper ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_vehicle_class_price_on_paper()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE v_reason text := CASE TG_TABLE_NAME WHEN 'receipts' THEN 'receipt' ELSE 'work_session' END;
BEGIN
  BEGIN
    INSERT INTO vehicle_class_price_recompute_queue AS q (vehicle_id, queued_at, reason)
    SELECT x.id, now(), v_reason
      FROM (SELECT CASE WHEN TG_OP <> 'DELETE' THEN NEW.vehicle_id END AS id
            UNION
            SELECT CASE WHEN TG_OP <> 'INSERT' THEN OLD.vehicle_id END) x
     WHERE x.id IS NOT NULL
    ON CONFLICT (vehicle_id) DO UPDATE SET queued_at = least(q.queued_at, EXCLUDED.queued_at), attempts = 0,
      reason = EXCLUDED.reason;
  EXCEPTION WHEN OTHERS THEN
    -- The paper is the write that matters; the daily top-up catches a missed enqueue.
    RAISE WARNING 'class price enqueue from % failed: %', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;
COMMENT ON FUNCTION public.enqueue_vehicle_class_price_on_paper() IS
  'AFTER row trigger on receipts and work_sessions: queues NEW and OLD vehicle_id in vehicle_class_price_recompute_queue '
  '(definer, so a signed-in writer needs no queue grant; a failure warns and never fails the write).';
REVOKE ALL ON FUNCTION public.enqueue_vehicle_class_price_on_paper() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_receipts_class_price_enqueue
  AFTER INSERT OR DELETE OR UPDATE OF vehicle_id, total_amount, total, superseded_at ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_vehicle_class_price_on_paper();
CREATE OR REPLACE TRIGGER trg_work_sessions_class_price_enqueue
  AFTER INSERT OR DELETE OR UPDATE OF vehicle_id, session_type ON public.work_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_vehicle_class_price_on_paper();

-- 5. The drain ------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drain_vehicle_class_price_queue(p_batch_size integer DEFAULT 1, p_budget_ms integer DEFAULT 8000)
 RETURNS TABLE(processed integer, errored integer)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_t0     timestamptz := clock_timestamp();
  v_budget integer := least(greatest(coalesce(p_budget_ms, 8000), 0), 20000);
  v_batch  integer := least(greatest(coalesce(p_batch_size, 1), 1), 20);
  v_left   integer;
  v_res    jsonb;
  r        record;
BEGIN
  processed := 0; errored := 0;
  -- Too little time to refresh anything: claim nothing.
  IF v_budget < 1000 THEN RETURN NEXT; RETURN; END IF;

  -- The daily sweep: stored rows older than 24 h (paper, text, year, make or model may have changed since), 50 a call.
  INSERT INTO vehicle_class_price_recompute_queue (vehicle_id, queued_at, reason)
  SELECT p.vehicle_id, now(), 'stale'
    FROM vehicle_class_price p
   WHERE p.computed_at < now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM vehicle_class_price_recompute_queue q WHERE q.vehicle_id = p.vehicle_id)
     AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = p.vehicle_id)
   ORDER BY p.computed_at
   LIMIT 50
  ON CONFLICT (vehicle_id) DO NOTHING;

  FOR r IN
    DELETE FROM vehicle_class_price_recompute_queue
     WHERE vehicle_id IN (SELECT q.vehicle_id FROM vehicle_class_price_recompute_queue q
                           ORDER BY q.queued_at LIMIT v_batch FOR UPDATE SKIP LOCKED)
    RETURNING vehicle_id, attempts, reason
  LOOP
    v_left := v_budget - (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::integer;
    IF v_left < 1000 THEN
      INSERT INTO vehicle_class_price_recompute_queue (vehicle_id, queued_at, attempts, reason)
      VALUES (r.vehicle_id, now(), r.attempts, 'not_reached') ON CONFLICT (vehicle_id) DO NOTHING;
      CONTINUE;
    END IF;
    BEGIN
      v_res := public.refresh_vehicle_class_price(r.vehicle_id, v_left);
      processed := processed + 1;
      -- Incomplete (cohort not yet classified): stays queued, behind the others; its classified members are kept.
      IF NOT coalesce((v_res->>'complete')::boolean, false) THEN
        INSERT INTO vehicle_class_price_recompute_queue (vehicle_id, queued_at, reason)
        VALUES (r.vehicle_id, now(), 'incomplete') ON CONFLICT (vehicle_id) DO NOTHING;
      END IF;
    EXCEPTION
      WHEN query_canceled THEN RAISE;
      WHEN OTHERS THEN
        errored := errored + 1;
        IF r.attempts + 1 < 3 THEN
          INSERT INTO vehicle_class_price_recompute_queue (vehicle_id, queued_at, attempts, last_error, reason)
          VALUES (r.vehicle_id, now(), r.attempts + 1, SQLERRM, 'error')
          ON CONFLICT (vehicle_id) DO UPDATE SET attempts = EXCLUDED.attempts, last_error = EXCLUDED.last_error;
        ELSE
          RAISE WARNING 'class price refresh of % failed 3 times, dropped until the daily top-up: %', r.vehicle_id, SQLERRM;
        END IF;
    END;
  END LOOP;
  RETURN NEXT;
END;
$function$;
COMMENT ON FUNCTION public.drain_vehicle_class_price_queue(integer, integer) IS
  'Drains vehicle_class_price_recompute_queue: tops it up with stored class prices older than 24 h (50 a call), claims the '
  'oldest p_batch_size ids (DELETE ... RETURNING, SKIP LOCKED) and runs refresh_vehicle_class_price on each under '
  'p_budget_ms (at most 20 s); incomplete and not-reached ids go back, an error is retried up to 3 times. Called by '
  'drain_vehicle_derived_queues.';
REVOKE ALL ON FUNCTION public.drain_vehicle_class_price_queue(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_vehicle_class_price_queue(integer, integer) TO service_role;

-- 6. The controller: the live body, unchanged through its FOREACH loop, and a fifth row after it ------------------------
CREATE OR REPLACE FUNCTION public.drain_vehicle_derived_queues(p_include_value boolean DEFAULT false, p_budget_seconds integer DEFAULT 45)
 RETURNS TABLE(queue text, processed integer, errored integer, skipped boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  -- A NULL or absurd budget cannot switch the time stop off.
  v_budget integer := least(greatest(coalesce(p_budget_seconds, 45), 5), 60);
  v_t0     timestamptz := clock_timestamp();
  v_until  timestamptz;
  v_p      integer;
  v_e      integer;
  v_chunk  integer;
  v_cap    integer;
  v_failed_chunks integer;
  v_name   text;
BEGIN
  -- The drains' writebacks must not re-enqueue completion recomputes (update_vehicle_completion reads this).
  PERFORM set_config('app.skip_completion_enqueue', '1', true);
  -- Transaction-local (set_config(..., true)): it reverts when the calling transaction, the cron job's own, ends.
  -- A vehicles row held by another writer fails that one vehicle after 2 s; the drain re-queues it.
  PERFORM set_config('lock_timeout', '2s', true);

  -- Metric starts chunks in the first half; siblings stop starting chunks at two thirds of the budget.
  -- The reserved sixth lets stats and completion progress after a metric burst; the final third is headroom.
  FOREACH v_name IN ARRAY ARRAY['metric', 'stats', 'value', 'completion'] LOOP
    queue := v_name; processed := 0; errored := 0; skipped := false; v_failed_chunks := 0;
    v_until := v_t0 + make_interval(secs => v_budget / CASE WHEN v_name = 'metric' THEN 2.0 ELSE 1.5 END);

    IF v_name = 'value' AND NOT p_include_value THEN
      skipped := true;                       -- off until the sale data is clean
    ELSIF clock_timestamp() >= v_until THEN
      skipped := true;                       -- this queue's slice is spent; the next run continues
    ELSE
      -- chunk = rows per inner call; cap = rows per run. Stats and value make one call.
      v_chunk := CASE v_name WHEN 'metric' THEN 10 WHEN 'completion' THEN 25 WHEN 'stats' THEN 50 ELSE 100 END;
      v_cap   := CASE v_name WHEN 'metric' THEN 500 WHEN 'completion' THEN 1000 ELSE v_chunk END;
      LOOP
        BEGIN
          v_p := NULL; v_e := NULL;
          CASE v_name
            WHEN 'metric'     THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_metric_queue(v_chunk) d;
            WHEN 'completion' THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_completion_queue(v_chunk) d;
            WHEN 'stats'      THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_stats_queue(v_chunk) d;
            WHEN 'value'      THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_value_queue(v_chunk) d;
          END CASE;
        EXCEPTION
          WHEN query_canceled THEN
            RAISE;                           -- the job's own budget fired; fail loudly, do not swallow
          WHEN OTHERS THEN
            errored := -1;                   -- whole-call failure; earlier chunks of this run stay done
            RAISE WARNING 'drain_vehicle_%_queue failed: %', v_name, SQLERRM;
        END;
        EXIT WHEN errored = -1;
        processed := processed + coalesce(v_p, 0);
        errored   := errored + coalesce(v_e, 0);
        IF coalesce(v_e, 0) > 0 THEN v_failed_chunks := v_failed_chunks + 1; END IF;
        IF v_failed_chunks >= 3 OR errored > 0.2 * (processed + errored) THEN
          RAISE WARNING 'drain_vehicle_%_queue stopped for this run: % failed rows in % chunks', v_name, errored, v_failed_chunks;
          EXIT;
        END IF;
        -- Stop when the queue ran short, the cap is reached, or this queue's slice has no time for another chunk.
        EXIT WHEN coalesce(v_p, 0) + coalesce(v_e, 0) < v_chunk
               OR processed + errored >= v_cap
               OR clock_timestamp() >= v_until;
      END LOOP;
    END IF;

    RETURN NEXT;
  END LOOP;

  -- class_price (20261121110000): after the four slices above, which run first and unchanged. One vehicle a call, started
  -- only before two thirds of the budget (its refresh gets the time left to that point), at most 20 a run, stopped by 3
  -- failed calls. A refresh checks its clock between chunks, so the last one can run past the slice into the final third.
  queue := 'class_price'; processed := 0; errored := 0; skipped := false;
  v_until := v_t0 + make_interval(secs => v_budget / 1.5);
  IF clock_timestamp() >= v_until THEN
    skipped := true;
  ELSE
    LOOP
      BEGIN
        v_p := NULL; v_e := NULL;
        SELECT d.processed, d.errored INTO v_p, v_e
          FROM public.drain_vehicle_class_price_queue(1,
                 greatest((extract(epoch FROM v_until - clock_timestamp()) * 1000)::integer, 0)) d;
      EXCEPTION
        WHEN query_canceled THEN
          RAISE;
        WHEN OTHERS THEN
          errored := -1;
          RAISE WARNING 'drain_vehicle_class_price_queue failed: %', SQLERRM;
      END;
      EXIT WHEN errored = -1;
      processed := processed + coalesce(v_p, 0);
      errored   := errored + coalesce(v_e, 0);
      EXIT WHEN coalesce(v_p, 0) + coalesce(v_e, 0) < 1
             OR processed + errored >= 20
             OR errored >= 3
             OR clock_timestamp() >= v_until;
    END LOOP;
  END IF;
  RETURN NEXT;
END;
$function$;
COMMENT ON FUNCTION public.drain_vehicle_derived_queues(boolean, integer) IS
  'Existing sequential metric/stats/value/completion controller. Budget coalesce45 clamped5..60; metric10/call,500/run starts through half the budget; siblings stats50/value100/completion25,1000/run start through two thirds, with final-third headroom. Existing retry circuit and transaction-local2s lock timeout. Value remains OFF in the unchanged every2min cron. Canonical metric owner and source clocks unchanged. Rebalanced2026-10-09 after >3h metric lag. 20261121110000: a fifth row, class_price (drain_vehicle_class_price_queue, one vehicle a call, at most 20 a run, started through two thirds of the budget), after the four.';
REVOKE ALL ON FUNCTION public.drain_vehicle_derived_queues(boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_vehicle_derived_queues(boolean, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
