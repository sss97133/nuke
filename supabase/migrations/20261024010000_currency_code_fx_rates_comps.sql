-- Native-currency prices + cited FX conversion for comps (Skylar decision 2026-10-23, Option A).
-- Additive: nullable columns, a new table, new functions. The three comps readers are
-- recreated with the same leading columns plus five trailing currency columns.
-- Revert: /workspace/nuke-strategy/currency-fx-v1-revert.sql (outside the repo).
SET lock_timeout = '5s';

-- 1. currency columns (ISO 4217 code of the stored amount; NULL = unknown, never guessed)
ALTER TABLE public.vehicles       ADD COLUMN IF NOT EXISTS currency_code text, ADD COLUMN IF NOT EXISTS currency_source text;
ALTER TABLE public.vehicle_events ADD COLUMN IF NOT EXISTS currency_code text, ADD COLUMN IF NOT EXISTS currency_source text;
ALTER TABLE public.auction_events ADD COLUMN IF NOT EXISTS currency_code text, ADD COLUMN IF NOT EXISTS currency_source text;
DO $$ BEGIN
  ALTER TABLE public.vehicles       ADD CONSTRAINT vehicles_currency_code_iso       CHECK (currency_code ~ '^[A-Z]{3}$') NOT VALID;
  ALTER TABLE public.vehicle_events ADD CONSTRAINT vehicle_events_currency_code_iso CHECK (currency_code ~ '^[A-Z]{3}$') NOT VALID;
  ALTER TABLE public.auction_events ADD CONSTRAINT auction_events_currency_code_iso CHECK (currency_code ~ '^[A-Z]{3}$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.vehicles.currency_code IS 'ISO 4217 currency of sale_price (native amount). NULL = unknown; comps read NULL as reported.';
COMMENT ON COLUMN public.vehicles.currency_source IS 'Citation/run id for currency_code.';
COMMENT ON COLUMN public.vehicle_events.currency_code IS 'ISO 4217 currency of the price columns (native amounts). NULL = unknown.';
COMMENT ON COLUMN public.vehicle_events.currency_source IS 'Citation/run id for currency_code.';
COMMENT ON COLUMN public.auction_events.currency_code IS 'ISO 4217 currency of the bid/price columns (native amounts). NULL = unknown.';
COMMENT ON COLUMN public.auction_events.currency_source IS 'Citation/run id for currency_code.';

-- 2. daily FX rates, cited
CREATE TABLE IF NOT EXISTS public.fx_rates (
  rate_date      date    NOT NULL,
  base_currency  text    NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text    NOT NULL DEFAULT 'USD' CHECK (quote_currency ~ '^[A-Z]{3}$'),
  rate           numeric NOT NULL CHECK (rate > 0),  -- quote units per 1 base unit
  method         text    NOT NULL,                   -- e.g. 'ecb_cross_via_eur'
  source         text    NOT NULL,                   -- human-readable citation
  source_url     text    NOT NULL,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  run_id         text    NOT NULL,
  PRIMARY KEY (base_currency, quote_currency, rate_date)
);
COMMENT ON TABLE public.fx_rates IS 'Daily FX reference rates with a cited public source. rate = quote_currency per 1 base_currency.';
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY fx_rates_public_read ON public.fx_rates FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON public.fx_rates TO anon, authenticated;

-- 3. conversion helpers. Uses the latest published rate on or before the sale date (max 7 days back:
--    reference rates are not published on weekends/holidays). USD is identity.
CREATE OR REPLACE FUNCTION public.fx_usd_rate(p_currency text, p_on date)
RETURNS TABLE(rate numeric, rate_date date, source text, source_url text)
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = public, pg_catalog
AS $$
  SELECT 1::numeric, p_on, 'identity: amount already in USD'::text, NULL::text
   WHERE upper(p_currency) = 'USD'
  UNION ALL
  SELECT * FROM (
    SELECT f.rate, f.rate_date, f.source, f.source_url
      FROM public.fx_rates f
     WHERE upper(p_currency) <> 'USD' AND p_on IS NOT NULL
       AND f.base_currency = upper(p_currency) AND f.quote_currency = 'USD'
       AND f.rate_date <= p_on AND f.rate_date >= p_on - 7
     ORDER BY f.rate_date DESC LIMIT 1) x
$$;

CREATE OR REPLACE FUNCTION public.fx_to_usd(p_amount numeric, p_currency text, p_on date)
RETURNS numeric LANGUAGE sql STABLE PARALLEL SAFE SET search_path = public, pg_catalog
AS $$ SELECT round(p_amount * r.rate, 2) FROM public.fx_usd_rate(p_currency, p_on) r $$;
COMMENT ON FUNCTION public.fx_to_usd(numeric, text, date) IS 'Native amount x USD rate on/before the date (fx_usd_rate). NULL when currency unknown or no rate within 7 days.';

-- 4. comps readers: price = native x sale-date rate; NULL currency = read as reported; foreign with no rate = excluded.
DROP FUNCTION IF EXISTS public.get_comps_combined(text,text,integer,integer,numeric,numeric,uuid,integer);
DROP FUNCTION IF EXISTS public.get_comps_scored(text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer);
DROP FUNCTION IF EXISTS public.get_auction_comps(text,text,integer,integer,numeric,numeric,uuid,integer);

CREATE OR REPLACE FUNCTION public.get_comps_scored(p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 5, p_engine_type text DEFAULT NULL::text, p_transmission text DEFAULT NULL::text, p_drivetrain text DEFAULT NULL::text, p_mileage integer DEFAULT NULL::integer, p_trim text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, similarity_score numeric, score_breakdown jsonb, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text)
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
      ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM vehicles v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND ae.winning_bid > 0
      AND ae.outcome = 'sold'
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ),
  vehicle_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      v.sale_price AS price, v.mileage, v.color,
      v.primary_image_url, v.location, v.listing_url AS source_url,
      NULL::text AS source,
      -- the sale's own date (UTC midnight), so a comp from 2010 reads as 2010, not as undated
      (COALESCE(v.sale_date, v.bat_sale_date)::timestamp AT TIME ZONE 'UTC') AS auction_end_date,
      'vehicle_record'::text AS src_type,
      v.currency_code AS cur, COALESCE(v.sale_date, v.bat_sale_date) AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM vehicles v
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND v.sale_price IS NOT NULL AND v.sale_price > 0
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND NOT EXISTS (
        SELECT 1 FROM auction_events ae2
        WHERE ae2.vehicle_id = v.id AND ae2.winning_bid > 0 AND ae2.outcome = 'sold'
      )
  ),
  raw_cands AS (
    SELECT * FROM auction_cands
    UNION ALL
    SELECT * FROM vehicle_cands
  ),
  -- native amount x sale-date USD rate (fx_usd_rate). NULL currency = legacy row, read as reported.
  conv_cands AS (
    SELECT r.*, r.price AS price_native, fx.rate AS fx_rate, fx.rate_date AS fx_rate_date,
      CASE WHEN r.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE fx.source END AS fx_source,
      CASE WHEN r.cur IS NULL THEN r.price::numeric ELSE round(r.price * fx.rate, 2) END AS price_usd
    FROM raw_cands r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  ),
  all_cands AS (
    SELECT * FROM conv_cands c
    WHERE (c.cur IS NULL OR c.fx_rate IS NOT NULL)   -- foreign amount with no rate: excluded, never read as USD
      AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
      AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ),
  scored AS (
    SELECT
      c.id AS vehicle_id,
      c.year AS yr,
      c.make AS mk,
      c.model AS mdl,
      c.trim AS tr,
      c.vin AS vi,
      c.price_usd AS sale_price,
      c.mileage AS miles,
      c.color AS clr,
      c.primary_image_url AS image_url,
      c.location AS loc,
      c.source_url AS listing_url,
      c.source AS platform,
      c.auction_end_date AS sold_date,
      c.src_type AS source_type,
      c.price_native, c.cur, c.fx_rate, c.fx_rate_date, c.fx_source,

      -- Year score
      (CASE WHEN p_year IS NOT NULL AND c.year IS NOT NULL
        THEN w_year * GREATEST(0, 1.0 - ABS(c.year - p_year)::numeric / GREATEST(LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50), 1))
        ELSE w_year * 0.5
      END) AS s_year,

      -- Model score
      (CASE
        WHEN p_model IS NULL THEN w_model * 0.5
        WHEN lower(c.model) = lower(p_model) THEN w_model
        WHEN length(public.model_spelling_key(p_model)) >= 2 AND public.model_spelling_key(c.model) = public.model_spelling_key(p_model) THEN w_model
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
    ) AS score_breakdown,
    s.price_native::numeric AS sale_price_native, s.cur AS currency_code, s.fx_rate, s.fx_rate_date, s.fx_source
  FROM scored s
  ORDER BY
    (s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim) DESC,
    s.sold_date DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_comps_combined(p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_year       integer;
  v_year_range integer;
  v_engine     text;
  v_trans      text;
  v_drive      text;
  v_mileage    integer;
  v_trim       text;
  v_body       text;
BEGIN
  -- Compute year and range from min/max
  IF p_year_min IS NOT NULL AND p_year_max IS NOT NULL THEN
    v_year := (p_year_min + p_year_max) / 2;
    v_year_range := GREATEST((p_year_max - p_year_min) / 2, 1);
  ELSIF p_year_min IS NOT NULL THEN
    v_year := p_year_min + 5;
    v_year_range := 5;
  ELSIF p_year_max IS NOT NULL THEN
    v_year := p_year_max - 5;
    v_year_range := 5;
  END IF;

  -- Try to resolve vehicle attributes if we have an exclude_vehicle_id (i.e. the subject)
  IF p_exclude_vehicle_id IS NOT NULL THEN
    SELECT v.engine_type, v.transmission, v.drivetrain, v.mileage, v.trim, v.body_style
    INTO v_engine, v_trans, v_drive, v_mileage, v_trim, v_body
    FROM vehicles v WHERE v.id = p_exclude_vehicle_id;
  END IF;

  RETURN QUERY
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    s.sale_price_native, s.currency_code, s.fx_rate, s.fx_rate_date, s.fx_source
  FROM get_comps_scored(
    p_make         := p_make,
    p_model        := p_model,
    p_year         := v_year,
    p_year_range   := COALESCE(v_year_range, 5),
    p_engine_type  := v_engine,
    p_transmission := v_trans,
    p_drivetrain   := v_drive,
    p_mileage      := v_mileage,
    p_trim         := v_trim,
    p_body_style   := v_body,
    p_min_price    := p_min_price,
    p_max_price    := p_max_price,
    p_exclude_vehicle_id := p_exclude_vehicle_id,
    p_limit        := p_limit
  ) s;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_auction_comps(p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '8s'
AS $function$
BEGIN
  RETURN QUERY
  WITH raw AS (
    SELECT v.id, v.year, v.make, v.model, v.trim, v.vin, ae.winning_bid, v.mileage, v.color,
           v.primary_image_url, v.location, ae.source_url, ae.source, ae.auction_end_date,
           ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on
    FROM vehicles v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND (p_year_min IS NULL OR v.year >= p_year_min)
      AND (p_year_max IS NULL OR v.year <= p_year_max)
      AND ae.winning_bid > 0
      AND ae.outcome = 'sold'
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ), conv AS (
    SELECT r.*, fx.rate, fx.rate_date, fx.source AS fx_src,
           CASE WHEN r.cur IS NULL THEN r.winning_bid ELSE round(r.winning_bid * fx.rate, 2) END AS price_usd
    FROM raw r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  )
  SELECT c.id, c.year, c.make, c.model, c.trim, c.vin, c.price_usd, c.mileage, c.color,
         c.primary_image_url, c.location, c.source_url, c.source, c.auction_end_date,
         c.winning_bid, c.cur, c.rate, c.rate_date,
         CASE WHEN c.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE c.fx_src END
  FROM conv c
  WHERE (c.cur IS NULL OR c.rate IS NOT NULL)
    AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
    AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ORDER BY c.auction_end_date DESC NULLS LAST
  LIMIT p_limit;
END;
$function$
;

REVOKE ALL ON FUNCTION public.get_comps_scored(text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comps_scored(text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_comps_combined(text,text,integer,integer,numeric,numeric,uuid,integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_auction_comps(text,text,integer,integer,numeric,numeric,uuid,integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fx_usd_rate(text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fx_to_usd(numeric, text, date) TO anon, authenticated, service_role;
