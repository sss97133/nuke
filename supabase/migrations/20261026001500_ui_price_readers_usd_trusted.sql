-- NEEDS SKYLAR'S OK before applying: user-facing price surface (search results / feed sale_price).
-- Rule: hide sale_price when vehicle_sale_price_untrusted(); non-USD sale_price shown as sale_price_usd.
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
      WHERE v.is_public = true
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
    WHERE v.is_public = true
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
    WHERE v.is_public = true
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

SET LOCAL statement_timeout = '600s';
DROP MATERIALIZED VIEW IF EXISTS public.vehicle_valuation_feed;
CREATE MATERIALIZED VIEW public.vehicle_valuation_feed AS
 SELECT v.id AS vehicle_id,
    v.year,
    COALESCE(cm.canonical_name, v.make) AS make,
    v.model,
    v.series,
    v."trim",
    v.transmission,
    v.drivetrain,
    v.body_style,
    v.canonical_body_style,
    v.mileage,
    v.vin,
    v.is_for_sale,
    v.sale_status,
    v.sale_date,
    v.created_at,
    v.updated_at,
    ae.auction_end_at,
    COALESCE((v.sale_date)::timestamp with time zone, ae.auction_end_at, v.created_at) AS event_at,
    v.discovery_url,
    COALESCE(v.platform_source, v.discovery_source) AS discovery_source,
    v.profile_origin,
    v.origin_organization_id,
    v.city,
    v.state,
    v.listing_location,
    v.canonical_vehicle_type,
    v.has_photos,
    v.primary_image_url,
    NULL::text AS thumbnail_url,
    NULL::text AS medium_url,
    v.primary_image_url AS full_image_url,
    NULL::text AS description_snippet,
    (COALESCE(v.observation_count, 0))::bigint AS observation_count,
    NULL::bigint AS source_count,
    NULL::bigint AS photo_count,
    cvp.best_price AS display_price,
    cvp.price_source,
    cvp.is_sold,
    v.asking_price,
    (CASE WHEN uu.vehicle_id IS NOT NULL THEN NULL::numeric WHEN COALESCE(v.sale_price_currency, 'USD'::text) = 'USD'::text THEN (v.sale_price)::numeric ELSE round(v.sale_price_usd) END)::integer AS sale_price,
    v.current_value,
    ne.estimated_value AS nuke_estimate,
    ne.value_low AS nuke_estimate_low,
    ne.value_high AS nuke_estimate_high,
    ne.confidence_score AS nuke_estimate_confidence,
    ne.price_tier,
    ne.deal_score,
    ne.deal_score_label,
    ne.heat_score,
    ne.heat_score_label,
    ne.model_version,
    ne.calculated_at AS valuation_calculated_at,
        CASE
            WHEN (rp.record_vehicle_id = v.id) THEN true
            ELSE false
        END AS is_record_price,
    rp.record_price AS segment_record_price,
    (((((COALESCE(ne.deal_score, (50)::numeric) *
        CASE
            WHEN (COALESCE((v.sale_date)::timestamp with time zone, ae.auction_end_at, v.created_at) > (now() - '1 day'::interval)) THEN 1.0
            WHEN (COALESCE((v.sale_date)::timestamp with time zone, ae.auction_end_at, v.created_at) > (now() - '3 days'::interval)) THEN 0.95
            WHEN (COALESCE((v.sale_date)::timestamp with time zone, ae.auction_end_at, v.created_at) > (now() - '7 days'::interval)) THEN 0.85
            WHEN (COALESCE((v.sale_date)::timestamp with time zone, ae.auction_end_at, v.created_at) > (now() - '30 days'::interval)) THEN 0.50
            ELSE 0.30
        END) + (COALESCE(ne.heat_score, (0)::numeric) * 0.3)) + (
        CASE
            WHEN (v.sale_status = 'auction_live'::text) THEN 200
            WHEN (v.is_for_sale = true) THEN 80
            ELSE 0
        END)::numeric) + (
        CASE
            WHEN (COALESCE(v.platform_source, v.discovery_source) = ANY (ARRAY['bringatrailer'::text, 'bat'::text])) THEN 100
            WHEN (COALESCE(v.platform_source, v.discovery_source) = ANY (ARRAY['cars-and-bids'::text, 'cars_and_bids'::text, 'collecting-cars'::text, 'collecting_cars'::text, 'mecum'::text, 'barrett-jackson'::text, 'barrett_jackson'::text, 'rmsothebys'::text, 'gooding'::text, 'bonhams'::text])) THEN 80
            WHEN (COALESCE(v.platform_source, v.discovery_source) = ANY (ARRAY['pcarmarket'::text, 'hagerty'::text, 'hemmings'::text])) THEN 60
            WHEN (COALESCE(v.platform_source, v.discovery_source) = ANY (ARRAY['facebook_marketplace'::text, 'facebook'::text])) THEN '-30'::integer
            ELSE 20
        END)::numeric) + (
        CASE
            WHEN v.has_photos THEN 20
            ELSE 0
        END)::numeric) AS feed_rank_score
   FROM (((((vehicles v
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN (v.auction_end_date IS NULL) THEN NULL::timestamp with time zone
                    ELSE safe_to_timestamptz(v.auction_end_date)
                END AS auction_end_at) ae)
     LEFT JOIN canonical_makes cm ON ((v.canonical_make_id = cm.id)))
     LEFT JOIN vehicle_sale_price_untrusted_ids uu ON ((uu.vehicle_id = v.id))
     LEFT JOIN clean_vehicle_prices cvp ON ((cvp.vehicle_id = v.id)))
     LEFT JOIN nuke_estimates ne ON ((ne.vehicle_id = v.id)))
     LEFT JOIN record_prices rp ON (((COALESCE(cm.canonical_name, v.make) = rp.make) AND (v.model = rp.model) AND (v.year >= rp.year_start) AND (v.year <= rp.year_end))))
  WHERE ((v.deleted_at IS NULL) AND (v.status <> ALL (ARRAY['deleted'::text, 'merged'::text, 'duplicate'::text])) AND ((ne.is_stale IS NOT TRUE) OR (ne.id IS NULL)) AND (v.year IS NOT NULL) AND (v.make IS NOT NULL) AND (NOT (upper(COALESCE(cm.canonical_name, v.make)) IN ( SELECT upper(non_auto_makes_excluded.make) AS upper
           FROM non_auto_makes_excluded))))
WITH DATA;
CREATE UNIQUE INDEX idx_vvf_vehicle_id ON public.vehicle_valuation_feed USING btree (vehicle_id);
CREATE INDEX idx_vvf_created ON public.vehicle_valuation_feed USING btree (created_at DESC);
CREATE INDEX idx_vvf_display_price ON public.vehicle_valuation_feed USING btree (display_price);
CREATE INDEX idx_vvf_feed_rank ON public.vehicle_valuation_feed USING btree (feed_rank_score DESC);
CREATE INDEX idx_vvf_feed_rank_vid ON public.vehicle_valuation_feed USING btree (feed_rank_score DESC, vehicle_id);
CREATE INDEX idx_vvf_has_photos ON public.vehicle_valuation_feed USING btree (has_photos);
CREATE INDEX idx_vvf_make ON public.vehicle_valuation_feed USING btree (make);
CREATE INDEX idx_vvf_source ON public.vehicle_valuation_feed USING btree (discovery_source);
CREATE INDEX idx_vvf_updated ON public.vehicle_valuation_feed USING btree (updated_at DESC);
CREATE INDEX idx_vvf_vehicle_type ON public.vehicle_valuation_feed USING btree (canonical_vehicle_type);
CREATE INDEX idx_vvf_year ON public.vehicle_valuation_feed USING btree (year);
CREATE INDEX idx_vvf_event_at ON public.vehicle_valuation_feed USING btree (event_at DESC, vehicle_id);
GRANT ALL ON public.vehicle_valuation_feed TO anon, authenticated, service_role;
