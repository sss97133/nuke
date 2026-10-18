-- search_vehicles_deep reads the long text only for the rows it returns.
--
-- Measured 2026-10-14 (money-columns, as postgres): search_vehicles_deep('chevorlet') ran past 55 s, and logged-out
-- universal-search took 60.5 s for "chevorlet" and 20.1 s for "mustnag". expand_search_query turns 'chevorlet' into
-- 'chevrolet', which matches about 109k rows of vehicle_search_index. For every match the function built
-- match_source and snippet (to_tsvector over the description, comment and evidence text, and ts_headline) before
-- sorting, then kept 20. universal-search calls it whenever the main search returns under half a page, so any typo
-- in the synonym map, and any word common in comments, reached this path, and any visitor could start one.
-- Now the matches are ranked first with the same relevance expression, the page is cut, and match_source and
-- snippet are built for that page only (vehicle_search_index is keyed by vehicle_id, so the join back is exact).
-- Same rows and order, up to ties in relevance; same signature, volatility, grants and security (invoker).
-- Contract: supabase/sql/test_search_deep_text_for_page_only.sql (db-contracts) compares it with the old body.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v
  FROM pg_proc WHERE oid = 'public.search_vehicles_deep(text,integer,integer)'::regprocedure;
  IF v IS DISTINCT FROM '8trz8F6V6c8ulvPU5ppqGtDL6UriYVWAJ4he4yjBiQQ=' AND v IS DISTINCT FROM 'wauAQ+k9nOX6MBV3TcBRG6hhKOVcc+ONDST+jPhRia0=' THEN
    RAISE EXCEPTION 'search_vehicles_deep is not the 2026-10-14 definition this was written from (sha256 %)', v;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.search_vehicles_deep(p_query text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(vehicle_id uuid, year smallint, make text, model text, vin text, primary_image_url text, sale_price bigint, relevance real, match_source text, snippet text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_tsquery tsquery;
  v_raw text;
  v_expanded text;
BEGIN
  v_raw := trim(p_query);
  IF v_raw = '' THEN RETURN; END IF;

  -- Expand synonyms before building tsquery
  v_expanded := expand_search_query(v_raw);

  BEGIN
    v_tsquery := websearch_to_tsquery('english', v_expanded);
  EXCEPTION WHEN OTHERS THEN
    v_tsquery := plainto_tsquery('english', v_expanded);
  END;

  -- Rank every match, then read the long text only for the page returned: match_source and snippet parse a row's
  -- description, comment and evidence text, and computing them for every match before the sort made a broad query
  -- ('chevorlet' expands to 'chevrolet', 109k matches) run past 55 s. The ranking and the rows returned are the same.
  RETURN QUERY
  WITH ranked AS (
    SELECT
      si.vehicle_id AS vid,
      v.year::smallint AS yr,
      v.make AS mk,
      v.model AS md,
      v.vin AS vn,
      v.primary_image_url AS img,
      v.sale_price::bigint AS sp,
    (
        ts_rank_cd(si.search_vector, v_tsquery, 32)
        + CASE WHEN lower(v.make) = lower(v_raw) OR lower(v.make) = lower(v_expanded) THEN 5.0
               WHEN lower(v.make || ' ' || coalesce(v.model,'')) LIKE lower(v_raw) || '%' THEN 4.0
               WHEN lower(v.make) LIKE '%' || lower(v_raw) || '%' THEN 2.0
               WHEN to_tsvector('simple', coalesce(si.vehicle_text,'')) @@ v_tsquery THEN 1.5
               ELSE 0.0
          END
      )::real AS rel
    FROM vehicle_search_index si
    JOIN vehicles v ON v.id = si.vehicle_id
    WHERE si.search_vector @@ v_tsquery
      AND v.is_public = true
      AND is_auto_vehicle(v.canonical_vehicle_type, v.make)
    ORDER BY rel DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    r.vid,
    r.yr,
    r.mk,
    r.md,
    r.vn,
    r.img,
    r.sp,
    r.rel,
    CASE
      WHEN to_tsvector('simple', coalesce(si.vehicle_text,'')) @@ v_tsquery THEN 'vehicle'
      WHEN to_tsvector('english', coalesce(si.description_text,'')) @@ v_tsquery THEN 'description'
      WHEN to_tsvector('english', coalesce(si.comment_text,'')) @@ v_tsquery THEN 'comment'
      WHEN to_tsvector('english', coalesce(si.evidence_text,'')) @@ v_tsquery THEN 'evidence'
      ELSE 'vehicle'
    END,
    CASE
      WHEN to_tsvector('english', coalesce(si.comment_text,'')) @@ v_tsquery THEN
        ts_headline('english', left(si.comment_text, 2000), v_tsquery, 'MaxWords=30, MinWords=10, StartSel=**, StopSel=**')
      WHEN to_tsvector('english', coalesce(si.description_text,'')) @@ v_tsquery THEN
        ts_headline('english', left(si.description_text, 2000), v_tsquery, 'MaxWords=30, MinWords=10, StartSel=**, StopSel=**')
      WHEN to_tsvector('english', coalesce(si.evidence_text,'')) @@ v_tsquery THEN
        ts_headline('english', left(si.evidence_text, 2000), v_tsquery, 'MaxWords=30, MinWords=10, StartSel=**, StopSel=**')
      WHEN to_tsvector('simple', coalesce(si.vehicle_text,'')) @@ v_tsquery THEN
        ts_headline('simple', si.vehicle_text, v_tsquery, 'MaxWords=20, MinWords=5, StartSel=**, StopSel=**')
      ELSE ''
    END
  FROM ranked r
  JOIN vehicle_search_index si ON si.vehicle_id = r.vid
  ORDER BY r.rel DESC;
END;
$function$;

COMMIT;
