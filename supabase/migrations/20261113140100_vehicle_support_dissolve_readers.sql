-- Readers: dissolved profiles (vehicles.derived_status = 'dissolved') drop out of the garage and search.
-- Bodies are the live definitions as of 2026-11-09 with one added predicate each (v.derived_status IS NULL).
-- Depends on 20261113140000_vehicle_support_dissolve.sql. Codex's lane: draft for review.

CREATE OR REPLACE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text, image_url text, current_value numeric, purchase_price numeric, image_count bigint, relationship text, last_activity_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The owner, or the service role (no user id; the books and attribution scripts), sees everything.
  WITH viewer AS (SELECT coalesce(auth.uid() = p_user_id, false) OR coalesce(auth.role() = 'service_role', false) AS is_own),
  -- prec = precedence when one vehicle is reached by several routes (lower wins).
  --   1 owner | 2 previously_owned | 3 consigned (significant non-owner role) | 4 documenting (own photos / work in last 60d)
  --   5 contributor | 6 profile_record | 7 relationship_review
  valid_titles AS (
    SELECT id, vehicle_id FROM public.ownership_verifications
    WHERE user_id=p_user_id AND status='approved'
      AND verification_category='title_document' AND title_document_url ~ '^https://'
      AND (expires_at IS NULL OR expires_at > (now() AT TIME ZONE 'UTC'))
      -- A title approval does not erase the account's recorded disposal/future period.
      AND (NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships o
          WHERE o.owner_profile_id=p_user_id AND o.vehicle_id=ownership_verifications.vehicle_id
            AND o.role IN ('owner','verified_owner','current_owner','co_owner','co-owner','previous_owner'))
        OR EXISTS (SELECT 1 FROM public.vehicle_ownerships o
          WHERE o.owner_profile_id=p_user_id AND o.vehicle_id=ownership_verifications.vehicle_id
            AND o.role IN ('owner','verified_owner','current_owner','co_owner','co-owner')
            AND o.is_current AND o.end_date IS NULL AND (o.start_date IS NULL OR o.start_date <= current_date)))
  ),
  src AS (
    -- A permission is membership, not proof of title. Preserve unsupported rows for own-account review.
    SELECT p.vehicle_id, CASE WHEN EXISTS (SELECT 1 FROM valid_titles t WHERE t.vehicle_id=p.vehicle_id)
        THEN 1 ELSE 7 END prec, NULL::timestamptz act
      FROM public.vehicle_user_permissions p
      WHERE p.user_id=p_user_id AND p.revoked_at IS NULL AND coalesce(p.is_active,true)
        AND p.role IN ('owner','co_owner')
        AND ((SELECT is_own FROM viewer) OR EXISTS (SELECT 1 FROM valid_titles t WHERE t.vehicle_id=p.vehicle_id))
    UNION ALL SELECT ov.vehicle_id, CASE
        WHEN EXISTS (SELECT 1 FROM public.vehicle_ownerships o WHERE o.owner_profile_id=p_user_id
          AND o.vehicle_id=ov.vehicle_id AND (o.role='previous_owner' OR o.end_date <= current_date))
          AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships o WHERE o.owner_profile_id=p_user_id
            AND o.vehicle_id=ov.vehicle_id AND o.is_current AND o.end_date IS NULL
            AND (o.start_date IS NULL OR o.start_date <= current_date)) THEN 2
        WHEN EXISTS (SELECT 1 FROM valid_titles t WHERE t.id=ov.id) THEN 1 ELSE 7 END, NULL
      FROM public.ownership_verifications ov WHERE ov.user_id=p_user_id AND ov.status='approved'
        AND ((SELECT is_own FROM viewer) OR EXISTS (SELECT 1 FROM valid_titles t WHERE t.id=ov.id))
    UNION ALL SELECT o.vehicle_id, CASE
        WHEN o.role IN ('owner','verified_owner','current_owner','co_owner','co-owner','previous_owner')
          AND (o.start_date IS NULL OR o.start_date <= current_date)
          AND (o.role='previous_owner' OR o.end_date <= current_date) THEN 2
        WHEN o.role IN ('owner','verified_owner','current_owner','co_owner','co-owner')
          AND o.is_current AND o.end_date IS NULL AND (o.start_date IS NULL OR o.start_date <= current_date)
          AND EXISTS (SELECT 1 FROM valid_titles t WHERE t.id=o.verification_id AND t.vehicle_id=o.vehicle_id) THEN 1
        ELSE 7 END, NULL
      FROM public.vehicle_ownerships o WHERE o.owner_profile_id=p_user_id AND (SELECT is_own FROM viewer)
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
      WHERE v.user_id=p_user_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL AND v.derived_status IS NULL AND (SELECT is_own FROM viewer)
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
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr NOT IN (6,7) THEN
           (SELECT ne.estimated_value FROM nuke_estimates ne
              WHERE ne.vehicle_id = v.id AND ne.comp_method = 'class_stratified'
              ORDER BY ne.calculated_at DESC NULLS LAST LIMIT 1) END,
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr NOT IN (6,7) THEN v.purchase_price END,
         COALESCE(v.image_count, 0)::bigint,
         CASE d.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously_owned' WHEN 3 THEN 'consigned' WHEN 4 THEN 'documenting' WHEN 5 THEN 'contributor' WHEN 6 THEN 'profile_record' ELSE 'relationship_review' END,
         -- genuine activity only (EXIF photos by owner/contributors, real work sessions, genuine timeline events); see vehicle_activity
         va.last_activity_at
  FROM dedup d JOIN vehicles v ON v.id=d.vehicle_id
  LEFT JOIN vehicle_activity va ON va.vehicle_id = v.id
  WHERE v.merged_into_vehicle_id IS NULL AND v.deleted_at IS NULL AND v.derived_status IS NULL
    AND ((SELECT is_own FROM viewer) OR v.is_public = true)
  -- display order: relationship group (owner, documenting, previously_owned, consigned, contributor, profile_record),
  -- then most recent GENUINE activity first (was: upload created_at of filed photos only)
  ORDER BY CASE d.pr WHEN 1 THEN 1 WHEN 4 THEN 2 WHEN 2 THEN 3 WHEN 3 THEN 4 WHEN 5 THEN 5 ELSE 6 END,
           va.last_activity_at DESC NULLS LAST, v.year;
$function$;

CREATE OR REPLACE FUNCTION public.search_vehicles_fulltext(query_text text, limit_count integer DEFAULT 20, p_auto_only boolean DEFAULT true)
 RETURNS TABLE(id uuid, year integer, make text, model text, color text, description text, created_at timestamp with time zone, relevance real)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT v.id, v.year, v.make, v.model, v.color, v.description, v.created_at,
    ts_rank_cd(v.search_vector, to_tsquery('english', query_text)) AS relevance
  FROM public.vehicles v
  WHERE v.is_public = true AND v.derived_status IS NULL
    AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
    AND v.search_vector @@ to_tsquery('english', query_text)
    AND (NOT p_auto_only OR is_auto_vehicle(v.canonical_vehicle_type, v.make))
  ORDER BY relevance DESC, v.created_at DESC
  LIMIT limit_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_vehicles_fts(query_text text, limit_count integer DEFAULT 20, p_auto_only boolean DEFAULT true, offset_count integer DEFAULT 0)
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
      SELECT v.id, v.year, v.make, v.model, v.vin, v.status, (CASE WHEN public.vehicle_sale_price_untrusted(v.id, v.sale_price::numeric) THEN NULL WHEN coalesce(v.sale_price_currency, 'USD') = 'USD' THEN v.sale_price ELSE round(v.sale_price_usd)::integer END)::integer AS sale_price, v.current_value,
        0.98::real AS relevance
      FROM public.vehicles v
      WHERE v.is_public = true AND v.derived_status IS NULL
        AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
        AND v.year = year_val
        AND v.make IS NOT NULL AND v.model IS NOT NULL
        AND (lower(v.make) || ' ' || lower(v.model)) ILIKE '%' || lower(rest_text) || '%'
        AND (NOT p_auto_only OR is_auto_vehicle(v.canonical_vehicle_type, v.make))
      ORDER BY (v.primary_image_url IS NOT NULL) DESC,
               COALESCE(v.image_count, 0) DESC,
               COALESCE(v.bat_view_count, v.view_count, 0) DESC,
               (CASE WHEN coalesce(v.sale_price_currency, 'USD') = 'USD' THEN v.sale_price::numeric ELSE v.sale_price_usd END) DESC NULLS LAST,
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
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, (CASE WHEN public.vehicle_sale_price_untrusted(v.id, v.sale_price::numeric) THEN NULL WHEN coalesce(v.sale_price_currency, 'USD') = 'USD' THEN v.sale_price ELSE round(v.sale_price_usd)::integer END)::integer AS sale_price, v.current_value,
      0.95::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true AND v.derived_status IS NULL
      AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
      AND v.make = initcap(parsed_make)
      AND (NOT p_auto_only OR is_auto_vehicle(v.canonical_vehicle_type, v.make))
    ORDER BY (v.primary_image_url IS NOT NULL) DESC,
             COALESCE(v.image_count, 0) DESC,
             COALESCE(v.bat_view_count, v.view_count, 0) DESC,
             (CASE WHEN coalesce(v.sale_price_currency, 'USD') = 'USD' THEN v.sale_price::numeric ELSE v.sale_price_usd END) DESC NULLS LAST,
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
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, (CASE WHEN public.vehicle_sale_price_untrusted(v.id, v.sale_price::numeric) THEN NULL WHEN coalesce(v.sale_price_currency, 'USD') = 'USD' THEN v.sale_price ELSE round(v.sale_price_usd)::integer END)::integer AS sale_price, v.current_value,
      0.9::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true AND v.derived_status IS NULL
      AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
      AND (lower(v.make) || ' ' || lower(v.model)) ILIKE '%' || lower(parsed_make) || '%'
      AND v.make != initcap(parsed_make)
      AND (NOT p_auto_only OR is_auto_vehicle(v.canonical_vehicle_type, v.make))
    ORDER BY (v.primary_image_url IS NOT NULL) DESC,
             COALESCE(v.image_count, 0) DESC,
             COALESCE(v.bat_view_count, v.view_count, 0) DESC,
             (CASE WHEN coalesce(v.sale_price_currency, 'USD') = 'USD' THEN v.sale_price::numeric ELSE v.sale_price_usd END) DESC NULLS LAST,
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
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, (CASE WHEN public.vehicle_sale_price_untrusted(v.id, v.sale_price::numeric) THEN NULL WHEN coalesce(v.sale_price_currency, 'USD') = 'USD' THEN v.sale_price ELSE round(v.sale_price_usd)::integer END)::integer AS sale_price, v.current_value,
      0.9::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true AND v.derived_status IS NULL
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
             (CASE WHEN coalesce(v.sale_price_currency, 'USD') = 'USD' THEN v.sale_price::numeric ELSE v.sale_price_usd END) DESC NULLS LAST,
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
$function$;

CREATE OR REPLACE FUNCTION public.search_vehicles_smart(p_query text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, year integer, make text, model text, vin text, status text, source text, sold_price integer, primary_image_url text, relevance double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_query TEXT;
  v_make TEXT;
  v_model TEXT;
  v_tokens TEXT[];
  v_total_found INT := 0;
  v_batch_count INT := 0;
  v_tsquery tsquery;
BEGIN
  v_query := trim(p_query);
  IF v_query IS NULL OR v_query = '' THEN RETURN; END IF;

  v_tokens := string_to_array(v_query, ' ');

  -- Strategy 1: Exact make match
  RETURN QUERY
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
           v.sold_price, v.primary_image_url, 0.95::FLOAT AS relevance
    FROM vehicles v
    WHERE v.is_public = true AND v.derived_status IS NULL AND lower(v.make) = lower(v_query)
      AND (v.canonical_vehicle_type IS NULL OR v.canonical_vehicle_type IN ('CAR','TRUCK','SUV','VAN','MINIVAN'))
    ORDER BY v.sold_price DESC NULLS LAST, v.year DESC
    LIMIT p_limit OFFSET p_offset;
  GET DIAGNOSTICS v_batch_count = ROW_COUNT;
  v_total_found := v_total_found + v_batch_count;
  IF v_total_found >= p_limit THEN RETURN; END IF;

  -- Strategy 2: Make+model split
  IF array_length(v_tokens, 1) >= 2 THEN
    v_make := v_tokens[1];
    v_model := array_to_string(v_tokens[2:], ' ');
    RETURN QUERY
      SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
             v.sold_price, v.primary_image_url, 0.90::FLOAT AS relevance
      FROM vehicles v
      WHERE v.is_public = true AND v.derived_status IS NULL
        AND lower(v.make) = lower(v_make)
        AND lower(v.model) LIKE '%' || lower(v_model) || '%'
        AND (v.canonical_vehicle_type IS NULL OR v.canonical_vehicle_type IN ('CAR','TRUCK','SUV','VAN','MINIVAN'))
      ORDER BY v.sold_price DESC NULLS LAST, v.year DESC
      LIMIT p_limit - v_total_found
      OFFSET GREATEST(0, p_offset - v_total_found);
    GET DIAGNOSTICS v_batch_count = ROW_COUNT;
    v_total_found := v_total_found + v_batch_count;
    IF v_total_found >= p_limit THEN RETURN; END IF;
  END IF;

  -- Strategy 3: FTS via search_vector
  BEGIN
    v_tsquery := plainto_tsquery('english', v_query);
    IF v_tsquery IS NOT NULL AND v_tsquery::TEXT <> '' THEN
      RETURN QUERY
        SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
               v.sold_price, v.primary_image_url,
               ts_rank(v.search_vector, v_tsquery)::FLOAT AS relevance
        FROM vehicles v
        WHERE v.is_public = true AND v.derived_status IS NULL AND v.search_vector @@ v_tsquery
          AND (v.canonical_vehicle_type IS NULL OR v.canonical_vehicle_type IN ('CAR','TRUCK','SUV','VAN','MINIVAN'))
        ORDER BY relevance DESC, v.year DESC
        LIMIT p_limit - v_total_found
        OFFSET GREATEST(0, p_offset - v_total_found);
      GET DIAGNOSTICS v_batch_count = ROW_COUNT;
      v_total_found := v_total_found + v_batch_count;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Strategy 4: Trigram fallback (only if <5 results)
  IF v_total_found < 5 THEN
    RETURN QUERY
      SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
             v.sold_price, v.primary_image_url,
             (0.7 * similarity(lower(v.make) || ' ' || lower(v.model), lower(v_query)))::FLOAT AS relevance
      FROM vehicles v
      WHERE v.is_public = true AND v.derived_status IS NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
        AND similarity(lower(v.make) || ' ' || lower(v.model), lower(v_query)) > 0.3
        AND (v.canonical_vehicle_type IS NULL OR v.canonical_vehicle_type IN ('CAR','TRUCK','SUV','VAN','MINIVAN'))
      ORDER BY relevance DESC, v.year DESC
      LIMIT p_limit - v_total_found
      OFFSET GREATEST(0, p_offset - v_total_found);
  END IF;
END;
$function$;

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
      AND v.is_public = true AND v.derived_status IS NULL
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

CREATE OR REPLACE FUNCTION public.search_vehicles_fuzzy(p_query text, p_limit integer DEFAULT 10)
 RETURNS TABLE(vehicle_id uuid, year smallint, make text, model text, vin text, primary_image_url text, sale_price bigint, relevance real, match_source text, snippet text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_q text := lower(trim(p_query));
BEGIN
  IF trim(p_query) = '' THEN RETURN; END IF;

  -- Every public vehicle of one make and model scores the same, so rank the distinct names, keep the best p_limit,
  -- then read their current public vehicles through idx_vehicles_lower_make_model. The old body ranked every vehicle.
  RETURN QUERY
  WITH names AS (
    SELECT d.make_l, d.model_l, similarity(d.name_l, v_q) AS sim
    FROM public.mv_vehicle_name_dictionary d
    WHERE similarity(d.name_l, v_q) > 0.25
    ORDER BY sim DESC
    LIMIT p_limit
  )
  SELECT h.id, h.year::smallint, h.make, h.model, h.vin, h.primary_image_url, h.sale_price::bigint,
         (h.sim * 0.8)::real, 'fuzzy'::text, ''::text
  FROM (
    SELECT x.id, x.year, x.make, x.model, x.vin, x.primary_image_url, x.sale_price, n.sim
    FROM names n
    CROSS JOIN LATERAL (
      SELECT v.id, v.year, v.make, v.model, v.vin, v.primary_image_url, v.sale_price
      FROM public.vehicles v
      WHERE lower(v.make) = n.make_l AND lower(v.model) = n.model_l AND v.is_public = true AND v.derived_status IS NULL
      LIMIT p_limit
    ) x
    WHERE n.model_l <> ''
    UNION ALL
    SELECT x.id, x.year, x.make, x.model, x.vin, x.primary_image_url, x.sale_price, n.sim
    FROM names n
    CROSS JOIN LATERAL (
      SELECT v.id, v.year, v.make, v.model, v.vin, v.primary_image_url, v.sale_price
      FROM public.vehicles v
      WHERE lower(v.make) = n.make_l AND (lower(v.model) IS NULL OR lower(v.model) = '') AND v.is_public = true AND v.derived_status IS NULL
      LIMIT p_limit
    ) x
    WHERE n.model_l = ''
  ) h
  ORDER BY h.sim DESC
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_vehicles_browse(p_make text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_status text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_era text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_has_image boolean DEFAULT NULL::boolean, p_has_price boolean DEFAULT NULL::boolean, p_color text DEFAULT NULL::text, p_sort_by text DEFAULT 'year'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_include_total boolean DEFAULT true)
 RETURNS TABLE(id uuid, year integer, make text, model text, vin text, status text, source text, sold_price integer, primary_image_url text, era text, body_style text, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sql TEXT;
  -- Public, not deleted, a vehicle (not a non-vehicle item), of a road vehicle type or an unclassified one.
  v_where TEXT := 'WHERE v.is_public = true AND v.derived_status IS NULL AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item'' AND (v.canonical_vehicle_type IS NULL OR v.canonical_vehicle_type IN (''CAR'',''TRUCK'',''SUV'',''VAN'',''MINIVAN''))';
  -- The row's price: its sale basis (2026-10-20) when the ledger says it sold for an amount, else the legacy column.
  v_price TEXT := '(CASE WHEN v.sale_status = ''sold'' AND v.sale_price > 0 THEN v.sale_price ELSE v.sold_price END)';
  v_sort_col TEXT;
  v_sort_direction TEXT;
  v_offset INT;
  v_nulls TEXT := ' NULLS LAST';
  v_total TEXT := CASE WHEN COALESCE(p_include_total, true) THEN 'COUNT(*) OVER()' ELSE 'NULL::bigint' END;
BEGIN
  v_sort_col := CASE p_sort_by
    WHEN 'year' THEN 'v.year'
    WHEN 'make' THEN 'v.make'
    WHEN 'sold_price' THEN v_price
    WHEN 'created_at' THEN 'v.created_at'
    WHEN 'newest' THEN 'v.created_at'
    WHEN 'status' THEN 'v.status'
    ELSE 'v.year'
  END;

  v_sort_direction := CASE WHEN lower(p_sort_dir) = 'asc' THEN 'ASC' ELSE 'DESC' END;

  -- created_at is never NULL (default now(); 0 NULL rows of 1,014,416 on 2026-10-14). Stating it lets the order use
  -- idx_vehicles_created_at in either direction, so a page walks the index; DESC NULLS LAST matched no index, and
  -- every call sorted all public vehicles (17 s cold for the newest 60 with an image).
  IF v_sort_col = 'v.created_at' THEN
    v_where := v_where || ' AND v.created_at IS NOT NULL';
    v_nulls := '';
  END IF;
  v_offset := (COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 50);

  IF p_make IS NOT NULL THEN
    v_where := v_where || ' AND lower(v.make) = lower(' || quote_literal(p_make) || ')';
  END IF;
  IF p_model IS NOT NULL THEN
    v_where := v_where || ' AND lower(v.model) = lower(' || quote_literal(p_model) || ')';
  END IF;
  IF p_year_min IS NOT NULL THEN
    v_where := v_where || ' AND v.year >= ' || p_year_min::TEXT;
  END IF;
  IF p_year_max IS NOT NULL THEN
    v_where := v_where || ' AND v.year <= ' || p_year_max::TEXT;
  END IF;
  IF p_price_min IS NOT NULL THEN
    v_where := v_where || ' AND ' || v_price || ' >= ' || p_price_min::TEXT;
  END IF;
  IF p_price_max IS NOT NULL THEN
    v_where := v_where || ' AND ' || v_price || ' <= ' || p_price_max::TEXT;
  END IF;
  IF p_status IS NOT NULL THEN
    v_where := v_where || ' AND v.status = ' || quote_literal(p_status);
  END IF;
  IF p_source IS NOT NULL THEN
    v_where := v_where || ' AND v.source = ' || quote_literal(p_source);
  END IF;
  IF p_era IS NOT NULL THEN
    v_where := v_where || ' AND v.era = ' || quote_literal(p_era);
  END IF;
  IF p_body_style IS NOT NULL THEN
    v_where := v_where || ' AND lower(v.body_style) = lower(' || quote_literal(p_body_style) || ')';
  END IF;
  IF p_has_image = true THEN
    v_where := v_where || ' AND v.primary_image_url IS NOT NULL';
  END IF;
  IF p_has_price = true THEN
    v_where := v_where || ' AND ' || v_price || ' > 0';
  END IF;
  IF p_color IS NOT NULL THEN
    v_where := v_where || ' AND lower(v.exterior_color) = lower(' || quote_literal(p_color) || ')';
  END IF;

  v_sql := format(
    'SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
            %s::integer AS sold_price, v.primary_image_url, v.era, v.body_style,
            %s AS total_count
     FROM vehicles v
     %s
     ORDER BY %s %s%s
     OFFSET %s LIMIT %s',
    v_price, v_total, v_where, v_sort_col, v_sort_direction, v_nulls, v_offset, COALESCE(p_page_size, 50)
  );

  RETURN QUERY EXECUTE v_sql;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_vehicles_by_partial_vin(partial_vin text, row_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, year integer, make text, model text, "trim" text, series text, vin text, mileage integer, color text, interior_color text, transmission text, engine_type text, drivetrain text, body_style text, sale_price numeric, is_public boolean, created_at timestamp with time zone, updated_at timestamp with time zone, primary_image_url text, discovery_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    v.id, v.year, v.make, v.model, v.trim, v.series, v.vin, v.mileage,
    v.color, v.interior_color, v.transmission, v.engine_type,
    v.drivetrain, v.body_style, v.sale_price, v.is_public,
    v.created_at, v.updated_at, v.primary_image_url, v.discovery_url
  FROM vehicles v
  WHERE lower(v.vin) LIKE lower('%' || partial_vin || '%')
    AND v.is_public = true AND v.derived_status IS NULL
  LIMIT row_limit;
$function$;
