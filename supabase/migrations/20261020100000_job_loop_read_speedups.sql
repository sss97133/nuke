-- Job-loop read speedups (output-identical), measured on the live published demand (39 open requirements; the K2500 job
-- has 34). Per-function timings inside a rolled-back transaction (track_functions = all) found:
--   * open_requirements_read as a signed-in provider: 600-950 ms warm, 721 ms of it in tool_text_keys called 520 times by
--     user_tool_keys: 51 reviewed tool-term regexes cycled per tool overflow the backend's 32-entry compiled-regex cache,
--     so every match recompiled. user_tool_keys is rewritten set-based: tools and terms materialized once, each term
--     scanned across all tools (one compile per term). Same rows (verified per user against the previous body).
--   * work_order_provider_matches_read (K2500, as its organization owner): ~480-600 ms warm, 421 ms in
--     requirement_capability_keys called 578 times: the lateral `q` was inlined and recomputed at every reference for every
--     provider. Requirements are now enriched once in a MATERIALIZED CTE (one call per requirement).
--   * requirement_capability_keys evaluated the template slug once per mapping row (8,092 calls); it is now a scalar
--     subquery evaluated once per call.
-- Contract: supabase/sql/test_job_loop_read_speedups.sql (PG17): previous and new bodies give the same rows on varied
-- fixtures; the readers keep their output.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $apply$
DECLARE
  udef text := pg_get_functiondef('public.user_tool_keys(uuid)'::regprocedure);
  cdef text := pg_get_functiondef('public.requirement_capability_keys(jsonb,jsonb)'::regprocedure);
  wdef text := pg_get_functiondef('public.work_order_provider_matches_read(uuid,integer)'::regprocedure);
  c1 constant text := $a$= public.capability_template_slug(p_requirement->>'description')$a$;
  w1 constant text := $a$  ), per AS (
$a$;
  w2 constant text := $a$    FROM people p, jsonb_array_elements(COALESCE(g->'requirements', '[]'::jsonb)) q0,
      LATERAL (SELECT q0 || jsonb_build_object('capability_keys', public.requirement_capability_keys(q0, g->'specifications')) AS q) qx
$a$;
BEGIN
  IF position('LATERAL (SELECT * FROM public.tool_text_keys(t.category' IN udef) = 0 THEN
    RAISE EXCEPTION 'user_tool_keys is not the 20261020030000 body; refusing to replace it';
  END IF;
  IF (length(cdef) - length(replace(cdef, c1, ''))) / length(c1) <> 1 THEN RAISE EXCEPTION 'requirement_capability_keys slug anchor not found once'; END IF;
  IF (length(wdef) - length(replace(wdef, w1, ''))) / length(w1) <> 1 THEN RAISE EXCEPTION 'work_order_provider_matches_read per anchor not found once'; END IF;
  IF (length(wdef) - length(replace(wdef, w2, ''))) / length(w2) <> 1 THEN RAISE EXCEPTION 'work_order_provider_matches_read requirements anchor not found once'; END IF;
  EXECUTE $u$CREATE OR REPLACE FUNCTION public.user_tool_keys(p_user uuid)
 RETURNS TABLE(requirement_key text, tool_source text, tool_id uuid, via text, matched text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH tools AS MATERIALIZED (
    SELECT 'user_tools'::text AS src, t.id, t.category AS cat, tc.name AS cat2,
      lower(concat_ws(' ', t.description, c.name, c.description)) AS txt
    FROM public.user_tools t
    LEFT JOIN public.tool_catalog c ON c.id = t.catalog_id
    LEFT JOIN public.tool_categories tc ON tc.id = c.category_id
    WHERE t.user_id = p_user
    UNION ALL
    SELECT 'tool_inventory', i.id, i.category, NULL, lower(concat_ws(' ', i.name, i.brand, i.model))
    FROM public.tool_inventory i
    WHERE i.owner_id = p_user AND COALESCE(i.status, 'active') NOT IN ('sold','lost','retired','disposed')
  ), terms AS MATERIALIZED (
    SELECT m.requirement_key, m.source_key,
      '\m' || regexp_replace(m.source_key, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M' AS re
    FROM public.tool_requirement_key_map m WHERE m.source_kind = 'tool_term'
  )
  SELECT m.requirement_key, x.src, x.id, 'category', m.source_key
  FROM tools x JOIN public.tool_requirement_key_map m ON m.source_kind = 'tool_category'
    AND (m.source_key = lower(btrim(COALESCE(x.cat, ''))) OR (x.src = 'user_tools' AND m.source_key = lower(btrim(COALESCE(x.cat2, '')))))
  UNION
  -- One reviewed term at a time over every tool, so each pattern is compiled once (the regex cache holds 32).
  SELECT t.requirement_key, x.src, x.id, 'term', t.source_key
  FROM terms t CROSS JOIN LATERAL (SELECT tl.src, tl.id FROM tools tl WHERE tl.txt ~ t.re OFFSET 0) x
$function$;$u$;
  EXECUTE replace(cdef, c1, $r$= (SELECT public.capability_template_slug(p_requirement->>'description'))$r$);
  wdef := replace(wdef, w1, $r$  ), reqs AS MATERIALIZED (
    SELECT q0 || jsonb_build_object('capability_keys', public.requirement_capability_keys(q0, g->'specifications')) AS q
    FROM jsonb_array_elements(COALESCE(g->'requirements', '[]'::jsonb)) q0
  ), per AS (
$r$);
  wdef := replace(wdef, w2, $r$    FROM people p, reqs
$r$);
  EXECUTE wdef;
END $apply$;
COMMIT;
