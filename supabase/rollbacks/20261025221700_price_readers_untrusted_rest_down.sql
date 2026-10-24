-- Rollback for 20261025221700_price_readers_untrusted_rest: restore previous definitions.
CREATE OR REPLACE FUNCTION public.vehicle_price_signal(vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, primary_label text, primary_value numeric, anchor_label text, anchor_value numeric, delta_amount numeric, delta_pct numeric, confidence integer, sources text[], missing_fields text[], updated_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH caller AS (
  SELECT auth.uid() AS uid
),
v AS (
  -- The owner's purchase price reaches the owner only (owner rule 2026-09-28): the owner, user, creator,
  -- uploader or a contributor with access. For everyone else it is absent from the signal (no PAID label,
  -- no PURCHASE anchor, no delta or confidence from it, not listed as missing), and a private vehicle
  -- returns no row.
  SELECT
    vh.id AS vehicle_id,
    NULLIF(vh.msrp, 0) AS msrp,
    NULLIF(vh.current_value, 0) AS current_value,
    CASE WHEN ins.insider THEN NULLIF(vh.purchase_price, 0) END AS purchase_price,
    NOT ins.insider AS purchase_masked,
    NULLIF(vh.asking_price, 0) AS asking_price,
    NULLIF(vh.sale_price, 0) AS sale_price,
    vh.is_for_sale,
    vh.updated_at
  FROM vehicles vh
  CROSS JOIN caller c
  CROSS JOIN LATERAL (
    SELECT CASE WHEN c.uid IS NULL THEN false
                ELSE coalesce(c.uid IN (vh.owner_id, vh.user_id, vh.created_by_user_id, vh.uploaded_by), false)
                     OR public.vehicle_user_has_access(vh.id, c.uid) END AS insider
  ) ins
  WHERE vh.id = ANY(vehicle_ids)
    AND (coalesce(vh.is_public, false) OR ins.insider)
),
sale AS (
  SELECT DISTINCT ON (vehicle_id)
    vehicle_id,
    COALESCE(
      NULLIF(NULLIF((metadata->'what'->>'sold_price')::numeric, 0), NULL),
      NULLIF(NULLIF((metadata->'what'->>'sale_price')::numeric, 0), NULL)
    ) AS sold_price,
    event_date::timestamptz AS sold_date
  FROM vehicle_timeline_events
  WHERE vehicle_id = ANY(vehicle_ids)
    AND (event_type IN ('ownership_transfer','auction_sale','sold') OR title ILIKE 'Sold%')
    AND ((metadata->'what' ? 'sold_price') OR (metadata->'what' ? 'sale_price'))
  ORDER BY vehicle_id, event_date DESC
),
live AS (
  SELECT DISTINCT ON (vehicle_id)
    vehicle_id,
    platform,
    listing_url,
    current_bid,
    end_date,
    COALESCE(updated_at, created_at) AS ts
  FROM external_listings
  WHERE vehicle_id = ANY(vehicle_ids)
    AND listing_status = 'active'
    AND current_bid IS NOT NULL
    AND current_bid > 0
    AND (end_date IS NULL OR end_date > NOW())
  ORDER BY
    vehicle_id,
    COALESCE(end_date, 'infinity'::timestamptz) ASC,
    COALESCE(updated_at, created_at) DESC
),
base AS (
  SELECT
    v.vehicle_id,
    v.msrp,
    v.current_value,
    v.purchase_price,
    v.asking_price,
    COALESCE(v.sale_price, sale.sold_price) AS sale_price,
    v.is_for_sale,
    sale.sold_date,
    live.current_bid AS live_bid,
    live.platform AS live_platform,
    live.listing_url AS live_listing_url,
    (v.sale_price IS NOT NULL) AS vehicle_sale_exists,
    (sale.sold_price IS NOT NULL) AS event_sale_exists,
    (live.current_bid IS NOT NULL) AS live_bid_exists,
    v.purchase_masked,
    v.updated_at
  FROM v
  LEFT JOIN sale ON sale.vehicle_id = v.vehicle_id
  LEFT JOIN live ON live.vehicle_id = v.vehicle_id
),
picked AS (
  SELECT
    b.*,
    CASE
      WHEN b.sale_price IS NOT NULL THEN 'SOLD'
      WHEN b.live_bid IS NOT NULL THEN 'BID'
      WHEN b.is_for_sale IS TRUE AND b.asking_price IS NOT NULL THEN 'ASK'
      WHEN b.current_value IS NOT NULL THEN 'EST'
      WHEN b.purchase_price IS NOT NULL THEN 'PAID'
      WHEN b.msrp IS NOT NULL THEN 'MSRP'
      ELSE NULL
    END AS primary_label,
    CASE
      WHEN b.sale_price IS NOT NULL THEN b.sale_price
      WHEN b.live_bid IS NOT NULL THEN b.live_bid
      WHEN b.is_for_sale IS TRUE AND b.asking_price IS NOT NULL THEN b.asking_price
      WHEN b.current_value IS NOT NULL THEN b.current_value
      WHEN b.purchase_price IS NOT NULL THEN b.purchase_price
      WHEN b.msrp IS NOT NULL THEN b.msrp
      ELSE NULL
    END AS primary_value,
    CASE
      WHEN b.purchase_price IS NOT NULL THEN 'PURCHASE'
      WHEN b.msrp IS NOT NULL THEN 'MSRP'
      ELSE NULL
    END AS anchor_label,
    CASE
      WHEN b.purchase_price IS NOT NULL THEN b.purchase_price
      WHEN b.msrp IS NOT NULL THEN b.msrp
      ELSE NULL
    END AS anchor_value
  FROM base b
)
SELECT
  p.vehicle_id,
  p.primary_label,
  p.primary_value,
  p.anchor_label,
  p.anchor_value,
  CASE WHEN p.primary_value IS NOT NULL AND p.anchor_value IS NOT NULL THEN p.primary_value - p.anchor_value END AS delta_amount,
  CASE WHEN p.primary_value IS NOT NULL AND p.anchor_value IS NOT NULL AND p.anchor_value <> 0 THEN ((p.primary_value - p.anchor_value)/p.anchor_value)*100 END AS delta_pct,
  GREATEST(
    0,
    (CASE
      WHEN p.primary_label = 'SOLD' THEN 40
      WHEN p.primary_label = 'BID' THEN 30
      WHEN p.primary_label IN ('ASK','EST') THEN 25
      ELSE 0
    END)
    + (CASE WHEN p.purchase_price IS NOT NULL THEN 10 ELSE 0 END)
    + (CASE WHEN p.msrp IS NOT NULL THEN 5 ELSE 0 END)
    + (CASE WHEN p.sold_date IS NOT NULL AND p.sold_date > NOW() - INTERVAL '365 days' THEN 10 ELSE 0 END)
  ) AS confidence,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN p.vehicle_sale_exists THEN 'vehicles.sale_price'::text END,
    CASE WHEN p.event_sale_exists THEN 'vehicle_timeline_events.sale'::text END,
    CASE WHEN p.live_bid_exists THEN 'external_listings.current_bid'::text END,
    CASE WHEN p.is_for_sale IS TRUE AND p.asking_price IS NOT NULL THEN 'vehicles.asking_price'::text END,
    CASE WHEN p.current_value IS NOT NULL THEN 'vehicles.current_value'::text END,
    CASE WHEN p.purchase_price IS NOT NULL THEN 'vehicles.purchase_price'::text END,
    CASE WHEN p.msrp IS NOT NULL THEN 'vehicles.msrp'::text END
  ], NULL) AS sources,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN p.purchase_price IS NULL AND NOT p.purchase_masked THEN 'purchase_price'::text END,
    CASE WHEN p.msrp IS NULL THEN 'msrp'::text END,
    CASE WHEN p.live_bid IS NULL THEN 'live_bid'::text END,
    CASE WHEN p.is_for_sale IS TRUE AND p.asking_price IS NULL THEN 'asking_price'::text END,
    CASE WHEN p.current_value IS NULL THEN 'current_value'::text END
  ], NULL) AS missing_fields,
  COALESCE(p.updated_at, NOW()) AS updated_at
FROM picked p;
$function$
;
CREATE OR REPLACE FUNCTION public.vehicle_price_facts(p_vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, price_kind text, price_amount numeric, price_as_of timestamp with time zone, price_live boolean, sold_amount numeric, sold_on date, sold_basis text, sold_amount_from text, ask_amount numeric, ask_as_of timestamp with time zone, bid_amount numeric, bid_on date, bid_from text, estimate_amount numeric, estimate_confidence integer, estimate_as_of timestamp with time zone, outcome text, platform text, source_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Keep the canonical sale basis once per selected vehicle. The SQL helper
  -- returns all twenty fields, so folding this stage repeats its source rule.
  WITH v AS MATERIALIZED (
    SELECT v.id, v.sale_status, v.auction_outcome, v.reserve_status, v.sale_price, v.bat_sold_price, v.sold_price, v.winning_bid, v.high_bid,
           v.asking_price, v.sale_date, v.bat_sale_date, v.listing_updated_at, v.listing_posted_at,
           v.nuke_estimate, v.nuke_estimate_confidence, v.valuation_calculated_at,
           v.canonical_outcome, v.canonical_platform,
           COALESCE(v.listing_url, v.bat_auction_url, v.platform_url) AS source_url,
           vehicle_sale_basis(v.sale_status, v.auction_outcome, v.canonical_platform, v.listing_url,
                              v.discovery_url, v.sale_price::numeric, v.notes, v.import_metadata,
                              v.created_at) AS basis,
           v.auction_end_date
    FROM vehicles v
    WHERE v.id = ANY (p_vehicle_ids)
      AND v.deleted_at IS NULL
  ),
  dated AS (
    -- Leave date parsing inline: an unused malformed legacy date must retain
    -- the old lazy CASE behavior rather than becoming a new reader exception.
    SELECT v.*, CASE WHEN v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}'
      THEN left(v.auction_end_date, 10)::date END AS auction_end_on
    FROM v
  ),
  f AS (
    SELECT v.*,
      CASE WHEN v.basis IS NOT NULL THEN COALESCE(NULLIF(v.sale_price, 0)::numeric, NULLIF(v.winning_bid, 0)::numeric,
                                                  NULLIF(v.bat_sold_price, 0)::numeric, NULLIF(v.sold_price, 0)::numeric)
      END AS f_sold_amount,
      CASE WHEN v.basis IS NOT NULL THEN
        CASE WHEN v.sale_price > 0 THEN 'sale_price' WHEN v.winning_bid > 0 THEN 'winning_bid'
             WHEN v.bat_sold_price > 0 THEN 'bat_sold_price' WHEN v.sold_price > 0 THEN 'sold_price' END
      END AS f_sold_from,
      CASE WHEN v.basis IS NOT NULL THEN COALESCE(v.sale_date, v.bat_sale_date, v.auction_end_on) END AS f_sold_on,
      NULLIF(v.asking_price, 0) AS f_ask,
      COALESCE(NULLIF(v.high_bid, 0), NULLIF(v.winning_bid, 0))::numeric AS f_bid,
      CASE WHEN v.high_bid > 0 THEN 'high_bid' WHEN v.winning_bid > 0 THEN 'winning_bid' END AS f_bid_from,
      NULLIF(v.nuke_estimate, 0) AS f_estimate,
      COALESCE(v.sale_status = 'auction_live', false) AS f_live,
      COALESCE(v.sale_status, '') NOT IN ('sold', 'ended', 'not_sold', 'unsold', 'bid_to', 'auction_live', 'upcoming')
        AS f_ask_active
    FROM dated v
  )
  SELECT
    f.id,
    CASE WHEN f.basis IS NOT NULL                     THEN 'sold'
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN 'bid'
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN 'ask'
         WHEN f.f_bid IS NOT NULL                     THEN 'bid'
         WHEN f.f_estimate IS NOT NULL                THEN 'estimate'
    END,
    CASE WHEN f.basis IS NOT NULL                     THEN f.f_sold_amount
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN f.f_bid
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN f.f_ask
         WHEN f.f_bid IS NOT NULL                     THEN f.f_bid
         ELSE f.f_estimate
    END,
    CASE WHEN f.basis IS NOT NULL                     THEN f.f_sold_on::timestamptz
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN NULL
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN COALESCE(f.listing_updated_at, f.listing_posted_at)
         WHEN f.f_bid IS NOT NULL                     THEN f.auction_end_on::timestamptz
         ELSE f.valuation_calculated_at
    END,
    f.f_live,
    f.f_sold_amount, f.f_sold_on, f.basis, f.f_sold_from,
    f.f_ask, CASE WHEN f.f_ask IS NOT NULL THEN COALESCE(f.listing_updated_at, f.listing_posted_at) END,
    f.f_bid, CASE WHEN f.f_bid IS NOT NULL THEN f.auction_end_on END, f.f_bid_from,
    f.f_estimate, CASE WHEN f.f_estimate IS NOT NULL THEN f.nuke_estimate_confidence END,
    CASE WHEN f.f_estimate IS NOT NULL THEN f.valuation_calculated_at END,
    CASE WHEN f.basis IS NOT NULL THEN 'sold'
         WHEN f.sale_status IN ('not_sold', 'unsold', 'bid_to') OR f.reserve_status = 'reserve_not_met'
              OR f.auction_outcome IN ('reserve_not_met', 'no_sale')                          THEN 'reserve_not_met'
         WHEN f.sale_status IN ('auction_live', 'upcoming')                                   THEN 'active'
         WHEN f.sale_status = 'for_sale'
              OR (COALESCE(f.asking_price, 0) > 0 AND COALESCE(f.sale_status, 'available') NOT IN ('ended'))
                                                                                              THEN 'for_sale'
         WHEN f.sale_status = 'ended'                                                         THEN 'ended'
         WHEN f.sale_status = 'available' AND (COALESCE(f.high_bid, 0) > 0 OR COALESCE(f.winning_bid, 0) > 0)
                                                                                              THEN 'ended'
         ELSE 'unknown'
    END,
    f.canonical_platform, f.source_url
  FROM f;
$function$
;
CREATE OR REPLACE FUNCTION public.get_vehicle_current_price(p_vehicle_id uuid)
 RETURNS TABLE(price numeric, price_source text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_vehicle RECORD;
  v_external_listing RECORD;
BEGIN
  -- Get vehicle
  SELECT * INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Priority 1: Sale price (if sold)
  IF v_vehicle.sale_price IS NOT NULL AND v_vehicle.sale_price > 0 THEN
    RETURN QUERY SELECT v_vehicle.sale_price, 'sale_price';
  END IF;
  
  -- Priority 2: Active auction bid
  SELECT * INTO v_external_listing
  FROM external_listings
  WHERE vehicle_id = p_vehicle_id
    AND listing_status IN ('active', 'live', 'pending')
    AND current_bid IS NOT NULL
    AND current_bid > 0
  ORDER BY updated_at DESC
  LIMIT 1;
  
  IF FOUND AND v_external_listing.current_bid IS NOT NULL THEN
    RETURN QUERY SELECT v_external_listing.current_bid, 'current_bid';
  END IF;
  
  -- Priority 3: Asking price
  IF v_vehicle.asking_price IS NOT NULL AND v_vehicle.asking_price > 0 THEN
    RETURN QUERY SELECT v_vehicle.asking_price, 'asking_price';
  END IF;
  
  -- Priority 4: Current value
  IF v_vehicle.current_value IS NOT NULL AND v_vehicle.current_value > 0 THEN
    RETURN QUERY SELECT v_vehicle.current_value, 'current_value';
  END IF;
  
  -- No price available
  RETURN;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.auction_intelligence(p_listing_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_listing_url text;
  v_vehicle_id uuid;
  v_listing jsonb;
  v_seller jsonb;
  v_bidders jsonb;
  v_comps jsonb;
  v_bid_timeline jsonb;
  v_comp_velocity jsonb;
  v_seller_username text;
  v_year int;
  v_make text;
  v_bidder_username text;
BEGIN
  v_listing_url := regexp_replace(p_listing_url, '[?#].*$', '');
  IF NOT v_listing_url LIKE '%/' THEN v_listing_url := v_listing_url || '/'; END IF;

  -- Resolve vehicle_id
  SELECT bl.vehicle_id INTO v_vehicle_id
  FROM bat_listings bl INNER JOIN vehicles v ON v.id = bl.vehicle_id
  WHERE bl.bat_listing_url IN (v_listing_url, rtrim(v_listing_url, '/')) LIMIT 1;
  IF v_vehicle_id IS NULL THEN
    SELECT ve.vehicle_id INTO v_vehicle_id
    FROM vehicle_events ve INNER JOIN vehicles v ON v.id = ve.vehicle_id
    WHERE ve.source_url IN (v_listing_url, rtrim(v_listing_url, '/')) AND ve.source_platform = 'bat' LIMIT 1;
  END IF;
  IF v_vehicle_id IS NULL THEN
    SELECT id INTO v_vehicle_id FROM vehicles
    WHERE bat_auction_url IN (v_listing_url, rtrim(v_listing_url, '/'))
       OR discovery_url IN (v_listing_url, rtrim(v_listing_url, '/')) LIMIT 1;
  END IF;
  IF v_vehicle_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Vehicle not found', 'url', p_listing_url);
  END IF;
  SELECT year, make INTO v_year, v_make FROM vehicles WHERE id = v_vehicle_id;

  -- Auto-refresh stale bidder profiles (>24h old or never computed)
  FOR v_bidder_username IN
    SELECT DISTINCT ac.author_username
    FROM auction_comments ac
    LEFT JOIN bat_user_profiles bp ON bp.username = ac.author_username
    WHERE ac.vehicle_id = v_vehicle_id AND ac.platform = 'bat' AND ac.bid_amount > 0
      AND (bp.updated_at IS NULL OR bp.updated_at < NOW() - interval '24 hours')
    LIMIT 30
  LOOP
    BEGIN
      PERFORM refresh_bat_user_profile(v_bidder_username);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- non-fatal, use stale data
    END;
  END LOOP;

  -- 1. Listing
  SELECT jsonb_build_object(
    'vehicle_id', v_vehicle_id, 'title', COALESCE(bl.bat_listing_title, v.year||' '||v.make||' '||v.model),
    'url', bl.bat_listing_url, 'current_bid', bl.final_bid, 'sale_price', bl.sale_price,
    'bid_count', bl.bid_count, 'comment_count', bl.comment_count, 'view_count', bl.view_count,
    'listing_status', bl.listing_status, 'auction_end', bl.auction_end_date,
    'sale_date', bl.sale_date, 'seller_username', bl.seller_username, 'buyer_username', bl.buyer_username
  ) INTO v_listing FROM bat_listings bl LEFT JOIN vehicles v ON v.id = bl.vehicle_id
  WHERE bl.vehicle_id = v_vehicle_id LIMIT 1;
  IF v_listing IS NULL THEN
    SELECT jsonb_build_object('vehicle_id', v_vehicle_id, 'title', v.year||' '||v.make||' '||v.model,
      'url', p_listing_url, 'listing_status', 'unknown')
    INTO v_listing FROM vehicles v WHERE v.id = v_vehicle_id;
  END IF;
  v_seller_username := v_listing->>'seller_username';

  -- 2. Seller
  IF v_seller_username IS NOT NULL AND v_seller_username != '' THEN
    SELECT jsonb_build_object(
      'username', v_seller_username, 'total_listings', count(*),
      'sold_count', count(*) FILTER (WHERE listing_status = 'sold'),
      'reserve_not_met_count', count(*) FILTER (WHERE listing_status IN ('ended','not_sold','reserve_not_met')),
      'avg_sale_price', round((avg(sale_price) FILTER (WHERE sale_price > 0))::numeric),
      'median_sale_price', percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price) FILTER (WHERE sale_price > 0),
      'avg_bid_count', round(avg(bid_count)::numeric),
      'avg_comment_count', round(avg(comment_count)::numeric)
    ) INTO v_seller FROM bat_listings WHERE seller_username = v_seller_username;
  ELSE
    SELECT author_username INTO v_seller_username FROM auction_comments
    WHERE vehicle_id = v_vehicle_id AND platform = 'bat' AND is_seller = true LIMIT 1;
    v_seller := jsonb_build_object('username', v_seller_username, 'note', 'from comments only');
  END IF;

  -- 3. Bidders (now always fresh from auto-refresh above)
  SELECT COALESCE(jsonb_agg(to_jsonb(sub) ORDER BY (sub.current_bid_on_this) DESC NULLS LAST), '[]'::jsonb)
  INTO v_bidders FROM (
    SELECT bp.username, bp.total_bids, bp.total_wins, bp.win_rate, bp.avg_bid_amount, bp.max_bid_amount,
      bp.bidding_strategy, bp.preferred_categories, bp.typical_price_range, bp.community_trust_score,
      bidder_ac.max_bid AS current_bid_on_this, bidder_ac.bid_count AS bid_count_on_this
    FROM (
      SELECT author_username, max(bid_amount) as max_bid, count(*) as bid_count
      FROM auction_comments WHERE vehicle_id = v_vehicle_id AND platform = 'bat' AND bid_amount > 0
      GROUP BY author_username
    ) bidder_ac LEFT JOIN bat_user_profiles bp ON bp.username = bidder_ac.author_username
  ) sub;

  -- 4. Comps
  SELECT COALESCE(jsonb_agg(to_jsonb(sub)), '[]'::jsonb) INTO v_comps FROM (
    SELECT bl.bat_listing_url AS url, bl.bat_listing_title AS title, bl.sale_price, bl.bid_count,
      bl.comment_count, bl.seller_username, bl.sale_date
    FROM bat_listings bl INNER JOIN vehicles v ON v.id = bl.vehicle_id
    WHERE v.make = v_make AND v.year BETWEEN COALESCE(v_year,1900)-5 AND COALESCE(v_year,2030)+5
      AND bl.listing_status = 'sold' AND bl.sale_price > 0 AND bl.vehicle_id != v_vehicle_id
    ORDER BY bl.sale_date DESC NULLS LAST LIMIT 20
  ) sub;

  -- 5. Bid timeline
  SELECT COALESCE(jsonb_agg(to_jsonb(sub) ORDER BY sub.posted_at), '[]'::jsonb) INTO v_bid_timeline FROM (
    SELECT ac.bid_amount AS amount, ac.author_username AS bidder, ac.posted_at,
      ac.hours_until_close AS hours_before_end, ac.bat_author_likes
    FROM auction_comments ac
    WHERE ac.vehicle_id = v_vehicle_id AND ac.platform = 'bat' AND ac.bid_amount > 0
  ) sub;

  -- 6. Comp velocity
  SELECT jsonb_build_object(
    'avg_final_price', round(avg(sub2.sale_price)::numeric),
    'avg_bid_count', round(avg(sub2.bid_count)::numeric),
    'comp_count', count(*),
    'pct_bids_in_last_24h', round((avg(sub2.pct_24h) * 100)::numeric, 1),
    'pct_bids_in_last_2h', round((avg(sub2.pct_2h) * 100)::numeric, 1)
  ) INTO v_comp_velocity FROM (
    SELECT bl.sale_price::float, bl.bid_count::float,
      COALESCE((SELECT count(*) FILTER (WHERE hours_until_close < 24)::float / NULLIF(count(*) FILTER (WHERE bid_amount > 0), 0)
       FROM auction_comments WHERE vehicle_id = bl.vehicle_id AND platform = 'bat'), 0) as pct_24h,
      COALESCE((SELECT count(*) FILTER (WHERE hours_until_close < 2)::float / NULLIF(count(*) FILTER (WHERE bid_amount > 0), 0)
       FROM auction_comments WHERE vehicle_id = bl.vehicle_id AND platform = 'bat'), 0) as pct_2h
    FROM bat_listings bl INNER JOIN vehicles v ON v.id = bl.vehicle_id
    WHERE v.make = v_make AND v.year BETWEEN COALESCE(v_year,1900)-5 AND COALESCE(v_year,2030)+5
      AND bl.listing_status = 'sold' AND bl.sale_price > 0 AND bl.vehicle_id != v_vehicle_id
    LIMIT 50
  ) sub2;

  RETURN jsonb_build_object(
    'listing', v_listing, 'seller', v_seller, 'bidders', v_bidders,
    'comps', v_comps, 'bid_timeline', v_bid_timeline,
    'comp_velocity', v_comp_velocity, 'computed_at', now()
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.popup_make_intel(p_make text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '10s'
AS $function$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM vehicles WHERE make = p_make AND is_public = true),
    'for_sale', (SELECT count(*) FROM vehicles WHERE make = p_make AND is_public = true AND is_for_sale = true),
    'recent_sales', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.sale_date DESC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT id, year, model, sale_price, sale_date,
               primary_image_url as thumbnail, mileage,
               nuke_estimate, heat_score
        FROM vehicles
        WHERE make = p_make AND is_public = true
          AND sale_price > 0
          AND sale_date > now() - interval '90 days'
        ORDER BY sale_date DESC NULLS LAST
        LIMIT 8
      ) sub
    ),
    'live_now', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
      FROM (
        SELECT id, year, model, 
               COALESCE(asking_price, current_value) as price,
               primary_image_url as thumbnail,
               discovery_source as source
        FROM vehicles
        WHERE make = p_make AND is_public = true AND is_for_sale = true
        ORDER BY created_at DESC
        LIMIT 4
      ) sub
    ),
    'top_models', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.cnt DESC), '[]'::jsonb)
      FROM (
        SELECT model as label, count(*) as cnt,
               round(avg(sale_price) FILTER (WHERE sale_price > 0))::int as avg_price,
               count(*) FILTER (WHERE is_for_sale = true) as for_sale
        FROM vehicles
        WHERE make = p_make AND is_public = true AND model IS NOT NULL
        GROUP BY model
        ORDER BY count(*) DESC
        LIMIT 12
      ) sub
    ),
    'sources', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.cnt DESC), '[]'::jsonb)
      FROM (
        SELECT platform_source as label, count(*) as cnt
        FROM vehicles
        WHERE make = p_make AND is_public = true AND platform_source IS NOT NULL
        GROUP BY platform_source
        ORDER BY count(*) DESC
        LIMIT 6
      ) sub
    ),
    'price_scatter', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('y', year, 'p', sale_price))
      FROM (
        SELECT year, sale_price
        FROM vehicles
        WHERE make = p_make AND is_public = true
          AND sale_price > 0 AND year > 1900
        ORDER BY random()
        LIMIT 200
      ) sub
    ), '[]'::jsonb)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.popup_model_intel(p_make text, p_model text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '10s'
AS $function$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM vehicles WHERE make = p_make AND model = p_model AND is_public = true),
    'for_sale', (SELECT count(*) FROM vehicles WHERE make = p_make AND model = p_model AND is_public = true AND is_for_sale = true),
    'recent_sales', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.sale_date DESC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT id, year, make, model, sale_price, sale_date,
               primary_image_url, mileage, nuke_estimate
        FROM vehicles
        WHERE make = p_make AND model = p_model AND is_public = true
          AND sale_price > 0
        ORDER BY sale_date DESC NULLS LAST
        LIMIT 6
      ) sub
    ),
    'live_now', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
      FROM (
        SELECT id, year, make, model,
               COALESCE(asking_price, current_value) as sale_price,
               primary_image_url, mileage, nuke_estimate
        FROM vehicles
        WHERE make = p_make AND model = p_model AND is_public = true AND is_for_sale = true
        ORDER BY created_at DESC
        LIMIT 4
      ) sub
    ),
    'price_scatter', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('y', year, 'p', sale_price))
      FROM (
        SELECT year, sale_price
        FROM vehicles
        WHERE make = p_make AND model = p_model AND is_public = true
          AND sale_price > 0 AND year > 1900
        ORDER BY random()
        LIMIT 100
      ) sub
    ), '[]'::jsonb),
    'year_range', (
      SELECT jsonb_build_object(
        'min', min(year),
        'max', max(year)
      )
      FROM vehicles
      WHERE make = p_make AND model = p_model AND is_public = true AND year > 1900
    ),
    'sources', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.cnt DESC), '[]'::jsonb)
      FROM (
        SELECT platform_source as label, count(*) as cnt
        FROM vehicles
        WHERE make = p_make AND model = p_model AND is_public = true AND platform_source IS NOT NULL
        GROUP BY platform_source
        ORDER BY count(*) DESC
        LIMIT 6
      ) sub
    )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.popup_source_intel(p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET statement_timeout TO '14s'
AS $function$
DECLARE
  norm text;
  v_total bigint;
  v_for_sale bigint;
  v_sold_week bigint;
  v_sold_month bigint;
  v_recent jsonb;
  v_live jsonb;
  v_makes jsonb;
BEGIN
  -- Normalize source aliases
  norm := CASE
    WHEN lower(p_source) IN ('bat', 'bat_core', 'bat_import', 'bat_listing', 'bat_profile_extraction', 'bringatrailer') THEN 'bringatrailer'
    WHEN lower(p_source) IN ('c&b', 'carsandbids', 'cars-and-bids') THEN 'cars-and-bids'
    WHEN lower(p_source) IN ('fb', 'facebook', 'fb_marketplace', 'facebook_marketplace') THEN 'facebook_marketplace'
    WHEN lower(p_source) IN ('bj', 'barrett-jackson', 'barrettjackson') THEN 'barrett-jackson'
    WHEN lower(p_source) IN ('rm', 'rm-sothebys', 'rmsothebys') THEN 'rm-sothebys'
    WHEN lower(p_source) IN ('cl', 'craigslist') THEN 'craigslist'
    WHEN lower(p_source) IN ('classic', 'classic.com') THEN 'classic'
    WHEN lower(p_source) IN ('cc', 'collectingcars', 'collecting-cars') THEN 'collecting-cars'
    ELSE lower(p_source)
  END;

  -- Single scan for counts
  SELECT count(*),
         count(*) FILTER (WHERE is_for_sale = true),
         count(*) FILTER (WHERE sale_date > now() - interval '7 days' AND sale_price > 0),
         count(*) FILTER (WHERE sale_date > now() - interval '30 days' AND sale_price > 0)
  INTO v_total, v_for_sale, v_sold_week, v_sold_month
  FROM vehicles
  WHERE platform_source = norm AND is_public = true;

  -- Recent sales
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT id, year, make, model, sale_price, sale_date, primary_image_url as thumbnail
    FROM vehicles WHERE platform_source = norm AND is_public = true AND sale_price > 0
    ORDER BY sale_date DESC NULLS LAST LIMIT 6
  ) sub;

  -- Live now
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb) INTO v_live
  FROM (
    SELECT id, year, make, model, COALESCE(asking_price, current_value) as price, primary_image_url as thumbnail
    FROM vehicles WHERE platform_source = norm AND is_public = true AND is_for_sale = true
    ORDER BY created_at DESC LIMIT 4
  ) sub;

  -- Top makes
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb) INTO v_makes
  FROM (
    SELECT make as label, count(*) as cnt, count(*) FILTER (WHERE is_for_sale) as for_sale
    FROM vehicles WHERE platform_source = norm AND is_public = true AND make IS NOT NULL
    GROUP BY make ORDER BY count(*) DESC LIMIT 8
  ) sub;

  RETURN jsonb_build_object(
    'total', v_total,
    'for_sale', v_for_sale,
    'sold_this_week', v_sold_week,
    'sold_this_month', v_sold_month,
    'recent_sales', v_recent,
    'live_now', v_live,
    'top_makes', v_makes
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_make_model_terminal(p_make text, p_model text, p_year integer DEFAULT NULL::integer, p_grain text DEFAULT 'year'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_subject uuid; v_ids uuid[]; v_count int; v_canon_model text;
  v_price jsonb; v_flow jsonb; v_sentiment jsonb; v_production jsonb;
  v_survival jsonb; v_comps jsonb; v_dealers jsonb; v_cited jsonb; v_points jsonb;
BEGIN
  SELECT cm.canonical_model INTO v_canon_model FROM public.canonical_models cm
  WHERE lower(cm.make) = lower(p_make)
    AND (lower(cm.canonical_model) = lower(p_model) OR lower(p_model) = ANY (SELECT lower(a) FROM unnest(cm.aliases) a))
  LIMIT 1;
  v_canon_model := COALESCE(v_canon_model, p_model);

  SELECT subject_id INTO v_subject FROM public.make_model_profiles
   WHERE lower(canonical_make) = lower(p_make) AND lower(canonical_model) = lower(v_canon_model)
     AND grain = p_grain AND (p_grain <> 'year' OR year = p_year) LIMIT 1;
  IF v_subject IS NULL THEN
    RETURN jsonb_build_object('resolved', false,
      'note', 'No make_model subject registered yet — call register_make_model_subject(). Absence is an intake gap, not a market verdict.');
  END IF;

  -- definer: the cohort is what a visitor may see (public, not deleted), stated here instead of left to row
  -- security, whose per-row checks on vehicles pushed the visitor call past the 15 s limit (2026-09-28)
  SELECT array_agg(cm.vehicle_id) INTO v_ids
  FROM public.cohort_members(v_subject) cm JOIN public.vehicles v ON v.id = cm.vehicle_id
  WHERE v.is_public AND v.deleted_at IS NULL;
  v_count := COALESCE(array_length(v_ids, 1), 0);

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events.final_price',
           'method', 'cohort_aggregate', 'n', count(*),
           'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price),
           'p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY ve.final_price),
           'p75', percentile_cont(0.75) WITHIN GROUP (ORDER BY ve.final_price),
           'min', min(ve.final_price), 'max', max(ve.final_price), 'observed_at', now())
    INTO v_price FROM public.vehicle_events ve
  WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0;

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events', 'method', 'quarterly_flow',
           'series', COALESCE(jsonb_agg(jsonb_build_object('quarter', q, 'sales', n, 'median_price', med) ORDER BY q), '[]'::jsonb))
    INTO v_flow FROM (
    SELECT date_trunc('quarter', COALESCE(ve.sold_at, ve.ended_at)) AS q, count(*) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price) AS med
    FROM public.vehicle_events ve WHERE ve.vehicle_id = ANY (v_ids)
      AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL AND ve.final_price IS NOT NULL AND ve.final_price > 0
    GROUP BY 1) s;

  -- price_points: the HONEST full set — every priced cohort sale, UNCAPPED, source + date(-exact?).
  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events.final_price (uncapped per-sale)',
           'n', count(*), 'n_dated', count(*) FILTER (WHERE date_exact),
           'points', COALESCE(jsonb_agg(jsonb_build_object('vehicle_id', vehicle_id, 'price', price, 'date', d,
                       'date_exact', date_exact, 'source', source, 'miles', miles, 'url', url) ORDER BY price), '[]'::jsonb))
    INTO v_points FROM (
    SELECT ve.vehicle_id, ve.final_price AS price,
           COALESCE(ve.sold_at, ve.ended_at, ve.created_at)::date AS d,
           (ve.sold_at IS NOT NULL OR ve.ended_at IS NOT NULL) AS date_exact,
           ve.source_platform AS source, v.mileage AS miles, ve.source_url AS url
    FROM public.vehicle_events ve JOIN public.vehicles v ON v.id = ve.vehicle_id
    WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0
    ORDER BY ve.final_price) pts;

  SELECT jsonb_build_object('populated', count(cd.sentiment_score) > 0, 'source', 'comment_discoveries',
           'method', 'cohort_avg', 'avg_sentiment_score', avg(cd.sentiment_score), 'n', count(cd.sentiment_score), 'observed_at', now())
    INTO v_sentiment FROM public.comment_discoveries cd WHERE cd.vehicle_id = ANY (v_ids);

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events.seller_identifier', 'method', 'top_sellers_in_cohort',
           'top', COALESCE(jsonb_agg(jsonb_build_object('seller', seller_identifier, 'events', n, 'median_price', med) ORDER BY n DESC), '[]'::jsonb))
    INTO v_dealers FROM (
    SELECT ve.seller_identifier, count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price) AS med
    FROM public.vehicle_events ve WHERE ve.vehicle_id = ANY (v_ids) AND ve.seller_identifier IS NOT NULL AND ve.seller_identifier <> ''
    GROUP BY ve.seller_identifier ORDER BY count(*) DESC LIMIT 10) d;

  SELECT jsonb_build_object(
           'populated', count(*) FILTER (WHERE cited) > 0,
           'source', 'vehicle_production_data',
           'total_produced', max(total_produced) FILTER (WHERE cited),
           'min_produced', min(total_produced) FILTER (WHERE cited),
           'max_produced', max(total_produced) FILTER (WHERE cited),
           'rarity_level', (array_agg(rarity_level ORDER BY total_produced DESC) FILTER (WHERE cited))[1],
           'verified', bool_or(cited),
           'source_url', (array_agg(source_url ORDER BY total_produced DESC) FILTER (WHERE cited))[1],
           'n_cited', count(*) FILTER (WHERE cited),
           'has_uncited_claims', COALESCE(bool_or(NOT cited), false))
    INTO v_production FROM (
      SELECT vp.total_produced, vp.rarity_level, vp.source_url,
             (vp.source_url IS NOT NULL AND COALESCE(vp.quarantined, false) = false) AS cited
      FROM public.vehicle_production_data vp
      WHERE lower(vp.make) = lower(p_make)
        AND (lower(vp.model) = lower(v_canon_model) OR lower(vp.model) = lower(p_model))
        AND vp.year = p_year
    ) q;

  SELECT jsonb_build_object('populated', sre.survival_rate IS NOT NULL, 'source', 'survival_rate_estimates',
           'survival_rate', sre.survival_rate, 'estimated_surviving', sre.estimated_surviving,
           'confidence', sre.confidence_score, 'floor_known_members', v_count,
           'note', 'survival_rate_estimates is sparse; member count is a lower-bound floor, not the estimate.')
    INTO v_survival FROM public.survival_rate_estimates sre
  WHERE lower(sre.make) = lower(p_make) AND lower(sre.model) = lower(p_model)
    AND COALESCE(p_year, sre.year_start) BETWEEN sre.year_start AND sre.year_end LIMIT 1;

  -- comps: full cohort sold set (UNCAPPED), priciest first. The client paginates/virtualizes.
  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events (cohort sold)', 'n', count(*),
           'rows', COALESCE(jsonb_agg(jsonb_build_object('vehicle_id', vehicle_id, 'year', yr, 'make', mk, 'model', mdl, 'trim', tr,
                     'sale_price', sale_price, 'miles', miles, 'platform', platform, 'sold_date', sold_date,
                     'listing_url', listing_url, 'image_url', image_url) ORDER BY sale_price DESC NULLS LAST), '[]'::jsonb))
    INTO v_comps FROM (
    SELECT ve.vehicle_id, v.year AS yr, v.make AS mk, v.model AS mdl, v.trim AS tr, ve.final_price AS sale_price,
           v.mileage AS miles, ve.source_platform AS platform, COALESCE(ve.sold_at, ve.ended_at) AS sold_date,
           ve.source_url AS listing_url, v.primary_image_url AS image_url
    FROM public.vehicle_events ve JOIN public.vehicles v ON v.id = ve.vehicle_id
    WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0
      AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL ORDER BY ve.final_price DESC) c;

  -- projection_event has no read policy: only the service role (and direct database sessions) ever saw these
  -- rows. Running as definer must not widen that, so cited fields stay empty for everyone else.
  IF coalesce(auth.role(), 'service_role') = 'service_role' THEN
    SELECT jsonb_agg(public.project_attribute(v_subject, attr) ORDER BY attr) INTO v_cited FROM (
      SELECT DISTINCT request_envelope->>'attribute' AS attr FROM public.projection_event
      WHERE request_envelope->>'subject_id' = v_subject::text AND request_envelope->>'subject_kind' = 'make_model' AND retracted_at IS NULL) a;
  END IF;

  RETURN jsonb_build_object('resolved', true, 'subject_id', v_subject,
    'cohort', jsonb_build_object('make', p_make, 'model', COALESCE(v_canon_model, p_model), 'year', p_year, 'grain', p_grain),
    'cohort_count', jsonb_build_object('populated', v_count > 0, 'value', v_count, 'source', 'cohort_members'),
    'price_distribution', COALESCE(v_price, jsonb_build_object('populated', false)),
    'price_points', COALESCE(v_points, jsonb_build_object('populated', false)),
    'market_flow', COALESCE(v_flow, jsonb_build_object('populated', false)),
    'sentiment', COALESCE(v_sentiment, jsonb_build_object('populated', false)),
    'dealer_flow', COALESCE(v_dealers, jsonb_build_object('populated', false)),
    'production', COALESCE(v_production, jsonb_build_object('populated', false)),
    'survival', COALESCE(v_survival, jsonb_build_object('populated', false, 'floor_known_members', v_count)),
    'comps', COALESCE(v_comps, jsonb_build_object('populated', false)),
    'cited_fields', COALESCE(v_cited, '[]'::jsonb),
    'note', 'Cohort terminal: live aggregates ASSEMBLED from substrate + curated fields PROJECTED. populated=false is an intake gap.');
END;
$function$
;
drop index if exists public.vehicle_events_price_verification_any_idx;
