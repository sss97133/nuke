-- Live definition of public.search_vehicles_deep(text,integer,integer), pg_get_functiondef on 2026-10-14 23:20Z
-- (prosrc sha256 8trz8F6V6c8ulvPU5ppqGtDL6UriYVWAJ4he4yjBiQQ=). Loaded by test_search_deep_text_for_page_only.sql.
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

  RETURN QUERY
  SELECT
    si.vehicle_id,
    v.year::smallint,
    v.make,
    v.model,
    v.vin,
    v.primary_image_url,
    v.sale_price::bigint,
    (
      ts_rank_cd(si.search_vector, v_tsquery, 32)
      + CASE WHEN lower(v.make) = lower(v_raw) OR lower(v.make) = lower(v_expanded) THEN 5.0
             WHEN lower(v.make || ' ' || coalesce(v.model,'')) LIKE lower(v_raw) || '%' THEN 4.0
             WHEN lower(v.make) LIKE '%' || lower(v_raw) || '%' THEN 2.0
             WHEN to_tsvector('simple', coalesce(si.vehicle_text,'')) @@ v_tsquery THEN 1.5
             ELSE 0.0
        END
    )::real,
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
  FROM vehicle_search_index si
  JOIN vehicles v ON v.id = si.vehicle_id
  WHERE si.search_vector @@ v_tsquery
    AND v.is_public = true
    AND is_auto_vehicle(v.canonical_vehicle_type, v.make)
  ORDER BY 8 DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$
;
