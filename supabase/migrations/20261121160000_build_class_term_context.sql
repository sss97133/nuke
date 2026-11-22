-- build_class_v5: seven rule terms that matched the wrong thing, and a class version bump so the store reclassifies.
--
-- Why. nuke_build_class_rule (v4, 20261121090000) decides each cohort member's build class, and so every class median
-- on the garage cards. Read-only over the 22,592 distinct members of the 27 cohorts behind the 34 priced garage cars
-- (2026-11-21), each term counted and 15 matching snippets read (fewer where fewer matched):
--   build "weld" (meant: Weld wheels)   258 members match; 12 of 15 read are welding: "welded in new metal", "requires
--                                       welding", "wheel welds", a seller handle. Now: Weld followed by wheel(s) within
--                                       the same phrase, or a Weld wheel line name (racing, draglite, prostar ...).
--   build "restored|restoration"        matched inside "unrestored": 99 members carry the build signal only from that word
--                                       (15 of 15 read: "unrestored survivor", "unrestored time capsule"), while the
--                                       same word is a stock signal. "needs (a full) restoration", "restoration
--                                       candidate", "not/never restored": 74 more, 12 of 12 read are unrestored cars.
--                                       Those phrases are removed before the term is tested.
--   build "bagged"                      3 members; 1 of 3 is parts "bagged and tagged". That phrase no longer counts.
--   build "rally wheel"                 637 members; 11 of 15 read are the factory Rally wheel option ("rally wheels and
--                                       redline tires", "14x6 df coded rally wheels"). Removed.
--   build "coys" (meant: Coys wheels)   52 members; 10 of 15 read are the Coys auction house in auction metadata. Now:
--                                       Coys followed by wheel(s) within the phrase.
--   stock "original owner"              531 members; 124 say "original owner's manual", 104 of them only that way. The
--                                       manual (handbook, guide, booklet) no longer counts.
--   stock "numbers matching"            10 members say "non-numbers matching" / "not numbers-matching" / "non-matching
--                                       numbers" (10 of 10 read), and "isn't numbers-matching" turned up in the read of
--                                       moved members. Negations, and "non-/not original", are removed first.
-- Measured, not changed (each reported with its rate in the PR): "lifted" (4 of 15 read are about another vehicle or a
-- dealer's stock list), an engine "rebuilt" counting as an engine swap (1,261 of the 2,697 swap matches rest on it alone),
-- "fuel injection" (factory on the 1987+ cohorts, not knowable from text without the year), "NN-inch wheels" (14-16 inch
-- factory sizes), "power disc" (a factory option in part of the read).
--
-- The class version. classify_vehicle_build_class writes method_version 'v5_store_term_context' and
-- refresh_vehicle_class_price treats any other version as out of date (c_class). Both are changed here by replacing
-- exactly that one literal in the live definition (refused unless the live definition is the one read 2026-11-21), so
-- every other byte of both bodies stays as deployed; the contract asserts it. v4 rows are reclassified by the next
-- refresh of a vehicle whose cohort holds them; a refresh that runs out of budget keeps the stored price
-- (20261121110000, "never blank") and stays queued until its cohort is done.
--
-- No DDL on any table, no rows written. nuke_build_class_rule is replaced with CREATE OR REPLACE (signature, volatility
-- and settings kept) and its grant restated as 20261121073000 set it.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 0. Refuse to replace bodies that changed since they were read ----------------------------------------------------------
DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.nuke_build_class_rule(numeric,integer,text)'::regprocedure));
  IF f NOT IN ('210b8c11a949953d3d598332ed2ffb36', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
               'e4228c9ac8cca33ba8bceeb366f4ea08') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'nuke_build_class_rule changed since 2026-11-21 (md5 %); review before replacement', f;
  END IF;
  f := md5(pg_get_functiondef('public.classify_vehicle_build_class(uuid[])'::regprocedure));
  IF f NOT IN ('d5d272f135d514b973615485f312301d', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
               'd61f6535513605c7fc18846cfc1b83ee') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'classify_vehicle_build_class changed since 2026-11-21 (md5 %); review before replacement', f;
  END IF;
  f := md5(pg_get_functiondef('public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure));
  IF f NOT IN ('ed5bd27f0943561fc64a315db2f0a759', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
               '3bb0a0f6c048f71bb4deda69adcdd993') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'refresh_vehicle_class_price changed since 20261121110000 (md5 %); review before replacement', f;
  END IF;
END
$guard$;

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
      -- "bagged and tagged" is parts in bags, not air bags
      + (i.x ~* 'lift kit|lifted|lowered|lowering|coilover|air[- ]?ride|bagged(?! (and|&) tagged)|drop(ped)? spindle|tubbed')::int
      -- Weld and Coys only as wheels (welding and the Coys auction house are not); a factory Rally wheel is not a build
      + (i.x ~* '\y(weld|coys)(-style)?\y[^.;,•\n]{0,25}\ywheels?\y|\yweld (racing|draglites?|prostar|pro star|rodlites?|alumastar|magnum|xt|rts?)\y|american racing|cragar|aftermarket wheel|\d{2}[- ]?(inch|″|in\.).{0,12}wheel')::int
      + (i.x ~* 'disc brake conversion|power disc|big brake|wilwood|headers|fuel.inject|efi conversion')::int
      -- an unrestored car, or one that needs restoring, is not a restored one
      + (z.xb ~* 'grant .{0,12}(wheel|steering)|aftermarket (stereo|gauge|seat)|bluetooth|modern (stereo|audio)|restored|restoration')::int
      -- word terms ('\y' is the word boundary): said to be modified, upgraded or swapped, a built engine, a built car
      + (regexp_replace(i.x, '\y(not|never)( been)? modified\y|\y(un|non)-modified\y|\ymodified version\y|\ymanufacturing modified\y', '', 'g')
           ~* '\y(modified|upgraded|swapped)\y'
         OR i.x ~* '\ybuilt (engine|motor|small[- ]block|big[- ]block|stroker)\y|\ybuilt \d{3}(?!,?\d)|\y(fully|professionally|kit)[- ]built\y|\ycustom[- ]build\y')::int AS b,
      -- stock terms read with their negations and the owner's manual removed
      (z.xs ~* 'original owner|numbers[- ]?matching|matching numbers|all[- ]?original|unrestored|survivor|factory original|as[- ]?delivered|bone[- ]?stock|untouched')::int
      + (z.xs ~* 'original .{0,12}(paint|engine|drivetrain|interior|miles)|date[- ]?code|window sticker|build sheet')::int
      -- "stock" and "factory" alone are a stock number, "in stock", a production fact or a factory option: not counted
      + (i.x ~* '\y(completely|totally|entirely|100%)[- ]stock\y')::int AS st
    FROM (SELECT (i.x ~* '(engine|motor|v8|v-8|transmission|trans).{0,30}(replac|swap|rebuil|crate)'
               OR i.x ~* '(replac|swap|rebuil|crate|ls[- ]?\d|ls[- ]?swap).{0,30}(engine|motor|v8|v-8|transmission|trans)') AS sw,
                 regexp_replace(i.x, 'un-?restored|\y(not|never)( been)? restored\y|\yrestoration candidate|\y(needs|needing|in need of)( an?)?( full| complete| total| some)? restoration', ' ', 'g') AS xb,
                 regexp_replace(i.x, 'original owner[''’]?s?[''’]? (manual|handbook|guide|booklet)|\y(non|not|isn[''’]?t|wasn[''’]?t)[- ]?(numbers[- ]?matching|matching[- ]numbers)|\y(non|not)[- ]original\y', ' ', 'g') AS xs) z) s
$function$;
GRANT EXECUTE ON FUNCTION public.nuke_build_class_rule(numeric, integer, text) TO PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.nuke_build_class_rule(numeric, integer, text) IS
  'The build-class rule as one pure function of documented spend, work-session count and the lowercased description text '
  '(v5 term context, 20261121160000: Weld and Coys only as wheels, no Rally wheels, "unrestored"/"needs restoration" '
  'are not restored, "bagged and tagged" is not bagged, the owner''s manual is not an original owner, negated numbers '
  'matching is not a stock signal; v4 "\y" word boundaries kept). Used by nuke_build_class (caller''s view) and '
  'classify_vehicle_build_class (store, method v5_store_term_context).';

-- 2. The writer's method literal and the refresh's c_class: one literal each, every other byte as deployed ------------
DO $bump$
DECLARE d text; f text;
BEGIN
  d := pg_get_functiondef('public.classify_vehicle_build_class(uuid[])'::regprocedure);
  IF md5(d) = 'd5d272f135d514b973615485f312301d' THEN -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
    IF (length(d) - length(replace(d, '''v4_store_word_terms''', ''))) / length('''v4_store_word_terms''') <> 1 THEN
      RAISE EXCEPTION 'classify_vehicle_build_class: expected exactly one v4 literal';
    END IF;
    EXECUTE replace(d, '''v4_store_word_terms''', '''v5_store_term_context''');
  END IF;
  d := pg_get_functiondef('public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure);
  IF md5(d) = 'ed5bd27f0943561fc64a315db2f0a759' THEN -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
    IF (length(d) - length(replace(d, '''v4_store_word_terms''', ''))) / length('''v4_store_word_terms''') <> 1 THEN
      RAISE EXCEPTION 'refresh_vehicle_class_price: expected exactly one v4 literal';
    END IF;
    EXECUTE replace(d, '''v4_store_word_terms''', '''v5_store_term_context''');
  END IF;
  -- Both now name the same version.
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.classify_vehicle_build_class(uuid[])'::regprocedure) NOT LIKE '%''v5_store_term_context''%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure)
        NOT LIKE '%c_class   constant text := ''v5_store_term_context''%' THEN
    RAISE EXCEPTION 'class version bump did not apply to both functions';
  END IF;
END
$bump$;
COMMENT ON FUNCTION public.classify_vehicle_build_class(uuid[]) IS
  'Classifies up to 2000 vehicles into vehicle_build_class (method v5_store_term_context) as the definer, so the class does '
  'not depend on who asks. Service role and refresh_vehicle_class_price only.';
COMMENT ON TABLE public.vehicle_build_class IS
  'Build class per vehicle (documented_build | modified | stock | unknown; coarse build | stock | unknown), classified by '
  'the definer from every receipt, work session and the description text (nuke_build_class_rule). Written only by '
  'classify_vehicle_build_class (method v5_store_term_context; v4_store_word_terms and v3_store_text_paper rows are out '
  'of date) and the 2026-06-23 Blazer/Jimmy backfill (v2_scored_text_unwired). source_dna holds private amounts: no '
  'client reads this table; get_vehicle_class_prices returns the coarse class to tied viewers.';

COMMIT;
