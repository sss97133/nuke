-- build_class_v4: word boundaries in the build-class rule, and a class version bump so the store reclassifies.
--
-- Why. nuke_build_class_rule (20261121073000, verbatim from nuke_build_class v2, 20260623100000) wrote two of its terms
-- with '\b', which in a PostgreSQL regular expression is a backspace character, not a word boundary ('\y'):
-- '\b(built|modified|upgraded|swapped|custom)\b' and '\b(stock|factory)\b'. Neither has ever matched a description:
-- over the 18,923 vehicles measured 2026-11-20 (the owner's 138 garage cars and the 11 cohorts of the 13 priced ones),
-- both terms matched 0 times. Every other term in the rule is unaffected ('\d' is a digit, as intended).
--
-- Not a straight '\b' -> '\y' swap. Measured read-only over the same 18,923 vehicles, the plain swap moves 1,410 of the
-- first 13,279 cohort members, and a read of 20 of them found 9 wrong, 6 thin, 5 right: "stock #: 20231", "status: in
-- stock", "built at the San Jose plant", "factory air", "factory a/c", "Custom" as a trim name ("C10 Custom", "Mustang
-- Custom Fastback"). "factory" alone appears in 2,281 of 14,031 members' text and is almost always a production fact
-- ("built at the factory", "factory rated", "factory warranty"); bare "stock" is mostly a dealer stock number. Under the
-- plain swap the owner's 1985 Suburban (one of the 13 priced cars) became "stock" on "status: in stock" alone.
--
-- The rule now (one sentence per class; documented_build and every other term unchanged):
--   documented_build: $5,000 or more of current receipts, or 20 or more work sessions.
--   modified: an engine or transmission swap, three or more build signals, or more build signals than stock signals.
--     The fixed build signal: the words modified, upgraded or swapped (not "not/never (been) modified", "un-/non-modified",
--     "a modified version of", "manufacturing modified"), or a built engine ("built 289", "built motor", "built small
--     block", "stroker"), or "fully/professionally/kit-built", or "custom build".
--   stock: at least one stock signal and no more build signals than stock signals. The fixed stock signal: "completely,
--     totally, entirely or 100% stock". "stock" and "factory" alone never count; "unknown" is the answer when the paper is
--     thin.
--   unknown: none of the above.
--
-- Measured 2026-11-20 (read-only, this exact expression inline over full text, both rules on the same rows):
--   garage (138 cars): 2 unknown -> build (both "kit-built 1932 Ford"; neither has a registered cohort), 136 unchanged.
--     The fix unblocks no garage price: of the 96 still unknown, 49 have no text and 47 a short note with no signal.
--   cohort members of the 13 priced cars (18,780 distinct): 18,493 unchanged; unknown -> build 215, stock -> build 67,
--     unknown -> stock 3, build -> stock 2. A read of 41 of the moves: 33 right, 4 borderline, 4 wrong (an "upgraded
--     am/fm/cassette", "upgraded with two new mufflers", "hasn't been over-modified", "take this one back to 100% stock").
--   price moves of the 13 priced cars: medians move -3.4% (1967 Camaro, stock, n 114 -> 108) to +11.3% (1985 Suburban, n 6 -> 8); the PR has each.
--
-- Version bump. classify_vehicle_build_class writes method_version 'v4_store_word_terms' and refresh_vehicle_class_price
-- treats any other version as out of date (c_class), so every v3_store_text_paper row is reclassified by the next refresh
-- of a vehicle whose cohort it belongs to. Both literals change together here; the contract asserts a second refresh
-- classifies nothing. Until the refresh runs, priced rows keep their v3 price; a refresh that runs out of budget mid
-- cohort writes "cohort not yet classified (k of n)" over a priced row until it is re-run to completion.
--
-- No DDL on any table; three function bodies replaced with CREATE OR REPLACE (signatures, owners and settings kept),
-- grants restated as 20261121073000 set them.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. The rule ---------------------------------------------------------------------------------------------------------
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
      -- word terms ('\y' is the word boundary): said to be modified, upgraded or swapped, a built engine, a built car
      + (regexp_replace(i.x, '\y(not|never)( been)? modified\y|\y(un|non)-modified\y|\ymodified version\y|\ymanufacturing modified\y', '', 'g')
           ~* '\y(modified|upgraded|swapped)\y'
         OR i.x ~* '\ybuilt (engine|motor|small[- ]block|big[- ]block|stroker)\y|\ybuilt \d{3}([^0-9]|$)|\y(fully|professionally|kit)[- ]built\y|\ycustom[- ]build\y')::int AS b,
      (i.x ~* 'original owner|numbers[- ]?matching|matching numbers|all[- ]?original|unrestored|survivor|factory original|as[- ]?delivered|bone[- ]?stock|untouched')::int
      + (i.x ~* 'original .{0,12}(paint|engine|drivetrain|interior|miles)|date[- ]?code|window sticker|build sheet')::int
      -- "stock" and "factory" alone are a stock number, "in stock", a production fact or a factory option: not counted
      + (i.x ~* '\y(completely|totally|entirely|100%)[- ]stock\y')::int AS st
    FROM (SELECT (i.x ~* '(engine|motor|v8|v-8|transmission|trans).{0,30}(replac|swap|rebuil|crate)'
               OR i.x ~* '(replac|swap|rebuil|crate|ls[- ]?\d|ls[- ]?swap).{0,30}(engine|motor|v8|v-8|transmission|trans)') AS sw) z) s
$function$;
GRANT EXECUTE ON FUNCTION public.nuke_build_class_rule(numeric, integer, text) TO PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.nuke_build_class_rule(numeric, integer, text) IS
  'The build-class rule as one pure function of documented spend, work-session count and the lowercased description text '
  '(v4 word terms, 20261121090000: "\y" word boundaries; bare "stock"/"factory"/"built"/"custom" do not count). Used by '
  'nuke_build_class (caller''s view) and classify_vehicle_build_class (store, method v4_store_word_terms).';

-- 2. The store writer: same body as 20261121073000, method v4_store_word_terms -----------------------------------------
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
         cls.j->>'confidence', 'v4_store_word_terms',
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
  'Classifies up to 2000 vehicles into vehicle_build_class (method v4_store_word_terms) as the definer, so the class does '
  'not depend on who asks. Service role and refresh_vehicle_class_price only.';
REVOKE ALL ON FUNCTION public.classify_vehicle_build_class(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classify_vehicle_build_class(uuid[]) TO service_role;
COMMENT ON TABLE public.vehicle_build_class IS
  'Build class per vehicle (documented_build | modified | stock | unknown; coarse build | stock | unknown), classified by '
  'the definer from every receipt, work session and the description text (nuke_build_class_rule). Written only by '
  'classify_vehicle_build_class (method v4_store_word_terms; v3_store_text_paper rows are out of date) and the 2026-06-23 '
  'Blazer/Jimmy backfill (v2_scored_text_unwired). source_dna holds private amounts: no client reads this table; '
  'get_vehicle_class_prices returns the coarse class to tied viewers.';

-- 3. Refresh: same body as 20261121073000, c_class = the version the writer above writes --------------------------------
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
REVOKE ALL ON FUNCTION public.refresh_vehicle_class_price(uuid, integer, integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_vehicle_class_price(uuid, integer, integer, interval) TO service_role;

COMMIT;
