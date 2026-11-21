-- vehicle_class_price_v1: build class and class price stored per vehicle, computed once by a caller-independent
-- refresh, read through one tied-viewer batch reader.
--
-- Why. get_class_stratified_price(vehicle) prices a car as the median, p25-p75 and n of the sold comps of its own coarse
-- build class (build | stock) in its year-make-model cohort. It classifies every cohort member inline, twice, through
-- nuke_build_class (receipts sum, work-session count, a vehicle_images count that never affects the class, text
-- scoring), so its cost grows with the cohort: measured 2026-11-20 as postgres, 173 members 0.2-1.8 s, 633 members 8.6 s,
-- the 1965 Mustang (6,281 members), 1966 Mustang and 1967 Camaro cohorts past the 10 s timeout; as a signed-in browser
-- user it hit the 15 s role timeout (HTTP 500). It is security invoker, so row security hides other accounts' receipts and
-- work sessions from the classifier and the answer depends on the caller (anon got "blocked" for a car postgres prices at
-- n 35). The garage cards meanwhile read old v1 class rows from nuke_estimates, a different computation that the
-- valuation writer no longer emits; two of them disagree with the live reader.
--
-- What this adds or extends (one owner per datum):
--   1. nuke_build_class_rule(receipts, sessions, text): the build-class rule, verbatim from nuke_build_class v2
--      (20260623100000), as one pure function. nuke_build_class keeps its invoker data scope and its output shape
--      (source_dna.photos included) and now calls the rule, so the rule exists once. Parity, read 2026-11-20 over the 173
--      members of the 1973 Pontiac Firebird cohort: class, confidence, scores and engine-swap identical for all 173.
--   2. vehicle_build_class (exists: 1,843 Blazer/Jimmy rows backfilled 2026-06-23 under v2_scored_text_unwired; row
--      security on, no policy) becomes the per-vehicle class store. classify_vehicle_build_class(ids) writes it set-based
--      as the definer (every receipt and work session counts, whoever filed it), method v3_store_text_paper, without the
--      photo count. No DDL on the table, so its foreign key to vehicles is not touched.
--   3. vehicle_class_price (new; no foreign key to vehicles, see below): one row per vehicle with the class price or the
--      reason it is not priced ("unknown" is an answer). Never nuke_estimates: that table is UNIQUE(vehicle_id) and owned by
--      compute-vehicle-valuation.
--   4. refresh_vehicle_class_price(vehicle, budget_ms, chunk, max_age): reclassifies the subject, classifies missing or
--      out-of-date cohort members in chunks under a clock budget, and prices from the store once every member is
--      classified; until then the row says "cohort not yet classified (k of n)". refresh_vehicle_class_prices(ids) runs it
--      for a list under one budget. Service role only. Not scheduled here (see the PR): drain_vehicle_derived_queues has a
--      fixed queue list and budget slices, which this would have to join through a queue of its own.
--   5. get_vehicle_class_prices(ids): the batch reader for the garage. A row only for a vehicle get_user_garage returns to
--      the caller's own account with a relationship that carries money (not profile_record: the same gate as
--      get_user_garage.current_value), or any vehicle for the service role. No anon. Returns value, band, n, coarse class,
--      basis words, blocked reason and computed_at; never source_dna or the receipts behind a class.
--   6. get_user_garage.current_value reads the stored class price instead of nuke_estimates class rows. Signature, ACL,
--      every other column and the viewer rule unchanged (CREATE OR REPLACE over the 20261116061500 body, identical to live
--      by pg_get_functiondef on 2026-11-20).
--   7. get_platform_stratified_price takes its comp pool from vehicle_build_class rows on its curated platform (full-size
--      Chevrolet/GMC Blazer and Jimmy, 1973-1991, compacts excluded: the predicate its 20260623110000 header records)
--      instead of the whole table, which now holds every refreshed cohort. 1,842 of the 1,843 June rows match the
--      predicate on 2026-11-20; the other is a record now named a G20 van.
--
-- Known and kept: the rule's '\b' terms are a backspace in PostgreSQL regular expressions, not a word boundary ('\y'), so
-- '\b(built|modified|upgraded|swapped|custom)\b' and '\b(stock|factory)\b' never match. Copied verbatim so the store
-- reproduces the live reader; correcting them is a separate, measured change.
--
-- No foreign key to vehicles: adding one takes SHARE ROW EXCLUSIVE on vehicles, and 20261121043000 rolled back twice on
-- the 5 s lock timeout behind 30-second vehicle writes. Rows are keyed by vehicle id and written only by the refresh,
-- which reads the vehicle first.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. The rule, once ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nuke_build_class_rule(p_receipts numeric, p_sessions integer, p_text text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO pg_catalog, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'build_class', CASE WHEN i.r >= 5000 OR i.w >= 20 THEN 'documented_build'
                        WHEN s.swap OR s.b >= 3 THEN 'modified'
                        WHEN s.b >= 1 AND s.b > s.st THEN 'modified'
                        WHEN s.st >= 1 AND s.st >= s.b THEN 'stock'
                        WHEN s.b >= 1 THEN 'modified'
                        ELSE 'unknown' END,
    'confidence', CASE WHEN i.r >= 5000 OR i.w >= 20 THEN 'high'
                       WHEN s.swap OR s.b >= 3 THEN 'high'
                       WHEN s.b >= 1 AND s.b > s.st THEN 'medium'
                       WHEN s.st >= 1 AND s.st >= s.b THEN 'medium'
                       WHEN s.b >= 1 THEN 'low'
                       ELSE 'none' END,
    'engine_swap', s.swap, 'build_score', s.b, 'stock_score', s.st,
    'reasons', jsonb_build_array(CASE
      WHEN i.r >= 5000 OR i.w >= 20 THEN format('documented investment/activity (receipts $%s, %s work sessions)', round(i.r), i.w)
      WHEN s.swap OR s.b >= 3 THEN format('engine-swap=%s, build signals=%s, stock signals=%s', s.swap, s.b, s.st)
      WHEN s.b >= 1 AND s.b > s.st THEN format('build signals=%s > stock signals=%s', s.b, s.st)
      WHEN s.st >= 1 AND s.st >= s.b THEN format('original/stock signals=%s >= build signals=%s (no engine swap)', s.st, s.b)
      WHEN s.b >= 1 THEN 'single build signal'
      ELSE 'no text or doc signal - needs vision (intake gap, not a stock verdict)' END))
  FROM (SELECT coalesce(p_receipts, 0) AS r, coalesce(p_sessions, 0) AS w, coalesce(p_text, '') AS x) i
  CROSS JOIN LATERAL (SELECT z.sw AS swap,
      -- the decisive build tell (a swapped/replaced engine or trans) counts as one build signal too
      z.sw::int
      + (i.x ~* 'resto[- ]?mod|pro[- ]?touring|custom built|frame[- ]?off')::int
      + (i.x ~* 'lift kit|lifted|lowered|lowering|coilover|air[- ]?ride|bagged|drop(ped)? spindle|tubbed')::int
      + (i.x ~* 'coys|american racing|cragar|weld|aftermarket wheel|rally wheel|\d{2}[- ]?(inch|″|in\.).{0,12}wheel')::int
      + (i.x ~* 'disc brake conversion|power disc|big brake|wilwood|headers|fuel.inject|efi conversion')::int
      + (i.x ~* 'grant .{0,12}(wheel|steering)|aftermarket (stereo|gauge|seat)|bluetooth|modern (stereo|audio)|restored|restoration')::int
      + (i.x ~* '\b(built|modified|upgraded|swapped|custom)\b')::int AS b,
      (i.x ~* 'original owner|numbers[- ]?matching|matching numbers|all[- ]?original|unrestored|survivor|factory original|as[- ]?delivered|bone[- ]?stock|untouched')::int
      + (i.x ~* 'original .{0,12}(paint|engine|drivetrain|interior|miles)|date[- ]?code|window sticker|build sheet')::int
      + (i.x ~* '\b(stock|factory)\b')::int AS st
    FROM (SELECT (i.x ~* '(engine|motor|v8|v-8|transmission|trans).{0,30}(replac|swap|rebuil|crate)'
               OR i.x ~* '(replac|swap|rebuil|crate|ls[- ]?\d|ls[- ]?swap).{0,30}(engine|motor|v8|v-8|transmission|trans)') AS sw) z) s
$function$;
-- nuke_build_class is security invoker and anon/authenticated reach it through get_class_stratified_price: they must be
-- able to run the rule it now calls. The rule reads nothing.
GRANT EXECUTE ON FUNCTION public.nuke_build_class_rule(numeric, integer, text) TO PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.nuke_build_class_rule(numeric, integer, text) IS
  'The build-class rule (nuke_build_class v2, 20260623100000) as one pure function of documented spend, work-session count '
  'and the lowercased description text. Used by nuke_build_class (caller''s view) and classify_vehicle_build_class (store).';

-- nuke_build_class: same reads, same output shape, the rule above.
CREATE OR REPLACE FUNCTION public.nuke_build_class(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_receipts numeric; v_sessions int; v_photos int; v_is_mod boolean; v_text text; v_rule jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_vehicle_id) THEN
    RETURN jsonb_build_object('error','vehicle not found','vehicle_id',p_vehicle_id);
  END IF;

  SELECT coalesce(sum(coalesce(total_amount,total)),0) INTO v_receipts
    FROM receipts WHERE vehicle_id = p_vehicle_id AND superseded_at IS NULL;
  SELECT count(*) INTO v_sessions
    FROM work_sessions WHERE vehicle_id = p_vehicle_id AND session_type IS DISTINCT FROM 'baseline_backfill';
  SELECT count(*) INTO v_photos FROM vehicle_images WHERE vehicle_id = p_vehicle_id;

  SELECT is_modified,
         lower(concat_ws(' ', description, bat_listing_title, listing_title, modifications,
                              modification_details, trim_details, notes, maintenance_notes))
    INTO v_is_mod, v_text FROM vehicles WHERE id = p_vehicle_id;
  v_text := coalesce(v_text,'');
  v_rule := public.nuke_build_class_rule(v_receipts, v_sessions, v_text);

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id, 'build_class', v_rule->>'build_class', 'confidence', v_rule->>'confidence',
    'method_version', 'v2_scored_text_unwired',
    'doctrine_note', 'Build class drives class-stratified comps; UNKNOWN stays blocked, never guessed. v2 scores full description text (engine-swap = decisive build tell). Tunable; owner-overridable.',
    'source_dna', jsonb_build_object(
      'receipts_total_USD', round(v_receipts), 'work_sessions', v_sessions, 'photos', v_photos,
      'is_modified_flag', v_is_mod, 'engine_swap', v_rule->'engine_swap',
      'build_score', v_rule->'build_score', 'stock_score', v_rule->'stock_score',
      'has_text', length(v_text) > 20, 'reasons', v_rule->'reasons'
    )
  );
END;
$function$;

-- 2. The class store --------------------------------------------------------------------------------------------------
COMMENT ON TABLE public.vehicle_build_class IS
  'Build class per vehicle (documented_build | modified | stock | unknown; coarse build | stock | unknown), classified by '
  'the definer from every receipt, work session and the description text (nuke_build_class_rule). Written only by '
  'classify_vehicle_build_class (method v3_store_text_paper) and the 2026-06-23 Blazer/Jimmy backfill '
  '(v2_scored_text_unwired). source_dna holds private amounts: no client reads this table; get_vehicle_class_prices '
  'returns the coarse class to tied viewers.';
REVOKE ALL ON TABLE public.vehicle_build_class FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vehicle_build_class TO service_role;

CREATE OR REPLACE FUNCTION public.classify_vehicle_build_class(p_vehicle_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE v_n integer;
BEGIN
  IF p_vehicle_ids IS NULL OR cardinality(p_vehicle_ids) > 2000 THEN
    RAISE EXCEPTION 'classify_vehicle_build_class takes 0 to 2000 vehicle ids' USING ERRCODE = '22023';
  END IF;
  -- Set-based: one pass over receipts and work sessions for the chunk, then the rule per vehicle.
  WITH ids AS (SELECT DISTINCT u AS id FROM unnest(p_vehicle_ids) u WHERE u IS NOT NULL),
  r AS (SELECT rc.vehicle_id, sum(coalesce(rc.total_amount, rc.total)) AS total
          FROM receipts rc JOIN ids ON ids.id = rc.vehicle_id
         WHERE rc.superseded_at IS NULL GROUP BY rc.vehicle_id),
  w AS (SELECT ws.vehicle_id, count(*)::int AS n
          FROM work_sessions ws JOIN ids ON ids.id = ws.vehicle_id
         WHERE ws.session_type IS DISTINCT FROM 'baseline_backfill' GROUP BY ws.vehicle_id),
  inp AS (SELECT v.id, v.is_modified, coalesce(r.total, 0) AS receipts, coalesce(w.n, 0) AS sessions,
                 coalesce(lower(concat_ws(' ', v.description, v.bat_listing_title, v.listing_title, v.modifications,
                                          v.modification_details, v.trim_details, v.notes, v.maintenance_notes)), '') AS txt
            FROM vehicles v JOIN ids ON ids.id = v.id
            LEFT JOIN r ON r.vehicle_id = v.id LEFT JOIN w ON w.vehicle_id = v.id),
  cls AS (SELECT inp.*, public.nuke_build_class_rule(inp.receipts, inp.sessions, inp.txt) AS j FROM inp)
  INSERT INTO vehicle_build_class AS t (vehicle_id, build_class, coarse_class, confidence, method_version, source_dna, classified_at)
  SELECT cls.id, cls.j->>'build_class',
         CASE WHEN cls.j->>'build_class' IN ('documented_build', 'modified') THEN 'build'
              WHEN cls.j->>'build_class' = 'stock' THEN 'stock' ELSE 'unknown' END,
         cls.j->>'confidence', 'v3_store_text_paper',
         jsonb_build_object('receipts_total_USD', round(cls.receipts), 'work_sessions', cls.sessions,
           'is_modified_flag', cls.is_modified, 'engine_swap', cls.j->'engine_swap', 'build_score', cls.j->'build_score',
           'stock_score', cls.j->'stock_score', 'has_text', length(cls.txt) > 20, 'reasons', cls.j->'reasons'),
         now()
    FROM cls
  ON CONFLICT (vehicle_id) DO UPDATE SET
    build_class = EXCLUDED.build_class, coarse_class = EXCLUDED.coarse_class, confidence = EXCLUDED.confidence,
    method_version = EXCLUDED.method_version, source_dna = EXCLUDED.source_dna, classified_at = EXCLUDED.classified_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
COMMENT ON FUNCTION public.classify_vehicle_build_class(uuid[]) IS
  'Classifies up to 2000 vehicles into vehicle_build_class (method v3_store_text_paper) as the definer, so the class does '
  'not depend on who asks. Service role and refresh_vehicle_class_price only.';
REVOKE ALL ON FUNCTION public.classify_vehicle_build_class(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classify_vehicle_build_class(uuid[]) TO service_role;

-- 3. The price store --------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_class_price (
  vehicle_id           uuid PRIMARY KEY,
  status               text NOT NULL CHECK (status IN ('priced', 'blocked')),
  value                numeric,
  value_low            numeric,
  value_high           numeric,
  n                    integer,
  blocked_reason       text,
  subject_build_class  text,
  subject_coarse_class text,
  cohort_subject_id    uuid,
  cohort_label         text,
  cohort_members       integer,
  cohort_classified    integer,
  basis                text,
  method_version       text NOT NULL,
  computed_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_class_price_shape CHECK (
    (status = 'priced' AND value IS NOT NULL AND value_low IS NOT NULL AND value_high IS NOT NULL AND n >= 5
       AND blocked_reason IS NULL AND basis IS NOT NULL)
    OR (status = 'blocked' AND value IS NULL AND value_low IS NULL AND value_high IS NULL AND blocked_reason IS NOT NULL))
);
ALTER TABLE public.vehicle_class_price ENABLE ROW LEVEL SECURITY;
-- Written only by refresh_vehicle_class_price (the definer); the service role may read it.
REVOKE ALL ON TABLE public.vehicle_class_price FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.vehicle_class_price TO service_role;
COMMENT ON TABLE public.vehicle_class_price IS
  'Class price per vehicle: the median (value), p25 (value_low), p75 (value_high) and n of the sold comps '
  '(comp_eligible_vehicle_events, max final_price per comp) of the same coarse build class in the vehicle''s registered '
  'year-make-model cohort, from vehicle_build_class; or status blocked with the reason. Written only by '
  'refresh_vehicle_class_price; read through get_vehicle_class_prices (tied viewers) and get_user_garage.current_value.';
COMMENT ON COLUMN public.vehicle_class_price.blocked_reason IS
  'Why there is no price: vehicle missing year/make, subject build class unknown, no registered cohort, cohort not yet '
  'classified (k of n), or fewer than 5 sold comps of the same build class.';
COMMENT ON COLUMN public.vehicle_class_price.cohort_classified IS
  'Cohort members with a current vehicle_build_class row when this row was computed; equals cohort_members once complete.';

-- 4. Refresh ----------------------------------------------------------------------------------------------------------
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
  c_method  constant text := 'class_price_v1';
  c_class   constant text := 'v3_store_text_paper';   -- the version classify_vehicle_build_class writes
  c_min     constant integer := 5;
  v_t0      timestamptz := clock_timestamp();
  -- 0 classifies no member and reports progress. The bound is this clock budget, checked before each chunk: a statement_timeout set inside a running statement does
  -- not re-arm its timer. One chunk is about 1.3 ms a member (6,281 members in 7.8 s, measured 2026-11-20).
  v_budget  interval := make_interval(secs => least(greatest(coalesce(p_budget_ms, 8000), 0), 50000) / 1000.0);
  v_chunk   integer := least(greatest(coalesce(p_chunk, 500), 1), 2000);
  v_age     interval := coalesce(p_max_age, interval '30 days');
  v_found   boolean; v_year integer; v_make text; v_model text;
  v_build   text; v_coarse text; v_canon text; v_subject uuid; v_label text;
  v_ids     uuid[]; v_members integer; v_todo uuid[] := '{}'; v_offset integer := 0; v_left integer := 0;
  v_n       integer; v_median numeric; v_p25 numeric; v_p75 numeric;
  v_reason  text; v_basis text; v_status text;
BEGIN
  IF p_vehicle_id IS NULL THEN RAISE EXCEPTION 'p_vehicle_id is required' USING ERRCODE = '22023'; END IF;
  -- Writes touch only vehicle_build_class and vehicle_class_price; never wait long behind another writer.
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
      -- The cohort, resolved as get_class_stratified_price resolves it.
      SELECT cm.canonical_model INTO v_canon FROM canonical_models cm
       WHERE lower(cm.make) = lower(v_make)
         AND (lower(cm.canonical_model) = lower(v_model) OR lower(v_model) = ANY (SELECT lower(a) FROM unnest(cm.aliases) a))
       LIMIT 1;
      v_canon := coalesce(v_canon, v_model);
      SELECT p.subject_id INTO v_subject FROM make_model_profiles p
       WHERE lower(p.canonical_make) = lower(v_make) AND lower(p.canonical_model) = lower(v_canon)
         AND p.grain = 'year' AND p.year = v_year
       LIMIT 1;
      v_label := format('%s %s %s', v_year, v_make, v_canon);
      IF v_subject IS NULL THEN
        v_reason := 'no registered cohort for this year-make-model';
      ELSE
        SELECT coalesce(array_agg(c.vehicle_id), '{}') INTO v_ids FROM cohort_members(v_subject) c;
        v_members := cardinality(v_ids);
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
    'cohort_members', v_members, 'classified_this_call', least(v_offset, cardinality(v_todo)),
    'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000));
END;
$function$;
COMMENT ON FUNCTION public.refresh_vehicle_class_price(uuid, integer, integer, interval) IS
  'Recomputes one vehicle''s class price into vehicle_class_price: subject classified afresh, cohort members classified '
  'in chunks under a clock budget (p_budget_ms), price from the store once every member is classified. Re-run until '
  'complete. Service role only.';
REVOKE ALL ON FUNCTION public.refresh_vehicle_class_price(uuid, integer, integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_vehicle_class_price(uuid, integer, integer, interval) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_vehicle_class_prices(p_vehicle_ids uuid[], p_budget_ms integer DEFAULT 40000)
 RETURNS TABLE(vehicle_id uuid, result jsonb)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO public, pg_temp
 SET statement_timeout TO '58s'
AS $function$
DECLARE
  v_t0     timestamptz := clock_timestamp();
  v_budget integer := least(greatest(coalesce(p_budget_ms, 40000), 1000), 45000);
  v_left   integer;
  v_id     uuid;
BEGIN
  IF p_vehicle_ids IS NULL OR cardinality(p_vehicle_ids) > 500 THEN
    RAISE EXCEPTION 'refresh_vehicle_class_prices takes 0 to 500 vehicle ids' USING ERRCODE = '22023';
  END IF;
  FOR v_id IN SELECT x.u FROM unnest(p_vehicle_ids) WITH ORDINALITY x(u, o) WHERE x.u IS NOT NULL
               GROUP BY x.u ORDER BY min(x.o) LOOP
    vehicle_id := v_id;
    v_left := v_budget - (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::integer;
    IF v_left < 1000 THEN
      result := jsonb_build_object('vehicle_id', v_id, 'status', 'not_reached', 'complete', false);
    ELSE
      BEGIN
        result := public.refresh_vehicle_class_price(v_id, least(v_left, 15000));
      EXCEPTION
        WHEN query_canceled THEN RAISE;
        WHEN OTHERS THEN
          result := jsonb_build_object('vehicle_id', v_id, 'status', 'error', 'complete', false, 'error', SQLERRM);
      END;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$function$;
COMMENT ON FUNCTION public.refresh_vehicle_class_prices(uuid[], integer) IS
  'refresh_vehicle_class_price for up to 500 vehicles under one clock budget (at most 15 s each); a vehicle the budget '
  'did not reach answers not_reached. Re-run with the incomplete ids. Service role only.';
REVOKE ALL ON FUNCTION public.refresh_vehicle_class_prices(uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_vehicle_class_prices(uuid[], integer) TO service_role;

-- 5. The garage's batch reader ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_vehicle_class_prices(p_vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, status text, value numeric, value_low numeric, value_high numeric, n integer,
               subject_class text, basis text, blocked_reason text, computed_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO public, pg_temp
 SET statement_timeout TO '10s'
AS $function$
BEGIN
  IF p_vehicle_ids IS NULL OR cardinality(p_vehicle_ids) > 500 THEN
    RAISE EXCEPTION 'get_vehicle_class_prices takes 0 to 500 vehicle ids' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH req AS (SELECT DISTINCT u AS id FROM unnest(p_vehicle_ids) u WHERE u IS NOT NULL),
  -- The garage's own tie: the vehicles get_user_garage returns to the caller's own account, with a relationship that
  -- carries money (its current_value gate); the service role reads any requested vehicle.
  tied AS (
    SELECT req.id FROM req WHERE coalesce(auth.role() = 'service_role', false)
    UNION
    SELECT g.vehicle_id FROM public.get_user_garage(auth.uid()) g
     WHERE auth.uid() IS NOT NULL AND g.relationship <> 'profile_record' AND g.vehicle_id IN (SELECT req.id FROM req)
  )
  SELECT p.vehicle_id, p.status, p.value, p.value_low, p.value_high, p.n, p.subject_coarse_class, p.basis,
         p.blocked_reason, p.computed_at
    FROM tied JOIN vehicle_class_price p ON p.vehicle_id = tied.id;
END;
$function$;
COMMENT ON FUNCTION public.get_vehicle_class_prices(uuid[]) IS
  'Stored class price for up to 500 vehicles, only those tied to the caller as get_user_garage ties them (not '
  'profile_record); any for the service role. Priced rows carry value (median), value_low (p25), value_high (p75), n and '
  'basis; blocked rows carry blocked_reason. No anon.';
REVOKE ALL ON FUNCTION public.get_vehicle_class_prices(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_vehicle_class_prices(uuid[]) TO authenticated, service_role;

-- 6. get_user_garage.current_value from the store (body otherwise 20261116061500, identical to live) ----------------
CREATE OR REPLACE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text, image_url text, current_value numeric, purchase_price numeric, image_count bigint, relationship text, last_activity_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The owner, or the service role (no user id; the books and attribution scripts), sees everything.
  WITH viewer AS (SELECT coalesce(auth.uid() = p_user_id, false) OR coalesce(auth.role() = 'service_role', false) AS is_own),
  -- prec = precedence when one vehicle is reached by several routes (lower wins).
  --   1 owner | 2 previously_owned | 3 consigned (significant non-owner role) | 4 documenting (own photos / work in last 60d)
  --   5 contributor | 6 profile_record
  src AS (
    -- owner / co_owner permissions and approved title verifications: 'owner' (owner's own view and the public projection alike)
    SELECT vehicle_id, 1 prec, NULL::timestamptz act FROM vehicle_user_permissions
      WHERE user_id=p_user_id AND revoked_at IS NULL AND coalesce(is_active,true) AND role IN ('owner','co_owner')
    UNION ALL SELECT vehicle_id, 1, NULL FROM ownership_verifications WHERE user_id=p_user_id AND status='approved'
    -- Owner-only routes (every relationship the record holds).
    UNION ALL SELECT vehicle_id, 1, NULL FROM vehicle_ownerships WHERE owner_profile_id=p_user_id AND is_current=true AND (SELECT is_own FROM viewer)
    -- significant non-owner roles carried as their own role
    UNION ALL SELECT vehicle_id, 2, NULL FROM vehicle_user_permissions
      WHERE user_id=p_user_id AND revoked_at IS NULL AND coalesce(is_active,true) AND role='previously_owned' AND (SELECT is_own FROM viewer)
    UNION ALL SELECT vehicle_id, 2, NULL FROM discovered_vehicles WHERE user_id=p_user_id AND is_active=true AND relationship_type='previously_owned' AND (SELECT is_own FROM viewer)
    UNION ALL SELECT vehicle_id, 3, NULL FROM vehicle_user_permissions
      WHERE user_id=p_user_id AND revoked_at IS NULL AND coalesce(is_active,true) AND role='consigned' AND (SELECT is_own FROM viewer)
    -- documenting: own photo uploads or work sessions in the last 60 days, ranked by recency
    UNION ALL SELECT vi.vehicle_id, 4, max(vi.created_at) FROM vehicle_images vi
      WHERE vi.user_id=p_user_id AND vi.vehicle_id IS NOT NULL AND vi.created_at >= now() - interval '60 days'
        AND coalesce(vi.is_superseded,false)=false AND (SELECT is_own FROM viewer)
      GROUP BY vi.vehicle_id
    UNION ALL SELECT ws.vehicle_id, 4, max(ws.session_date)::timestamptz FROM work_sessions ws
      WHERE ws.user_id=p_user_id AND ws.vehicle_id IS NOT NULL AND ws.session_date >= current_date - 60 AND (SELECT is_own FROM viewer)
      GROUP BY ws.vehicle_id
    UNION ALL SELECT vehicle_id, 5, NULL FROM vehicle_contributors WHERE user_id=p_user_id AND (SELECT is_own FROM viewer)
    -- Creating a profile relates it to this account; it does not establish ownership.
    UNION ALL SELECT v.id, 6, NULL FROM vehicles v
      WHERE v.user_id=p_user_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL AND (SELECT is_own FROM viewer)
  ),
  -- follow merged_into_vehicle_id (two hops) to the canonical vehicle
  canon AS (
    SELECT coalesce(m2.id, m1.id, sv.id) AS vid, s.prec, s.act
    FROM src s
    JOIN vehicles sv ON sv.id = s.vehicle_id
    LEFT JOIN vehicles m1 ON m1.id = sv.merged_into_vehicle_id
    LEFT JOIN vehicles m2 ON m2.id = m1.merged_into_vehicle_id
  ),
  dedup AS (SELECT vid AS vehicle_id, MIN(prec) pr, max(act) act FROM canon GROUP BY vid)
  SELECT v.id, v.year, v.make, v.model, v.trim,
         COALESCE(v.primary_image_url,
                  (SELECT vi2.image_url FROM vehicle_images vi2
                     WHERE vi2.vehicle_id = v.id AND vi2.image_url IS NOT NULL
                       -- the definer skips RLS and the vision gate; a stranger gets only an admitted frame
                       AND ((SELECT is_own FROM viewer) OR public.vehicle_image_gallery_eligible(vi2))
                     ORDER BY vi2.created_at LIMIT 1)),
         -- the stored class price (vehicle_class_price, written by refresh_vehicle_class_price); never nuke_estimates
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr <> 6 THEN
           (SELECT cp.value FROM vehicle_class_price cp
              WHERE cp.vehicle_id = v.id AND cp.status = 'priced') END,
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr <> 6 THEN v.purchase_price END,
         COALESCE(v.image_count, 0)::bigint,
         CASE d.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously_owned' WHEN 3 THEN 'consigned' WHEN 4 THEN 'documenting' WHEN 5 THEN 'contributor' ELSE 'profile_record' END,
         -- genuine activity only (EXIF photos by owner/contributors, real work sessions, genuine timeline events); see vehicle_activity
         va.last_activity_at
  FROM dedup d JOIN vehicles v ON v.id=d.vehicle_id
  LEFT JOIN vehicle_activity va ON va.vehicle_id = v.id
  WHERE v.merged_into_vehicle_id IS NULL AND v.deleted_at IS NULL
    AND ((SELECT is_own FROM viewer) OR v.is_public = true)
  -- display order: consigned (active deal) ranks above documenting (photos only) and previously_owned (historical)
  -- owner > consigned > documenting > previously_owned > contributor > profile_record
  ORDER BY CASE d.pr WHEN 1 THEN 1 WHEN 3 THEN 2 WHEN 4 THEN 3 WHEN 2 THEN 4 WHEN 5 THEN 5 ELSE 6 END,
           va.last_activity_at DESC NULLS LAST, v.year;
$function$;
REVOKE ALL ON FUNCTION public.get_user_garage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_garage(uuid) TO postgres, authenticated, service_role;

-- 7. The curated platform reader keeps its curated pool ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_platform_stratified_price(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_coarse text; v_n int; v_median numeric; v_p25 numeric; v_p75 numeric; v_min int := 5;
BEGIN
  SELECT coarse_class INTO v_coarse FROM public.vehicle_build_class WHERE vehicle_id = p_vehicle_id;
  IF v_coarse IS NULL THEN
    v_coarse := CASE WHEN (public.nuke_build_class(p_vehicle_id)->>'build_class') IN ('documented_build','modified') THEN 'build'
                     WHEN (public.nuke_build_class(p_vehicle_id)->>'build_class')='stock' THEN 'stock' ELSE 'unknown' END;
  END IF;
  IF v_coarse = 'unknown' THEN
    RETURN jsonb_build_object('comp_method','blocked','reason','subject build class unknown — needs vision');
  END IF;

  -- vehicle_build_class now holds every refreshed cohort; the platform is the curation recorded in 20260623110000:
  -- full-size Chevrolet/GMC Blazer and Jimmy, 1973-1991, S-10/S-15 compacts excluded.
  WITH comps AS (
    SELECT vbc.vehicle_id,
           (SELECT max(final_price) FROM public.comp_eligible_vehicle_events ve
             WHERE ve.vehicle_id = vbc.vehicle_id AND ve.final_price > 0) AS px
    FROM public.vehicle_build_class vbc
    JOIN public.vehicles pv ON pv.id = vbc.vehicle_id
    WHERE vbc.coarse_class = v_coarse AND vbc.vehicle_id <> p_vehicle_id
      AND pv.make ~* '(chevrolet|gmc)' AND pv.year BETWEEN 1973 AND 1991
      AND pv.model ~* '(k5|k-5|blazer|jimmy)' AND pv.model !~* '(s-10|s-15)'
  )
  SELECT count(px), percentile_cont(0.5) WITHIN GROUP (ORDER BY px),
         percentile_cont(0.25) WITHIN GROUP (ORDER BY px), percentile_cont(0.75) WITHIN GROUP (ORDER BY px)
    INTO v_n, v_median, v_p25, v_p75
  FROM comps WHERE px IS NOT NULL;

  IF coalesce(v_n,0) < v_min THEN
    RETURN jsonb_build_object('comp_method','blocked',
      'reason', format('only %s class-matched priced platform comps (need %s)', coalesce(v_n,0), v_min),
      'subject_class', v_coarse, 'n_class_matched', coalesce(v_n,0));
  END IF;

  RETURN jsonb_build_object(
    'comp_method','class_stratified', 'subject_class', v_coarse,
    'n_class_matched_priced', v_n, 'value', round(v_median),
    'value_low', round(v_p25), 'value_high', round(v_p75),
    'comp_universe', 'curated full-size squarebody Blazer ∪ GMC Jimmy (compacts excluded), 1973-1991, materialized',
    'note', 'Priced against the curated platform, class-matched. Unknown comps excluded until vision classifies them.');
END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
