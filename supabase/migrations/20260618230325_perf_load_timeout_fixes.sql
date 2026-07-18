-- Perf: fix iOS read-RPC load timeouts. Root cause: a 1GB Micro instance serving
-- 28GB+ tables -> cold random heap I/O. Applied to PROD 2026-06-18 via CREATE INDEX
-- CONCURRENTLY (online) + CREATE OR REPLACE. This file is repo/prod parity (fresh DB
-- builds them; prod already has them so IF NOT EXISTS no-ops). After (Large compute):
-- specs 250ms, engagement 67ms, day_receipt 80ms, calendar 109ms, field_prov 80ms,
-- comps 611ms warm — all were 30s timeouts.

CREATE INDEX IF NOT EXISTS idx_vobs_image_id_analysis ON public.vehicle_observations ((structured_data->>'image_id'), (structured_data->>'analysis_kind')) WHERE (structured_data->>'image_id') IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vobs_specs_covering ON public.vehicle_observations (vehicle_id) INCLUDE (is_superseded, structured_data) WHERE (NOT COALESCE(is_superseded, false)) AND (structured_data ?| ARRAY['vin','mileage','transmission','drivetrain','body_style','color','interior_color','engine_type','fuel_type']);
CREATE INDEX IF NOT EXISTS idx_vobs_engagement_contrib ON public.vehicle_observations (vehicle_id, kind, is_superseded, ((structured_data ->> 'authored'))) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vobs_structured_data_gin ON public.vehicle_observations USING gin (structured_data jsonb_ops);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_user_taken_at ON public.vehicle_images (user_id, taken_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_user_contrib_day ON public.vehicle_images (user_id, (COALESCE(taken_at, created_at)));
CREATE INDEX IF NOT EXISTS idx_vehicle_images_user_capture_stats ON public.vehicle_images (user_id, source, created_at, taken_at);
CREATE INDEX IF NOT EXISTS idx_work_sessions_user_session_date ON public.work_sessions (user_id, session_date DESC NULLS LAST);
ALTER TABLE public.nuke_estimates SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_threshold = 200, autovacuum_analyze_threshold = 200);

-- get_user_garage: LATERAL-over-vehicle_images -> correlated subquery (planning 2931ms->1.1ms)
CREATE OR REPLACE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text, image_url text, current_value numeric, purchase_price numeric, image_count bigint, relationship text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH owned AS (
    SELECT vehicle_id, 1 pr FROM vehicle_ownerships WHERE owner_profile_id=p_user_id AND is_current=true
    UNION SELECT vehicle_id, 1 FROM ownership_verifications WHERE user_id=p_user_id AND status='approved'
    UNION SELECT vehicle_id, 2 FROM discovered_vehicles WHERE user_id=p_user_id AND is_active=true AND relationship_type='previously_owned'
    UNION SELECT vehicle_id, 3 FROM vehicle_contributors WHERE user_id=p_user_id
  ),
  dedup AS (SELECT vehicle_id, MIN(pr) pr FROM owned GROUP BY vehicle_id)
  SELECT v.id, v.year, v.make, v.model, v.trim,
         COALESCE(v.primary_image_url,
                  (SELECT vi2.image_url FROM vehicle_images vi2
                     WHERE vi2.vehicle_id = v.id AND vi2.image_url IS NOT NULL
                     ORDER BY vi2.created_at LIMIT 1)),
         (SELECT ne.estimated_value FROM nuke_estimates ne
            WHERE ne.vehicle_id = v.id AND ne.comp_method = 'class_stratified'
            ORDER BY ne.calculated_at DESC NULLS LAST LIMIT 1),
         v.purchase_price,
         COALESCE(v.image_count, 0)::bigint,
         CASE d.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously_owned' ELSE 'contributor' END
  FROM dedup d JOIN vehicles v ON v.id=d.vehicle_id
  ORDER BY d.pr, v.year;
$function$;

-- get_comps_scored: model predicate pushed into both candidate CTEs (no longer scans all Chevrolets)
CREATE OR REPLACE FUNCTION public.get_comps_scored(p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 5, p_engine_type text DEFAULT NULL::text, p_transmission text DEFAULT NULL::text, p_drivetrain text DEFAULT NULL::text, p_mileage integer DEFAULT NULL::integer, p_trim text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, similarity_score numeric, score_breakdown jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  w_year        constant numeric := 15;
  w_model       constant numeric := 25;
  w_engine_cyl  constant numeric := 12;
  w_engine_cfg  constant numeric := 5;
  w_trans       constant numeric := 15;
  w_drivetrain  constant numeric := 10;
  w_mileage     constant numeric := 8;
  w_body        constant numeric := 5;
  w_trim_w      constant numeric := 5;

  ref_trans     text;
  ref_cyls      integer;
  ref_eng_cfg   text;
  ref_drive     text;
BEGIN
  ref_trans    := classify_transmission(p_transmission);
  ref_cyls     := extract_cylinder_count(p_engine_type);
  ref_eng_cfg  := extract_engine_config(p_engine_type);
  ref_drive    := classify_drivetrain(p_drivetrain);

  RETURN QUERY
  WITH auction_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      ae.winning_bid AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ae.source_url,
      ae.source, ae.auction_end_date,
      'auction_event'::text AS src_type,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM vehicles v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%')
      AND (p_year IS NULL OR v.year BETWEEN p_year - p_year_range AND p_year + p_year_range)
      AND ae.winning_bid > 0
      AND ae.outcome = 'sold'
      AND (p_min_price IS NULL OR ae.winning_bid >= p_min_price)
      AND (p_max_price IS NULL OR ae.winning_bid <= p_max_price)
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ),
  vehicle_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      v.sale_price AS price, v.mileage, v.color,
      v.primary_image_url, v.location, v.listing_url AS source_url,
      NULL::text AS source, NULL::timestamptz AS auction_end_date,
      'vehicle_record'::text AS src_type,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM vehicles v
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%')
      AND (p_year IS NULL OR v.year BETWEEN p_year - p_year_range AND p_year + p_year_range)
      AND v.sale_price IS NOT NULL AND v.sale_price > 0
      AND (p_min_price IS NULL OR v.sale_price >= p_min_price)
      AND (p_max_price IS NULL OR v.sale_price <= p_max_price)
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND NOT EXISTS (
        SELECT 1 FROM auction_events ae2
        WHERE ae2.vehicle_id = v.id AND ae2.winning_bid > 0 AND ae2.outcome = 'sold'
      )
  ),
  all_cands AS (
    SELECT * FROM auction_cands
    UNION ALL
    SELECT * FROM vehicle_cands
  ),
  scored AS (
    SELECT
      c.id AS vehicle_id,
      c.year AS yr,
      c.make AS mk,
      c.model AS mdl,
      c.trim AS tr,
      c.vin AS vi,
      c.price AS sale_price,
      c.mileage AS miles,
      c.color AS clr,
      c.primary_image_url AS image_url,
      c.location AS loc,
      c.source_url AS listing_url,
      c.source AS platform,
      c.auction_end_date AS sold_date,
      c.src_type AS source_type,

      -- Year score
      (CASE WHEN p_year IS NOT NULL AND c.year IS NOT NULL
        THEN w_year * GREATEST(0, 1.0 - ABS(c.year - p_year)::numeric / GREATEST(p_year_range, 1))
        ELSE w_year * 0.5
      END) AS s_year,

      -- Model score
      (CASE
        WHEN p_model IS NULL THEN w_model * 0.5
        WHEN lower(c.model) = lower(p_model) THEN w_model
        WHEN lower(c.model) LIKE '%' || lower(p_model) || '%' THEN w_model * 0.7
        WHEN lower(p_model) LIKE '%' || lower(c.model) || '%' THEN w_model * 0.6
        WHEN lower(c.model) LIKE '%' || lower(split_part(p_model, ' ', 1)) || '%' THEN w_model * 0.4
        ELSE 0
      END) AS s_model,

      -- Engine cylinder score
      (CASE
        WHEN ref_cyls IS NULL OR extract_cylinder_count(c.v_engine) IS NULL THEN w_engine_cyl * 0.3
        WHEN extract_cylinder_count(c.v_engine) = ref_cyls THEN w_engine_cyl
        WHEN ABS(extract_cylinder_count(c.v_engine) - ref_cyls) <= 2 THEN w_engine_cyl * 0.5
        ELSE 0
      END) AS s_engine_cyl,

      -- Engine config score
      (CASE
        WHEN ref_eng_cfg IS NULL OR extract_engine_config(c.v_engine) IS NULL THEN w_engine_cfg * 0.3
        WHEN extract_engine_config(c.v_engine) = ref_eng_cfg THEN w_engine_cfg
        ELSE 0
      END) AS s_engine_cfg,

      -- Transmission score
      (CASE
        WHEN ref_trans IS NULL OR classify_transmission(c.v_trans) IS NULL THEN w_trans * 0.3
        WHEN classify_transmission(c.v_trans) = ref_trans THEN w_trans
        ELSE 0
      END) AS s_trans,

      -- Drivetrain score
      (CASE
        WHEN ref_drive IS NULL OR classify_drivetrain(c.v_drive) IS NULL THEN w_drivetrain * 0.3
        WHEN classify_drivetrain(c.v_drive) = ref_drive THEN w_drivetrain
        WHEN classify_drivetrain(c.v_drive) IN ('4WD','AWD') AND ref_drive IN ('4WD','AWD') THEN w_drivetrain * 0.8
        ELSE 0
      END) AS s_drivetrain,

      -- Mileage score
      (CASE
        WHEN p_mileage IS NULL OR c.mileage IS NULL OR p_mileage = 0 THEN w_mileage * 0.3
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.2 THEN w_mileage
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.5 THEN w_mileage * 0.6
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 1.0 THEN w_mileage * 0.3
        ELSE 0
      END) AS s_mileage,

      -- Body style score
      (CASE
        WHEN p_body_style IS NULL OR c.v_body IS NULL THEN w_body * 0.3
        WHEN lower(c.v_body) = lower(p_body_style) THEN w_body
        WHEN lower(c.v_body) LIKE '%' || lower(p_body_style) || '%' THEN w_body * 0.6
        ELSE 0
      END) AS s_body,

      -- Trim score
      (CASE
        WHEN p_trim IS NULL OR c.trim IS NULL THEN w_trim_w * 0.3
        WHEN lower(c.trim) = lower(p_trim) THEN w_trim_w
        WHEN lower(c.trim) LIKE '%' || lower(p_trim) || '%' THEN w_trim_w * 0.6
        ELSE 0
      END) AS s_trim

    FROM all_cands c
  )
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    ROUND(s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim, 1) AS similarity_score,
    jsonb_build_object(
      'year', ROUND(s.s_year, 1),
      'model', ROUND(s.s_model, 1),
      'engine_cyl', ROUND(s.s_engine_cyl, 1),
      'engine_cfg', ROUND(s.s_engine_cfg, 1),
      'transmission', ROUND(s.s_trans, 1),
      'drivetrain', ROUND(s.s_drivetrain, 1),
      'mileage', ROUND(s.s_mileage, 1),
      'body_style', ROUND(s.s_body, 1),
      'trim', ROUND(s.s_trim, 1)
    ) AS score_breakdown
  FROM scored s
  ORDER BY
    (s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim) DESC,
    s.sold_date DESC NULLS LAST
  LIMIT p_limit;
END;
$function$

;
