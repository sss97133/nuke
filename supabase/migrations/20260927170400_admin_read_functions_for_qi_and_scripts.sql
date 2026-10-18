-- P0.3 of the approved lock-down plan (2026-09-27): the admin pages that ran raw SQL through
-- execute_sql(text) with a user session get one narrow read-only function each.
--
-- WHY: 20260927150000 revoked EXECUTE on execute_sql(text) from anon and authenticated (it is SECURITY
-- DEFINER, owned by postgres, prefix-checked only — owner-privileged SQL for anyone with the anon key).
-- Five admin pages used it: ScriptControlCenter.tsx:157, admin/QuestionIntelligence.tsx:314,
-- admin/qi/QIAuthorDetail.tsx:56, QICategoryDetail.tsx:72, QIFieldDetail.tsx:54 and :67. Each query
-- below is the page's own query, made static (no dynamic SQL: the one variable column is a CASE over
-- the page's whitelist), parameterized, and gated on the project's existing admin check —
-- public.assert_admin() (SECURITY DEFINER, search_path '', profiles.user_type IN ('admin','moderator')
-- for auth.uid(); raises 'not_authorized' otherwise). All SECURITY DEFINER, SET search_path = '',
-- STABLE; EXECUTE for authenticated only (an admin signed in on nuke.ag).
--
-- MEASURED (prod, 2026-09-27 ~17:50Z, EXPLAIN ANALYZE, session cb179857) — what each page can afford
-- inside the authenticated role's statement budget:
--   author categories: 4 ms (idx_auction_comments_author_username_full);
--   category vehicles: index plan on idx_ac_question_l2_posted (rows≈23 for engine_specs);
--   field fill rate: 10.8 s (parallel seq scan of 947,298 vehicles) — the page's own query, kept;
--   classification progress: both live counts exceeded a 55 s budget on 14.8M auction_comments —
--     question_classified_at IS NOT NULL is a parallel seq scan, and has_question AND
--     question_primary_l1 IS NOT NULL, although planned as an index-only scan on
--     idx_ac_question_l2_posted, still timed out (pg_stat_user_tables shows the table's statistics
--     reset and no vacuum recorded, so the visibility map cannot serve index-only scans). The progress
--     function therefore sums question_count over mv_question_intelligence — the same materialized
--     view the page's table is built from (1,351,436 across 62 taxonomy rows, milliseconds) — and
--     names that source; the figure is as of the view's last refresh, like the table under it;
--   ScriptControlCenter: COUNT(*) FILTER (...) over vehicle_images (43,037,656 rows) exceeded a 55 s
--     budget even as one pass; the four image metrics are returned as NOT COMPUTED rather than as 0
--     (which is what the page displayed on error) — no fabricated numbers on an admin surface.
--     vehicle_processing_summary does not exist in prod; missing_context_reports has 332 rows.
--
-- SCHEMA_LAW: §1 no existing function serves these reads (admin_pulse() covers queues and snapshots,
-- not these); §4 read-only; §6 the pages are the only callers; §7 CI-applied, undo = DROP FUNCTION.

SET statement_timeout = '120s';

-- ─── admin/QuestionIntelligence.tsx: classification progress ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_qi_progress()
RETURNS TABLE (has_l1 bigint, source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM public.assert_admin();
  RETURN QUERY
    SELECT COALESCE(sum(m.question_count), 0)::bigint,
           'mv_question_intelligence (as of its last refresh)'::text
    FROM public.mv_question_intelligence m;
END;
$fn$;

COMMENT ON FUNCTION public.admin_qi_progress() IS
  'Admin-only (assert_admin). Questions that carry a category, summed from mv_question_intelligence (the view the QI table is built from), as of its last refresh. The live counts over 14.8M auction_comments exceeded a 55 s budget on 2026-09-27 and are not offered.';

-- ─── admin/qi/QIAuthorDetail.tsx: category distribution for one author ───────────────────────────
CREATE OR REPLACE FUNCTION public.admin_qi_author_categories(p_author text)
RETURNS TABLE (l1 text, l2 text, count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM public.assert_admin();
  RETURN QUERY
    SELECT ac.question_primary_l1, ac.question_primary_l2, pg_catalog.count(*)::integer
    FROM public.auction_comments ac
    WHERE ac.author_username = p_author
      AND ac.has_question = true
      AND ac.question_primary_l1 IS NOT NULL
    GROUP BY ac.question_primary_l1, ac.question_primary_l2
    ORDER BY 3 DESC
    LIMIT 20;
END;
$fn$;

COMMENT ON FUNCTION public.admin_qi_author_categories(text) IS
  'Admin-only (assert_admin). Top 20 (l1, l2) categories of one author''s classified questions. Replaces the execute_sql call in QIAuthorDetail.tsx.';

-- ─── admin/qi/QICategoryDetail.tsx: vehicles most asked about in one L2 category ─────────────────
CREATE OR REPLACE FUNCTION public.admin_qi_category_vehicles(p_l2 text)
RETURNS TABLE (vehicle_id uuid, year integer, make text, model text, q_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM public.assert_admin();
  RETURN QUERY
    SELECT ac.vehicle_id, v.year, v.make, v.model, pg_catalog.count(*)::integer
    FROM public.auction_comments ac
    JOIN public.vehicles v ON v.id = ac.vehicle_id
    WHERE ac.question_primary_l2 = p_l2
      AND ac.has_question = true
      AND ac.question_primary_l1 IS NOT NULL
    GROUP BY ac.vehicle_id, v.year, v.make, v.model
    ORDER BY 5 DESC
    LIMIT 20;
END;
$fn$;

COMMENT ON FUNCTION public.admin_qi_category_vehicles(text) IS
  'Admin-only (assert_admin). Top 20 vehicles by classified-question count in one L2 category. Replaces the execute_sql call in QICategoryDetail.tsx.';

-- ─── admin/qi/QIFieldDetail.tsx: fill rate of one whitelisted vehicles column ────────────────────
-- The page's whitelist (qi/constants.ts VALID_FIELD_COLUMNS) names 39 columns; these 20 exist on
-- vehicles in prod. Any other name is refused (22023), never interpolated.
CREATE OR REPLACE FUNCTION public.admin_qi_field_fill(p_field text)
RETURNS TABLE (total integer, filled integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM public.assert_admin();
  IF p_field IS NULL OR p_field NOT IN (
    'asking_price','body_style','description','drivetrain','engine_displacement','engine_type','fuel_type',
    'highlights','horsepower','interior_color','known_flaws','mileage','modifications','sale_price',
    'steering_type','title_status','torque','transmission_speeds','transmission_type','vin') THEN
    RAISE EXCEPTION 'admin_qi_field_fill: unsupported field %', p_field USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT count(*)::integer,
           count(*) FILTER (WHERE CASE p_field
             WHEN 'asking_price'        THEN v.asking_price        IS NOT NULL
             WHEN 'body_style'          THEN v.body_style          IS NOT NULL
             WHEN 'description'         THEN v.description         IS NOT NULL
             WHEN 'drivetrain'          THEN v.drivetrain          IS NOT NULL
             WHEN 'engine_displacement' THEN v.engine_displacement IS NOT NULL
             WHEN 'engine_type'         THEN v.engine_type         IS NOT NULL
             WHEN 'fuel_type'           THEN v.fuel_type           IS NOT NULL
             WHEN 'highlights'          THEN v.highlights          IS NOT NULL
             WHEN 'horsepower'          THEN v.horsepower          IS NOT NULL
             WHEN 'interior_color'      THEN v.interior_color      IS NOT NULL
             WHEN 'known_flaws'         THEN v.known_flaws         IS NOT NULL
             WHEN 'mileage'             THEN v.mileage             IS NOT NULL
             WHEN 'modifications'       THEN v.modifications       IS NOT NULL
             WHEN 'sale_price'          THEN v.sale_price          IS NOT NULL
             WHEN 'steering_type'       THEN v.steering_type       IS NOT NULL
             WHEN 'title_status'        THEN v.title_status        IS NOT NULL
             WHEN 'torque'              THEN v.torque              IS NOT NULL
             WHEN 'transmission_speeds' THEN v.transmission_speeds IS NOT NULL
             WHEN 'transmission_type'   THEN v.transmission_type   IS NOT NULL
             WHEN 'vin'                 THEN v.vin                 IS NOT NULL
             ELSE false END)::integer
    FROM public.vehicles v;
END;
$fn$;

COMMENT ON FUNCTION public.admin_qi_field_fill(text) IS
  'Admin-only (assert_admin). (total, filled) for one of 20 whitelisted vehicles columns; a full scan of vehicles (~11 s measured 2026-09-27). Replaces the first execute_sql call in QIFieldDetail.tsx.';

-- ─── admin/qi/QIFieldDetail.tsx: vehicles missing the field, most asked about in the given L2s ───
CREATE OR REPLACE FUNCTION public.admin_qi_field_missing_vehicles(p_field text, p_l2 text[])
RETURNS TABLE (vehicle_id uuid, year integer, make text, model text, q_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM public.assert_admin();
  IF p_field IS NULL OR p_field NOT IN (
    'asking_price','body_style','description','drivetrain','engine_displacement','engine_type','fuel_type',
    'highlights','horsepower','interior_color','known_flaws','mileage','modifications','sale_price',
    'steering_type','title_status','torque','transmission_speeds','transmission_type','vin') THEN
    RAISE EXCEPTION 'admin_qi_field_missing_vehicles: unsupported field %', p_field USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_l2 IS NULL OR cardinality(p_l2) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT v.id, v.year, v.make, v.model, pg_catalog.count(*)::integer
    FROM public.auction_comments ac
    JOIN public.vehicles v ON v.id = ac.vehicle_id
    WHERE ac.question_primary_l2 = ANY (p_l2)
      AND ac.has_question = true
      AND ac.question_primary_l1 IS NOT NULL
      AND (CASE p_field
             WHEN 'asking_price'        THEN v.asking_price        IS NULL
             WHEN 'body_style'          THEN v.body_style          IS NULL
             WHEN 'description'         THEN v.description         IS NULL
             WHEN 'drivetrain'          THEN v.drivetrain          IS NULL
             WHEN 'engine_displacement' THEN v.engine_displacement IS NULL
             WHEN 'engine_type'         THEN v.engine_type         IS NULL
             WHEN 'fuel_type'           THEN v.fuel_type           IS NULL
             WHEN 'highlights'          THEN v.highlights          IS NULL
             WHEN 'horsepower'          THEN v.horsepower          IS NULL
             WHEN 'interior_color'      THEN v.interior_color      IS NULL
             WHEN 'known_flaws'         THEN v.known_flaws         IS NULL
             WHEN 'mileage'             THEN v.mileage             IS NULL
             WHEN 'modifications'       THEN v.modifications       IS NULL
             WHEN 'sale_price'          THEN v.sale_price          IS NULL
             WHEN 'steering_type'       THEN v.steering_type       IS NULL
             WHEN 'title_status'        THEN v.title_status        IS NULL
             WHEN 'torque'              THEN v.torque              IS NULL
             WHEN 'transmission_speeds' THEN v.transmission_speeds IS NULL
             WHEN 'transmission_type'   THEN v.transmission_type   IS NULL
             WHEN 'vin'                 THEN v.vin                 IS NULL
             ELSE false END)
    GROUP BY v.id, v.year, v.make, v.model
    ORDER BY 5 DESC
    LIMIT 15;
END;
$fn$;

COMMENT ON FUNCTION public.admin_qi_field_missing_vehicles(text, text[]) IS
  'Admin-only (assert_admin). Top 15 vehicles missing one whitelisted column, ranked by classified questions in the given L2 categories. Replaces the second execute_sql call in QIFieldDetail.tsx.';

-- ─── pages/ScriptControlCenter.tsx: per-script processed counts ──────────────────────────────────
-- One call per page load instead of six. The four vehicle_images metrics are NOT computed (43M-row
-- scans do not fit an interactive request; measured > 55 s on 2026-09-27) and say so; the page shows
-- them as unknown, not as 0. vehicle_processing_summary does not exist in prod.
CREATE OR REPLACE FUNCTION public.admin_script_center_progress()
RETURNS TABLE (script_id text, source_table text, processed bigint, computed boolean, note text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM public.assert_admin();
  RETURN QUERY
    SELECT 'gap-finder'::text, 'missing_context_reports'::text, count(*)::bigint, true, NULL::text
      FROM public.missing_context_reports
    UNION ALL SELECT 'completeness-calculator', 'vehicle_processing_summary', NULL, false,
      'table does not exist in prod (2026-09-27)'
    UNION ALL SELECT 'angle-setter', 'vehicle_images', NULL, false,
      'not computed: COUNT(*) FILTER (WHERE angle IS NOT NULL) over 43M rows exceeds an interactive budget (> 55 s measured 2026-09-27)'
    UNION ALL SELECT 'tier1-processor', 'vehicle_images', NULL, false,
      'not computed: ai_scan_metadata->tier_1_analysis over 43M rows exceeds an interactive budget (> 55 s measured 2026-09-27)'
    UNION ALL SELECT 'tier2-processor', 'vehicle_images', NULL, false,
      'not computed: ai_scan_metadata->tier_2_analysis over 43M rows exceeds an interactive budget (> 55 s measured 2026-09-27)'
    UNION ALL SELECT 'tier3-processor', 'vehicle_images', NULL, false,
      'not computed: ai_scan_metadata->tier_3_analysis over 43M rows exceeds an interactive budget (> 55 s measured 2026-09-27)';
END;
$fn$;

COMMENT ON FUNCTION public.admin_script_center_progress() IS
  'Admin-only (assert_admin). Processed counts for ScriptControlCenter.tsx; computed = false rows carry the reason instead of a fabricated 0. Replaces the execute_sql call at ScriptControlCenter.tsx:157.';

-- ─── Grants: signed-in users only; assert_admin() does the rest ─────────────────────────────────
-- (service_role is revoked too: the pages run as the signed-in admin, and assert_admin() has no
-- auth.uid() under a service key anyway.)
REVOKE ALL ON FUNCTION public.admin_qi_progress()                              FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_qi_author_categories(text)                 FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_qi_category_vehicles(text)                 FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_qi_field_fill(text)                        FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_qi_field_missing_vehicles(text, text[])    FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_script_center_progress()                   FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_qi_progress()                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_qi_author_categories(text)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_qi_category_vehicles(text)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_qi_field_fill(text)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_qi_field_missing_vehicles(text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_script_center_progress()                TO authenticated;

-- ─── Live verification (run after apply) ─────────────────────────────────────────────────────────
-- SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname LIKE 'admin_qi_%' OR proname = 'admin_script_center_progress';
--   -> 6 rows, prosecdef = true, proconfig = {search_path=}
-- SELECT has_function_privilege('anon', 'public.admin_qi_progress()', 'EXECUTE');           -> false
-- SELECT has_function_privilege('authenticated', 'public.admin_qi_progress()', 'EXECUTE');  -> true
-- As a non-admin session: SELECT * FROM public.admin_qi_progress();  -> ERROR not_authorized
