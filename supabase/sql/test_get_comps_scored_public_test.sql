-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_get_comps_public -f this-file.sql
-- Proves 20261125134000_get_comps_scored_public_test.sql: both get_comps_scored overloads stop returning a private or a
-- deleted vehicle as a comp, on both candidate branches (auction events and vehicle records), and keep returning the
-- public ones. The functions start as production held them on 2026-11-25 (pg_get_functiondef, embedded below); the
-- leak is shown on them, the migration is applied twice, and each body must equal its live body with only the anchor
-- line extended. Security, settings and grants must not change. The helpers the bodies call are stubbed to admit
-- every row, except lot_class_of, which is the live body. Rows are a disposable database's rows, never testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET TimeZone = 'UTC';
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TYPE public.price_basis_t AS ENUM ('hammer', 'gross_incl_premium', 'net_to_owner', 'unknown');
CREATE TYPE public.lot_class_t AS ENUM ('car', 'motorcycle', 'minibike', 'kart', 'atv', 'boat', 'trailer', 'tractor', 'memorabilia', 'wheels', 'engine', 'part');
CREATE TYPE public.sale_outcome_t AS ENUM ('sold', 'bid_to', 'no_sale', 'withdrawn', 'unknown');
-- The columns the two bodies read, with production's types.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, model text, year integer, vin text, color text, mileage integer,
  transmission text, drivetrain text, body_style text, is_public boolean DEFAULT true, sale_price integer, bat_sale_date date,
  sale_date date, deleted_at timestamptz, trim text, primary_image_url text, engine_type text, location text, listing_url text,
  listing_kind text, currency_code text, sale_price_currency text);
-- auction_events_canonical is a view in production; a table with its columns stands in.
CREATE TABLE public.auction_events_canonical (vehicle_id uuid REFERENCES public.vehicles(id), source text, source_url text,
  auction_end_date timestamptz, outcome text, winning_bid numeric, raw_data jsonb, currency_code text, hammer_price numeric,
  gross_price numeric, net_to_owner numeric);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles(id),
  source_platform text, source_url text, event_status text, ended_at timestamptz, sold_at timestamptz, hammer_price numeric,
  gross_price numeric, net_to_owner numeric, price_verification text, source_suspect text[], sale_outcome public.sale_outcome_t);
CREATE TABLE public.vehicle_lot_class (vehicle_id uuid REFERENCES public.vehicles(id), lot_class public.lot_class_t, retired_at timestamptz);
CREATE TABLE public.record_quarantine (tbl text, row_id uuid, released_at timestamptz);

-- Helpers: stubs that admit every row (the leak and the fix do not depend on them), and the live lot_class_of.
CREATE FUNCTION public.classify_transmission(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.extract_cylinder_count(text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::integer $$;
CREATE FUNCTION public.extract_engine_config(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.classify_drivetrain(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.model_spelling_key(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(regexp_replace($1, '[^a-zA-Z0-9]', '', 'g')) $$;
CREATE FUNCTION public.fx_usd_rate(text, date) RETURNS TABLE(rate numeric, rate_date date, source text, source_url text)
  LANGUAGE sql STABLE AS $$ SELECT 1::numeric, $2, 'test'::text, NULL::text $$;
CREATE FUNCTION public.auction_event_typed_not_sold(uuid, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.vehicle_sale_price_untrusted(uuid, numeric) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.vehicle_event_low_trust(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.vehicle_event_comp_excluded(uuid, text[]) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.event_resolved_platform(uuid, text[]) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE OR REPLACE FUNCTION public.lot_class_of(p_vehicle_id uuid)
 RETURNS lot_class_t
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce((select lc.lot_class from public.vehicle_lot_class lc where lc.vehicle_id = p_vehicle_id and lc.retired_at is null), 'car'::public.lot_class_t)
$function$;

-- Live bodies, 2026-11-25.
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
  WITH comp_ids AS MATERIALIZED (
    -- narrow pre-filter: index-only on idx_vehicles_comp_probe, heap read only for matching ids
    SELECT vv.id FROM public.vehicles vv
    WHERE lower(vv.make) = lower(p_make)
      AND (p_year IS NULL OR vv.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND (p_model IS NULL OR lower(vv.model) = lower(p_model) OR lower(vv.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(vv.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(vv.model)) >= 2 AND (public.model_spelling_key(vv.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(vv.model) || '%')))
      AND listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = vv.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = vv.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id)))
  ),
  auction_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      ae.winning_bid AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ae.source_url,
      ae.source, ae.auction_end_date,
      'auction_event'::text AS src_type,
      ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM public.vehicles v JOIN comp_ids ci ON ci.id = v.id
    JOIN public.auction_events_canonical ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND ae.winning_bid > 0
      AND ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
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
      COALESCE(v.sale_price_currency, v.currency_code) AS cur, COALESCE(v.sale_date, v.bat_sale_date) AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM public.vehicles v JOIN comp_ids ci ON ci.id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND v.sale_price IS NOT NULL AND v.sale_price > 0
      -- price_verification: one shared rule (vehicle_sale_price_untrusted)
      AND NOT public.vehicle_sale_price_untrusted(v.id, v.sale_price)
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.auction_events_canonical ae2
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
$function$;

CREATE OR REPLACE FUNCTION public.get_comps_scored(p_basis price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 5, p_engine_type text DEFAULT NULL::text, p_transmission text DEFAULT NULL::text, p_drivetrain text DEFAULT NULL::text, p_mileage integer DEFAULT NULL::integer, p_trim text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, similarity_score numeric, score_breakdown jsonb, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text, price_basis text)
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
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  ref_trans    := classify_transmission(p_transmission);
  ref_cyls     := extract_cylinder_count(p_engine_type);
  ref_eng_cfg  := extract_engine_config(p_engine_type);
  ref_drive    := classify_drivetrain(p_drivetrain);

  RETURN QUERY
  WITH comp_ids AS MATERIALIZED (
    -- narrow pre-filter: index-only on idx_vehicles_comp_probe, heap read only for matching ids
    SELECT vv.id FROM public.vehicles vv
    WHERE lower(vv.make) = lower(p_make)
      AND (p_year IS NULL OR vv.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND (p_model IS NULL OR lower(vv.model) = lower(p_model) OR lower(vv.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(vv.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(vv.model)) >= 2 AND (public.model_spelling_key(vv.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(vv.model) || '%')))
      AND listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = vv.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = vv.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id))) and vv.id <> all (array(select q.row_id from public.record_quarantine q where q.tbl = 'vehicles' and q.released_at is null))
  ),
  auction_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ae.source_url,
      ae.source, ae.auction_end_date,
      'auction_event'::text AS src_type,
      ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM public.vehicles v JOIN comp_ids ci ON ci.id = v.id
    JOIN public.auction_events_canonical ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) > 0
      AND ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ),
  vehicle_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      (CASE p_basis WHEN 'hammer' THEN ve.hammer_price WHEN 'gross_incl_premium' THEN ve.gross_price WHEN 'net_to_owner' THEN ve.net_to_owner END) AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ve.source_url,
      COALESCE(public.event_resolved_platform(ve.id, ve.source_suspect), ve.source_platform) AS source,
      COALESCE(ve.sold_at, ve.ended_at) AS auction_end_date,
      'vehicle_event'::text AS src_type,
      NULL::text AS cur, COALESCE(ve.sold_at, ve.ended_at)::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM public.vehicles v JOIN comp_ids ci ON ci.id = v.id
    JOIN vehicle_events ve ON ve.vehicle_id = v.id
      AND NOT coalesce(ve.sale_outcome is not null and ve.sale_outcome <> 'sold', false)
      AND (ve.source_suspect is null OR NOT public.vehicle_event_comp_excluded(ve.id, ve.source_suspect))
      AND NOT public.vehicle_event_low_trust(ve.id)  -- writer_source_trust: low unless corroborated
      AND ve.id <> all (array(select q.row_id from public.record_quarantine q where q.tbl = 'vehicle_events' and q.released_at is null))
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%')
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND ve.event_status = 'sold'
      AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted'
      AND (CASE p_basis WHEN 'hammer' THEN ve.hammer_price WHEN 'gross_incl_premium' THEN ve.gross_price WHEN 'net_to_owner' THEN ve.net_to_owner END) > 0
      AND v.deleted_at IS NULL
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.auction_events_canonical ae2
        WHERE ae2.vehicle_id = v.id AND ae2.outcome = 'sold' AND (CASE p_basis WHEN 'hammer' THEN ae2.hammer_price WHEN 'gross_incl_premium' THEN ae2.gross_price WHEN 'net_to_owner' THEN ae2.net_to_owner END) > 0
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
    s.price_native::numeric AS sale_price_native, s.cur AS currency_code, s.fx_rate, s.fx_rate_date, s.fx_source, p_basis::text
  FROM scored s
  ORDER BY
    (s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim) DESC,
    s.sold_date DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_comps_scored(text, text, integer, integer, text, text, text, integer, text, text, numeric, numeric, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_comps_scored(public.price_basis_t, text, text, integer, integer, text, text, text, integer, text, text, numeric, numeric, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comps_scored(text, text, integer, integer, text, text, text, integer, text, text, numeric, numeric, uuid, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_comps_scored(public.price_basis_t, text, text, integer, integer, text, text, text, integer, text, text, numeric, numeric, uuid, integer) TO anon, authenticated, service_role;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
-- The vehicles each overload returns for a 1973 Pontiac Firebird, as a sorted label list (the label is the VIN column).
CREATE FUNCTION public.t_text() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(DISTINCT vi, ',' ORDER BY vi), '') FROM public.get_comps_scored('Pontiac', 'Firebird', 1973, 5, p_limit := 50) $$;
CREATE FUNCTION public.t_basis() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(DISTINCT vi, ',' ORDER BY vi), '') FROM public.get_comps_scored('hammer'::public.price_basis_t, 'Pontiac', 'Firebird', 1973, 5, p_limit := 50) $$;
CREATE FUNCTION public.t_state() RETURNS text LANGUAGE sql AS
$$ SELECT string_agg(p.oid::regprocedure::text || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ';'), '')
     || ':' || coalesce(p.proacl::text, ''), ' | ' ORDER BY p.oid::regprocedure::text)
   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_comps_scored' $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_text(), public.t_basis() TO anon;

-- Cars, all 1973 Pontiac Firebird (label in vin):
--   pub_auction   public, a sold auction event           -> returned
--   priv_auction  private, a sold auction event          -> leaked before, never after
--   del_auction   public but deleted, a sold auction     -> leaked before (both overloads), never after
--   pub_record    public, sale on the record and a sold vehicle event (no auction) -> returned
--   priv_record   private, the same                      -> leaked before, never after
--   del_record    public but deleted, the same           -> leaked before by the text overload only
INSERT INTO public.vehicles (id, make, model, year, vin, is_public, deleted_at, sale_price, sale_date) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Pontiac', 'Firebird', 1973, 'pub_auction',  true,  NULL,         NULL, NULL),
  ('a0000000-0000-0000-0000-000000000002', 'Pontiac', 'Firebird', 1973, 'priv_auction', false, NULL,         NULL, NULL),
  ('a0000000-0000-0000-0000-000000000003', 'Pontiac', 'Firebird', 1973, 'del_auction',  true,  '2026-11-01', NULL, NULL),
  ('a0000000-0000-0000-0000-000000000004', 'Pontiac', 'Firebird', 1973, 'pub_record',   true,  NULL,         1,    '2025-06-01'),
  ('a0000000-0000-0000-0000-000000000005', 'Pontiac', 'Firebird', 1973, 'priv_record',  false, NULL,         1,    '2025-06-01'),
  ('a0000000-0000-0000-0000-000000000006', 'Pontiac', 'Firebird', 1973, 'del_record',   true,  '2026-11-01', 1,    '2025-06-01');
INSERT INTO public.auction_events_canonical (vehicle_id, source, source_url, auction_end_date, outcome, winning_bid, hammer_price) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'test', 'https://x.invalid/1', '2025-06-01', 'sold', 1, 1),
  ('a0000000-0000-0000-0000-000000000002', 'test', 'https://x.invalid/2', '2025-06-01', 'sold', 1, 1),
  ('a0000000-0000-0000-0000-000000000003', 'test', 'https://x.invalid/3', '2025-06-01', 'sold', 1, 1);
INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, event_status, sold_at, hammer_price, sale_outcome) VALUES
  ('a0000000-0000-0000-0000-000000000004', 'test', 'https://x.invalid/4', 'sold', '2025-06-01', 1, 'sold'),
  ('a0000000-0000-0000-0000-000000000005', 'test', 'https://x.invalid/5', 'sold', '2025-06-01', 1, 'sold'),
  ('a0000000-0000-0000-0000-000000000006', 'test', 'https://x.invalid/6', 'sold', '2025-06-01', 1, 'sold');

CREATE TEMP TABLE t_before AS SELECT public.t_state() AS state,
  (SELECT pg_get_functiondef('public.get_comps_scored(text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer)'::regprocedure)) AS d_text,
  (SELECT pg_get_functiondef('public.get_comps_scored(price_basis_t,text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer)'::regprocedure)) AS d_basis;

-- Before: the defect, read as anon.
SET ROLE anon;
SELECT t_assert(t_text() = 'del_auction,del_record,priv_auction,priv_record,pub_auction,pub_record',
  'before (text overload): private and deleted cars come back as comps on both branches');
SELECT t_assert(t_basis() = 'del_auction,priv_auction,priv_record,pub_auction,pub_record',
  'before (basis overload): private cars on both branches and the deleted car on the auction branch come back');
RESET ROLE;

\ir ../migrations/20261125134000_get_comps_scored_public_test.sql
\ir ../migrations/20261125134000_get_comps_scored_public_test.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert((SELECT state FROM t_before) = public.t_state(), 'security definer, volatility, settings and grants unchanged on both overloads');
SELECT t_assert(pg_get_functiondef('public.get_comps_scored(text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer)'::regprocedure)
    = replace((SELECT d_text FROM t_before), E'SELECT vv.id FROM public.vehicles vv\n    WHERE lower(vv.make) = lower(p_make)',
              E'SELECT vv.id FROM public.vehicles vv\n    WHERE lower(vv.make) = lower(p_make) AND vv.is_public = true AND vv.deleted_at IS NULL')
  AND pg_get_functiondef('public.get_comps_scored(price_basis_t,text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer)'::regprocedure)
    = replace((SELECT d_basis FROM t_before), E'SELECT vv.id FROM public.vehicles vv\n    WHERE lower(vv.make) = lower(p_make)',
              E'SELECT vv.id FROM public.vehicles vv\n    WHERE lower(vv.make) = lower(p_make) AND vv.is_public = true AND vv.deleted_at IS NULL'),
  'each body equals its live body with only the comp_ids line extended (applied twice, patched once)');

SET ROLE anon;
SELECT t_assert(t_text() = 'pub_auction,pub_record', 'after (text overload): only the public, undeleted cars, on both branches');
SELECT t_assert(t_basis() = 'pub_auction,pub_record', 'after (basis overload): only the public, undeleted cars, on both branches');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM public.vehicles) = 6 AND (SELECT count(*) FROM public.auction_events_canonical) = 3
  AND (SELECT count(*) FROM public.vehicle_events) = 3, 'no row changed');
