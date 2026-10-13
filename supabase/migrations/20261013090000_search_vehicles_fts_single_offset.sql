-- Preserve branch priority and rank while applying offset/limit once across
-- candidates eligible for public vehicle readers. Deleted/non-vehicle records
-- must not reappear through this SECURITY DEFINER search path.
-- No index, grant, security-mode or source-data change. Refuse unreviewed drift.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';
DO $repair$
DECLARE
  current_definition text;
  replacement constant text := $replacement$CREATE OR REPLACE FUNCTION public.search_vehicles_fts(query_text text, limit_count integer DEFAULT 20, p_auto_only boolean DEFAULT true, offset_count integer DEFAULT 0)
 RETURNS TABLE(id uuid, year integer, make text, model text, vin text, status text, sale_price integer, current_value numeric, relevance real)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  parsed_make text;
  tokens text[];
  remaining_offset bigint := COALESCE(offset_count, 0);
  remaining_limit bigint := limit_count;
  candidate record;
  has_year_prefix boolean := false;
  raw_query text;
  year_val integer;
  rest_text text;
BEGIN
  IF remaining_offset < 0 THEN RAISE EXCEPTION 'OFFSET must not be negative' USING ERRCODE = '2201X'; END IF;
  IF remaining_limit < 0 THEN RAISE EXCEPTION 'LIMIT must not be negative' USING ERRCODE = '2201W'; END IF;
  IF remaining_limit = 0 THEN RETURN; END IF;
  tokens := string_to_array(regexp_replace(query_text, '\s*&\s*', ' ', 'g'), ' ');
  raw_query := regexp_replace(query_text, '\s*&\s*', ' ', 'g');

  -- Carry one offset/limit across ordered, disjoint branches. Each branch scans
  -- at most the still-skipped + still-needed rows; full primary pages never run
  -- the broader fallback. NULL LIMIT retains PostgreSQL's unbounded behavior.
  -- Year prefix: "1967 camaro"
  IF array_length(tokens, 1) >= 2 AND tokens[1] ~ '^\d{4}$' THEN
    year_val := tokens[1]::integer;
    IF year_val BETWEEN 1886 AND 2030 THEN
      has_year_prefix := true;
      rest_text := trim(array_to_string(tokens[2:], ' '));
      FOR candidate IN
      SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
        0.98::real AS relevance
      FROM public.vehicles v
      WHERE v.is_public = true
        AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
        AND v.year = year_val
        AND v.make IS NOT NULL AND v.model IS NOT NULL
        AND (lower(v.make) || ' ' || lower(v.model)) ILIKE '%' || lower(rest_text) || '%'
        AND (NOT p_auto_only OR is_auto_vehicle(v.canonical_vehicle_type, v.make))
      ORDER BY (v.primary_image_url IS NOT NULL) DESC,
               COALESCE(v.image_count, 0) DESC,
               COALESCE(v.bat_view_count, v.view_count, 0) DESC,
               v.sale_price DESC NULLS LAST,
               v.year DESC, v.id
      LIMIT remaining_offset + remaining_limit
      LOOP
        IF remaining_offset > 0 THEN
          remaining_offset := remaining_offset - 1;
        ELSE
          id := candidate.id; year := candidate.year; make := candidate.make;
          model := candidate.model; vin := candidate.vin; status := candidate.status;
          sale_price := candidate.sale_price; current_value := candidate.current_value;
          relevance := candidate.relevance;
          RETURN NEXT;
          remaining_limit := remaining_limit - 1;
          IF remaining_limit = 0 THEN RETURN; END IF;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Single token: exact make match
  IF array_length(tokens, 1) = 1 THEN
    parsed_make := trim(tokens[1]);
    FOR candidate IN
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
      0.95::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true
      AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
      AND v.make = initcap(parsed_make)
      AND (NOT p_auto_only OR is_auto_vehicle(v.canonical_vehicle_type, v.make))
    ORDER BY (v.primary_image_url IS NOT NULL) DESC,
             COALESCE(v.image_count, 0) DESC,
             COALESCE(v.bat_view_count, v.view_count, 0) DESC,
             v.sale_price DESC NULLS LAST,
             v.year DESC, v.id
    LIMIT remaining_offset + remaining_limit
    LOOP
      IF remaining_offset > 0 THEN
        remaining_offset := remaining_offset - 1;
      ELSE
        id := candidate.id; year := candidate.year; make := candidate.make;
        model := candidate.model; vin := candidate.vin; status := candidate.status;
        sale_price := candidate.sale_price; current_value := candidate.current_value;
        relevance := candidate.relevance;
        RETURN NEXT;
        remaining_limit := remaining_limit - 1;
        IF remaining_limit = 0 THEN RETURN; END IF;
      END IF;
    END LOOP;

    -- Trigram make+model search
    FOR candidate IN
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
      0.9::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true
      AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
      AND (lower(v.make) || ' ' || lower(v.model)) ILIKE '%' || lower(parsed_make) || '%'
      AND v.make != initcap(parsed_make)
      AND (NOT p_auto_only OR is_auto_vehicle(v.canonical_vehicle_type, v.make))
    ORDER BY (v.primary_image_url IS NOT NULL) DESC,
             COALESCE(v.image_count, 0) DESC,
             COALESCE(v.bat_view_count, v.view_count, 0) DESC,
             v.sale_price DESC NULLS LAST,
             v.year DESC, v.id
    LIMIT remaining_offset + remaining_limit
    LOOP
      IF remaining_offset > 0 THEN
        remaining_offset := remaining_offset - 1;
      ELSE
        id := candidate.id; year := candidate.year; make := candidate.make;
        model := candidate.model; vin := candidate.vin; status := candidate.status;
        sale_price := candidate.sale_price; current_value := candidate.current_value;
        relevance := candidate.relevance;
        RETURN NEXT;
        remaining_limit := remaining_limit - 1;
        IF remaining_limit = 0 THEN RETURN; END IF;
      END IF;
    END LOOP;
  END IF;

  -- 2+ tokens: trigram on make+model
  IF array_length(tokens, 1) >= 2 THEN
    FOR candidate IN
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
      0.9::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true
      AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
      AND (lower(v.make) || ' ' || lower(v.model)) ILIKE '%' || lower(raw_query) || '%'
      -- One vehicle belongs to its highest-priority matching branch.
      AND NOT (has_year_prefix AND v.year = year_val
        AND (lower(v.make) || ' ' || lower(v.model)) ILIKE '%' || lower(rest_text) || '%')
      AND (NOT p_auto_only OR is_auto_vehicle(v.canonical_vehicle_type, v.make))
    ORDER BY (v.primary_image_url IS NOT NULL) DESC,
             COALESCE(v.image_count, 0) DESC,
             COALESCE(v.bat_view_count, v.view_count, 0) DESC,
             v.sale_price DESC NULLS LAST,
             v.year DESC, v.id
    LIMIT remaining_offset + remaining_limit
    LOOP
      IF remaining_offset > 0 THEN
        remaining_offset := remaining_offset - 1;
      ELSE
        id := candidate.id; year := candidate.year; make := candidate.make;
        model := candidate.model; vin := candidate.vin; status := candidate.status;
        sale_price := candidate.sale_price; current_value := candidate.current_value;
        relevance := candidate.relevance;
        RETURN NEXT;
        remaining_limit := remaining_limit - 1;
        IF remaining_limit = 0 THEN RETURN; END IF;
      END IF;
    END LOOP;
  END IF;
END;
$function$
$replacement$;
BEGIN
  current_definition := pg_get_functiondef('public.search_vehicles_fts(text,integer,boolean,integer)'::regprocedure);
  IF current_definition = replacement THEN RETURN; END IF;
  IF encode(sha256(convert_to(current_definition, 'UTF8')), 'hex') IS DISTINCT FROM
      'f77ef0a7a8512a87cf4bb11bcf4bb042958794566c8fcc6177f93277fd5bb7b3' THEN
    RAISE EXCEPTION 'Search reader owner drifted; review its definition before changing pagination';
  END IF;
  IF EXISTS(SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock')
    OR (SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state = 'active'
        AND query ILIKE '%search_vehicles_fts%') > 2 THEN
    RAISE EXCEPTION 'Search reader repair requires an idle DDL lane';
  END IF;
  EXECUTE replacement;
  IF pg_get_functiondef('public.search_vehicles_fts(text,integer,boolean,integer)'::regprocedure)
      IS DISTINCT FROM replacement THEN
    RAISE EXCEPTION 'Search reader replacement differs from reviewed definition';
  END IF;
END $repair$;
COMMIT;
SELECT count(*) AS lock_waiters_after_search_repair FROM pg_stat_activity WHERE wait_event_type = 'Lock';
