-- build_class_v6: a rebuilt engine is not a swap, factory fuel injection is not a build, and the rule reads the model year.
--
-- Why. nuke_build_class_rule (v5, 20261121160000) classes every cohort member, and so every class median on the garage
-- cards. Read-only emulation over the whole store, vehicle_build_class (24,445 vehicles, 2026-11-21; 22,362 on v5,
-- 1,726 v2, 357 v4): the inlined v5 body equals the live function on all 24,445 and the stored class on all 22,362 v5
-- rows. Of 8,428 vehicles v5 calls modified or documented build:
--   rebuilt engine as a swap      516 are non-stock only because "rebuil" sat within 30 characters of engine/motor/v8/
--                                 transmission (the swap test): "rebuilt 289ci v8", "machine shop rebuilt engine",
--                                 "transmission was reportedly rebuilt", "totally rebuilt original inline 6". 15 of 15 read
--                                 are the car's own unit rebuilt. "rebuil" no longer counts as a swap.
--   factory fuel injection         173 are non-stock only because of "fuel inject": 58 from model year 1987 (all 58 read:
--                                 56 factory, GM TBI trucks from 1987 and the LX450's 1FZ-FE; a K&N kit and replacement
--                                 injectors are the other two), 115 before 1987 (40 read: 38 aftermarket, FiTech, Holley
--                                 Sniper, MSD Atomic, LT1 and 5.0 swaps). No year/make/model fuel-system fact is usable:
--                                 EPA's file starts in 1984 and its "(FFS)" is a feedback fuel system (carburetors too);
--                                 vPIC FuelInjectionType is filled for 31 of the 173 and never says carburetor. So this is
--                                 a year cutoff: the bare term counts only before model year 1987 or with no year; named
--                                 aftermarket systems (Holley Sniper/Terminator, FiTech, MSD Atomic, EZ-EFI, Edelbrock
--                                 Pro-Flo/E-Street, MegaSquirt) and conversions count at any year.
-- Taking "rebuil" out also lost real swaps v5 caught only by accident ("a five-speed transmission and transfer case were
-- installed", "a 383ci v8 was installed"; 9 of 18 read in the moved set), so an engine or gearbox "was installed/fitted"
-- and a bare "LS swap" are swaps, and a stroked or high-performance rebuild, or a stroker, is one build signal.
--
-- Measured v5 -> v6 over the 24,445: 617 change class: modified -> unknown 303, modified -> stock 256, unknown -> modified
-- 50, stock -> modified 8 (73 of the 617 are model year 1987 or later). 20 changed vehicles read: 18 right, 2 wrong (a 402 big
-- block "with over 500 horsepower" in a 1967 Camaro is now unknown; a C10 "rebuilt to high-performance specifications"
-- with "original miles" is now stock). All 58 upward moves read: strokers, installed engines and gearboxes, Sniper EFI.
-- Measured, not changed: the swap test's "replac" still reads "replacing the clutch", "transmission filter" or a
-- "replacement headliner" near an engine word as a swap (431 rebuild-phrase vehicles stay swap-classed through it; 15 read,
-- about half are not swaps).
--
-- Speed. Both subqueries of the rule are now OFFSET 0 fences. Flattened, every regular expression ran again for each of
-- the ~10 references to swap, b and st. Production, 6 random chunks of 200 vehicles twice each: v5 body median 479 ms per
-- 200, v6 99 ms (total 0.19x). Without the fence v6 was 2.6x slower than v5 (no early "rebuil" match to stop the scan).
--
-- The year. The rule gains a fourth argument, p_year; the three-argument form stays (signature, grants, answers for
-- callers without a year) and calls the four-argument one with NULL. classify_vehicle_build_class passes v.year and writes
-- method_version 'v6_store_rebuild_factory_efi'; refresh_vehicle_class_price's c_class names it, so every v5 row is out of
-- date and reclassified by the next refresh of its cohort (a refresh out of budget keeps the stored price, 20261121110000);
-- nuke_build_class passes the vehicle's year so the caller's view and the store agree. Each change replaces exact literals
-- in the live definition read 2026-11-21 (refused when that definition changed); the contract asserts nothing else moved.
-- No vehicles trigger is needed: the daily stale sweep already catches a changed year.
--
-- No DDL on any table, no rows written.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 0. Refuse to replace bodies that changed since they were read ----------------------------------------------------------
DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.nuke_build_class_rule(numeric,integer,text)'::regprocedure));
  IF f NOT IN ('e4228c9ac8cca33ba8bceeb366f4ea08', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
               'c0ed634c8ed00bac1efae1a786888927') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'nuke_build_class_rule(3) changed since 2026-11-21 (md5 %); review before replacement', f;
  END IF;
  IF to_regprocedure('public.nuke_build_class_rule(numeric,integer,text,integer)') IS NOT NULL THEN
    f := md5(pg_get_functiondef('public.nuke_build_class_rule(numeric,integer,text,integer)'::regprocedure));
    IF f <> '0221312c67f2fff9ea428fc7f6b89b47' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
      RAISE EXCEPTION 'nuke_build_class_rule(4) differs from this migration''s (md5 %); review before replacement', f;
    END IF;
  END IF;
  f := md5(pg_get_functiondef('public.classify_vehicle_build_class(uuid[])'::regprocedure));
  IF f NOT IN ('d61f6535513605c7fc18846cfc1b83ee', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
               'ade65f625fb0fcb99adaabf63e955522') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'classify_vehicle_build_class changed since 2026-11-21 (md5 %); review before replacement', f;
  END IF;
  f := md5(pg_get_functiondef('public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure));
  IF f NOT IN ('3bb0a0f6c048f71bb4deda69adcdd993', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
               '76a461546387e93d99541c455e2469fa') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'refresh_vehicle_class_price changed since 2026-11-21 (md5 %); review before replacement', f;
  END IF;
  f := md5(pg_get_functiondef('public.nuke_build_class(uuid)'::regprocedure));
  IF f NOT IN ('d2ec66e2b6d6e208480bf9cd886fdded', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
               '9a7242506ea230b4540b2631e5bcd63d') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'nuke_build_class changed since 2026-11-21 (md5 %); review before replacement', f;
  END IF;
END
$guard$;

-- 1. The rule, now with the model year ----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nuke_build_class_rule(p_receipts numeric, p_sessions integer, p_text text, p_year integer)
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
  FROM (SELECT coalesce(p_receipts, 0) AS r, coalesce(p_sessions, 0) AS w, coalesce(p_text, '') AS x, p_year AS y) i
  -- OFFSET 0 fences both subqueries so each regular expression runs once per call; flattened (v5), they ran again for
  -- every reference to swap, b and st in the CASEs above
  CROSS JOIN LATERAL (SELECT z.sw AS swap,
      -- the decisive build tell (a swapped/replaced engine or trans) counts as one build signal too
      z.sw::int
      + (i.x ~* 'resto[- ]?mod|pro[- ]?touring|custom built|frame[- ]?off')::int
      -- "bagged and tagged" is parts in bags, not air bags
      + (i.x ~* 'lift kit|lifted|lowered|lowering|coilover|air[- ]?ride|bagged(?! (and|&) tagged)|drop(ped)? spindle|tubbed')::int
      -- Weld and Coys only as wheels (welding and the Coys auction house are not); a factory Rally wheel is not a build
      + (i.x ~* '\y(weld|coys)(-style)?\y[^.;,•\n]{0,25}\ywheels?\y|\yweld (racing|draglites?|prostar|pro star|rodlites?|alumastar|magnum|xt|rts?)\y|american racing|cragar|aftermarket wheel|\d{2}[- ]?(inch|″|in\.).{0,12}wheel')::int
      -- fuel injection: an aftermarket system or a conversion counts at any model year; the bare term counts only before
      -- 1987 or when the year is not known (factory injection from then on: GM trucks got TBI for 1987)
      + (i.x ~* 'disc brake conversion|power disc|big brake|wilwood|headers'
         OR i.x ~* '\y(efi|tbi|fuel[- ]?injection) (conversion|swap)|\yconver(ted|sion) to (efi|tbi|fuel[- ]?injection)|\yholley (sniper|terminator|hyperspark|efi)|\ysniper efi|\yfi[- ]?tech\y|\y(msd )?atomic efi|\yez[- ]?efi|\yedelbrock (pro[- ]?flo|e[- ]?street)|\ymegasquirt|\yaftermarket (efi|fuel[- ]?injection)'
         OR (i.x ~* 'fuel.inject' AND coalesce(i.y < 1987, true)))::int
      -- an unrestored car, or one that needs restoring, is not a restored one
      + (z.xb ~* 'grant .{0,12}(wheel|steering)|aftermarket (stereo|gauge|seat)|bluetooth|modern (stereo|audio)|restored|restoration')::int
      -- word terms ('\y' is the word boundary): said to be modified, upgraded or swapped, a built engine, a built car
      + (regexp_replace(i.x, '\y(not|never)( been)? modified\y|\y(un|non)-modified\y|\ymodified version\y|\ymanufacturing modified\y', '', 'g')
           ~* '\y(modified|upgraded|swapped)\y'
         OR i.x ~* '\ybuilt (engine|motor|small[- ]block|big[- ]block|stroker)\y|\ybuilt \d{3}(?!,?\d)|\y(fully|professionally|kit)[- ]built\y|\ycustom[- ]build\y'
         -- a rebuild that changed the engine (stroked, bored to a new displacement, high-performance specification)
         OR i.x ~* '\ystroker\y|\yrebuil\w*[^.;•]{0,40}(high[- ]?performance spec|\ystroked\y|\ybored (out )?to \d{3})')::int AS b,
      -- stock terms read with their negations and the owner's manual removed
      (z.xs ~* 'original owner|numbers[- ]?matching|matching numbers|all[- ]?original|unrestored|survivor|factory original|as[- ]?delivered|bone[- ]?stock|untouched')::int
      + (z.xs ~* 'original .{0,12}(paint|engine|drivetrain|interior|miles)|date[- ]?code|window sticker|build sheet')::int
      -- "stock" and "factory" alone are a stock number, "in stock", a production fact or a factory option: not counted
      + (i.x ~* '\y(completely|totally|entirely|100%)[- ]stock\y')::int AS st
    -- an engine or transmission rebuilt is the same unit made new, not a swap: "rebuil" no longer counts; an LS swap and
    -- an engine or gearbox installed do
    FROM (SELECT (i.x ~* '(engine|motor|v8|v-8|transmission|trans).{0,30}(replac|swap|crate)'
               OR i.x ~* '(replac|swap|crate|ls[- ]?\d|ls[- ]?swap).{0,30}(engine|motor|v8|v-8|transmission|trans)'
               OR i.x ~* '\yls[- ]?swap'
               -- an engine or gearbox put in ("a 383ci v8 was installed", "a five-speed transmission was installed")
               OR i.x ~* '\y(engine|v-?8|transmission|gearbox|transfer case|\d{3} ?ci|\d\.\d[- ]?(l|liter|litre))\y[^.;•,]{0,40}\y(was|were|has been|had been) (installed|fitted\y(?! with))') AS sw,
                 regexp_replace(i.x, 'un-?restored|\y(not|never)( been)? restored\y|\yrestoration candidate|\y(needs|needing|in need of)( an?)?( full| complete| total| some)? restoration', ' ', 'g') AS xb,
                 regexp_replace(i.x, 'original owner[''’]?s?[''’]? (manual|handbook|guide|booklet)|\y(non|not|isn[''’]?t|wasn[''’]?t)[- ]?(numbers[- ]?matching|matching[- ]numbers)|\y(non|not)[- ]original\y', ' ', 'g') AS xs OFFSET 0) z OFFSET 0) s
$function$;
GRANT EXECUTE ON FUNCTION public.nuke_build_class_rule(numeric, integer, text, integer) TO PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.nuke_build_class_rule(numeric, integer, text, integer) IS
  'The build-class rule as one pure function of documented spend, work-session count, the lowercased description text '
  'and the model year (v6, 20261121200000: an engine or transmission rebuilt is not a swap; a bare fuel-injection term '
  'counts only before model year 1987 or with no year, while named aftermarket systems, conversions, an LS swap and an '
  'engine or gearbox installed count at any year; a stroked or high-performance rebuild is one build signal; v5 term '
  'context and v4 "\y" word boundaries kept). Used by nuke_build_class (caller''s view) and '
  'classify_vehicle_build_class (store, method v6_store_rebuild_factory_efi).';

-- The three-argument form keeps its signature and grants for callers without a year; with the year unknown, a bare
-- fuel-injection term still counts there.
CREATE OR REPLACE FUNCTION public.nuke_build_class_rule(p_receipts numeric, p_sessions integer, p_text text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO pg_catalog, pg_temp
AS $function$
  SELECT public.nuke_build_class_rule(p_receipts, p_sessions, p_text, NULL::integer)
$function$;
GRANT EXECUTE ON FUNCTION public.nuke_build_class_rule(numeric, integer, text) TO PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.nuke_build_class_rule(numeric, integer, text) IS
  'The build-class rule without a model year: nuke_build_class_rule(receipts, sessions, text, NULL) (20261121200000).';

-- 2. The callers: the store's writer and the caller's view pass the year; the writer's method literal and the refresh's
--    c_class name v6. Exact literals in the bodies read 2026-11-21, each required once; every other byte as deployed.
DO $bump$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.classify_vehicle_build_class(uuid[])'::regprocedure);
  IF md5(d) = 'd61f6535513605c7fc18846cfc1b83ee' THEN -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
    IF (length(d) - length(replace(d, '''v5_store_term_context''', ''))) / length('''v5_store_term_context''') <> 1
       OR (length(d) - length(replace(d, 'SELECT v.id, v.is_modified,', ''))) / length('SELECT v.id, v.is_modified,') <> 1
       OR (length(d) - length(replace(d, 'public.nuke_build_class_rule(inp.receipts, inp.sessions, inp.txt)', '')))
          / length('public.nuke_build_class_rule(inp.receipts, inp.sessions, inp.txt)') <> 1 THEN
      RAISE EXCEPTION 'classify_vehicle_build_class: expected exactly one of each v5 literal';
    END IF;
    EXECUTE replace(replace(replace(d,
      '''v5_store_term_context''', '''v6_store_rebuild_factory_efi'''),
      'SELECT v.id, v.is_modified,', 'SELECT v.id, v.year, v.is_modified,'),
      'public.nuke_build_class_rule(inp.receipts, inp.sessions, inp.txt)',
      'public.nuke_build_class_rule(inp.receipts, inp.sessions, inp.txt, inp.year)');
  END IF;
  d := pg_get_functiondef('public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure);
  IF md5(d) = '3bb0a0f6c048f71bb4deda69adcdd993' THEN -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
    IF (length(d) - length(replace(d, '''v5_store_term_context''', ''))) / length('''v5_store_term_context''') <> 1 THEN
      RAISE EXCEPTION 'refresh_vehicle_class_price: expected exactly one v5 literal';
    END IF;
    EXECUTE replace(d, '''v5_store_term_context''', '''v6_store_rebuild_factory_efi''');
  END IF;
  d := pg_get_functiondef('public.nuke_build_class(uuid)'::regprocedure);
  IF md5(d) = 'd2ec66e2b6d6e208480bf9cd886fdded' THEN -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
    IF (length(d) - length(replace(d, 'public.nuke_build_class_rule(v_receipts, v_sessions, v_text)', '')))
       / length('public.nuke_build_class_rule(v_receipts, v_sessions, v_text)') <> 1 THEN
      RAISE EXCEPTION 'nuke_build_class: expected exactly one rule call';
    END IF;
    EXECUTE replace(d, 'public.nuke_build_class_rule(v_receipts, v_sessions, v_text)',
      'public.nuke_build_class_rule(v_receipts, v_sessions, v_text, (SELECT year FROM vehicles WHERE id = p_vehicle_id))');
  END IF;
  -- All three now name v6 and pass the year.
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.classify_vehicle_build_class(uuid[])'::regprocedure)
       NOT LIKE '%inp.txt, inp.year)%''v6_store_rebuild_factory_efi''%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure)
        NOT LIKE '%c_class   constant text := ''v6_store_rebuild_factory_efi''%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.nuke_build_class(uuid)'::regprocedure)
        NOT LIKE '%v_text, (SELECT year FROM vehicles WHERE id = p_vehicle_id))%' THEN
    RAISE EXCEPTION 'v6 did not apply to all three callers';
  END IF;
END
$bump$;
COMMENT ON FUNCTION public.classify_vehicle_build_class(uuid[]) IS
  'Classifies up to 2000 vehicles into vehicle_build_class (method v6_store_rebuild_factory_efi) as the definer, so the '
  'class does not depend on who asks. Service role and refresh_vehicle_class_price only.';
COMMENT ON TABLE public.vehicle_build_class IS
  'Build class per vehicle (documented_build | modified | stock | unknown; coarse build | stock | unknown), classified by '
  'the definer from every receipt, work session, the description text and the model year (nuke_build_class_rule). '
  'Written only by classify_vehicle_build_class (method v6_store_rebuild_factory_efi; v5_store_term_context, '
  'v4_store_word_terms and v3_store_text_paper rows are out of date) and the 2026-06-23 Blazer/Jimmy backfill '
  '(v2_scored_text_unwired). source_dna holds private amounts: no client reads this table; get_vehicle_class_prices '
  'returns the coarse class to tied viewers.';

COMMIT;
